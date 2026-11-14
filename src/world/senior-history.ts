import type { ArchivedAppearance, ArchivedFixture, ArchivedPlayerTotals, SeasonArchive, SeasonFixture, SeasonState } from '../domain/season';
import type { PlayerStats } from '../domain/types';
import { managedClubFor } from './career';
import { rosterForRound } from './rosters';

export const SENIOR_TOTAL_KEYS: readonly (keyof Omit<PlayerStats, 'condition'>)[] = [
  'secondsPlayed', 'points', 'fieldGoalsMade', 'fieldGoalsAttempted', 'threePointersMade', 'threePointersAttempted',
  'freeThrowsMade', 'freeThrowsAttempted', 'rebounds', 'assists', 'steals', 'blocks', 'turnovers', 'fouls',
];
export const emptySeniorTotals = (): Omit<PlayerStats, 'condition'> => Object.fromEntries(SENIOR_TOTAL_KEYS.map(key => [key, 0])) as Omit<PlayerStats, 'condition'>;
export const seniorTotalKey = (clubId: string, playerId: string): string => JSON.stringify([clubId, playerId]);
export const compareSeniorTotals = (a: Pick<ArchivedPlayerTotals, 'clubId' | 'playerId'>, b: Pick<ArchivedPlayerTotals, 'clubId' | 'playerId'>): number => {
  const left = seniorTotalKey(a.clubId, a.playerId), right = seniorTotalKey(b.clubId, b.playerId);
  return left < right ? -1 : left > right ? 1 : 0;
};

/** A missing legacy record stays missing; this only exposes evidence actually retained by that fixture. */
export function fixturePlayerEvidence(fixture: Pick<SeasonFixture | ArchivedFixture, 'result'>, playerId: string): PlayerStats | ArchivedAppearance | undefined {
  const result = fixture.result;
  return result?.stats?.[playerId] ?? (result && 'appearances' in result ? result.appearances?.[playerId] : undefined) ?? (result?.selection && Object.hasOwn(result.selection.rested, playerId) ? { secondsPlayed: 0, fouls: 0, appeared: false } : undefined);
}

function summarizeArchive(archive: SeasonArchive, managedClubId: string): SeasonArchive {
  // Unknown legacy statistics cannot be turned into totals. Existing summaries are already an explicit format.
  if (archive.summary || archive.fixtures.some(fixture => fixture.result.stats === null)) return archive;
  const rows = new Map<string, ArchivedPlayerTotals>();
  let changed = false;
  const fixtures = archive.fixtures.map(fixture => {
    if ([fixture.homeClubId, fixture.awayClubId].includes(managedClubId)) return fixture;
    const result = fixture.result, appearances: Record<string, ArchivedAppearance> = {};
    for (const clubId of [fixture.homeClubId, fixture.awayClubId]) {
      for (const player of rosterForRound(archive.rosters, clubId, fixture.round).players) {
        if (result.selection && !result.selection[clubId === fixture.homeClubId ? 'home' : 'away'].includes(player.id)) continue;
        const stats = result.stats![player.id];
        if (!stats) throw new Error('Cannot summarize a match without its registered player statistics.');
        const appeared = SENIOR_TOTAL_KEYS.some(key => stats[key] !== 0);
        appearances[player.id] = { secondsPlayed: stats.secondsPlayed, fouls: stats.fouls, appeared };
        const key = seniorTotalKey(clubId, player.id);
        const row = rows.get(key) ?? { clubId, playerId: player.id, games: 0, totals: emptySeniorTotals() };
        row.games += Number(appeared);
        for (const field of SENIOR_TOTAL_KEYS) row.totals[field] += stats[field];
        rows.set(key, row);
      }
    }
    changed = true;
    return { ...fixture, result: { ...result, stats: null, appearances } };
  });
  return changed ? { ...archive, fixtures, summary: { model: 'senior-totals-1', players: [...rows.values()].sort(compareSeniorTotals) } } : archive;
}

/** Completed seasons retain full manager-game detail and exact rival season totals. Idempotent and immutable. */
export function summarizeSeniorHistory(state: SeasonState): SeasonState {
  let changed = false;
  const history = state.history.map(archive => {
    const result = summarizeArchive(archive, managedClubFor(state, archive.seasonNumber, false));
    changed ||= result !== archive;
    return result;
  });
  return changed ? { ...state, history } : state;
}
