/**
 * The position-weighted overall rating (1-99) and its stars. Dependency-free on purpose: the real-data scripts
 * import this file directly with Node, so their human-check reports show the same numbers as the game.
 */
import type { PlayerAttributes, SkillAttributes, Position } from '../domain/types';

type SkillWeights = Readonly<Record<keyof SkillAttributes, number>>;
const SKILLS: readonly (keyof SkillAttributes)[] = ['twoPoint', 'threePoint', 'freeThrow', 'passing', 'defense', 'rebounding', 'stamina'];

/** What each position needs most; every row sums to 1. Guards lean on passing and shooting, bigs on inside scoring and rebounding. */
export const OVR_POSITION_WEIGHTS: Readonly<Record<Position, SkillWeights>> = {
  PG: { twoPoint: 0.15, threePoint: 0.20, freeThrow: 0.08, passing: 0.27, defense: 0.15, rebounding: 0.05, stamina: 0.10 },
  SG: { twoPoint: 0.18, threePoint: 0.26, freeThrow: 0.10, passing: 0.14, defense: 0.17, rebounding: 0.06, stamina: 0.09 },
  SF: { twoPoint: 0.20, threePoint: 0.20, freeThrow: 0.08, passing: 0.10, defense: 0.18, rebounding: 0.14, stamina: 0.10 },
  PF: { twoPoint: 0.24, threePoint: 0.12, freeThrow: 0.06, passing: 0.08, defense: 0.20, rebounding: 0.22, stamina: 0.08 },
  C: { twoPoint: 0.26, threePoint: 0.04, freeThrow: 0.06, passing: 0.07, defense: 0.22, rebounding: 0.28, stamina: 0.07 },
};
const POSITIONS = Object.keys(OVR_POSITION_WEIGHTS) as Position[];
const BALANCED_WEIGHTS = Object.fromEntries(SKILLS.map(key => [key, POSITIONS.reduce((sum, position) => sum + OVR_POSITION_WEIGHTS[position][key], 0) / POSITIONS.length])) as SkillWeights;
/** Each point of weighted skill (1-20) is worth 8 rating points: a weighted 12 is 60, a weighted 15 is 84. */
export const OVR_SCALE = { perSkillPoint: 8, offset: -36, min: 1, max: 99 } as const;
/** 85 or more is five stars; every 6 points less is half a star less, down to one star below 43. */
export const OVR_STAR_SCALE = { fiveStars: 85, halfStarStep: 6 } as const;

/** Position-weighted overall rating from 1 to 99; an unknown position weighs the five positions equally. Not potential, and not a match prediction. */
export function overallRating(attributes: PlayerAttributes, position?: Position | null): number {
  const weights = position ? OVR_POSITION_WEIGHTS[position] : BALANCED_WEIGHTS;
  const weighted = SKILLS.reduce((sum, key) => sum + weights[key] * attributes[key], 0);
  return Math.max(OVR_SCALE.min, Math.min(OVR_SCALE.max, Math.round(OVR_SCALE.perSkillPoint * weighted + OVR_SCALE.offset)));
}

export function overallRatingStars(ovr: number): number {
  const halfSteps = Math.floor((ovr - OVR_STAR_SCALE.fiveStars) / OVR_STAR_SCALE.halfStarStep) + 8;
  return Math.max(1, Math.min(5, 1 + halfSteps / 2));
}
