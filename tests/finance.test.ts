import { beforeAll, describe, expect, it } from 'vitest';
import type { FinanceEntry, SeasonFinance } from '../src/domain/finance';
import type { SeasonState } from '../src/domain/season';
import { DEVELOPMENT_CLUBS } from '../src/data/development-league';
import { DEVELOPMENT_COACHES } from '../src/data/development-coaches';
import { setAutoSubstitutions, simulateToEnd, stepMatch } from '../src/engine/match';
import { coachingCommitted, enableCoaching, getClubCoaching, hireCoach, recruitAiCoaches, releaseCoach, renewSeasonCoaching, setCoachRenewal } from '../src/world/coaching';
import { ANNUAL_SPONSORSHIP, createFinance, DEFAULT_TICKET_PRICE, enableFinance, financeLedgerRows, forecastGate, getClubFinanceDefinition, getFinanceBalance, MAX_TICKET_PRICE, OPENING_CASH, prepareFinanceRound, processFinanceRound, recommendTicketPrice, recordCoachFee, ROUND_OPERATING_COST, setTicketPlan, startFinanceSeason } from '../src/world/finance';
import { advanceSeason, createSeason as createSeasonWithPayroll, getActiveFixture, managedSide, rolloverSeason } from '../src/world/season';
import type { InjuryMode } from '../src/domain/types';

// These cases isolate the pre-payroll financial model; payroll has its own integration suite.
const createSeason = (seed?: number, club?: string, injury?: InjuryMode, training?: boolean, coaching?: boolean, finance?: boolean) => createSeasonWithPayroll(seed, club, injury, training, coaching, finance, false);

const clubId = DEVELOPMENT_CLUBS[0]!.id;
const otherId = DEVELOPMENT_CLUBS[1]!.id;
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
/** Isolated balance/affordability fixtures; fabricated obligations are not claimed to be importable saves. */
function expense(state: SeasonState, id: string, amount: number): SeasonState {
  const entry: FinanceEntry = { id: `finance-${state.finance.ledger.length + 1}`, clubId: id, seasonNumber: state.seasonNumber, round: state.round, kind: 'operations', amount: -amount, sourceId: `test-cost-${state.finance.ledger.length}`, ticket: null, coach: null, payroll: null };
  return { ...state, finance: { ...state.finance, ledger: [...state.finance.ledger, entry] } };
}

describe('fictional gates and locked ticket decisions', () => {
  it('starts every club with the same funding and charges its starter contract exactly once', () => {
    const state = createSeason();
    expect(state.finance.enabledSince).toEqual({ seasonNumber: 1, round: 1 });
    expect(state.finance.ledger).toHaveLength(18);
    expect(state.finance.ledger.map(entry => entry.id)).toEqual(Array.from({ length: 18 }, (_, index) => `finance-${index + 1}`));
    for (const club of state.clubs) {
      expect(getFinanceBalance(state.finance, club.id)).toEqual({ cash: OPENING_CASH + ANNUAL_SPONSORSHIP - 4_000_000, unpaid: 0 });
      const definition = getClubFinanceDefinition(club.id);
      expect(definition.capacity).toBeGreaterThanOrEqual(3200);
      expect(definition.referenceDemand).toBeLessThan(definition.capacity);
      expect(definition.venue).toContain('Arena');
    }
    expect(state.finance.plans[clubId]).toEqual({ delegated: false, price: DEFAULT_TICKET_PRICE });
    expect(enableFinance(state)).toBe(state);
  });

  it('models capped demand, free entry and declining attendance without any sporting state changes', () => {
    const state = freeze(createSeason()), fixture = getActiveFixture(state), venue = getClubFinanceDefinition(fixture.homeClubId);
    const before = structuredClone(state);
    expect(forecastGate(state, fixture, 0)).toMatchObject({ attendance: venue.capacity, revenue: 0 });
    expect(forecastGate(state, fixture, 100).attendance).toBe(venue.capacity);
    expect(forecastGate(state, fixture, 1800)).toMatchObject({ attendance: venue.referenceDemand, revenue: venue.referenceDemand * 1800 });
    expect(forecastGate(state, fixture, 3600).attendance).toBe(Math.floor(venue.referenceDemand * .5 ** 1.4));
    expect(forecastGate(state, fixture, 6000).attendance).toBeLessThan(forecastGate(state, fixture, 3600).attendance);
    expect(state).toEqual(before);
  });

  it('uses only earlier committed fixtures for both teams form, independent of fixture array order', () => {
    const fixture = { id: 'target', round: 3, homeClubId: clubId, awayClubId: otherId };
    const earlier = { id: 'earlier', round: 1, homeClubId: clubId, awayClubId: otherId, result: { winnerClubId: clubId } };
    const later = { ...earlier, id: 'future', round: 4, result: { winnerClubId: otherId } };
    const current = { ...fixture, result: { winnerClubId: otherId } };
    const expected = Math.floor(getClubFinanceDefinition(clubId).referenceDemand * 1.15 * .9);
    const context = { fixtures: [later, current, earlier] };
    expect(forecastGate(context, fixture, 1800).attendance).toBe(expected);
    expect(forecastGate(context, fixture, 1800)).toEqual(forecastGate({ fixtures: [earlier] }, fixture, 1800));
    expect(forecastGate({ fixtures: [{ ...earlier, result: null }] }, fixture, 1800).attendance).toBe(getClubFinanceDefinition(clubId).referenceDemand);
  });

  it('uses one revenue optimizer for every club and breaks any revenue ties toward the lower price', () => {
    const state = createSeason();
    for (const fixture of state.fixtures.filter(fixture => fixture.round === 1)) {
      const choice = recommendTicketPrice(state, fixture);
      const gates = Array.from({ length: MAX_TICKET_PRICE / 100 + 1 }, (_, index) => forecastGate(state, fixture, index * 100));
      const best = Math.max(...gates.map(gate => gate.revenue));
      expect(choice).toBe(gates.find(gate => gate.revenue === best)!.price);
      const delegated = { ...state, finance: { ...state.finance, plans: { ...state.finance.plans, [fixture.homeClubId]: { delegated: true, price: 6000 } } } };
      expect(prepareFinanceRound(delegated).finance.roundPrices[fixture.homeClubId]).toBe(choice);
    }
    const away = state.clubs.find(club => !state.fixtures.some(fixture => fixture.round === 1 && fixture.homeClubId === club.id))!;
    expect(state.finance.roundPrices[away.id]).toBe(state.finance.plans[away.id]!.price);
  });

  it('leaves the current price locked when plans change before play or after the final whistle', () => {
    const original = freeze(createSeason(9, clubId, 'off', false, false));
    const revised = setTicketPlan(original, { delegated: false, price: 6000 });
    expect(revised.finance.roundPrices).toBe(original.finance.roundPrices);
    expect(revised.activeMatch).toBe(original.activeMatch);
    const pending = finish(revised);
    const cheaper = setTicketPlan(pending, { delegated: false, price: 0 });
    expect(cheaper.finance.roundPrices).toBe(original.finance.roundPrices);
    const next = advanceSeason(cheaper);
    expect(next.finance.ledger.find(entry => entry.ticket?.fixtureId === original.activeFixtureId)?.ticket?.price).toBe(1800);
    expect(next.finance.roundPrices[clubId]).toBe(0);
    expect(stepMatch(revised.activeMatch)).toEqual(stepMatch(original.activeMatch));
  });

  it.each([-100, 50, 6001, 6100, NaN, Infinity])('rejects invalid ticket price %s atomically', price => {
    const state = freeze(createSeason()), before = structuredClone(state);
    expect(() => setTicketPlan(state, { delegated: false, price })).toThrow(/ticket price/);
    expect(() => forecastGate(state, getActiveFixture(state), price)).toThrow(/ticket price/);
    expect(state).toEqual(before);
  });

  it('validates delegation and keeps disabled finances inert', () => {
    const state = createSeason(9, clubId, 'off', false, false, false);
    expect(state.finance).toEqual(createFinance(state.clubs, clubId));
    expect(processFinanceRound(state)).toBe(state);
    expect(prepareFinanceRound(state)).toBe(state);
    expect(startFinanceSeason(state)).toBe(state);
    expect(() => setTicketPlan(state, { delegated: false, price: 1800 })).toThrow(/Enable/);
    expect(() => setTicketPlan(enableFinance(state), { delegated: 1 as never, price: 1800 })).toThrow(/ticket policy/);
    expect(() => createSeason(9, clubId, 'off', false, false, 'yes' as never)).toThrow(/finance setting/);
  });
});

describe('cash, unpaid obligations and staff affordability', () => {
  it('pays expenses from cash and applies later income to unpaid costs before increasing cash', () => {
    const base = createFinance(DEVELOPMENT_CLUBS, clubId);
    const finance: SeasonFinance = { ...base, ledger: [100, -140, 25, 20, -10].map((amount, index) => ({ id: `finance-${index + 1}`, clubId, seasonNumber: 1, round: 1, kind: amount >= 0 ? 'sponsor' : 'operations', amount, sourceId: `test-${index}`, ticket: null, coach: null, payroll: null })) };
    const before = structuredClone(finance);
    expect(getFinanceBalance(finance, clubId)).toEqual({ cash: 0, unpaid: 5 });
    const rows = financeLedgerRows(finance, clubId);
    expect(rows.map(row => [row.cashAfter, row.unpaidAfter])).toEqual([[0, 5], [5, 0], [0, 15], [0, 40], [100, 0]]);
    expect(rows.map(row => [row.cashDelta, row.unpaidDelta])).toEqual([[-5, 5], [5, -15], [0, -25], [-100, 40], [100, 0]]);
    expect(rows.reduce((sum, row) => sum + row.cashDelta, 0)).toBe(0);
    expect(rows.reduce((sum, row) => sum + row.unpaidDelta, 0)).toBe(5);
    expect(getFinanceBalance(finance, otherId)).toEqual({ cash: 0, unpaid: 0 });
    expect(finance).toEqual(before);
  });

  it('charges a hire once, never refunds a release, and charges a fresh obligation on rehiring', () => {
    const state = freeze(createSeason()), hired = hireCoach(state, 'coach-25');
    expect(getFinanceBalance(hired.finance, clubId).cash).toBe(getFinanceBalance(state.finance, clubId).cash - 3_500_000);
    const contract = getClubCoaching(hired.coaching, clubId).find(contract => contract.coachId === 'coach-25')!;
    const released = releaseCoach(hired, contract.id);
    expect(released.finance).toBe(hired.finance);
    const rehired = hireCoach(released, 'coach-25');
    expect(getFinanceBalance(rehired.finance, clubId).cash).toBe(getFinanceBalance(hired.finance, clubId).cash - 3_500_000);
    expect(() => recordCoachFee(hired, contract)).toThrow(/already been recorded/);
    expect(hired.activeMatch).toBe(state.activeMatch);
    expect(hired.training).toBe(state.training);
  });

  it('rejects unaffordable discretionary hiring without spending cash or altering contracts', () => {
    const base = createSeason();
    const poor = freeze(expense(base, clubId, getFinanceBalance(base.finance, clubId).cash - 3_499_999));
    const before = structuredClone(poor);
    expect(() => hireCoach(poor, 'coach-25')).toThrow(/enough cash/);
    expect(poor).toEqual(before);
    const indebted = expense(poor, clubId, 3_500_000);
    expect(getFinanceBalance(indebted.finance, clubId)).toEqual({ cash: 0, unpaid: 1 });
    expect(() => hireCoach(indebted, 'coach-25')).toThrow(/unpaid costs/);
    const legacy = { ...poor, finance: createFinance(poor.clubs, clubId) };
    expect(getClubCoaching(hireCoach(legacy, 'coach-25').coaching, clubId)).toHaveLength(2);
  });

  it('uses the same cash guard for AI clubs, with every successful hire backed by a fee', () => {
    const base = createSeason();
    const poor = expense(base, otherId, getFinanceBalance(base.finance, otherId).cash + 1);
    const next = recruitAiCoaches(poor);
    expect(getClubCoaching(next.coaching, otherId)).toEqual(getClubCoaching(poor.coaching, otherId));
    expect(getClubCoaching(next.coaching, clubId)).toEqual(getClubCoaching(poor.coaching, clubId));
    expect(next.coaching.contracts.length).toBeGreaterThan(poor.coaching.contracts.length);
    for (const contract of next.coaching.contracts) {
      const fees = next.finance.ledger.filter(entry => entry.coach?.contractId === contract.id);
      expect(fees).toHaveLength(1);
      expect(fees[0]!.amount).toBe(-DEVELOPMENT_COACHES.find(coach => coach.id === contract.coachId)!.fee);
    }
    expect(recruitAiCoaches(next)).toEqual(next);
  });

  it('enables coaching once, pays affordable starters and leaves an unaffordable club vacant', () => {
    const base = createSeason(9, clubId, 'off', true, false);
    const poor = freeze(expense(base, otherId, getFinanceBalance(base.finance, otherId).cash + 1));
    const state = enableCoaching(poor);
    expect(state.coaching.enabledSince).toEqual({ seasonNumber: 1, round: 1 });
    expect(getClubCoaching(state.coaching, otherId)).toHaveLength(0);
    expect(state.coaching.contracts).toHaveLength(5);
    expect(state.finance.ledger.filter(entry => entry.kind === 'coaching')).toHaveLength(5);
    expect(getFinanceBalance(state.finance, clubId).cash).toBe(OPENING_CASH + ANNUAL_SPONSORSHIP - 4_000_000);
    expect(state.activeMatch).toBe(poor.activeMatch);
    expect(state.training).toBe(poor.training);
    expect(enableCoaching(state)).toBe(state);
  });
});

describe('calendar finance commits and carryover', () => {
  let completed: SeasonState;
  beforeAll(() => { completed = finishSeason(createSeason(9, clubId, 'off', false, true)); });

  it('requires every result, records one gate per home game and one operating cost per club through the final round', () => {
    expect(() => processFinanceRound(createSeason())).toThrow(/every game/);
    expect(completed.status).toBe('complete');
    expect(completed.finance.ledger.filter(entry => entry.kind === 'tickets')).toHaveLength(30);
    expect(completed.finance.ledger.filter(entry => entry.kind === 'operations')).toHaveLength(60);
    for (const club of completed.clubs) {
      expect(completed.finance.ledger.filter(entry => entry.clubId === club.id && entry.kind === 'tickets')).toHaveLength(5);
      expect(completed.finance.ledger.filter(entry => entry.clubId === club.id && entry.kind === 'operations').reduce((sum, entry) => sum + entry.amount, 0)).toBe(-10 * ROUND_OPERATING_COST);
    }
    const final = completed.finance.ledger.filter(entry => entry.round === 10);
    expect(final.map(entry => entry.kind)).toEqual(['tickets', 'tickets', 'tickets', 'operations', 'operations', 'operations', 'operations', 'operations', 'operations']);
    const frozen = freeze(structuredClone(completed)), before = structuredClone(frozen);
    expect(() => processFinanceRound(frozen)).toThrow(/already been recorded/);
    expect(() => advanceSeason(frozen)).toThrow(/complete/);
    expect(frozen).toEqual(before);
  });

  it('settles a mandatory operating obligation even when current gate revenue cannot cover it', () => {
    const first = createSeason(9, clubId, 'off', false, false);
    const posted = advanceSeason(finish(first));
    let input: SeasonState = { ...first, fixtures: posted.fixtures };
    input = expense(input, clubId, getFinanceBalance(input.finance, clubId).cash);
    input = { ...input, finance: { ...input.finance, roundPrices: { ...input.finance.roundPrices, [clubId]: 0 } } };
    const next = processFinanceRound(freeze(input));
    expect(getFinanceBalance(next.finance, clubId)).toEqual({ cash: 0, unpaid: ROUND_OPERATING_COST });
    expect(next.finance.ledger.filter(entry => entry.kind === 'operations' && entry.clubId === clubId)).toHaveLength(2);
    expect(next.finance.ledger.find(entry => entry.kind === 'tickets' && entry.clubId === clubId)?.amount).toBe(0);
  });

  it('leaves input unchanged if a later gate fails after earlier gates were calculated', () => {
    const initial = createSeason(9, clubId, 'off', false, false), posted = advanceSeason(finish(initial));
    const lastHome = initial.fixtures.filter(fixture => fixture.round === 1).at(-1)!.homeClubId;
    const input = freeze({ ...initial, fixtures: posted.fixtures, finance: { ...initial.finance, roundPrices: { ...initial.finance.roundPrices, [lastHome]: 55 } } });
    const before = structuredClone(input);
    expect(() => processFinanceRound(input)).toThrow(/ticket price/);
    expect(input).toEqual(before);
    expect(input.finance.ledger.some(entry => entry.kind === 'tickets')).toBe(false);
  });

  it('activates midyear without rewriting results, match snapshots or old training and charges released contracts too', () => {
    let legacy = createSeason(9, clubId, 'off', true, true, false);
    legacy = advanceSeason(finish(legacy));
    legacy = advanceSeason(finish(legacy));
    legacy = releaseCoach(legacy, getClubCoaching(legacy.coaching, clubId)[0]!.id);
    const before = freeze(legacy), next = enableFinance(before);
    expect(next.finance.enabledSince).toEqual({ seasonNumber: 1, round: 3 });
    expect(next.finance.ledger.every(entry => entry.round === 3)).toBe(true);
    expect(next.finance.ledger.some(entry => ['tickets', 'operations'].includes(entry.kind))).toBe(false);
    expect(getFinanceBalance(next.finance, clubId).cash).toBe(OPENING_CASH + ANNUAL_SPONSORSHIP * .8 - coachingCommitted(next.coaching, clubId));
    expect(next.finance.ledger.filter(entry => entry.kind === 'coaching')).toHaveLength(legacy.coaching.contracts.length);
    expect(next.activeMatch).toBe(before.activeMatch);
    expect(next.fixtures).toBe(before.fixtures);
    expect(next.coaching).toBe(before.coaching);
    expect(next.training).toBe(before.training);
    expect(stepMatch(next.activeMatch)).toEqual(stepMatch(before.activeMatch));
    expect(() => enableFinance({ ...completed, finance: createFinance(completed.clubs, clubId) })).toThrow(/next season/);
    expect(() => enableCoaching({ ...completed, coaching: { model: 'coaching-1', enabledSince: null, contracts: [] } })).toThrow(/next season/);
  });

  it('can activate at the pending final result, with one final gate/cost round and a tenth of sponsorship', () => {
    let legacy = createSeason(19, clubId, 'off', false, true, false);
    while (legacy.round < 10) legacy = advanceSeason(finish(legacy));
    const pending = freeze(finish(legacy)), activated = enableFinance(pending);
    expect(activated.activeMatch).toBe(pending.activeMatch);
    expect(activated.finance.enabledSince).toEqual({ seasonNumber: 1, round: 10 });
    expect(activated.finance.ledger.filter(entry => entry.kind === 'sponsor').every(entry => entry.amount === ANNUAL_SPONSORSHIP / 10)).toBe(true);
    const final = advanceSeason(activated);
    expect(final.status).toBe('complete');
    expect(final.finance.ledger.filter(entry => entry.kind === 'tickets')).toHaveLength(3);
    expect(final.finance.ledger.filter(entry => entry.kind === 'operations')).toHaveLength(6);
    expect(final.finance.ledger.every(entry => entry.round === 10)).toBe(true);
    expect(final.fixtures).toEqual(advanceSeason(pending).fixtures);
    const next = rolloverSeason(final);
    expect(next.finance.ledger.filter(entry => entry.kind === 'opening')).toHaveLength(6);
    expect(next.finance.ledger.filter(entry => entry.kind === 'sponsor')).toHaveLength(12);
  });

  it('carries the full ledger, receives yearly sponsorship once and pays renewed contracts after funding', () => {
    const initial = freeze(setCoachRenewal(completed, getClubCoaching(completed.coaching, clubId)[0]!.id, false));
    const before = structuredClone(initial), next = rolloverSeason(initial);
    expect(next.seasonNumber).toBe(2);
    expect(next.finance.ledger.slice(0, initial.finance.ledger.length)).toEqual(initial.finance.ledger);
    const additions = next.finance.ledger.slice(initial.finance.ledger.length);
    expect(additions.slice(0, 6).map(entry => entry.kind)).toEqual(Array(6).fill('sponsor'));
    expect(additions.slice(0, 6).every(entry => entry.amount === ANNUAL_SPONSORSHIP && entry.round === 1 && entry.seasonNumber === 2)).toBe(true);
    expect(additions.some(entry => entry.kind === 'opening')).toBe(false);
    expect(getClubCoaching(next.coaching, clubId)).toHaveLength(0);
    expect(getFinanceBalance(next.finance, clubId).cash).toBe(getFinanceBalance(initial.finance, clubId).cash + ANNUAL_SPONSORSHIP);
    for (const contract of next.coaching.contracts) expect(next.finance.ledger.filter(entry => entry.coach?.contractId === contract.id)).toHaveLength(1);
    expect(() => startFinanceSeason(next)).toThrow(/already been recorded/);
    expect(rolloverSeason(initial)).toEqual(next);
    expect(initial).toEqual(before);
  });

  it('uses new-year income to clear debt before renewal and lets unaffordable contracts lapse', () => {
    const cash = getFinanceBalance(completed.finance, clubId).cash;
    const indebted = expense(completed, clubId, cash + ANNUAL_SPONSORSHIP + 1);
    const next = rolloverSeason(freeze(indebted));
    expect(getFinanceBalance(next.finance, clubId)).toEqual({ cash: 0, unpaid: 1 });
    expect(getClubCoaching(next.coaching, clubId)).toHaveLength(0);
    expect(next.finance.ledger.some(entry => entry.seasonNumber === 2 && entry.kind === 'coaching' && entry.clubId === clubId)).toBe(false);
    expect(() => renewSeasonCoaching(completed, completed.coaching)).toThrow(/opening day/);
  });

  it('leaves sporting continuation identical while healthy clubs have enough cash under either finance setting', () => {
    const enabled = createSeason(11, clubId, 'off', true, true, true);
    const disabled = createSeason(11, clubId, 'off', true, true, false);
    expect(enabled.activeMatch).toEqual(disabled.activeMatch);
    const a = advanceSeason(finish(freeze(enabled))), b = advanceSeason(finish(freeze(disabled)));
    expect(a.activeMatch).toEqual(b.activeMatch);
    expect(a.coaching).toEqual(b.coaching);
    expect(a.training).toEqual(b.training);
    expect(a.fixtures).toEqual(b.fixtures);
    expect(b.finance.ledger).toEqual([]);
    expect(advanceSeason(finish(enabled))).toEqual(a);
  });
});
