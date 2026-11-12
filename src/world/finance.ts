import type { CoachingContract } from '../domain/coaching';
import type { ScoutContract } from '../domain/scouts';
import type { FitnessContract } from '../domain/fitness';
import type { PhysioContract } from '../domain/physio';
import type { AssistantContract } from '../domain/assistant';
import type { YouthCoachContract } from '../domain/youth';
import type { EmploymentBuyout, EmploymentTransfer } from '../domain/employment';
import type { PayrollCharge } from '../domain/payroll';
import type { TransferPayment } from '../domain/transfer-payments';
import type { FinanceBalance, FinanceEntry, FinanceLedgerRow, FinancePlan, GateForecast, SeasonFinance } from '../domain/finance';
import type { SeasonState } from '../domain/season';
import type { Team } from '../domain/types';
import { DEVELOPMENT_COACHES } from '../data/development-coaches';
import { DEVELOPMENT_SCOUTS } from '../data/development-scouts';
import { DEVELOPMENT_FITNESS_COACHES } from '../data/development-fitness';
import { DEVELOPMENT_PHYSIOS } from '../data/development-physios';
import { DEVELOPMENT_ASSISTANTS } from '../data/development-assistants';
import { DEVELOPMENT_YOUTH_COACHES } from '../data/development-youth';
import { getClubFinanceDefinition } from '../data/development-finances';
import { getPayrollReserve, getSpendableCash } from './payroll-policy';
import { getTransferInstallmentRemaining, getTransferPaymentSchedule, getTransferPaymentSummary, payTransferInstallment } from './transfer-payments';
import { quoteContractBuyout } from './buyouts';
import { STAFF_BUDGET, staffCommitted } from './staff-policy';

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

/** Compensation leaves the club once; no other club receives the player's settlement. */
export function recordContractBuyout(state: SeasonState, buyout: EmploymentBuyout): SeasonState {
  const records = state.employment.buyouts ?? [], recorded = records.at(-1);
  if (!recorded || JSON.stringify(recorded) !== JSON.stringify(buyout) || buyout.id !== `employment-buyout-${records.length}`) throw new Error('A buyout payment requires the exact newly recorded contract release.');
  if (state.finance.ledger.some(entry => entry.kind === 'buyout' && entry.sourceId === buyout.id)) throw new Error('This contract buyout has already been paid.');
  const before = { ...state, employment: { ...state.employment, buyouts: records.slice(0, -1) } };
  const quote = quoteContractBuyout(before, buyout.playerId, buyout.clubId);
  if (!quote.canBuyout) throw new Error(quote.reason!);
  if (state.status !== 'complete' || state.round !== 10 || buyout.seasonNumber !== state.seasonNumber || buyout.completedOn !== state.date || buyout.startsSeason !== quote.startsSeason || buyout.amount !== quote.amount || buyout.contractCountBefore !== quote.contractCountBefore || buyout.negotiationCountBefore !== quote.negotiationCountBefore || JSON.stringify(buyout.releasedContractIds) !== JSON.stringify(quote.releasedContractIds)) throw new Error('Pay exactly the remaining guaranteed salary for the recorded future terms.');
  return book(state, buyout.clubId, 'buyout', -buyout.amount, buyout.id);
}

/** Completion pays only the first installment; the entire fee must already be affordable. */
export function recordTransferFee(state: SeasonState, transfer: EmploymentTransfer): SeasonState {
  const completed = state.employment.transfers.find(item => item.id === transfer.id);
  if (!state.finance.enabledSince || !completed || completed.offerId !== transfer.offerId || completed.contractId !== transfer.contractId || completed.fromClubId !== transfer.fromClubId || completed.toClubId !== transfer.toClubId || completed.fee !== transfer.fee || completed.mode !== transfer.mode || completed.seasonNumber !== transfer.seasonNumber || completed.startsSeason !== transfer.startsSeason || completed.startsRound !== transfer.startsRound || completed.playerId !== transfer.playerId || completed.completedOn !== transfer.completedOn) throw new Error('A transfer payment requires the exact completed employment transfer.');
  const inSeason = transfer.startsSeason === state.seasonNumber && transfer.startsRound === state.round && state.round > 1;
  if (state.status !== (inSeason ? 'active' : 'complete') || transfer.seasonNumber !== state.seasonNumber || transfer.completedOn !== state.date || transfer.fromClubId === transfer.toClubId || !Number.isSafeInteger(transfer.fee) || transfer.fee <= 0) throw new Error('Choose a completed transfer at its recorded registration boundary.');
  if (transfer.payments.length || state.finance.ledger.some(entry => entry.kind === 'transfer' && entry.sourceId === transfer.id)) throw new Error('This transfer payment has already been recorded.');
  if (completed.paymentPlan !== transfer.paymentPlan || JSON.stringify(completed.installments) !== JSON.stringify(transfer.installments) || JSON.stringify(transfer.installments) !== JSON.stringify(getTransferPaymentSchedule(transfer.fee, transfer.paymentPlan, transfer.completedOn, transfer.startsSeason, transfer.startsRound))) throw new Error('Use the agreed transfer payment schedule.');
  if (transfer.mode === 'release-clause' && (transfer.paymentPlan !== 'upfront' || transfer.releasedContractIds.length !== 1 || !state.employment.contracts.some(contract => contract.id === transfer.releasedContractIds[0] && contract.clubId === transfer.fromClubId && contract.playerId === transfer.playerId && contract.releaseFee === transfer.fee))) throw new Error('Release-clause completion must pay the exact single source agreement fee in full.');
  if (getFinanceBalance(state.finance, transfer.toClubId).unpaid > 0 || getSpendableCash(state, transfer.toClubId, transfer.offerId, transfer.id, inSeason ? transfer.offerId : undefined) < transfer.fee) throw new Error('The transfer fee exceeds the remaining budget after other commitments.');
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
  if (staffCommitted(state, contract.clubId) > STAFF_BUDGET) throw new Error('This appointment exceeds the shared staff allocation.');
  if (getTransferPaymentSummary(state, contract.clubId).overdue > 0) throw new Error('Settle overdue transfer payments before hiring a coach.');
  if (balance.unpaid > 0 || balance.cash < fee) throw new Error('This club must settle unpaid costs and have enough cash before hiring a coach.');
  if (getSpendableCash(state, contract.clubId) < fee) throw new Error('This club must protect remaining player wage commitments before hiring a coach.');
  return book(state, contract.clubId, 'coaching', -fee, `coaching-${contract.id}`, null, { contractId: contract.id, coachId: contract.coachId });
}

/** A scout appointment and its full-season charge form one immutable transaction. */
export function recordScoutFee(state: SeasonState, contract: ScoutContract): SeasonState {
  const scout = DEVELOPMENT_SCOUTS.find(scout => scout.id === contract.scoutId);
  const stored = state.scouts.contracts.at(-1);
  if (!state.finance.enabledSince || !state.scouts.enabledSince || !state.scouting.enabledSince || state.status !== 'active' || !scout || contract.seasonNumber !== state.seasonNumber || contract.startedRound !== state.round || contract.hiredLedgerIndex !== state.finance.ledger.length || contract.releasedRound !== null || contract.releasedLedgerIndex !== null || JSON.stringify(stored) !== JSON.stringify(contract) || contract.id !== `scout-contract-${state.scouts.contracts.length}`) throw new Error('Pay only the exact newly appointed scout contract.');
  if (staffCommitted(state, contract.clubId) > STAFF_BUDGET) throw new Error('This appointment exceeds the shared staff allocation.');
  if (getFinanceBalance(state.finance, contract.clubId).unpaid || getTransferPaymentSummary(state, contract.clubId).overdue) throw new Error('Settle unpaid costs and overdue transfer payments before hiring a scout.');
  if (getSpendableCash(state, contract.clubId) < scout.fee) throw new Error('Protect remaining wages and transfer commitments before hiring a scout.');
  return append(state, { clubId: contract.clubId, kind: 'scouting', amount: -scout.fee, sourceId: `scouting-${contract.id}`, seasonNumber: state.seasonNumber, round: state.round, ticket: null, coach: null, payroll: null, scout: { contractId: contract.id, scoutId: contract.scoutId } });
}

export function recordFitnessFee(state: SeasonState, contract: FitnessContract): SeasonState {
  const coach = DEVELOPMENT_FITNESS_COACHES.find(coach => coach.id === contract.coachId);
  const stored = state.fitness.contracts.at(-1);
  if (!state.finance.enabledSince || !state.fitness.enabledSince || !state.training.enabledSince || state.status !== 'active' || state.round === 10 || !coach || contract.seasonNumber !== state.seasonNumber || contract.startedRound !== state.round || contract.hiredLedgerIndex !== state.finance.ledger.length || contract.releasedRound !== null || contract.releasedLedgerIndex !== null || JSON.stringify(stored) !== JSON.stringify(contract) || contract.id !== `fitness-contract-${state.fitness.contracts.length}`) throw new Error('Pay only the exact newly appointed fitness coach contract.');
  if (staffCommitted(state, contract.clubId) > STAFF_BUDGET) throw new Error('This appointment exceeds the shared staff allocation.');
  if (getFinanceBalance(state.finance, contract.clubId).unpaid || getTransferPaymentSummary(state, contract.clubId).overdue) throw new Error('Settle unpaid costs and overdue transfer payments before hiring a fitness coach.');
  if (getSpendableCash(state, contract.clubId) < coach.fee) throw new Error('Protect remaining wages and transfer commitments before hiring a fitness coach.');
  return append(state, { clubId: contract.clubId, kind: 'fitness', amount: -coach.fee, sourceId: `fitness-${contract.id}`, seasonNumber: state.seasonNumber, round: state.round, ticket: null, coach: null, payroll: null, fitness: { contractId: contract.id, coachId: contract.coachId } });
}

export function recordPhysioFee(state: SeasonState, contract: PhysioContract): SeasonState {
  const staff = DEVELOPMENT_PHYSIOS.find(staff => staff.id === contract.physioId);
  const stored = state.physio.contracts.at(-1);
  if (!state.finance.enabledSince || !state.physio.enabledSince || state.status !== 'active' || state.round === 10 || !staff || contract.seasonNumber !== state.seasonNumber || contract.startedRound !== state.round || contract.hiredLedgerIndex !== state.finance.ledger.length || contract.releasedRound !== null || contract.releasedLedgerIndex !== null || JSON.stringify(stored) !== JSON.stringify(contract) || contract.id !== `physio-contract-${state.physio.contracts.length}`) throw new Error('Pay only the exact newly appointed physio contract.');
  if (staffCommitted(state, contract.clubId) > STAFF_BUDGET) throw new Error('This appointment exceeds the shared staff allocation.');
  if (getFinanceBalance(state.finance, contract.clubId).unpaid || getTransferPaymentSummary(state, contract.clubId).overdue) throw new Error('Settle unpaid costs and overdue transfer payments before hiring a physio.');
  if (getSpendableCash(state, contract.clubId) < staff.fee) throw new Error('Protect remaining wages and transfer commitments before hiring a physio.');
  return append(state, { clubId: contract.clubId, kind: 'physio', amount: -staff.fee, sourceId: `physio-${contract.id}`, seasonNumber: state.seasonNumber, round: state.round, ticket: null, coach: null, payroll: null, physio: { contractId: contract.id, physioId: contract.physioId } });
}

/** A full-season assistant appointment is charged once and never refunded on release. */
export function recordAssistantFee(state: SeasonState, contract: AssistantContract): SeasonState {
  const coach = DEVELOPMENT_ASSISTANTS.find(coach => coach.id === contract.assistantId);
  const stored = state.assistant.contracts.at(-1);
  if (!state.finance.enabledSince || !state.assistant.enabledSince || state.status !== 'active' || state.round === 10 && state.activeMatch.status === 'finished' || !coach || contract.seasonNumber !== state.seasonNumber || contract.startedRound !== state.round || contract.hiredLedgerIndex !== state.finance.ledger.length || contract.releasedRound !== null || contract.releasedLedgerIndex !== null || JSON.stringify(stored) !== JSON.stringify(contract) || contract.id !== `assistant-contract-${state.assistant.contracts.length}`) throw new Error('Pay only the exact newly appointed assistant-coach contract.');
  const active = state.assistant.contracts.filter(item => item.seasonNumber === state.seasonNumber && item.releasedRound === null);
  if (!state.clubs.some(club => club.id === contract.clubId) || active.filter(item => item.clubId === contract.clubId).length !== 1 || active.filter(item => item.assistantId === contract.assistantId).length !== 1) throw new Error('Only one active assistant coach is allowed per club and per person.');
  if (staffCommitted(state, contract.clubId) > STAFF_BUDGET) throw new Error('This appointment exceeds the shared staff allocation.');
  if (getFinanceBalance(state.finance, contract.clubId).unpaid || getTransferPaymentSummary(state, contract.clubId).overdue) throw new Error('Settle unpaid costs and overdue transfer payments before hiring an assistant coach.');
  if (getSpendableCash(state, contract.clubId) < coach.fee) throw new Error('Protect remaining wages and transfer commitments before hiring an assistant coach.');
  return append(state, { clubId: contract.clubId, kind: 'assistant', amount: -coach.fee, sourceId: `assistant-${contract.id}`, seasonNumber: state.seasonNumber, round: state.round, ticket: null, coach: null, payroll: null, assistant: { contractId: contract.id, assistantId: contract.assistantId } });
}

export function recordYouthFee(state: SeasonState, contract: YouthCoachContract): SeasonState {
  const coach = DEVELOPMENT_YOUTH_COACHES.find(coach => coach.id === contract.coachId), stored = state.youth.contracts.at(-1);
  if (!state.finance.enabledSince || !state.youth.enabledSince || !state.academy.enabledSince || state.status !== 'active' || state.round === 10 || !coach || contract.seasonNumber !== state.seasonNumber || contract.startedRound !== state.round || contract.hiredLedgerIndex !== state.finance.ledger.length || contract.releasedRound !== null || contract.releasedLedgerIndex !== null || JSON.stringify(stored) !== JSON.stringify(contract) || contract.id !== `youth-contract-${state.youth.contracts.length}`) throw new Error('Pay only the exact newly appointed youth-coach contract.');
  const active = state.youth.contracts.filter(item => item.seasonNumber === state.seasonNumber && item.releasedRound === null);
  if (!state.clubs.some(club => club.id === contract.clubId) || active.filter(item => item.clubId === contract.clubId).length !== 1 || active.filter(item => item.coachId === contract.coachId).length !== 1) throw new Error('Only one active youth coach is allowed per club and person.');
  if (staffCommitted(state, contract.clubId) > STAFF_BUDGET) throw new Error('This appointment exceeds the shared staff allocation.');
  if (getFinanceBalance(state.finance, contract.clubId).unpaid || getTransferPaymentSummary(state, contract.clubId).overdue) throw new Error('Settle unpaid costs and overdue transfer payments before hiring a youth coach.');
  if (getSpendableCash(state, contract.clubId) < coach.fee) throw new Error('Protect remaining wages and transfer commitments before hiring a youth coach.');
  return append(state, { clubId: contract.clubId, kind: 'youth', amount: -coach.fee, sourceId: `youth-${contract.id}`, seasonNumber: state.seasonNumber, round: state.round, ticket: null, coach: null, payroll: null, youth: { contractId: contract.id, coachId: contract.coachId } });
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
