import { getFacilityUpkeep } from './facilities-policy';
import type { FinanceEntry } from '../domain/finance';
import { financeLedgerEntries } from './finance-ledger';
import type { CashOutlookInstallment, CashOutlookRow, CashOutlookScenario, ClubCashOutlook } from '../domain/finance-outlook';
import type { SeasonState } from '../domain/season';
import { forecastGate, getFinanceBalance, recommendTicketPrice, roundOperatingCostFor } from './finance';
import { getReservedTransferFees } from './market-policy';
import { agreementThroughRound, getSpendableCash, payrollInstallment } from './payroll-policy';
import { getReservedInSeasonFees, getReservedInSeasonWages } from './recruitment-policy';
import { getTransferInstallmentRemaining, getTransferInstallments } from './transfer-payments';
import { playsAtNeutralVenue, seasonRounds } from './career-world';

export const CASH_OUTLOOK_ADVERSE_GATE_PERCENT = 75;

function emptyRow(date: string, kind: CashOutlookRow['kind']): CashOutlookRow {
  return { id: `${kind}-${date}`, date, kind, round: null, fixtureIds: [], wages: 0, operations: 0, unpaidCosts: 0, transferOut: 0, transferIn: 0, tickets: 0, adverseTickets: 0, baselineBalance: 0, adverseBalance: 0 };
}

function scenario(startCash: number, asOf: string, rows: readonly CashOutlookRow[], key: 'baselineBalance' | 'adverseBalance'): CashOutlookScenario {
  let lowBalance = startCash, lowOn = asOf;
  for (const row of rows) if (row[key] < lowBalance) { lowBalance = row[key]; lowOn = row.date; }
  return { endBalance: rows.at(-1)?.[key] ?? startCash, lowBalance, lowOn, fundingGap: Math.max(0, -lowBalance) };
}

function sortInstallments(items: CashOutlookInstallment[]): CashOutlookInstallment[] {
  return items.sort((left, right) => left.dueOn.localeCompare(right.dueOn, 'en') || left.transferId.localeCompare(right.transferId, 'en', { numeric: true }) || left.installmentIndex - right.installmentIndex);
}

/**
 * Read-only planning view of the existing ledger and dated commitments.
 * Projected receipts never grant spending authority or simulate player/AI decisions.
 */
export function getClubCashOutlook(state: SeasonState, clubId = state.managedClubId): ClubCashOutlook {
  if (!state.clubs.some(club => club.id === clubId)) throw new Error('Choose a club in this career.');
  const horizon = state.fixtures.reduce((last, fixture) => fixture.date > last ? fixture.date : last, state.date);
  const enabled = state.finance.enabledSince !== null;
  const balance = getFinanceBalance(state.finance, clubId);
  const wages = enabled ? getReservedInSeasonWages(state, clubId) : 0;
  const fees = enabled ? getReservedTransferFees(state, clubId) + getReservedInSeasonFees(state, clubId) : 0;
  const outlook: ClubCashOutlook = {
    enabled, clubId, seasonNumber: state.seasonNumber, asOf: state.date, horizon,
    startCash: balance.cash, startUnpaid: balance.unpaid,
    spendableCash: enabled ? getSpendableCash(state, clubId) : 0,
    pendingHolds: { wages, fees, total: wages + fees }, rows: [],
    baseline: scenario(balance.cash, state.date, [], 'baselineBalance'),
    adverse: scenario(balance.cash, state.date, [], 'adverseBalance'),
    laterOutgoing: [], laterIncoming: [], overdueIncoming: [],
    assumptions: enabled ? [
      'Forecast balances are planning estimates, not money available to spend. A negative balance shows a funding gap; actual bank cash is unchanged.',
      'Only the current season is projected. Later transfer installments are listed separately; future seasons, new sponsorship and future salary schedules are not projected.',
      'Gate estimates hold current published results and the selected ticket policy constant. The prepared matchday keeps its locked ticket price.',
      'Expected income assumes future transfer installments arrive on their agreed dates. Already-due unpaid receipts have no assumed payment date.',
      'The cautious scenario uses 25% less ticket income and no unreceived transfer income. It is a stress scenario, not a probability or a worst-case guarantee.',
      'Wages follow existing agreements and installments, excluding charges already posted or prepaid and wages ended by a completed transfer. Optional future prepayments and other automatic or discretionary decisions are not predicted.',
      ...(state.facilities?.enabledSince ? ['Facility investment already paid is not counted again. Upkeep and venue capacity use completed facilities and current construction restrictions; future project completions and new upgrades are not predicted.'] : []),
      ...(!state.payroll.enabledSince ? ['Player payroll is disabled in this career, so player wages are not included.'] : []),
      'Pending offers retain their existing cash reservations but do not become forecast expenses until agreed. Next-season wages budgets are separate from cash reservations.',
      'Scheduled transfer costs are shown in full when due, even if actual payment must wait for enough cash after protected wages. Staff fees and sponsorship already recorded in cash are not counted again.',
    ] : [],
  };
  if (!enabled) return outlook;

  const ledger: FinanceEntry[] = [];
  for (const entry of financeLedgerEntries(state.finance)) if (entry.clubId === clubId) ledger.push(entry);
  const dueNow = emptyRow(state.date, 'due-now');
  dueNow.unpaidCosts = balance.unpaid;
  const scheduled = new Map<string, CashOutlookRow>();
  const rowOn = (date: string): CashOutlookRow => {
    const existing = scheduled.get(date);
    if (existing) return existing;
    const row = emptyRow(date, 'scheduled');
    scheduled.set(date, row);
    return row;
  };

  // Only already-published results inform every future gate; no future match is played.
  const form = { ...state, fixtures: state.fixtures.filter(fixture => fixture.round < state.round && fixture.result !== null) };
  const fixtures = state.fixtures.filter(fixture => fixture.date >= state.date && (fixture.homeClubId === clubId || fixture.awayClubId === clubId)).sort((left, right) => left.date.localeCompare(right.date, 'en') || left.id.localeCompare(right.id, 'en'));
  for (const fixture of fixtures) {
    const operationPosted = ledger.some(entry => entry.kind === 'operations' && entry.sourceId === `operations-s${state.seasonNumber}-r${fixture.round}`);
    const upkeep = getFacilityUpkeep(state, clubId, fixture.date);
    const upkeepPosted = upkeep === 0 || ledger.some(entry => entry.kind === 'facility-upkeep' && entry.round === fixture.round && entry.seasonNumber === state.seasonNumber);
    const gatePosted = ledger.some(entry => entry.kind === 'tickets' && (entry.ticket?.fixtureId === fixture.id || entry.sourceId === `tickets-${fixture.id}`));
    // Format 85: a game at one venue earns the listed home club no gate.
    const gatePending = fixture.homeClubId === clubId && !gatePosted && !playsAtNeutralVenue(state, fixture);
    if (operationPosted && upkeepPosted && !gatePending) continue;
    const row = rowOn(fixture.date);
    row.round = fixture.round;
    row.fixtureIds.push(fixture.id);
    if (!operationPosted) row.operations += roundOperatingCostFor(state, clubId);
    if (!upkeepPosted) row.operations += upkeep;
    if (gatePending) {
      const plan = state.finance.plans[clubId]!;
      const price = fixture.round === state.round ? state.finance.roundPrices[clubId]! : plan.delegated ? recommendTicketPrice(form, fixture) : plan.price;
      const revenue = forecastGate(form, fixture, price).revenue;
      row.tickets += revenue;
      row.adverseTickets += Math.floor(revenue * CASH_OUTLOOK_ADVERSE_GATE_PERCENT / 100);
    }
  }

  if (state.payroll.enabledSince) for (const agreement of state.payroll.agreements.filter(agreement => agreement.clubId === clubId && agreement.seasonNumber === state.seasonNumber)) {
    for (let round = agreement.startsRound; round <= agreementThroughRound(state, agreement); round += 1) {
      const posted = ledger.some(entry => entry.payroll && entry.payroll.fromRound <= round && entry.payroll.throughRound >= round && entry.payroll.items.some(item => item.agreementId === agreement.id));
      if (posted) continue;
      const fixture = state.fixtures.find(fixture => fixture.round === round && (fixture.homeClubId === clubId || fixture.awayClubId === clubId));
      if (!fixture) continue;
      const row = fixture.date < state.date ? dueNow : rowOn(fixture.date);
      row.wages += payrollInstallment(agreement.seasonWage, round, seasonRounds(state));
      if (row.kind === 'scheduled') { row.round = round; if (!row.fixtureIds.includes(fixture.id)) row.fixtureIds.push(fixture.id); }
    }
  }

  for (const transfer of state.employment.transfers) {
    const outgoing = transfer.toClubId === clubId;
    if (!outgoing && transfer.fromClubId !== clubId) continue;
    for (const [installmentIndex, installment] of getTransferInstallments(transfer).entries()) {
      const amount = getTransferInstallmentRemaining(transfer, installmentIndex);
      if (!amount) continue;
      const item: CashOutlookInstallment = { transferId: transfer.id, playerId: transfer.playerId, counterpartyClubId: outgoing ? transfer.fromClubId : transfer.toClubId, installmentIndex, dueOn: installment.dueOn, amount };
      if (installment.dueOn <= state.date) {
        if (outgoing) dueNow.transferOut += amount;
        else outlook.overdueIncoming.push(item);
      } else if (installment.dueOn > horizon) {
        (outgoing ? outlook.laterOutgoing : outlook.laterIncoming).push(item);
      } else {
        const row = rowOn(installment.dueOn);
        if (outgoing) row.transferOut += amount;
        else row.transferIn += amount;
      }
    }
  }
  sortInstallments(outlook.laterOutgoing); sortInstallments(outlook.laterIncoming); sortInstallments(outlook.overdueIncoming);
  const rows = [...(dueNow.unpaidCosts || dueNow.transferOut || dueNow.wages ? [dueNow] : []), ...[...scheduled.values()].sort((left, right) => left.date.localeCompare(right.date, 'en'))];
  let baselineBalance = balance.cash, adverseBalance = balance.cash;
  for (const row of rows) {
    const costs = row.wages + row.operations + row.unpaidCosts + row.transferOut;
    baselineBalance += row.tickets + row.transferIn - costs;
    adverseBalance += row.adverseTickets - costs;
    row.baselineBalance = baselineBalance;
    row.adverseBalance = adverseBalance;
  }
  outlook.rows = rows;
  outlook.baseline = scenario(balance.cash, state.date, rows, 'baselineBalance');
  outlook.adverse = scenario(balance.cash, state.date, rows, 'adverseBalance');
  return outlook;
}
