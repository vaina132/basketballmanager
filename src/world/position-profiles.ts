import type { PlayerAttributes, Position, SkillAttributes } from '../domain/types';
import type { CareerWorld } from '../domain/world';
import { OVR_POSITION_WEIGHTS, overallRating } from './overall-rating';

/**
 * Format 105 (new real-data careers, marker `world.positionProfiles`): generated players are shaped like real players
 * of their position and rating.
 *
 * Ten automatic seasons had shown the three-point share of shots in Liga ACB and the Süper Ligi rising from about 43%
 * to 49-51% (2 points in the NBA) and free-throw percentage from 77% to 80-81% in the NBA. Most real players retire
 * within ten seasons and generated players replace them (academy graduates in Europe, draft prospects in the NBA: about
 * four in five top-division players by season 11). Their skills were flat: an academy centre started with the same
 * three-point and free-throw shooting as a guard (7-11 for every skill plus two on two skills of his position), and a
 * draft centre, rated to an overall, was nudged up one skill at a time through all seven skills. Clubs choose players by
 * the overall rating, which weighs the skills a position needs, so the league filled with centres who shoot threes and
 * free throws like forwards (Liga ACB centres by season 11: three-point +4.3, free throws +3.7; NBA centres: free throws
 * +3.8). Removing only that drift from the season-11 squads brought the shares back to season-1 values; the coaches'
 * tactics and the other skills hardly mattered.
 *
 * With this marker a generated player's seven skills follow the mean of real players of his position at his rating
 * (`POSITION_PROFILES`, interpolated between rating bands), moved up or down together to his rating, plus his own
 * variation: a generated centre is strong inside and on the boards and weaker from outside and at the line; an NBA
 * rookie's lower rating sits mostly in defence and stamina, as for real NBA players of that rating. Individuals still
 * differ (the variation, potential, development traits and form). The level of generated players is unchanged: academy
 * prospects keep the position-weighted mean of the earlier rule, draft prospects their target rating.
 */
export const POSITION_PROFILES = Object.freeze({
  /**
   * European domestic leagues (live pack world-16, the 2,480 players of European domestic leagues): by position, rows of
   * [mean overall, then the mean two-point, three-point, free-throw, passing, defence, rebounding and stamina skills]
   * for overall bands under 46, 46-55, 56-63, 64-71 and 72 or more.
   */
  europe: Object.freeze({
    PG: [[36.8, 6.8, 8.5, 11, 12.4, 6.7, 7.3, 7.7], [51, 8.2, 10.8, 12.2, 13.8, 9.4, 8.3, 9.8], [60.2, 9.1, 11.9, 13.1, 14.8, 11.3, 8.7, 11.1], [67.1, 9.9, 12.9, 13.9, 15.5, 12.6, 8.6, 12.3], [77.7, 11, 14.2, 14.2, 17.6, 14.2, 8.4, 12.8]],
    SG: [[37.1, 8.2, 9.5, 11.7, 11, 6.9, 8.7, 8.5], [51.9, 9.3, 11.9, 13.4, 12, 9.9, 9.4, 10.9], [59.1, 10.1, 13.3, 13.3, 12.7, 11.1, 10, 11.4], [66.9, 10.9, 14.3, 14.5, 13.1, 12.6, 10.1, 12.9], [77.9, 12, 15.8, 16, 14.1, 14.8, 9.9, 14.4]],
    SF: [[34, 9, 9, 10, 9.1, 6.6, 10.3, 8.1], [48.6, 10.4, 10.6, 11.5, 10.3, 9.7, 11.2, 10.9], [59.3, 11.6, 12.9, 12.5, 10.9, 11.1, 12.4, 11.9], [67.5, 12.5, 14, 13, 11.2, 13, 12.9, 13.4], [79, 13.5, 15.4, 13.9, 11.9, 15.8, 13.1, 15.9]],
    PF: [[37.4, 10, 7.8, 9.2, 8.4, 6.8, 11.8, 8.2], [51, 11.4, 10.6, 10.1, 9.4, 9.3, 13, 9.9], [58.9, 12.3, 11.2, 10.6, 9.8, 10.9, 13.9, 11.2], [67.3, 13.5, 12.6, 11.2, 10.3, 12.7, 14.2, 12.6], [77, 14.9, 13.3, 12.4, 10.2, 14.2, 15.7, 13.7]],
    C: [[37.1, 10.9, 5.5, 6.6, 7.4, 5.3, 12.8, 6], [51, 13.2, 7.1, 7.5, 8.1, 7.5, 14.3, 7.2], [59.5, 14.3, 7.9, 8.1, 8.4, 9.1, 15.1, 8.6], [66.7, 15.3, 8.2, 8.4, 8.8, 10.2, 16.1, 9.7], [78.5, 17.2, 7, 8.3, 9, 12.2, 17.8, 10.5]],
  }),
  /** The NBA (live pack world-16, all 435 players): bands under 64, 64-69, 70-75, 76-81 and 82 or more. */
  nba: Object.freeze({
    PG: [[59.8, 10.2, 14.5, 13.7, 15.5, 8, 9.5, 5.9], [66.3, 11.1, 13.5, 13.5, 15.7, 11.4, 8.9, 9.6], [72.1, 10.9, 14.1, 13.5, 15.6, 14.2, 8.6, 12.2], [78.4, 11.2, 13.9, 12.8, 16.8, 17, 8.8, 12.8], [88.7, 12.9, 14.6, 13.3, 17.1, 19.3, 9.8, 17]],
    SG: [[59.8, 12.4, 14.9, 13.7, 11.9, 8.8, 10.7, 7.9], [66.3, 11.1, 15.3, 14.9, 12.6, 11.5, 11.1, 10.3], [71.9, 10.9, 16.8, 14.6, 12.1, 13.5, 10.4, 12], [77.8, 12.6, 16.1, 14.5, 12.3, 16.1, 10.5, 13.9], [88.7, 13.8, 15.6, 14.8, 14.5, 19.4, 11.3, 17.4]],
    SF: [[59.8, 13.6, 14.9, 12.6, 12, 8.5, 13, 7.2], [66.2, 13.2, 14.5, 12.8, 11.9, 11.7, 13.1, 10.7], [72.5, 13.2, 14.6, 13.1, 11.9, 14.9, 12.2, 13.8], [78.1, 12.8, 15.4, 12.5, 11.4, 17.2, 12.8, 15.8], [88.5, 14.4, 15.3, 14.6, 13.8, 19.8, 13.1, 16.8]],
    PF: [[60.4, 14, 13.4, 10.8, 11.2, 8.2, 15.4, 6.4], [66.7, 13.9, 13.7, 11.4, 11, 11, 15.3, 9.3], [71.7, 14.1, 13.8, 11, 10.9, 13.4, 15.2, 11.1], [77.8, 13.5, 15.7, 11.3, 10.7, 16.6, 14.3, 13.9], [88.6, 15.7, 13.5, 11.5, 12.4, 19.3, 15.1, 16.4]],
    C: [[59.9, 14.2, 9.7, 7.7, 8.6, 7.2, 17.8, 4.2], [66.5, 14.5, 9.9, 8, 8.9, 10.4, 17.2, 6.4], [72.4, 14.7, 9.9, 7.5, 9.9, 12.5, 17, 9.4], [78, 15, 8.4, 7.5, 8.7, 14.2, 18.6, 9.1], [89.2, 15.2, 8.5, 8.4, 10, 18.4, 18.4, 13.7]],
  }),
} satisfies Record<string, Record<Position, readonly (readonly number[])[]>>);

export type ProfileRegion = keyof typeof POSITION_PROFILES;
const SKILLS = ['twoPoint', 'threePoint', 'freeThrow', 'passing', 'defense', 'rebounding', 'stamina'] as const;
const clampSkill = (value: number) => Math.max(1, Math.min(20, value));

/** Whether the career's world shapes its generated players by position (format 105; pass `worldOf(state)`). */
export function usesPositionProfiles(world: Pick<CareerWorld, 'positionProfiles'>): boolean {
  return world.positionProfiles === true;
}

/** The mean skills of real players of a position at an overall rating: linear between bands, the end band beyond them. */
export function profileAt(region: ProfileRegion, position: Position, overall: number): SkillAttributes {
  const rows = POSITION_PROFILES[region][position];
  let low = rows[0]!, high = rows[0]!;
  if (overall >= rows.at(-1)![0]!) low = high = rows.at(-1)!;
  else for (let index = 1; index < rows.length; index += 1) if (overall < rows[index]![0]!) { low = rows[index - 1]!; high = rows[index]!; break; }
  const share = high === low || overall <= low[0]! ? 0 : (overall - low[0]!) / (high[0]! - low[0]!);
  return Object.fromEntries(SKILLS.map((key, index) => [key, low[index + 1]! + (high[index + 1]! - low[index + 1]!) * share])) as unknown as SkillAttributes;
}

/** Whole skills: the profile moved by `shift`, rounded, plus the player's own whole-point variation, within 1-20. */
export function profiledSkills(profile: SkillAttributes, shift: number, variation: (key: keyof SkillAttributes) => number): SkillAttributes {
  return Object.fromEntries(SKILLS.map(key => [key, clampSkill(Math.round(profile[key] + shift) + variation(key))])) as unknown as SkillAttributes;
}

/** Shifts in twentieths of a point, smallest first (0, +0.05, -0.05, ...), up to ±10. */
function* shifts(): Generator<number> {
  yield 0;
  for (let step = 1; step <= 200; step += 1) { yield step / 20; yield -step / 20; }
}

/** The position-weighted skill of whole skills. */
const weighted = (skills: SkillAttributes, position: Position) => SKILLS.reduce((sum, key) => sum + OVR_POSITION_WEIGHTS[position][key] * skills[key], 0);

/**
 * The profile at `overall` moved by the smallest shift whose rounded skills (without variation) reach `weightedSkill`,
 * the position-weighted mean skill, as closely as the scale allows. Academy prospects use it to keep the earlier rule's
 * level while their variation keeps its spread.
 */
export function profileAtLevel(region: ProfileRegion, position: Position, overall: number, weightedSkill: number): { profile: SkillAttributes; shift: number } {
  const profile = profileAt(region, position, overall);
  let best = 0, bestGap = Infinity;
  for (const shift of shifts()) {
    const gap = Math.abs(weighted(profiledSkills(profile, shift, () => 0), position) - weightedSkill);
    if (gap < bestGap - 1e-9) { best = shift; bestGap = gap; }
  }
  return { profile, shift: best };
}

/**
 * Skills shaped like real players of the position at `target` whose overall rating is as close to it as the scale
 * allows: the profile moves by the smallest shift that reaches the target, then single points move where they bring the
 * overall closest to it (the skills the position weighs most first on a tie). Deterministic; replaces `attributesFor`'s
 * skill-by-skill nudges through all seven skills.
 */
export function profiledAttributesFor(target: number, position: Position, region: ProfileRegion, variation: (key: keyof SkillAttributes) => number): PlayerAttributes {
  const profile = profileAt(region, position, target);
  let best: SkillAttributes | null = null, bestGap = Infinity;
  for (const shift of shifts()) {
    const skills = profiledSkills(profile, shift, variation), gap = Math.abs(overallRating(skills as PlayerAttributes, position) - target);
    if (gap < bestGap) { best = skills; bestGap = gap; }
    if (gap === 0) break;
  }
  const skills = { ...best! } as Record<keyof SkillAttributes, number>;
  const weights = OVR_POSITION_WEIGHTS[position], order = [...SKILLS].sort((a, b) => weights[b] - weights[a] || SKILLS.indexOf(a) - SKILLS.indexOf(b));
  for (let round = 0; round < 20; round += 1) {
    const current = overallRating(skills as PlayerAttributes, position), gap = Math.abs(current - target);
    if (gap === 0) break;
    let move: { key: keyof SkillAttributes; delta: number; gap: number } | null = null;
    for (const key of order) {
      const delta = current < target ? 1 : -1, next = skills[key] + delta;
      if (next < 1 || next > 20) continue;
      const nextGap = Math.abs(overallRating({ ...skills, [key]: next } as PlayerAttributes, position) - target);
      if (nextGap < gap && (!move || nextGap < move.gap)) move = { key, delta, gap: nextGap };
    }
    if (!move) break;
    skills[move.key] += move.delta;
  }
  return skills as unknown as PlayerAttributes;
}

/**
 * Format 105, development: a balanced week's practice goes to each skill as real players of the position differ in it
 * between the lowest and the highest rating band (`growthShares`), so practice makes a centre a better centre rather
 * than a shooter. Each skill keeps at least `minSlope` skill points per rating point, so every skill still grows a
 * little. A focus week still trains its one skill.
 */
export const POSITION_GROWTH = Object.freeze({ minSlope: 0.02 });
const growthCache = new Map<string, Readonly<SkillAttributes>>();

/** A position's balanced practice shares in basis points (summing to 10,000), from its rating bands. */
export function growthShares(region: ProfileRegion, position: Position): Readonly<SkillAttributes> {
  const key = `${region}|${position}`, known = growthCache.get(key);
  if (known) return known;
  const rows = POSITION_PROFILES[region][position], first = rows[0]!, last = rows.at(-1)!;
  const slopes = SKILLS.map((_, index) => Math.max(POSITION_GROWTH.minSlope, (last[index + 1]! - first[index + 1]!) / (last[0]! - first[0]!)));
  const total = slopes.reduce((sum, slope) => sum + slope, 0), shares = slopes.map(slope => Math.floor(slope / total * 10_000));
  // The rounding remainder goes to the largest share, so the shares add up to exactly 10,000.
  shares[shares.indexOf(Math.max(...shares))]! += 10_000 - shares.reduce((sum, share) => sum + share, 0);
  const result = Object.freeze(Object.fromEntries(SKILLS.map((skill, index) => [skill, shares[index]!]))) as unknown as Readonly<SkillAttributes>;
  growthCache.set(key, result);
  return result;
}

/**
 * Whole practice points of a balanced week split by growth shares: each skill its share rounded down, the points left
 * one each to the largest remainders (ties in the order of `rotation`, the week's starting skill, as balanced weeks
 * rotate their leftover points). Never negative; the parts add up to `points`.
 */
export function splitByShares(points: number, shares: Readonly<SkillAttributes>, rotation: number): SkillAttributes {
  const parts = SKILLS.map(skill => Math.floor(points * shares[skill] / 10_000));
  const order = SKILLS.map((skill, index) => ({ index, rest: points * shares[skill] % 10_000, turn: (index - rotation % SKILLS.length + SKILLS.length) % SKILLS.length })).sort((a, b) => b.rest - a.rest || a.turn - b.turn);
  for (let left = points - parts.reduce((sum, part) => sum + part, 0), next = 0; left > 0; left -= 1, next += 1) parts[order[next % SKILLS.length]!.index]! += 1;
  return Object.fromEntries(SKILLS.map((skill, index) => [skill, parts[index]!])) as unknown as SkillAttributes;
}
