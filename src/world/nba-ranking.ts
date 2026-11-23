import type { CompetitionTableRow } from '../domain/competition';
import type { NbaConference } from '../domain/world';
import { partition, settleTie, type PlayedGame } from './lnb-ranking';

/**
 * NBA standings (`nba-2026`, NBA step 5, format 90). Clubs are ranked by winning percentage; ties follow the NBA's
 * tie-break procedures (NBA.com, "NBA Tiebreaker Procedures", 2025-26 rules, unchanged for 2026-27):
 *
 * Two clubs: (1) games between them, (2) division leader (a division winner over a club that did not win its
 * division), (3) division record when both are in the same division, (4) conference record, (5) record against the
 * playoff-eligible clubs of its own conference, (6) record against the playoff-eligible clubs of the other conference,
 * (7) point difference in all games.
 * Three or more clubs: (1) division leader, (2) games among the tied clubs, (3) division record when all are in the
 * same division, (4) conference record, (5) record against the playoff-eligible clubs of its own conference, (6) point
 * difference in all games. Once a criterion separates some clubs, each group still level starts again from the top
 * (two clubs with the two-club rules).
 *
 * Simplifications: "playoff-eligible" counts the clubs placed 1-10 of each conference by winning percentage alone
 * (clubs level with the tenth included), so the criterion never depends on the tie it settles; a division leader is the
 * first of its division by these same rules. A tie surviving every criterion uses the reproducible draw of the other
 * rules (`settleTie`) once the season is complete. The league table (home court in the Finals) ranks by winning
 * percentage, then games between the clubs, then point difference, then the draw.
 */
export interface NbaTables {
  league: CompetitionTableRow[];
  conferences: Record<string, CompetitionTableRow[]>;
  divisions: Record<string, CompetitionTableRow[]>;
}
type Compare = (a: string, b: string) => number;
interface Tally { played: number; wins: number }

const pctOrder = (a: Tally, b: Tally) => b.wins * (a.played || 1) - a.wins * (b.played || 1);
const blank = (): Tally => ({ played: 0, wins: 0 });

export function rankNbaTables(rows: readonly CompetitionTableRow[], games: readonly PlayedGame[], drawKey: string | null, conferences: readonly NbaConference[]): NbaTables {
  const byId = new Map(rows.map(row => [row.clubId, row]));
  const conferenceOf = new Map<string, string>(), divisionOf = new Map<string, string>();
  for (const conference of conferences) for (const division of conference.divisions) for (const clubId of division.clubIds) { conferenceOf.set(clubId, conference.id); divisionOf.set(clubId, division.id); }
  // Records against groups of opponents, computed once.
  const versus = (filter: (club: string, opponent: string) => boolean) => {
    const tallies = new Map(rows.map(row => [row.clubId, blank()]));
    for (const game of games) for (const [club, opponent] of [[game.homeClubId, game.awayClubId], [game.awayClubId, game.homeClubId]] as const) {
      if (!filter(club, opponent)) continue;
      const tally = tallies.get(club);
      if (!tally) continue;
      tally.played += 1; tally.wins += Number(game.winnerClubId === club);
    }
    return tallies;
  };
  const division = versus((club, opponent) => divisionOf.get(club) === divisionOf.get(opponent));
  const conference = versus((club, opponent) => conferenceOf.get(club) === conferenceOf.get(opponent));
  const overall = (id: string): CompetitionTableRow => byId.get(id)!;
  const byPct = (tally: (id: string) => Tally): Compare => (a, b) => pctOrder(tally(a), tally(b));
  // Clubs placed 1-10 of each conference by winning percentage alone (level clubs included).
  const eligible = new Set<string>();
  for (const entry of conferences) {
    const members = entry.divisions.flatMap(item => item.clubIds).filter(id => byId.has(id)).sort(byPct(overall));
    const tenth = members[Math.min(9, members.length - 1)];
    for (const id of members) if (tenth !== undefined && pctOrder(overall(id), overall(tenth)) <= 0) eligible.add(id);
  }
  const ownPlayoff = versus((club, opponent) => eligible.has(opponent) && conferenceOf.get(club) === conferenceOf.get(opponent));
  const otherPlayoff = versus((club, opponent) => eligible.has(opponent) && conferenceOf.get(club) !== conferenceOf.get(opponent));
  const amongTied = (ids: readonly string[]): Map<string, Tally> => {
    const set = new Set(ids), tallies = new Map(ids.map(id => [id, blank()]));
    for (const game of games) if (set.has(game.homeClubId) && set.has(game.awayClubId)) for (const club of [game.homeClubId, game.awayClubId]) { const tally = tallies.get(club)!; tally.played += 1; tally.wins += Number(game.winnerClubId === club); }
    return tallies;
  };
  const differenceOrder: Compare = (a, b) => { const x = overall(a), y = overall(b); const dx = x.pointsFor - x.pointsAgainst, dy = y.pointsFor - y.pointsAgainst; return dx === dy ? 0 : dx > dy ? -1 : 1; };
  const sameDivision = (ids: readonly string[]) => ids.every(id => divisionOf.get(id) === divisionOf.get(ids[0]!));

  const rankWith = (ids: readonly string[], leaders: ReadonlySet<string> | null, marks: Map<string, 'unresolved' | 'draw'>): string[] => {
    const leaderOrder: Compare = (a, b) => leaders ? Number(leaders.has(b)) - Number(leaders.has(a)) : 0;
    const criteria = (group: readonly string[]): Compare[] => {
      const direct = amongTied(group), head = byPct(id => direct.get(id)!);
      const divisionRecord: Compare = sameDivision(group) ? byPct(id => division.get(id)!) : () => 0;
      return group.length === 2
        ? [head, leaderOrder, divisionRecord, byPct(id => conference.get(id)!), byPct(id => ownPlayoff.get(id)!), byPct(id => otherPlayoff.get(id)!), differenceOrder]
        : [leaderOrder, head, divisionRecord, byPct(id => conference.get(id)!), byPct(id => ownPlayoff.get(id)!), differenceOrder];
    };
    const breakTie = (group: string[]): string[] => {
      if (group.length < 2) return group;
      for (const compare of criteria(group)) {
        const parts = partition(group, compare);
        if (parts.length > 1) return parts.flatMap(breakTie);
      }
      return settleTie(group, drawKey, marks);
    };
    return partition(ids, byPct(overall)).flatMap(breakTie);
  };
  const table = (ids: readonly string[], leaders: ReadonlySet<string> | null): CompetitionTableRow[] => {
    const marks = new Map<string, 'unresolved' | 'draw'>();
    return rankWith(ids, leaders, marks).map((id, index) => ({ ...byId.get(id)!, position: index + 1, ...(marks.has(id) ? { rankingTie: marks.get(id)! } : {}) }));
  };
  const divisions: Record<string, CompetitionTableRow[]> = {}, leaders = new Set<string>();
  for (const entry of conferences) for (const item of entry.divisions) {
    const ranked = table(item.clubIds.filter(id => byId.has(id)), null);
    divisions[item.id] = ranked;
    if (ranked[0]) leaders.add(ranked[0].clubId);
  }
  const conferenceTables: Record<string, CompetitionTableRow[]> = {};
  for (const entry of conferences) conferenceTables[entry.id] = table(entry.divisions.flatMap(item => item.clubIds).filter(id => byId.has(id)), leaders);
  // League order: winning percentage, games between the clubs, point difference, then the draw.
  const marks = new Map<string, 'unresolved' | 'draw'>();
  const leagueBreak = (group: string[]): string[] => {
    if (group.length < 2) return group;
    const direct = amongTied(group);
    for (const compare of [byPct(id => direct.get(id)!), differenceOrder]) { const parts = partition(group, compare); if (parts.length > 1) return parts.flatMap(leagueBreak); }
    return settleTie(group, drawKey, marks);
  };
  const league = partition(rows.map(row => row.clubId), byPct(overall)).flatMap(leagueBreak).map((id, index) => ({ ...byId.get(id)!, position: index + 1, ...(marks.has(id) ? { rankingTie: marks.get(id)! } : {}) }));
  return { league, conferences: conferenceTables, divisions };
}
