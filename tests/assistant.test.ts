import { beforeAll, describe, expect, it } from 'vitest';
import type { FinanceEntry } from '../src/domain/finance';
import type { SeasonState } from '../src/domain/season';
import { DEVELOPMENT_ASSISTANTS } from '../src/data/development-assistants';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { createAssistant, enableAssistant, hireAssistant, recruitAiAssistants, releaseAssistant, renewSeasonAssistant, setAssistantRenewal } from '../src/world/assistant';
import { applyAssistantTactics, getAssistantAdvice } from '../src/world/assistant-advice';
import { assistantEffects, availableAssistants, getClubAssistant, quoteAssistantHire } from '../src/world/assistant-policy';
import { hireCoach } from '../src/world/coaching';
import { getFinanceBalance, recordAssistantFee } from '../src/world/finance';
import { hireFitnessCoach } from '../src/world/fitness';
import { getSpendableCash } from '../src/world/payroll-policy';
import { hirePhysio } from '../src/world/physio';
import { hireScout } from '../src/world/scouts';
import { advanceSeason, createSeason, dateForRound, managedSide } from '../src/world/season';
import { remainingStaffBudget, STAFF_BUDGET, staffCommitmentsByRole, staffCommitted } from '../src/world/staff-policy';

const club = 'rhine-falcons';
const create = (assistant = true) => createSeason(227, club, 'off', true, true, true, true, null, true, true, true, true, true, true, true, assistant);
function freeze<T>(value: T): T { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
/** Isolated budget/season boundaries below test guards; full careers are covered by integration tests. */
function expense(state: SeasonState, amount: number): SeasonState {
  const entry: FinanceEntry = { id: `assistant-test-${state.finance.ledger.length}`, clubId: club, seasonNumber: state.seasonNumber, round: state.round, kind: 'operations', amount: -amount, sourceId: 'assistant-test', ticket: null, coach: null, payroll: null };
  return { ...state, finance: { ...state.finance, ledger: [...state.finance.ledger, entry] } };
}

describe('assistant appointments and shared five-role staff allocation', () => {
  let initial: SeasonState, legacy: SeasonState;
  beforeAll(() => { initial = freeze(create()); legacy = freeze(create(false)); });

  it('activates prospectively without requiring training or changing prepared sporting state', () => {
    expect(legacy.assistant).toEqual(createAssistant());
    const enabled = enableAssistant(legacy);
    expect(enabled.assistant.enabledSince).toEqual({ seasonNumber: 1, round: 1, ledgerIndex: legacy.finance.ledger.length });
    expect(enabled.activeMatch!).toBe(legacy.activeMatch!);
    expect(enabled.plans).toBe(legacy.plans);
    expect(enabled.training).toBe(legacy.training);
    expect(enableAssistant(enabled)).toBe(enabled);
    const noTraining = createSeason(227, club, 'off', false, false, true, false, null, false, false, false, false, false, false, false, true);
    expect(noTraining.assistant.enabledSince).not.toBeNull();
    expect(() => enableAssistant(createSeason(227, club, 'off', false, false, false, false))).toThrow(/finances/i);
    expect(() => createSeason(227, club, 'off', false, false, false, false, null, false, false, false, false, false, false, false, true)).toThrow(/finances/i);
    expect(() => createSeason(227, club, 'off', true, true, true, true, null, false, false, false, false, false, false, false, 'yes' as never)).toThrow(/assistant/i);
  });

  it('prices actual advice resolution without hidden playing bonuses', () => {
    expect(assistantEffects({ id: 'test', name: 'Test', assessment: 1, fee: 1 })).toEqual({ skillStep: 4 });
    expect(assistantEffects(DEVELOPMENT_ASSISTANTS[0]!)).toEqual({ skillStep: 3 });
    expect(assistantEffects(DEVELOPMENT_ASSISTANTS[6]!)).toEqual({ skillStep: 2 });
    expect(assistantEffects(DEVELOPMENT_ASSISTANTS.at(-1)!)).toEqual({ skillStep: 1 });
    for (const coach of DEVELOPMENT_ASSISTANTS) {
      expect(Object.isFrozen(coach)).toBe(true);
      const sameEffect = DEVELOPMENT_ASSISTANTS.filter(other => assistantEffects(other).skillStep === assistantEffects(coach).skillStep);
      expect(new Set(sameEffect.map(other => other.fee)).size).toBe(1);
    }
  });

  it('makes one atomic appointment and retains the full fee after release and replacement', () => {
    const hired = hireAssistant(initial, 'assistant-06'), contract = getClubAssistant(hired)!;
    expect(contract.hiredLedgerIndex).toBe(initial.finance.ledger.length);
    expect(hired.finance.ledger.at(-1)).toMatchObject({ kind: 'assistant', amount: -2_000_000, sourceId: `assistant-${contract.id}`, assistant: { contractId: contract.id, assistantId: 'assistant-06' } });
    expect(getFinanceBalance(initial.finance, club).cash - getFinanceBalance(hired.finance, club).cash).toBe(2_000_000);
    expect(hired.activeMatch!).toBe(initial.activeMatch!);
    expect(hired.plans).toBe(initial.plans);
    expect(() => hireAssistant(hired, 'assistant-05')).toThrow(/occupied/i);
    expect(() => recordAssistantFee(hired, contract)).toThrow(/exact newly appointed/i);
    const released = releaseAssistant(hired, contract.id);
    expect(released.finance).toBe(hired.finance);
    expect(released.activeMatch!).toBe(hired.activeMatch!);
    expect(staffCommitted(released, club)).toBe(staffCommitted(hired, club));
    expect(released.assistant.contracts.at(-1)).toMatchObject({ releasedRound: 1, releasedLedgerIndex: hired.finance.ledger.length });
    expect(availableAssistants(released).some(coach => coach.id === contract.assistantId)).toBe(true);
    const replaced = hireAssistant(released, contract.assistantId);
    expect(getClubAssistant(replaced)?.id).not.toBe(contract.id);
    expect(staffCommitmentsByRole(replaced, club).assistant).toBe(4_000_000);
    expect(() => releaseAssistant(replaced, contract.id)).toThrow(/active assistant/i);
  });

  it('enforces one club per person and never fills the human club automatically', () => {
    expect(getClubAssistant(initial)).toBeNull();
    expect(initial.assistant.contracts).toHaveLength(5);
    expect(new Set(initial.assistant.contracts.map(contract => contract.assistantId)).size).toBe(5);
    const employed = initial.assistant.contracts[0]!;
    expect(quoteAssistantHire(initial, employed.assistantId).reason).toMatch(/active club/i);
    expect(() => releaseAssistant(initial, employed.id)).toThrow(/active assistant/i);
    expect(recruitAiAssistants(initial)).toBe(initial);
    for (const team of initial.clubs) expect(staffCommitted(initial, team.id)).toBeLessThanOrEqual(STAFF_BUDGET);
    expect(create()).toEqual(initial);
  });

  it('shares staff allocation with coaches, scouts, fitness and physios, including released fees', () => {
    let staffed = hireAssistant(hirePhysio(hireFitnessCoach(hireScout(initial, 'scout-06'), 'fitness-06'), 'physio-06'), 'assistant-06');
    expect(staffCommitmentsByRole(staffed, club)).toEqual({ coaches: 4_000_000, scouts: 2_000_000, fitness: 2_000_000, physio: 2_000_000, assistant: 2_000_000, youth: 0, total: 12_000_000 });
    expect(remainingStaffBudget(staffed)).toBe(3_000_000);
    expect(() => hireCoach(staffed, 'coach-25')).toThrow(/shared staff/i);
    staffed = hireAssistant(releaseAssistant(staffed, getClubAssistant(staffed)!.id), 'assistant-06');
    staffed = releaseAssistant(staffed, getClubAssistant(staffed)!.id);
    expect(quoteAssistantHire(staffed, 'assistant-06')).toMatchObject({ remainingAllocation: 1_000_000, canHire: false });
    expect(quoteAssistantHire(staffed, 'assistant-06').reason).toMatch(/shared staff/i);
  });

  it('protects remaining player wages and refuses unpaid operating costs', () => {
    const poor = freeze(expense(initial, getSpendableCash(initial, club) - 1_000_000));
    expect(getFinanceBalance(poor.finance, club).cash).toBeGreaterThan(2_000_000);
    expect(quoteAssistantHire(poor, 'assistant-06')).toMatchObject({ remainingBudget: 1_000_000, canHire: false });
    expect(quoteAssistantHire(poor, 'assistant-06').reason).toMatch(/protected wages|Spending left/i);
    expect(() => hireAssistant(poor, 'assistant-06')).toThrow(/Spending left/i);
    const unpaid = freeze(expense(initial, getFinanceBalance(initial.finance, club).cash + 1));
    expect(quoteAssistantHire(unpaid, 'assistant-06').reason).toMatch(/unpaid/i);
    expect(remainingStaffBudget(unpaid)).toBe(0);
  });

  it('rechecks funds after an unsuccessful automated candidate search on the same input', () => {
    // The normal manager club has a vacancy. Let AI manage it for this isolated funding boundary.
    const poor = expense({ ...initial, managedClubId: initial.clubs.find(team => team.id !== club)!.id }, getSpendableCash(initial, club) - 1_000_000);
    expect(recruitAiAssistants(poor)).toBe(poor);
    // A changed input must not inherit accounting from the completed candidate search. Career state is replaced, never
    // edited (step 3.7 caches per ledger rely on it), so the changed input carries a new ledger.
    const ledger = poor.finance.ledger, funded = { ...poor, finance: { ...poor.finance, ledger: [...ledger.slice(0, -1), { ...ledger.at(-1)!, amount: 0 }] } };
    const before = structuredClone(funded), hired = recruitAiAssistants(funded);
    expect(getClubAssistant(hired, club)).not.toBeNull();
    expect(staffCommitted(hired, club)).toBeLessThanOrEqual(STAFF_BUDGET);
    expect(hired.finance.ledger.length).toBe(funded.finance.ledger.length + 1);
    expect(funded).toEqual(before);
  });

  it('permits advice for the final game but closes new appointments after its final whistle', () => {
    const finalReady = { ...initial, round: 10, date: dateForRound(10) };
    expect(quoteAssistantHire(finalReady, 'assistant-06').canHire).toBe(true);
    const finalFinished = { ...finalReady, activeMatch: { ...initial.activeMatch!, status: 'finished' as const } };
    expect(quoteAssistantHire(finalFinished, 'assistant-06').reason).toMatch(/next season/i);
    expect(() => enableAssistant({ ...finalFinished, assistant: createAssistant() })).toThrow(/final match/i);
    expect(recruitAiAssistants(finalFinished)).toBe(finalFinished);
    expect(quoteAssistantHire({ ...initial, activeMatch: finalFinished.activeMatch! }, 'assistant-06').canHire).toBe(true);
    const hired = hireAssistant(finalReady, 'assistant-06'), contract = getClubAssistant(hired)!;
    expect(getClubAssistant(setAssistantRenewal({ ...hired, activeMatch: finalFinished.activeMatch! }, contract.id, false))?.renew).toBe(false);
    expect(() => setAssistantRenewal(hired, contract.id, 'yes' as never)).toThrow(/renew/i);
    expect(() => enableAssistant({ ...legacy, status: 'complete' })).toThrow(/next season/i);
  });

  it('renews against fresh-year commitments while retaining old fees and honoring declined renewals', () => {
    const hired = hireAssistant(initial, 'assistant-06'), contract = getClubAssistant(hired)!;
    const opening: SeasonState = { ...hired, seasonNumber: 2, round: 1, date: dateForRound(1, 2), coaching: { ...hired.coaching, contracts: [] } };
    expect(staffCommitted(opening, club)).toBe(0);
    const renewed = renewSeasonAssistant(opening);
    expect(getClubAssistant(renewed)).toMatchObject({ assistantId: contract.assistantId, seasonNumber: 2, startedRound: 1 });
    expect(renewed.assistant.contracts.find(item => item.id === contract.id)).toEqual(contract);
    expect(staffCommitmentsByRole(renewed, club).assistant).toBe(2_000_000);
    expect(renewSeasonAssistant(renewed)).toBe(renewed);
    const declined = setAssistantRenewal(hired, contract.id, false);
    expect(getClubAssistant(renewSeasonAssistant({ ...opening, assistant: declined.assistant }))).toBeNull();
    const poor = expense(opening, getFinanceBalance(opening.finance, club).cash);
    expect(getClubAssistant(renewSeasonAssistant(poor))).toBeNull();
  });

  it('prepares new-career AI tactics through the same advice command without consuming RNG', () => {
    const side = managedSide(initial) === 'home' ? 'away' : 'home';
    const contract = getClubAssistant(initial, initial.activeMatch![side].id)!;
    const coach = DEVELOPMENT_ASSISTANTS.find(coach => coach.id === contract.assistantId)!;
    expect(initial.activeMatch!).toEqual(applyAssistantTactics(legacy.activeMatch!, side, coach));
    expect(initial.activeMatch!.rngState).toEqual(legacy.activeMatch!.rngState);
    expect(initial.activeMatch!.tactics[managedSide(initial)]).toEqual(legacy.activeMatch!.tactics[managedSide(initial)]);
    expect(initial.activeMatch!.events.some(event => event.type === 'tactics' && event.text.includes(coach.name))).toBe(true);
  });

  it('applies newly activated AI advice only when preparing the next fixture', () => {
    const enabled = enableAssistant(legacy);
    const finished = simulateToEnd(setAutoSubstitutions(enabled.activeMatch!, managedSide(enabled), true));
    const next = advanceSeason({ ...enabled, activeMatch: finished });
    const side = managedSide(next) === 'home' ? 'away' : 'home';
    const contract = getClubAssistant(next, next.activeMatch![side].id)!;
    const coach = DEVELOPMENT_ASSISTANTS.find(coach => coach.id === contract.assistantId)!;
    // The coach's advice shapes the prepared fixture. Sprint 4: an unchanged, rested five gets unchanged advice, so the
    // advice can already be in place from the first matchday and add no new event.
    const advice = getAssistantAdvice(next.activeMatch!, side, coach).tactics!;
    expect(next.activeMatch!.tactics[side]).toEqual(advice);
    expect(advice).not.toEqual({ tempo: .5, outsideShare: .45, pressure: .5 });
    expect(next.fixtures.find(fixture => fixture.id === legacy.activeFixtureId!)!.result!.score).toEqual(finished.score);
    expect(enabled.activeMatch!).toBe(legacy.activeMatch!);
  });
});
