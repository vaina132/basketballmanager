import type { ClubFinanceDefinition } from '../data/development-finances';
import type { DevelopmentPresident } from '../data/development-presidents';
import type { Rivalry } from '../domain/rivalries';
import type { Player } from '../domain/types';
import { FULL_ROSTER_MODEL, MAX_CLUB_ROSTER_SIZE } from '../domain/roster';
import type { CareerWorld, WorldContext } from '../domain/world';
import { DEVELOPMENT_PLAYERS } from '../data/development-players';
import { DEVELOPMENT_WORLD } from '../data/development-world';

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

/** A world holds an even number of clubs (every club plays every matchday) from 4 to 40. */
export const MIN_WORLD_CLUBS = 4;
export const MAX_WORLD_CLUBS = 40;
/** The longest possible season: a double round robin of the largest world. */
export const MAX_SEASON_ROUNDS = 2 * (MAX_WORLD_CLUBS - 1);

/** Matchdays in a season of this world: every club meets every other club home and away. */
export function worldRounds(world: CareerWorld): number {
  return 2 * (world.clubs.length - 1);
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

/** Only careers outside the built-in league store their world. */
export function storedWorld(world: CareerWorld): { world?: CareerWorld } {
  return world.id === DEVELOPMENT_WORLD.id ? {} : { world };
}

// The built-in league keeps its long-standing catalog array, so existing identity checks and caches still hold.
const playerLists = new WeakMap<CareerWorld, readonly Player[]>([[DEVELOPMENT_WORLD, DEVELOPMENT_PLAYERS]]);
const playerIndexes = new WeakMap<CareerWorld, ReadonlyMap<string, Player>>();

/** Every original player of the world, in club order. */
export function worldPlayers(world: CareerWorld): readonly Player[] {
  let players = playerLists.get(world);
  if (!players) { players = Object.freeze(world.clubs.flatMap(club => club.players)); playerLists.set(world, players); }
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
  return typeof clubId === 'string' && world.clubs.some(club => club.id === clubId);
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
const exactKeys = (value: unknown, keys: readonly string[]) => isObject(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

/**
 * Checks that a world is complete and consistent before a career starts in it or a save that carries it loads:
 * unique club and player identities, playable squads, and every club and player covered by the club data.
 * All worlds share the career calendar: season one starts on DEVELOPMENT_WORLD.startDate.
 */
export function validateWorld(value: unknown): asserts value is CareerWorld {
  if (isObject(value) && validated.has(value)) return;
  const fail = (path: string, reason: string): never => { throw new Error(`Invalid career world: ${path} ${reason}.`); };
  if (!exactKeys(value, [...WORLD_KEYS, ...(isObject(value) && Object.hasOwn(value, 'rosterModel') ? ['rosterModel'] : [])])) fail('world', 'must contain exactly the world fields');
  const world = value as unknown as CareerWorld;
  if (Object.hasOwn(world, 'rosterModel') && world.rosterModel !== FULL_ROSTER_MODEL) fail('world.rosterModel', 'has an unsupported value');
  if (!isText(world.id, 80) || !ID.test(world.id)) fail('world.id', 'must be a supported identifier');
  if (!isText(world.name)) fail('world.name', 'must be a nonempty, bounded text value');
  if (world.source !== 'fictional-development' && world.source !== 'real-data-pack') fail('world.source', 'has an unsupported value');
  if (world.startDate !== DEVELOPMENT_WORLD.startDate) fail('world.startDate', 'must use the shared career calendar');
  if (!Array.isArray(world.clubs) || world.clubs.length < MIN_WORLD_CLUBS || world.clubs.length > MAX_WORLD_CLUBS || world.clubs.length % 2 !== 0) fail('world.clubs', `must list an even number of clubs from ${MIN_WORLD_CLUBS} to ${MAX_WORLD_CLUBS}`);
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
      if (!exactKeys(player, ['id', 'name', 'number', 'position', 'heightCm', 'weightKg', 'skinTone', 'hairColor', 'attributes'])) fail(playerPath, 'must be a player');
      if (!isText(player.id, 80) || !ID.test(player.id) || playerIds.has(player.id)) fail(`${playerPath}.id`, 'must be a unique supported identifier');
      playerIds.add(player.id);
      if (!isText(player.name) || !isWhole(player.number, 0, 99) || numbers.has(player.number) || !['PG', 'SG', 'SF', 'PF', 'C'].includes(player.position)) fail(playerPath, 'needs a name, a unique shirt number and a position');
      numbers.add(player.number);
      if (!isWhole(player.heightCm, 120, 260) || typeof player.weightKg !== 'number' || !(player.weightKg >= 35 && player.weightKg <= 250) || !COLOUR.test(player.skinTone) || !COLOUR.test(player.hairColor)) fail(playerPath, 'needs a supported build and appearance');
      if (!exactKeys(player.attributes, ATTRIBUTE_KEYS) || ATTRIBUTE_KEYS.some(key => !isWhole(player.attributes[key], 1, 20))) fail(`${playerPath}.attributes`, 'must hold seven abilities from 1 to 20');
      const profile = Object.hasOwn(world.playerProfiles, player.id) ? world.playerProfiles[player.id] : undefined;
      if (!profile || typeof profile.dateOfBirth !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(profile.dateOfBirth) || profile.dateOfBirth >= world.startDate) fail(`world.playerProfiles.${player.id}`, 'must give a date of birth before the career starts');
      if (!Object.hasOwn(world.wages, player.id) || !isWhole(world.wages[player.id], 0, 1_000_000_000)) fail(`world.wages.${player.id}`, 'must give a season wage');
    }
  }
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
  for (const finance of world.finances) {
    if (!exactKeys(finance, ['clubId', 'venue', 'sponsor', 'capacity', 'referenceDemand']) || !isText(finance.venue) || !sponsorNames.has(finance.sponsor) || !isWhole(finance.capacity, 500, 60_000) || !isWhole(finance.referenceDemand, 100, finance.capacity)) fail(`world.finances.${finance.clubId}`, 'needs a venue, a listed sponsor, a capacity and a demand within it');
  }
  perClub(world.presidents, 'world.presidents');
  for (const president of world.presidents) {
    if (!exactKeys(president, ['clubId', 'name', 'generosity', 'seasonCapital']) || !isText(president.name) || !isWhole(president.generosity, 1, 5) || !isWhole(president.seasonCapital, 0, 1_000_000_000)) fail(`world.presidents.${president.clubId}`, 'needs a name, a generosity from 1 to 5 and a season capital');
  }
  if (!Array.isArray(world.rivalries)) fail('world.rivalries', 'must be a list');
  const rivals = new Set<string>(), rivalryIds = new Set<string>();
  for (const rivalry of world.rivalries) {
    if (!exactKeys(rivalry, ['id', 'clubIds', 'name', 'intensity', 'origin']) || !isText(rivalry.id, 80) || !ID.test(rivalry.id) || rivalryIds.has(rivalry.id) || !Array.isArray(rivalry.clubIds) || rivalry.clubIds.length !== 2 || rivalry.clubIds[0] === rivalry.clubIds[1] || rivalry.clubIds.some(id => !clubIds.has(id) || rivals.has(id)) || !isText(rivalry.name) || !isWhole(rivalry.intensity, 1, 3)) fail('world.rivalries', 'must pair distinct clubs of this world, each club at most once');
    rivalryIds.add(rivalry.id);
    for (const id of rivalry.clubIds) rivals.add(id);
  }
  validated.add(world);
}
