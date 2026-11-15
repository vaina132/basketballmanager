import { describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { DEVELOPMENT_COACHES } from '../src/data/development-coaches';
import { DEVELOPMENT_CLUBS } from '../src/data/development-league';
import { setAutoSubstitutions, simulateToEnd, stepMatch } from '../src/engine/match';
import { availableCoaches, coachingAssignments, coachingCommitted, coachingRatingForAttribute, COACHING_BUDGET, coachRating, createCoaching, enableCoaching, getClubCoaching, hireCoach, MAX_COACHES, recruitAiCoaches, releaseCoach, rolloverCoaching, setCoachAssignment, setCoachRenewal } from '../src/world/coaching';
import { advanceSeason, createSeason, dateForRound, managedSide, rolloverSeason } from '../src/world/season';
import { createTraining, processTrainingWeek, setTrainingPlan, TRAINING_ATTRIBUTES } from '../src/world/training';
import type { TrainingWeekInput } from '../src/world/training';

const clubId = DEVELOPMENT_CLUBS[0]!.id;
const player = DEVELOPMENT_CLUBS[0]!.players[0]!;
const total = (values: Record<string, number>) => Object.values(values).reduce((sum, value) => sum + value, 0);
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function finish(state: SeasonState): SeasonState {
  return state.activeMatch!.status === 'finished' ? state : { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch!, managedSide(state), true)) };
}
function trainingWeek(): TrainingWeekInput {
  const training = createTraining(DEVELOPMENT_CLUBS);
  for (const plan of Object.values(training.plans)) Object.assign(plan, { delegated: false, intensity: 'heavy', focus: 'freeThrow' });
  return { training, clubs: DEVELOPMENT_CLUBS, conditions: Object.fromEntries(DEVELOPMENT_CLUBS.flatMap(club => club.players.map(player => [player.id, 100]))), injuries: [], seasonNumber: 1, afterRound: 1, fromDate: dateForRound(1), toDate: dateForRound(2), coaching: createCoaching(DEVELOPMENT_CLUBS) };
}

describe('fictional coaches and contract decisions', () => {
  it('starts every enabled club with one distinct coach under the same budget and slot rules', () => {
    expect(DEVELOPMENT_COACHES).toHaveLength(30);
    expect(new Set(DEVELOPMENT_COACHES.map(coach => coach.id)).size).toBe(30);
    for (const coach of DEVELOPMENT_COACHES) {
      expect(coach.fee).toBeGreaterThanOrEqual(3_500_000); expect(coach.fee).toBeLessThanOrEqual(8_000_000);
      expect(Object.values(coach.skills).every(rating => Number.isInteger(rating) && rating >= 1 && rating <= 10)).toBe(true);
      expect(coachRating(coach)).toBe(Math.round(total(coach.skills) / 7));
    }
    const state = createSeason();
    expect(state.coaching.enabledSince).toEqual({ seasonNumber: 1, round: 1 });
    expect(state.coaching.contracts).toHaveLength(6);
    for (const club of state.clubs) {
      expect(getClubCoaching(state.coaching, club.id)).toHaveLength(1);
      expect(coachingCommitted(state.coaching, club.id)).toBe(4_000_000);
    }
    expect(availableCoaches(state.coaching, state)).toHaveLength(24);
    expect(MAX_COACHES).toBe(3); expect(COACHING_BUDGET).toBe(15_000_000);
  });

  it('enforces recruitment availability, ownership, full-season budget and three positions atomically', () => {
    const original = freeze(createSeason(9, clubId, 'off'));
    const before = structuredClone(original);
    expect(() => hireCoach(original, 'coach-02')).toThrow(/active club contract/);
    expect(() => hireCoach(original, 'unknown')).toThrow(/staff pool/);
    expect(() => releaseCoach(original, original.coaching.contracts[1]!.id)).toThrow(/your club/);
    expect(() => setCoachAssignment(original, original.coaching.contracts[1]!.id, 'defense')).toThrow(/your club/);
    const expensive = hireCoach(original, 'coach-14');
    expect(coachingCommitted(expensive.coaching, clubId)).toBe(12_000_000);
    expect(() => hireCoach(expensive, 'coach-25')).toThrow(/budget/);
    const full = hireCoach(hireCoach(original, 'coach-25'), 'coach-26');
    expect(getClubCoaching(full.coaching, clubId)).toHaveLength(3);
    expect(coachingCommitted(full.coaching, clubId)).toBe(11_000_000);
    expect(() => hireCoach(full, 'coach-27')).toThrow(/three coaching positions/);
    expect(original).toEqual(before);
  });

  it('keeps released fees committed and requires a new charged contract when rehiring', () => {
    const original = createSeason(9, clubId, 'off'), first = getClubCoaching(original.coaching, clubId)[0]!;
    const released = releaseCoach(original, first.id);
    expect(getClubCoaching(released.coaching, clubId)).toEqual([]);
    expect(coachingCommitted(released.coaching, clubId)).toBe(4_000_000);
    expect(availableCoaches(released.coaching, released).some(coach => coach.id === first.coachId)).toBe(true);
    const rehired = hireCoach(released, first.coachId, 'passing');
    expect(coachingCommitted(rehired.coaching, clubId)).toBe(8_000_000);
    expect(getClubCoaching(rehired.coaching, clubId)[0]).toMatchObject({ id: 'coach-s1-c7', startedRound: 1, focus: 'passing', renew: true });
    expect(rehired.coaching.contracts[0]!.releasedRound).toBe(1);
    expect(coachingAssignments(rehired.coaching, rehired.clubs, 1, 1)![clubId]!.map(assignment => assignment.contractId)).toEqual(['coach-s1-c7']);
    expect(() => releaseCoach(rehired, first.id)).toThrow(/active coach/);
  });

  it('enables and edits future staff without changing the current match, training report or sporting RNG', () => {
    let state = advanceSeason(finish(createSeason(4, clubId, 'off', true, false)));
    const current = freeze(state), before = structuredClone(current);
    state = enableCoaching(current);
    expect(state.coaching.enabledSince).toEqual({ seasonNumber: 1, round: 2 });
    expect(state.coaching.contracts.every(contract => contract.startedRound === 2)).toBe(true);
    expect(coachingAssignments(state.coaching, state.clubs, 1, 1)).toBeNull();
    const contract = getClubCoaching(state.coaching, clubId)[0]!;
    state = setCoachAssignment(state, contract.id, 'freeThrow');
    state = setCoachRenewal(state, contract.id, false);
    expect(state.activeMatch!).toBe(current.activeMatch!);
    expect(state.training.lastWeek).toBe(current.training.lastWeek);
    expect(stepMatch(state.activeMatch!)).toEqual(stepMatch(current.activeMatch!));
    expect(current).toEqual(before);
    expect(enableCoaching(state)).toBe(state);
    expect(() => setCoachAssignment(state, contract.id, 'unknown' as never)).toThrow(/assignment/);
    expect(() => setCoachRenewal(state, contract.id, 1 as never)).toThrow(/whether/);
  });
});

describe('coaching contribution to authoritative training', () => {
  it('uses the strongest matching specialist or half-rated balanced coach without stacking', () => {
    const assignments = [{ contractId: 'a', coachId: 'coach-09', focus: 'freeThrow' as const }, { contractId: 'b', coachId: 'coach-01', focus: 'balanced' as const }];
    expect(coachingRatingForAttribute(assignments, 'freeThrow')).toBe(10);
    expect(coachingRatingForAttribute([...assignments, assignments[0]!], 'freeThrow')).toBe(10);
    expect(coachingRatingForAttribute([assignments[0]!], 'defense')).toBe(0);
    expect(coachingRatingForAttribute([assignments[1]!], 'freeThrow')).toBe(3);
    const state = hireCoach(createSeason(), 'coach-09', 'freeThrow');
    const input = { ...trainingWeek(), coaching: state.coaching };
    const result = processTrainingWeek(input), report = result.training.lastWeek!.players[player.id]!;
    expect(report.gains.freeThrow).toBe(43);
    expect(report.coachingGains.freeThrow).toBe(8);
    expect(total(report.gains)).toBe(43);
    expect(result.conditions[player.id]).toBe(processTrainingWeek({ ...input, coaching: undefined }).conditions[player.id]);
  });

  it('apportions balanced weekly coaching before rounding so broad practice benefits', () => {
    const input = trainingWeek();
    for (const plan of Object.values(input.training.plans)) { plan.focus = 'balanced'; plan.intensity = 'standard'; }
    const result = processTrainingWeek(input);
    for (const club of input.clubs) {
      const coach = DEVELOPMENT_COACHES.find(coach => coach.id === getClubCoaching(input.coaching!, club.id)[0]!.coachId)!;
      const expected = Math.floor(TRAINING_ATTRIBUTES.reduce((sum, attribute) => sum + 4 * coach.skills[attribute] / 2 / 40, 0));
      for (const player of club.players) {
        const report = result.training.lastWeek!.players[player.id]!;
        expect(total(report.coachingGains)).toBe(expected);
        expect(total(report.coachingGains)).toBeGreaterThan(0);
        expect(total(report.gains)).toBe(28 + expected);
      }
    }
    expect(processTrainingWeek(input)).toEqual(result);
  });

  it('charges base headroom first, caps actual coaching gains, and grants nothing for recovery or absence', () => {
    const state = hireCoach(createSeason(), 'coach-09', 'freeThrow');
    const input = { ...trainingWeek(), coaching: state.coaching };
    input.training.points[player.id]!.freeThrow = 160;
    const capped = processTrainingWeek(input);
    expect(capped.training.points[player.id]!.freeThrow).toBe(200);
    expect(capped.training.lastWeek!.players[player.id]!.gains.freeThrow).toBe(40);
    expect(capped.training.lastWeek!.players[player.id]!.coachingGains.freeThrow).toBe(5);
    const resting = trainingWeek();
    resting.training.plans[clubId]!.intensity = 'recovery';
    const rest = processTrainingWeek(resting).training.lastWeek!.players[player.id]!;
    expect(total(rest.gains)).toBe(0); expect(total(rest.coachingGains)).toBe(0);
    const injured = processTrainingWeek({ ...input, injuries: [{ id: 'test', playerId: player.id, clubId, kind: 'ankle', fixtureId: 'dev-r1-g1', occurredOn: input.fromDate, returnOn: '2026-09-20' }] }).training.lastWeek!.players[player.id]!;
    expect(total(injured.gains)).toBe(0); expect(total(injured.coachingGains)).toBe(0);
    const uncoached = processTrainingWeek({ ...trainingWeek(), coaching: undefined }).training.lastWeek!;
    expect(uncoached.coaching).toBeNull();
    expect(Object.values(uncoached.players).every(report => total(report.coachingGains) === 0)).toBe(true);
  });

  it('retains the applied assignment when a coach changes focus or is released after that week', () => {
    let state = createSeason(6, clubId, 'off');
    const contract = getClubCoaching(state.coaching, clubId)[0]!;
    state = setCoachAssignment(state, contract.id, 'freeThrow');
    state = setTrainingPlan(state, { ...state.training.plans[clubId]!, delegated: false, intensity: 'heavy', focus: 'freeThrow' });
    state = advanceSeason(finish(state));
    const report = structuredClone(state.training.lastWeek);
    const reassigned = setCoachAssignment(state, contract.id, 'defense');
    const released = releaseCoach(reassigned, contract.id);
    expect(released.training.lastWeek).toEqual(report);
    expect(report!.coaching![clubId]![0]).toEqual({ contractId: contract.id, coachId: contract.coachId, focus: 'freeThrow' });
    expect(coachingAssignments(released.coaching, state.clubs, 1, 1)![clubId]!.map(item => item.contractId)).toContain(contract.id);
    expect(coachingAssignments(released.coaching, state.clubs, 1, 2)![clubId]).toEqual([]);
  });
});

describe('AI recruitment and season renewal', () => {
  it('recruits deterministically after results, obeys identical limits, and never changes the completed games', () => {
    const enabled = freeze(finish(createSeason(11, clubId, 'off', true, true)));
    const disabled = finish(createSeason(11, clubId, 'off', true, false));
    expect(enabled.activeMatch!).toEqual(disabled.activeMatch!);
    const next = advanceSeason(enabled), baseline = advanceSeason(disabled);
    expect(next.fixtures).toEqual(baseline.fixtures);
    expect(next.coaching.contracts.length).toBeGreaterThan(6);
    expect(getClubCoaching(next.coaching, clubId)).toHaveLength(1);
    for (const club of next.clubs) {
      expect(coachingCommitted(next.coaching, club.id)).toBeLessThanOrEqual(COACHING_BUDGET);
      expect(getClubCoaching(next.coaching, club.id).length).toBeLessThanOrEqual(MAX_COACHES);
    }
    const active = next.coaching.contracts.filter(contract => contract.releasedRound === null);
    expect(new Set(active.map(contract => contract.coachId)).size).toBe(active.length);
    expect(next.coaching.contracts.every(contract => contract.startedRound === 1)).toBe(true);
    expect(advanceSeason(enabled)).toEqual(next);
    expect(recruitAiCoaches(next)).toEqual(next);
    expect(enabled.coaching.contracts).toHaveLength(6);
  });

  it('renews selected active contracts with a fresh budget and leaves disabled careers unchanged', () => {
    let state = hireCoach(createSeason(17, clubId, 'off'), 'coach-25', 'defense');
    const first = getClubCoaching(state.coaching, clubId)[0]!;
    state = setCoachRenewal(state, first.id, false);
    while (state.round < 10) state = advanceSeason(finish(state));
    const beforeFinal = structuredClone(state.coaching);
    state = advanceSeason(finish(state));
    expect(state.coaching).toEqual(beforeFinal);
    expect(() => hireCoach(state, 'coach-30')).toThrow(/next season/);
    const before = structuredClone(state);
    const next = rolloverSeason(state);
    expect(state).toEqual(before);
    const renewed = getClubCoaching(next.coaching, clubId);
    expect(renewed).toHaveLength(1);
    expect(renewed[0]).toMatchObject({ coachId: 'coach-25', focus: 'defense', seasonNumber: 2, startedRound: 1, releasedRound: null, renew: true });
    expect(coachingCommitted(next.coaching, clubId)).toBe(3_500_000);
    expect(next.coaching.contracts.every(contract => contract.id.startsWith('coach-s2-') && contract.startedRound === 1)).toBe(true);
    expect(next.coaching.enabledSince).toEqual(state.coaching.enabledSince);
    expect(next.training.points).toEqual(state.training.points);
    expect(next.training.lastWeek).toBeNull();
    const disabled = createCoaching(state.clubs, 1, 1, false);
    expect(rolloverCoaching(disabled, state.clubs, 2)).toEqual(disabled);
    expect(recruitAiCoaches({ ...next, coaching: disabled }).coaching).toEqual(disabled);
  }, 30_000);
});
