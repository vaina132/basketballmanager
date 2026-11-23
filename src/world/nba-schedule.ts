import type { CareerWorld, NbaWorld } from '../domain/world';
import { DEVELOPMENT_START_DATE } from '../data/development-league';
import { addCalendarDays, calendarDate, calendarDaysBetween } from './competition-calendar';

/**
 * The NBA's regular season (NBA step 5, format 90): 82 games a club, 41 at home.
 * - The four division rivals four times (16 games), six conference clubs of the other two divisions four times (24)
 *   and the other four three times (12), the 30 games against the other conference twice. The three-game opponents
 *   rotate each season over a five-season cycle, as the NBA's own formula does: between each pair of divisions of a
 *   conference, club i of the first division plays clubs i+r and i+r+1 (mod 5) of the second three times, r turning
 *   with the season. Of the two, the first visits twice and the second hosts twice, so every club has 41 home games.
 * - Dates: from the Tuesday of the third full week (Monday to Sunday) of October to the second Sunday of April, with
 *   no games from the Friday to the Tuesday around the All-Star Sunday (the third Sunday of February).
 * - Days are filled greedily, the clubs most behind their pace first, with a choice among equals by a hash of the seed
 *   and the season (never the match random stream). A club never plays twice a day nor three days running; back-to-back
 *   games are allowed (aiming at about 12-15 a club, at most 16).
 * Worked out once per world and season.
 */
export const NBA_SCHEDULE_RULES = Object.freeze({
  games: 82, homeGames: 41,
  /** Back-to-back games a club plays at most in a season, and the pace aimed at. */
  backToBackCap: 16, backToBackTarget: 12,
  /** Days without games around the All-Star Sunday: from this many days before it to this many after. */
  allStarBreak: Object.freeze([-2, 2] as const),
});

export interface NbaGame { id: string; date: string; homeClubId: string; awayClubId: string }

function hash(text: string): number { let value = 2166136261; for (const character of text) value = Math.imul(value ^ character.charCodeAt(0), 16777619) >>> 0; return value; }
const seasonYear = (seasonNumber: number) => Number(DEVELOPMENT_START_DATE.slice(0, 4)) + seasonNumber - 1;
const weekday = (date: string) => new Date(calendarDate(date)).getUTCDay();
/** The `n`th Sunday (1-based) of a month. */
function nthSunday(year: number, month: number, n: number): string {
  const first = `${year}-${String(month).padStart(2, '0')}-01`;
  return addCalendarDays(first, (7 - weekday(first)) % 7 + (n - 1) * 7);
}

/** The season's key dates: first game day, last regular-season day and the All-Star Sunday. */
export function nbaSeasonDates(seasonNumber: number): { start: string; end: string; allStar: string } {
  const year = seasonYear(seasonNumber);
  // The first Monday of October that starts a full week, then two weeks on, then its Tuesday.
  const october = `${year}-10-01`, firstMonday = addCalendarDays(october, (8 - weekday(october)) % 7);
  return { start: addCalendarDays(firstMonday, 15), end: nthSunday(year + 1, 4, 2), allStar: nthSunday(year + 1, 2, 3) };
}

/** Every game day of the regular season (the All-Star break left out). */
export function nbaGameDays(seasonNumber: number): string[] {
  const { start, end, allStar } = nbaSeasonDates(seasonNumber), [from, to] = NBA_SCHEDULE_RULES.allStarBreak;
  const days: string[] = [];
  for (let offset = 0, length = calendarDaysBetween(start, end); offset <= length; offset += 1) {
    const day = addCalendarDays(start, offset), off = calendarDaysBetween(allStar, day);
    if (off < from || off > to) days.push(day);
  }
  return days;
}

/** Each pairing's games, home side first: [home, away] once per game. */
export function nbaMatchups(nba: NbaWorld, seasonNumber: number): [string, string][] {
  const games: [string, string][] = [];
  const add = (a: string, b: string, homeA: number, homeB: number) => { for (let i = 0; i < homeA; i += 1) games.push([a, b]); for (let i = 0; i < homeB; i += 1) games.push([b, a]); };
  const conferenceClubs = nba.conferences.map(conference => conference.divisions.flatMap(division => division.clubIds));
  // The other conference: twice, once at each end.
  for (const a of conferenceClubs[0]!) for (const b of conferenceClubs[1]!) add(a, b, 1, 1);
  nba.conferences.forEach((conference, c) => {
    // Division rivals: four times, twice at each end.
    for (const division of conference.divisions) division.clubIds.forEach((a, i) => division.clubIds.slice(i + 1).forEach(b => add(a, b, 2, 2)));
    // The other two divisions of the conference: four times, except the rotating pairs met three times.
    [[0, 1], [0, 2], [1, 2]].forEach(([x, y], pairing) => {
      const first = conference.divisions[x!]!.clubIds, second = conference.divisions[y!]!.clubIds;
      const r = (seasonNumber - 1 + pairing + 2 * c) % 5;
      first.forEach((a, i) => second.forEach((b, j) => {
        if (j === (i + r) % 5) add(a, b, 1, 2);
        else if (j === (i + r + 1) % 5) add(a, b, 2, 1);
        else add(a, b, 2, 2);
      }));
    });
  });
  return games;
}

const pairKey = (a: string, b: string) => a < b ? `${a}|${b}` : `${b}|${a}`;

/** One attempt at the greedy day fill; null when games are left over at the end. */
function fillDays(matchups: readonly [string, string][], days: readonly string[], clubs: readonly string[], salt: string): { date: string; home: string; away: string }[] | null {
  const rules = NBA_SCHEDULE_RULES;
  const left = new Map<string, number>(clubs.map(club => [club, 0]));
  const pending = new Map<string, [string, string][]>();
  for (const [home, away] of matchups) {
    left.set(home, left.get(home)! + 1); left.set(away, left.get(away)! + 1);
    const key = pairKey(home, away), list = pending.get(key) ?? [];
    list.push([home, away]); pending.set(key, list);
  }
  // Each pairing's games in a fixed order: alternate the host where possible.
  for (const [key, list] of pending) {
    const turn = hash(`${salt}|order|${key}`) % 2;
    const a = list.filter(([home]) => home === list[0]![0]), b = list.filter(([home]) => home !== list[0]![0]);
    const ordered: [string, string][] = [];
    for (let i = 0; ordered.length < list.length; i += 1) { const first = (i + turn) % 2 ? b : a, second = first === a ? b : a; if (first.length) ordered.push(first.shift()!); else ordered.push(second.shift()!); }
    pending.set(key, ordered);
  }
  const last = new Map<string, number>(), before = new Map<string, number>(), backToBack = new Map<string, number>(clubs.map(club => [club, 0]));
  const lastMet = new Map<string, number>(), keyHash = new Map([...pending.keys()].map(key => [key, hash(`${salt}|${key}`)]));
  const mix = (value: number, day: number) => (Math.imul(value ^ Math.imul(day + 1, 2654435761), 2246822519) >>> 0) % 1000;
  const placed: { date: string; home: string; away: string }[] = [];
  let remaining = matchups.length;
  const at = days.map(date => calendarDaysBetween(days[0]!, date));
  for (let day = 0; day < days.length; day += 1) {
    const daysLeft = days.length - day;
    // Calendar days since a club's last game (the All-Star break counts as days off).
    const gap = (club: string) => last.has(club) ? at[day]! - at[last.get(club)!]! : Infinity;
    const rested = (club: string) => left.get(club)! > 0 && (gap(club) >= 2 || gap(club) === 1 && backToBack.get(club)! < rules.backToBackCap && !(before.has(club) && at[day]! - at[before.get(club)!]! === 2));
    const need = (club: string) => left.get(club)! * 2 / daysLeft;
    const target = Math.floor(remaining / daysLeft * (0.55 + 0.9 * (hash(`${salt}|count|${day}`) % 1000) / 1000) + 0.5);
    const candidates: { key: string; a: string; b: string; score: number }[] = [];
    for (const [key, list] of pending) {
      if (!list.length) continue;
      const [a, b] = list[0]!;
      if (!rested(a) || !rested(b)) continue;
      const pace = (club: string) => backToBack.get(club)! >= rules.backToBackTarget * (day + 1) / days.length + 1;
      const tired = (club: string) => gap(club) === 1 ? pace(club) ? 1.5 : -0.2 : 0;
      const recent = lastMet.has(key) && day - lastMet.get(key)! < 4 ? 0.6 : 0;
      const scarce = list.length / Math.max(1, Math.min(left.get(a)!, left.get(b)!));
      candidates.push({ key, a, b, score: need(a) + need(b) + 0.4 * scarce - tired(a) - tired(b) - recent + mix(keyHash.get(key)!, day) / 4000 });
    }
    candidates.sort((x, y) => y.score - x.score || (x.key < y.key ? -1 : 1));
    const busy = new Set<string>();
    let count = 0;
    for (const candidate of candidates) {
      if (busy.has(candidate.a) || busy.has(candidate.b)) continue;
      // Beyond the day's share, only clubs that cannot wait any longer play.
      if (count >= target && Math.max(need(candidate.a), need(candidate.b)) < 1) continue;
      busy.add(candidate.a); busy.add(candidate.b); count += 1;
      const [home, away] = pending.get(candidate.key)!.shift()!;
      placed.push({ date: days[day]!, home, away });
      lastMet.set(candidate.key, day);
      for (const club of [home, away]) {
        if (gap(club) === 1) backToBack.set(club, backToBack.get(club)! + 1);
        if (last.has(club)) before.set(club, last.get(club)!);
        last.set(club, day); left.set(club, left.get(club)! - 1);
      }
      remaining -= 1;
    }
  }
  return remaining === 0 ? placed : null;
}

const scheduleCache = new WeakMap<CareerWorld, Map<number, readonly NbaGame[]>>();
/**
 * The NBA's regular-season games of a season, in date order, with ids `<league>-s<season>-regular-d<day>-g<n>` (day of
 * the season from its first game day, game number that day). Deterministic: the same world and season always give the
 * same games.
 */
export function nbaSchedule(world: CareerWorld, seasonNumber: number): readonly NbaGame[] {
  const nba = world.nba;
  if (!nba) throw new Error('This world has no NBA.');
  let bySeason = scheduleCache.get(world);
  if (!bySeason) { bySeason = new Map(); scheduleCache.set(world, bySeason); }
  const known = bySeason.get(seasonNumber);
  if (known) return known;
  const matchups = nbaMatchups(nba, seasonNumber), days = nbaGameDays(seasonNumber), clubs = nba.conferences.flatMap(conference => conference.divisions.flatMap(division => division.clubIds));
  let placed: ReturnType<typeof fillDays> = null;
  for (let attempt = 0; attempt < 200 && !placed; attempt += 1) placed = fillDays(matchups, days, clubs, `${world.id}|${seasonNumber}|${attempt}`);
  if (!placed) throw new Error('The NBA schedule could not be built.');
  const first = days[0]!, perDay = new Map<string, number>();
  const games = Object.freeze(placed.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.home < b.home ? -1 : 1).map(game => {
    const n = (perDay.get(game.date) ?? 0) + 1;
    perDay.set(game.date, n);
    return Object.freeze({ id: `${nba.leagueId}-s${seasonNumber}-regular-d${calendarDaysBetween(first, game.date) + 1}-g${n}`, date: game.date, homeClubId: game.home, awayClubId: game.away });
  }));
  bySeason.set(seasonNumber, games);
  return games;
}

/** NBA regular-season games a club plays (82). */
export const NBA_REGULAR_GAMES = NBA_SCHEDULE_RULES.games;

/** The career calendar's first Saturday of September of a season (as `seasonStartDate`). */
function careerSeasonStart(seasonNumber: number): string {
  const september = `${seasonYear(seasonNumber)}-09-01`;
  return addCalendarDays(september, (6 - weekday(september) + 7) % 7);
}
/** The career week (1-based, Saturday to Friday from the season's first Saturday) of a date. */
export function nbaWeekOf(seasonNumber: number, date: string): number {
  return Math.floor(calendarDaysBetween(careerSeasonStart(seasonNumber), date) / 7) + 1;
}

/** Postseason game slots: one every second day from the Tuesday after the regular season (play-in, then the playoffs). */
export const NBA_POSTSEASON_SLOT_DAYS = 2;
/** Slots the `nba-2026-1` format uses: two play-in steps and four best-of-seven rounds. */
export const NBA_POSTSEASON_SLOTS = 2 + 4 * 7;
/** The week and date of a 1-based postseason slot. */
export function nbaPostseasonSlotDay(seasonNumber: number, slot: number): { round: number; date: string } {
  const date = addCalendarDays(nbaSeasonDates(seasonNumber).end, 2 + (slot - 1) * NBA_POSTSEASON_SLOT_DAYS);
  return { round: nbaWeekOf(seasonNumber, date), date };
}

// The calendar repeats every 28 years, so these maxima hold for every season; each world's season length is constant.
const CYCLE = Array.from({ length: 28 }, (_, index) => index + 1);
/** The latest week the NBA's regular season can end in (week 32 or 33). */
export const NBA_REGULAR_WEEKS = Math.max(...CYCLE.map(season => nbaWeekOf(season, nbaSeasonDates(season).end)));
/** The latest week the NBA Finals' last possible game can fall in: the NBA's season length. */
export const NBA_SEASON_WEEKS = Math.max(...CYCLE.map(season => nbaPostseasonSlotDay(season, NBA_POSTSEASON_SLOTS).round));
