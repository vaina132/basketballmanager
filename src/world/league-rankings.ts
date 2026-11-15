import type { CompetitionTableRow } from '../domain/competition';
import { partition, settleTie, type PlayedGame } from './lnb-ranking';

/**
 * League-specific regular-season rankings verified on 15 November 2026 (step 3.4e-2). Sources and the readings taken
 * where a text is silent are in docs/competition-rules-2026.md. Only sporting results exist in the engine: no
 * forfeits, sanctions or point deductions, so the rules' sanction clauses never apply. Every rule settles a tie that
 * survives all its criteria with the same reproducible draw as `lnb-2026-1` once the table is complete, and marks it
 * unresolved before that.
 */
export interface RankedGame extends PlayedGame {
  /** Personal and technical fouls of each side (FIP article 62.3); only the FIP rule reads them. */
  fouls?: { home: number; away: number };
}
type Compare = (a: string, b: string) => number;
interface Tally { played: number; wins: number; losses: number; pointsFor: number; pointsAgainst: number; fouls: number }

const difference = (row: Pick<Tally, 'pointsFor' | 'pointsAgainst'>) => row.pointsFor - row.pointsAgainst;
const higher = (value: (id: string) => number): Compare => (a, b) => { const x = value(a), y = value(b); return x === y ? 0 : x > y ? -1 : 1; };
const lower = (value: (id: string) => number): Compare => (a, b) => higher(id => -value(id))(a, b);

/** Each club's record in the games among `ids` only. */
function tally(ids: readonly string[], games: readonly RankedGame[]): Map<string, Tally> {
  const rows = new Map(ids.map(id => [id, { played: 0, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, fouls: 0 }]));
  for (const game of games) {
    const home = rows.get(game.homeClubId), away = rows.get(game.awayClubId);
    if (!home || !away) continue;
    for (const [row, id, scored, conceded, fouls] of [[home, game.homeClubId, game.home, game.away, game.fouls?.home], [away, game.awayClubId, game.away, game.home, game.fouls?.away]] as const) {
      row.played++; row.pointsFor += scored; row.pointsAgainst += conceded; row.fouls += fouls ?? 0;
      if (game.winnerClubId === id) row.wins++; else row.losses++;
    }
  }
  return rows;
}

/** Ranks rows by `primary`, breaks each tied group with `breakTie`, then numbers the positions. */
function rank(rows: readonly CompetitionTableRow[], primary: Compare, breakTie: (ids: string[], marks: Map<string, 'unresolved' | 'draw'>) => string[]): CompetitionTableRow[] {
  const byId = new Map(rows.map(row => [row.clubId, row]));
  const marks = new Map<string, 'unresolved' | 'draw'>();
  return partition(rows.map(row => row.clubId), primary).flatMap(ids => breakTie(ids, marks))
    .map((id, index) => ({ ...byId.get(id)!, position: index + 1, ...(marks.has(id) ? { rankingTie: marks.get(id)! } : {}) }));
}

/**
 * Applies `criteria(ids)` in order; when one separates the clubs, each group still level starts again from the first
 * criterion with only its own clubs (the restart rules of BBL § 20 (9), ACB article 7.3.2 and FIP article 62.2).
 */
function restartingTieBreak(criteria: (ids: string[]) => Compare[], drawKey: string | null, marks: Map<string, 'unresolved' | 'draw'>): (ids: string[]) => string[] {
  const breakTie = (ids: string[]): string[] => {
    if (ids.length < 2) return ids;
    for (const compare of criteria(ids)) {
      const groups = partition(ids, compare);
      if (groups.length > 1) return groups.flatMap(breakTie);
    }
    return settleTie(ids, drawKey, marks);
  };
  return breakTie;
}

/**
 * easyCredit BBL Spielordnung 2026/2027, § 16 (1) and § 20 (`bbl-art20-2026`). A win scores 2:0 and a loss 0:2
 * Wertungspunkte; more plus points, then fewer minus points. Clubs level on both are ranked by (3) plus points in the
 * games between them, (4) points difference in those games, (5) overall points difference and (6) the better quotient
 * of points scored and conceded, which with a positive difference is the smaller one and with a negative difference the
 * larger one (at equal difference: more points scored; no decision at a difference of zero); (7) then lots. Once some
 * clubs are placed, the procedure restarts at (3) for the others (§ 20 (8)-(9)).
 */
export function rankBblTable(rows: readonly CompetitionTableRow[], games: readonly RankedGame[], drawKey: string | null): CompetitionTableRow[] {
  const overall = new Map(rows.map(row => [row.clubId, row]));
  const quotient: Compare = (a, b) => {
    const x = overall.get(a)!, y = overall.get(b)!, sign = Math.sign(difference(x));
    if (sign === 0 || sign !== Math.sign(difference(y))) return 0;
    const cross = x.pointsFor * y.pointsAgainst - y.pointsFor * x.pointsAgainst;
    return sign > 0 ? Math.sign(cross) : -Math.sign(cross);
  };
  return rank(rows, (a, b) => higher(id => overall.get(id)!.wins)(a, b) || lower(id => overall.get(id)!.losses)(a, b), (ids, marks) => restartingTieBreak(group => {
    const direct = tally(group, games);
    return [higher(id => direct.get(id)!.wins), higher(id => difference(direct.get(id)!)), higher(id => difference(overall.get(id)!)), quotient];
  }, drawKey, marks)(ids));
}

/** The sum of a club's per-game quotients of points scored and conceded, to a thousandth (ACB article 7.3). */
function quotientSums(rows: readonly CompetitionTableRow[], games: readonly RankedGame[]): Map<string, number> {
  const sums = new Map(rows.map(row => [row.clubId, 0]));
  for (const game of games) for (const [id, scored, conceded] of [[game.homeClubId, game.home, game.away], [game.awayClubId, game.away, game.home]] as const) {
    if (sums.has(id)) sums.set(id, sums.get(id)! + (conceded > 0 ? scored / conceded : Infinity));
  }
  return new Map([...sums].map(([id, sum]) => [id, Number.isFinite(sum) ? Math.round(sum * 1000) : sum]));
}

/**
 * ACB Normas Internas 2026/2027, articles 6.2 and 7 (`acb-art7-2026`). Most wins, or win percentage while clubs have
 * played different numbers of games. Among clubs level on that, those with fewer games come first (7.2). Clubs level
 * with equal games: if they have not all met home and away (7.3.1), overall points difference, overall points scored
 * and the sum of per-game quotients of points scored and conceded (to a thousandth). If they have (7.3.2): two clubs by
 * direct wins, direct difference, overall difference, overall points scored and the quotient sum; three or more also
 * use direct points scored after the direct difference; clubs still level start again with the list for their number.
 * 7.3.3 (the previous season's final position) is not applied: the game uses its reproducible draw instead.
 */
export function rankAcbTable(rows: readonly CompetitionTableRow[], games: readonly RankedGame[], drawKey: string | null): CompetitionTableRow[] {
  const overall = new Map(rows.map(row => [row.clubId, row]));
  const sums = quotientSums(rows, games);
  const sameGames = rows.every(row => row.played === rows[0]!.played);
  const primary: Compare = sameGames ? higher(id => overall.get(id)!.wins) : (a, b) => {
    const x = overall.get(a)!, y = overall.get(b)!;
    return Math.sign(y.wins * (x.played || 1) - x.wins * (y.played || 1));
  };
  const seasonWide = [higher(id => difference(overall.get(id)!)), higher(id => overall.get(id)!.pointsFor), higher(id => sums.get(id)!)];
  // Every pair of the clubs has played each other at home and away.
  const metHomeAndAway = (ids: readonly string[]) => ids.every(a => ids.every(b => a === b || games.some(game => game.homeClubId === a && game.awayClubId === b)));
  return rank(rows, primary, (tied, marks) => {
    const sequential = (ids: string[]): string[] => {
      // 7.3.1 continues down its own list; its criteria are season-wide, so a group never switches to 7.3.2.
      for (const compare of seasonWide) {
        const groups = partition(ids, compare);
        if (groups.length > 1) return groups.flatMap(group => group.length > 1 ? sequential(group) : group);
      }
      return settleTie(ids, drawKey, marks);
    };
    const direct = restartingTieBreak(group => {
      const h2h = tally(group, games);
      return group.length === 2
        ? [higher(id => h2h.get(id)!.wins), higher(id => difference(h2h.get(id)!)), ...seasonWide]
        : [higher(id => h2h.get(id)!.wins), higher(id => difference(h2h.get(id)!)), higher(id => h2h.get(id)!.pointsFor), ...seasonWide];
    }, drawKey, marks);
    return partition(tied, lower(id => overall.get(id)!.played)).flatMap(group => group.length < 2 ? group : metHomeAndAway(group) ? direct(group) : sequential(group));
  });
}

/**
 * FIP Regolamento Esecutivo Gare (25 March 2026), articles 60 and 62 (`fip-art62-2026`), applied by Lega Basket Serie A
 * (Regolamento Sportivo article 8.2) and to Serie A2. Two points for a win, none for a loss. Two clubs level: direct wins,
 * the direct points quotient (scored divided by conceded), then the quotient over all games. Three or more: a table of
 * their direct games only, the direct quotient among clubs still level there, then the overall quotient; whenever two
 * or more clubs remain level the list for their number starts again (62.2). Still level: fewer personal and technical
 * fouls in the direct games, then in all games (62.3). Quotients keep four decimals (62.5). A quotient of 0:0 counts as
 * equal totals, so the next criterion decides. Article 62.4 (competitions of three clubs) never applies to a league.
 */
export function rankFipTable(rows: readonly CompetitionTableRow[], games: readonly RankedGame[], drawKey: string | null): CompetitionTableRow[] {
  const overall = new Map(rows.map(row => [row.clubId, row]));
  const allFouls = tally(rows.map(row => row.clubId), games);
  const quotient = (row: Pick<Tally, 'pointsFor' | 'pointsAgainst'>) => row.pointsAgainst > 0 ? Math.floor(row.pointsFor * 10_000 / row.pointsAgainst) : row.pointsFor > 0 ? Infinity : 10_000;
  return rank(rows, higher(id => overall.get(id)!.wins), (ids, marks) => restartingTieBreak(group => {
    const direct = tally(group, games);
    return [higher(id => direct.get(id)!.wins), higher(id => quotient(direct.get(id)!)), higher(id => quotient(overall.get(id)!)), lower(id => direct.get(id)!.fouls), lower(id => allFouls.get(id)!.fouls)];
  }, drawKey, marks)(ids));
}
