import { compactJson2, expandJson } from './compact-json';

/**
 * Bounded reuse of pure replay calculations, never validation verdicts. Structural IDs are interned from
 * exact strings (no digest collisions); mutable object identity is used only inside one synchronous check.
 * Inputs must remain unchanged during that check. Each later check walks its inputs again, including clones.
 * Cached outputs are private JSON text, so neither a returned value nor an input mutation can poison them.
 */
export class ReplayCache {
  private interned = new Map<string, number>();
  private results = new Map<string, string>();
  private objects: WeakMap<object, number> | null = null;
  private bytes = 0;
  private hits = 0;
  private misses = 0;
  private inScope = false;
  private workload = Infinity;
  private blockedFrom: number | null = null;
  constructor(private readonly byteLimit = 64 * 1024 * 1024, private readonly entryLimit = 250_000) {}

  get statistics() { return { bytes: this.bytes, entries: this.interned.size + this.results.size, hits: this.hits, misses: this.misses, blockedFrom: this.blockedFrom }; }
  clear(): void { this.interned.clear(); this.results.clear(); this.bytes = 0; this.objects = null; this.blockedFrom = null; }
  run<T>(compute: () => T, workload = Infinity): T {
    // Nested pure work shares the same immutable-input scope.
    if (this.inScope) return compute();
    this.inScope = true; this.workload = workload;
    this.objects = this.blockedFrom !== null && workload >= this.blockedFrom ? null : new WeakMap();
    try { return compute(); }
    catch (error) { this.clear(); throw error; }
    finally { this.objects = null; this.inScope = false; }
  }
  private reserve(bytes: number): boolean {
    if (this.bytes + bytes > this.byteLimit || this.interned.size + this.results.size >= this.entryLimit) {
      // Do not keep paying to rebuild a cache this career has already outgrown. A smaller workload, a cleared
      // cache or a fresh worker can try again. This admission hint skips caching only, never any validation.
      this.clear(); this.blockedFrom = this.workload; return false;
    }
    this.bytes += bytes; return true;
  }
  private intern(signature: string): number | null {
    if (!this.objects) return null;
    const previous = this.interned.get(signature);
    if (previous !== undefined) return previous;
    if (!this.reserve(signature.length * 2 + 96)) return null;
    const id = this.interned.size + 1; this.interned.set(signature, id); return id;
  }
  /** Repeated ledger/history prefixes share fixed blocks instead of retaining a full giant key per boundary. */
  private sequence(parts: (string | number)[]): string | null {
    if (parts.length <= 64) return JSON.stringify(parts);
    const blocks: number[] = [];
    for (let index = 0; index < parts.length; index += 64) {
      const id = this.intern(`block:${JSON.stringify(parts.slice(index, index + 64))}`);
      if (id === null) return null;
      blocks.push(id);
    }
    const parent = this.sequence(blocks);
    return parent === null ? null : `blocks:${parent}`;
  }
  private identity(value: unknown): number | null {
    if (!this.objects) return null;
    let signature: string;
    if (value && typeof value === 'object') {
      const known = this.objects.get(value);
      if (known !== undefined) return known;
      if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return null;
      const keys = Object.keys(value), array = Array.isArray(value);
      const dense = array && keys.length === value.length && keys.every((key, index) => key === String(index));
      const shape = dense ? null : this.intern(`shape:${JSON.stringify(keys)}`);
      if (!dense && shape === null) return null;
      const parts: number[] = [];
      for (const key of keys) {
        const child = this.identity((value as Record<string, unknown>)[key]);
        if (child === null) return null;
        parts.push(child);
      }
      const sequence = this.sequence(parts);
      if (sequence === null) return null;
      signature = `${array ? `array:${value.length}:${dense ? 'dense' : shape}` : `object:${shape}`}:${sequence}`;
    } else {
      if (!['undefined', 'boolean', 'string', 'number'].includes(typeof value) && value !== null) return null;
      signature = `${typeof value}:${Object.is(value, -0) ? '-0' : String(value)}`;
    }
    const id = this.intern(signature);
    if (id === null) return null;
    if (value && typeof value === 'object') this.objects!.set(value, id);
    return id;
  }
  calculate<I, O>(name: string, input: I, compute: (input: I) => O): O {
    const id = this.identity(input), key = id === null ? null : JSON.stringify([name, id]);
    const stored = key === null ? undefined : this.results.get(key);
    if (stored !== undefined) { this.hits += 1; return expandJson(JSON.parse(stored)) as O; }
    this.misses += 1;
    const output = compute(input);
    if (key !== null && this.objects && jsonStable(output)) {
      const text = JSON.stringify(compactJson2(output));
      if (text !== undefined && this.reserve((key.length + text.length) * 2 + 96)) this.results.set(key, text);
    }
    return output;
  }
}

/** JSON text may only stand in for outputs it preserves exactly (including signed zero and optional fields). */
function jsonStable(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value) && !Object.is(value, -0);
  if (Array.isArray(value)) { const keys = Object.keys(value); return keys.length === value.length && keys.every((key, index) => key === String(index)) && value.every(jsonStable); }
  return typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype && Object.values(value).every(jsonStable);
}

/** One instance per codec worker/module; no cache data is persisted or accepted from a save. */
export const validationReplayCache = new ReplayCache();
