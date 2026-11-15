import type { SeasonState } from '../domain/season';
import { parseSealedSeason, parseSeason, serializeSeasonCompact } from './season-storage';

/**
 * Validated conversion between a career and its save text. The browser runs it in a worker so strict
 * historical validation never freezes the interface; tests and fallbacks use the same functions directly.
 */
export interface SeasonCodec {
  /** `check: false` (the game's own checkpoints in development mode) skips the full career check; exports keep it. */
  serialize(state: SeasonState, options?: { check?: boolean }): Promise<string>;
  parse(text: string): Promise<SeasonState>;
  /** Unpack a previously validated local checkpoint after its current-version seal has been verified. */
  parseSealed?(text: string): Promise<SeasonState>;
}

type SeasonCodecJob = { kind: 'serialize'; state: SeasonState; check?: boolean } | { kind: 'parse'; text: string } | { kind: 'parse-sealed'; text: string };
export type SeasonCodecRequest = SeasonCodecJob & { requestId: number };
export type SeasonCodecReply = { requestId: number; result: string | SeasonState } | { requestId: number; error: string };

export const directSeasonCodec: SeasonCodec = {
  serialize: async (state, options) => serializeSeasonCompact(state, options),
  parse: async text => parseSeason(text),
  parseSealed: async text => parseSealedSeason(text),
};

function runDirectly(job: SeasonCodecJob): Promise<string | SeasonState> {
  if (job.kind === 'serialize') return directSeasonCodec.serialize(job.state, job.check === false ? { check: false } : {});
  if (job.kind === 'parse-sealed') return directSeasonCodec.parseSealed!(job.text);
  return directSeasonCodec.parse(job.text);
}

/** The worker's entire behavior: identical validation and messages to the direct codec. */
export function handleSeasonCodecRequest(request: SeasonCodecRequest): SeasonCodecReply {
  try {
    if (request.kind === 'serialize') return { requestId: request.requestId, result: serializeSeasonCompact(request.state, request.check === false ? { check: false } : {}) };
    if (request.kind === 'parse') return { requestId: request.requestId, result: parseSeason(request.text) };
    if (request.kind === 'parse-sealed') return { requestId: request.requestId, result: parseSealedSeason(request.text) };
    throw new Error('Unsupported save operation.');
  } catch (error) {
    return { requestId: request.requestId, error: error instanceof Error ? error.message : 'The season save could not be processed.' };
  }
}

export interface SeasonCodecWorker {
  onmessage: ((event: MessageEvent<SeasonCodecReply>) => void) | null;
  onerror: ((event: Event) => void) | null;
  postMessage(message: SeasonCodecRequest): void;
  terminate(): void;
}

/**
 * Runs the codec in one reusable worker. If workers are unavailable or the worker fails, waiting and later
 * requests run on the main thread instead, so saving and loading keep working (with a brief pause).
 */
export function createWorkerSeasonCodec(createWorker: (() => SeasonCodecWorker) | null = defaultWorkerFactory()): SeasonCodec & { dispose(): void } {
  let worker: SeasonCodecWorker | null = null;
  let failed = createWorker === null;
  let nextId = 0;
  const pending = new Map<number, { job: SeasonCodecJob; resolve: (value: string | SeasonState) => void; reject: (error: Error) => void }>();

  function fallBack(started: SeasonCodecWorker): void {
    failed = true;
    if (worker === started) worker = null;
    started.terminate();
    const waiting = [...pending.values()];
    pending.clear();
    for (const { job, resolve, reject } of waiting) runDirectly(job).then(resolve, reject);
  }

  function ensureWorker(): SeasonCodecWorker {
    if (worker) return worker;
    const started = createWorker!();
    started.onmessage = ({ data }) => {
      const waiting = pending.get(data.requestId);
      if (!waiting) return;
      pending.delete(data.requestId);
      if ('error' in data) waiting.reject(new Error(data.error)); else waiting.resolve(data.result);
    };
    started.onerror = event => { event.preventDefault?.(); fallBack(started); };
    worker = started;
    return started;
  }

  function run(job: SeasonCodecJob): Promise<string | SeasonState> {
    if (failed) return runDirectly(job);
    return new Promise((resolve, reject) => {
      const requestId = ++nextId;
      pending.set(requestId, { job, resolve, reject });
      try { ensureWorker().postMessage({ ...job, requestId }); }
      catch {
        pending.delete(requestId);
        failed = true;
        runDirectly(job).then(resolve, reject);
      }
    });
  }

  return {
    serialize: (state, options) => run({ kind: 'serialize', state, ...(options?.check === false ? { check: false } : {}) }) as Promise<string>,
    parse: text => run({ kind: 'parse', text }) as Promise<SeasonState>,
    parseSealed: text => run({ kind: 'parse-sealed', text }) as Promise<SeasonState>,
    dispose() {
      worker?.terminate();
      worker = null;
      failed = true;
      const waiting = [...pending.values()];
      pending.clear();
      for (const { reject } of waiting) reject(new Error('The background save process was closed.'));
    },
  };
}

function defaultWorkerFactory(): (() => SeasonCodecWorker) | null {
  if (typeof Worker === 'undefined') return null;
  return () => new Worker(new URL('./season-codec.worker.ts', import.meta.url), { type: 'module' }) as unknown as SeasonCodecWorker;
}
