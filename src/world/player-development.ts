import type { SkillAttributes } from '../domain/types';
import type { WorldContext } from '../domain/world';
import { worldOf } from './career-world';

/**
 * Format 101 (owner decision 24 November 2026, new careers in real-data worlds, marker `world.playerDevelopment`):
 * realistic player development. Ten-season careers had shown every player's ratings rising year after year (median
 * +10 to +30, NBA players at 99 from 5 to 48), because practice filled each player's potential within two or three
 * seasons at any age and decline began late and gently. In this model:
 *
 * 1. **Growth follows age.** Practice turns into skill fast from 16 to 21, more slowly to about 26, little from 27 to
 *    29 and hardly at all from 31 (`growthAges`). Potential stays the ceiling, never a promise.
 * 2. **Each player is different.** A stable growth trait (some players develop twice as fast as others, busts and
 *    high achievers), a timing trait (early developers and late bloomers) and an aging trait (some age gracefully)
 *    are drawn per player; each season brings its own form (from a lost season to a breakout one).
 * 3. **Higher skills are harder to raise** (`levelFactors`): above 13 of 20 each further point takes longer; 20 is rare.
 * 4. **Playing time helps young players** (`minutes`): regular minutes in the week's games add practice value, a
 *    bench season costs some.
 * 5. **Decline starts around 29-30** for athletic skills (stamina, defence, rebounding) and later for shooting and
 *    passing, and it speeds up with age (`decline`).
 * 6. **Setbacks**: in any year a player can lose a little in one to three skills (`setbacks`), so some players regress.
 *
 * Everything is derived from the career seed and each player's identity (own deterministic streams; no match
 * randomness is used), so the simulation, the save checks and the screens agree. Older careers keep their rules.
 */
export const PLAYER_DEVELOPMENT_RULES = Object.freeze({
  /**
   * Practice conversion by age (fractional years), basis points of a full week's practice; linear between the points,
   * flat beyond the ends. A practice interval shortened by a midweek game day counts as a full week, so seasons with
   * European or NBA midweek games develop players as much as others (never more than the practice itself).
   */
  growthAges: Object.freeze([[17, 2_400], [20, 2_300], [22, 1_900], [24, 1_450], [26, 950], [28, 550], [30, 250], [32, 0]] as const),
  /** The player's growth trait: a stable share from `min` to `max` basis points (mean of two draws, so most are near 100%). */
  growthTrait: Object.freeze({ min: 3_000, max: 17_000 }),
  /** Timing trait in years (late bloomers develop as if younger): one player in five is early, one in five late. */
  timing: Object.freeze({ early: -1, late: 2, earlyShare: 2_000, lateShare: 2_000 }),
  /**
   * A season's form, basis points: usually the mean of two draws from `min` to `max` (a lost season to a good one); in
   * `breakoutShare` of seasons a breakout from `breakoutMin` to `breakoutMax` (on average about 10,000 in all).
   */
  form: Object.freeze({ min: 0, max: 16_000, breakoutShare: 1_200, breakoutMin: 26_000, breakoutMax: 34_000 }),
  /** Practice value by the skill already reached (1-20); 20 cannot be passed. */
  levelFactors: Object.freeze([10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 9_500, 8_800, 8_000, 7_000, 5_500, 4_000, 0] as const),
  /** Minutes: under `fullAge` the week's playing time moves practice from `bench` to `full` (share of `fullMinutes` a game). */
  minutes: Object.freeze({ bench: 8_500, full: 11_500, fullMinutes: 28, fullAge: 24, fadeAge: 27 }),
  /**
   * Decline per skill in hundredths of a rating point a year: from `onset` (age) at `start`, rising by `slope` a year,
   * at most `max`. The player's aging trait moves the onset by up to `onsetShift` years either way and scales the rates.
   */
  decline: Object.freeze({
    stamina: Object.freeze({ onset: 28, start: 12, slope: 9, max: 90 }),
    defense: Object.freeze({ onset: 29, start: 10, slope: 8, max: 70 }),
    rebounding: Object.freeze({ onset: 29.5, start: 10, slope: 7, max: 60 }),
    twoPoint: Object.freeze({ onset: 30, start: 6, slope: 6, max: 50 }),
    passing: Object.freeze({ onset: 32.5, start: 4, slope: 5, max: 40 }),
    threePoint: Object.freeze({ onset: 32, start: 4, slope: 5, max: 40 }),
    freeThrow: Object.freeze({ onset: 33, start: 3, slope: 4, max: 30 }),
  } satisfies Record<keyof SkillAttributes, { onset: number; start: number; slope: number; max: number }>),
  aging: Object.freeze({ onsetShift: 1.5, minScale: 7_000, maxScale: 13_000 }),
  /** Each birthday from `fromAge`: the chance of a setback (basis points), how many skills it touches (1 to `maxSkills`) and how much each loses (hundredths). */
  setbacks: Object.freeze({ fromAge: 21, chance: 1_200, maxSkills: 3, min: 40, max: 120 }),
});

const SKILLS = ['twoPoint', 'threePoint', 'freeThrow', 'passing', 'defense', 'rebounding', 'stamina'] as const;
const YEAR_DAYS = 365.25;

/** Whether the career develops players with this model (format 101). */
export function usesPlayerDevelopment(context: WorldContext | undefined): boolean {
  return !!context && worldOf(context).playerDevelopment === true;
}

/** FNV-1a with a final avalanche, on its own key: development never consumes match randomness. */
export function developmentHash(seed: number, key: string): number {
  let hash = (2166136261 ^ seed) >>> 0;
  for (const character of key) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  hash ^= hash >>> 16; hash = Math.imul(hash, 0x85eb_ca6b) >>> 0;
  hash ^= hash >>> 13; hash = Math.imul(hash, 0xc2b2_ae35) >>> 0;
  hash ^= hash >>> 16;
  return hash >>> 0;
}

/** A value from min to max, the mean of two even draws (most values near the middle). */
function twoDraws(seed: number, key: string, min: number, max: number): number {
  const span = max - min + 1;
  return min + Math.floor((developmentHash(seed, `${key}:a`) % span + developmentHash(seed, `${key}:b`) % span) / 2);
}

export interface DevelopmentTraits {
  /** How readily practice turns into skill, basis points (10,000 is the usual player). */
  growth: number;
  /** Years by which his development runs late (positive) or early (negative). */
  timing: number;
  /** Years by which his decline starts late (positive) or early (negative). */
  agingOnset: number;
  /** How fast he declines once he does, basis points. */
  agingScale: number;
}

/** A player's stable development traits in this career. */
export function developmentTraits(seed: number, playerId: string): DevelopmentTraits {
  const { growthTrait, timing, aging } = PLAYER_DEVELOPMENT_RULES;
  const roll = developmentHash(seed, `development-timing:${playerId}`) % 10_000;
  const onset = developmentHash(seed, `development-aging-onset:${playerId}`) % 10_001;
  return {
    growth: twoDraws(seed, `development-growth:${playerId}`, growthTrait.min, growthTrait.max),
    timing: roll < timing.earlyShare ? timing.early : roll >= 10_000 - timing.lateShare ? timing.late : 0,
    agingOnset: (onset / 10_000 * 2 - 1) * aging.onsetShift,
    agingScale: twoDraws(seed, `development-aging-scale:${playerId}`, aging.minScale, aging.maxScale),
  };
}

/** The player's form in a season, basis points (10,000 is an ordinary season). */
export function seasonForm(seed: number, playerId: string, seasonNumber: number): number {
  const rule = PLAYER_DEVELOPMENT_RULES.form, key = `development-form:${playerId}:${seasonNumber}`;
  if (developmentHash(seed, `${key}:breakout`) % 10_000 < rule.breakoutShare) return rule.breakoutMin + developmentHash(seed, `${key}:size`) % (rule.breakoutMax - rule.breakoutMin + 1);
  return twoDraws(seed, key, rule.min, rule.max);
}

/** Practice conversion at an age (fractional years), basis points, before the player's traits. */
export function growthAtAge(age: number): number {
  const points = PLAYER_DEVELOPMENT_RULES.growthAges;
  if (age <= points[0][0]) return points[0][1];
  for (let index = 1; index < points.length; index += 1) {
    const [toAge, toRate] = points[index]!, [fromAge, fromRate] = points[index - 1]!;
    if (age <= toAge) return Math.round(fromRate + (toRate - fromRate) * (age - fromAge) / (toAge - fromAge));
  }
  return points[points.length - 1]![1];
}

/** The player's practice conversion at an age: the age curve, moved by his timing and scaled by his growth trait. */
export function playerGrowthRate(seed: number, playerId: string, age: number): number {
  const traits = developmentTraits(seed, playerId);
  return Math.floor(growthAtAge(age - traits.timing) * traits.growth / 10_000);
}

/** Practice value at a skill level (1-20). */
export function levelFactor(skill: number): number {
  return PLAYER_DEVELOPMENT_RULES.levelFactors[Math.max(0, Math.min(20, Math.floor(skill)))]!;
}

/** The week's playing-time factor for a player of this age (minutes a game on average, null when unknown). */
export function minutesFactor(age: number, minutesPerGame: number | null): number {
  const rule = PLAYER_DEVELOPMENT_RULES.minutes;
  if (minutesPerGame === null || age >= rule.fadeAge) return 10_000;
  const share = Math.max(0, Math.min(1, minutesPerGame / rule.fullMinutes));
  const full = rule.bench + (rule.full - rule.bench) * share;
  const weight = age <= rule.fullAge ? 1 : (rule.fadeAge - age) / (rule.fadeAge - rule.fullAge);
  return Math.round(10_000 + (full - 10_000) * weight);
}

/** Rounds `units` x `basis` / 10,000 down or up by a stable draw, so small weekly amounts are not lost on average. */
export function stochasticShare(units: number, basis: number, seed: number, key: string): number {
  if (units <= 0 || basis <= 0) return 0;
  const exact = units * basis, whole = Math.floor(exact / 10_000), rest = exact - whole * 10_000;
  return whole + (rest > 0 && developmentHash(seed, key) % 10_000 < rest ? 1 : 0);
}

/** Age in fractional years between a birth date and a date (both ISO). */
export function fractionalAge(dateOfBirth: string, onDate: string): number {
  return (Date.parse(`${onDate}T00:00:00.000Z`) - Date.parse(`${dateOfBirth}T00:00:00.000Z`)) / 86_400_000 / YEAR_DAYS;
}

/** Cumulative decline of one skill from age `from` to age `to` (years), hundredths. */
export function declineBetween(skill: keyof SkillAttributes, traits: Pick<DevelopmentTraits, 'agingOnset' | 'agingScale'>, from: number, to: number): number {
  const rule = PLAYER_DEVELOPMENT_RULES.decline[skill], onset = rule.onset + traits.agingOnset, capAge = onset + (rule.max - rule.start) / rule.slope;
  const integral = (age: number): number => {
    if (age <= onset) return 0;
    const ramp = Math.min(age, capAge) - onset;
    return rule.start * ramp + rule.slope * ramp * ramp / 2 + (age > capAge ? rule.max * (age - capAge) : 0);
  };
  return Math.max(0, (integral(to) - integral(Math.min(from, to))) * traits.agingScale / 10_000);
}

/** One birthday's setback: hundredths lost per skill (all zero in most years). */
export function birthdaySetback(seed: number, playerId: string, age: number): Record<keyof SkillAttributes, number> {
  const rule = PLAYER_DEVELOPMENT_RULES.setbacks, loss = Object.fromEntries(SKILLS.map(key => [key, 0])) as Record<keyof SkillAttributes, number>;
  const hash = developmentHash(seed, `development-setback:${playerId}:${age}`);
  if (age < rule.fromAge || hash % 10_000 >= rule.chance) return loss;
  const count = 1 + (hash >>> 14) % rule.maxSkills;
  for (let index = 0; index < count; index += 1) {
    const pick = developmentHash(seed, `development-setback:${playerId}:${age}:${index}`);
    loss[SKILLS[pick % SKILLS.length]!] += rule.min + (pick >>> 8) % (rule.max - rule.min + 1);
  }
  return loss;
}
