import { describe, expect, it } from 'vitest';
import type { CompetitionGame, CompetitionGameResult, CompetitionSeries } from '../src/domain/competition';
import { BEST_OF_FIVE_HOSTS, BEST_OF_THREE_HOSTS, playInGames, seededBracket, seriesGames, seriesProgress } from '../src/world/competition-series';
import { competitionTable } from '../src/world/competition-table';
import { roundRobinGames } from '../src/world/competition-calendar';

const result = (game: CompetitionGame, winner: string, points = 80, conceded = 70): CompetitionGameResult => ({ fixtureId: game.id, home: winner === game.homeClubId ? points : conceded, away: winner === game.homeClubId ? conceded : points, winnerClubId: winner });
const series: CompetitionSeries = { id: 'league-s1-qf1', competitionId: 'league', stage: 'quarter-final', higherSeedId: 'a', lowerSeedId: 'b', hosts: BEST_OF_FIVE_HOSTS, dates: ['2027-06-05', '2027-06-08', '2027-06-10', '2027-06-12', '2027-06-15'], winsRequired: 3 };

describe('competition series and standings', () => {
  it('ends a sweep immediately and cancels reserved games rather than creating extra results', () => {
    const games = seriesGames(series), results = games.slice(0, 3).map(game => result(game, 'b'));
    const progress = seriesProgress(series, results);
    expect(progress).toMatchObject({ wins: { a: 0, b: 3 }, winnerClubId: 'b', loserClubId: 'a', nextGame: null });
    expect(progress.cancelled.map(game => game.id)).toEqual(games.slice(3).map(game => game.id));
    expect(() => seriesProgress(series, [...results, result(games[3]!, 'a')])).toThrow(/decided series/);
    expect(() => seriesProgress(series, [result(games[1]!, 'a')])).toThrow(/skip/);
    expect(() => seriesProgress(series, [results[0]!, results[0]!])).toThrow(/unique/);
  });
  it('retains the correct home pattern, supports a deciding fifth game and neutral finals', () => {
    const games = seriesGames(series);
    expect(games.map(game => game.homeClubId)).toEqual(['a', 'a', 'b', 'b', 'a']);
    const four = games.slice(0, 4).map((game, i) => result(game, i % 2 ? 'b' : 'a'));
    expect(seriesProgress(series, four).nextGame).toEqual(games[4]);
    expect(seriesProgress(series, [...four, result(games[4]!, 'a')]).cancelled).toEqual([]);
    const final = { ...series, stage: 'final' as const, winsRequired: 1, hosts: ['neutral'] as const, dates: ['2027-05-30'] };
    expect(seriesGames(final)[0]!.neutral).toBe(true);
    expect(seriesProgress(final, []).winnerClubId).toBeNull();
    const three = { ...series, winsRequired: 2, hosts: BEST_OF_THREE_HOSTS, dates: series.dates.slice(0, 3) };
    expect(seriesGames(three).map(game => game.homeClubId)).toEqual(['a', 'b', 'a']);
  });
  it('seeds the conventional bracket and does not create a play-in final before both feeders finish', () => {
    expect(seededBracket(['1', '2', '3', '4', '5', '6', '7', '8'])).toEqual([['1', '8'], ['4', '5'], ['2', '7'], ['3', '6']]);
    const input = { id: 'play-in', competitionId: 'league', rankedClubIds: ['7', '8', '9', '10'], dates: ['2027-06-01', '2027-06-03'] as const, results: [] as CompetitionGameResult[] };
    const opening = playInGames(input);
    expect(opening.games).toHaveLength(2);
    const results = [result(opening.games[0]!, '8'), result(opening.games[1]!, '10')];
    const second = playInGames({ ...input, results });
    expect(second.games[2]).toMatchObject({ homeClubId: '7', awayClubId: '10' });
    expect(playInGames({ ...input, results: [...results, result(second.games[2]!, '10')] }).seeds).toEqual(['8', '10']);
    expect(() => playInGames({ ...input, results: [result(second.games[2]!, '10')] })).toThrow(/participants/);
  });
  it('uses head-to-head records within a tied group and excludes other competitions and knockout results', () => {
    const games = roundRobinGames({ competitionId: 'league', season: 1, clubIds: ['a', 'b', 'c'], dates: ['2026-09-05', '2026-09-12', '2026-09-19', '2026-09-26', '2026-10-03', '2026-10-10'] });
    const results = games.map(game => {
      const pair = [game.homeClubId, game.awayClubId].sort().join('');
      return result(game, pair === 'ab' ? 'a' : pair === 'ac' ? 'c' : 'b', pair === 'ab' ? 85 : 80, 70);
    });
    // Everyone is 2–2. A's greater head-to-head difference decides the three-way tie.
    const extra = { ...games[0]!, id: 'other', competitionId: 'other-league' };
    const knockout = { ...games[0]!, id: 'knockout', stage: 'quarter-final' as const };
    const table = competitionTable({ competitionId: 'league', clubIds: ['a', 'b', 'c'], games: [...games, extra, knockout], results: [...results, result(extra, 'c'), result(knockout, 'c')] });
    expect(table.map(row => row.clubId)).toEqual(['a', 'c', 'b']);
    expect(table.every(row => row.played === 4 && row.wins === 2)).toBe(true);
    expect(() => competitionTable({ competitionId: 'league', clubIds: ['a', 'b', 'c'], games, results: [...results, results[0]!] })).toThrow(/twice/);
  });
});
