import { describe, expect, it } from 'vitest';
import { addCalendarDays, buildCompetitionCalendar, domesticRoundDates, firstSeasonSaturday, managerGameOnDay, roundRobinGames, roundRobinRoundCount } from '../src/world/competition-calendar';

const clubs = (count: number, prefix = 'club') => Array.from({ length: count }, (_, i) => `${prefix}-${i + 1}`);
const start = firstSeasonSaturday(2026);
const schedule = (count: number, id = 'league') => roundRobinGames({ competitionId: id, season: 1, clubIds: clubs(count, id), dates: domesticRoundDates(start, roundRobinRoundCount(count)) });

describe('shared competition calendar', () => {
  it.each([3, 4, 6, 14, 16, 17, 18, 20])('schedules %i clubs home and away without dummy clubs or duplicated opponents', count => {
    const games = schedule(count), appearances = new Map<string, number>();
    expect(games).toHaveLength(count * (count - 1));
    for (const game of games) {
      expect(game.homeClubId).not.toBe(game.awayClubId);
      const pair = `${game.homeClubId}/${game.awayClubId}`;
      appearances.set(pair, (appearances.get(pair) ?? 0) + 1);
    }
    expect([...appearances.values()].every(value => value === 1)).toBe(true);
    for (let round = 1; round <= roundRobinRoundCount(count); round++) {
      const members = games.filter(game => game.stageRound === round).flatMap(game => [game.homeClubId, game.awayClubId]);
      expect(members).toHaveLength(count - count % 2);
      expect(new Set(members).size).toBe(members.length);
    }
  });
  it('gives every TBL club two genuine byes and a final round on the shared weekend', () => {
    const games = schedule(17), all = clubs(17, 'league');
    for (const id of all) expect(34 - games.filter(game => [game.homeClubId, game.awayClubId].includes(id)).length).toBe(2);
    expect(games.at(-1)!.date).toBe(schedule(20).at(-1)!.date);
    expect(games.at(-1)!.date).toBe('2027-05-22');
  });
  it('keeps weekly accounting boundaries independent of game volume or a manager bye', () => {
    const domestic = schedule(17), euro = roundRobinGames({ competitionId: 'europe', season: 1, clubIds: ['league-1', 'foreign'], dates: ['2026-09-08', '2026-09-10'] });
    const input = { start, end: '2027-05-28', nextSeasonStart: firstSeasonSaturday(2027) };
    const a = buildCompetitionCalendar({ ...input, games: domestic }), b = buildCompetitionCalendar({ ...input, games: [...domestic, ...euro] });
    expect(a.filter(day => day.closesWeek)).toHaveLength(38);
    expect(b.filter(day => day.closesWeek).map(day => day.date)).toEqual(a.filter(day => day.closesWeek).map(day => day.date));
    expect(managerGameOnDay(b.find(day => day.date === '2026-09-08')!, [...domestic, ...euro], 'league-2')).toBeNull();
    expect(managerGameOnDay(b.find(day => day.date === '2026-09-08')!, [...domestic, ...euro], 'league-1')!.competitionId).toBe('europe');
  });
  it('rejects overlaps, next-day travel, duplicate fixtures and calendars crossing the next season', () => {
    const games = schedule(4), first = games[0]!;
    const calendar = (extra: typeof games) => buildCompetitionCalendar({ start, end: '2027-05-28', nextSeasonStart: firstSeasonSaturday(2027), games: [...games, ...extra] });
    expect(() => calendar([first])).toThrow(/invalid, repeated/);
    for (const days of [0, 1]) expect(() => calendar([{ ...first, id: 'extra', date: addCalendarDays(first.date, days) }])).toThrow(/rest day/);
    expect(() => buildCompetitionCalendar({ start, end: '2027-09-18', nextSeasonStart: '2027-09-04', games: [] })).toThrow(/offseason/);
    expect(() => domesticRoundDates(start, 78)).toThrow();
  });
  it('reserves qualifying weekends explicitly and rejects a field that cannot fit', () => {
    const dates = domesticRoundDates(start, 30, 38, [3]);
    expect(dates).not.toContain('2026-09-19');
    expect(dates.at(-1)).toBe('2027-05-22');
    expect(() => domesticRoundDates(start, 38, 38, [3])).toThrow(/too few/);
    expect(() => domesticRoundDates(start, 30, 38, [38])).toThrow();
    expect(() => firstSeasonSaturday(2026.5)).toThrow();
    expect(() => addCalendarDays('2026-02-30', 1)).toThrow();
  });
});
