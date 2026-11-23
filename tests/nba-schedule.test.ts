import { describe, expect, it } from 'vitest';
import { nbaPack } from './helpers/nba-pack';
import { worldFromPack } from '../src/world/real-world';
import { NBA_POSTSEASON_SLOTS, NBA_REGULAR_WEEKS, NBA_SCHEDULE_RULES, NBA_SEASON_WEEKS, nbaGameDays, nbaPostseasonSlotDay, nbaSchedule, nbaSeasonDates, nbaWeekOf } from '../src/world/nba-schedule';
import { buildCompetitionCalendar, calendarDaysBetween } from '../src/world/competition-calendar';
import { domesticSchedule, seasonStartDate } from '../src/world/season';
import { expectedRegularGames, isNbaClub, regularWorldRounds, worldRounds } from '../src/world/career-world';

const world = worldFromPack(nbaPack(), 'nba');
const nba = world.nba!;
const conferenceOf = (id: string) => nba.conferences.findIndex(conference => conference.divisions.some(division => division.clubIds.includes(id)));
const divisionOf = (id: string) => nba.conferences.flatMap(conference => conference.divisions).findIndex(division => division.clubIds.includes(id));

describe('NBA schedule (nba-schedule.ts)', () => {
  it('gives every club 82 games, 41 at home, with the NBA formula: division 4x, conference 4x or 3x, other conference 2x', () => {
    const started = performance.now();
    const games = nbaSchedule(world, 1);
    expect(performance.now() - started).toBeLessThan(3000);
    expect(games).toHaveLength(1230);
    expect(new Set(games.map(game => game.id)).size).toBe(1230);
    for (const club of nba.conferences.flatMap(conference => conference.divisions.flatMap(division => division.clubIds))) {
      const own = games.filter(game => game.homeClubId === club || game.awayClubId === club);
      expect(own).toHaveLength(82);
      expect(own.filter(game => game.homeClubId === club)).toHaveLength(41);
      const meetings = new Map<string, number>();
      for (const game of own) { const other = game.homeClubId === club ? game.awayClubId : game.homeClubId; meetings.set(other, (meetings.get(other) ?? 0) + 1); }
      const counts = (filter: (other: string) => boolean) => [...meetings].filter(([other]) => filter(other)).map(([, count]) => count).sort();
      expect(counts(other => divisionOf(other) === divisionOf(club))).toEqual([4, 4, 4, 4]);
      expect(counts(other => conferenceOf(other) === conferenceOf(club) && divisionOf(other) !== divisionOf(club))).toEqual([3, 3, 3, 3, 4, 4, 4, 4, 4, 4]);
      expect(counts(other => conferenceOf(other) !== conferenceOf(club))).toEqual(Array(15).fill(2));
    }
  });

  it('plays from the third full week of October to the second Sunday of April, never in the All-Star break, never twice a day or three days running', () => {
    const { start, end, allStar } = nbaSeasonDates(1);
    expect([start, end, allStar]).toEqual(['2026-10-20', '2027-04-11', '2027-02-21']);
    expect(new Date(`${start}T00:00:00Z`).getUTCDay()).toBe(2);
    const games = nbaSchedule(world, 1), days = new Set(nbaGameDays(1));
    expect(games.every(game => days.has(game.date))).toBe(true);
    expect(games.some(game => game.date >= '2027-02-19' && game.date <= '2027-02-23')).toBe(false);
    const backToBacks: number[] = [];
    for (const club of new Set(games.map(game => game.homeClubId))) {
      const dates = games.filter(game => game.homeClubId === club || game.awayClubId === club).map(game => game.date).sort();
      const gaps = dates.slice(1).map((date, index) => calendarDaysBetween(dates[index]!, date));
      expect(gaps.every(gap => gap >= 1)).toBe(true);
      expect(gaps.some((gap, index) => gap === 1 && gaps[index + 1] === 1)).toBe(false);
      backToBacks.push(gaps.filter(gap => gap === 1).length);
    }
    expect(Math.max(...backToBacks)).toBeLessThanOrEqual(NBA_SCHEDULE_RULES.backToBackCap);
    const average = backToBacks.reduce((sum, value) => sum + value, 0) / backToBacks.length;
    expect(average).toBeGreaterThanOrEqual(12);
    expect(average).toBeLessThanOrEqual(15);
    // The shared calendar accepts NBA clubs on consecutive days only when told they may.
    const asGames = games.map((game, index) => ({ id: game.id, competitionId: 'nba', stage: 'regular' as const, stageRound: index + 1, groupId: null, seriesId: null, date: game.date, homeClubId: game.homeClubId, awayClubId: game.awayClubId, neutral: false }));
    const calendar = { start: seasonStartDate(1), end: '2027-06-30', nextSeasonStart: seasonStartDate(2), games: asGames };
    expect(() => buildCompetitionCalendar(calendar)).toThrow(/rest day/);
    expect(buildCompetitionCalendar({ ...calendar, gameGap: club => isNbaClub(world, club) ? 1 : 2 }).length).toBeGreaterThan(150);
  });

  it('is deterministic, cached per world and season, and rotates the three-game opponents over five seasons', () => {
    const again = worldFromPack(nbaPack(), 'nba');
    expect(nbaSchedule(again, 1)).toEqual(nbaSchedule(world, 1));
    expect(nbaSchedule(world, 1)).toBe(nbaSchedule(world, 1));
    const threeGame = (season: number) => {
      const pairs = new Map<string, number>();
      for (const game of nbaSchedule(world, season)) { const key = [game.homeClubId, game.awayClubId].sort().join('|'); pairs.set(key, (pairs.get(key) ?? 0) + 1); }
      return new Set([...pairs].filter(([, count]) => count === 3).map(([key]) => key));
    };
    const seasons = [1, 2, 3, 4, 5].map(threeGame);
    expect(seasons[1]).not.toEqual(seasons[0]);
    // Over the five-season cycle each non-division conference pairing is met three times in exactly two seasons.
    const tally = new Map<string, number>();
    for (const set of seasons) for (const key of set) tally.set(key, (tally.get(key) ?? 0) + 1);
    expect(tally.size).toBe(2 * 3 * 25);
    expect([...tally.values()].every(count => count === 2)).toBe(true);
    expect(threeGame(6)).toEqual(seasons[0]);
  });

  it('fits the career calendar: weeks, the postseason slots and the world\'s season length', () => {
    expect(NBA_REGULAR_WEEKS).toBeGreaterThanOrEqual(32);
    expect(regularWorldRounds(world)).toBe(NBA_REGULAR_WEEKS);
    expect(worldRounds(world)).toBe(NBA_SEASON_WEEKS);
    expect(expectedRegularGames(world, world.domesticLeagues![0]!)).toBe(1230);
    for (let season = 1; season <= 28; season += 1) {
      expect(nbaWeekOf(season, nbaSeasonDates(season).end)).toBeLessThanOrEqual(NBA_REGULAR_WEEKS);
      const last = nbaPostseasonSlotDay(season, NBA_POSTSEASON_SLOTS);
      expect(last.round).toBeLessThanOrEqual(NBA_SEASON_WEEKS);
      expect(calendarDaysBetween(nbaSeasonDates(season).end, nbaPostseasonSlotDay(season, 1).date)).toBe(2);
    }
    const fixtures = domesticSchedule(world.clubs, 1, { world });
    expect(fixtures).toHaveLength(1230);
    expect(fixtures.every(fixture => fixture.round === nbaWeekOf(1, fixture.date))).toBe(true);
    expect(fixtures.map(fixture => fixture.date)).toEqual([...fixtures.map(fixture => fixture.date)].sort());
  });
});
