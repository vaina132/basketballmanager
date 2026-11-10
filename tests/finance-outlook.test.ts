import { beforeAll, describe, expect, it } from 'vitest';
import type { EmploymentTransfer } from '../src/domain/employment';
import type { FinanceEntry } from '../src/domain/finance';
import type { SeasonState } from '../src/domain/season';
import { getSeasonWage } from '../src/data/development-wages';
import { forecastGate, getFinanceBalance, recommendTicketPrice, ROUND_OPERATING_COST, setTicketPlan } from '../src/world/finance';
import { getClubCashOutlook } from '../src/world/finance-outlook';
import { prepayWages } from '../src/world/payroll';
import { getPayrollReserve, getSpendableCash, payrollInstallment } from '../src/world/payroll-policy';
import { submitInSeasonTransferOffer, withdrawInSeasonOffer } from '../src/world/recruitment';
import { getInSeasonOffers, requiredInSeasonTransferFee } from '../src/world/recruitment-policy';
import { createSeason, dateForRound } from '../src/world/season';

const club = 'rhine-falcons', other = 'aegean-waves';
function freeze<T>(value: T): T { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }

/** Isolated projection inputs, not assertions that fabricated history is a valid save. */
function entry(state: SeasonState, amount: number, extra: Partial<FinanceEntry> = {}): SeasonState {
  return { ...state, finance: { ...state.finance, ledger: [...state.finance.ledger, { id: `outlook-${state.finance.ledger.length}`, clubId: club, seasonNumber: state.seasonNumber, round: state.round, kind: 'operations', amount, sourceId: 'projection-fixture', ticket: null, coach: null, payroll: null, ...extra }] } };
}
function transfer(id: string, installments: EmploymentTransfer['installments']): EmploymentTransfer {
  return { id, offerId: `${id}-offer`, playerId: 'aeg-1', fromClubId: club, toClubId: other, seasonNumber: 1, completedOn: dateForRound(1), startsSeason: 1, startsRound: 1, fee: installments.reduce((sum, item) => sum + item.amount, 0), releasedContractIds: [], contractId: `${id}-contract`, paymentPlan: 'three-payments', installments, payments: [] };
}
function withTransfers(state: SeasonState, transfers: EmploymentTransfer[]): SeasonState { return { ...state, employment: { ...state.employment, transfers } }; }
const totalWages = (state: SeasonState) => getClubCashOutlook(state).rows.reduce((sum, row) => sum + row.wages, 0);

describe('read-only current-season cash outlook', () => {
  let initial: SeasonState;
  beforeAll(() => { initial = freeze(createSeason(53, club, 'off', true, true, true, true, null, true, true, true, true)); });

  it('is inert for disabled finances and rejects an unknown club', () => {
    const disabled = freeze(createSeason(53, club, 'off', false, false, false, false));
    expect(getClubCashOutlook(disabled)).toMatchObject({ enabled: false, startCash: 0, startUnpaid: 0, spendableCash: 0, rows: [], assumptions: [], pendingHolds: { wages: 0, fees: 0, total: 0 } });
    expect(() => getClubCashOutlook(initial, 'unknown-club')).toThrow(/club/i);
  });

  it('reconciles the ten dated matchdays, remaining wages and both projected balances without mutating game state', () => {
    const before = structuredClone(initial), outlook = getClubCashOutlook(initial);
    expect(outlook).toMatchObject({ enabled: true, asOf: initial.date, horizon: dateForRound(10), startCash: getFinanceBalance(initial.finance, club).cash, startUnpaid: 0, spendableCash: getSpendableCash(initial, club) });
    expect(outlook.rows).toHaveLength(10);
    expect(outlook.rows.map(row => row.date)).toEqual(Array.from({ length: 10 }, (_, index) => dateForRound(index + 1)));
    expect(outlook.rows.map(row => row.round)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(outlook.rows.every(row => row.fixtureIds.length === 1 && row.operations === ROUND_OPERATING_COST)).toBe(true);
    expect(totalWages(initial)).toBe(getPayrollReserve(initial, club));
    const costs = totalWages(initial) + 10 * ROUND_OPERATING_COST;
    expect(outlook.baseline.endBalance).toBe(outlook.startCash + outlook.rows.reduce((sum, row) => sum + row.tickets, 0) - costs);
    expect(outlook.adverse.endBalance).toBe(outlook.startCash + outlook.rows.reduce((sum, row) => sum + row.adverseTickets, 0) - costs);
    expect(outlook.rows.every(row => row.adverseTickets === Math.floor(row.tickets * .75))).toBe(true);
    expect(outlook.baseline.lowBalance).toBe(Math.min(outlook.startCash, ...outlook.rows.map(row => row.baselineBalance)));
    expect(initial).toEqual(before);
    expect(getClubCashOutlook(initial)).toEqual(outlook);
  });

  it('keeps the prepared price locked while future gates follow the selected manual or delegated policy', () => {
    const currentHome = initial.fixtures.find(fixture => fixture.round === 1)!.homeClubId;
    const managed = { ...initial, managedClubId: currentHome };
    const changed = setTicketPlan(managed, { delegated: false, price: 6000 });
    const futureHome = changed.fixtures.find(fixture => fixture.round > 1 && fixture.homeClubId === currentHome)!;
    const current = changed.fixtures.find(fixture => fixture.round === 1 && fixture.homeClubId === currentHome)!;
    const outlook = getClubCashOutlook(changed);
    expect(outlook.rows.find(row => row.round === 1)?.tickets).toBe(forecastGate(changed, current, initial.finance.roundPrices[currentHome]!).revenue);
    expect(outlook.rows.find(row => row.round === futureHome.round)?.tickets).toBe(forecastGate(changed, futureHome, 6000).revenue);
    const automatic = setTicketPlan(managed, { delegated: true, price: 6000 });
    expect(getClubCashOutlook(automatic).rows.find(row => row.round === futureHome.round)?.tickets).toBe(forecastGate(automatic, futureHome, recommendTicketPrice(automatic, futureHome)).revenue);
    expect(getClubCashOutlook(setTicketPlan(managed, { delegated: false, price: 0 })).rows.filter(row => row.round !== 1).every(row => row.tickets === 0)).toBe(true);
  });

  it('never uses current or future uncommitted results to change projected form', () => {
    const prior = getClubCashOutlook(initial);
    const uncommitted = { ...initial, fixtures: initial.fixtures.map(fixture => ({ ...fixture, result: { winnerClubId: fixture.homeClubId } as NonNullable<typeof fixture.result> })) };
    expect(getClubCashOutlook(uncommitted)).toEqual(prior);
  });

  it('excludes prepaid wages, keeps the actual discount in cash, and never refunds prepaid departed wages', () => {
    const player = initial.clubs.find(item => item.id === club)!.players[0]!;
    const paid = prepayWages(initial, player.id), original = getClubCashOutlook(initial), prepaid = getClubCashOutlook(paid);
    const charge = paid.finance.ledger.at(-1)!.payroll!.items[0]!;
    expect(original.startCash - prepaid.startCash).toBe(charge.amount);
    expect(totalWages(initial) - totalWages(paid)).toBe(charge.gross);
    expect(prepaid.baseline.endBalance - original.baseline.endBalance).toBe(charge.discount);
    const sale = { ...transfer('sale', []), playerId: player.id, startsRound: 2, fromClubId: club, toClubId: other };
    expect(getClubCashOutlook(withTransfers(paid, [sale]))).toEqual(prepaid);
  });

  it('excludes posted gate/operation/payroll obligations and puts existing unpaid costs in Due now exactly once', () => {
    const fixture = initial.fixtures.find(fixture => fixture.round === 1 && fixture.homeClubId === club)!;
    expect(fixture).toBeDefined();
    const agreement = initial.payroll.agreements.find(item => item.clubId === club)!;
    let posted = entry(initial, -ROUND_OPERATING_COST, { sourceId: 'operations-s1-r1' });
    posted = entry(posted, 12345, { kind: 'tickets', sourceId: `tickets-${fixture.id}`, ticket: { fixtureId: fixture.id, price: 100, attendance: 123 } });
    const gross = payrollInstallment(agreement.seasonWage, 1);
    posted = entry(posted, -gross, { kind: 'payroll', sourceId: 'payroll-s1-r1', payroll: { type: 'installment', fromRound: 1, throughRound: 1, items: [{ agreementId: agreement.id, playerId: agreement.playerId, gross, discount: 0, amount: gross }] } });
    posted = entry(posted, -getFinanceBalance(posted.finance, club).cash - 87654);
    const outlook = getClubCashOutlook(posted), row = outlook.rows.find(item => item.kind === 'scheduled' && item.round === 1)!;
    expect(outlook.startCash).toBe(0);
    expect(outlook.startUnpaid).toBe(87654);
    expect(outlook.rows[0]).toMatchObject({ kind: 'due-now', unpaidCosts: 87654, baselineBalance: -87654, adverseBalance: -87654 });
    expect(outlook.rows.reduce((sum, item) => sum + item.unpaidCosts, 0)).toBe(87654);
    expect(row).toMatchObject({ tickets: 0, operations: 0 });
    expect(totalWages(posted)).toBe(totalWages(initial) - gross);
    expect(outlook.baseline.fundingGap).toBe(Math.max(0, -Math.min(...outlook.rows.map(item => item.baselineBalance))));
    expect(getFinanceBalance(posted.finance, club)).toEqual({ cash: 0, unpaid: 87654 });
  });

  it('uses exact cents, an arriving agreement start and a departing agreement stop', () => {
    const first = initial.payroll.agreements.find(item => item.clubId === club)!;
    const unusual = { ...first, seasonWage: 1_234_567, startsRound: 3 };
    const sale = { ...transfer('departure', []), playerId: first.playerId, startsRound: 7, fromClubId: club, toClubId: other };
    const isolated = withTransfers({ ...initial, payroll: { ...initial.payroll, agreements: [unusual] } }, [sale]);
    expect(getClubCashOutlook(isolated).rows.map(row => row.wages)).toEqual(Array.from({ length: 10 }, (_, index) => index + 1 >= 3 && index + 1 < 7 ? payrollInstallment(unusual.seasonWage, index + 1) : 0));
    expect(totalWages(isolated)).toBe([3, 4, 5, 6].reduce((sum, round) => sum + payrollInstallment(unusual.seasonWage, round), 0));
  });

  it('dates only outstanding installments, separates later obligations, and never dates overdue income', () => {
    // This club buys in outgoing and sells in incoming; the helper's counterparties are explicit below.
    const outgoing = { ...transfer('outgoing', [{ dueOn: initial.date, amount: 1000 }, { dueOn: dateForRound(4), amount: 2000 }, { dueOn: dateForRound(1, 2), amount: 3000 }]), fromClubId: other, toClubId: club };
    outgoing.payments = [{ id: 'partial', installmentIndex: 0, paidOn: initial.date, seasonNumber: 1, round: 1, amount: 250 }];
    const incoming = { ...transfer('incoming', [{ dueOn: initial.date, amount: 1100 }, { dueOn: dateForRound(5), amount: 2200 }, { dueOn: dateForRound(1, 2), amount: 3300 }]), fromClubId: club, toClubId: other };
    const outlook = getClubCashOutlook(withTransfers(initial, [outgoing, incoming])), base = getClubCashOutlook(initial);
    expect(outlook.rows[0]).toMatchObject({ kind: 'due-now', transferOut: 750 });
    expect(outlook.rows.find(row => row.round === 4)?.transferOut).toBe(2000);
    expect(outlook.rows.find(row => row.round === 5)?.transferIn).toBe(2200);
    expect(outlook.laterOutgoing).toEqual([{ transferId: 'outgoing', playerId: 'aeg-1', counterpartyClubId: other, installmentIndex: 2, dueOn: dateForRound(1, 2), amount: 3000 }]);
    expect(outlook.laterIncoming[0]?.amount).toBe(3300);
    expect(outlook.overdueIncoming[0]).toMatchObject({ transferId: 'incoming', amount: 1100, dueOn: initial.date });
    expect(outlook.baseline.endBalance - base.baseline.endBalance).toBe(2200 - 750 - 2000);
    expect(outlook.adverse.endBalance - base.adverse.endBalance).toBe(-750 - 2000);
    expect(outlook.rows.reduce((sum, row) => sum + row.transferIn, 0)).toBe(2200);
  });

  it('shows pending transfer and salary reservations without treating negotiations as agreed cash flows', () => {
    const target = initial.clubs.find(item => item.id === other)!.players[0]!.id;
    const salary = getSeasonWage(target), fee = requiredInSeasonTransferFee(initial, target);
    const pending = submitInSeasonTransferOffer(initial, target, salary, 1, fee);
    const before = getClubCashOutlook(initial), after = getClubCashOutlook(pending);
    expect(after.pendingHolds).toEqual({ wages: salary * .9, fees: fee, total: salary * .9 + fee });
    expect(after.spendableCash).toBe(before.spendableCash - after.pendingHolds.total);
    expect(after.rows).toEqual(before.rows);
    expect(after.baseline).toEqual(before.baseline);
    expect(getClubCashOutlook(withdrawInSeasonOffer(pending, getInSeasonOffers(pending, club, true)[0]!.id))).toEqual(before);
    expect(getClubCashOutlook(pending, other).pendingHolds.total).toBe(0);
  });

  it('does not project another season or put the horizon before a completed offseason date', () => {
    const noPayroll = createSeason(53, club, 'off', false, false, true, false);
    const complete = { ...noPayroll, status: 'complete' as const, round: 10, date: new Date(Date.parse(`${dateForRound(10)}T00:00:00Z`) + 86400000).toISOString().slice(0, 10) };
    const outlook = getClubCashOutlook(complete);
    expect(outlook.horizon).toBe(complete.date);
    expect(outlook.rows).toEqual([]);
    expect(outlook.baseline.endBalance).toBe(outlook.startCash);
    expect(outlook.assumptions.join(' ')).toMatch(/future salary schedules are not projected/);
    expect(outlook.assumptions.join(' ')).toMatch(/prepayments.*not predicted/);
  });
});
