import type { SeasonBackground } from '../domain/background';
import type { CompetitionGame } from '../domain/competition';
import type { ArchivedFixture, ClubPlan, SeasonFixture, SeasonInjury, Standing } from '../domain/season';
import type { Team } from '../domain/types';
import type { CareerWorld, EuropeanCompetition, WorldContext } from '../domain/world';
import { DEVELOPMENT_START_DATE } from '../data/development-league';
import { selectBackgroundMatchday, backgroundClubsIn } from './background';
import { worldOf } from './career-world';
import { addCalendarDays, calendarDaysBetween, firstSeasonSaturday, roundRobinGames, roundRobinRoundCount } from './competition-calendar';
import { competitionTable } from './competition-table';
import { EUROPEAN_FORMATS, knockoutOf, playedEuropeanCompetitions, type EuropeanFormat } from './european-formats';
import { isRecovering } from './health';
import { applyAgingAttributes, isPlayerRetired, type LifecycleContext } from './lifecycle-policy';
import { derivePostseason, postseasonOutcome } from './postseason';
import type { SeasonPhysio } from '../domain/physio';

/**
 * European competitions on the shared calendar (steps 3.5b-c). Like the domestic postseasons, nothing is stored but the
 * games themselves: the draw, the calendar, the tables and the knockout games that exist so far are derived from the
 * career's seed and the results already played, so the save checks derive the same games again.
 *
 * Clubs outside the full world that play a European game (entrants from leagues that were not chosen, and clubs that
 * left the full world) are background sides: their squad for a season is their real squad aged to the season's start
 * (players who retired are gone), with a legal matchday selection of the best available players, the default tactics,
 * condition carried from their earlier European games of the season and injuries like every other player. They have no
 * plans, finances, training or staff.
 */
export type EuropeContext = WorldContext & LifecycleContext & { seed?: number; background?: SeasonBackground };

/** The same daily recovery as every player of the full world (`DAILY_RECOVERY` in season.ts). */
export const BACKGROUND_DAILY_RECOVERY = 3;
const DEFAULT_TACTICS = Object.freeze({ tempo: .5, outsideShare: .45, pressure: .5 });

const seasonStart = (seasonNumber: number) => firstSeasonSaturday(Number(DEVELOPMENT_START_DATE.slice(0, 4)) + seasonNumber - 1);
/** The career week of a date in a season (week 1 starts on the season's first Saturday). */
const weekOf = (date: string, start: string) => Math.floor(calendarDaysBetween(start, date) / 7) + 1;

/** An independent stream for draws (never match randomness): FNV-1a with a final avalanche, so close keys spread. */
function drawHash(seed: number, key: string): number {
  let hash = (2166136261 ^ seed) >>> 0;
  for (let index = 0; index < key.length; index += 1) hash = Math.imul(hash ^ key.charCodeAt(index), 16777619) >>> 0;
  hash ^= hash >>> 16; hash = Math.imul(hash, 0x85ebca6b) >>> 0; hash ^= hash >>> 13; hash = Math.imul(hash, 0xc2b2ae35) >>> 0; hash ^= hash >>> 16;
  return hash >>> 0;
}

/** The season's draw: the entrants in a seeded order that decides the regular-season pairings and venues. */
export function europeanDrawOrder(seed: number, seasonNumber: number, competitionId: string, clubIds: readonly string[]): string[] {
  return clubIds.map(id => ({ id, key: drawHash(seed, `draw:${competitionId}:s${seasonNumber}:${id}`) })).sort((a, b) => a.key - b.key || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map(entry => entry.id);
}

/** The regular season's round dates on `day`: one round a week, or two in evenly spread weeks when rounds outnumber weeks. */
export function europeanRoundDates(format: EuropeanFormat, seasonNumber: number, rounds: number, day = format.regular.day): string[] {
  const start = seasonStart(seasonNumber), { firstWeek, lastWeek, doubleDays } = format.regular, weeks = lastWeek - firstWeek + 1;
  const date = (week: number, offset: number) => addCalendarDays(start, (week - 1) * 7 + offset);
  if (rounds <= weeks) return Array.from({ length: rounds }, (_, index) => date(firstWeek + (rounds === 1 ? 0 : Math.round(index * (weeks - 1) / (rounds - 1))), day));
  const doubles = rounds - weeks;
  if (!doubleDays || doubles > weeks) throw new Error(`The ${format.label} calendar has too few weeks for ${rounds} rounds.`);
  return Array.from({ length: weeks }, (_, index) => index).flatMap(index => Math.floor((index + 1) * doubles / weeks) > Math.floor(index * doubles / weeks) ? doubleDays.map(offset => date(firstWeek + index, offset)) : [date(firstWeek + index, day)]);
}

/** A competition's entrants in a season (the opening season's entrants until step 3.5f decides later places). */
export function europeanEntrants(competition: EuropeanCompetition): readonly string[] {
  return competition.clubIds;
}

/** A regular-season group: its id (null for a single table), its clubs in draw order and its day. */
export interface EuropeanGroup { id: string | null; clubIds: string[]; day: number }

/** The season's regular-season groups: the drawn entrants dealt into the format's groups in turn (one table without groups). */
export function europeanGroups(seed: number, seasonNumber: number, competition: EuropeanCompetition): EuropeanGroup[] {
  const format = EUROPEAN_FORMATS[competition.format!], order = europeanDrawOrder(seed, seasonNumber, competition.id, europeanEntrants(competition));
  const groups = format.regular.groups;
  if (!groups) return [{ id: null, clubIds: order, day: format.regular.day }];
  return groups.map((group, index) => ({ id: group.id, clubIds: order.filter((_, position) => position % groups.length === index), day: group.day }));
}

const requireSeed = (context: { seed?: number }): number => {
  if (context.seed === undefined) throw new Error('The European draw needs the career seed.');
  return context.seed;
};

/** The regular-season games of every played competition, unplayed, group by group in draw order. */
export function europeanRegularFixtures(context: EuropeContext, seasonNumber: number): SeasonFixture[] {
  const world = worldOf(context), competitions = playedEuropeanCompetitions(world);
  if (!competitions.length) return [];
  const seed = requireSeed(context), start = seasonStart(seasonNumber);
  return competitions.flatMap(competition => {
    const format = EUROPEAN_FORMATS[competition.format!];
    return europeanGroups(seed, seasonNumber, competition).flatMap(group => roundRobinGames({ competitionId: competition.id, clubIds: group.clubIds, dates: europeanRoundDates(format, seasonNumber, roundRobinRoundCount(group.clubIds.length), group.day), season: seasonNumber, groupId: group.id })
      .map(game => ({ id: game.id, round: weekOf(game.date, start), date: game.date, homeClubId: game.homeClubId, awayClubId: game.awayClubId, result: null, competition: competition.id })));
  });
}

type GameRecord = SeasonFixture | ArchivedFixture;
const asGame = (fixture: GameRecord, competitionId: string, groupId: string | null): CompetitionGame => ({ id: fixture.id, competitionId, stage: 'regular', stageRound: fixture.round, groupId, seriesId: null, date: fixture.date, homeClubId: fixture.homeClubId, awayClubId: fixture.awayClubId, neutral: false });

/** Each regular-season group's table so far, by the format's ranking. */
export function europeanTables(context: { seed?: number }, competition: EuropeanCompetition, fixtures: readonly GameRecord[], seasonNumber: number): (EuropeanGroup & { rows: Standing[] })[] {
  const format = EUROPEAN_FORMATS[competition.format!], games = fixtures.filter(fixture => fixture.competition === competition.id && !fixture.stage);
  const groups = format.regular.groups ? europeanGroups(requireSeed(context), seasonNumber, competition) : [{ id: null, clubIds: [...europeanEntrants(competition)], day: format.regular.day }];
  return groups.map(group => {
    const own = games.filter(fixture => group.clubIds.includes(fixture.homeClubId));
    return { ...group, rows: competitionTable({
      competitionId: competition.id, clubIds: group.clubIds, rule: format.standingsRule, groupId: group.id, games: own.map(fixture => asGame(fixture, competition.id, group.id)),
      results: own.flatMap(fixture => fixture.result ? [{ fixtureId: fixture.id, home: fixture.result.officialScore.home, away: fixture.result.officialScore.away, winnerClubId: fixture.result.winnerClubId }] : []),
    }).map(row => ({ ...row, difference: row.pointsFor - row.pointsAgainst })) };
  });
}

/** A competition's single regular-season table (formats without groups). */
export function europeanTable(competition: EuropeanCompetition, fixtures: readonly GameRecord[]): Standing[] {
  return europeanTables({}, competition, fixtures, 1)[0]!.rows;
}

/** A knockout slot's week and date. */
export function europeanSlotDay(format: EuropeanFormat, seasonNumber: number, slot: number): { round: number; date: string } {
  const entry = format.slots[slot - 1];
  if (!entry) throw new Error(`The ${format.label} has no reserved day for knockout slot ${slot}.`);
  return { round: entry.week, date: addCalendarDays(seasonStart(seasonNumber), (entry.week - 1) * 7 + entry.day) };
}

/**
 * Each played competition as far as results decide it: its group tables, its knockout series, the games that should
 * exist and its champion. Across groups, home advantage goes to the better group place, then more wins, a better point
 * difference and more points scored.
 */
export function getEuropeanCompetitions(context: WorldContext & { fixtures: readonly GameRecord[]; seed?: number }, seasonNumber: number) {
  return playedEuropeanCompetitions(worldOf(context)).map(competition => {
    const format = EUROPEAN_FORMATS[competition.format!], entrants = europeanEntrants(competition);
    const tables = europeanTables(context, competition, context.fixtures, seasonNumber);
    const regular = context.fixtures.filter(fixture => fixture.competition === competition.id && !fixture.stage);
    const expected = tables.reduce((sum, group) => sum + group.clubIds.length * (group.clubIds.length - 1), 0);
    const order = regular.length === expected && regular.every(fixture => fixture.result) ? tables.flatMap(group => group.rows.map(row => row.clubId)) : null;
    const seeds = new Map(tables.flatMap(group => group.rows).sort((a, b) => a.position - b.position || b.wins - a.wins || b.difference - a.difference || b.pointsFor - a.pointsFor || (a.clubId < b.clubId ? -1 : a.clubId > b.clubId ? 1 : 0)).map((row, index) => [row.clubId, index + 1]));
    const knockout = knockoutOf(format, entrants.length);
    const derived = derivePostseason({ leagueId: competition.id, format: knockout, seasonNumber, order, slotDay: slot => europeanSlotDay(format, seasonNumber, slot), fixtures: context.fixtures, ...(format.regular.groups ? { rankOf: (clubId: string) => seeds.get(clubId)! } : {}) });
    return { competition, format, tables, table: tables.flatMap(group => group.rows), order, series: derived.series, fixtures: derived.fixtures.map(fixture => ({ ...fixture, competition: competition.id })), outcome: postseasonOutcome(knockout, order, derived.series) };
  });
}

/** Whether a club plays this season outside the full world (a background side in its European games). */
export const isBackgroundSide = (clubs: readonly Team[], clubId: string) => !clubs.some(club => club.id === clubId);

/** The result's roster reference for a background side: its squad for the season. */
export const backgroundRosterId = (clubId: string, seasonNumber: number) => `background-${clubId}-s${seasonNumber}`;

/**
 * A background side's squad for a season: a club outside the full world after leaving it keeps its departure record
 * (players who have retired by then are gone); any other club of the world plays with its real squad. Squads stay the
 * same through a season and age at each season's start, like every other player.
 */
export function backgroundSide(context: EuropeContext, clubId: string, seasonNumber: number): Team {
  const world = worldOf(context), identity = world.clubs.find(club => club.id === clubId);
  if (!identity) throw new Error('A European game refers to a club outside this world.');
  const record = backgroundClubsIn(context.background, seasonNumber).find(club => club.id === clubId);
  const players = record ? record.players.filter(player => !isPlayerRetired(context, player.id, seasonNumber, 1)) : identity.players;
  const date = seasonStart(seasonNumber);
  return { id: identity.id, name: identity.name, shortName: identity.shortName, color: identity.color, players: players.map(player => ({ ...player, attributes: applyAgingAttributes(context, player.id, player.attributes, date) })) };
}

/** A background side's matchday selection for a game: the best available players, starters first. */
export function backgroundMatchdayTeam(context: EuropeContext & { injuries: readonly SeasonInjury[]; physio?: SeasonPhysio }, clubId: string, fixture: Pick<SeasonFixture, 'date'>, seasonNumber: number): Team {
  const squad = backgroundSide(context, clubId, seasonNumber), ids = new Set(squad.players.map(player => player.id));
  const unavailable = new Set(context.injuries.filter(injury => ids.has(injury.playerId) && isRecovering(injury, fixture.date, context.physio)).map(injury => injury.playerId));
  return selectBackgroundMatchday(squad, unavailable);
}

/** A background side's plan for a game: the default tactics, its first five as starters, automatic substitutions. */
export function backgroundPlan(team: Team): ClubPlan {
  return { tactics: { ...DEFAULT_TACTICS }, lineup: team.players.slice(0, 5).map(player => player.id), autoSubstitutions: true };
}

/** Each player's condition before a game: after his latest earlier game of the season and the days of rest since (fresh before his first). */
export function backgroundConditions(fixtures: readonly GameRecord[], team: Team, date: string): Record<string, number> {
  const played = fixtures.filter(fixture => fixture.result && fixture.date < date && (fixture.homeClubId === team.id || fixture.awayClubId === team.id)).sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
  return Object.fromEntries(team.players.map(player => {
    const last = played.find(fixture => fixture.result!.stats?.[player.id]);
    const condition = last ? Math.min(100, Math.round((last.result!.stats![player.id]!.condition + BACKGROUND_DAILY_RECOVERY * calendarDaysBetween(last.date, date)) * 1000) / 1000) : 100;
    return [player.id, condition];
  }));
}

/** The world plays European games (format 57). */
export const playsEurope = (world: CareerWorld) => playedEuropeanCompetitions(world).length > 0;
