import type { CalendarDay, CompetitionGame, CompetitionStage } from '../domain/competition';

const DAY = 86_400_000;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;

export function calendarDate(value: string): number {
  const time = Date.parse(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) throw new Error('Use a valid UTC calendar date.');
  return time;
}

export function addCalendarDays(date: string, days: number): string {
  if (!Number.isInteger(days)) throw new Error('Calendar intervals must be whole days.');
  const result = new Date(calendarDate(date) + days * DAY).toISOString().slice(0, 10);
  calendarDate(result);
  return result;
}

export function calendarDaysBetween(from: string, to: string): number { return (calendarDate(to) - calendarDate(from)) / DAY; }

export function firstSeasonSaturday(year: number): string {
  if (!Number.isInteger(year) || year < 1900 || year > 9998) throw new Error('Choose a supported season year.');
  const date = `${year}-09-01`;
  return addCalendarDays(date, (6 - new Date(calendarDate(date)).getUTCDay() + 7) % 7);
}

export function roundRobinRoundCount(clubs: number): number {
  if (!Number.isInteger(clubs) || clubs < 2 || clubs > 40) throw new Error('A competition needs 2–40 clubs.');
  return (clubs % 2 === 0 ? clubs - 1 : clubs) * 2;
}

/** Circle schedule with a real bye for an odd field. No dummy club, score or fixture is created. */
export function roundRobinGames(input: { competitionId: string; clubIds: readonly string[]; dates: readonly string[]; stage?: CompetitionStage; groupId?: string | null; season: number }): CompetitionGame[] {
  const { competitionId, clubIds, dates, season } = input;
  const rounds = roundRobinRoundCount(clubIds.length);
  if (!ID.test(competitionId) || !Number.isInteger(season) || season < 1 || new Set(clubIds).size !== clubIds.length || clubIds.some(id => !ID.test(id))) throw new Error('Competition and club identities must be valid and unique.');
  if (dates.length !== rounds) throw new Error('Supply exactly one date for every competition round.');
  dates.forEach((date, index) => { calendarDate(date); if (index && calendarDaysBetween(dates[index - 1]!, date) < 2) throw new Error('A club needs at least one full rest day between rounds.'); });
  const group = input.groupId ?? null;
  if (group !== null && !ID.test(group)) throw new Error('Use a valid group identity.');
  let ring: (string | null)[] = [...clubIds];
  if (ring.length % 2) ring.push(null);
  const leg = ring.length - 1, games: CompetitionGame[] = [];
  for (let round = 0; round < leg; round++) {
    for (let pair = 0; pair < ring.length / 2; pair++) {
      const left = ring[pair], right = ring[ring.length - 1 - pair];
      if (left === null || right === null) continue;
      const reverse = (round + 1 + pair) % 2 === 0;
      const homeClubId = reverse ? right! : left!, awayClubId = reverse ? left! : right!;
      const identity = `${competitionId}-s${season}-${input.stage ?? 'regular'}${group ? `-${group}` : ''}`;
      for (const second of [false, true]) {
        const at = round + (second ? leg : 0);
        games.push({ id: `${identity}-r${at + 1}-g${pair + 1}`, competitionId, stage: input.stage ?? 'regular', stageRound: at + 1, groupId: group, seriesId: null, date: dates[at]!, homeClubId: second ? awayClubId : homeClubId, awayClubId: second ? homeClubId : awayClubId, neutral: false });
      }
    }
    ring = [ring[0]!, ring.at(-1)!, ...ring.slice(1, -1)];
  }
  return games.sort((a, b) => a.stageRound - b.stageRound || a.id.localeCompare(b.id));
}

/** Shorter leagues rest on evenly distributed Saturdays; all finish on the final available Saturday. */
export function domesticRoundDates(start: string, rounds: number, weeks = 38, pausedWeeks: readonly number[] = []): string[] {
  calendarDate(start);
  if (new Date(calendarDate(start)).getUTCDay() !== 6 || !Number.isInteger(rounds) || rounds < 2 || !Number.isInteger(weeks) || weeks < rounds || weeks > 44 || new Set(pausedWeeks).size !== pausedWeeks.length || pausedWeeks.some(week => !Number.isInteger(week) || week < 1 || week > weeks) || pausedWeeks.includes(weeks)) throw new Error('Use a supported Saturday calendar with a shared final round.');
  const available = Array.from({ length: weeks }, (_, i) => i + 1).filter(week => !pausedWeeks.includes(week));
  if (rounds > available.length) throw new Error('The season has too few available Saturdays for this league.');
  return Array.from({ length: rounds }, (_, i) => addCalendarDays(start, (available[Math.round(i * (available.length - 1) / (rounds - 1))]! - 1) * 7));
}

/** A single calendar, with explicit weekly boundaries even when no club plays on that day. */
export function buildCompetitionCalendar(input: { start: string; end: string; nextSeasonStart: string; games: readonly CompetitionGame[]; minimumOffseasonDays?: number }): CalendarDay[] {
  const { start, end, nextSeasonStart, games } = input;
  const length = calendarDaysBetween(start, end), offseason = input.minimumOffseasonDays ?? 42;
  if (new Date(calendarDate(start)).getUTCDay() !== 6 || !Number.isInteger(offseason) || offseason < 0 || length < 0 || length > 330 || calendarDaysBetween(end, nextSeasonStart) < offseason) throw new Error('The calendar must finish before the next season and leave its offseason intact.');
  const ids = new Set<string>(), appearances = new Map<string, string[]>(), byDate = new Map<string, CompetitionGame[]>();
  for (const game of games) {
    calendarDate(game.date);
    if (!game.id || ids.has(game.id) || !ID.test(game.competitionId) || !ID.test(game.homeClubId) || !ID.test(game.awayClubId) || game.homeClubId === game.awayClubId || game.date < start || game.date > end || !Number.isInteger(game.stageRound) || game.stageRound < 1) throw new Error('The calendar contains an invalid, repeated or out-of-season fixture.');
    ids.add(game.id);
    for (const club of [game.homeClubId, game.awayClubId]) appearances.set(club, [...(appearances.get(club) ?? []), game.date]);
    byDate.set(game.date, [...(byDate.get(game.date) ?? []), game]);
  }
  for (const dates of appearances.values()) {
    dates.sort();
    if (dates.some((date, index) => index > 0 && calendarDaysBetween(dates[index - 1]!, date) < 2)) throw new Error('A club has overlapping games or less than one full rest day.');
  }
  const days: CalendarDay[] = [];
  for (let offset = 0; offset <= length; offset++) {
    const date = addCalendarDays(start, offset), fixtures = byDate.get(date) ?? [];
    const closesWeek = offset % 7 === 6 || offset === length;
    if (fixtures.length || closesWeek) days.push({ date, week: Math.floor(offset / 7) + 1, fixtureIds: fixtures.map(game => game.id).sort(), closesWeek });
  }
  return days;
}

/** The manager may have no game today. Continue still processes this calendar day and its weekly boundary. */
export function managerGameOnDay(day: CalendarDay, games: readonly CompetitionGame[], clubId: string): CompetitionGame | null {
  const ids = new Set(day.fixtureIds), matches = games.filter(game => ids.has(game.id) && (game.homeClubId === clubId || game.awayClubId === clubId));
  if (matches.length > 1) throw new Error('A club cannot have two games on one calendar day.');
  return matches[0] ?? null;
}
