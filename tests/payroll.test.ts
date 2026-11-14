import { financeLedgerSlice } from '../src/world/finance-ledger';
import { beforeAll, describe, expect, it } from 'vitest';
import type { FinanceEntry } from '../src/domain/finance';
import type { SeasonState } from '../src/domain/season';
import { DEVELOPMENT_CLUBS } from '../src/data/development-league';
import { DEVELOPMENT_WAGES, getSeasonWage } from '../src/data/development-wages';
import { setAutoSubstitutions, simulateToEnd, stepMatch } from '../src/engine/match';
import { getClubCoaching, hireCoach, recruitAiCoaches } from '../src/world/coaching';
import { ANNUAL_SPONSORSHIP, getFinanceBalance, processFinanceRound } from '../src/world/finance';
import { agreementCommitted, createPayroll, enablePayroll, getClubPayrollSummary, getPayrollReserve, getPlayerPayroll, getSpendableCash, PAYROLL_AUTOMATION_CUSHION, payrollInstallment, preparePayrollRound, prepayWages, processPayrollRound, quoteWagePrepayment, setPayrollDelegation, startPayrollSeason } from '../src/world/payroll';
import { advanceSeason, createSeason, getActiveFixture, managedSide, rolloverSeason } from '../src/world/season';

const clubId = DEVELOPMENT_CLUBS[0]!.id, otherId = DEVELOPMENT_CLUBS[1]!.id;
const playerId = DEVELOPMENT_CLUBS[0]!.players[0]!.id;
const annualClubWages = 15_250_000;
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function finish(state: SeasonState): SeasonState {
  return state.activeMatch.status === 'finished' ? state : { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) };
}
function finishSeason(initial: SeasonState): SeasonState {
  let state = initial;
  while (state.status === 'active') state = advanceSeason(finish(state));
  return state;
}
/** Explicit synthetic cash position for policy tests, not an importable financial history. */
function cashPosition(state: SeasonState, clubId: string, cash: number, unpaid = 0): SeasonState {
  const balance = getFinanceBalance(state.finance, clubId);
  const amount = cash - unpaid - (balance.cash - balance.unpaid);
  const entry: FinanceEntry = { id: `finance-${state.finance.ledger.length + 1}`, clubId, seasonNumber: state.seasonNumber, round: state.round, kind: 'operations', amount, sourceId: `test-cash-${state.finance.ledger.length}`, ticket: null, coach: null, payroll: null };
  return { ...state, finance: { ...state.finance, ledger: [...state.finance.ledger, entry] } };
}

describe('authored season wages and payroll activation', () => {
  it('pins sixty fictional wages and creates one prospective agreement per player in canonical order', () => {
    expect(Object.keys(DEVELOPMENT_WAGES)).toHaveLength(60);
    expect(Object.isFrozen(DEVELOPMENT_WAGES)).toBe(true);
    const state = createSeason(9, clubId, 'off');
    expect(state.payroll.agreements).toHaveLength(60);
    expect(state.payroll.agreements.map(agreement => agreement.playerId)).toEqual(state.clubs.flatMap(club => club.players.map(player => player.id)));
    expect(state.payroll.enabledSince).toEqual({ seasonNumber: 1, round: 1, ledgerIndex: 18 });
    for (const club of state.clubs) {
      const agreements = state.payroll.agreements.filter(agreement => agreement.clubId === club.id);
      expect(agreements.reduce((sum, agreement) => sum + agreement.seasonWage, 0)).toBe(annualClubWages);
      for (const agreement of agreements) expect(agreement).toMatchObject({ id: `wage-s1-${agreement.playerId}`, startsRound: 1, seasonWage: getSeasonWage(agreement.playerId) });
    }
    expect(state.payroll.delegated[clubId]).toBe(false);
    expect(state.finance.ledger.filter(entry => entry.payroll?.type === 'prepayment')).toHaveLength(50);
    expect(getClubPayrollSummary(state, clubId)).toMatchObject({ seasonWages: annualClubWages, charged: 0, futureCommitted: annualClubWages, nextInstallment: annualClubWages / 10, savings: 0 });
    expect(getPayrollReserve(state, otherId)).toBe(0);
    expect(enablePayroll(state)).toBe(state);
  });

  it('allocates every cent across ten installments without cumulative rounding drift', () => {
    for (const wage of [1, 7, 10, 11, 1234567, 1800000]) {
      const installments = Array.from({ length: 10 }, (_, index) => payrollInstallment(wage, index + 1, 10));
      expect(installments.reduce((sum, amount) => sum + amount, 0)).toBe(wage);
      expect(Math.max(...installments) - Math.min(...installments)).toBeLessThanOrEqual(1);
    }
    expect(() => payrollInstallment(120000, 0, 10)).toThrow();
    expect(() => payrollInstallment(120000, 11, 10)).toThrow();
    expect(() => payrollInstallment(123.5, 1, 10)).toThrow();
  });

  it('keeps payroll disabled in opt-out games and rejects activation without finance', () => {
    const noFinance = createSeason(9, clubId, 'off', true, true, false);
    expect(noFinance.payroll).toEqual(createPayroll(noFinance.clubs, clubId));
    expect(() => enablePayroll(noFinance)).toThrow(/Enable club finances/);
    expect(() => createSeason(9, clubId, 'off', true, true, false, true)).toThrow(/requires enabled/);
    expect(() => createSeason(9, clubId, 'off', true, true, true, 'yes' as never)).toThrow(/payroll setting/);
    expect(processPayrollRound(noFinance)).toBe(noFinance);
    expect(preparePayrollRound(noFinance)).toBe(noFinance);
    expect(startPayrollSeason(noFinance)).toBe(noFinance);
    expect(getPlayerPayroll(noFinance, playerId)).toBeNull();
    expect(getPayrollReserve(noFinance, clubId)).toBe(0);
    expect(() => setPayrollDelegation(noFinance, true)).toThrow(/Enable player payroll/);
  });

  it('activates midyear prospectively without automatic settlement or changing prepared sporting state', () => {
    let legacy = createSeason(9, clubId, 'off', true, true, true, false);
    for (let index = 0; index < 3; index += 1) legacy = advanceSeason(finish(legacy));
    const original = freeze(legacy), before = structuredClone(original), state = enablePayroll(original);
    expect(state.payroll.enabledSince).toEqual({ seasonNumber: 1, round: 4, ledgerIndex: original.finance.ledger.length });
    expect(state.payroll.agreements.every(agreement => agreement.startsRound === 4)).toBe(true);
    expect(getPayrollReserve(state, clubId)).toBe(annualClubWages * .7);
    expect(state.finance).toBe(original.finance);
    expect(state.activeMatch).toBe(original.activeMatch);
    expect(state.coaching).toBe(original.coaching);
    expect(state.training).toBe(original.training);
    expect(stepMatch(state.activeMatch)).toEqual(stepMatch(original.activeMatch));
    expect(original).toEqual(before);
    const next = advanceSeason(finish(state));
    expect(financeLedgerSlice(next.finance).filter(entry => entry.payroll?.type === 'installment')).toHaveLength(6);
    expect(financeLedgerSlice(next.finance).filter(entry => entry.payroll).every(entry => entry.round >= 4)).toBe(true);
    expect(financeLedgerSlice(next.finance).find(entry => entry.payroll?.type === 'installment' && entry.clubId === otherId)?.payroll?.items).toHaveLength(10);
    expect(financeLedgerSlice(next.finance).filter(entry => entry.payroll?.type === 'prepayment').every(entry => entry.round === 5)).toBe(true);
  });
});

describe('discounted settlement and protected wage commitments', () => {
  it('quotes and settles remaining gross wages once while preserving other players and current match RNG', () => {
    const state = freeze(advanceSeason(finish(createSeason(9, clubId, 'off')))), before = structuredClone(state);
    const quote = quoteWagePrepayment(state, playerId);
    const gross = getSeasonWage(playerId) * .9, discount = Math.floor(gross * .05);
    expect(quote).toMatchObject({ agreementId: `wage-s1-${playerId}`, fromRound: 2, throughRound: 10, gross, discount, amount: gross - discount, otherCommitments: annualClubWages * .9 - gross, canPrepay: true, reason: null });
    const next = prepayWages(state, playerId), row = getPlayerPayroll(next, playerId)!;
    expect(row).toMatchObject({ prepaid: true, futureCommitted: 0, nextInstallment: 0, charged: getSeasonWage(playerId) - discount, savings: discount });
    expect(getFinanceBalance(next.finance, clubId).cash).toBe(getFinanceBalance(state.finance, clubId).cash - quote.amount);
    expect(getPayrollReserve(next, clubId)).toBe(quote.otherCommitments);
    expect(financeLedgerSlice(next.finance).at(-1)).toMatchObject({ kind: 'payroll', amount: -quote.amount, sourceId: `prepay-${quote.agreementId}`, payroll: { type: 'prepayment', fromRound: 2, throughRound: 10, items: [{ agreementId: quote.agreementId, playerId, gross, discount, amount: quote.amount }] } });
    expect(next.activeMatch).toBe(state.activeMatch);
    expect(next.training).toBe(state.training);
    expect(next.coaching).toBe(state.coaching);
    expect(stepMatch(next.activeMatch)).toEqual(stepMatch(state.activeMatch));
    expect(quoteWagePrepayment(next, playerId).canPrepay).toBe(false);
    expect(() => prepayWages(next, playerId)).toThrow(/already prepaid/);
    expect(prepayWages(state, playerId)).toEqual(next);
    expect(state).toEqual(before);
  });

  it('requires enough cash for discounted payment plus every other future wage', () => {
    const base = createSeason(9, clubId, 'off'), quote = quoteWagePrepayment(base, playerId);
    const poor = freeze(cashPosition(base, clubId, quote.requiredCash - 1)), before = structuredClone(poor);
    expect(getFinanceBalance(poor.finance, clubId).cash).toBeGreaterThan(quote.amount);
    expect(quoteWagePrepayment(poor, playerId)).toMatchObject({ canPrepay: false });
    expect(() => prepayWages(poor, playerId)).toThrow(/other players/);
    expect(poor).toEqual(before);
    const exact = cashPosition(base, clubId, quote.requiredCash);
    expect(quoteWagePrepayment(exact, playerId).canPrepay).toBe(true);
    expect(getFinanceBalance(prepayWages(exact, playerId).finance, clubId).cash).toBe(quote.otherCommitments);
  });

  it('rejects unpaid costs, another club player and missing wage agreements without any changes', () => {
    const base = createSeason(), indebted = freeze(cashPosition(base, clubId, 0, 1));
    expect(() => prepayWages(indebted, playerId)).toThrow(/unpaid club costs/);
    expect(() => prepayWages(base, DEVELOPMENT_CLUBS[1]!.players[0]!.id)).toThrow(/your club/);
    expect(() => prepayWages(base, 'missing')).toThrow(/current season wage agreement/);
    expect(getFinanceBalance(indebted.finance, clubId)).toEqual({ cash: 0, unpaid: 1 });
  });

  it('prevents manual and AI staff appointments from spending reserved wages', () => {
    const base = enablePayroll(createSeason(9, clubId, 'off', false, true, true, false));
    const own = cashPosition(base, clubId, annualClubWages + 3_499_999);
    expect(getSpendableCash(own, clubId)).toBe(3_499_999);
    expect(() => hireCoach(freeze(own), 'coach-25')).toThrow(/player wage commitments/);
    const exact = cashPosition(base, clubId, annualClubWages + 3_500_000), hired = hireCoach(exact, 'coach-25');
    expect(getSpendableCash(hired, clubId)).toBe(0);
    expect(getFinanceBalance(hired.finance, clubId).cash).toBe(annualClubWages);
    const ai = cashPosition(base, otherId, annualClubWages + 1);
    expect(getClubCoaching(recruitAiCoaches(ai).coaching, otherId)).toEqual(getClubCoaching(ai.coaching, otherId));
  });
});

describe('shared automatic wage payment policy', () => {
  it('uses stable player order and a cash cushion, with the same settlement rules for the manager', () => {
    const initial = enablePayroll(createSeason(9, clubId, 'off', false, false, true, false));
    const automatic = setPayrollDelegation(freeze(initial), true);
    const entries = automatic.finance.ledger.filter(entry => entry.clubId === clubId && entry.payroll?.type === 'prepayment');
    expect(entries.map(entry => entry.payroll!.items[0]!.playerId)).toEqual(DEVELOPMENT_CLUBS[0]!.players.map(player => player.id).sort());
    let manual = initial;
    for (const player of [...DEVELOPMENT_CLUBS[0]!.players].sort((a, b) => a.id < b.id ? -1 : 1)) manual = prepayWages(manual, player.id);
    expect(automatic.finance).toEqual(manual.finance);
    expect(automatic.activeMatch).toBe(initial.activeMatch);
    expect(setPayrollDelegation(automatic, false).finance).toBe(automatic.finance);
    expect(preparePayrollRound(preparePayrollRound(automatic))).toEqual(preparePayrollRound(automatic));
    expect(() => setPayrollDelegation(initial, 'yes' as never)).toThrow(/manual or delegated/);
  });

  it('keeps cash below the automatic cushion on installments while manual payment can remain affordable', () => {
    const base = enablePayroll(createSeason(9, clubId, 'off', false, false, true, false));
    const quoted = quoteWagePrepayment(base, playerId);
    const state = cashPosition(base, clubId, quoted.requiredCash + PAYROLL_AUTOMATION_CUSHION - 1);
    const automatic = setPayrollDelegation(state, true);
    expect(getPlayerPayroll(automatic, playerId)!.prepaid).toBe(false);
    expect(automatic.finance).toBe(state.finance);
    expect(quoteWagePrepayment(state, playerId).canPrepay).toBe(true);
    expect(getPlayerPayroll(prepayWages(state, playerId), playerId)!.prepaid).toBe(true);
    expect(getPlayerPayroll(setPayrollDelegation(cashPosition(base, clubId, quoted.requiredCash + PAYROLL_AUTOMATION_CUSHION), true), playerId)!.prepaid).toBe(true);
  });
});

describe('atomic payroll calendar and retained agreements', () => {
  let completed: SeasonState;
  beforeAll(() => { completed = finishSeason(createSeason(9, clubId, 'off', false, false)); });

  it('charges all ten installments for every player, including unused reserves, and retains zero club entries after prepayment', () => {
    const ownEntries = completed.finance.ledger.filter(entry => entry.clubId === clubId && entry.payroll?.type === 'installment');
    expect(ownEntries).toHaveLength(10);
    expect(ownEntries.every(entry => entry.payroll!.items.length === 10)).toBe(true);
    expect(ownEntries.reduce((sum, entry) => sum - entry.amount, 0)).toBe(annualClubWages);
    for (const player of DEVELOPMENT_CLUBS[0]!.players) expect(getPlayerPayroll(completed, player.id)).toMatchObject({ charged: getSeasonWage(player.id), savings: 0, futureCommitted: 0, nextInstallment: 0, prepaid: false });
    const otherEntries = completed.finance.ledger.filter(entry => entry.clubId === otherId && entry.payroll?.type === 'installment');
    expect(otherEntries).toHaveLength(10);
    expect(otherEntries.every(entry => Object.is(entry.amount, 0) && entry.payroll!.items.length === 0)).toBe(true);
    expect(JSON.parse(JSON.stringify(otherEntries))).toEqual(otherEntries);
    expect(getPayrollReserve(completed, clubId)).toBe(0);
    expect(getClubPayrollSummary(completed, clubId).nextInstallment).toBe(0);
    expect(() => processPayrollRound(completed)).toThrow(/already been recorded/);
    expect(() => prepayWages(completed, playerId)).toThrow(/next season/);
    expect(() => enablePayroll({ ...completed, payroll: createPayroll(completed.clubs, clubId) })).toThrow(/next season/);
    expect(setPayrollDelegation(completed, true).finance).toBe(completed.finance);
  });

  it('pays an injured player and a zero-minute reserve without checking match availability', () => {
    const starting = createSeason(9, clubId, 'standard', false, false), next = advanceSeason(finish(starting));
    // Isolate financial eligibility from sporting participation: the posted result marks a reserve DNP.
    const clean: SeasonState = { ...starting, fixtures: structuredClone(next.fixtures) };
    const unused = DEVELOPMENT_CLUBS[0]!.players.at(-1)!;
    const fixture = clean.fixtures.find(fixture => fixture.id === starting.activeFixtureId)!;
    const stats = fixture.result!.stats[unused.id]!;
    for (const key of Object.keys(stats) as (keyof typeof stats)[]) if (key !== 'condition') stats[key] = 0;
    const funded = processFinanceRound(clean);
    const injured = { ...funded, injuries: [{ id: 'test-injury', playerId, clubId, kind: 'ankle' as const, fixtureId: starting.activeFixtureId, occurredOn: starting.date, returnOn: '2027-01-01' }] };
    const charged = processPayrollRound(injured);
    expect(charged.finance).toEqual(processPayrollRound(funded).finance);
    const items = charged.finance.ledger.find(entry => entry.clubId === clubId && entry.payroll?.type === 'installment')!.payroll!.items;
    expect(items.find(item => item.playerId === unused.id)!.amount).toBe(payrollInstallment(getSeasonWage(unused.id), 1, 10));
    expect(items.find(item => item.playerId === playerId)!.amount).toBe(payrollInstallment(getSeasonWage(playerId), 1, 10));
  });

  it('records mandatory wages even without cash, showing charged obligations rather than pretending they were paid', () => {
    const initial = createSeason(9, clubId, 'off', false, false), posted = advanceSeason(finish(initial));
    const input = cashPosition({ ...initial, fixtures: posted.fixtures }, clubId, 0);
    const next = processPayrollRound(freeze(input));
    expect(getFinanceBalance(next.finance, clubId)).toEqual({ cash: 0, unpaid: annualClubWages / 10 });
    expect(getClubPayrollSummary(next, clubId)).toMatchObject({ charged: annualClubWages / 10, futureCommitted: annualClubWages * .9 });
    expect(getSpendableCash(next, clubId)).toBe(0);
  });

  it('preserves the input if a later club has a missing agreement after earlier payroll entries were calculated', () => {
    const initial = createSeason(9, clubId, 'off', false, false), posted = advanceSeason(finish(initial));
    const missing = initial.clubs.at(-1)!.players[0]!.id;
    const invalid = freeze({ ...initial, fixtures: posted.fixtures, payroll: { ...initial.payroll, agreements: initial.payroll.agreements.filter(agreement => agreement.playerId !== missing) } });
    const before = structuredClone(invalid);
    expect(() => processPayrollRound(invalid)).toThrow(/current wage agreement/);
    expect(invalid).toEqual(before);
    expect(() => processPayrollRound(initial)).toThrow(/every matchday result/);
  });

  it('retains past agreements and liabilities at rollover and reserves the new year before staff renewals', () => {
    const completedWithCoach = finishSeason(createSeason(7, clubId, 'off', false, true));
    const paidDown = cashPosition(completedWithCoach, clubId, 0, 5_000_000);
    const before = freeze(paidDown), next = rolloverSeason(before);
    expect(next.payroll.agreements).toHaveLength(120);
    expect(next.payroll.agreements.slice(0, 60)).toEqual(before.payroll.agreements);
    expect(next.payroll.agreements.slice(60).every(agreement => agreement.seasonNumber === 2 && agreement.startsRound === 1)).toBe(true);
    expect(financeLedgerSlice(next.finance).slice(0, before.finance.ledger.length)).toEqual(before.finance.ledger);
    expect(getFinanceBalance(next.finance, clubId)).toEqual({ cash: ANNUAL_SPONSORSHIP - 5_000_000, unpaid: 0 });
    expect(getPayrollReserve(next, clubId)).toBe(annualClubWages);
    expect(getSpendableCash(next, clubId)).toBe(0);
    expect(getClubCoaching(next.coaching, clubId)).toHaveLength(0);
    expect(financeLedgerSlice(next.finance).slice(before.finance.ledger.length, before.finance.ledger.length + 6).every(entry => entry.kind === 'sponsor')).toBe(true);
    expect(() => startPayrollSeason(next)).toThrow(/already exist/);
    expect(rolloverSeason(before)).toEqual(next);
    expect(before.payroll.agreements).toHaveLength(60);
    expect(next.payroll.agreements.slice(0, 60).every(agreement => agreementCommitted(agreement, financeLedgerSlice(next.finance), 10, 10) === 0)).toBe(true);
  });

  it('supports final-round activation and never back-charges earlier rounds', () => {
    let legacy = createSeason(13, clubId, 'off', false, false, true, false);
    while (legacy.round < 10) legacy = advanceSeason(finish(legacy));
    const enabled = enablePayroll(finish(legacy));
    expect(getPayrollReserve(enabled, clubId)).toBe(annualClubWages / 10);
    const final = advanceSeason(enabled);
    expect(final.finance.ledger.filter(entry => entry.payroll?.type === 'installment')).toHaveLength(6);
    expect(final.finance.ledger.filter(entry => entry.payroll).every(entry => entry.round === 10)).toBe(true);
    expect(getPayrollReserve(final, clubId)).toBe(0);
    expect(rolloverSeason(final).payroll.agreements).toHaveLength(120);
    expect(getActiveFixture(final).result).not.toBeNull();
  });
});
