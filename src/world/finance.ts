import type { CoachingContract } from '../domain/coaching';
import type { EmploymentTransfer } from '../domain/employment';
import type { PayrollCharge } from '../domain/payroll';
import type { TransferPayment } from '../domain/transfer-payments';
import type { FinanceBalance, FinanceEntry, FinanceLedgerRow, FinancePlan, GateForecast, SeasonFinance } from '../domain/finance';
import type { SeasonState } from '../domain/season';
import type { Team } from '../domain/types';
import { DEVELOPMENT_COACHES } from '../data/development-coaches';
import { getClubFinanceDefinition } from '../data/development-finances';
import { getPayrollReserve, getSpendableCash } from './payroll-policy';
import { getTransferInstallmentRemaining, getTransferPaymentSchedule, getTransferPaymentSummary, payTransferInstallment } from './transfer-payments';

export { getClubFinanceDefinition } from '../data/development-finances';
export type { FinanceBalance, FinanceLedgerRow, GateForecast } from '../domain/finance';
export const OPENING_CASH = 50_000_000;
export const ANNUAL_SPONSORSHIP = 20_000_000;
export const ROUND_OPERATING_COST = 1_500_000;
export const DEFAULT_TICKET_PRICE = 1800;
export const MAX_TICKET_PRICE = 6000;
export const TICKET_PRICE_STEP = 100;

export interface FinanceFixture {
  id: string;
  round: number;
  homeClubId: string;
  awayClubId: string;
  result: { winnerClubId: string } | null;
}
export interface FinanceContext { fixtures: readonly FinanceFixture[] }

function validatePrice(price: number): void {
  if (!Number.isInteger(price) || price < 0 || price > MAX_TICKET_PRICE || price % TICKET_PRICE_STEP !== 0) throw new Error('Choose a ticket price from zero to sixty euros in one-euro steps.');
}

export function createFinance(clubs: readonly Team[], managedClubId: string): SeasonFinance {
  return { model: 'finance-1', enabledSince: null,
    plans: Object.fromEntries(clubs.map(club => [club.id, { delegated: club.id !== managedClubId, price: DEFAULT_TICKET_PRICE }])),
    roundPrices: Object.fromEntries(clubs.map(club => [club.id, DEFAULT_TICKET_PRICE])), ledger: [],
  };
}

function applyAmount(balance: FinanceBalance, amount: number): FinanceBalance {
  if (amount >= 0) {
    const settled = Math.min(balance.unpaid, amount);
    return { cash: balance.cash + amount - settled, unpaid: balance.unpaid - settled };
  }
  const paid = Math.min(balance.cash, -amount);
  return { cash: balance.cash - paid, unpaid: balance.unpaid - amount - paid };
}

export function getFinanceBalance(finance: SeasonFinance, clubId: string): FinanceBalance {
  return finance.ledger.filter(entry => entry.clubId === clubId).reduce((balance, entry) => applyAmount(balance, entry.amount), { cash: 0, unpaid: 0 });
}

/** Newest-first display rows preserve both the original obligation and its actual cash effects. */
export function financeLedgerRows(finance: SeasonFinance, clubId: string): FinanceLedgerRow[] {
  let balance: FinanceBalance = { cash: 0, unpaid: 0 };
  return finance.ledger.filter(entry => entry.clubId === clubId).map(entry => {
    const previous = balance;
    balance = applyAmount(previous, entry.amount);
    return { ...entry, cashDelta: balance.cash - previous.cash, unpaidDelta: balance.unpaid - previous.unpaid, cashAfter: balance.cash, unpaidAfter: balance.unpaid };
  }).reverse();
}

function append(state: SeasonState, entry: Omit<FinanceEntry, 'id'>): SeasonState {
  if (state.finance.ledger.some(previous => previous.clubId === entry.clubId && previous.kind === entry.kind && previous.sourceId === entry.sourceId)) throw new Error('This financial event has already been recorded.');
  return { ...state, finance: { ...state.finance, ledger: [...state.finance.ledger, { ...entry, id: `finance-${state.finance.ledger.length + 1}` }] } };
}

function book(state: SeasonState, clubId: string, kind: FinanceEntry['kind'], amount: number, sourceId: string, ticket: FinanceEntry['ticket'] = null, coach: FinanceEntry['coach'] = null, payroll: PayrollCharge | null = null): SeasonState {
  return append(state, { clubId, kind, amount, sourceId, seasonNumber: state.seasonNumber, round: state.round, ticket, coach, payroll });
}

/** The payroll command owns its schedule; finance records the resulting mandatory obligation. */
export function recordPayrollCharge(state: SeasonState, clubId: string, payroll: PayrollCharge, sourceId: string): SeasonState {
  if (!state.finance.enabledSince) throw new Error('Enable club finances before recording wages.');
  const amount = payroll.items.reduce((sum, item) => sum + item.amount, 0);
  return book(state, clubId, 'payroll', amount === 0 ? 0 : -amount, sourceId, null, null, payroll);
}

/** Completion pays only the first installment; the entire fee must already be affordable. */
export function recordTransferFee(state: SeasonState, transfer: EmploymentTransfer): SeasonState {
  const completed = state.employment.transfers.find(item => item.id === transfer.id);
  if (!state.finance.enabledSince || !completed || completed.offerId !== transfer.offerId || completed.contractId !== transfer.contractId || completed.fromClubId !== transfer.fromClubId || completed.toClubId !== transfer.toClubId || completed.fee !== transfer.fee || completed.seasonNumber !== transfer.seasonNumber || completed.completedOn !== transfer.completedOn) throw new Error('A transfer payment requires the exact completed employment transfer.');
  if (state.status !== 'complete' || transfer.seasonNumber !== state.seasonNumber || transfer.completedOn !== state.date || transfer.fromClubId === transfer.toClubId || !Number.isSafeInteger(transfer.fee) || transfer.fee <= 0) throw new Error('Choose a completed transfer in the current offseason.');
  if (transfer.payments.length || state.finance.ledger.some(entry => entry.kind === 'transfer' && entry.sourceId === transfer.id)) throw new Error('This transfer payment has already been recorded.');
  if (completed.paymentPlan !== transfer.paymentPlan || JSON.stringify(completed.installments) !== JSON.stringify(transfer.installments) || JSON.stringify(transfer.installments) !== JSON.stringify(getTransferPaymentSchedule(transfer.fee, transfer.paymentPlan, transfer.completedOn, transfer.startsSeason))) throw new Error('Use the agreed transfer payment schedule.');
  if (getFinanceBalance(state.finance, transfer.toClubId).unpaid > 0 || getSpendableCash(state, transfer.toClubId, transfer.offerId, transfer.id) < transfer.fee) throw new Error('The transfer fee exceeds the remaining budget after other commitments.');
  return payTransferInstallment(state, transfer.id, 0, transfer.installments[0]!.amount);
}

/** Record only money actually paid. Outstanding fees remain in the installment schedule. */
export function recordTransferPayment(state: SeasonState, transfer: EmploymentTransfer, payment: TransferPayment): SeasonState {
  const completed = state.employment.transfers.find(item => item.id === transfer.id);
  const stored = completed?.payments.at(-1);
  if (!state.finance.enabledSince || !completed || !stored || JSON.stringify(stored) !== JSON.stringify(payment) || JSON.stringify(completed) !== JSON.stringify(transfer)) throw new Error('A transfer payment requires its exact recorded receipt.');
  const installment = completed.installments[payment.installmentIndex];
  const expectedId = completed.payments.length === 1 ? completed.id : `${completed.id}-payment-${completed.payments.length}`;
  const previousPaid = completed.payments.slice(0, -1).filter(item => item.installmentIndex === payment.installmentIndex).reduce((sum, item) => sum + item.amount, 0);
  if (!installment || installment.dueOn > state.date || payment.id !== expectedId || payment.paidOn !== state.date || payment.seasonNumber !== state.seasonNumber || payment.round !== state.round || !Number.isSafeInteger(payment.amount) || payment.amount <= 0 || previousPaid + payment.amount > installment.amount) throw new Error('Pay only an amount due on the recorded transfer schedule.');
  if (completed.installments.some((_item, index) => index < payment.installmentIndex && getTransferInstallmentRemaining(completed, index) > 0)) throw new Error('Pay earlier installments of this transfer first.');
  const balance = getFinanceBalance(state.finance, transfer.toClubId);
  if (balance.unpaid > 0 || balance.cash - getPayrollReserve(state, transfer.toClubId) < payment.amount) throw new Error('Protect player wages before paying a transfer installment.');
  const charged = book(state, transfer.toClubId, 'transfer', -payment.amount, payment.id);
  return book(charged, transfer.fromClubId, 'transfer', payment.amount, payment.id);
}

function coachFee(contract: CoachingContract): number {
  const coach = DEVELOPMENT_COACHES.find(coach => coach.id === contract.coachId);
  if (!coach) throw new Error('The coaching fee needs a coach from the development catalog.');
  return coach.fee;
}

/** New contracts may use cash only; mandatory existing obligations are booked during activation. */
export function recordCoachFee(state: SeasonState, contract: CoachingContract): SeasonState {
  if (!state.finance.enabledSince) return state;
  if (contract.seasonNumber !== state.seasonNumber || !state.coaching.contracts.some(current => current.id === contract.id && current.clubId === contract.clubId && current.coachId === contract.coachId)) throw new Error('The coaching payment must belong to a current club contract.');
  const fee = coachFee(contract), balance = getFinanceBalance(state.finance, contract.clubId);
  if (getTransferPaymentSummary(state, contract.clubId).overdue > 0) throw new Error('Settle overdue transfer payments before hiring a coach.');
  if (balance.unpaid > 0 || balance.cash < fee) throw new Error('This club must settle unpaid costs and have enough cash before hiring a coach.');
  if (getSpendableCash(state, contract.clubId) < fee) throw new Error('This club must protect remaining player wage commitments before hiring a coach.');
  return book(state, contract.clubId, 'coaching', -fee, `coaching-${contract.id}`, null, { contractId: contract.id, coachId: contract.coachId });
}

function winShare(state: FinanceContext, clubId: string, beforeRound: number): number | null {
  const played = state.fixtures.filter(fixture => fixture.round < beforeRound && fixture.result !== null && [fixture.homeClubId, fixture.awayClubId].includes(clubId));
  return played.length ? played.filter(fixture => fixture.result!.winnerClubId === clubId).length / played.length : null;
}

/** Attendance is a deterministic development estimate from prior results and the chosen price. */
export function forecastGate(state: FinanceContext, fixture: Pick<FinanceFixture, 'id' | 'round' | 'homeClubId' | 'awayClubId'>, price: number): GateForecast {
  validatePrice(price);
  const venue = getClubFinanceDefinition(fixture.homeClubId);
  const own = winShare(state, fixture.homeClubId, fixture.round), opponent = winShare(state, fixture.awayClubId, fixture.round);
  const demand = venue.referenceDemand * (own === null ? 1 : .85 + .3 * own) * (opponent === null ? 1 : .9 + .2 * opponent);
  const attendance = price === 0 ? venue.capacity : Math.min(venue.capacity, Math.floor(demand * (DEFAULT_TICKET_PRICE / price) ** 1.4));
  return { fixtureId: fixture.id, clubId: fixture.homeClubId, opponentClubId: fixture.awayClubId, price, attendance, capacity: venue.capacity, revenue: attendance * price };
}

export function recommendTicketPrice(state: FinanceContext, fixture: Pick<FinanceFixture, 'id' | 'round' | 'homeClubId' | 'awayClubId'>): number {
  let price = 0, bestRevenue = 0;
  for (let candidate = TICKET_PRICE_STEP; candidate <= MAX_TICKET_PRICE; candidate += TICKET_PRICE_STEP) {
    const revenue = forecastGate(state, fixture, candidate).revenue;
    if (revenue > bestRevenue) { price = candidate; bestRevenue = revenue; }
  }
  return price;
}

export function setTicketPlan(state: SeasonState, plan: FinancePlan): SeasonState {
  if (!state.finance.enabledSince) throw new Error('Enable club finances before changing ticket policy.');
  if (!plan || typeof plan !== 'object' || Array.isArray(plan) || Object.keys(plan).length !== 2 || typeof plan.delegated !== 'boolean') throw new Error('Choose a valid ticket policy.');
  validatePrice(plan.price);
  return { ...state, finance: { ...state.finance, plans: { ...state.finance.plans, [state.managedClubId]: { ...plan } } } };
}

/** Calendar preparation only: UI edits update plans and cannot rewrite these locked prices. */
export function prepareFinanceRound(state: SeasonState): SeasonState {
  if (!state.finance.enabledSince) return state;
  const roundPrices = Object.fromEntries(state.clubs.map(club => {
    const plan = state.finance.plans[club.id]!;
    validatePrice(plan.price);
    const fixture = state.fixtures.find(fixture => fixture.round === state.round && fixture.homeClubId === club.id);
    return [club.id, plan.delegated && fixture ? recommendTicketPrice(state, fixture) : plan.price];
  }));
  return { ...state, finance: { ...state.finance, roundPrices } };
}

export function enableFinance(state: SeasonState): SeasonState {
  if (state.finance.enabledSince) return state;
  if (state.status === 'complete') throw new Error('Start the next season before enabling club finances.');
  let next: SeasonState = { ...state, finance: { ...state.finance, enabledSince: { seasonNumber: state.seasonNumber, round: state.round } } };
  for (const club of state.clubs) next = book(next, club.id, 'opening', OPENING_CASH, 'opening');
  for (const club of state.clubs) next = book(next, club.id, 'sponsor', ANNUAL_SPONSORSHIP / 10 * (11 - state.round), `sponsor-s${state.seasonNumber}`);
  for (const contract of state.coaching.contracts) next = book(next, contract.clubId, 'coaching', -coachFee(contract), `coaching-${contract.id}`, null, { contractId: contract.id, coachId: contract.coachId });
  return prepareFinanceRound(next);
}

/** Post all gates before mandatory operating costs; sporting results never consume finance RNG. */
export function processFinanceRound(state: SeasonState): SeasonState {
  if (!state.finance.enabledSince) return state;
  const fixtures = state.fixtures.filter(fixture => fixture.round === state.round).sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  if (fixtures.length !== state.clubs.length / 2 || fixtures.some(fixture => !fixture.result)) throw new Error('Commit every game in the matchday before recording finances.');
  let next = state;
  for (const fixture of fixtures) {
    const gate = forecastGate(state, fixture, state.finance.roundPrices[fixture.homeClubId]!);
    next = book(next, fixture.homeClubId, 'tickets', gate.revenue, `tickets-${fixture.id}`, { fixtureId: fixture.id, price: gate.price, attendance: gate.attendance });
  }
  for (const club of state.clubs) next = book(next, club.id, 'operations', -ROUND_OPERATING_COST, `operations-s${state.seasonNumber}-r${state.round}`);
  return next;
}

/** New-year sponsorship is received before selected staff renewals are considered. */
export function startFinanceSeason(state: SeasonState): SeasonState {
  if (!state.finance.enabledSince) return state;
  if (state.status !== 'active' || state.round !== 1) throw new Error('New-season funding requires the opening matchday.');
  let next = state;
  for (const club of state.clubs) next = book(next, club.id, 'sponsor', ANNUAL_SPONSORSHIP, `sponsor-s${state.seasonNumber}`);
  return prepareFinanceRound(next);
}
