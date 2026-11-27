import type { CompetitionGame, CompetitionGameResult, CompetitionTableRow, DomesticStandingsRule } from '../domain/competition';
import { validateCompetitionResult } from './competition-series';
import { rankLnbTable } from './lnb-ranking';
import { rankFibaTable } from './fiba-ranking';
import { rankAcbTable, rankBblTable, rankFipTable } from './league-rankings';
import { rankNbaTables, type NbaTables } from './nba-ranking';
import type { NbaConference } from '../domain/world';

/** NBA step 5: the NBA rule (`nba-2026`) ranks by conference and division as well, so it needs the league's structure. */
const RANKINGS = { 'lnb-2026-1': rankLnbTable, 'fiba-2026-d': rankFibaTable, 'acb-art7-2026': rankAcbTable, 'bbl-art20-2026': rankBblTable, 'fip-art62-2026': rankFipTable, 'nba-2026': null } as const;
type TableInput = { competitionId: string; clubIds: readonly string[]; games: readonly CompetitionGame[]; results: readonly CompetitionGameResult[]; stage?: 'regular' | 'round-of-16'; groupId?: string | null; rule?: DomesticStandingsRule; nba?: readonly NbaConference[] };

/** NBA step 5: the NBA's league, conference and division tables from its regular-season games (`nba-2026`). */
export function nbaCompetitionTables(input: Omit<TableInput, 'rule'> & { nba: readonly NbaConference[] }): NbaTables {
  const { rows, ranked, drawKey } = tableParts(input);
  return rankNbaTables(rows, ranked, drawKey, input.nba);
}

/** A table is scoped explicitly to one stage/group. Knockout games never leak into the league standings. */
export function competitionTable(input: TableInput): CompetitionTableRow[] {
  if (input.rule !== undefined && !Object.hasOwn(RANKINGS, input.rule)) throw new Error('Unsupported standings rule.');
  if (input.rule === 'nba-2026') {
    if (!input.nba) throw new Error('The NAL table needs its conferences and divisions.');
    return nbaCompetitionTables({ ...input, nba: input.nba }).league;
  }
  const { rows, ranked, drawKey, played, byId } = tableParts(input);
  if (input.rule !== undefined) return RANKINGS[input.rule]!(rows, ranked, drawKey);
  return defaultTable(input.clubIds, rows, played, byId);
}

function tableParts(input: TableInput) {
  const { clubIds, results } = input;
  if (input.rule !== undefined && !Object.hasOwn(RANKINGS, input.rule)) throw new Error('Unsupported standings rule.');
  if (clubIds.length < 2 || new Set(clubIds).size !== clubIds.length || clubIds.some(id => !id)) throw new Error('A table needs distinct registered clubs.');
  const games = input.games.filter(game => game.competitionId === input.competitionId && game.stage === (input.stage ?? 'regular') && game.groupId === (input.groupId ?? null));
  if (new Set(games.map(game => game.id)).size !== games.length || games.some(game => game.homeClubId === game.awayClubId || !clubIds.includes(game.homeClubId) || !clubIds.includes(game.awayClubId))) throw new Error('Table fixtures must belong to its registered field.');
  const byId = new Map(games.map(game => [game.id, game]));
  if (new Set(results.map(result => result.fixtureId)).size !== results.length) throw new Error('A result cannot be counted twice.');
  const played = results.filter(result => byId.has(result.fixtureId));
  played.forEach(result => validateCompetitionResult(byId.get(result.fixtureId)!, result));
  if (played.some(result => result.fouls !== undefined && (!Number.isInteger(result.fouls.home) || !Number.isInteger(result.fouls.away) || result.fouls.home < 0 || result.fouls.away < 0))) throw new Error('Foul totals must be whole, non-negative numbers.');
  const rows = new Map(clubIds.map(clubId => [clubId, { clubId, played: 0, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, position: 0 }]));
  for (const result of played) {
    const game = byId.get(result.fixtureId)!;
    for (const [id, pointsFor, pointsAgainst] of [[game.homeClubId, result.home, result.away], [game.awayClubId, result.away, result.home]] as const) {
      const row = rows.get(id)!;
      row.played++; row.wins += Number(result.winnerClubId === id); row.losses += Number(result.winnerClubId !== id); row.pointsFor += pointsFor; row.pointsAgainst += pointsAgainst;
    }
  }
  const drawKey = games.length > 0 && played.length === games.length ? JSON.stringify([input.competitionId, games.map(game => game.id).sort()]) : null;
  const ranked = played.map(result => ({ ...byId.get(result.fixtureId)!, home: result.home, away: result.away, winnerClubId: result.winnerClubId, ...(result.fouls ? { fouls: result.fouls } : {}) }));
  return { rows: [...rows.values()], ranked, drawKey, played, byId, tallies: rows };
}

function defaultTable(clubIds: readonly string[], list: readonly CompetitionTableRow[], played: readonly CompetitionGameResult[], byId: ReadonlyMap<string, CompetitionGame>): CompetitionTableRow[] {
  const rows = new Map(list.map(row => [row.clubId, row]));
  const partition = (ids: string[], measure: (id: string) => number): string[][] => {
    const values = ids.map(id => ({ id, value: measure(id) })).sort((a, b) => b.value - a.value || a.id.localeCompare(b.id));
    const groups: { value: number; ids: string[] }[] = [];
    for (const row of values) { if (groups.at(-1)?.value === row.value) groups.at(-1)!.ids.push(row.id); else groups.push({ value: row.value, ids: [row.id] }); }
    return groups.map(group => group.ids);
  };
  const breakTie = (ids: string[]): string[] => {
    if (ids.length < 2) return ids;
    const mini = new Map(ids.map(id => [id, { wins: 0, difference: 0, points: 0 }]));
    for (const result of played) {
      const game = byId.get(result.fixtureId)!;
      if (!mini.has(game.homeClubId) || !mini.has(game.awayClubId)) continue;
      for (const [id, scored, conceded] of [[game.homeClubId, result.home, result.away], [game.awayClubId, result.away, result.home]] as const) {
        const row = mini.get(id)!; row.wins += Number(result.winnerClubId === id); row.difference += scored - conceded; row.points += scored;
      }
    }
    const criteria = [ (id: string) => mini.get(id)!.wins, (id: string) => mini.get(id)!.difference, (id: string) => mini.get(id)!.points, (id: string) => rows.get(id)!.pointsFor - rows.get(id)!.pointsAgainst, (id: string) => rows.get(id)!.pointsFor ];
    for (const criterion of criteria) {
      const groups = partition(ids, criterion);
      if (groups.length > 1) return groups.flatMap(breakTie);
    }
    return [...ids].sort(); // Equal sporting records have a stable display order, never a fabricated result.
  };
  return partition([...clubIds], id => rows.get(id)!.wins).flatMap(breakTie).map((id, index) => ({ ...rows.get(id)!, position: index + 1 }));
}
