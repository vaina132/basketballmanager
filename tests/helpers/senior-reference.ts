import { expect } from 'vitest';
import type { ArchivedPlayerTotals, SeasonState } from '../../src/domain/season';

const fields = ['secondsPlayed', 'points', 'fieldGoalsMade', 'fieldGoalsAttempted', 'threePointersMade', 'threePointersAttempted', 'freeThrowsMade', 'freeThrowsAttempted', 'rebounds', 'assists', 'steals', 'blocks', 'turnovers', 'fouls'] as const;
/** Restore detail only from independently retained original games, after checking every projected field. */
export function restoreSeniorDetail(candidate: SeasonState, original: SeasonState): SeasonState {
  const restored = structuredClone(candidate);
  for (const archive of restored.history) {
    if (!archive.summary) continue;
    const source = original.seasonNumber === archive.seasonNumber ? original : original.history.find(row => row.seasonNumber === archive.seasonNumber)!;
    expect(source, 'summarized history needs its original full reference').toBeDefined();
    const rows = new Map<string, ArchivedPlayerTotals>();
    for (const fixture of archive.fixtures) {
      if (!fixture.result.appearances) continue;
      const before = source.fixtures.find(row => row.id === fixture.id)!;
      expect(before.result?.stats).toBeTruthy();
      const appearances = Object.fromEntries(Object.entries(before.result!.stats!).map(([id, stats]) => [id, { secondsPlayed: stats.secondsPlayed, fouls: stats.fouls, appeared: fields.some(key => stats[key] !== 0) }]));
      expect(fixture).toEqual({ ...before, result: { ...before.result, stats: null, appearances } });
      for (const side of ['home', 'away'] as const) {
        const roster = source.rosters.find(row => row.id === before.result!.rosterIds[side])!;
        for (const player of roster.players) {
          const stats = before.result!.stats![player.id]!, key = JSON.stringify([roster.clubId, player.id]);
          const row = rows.get(key) ?? { clubId: roster.clubId, playerId: player.id, games: 0, totals: Object.fromEntries(fields.map(key => [key, 0])) as ArchivedPlayerTotals['totals'] };
          row.games += Number(appearances[player.id]!.appeared);
          for (const field of fields) row.totals[field] += stats[field];
          rows.set(key, row);
        }
      }
      fixture.result = structuredClone(before.result!);
    }
    expect(archive.summary).toEqual({ model: 'senior-totals-1', players: [...rows.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, row]) => row) });
    delete archive.summary;
  }
  return restored;
}
