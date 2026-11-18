import type { SeasonCoaching } from '../domain/coaching';
import type { SeasonState } from '../domain/season';
import type { Team } from '../domain/types';
import { ASSISTANT_DIRECTORY, COACH_DIRECTORY, FITNESS_DIRECTORY, PHYSIO_DIRECTORY, SCOUT_DIRECTORY, YOUTH_COACH_DIRECTORY, realAssistantOf, staffMember, staffNationality, type StaffMarketScope } from '../data/staff-directory';
import type { WorldContext } from '../domain/world';
import { clubEconomy, staffFee } from './economy';
import { overallRating } from './overall-rating';
import { clubCountry, worldOf } from './career-world';
import { staffAllocation } from './board-consequences';

/** The six staff areas every club fills (format 74). */
export type StaffRole = 'coaches' | 'scouts' | 'fitness' | 'physio' | 'assistant' | 'youth';
export const STAFF_ROLES: readonly StaffRole[] = Object.freeze(['coaches', 'scouts', 'fitness', 'physio', 'assistant', 'youth']);

/**
 * Club-level staff (owner request, 16 November 2026; format 74, stored as `coaching.model` 'coaching-2'). Every rule
 * here is a reversible default:
 * - Every club (the manager's and every computer club) starts with one person in each staff role.
 * - A club's staff level is its place among the full world's clubs by money (the season's club budget in worlds with an
 *   economy; squad strength, the best eight's average overall rating, otherwise): 0 for the poorest, 1 for the richest.
 * - Each appointment aims at the role's rating range at that level, moved by up to `spread` either way (a fixed spread
 *   from the career seed, club, role and season, never match randomness), so clubs of one level differ a little.
 * - A starting or computer appointment may use at most `shares` percent of the club's season staff budget (the six
 *   shares add up to 100), so the opening staff always fit the budget; when no one near the target fits, the cheapest
 *   affordable candidate is taken. Richer clubs have a larger budget, so they can afford the better staff they aim at.
 * - Computer clubs fill an empty role the same way, the richest club first; the manager hires and replaces freely.
 * - A sacked person's season fee was paid when they were hired and is not refunded; from the day they leave, their fee
 *   no longer counts against the club's season staff budget, so a replacement always has room for a similar fee.
 */
export const STAFF_LEVEL_RULES = Object.freeze({
  shares: Object.freeze({ coaches: 30, scouts: 15, fitness: 15, physio: 15, assistant: 15, youth: 10 } as Readonly<Record<StaffRole, number>>),
  spread: 0.15,
});

/** Format 74: the career staffs every club to its level and sacked fees stop counting against the staff budget. */
export function usesClubLevelStaff(state: { coaching?: Pick<SeasonCoaching, 'model'> }): boolean {
  return state.coaching?.model === 'coaching-2' || state.coaching?.model === 'coaching-3';
}

/**
 * The clubs a staff market serves (format 74): the season's full-world clubs when known, otherwise the world's clubs.
 * Background and lower-division clubs employ no one, so they no longer widen the market.
 */
export function staffMarketWorld(context: WorldContext & { clubs?: readonly Team[]; coaching?: Pick<SeasonCoaching, 'model'> }): StaffMarketScope {
  const clubs = context.clubs ?? worldOf(context).clubs, world = context.world;
  if (!usesClubLevelStaff(context)) return { clubs };
  // Owner feedback (18 November 2026): club-level markets always offer a few top candidates (`elite`), and in a world
  // whose countries are known also local pools.
  if (!world) return eliteScope(clubs);
  let byWorld = marketScopes.get(clubs);
  if (!byWorld) { byWorld = new Map(); marketScopes.set(clubs, byWorld); }
  let scope = byWorld.get(world.id);
  if (!scope) {
    const countries = clubs.map(club => clubCountry(world, club.id));
    scope = countries.some(country => country !== null) ? { clubs, countries, elite: true } : eliteScope(clubs);
    byWorld.set(world.id, scope);
  }
  return scope;
}
const marketScopes = new WeakMap<readonly { id: string }[], Map<string, StaffMarketScope>>();
const eliteScopes = new WeakMap<readonly { id: string }[], StaffMarketScope>();
function eliteScope(clubs: readonly { id: string }[]): StaffMarketScope {
  let scope = eliteScopes.get(clubs);
  if (!scope) { scope = { clubs, elite: true }; eliteScopes.set(clubs, scope); }
  return scope;
}

/** Owner feedback (18 November 2026): most staff come from the club's country, a minority from abroad. */
export const STAFF_NATIONALITY_RULES = Object.freeze({ localShare: 0.75 });

/**
 * `fittingStaffChoice` for club-level staff in a real-club world: a club's real assistant coach when the real-people
 * list names one and he is free and affordable; otherwise, by a fixed draw from the career seed, club, role and season,
 * a candidate of the club's country (`localShare`) or one from abroad, falling back to every candidate when that group
 * has no one affordable.
 */
export function fittingLocalStaffChoice<T extends { id: string }>(context: WorldContext & { seed: number; seasonNumber?: number; coaching?: Pick<SeasonCoaching, 'model'> }, clubId: string, role: StaffRole, candidates: readonly T[], options: Parameters<typeof fittingStaffChoice<T>>[1]): T | undefined {
  const world = context.world;
  if (!world || !usesClubLevelStaff(context)) return fittingStaffChoice(candidates, options);
  if (role === 'assistant') {
    const realId = realAssistantOf(clubId)?.id, real = realId === undefined ? undefined : candidates.find(member => member.id === realId);
    if (real && options.fee(real) <= options.budget) return real;
  }
  const country = clubCountry(world, clubId);
  if (country === null) return fittingStaffChoice(candidates, options);
  const local = unitHash(`${context.seed}|${clubId}|${role}|${context.seasonNumber ?? 1}|nationality`) < STAFF_NATIONALITY_RULES.localShare;
  const group = candidates.filter(member => staffNationality(member.id) !== null && (staffNationality(member.id) === country) === local && (role !== 'assistant' || !member.id.startsWith('assistant-real-')));
  return fittingStaffChoice(group, options) ?? fittingStaffChoice(candidates.filter(member => !member.id.startsWith('assistant-real-')), options);
}

const strengths = new WeakMap<readonly Team['players'][number][], number>();
function squadStrength(players: readonly Team['players'][number][]): number {
  let value = strengths.get(players);
  if (value === undefined) {
    const best = players.map(player => overallRating(player.attributes, player.position)).sort((left, right) => right - left).slice(0, 8);
    value = best.length ? best.reduce((sum, rating) => sum + rating, 0) / best.length : 0;
    strengths.set(players, value);
  }
  return value;
}

type LevelContext = WorldContext & { clubs: readonly Team[] };
const levelCache = new WeakMap<readonly Team[], Map<string, ReadonlyMap<string, number>>>();
/** Every full-world club's staff level (0 the poorest or weakest, 1 the richest or strongest; a lone club 1). */
export function clubStaffLevels(context: LevelContext): ReadonlyMap<string, number> {
  const key = `${context.seasonNumber ?? 1}/${context.world?.id ?? context.dataPackId ?? ''}/${context.economySeasons?.seasons.length ?? 0}`;
  let bySeason = levelCache.get(context.clubs);
  if (!bySeason) { bySeason = new Map(); levelCache.set(context.clubs, bySeason); }
  const known = bySeason.get(key);
  if (known) return known;
  const value = (club: Team) => clubEconomy(context, club.id)?.budget ?? squadStrength(club.players);
  const ranked = context.clubs.map(club => ({ id: club.id, value: value(club) })).sort((left, right) => left.value - right.value || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const levels = new Map(ranked.map((club, index) => [club.id, ranked.length > 1 ? index / (ranked.length - 1) : 1]));
  bySeason.set(key, levels);
  return levels;
}

/** A fixed number in [0, 1) for a text (FNV-1a), so a club's spread never draws on match randomness. */
function unitHash(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return hash / 0x1_0000_0000;
}

/** The rating a club aims at for a role: its level within the role's rating range, moved by its fixed spread. */
export function staffTargetRating(context: LevelContext & { seed: number }, clubId: string, role: StaffRole, range: readonly [number, number]): number {
  const level = clubStaffLevels(context).get(clubId) ?? 0;
  const spread = (unitHash(`${context.seed}|${clubId}|${role}|${context.seasonNumber ?? 1}`) * 2 - 1) * STAFF_LEVEL_RULES.spread;
  const placed = Math.max(0, Math.min(1, level + spread));
  return range[0] + placed * (range[1] - range[0]);
}

/** The most a starting or computer appointment in a role may cost: the role's share of the club's season staff budget. */
export function staffShareCap(context: Parameters<typeof staffAllocation>[0], clubId: string, role: StaffRole): number {
  return Math.floor(staffAllocation(context, clubId) * STAFF_LEVEL_RULES.shares[role] / 100);
}

/**
 * The candidate closest to the target rating among those within `cap` (lower fee, then identity, on ties); when no one
 * within the cap is affordable, the cheapest candidate within `budget`. Undefined when nobody is affordable.
 */
export function fittingStaffChoice<T extends { id: string }>(candidates: readonly T[], options: { rating: (member: T) => number; fee: (member: T) => number; target: number; cap: number; budget: number }): T | undefined {
  const byId = (left: T, right: T) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  const affordable = candidates.filter(member => options.fee(member) <= options.budget);
  const within = affordable.filter(member => options.fee(member) <= options.cap);
  if (!within.length) return [...affordable].sort((left, right) => options.fee(left) - options.fee(right) || byId(left, right))[0];
  return [...within].sort((left, right) => Math.abs(options.rating(left) - options.target) - Math.abs(options.rating(right) - options.target) || options.fee(left) - options.fee(right) || byId(left, right))[0];
}

/** A role's rating range in its authored candidates (the scale a club's level is placed on). */
export function ratingRange<T>(authored: readonly T[], rating: (member: T) => number): readonly [number, number] {
  const ratings = authored.map(rating);
  return [Math.min(...ratings), Math.max(...ratings)];
}

/** Full-world clubs in staffing order: the richest (or strongest) first, so better staff go to the bigger clubs. */
export function clubsByStaffLevel<T extends Pick<Team, 'id'>>(context: LevelContext, clubs: readonly T[]): T[] {
  const levels = clubStaffLevels(context);
  return [...clubs].sort((left, right) => (levels.get(right.id) ?? 0) - (levels.get(left.id) ?? 0) || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

type RenewableContract = { clubId: string; seasonNumber: number; releasedRound: number | null; renew: boolean };
/**
 * Computer clubs' renewals at a rollover (format 74), decided before any renewal: each club keeps one training coach
 * (its first), and anyone whose new-season fee is above the role's share of the new season's staff budget leaves, so
 * the role is filled again at the club's new level (after relegation or a poor board verdict, for example). Extra
 * training coaches can be hired again in the season once every role is filled. The manager's renewals are unchanged.
 */
export function planComputerStaffRenewals(state: SeasonState, previous: SeasonCoaching): { state: SeasonState; coaching: SeasonCoaching } {
  if (!usesClubLevelStaff(state)) return { state, coaching: previous };
  const year = state.seasonNumber - 1;
  const fits = (clubId: string, role: StaffRole, fee: number | undefined) => fee !== undefined && staffFee(state, clubId, fee) <= staffShareCap(state, clubId, role);
  const renewing = (contract: RenewableContract) => contract.clubId !== state.managedClubId && contract.releasedRound === null && contract.renew;
  const kept = new Set<string>();
  const coaching = { ...previous, contracts: previous.contracts.map(contract => {
    if (!renewing(contract)) return contract;
    const first = !kept.has(contract.clubId);
    kept.add(contract.clubId);
    return first && fits(contract.clubId, 'coaches', staffMember(COACH_DIRECTORY, contract.coachId)?.fee) ? contract : { ...contract, renew: false };
  }) };
  const plan = <C extends RenewableContract>(contracts: C[], role: StaffRole, fee: (contract: C) => number | undefined): C[] => contracts.map(contract => contract.seasonNumber === year && renewing(contract) && !fits(contract.clubId, role, fee(contract)) ? { ...contract, renew: false } : contract);
  return { coaching, state: { ...state,
    scouts: { ...state.scouts, contracts: plan(state.scouts.contracts, 'scouts', contract => staffMember(SCOUT_DIRECTORY, contract.scoutId)?.fee) },
    fitness: { ...state.fitness, contracts: plan(state.fitness.contracts, 'fitness', contract => staffMember(FITNESS_DIRECTORY, contract.coachId)?.fee) },
    physio: { ...state.physio, contracts: plan(state.physio.contracts, 'physio', contract => staffMember(PHYSIO_DIRECTORY, contract.physioId)?.fee) },
    assistant: { ...state.assistant, contracts: plan(state.assistant.contracts, 'assistant', contract => staffMember(ASSISTANT_DIRECTORY, contract.assistantId)?.fee) },
    youth: { ...state.youth, contracts: plan(state.youth.contracts, 'youth', contract => staffMember(YOUTH_COACH_DIRECTORY, contract.coachId)?.fee) },
  } };
}
