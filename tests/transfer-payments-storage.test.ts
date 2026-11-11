import { stripInSeasonRecruitment } from './helpers/legacy-season';
import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { getSeasonWage } from '../src/data/development-wages';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { parseSeason, serializeSeason, validateSeasonState } from '../src/storage/season-storage';
import { contractForSeason, getClubContractSummary } from '../src/world/employment-policy';
import { advanceMarket, decideClubTransfer, submitMarketOffer, submitTransferOffer } from '../src/world/market';
import { getLiveMarketOffers, getMarketStartReason } from '../src/world/market-policy';
import { getTransferCandidates, quoteTransferOffer, requiredTransferFee } from '../src/world/transfers-policy';
import { getTransferPaymentSummary } from '../src/world/transfer-payments';
import { setTicketPlan } from '../src/world/finance';
import { prepayWages, quoteWagePrepayment, setPayrollDelegation } from '../src/world/payroll';
import { advanceSeason, createSeason, managedSide, rolloverSeason } from '../src/world/season';

const managed = 'rhine-falcons', seller = 'aegean-waves';
const play = (state: SeasonState) => advanceSeason({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) });
const complete = (initial: SeasonState): SeasonState => { let state = initial; while (state.status === 'active') state = play(state); return state; };
const encode = (state: unknown, formatVersion = 23) => JSON.stringify({ format: 'basketball-manager-season', formatVersion, engineVersion: 'possession-3', state });
const settleWindow = (initial: SeasonState): SeasonState => {
  let state = initial;
  for (let attempts = 0; getMarketStartReason(state) && attempts < 35; attempts += 1) {
    for (const offer of getLiveMarketOffers(state).filter(offer => offer.status === 'club-review' && offer.transfer?.sellerClubId === managed)) state = decideClubTransfer(state, offer.id, 'reject');
    if (getMarketStartReason(state)) state = advanceMarket(state);
  }
  return state;
};

let pending: SeasonState, accepted: SeasonState, opening: SeasonState, middle: SeasonState, finished: SeasonState, upfront: SeasonState;
beforeAll(() => {
  let opened = advanceMarket(complete(createSeason(113, managed, 'off', true, true, true, true, null, true, true, true, true)));
  const target = getClubContractSummary(opened, seller).contracts[0]!.playerId;
  const fee = requiredTransferFee(opened, target);
  pending = submitTransferOffer(opened, target, getSeasonWage(target) + 200_000, 3, fee, managed, 'three-payments');
  accepted = advanceMarket(advanceMarket(pending));
  upfront = advanceMarket(advanceMarket(submitTransferOffer(opened, target, getSeasonWage(target) + 200_000, 3, fee)));
  opened = accepted;
  for (const player of opened.clubs.find(club => club.id === managed)!.players.slice(0, 8)) opened = submitMarketOffer(opened, player.id, getSeasonWage(player.id), 1);
  opening = rolloverSeason(settleWindow(advanceMarket(opened)));
  middle = opening;
  while (middle.round < 6) middle = play(middle);
  finished = complete(middle);
}, 120_000);

describe('installment transfer saves', () => {
  it('round-trips pending plans, completion, opening-day payments, round-six payments and the next market', () => {
    for (const state of [pending, accepted, opening, middle, finished]) expect(parseSeason(serializeSeason(state))).toEqual(state);
    const transfer = accepted.employment.transfers[0]!;
    expect(transfer.payments).toHaveLength(1);
    expect(opening.employment.transfers[0]!.payments).toHaveLength(2);
    expect(middle.employment.transfers[0]!.payments).toHaveLength(3);
    expect(finished.employment.transfers[0]!.payments.reduce((sum, payment) => sum + payment.amount, 0)).toBe(transfer.fee);
    expect(advanceMarket(parseSeason(serializeSeason(finished)))).toEqual(advanceMarket(finished));
  }, 60_000);

  it('validates schema15 first, preserves cash history, then gives old transfers an upfront receipt', () => {
    const legacy = structuredClone(upfront) as unknown as { schemaVersion: number; employment: { transfers: Array<Record<string, unknown>> }; market: { windows: Array<{ offers: Array<{ transfer: Record<string, unknown> | null }> }> } };
    stripInSeasonRecruitment(legacy); legacy.schemaVersion = 15;
    delete (legacy.employment as unknown as Record<string, unknown>).buyouts;
    for (const transfer of legacy.employment.transfers) { delete transfer.paymentPlan; delete transfer.installments; delete transfer.payments; }
    for (const window of legacy.market.windows) for (const offer of window.offers) if (offer.transfer) delete offer.transfer.paymentPlan;
    const restored = parseSeason(encode(legacy, 15));
    expect(restored).toEqual({ ...upfront, recruitment: { model: 'recruitment-1', enabledSince: null, transfersEnabledSince: null, events: [], offers: [] } });
    expect(restored.finance.ledger).toEqual(upfront.finance.ledger);
    const damaged = structuredClone(legacy);
    damaged.employment.transfers[0]!.fee = Number(damaged.employment.transfers[0]!.fee) + 100_000;
    expect(() => parseSeason(encode(damaged, 15))).toThrow();
  });

  it('preserves genuine partial payments and later gate-income recovery, rejecting a removed mandatory receipt', () => {
    let state = advanceMarket(complete(createSeason(53, managed, 'off', true, true, true, true, null, true, true, true, true)));
    for (const player of state.clubs.find(club => club.id === managed)!.players.slice(0, 8)) state = submitMarketOffer(state, player.id, getSeasonWage(player.id), 1);
    state = advanceMarket(state);
    for (const seller of ['aegean-waves', 'alpine-stags']) {
      const target = getTransferCandidates(state).find(player => contractForSeason(state.employment, player.id, 2)?.clubId === seller && quoteTransferOffer(state, player.id, 5_000_000, 1, 30_000_000).canOffer)!;
      expect(target).toBeDefined();
      state = submitTransferOffer(state, target.id, 5_000_000, 1, 30_000_000, managed, 'three-payments');
    }
    state = settleWindow(advanceMarket(advanceMarket(state)));
    state = rolloverSeason(setTicketPlan(state, { delegated: false, price: 0 }));
    while (state.round < 6) state = play(state);
    expect(getTransferPaymentSummary(state, managed).overdue).toBeGreaterThan(0);
    expect(parseSeason(serializeSeason(state))).toEqual(state);
    const prepaid = prepayWages(state, 'rhf-1');
    expect(quoteWagePrepayment(state, 'rhf-1').canPrepay).toBe(true);
    expect(parseSeason(serializeSeason(prepaid))).toEqual(prepaid);
    const afterPrepaymentRound = play(prepaid);
    expect(parseSeason(serializeSeason(afterPrepaymentRound))).toEqual(afterPrepaymentRound);
    const delegated = setPayrollDelegation(state, true);
    expect(parseSeason(serializeSeason(delegated))).toEqual(delegated);
    const corrupted = structuredClone(state);
    const partial = corrupted.employment.transfers.find(transfer => transfer.toClubId === managed && transfer.payments.some(payment => payment.installmentIndex === 2 && payment.amount < transfer.installments[2]!.amount))!;
    expect(partial).toBeDefined();
    const removed = partial.payments.pop()!;
    corrupted.finance.ledger = corrupted.finance.ledger.filter(entry => entry.sourceId !== removed.id).map((entry, index) => ({ ...entry, id: `finance-${index + 1}` }));
    expect(() => parseSeason(encode(corrupted))).toThrow(/calendar boundary/);
    state = setTicketPlan(state, { delegated: true, price: 1800 });
    while (state.status === 'active' && getTransferPaymentSummary(state, managed).overdue > 0) state = play(state);
    expect(getTransferPaymentSummary(state, managed).overdue).toBe(0);
    expect(parseSeason(serializeSeason(state))).toEqual(state);
  }, 60_000);

  const mutations: Array<[string, (state: SeasonState) => void]> = [
    ['unsupported plan', state => { state.employment.transfers[0]!.paymentPlan = 'monthly' as never; }],
    ['changed agreed date', state => { state.employment.transfers[0]!.installments[1]!.dueOn = '2027-09-05'; }],
    ['changed agreed amount', state => { state.employment.transfers[0]!.installments[1]!.amount += 1; }],
    ['duplicate receipt identity', state => { state.employment.transfers[0]!.payments[1]!.id = state.employment.transfers[0]!.id; }],
    ['early payment date', state => { state.employment.transfers[0]!.payments[1]!.paidOn = '2027-09-03'; }],
    ['wrong calendar round', state => { state.employment.transfers[0]!.payments[1]!.round = 2; }],
    ['overpaid installment', state => { state.employment.transfers[0]!.payments[1]!.amount += 1; }],
    ['wrong installment', state => { state.employment.transfers[0]!.payments[1]!.installmentIndex = 2; }],
    ['unrecorded seller credit', state => { const row = state.finance.ledger.find(entry => entry.sourceId.endsWith('-payment-2') && entry.amount > 0)!; row.amount += 1; }],
    ['unrecorded buyer debit', state => { const row = state.finance.ledger.find(entry => entry.sourceId.endsWith('-payment-2') && entry.amount < 0)!; row.amount -= 1; }],
    ['credit before debit', state => { const index = state.finance.ledger.findIndex(entry => entry.sourceId.endsWith('-payment-2')); const left = state.finance.ledger[index]!, right = state.finance.ledger[index + 1]!; state.finance.ledger[index] = { ...right, id: left.id }; state.finance.ledger[index + 1] = { ...left, id: right.id }; }],
    ['missing mandatory payment', state => { const transfer = state.employment.transfers[0]!, payment = transfer.payments.pop()!; state.finance.ledger = state.finance.ledger.filter(entry => entry.sourceId !== payment.id).map((entry, index) => ({ ...entry, id: `finance-${index + 1}` })); }],
    ['partial payment despite enough cash', state => { const payment = state.employment.transfers[0]!.payments[1]!; payment.amount -= 1; for (const entry of state.finance.ledger.filter(entry => entry.sourceId === payment.id)) entry.amount += entry.amount < 0 ? 1 : -1; }],
  ];
  for (const [name, damage] of mutations) it(`rejects ${name}`, () => {
    const corrupted = structuredClone(opening);
    damage(corrupted);
    expect(() => validateSeasonState(corrupted)).toThrow();
    expect(() => parseSeason(encode(corrupted))).toThrow();
  });
});
