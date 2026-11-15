import type { SeasonState } from '../domain/season';
import type { SeasonTraining } from '../domain/training';
import type { Player, PlayerAttributes } from '../domain/types';
import type { WorldContext } from '../domain/world';
import { DEFAULT_PLAYER_AGE, playerAgeOnDate } from '../data/development-player-profiles';
import { worldOf } from './career-world';
import { lifecycleDateOfBirth } from './lifecycle-policy';

/**
 * Hidden potential (sprint 4, owner feedback point 7): how many rating points practice can still add to each of a
 * player's skills. It is derived, never stored: the career seed, the player's identity and his age at the career
 * start decide it, so the simulation, the save checks and the screens always agree. Practice keeps the existing model
 * of 100 training points per rating point; potential only replaces the old fixed limit of two rating points.
 */
export const POTENTIAL_ATTRIBUTES = ['twoPoint', 'threePoint', 'freeThrow', 'passing', 'defense', 'rebounding', 'stamina'] as const;
export const POTENTIAL_RULES = Object.freeze({
  /** The most rating points a player of this age at the career start can add to a skill (the first band that fits). */
  ageBands: Object.freeze([
    Object.freeze({ maxAge: 19, points: 8 }), Object.freeze({ maxAge: 21, points: 6 }), Object.freeze({ maxAge: 23, points: 4 }),
    Object.freeze({ maxAge: 26, points: 2 }), Object.freeze({ maxAge: 29, points: 1 }),
  ]),
  /** Thirty or older at the career start: practice keeps skills, it no longer raises them. */
  olderPoints: 0,
  /** Each player's share of his age band's maximum, a stable value from 25% to 100% (basis points). */
  minShareBasisPoints: 2_500,
  maxShareBasisPoints: 10_000,
  /** No skill exceeds the 1-20 scale. */
  ceiling: 20,
});

/** What the rule needs: the career seed, its world (birth dates and start date) and academy prospects' birth dates. */
export type PotentialContext = Pick<SeasonState, 'seed'> & Partial<Pick<SeasonState, 'academy'>> & WorldContext;

/** The age band's maximum headroom in rating points. */
export function maximumHeadroomForAge(age: number): number {
  if (!Number.isFinite(age)) throw new Error('Potential needs a valid player age.');
  return POTENTIAL_RULES.ageBands.find(band => age <= band.maxAge)?.points ?? POTENTIAL_RULES.olderPoints;
}

/**
 * Its own deterministic stream (FNV-1a with a final avalanche): potential never consumes match randomness and does
 * not follow the retirement, scouting or contract streams.
 */
export function potentialShareBasisPoints(seed: number, playerId: string): number {
  if (!Number.isInteger(seed)) throw new Error('Potential needs the career seed.');
  let hash = (2166136261 ^ seed) >>> 0;
  for (const character of `potential:${playerId}`) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  hash ^= hash >>> 16; hash = Math.imul(hash, 0x85eb_ca6b) >>> 0;
  hash ^= hash >>> 13; hash = Math.imul(hash, 0xc2b2_ae35) >>> 0;
  hash ^= hash >>> 16;
  const { minShareBasisPoints: min, maxShareBasisPoints: max } = POTENTIAL_RULES;
  return min + (hash >>> 0) % (max - min + 1);
}

/**
 * The player's age on the career's first matchday. Unknown birth dates use the default age; a player born after the
 * career start (a much later academy intake) counts as the youngest.
 */
export function potentialAge(context: PotentialContext, playerId: string): number {
  const dateOfBirth = lifecycleDateOfBirth(context, playerId), start = worldOf(context).startDate;
  if (!dateOfBirth) return DEFAULT_PLAYER_AGE;
  const age = playerAgeOnDate(dateOfBirth, start);
  if (age !== null) return age;
  return /^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth) && dateOfBirth > start ? 0 : DEFAULT_PLAYER_AGE;
}

/** Whole rating points of headroom before the 1-20 ceiling: the age band's maximum times the player's share, rounded. */
export function playerHeadroom(context: PotentialContext, playerId: string): number {
  return Math.floor((maximumHeadroomForAge(potentialAge(context, playerId)) * potentialShareBasisPoints(context.seed, playerId) + 5_000) / 10_000);
}

/** Careers created before hidden potential (training model `training-1`) keep the first model's two rating points. */
export const LEGACY_TRAINING_HEADROOM = 2;

/** The headroom the career's training model gives: hidden potential, or the legacy two points in older careers. */
export function trainingHeadroom(context: PotentialContext & { training: Pick<SeasonTraining, 'model'> }, playerId: string): number {
  return context.training.model === 'training-1' ? LEGACY_TRAINING_HEADROOM : playerHeadroom(context, playerId);
}

/** One skill's headroom: the player's headroom, never above 20 in total. */
export function skillHeadroom(headroom: number, baseRating: number): number {
  return Math.max(0, Math.min(headroom, POTENTIAL_RULES.ceiling - baseRating));
}

/** Rating points practice can still add to each skill of the player's authored (or graduation) ratings. */
export function potentialHeadroom(context: PotentialContext, player: Pick<Player, 'id' | 'attributes'>): PlayerAttributes {
  const headroom = playerHeadroom(context, player.id);
  return Object.fromEntries(POTENTIAL_ATTRIBUTES.map(attribute => [attribute, skillHeadroom(headroom, player.attributes[attribute])])) as unknown as PlayerAttributes;
}

/** The skills the player can reach through practice: each skill raised by its headroom, at most 20. */
export function potentialAttributes(context: PotentialContext, player: Pick<Player, 'id' | 'attributes'>, headroom = playerHeadroom(context, player.id)): PlayerAttributes {
  return Object.fromEntries(POTENTIAL_ATTRIBUTES.map(attribute => [attribute, player.attributes[attribute] + skillHeadroom(headroom, player.attributes[attribute])])) as unknown as PlayerAttributes;
}

/** Training points one skill may hold: 100 per rating point of headroom. */
export function potentialPointCap(headroom: number, baseRating: number): number {
  return skillHeadroom(headroom, baseRating) * 100;
}

export const POTENTIAL_RATING_DESCRIPTION = 'Potential: the overall rating the player could reach through practice. It is hidden and always shown as an estimated range: scouting narrows it, and your own players\' range is narrow.';
