import { describe, expect, it } from 'vitest';
import { DEVELOPMENT_CLUBS } from '../src/data/development-league';
import { DEFAULT_PLAYER_AGE } from '../src/data/development-player-profiles';
import { validateSeasonState } from '../src/storage/season-storage';
import { createSeason, dateForRound } from '../src/world/season';
import { createTraining, developClub, processTrainingWeek, TRAINING_ATTRIBUTES, trainingPointCap, type TrainingWeekInput } from '../src/world/training';
import { maximumHeadroomForAge, playerHeadroom, potentialAge, potentialAttributes, potentialHeadroom, potentialShareBasisPoints, skillHeadroom, trainingHeadroom } from '../src/world/potential';
import { getPlayerKnowledge, getPotentialKnowledge } from '../src/world/scouting-policy';
import { abilityRating } from '../src/world/performance-rating';

const players = DEVELOPMENT_CLUBS.flatMap(club => club.players);
const byId = (id: string) => players.find(player => player.id === id)!;
const newCareer = { seed: 42, training: { model: 'training-2' as const } };
function week(seed: number, focus: 'passing' | 'balanced' = 'passing'): TrainingWeekInput {
  const training = createTraining(DEVELOPMENT_CLUBS);
  for (const plan of Object.values(training.plans)) Object.assign(plan, { delegated: false, intensity: 'standard', focus });
  return { seed, training, clubs: DEVELOPMENT_CLUBS, conditions: Object.fromEntries(players.map(player => [player.id, 80])), injuries: [], seasonNumber: 1, afterRound: 1, fromDate: dateForRound(1), toDate: dateForRound(2) };
}

describe('hidden player potential', () => {
  it('gives the most headroom to the youngest players by age at the career start', () => {
    expect([15, 19, 20, 21, 22, 23, 24, 26, 27, 29, 30, 38].map(maximumHeadroomForAge)).toEqual([8, 8, 6, 6, 4, 4, 2, 2, 1, 1, 0, 0]);
    // Ages on the built-in league's first matchday (5 September 2026), not on later dates.
    expect(potentialAge({ seed: 1 }, 'rhf-10')).toBe(19); // born 21 January 2007
    expect(potentialAge({ seed: 1 }, 'alp-10')).toBe(18);
    expect(potentialAge({ seed: 1 }, 'adr-3')).toBe(36);
    expect(potentialAge({ seed: 1 }, 'unknown-player')).toBe(DEFAULT_PLAYER_AGE);
  });

  it('is deterministic per career and player, from its own stream, within 25-100% of the age band', () => {
    for (const seed of [1, 42, 227, 0xffff_ffff]) for (const player of players) {
      const share = potentialShareBasisPoints(seed, player.id);
      expect(share).toBeGreaterThanOrEqual(2_500); expect(share).toBeLessThanOrEqual(10_000);
      expect(potentialShareBasisPoints(seed, player.id)).toBe(share);
      const headroom = playerHeadroom({ seed }, player.id), maximum = maximumHeadroomForAge(potentialAge({ seed }, player.id));
      expect(headroom).toBe(Math.round(maximum * share / 10_000));
      expect(headroom).toBeLessThanOrEqual(maximum);
      expect(headroom).toBeGreaterThanOrEqual(Math.round(maximum / 4));
    }
    const shares = Array.from({ length: 4_000 }, (_, index) => potentialShareBasisPoints(42, `player-${index}`));
    expect(Math.min(...shares)).toBeLessThan(2_600); expect(Math.max(...shares)).toBeGreaterThan(9_900);
    // Another career draws other potentials for the same players.
    expect(players.some(player => potentialShareBasisPoints(42, player.id) !== potentialShareBasisPoints(43, player.id))).toBe(true);
    expect(() => potentialShareBasisPoints(Number.NaN, 'rhf-1')).toThrow(/career seed/);
  });

  it('never raises a skill above 20 and reports the reachable skills', () => {
    expect(skillHeadroom(8, 18)).toBe(2); expect(skillHeadroom(8, 20)).toBe(0); expect(skillHeadroom(0, 5)).toBe(0); expect(skillHeadroom(3, 10)).toBe(3);
    for (const player of players) {
      const headroom = potentialHeadroom({ seed: 42 }, player), reachable = potentialAttributes({ seed: 42 }, player);
      for (const attribute of TRAINING_ATTRIBUTES) {
        expect(reachable[attribute]).toBe(Math.min(20, player.attributes[attribute] + playerHeadroom({ seed: 42 }, player.id)));
        expect(reachable[attribute] - player.attributes[attribute]).toBe(headroom[attribute]);
        expect(trainingPointCap(newCareer, player, attribute)).toBe(headroom[attribute] * 100);
      }
    }
  });

  it('limits weekly training at the player\'s potential instead of two rating points', () => {
    const young = byId('rhf-10'), old = byId('adr-3');
    expect(playerHeadroom({ seed: 42 }, young.id)).toBeGreaterThan(2);
    expect(playerHeadroom({ seed: 42 }, old.id)).toBe(0);
    const input = week(42);
    input.training.points[young.id]!.passing = 200; // the old limit
    const next = processTrainingWeek(input);
    expect(next.training.points[young.id]!.passing).toBe(228);
    expect(next.training.points[old.id]!.passing).toBe(0);
    expect(next.training.lastWeek!.players[old.id]!.gains.passing).toBe(0);
    // At the cap, practice stops exactly there; one point more is refused as outside the development limits.
    const cap = trainingPointCap(newCareer, young, 'passing'), almost = week(42);
    almost.training.points[young.id]!.passing = cap - 10;
    expect(processTrainingWeek(almost).training.points[young.id]!.passing).toBe(cap);
    almost.training.points[young.id]!.passing = cap + 1;
    expect(() => processTrainingWeek(almost)).toThrow(/development limits/);
    expect(() => developClub(DEVELOPMENT_CLUBS[0]!, almost.training, { seed: 42 })).toThrow(/development limits/);
    almost.training.points[young.id]!.passing = cap;
    expect(developClub(DEVELOPMENT_CLUBS[0]!, almost.training, { seed: 42 }).players.find(player => player.id === young.id)!.attributes.passing).toBe(Math.min(20, young.attributes.passing + playerHeadroom({ seed: 42 }, young.id)));
  });

  it('checks saved training points against each player\'s potential', () => {
    const state = createSeason(42, 'rhine-falcons');
    expect(playerHeadroom(state, 'rhf-3')).toBe(0);
    const capped = structuredClone(state); capped.training.points['rhf-3']!.passing = 1;
    expect(() => validateSeasonState(capped)).toThrow(/training\.points\.rhf-3\.passing/);
    // Within his potential, a young player's point is refused only by the week budget.
    const young = structuredClone(state); young.training.points['rhf-10']!.passing = 1;
    expect(() => validateSeasonState(young)).toThrow(/training\.points\.rhf-10 exceeds available training weeks/);
  });

  it('keeps the fixed two-point limit in careers created before hidden potential', () => {
    const legacy = { seed: 42, training: { model: 'training-1' as const } }, old = byId('adr-3');
    expect(createTraining(DEVELOPMENT_CLUBS).model).toBe('training-2');
    expect(trainingHeadroom(legacy, old.id)).toBe(2);
    expect(trainingHeadroom(newCareer, old.id)).toBe(0);
    for (const attribute of TRAINING_ATTRIBUTES) expect(trainingPointCap(legacy, old, attribute)).toBe(Math.min(200, (20 - old.attributes[attribute]) * 100));
    const input = week(42);
    input.training = { ...input.training, model: 'training-1' };
    input.training.points[old.id]!.passing = 150;
    expect(processTrainingWeek(input).training.points[old.id]!.passing).toBe(178);
    expect(developClub(DEVELOPMENT_CLUBS.find(club => club.players.includes(old))!, processTrainingWeek(input).training, legacy).players.find(player => player.id === old.id)!.attributes.passing).toBe(old.attributes.passing + 1);
  });

  it('shows potential as a narrow range for the own squad and keeps unscouted players unknown', () => {
    const state = createSeason(42, 'rhine-falcons', 'off', true, false, true, true, null, true, true);
    const own = getPotentialKnowledge(state, 'rhf-10');
    expect(own.kind).toBe('report');
    const reachable = potentialAttributes(state, byId('rhf-10'));
    for (const attribute of TRAINING_ATTRIBUTES) {
      const range = own.ranges![attribute];
      expect(range.min).toBeGreaterThanOrEqual(byId('rhf-10').attributes[attribute]);
      expect(range.min).toBeLessThanOrEqual(reachable[attribute]); expect(range.max).toBeGreaterThanOrEqual(reachable[attribute]);
      expect(range.max - range.min).toBeLessThanOrEqual(2);
    }
    const rating = abilityRating(own, { position: 'C' });
    expect(rating.kind).toBe('range');
    expect(rating.max! - rating.min!).toBeLessThanOrEqual(1.5);
    expect(getPotentialKnowledge(state, 'aeg-10')).toMatchObject({ kind: 'unknown', ranges: null });
  });

  it('narrows a scouted potential range with more observations and never places it below the ability range', () => {
    const state = createSeason(42, 'rhine-falcons', 'off', true, false, true, true, null, true, true), target = byId('aeg-10');
    const review = { playerId: target.id, seasonNumber: 1, round: 1, date: state.date, clubId: 'aegean-waves', rosterId: 'test-roster', outcome: 'observed' as const, attributes: target.attributes };
    const observed = (count: number) => {
      const next = structuredClone(state);
      next.scouting.clubs['rhine-falcons']!.reviews = Array.from({ length: count }, () => ({ ...review }));
      return next;
    };
    const widths = (count: number) => {
      const next = observed(count), potential = getPotentialKnowledge(next, target.id), ability = getPlayerKnowledge(next, target.id), reachable = potentialAttributes(next, target);
      expect(potential).toMatchObject({ kind: 'report', level: count });
      for (const attribute of TRAINING_ATTRIBUTES) {
        const range = potential.ranges![attribute];
        expect(range.min).toBeLessThanOrEqual(reachable[attribute]); expect(range.max).toBeGreaterThanOrEqual(reachable[attribute]);
        expect(range.min).toBeGreaterThanOrEqual(ability.ranges![attribute].min); expect(range.max).toBeGreaterThanOrEqual(ability.ranges![attribute].max);
      }
      return TRAINING_ATTRIBUTES.reduce((sum, attribute) => sum + potential.ranges![attribute].max - potential.ranges![attribute].min, 0);
    };
    expect(widths(1)).toBeGreaterThan(widths(3));
  });
});
