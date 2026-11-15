import { beforeAll, describe, expect, it } from 'vitest';
import type { FinanceEntry } from '../src/domain/finance';
import type { SeasonInjury, SeasonState } from '../src/domain/season';
import type { TrainingIntensity } from '../src/domain/training';
import { DEVELOPMENT_FITNESS_COACHES } from '../src/data/development-fitness';
import { hireCoach } from '../src/world/coaching';
import { getFinanceBalance } from '../src/world/finance';
import { createFitness, enableFitness, hireFitnessCoach, recruitAiFitnessCoaches, releaseFitnessCoach, setFitnessRenewal } from '../src/world/fitness';
import { availableFitnessCoaches, fitnessAssignments, fitnessEffects, fitnessRating, getClubFitnessCoach, getClubFitnessEffects, quoteFitnessHire } from '../src/world/fitness-policy';
import { getSpendableCash } from '../src/world/payroll-policy';
import { hireScout } from '../src/world/scouts';
import { createSeason, dateForRound } from '../src/world/season';
import { remainingStaffBudget, STAFF_BUDGET, staffCommitmentsByRole, staffCommitted } from '../src/world/staff-policy';
import { processTrainingWeek, type TrainingWeekInput } from '../src/world/training';

const club = 'rhine-falcons', player = 'rhf-1';
const create = (fitness = true) => createSeason(53, club, 'off', true, true, true, true, null, true, true, true, true, true, fitness);
function freeze<T>(value: T): T { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function input(state: SeasonState, intensity: TrainingIntensity = 'heavy', condition = 80): TrainingWeekInput {
  return { seed: state.seed, training: { ...state.training, plans: Object.fromEntries(Object.entries(state.training.plans).map(([id, plan]) => [id, { ...plan, delegated: false, intensity, focus: 'passing' }])) }, clubs: state.clubs, rosters: state.rosters, fitness: state.fitness, conditions: Object.fromEntries(Object.keys(state.conditions).map(id => [id, condition])), injuries: [], seasonNumber: state.seasonNumber, afterRound: state.round, fromDate: dateForRound(state.round, state.seasonNumber), toDate: dateForRound(state.round + 1, state.seasonNumber) };
}
/** Isolated cash positions exercise guards, not portable save history. */
function expense(state: SeasonState, amount: number): SeasonState {
  const entry: FinanceEntry = { id: `test-${state.finance.ledger.length}`, clubId: club, seasonNumber: state.seasonNumber, round: state.round, kind: 'operations', amount: -amount, sourceId: 'fitness-test-obligation', ticket: null, coach: null, payroll: null };
  return { ...state, finance: { ...state.finance, ledger: [...state.finance.ledger, entry] } };
}

describe('fitness appointments and shared staff spending', () => {
  let initial: SeasonState;
  beforeAll(() => { initial = freeze(create()); });

  it('uses prospective activation, preserves the current game and requires training plus finances', () => {
    const legacy = freeze(create(false)), activated = enableFitness(legacy);
    expect(legacy.fitness).toEqual(createFitness());
    expect(activated.fitness.enabledSince).toEqual({ seasonNumber: 1, round: 1, ledgerIndex: legacy.finance.ledger.length });
    expect(activated.activeMatch!).toBe(legacy.activeMatch!);
    expect(activated.conditions).toBe(legacy.conditions);
    expect(activated.training).toBe(legacy.training);
    expect(activated.injuries).toBe(legacy.injuries);
    expect(enableFitness(activated)).toBe(activated);
    expect(() => enableFitness(createSeason(53, club, 'off', false))).toThrow(/training/i);
    expect(() => createSeason(53, club, 'off', false, true, true, true, null, false, false, false, false, false, true)).toThrow(/training/i);
    expect(() => enableFitness({ ...legacy, round: 10 })).toThrow(/before the final matchday/i);
  });

  it('provides bounded named skills without stacking an overall star multiplier', () => {
    expect(new Set(DEVELOPMENT_FITNESS_COACHES.map(coach => coach.id)).size).toBe(DEVELOPMENT_FITNESS_COACHES.length);
    for (const coach of DEVELOPMENT_FITNESS_COACHES) {
      expect(Object.isFrozen(coach)).toBe(true);
      expect(fitnessRating(coach)).toBe(Math.round((coach.skills.recovery + coach.skills.workload) / 2));
      expect(fitnessEffects(coach).recoveryPerDay).toBeLessThanOrEqual(1);
      expect(fitnessEffects(coach).practiceCostReductionPercent).toBeLessThanOrEqual(25);
    }
    expect(fitnessEffects(DEVELOPMENT_FITNESS_COACHES.at(-1)!)).toEqual({ recoveryPerDay: 1, practiceCostReductionPercent: 25 });
  });

  it('charges the exact fee once, limits the club to one coach and releases without refunds', () => {
    const hired = hireFitnessCoach(initial, 'fitness-12'), contract = getClubFitnessCoach(hired)!;
    expect(hired.finance.ledger.at(-1)).toMatchObject({ kind: 'fitness', amount: -5_000_000, sourceId: `fitness-${contract.id}`, fitness: { contractId: contract.id, coachId: 'fitness-12' }, ticket: null, coach: null, payroll: null });
    expect(contract.hiredLedgerIndex).toBe(initial.finance.ledger.length);
    expect(getFinanceBalance(initial.finance, club).cash - getFinanceBalance(hired.finance, club).cash).toBe(5_000_000);
    expect(hired.activeMatch!).toBe(initial.activeMatch!);
    expect(getClubFitnessEffects(hired)).toEqual({ contractId: contract.id, coachId: 'fitness-12', recoveryPerDay: 1, practiceCostReductionPercent: 25 });
    expect(() => hireFitnessCoach(hired, 'fitness-06')).toThrow(/occupied/i);
    const released = releaseFitnessCoach(hired, contract.id);
    expect(released.finance).toBe(hired.finance);
    expect(released.training).toBe(hired.training);
    expect(staffCommitted(released, club)).toBe(staffCommitted(hired, club));
    expect(getClubFitnessCoach(released)).toBeNull();
    expect(availableFitnessCoaches(released).some(coach => coach.id === contract.coachId)).toBe(true);
    expect(released.fitness.contracts.find(item => item.id === contract.id)).toMatchObject({ releasedRound: 1, releasedLedgerIndex: hired.finance.ledger.length });
    expect(() => releaseFitnessCoach(released, contract.id)).toThrow(/active fitness/i);
  });

  it('shares the same allocation across coaches, scouts and fitness in every hiring direction', () => {
    const first = hireFitnessCoach(hireScout(initial, 'scout-06'), 'fitness-12');
    expect(staffCommitmentsByRole(first, club)).toEqual({ coaches: 4_000_000, scouts: 2_000_000, fitness: 5_000_000, physio: 0, assistant: 0, youth: 0, total: 11_000_000 });
    expect(() => hireCoach(first, 'coach-07')).toThrow(/shared staff/i);
    expect(() => hireScout(first, 'scout-19')).toThrow(/shared staff/i);
    const coachesFirst = hireScout(hireCoach(initial, 'coach-07'), 'scout-06');
    expect(quoteFitnessHire(coachesFirst, 'fitness-12')).toMatchObject({ canHire: false, remainingAllocation: 2_000_000 });
    expect(staffCommitted(hireFitnessCoach(coachesFirst, 'fitness-06'), club)).toBe(STAFF_BUDGET);
    expect(remainingStaffBudget(first)).toBe(Math.min(4_000_000, getSpendableCash(first, club)));
  });

  it('guards protected cash, arrears, occupied staff and the final round while renewal remains editable', () => {
    const poor = freeze(expense(initial, getSpendableCash(initial, club) - 1_000_000));
    expect(quoteFitnessHire(poor, 'fitness-06').reason).toMatch(/remaining budget/i);
    expect(() => hireFitnessCoach(poor, 'fitness-06')).toThrow(/budget/i);
    const debt = freeze(expense(initial, getFinanceBalance(initial.finance, club).cash + 1));
    expect(quoteFitnessHire(debt, 'fitness-06').reason).toMatch(/unpaid/i);
    expect(remainingStaffBudget(debt)).toBe(0);
    const employed = initial.fitness.contracts[0]!;
    expect(quoteFitnessHire(initial, employed.coachId).reason).toMatch(/active club/i);
    expect(quoteFitnessHire({ ...initial, round: 10 }, 'fitness-06').reason).toMatch(/next season/i);
    expect(quoteFitnessHire({ ...initial, status: 'complete' }, 'fitness-06').canHire).toBe(false);
    const hired = hireFitnessCoach(initial, 'fitness-06'), contract = getClubFitnessCoach(hired)!;
    const changed = setFitnessRenewal({ ...hired, round: 10 }, contract.id, false);
    expect(getClubFitnessCoach(changed)?.renew).toBe(false);
    expect(changed.finance).toBe(hired.finance);
    expect(() => setFitnessRenewal(hired, contract.id, 'yes' as never)).toThrow(/renew/i);
  });

  it('recruits AI under the same cash, unique-person and shared-allocation rules without changing results', () => {
    expect(getClubFitnessCoach(initial)).toBeNull();
    expect(recruitAiFitnessCoaches(initial)).toBe(initial);
    expect(new Set(initial.fitness.contracts.map(contract => contract.coachId)).size).toBe(initial.fitness.contracts.length);
    for (const team of initial.clubs) {
      expect(Boolean(getClubFitnessCoach(initial, team.id))).toBe(team.id !== club);
      expect(staffCommitted(initial, team.id)).toBeLessThanOrEqual(STAFF_BUDGET);
    }
    expect(create()).toEqual(initial);
    const disabled = create(false);
    expect(recruitAiFitnessCoaches(disabled)).toBe(disabled);
  });
});

describe('fitness effects in the authoritative weekly interval', () => {
  let staffed: SeasonState;
  beforeAll(() => { staffed = freeze(hireFitnessCoach(create(), 'fitness-12')); });

  it('shows the actual same-week condition benefit and leaves the input and match random state untouched', () => {
    const original = freeze(input(staffed)), before = structuredClone(original);
    const trained = processTrainingWeek(original), baseline = processTrainingWeek({ ...original, fitness: createFitness() });
    expect(trained.conditions[player]).toBe(87);
    expect(baseline.conditions[player]).toBe(73);
    expect(trained.training.lastWeek!.players[player]!.fitness).toEqual({ conditionWithoutCoach: 73, conditionBenefit: 14 });
    expect(trained.training.lastWeek!.fitness?.[club]).toEqual(getClubFitnessEffects(staffed));
    expect(trained.training.points[player]).toEqual(baseline.training.points[player]);
    expect(original).toEqual(before);
    expect(processTrainingWeek(original)).toEqual(trained);
  });

  it.each([
    ['standard', 80, 97.5, 87, 10.5],
    ['recovery', 35, 70, 63, 7],
    ['light', 99, 100, 100, 0],
    ['heavy', 100, 100, 93, 7],
    ['heavy', 35, 42, 35, 7],
  ] as const)('caps benefits under %s training at initial condition %s', (intensity, before, after, without, benefit) => {
    const result = processTrainingWeek(input(staffed, intensity, before));
    expect(result.conditions[player]).toBe(after);
    expect(result.training.lastWeek!.players[player]!.fitness).toEqual({ conditionWithoutCoach: without, conditionBenefit: benefit });
  });

  it('uses only medically available days and never changes injury dates or unavailable-day recovery', () => {
    const original = input(staffed, 'heavy', 55);
    const injury: SeasonInjury = { id: 'fitness-health-policy', playerId: player, clubId: club, kind: 'ankle', fixtureId: 'dev-r1-g1', occurredOn: dateForRound(1), returnOn: '2026-09-09' };
    const partial = processTrainingWeek({ ...original, injuries: [freeze(injury)] });
    expect(partial.training.lastWeek!.players[player]).toMatchObject({ availableDays: 4, conditionAfter: 68, fitness: { conditionWithoutCoach: 60, conditionBenefit: 8 } });
    const unavailable = { ...injury, returnOn: '2026-09-13' };
    const full = processTrainingWeek({ ...original, injuries: [unavailable] });
    expect(full.training.lastWeek!.players[player]).toMatchObject({ availableDays: 0, conditionAfter: 76, fitness: { conditionWithoutCoach: 76, conditionBenefit: 0 } });
    expect(Object.values(full.training.points[player]!).reduce((sum, value) => sum + value, 0)).toBe(0);
    expect(injury.returnOn).toBe('2026-09-09');
    expect(unavailable.returnOn).toBe('2026-09-13');
  });

  it('preserves the previous snapshot after release/replacement and applies the new appointment prospectively', () => {
    const original = input(staffed), result = processTrainingWeek(original), prior = getClubFitnessCoach(staffed)!;
    const next = { ...staffed, round: 2, date: dateForRound(2), training: result.training, conditions: result.conditions };
    const replacement = hireFitnessCoach(releaseFitnessCoach(next, prior.id), 'fitness-06');
    expect(replacement.training.lastWeek).toBe(result.training.lastWeek);
    expect(fitnessAssignments(replacement.fitness, replacement.clubs, 1, 1)).toEqual(result.training.lastWeek!.fitness);
    expect(fitnessAssignments(replacement.fitness, replacement.clubs, 1, 2)?.[club]?.coachId).toBe('fitness-06');
    expect(processTrainingWeek({ ...original, fitness: replacement.fitness })).toEqual(result);
  });

  it('retains legacy week output before activation and has no disabled-training or offseason application', () => {
    const original = input(staffed), baseline = processTrainingWeek({ ...original, fitness: createFitness() });
    const future = { ...staffed.fitness, enabledSince: { seasonNumber: 1, round: 2, ledgerIndex: 0 }, contracts: [] };
    expect(processTrainingWeek({ ...original, fitness: future })).toEqual(baseline);
    expect(baseline.training.lastWeek).not.toHaveProperty('fitness');
    expect(baseline.training.lastWeek!.players[player]).not.toHaveProperty('fitness');
    expect(() => processTrainingWeek({ ...original, training: { ...original.training, enabledSince: null } })).toThrow(/Enable training/);
    expect(() => processTrainingWeek({ ...original, afterRound: 10 })).toThrow(/before the final one/);
    expect(getClubFitnessEffects({ ...staffed, training: { ...staffed.training, enabledSince: null } })).toBeNull();
  });
});
