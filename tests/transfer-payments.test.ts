import { beforeAll, describe, expect, it } from 'vitest';
import type { EmploymentTransfer } from '../src/domain/employment';
import type { SeasonState } from '../src/domain/season';
import type { TransferPaymentPlan } from '../src/domain/transfer-payments';
import { getSeasonWage } from '../src/data/development-wages';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { availableCoaches, hireCoach } from '../src/world/coaching';
import { effectiveContractsForSeason } from '../src/world/employment-policy';
import { getFinanceBalance, recordTransferFee } from '../src/world/finance';
import { advanceMarket, submitMarketOffer, submitTransferOffer, withdrawMarketOffer } from '../src/world/market';
import { getMarketOffers, getReservedTransferFees } from '../src/world/market-policy';
import { getPayrollReserve, getSpendableCash } from '../src/world/payroll-policy';
import { advanceSeason, createSeason, dateForRound, managedSide } from '../src/world/season';
import { getTransferInstallmentRemaining, getTransferObligationReserve, getTransferPaymentSchedule, getTransferPaymentSummary, payTransferInstallment, processTransferPayments } from '../src/world/transfer-payments';
import { quoteTransferOffer, requiredTransferFee } from '../src/world/transfers-policy';

const buyer = 'rhine-falcons', seller = 'aegean-waves', third = 'alpine-stags';
const create = () => createSeason(53, buyer, 'off', true, true, true, true, null, true, true, true, true);
function finish(state: SeasonState): SeasonState {
  while (state.status === 'active') state = advanceSeason({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch!, managedSide(state), true)) });
  return state;
}

/** Accounting-only snapshots isolate cash scarcity without inventing a gameplay command. */
function withCash(state: SeasonState, clubId: string, cash: number): SeasonState {
  const balance = getFinanceBalance(state.finance, clubId);
  const amount = cash - balance.cash + balance.unpaid;
  return { ...state, finance: { ...state.finance, ledger: [...state.finance.ledger, { id: `finance-${state.finance.ledger.length + 1}`, clubId, amount, kind: 'sponsor', sourceId: `accounting-fixture-${state.finance.ledger.length}`, seasonNumber: state.seasonNumber, round: state.round, ticket: null, coach: null, payroll: null }] } };
}

function atRound(state: SeasonState, round: number): SeasonState {
  return { ...state, seasonNumber: 2, round, date: dateForRound(round, 2), status: 'active' };
}

describe('transfer payment schedules and protected obligations', () => {
  let ready: SeasonState, completed: SeasonState, target: string, fee: number;
  beforeAll(() => {
    let state = advanceMarket(finish(create()));
    for (const player of state.clubs.find(club => club.id === buyer)!.players.slice(0, 8)) state = submitMarketOffer(state, player.id, getSeasonWage(player.id), 1);
    ready = advanceMarket(state);
    target = effectiveContractsForSeason(ready.employment, 2).find(contract => contract.clubId === seller)!.playerId;
    fee = requiredTransferFee(ready, target);
    completed = advanceMarket(advanceMarket(submitTransferOffer(ready, target, getSeasonWage(target), 1, fee, buyer, 'three-payments')));
  }, 30_000);

  it('uses real season dates and allocates every cent for each supported plan', () => {
    const date = '2025-12-10';
    expect(getTransferPaymentSchedule(101, 'upfront', date, 2)).toEqual([{ dueOn: date, amount: 101 }]);
    expect(getTransferPaymentSchedule(101, 'two-payments', date, 2)).toEqual([{ dueOn: date, amount: 50 }, { dueOn: dateForRound(1, 2), amount: 51 }]);
    expect(getTransferPaymentSchedule(103, 'three-payments', date, 2)).toEqual([{ dueOn: date, amount: 51 }, { dueOn: dateForRound(1, 2), amount: 25 }, { dueOn: dateForRound(6, 2), amount: 27 }]);
    expect(() => getTransferPaymentSchedule(100, 'monthly' as TransferPaymentPlan, date, 2)).toThrow();
  });

  it('reserves the whole proposal fee, then swaps the hold for paid cash and the frozen unpaid balance', () => {
    const pending = submitTransferOffer(ready, target, getSeasonWage(target), 1, fee, buyer, 'three-payments');
    expect(pending.finance).toBe(ready.finance);
    expect(getReservedTransferFees(pending, buyer)).toBe(fee);
    expect(getSpendableCash(pending, buyer)).toBe(getSpendableCash(ready, buyer) - fee);
    const transfer = completed.employment.transfers.at(-1)!;
    expect(transfer.paymentPlan).toBe('three-payments');
    expect(transfer.installments).toEqual(getTransferPaymentSchedule(fee, 'three-payments', completed.date, 2));
    expect(transfer.payments).toEqual([{ id: transfer.id, installmentIndex: 0, paidOn: completed.date, seasonNumber: 1, round: 10, amount: Math.floor(fee / 2) }]);
    expect(getReservedTransferFees(completed, buyer)).toBe(0);
    expect(getTransferObligationReserve(completed, buyer)).toBe(fee - Math.floor(fee / 2));
    expect(getSpendableCash(completed, buyer)).toBe(getSpendableCash(ready, buyer) - fee);
    expect(getFinanceBalance(completed.finance, buyer).cash).toBe(getFinanceBalance(ready.finance, buyer).cash - Math.floor(fee / 2));
    expect(getFinanceBalance(completed.finance, seller).cash).toBe(getFinanceBalance(ready.finance, seller).cash + Math.floor(fee / 2));
    expect(() => recordTransferFee(completed, transfer)).toThrow(/already/);
  });

  it('offers no additional buying capacity and never turns incoming unpaid fees into cash', () => {
    const upfront = advanceMarket(advanceMarket(submitTransferOffer(ready, target, getSeasonWage(target), 1, fee, buyer, 'upfront')));
    expect(getSpendableCash(upfront, buyer)).toBe(getSpendableCash(completed, buyer));
    expect(getSpendableCash(upfront, seller) - getSpendableCash(completed, seller)).toBe(getTransferPaymentSummary(completed, seller).incomingRemaining);
    const pending = submitTransferOffer(ready, target, getSeasonWage(target), 1, fee, buyer, 'two-payments');
    const offer = getMarketOffers(pending, buyer).at(-1)!;
    const withdrawn = withdrawMarketOffer(pending, offer.id);
    expect(getTransferObligationReserve(withdrawn, buyer)).toBe(0);
    expect(getSpendableCash(withdrawn, buyer)).toBe(getSpendableCash(ready, buyer));
  });

  it('pays only due installments and records one exact debit/credit pair for each receipt', () => {
    expect(processTransferPayments(completed)).toBe(completed);
    const opening = processTransferPayments(atRound(completed, 1));
    const transfer = opening.employment.transfers.at(-1)!;
    expect(transfer.payments.map(payment => payment.installmentIndex)).toEqual([0, 1]);
    expect(transfer.payments[1]).toMatchObject({ id: `${transfer.id}-payment-2`, paidOn: dateForRound(1, 2), seasonNumber: 2, round: 1, amount: Math.floor(fee / 4) });
    expect(getTransferPaymentSummary(opening, buyer)).toMatchObject({ overdue: 0, outgoingRemaining: transfer.installments[2]!.amount, nextDueOn: dateForRound(6, 2) });
    expect(processTransferPayments(opening)).toBe(opening);
    expect(processTransferPayments(atRound(opening, 5)).employment.transfers).toBe(opening.employment.transfers);
    const final = processTransferPayments(atRound(opening, 6));
    expect(getTransferPaymentSummary(final, buyer)).toMatchObject({ outgoingRemaining: 0, overdue: 0, futureDue: 0, nextDueOn: null });
    expect(getFinanceBalance(final.finance, seller).cash).toBe(getFinanceBalance(ready.finance, seller).cash + fee);
    for (const payment of final.employment.transfers.at(-1)!.payments) expect(final.finance.ledger.filter(entry => entry.kind === 'transfer' && entry.sourceId === payment.id).map(entry => [entry.clubId, entry.amount])).toEqual([[buyer, -payment.amount], [seller, payment.amount]]);
  });

  it('pays partial amounts around protected wages, then collects only the remaining arrears', () => {
    const reserve = 1_000_003, partial = 10_007;
    let state = atRound(completed, 1);
    state = { ...state, payroll: { ...state.payroll, agreements: [...state.payroll.agreements, { id: 'accounting-wage', playerId: 'rhf-1', clubId: buyer, seasonNumber: 2, startsRound: 1, seasonWage: reserve }] } };
    const unpaidCosts = withCash(state, buyer, -123);
    expect(processTransferPayments(unpaidCosts)).toBe(unpaidCosts);
    state = withCash(state, buyer, reserve + partial);
    const sellerCash = getFinanceBalance(state.finance, seller).cash;
    const original = structuredClone(state);
    const paid = processTransferPayments(state), transfer = paid.employment.transfers.at(-1)!;
    expect(state).toEqual(original);
    expect(getPayrollReserve(paid, buyer)).toBe(reserve);
    expect(getFinanceBalance(paid.finance, buyer)).toEqual({ cash: reserve, unpaid: 0 });
    expect(getFinanceBalance(paid.finance, seller).cash).toBe(sellerCash + partial);
    expect(transfer.payments.at(-1)!.amount).toBe(partial);
    expect(getTransferPaymentSummary(paid, buyer)).toMatchObject({ overdue: transfer.installments[1]!.amount - partial, futureDue: transfer.installments[2]!.amount });
    expect(processTransferPayments(paid)).toBe(paid);
    const funded = withCash(paid, buyer, reserve + transfer.installments[1]!.amount - partial);
    const cleared = processTransferPayments({ ...funded, round: 2, date: dateForRound(2, 2) });
    expect(cleared.employment.transfers.at(-1)!.payments.at(-1)).toMatchObject({ id: `${transfer.id}-payment-3`, installmentIndex: 1, round: 2, amount: transfer.installments[1]!.amount - partial });
    expect(getTransferPaymentSummary(cleared, buyer).overdue).toBe(0);
    expect(getFinanceBalance(cleared.finance, seller).cash).toBe(sellerCash + transfer.installments[1]!.amount);
    expect(getFinanceBalance(cleared.finance, buyer)).toEqual({ cash: reserve, unpaid: 0 });
  });

  it('rejects early or excessive payments atomically and blocks fresh spending while fees are overdue', () => {
    const transfer = completed.employment.transfers.at(-1)!;
    expect(() => payTransferInstallment(completed, transfer.id, 1, 1)).toThrow(/not due/);
    const overdue = withCash(atRound(completed, 1), buyer, 100_000_000);
    const snapshot = structuredClone(overdue);
    expect(() => payTransferInstallment(overdue, transfer.id, 1, transfer.installments[1]!.amount + 1)).toThrow(/outstanding/);
    expect(() => hireCoach(overdue, availableCoaches(overdue.coaching, overdue)[0]!.id)).toThrow(/overdue/);
    // Put the unpaid installment in an open recruitment accounting snapshot.
    const market = { ...completed, employment: { ...completed.employment, transfers: completed.employment.transfers.map(item => ({ ...item, installments: item.installments.map(installment => ({ ...installment, dueOn: completed.date })) })) } };
    const other = effectiveContractsForSeason(ready.employment, 2).find(contract => contract.clubId === seller && contract.playerId !== target)!.playerId;
    expect(quoteTransferOffer(market, other, getSeasonWage(other), 1, requiredTransferFee(market, other))).toMatchObject({ canOffer: false, reason: expect.stringMatching(/overdue/) });
    expect(overdue).toEqual(snapshot);
  });

  it('processes due agreements in a stable order across clubs without repeated credits', () => {
    const original = completed.employment.transfers.at(-1)!;
    const clone = (id: string, toClubId: string, fromClubId: string): EmploymentTransfer => ({ ...original, id, toClubId, fromClubId, payments: original.payments.map(payment => ({ ...payment, id })) });
    const first = clone('employment-transfer-2', buyer, seller), second = clone('employment-transfer-10', buyer, third);
    let state = atRound(completed, 1);
    state = { ...state, employment: { ...state.employment, transfers: [second, first] } };
    state = withCash(state, buyer, first.installments[1]!.amount + 123);
    const paid = processTransferPayments(state);
    expect(getTransferInstallmentRemaining(paid.employment.transfers.find(transfer => transfer.id === first.id)!, 1)).toBe(0);
    expect(paid.employment.transfers.find(transfer => transfer.id === second.id)!.payments.at(-1)!.amount).toBe(123);
    expect(paid.finance.ledger.slice(-4).map(entry => entry.sourceId)).toEqual([`${first.id}-payment-2`, `${first.id}-payment-2`, `${second.id}-payment-2`, `${second.id}-payment-2`]);
    expect(processTransferPayments(paid)).toBe(paid);
  });

  it('retains debt independently of player ownership and treats legacy upfront transfers as settled', () => {
    const detached = { ...completed, employment: { ...completed.employment, contracts: [] } };
    expect(getTransferObligationReserve(detached, buyer)).toBe(getTransferObligationReserve(completed, buyer));
    const legacy = { ...completed.employment.transfers.at(-1)! } as Partial<EmploymentTransfer>;
    delete legacy.paymentPlan; delete legacy.installments; delete legacy.payments;
    const oldState = { ...completed, employment: { ...completed.employment, transfers: [legacy as EmploymentTransfer] } };
    expect(getTransferPaymentSummary(oldState, buyer)).toMatchObject({ outgoingRemaining: 0, overdue: 0 });
    expect(processTransferPayments(oldState)).toBe(oldState);
  });

  it('makes one pass when a later incoming receipt funds an earlier debt', () => {
    const original = completed.employment.transfers.at(-1)!;
    const incoming: EmploymentTransfer = { ...original, id: 'employment-transfer-2', toClubId: third, fromClubId: buyer, payments: original.payments.map(payment => ({ ...payment, id: 'employment-transfer-2' })) };
    let state = atRound(completed, 1);
    state = { ...state, employment: { ...state.employment, transfers: [original, incoming] } };
    state = withCash(withCash(state, buyer, 0), third, incoming.installments[1]!.amount);
    const paid = processTransferPayments(state);
    expect(paid.employment.transfers[0]!.payments).toHaveLength(1);
    expect(paid.employment.transfers[1]!.payments).toHaveLength(2);
    expect(getTransferPaymentSummary(paid, buyer).overdue).toBe(original.installments[1]!.amount);
    const nextBoundary = processTransferPayments({ ...paid, round: 2, date: dateForRound(2, 2) });
    expect(nextBoundary.employment.transfers[0]!.payments.at(-1)).toMatchObject({ installmentIndex: 1, paidOn: dateForRound(2, 2), amount: original.installments[1]!.amount });
    expect(nextBoundary.employment.transfers[1]!.payments).toHaveLength(2);
    expect(getTransferPaymentSummary(nextBoundary, buyer).overdue).toBe(0);
  });

  it('keeps an earlier unpaid installment ahead of a later portion after incoming cash arrives', () => {
    const original = completed.employment.transfers.at(-1)!;
    const incoming: EmploymentTransfer = { ...original, id: 'employment-transfer-2', toClubId: third, fromClubId: buyer, payments: original.payments.map(payment => ({ ...payment, id: 'employment-transfer-2' })) };
    let state = atRound(completed, 6);
    state = { ...state, employment: { ...state.employment, transfers: [original, incoming] } };
    state = withCash(withCash(state, buyer, 0), third, incoming.installments[1]!.amount);
    const paid = processTransferPayments(state);
    expect(paid.employment.transfers[0]!.payments).toHaveLength(1);
    expect(paid.employment.transfers[1]!.payments).toHaveLength(2);
    expect(getFinanceBalance(paid.finance, buyer).cash).toBe(incoming.installments[1]!.amount);
    const snapshot = structuredClone(paid);
    expect(() => payTransferInstallment(paid, original.id, 2, 1)).toThrow(/earlier/);
    expect(paid).toEqual(snapshot);
    const nextBoundary = processTransferPayments({ ...paid, round: 7, date: dateForRound(7, 2) });
    expect(nextBoundary.employment.transfers[0]!.payments.at(-1)).toMatchObject({ installmentIndex: 1, paidOn: dateForRound(7, 2), amount: original.installments[1]!.amount });
    expect(getTransferPaymentSummary(nextBoundary, buyer).overdue).toBe(original.installments[2]!.amount);
  });
});
