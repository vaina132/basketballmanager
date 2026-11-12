import { createFacilities } from '../src/world/facilities';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { setAutoSubstitutions, simulateToEnd, stepMatch } from '../src/engine/match';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { createFitness, enableFitness, hireFitnessCoach, releaseFitnessCoach } from '../src/world/fitness';
import { availableFitnessCoaches, getClubFitnessCoach } from '../src/world/fitness-policy';
import { hireScout } from '../src/world/scouts';
import { advanceSeason, createSeason, managedSide } from '../src/world/season';
import { setTrainingPlan } from '../src/world/training';

const club = 'rhine-falcons';
const play = state => advanceSeason({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) });
const fixture = name => gunzipSync(readFileSync(new URL(`./fixtures/${name}.json.gz`, import.meta.url))).toString('utf8');
const changed = (state, mutate) => { const envelope = JSON.parse(serializeSeason(state)); mutate(envelope.state); return JSON.stringify(envelope); };
const restore = state => parseSeason(serializeSeason(state));
let hired, report, released, replaced, original, restored, replacementId;
beforeAll(() => {
  original = JSON.parse(fixture('season21-training-scouts'));
  restored = parseSeason(JSON.stringify(original));
  const initial = hireScout(createSeason(731, club, 'off', true, true, true, true, null, false, true, false, false, true, true), 'scout-06');
  hired = hireFitnessCoach(setTrainingPlan(initial, { ...initial.training.plans[club], delegated: false, intensity: 'heavy', focus: 'balanced' }), 'fitness-12');
  report = play(hired);
  released = releaseFitnessCoach(report, getClubFitnessCoach(report).id);
  replacementId = availableFitnessCoaches(released).find(coach => coach.fee === 2_000_000).id;
  replaced = hireFitnessCoach(released, replacementId);
});

describe('fitness save history and prospective migration', () => {
  it('preserves a genuine format21 career, its staff, report and independent next week exactly', () => {
    expect(original.formatVersion).toBe(21);
    expect(original.state.training.lastWeek).not.toBeNull();
    expect(original.state.scouting.clubs[club].reviews.some(review => review.observer?.scoutId)).toBe(true);
    expect(original.state.injuries.length).toBeGreaterThan(0);
    expect(restored).toEqual({ ...original.state, schemaVersion: 28, facilities: createFacilities((original.state).clubs, (original.state).managedClubId), youthCompetition: { model: 'youth-competition-1', enabledSince: null, seasons: [] }, lifecycle: { model: 'lifecycle-1', enabledSince: null, reviews: [], notices: [] }, assistant: { model: 'assistant-1', enabledSince: null, contracts: [] }, academy: { model: 'academy-1', enabledSince: null, prospects: [], intakes: [], focus: {}, points: {}, weeks: [], graduates: [] }, youth: { model: 'youth-1', enabledSince: null, contracts: [] }, physio: { model: 'physio-1', enabledSince: null, contracts: [], rehabilitation: [] }, fitness: createFitness() });
    expect(stepMatch(restored.activeMatch)).toEqual(stepMatch(original.state.activeMatch));
    const expected = JSON.parse(fixture('season21-training-scouts-next'));
    const next = play(restored);
    expect(next).toEqual({ ...expected.state, schemaVersion: 28, facilities: createFacilities((expected.state).clubs, (expected.state).managedClubId), youthCompetition: { model: 'youth-competition-1', enabledSince: null, seasons: [] }, lifecycle: { model: 'lifecycle-1', enabledSince: null, reviews: [], notices: [] }, assistant: { model: 'assistant-1', enabledSince: null, contracts: [] }, academy: { model: 'academy-1', enabledSince: null, prospects: [], intakes: [], focus: {}, points: {}, weeks: [], graduates: [] }, youth: { model: 'youth-1', enabledSince: null, contracts: [] }, physio: { model: 'physio-1', enabledSince: null, contracts: [], rehabilitation: [] }, fitness: createFitness() });
    expect(restore(next)).toEqual(next);
  });

  it('activates and hires prospectively without rewriting the retained legacy week or injury dates', () => {
    const enabled = hireFitnessCoach(enableFitness(restored), 'fitness-12');
    expect(enabled.training).toEqual(restored.training);
    expect(enabled.injuries).toEqual(restored.injuries);
    expect(enabled.activeMatch).toEqual(restored.activeMatch);
    expect(restore(enabled)).toEqual(enabled);
    const next = play(enabled);
    expect(next.training.lastWeek.fitness[club].coachId).toBe('fitness-12');
    expect(next.injuries.filter(injury => restored.injuries.some(old => old.id === injury.id))).toEqual(restored.injuries);
    expect(restore(next)).toEqual(next);
  });

  it('replays the original coach after release and replacement, then the replacement for the next interval', () => {
    expect(released.training).toEqual(report.training);
    expect(replaced.training).toEqual(report.training);
    for (const state of [hired, report, released, replaced]) expect(restore(state)).toEqual(state);
    const next = play(replaced);
    expect(next.training.lastWeek.fitness[club].coachId).toBe(replacementId);
    expect(restore(next)).toEqual(next);
  });

  it.each([
    ['fitness without training', state => { state.training.enabledSince = null; }],
    ['fitness without finance', state => { state.finance.enabledSince = null; }],
    ['missing fee', state => { state.finance.ledger.pop(); }],
    ['altered fee', state => { state.finance.ledger.at(-1).amount += 100; }],
    ['wrong fee provenance', state => { state.finance.ledger.at(-1).fitness.coachId = 'fitness-01'; }],
    ['foreign details on another ledger kind', state => { state.finance.ledger[0].fitness = state.finance.ledger.at(-1).fitness; }],
    ['wrong hire boundary', state => { state.fitness.contracts.at(-1).hiredLedgerIndex -= 1; }],
    ['release missing its ledger boundary', state => { state.fitness.contracts.at(-1).releasedRound = 1; }],
    ['release before payment', state => { const contract = state.fitness.contracts.at(-1); contract.releasedRound = 1; contract.releasedLedgerIndex = contract.hiredLedgerIndex; }],
    ['invented coach identity', state => { state.fitness.contracts.at(-1).coachId = 'not-a-coach'; }],
  ])('rejects %s', (_name, mutate) => {
    expect(() => parseSeason(changed(hired, mutate))).toThrow();
  });

  it.each([
    ['incorrect training coach', state => { state.training.lastWeek.fitness[club].coachId = 'fitness-01'; }],
    ['wrong appointment source', state => { state.training.lastWeek.fitness[club].contractId = state.fitness.contracts[0].id; }],
    ['inflated recovery', state => { state.training.lastWeek.fitness[club].recoveryPerDay += 0.1; }],
    ['inflated workload reduction', state => { state.training.lastWeek.fitness[club].practiceCostReductionPercent += 2.5; }],
    ['missing staffing snapshot', state => { delete state.training.lastWeek.fitness; }],
    ['invented baseline condition', state => { state.training.lastWeek.players['rhf-1'].fitness.conditionWithoutCoach -= 1; }],
    ['inflated actual condition benefit', state => { state.training.lastWeek.players['rhf-1'].fitness.conditionBenefit += 1; }],
    ['removed player contribution', state => { delete state.training.lastWeek.players['rhf-1'].fitness; }],
    ['later replacement rewritten into an old week', state => { const contract = state.fitness.contracts.at(-1); state.training.lastWeek.fitness[club].contractId = contract.id; state.training.lastWeek.fitness[club].coachId = contract.coachId; }],
    ['release backdated across a completed interval', state => { state.fitness.contracts.find(contract => contract.coachId === 'fitness-12').releasedRound = 1; }],
  ])('rejects %s', (_name, mutate) => {
    expect(() => parseSeason(changed(replaced, mutate))).toThrow();
  });

  it('rejects a plausible paid replacement exceeding the combined annual staff allocation', () => {
    expect(() => parseSeason(changed(replaced, state => {
      const current = state.fitness.contracts.at(-1);
      current.releasedRound = state.round;
      current.releasedLedgerIndex = state.finance.ledger.length;
      const contract = { ...current, id: `fitness-contract-${state.fitness.contracts.length + 1}`, coachId: 'fitness-11', releasedRound: null, releasedLedgerIndex: null, hiredLedgerIndex: state.finance.ledger.length };
      state.fitness.contracts.push(contract);
      state.finance.ledger.push({ ...state.finance.ledger.at(-1), id: `finance-${state.finance.ledger.length + 1}`, sourceId: `fitness-${contract.id}`, amount: -4_000_000, fitness: { contractId: contract.id, coachId: contract.coachId } });
    }))).toThrow(/shared annual staff allocation/);
  });

  it('rejects duplicate employment even when the forged second appointment has its full fee', () => {
    expect(() => parseSeason(changed(hired, state => {
      const contract = { ...state.fitness.contracts.at(-1), id: `fitness-contract-${state.fitness.contracts.length + 1}`, coachId: replacementId, hiredLedgerIndex: state.finance.ledger.length };
      state.fitness.contracts.push(contract);
      state.finance.ledger.push({ ...state.finance.ledger.at(-1), id: `finance-${state.finance.ledger.length + 1}`, sourceId: `fitness-${contract.id}`, amount: -2_000_000, fitness: { contractId: contract.id, coachId: contract.coachId } });
    }))).toThrow(/one-fitness-coach/);
  });

  it('rejects fitness fields disguised as old-format reports before migration', () => {
    for (const mutate of [
      state => { state.fitness = createFitness(); },
      state => { state.training.lastWeek.fitness = report.training.lastWeek.fitness; },
      state => { state.training.lastWeek.players['rhf-1'].fitness = report.training.lastWeek.players['rhf-1'].fitness; },
      state => { state.finance.ledger[0].fitness = hired.finance.ledger.at(-1).fitness; },
    ]) {
      const envelope = structuredClone(original);
      mutate(envelope.state);
      expect(() => parseSeason(JSON.stringify(envelope))).toThrow();
    }
  });
});
