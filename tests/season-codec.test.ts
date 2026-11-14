import { describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { createWorkerSeasonCodec, directSeasonCodec, handleSeasonCodecRequest, type SeasonCodecReply, type SeasonCodecRequest, type SeasonCodecWorker } from '../src/storage/season-codec';
// The game's codec writes the compact layout.
import { parseSeason, serializeSeasonCompact as serializeSeason } from '../src/storage/season-storage';
import { createSeason } from '../src/world/season';

/** A message-passing stand-in for a module worker; replies are delivered asynchronously, optionally reversed. */
class FakeWorker implements SeasonCodecWorker {
  onmessage: ((event: MessageEvent<SeasonCodecReply>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  received: SeasonCodecRequest[] = [];
  terminated = false;
  constructor(private readonly options: { holdReplies?: boolean; throwOnPost?: boolean } = {}) {}
  postMessage(message: SeasonCodecRequest): void {
    if (this.options.throwOnPost) throw new Error('DataCloneError');
    this.received.push(structuredClone(message));
    if (!this.options.holdReplies) queueMicrotask(() => this.reply(this.received.length - 1));
  }
  reply(index: number): void { this.onmessage?.({ data: handleSeasonCodecRequest(this.received[index]!) } as MessageEvent<SeasonCodecReply>); }
  crash(): void { this.onerror?.(new Event('error')); }
  terminate(): void { this.terminated = true; }
}

describe('season save codec', () => {
  const state = createSeason(31, 'aegean-waves', 'off');
  const text = serializeSeason(state);

  it('handles worker requests with the same validation and messages as direct saving', async () => {
    expect(handleSeasonCodecRequest({ requestId: 1, kind: 'serialize', state })).toEqual({ requestId: 1, result: text });
    expect(handleSeasonCodecRequest({ requestId: 2, kind: 'parse', text })).toEqual({ requestId: 2, result: parseSeason(text) });
    const broken = handleSeasonCodecRequest({ requestId: 3, kind: 'parse', text: '{' });
    expect(broken).toEqual({ requestId: 3, error: 'This is not a valid JSON season file.' });
    expect(handleSeasonCodecRequest({ requestId: 4, kind: 'unknown' } as unknown as SeasonCodecRequest)).toEqual({ requestId: 4, error: 'Unsupported save operation.' });
    await expect(directSeasonCodec.serialize(state)).resolves.toBe(text);
    await expect(directSeasonCodec.parse(text)).resolves.toEqual(state);
  });

  it('matches out-of-order worker replies to their own requests', async () => {
    const worker = new FakeWorker({ holdReplies: true });
    const codec = createWorkerSeasonCodec(() => worker);
    const saved = codec.serialize(state), loaded = codec.parse(text);
    expect(worker.received.map(request => request.kind)).toEqual(['serialize', 'parse']);
    worker.reply(1); worker.reply(0);
    await expect(saved).resolves.toBe(text);
    await expect(loaded).resolves.toEqual(state);
  });

  it('reports validation errors from the worker unchanged', async () => {
    const codec = createWorkerSeasonCodec(() => new FakeWorker());
    await expect(codec.parse('{')).rejects.toThrow('This is not a valid JSON season file.');
    await expect(codec.serialize({ ...state, round: 0 } as SeasonState)).rejects.toThrow(/Invalid season save/);
  });

  it('finishes waiting requests on the main thread if the worker fails, then stops using it', async () => {
    let created = 0;
    const worker = new FakeWorker({ holdReplies: true });
    const codec = createWorkerSeasonCodec(() => { created += 1; return worker; });
    const saved = codec.serialize(state);
    worker.crash();
    await expect(saved).resolves.toBe(text);
    await expect(codec.parse(text)).resolves.toEqual(state);
    expect([created, worker.terminated, worker.received.length]).toEqual([1, true, 1]);
  });

  it('uses the main thread when workers are unavailable or cannot accept the career', async () => {
    await expect(createWorkerSeasonCodec(null).serialize(state)).resolves.toBe(text);
    const codec = createWorkerSeasonCodec(() => new FakeWorker({ throwOnPost: true }));
    await expect(codec.serialize(state)).resolves.toBe(text);
    await expect(codec.parse(text)).resolves.toEqual(state);
  });

  it('rejects requests still waiting when the codec is closed', async () => {
    const codec = createWorkerSeasonCodec(() => new FakeWorker({ holdReplies: true }));
    const saved = codec.serialize(state);
    codec.dispose();
    await expect(saved).rejects.toThrow('The background save process was closed.');
  });
});
