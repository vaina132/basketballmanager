import type { SeasonCoaching } from '../domain/coaching';
import type { Team } from '../domain/types';
import type { CareerWorld, WorldContext } from '../domain/world';
import { clubEconomy } from './economy';
import { overallRating } from './overall-rating';
import { worldOf } from './career-world';
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
  return state.coaching?.model === 'coaching-2';
}

/**
 * The clubs a staff market serves (format 74): the season's full-world clubs when known, otherwise the world's clubs.
 * Background and lower-division clubs employ no one, so they no longer widen the market.
 */
export function staffMarketWorld(context: WorldContext & { clubs?: readonly Team[] }): Pick<CareerWorld, 'clubs'> {
  return context.clubs ? { clubs: context.clubs } : worldOf(context);
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
