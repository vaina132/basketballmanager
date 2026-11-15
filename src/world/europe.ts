import type { SeasonBackground } from '../domain/background';
import type { CompetitionGame } from '../domain/competition';
import type { ArchivedFixture, ClubPlan, SeasonEurope, SeasonFixture, SeasonInjury, Standing } from '../domain/season';
import type { Team } from '../domain/types';
import type { CareerWorld, EuropeanCompetition, WorldContext } from '../domain/world';
import { DEVELOPMENT_START_DATE } from '../data/development-league';
import { selectBackgroundMatchday, backgroundClubsIn } from './background';
import { clubCountry, worldOf } from './career-world';
import { addCalendarDays, calendarDaysBetween, firstSeasonSaturday, roundRobinGames, roundRobinRoundCount } from './competition-calendar';
import { competitionTable } from './competition-table';
import { EUROPEAN_FORMATS, knockoutOf, playedEuropeanCompetitions, qualificationSplit, type EuropeanFormat } from './european-formats';
import { overallRating } from './overall-rating';
import { isRecovering } from './health';
import { applyAgingAttributes, isPlayerRetired, type LifecycleContext } from './lifecycle-policy';
import { derivePostseason, postseasonOutcome, type PostseasonFormat, type PostseasonRef, type PostseasonSeriesSpec } from './postseason';
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
export type EuropeContext = WorldContext & LifecycleContext & { seed?: number; background?: SeasonBackground; europe?: SeasonEurope };

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
  if (format.regular.weeks) {
    if (rounds !== format.regular.weeks.length) throw new Error(`The ${format.label} calendar lists ${format.regular.weeks.length} rounds.`);
    return format.regular.weeks.map(week => date(week, day));
  }
  if (rounds <= weeks) return Array.from({ length: rounds }, (_, index) => date(firstWeek + (rounds === 1 ? 0 : Math.round(index * (weeks - 1) / (rounds - 1))), day));
  const doubles = rounds - weeks;
  if (!doubleDays || doubles > weeks) throw new Error(`The ${format.label} calendar has too few weeks for ${rounds} rounds.`);
  return Array.from({ length: weeks }, (_, index) => index).flatMap(index => Math.floor((index + 1) * doubles / weeks) > Math.floor(index * doubles / weeks) ? doubleDays.map(offset => date(firstWeek + index, offset)) : [date(firstWeek + index, day)]);
}

/** A competition's entrants in a season: the season's recorded places (format 60), else the opening entrants. */
export function europeanEntrants(competition: EuropeanCompetition, europe?: SeasonEurope): readonly string[] {
  return europe?.entrants.find(entry => entry.competitionId === competition.id)?.clubIds ?? competition.clubIds;
}

/** A regular-season group: its id (null for a single table), its clubs in draw order and its day. */
export interface EuropeanGroup { id: string | null; clubIds: string[]; day: number }

/** The season's regular-season groups: the drawn entrants dealt into the format's groups in turn (one table without groups). */
export function europeanGroups(seed: number, seasonNumber: number, competition: EuropeanCompetition, europe?: SeasonEurope): EuropeanGroup[] {
  const format = EUROPEAN_FORMATS[competition.format!], order = europeanDrawOrder(seed, seasonNumber, competition.id, europeanEntrants(competition, europe));
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
  // The BCL's games all follow from results (its regular season waits for the qualification winners): `getEuropeanCompetitions`.
  return competitions.filter(competition => !EUROPEAN_FORMATS[competition.format!].staged).flatMap(competition => {
    const format = EUROPEAN_FORMATS[competition.format!];
    return europeanGroups(seed, seasonNumber, competition, context.europe).flatMap(group => roundRobinGames({ competitionId: competition.id, clubIds: group.clubIds, dates: europeanRoundDates(format, seasonNumber, roundRobinRoundCount(group.clubIds.length), group.day), season: seasonNumber, groupId: group.id })
      .map(game => ({ id: game.id, round: weekOf(game.date, start), date: game.date, homeClubId: game.homeClubId, awayClubId: game.awayClubId, result: null, competition: competition.id })));
  });
}

type GameRecord = SeasonFixture | ArchivedFixture;
const asGame = (fixture: GameRecord, competitionId: string, groupId: string | null): CompetitionGame => ({ id: fixture.id, competitionId, stage: 'regular', stageRound: fixture.round, groupId, seriesId: null, date: fixture.date, homeClubId: fixture.homeClubId, awayClubId: fixture.awayClubId, neutral: false });

/** Each regular-season group's table so far, by the format's ranking. */
export function europeanTables(context: { seed?: number; europe?: SeasonEurope }, competition: EuropeanCompetition, fixtures: readonly GameRecord[], seasonNumber: number): (EuropeanGroup & { rows: Standing[] })[] {
  const format = EUROPEAN_FORMATS[competition.format!], games = fixtures.filter(fixture => fixture.competition === competition.id && !fixture.stage);
  const groups = format.regular.groups ? europeanGroups(requireSeed(context), seasonNumber, competition, context.europe) : [{ id: null, clubIds: [...europeanEntrants(competition, context.europe)], day: format.regular.day }];
  return groups.map(group => {
    const own = games.filter(fixture => group.clubIds.includes(fixture.homeClubId));
    return { ...group, rows: competitionTable({
      competitionId: competition.id, clubIds: group.clubIds, rule: format.standingsRule, groupId: group.id, games: own.map(fixture => asGame(fixture, competition.id, group.id)),
      results: own.flatMap(fixture => fixture.result ? [{ fixtureId: fixture.id, home: fixture.result.officialScore.home, away: fixture.result.officialScore.away, winnerClubId: fixture.result.winnerClubId }] : []),
    }).map(row => ({ ...row, difference: row.pointsFor - row.pointsAgainst })) };
  });
}

/** A competition's single regular-season table (formats without groups). */
export function europeanTable(competition: EuropeanCompetition, fixtures: readonly GameRecord[], europe?: SeasonEurope): Standing[] {
  return europeanTables({ ...(europe ? { europe } : {}) }, competition, fixtures, 1)[0]!.rows;
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
export function getEuropeanCompetitions(context: WorldContext & { fixtures: readonly GameRecord[]; seed?: number; europe?: SeasonEurope }, seasonNumber: number) {
  return playedEuropeanCompetitions(worldOf(context)).map(competition => {
    const format = EUROPEAN_FORMATS[competition.format!], entrants = europeanEntrants(competition, context.europe);
    if (format.staged) return deriveStaged(context, competition, seasonNumber);
    const tables = europeanTables(context, competition, context.fixtures, seasonNumber);
    const regular = context.fixtures.filter(fixture => fixture.competition === competition.id && !fixture.stage);
    const expected = tables.reduce((sum, group) => sum + group.clubIds.length * (group.clubIds.length - 1), 0);
    const order = regular.length === expected && regular.every(fixture => fixture.result) ? tables.flatMap(group => group.rows.map(row => row.clubId)) : null;
    const seeds = new Map(tables.flatMap(group => group.rows).sort((a, b) => a.position - b.position || b.wins - a.wins || b.difference - a.difference || b.pointsFor - a.pointsFor || (a.clubId < b.clubId ? -1 : a.clubId > b.clubId ? 1 : 0)).map((row, index) => [row.clubId, index + 1]));
    const knockout = knockoutOf(format, entrants.length);
    const derived = derivePostseason({ leagueId: competition.id, format: knockout, seasonNumber, order, slotDay: slot => europeanSlotDay(format, seasonNumber, slot), fixtures: context.fixtures, ...(format.regular.groups ? { rankOf: (clubId: string) => seeds.get(clubId)! } : {}) });
    return { competition, format, tables, table: tables.flatMap(group => group.rows), order, series: derived.series, fixtures: derived.fixtures.map(fixture => ({ ...fixture, competition: competition.id })) as SeasonFixtureFields[], outcome: postseasonOutcome(knockout, order, derived.series), roundOf16: [] as GroupTable[] };
  });
}

type SeasonFixtureFields = Omit<SeasonFixture, 'result'>;
type GroupTable = EuropeanGroup & { rows: Standing[] };

/** A club's squad strength for seeding: the mean position-weighted rating of its best eight players in the world's squads. */
export function clubStrength(world: CareerWorld, clubId: string): number {
  const club = world.clubs.find(item => item.id === clubId);
  if (!club) throw new Error('A European entrant is not a club of this world.');
  const best = club.players.map(player => overallRating(player.attributes, player.position)).sort((a, b) => b - a).slice(0, 8);
  return best.reduce((sum, value) => sum + value, 0) / best.length;
}
const byStrength = (world: CareerWorld, ids: readonly string[]) => [...ids].sort((a, b) => clubStrength(world, b) - clubStrength(world, a) || (a < b ? -1 : a > b ? 1 : 0));

/** The BCL field: the strongest clubs take the direct places, the next ones the first qualification tournament and the rest the second. */
export function bclField(world: CareerWorld, competition: EuropeanCompetition, europe?: SeasonEurope): { direct: string[]; qualification: readonly [string[], string[]] } {
  const ranked = byStrength(world, europeanEntrants(competition, europe)), [first, second] = qualificationSplit(ranked.length), direct = ranked.length - first - second;
  return { direct: ranked.slice(0, direct), qualification: [ranked.slice(direct, direct + first), ranked.slice(direct + first)] };
}

/** Bracket positions of a single-elimination draw: 1 meets the last seed, and seeds 1 and 2 can only meet in the final. */
function bracketSeeds(size: number): number[] {
  let seeds = [1];
  while (seeds.length < size) { const next = seeds.length * 2 + 1; seeds = seeds.flatMap(seed => [seed, next - seed]); }
  return seeds;
}

/** The two qualification tournaments as one knockout format: single games at one venue, both finals on the last day. */
function qualificationFormat(sizes: readonly [number, number]): PostseasonFormat {
  const steps = ['q-r16', 'q-quarter', 'q-semi', 'q-final'];
  const trees = sizes.map((size, tree) => {
    const offset = tree ? sizes[0] : 0, rounds = Math.log2(size), prefix = `q${tree + 1}`;
    const series: PostseasonSeriesSpec[] = [];
    let previous: string[] = [];
    for (let round = 0; round < rounds; round += 1) {
      const step = steps[steps.length - rounds + round]!, ids: string[] = [];
      const count = size / 2 ** (round + 1);
      for (let index = 0; index < count; index += 1) {
        const id = count === 1 ? `${prefix}-final` : `${prefix}-${step.slice(2)}-${'abcdefgh'[index]}`;
        const seeds = bracketSeeds(size);
        const a: PostseasonRef = round ? { winner: previous[2 * index]! } : { place: offset + seeds[2 * index]! };
        const b: PostseasonRef = round ? { winner: previous[2 * index + 1]! } : { place: offset + seeds[2 * index + 1]! };
        series.push({ id, stage: 'qualifying', step, bestOf: 1, a, b, neutral: true });
        ids.push(id);
      }
      previous = ids;
    }
    return series;
  });
  // Listed step by step, so both tournaments end together.
  const series = steps.flatMap(step => trees.flat().filter(spec => spec.step === step));
  return { id: 'bcl-2026-1', label: 'Basketball Champions League qualification', verified: true, source: EUROPEAN_FORMATS['bcl-2026-1'].source, series, champion: { series: 'q1-final' }, promoted: [], relegated: [] };
}

const PLAY_INS: readonly (readonly [number, number])[] = [[0, 1], [1, 0], [2, 3], [3, 2], [4, 5], [5, 4], [6, 7], [7, 6]];
/** Play-ins A2-B3, B2-A3 ... H2-G3, best of three with the second-placed club at home in games 1 and 3. */
const PLAY_IN_FORMAT: PostseasonFormat = {
  id: 'bcl-2026-1', label: 'Basketball Champions League play-ins', verified: true, source: 'See the BCL format.',
  series: PLAY_INS.map(([second, third], index) => ({ id: `pi-${'abcdefgh'[index]}`, stage: 'play-in', step: 'play-in', bestOf: 3, a: { place: second * 4 + 2, rank: 1 }, b: { place: third * 4 + 3, rank: 2 } })),
  champion: { series: 'pi-a' }, promoted: [], relegated: [],
};

const drawCache = new WeakMap<CareerWorld, Map<string, string[][]>>();
/**
 * The BCL regular-season draw at the season's start: four pots of eight by squad strength (the two qualification
 * places in the last pot), one club of each pot per group, never two clubs of one country in a group. Seeded and
 * deterministic: pots are drawn in turn, each club into the first group (in its own seeded order) that keeps the rules,
 * going back a step whenever a later club would have no group.
 */
export function bclDraw(world: CareerWorld, seed: number, seasonNumber: number, competition: EuropeanCompetition, europe?: SeasonEurope): string[][] {
  const key = `${seed}|${seasonNumber}|${competition.id}|${europeanEntrants(competition, europe).join(',')}`;
  let cache = drawCache.get(world);
  if (!cache) { cache = new Map(); drawCache.set(world, cache); }
  const known = cache.get(key);
  if (known) return known;
  const field = bclField(world, competition, europe), slots = [...field.direct, ...(field.qualification[0].length ? ['#q1', '#q2'] : [])];
  const order = (items: readonly string[], salt: string) => [...items].sort((a, b) => drawHash(seed, `${salt}:${a}`) - drawHash(seed, `${salt}:${b}`) || (a < b ? -1 : 1));
  const pots = [0, 1, 2, 3].map(pot => order(slots.slice(pot * 8, pot * 8 + 8), `bcl-pot:${competition.id}:s${seasonNumber}`));
  const country = (id: string) => id.startsWith('#') ? null : clubCountry(world, id) ?? `unknown-${id}`;
  const groups: string[][] = Array.from({ length: 8 }, () => []);
  const assign = (pot: number, index: number): boolean => {
    if (pot === 4) return true;
    if (index === 8) return assign(pot + 1, 0);
    const club = pots[pot]![index]!;
    for (const group of order(['0', '1', '2', '3', '4', '5', '6', '7'], `bcl-group:${competition.id}:s${seasonNumber}:${club}`).map(Number)) {
      if (groups[group]!.length !== pot || country(club) !== null && groups[group]!.some(other => country(other) === country(club))) continue;
      groups[group]!.push(club);
      if (assign(pot, index + 1)) return true;
      groups[group]!.pop();
    }
    return false;
  };
  if (!assign(0, 0)) throw new Error('The BCL draw cannot keep clubs of one country apart.');
  cache.set(key, groups);
  return groups;
}

const datesOn = (seasonNumber: number, weeks: readonly number[], day: number) => weeks.map(week => addCalendarDays(seasonStart(seasonNumber), (week - 1) * 7 + day));

/**
 * The BCL as far as results decide it (step 3.5e): the qualification tournaments, the drawn groups once their places are
 * known, the play-ins, the Round of 16 groups and the quarter-finals and Final Four. Every game exists once both its
 * clubs are known.
 */
function deriveStaged(context: WorldContext & { fixtures: readonly GameRecord[]; seed?: number; europe?: SeasonEurope }, competition: EuropeanCompetition, seasonNumber: number) {
  const world = worldOf(context), format = EUROPEAN_FORMATS[competition.format!], staged = format.staged!, seed = requireSeed(context), start = seasonStart(seasonNumber);
  const games = context.fixtures.filter(fixture => fixture.competition === competition.id);
  const result = (fixture: GameRecord) => fixture.result ? [{ fixtureId: fixture.id, home: fixture.result.officialScore.home, away: fixture.result.officialScore.away, winnerClubId: fixture.result.winnerClubId }] : [];
  const fixtures: SeasonFixtureFields[] = [];
  const knockout = (spec: PostseasonFormat, order: readonly string[] | null, slotDay: (slot: number) => { round: number; date: string }) => {
    const derived = derivePostseason({ leagueId: competition.id, format: spec, seasonNumber, order, slotDay, fixtures: context.fixtures });
    fixtures.push(...derived.fixtures.map(fixture => ({ ...fixture, competition: competition.id })));
    return derived.series;
  };
  // 1. Qualification (both tournaments end on the last qualification day).
  const field = bclField(world, competition, context.europe), sizes = [field.qualification[0].length, field.qualification[1].length] as const;
  let qualification: ReturnType<typeof knockout> = [];
  if (sizes[0]) {
    const days = staged.qualificationDays.slice(staged.qualificationDays.length - Math.log2(Math.max(...sizes)));
    qualification = knockout(qualificationFormat(sizes), [...field.qualification[0], ...field.qualification[1]], slot => ({ round: days[slot - 1]!.week, date: addCalendarDays(start, (days[slot - 1]!.week - 1) * 7 + days[slot - 1]!.day) }));
  }
  const winners: Record<string, string | null> = { '#q1': qualification.find(series => series.id === 'q1-final')?.winner ?? null, '#q2': qualification.find(series => series.id === 'q2-final')?.winner ?? null };
  // 2. The regular-season groups: games once the group's clubs are all known.
  const groupIds = format.regular.groups!;
  const groups = bclDraw(world, seed, seasonNumber, competition, context.europe).map((members, index) => ({ id: groupIds[index]!.id, day: groupIds[index]!.day, clubIds: members.map(id => id.startsWith('#') ? winners[id] ?? id : id) }));
  const tables: GroupTable[] = groups.map(group => {
    if (group.clubIds.some(id => id.startsWith('#'))) return { ...group, rows: [] };
    const dates = europeanRoundDates(format, seasonNumber, roundRobinRoundCount(group.clubIds.length), group.day);
    fixtures.push(...roundRobinGames({ competitionId: competition.id, clubIds: group.clubIds, dates, season: seasonNumber, groupId: group.id }).map(game => ({ id: game.id, round: weekOf(game.date, start), date: game.date, homeClubId: game.homeClubId, awayClubId: game.awayClubId, competition: competition.id })));
    const own = games.filter(fixture => !fixture.stage && group.clubIds.includes(fixture.homeClubId));
    return { ...group, rows: competitionTable({ competitionId: competition.id, clubIds: group.clubIds, rule: format.standingsRule, groupId: group.id, games: own.map(fixture => asGame(fixture, competition.id, group.id)), results: own.flatMap(result) }).map(row => ({ ...row, difference: row.pointsFor - row.pointsAgainst })) };
  });
  const regular = games.filter(fixture => !fixture.stage);
  const order = tables.every(group => group.rows.length) && regular.length === 8 * 12 && regular.every(fixture => fixture.result) ? tables.flatMap(group => group.rows.map(row => row.clubId)) : null;
  // 3. Play-ins.
  const playIns = knockout(PLAY_IN_FORMAT, order, slot => { const day = staged.playInSlots[slot - 1]!; return { round: day.week, date: addCalendarDays(start, (day.week - 1) * 7 + day.day) }; });
  // 4. The Round of 16 groups.
  const resolve = (ref: PostseasonRef): string | null => 'place' in ref ? order?.[ref.place - 1] ?? null : 'winner' in ref ? playIns.find(series => series.id === ref.winner)?.winner ?? null : null;
  const roundOf16: GroupTable[] = staged.roundOf16.groups.map(group => {
    const members = group.members.map(resolve);
    if (members.some(id => id === null)) return { id: group.id, day: group.day, clubIds: [], rows: [] };
    const clubIds = members as string[], dates = datesOn(seasonNumber, staged.roundOf16.weeks, group.day);
    fixtures.push(...roundRobinGames({ competitionId: competition.id, clubIds, dates, season: seasonNumber, stage: 'round-of-16', groupId: group.id }).map(game => ({ id: game.id, round: weekOf(game.date, start), date: game.date, homeClubId: game.homeClubId, awayClubId: game.awayClubId, stage: 'round-of-16' as const, seriesId: `r16-${group.id}`, game: game.stageRound, competition: competition.id })));
    const own = games.filter(fixture => fixture.stage === 'round-of-16' && fixture.seriesId === `r16-${group.id}`);
    return { id: group.id, day: group.day, clubIds, rows: competitionTable({ competitionId: competition.id, clubIds, rule: format.standingsRule, stage: 'round-of-16', groupId: group.id, games: own.map(fixture => ({ ...asGame(fixture, competition.id, group.id), stage: 'round-of-16' as const })), results: own.flatMap(result) }).map(row => ({ ...row, difference: row.pointsFor - row.pointsAgainst })) };
  });
  const r16Games = games.filter(fixture => fixture.stage === 'round-of-16');
  const r16Order = roundOf16.every(group => group.rows.length) && r16Games.length === 4 * 12 && r16Games.every(fixture => fixture.result) ? roundOf16.flatMap(group => group.rows.map(row => row.clubId)) : null;
  // 5. Quarter-finals and the Final Four.
  const finals = knockout(format.knockout as PostseasonFormat, r16Order, slot => europeanSlotDay(format, seasonNumber, slot));
  return { competition, format, tables, table: tables.flatMap(group => group.rows), order, series: [...qualification, ...playIns, ...finals], fixtures, outcome: postseasonOutcome(format.knockout as PostseasonFormat, r16Order, finals), roundOf16 };
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
