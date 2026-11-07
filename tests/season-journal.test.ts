import { describe, expect, it } from 'vitest';
import { decodeSeasonJournal, MAX_CHECKPOINT_BYTES, MAX_SEASON_CHECKPOINTS, MAX_SEASON_REVISION, prepareSeasonCheckpoint, SeasonSaveConflictError } from '../src/storage/season-journal';
import type { CheckpointReason, SeasonCheckpoint, SeasonJournal } from '../src/storage/season-journal';

const savedAt = '2026-11-06T23:15:00.000Z';
const row = (revision: number, reason: CheckpointReason = 'manual'): SeasonCheckpoint => ({ revision, reason, savedAt, serialized: `season-${revision}` });
function save(journal: SeasonJournal, expectedRevision = journal.revision): SeasonJournal {
  const { checkpoint, checkpoints } = prepareSeasonCheckpoint(journal, `season-${expectedRevision + 1}`, expectedRevision, 'manual', savedAt);
  return { revision: checkpoint.revision, current: checkpoint.serialized, checkpoints };
}

describe('career checkpoint journal metadata', () => {
  it('reads a new database at revision zero without inventing a saved game', () => {
    expect(decodeSeasonJournal(undefined, undefined, [])).toEqual({ revision: 0, current: null, checkpoints: [] });
    expect(decodeSeasonJournal(undefined, 0, [])).toEqual({ revision: 0, current: null, checkpoints: [] });
  });

  it('exposes the exact legacy current string without claiming its historical save time', () => {
    const current = '{"formatVersion":1}', journal = decodeSeasonJournal(current, 0, []);
    expect(journal).toEqual({ revision: 0, current, checkpoints: [{ revision: 0, reason: 'legacy', savedAt: null, serialized: current }] });
    const next = save(journal);
    expect(next.checkpoints[1]).toEqual(journal.checkpoints[0]);
    expect(journal.revision).toBe(0);
    expect(journal.checkpoints).toHaveLength(1);
  });

  it('reads newest first regardless of IndexedDB key order', () => {
    const rows = [row(1), row(2), row(3)];
    expect(decodeSeasonJournal('season-3', 3, rows).checkpoints.map(checkpoint => checkpoint.revision)).toEqual([3, 2, 1]);
    expect(rows.map(checkpoint => checkpoint.revision)).toEqual([1, 2, 3]);
  });

  it.each([null, { broken: true }, 17, 'not json'])('keeps history available when current is damaged: %j', current => {
    const journal = decodeSeasonJournal(current, 2, [row(1), row(2)]);
    expect(journal.current).toEqual(current);
    expect(journal.checkpoints).toHaveLength(2);
    expect(save(journal).revision).toBe(3);
  });

  it('keeps malformed checkpoint payload text for the service to validate individually', () => {
    const damaged = { ...row(1), serialized: '{malformed' };
    expect(decodeSeasonJournal('season-2', 2, [damaged, row(2)]).checkpoints[1]).toEqual(damaged);
  });

  it.each([null, undefined, { broken: true }, 17])('keeps healthy checkpoints readable beside a damaged stored payload: %j', serialized => {
    const damaged = { ...row(1), serialized }, journal = decodeSeasonJournal('season-2', 2, [damaged, row(2)]);
    expect(journal.current).toBe('season-2');
    expect(journal.checkpoints).toEqual([row(2), damaged]);
    expect(journal.checkpoints[1]!.serialized).toBe(serialized);
    const next = save(journal);
    expect(next.checkpoints[2]!.serialized).toBe(serialized);
    expect(next.revision).toBe(3);
  });

  it('exposes oversized historical and legacy payloads for per-checkpoint validation', () => {
    const oversized = 'a'.repeat(MAX_CHECKPOINT_BYTES + 1), damaged = { ...row(1), serialized: oversized };
    const journal = decodeSeasonJournal('season-2', 2, [damaged, row(2)]);
    expect(journal.checkpoints).toEqual([row(2), damaged]);
    expect(save(journal).checkpoints[2]!.serialized).toBe(oversized);
    const legacy = decodeSeasonJournal(oversized, 0, []);
    expect(legacy.current).toBe(oversized);
    expect(legacy.checkpoints[0]!.serialized).toBe(oversized);
    expect(save(legacy).checkpoints[1]!.serialized).toBe(oversized);
  });

  const cases: Array<[string, unknown, unknown[]]> = [
    ['negative revision', -1, []],
    ['fractional revision', 1.5, []],
    ['unsafe revision', MAX_SEASON_REVISION + 1, []],
    ['string revision', '1', [row(1)]],
    ['missing current revision', undefined, [row(1)]],
    ['missing all checkpoint rows', 1, []],
    ['duplicate checkpoint revisions', 2, [row(1), row(2), row(2)]],
    ['mismatched latest revision', 3, [row(1), row(2)]],
    ['missing middle checkpoint', 3, [row(1), row(3)]],
    ['missing early retained checkpoint', 3, [row(2), row(3)]],
    ['excessive checkpoint rows', 6, [1, 2, 3, 4, 5, 6].map(revision => row(revision))],
    ['extra checkpoint metadata', 1, [{ ...row(1), label: 'Unexpected' }]],
    ['unknown reason', 1, [{ ...row(1), reason: 'unknown' }]],
    ['unbounded checkpoint revision', 1, [{ ...row(1), revision: Infinity }]],
    ['missing save timestamp', 1, [{ ...row(1), savedAt: null }]],
    ['invalid save date', 1, [{ ...row(1), savedAt: '2026-02-31T23:15:00.000Z' }]],
    ['unbounded save timestamp', 1, [{ ...row(1), savedAt: 'x'.repeat(100) }]],
    ['non-UTC save timestamp', 1, [{ ...row(1), savedAt: '2026-11-06T23:15:00.000+00:00' }]],
    ['legacy checkpoint above baseline', 1, [{ ...row(1), reason: 'legacy', savedAt: null }]],
    ['legacy checkpoint with invented date', 0, [{ ...row(0), reason: 'legacy' }]],
    ['ordinary checkpoint at baseline', 0, [row(0)]],
  ];
  it.each(cases)('rejects %s', (_name, revision, rows) => {
    expect(() => decodeSeasonJournal('current', revision, rows)).toThrow(/metadata is damaged/);
  });

  it('bounds both character count and UTF-8 bytes before writing a new snapshot', () => {
    const journal = decodeSeasonJournal('legacy', 0, []), original = structuredClone(journal);
    expect(() => prepareSeasonCheckpoint(journal, 'a'.repeat(MAX_CHECKPOINT_BYTES + 1), 0, 'manual', savedAt)).toThrow(/8 MB/);
    expect(() => prepareSeasonCheckpoint(journal, '€'.repeat(Math.floor(MAX_CHECKPOINT_BYTES / 3) + 1), 0, 'manual', savedAt)).toThrow(/8 MB/);
    expect(() => prepareSeasonCheckpoint(journal, {} as string, 0, 'manual', savedAt)).toThrow(/serialized text/);
    expect(journal).toEqual(original);
  });
});

describe('career checkpoint compare-and-swap planning', () => {
  it('rejects a competing save using the same revision token and preserves the winner', () => {
    const original = decodeSeasonJournal('legacy', 0, []), firstTab = save(original, 0);
    const unchanged = structuredClone(firstTab);
    expect(() => save(firstTab, 0)).toThrow(SeasonSaveConflictError);
    expect(() => save(firstTab, 0)).toThrow(/Load the latest local career or export/);
    expect(firstTab).toEqual(unchanged);
    expect(original.current).toBe('legacy');
    expect(original.revision).toBe(0);
  });

  it('keeps exactly the latest five revisions and prunes legacy only when it leaves that window', () => {
    let journal = decodeSeasonJournal('legacy', 0, []);
    for (let revision = 1; revision <= 8; revision += 1) {
      journal = save(journal);
      expect(journal.checkpoints).toHaveLength(Math.min(MAX_SEASON_CHECKPOINTS, revision + 1));
      expect(journal.checkpoints[0]!.revision).toBe(revision);
      expect(journal.checkpoints.at(-1)!.revision).toBe(Math.max(0, revision - 4));
      expect(decodeSeasonJournal(journal.current, journal.revision, journal.checkpoints)).toEqual(journal);
    }
    expect(journal.checkpoints.map(checkpoint => checkpoint.revision)).toEqual([8, 7, 6, 5, 4]);
  });

  it('starts a new database at revision one and never creates a fake legacy checkpoint', () => {
    const initial = decodeSeasonJournal(undefined, 0, []);
    const saved = save(initial);
    expect(saved.checkpoints).toEqual([row(1)]);
    expect(saved.current).toBe('season-1');
    expect(initial).toEqual({ revision: 0, current: null, checkpoints: [] });
  });

  it.each(['manual', 'new-game', 'matchday', 'rollover', 'recovery'] as const)('supports an explicit %s reason', reason => {
    const journal = decodeSeasonJournal(undefined, 0, []);
    const planned = prepareSeasonCheckpoint(journal, 'serialized', 0, reason, savedAt);
    expect(planned.checkpoint).toEqual({ revision: 1, reason, serialized: 'serialized', savedAt });
  });

  it('makes legacy reason read-only and rejects invalid arguments without modifying history', () => {
    const journal = decodeSeasonJournal('legacy', 0, []), original = structuredClone(journal);
    expect(() => prepareSeasonCheckpoint(journal, 'new', 0, 'legacy', savedAt)).toThrow(/read-only/);
    expect(() => prepareSeasonCheckpoint(journal, 'new', -1, 'manual', savedAt)).toThrow(/expected local career revision/);
    expect(() => prepareSeasonCheckpoint(journal, 'new', 0, 'manual', 'tomorrow')).toThrow(/save time/);
    expect(journal).toEqual(original);
  });

  it('rejects revision overflow before planning any replacement or pruning', () => {
    const rows = Array.from({ length: 5 }, (_, index) => row(MAX_SEASON_REVISION - index));
    const journal = decodeSeasonJournal('latest', MAX_SEASON_REVISION, rows);
    expect(() => prepareSeasonCheckpoint(journal, 'new', MAX_SEASON_REVISION, 'manual', savedAt)).toThrow(/revision limit/);
    expect(journal.checkpoints).toEqual(rows);
  });
});
