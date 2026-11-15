import { describe, expect, it } from 'vitest';
import type { SeasonInjury, SeasonState } from '../src/domain/season';
import type { TrainingIntensity, TrainingPlan } from '../src/domain/training';
import { DEVELOPMENT_CLUBS } from '../src/data/development-league';
import { createFixtureMatch, setAutoSubstitutions, simulateToEnd, stepMatch } from '../src/engine/match';
import { advanceSeason, createSeason, dateForRound, managedSide, rolloverSeason } from '../src/world/season';
import { createTraining, developClub, enableTraining, processTrainingWeek, resolveTrainingPlan, setTrainingPlan, TRAINING_ATTRIBUTES, trainingAvailableDays, trainingPointCap } from '../src/world/training';
import type { TrainingWeekInput } from '../src/world/training';

const club = DEVELOPMENT_CLUBS[0]!, player = club.players[0]!;
const total = (values: Record<string, number>) => Object.values(values).reduce((sum, value) => sum + value, 0);
function input(intensity: TrainingIntensity = 'standard', condition = 80): TrainingWeekInput {
  const training = createTraining(DEVELOPMENT_CLUBS);
  for (const plan of Object.values(training.plans)) Object.assign(plan, { delegated: false, intensity, focus: 'passing' });
  return { training, clubs: DEVELOPMENT_CLUBS, conditions: Object.fromEntries(DEVELOPMENT_CLUBS.flatMap(team => team.players.map(player => [player.id, condition]))), injuries: [], seasonNumber: 1, afterRound: 1, fromDate: dateForRound(1), toDate: dateForRound(2) };
}
function finish(state: SeasonState): SeasonState {
  return state.activeMatch!.status === 'finished' ? state : { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch!, managedSide(state), true)) };
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

describe('weekly training workload and development', () => {
  it('resolves every club deterministically without mutating input or allowing the same week twice', () => {
    const original = freeze(input()), snapshot = structuredClone(original);
    const next = processTrainingWeek(original);
    expect(original).toEqual(snapshot);
    expect(processTrainingWeek(original)).toEqual(next);
    expect(Object.keys(next.training.lastWeek!.players)).toHaveLength(60);
    expect(next.training.lastWeek).toMatchObject({ seasonNumber: 1, afterRound: 1, fromDate: '2026-09-05', toDate: '2026-09-12' });
    expect(next.training.lastWeek!.players[player.id]).toMatchObject({ focus: 'passing', intensity: 'standard', availableDays: 7, conditionBefore: 80, conditionAfter: 87 });
    expect(next.training.points[player.id]!.passing).toBe(28);
    expect(() => processTrainingWeek({ ...original, ...next })).toThrow(/already been processed/);
    expect(() => processTrainingWeek({ ...original, toDate: '2026-09-13' })).toThrow(/seven-day/);
  });

  it('makes increased development cost recovery and reduces learning under fatigue', () => {
    const recovery = processTrainingWeek(input('recovery')), light = processTrainingWeek(input('light'));
    const standard = processTrainingWeek(input()), heavy = processTrainingWeek(input('heavy'));
    expect([recovery, light, standard, heavy].map(result => result.conditions[player.id])).toEqual([100, 100, 87, 73]);
    expect([recovery, light, standard, heavy].map(result => result.training.points[player.id]!.passing)).toEqual([0, 14, 28, 35]);
    const tiredHeavy = processTrainingWeek(input('heavy', 65)), tiredStandard = processTrainingWeek(input('standard', 65));
    expect(tiredHeavy.conditions[player.id]).toBe(58);
    expect(tiredHeavy.training.points[player.id]!.passing).toBe(14);
    expect(tiredStandard.conditions[player.id]).toBe(72);
    expect(tiredStandard.training.points[player.id]!.passing).toBe(18);
    expect(processTrainingWeek(input('heavy', 35)).conditions[player.id]).toBe(35);
  });

  it('gives an individual focus the same finite budget as team training and rotates balanced remainders', () => {
    const original = input('heavy', 69);
    original.training.plans[club.id]!.focus = 'balanced';
    original.training.plans[club.id]!.individual[player.id] = 'defense';
    const focused = processTrainingWeek(original), teammate = club.players[1]!;
    expect(focused.training.points[player.id]!.defense).toBe(14);
    expect(total(focused.training.points[player.id]!)).toBe(total(focused.training.points[teammate.id]!));
    const uneven = input('standard', 69);
    uneven.training.plans[club.id]!.focus = 'balanced';
    const first = processTrainingWeek(uneven).training.points[player.id]!;
    const second = processTrainingWeek({ ...uneven, afterRound: 2, fromDate: dateForRound(2), toDate: dateForRound(3) }).training.points[player.id]!;
    expect(total(first)).toBe(26); expect(total(second)).toBe(26);
    expect(first.twoPoint).toBe(4); expect(first.stamina).toBe(3);
    expect(second.twoPoint).toBe(3); expect(second.stamina).toBe(3);
    expect(second.rebounding).toBe(4);
  });

  it('excludes full and partial injury absences by calendar day without changing recovery dates', () => {
    const original = input();
    const injury: SeasonInjury = { id: 'episode', playerId: player.id, clubId: club.id, kind: 'ankle-sprain', fixtureId: 'dev-r1-g1', occurredOn: '2026-09-05', returnOn: '2026-09-09' };
    const partial = processTrainingWeek({ ...original, injuries: [injury] });
    expect(trainingAvailableDays([injury], player.id, original.fromDate, original.toDate)).toBe(4);
    expect(partial.training.lastWeek!.players[player.id]).toMatchObject({ availableDays: 4, conditionBefore: 80, conditionAfter: 93 });
    expect(partial.training.points[player.id]!.passing).toBe(16);
    expect(injury.returnOn).toBe('2026-09-09');
    const full = processTrainingWeek({ ...original, injuries: [{ ...injury, returnOn: '2026-09-13' }] });
    expect(full.training.lastWeek!.players[player.id]!.availableDays).toBe(0);
    expect(total(full.training.points[player.id]!)).toBe(0);
    expect(full.conditions[player.id]).toBe(100);
    const clearedOnOpeningDay = processTrainingWeek({ ...original, injuries: [{ ...injury, returnOn: '2026-09-12' }] });
    expect(clearedOnOpeningDay.training.lastWeek!.players[player.id]!.availableDays).toBe(1);
  });

  it('applies identical assistant decisions and development budgets to every club', () => {
    const original = input('heavy', 74);
    for (const plan of Object.values(original.training.plans)) { plan.delegated = true; plan.focus = 'stamina'; }
    original.training.plans[club.id]!.individual[player.id] = 'passing';
    const next = processTrainingWeek(original);
    for (const team of original.clubs) {
      expect(next.training.lastWeek!.plans[team.id]).toMatchObject({ delegated: true, intensity: 'light', focus: 'balanced' });
      for (const individual of team.players) {
        expect(next.conditions[individual.id]).toBe(95);
        expect(total(next.training.points[individual.id]!)).toBe(14);
      }
    }
    expect(next.training.points[player.id]!.passing).toBe(14);
    const threshold = Object.fromEntries(Object.keys(original.conditions).map(id => [id, 75]));
    expect(resolveTrainingPlan(original.training.plans[club.id]!, club, threshold).intensity).toBe('standard');
    expect(original.training.plans[club.id]!.intensity).toBe('heavy');
  });

  it('caps development and projects integer match abilities without changing authored data', () => {
    const original = input();
    for (const team of original.clubs) for (const individual of team.players) for (const attribute of TRAINING_ATTRIBUTES) original.training.points[individual.id]![attribute] = trainingPointCap(individual.attributes[attribute]);
    const before = structuredClone(DEVELOPMENT_CLUBS), next = processTrainingWeek(original);
    const developed = developClub(club, next.training);
    expect(developed.id).toBe(club.id); expect(developed.players.map(player => player.id)).toEqual(club.players.map(player => player.id));
    for (const individual of developed.players) {
      const base = club.players.find(player => player.id === individual.id)!;
      for (const attribute of TRAINING_ATTRIBUTES) expect(individual.attributes[attribute]).toBe(Math.min(20, base.attributes[attribute] + 2));
      expect(total(next.training.lastWeek!.players[individual.id]!.gains)).toBe(0);
    }
    expect(DEVELOPMENT_CLUBS).toEqual(before);
    const bad = structuredClone(original); bad.training.points[player.id]!.passing = 201;
    expect(() => processTrainingWeek(bad)).toThrow(/development limits/);
  });
});

describe('training in the season loop', () => {
  it('enables legacy careers and edits only future plans, preserving the active match and RNG', () => {
    const original = freeze(createSeason(42, club.id, 'standard', false, false));
    expect(original.training.enabledSince).toBeNull();
    const enabled = enableTraining(original), active = structuredClone(original.activeMatch!);
    expect(enabled.training.enabledSince).toEqual({ seasonNumber: 1, round: 1 });
    const plan: TrainingPlan = { ...enabled.training.plans[club.id]!, delegated: false, intensity: 'heavy', focus: 'passing', individual: { ...enabled.training.plans[club.id]!.individual } };
    const edited = setTrainingPlan(enabled, plan);
    plan.individual[player.id] = 'defense';
    expect(edited.training.plans[club.id]!.individual[player.id]).toBe('team');
    expect(edited.activeMatch!).toBe(original.activeMatch!);
    expect(edited.activeMatch!).toEqual(active);
    expect(stepMatch(edited.activeMatch!)).toEqual(stepMatch(original.activeMatch!));
    expect(original.training.enabledSince).toBeNull();
    expect(enableTraining(edited)).toBe(edited);
    expect(() => setTrainingPlan(original, plan)).toThrow(/Enable training/);
    expect(() => setTrainingPlan(enabled, { ...plan, individual: {} })).toThrow(/every player/);
    expect(() => setTrainingPlan(enabled, { ...plan, intensity: 'invalid' as never })).toThrow(/valid training plan/);
  });

  it('commits all three games before training and uses gained skills only in the next prepared match', () => {
    let state = createSeason(12, club.id, 'off', true, false);
    state.training.points[player.id]!.passing = 98;
    state = setTrainingPlan(state, { ...state.training.plans[club.id]!, delegated: false, intensity: 'light', focus: 'passing' });
    const completed = freeze(finish(state)), before = structuredClone(completed);
    const next = advanceSeason(completed);
    expect(completed).toEqual(before);
    expect(next.fixtures.filter(fixture => fixture.result)).toHaveLength(3);
    expect(next.training.lastWeek!.afterRound).toBe(1);
    for (const fixture of next.fixtures.filter(fixture => fixture.result)) for (const [id, stats] of Object.entries(fixture.result!.stats)) expect(next.training.lastWeek!.players[id]!.conditionBefore).toBe(stats.condition);
    expect(next.training.points[player.id]!.passing).toBeGreaterThanOrEqual(100);
    expect(next.activeMatch![managedSide(next)].players.find(item => item.id === player.id)!.attributes.passing).toBe(player.attributes.passing + 1);
    expect(next.clubs).toEqual(DEVELOPMENT_CLUBS);
    expect(completed.activeMatch![managedSide(completed)].players.find(item => item.id === player.id)!.attributes.passing).toBe(player.attributes.passing);
    expect(advanceSeason(completed)).toEqual(next);
    expect(() => advanceSeason(next)).toThrow(/Finish/);
  });

  it('retains exact recovery-only behavior and fixture squads while training remains disabled', () => {
    const initial = createSeason(9, club.id, 'off', false, false), next = advanceSeason(finish(initial));
    expect(next.training).toEqual(initial.training);
    for (const fixture of next.fixtures.filter(fixture => fixture.result)) for (const [id, stats] of Object.entries(fixture.result!.stats)) expect(next.conditions[id]).toBe(Math.min(100, Math.round((stats.condition + 21) * 1000) / 1000));
    const home = next.clubs.find(club => club.id === next.activeMatch!.home.id)!, away = next.clubs.find(club => club.id === next.activeMatch!.away.id)!;
    const expected = createFixtureMatch(next.activeMatch!.seed, home, away, { lineups: { home: next.plans[home.id]!.lineup, away: next.plans[away.id]!.lineup }, tactics: { home: next.plans[home.id]!.tactics, away: next.plans[away.id]!.tactics }, conditions: Object.fromEntries([...home.players, ...away.players].map(player => [player.id, next.conditions[player.id]!])), autoSubstitutions: next.activeMatch!.autoSubstitutions, injuryMode: 'off' });
    expect(next.activeMatch!).toEqual(expected);
    const enabled = enableTraining(next);
    expect(enabled.training.enabledSince).toEqual({ seasonNumber: 1, round: 2 });
    expect(enabled.activeMatch!).toBe(next.activeMatch!);
  });

  it('skips final-round training and preserves growth across offseason recovery without bonus XP', () => {
    let state = createSeason(15, club.id, 'off', true, false);
    state = setTrainingPlan(state, { ...state.training.plans[club.id]!, delegated: false, intensity: 'light', focus: 'passing' });
    while (state.round < 10) state = advanceSeason(finish(state));
    const points = structuredClone(state.training.points), report = structuredClone(state.training.lastWeek);
    const complete = advanceSeason(finish(state));
    expect(complete.training.points).toEqual(points);
    expect(complete.training.lastWeek).toEqual(report);
    expect(complete.training.lastWeek!.afterRound).toBe(9);
    const next = rolloverSeason(complete);
    expect(next.training.points).toEqual(points);
    expect(next.training.plans).toEqual(complete.training.plans);
    expect(next.training.enabledSince).toEqual({ seasonNumber: 1, round: 1 });
    expect(next.training.lastWeek).toBeNull();
    expect(Object.values(next.conditions).every(value => value === 100)).toBe(true);
    expect(next.activeMatch![managedSide(next)]).toEqual(developClub(club, next.training));
    expect(total(next.training.points[player.id]!)).toBeGreaterThan(0);
  }, 30_000);
});
