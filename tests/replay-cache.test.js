import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { ReplayCache, validationReplayCache } from '../src/storage/replay-cache';
import { parseSeason, serializeSeasonCompact, validateSeasonState } from '../src/storage/season-storage';
import { advanceSeason, managedSide } from '../src/world/season';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';

describe('bounded exact-content replay calculations', () => {
  it('reuses cloned inputs and isolates returned objects from future results', () => {
    const cache = new ReplayCache(); let calls = 0;
    const calculate = value => { calls++; return { copied: value.items }; };
    const input = { items: [1, { value: 2 }] };
    const first = cache.run(() => cache.calculate('example', input, calculate));
    first.copied[1].value = 3;
    expect(cache.run(() => cache.calculate('example', { items: [1, { value: 2 }] }, calculate))).toEqual({ copied: [1, { value: 2 }] });
    expect(calls).toBe(1);
    expect(cache.run(() => cache.calculate('example', input, calculate))).toEqual({ copied: [1, { value: 3 }] });
    expect(calls).toBe(2);
  });
  it.each([
    [null, 'null'], [undefined, 'undefined'], [0, -0], [[], {}], [[], [undefined]],
    [{ a: 1 }, { a: 1, b: undefined }], [{ a: 1, b: 2 }, { b: 2, a: 1 }],
    [[1, 2], [2, 1]], [{ nested: { value: 1 } }, { nested: { value: 2 } }],
  ])('distinguishes exact input forms %#', (a, b) => {
    const cache = new ReplayCache(); let calls = 0;
    const calculate = () => ++calls;
    expect(cache.run(() => cache.calculate('same', a, calculate))).toBe(1);
    expect(cache.run(() => cache.calculate('same', b, calculate))).toBe(2);
  });
  it('separates computations and reruns throws instead of retaining an acceptance', () => {
    const cache = new ReplayCache(); let calls = 0;
    expect(cache.run(() => cache.calculate('one', 1, () => 1))).toBe(1);
    expect(cache.run(() => cache.calculate('two', 1, () => 2))).toBe(2);
    for (let index = 0; index < 2; index++) expect(() => cache.run(() => cache.calculate('error', 1, () => { calls++; throw new Error('broken'); }))).toThrow('broken');
    expect(calls).toBe(2); expect(cache.statistics.bytes).toBe(0);
  });
  it('shares long prefixes without confusing a changed boundary, field name or tail', () => {
    const cache = new ReplayCache(); let calls = 0;
    const input = Array.from({ length: 2_100 }, (_, index) => ({ amount: index, owner: 'club' }));
    const compute = rows => { calls++; return rows.reduce((sum, row) => sum + (row.amount ?? row.other), 0); };
    const run = rows => cache.run(() => cache.calculate('long', rows, compute));
    const expected = run(input);
    expect(run(structuredClone(input))).toBe(expected); expect(calls).toBe(1);
    for (const index of [0, 31, 32, 1_023, 2_099]) {
      const changed = structuredClone(input); changed[index].amount += 1;
      expect(run(changed)).toBe(expected + 1);
    }
    const renamed = structuredClone(input); renamed[0] = { other: 0, owner: 'club' };
    expect(run(renamed)).toBe(expected); expect(calls).toBe(7);
  });
  it.each([[256, 100], [10_000, 3]])('falls back correctly when byte/entry limits are exhausted (%s, %s)', (bytes, entries) => {
    const cache = new ReplayCache(bytes, entries);
    for (let index = 0; index < 20; index++) {
      const input = { index, data: 'a'.repeat(index * 30) };
      expect(cache.run(() => cache.calculate('size', input, value => ({ size: value.data.length })))).toEqual({ size: index * 30 });
      expect(cache.statistics.bytes).toBeLessThanOrEqual(bytes);
      expect(cache.statistics.entries).toBeLessThanOrEqual(entries);
    }
  });
  it('does not reuse object identity outside a validation scope', () => {
    const cache = new ReplayCache(), input = { value: 1 };
    expect(cache.calculate('number', input, value => value.value)).toBe(1);
    input.value = 2;
    expect(cache.calculate('number', input, value => value.value)).toBe(2);
    expect(cache.statistics.hits).toBe(0);
  });
  it('stops rebuilding an exhausted cache until a smaller workload or explicit reset', () => {
    const cache = new ReplayCache(4_000);
    cache.run(() => cache.calculate('large', 'x'.repeat(3_000), value => value), 100);
    expect(cache.statistics.blockedFrom).toBe(100);
    for (const workload of [100, 120]) expect(cache.run(() => cache.calculate('small', 3, value => value + 1), workload)).toBe(4);
    expect(cache.statistics.bytes).toBe(0);
    cache.run(() => cache.calculate('small', 3, value => value + 1), 50);
    cache.run(() => cache.calculate('small', 3, value => value + 1), 50);
    expect(cache.statistics.hits).toBe(1);
    cache.clear();
    expect(cache.statistics.blockedFrom).toBeNull();
    cache.run(() => cache.calculate('small', 3, value => value + 1), 120);
    expect(cache.statistics.bytes).toBeGreaterThan(0);
  });
  it.each([-0, { optional: undefined }, [undefined], Number.NaN])('never changes an output JSON cannot preserve exactly (%#)', output => {
    const cache = new ReplayCache();
    for (let index = 0; index < 2; index++) expect(cache.run(() => cache.calculate('special', 1, () => output))).toEqual(output);
    expect(cache.statistics.hits).toBe(0);
  });
});

describe('strict save replay reuse', () => {
  let state;
  beforeAll(() => {
    state = parseSeason(gunzipSync(readFileSync(new URL('./fixtures/season44-board-career.json.gz', import.meta.url))).toString('utf8'));
  }, 120_000);
  it('preserves exact serialized bytes and continues to reuse prior calculations after a matchday', () => {
    validationReplayCache.clear();
    const original = serializeSeasonCompact(state), before = validationReplayCache.statistics;
    expect(serializeSeasonCompact(structuredClone(state))).toBe(original);
    expect(validationReplayCache.statistics.hits).toBeGreaterThan(before.hits);
    const next = advanceSeason({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) });
    const atNext = validationReplayCache.statistics;
    const text = serializeSeasonCompact(next);
    expect(validationReplayCache.statistics.hits).toBeGreaterThan(atNext.hits);
    validationReplayCache.clear();
    expect(serializeSeasonCompact(next)).toBe(text);
    expect(parseSeason(text)).toEqual(next);
  }, 120_000);
  it.each(['academy output', 'board output', 'source points', 'source finances'])('rejects changed %s after validating the same object', damage => {
    const input = structuredClone(state);
    validateSeasonState(input);
    if (damage === 'academy output') Object.values(input.academy.weeks[0].players)[0].pointsAfter.twoPoint += 1;
    if (damage === 'board output') Object.values(input.board.reviews[0].clubs)[0].confidence += 1;
    if (damage === 'source points') Object.values(input.academy.points)[0].twoPoint += 1;
    if (damage === 'source finances') input.finance.ledger[0].amount += 1;
    expect(() => validateSeasonState(input)).toThrow();
    expect(() => validateSeasonState(state)).not.toThrow();
  }, 120_000);
});
