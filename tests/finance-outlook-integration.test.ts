import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { stepMatch } from '../src/engine/match';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { getClubCashOutlook } from '../src/world/finance-outlook';
import { getFinanceBalance, setTicketPlan } from '../src/world/finance';
import { getSpendableCash } from '../src/world/payroll-policy';
import { quoteWagePrepayment } from '../src/world/payroll';
import { dateForRound } from '../src/world/season';
import { advanceOutlookCareer, completeOutlookSeason, createOutlookCareers, outlookClub as club, outlookCounterparty as other } from './helpers/finance-outlook-careers';

let careers: ReturnType<typeof createOutlookCareers>;
beforeAll(() => { careers = createOutlookCareers(); }, 60_000);

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
const cashNet = (state: SeasonState, clubId = club): number => { const balance = getFinanceBalance(state.finance, clubId); return balance.cash - balance.unpaid; };
const wageTotal = (state: SeasonState, clubId = club): number => getClubCashOutlook(state, clubId).rows.reduce((sum, row) => sum + row.wages, 0);

describe('cash outlook against actual career commands', () => {
  it('reconciles the current locked home gate, operating cost and wages with the actual posted ledger', () => {
    const changedPlan = setTicketPlan(careers.healthy, { delegated: false, price: 6000 });
    expect(changedPlan.finance.roundPrices[club]).not.toBe(6000);
    const outlook = getClubCashOutlook(changedPlan), row = outlook.rows.find(row => row.kind === 'scheduled' && row.date === changedPlan.date)!;
    const next = advanceOutlookCareer(changedPlan);
    const posted = next.finance.ledger.slice(changedPlan.finance.ledger.length).filter(entry => entry.clubId === club && entry.round === changedPlan.round);
    expect(row.tickets).toBe(posted.filter(entry => entry.kind === 'tickets').reduce((sum, entry) => sum + entry.amount, 0));
    expect(row.wages).toBe(-posted.filter(entry => entry.kind === 'payroll').reduce((sum, entry) => sum + entry.amount, 0));
    expect(row.operations).toBe(-posted.filter(entry => entry.kind === 'operations').reduce((sum, entry) => sum + entry.amount, 0));
    expect(row.baselineBalance).toBe(cashNet(next));
    expect(outlook.spendableCash).toBe(getSpendableCash(changedPlan, club));
  });

  it('still includes an uncommitted full-time match and leaves its future sporting action unchanged', () => {
    expect(careers.fulltime.activeMatch.status).toBe('finished');
    expect(careers.fulltime.fixtures.find(fixture => fixture.id === careers.fulltime.activeFixtureId)!.result).toBeNull();
    expect(getClubCashOutlook(careers.fulltime)).toEqual(getClubCashOutlook(careers.healthy));
    const state = freeze(structuredClone(careers.fulltime)), before = structuredClone(state);
    getClubCashOutlook(state);
    expect(state).toEqual(before);
    expect(advanceOutlookCareer(state)).toEqual(advanceOutlookCareer(before));
  });

  it('removes prepaid gross wages from future expenses while keeping the actual discounted payment in starting cash', () => {
    const quote = quoteWagePrepayment(careers.healthy, 'rhf-1');
    const before = getClubCashOutlook(careers.healthy), after = getClubCashOutlook(careers.prepaid);
    expect(before.startCash - after.startCash).toBe(quote.amount);
    expect(wageTotal(careers.healthy) - wageTotal(careers.prepaid)).toBe(quote.gross);
    expect(after.baseline.endBalance - before.baseline.endBalance).toBe(quote.discount);
  });

  it('keeps pending offer holds out of actual forecast expenses and projected income', () => {
    const before = getClubCashOutlook(careers.healthy), pending = getClubCashOutlook(careers.pending);
    const offer = careers.pending.recruitment.offers.at(-1)!;
    expect(careers.pending.finance).toEqual(careers.healthy.finance);
    expect(pending.rows).toEqual(before.rows);
    expect(pending.baseline).toEqual(before.baseline);
    expect(pending.pendingHolds).toEqual({ wages: offer.remainingWages, fees: offer.transfer!.fee, total: offer.remainingWages + offer.transfer!.fee });
    expect(before.spendableCash - pending.spendableCash).toBe(pending.pendingHolds.total);
    expect(getClubCashOutlook(careers.pending, other)).toEqual(getClubCashOutlook(careers.healthy, other));
  });

  it('matches all later actual salary charges after a departure, with no refund or duplicate cost for the prepaid seller', () => {
    for (const state of [careers.sold, careers.soldPrepaid]) {
      const finish = completeOutlookSeason(state);
      const charged = -finish.finance.ledger.slice(state.finance.ledger.length).filter(entry => entry.clubId === club && entry.kind === 'payroll').reduce((sum, entry) => sum + entry.amount, 0);
      expect(wageTotal(state)).toBe(charged);
      expect(finish.finance.ledger.slice(0, state.finance.ledger.length)).toEqual(state.finance.ledger);
    }
    expect(wageTotal(careers.soldPrepaid)).toBe(wageTotal(careers.sold));
    expect(careers.soldPrepaid.finance.ledger.find(entry => entry.sourceId === 'prepay-wage-s1-rhf-1')).toEqual(careers.prepaid.finance.ledger.find(entry => entry.sourceId === 'prepay-wage-s1-rhf-1'));
  });

  it('places real unpaid installments beyond the season horizon until their actual due season', () => {
    const transfer = careers.arrived.employment.transfers.at(-1)!;
    const outgoing = getClubCashOutlook(careers.arrived), incoming = getClubCashOutlook(careers.arrived, other);
    expect(outgoing.rows.reduce((sum, row) => sum + row.transferOut, 0)).toBe(0);
    expect(outgoing.laterOutgoing.map(item => [item.dueOn, item.amount])).toEqual(transfer.installments.slice(1).map(item => [item.dueOn, item.amount]));
    expect(incoming.laterIncoming.map(item => [item.dueOn, item.amount])).toEqual(outgoing.laterOutgoing.map(item => [item.dueOn, item.amount]));
    const opening = getClubCashOutlook(careers.nextOpening), seller = getClubCashOutlook(careers.nextOpening, other);
    const due = transfer.installments[2]!;
    expect(careers.nextOpening.employment.transfers.find(item => item.id === transfer.id)!.payments).toHaveLength(2);
    expect(opening.rows.filter(row => row.transferOut).map(row => [row.date, row.transferOut])).toEqual([[dateForRound(6, 2), due.amount]]);
    expect(seller.rows.filter(row => row.transferIn).map(row => [row.date, row.transferIn])).toEqual([[dateForRound(6, 2), due.amount]]);
    expect(opening.laterOutgoing).toEqual([]);
  });

  it('removes a settled installment from the forecast exactly when the actual receipt is posted', () => {
    const original = careers.nextOpening.employment.transfers[0]!;
    const paid = careers.installmentPaid.employment.transfers.find(transfer => transfer.id === original.id)!;
    expect(paid.payments.at(-1)).toMatchObject({ paidOn: dateForRound(6, 2), amount: original.installments[2]!.amount });
    const posted = careers.installmentPaid.finance.ledger.filter(entry => entry.sourceId === paid.payments.at(-1)!.id);
    expect(posted.map(entry => entry.amount)).toEqual([-original.installments[2]!.amount, original.installments[2]!.amount]);
    for (const clubId of [club, other]) {
      const outlook = getClubCashOutlook(careers.installmentPaid, clubId);
      expect(outlook.rows.reduce((sum, row) => sum + row.transferOut + row.transferIn, 0)).toBe(0);
      expect(outlook.overdueIncoming).toEqual([]);
    }
  });

  it('does not invent next-season cash when viewing a completed season or disabled finances', () => {
    const completed = getClubCashOutlook(careers.completed);
    expect(completed.rows.filter(row => row.kind === 'scheduled')).toEqual([]);
    expect(completed.baseline.endBalance).toBe(cashNet(careers.completed));
    expect(completed.horizon).toBe(careers.completed.date);
    expect(completed.laterOutgoing.length).toBeGreaterThan(0);
    const disabled = getClubCashOutlook(careers.disabled);
    expect(disabled.enabled).toBe(false);
    expect(disabled.rows).toEqual([]);
  });

  it('is repeatable on frozen valid saves and preserves every next match event', () => {
    for (const state of Object.values(careers)) {
      const restored = freeze(parseSeason(serializeSeason(state))), before = structuredClone(restored);
      const first = getClubCashOutlook(restored);
      expect(getClubCashOutlook(restored)).toEqual(first);
      expect(restored).toEqual(before);
      expect(stepMatch(restored.activeMatch)).toEqual(stepMatch(before.activeMatch));
    }
  });
});
