import type { CompetitionTableRow } from '../domain/competition';
import { partition, settleTie, type PlayedGame } from './lnb-ranking';

type RecordRow = Pick<CompetitionTableRow, 'wins' | 'losses' | 'pointsFor' | 'pointsAgainst'>;

/**
 * FIBA Official Basketball Rules 2026, Appendix D.1.1: 2 classification points for a win and 1 for a loss, including a
 * loss by default. A forfeit would score 0, but the engine records no forfeits (its defaults are sporting losses).
 */
export const classificationPoints = (row: Pick<CompetitionTableRow, 'wins' | 'losses'>) => 2 * row.wins + row.losses;
const difference = (row: RecordRow) => row.pointsFor - row.pointsAgainst;

/**
 * FIBA Official Basketball Rules 2026, Appendix D.1 (`fiba-2026-d`), the labelled default for leagues without a
 * verified rule of their own. Clubs are ranked by classification points. Clubs level on points are ranked by the games
 * between them (D.1.3): classification points, then points difference, then points scored in those games, then
 * overall points difference and overall points scored. Whenever a criterion separates some of the tied clubs, the
 * procedure restarts from the games between the clubs still level (D.1.4). Clubs equal after every criterion are
 * settled by a reproducible draw once the table is complete, and marked as unresolved before that (D.1.3, last
 * sentence: there is no FIBA ranking for clubs).
 */
export function rankFibaTable(rows: readonly CompetitionTableRow[], games: readonly PlayedGame[], drawKey: string | null): CompetitionTableRow[] {
  const overall = new Map(rows.map(row => [row.clubId, row]));
  const unresolved = new Map<string, 'unresolved' | 'draw'>();
  const breakTie = (ids: string[]): string[] => {
    if (ids.length < 2) return ids;
    const mini = new Map(ids.map(id => [id, { wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0 }]));
    for (const game of games) {
      if (!mini.has(game.homeClubId) || !mini.has(game.awayClubId)) continue;
      for (const [id, scored, conceded] of [[game.homeClubId, game.home, game.away], [game.awayClubId, game.away, game.home]] as const) {
        const row = mini.get(id)!;
        if (game.winnerClubId === id) row.wins++; else row.losses++;
        row.pointsFor += scored; row.pointsAgainst += conceded;
      }
    }
    const criteria = [
      (a: string, b: string) => classificationPoints(mini.get(b)!) - classificationPoints(mini.get(a)!),
      (a: string, b: string) => difference(mini.get(b)!) - difference(mini.get(a)!),
      (a: string, b: string) => mini.get(b)!.pointsFor - mini.get(a)!.pointsFor,
      (a: string, b: string) => difference(overall.get(b)!) - difference(overall.get(a)!),
      (a: string, b: string) => overall.get(b)!.pointsFor - overall.get(a)!.pointsFor,
    ];
    for (const compare of criteria) {
      const groups = partition(ids, compare);
      if (groups.length > 1) return groups.flatMap(breakTie);
    }
    return settleTie(ids, drawKey, unresolved);
  };
  return partition(rows.map(row => row.clubId), (a, b) => classificationPoints(overall.get(b)!) - classificationPoints(overall.get(a)!)).flatMap(breakTie)
    .map((id, index) => ({ ...overall.get(id)!, position: index + 1, ...(unresolved.has(id) ? { rankingTie: unresolved.get(id)! } : {}) }));
}
