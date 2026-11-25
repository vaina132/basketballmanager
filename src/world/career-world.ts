import { abilityShapeProblem } from './extra-attributes';
import type { RulesetId } from '../engine/rulesets';
import type { ClubFinanceDefinition } from '../data/development-finances';
import type { DevelopmentPresident } from '../data/development-presidents';
import type { Rivalry } from '../domain/rivalries';
import type { Player } from '../domain/types';
import { FULL_ROSTER_MODEL, MAX_CLUB_ROSTER_SIZE } from '../domain/roster';
import type { CareerWorld, WorldContext } from '../domain/world';
import type { ClubExchange, LowerDivision, LowerDivisionMembers } from '../domain/background';
import type { Team } from '../domain/types';
import { STANDINGS_RULE_FORMAT, standingsRuleAllowed } from '../domain/competition';
import { DEVELOPMENT_PLAYERS } from '../data/development-players';
import { DEVELOPMENT_WORLD } from '../data/development-world';
import { roundRobinRoundCount } from './competition-calendar';
import { NBA_REGULAR_GAMES, NBA_REGULAR_WEEKS, NBA_SEASON_WEEKS } from './nba-schedule';
import { POSTSEASON_FORMATS, postseasonFormatAllowed, postseasonWeeks } from './postseason';
import { EUROPEAN_FORMATS, europeanWeeks, fieldFits } from './european-formats';
import type { EconomyBand } from '../domain/world';
import { CLUB_ECONOMY_KEYS, ECONOMY_BANDS, MAX_ECONOMY_AMOUNT, REAL_ECONOMY_RULES } from './economy';
import { isPresidentTraits } from '../data/development-presidents';
import { euroleagueJobsWorld } from './euroleague-jobs';

/**
 * The world a career plays in. Careers in the built-in fictional league carry no world and use DEVELOPMENT_WORLD;
 * every other career carries its world, and its `dataPackId` must name it.
 */
let strictContexts = false;
/**
 * Tests of careers outside the built-in league switch this on, so a context that lost its world (and would
 * otherwise silently fall back to the built-in league) fails loudly instead.
 */
export function requireWorldContexts(on: boolean): void { strictContexts = on; }

export function worldOf(context: WorldContext): CareerWorld {
  if (strictContexts && !context.world && context.dataPackId === undefined) throw new Error('A world-dependent rule was given a context without its career world.');
  if (context.world) {
    if (context.dataPackId !== undefined && context.dataPackId !== context.world.id) throw new Error('This career names a different world than the one it carries.');
    return context.world;
  }
  if (context.dataPackId !== undefined && context.dataPackId !== DEVELOPMENT_WORLD.id) throw new Error('This career\'s world is missing.');
  return DEVELOPMENT_WORLD;
}

/** Legacy single-league bounds. New domestic worlds allow up to 400 clubs (chosen leagues of 4–20, next divisions, unchosen top divisions and European entrants). */
export const MIN_WORLD_CLUBS = 4;
export const MAX_WORLD_CLUBS = 40;
/** The longest possible season: a double round robin of the largest world. */
export const MAX_SEASON_ROUNDS = 2 * (MAX_WORLD_CLUBS - 1);

/** Matchdays in a season of this world: every club meets every other club home and away. */
/** Weeks of the regular season: the longest league's double round robin (shorter leagues pause on spread weekends). */
export function regularWorldRounds(world: CareerWorld): number {
  // NBA step 5: the NBA keeps its own calendar (`src/world/nba-schedule.ts`), so the other leagues' weeks stay exactly
  // as without it; a world of the NBA alone has the NBA's regular-season weeks.
  const leagues = europeanCalendarLeagues(world);
  if (world.nba && !leagues?.length) return NBA_REGULAR_WEEKS;
  // Format 57: worlds that play European competitions keep their domestic regular season going until the last European
  // week, so domestic postseasons never share a midweek day with a European game (step 3.5b).
  if (leagues) return Math.max(europeanWeeks(world), ...leagues.map(league => roundRobinRoundCount(league.clubIds.length)));
  return 2 * (world.clubs.length - 1);
}

/** The domestic leagues on the shared Saturday calendar: every league except the NBA. */
function europeanCalendarLeagues(world: CareerWorld): CareerWorld['domesticLeagues'] {
  return world.nba ? world.domesticLeagues?.filter(league => league.id !== world.nba!.leagueId) : world.domesticLeagues;
}

/** Weeks of the regular season plus the longest league's reserved postseason (step 3.4b; worlds without postseasons keep their regular season). */
export function postseasonWorldWeeks(world: CareerWorld): number {
  return Math.max(0, ...(europeanCalendarLeagues(world) ?? []).map(league => league.postseason ? postseasonWeeks(POSTSEASON_FORMATS[league.postseason]) : 0));
}

/**
 * NBA step 5: the regular-season games a league plays in all: 1,230 in the NBA (82 a club), a double round robin
 * (n x (n - 1)) everywhere else.
 */
export function expectedRegularGames(world: CareerWorld, league: { id: string; clubIds: readonly string[] }): number {
  return world.nba?.leagueId === league.id ? league.clubIds.length * NBA_REGULAR_GAMES / 2 : league.clubIds.length * (league.clubIds.length - 1);
}

// Step 3.7: a world never changes after creation, so its season length is worked out once (it was recomputed, with every
// league's postseason slots, many thousands of times a week in large worlds).
const worldRoundsCache = new WeakMap<CareerWorld, number>();
export function worldRounds(world: CareerWorld): number {
  const known = worldRoundsCache.get(world);
  if (known !== undefined) return known;
  // NBA step 5: a world with the NBA lasts until the later of the other leagues' end and the NBA Finals' last week.
  const european = europeanCalendarLeagues(world)?.length ? regularWorldRounds(world) + postseasonWorldWeeks(world) : 0;
  const rounds = world.nba ? Math.max(european, NBA_SEASON_WEEKS) : world.domesticLeagues ? regularWorldRounds(world) + postseasonWorldWeeks(world) : 2 * (world.clubs.length - 1);
  worldRoundsCache.set(world, rounds);
  return rounds;
}

/** Matchdays in a season of the career's world (10 in the built-in six-club league). */
export function seasonRounds(context: WorldContext): number {
  return worldRounds(worldOf(context));
}

/**
 * A matchday as one increasing number across seasons, `(season - 1) x matchdays + matchday`. The built-in league's
 * ten matchdays give the numbers its saves have always stored.
 */
export function roundOrdinal(seasonNumber: number, round: number, rounds: number): number {
  return (seasonNumber - 1) * rounds + round;
}

/**
 * A sort key for a matchday that needs no season length: `season x 100 + matchday`. Only for comparing calendar
 * positions (it orders like the old `season x 10 + matchday`); never stored and never counted across seasons.
 */
export function roundKey(seasonNumber: number, round: number): number {
  return seasonNumber * 100 + round;
}

/** The season and matchday of an ordinal from `roundOrdinal`. */
export function ordinalRound(ordinal: number, rounds: number): { seasonNumber: number; round: number } {
  return { seasonNumber: Math.floor((ordinal - 1) / rounds) + 1, round: (ordinal - 1) % rounds + 1 };
}

/**
 * The season's last committed week: the latest week with a result, and never less than the week before the current
 * one. Weeks without any game (possible once European competitions stretch the calendar, format 57) count as committed
 * once the calendar has moved past them; in every earlier calendar each week before the current one has results.
 */
export function lastCommittedWeek(state: { round: number; fixtures: readonly { round: number; result: unknown }[] }): number {
  let completed = Math.max(0, state.round - 1);
  for (const fixture of state.fixtures) if (fixture.result && fixture.round > completed) completed = fixture.round;
  return completed;
}

const weekStartViews = new WeakMap<object, object>();
/**
 * Player relationships and press questions decide at week boundaries (owner report, 18 November 2026: the day-by-day
 * Continue stops between a week's game days). During an active week, the games of the week already played count from
 * the week's end: this view hides their results and injuries, as the strict save check rebuilds each player decision
 * at its week's start. Outside a partly played week it is the state itself.
 */
export function weekStartView<T extends { status?: string; round?: number; fixtures: readonly { id: string; round: number; result: unknown }[]; injuries?: readonly { fixtureId: string }[] }>(state: T): T {
  const round = state.round;
  if (state.status !== 'active' || round === undefined || !state.fixtures.some(fixture => fixture.round >= round && fixture.result)) return state;
  let view = weekStartViews.get(state) as T | undefined;
  if (!view) {
    const open = new Set(state.fixtures.filter(fixture => fixture.round >= round && fixture.result).map(fixture => fixture.id));
    view = { ...state, fixtures: state.fixtures.map(fixture => open.has(fixture.id) ? { ...fixture, result: null } : fixture), ...(state.injuries ? { injuries: state.injuries.filter(injury => !open.has(injury.fixtureId)) } : {}) };
    weekStartViews.set(state, view);
  }
  return view;
}

/** Only careers outside the built-in league store their world. */
export function storedWorld(world: CareerWorld): { world?: CareerWorld } {
  return world.id === DEVELOPMENT_WORLD.id ? {} : { world };
}

/** Format 54 next-division lists name clubs of the world itself; format 53 lists named identities outside it. */
export const isMemberList = (entry: LowerDivision): entry is LowerDivisionMembers => Object.hasOwn(entry, 'clubIds');
const lowerMemberSets = new WeakMap<CareerWorld, ReadonlySet<string>>();
/** Clubs of the world that start outside the full world, in a next division (format 54). */
export function lowerDivisionClubIds(world: CareerWorld): ReadonlySet<string> {
  let ids = lowerMemberSets.get(world);
  if (!ids) { ids = new Set((world.lowerDivisions ?? []).filter(isMemberList).flatMap(entry => entry.clubIds)); lowerMemberSets.set(world, ids); }
  return ids;
}
const europeanOnlySets = new WeakMap<CareerWorld, ReadonlySet<string>>();
/** European entrants that are in no domestic league of the world (format 56): background clubs for European games only. */
export function europeanOnlyClubIds(world: CareerWorld): ReadonlySet<string> {
  let ids = europeanOnlySets.get(world);
  if (!ids) {
    const domestic = new Set((world.domesticLeagues ?? []).flatMap(league => league.clubIds));
    ids = new Set((world.europeanCompetitions ?? []).flatMap(competition => competition.clubIds).filter(id => !domestic.has(id)));
    europeanOnlySets.set(world, ids);
  }
  return ids;
}
const backgroundLeagueSets = new WeakMap<CareerWorld, ReadonlySet<string>>();
/** Clubs of the unchosen top divisions (format 60): outside the full world, ranked in estimated tables. */
export function backgroundLeagueClubIds(world: CareerWorld): ReadonlySet<string> {
  let ids = backgroundLeagueSets.get(world);
  if (!ids) { ids = new Set((world.backgroundLeagues ?? []).flatMap(league => league.clubIds)); backgroundLeagueSets.set(world, ids); }
  return ids;
}
/**
 * A club's country: its opening league's or background league's, else as a European competition lists it (null when
 * unknown). Format 85 (`nextDivisionCountries`, new careers): a club of a next division has its division's country too,
 * so a promoted club keeps it (clubs never change country); older careers keep null for those clubs.
 */
export function clubCountry(world: CareerWorld, clubId: string): string | null {
  const league = world.domesticLeagues?.find(item => item.clubIds.includes(clubId)) ?? world.backgroundLeagues?.find(item => item.clubIds.includes(clubId));
  if (league) return league.country;
  if (world.nextDivisionCountries) {
    const division = world.lowerDivisions?.find(list => isMemberList(list) && list.clubIds.includes(clubId));
    if (division) return division.country;
  }
  for (const competition of world.europeanCompetitions ?? []) if (competition.countries && Object.hasOwn(competition.countries, clubId)) return competition.countries[clubId]!;
  return null;
}
const nbaClubSets = new WeakMap<CareerWorld, ReadonlySet<string>>();
/** NBA step 4: the clubs of the world's NBA league (empty without one). NBA clubs never change league. */
export function nbaClubIds(world: CareerWorld): ReadonlySet<string> {
  let ids = nbaClubSets.get(world);
  if (!ids) { ids = new Set(world.nba ? world.domesticLeagues?.find(league => league.id === world.nba!.leagueId)?.clubIds ?? [] : []); nbaClubSets.set(world, ids); }
  return ids;
}
/** NBA step 4: whether a club plays in the world's NBA. */
export const isNbaClub = (world: CareerWorld, clubId: string): boolean => nbaClubIds(world).has(clubId);
/**
 * NBA step 4: whether a club runs an academy, youth team and youth coach. NBA clubs do not (their young players come
 * through the draft and college); every other club does as before.
 */
export const clubHasAcademy = (world: CareerWorld, clubId: string): boolean => !isNbaClub(world, clubId);
/** NBA step 4: what a club's president is called on screen: an NBA club's is its owner. */
export const presidentTitle = (world: CareerWorld, clubId: string): 'President' | 'Owner' => isNbaClub(world, clubId) ? 'Owner' : 'President';
/**
 * NBA step 3: the competition rules a fixture is played under (src/engine/rulesets.ts); undefined means FIBA. Since NBA
 * step 4 the NBA's games (both clubs of the world's NBA league, never a European game) play its ruleset.
 */
export function fixtureRuleset(context: WorldContext, fixture: { homeClubId: string; awayClubId: string; competition?: unknown }): RulesetId | undefined {
  const world = worldOf(context);
  if (!world.nba || fixture.competition) return undefined;
  const nba = nbaClubIds(world);
  return nba.has(fixture.homeClubId) && nba.has(fixture.awayClubId) ? world.nba.ruleset : undefined;
}
/** Format 85 (`neutralVenues`, new careers): a game marked at one venue is played without home advantage or gate. */
export function playsAtNeutralVenue(context: WorldContext, fixture: { neutral?: boolean }): boolean {
  return !!fixture.neutral && !!worldOf(context).neutralVenues;
}
const fullClubLists = new WeakMap<CareerWorld, readonly Team[]>();
/** The clubs a career starts with: every club of the world except next-division and European-only clubs (the same array when there are none). */
export function fullWorldClubs(world: CareerWorld): readonly Team[] {
  let clubs = fullClubLists.get(world);
  if (!clubs) {
    const lower = lowerDivisionClubIds(world), european = europeanOnlyClubIds(world), background = backgroundLeagueClubIds(world);
    clubs = lower.size || european.size || background.size ? world.clubs.filter(club => !lower.has(club.id) && !european.has(club.id) && !background.has(club.id)) : world.clubs;
    fullClubLists.set(world, clubs);
  }
  return clubs;
}

const membershipCache = new WeakMap<CareerWorld, WeakMap<object, Map<number, readonly Team[]>>>();
const NO_EXCHANGES: readonly ClubExchange[] = Object.freeze([]);
/**
 * The full world's clubs in a season (format 55): the opening clubs, changed by every earlier season end's exchanges
 * with a next division, in world order. Without exchanges it is `fullWorldClubs(world)` itself.
 */
export function fullWorldClubsIn(context: WorldContext & { background?: { exchanges?: readonly ClubExchange[] } }, seasonNumber: number): readonly Team[] {
  const world = worldOf(context), exchanges = context.background?.exchanges ?? NO_EXCHANGES;
  if (!exchanges.some(exchange => exchange.seasonNumber < seasonNumber)) return fullWorldClubs(world);
  let byExchanges = membershipCache.get(world);
  if (!byExchanges) { byExchanges = new WeakMap(); membershipCache.set(world, byExchanges); }
  let bySeason = byExchanges.get(exchanges);
  if (!bySeason) { bySeason = new Map(); byExchanges.set(exchanges, bySeason); }
  const known = bySeason.get(seasonNumber);
  if (known) return known;
  const members = new Set(fullWorldClubs(world).map(club => club.id));
  for (const exchange of exchanges) if (exchange.seasonNumber < seasonNumber) {
    for (const id of exchange.leaving) members.delete(id);
    for (const id of exchange.joining) members.add(id);
  }
  const clubs = Object.freeze(world.clubs.filter(club => members.has(club.id)));
  bySeason.set(seasonNumber, clubs);
  return clubs;
}

/** Every club that has been in the full world by `seasonNumber` (opening clubs and clubs that joined), in world order. */
export function clubsEverInFullWorld(context: WorldContext & { background?: { exchanges?: readonly ClubExchange[] } }, seasonNumber: number): readonly Team[] {
  const exchanges = context.background?.exchanges ?? NO_EXCHANGES, world = worldOf(context);
  const joined = new Set(exchanges.filter(exchange => exchange.seasonNumber < seasonNumber).flatMap(exchange => exchange.joining));
  if (!joined.size) return fullWorldClubs(world);
  const opening = new Set(fullWorldClubs(world).map(club => club.id));
  return world.clubs.filter(club => opening.has(club.id) || joined.has(club.id));
}

/** Players of next-division clubs that joined the full world by `seasonNumber` (they stay in the catalog afterwards). */
// Step 3.7: worked out once per world, exchange list and season (lists are replaced, never edited); every player lookup
// asked for it again once clubs had joined from a next division, so later seasons slowed down.
const joinedCache = new WeakMap<CareerWorld, WeakMap<object, Map<number, readonly Player[]>>>();
const NO_PLAYERS: readonly Player[] = Object.freeze([]);
export function joinedPlayers(context: WorldContext & { background?: { exchanges?: readonly ClubExchange[] } }, seasonNumber: number): readonly Player[] {
  const exchanges = context.background?.exchanges ?? NO_EXCHANGES;
  if (!exchanges.length) return NO_PLAYERS;
  const world = worldOf(context);
  let byExchanges = joinedCache.get(world);
  if (!byExchanges) { byExchanges = new WeakMap(); joinedCache.set(world, byExchanges); }
  let bySeason = byExchanges.get(exchanges);
  if (!bySeason) { bySeason = new Map(); byExchanges.set(exchanges, bySeason); }
  const known = bySeason.get(seasonNumber);
  if (known) return known;
  const lower = lowerDivisionClubIds(world);
  const joined = new Set(exchanges.filter(exchange => exchange.seasonNumber < seasonNumber).flatMap(exchange => exchange.joining).filter(id => lower.has(id)));
  const players = joined.size ? Object.freeze(world.clubs.filter(club => joined.has(club.id)).flatMap(club => club.players)) : NO_PLAYERS;
  bySeason.set(seasonNumber, players);
  return players;
}

const playerIdIndexes = new WeakMap<readonly Player[], { length: number; index: ReadonlyMap<string, Player> }>();
/** The first player with this id in a catalog list, as `list.find` gives it; indexed once per list. */
export function playerInList(players: readonly Player[], playerId: string): Player | undefined {
  let known = playerIdIndexes.get(players);
  if (!known || known.length !== players.length) {
    const index = new Map<string, Player>();
    for (const player of players) if (!index.has(player.id)) index.set(player.id, player);
    known = { length: players.length, index };
    playerIdIndexes.set(players, known);
  }
  return known.index.get(playerId);
}

// The built-in league keeps its long-standing catalog array, so existing identity checks and caches still hold.
const playerLists = new WeakMap<CareerWorld, readonly Player[]>([[DEVELOPMENT_WORLD, DEVELOPMENT_PLAYERS]]);
const playerIndexes = new WeakMap<CareerWorld, ReadonlyMap<string, Player>>();

/** Every original player of the full world's clubs, in club order (next-division squads are not part of it). */
export function worldPlayers(world: CareerWorld): readonly Player[] {
  let players = playerLists.get(world);
  if (!players) { players = Object.freeze(fullWorldClubs(world).flatMap(club => club.players)); playerLists.set(world, players); }
  return players;
}

export function worldPlayer(world: CareerWorld, playerId: string): Player | undefined {
  let index = playerIndexes.get(world);
  if (!index) { index = new Map(worldPlayers(world).map(player => [player.id, player])); playerIndexes.set(world, index); }
  return index.get(playerId);
}

export function worldClubIds(world: CareerWorld): string[] {
  return world.clubs.map(club => club.id);
}

export function isWorldClub(world: CareerWorld, clubId: unknown): clubId is string {
  return typeof clubId === 'string' && fullWorldClubs(world).some(club => club.id === clubId);
}

export function clubFinanceDefinition(world: CareerWorld, clubId: string): ClubFinanceDefinition {
  const definition = world.finances.find(item => item.clubId === clubId);
  if (!definition) throw new Error('This club has no venue or sponsorship definition in this world.');
  return definition;
}

export function clubPresident(world: CareerWorld, clubId: string): DevelopmentPresident {
  const president = world.presidents.find(item => item.clubId === clubId);
  if (!president) throw new Error('This club has no president in this world.');
  return president;
}

/** The sponsor shown for each club before negotiations are enabled. */
export function incumbentSponsorId(world: CareerWorld, clubId: string): string {
  const definition = world.finances.find(item => item.clubId === clubId);
  const sponsor = definition && world.sponsors.find(item => item.name === definition.sponsor);
  if (!sponsor) throw new Error('This club has no sponsor in this world.');
  return sponsor.id;
}

export function worldRivalryBetween(world: CareerWorld, firstClubId: string, secondClubId: string): Rivalry | null {
  return world.rivalries.find(rivalry => rivalry.clubIds.includes(firstClubId) && rivalry.clubIds.includes(secondClubId) && firstClubId !== secondClubId) ?? null;
}

export function worldRivalryFor(world: CareerWorld, clubId: string): { rivalry: Rivalry; rivalId: string } | null {
  const rivalry = world.rivalries.find(item => item.clubIds.includes(clubId));
  return rivalry ? { rivalry, rivalId: rivalry.clubIds[0] === clubId ? rivalry.clubIds[1] : rivalry.clubIds[0] } : null;
}

const ATTRIBUTE_KEYS = ['twoPoint', 'threePoint', 'freeThrow', 'passing', 'defense', 'rebounding', 'stamina'] as const;
const WORLD_KEYS = ['id', 'name', 'source', 'startDate', 'clubs', 'playerProfiles', 'wages', 'finances', 'presidents', 'sponsors', 'rivalries'] as const;
const validated = new WeakSet<object>();
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/u;
const COLOUR = /^#[0-9a-f]{6}$/iu;
const isText = (value: unknown, max = 120): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);
const isWhole = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const worldFail = (path: string, reason: string): never => { throw new Error(`Invalid career world: ${path} ${reason}.`); };
const exactKeys = (value: unknown, keys: readonly string[]) => isObject(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

/**
 * Checks that a world is complete and consistent before a career starts in it or a save that carries it loads:
 * unique club and player identities, playable squads, and every club and player covered by the club data.
 * All worlds share the career calendar: season one starts on DEVELOPMENT_WORLD.startDate.
 */
/**
 * A player record's shape: identity, unique shirt number, position, build, appearance and seven abilities from 1 to 20.
 * `ids` and `numbers` collect what has been seen so far (identities across the scope, shirt numbers within the club).
 */
export function checkPlayerShape(value: unknown, path: string, ids: Set<string>, numbers: Set<number>): asserts value is Player {
  const fail = worldFail;
  if (!exactKeys(value, ['id', 'name', 'number', 'position', 'heightCm', 'weightKg', 'skinTone', 'hairColor', 'attributes'])) fail(path, 'must be a player');
  const player = value as Record<string, any>;
  if (!isText(player.id, 80) || !ID.test(player.id) || ids.has(player.id)) fail(`${path}.id`, 'must be a unique supported identifier');
  ids.add(player.id);
  if (!isText(player.name) || !isWhole(player.number, 0, 99) || numbers.has(player.number) || !['PG', 'SG', 'SF', 'PF', 'C'].includes(player.position as string)) fail(path, 'needs a name, a unique shirt number and a position');
  numbers.add(player.number);
  if (!isWhole(player.heightCm, 120, 260) || typeof player.weightKg !== 'number' || !(player.weightKg >= 35 && player.weightKg <= 250) || typeof player.skinTone !== 'string' || !COLOUR.test(player.skinTone) || typeof player.hairColor !== 'string' || !COLOUR.test(player.hairColor)) fail(path, 'needs a supported build and appearance');
  // Careers started with the five further abilities store them on every player (`src/world/extra-attributes.ts`).
  if (abilityShapeProblem(player.attributes, ATTRIBUTE_KEYS)) fail(`${path}.attributes`, 'must hold seven abilities from 1 to 20, and the five further abilities or none');
}

/** Countries without a lower-division list (owner decision, 15 November 2026): no club leaves their full world for now. */
/** NBA step 4: the USA (the NBA) has no division below it. */
export const NO_LOWER_DIVISION_COUNTRIES: readonly string[] = Object.freeze(['Italy', 'France', 'USA']);

/** NBA step 4 (format 90): the NBA league, its two conferences of three divisions of five clubs, and its ruleset. */
function checkNba(world: CareerWorld): void {
  const fail = worldFail, nba = world.nba as unknown as Record<string, any>;
  if (!exactKeys(nba, ['model', 'leagueId', 'conferences', 'ruleset', ...(Object.hasOwn(nba, 'cap') ? ['cap'] : []), ...(Object.hasOwn(nba, 'moves') ? ['moves'] : []), ...(Object.hasOwn(nba, 'draft') ? ['draft'] : []), ...(Object.hasOwn(nba, 'balance') ? ['balance'] : [])]) || nba.model !== 'nba-1' || nba.ruleset !== (Object.hasOwn(nba, 'balance') ? 'nba-2026b' : 'nba-2026') || Object.hasOwn(nba, 'balance') && (nba.balance !== 'nba-balance-1' || nba.draft !== 'nba-draft-1') || Object.hasOwn(nba, 'cap') && nba.cap !== 'nba-cap-1' || Object.hasOwn(nba, 'moves') && (nba.moves !== 'nba-moves-1' || nba.cap !== 'nba-cap-1') || Object.hasOwn(nba, 'draft') && (nba.draft !== 'nba-draft-1' || nba.cap !== 'nba-cap-1')) fail('world.nba', 'must name the NBA model, its league, conferences and ruleset');
  const league = world.domesticLeagues?.find(item => item.id === nba.leagueId);
  if (!league || league.country !== 'USA' || league.tier !== 1 || league.clubIds.length !== 30) fail('world.nba.leagueId', 'must name the world\'s 30-club USA league');
  if (!Array.isArray(nba.conferences) || nba.conferences.length !== 2) fail('world.nba.conferences', 'must list two conferences');
  const ids = new Set<string>(), seen = new Set<string>();
  for (const conference of nba.conferences as Record<string, any>[]) {
    if (!exactKeys(conference, ['id', 'name', 'divisions']) || !isText(conference.id, 80) || !ID.test(conference.id) || ids.has(conference.id) || !isText(conference.name, 80) || !Array.isArray(conference.divisions) || conference.divisions.length !== 3) fail('world.nba.conferences', 'must give each conference an id, a name and three divisions');
    ids.add(conference.id);
    for (const division of conference.divisions as Record<string, any>[]) {
      if (!exactKeys(division, ['id', 'name', 'clubIds']) || !isText(division.id, 80) || !ID.test(division.id) || ids.has(division.id) || !isText(division.name, 80) || !Array.isArray(division.clubIds) || division.clubIds.length !== 5) fail('world.nba.conferences', 'must give each division an id, a name and five clubs');
      ids.add(division.id);
      for (const id of division.clubIds as unknown[]) { if (typeof id !== 'string' || seen.has(id) || !league!.clubIds.includes(id)) fail('world.nba.conferences', 'must divide the league\'s clubs among the divisions'); seen.add(id as string); }
    }
  }
  if (seen.size !== 30) fail('world.nba.conferences', 'must divide the league\'s clubs among the divisions');
  if (world.rosterModel !== FULL_ROSTER_MODEL) fail('world.nba', 'requires clubs with full rosters');
}

/** Format 56: the three European competitions, each once, with distinct entrants of this world; a club enters one competition. */
function checkEuropeanCompetitions(world: CareerWorld, clubIds: ReadonlySet<string>): void {
  const fail = worldFail;
  const lists = world.europeanCompetitions as unknown as Record<string, any>[];
  if (!world.domesticLeagues || !Array.isArray(lists) || lists.length < 1 || lists.length > 3) fail('world.europeanCompetitions', 'must list up to three competitions in a world of domestic leagues');
  const kinds = new Set<string>(), ids = new Set<string>(), entrants = new Set<string>();
  for (const [index, entry] of lists.entries()) {
    const path = `world.europeanCompetitions[${index}]`;
    if (!exactKeys(entry, ['id', 'name', 'kind', 'season', 'clubIds', ...(isObject(entry) && Object.hasOwn(entry, 'format') ? ['format'] : []), ...(isObject(entry) && Object.hasOwn(entry, 'countries') ? ['countries'] : []), ...(isObject(entry) && Object.hasOwn(entry, 'oneYear') ? ['oneYear'] : [])]) || !isText(entry.id, 80) || !ID.test(entry.id) || ids.has(entry.id) || !isText(entry.name) || !['euroleague', 'eurocup', 'bcl'].includes(entry.kind) || kinds.has(entry.kind) || !isText(entry.season, 20) || !Array.isArray(entry.clubIds) || entry.clubIds.length < 2 || entry.clubIds.length > 64) fail(path, 'must name one of the three competitions once, its season and its entrants');
    kinds.add(entry.kind); ids.add(entry.id);
    if (world.domesticLeagues!.some(league => league.id === entry.id)) fail(`${path}.id`, 'must differ from every domestic league\'s id');
    // Format 57: a played competition follows its real format, in a world whose clubs have full rosters.
    if (Object.hasOwn(entry, 'format')) {
      const format = Object.hasOwn(EUROPEAN_FORMATS, entry.format) ? EUROPEAN_FORMATS[entry.format as keyof typeof EUROPEAN_FORMATS] : undefined;
      if (!format || format.kind !== entry.kind) fail(`${path}.format`, 'must be a format of this competition');
      if (!fieldFits(format!, entry.clubIds.length)) fail(`${path}.clubIds`, `must list ${format!.clubs.min} to ${format!.clubs.max} entrants for its format${format!.regular.groups ? `, in ${format!.regular.groups.length} equal groups of at least four` : ''}`);
      if (world.rosterModel !== FULL_ROSTER_MODEL) fail(`${path}.format`, 'requires clubs with full rosters');
    }
    // Format 59: the BCL's draw keeps clubs of one country apart, so its entrants carry their countries.
    const protectedDraw = Object.hasOwn(entry, 'format') && !!EUROPEAN_FORMATS[entry.format as keyof typeof EUROPEAN_FORMATS]?.staged;
    // Format 60: with European places every played competition gives its entrants' countries (the places go by country).
    const needsCountries = protectedDraw || Object.hasOwn(world, 'europeanPlaces') && Object.hasOwn(entry, 'format');
    if (needsCountries !== Object.hasOwn(entry, 'countries')) fail(`${path}.countries`, needsCountries ? 'must give every entrant\'s country for the draw' : 'belong only to the BCL format or a world with European places');
    if (Object.hasOwn(entry, 'oneYear') && (!Object.hasOwn(world, 'europeanPlaces') || entry.kind !== 'euroleague' || !Array.isArray(entry.oneYear) || new Set(entry.oneYear).size !== entry.oneYear.length || (entry.oneYear as unknown[]).some(id => !(entry.clubIds as unknown[]).includes(id)))) fail(`${path}.oneYear`, 'must list EuroLeague entrants on one-year places, in a world with European places');
    if (needsCountries) {
      const countries = entry.countries as Record<string, unknown>;
      if (!exactKeys(countries, entry.clubIds) || (entry.clubIds as string[]).some(id => !isText(countries[id], 60))) fail(`${path}.countries`, 'must give every entrant\'s country for the draw');
      for (const id of entry.clubIds as string[]) { const league = world.domesticLeagues!.find(item => item.clubIds.includes(id)) ?? (Array.isArray(world.backgroundLeagues) ? world.backgroundLeagues.find(item => isObject(item) && Array.isArray(item.clubIds) && item.clubIds.includes(id)) : undefined); if (league && countries[id] !== league.country) fail(`${path}.countries`, 'must match the country of each league club'); }
      const counts = new Map<string, number>();
      for (const id of entry.clubIds as string[]) counts.set(countries[id] as string, (counts.get(countries[id] as string) ?? 0) + 1);
      if (protectedDraw && Math.max(...counts.values()) > 8) fail(`${path}.countries`, 'can list at most eight clubs of one country (one a group)');
    }
    for (const id of entry.clubIds as unknown[]) {
      if (typeof id !== 'string' || !clubIds.has(id) || entrants.has(id) || lowerDivisionClubIds(world).has(id)) fail(`${path}.clubIds`, 'must list clubs of this world, each in one competition and none of a next division');
      entrants.add(id as string);
    }
  }
}

/** Format 60: European places need the played competitions; unchosen top divisions belong to countries without a chosen league. */
function checkEuropeanPlaces(world: CareerWorld, clubIds: ReadonlySet<string>): void {
  const fail = worldFail;
  if (Object.hasOwn(world, 'europeanPlaces') && (world.europeanPlaces !== 'places-2026-1' || !world.europeanCompetitions?.some(competition => competition.format))) fail('world.europeanPlaces', 'must name the supported default for a world that plays European competitions');
  if (!Object.hasOwn(world, 'backgroundLeagues')) return;
  const lists = world.backgroundLeagues as unknown as Record<string, any>[];
  if (!Object.hasOwn(world, 'europeanPlaces') || !Array.isArray(lists) || lists.length > 10) fail('world.backgroundLeagues', 'must be a short list in a world with European places');
  const ids = new Set([...(world.domesticLeagues ?? []).map(league => league.id), ...(world.europeanCompetitions ?? []).map(competition => competition.id)]), countries = new Set<string>(), members = new Set<string>();
  const chosen = new Set((world.domesticLeagues ?? []).map(league => league.country)), lower = lowerDivisionClubIds(world);
  for (const [index, entry] of lists.entries()) {
    const path = `world.backgroundLeagues[${index}]`;
    if (!exactKeys(entry, ['id', 'name', 'country', 'tier', 'clubIds']) || !isText(entry.id, 80) || !ID.test(entry.id) || ids.has(entry.id) || !isText(entry.name) || !isText(entry.country, 60) || chosen.has(entry.country) || countries.has(entry.country) || entry.tier !== 1 || !Array.isArray(entry.clubIds) || entry.clubIds.length < 2 || entry.clubIds.length > 40) fail(path, 'must name an unchosen country\'s top division once, with its clubs');
    ids.add(entry.id); countries.add(entry.country);
    for (const id of entry.clubIds as unknown[]) { if (typeof id !== 'string' || !clubIds.has(id) || members.has(id) || lower.has(id) || (world.domesticLeagues ?? []).some(league => league.clubIds.includes(id as string))) fail(`${path}.clubIds`, 'must list clubs of this world in no other league'); members.add(id as string); }
  }
}

/** Format 53: each listed country's real next division, one below its lowest full division, with clubs not in the world. */
function checkLowerDivisions(world: CareerWorld, clubIds: ReadonlySet<string>): void {
  const fail = worldFail;
  const lists = world.lowerDivisions as unknown as Record<string, any>[];
  if (!Array.isArray(lists) || lists.length > 10) fail('world.lowerDivisions', 'must be a short list');
  const countries = new Set<string>(), ids = new Set<string>();
  for (const [index, entry] of lists.entries()) {
    const path = `world.lowerDivisions[${index}]`;
    if (!isObject(entry) || !isText(entry.country) || countries.has(entry.country) || !isText(entry.name)) fail(path, 'must name a country once, its division and its clubs');
    countries.add(entry.country);
    const tiers = world.domesticLeagues?.filter(league => league.country === entry.country).map(league => league.tier) ?? [];
    if (!tiers.length || entry.tier !== Math.max(...tiers) + 1) fail(`${path}.tier`, 'must be the division below the lowest league of its country in this world');
    if (NO_LOWER_DIVISION_COUNTRIES.includes(entry.country)) fail(`${path}.country`, 'has no relegation out of the full world for now');
    if (Object.hasOwn(entry, 'clubIds')) {
      // Format 54: clubs of this world in no opening league, whose generated players are labelled as generated.
      if (!exactKeys(entry, ['country', 'tier', 'name', 'clubIds']) || !Array.isArray(entry.clubIds) || entry.clubIds.length < 1 || entry.clubIds.length > 30) fail(path, 'must name a country once, its division and its clubs');
      for (const id of entry.clubIds as unknown[]) {
        const club = world.clubs.find(item => item.id === id);
        if (typeof id !== 'string' || ids.has(id) || !club || world.domesticLeagues!.some(league => league.clubIds.includes(id))) fail(`${path}.clubIds`, 'must list unique clubs of this world outside every league');
        ids.add(id as string);
        if (club!.players.some(player => world.playerProfiles[player.id]?.source !== 'generated')) fail(`${path}.clubIds`, 'must hold generated squads');
      }
      continue;
    }
    if (!exactKeys(entry, ['country', 'tier', 'name', 'clubs']) || !Array.isArray(entry.clubs) || entry.clubs.length < 1 || entry.clubs.length > 30) fail(path, 'must name a country once, its division and its clubs');
    for (const club of entry.clubs as Record<string, any>[]) {
      if (!exactKeys(club, ['id', 'name', 'shortName', 'color']) || !isText(club.id, 80) || !ID.test(club.id) || ids.has(club.id) || clubIds.has(club.id) || !isText(club.name) || !isText(club.shortName, 12) || typeof club.color !== 'string' || !COLOUR.test(club.color)) fail(`${path}.clubs`, 'must hold unique clubs outside this world with a name, a short name and a colour');
      ids.add(club.id);
    }
  }
}

export function validateWorld(value: unknown): asserts value is CareerWorld {
  if (isObject(value) && !Object.hasOwn(value, 'domesticLeagues') && validated.has(value)) return;
  const fail = (path: string, reason: string): never => { throw new Error(`Invalid career world: ${path} ${reason}.`); };
  if (!exactKeys(value, [...WORLD_KEYS, ...(isObject(value) && Object.hasOwn(value, 'rosterModel') ? ['rosterModel'] : []), ...(isObject(value) && Object.hasOwn(value, 'domesticLeagues') ? ['domesticLeagues'] : []), ...(isObject(value) && Object.hasOwn(value, 'playerContracts') ? ['playerContracts'] : []), ...(isObject(value) && Object.hasOwn(value, 'lowerDivisions') ? ['lowerDivisions'] : []), ...(isObject(value) && Object.hasOwn(value, 'europeanCompetitions') ? ['europeanCompetitions'] : []), ...(['europeanPlaces', 'backgroundLeagues', 'economy', 'neutralVenues', 'nextDivisionCountries', 'economyBalance', 'surplusSpending', 'spendingBalance', 'nba', 'nbaJobs', 'nbaTrades', 'longCareers', 'careerBalance', 'cashBalance', 'euroleagueJobs', 'squadRefresh', 'playerDevelopment', 'nbaFreeAgency'] as const).filter(key => isObject(value) && Object.hasOwn(value, key))])) fail('world', 'must contain exactly the world fields');
  const world = value as unknown as CareerWorld;
  // Format 85: rule markers of new careers, true when recorded.
  for (const key of ['neutralVenues', 'nextDivisionCountries'] as const) if (Object.hasOwn(world, key) && world[key] !== true) fail(`world.${key}`, 'must be true when recorded');
  // Format 87: the economy balance marker, only on worlds with researched money.
  if (Object.hasOwn(world, 'economyBalance') && (world.economyBalance !== true || !Object.hasOwn(world, 'economy'))) fail('world.economyBalance', 'must be true and needs researched club money');
  // Format 88: the surplus spending marker, only with the economy balance.
  if (Object.hasOwn(world, 'surplusSpending') && (world.surplusSpending !== true || world.economyBalance !== true)) fail('world.surplusSpending', 'must be true and needs the economy balance');
  // Format 89: the spending balance marker, only with surplus spending.
  if (Object.hasOwn(world, 'spendingBalance') && (world.spendingBalance !== true || world.surplusSpending !== true)) fail('world.spendingBalance', 'must be true and needs surplus spending');
  // NBA step 10 (format 92): the NBA careers marker, only on worlds with the NBA.
  if (Object.hasOwn(world, 'nbaJobs') && (world.nbaJobs !== true || !Object.hasOwn(world, 'nba'))) fail('world.nbaJobs', 'must be true and needs the NBA');
  // NBA step 9 (format 94): the NBA trades marker, only on worlds with the NBA's money rules.
  // Format 97: the long-careers fixes marker, only on worlds with researched money.
  if (Object.hasOwn(world, 'longCareers') && (world.longCareers !== true || !Object.hasOwn(world, 'economy'))) fail('world.longCareers', 'must be true and needs researched club money');
  // Format 98: the board and career balance marker.
  // Format 100: the EuroLeague jobs marker, only on worlds with domestic leagues and a EuroLeague, without the NBA.
  if (Object.hasOwn(world, 'euroleagueJobs') && (world.euroleagueJobs !== true || !euroleagueJobsWorld(world))) fail('world.euroleagueJobs', 'must be true and needs a EuroLeague without the NBA');
  if (Object.hasOwn(world, 'careerBalance') && (world.careerBalance !== true || !Object.hasOwn(world, 'domesticLeagues'))) fail('world.careerBalance', 'must be true and needs domestic leagues');
  // Format 99: the cash balance marker, only on worlds with researched money.
  if (Object.hasOwn(world, 'cashBalance') && (world.cashBalance !== true || !Object.hasOwn(world, 'economy'))) fail('world.cashBalance', 'must be true and needs researched club money');
  // Format 102: the squad refresh marker, only on worlds with the spending balance.
  if (Object.hasOwn(world, 'squadRefresh') && (world.squadRefresh !== true || world.spendingBalance !== true)) fail('world.squadRefresh', 'must be true and needs the spending balance');
  // Format 101: the player development marker.
  if (Object.hasOwn(world, 'playerDevelopment') && world.playerDevelopment !== true) fail('world.playerDevelopment', 'must be true when recorded');
  // Format 103: the NBA free agency marker, only on worlds with the NBA's money rules.
  if (Object.hasOwn(world, 'nbaFreeAgency') && (world.nbaFreeAgency !== true || world.nba?.cap !== 'nba-cap-1')) fail('world.nbaFreeAgency', 'must be true and needs the NBA\'s money rules');
  if (Object.hasOwn(world, 'nbaTrades') && (world.nbaTrades !== true || world.nba?.cap !== 'nba-cap-1')) fail('world.nbaTrades', 'must be true and needs the NBA\'s money rules');
  if (Object.hasOwn(world, 'rosterModel') && world.rosterModel !== FULL_ROSTER_MODEL) fail('world.rosterModel', 'has an unsupported value');
  if (!isText(world.id, 80) || !ID.test(world.id)) fail('world.id', 'must be a supported identifier');
  if (!isText(world.name)) fail('world.name', 'must be a nonempty, bounded text value');
  if (world.source !== 'fictional-development' && world.source !== 'real-data-pack') fail('world.source', 'has an unsupported value');
  if (world.startDate !== DEVELOPMENT_WORLD.startDate) fail('world.startDate', 'must use the shared career calendar');
  if (!Array.isArray(world.clubs) || world.clubs.length < MIN_WORLD_CLUBS || world.clubs.length > (world.domesticLeagues ? 400 : MAX_WORLD_CLUBS) || !world.domesticLeagues && world.clubs.length % 2 !== 0) fail('world.clubs', world.domesticLeagues ? 'must list a supported number of clubs' : `must list an even number of clubs from ${MIN_WORLD_CLUBS} to ${MAX_WORLD_CLUBS}`);
  if (Object.hasOwn(world, 'domesticLeagues')) {
    if (world.rosterModel !== FULL_ROSTER_MODEL || !Array.isArray(world.domesticLeagues) || world.domesticLeagues.length < 1 || world.domesticLeagues.length > 11) fail('world.domesticLeagues', 'requires full rosters and one to eleven leagues');
    const ids = new Set<string>(), members = new Set<string>();
    for (const league of world.domesticLeagues!) {
      if (!exactKeys(league, ['id', 'name', 'country', 'tier', 'clubIds', ...(['standingsRule', 'postseason'] as const).filter(key => isObject(league) && Object.hasOwn(league, key))]) || !isText(league.id, 80) || !ID.test(league.id) || ids.has(league.id) || !isText(league.name) || !isText(league.country) || !isWhole(league.tier, 1, 2) || !Array.isArray(league.clubIds) || league.clubIds.length < 4 || league.clubIds.length > (isObject(world.nba) && world.nba.leagueId === league.id ? 30 : 20)) fail('world.domesticLeagues', 'contains an invalid league');
      if (Object.hasOwn(league, 'standingsRule') && !standingsRuleAllowed(league.standingsRule, league.country, league.tier)) fail('world.domesticLeagues.standingsRule', 'must name a supported rule for this country');
      if (Object.hasOwn(league, 'postseason') && !postseasonFormatAllowed(String(league.postseason), league.country, league.tier, league.clubIds.length)) fail('world.domesticLeagues.postseason', 'must name this country and division\'s format, for a league with enough clubs');
      ids.add(league.id);
      for (const id of league.clubIds) {
        if (members.has(id) || !world.clubs.some(club => club.id === id)) fail('world.domesticLeagues', 'must assign each club to exactly one league');
        members.add(id);
      }
    }
    // Format 54: next-division clubs are in the world but in no opening league.
    const lowerMembers = Array.isArray(world.lowerDivisions) ? world.lowerDivisions.filter(entry => isObject(entry) && Array.isArray((entry as unknown as LowerDivisionMembers).clubIds)).flatMap(entry => (entry as unknown as LowerDivisionMembers).clubIds) : [];
    // Format 56: European-only entrants are in the world too, in no domestic league.
    const europeanOnly = Array.isArray(world.europeanCompetitions) ? [...new Set(world.europeanCompetitions.flatMap(entry => isObject(entry) && Array.isArray(entry.clubIds) ? entry.clubIds as string[] : []).filter(id => !members.has(id)))] : [];
    // Format 60: unchosen top divisions' clubs too (some of them European entrants).
    const backgroundMembers = Array.isArray(world.backgroundLeagues) ? world.backgroundLeagues.flatMap(entry => isObject(entry) && Array.isArray(entry.clubIds) ? entry.clubIds as string[] : []) : [];
    const outside = new Set([...europeanOnly, ...backgroundMembers]);
    if (members.size + lowerMembers.length + outside.size !== world.clubs.length || lowerMembers.some(id => members.has(id) || outside.has(id)) || backgroundMembers.some(id => members.has(id))) fail('world.domesticLeagues', 'must cover every club');
    // Worlds created since format 51 give every league a rule (its own or the FIBA default); older worlds rank only French leagues by a rule.
    if (world.domesticLeagues!.some(league => league.standingsRule && STANDINGS_RULE_FORMAT[league.standingsRule] >= STANDINGS_RULE_FORMAT['fiba-2026-d']) && world.domesticLeagues!.some(league => !Object.hasOwn(league, 'standingsRule'))) fail('world.domesticLeagues.standingsRule', 'must be given to every league of a world that uses the FIBA default or a later rule');
    // Postseasons are all or nothing, and a format seeding from the other division needs that division's postseason too.
    const withPostseason = world.domesticLeagues!.filter(league => league.postseason);
    if (withPostseason.length && withPostseason.length !== world.domesticLeagues!.length) fail('world.domesticLeagues.postseason', 'must be given to every league or none');
    for (const league of withPostseason) if (POSTSEASON_FORMATS[league.postseason!].series.some(spec => [spec.a, spec.b].some(ref => 'otherTier' in ref && ref.otherTier)) && !world.domesticLeagues!.some(other => other.country === league.country && other.tier !== league.tier)) fail('world.domesticLeagues.postseason', 'needs the country\'s other division');
  }
  if (!isObject(world.playerProfiles) || !isObject(world.wages)) fail('world', 'needs player profiles and wages');
  const clubIds = new Set<string>(), playerIds = new Set<string>();
  for (const [index, club] of world.clubs.entries()) {
    const path = `world.clubs[${index}]`;
    if (!exactKeys(club, ['id', 'name', 'shortName', 'color', 'players'])) fail(path, 'must be a club');
    if (!isText(club.id, 80) || !ID.test(club.id) || clubIds.has(club.id)) fail(`${path}.id`, 'must be a unique supported identifier');
    clubIds.add(club.id);
    if (!isText(club.name) || !isText(club.shortName, 12) || typeof club.color !== 'string' || !COLOUR.test(club.color)) fail(path, 'needs a name, a short name and a colour');
    const maximum = world.rosterModel === FULL_ROSTER_MODEL ? MAX_CLUB_ROSTER_SIZE : 20;
    if (!Array.isArray(club.players) || club.players.length < 5 || club.players.length > maximum) fail(`${path}.players`, `must list between 5 and ${maximum} players`);
    const numbers = new Set<number>();
    for (const [playerIndex, player] of club.players.entries()) {
      const playerPath = `${path}.players[${playerIndex}]`;
      checkPlayerShape(player, playerPath, playerIds, numbers);
      const profile = Object.hasOwn(world.playerProfiles, player.id) ? world.playerProfiles[player.id] : undefined;
      if (!profile || typeof profile.dateOfBirth !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(profile.dateOfBirth) || profile.dateOfBirth >= world.startDate) fail(`world.playerProfiles.${player.id}`, 'must give a date of birth before the career starts');
      // Format 62: researched wages reach EUR 15 million a season; every limit stays far inside safe integers.
      if (!Object.hasOwn(world.wages, player.id) || !isWhole(world.wages[player.id], 0, MAX_ECONOMY_AMOUNT)) fail(`world.wages.${player.id}`, 'must give a season wage');
    }
  }
  if (Object.hasOwn(world, 'nba')) checkNba(world);
  if (Object.hasOwn(world, 'lowerDivisions')) checkLowerDivisions(world, clubIds);
  if (Object.hasOwn(world, 'europeanCompetitions')) checkEuropeanCompetitions(world, clubIds);
  if (Object.hasOwn(world, 'europeanPlaces') || Object.hasOwn(world, 'backgroundLeagues')) checkEuropeanPlaces(world, clubIds);
  if (Object.hasOwn(world, 'playerContracts') && (!isObject(world.playerContracts) || Object.keys(world.playerContracts!).length !== playerIds.size || [...playerIds].some(id => !Object.hasOwn(world.playerContracts!, id) || !isWhole(world.playerContracts![id], 1, 3)))) fail('world.playerContracts', 'must give every player an opening contract of one to three seasons');
  if (Object.keys(world.playerProfiles).length !== playerIds.size || Object.keys(world.wages).length !== playerIds.size) fail('world', 'must give profiles and wages for exactly its players');
  if (!Array.isArray(world.sponsors)) fail('world.sponsors', 'must be a list');
  const sponsorNames = new Set<string>(), sponsorIds = new Set<string>();
  for (const sponsor of world.sponsors) {
    if (!exactKeys(sponsor, ['id', 'name', 'sector']) || !isText(sponsor.id, 80) || !ID.test(sponsor.id) || sponsorIds.has(sponsor.id) || !isText(sponsor.name) || sponsorNames.has(sponsor.name) || !isText(sponsor.sector)) fail('world.sponsors', 'must hold unique, complete sponsors');
    sponsorIds.add(sponsor.id); sponsorNames.add(sponsor.name);
  }
  const perClub = (list: unknown, path: string) => {
    if (!Array.isArray(list) || list.length !== clubIds.size || list.some(item => !isObject(item) || !clubIds.has(item.clubId as string)) || new Set(list.map(item => (item as { clubId: string }).clubId)).size !== clubIds.size) fail(path, 'must cover every club exactly once');
  };
  perClub(world.finances, 'world.finances');
  if (Object.hasOwn(world, 'economy') && world.economy !== REAL_ECONOMY_RULES.id) fail('world.economy', 'has an unsupported value');
  for (const finance of world.finances) {
    if (!exactKeys(finance, ['clubId', 'venue', 'sponsor', 'capacity', 'referenceDemand', ...(world.economy ? ['economy'] : [])]) || !isText(finance.venue) || !sponsorNames.has(finance.sponsor) || !isWhole(finance.capacity, 500, 60_000) || !isWhole(finance.referenceDemand, 100, finance.capacity)) fail(`world.finances.${finance.clubId}`, 'needs a venue, a listed sponsor, a capacity and a demand within it');
    // Format 62: each club's researched money figures, in euro cents.
    if (world.economy) {
      const economy = finance.economy as unknown as Record<string, unknown>;
      if (!exactKeys(economy, CLUB_ECONOMY_KEYS) || !ECONOMY_BANDS.includes(economy.band as EconomyBand) || !isWhole(economy.budget, 1, MAX_ECONOMY_AMOUNT) || ['sponsorship', 'funding', 'openingCash', 'operatingCost'].some(key => !isWhole(economy[key], 0, MAX_ECONOMY_AMOUNT)) || !isWhole(economy.ticketPrice, 100, 100_000) || (economy.ticketPrice as number) % 100 !== 0 || !isWhole(economy.scale, 1, 1_000_000)) fail(`world.finances.${finance.clubId}.economy`, 'needs a band, a budget, season income and costs, a whole-euro ticket price and a scale');
    }
  }
  perClub(world.presidents, 'world.presidents');
  for (const president of world.presidents) {
    if (!exactKeys(president, ['clubId', 'name', 'generosity', 'seasonCapital', ...(Object.hasOwn(president, 'traits') ? ['traits'] : [])]) || !isText(president.name) || !isWhole(president.generosity, 1, 5) || !isWhole(president.seasonCapital, 0, MAX_ECONOMY_AMOUNT)) fail(`world.presidents.${president.clubId}`, 'needs a name, a generosity from 1 to 5 and a season capital');
    // Format 70: optional fictional personality traits (patience, ambition and interference 1-5, a negotiation style).
    if (Object.hasOwn(president, 'traits') && !isPresidentTraits(president.traits)) fail(`world.presidents.${president.clubId}.traits`, 'needs patience, ambition and interference from 1 to 5 and a negotiation style');
  }
  if (!Array.isArray(world.rivalries)) fail('world.rivalries', 'must be a list');
  const rivals = new Set<string>(), rivalryIds = new Set<string>();
  for (const rivalry of world.rivalries) {
    if (!exactKeys(rivalry, ['id', 'clubIds', 'name', 'intensity', 'origin']) || !isText(rivalry.id, 80) || !ID.test(rivalry.id) || rivalryIds.has(rivalry.id) || !Array.isArray(rivalry.clubIds) || rivalry.clubIds.length !== 2 || rivalry.clubIds[0] === rivalry.clubIds[1] || rivalry.clubIds.some(id => !clubIds.has(id) || rivals.has(id)) || !isText(rivalry.name) || !isWhole(rivalry.intensity, 1, 3)) fail('world.rivalries', 'must pair distinct clubs of this world, each club at most once');
    rivalryIds.add(rivalry.id);
    for (const id of rivalry.clubIds) rivals.add(id);
  }
  // Calendar membership may be edited in a mutable import object; never cache its validation.
  if (!world.domesticLeagues) validated.add(world);
}
