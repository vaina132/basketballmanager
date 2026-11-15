import type { CompetitionGame, CompetitionGameResult, CompetitionSeries } from '../domain/competition';
import { calendarDate, calendarDaysBetween } from './competition-calendar';

/** Reserved games are possibilities. Only nextGame is playable; later games disappear after a series is decided. */
export function seriesGames(series: CompetitionSeries): CompetitionGame[] {
  const maximum = series.winsRequired * 2 - 1;
  if (!series.id || !series.competitionId || !series.higherSeedId || !series.lowerSeedId || series.higherSeedId === series.lowerSeedId || ![1, 2, 3, 4].includes(series.winsRequired) || series.hosts.length !== maximum || series.dates.length !== maximum || series.hosts.some(host => !['higher', 'lower', 'neutral'].includes(host))) throw new Error('A series needs two distinct clubs and a complete legal host/date pattern.');
  return series.dates.map((date, index) => {
    calendarDate(date);
    if (index && calendarDaysBetween(series.dates[index - 1]!, date) < 2) throw new Error('Series games must leave a full rest day.');
    const lowerAtHome = series.hosts[index] === 'lower';
    return { id: `${series.id}-g${index + 1}`, competitionId: series.competitionId, stage: series.stage, stageRound: index + 1, groupId: null, seriesId: series.id, date, homeClubId: lowerAtHome ? series.lowerSeedId : series.higherSeedId, awayClubId: lowerAtHome ? series.higherSeedId : series.lowerSeedId, neutral: series.hosts[index] === 'neutral' };
  });
}

export function validateCompetitionResult(game: CompetitionGame, result: CompetitionGameResult): void {
  if (result.fixtureId !== game.id || !Number.isInteger(result.home) || !Number.isInteger(result.away) || result.home < 0 || result.away < 0 || result.home > 1000 || result.away > 1000 || result.home === result.away || result.winnerClubId !== (result.home > result.away ? game.homeClubId : game.awayClubId)) throw new Error('A competition result must match its fixture and decisive official score.');
}

export function seriesProgress(series: CompetitionSeries, results: readonly CompetitionGameResult[]): { wins: Record<string, number>; winnerClubId: string | null; loserClubId: string | null; nextGame: CompetitionGame | null; played: CompetitionGame[]; cancelled: CompetitionGame[] } {
  const games = seriesGames(series), byId = new Map(results.map(result => [result.fixtureId, result]));
  if (byId.size !== results.length || results.some(result => !games.some(game => game.id === result.fixtureId))) throw new Error('Only unique results from this series are allowed.');
  const wins = { [series.higherSeedId]: 0, [series.lowerSeedId]: 0 }, played: CompetitionGame[] = [];
  let winnerClubId: string | null = null, nextGame: CompetitionGame | null = null;
  for (const game of games) {
    const result = byId.get(game.id);
    if (!result) { if (!winnerClubId && !nextGame) nextGame = game; continue; }
    if (winnerClubId || nextGame) throw new Error('Cannot play a decided series or skip an earlier game.');
    validateCompetitionResult(game, result);
    wins[result.winnerClubId]!++;
    played.push(game);
    if (wins[result.winnerClubId] === series.winsRequired) winnerClubId = result.winnerClubId;
  }
  const loserClubId = winnerClubId ? [series.higherSeedId, series.lowerSeedId].find(id => id !== winnerClubId)! : null;
  return { wins, winnerClubId, loserClubId, nextGame: winnerClubId ? null : nextGame, played, cancelled: winnerClubId ? games.slice(played.length) : [] };
}

export const BEST_OF_THREE_HOSTS = ['higher', 'lower', 'higher'] as const;
export const BEST_OF_FIVE_HOSTS = ['higher', 'higher', 'lower', 'lower', 'higher'] as const;

/** Conventional 1v8 / 4v5 / 2v7 / 3v6 bracket, already ordered into semi-final pairs. */
export function seededBracket(clubIds: readonly string[]): [string, string][] {
  if (![2, 4, 8, 16].includes(clubIds.length) || clubIds.some(id => !id) || new Set(clubIds).size !== clubIds.length) throw new Error('A seeded bracket needs 2, 4, 8 or 16 distinct clubs.');
  let seeds = [1, 2];
  while (seeds.length < clubIds.length) seeds = seeds.flatMap(seed => [seed, seeds.length * 2 + 1 - seed]);
  return Array.from({ length: clubIds.length / 2 }, (_, i) => [clubIds[seeds[i * 2]! - 1]!, clubIds[seeds[i * 2 + 1]! - 1]!]);
}

/** 7v8 then 9v10, followed by the upper loser against the lower winner; every game at the better seed. */
export function playInGames(input: { id: string; competitionId: string; rankedClubIds: readonly string[]; dates: readonly [string, string]; results: readonly CompetitionGameResult[] }): { games: CompetitionGame[]; seeds: [string, string] | null } {
  const { rankedClubIds: ranks, dates, results } = input;
  if (ranks.length !== 4 || new Set(ranks).size !== 4 || ranks.some(id => !id) || calendarDaysBetween(dates[0], dates[1]) < 2) throw new Error('A play-in needs four ranked clubs and two dates with a full rest day.');
  const game = (number: number, homeClubId: string, awayClubId: string, date: string): CompetitionGame => ({ id: `${input.id}-g${number}`, competitionId: input.competitionId, stage: 'play-in', stageRound: number < 3 ? 1 : 2, groupId: null, seriesId: null, date, homeClubId, awayClubId, neutral: false });
  const games = [game(1, ranks[0]!, ranks[1]!, dates[0]), game(2, ranks[2]!, ranks[3]!, dates[0])];
  const byId = new Map(results.map(result => [result.fixtureId, result]));
  if (byId.size !== results.length) throw new Error('Play-in results must be unique.');
  const upper = byId.get(games[0]!.id), lower = byId.get(games[1]!.id);
  if (upper) validateCompetitionResult(games[0]!, upper);
  if (lower) validateCompetitionResult(games[1]!, lower);
  if (upper && lower) {
    const upperLoser = ranks.slice(0, 2).find(id => id !== upper.winnerClubId)!;
    games.push(game(3, upperLoser, lower.winnerClubId, dates[1]));
  }
  if (results.some(result => !games.some(game => game.id === result.fixtureId))) throw new Error('Cannot record a play-in game before its participants are decided.');
  const final = games[2] && byId.get(games[2].id);
  if (final) validateCompetitionResult(games[2]!, final);
  return { games, seeds: upper && final ? [upper.winnerClubId, final.winnerClubId] : null };
}
