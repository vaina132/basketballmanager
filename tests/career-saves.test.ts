import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { setAutoSubstitutions, simulateToQuarterEnd, stepMatch } from '../src/engine/match';
import { loadCareerCheckpoint, readCareerSaves, saveCareerCheckpoint } from '../src/storage/career-saves';
import type { SeasonCheckpoint, SeasonJournal } from '../src/storage/season-indexed-db';
import { loadLocalSeason, MAX_SEASON_SAVE_BYTES, parseSeason, saveLocalSeason, serializeSeason } from '../src/storage/season-storage';
import { createSeason, managedSide } from '../src/world/season';

const storage = vi.hoisted(() => ({
  readSeasonJournal: vi.fn(), writeSeasonCheckpoint: vi.fn(), readLocalSeason: vi.fn(), writeLocalSeason: vi.fn(),
}));
vi.mock('../src/storage/season-indexed-db', () => storage);

function checkpoint(revision: number, state: SeasonState): SeasonCheckpoint {
  return { revision, savedAt: `2026-11-07T12:00:${String(revision).padStart(2, '0')}.000Z`, reason: 'manual', serialized: serializeSeason(state) };
}

function previousFormat(state: SeasonState, version: 1 | 2): string {
  const value = structuredClone(state) as unknown as Record<string, unknown>;
  value.schemaVersion = version;
  delete value.seasonNumber; delete value.history; delete value.training; delete value.coaching;
  if (version === 1) {
    delete value.injuryMode; delete value.injuries;
    for (const fixture of value.fixtures as Array<{ result: Record<string, unknown> | null }>) if (fixture.result) delete fixture.result.injuries;
  }
  return JSON.stringify({ format: 'basketball-manager-season', formatVersion: version, engineVersion: 'possession-3', state: value });
}

beforeEach(() => { vi.resetAllMocks(); });

describe('validated career checkpoint listing', () => {
  it('reports an empty local slot without errors or writes', async () => {
    storage.readSeasonJournal.mockResolvedValue({ revision: 0, current: null, checkpoints: [] });
    expect(await readCareerSaves()).toEqual({ revision: 0, current: null, currentError: null, entries: [] });
    expect(storage.writeSeasonCheckpoint).not.toHaveBeenCalled();
  });

  it('derives management labels from validated snapshots and preserves newest-first order', async () => {
    const first = createSeason(12, 'atlantic-pilots'), latest = createSeason(71, 'aegean-waves');
    latest.activeMatch = simulateToQuarterEnd(setAutoSubstitutions(latest.activeMatch, managedSide(latest), true));
    const checkpoints = [checkpoint(7, latest), checkpoint(6, first)];
    const journal: SeasonJournal = { revision: 7, current: checkpoints[0]!.serialized, checkpoints };
    const before = structuredClone(journal);
    storage.readSeasonJournal.mockResolvedValue(journal);
    const list = await readCareerSaves();
    expect(list.revision).toBe(7);
    expect(list.current).toEqual(latest);
    expect(list.currentError).toBeNull();
    expect(list.entries.map(entry => entry.revision)).toEqual([7, 6]);
    expect(list.entries[0]).toEqual({ revision: 7, savedAt: checkpoints[0]!.savedAt, reason: 'manual', valid: true, clubName: latest.clubs.find(club => club.id === latest.managedClubId)!.name, seasonNumber: 1, date: latest.date, round: 1, status: 'active', matchStatus: latest.activeMatch.status });
    expect(journal).toEqual(before);
    expect(storage.writeSeasonCheckpoint).not.toHaveBeenCalled();
  });

  it('keeps valid recovery choices when current and newest checkpoint are damaged', async () => {
    const state = createSeason(4), older = checkpoint(3, state);
    storage.readSeasonJournal.mockResolvedValue({ revision: 4, current: '{damaged', checkpoints: [{ ...older, revision: 4, serialized: '{damaged' }, older] });
    const list = await readCareerSaves();
    expect(list.current).toBeNull();
    expect(list.currentError).toMatch(/Choose a valid checkpoint/);
    expect(list.entries[0]).toMatchObject({ revision: 4, valid: false, clubName: 'Unknown club', seasonNumber: null, date: null, round: null, status: null, matchStatus: null, error: expect.stringMatching(/cannot be loaded/) });
    expect(list.entries[1]).toMatchObject({ revision: 3, valid: true, date: state.date });
    expect(storage.writeSeasonCheckpoint).not.toHaveBeenCalled();
  });

  it.each(['nonstring', 'oversized'] as const)('isolates an older %s payload without hiding valid current or recovery saves', async damage => {
    const latestState = createSeason(17), olderState = createSeason(11);
    const newest = checkpoint(3, latestState), older = checkpoint(1, olderState);
    const damaged = { ...checkpoint(2, olderState), serialized: damage === 'nonstring' ? { broken: true } : 'x'.repeat(MAX_SEASON_SAVE_BYTES + 1) };
    storage.readSeasonJournal.mockResolvedValue({ revision: 3, current: newest.serialized, checkpoints: [newest, damaged, older] });
    const list = await readCareerSaves();
    expect(list.current).toEqual(latestState);
    expect(list.currentError).toBeNull();
    expect(list.entries.map(entry => [entry.revision, entry.valid])).toEqual([[3, true], [2, false], [1, true]]);
    expect(list.entries[1]).toMatchObject({ clubName: 'Unknown club', seasonNumber: null, date: null, round: null, status: null, matchStatus: null });
    await expect(loadCareerCheckpoint(2)).rejects.toThrow(/checkpoint cannot be loaded/);
    expect(await loadCareerCheckpoint(1)).toEqual({ state: olderState, revision: 3 });
    expect(storage.writeSeasonCheckpoint).not.toHaveBeenCalled();
  });

  it.each([null, { malformed: true }, 42])('reports missing or nonstring current data without hiding the history', async current => {
    const state = createSeason(4), saved = checkpoint(1, state);
    storage.readSeasonJournal.mockResolvedValue({ revision: 1, current, checkpoints: [saved] });
    const list = await readCareerSaves();
    expect(list.current).toBeNull();
    expect(list.currentError).toMatch(/current save cannot be loaded/);
    expect(list.entries[0]!.valid).toBe(true);
  });

  it.each([1, 2] as const)('exposes and migrates a legacy format %s current slot without writing or changing RNG', async version => {
    const original = createSeason(21, 'atlantic-pilots', version === 1 ? 'off' : 'standard', false, false);
    original.activeMatch = stepMatch(original.activeMatch);
    const serialized = previousFormat(original, version);
    storage.readSeasonJournal.mockResolvedValue({ revision: 0, current: serialized, checkpoints: [] });
    const list = await readCareerSaves();
    expect(list.current).toEqual(original);
    expect(list.entries).toHaveLength(1);
    expect(list.entries[0]).toMatchObject({ revision: 0, savedAt: null, reason: 'legacy', valid: true });
    const loaded = await loadCareerCheckpoint(0);
    expect(loaded).toEqual({ state: original, revision: 0 });
    expect(stepMatch(loaded.state.activeMatch)).toEqual(stepMatch(original.activeMatch));
    expect(storage.writeSeasonCheckpoint).not.toHaveBeenCalled();
  });

  it('does not duplicate the legacy row already supplied by the journal', async () => {
    const serialized = serializeSeason(createSeason(3));
    storage.readSeasonJournal.mockResolvedValue({ revision: 0, current: serialized, checkpoints: [{ revision: 0, savedAt: null, reason: 'legacy', serialized }] });
    expect((await readCareerSaves()).entries).toHaveLength(1);
  });
});

describe('checkpoint restore and append', () => {
  it('loads an older snapshot with the latest revision token and appends its recovery without deleting newer data', async () => {
    const olderState = createSeason(4), newerState = createSeason(8);
    olderState.activeMatch = stepMatch(olderState.activeMatch);
    const newer = checkpoint(9, newerState), older = checkpoint(8, olderState);
    const journal: SeasonJournal = { revision: 9, current: newer.serialized, checkpoints: [newer, older] };
    storage.readSeasonJournal.mockResolvedValue(journal);
    const restored = await loadCareerCheckpoint(8);
    expect(restored).toEqual({ state: olderState, revision: 9 });
    expect(stepMatch(restored.state.activeMatch)).toEqual(stepMatch(olderState.activeMatch));
    expect(storage.writeSeasonCheckpoint).not.toHaveBeenCalled();
    const next = { ...checkpoint(10, olderState), reason: 'recovery' as const };
    storage.writeSeasonCheckpoint.mockResolvedValue(next);
    expect(await saveCareerCheckpoint(restored.state, restored.revision, 'recovery')).toEqual(next);
    expect(storage.writeSeasonCheckpoint).toHaveBeenCalledExactlyOnceWith(older.serialized, 9, 'recovery');
    expect(journal.checkpoints).toEqual([newer, older]);
    expect(journal.current).toBe(newer.serialized);
  });

  it('rejects unavailable or malformed checkpoints without falling back or writing', async () => {
    const valid = checkpoint(5, createSeason(2));
    storage.readSeasonJournal.mockResolvedValue({ revision: 6, current: valid.serialized, checkpoints: [{ ...valid, revision: 6, serialized: '{bad' }, valid] });
    await expect(loadCareerCheckpoint(6)).rejects.toThrow(/checkpoint cannot be loaded/);
    await expect(loadCareerCheckpoint(4)).rejects.toThrow(/no longer available/);
    for (const revision of [-1, .5, Number.NaN, Number.POSITIVE_INFINITY]) await expect(loadCareerCheckpoint(revision)).rejects.toThrow(/valid checkpoint revision/);
    expect(storage.writeSeasonCheckpoint).not.toHaveBeenCalled();
  });

  it('validates malformed game state before issuing any write', async () => {
    const invalid = createSeason(5);
    invalid.managedClubId = 'missing-club';
    await expect(saveCareerCheckpoint(invalid, 2, 'manual')).rejects.toThrow(/managedClubId/);
    expect(storage.writeSeasonCheckpoint).not.toHaveBeenCalled();
  });

  it('preserves conflict and storage failures without retrying with a fresh token', async () => {
    const state = createSeason(7), conflict = new Error('A newer local save exists.');
    storage.writeSeasonCheckpoint.mockRejectedValue(conflict);
    await expect(saveCareerCheckpoint(state, 4, 'matchday')).rejects.toBe(conflict);
    expect(storage.writeSeasonCheckpoint).toHaveBeenCalledExactlyOnceWith(serializeSeason(state), 4, 'matchday');
    expect(storage.readSeasonJournal).not.toHaveBeenCalled();
  });

  it('keeps wall-clock checkpoint metadata outside the portable format and sporting state', async () => {
    const state = createSeason(19), before = structuredClone(state), saved = checkpoint(2, state);
    storage.writeSeasonCheckpoint.mockResolvedValue(saved);
    expect(await saveCareerCheckpoint(state, 1, 'manual')).toEqual(saved);
    const serialized = storage.writeSeasonCheckpoint.mock.calls[0]![0] as string;
    expect(Object.keys(JSON.parse(serialized))).toEqual(['format', 'formatVersion', 'engineVersion', 'state']);
    expect(JSON.parse(serialized).formatVersion).toBe(5);
    expect(parseSeason(serialized)).toEqual(state);
    expect(state).toEqual(before);
    expect(stepMatch(parseSeason(serialized).activeMatch)).toEqual(stepMatch(before.activeMatch));
  });

  it('keeps compatibility loading and passes the required revision through compatibility saving', async () => {
    const state = createSeason(6), text = serializeSeason(state);
    storage.readLocalSeason.mockResolvedValue(text);
    storage.writeLocalSeason.mockResolvedValue(undefined);
    expect(await loadLocalSeason()).toEqual(state);
    await saveLocalSeason(state, 11);
    expect(storage.writeLocalSeason).toHaveBeenCalledExactlyOnceWith(text, 11);
    storage.readLocalSeason.mockResolvedValue(null);
    expect(await loadLocalSeason()).toBeNull();
  });
});
