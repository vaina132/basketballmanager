import { DEVELOPMENT_START_DATE } from '../data/development-league';
import { addCalendarDays, calendarDaysBetween, firstSeasonSaturday } from './competition-calendar';

/**
 * Format 80: the FIBA windows in the one calendar (owner feedback item 13, 22 November 2026). Real 2026-27 windows: 23
 * November - 1 December 2026 (games 26-30 November) and 22 February - 2 March 2027. The game puts each window on the
 * week of the last Saturday of November and of February: national games on the Thursday before and on that Saturday;
 * called-up players are away from the Wednesday to the Saturday.
 */
export const NATIONAL_RULES = Object.freeze({
  /** National games per window. */
  windowGames: 2,
  /** Days before the window Saturday that called-up players leave their clubs (Wednesday). */
  awayFrom: 3,
  /** Days before the window Saturday of the first game (Thursday). */
  firstGame: 2,
  squadSize: 12,
  /** Condition a national game costs: a base plus a share of the minutes played. */
  gameCostBase: 4,
  gameCostPerMinute: 0.45,
  /** Federation confidence: start, replacement below, manager dismissal below, renewal from. */
  startingConfidence: 60,
  replaceBelow: 30,
  dismissBelow: 25,
  renewFrom: 50,
  /** Reputation a federation looks for, by team level; the manager's own country asks this much less. */
  requirement: { 1: 70, 2: 55, 3: 42 } as Readonly<Record<1 | 2 | 3, number>>,
  ownCountryBonus: 10,
  /** Salary a season in euro cents, by team level (shown only). */
  salary: { 1: 40_000_000, 2: 25_000_000, 3: 15_000_000 } as Readonly<Record<1 | 2 | 3, number>>,
  offerDays: 14,
  contractSeasons: 2,
});

const seasonYear = (seasonNumber: number) => Number(DEVELOPMENT_START_DATE.slice(0, 4)) + seasonNumber - 1;

function lastSaturday(year: number, monthIndex: number): string {
  const last = new Date(Date.UTC(year, monthIndex + 1, 0));
  last.setUTCDate(last.getUTCDate() - (last.getUTCDay() + 1) % 7);
  return last.toISOString().slice(0, 10);
}

/** The Saturday of a season's November (1) or February (2) window. */
export function nationalWindowSaturday(seasonNumber: number, window: 1 | 2): string {
  const year = seasonYear(seasonNumber);
  return window === 1 ? lastSaturday(year, 10) : lastSaturday(year + 1, 1);
}

/** The two game days of a window: the Thursday before its Saturday and the Saturday. */
export function nationalWindowDays(seasonNumber: number, window: 1 | 2): [string, string] {
  const saturday = nationalWindowSaturday(seasonNumber, window);
  return [addCalendarDays(saturday, -NATIONAL_RULES.firstGame), saturday];
}

/** The days a called-up player is away from his club: Wednesday to the window Saturday. */
export function nationalAwayDays(seasonNumber: number, window: 1 | 2): string[] {
  const saturday = nationalWindowSaturday(seasonNumber, window);
  return Array.from({ length: NATIONAL_RULES.awayFrom + 1 }, (_, index) => addCalendarDays(saturday, index - NATIONAL_RULES.awayFrom));
}

/** The weeks (1 = the season's first Saturday) whose Saturday is a window Saturday. */
export function nationalWindowWeeks(seasonNumber: number): number[] {
  const start = firstSeasonSaturday(seasonYear(seasonNumber));
  return ([1, 2] as const).map(window => calendarDaysBetween(start, nationalWindowSaturday(seasonNumber, window)) / 7 + 1);
}

/**
 * The domestic weeks a league pauses for the windows: every window week when the league's calendar has room for it,
 * none otherwise (a league with no room plays on, and its players are not called up).
 */
export function nationalPausedWeeks(seasonNumber: number, rounds: number, weeks: number): number[] {
  const paused = nationalWindowWeeks(seasonNumber).filter(week => week >= 1 && week <= weeks);
  return weeks - rounds >= paused.length ? paused : [];
}

/** The summer tournament's name: a simple repeating cycle from the real 2027 World Cup (the game's own simplification). */
export function nationalTournamentName(seasonNumber: number): string {
  const year = seasonYear(seasonNumber) + 1;
  if (year === 2027) return 'World Cup 2027 (Qatar)';
  return year % 2 === 0 ? `Olympic Games ${year}` : year % 4 === 3 ? `World Cup ${year}` : `EuroBasket ${year}`;
}

/** The real 2027 World Cup ran 27 August - 12 September; later tournaments take the same dates in their year. */
export function nationalTournamentDays(seasonNumber: number): string[] {
  const year = seasonYear(seasonNumber) + 1;
  const start = `${year}-08-27`;
  // Three group days, semi-finals, then the final and the game for third place.
  return [0, 2, 4, 10, 16].map(offset => addCalendarDays(start, offset));
}
