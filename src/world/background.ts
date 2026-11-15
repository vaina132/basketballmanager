import type { BackgroundClub, SeasonBackground } from '../domain/background';
import type { DomesticDivisions, SeasonState } from '../domain/season';
import type { Team } from '../domain/types';
import type { WorldContext } from '../domain/world';
import { MAX_CLUB_ROSTER_SIZE, MAX_MATCHDAY_PLAYERS } from '../domain/roster';
import { checkPlayerShape, worldOf } from './career-world';
import { seasonLeagues } from './divisions';
import { applyAgingAttributes, type LifecycleContext } from './lifecycle-policy';
import { overallRating } from './overall-rating';

/**
 * Clubs outside the full world (step 3.4d-1, shared with 3.5). The record is empty until clubs can leave the full world
 * (step 3.4d-2); this module already gives the pieces that step and the European competitions need: a background club
 * made from a full-world club, its squad aged to a date, a legal matchday selection and the save checks.
 */
/** Format 55: exchanges with a next division can happen from the end of season `changesFrom` (1 for a new career). */
export function createBackground(changesFrom = 1): SeasonBackground {
  return { model: 'background-1', clubs: [], changesFrom, exchanges: [] };
}

/** The country a world club plays in: its opening league's country (clubs never change country). */
function clubCountry(context: WorldContext, clubId: string): string {
  const league = worldOf(context).domesticLeagues?.find(item => item.clubIds.includes(clubId));
  if (!league) throw new Error('Only a club of a domestic league can leave the full world.');
  return league.country;
}

/** A full-world club leaving it at the end of season `since - 1`: its world identity and its squad at that moment. */
export function backgroundClubFrom(state: Pick<SeasonState, 'clubs'> & WorldContext, clubId: string, since: number): BackgroundClub {
  const team = state.clubs.find(club => club.id === clubId);
  const identity = worldOf(state).clubs.find(club => club.id === clubId);
  if (!team || !identity) throw new Error('This club is not in the full world.');
  return {
    id: clubId, name: identity.name, shortName: identity.shortName, color: identity.color, country: clubCountry(state, clubId), origin: 'relegated', since,
    players: team.players.map(player => ({ ...player, attributes: { ...player.attributes } })),
  };
}

/** The squad on a date. Background squads do not train; they age by the same dated decline as every other player. */
export function backgroundSquad(context: LifecycleContext, club: BackgroundClub, onDate: string): Team {
  return { id: club.id, name: club.name, shortName: club.shortName, color: club.color, players: club.players.map(player => ({ ...player, attributes: applyAgingAttributes(context, player.id, player.attributes, onDate) })) };
}

/**
 * A legal matchday selection of up to twelve: the best available player at each position, then the best of the rest,
 * by position-weighted overall rating on that date. Unavailable players are used only when fewer than five are fit.
 */
export function backgroundMatchday(context: LifecycleContext, club: BackgroundClub, onDate: string, unavailable: ReadonlySet<string> = new Set()): Team {
  const squad = backgroundSquad(context, club, onDate);
  const rating = new Map(squad.players.map(player => [player.id, overallRating(player.attributes, player.position)]));
  const ranked = [...squad.players].sort((a, b) => Number(unavailable.has(a.id)) - Number(unavailable.has(b.id)) || rating.get(b.id)! - rating.get(a.id)! || squad.players.indexOf(a) - squad.players.indexOf(b));
  const fit = ranked.filter(player => !unavailable.has(player.id));
  const pool = fit.length >= 5 ? fit : ranked;
  const starters = (['PG', 'SG', 'SF', 'PF', 'C'] as const).flatMap(position => pool.find(player => player.position === position)?.id ?? []);
  const chosen = new Set([...new Set([...starters, ...pool.map(player => player.id), ...ranked.map(player => player.id)])].slice(0, MAX_MATCHDAY_PLAYERS));
  if (chosen.size < 5) throw new Error('A background club needs at least five players for a matchday.');
  return { ...squad, players: squad.players.filter(player => chosen.has(player.id)) };
}

const fail = (path: string, reason: string): never => { throw new Error(`Invalid season save: ${path} ${reason}.`); };
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: unknown, keys: readonly string[]) => isObject(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

/**
 * One background club's record against the career: a club of the world that is in none of this season's divisions,
 * with its world identity and country, a departure at an earlier season's end, and a squad of real player records
 * that nobody in the full world holds.
 */
export function validateBackgroundClub(value: unknown, path: string, state: Pick<SeasonState, 'seasonNumber' | 'clubs'> & WorldContext & { divisions?: DomesticDivisions | null }, playerIds: Set<string>): asserts value is BackgroundClub {
  if (!exactKeys(value, ['id', 'name', 'shortName', 'color', 'country', 'origin', 'since', 'players'])) fail(path, 'must be a background club');
  const club = value as Record<string, unknown>;
  const world = worldOf(state);
  const identity = world.clubs.find(item => item.id === club.id);
  if (!identity || seasonLeagues(world, state.divisions).some(league => league.clubIds.includes(identity.id))) fail(`${path}.id`, 'must name a club of this world outside this season\'s divisions');
  if (club.name !== identity!.name || club.shortName !== identity!.shortName || club.color !== identity!.color || club.country !== clubCountry(state, identity!.id)) fail(path, 'must keep the club\'s identity and country');
  if (club.origin !== 'relegated') fail(`${path}.origin`, 'must record why the club left');
  if (typeof club.since !== 'number' || !Number.isInteger(club.since) || club.since < 2 || club.since > state.seasonNumber) fail(`${path}.since`, 'must be a season after one that ended');
  if (!Array.isArray(club.players) || club.players.length < 5 || club.players.length > MAX_CLUB_ROSTER_SIZE) fail(`${path}.players`, `must list between 5 and ${MAX_CLUB_ROSTER_SIZE} players`);
  const held = new Set(state.clubs.flatMap(team => team.players.map(player => player.id)));
  const numbers = new Set<number>();
  for (const [index, player] of (club.players as unknown[]).entries()) {
    try { checkPlayerShape(player, `${path}.players[${index}]`, playerIds, numbers); } catch (error) { fail(`${path}.players[${index}]`, error instanceof Error ? error.message.replace(/^Invalid career world: \S+ /, '').replace(/\.$/, '') : 'is invalid'); }
    if (held.has((player as { id: string }).id)) fail(`${path}.players[${index}].id`, 'is registered with a full-world club');
  }
}

/**
 * Format 53: the record's shape, then what the career's history allows. No club leaves the full world before step
 * 3.4d-2, so every club listed is refused for now.
 */
export function validateBackground(value: unknown, state: Pick<SeasonState, 'seasonNumber' | 'clubs'> & WorldContext & { divisions?: DomesticDivisions | null }, version = 55): asserts value is SeasonBackground {
  if (!exactKeys(value, ['model', 'clubs', ...(version >= 55 ? ['changesFrom', 'exchanges'] : [])]) || (value as Record<string, unknown>).model !== 'background-1' || !Array.isArray((value as Record<string, unknown>).clubs)) fail('background', 'must be a background-1 record');
  if (version >= 55) {
    const { changesFrom, exchanges } = value as unknown as Required<SeasonBackground>;
    if (!Number.isInteger(changesFrom) || changesFrom < 1 || changesFrom > state.seasonNumber + 1) fail('background.changesFrom', 'must be a season of this career');
    if (!Array.isArray(exchanges) || exchanges.length > 4 * state.seasonNumber) fail('background.exchanges', 'must be a bounded list');
    for (const [index, exchange] of exchanges.entries()) {
      if (!exactKeys(exchange, ['seasonNumber', 'leagueId', 'leaving', 'joining']) || !Array.isArray(exchange.leaving) || !Array.isArray(exchange.joining) || exchange.leaving.length !== exchange.joining.length) fail(`background.exchanges[${index}]`, 'must name a season, a league and balanced clubs leaving and joining');
    }
  }
  const clubs = (value as { clubs: unknown[] }).clubs;
  // Each record's shape; that the records and exchanges follow from the career is checked by `validateBackgroundHistory`.
  for (const [index, club] of clubs.entries()) {
    const open = isObject(club) && club.until === undefined;
    if (!exactKeys(club, ['id', 'name', 'shortName', 'color', 'country', 'origin', 'since', 'players', ...(isObject(club) && Object.hasOwn(club, 'until') ? ['until'] : [])]) || !open && (version < 55 || !Number.isInteger((club as Record<string, unknown>).until))) fail(`background.clubs[${index}]`, 'must be a background club');
  }
  if (version < 55 && clubs.length) fail('background.clubs', 'cannot list clubs before clubs leave the full world (step 3.4d-2)');
}

/** Clubs leaving the full world at the end of the current, completed season (step 3.4d-2); they sit out its offseason market. */
export function leavingClubIds(state: { seasonNumber: number; status: string; background?: SeasonBackground }): ReadonlySet<string> {
  if (state.status !== 'complete') return new Set();
  return new Set((state.background?.exchanges ?? []).filter(exchange => exchange.seasonNumber === state.seasonNumber).flatMap(exchange => exchange.leaving));
}

/** The background records of clubs outside the full world in a season (left by then, not yet back). */
export function backgroundClubsIn(background: SeasonBackground | undefined, seasonNumber: number): BackgroundClub[] {
  return (background?.clubs ?? []).filter(club => club.since <= seasonNumber && (club.until === undefined || seasonNumber < club.until));
}
