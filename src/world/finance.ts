import { staffLimit } from './wage-pool';
import { requireCalendarWeek } from './calendar-boundary';
import type { CoachingContract } from '../domain/coaching';
import type { ScoutContract } from '../domain/scouts';
import type { FitnessContract } from '../domain/fitness';
import type { PhysioContract } from '../domain/physio';
import type { AssistantContract } from '../domain/assistant';
import type { YouthCoachContract } from '../domain/youth';
import type { FacilityProject, SeasonFacilities } from '../domain/facilities';
import type { SeasonRivalries } from '../domain/rivalries';
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
import type { WorldContext } from '../domain/world';
import { clubFinanceDefinition, playsAtNeutralVenue, seasonRounds, worldOf } from './career-world';
import { getPayrollReserve, getSpendableCash } from './payroll-policy';
import { getTransferInstallmentRemaining, getTransferPaymentSchedule, getTransferPaymentSummary, payTransferInstallment } from './transfer-payments';
import { quoteContractBuyout } from './buyouts';
import { staffAllocation, staffCommitted, minimumStaffAppointment } from './staff-policy';
import { arenaComfortPercent, getArenaCapacity, getFacilityUpkeepBreakdown, quoteArenaExpansion, quoteFacilityRepair, quoteFacilityUpgrade } from './facilities-policy';
import { governingDerby, RIVALRY_CROWD_PERCENT } from './rivalries';
import { agreementFor, commercialGovernsSeason, openingSponsorshipClubs, sponsorshipInstallment, sponsorshipSourceId, type DueSponsorshipPayment } from './commercial-policy';
import { ASSISTANT_DIRECTORY, COACH_DIRECTORY, FITNESS_DIRECTORY, PHYSIO_DIRECTORY, SCOUT_DIRECTORY, YOUTH_COACH_DIRECTORY, staffMember } from '../data/staff-directory';
import { appendFinanceLedgerEntry, financeLedgerCount, financeLedgerEntries, financeLedgerTicket } from './finance-ledger';
import { clubEconomy, REAL_ECONOMY_RULES, staffFee } from './economy';
import { solidarityPayment } from './economy-balance';
import { ledgerClubBalance } from './finance-ledger-index';
import type { SeasonMedia } from '../domain/media';
import type { SeasonRelationships } from '../domain/relationships';
import { pressSupporterPercent } from './media';
import { dateForRound } from './season';
import { debtSourceId, dueDebtPayments } from './facility-debt';
import { usesStaffContracts } from './staff-contracts';

export { clubFinanceDefinition } from './career-world';
export type { FinanceBalance, FinanceLedgerRow, GateForecast } from '../domain/finance';
/** Development economy (every world without `economy`); worlds with an economy read each club's figures instead. */
export const OPENING_CASH = 50_000_000;
export const ANNUAL_SPONSORSHIP = 20_000_000;
export const ROUND_OPERATING_COST = 1_500_000;
export const DEFAULT_TICKET_PRICE = 1800;
export const MAX_TICKET_PRICE = 6000;
export const TICKET_PRICE_STEP = 100;

/** Opening cash for a club (format 62: its researched figure). */
export const openingCashFor = (context: WorldContext, clubId: string): number => clubEconomy(context, clubId)?.openingCash ?? OPENING_CASH;
/** The fixed annual sponsorship (format 62: the club's main sponsorship). */
export const annualSponsorshipFor = (context: WorldContext, clubId: string): number => clubEconomy(context, clubId)?.sponsorship ?? ANNUAL_SPONSORSHIP;
/** Format 62: the club's season funding (league, European and public money and the owner's contribution); none in the development economy. */
export const annualFundingFor = (context: WorldContext, clubId: string): number => { const economy = clubEconomy(context, clubId); return economy ? economy.funding + solidarityPayment(context, clubId) : 0; };
/** The season-funding receipt's source (booked as sponsorship-kind income at the season opening, after the sponsors). */
export const fundingSourceId = (seasonNumber: number): string => `funding-s${seasonNumber}`;
/** A week's operating cost: the club's annual figure in equal weekly parts (format 62), otherwise the development constant. */
export function roundOperatingCostFor(context: WorldContext, clubId: string): number {
  const economy = clubEconomy(context, clubId);
  return economy ? Math.round(economy.operatingCost / seasonRounds(context)) : ROUND_OPERATING_COST;
}
/** The club's default ticket price (format 62: its league's yield placed by strength). */
export const defaultTicketPriceFor = (context: WorldContext, clubId: string): number => clubEconomy(context, clubId)?.ticketPrice ?? DEFAULT_TICKET_PRICE;
/** The highest ticket price the club may set: three times its default (format 62), otherwise sixty euros. */
export function maxTicketPriceFor(context: WorldContext, clubId: string): number {
  const economy = clubEconomy(context, clubId);
  return economy ? economy.ticketPrice * REAL_ECONOMY_RULES.maxPriceMultiple : MAX_TICKET_PRICE;
}

export interface FinanceFixture {
  id: string;
  round: number;
  homeClubId: string;
  awayClubId: string;
  result: { winnerClubId: string } | null;
}
/** Format 67: careers with media also carry their press answers (`relationships`), which move gate demand a little. */
export interface FinanceContext extends WorldContext { fixtures: readonly FinanceFixture[]; facilities?: SeasonFacilities; finance?: SeasonFinance; date?: string; round?: number; seasonNumber?: number; rivalries?: SeasonRivalries; media?: SeasonMedia; relationships?: SeasonRelationships }

function validatePrice(price: number, maximum = MAX_TICKET_PRICE): void {
  if (!Number.isInteger(price) || price < 0 || price > maximum || price % TICKET_PRICE_STEP !== 0) throw new Error(maximum === MAX_TICKET_PRICE ? 'Choose a ticket price from zero to sixty euros in one-euro steps.' : `Choose a ticket price from zero to ${maximum / 100} euros in one-euro steps.`);
}

/** Each club starts at its default price; `context` names the world (format 62 prices differ per club). */
export function createFinance(clubs: readonly Team[], managedClubId: string, context: WorldContext = {}): SeasonFinance {
  return { model: 'finance-1', enabledSince: null,
    plans: Object.fromEntries(clubs.map(club => [club.id, { delegated: club.id !== managedClubId, price: defaultTicketPriceFor(context, club.id) }])),
    roundPrices: Object.fromEntries(clubs.map(club => [club.id, defaultTicketPriceFor(context, club.id)])), ledger: [],
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
  return ledgerClubBalance(finance, clubId);
}

/** Newest-first display rows preserve both the original obligation and its actual cash effects. */
export function financeLedgerRows(finance: SeasonFinance, clubId: string): FinanceLedgerRow[] {
  let balance: FinanceBalance = { cash: 0, unpaid: 0 };
  const rows: FinanceLedgerRow[] = [];
  for (const entry of financeLedgerEntries(finance)) if (entry.clubId === clubId) {
    const previous = balance;
    balance = applyAmount(previous, entry.amount);
    rows.push({ ...entry, cashDelta: balance.cash - previous.cash, unpaidDelta: balance.unpaid - previous.unpaid, cashAfter: balance.cash, unpaidAfter: balance.unpaid });
  }
  return rows.reverse();
}

function append(state: SeasonState, entry: Omit<FinanceEntry, 'id'>): SeasonState {
  return { ...state, finance: appendFinanceLedgerEntry(state.finance, entry) };
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

/** Construction (and a `facilities-2` repair) is paid in full on approval; cancellation does not refund this retained investment. */
export function recordFacilityInvestment(state: SeasonState, project: FacilityProject): SeasonState {
  const stored = state.facilities.projects.at(-1), event = state.facilities.events.at(-1);
  if (!state.facilities.enabledSince || !state.finance.enabledSince || !stored || JSON.stringify(stored) !== JSON.stringify(project) || project.id !== `facility-project-${state.facilities.projects.length}` || event?.type !== (project.kind === 'repair' ? 'repair' : 'start') || event.projectId !== project.id || event.ledgerIndex !== financeLedgerCount(state.finance) || project.startEventIndex !== state.facilities.events.length - 1 || project.startedOn !== state.date || project.completedOn !== null || project.cancelledOn !== null) throw new Error('Pay only the exact newly approved facility project.');
  const before = { ...state, facilities: { ...state.facilities, projects: state.facilities.projects.slice(0, -1), events: state.facilities.events.slice(0, -1) } };
  if (project.kind === 'repair') {
    const repair = quoteFacilityRepair(before, project.type, project.clubId);
    if (!repair.canStart || repair.cost !== project.cost || repair.level !== project.fromLevel || repair.level !== project.toLevel || repair.conditionBefore !== project.conditionBefore || repair.dueOn !== project.dueOn) throw new Error(repair.reason ?? 'Fund exactly the approved repair terms.');
    return append(state, { clubId: project.clubId, kind: 'facility', amount: -project.cost, sourceId: project.id, seasonNumber: state.seasonNumber, round: state.round, ticket: null, coach: null, payroll: null, facility: { projectId: project.id, type: project.type } });
  }
  if (project.kind === 'expansion') {
    // Format 74 (`facilities-3`): an arena expansion of a supported size.
    const expansion = quoteArenaExpansion(before, project.seats ?? 0, project.clubId);
    if (!expansion.canStart || expansion.cost !== project.cost || expansion.seats !== project.seats || project.fromLevel !== 1 || project.toLevel !== 1 || expansion.dueOn !== project.dueOn) throw new Error(expansion.reason ?? 'Fund exactly the approved expansion terms.');
    return append(state, { clubId: project.clubId, kind: 'facility', amount: -project.cost, sourceId: project.id, seasonNumber: state.seasonNumber, round: state.round, ticket: null, coach: null, payroll: null, facility: { projectId: project.id, type: project.type } });
  }
  const quote = quoteFacilityUpgrade(before, project.type, project.clubId);
  if (!quote.canStart || quote.cost !== project.cost || quote.fromLevel !== project.fromLevel || quote.toLevel !== project.toLevel || quote.dueOn !== project.dueOn) throw new Error(quote.reason ?? 'Fund exactly the approved construction terms.');
  return append(state, { clubId: project.clubId, kind: 'facility', amount: -project.cost, sourceId: project.id, seasonNumber: state.seasonNumber, round: state.round, ticket: null, coach: null, payroll: null, facility: { projectId: project.id, type: project.type } });
}

/** Owner capital for exactly the approved board decision just recorded; the funded upgrade starts next. */
export function recordBoardCapital(state: SeasonState, projectId: string): SeasonState {
  const decision = state.facilities.events.at(-1);
  if (!state.finance.enabledSince || decision?.type !== 'funding' || !decision.approved || decision.ledgerIndex !== financeLedgerCount(state.finance) || projectId !== `facility-project-${state.facilities.projects.length + 1}` || !Number.isSafeInteger(decision.amount) || decision.amount <= 0) throw new Error('Book owner capital only for the board decision just approved.');
  return append(state, { clubId: decision.clubId, kind: 'board-capital', amount: decision.amount, sourceId: `board-capital-${projectId}`, seasonNumber: state.seasonNumber, round: state.round, ticket: null, coach: null, payroll: null, boardCapital: { projectId, facilityType: decision.facilityType } });
}

/** Compensation leaves the club once; no other club receives the player's settlement. */
export function recordContractBuyout(state: SeasonState, buyout: EmploymentBuyout): SeasonState {
  const records = state.employment.buyouts ?? [], recorded = records.at(-1);
  if (!recorded || JSON.stringify(recorded) !== JSON.stringify(buyout) || buyout.id !== `employment-buyout-${records.length}`) throw new Error('A buyout payment requires the exact newly recorded contract release.');
  for (const entry of financeLedgerEntries(state.finance)) if (entry.kind === 'buyout' && entry.sourceId === buyout.id) throw new Error('This contract buyout has already been paid.');
  const before = { ...state, employment: { ...state.employment, buyouts: records.slice(0, -1) } };
  const quote = quoteContractBuyout(before, buyout.playerId, buyout.clubId);
  if (!quote.canBuyout) throw new Error(quote.reason!);
  if (state.status !== 'complete' || state.round !== seasonRounds(state) || buyout.seasonNumber !== state.seasonNumber || buyout.completedOn !== state.date || buyout.startsSeason !== quote.startsSeason || buyout.amount !== quote.amount || buyout.contractCountBefore !== quote.contractCountBefore || buyout.negotiationCountBefore !== quote.negotiationCountBefore || JSON.stringify(buyout.releasedContractIds) !== JSON.stringify(quote.releasedContractIds)) throw new Error('Pay exactly the remaining guaranteed salary for the recorded future terms.');
  return book(state, buyout.clubId, 'buyout', -buyout.amount, buyout.id);
}

/** Completion pays only the first installment; the entire fee must already be affordable. */
export function recordTransferFee(state: SeasonState, transfer: EmploymentTransfer): SeasonState {
  const completed = state.employment.transfers.find(item => item.id === transfer.id);
  if (!state.finance.enabledSince || !completed || completed.offerId !== transfer.offerId || completed.contractId !== transfer.contractId || completed.fromClubId !== transfer.fromClubId || completed.toClubId !== transfer.toClubId || completed.fee !== transfer.fee || completed.mode !== transfer.mode || completed.seasonNumber !== transfer.seasonNumber || completed.startsSeason !== transfer.startsSeason || completed.startsRound !== transfer.startsRound || completed.playerId !== transfer.playerId || completed.completedOn !== transfer.completedOn) throw new Error('A transfer payment requires the exact completed employment transfer.');
  const inSeason = transfer.startsSeason === state.seasonNumber && transfer.startsRound === state.round && state.round > 1;
  if (state.status !== (inSeason ? 'active' : 'complete') || transfer.seasonNumber !== state.seasonNumber || transfer.completedOn !== state.date || transfer.fromClubId === transfer.toClubId || !Number.isSafeInteger(transfer.fee) || transfer.fee <= 0) throw new Error('Choose a completed transfer at its recorded registration boundary.');
  if (transfer.payments.length) throw new Error('This transfer payment has already been recorded.');
  for (const entry of financeLedgerEntries(state.finance)) if (entry.kind === 'transfer' && entry.sourceId === transfer.id) throw new Error('This transfer payment has already been recorded.');
  if (completed.paymentPlan !== transfer.paymentPlan || JSON.stringify(completed.installments) !== JSON.stringify(transfer.installments) || JSON.stringify(transfer.installments) !== JSON.stringify(getTransferPaymentSchedule(transfer.fee, transfer.paymentPlan, transfer.completedOn, transfer.startsSeason, transfer.startsRound))) throw new Error('Use the agreed transfer payment schedule.');
  if (transfer.mode === 'release-clause' && (transfer.paymentPlan !== 'upfront' || transfer.releasedContractIds.length !== 1 || !state.employment.contracts.some(contract => contract.id === transfer.releasedContractIds[0] && contract.clubId === transfer.fromClubId && contract.playerId === transfer.playerId && contract.releaseFee === transfer.fee))) throw new Error('Release-clause completion must pay the exact single source agreement fee in full.');
  if (getFinanceBalance(state.finance, transfer.toClubId).unpaid > 0 || getSpendableCash(state, transfer.toClubId, transfer.offerId, transfer.id, inSeason ? transfer.offerId : undefined) < transfer.fee) throw new Error('The transfer fee exceeds your Spending left after other commitments.');
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

/** The coach's catalog fee at the club's money level (format 62), paid when hired (nothing up front with staff contracts). */
function coachFee(context: WorldContext & Pick<SeasonState, 'coaching'>, contract: CoachingContract): number {
  const coach = staffMember(COACH_DIRECTORY, contract.coachId);
  if (!coach) throw new Error('The training coach fee needs a training coach from the development catalog.');
  return upfrontStaffFee(context, contract.clubId, coach.fee);
}

/**
 * What a staff appointment pays when it is made: the season fee at the club's money level, or nothing in format 76
 * (`coaching-4`), where staff are paid a weekly salary (`src/world/staff-contracts.ts`). The appointment's ledger entry
 * is kept (with amount 0) so every appointment still has its ledger boundary.
 */
export function upfrontStaffFee(context: WorldContext & Pick<SeasonState, 'coaching'>, clubId: string, catalogFee: number): number {
  return usesStaffContracts(context) ? 0 : staffFee(context, clubId, catalogFee);
}

/** New contracts may use cash only; mandatory existing obligations are booked during activation. */
export function recordCoachFee(state: SeasonState, contract: CoachingContract): SeasonState {
  if (!state.finance.enabledSince) return state;
  if (contract.seasonNumber !== state.seasonNumber || !state.coaching.contracts.some(current => current.id === contract.id && current.clubId === contract.clubId && current.coachId === contract.coachId)) throw new Error('The training coach payment must belong to a current club contract.');
  const fee = coachFee(state, contract), balance = getFinanceBalance(state.finance, contract.clubId);
  if (!minimumStaffAppointment() && (staffCommitted(state, contract.clubId) > staffLimit(state, contract.clubId))) throw new Error('This appointment exceeds the shared staff budget.');
  if (!minimumStaffAppointment() && (getTransferPaymentSummary(state, contract.clubId).overdue > 0)) throw new Error('Settle overdue transfer payments before hiring a training coach.');
  if (!minimumStaffAppointment() && (balance.unpaid > 0 || balance.cash < fee)) throw new Error('This club must settle unpaid costs and have enough cash before hiring a training coach.');
  if (!minimumStaffAppointment() && (getSpendableCash(state, contract.clubId) < fee)) throw new Error('This club must protect remaining player wage commitments before hiring a training coach.');
  return book(state, contract.clubId, 'coaching', 0 - fee, `coaching-${contract.id}`, null, { contractId: contract.id, coachId: contract.coachId });
}

/** A scout appointment and its full-season charge form one immutable transaction. */
export function recordScoutFee(state: SeasonState, contract: ScoutContract): SeasonState {
  const scout = staffMember(SCOUT_DIRECTORY, contract.scoutId);
  const stored = state.scouts.contracts.at(-1);
  if (!state.finance.enabledSince || !state.scouts.enabledSince || !state.scouting.enabledSince || state.status !== 'active' || !scout || contract.seasonNumber !== state.seasonNumber || contract.startedRound !== state.round || contract.hiredLedgerIndex !== financeLedgerCount(state.finance) || contract.releasedRound !== null || contract.releasedLedgerIndex !== null || JSON.stringify(stored) !== JSON.stringify(contract) || contract.id !== `scout-contract-${state.scouts.contracts.length}`) throw new Error('Pay only the exact newly appointed scout contract.');
  if (!minimumStaffAppointment() && (staffCommitted(state, contract.clubId) > staffLimit(state, contract.clubId))) throw new Error('This appointment exceeds the shared staff budget.');
  if (!minimumStaffAppointment() && (getFinanceBalance(state.finance, contract.clubId).unpaid || getTransferPaymentSummary(state, contract.clubId).overdue)) throw new Error('Settle unpaid costs and overdue transfer payments before hiring a scout.');
  if (!minimumStaffAppointment() && (getSpendableCash(state, contract.clubId) < upfrontStaffFee(state, contract.clubId, scout.fee))) throw new Error('Protect remaining wages and transfer commitments before hiring a scout.');
  return append(state, { clubId: contract.clubId, kind: 'scouting', amount: 0 - upfrontStaffFee(state, contract.clubId, scout.fee), sourceId: `scouting-${contract.id}`, seasonNumber: state.seasonNumber, round: state.round, ticket: null, coach: null, payroll: null, scout: { contractId: contract.id, scoutId: contract.scoutId } });
}

export function recordFitnessFee(state: SeasonState, contract: FitnessContract): SeasonState {
  const coach = staffMember(FITNESS_DIRECTORY, contract.coachId);
  const stored = state.fitness.contracts.at(-1);
  if (!state.finance.enabledSince || !state.fitness.enabledSince || !state.training.enabledSince || state.status !== 'active' || state.round === seasonRounds(state) || !coach || contract.seasonNumber !== state.seasonNumber || contract.startedRound !== state.round || contract.hiredLedgerIndex !== financeLedgerCount(state.finance) || contract.releasedRound !== null || contract.releasedLedgerIndex !== null || JSON.stringify(stored) !== JSON.stringify(contract) || contract.id !== `fitness-contract-${state.fitness.contracts.length}`) throw new Error('Pay only the exact newly appointed fitness coach contract.');
  if (!minimumStaffAppointment() && (staffCommitted(state, contract.clubId) > staffLimit(state, contract.clubId))) throw new Error('This appointment exceeds the shared staff budget.');
  if (!minimumStaffAppointment() && (getFinanceBalance(state.finance, contract.clubId).unpaid || getTransferPaymentSummary(state, contract.clubId).overdue)) throw new Error('Settle unpaid costs and overdue transfer payments before hiring a fitness coach.');
  if (!minimumStaffAppointment() && (getSpendableCash(state, contract.clubId) < upfrontStaffFee(state, contract.clubId, coach.fee))) throw new Error('Protect remaining wages and transfer commitments before hiring a fitness coach.');
  return append(state, { clubId: contract.clubId, kind: 'fitness', amount: 0 - upfrontStaffFee(state, contract.clubId, coach.fee), sourceId: `fitness-${contract.id}`, seasonNumber: state.seasonNumber, round: state.round, ticket: null, coach: null, payroll: null, fitness: { contractId: contract.id, coachId: contract.coachId } });
}

export function recordPhysioFee(state: SeasonState, contract: PhysioContract): SeasonState {
  const staff = staffMember(PHYSIO_DIRECTORY, contract.physioId);
  const stored = state.physio.contracts.at(-1);
  if (!state.finance.enabledSince || !state.physio.enabledSince || state.status !== 'active' || state.round === seasonRounds(state) || !staff || contract.seasonNumber !== state.seasonNumber || contract.startedRound !== state.round || contract.hiredLedgerIndex !== financeLedgerCount(state.finance) || contract.releasedRound !== null || contract.releasedLedgerIndex !== null || JSON.stringify(stored) !== JSON.stringify(contract) || contract.id !== `physio-contract-${state.physio.contracts.length}`) throw new Error('Pay only the exact newly appointed physio contract.');
  if (!minimumStaffAppointment() && (staffCommitted(state, contract.clubId) > staffLimit(state, contract.clubId))) throw new Error('This appointment exceeds the shared staff budget.');
  if (!minimumStaffAppointment() && (getFinanceBalance(state.finance, contract.clubId).unpaid || getTransferPaymentSummary(state, contract.clubId).overdue)) throw new Error('Settle unpaid costs and overdue transfer payments before hiring a physio.');
  if (!minimumStaffAppointment() && (getSpendableCash(state, contract.clubId) < upfrontStaffFee(state, contract.clubId, staff.fee))) throw new Error('Protect remaining wages and transfer commitments before hiring a physio.');
  return append(state, { clubId: contract.clubId, kind: 'physio', amount: 0 - upfrontStaffFee(state, contract.clubId, staff.fee), sourceId: `physio-${contract.id}`, seasonNumber: state.seasonNumber, round: state.round, ticket: null, coach: null, payroll: null, physio: { contractId: contract.id, physioId: contract.physioId } });
}

/** A full-season assistant appointment is charged once and never refunded on release. */
export function recordAssistantFee(state: SeasonState, contract: AssistantContract): SeasonState {
  const coach = staffMember(ASSISTANT_DIRECTORY, contract.assistantId);
  const stored = state.assistant.contracts.at(-1);
  if (!state.finance.enabledSince || !state.assistant.enabledSince || state.status !== 'active' || state.round === seasonRounds(state) && state.activeMatch?.status === 'finished' || !coach || contract.seasonNumber !== state.seasonNumber || contract.startedRound !== state.round || contract.hiredLedgerIndex !== financeLedgerCount(state.finance) || contract.releasedRound !== null || contract.releasedLedgerIndex !== null || JSON.stringify(stored) !== JSON.stringify(contract) || contract.id !== `assistant-contract-${state.assistant.contracts.length}`) throw new Error('Pay only the exact newly appointed assistant-coach contract.');
  const active = state.assistant.contracts.filter(item => item.seasonNumber === state.seasonNumber && item.releasedRound === null);
  if (!state.clubs.some(club => club.id === contract.clubId) || active.filter(item => item.clubId === contract.clubId).length !== 1 || active.filter(item => item.assistantId === contract.assistantId).length !== 1) throw new Error('Only one active assistant coach is allowed per club and per person.');
  if (!minimumStaffAppointment() && (staffCommitted(state, contract.clubId) > staffLimit(state, contract.clubId))) throw new Error('This appointment exceeds the shared staff budget.');
  if (!minimumStaffAppointment() && (getFinanceBalance(state.finance, contract.clubId).unpaid || getTransferPaymentSummary(state, contract.clubId).overdue)) throw new Error('Settle unpaid costs and overdue transfer payments before hiring an assistant coach.');
  if (!minimumStaffAppointment() && (getSpendableCash(state, contract.clubId) < upfrontStaffFee(state, contract.clubId, coach.fee))) throw new Error('Protect remaining wages and transfer commitments before hiring an assistant coach.');
  return append(state, { clubId: contract.clubId, kind: 'assistant', amount: 0 - upfrontStaffFee(state, contract.clubId, coach.fee), sourceId: `assistant-${contract.id}`, seasonNumber: state.seasonNumber, round: state.round, ticket: null, coach: null, payroll: null, assistant: { contractId: contract.id, assistantId: contract.assistantId } });
}

export function recordYouthFee(state: SeasonState, contract: YouthCoachContract): SeasonState {
  const coach = staffMember(YOUTH_COACH_DIRECTORY, contract.coachId), stored = state.youth.contracts.at(-1);
  if (!state.finance.enabledSince || !state.youth.enabledSince || !state.academy.enabledSince || state.status !== 'active' || state.round === seasonRounds(state) || !coach || contract.seasonNumber !== state.seasonNumber || contract.startedRound !== state.round || contract.hiredLedgerIndex !== financeLedgerCount(state.finance) || contract.releasedRound !== null || contract.releasedLedgerIndex !== null || JSON.stringify(stored) !== JSON.stringify(contract) || contract.id !== `youth-contract-${state.youth.contracts.length}`) throw new Error('Pay only the exact newly appointed youth-coach contract.');
  const active = state.youth.contracts.filter(item => item.seasonNumber === state.seasonNumber && item.releasedRound === null);
  if (!state.clubs.some(club => club.id === contract.clubId) || active.filter(item => item.clubId === contract.clubId).length !== 1 || active.filter(item => item.coachId === contract.coachId).length !== 1) throw new Error('Only one active youth coach is allowed per club and person.');
  if (!minimumStaffAppointment() && (staffCommitted(state, contract.clubId) > staffLimit(state, contract.clubId))) throw new Error('This appointment exceeds the shared staff budget.');
  if (!minimumStaffAppointment() && (getFinanceBalance(state.finance, contract.clubId).unpaid || getTransferPaymentSummary(state, contract.clubId).overdue)) throw new Error('Settle unpaid costs and overdue transfer payments before hiring a youth coach.');
  if (!minimumStaffAppointment() && (getSpendableCash(state, contract.clubId) < upfrontStaffFee(state, contract.clubId, coach.fee))) throw new Error('Protect remaining wages and transfer commitments before hiring a youth coach.');
  return append(state, { clubId: contract.clubId, kind: 'youth', amount: 0 - upfrontStaffFee(state, contract.clubId, coach.fee), sourceId: `youth-${contract.id}`, seasonNumber: state.seasonNumber, round: state.round, ticket: null, coach: null, payroll: null, youth: { contractId: contract.id, coachId: contract.coachId } });
}

function winShare(state: FinanceContext, clubId: string, beforeRound: number): number | null {
  const played = state.fixtures.filter(fixture => fixture.round < beforeRound && fixture.result !== null && [fixture.homeClubId, fixture.awayClubId].includes(clubId));
  return played.length ? played.filter(fixture => fixture.result!.winnerClubId === clubId).length / played.length : null;
}

/** Attendance is a deterministic development estimate from prior results and the chosen price. */
export function forecastGate(state: FinanceContext, fixture: Pick<FinanceFixture, 'id' | 'round' | 'homeClubId' | 'awayClubId'> & { date?: string }, price: number): GateForecast {
  return gateForecaster(state, fixture)(price);
}

/**
 * Forecasts for one fixture at several prices (step 3.7): capacity and demand do not depend on the price, so they are
 * worked out once, after the first price is checked, instead of for every candidate price. The arithmetic is unchanged.
 */
function gateForecaster(state: FinanceContext, fixture: Pick<FinanceFixture, 'id' | 'round' | 'homeClubId' | 'awayClubId'> & { date?: string }): (price: number) => GateForecast {
  let shared: { capacity: number; demand: number } | undefined, defaultPrice: number | undefined;
  return price => {
    validatePrice(price, maxTicketPriceFor(state, fixture.homeClubId));
    shared ??= gateDemand(state, fixture);
    const { capacity, demand } = shared;
    const attendance = price === 0 ? capacity : Math.min(capacity, Math.floor(demand * ((defaultPrice ??= defaultTicketPriceFor(state, fixture.homeClubId)) / price) ** 1.4));
    return { fixtureId: fixture.id, clubId: fixture.homeClubId, opponentClubId: fixture.awayClubId, price, attendance, capacity, revenue: attendance * price };
  };
}

function gateDemand(state: FinanceContext, fixture: Pick<FinanceFixture, 'id' | 'round' | 'homeClubId' | 'awayClubId'> & { date?: string }): { capacity: number; demand: number } {
  const venue = clubFinanceDefinition(worldOf(state), fixture.homeClubId);
  const recorded = state.finance ? financeLedgerTicket(state.finance, fixture.id)?.capacity : undefined;
  // The week's locked capacity applies to games on its Saturday; a midweek game day (step 3.4a) uses that day's capacity.
  const capacity = recorded ?? (fixture.round === state.round && (fixture.date === undefined || fixture.date === state.date) ? state.finance?.roundCapacities?.[fixture.homeClubId] : undefined) ?? getArenaCapacity(state, fixture.homeClubId, fixture.date ?? state.date);
  const own = winShare(state, fixture.homeClubId, fixture.round), opponent = winShare(state, fixture.awayClubId, fixture.round);
  const derby = state.seasonNumber === undefined ? null : governingDerby(state.rivalries, fixture.homeClubId, fixture.awayClubId, state.seasonNumber, fixture.round, worldOf(state));
  // Format 67: the home club's recent press answers move supporter demand by up to 4% (careers with media only).
  const supporters = state.media && state.seasonNumber !== undefined ? pressSupporterPercent(state, fixture.homeClubId, state.seasonNumber, fixture.round, fixture.date ?? dateForRound(fixture.round, state.seasonNumber)) : 0;
  // Format 65 (`facilities-2`): a worn arena draws fewer spectators; older careers keep 100.
  const comfort = arenaComfortPercent(state, fixture.homeClubId, fixture.date ?? state.date);
  const demand = venue.referenceDemand * (own === null ? 1 : .85 + .3 * own) * (opponent === null ? 1 : .9 + .2 * opponent) * (derby ? 1 + RIVALRY_CROWD_PERCENT * derby.intensity / 100 : 1) * (supporters ? 1 + supporters / 100 : 1) * (comfort === 100 ? 1 : comfort / 100);
  return { capacity, demand };
}

export function recommendTicketPrice(state: FinanceContext, fixture: Pick<FinanceFixture, 'id' | 'round' | 'homeClubId' | 'awayClubId'>): number {
  let price = 0, bestRevenue = 0;
  const maximum = maxTicketPriceFor(state, fixture.homeClubId), forecast = gateForecaster(state, fixture);
  for (let candidate = TICKET_PRICE_STEP; candidate <= maximum; candidate += TICKET_PRICE_STEP) {
    const revenue = forecast(candidate).revenue;
    if (revenue > bestRevenue) { price = candidate; bestRevenue = revenue; }
  }
  return price;
}

export function setTicketPlan(state: SeasonState, plan: FinancePlan): SeasonState {
  if (!state.finance.enabledSince) throw new Error('Enable club finances before changing ticket policy.');
  if (!plan || typeof plan !== 'object' || Array.isArray(plan) || Object.keys(plan).length !== 2 || typeof plan.delegated !== 'boolean') throw new Error('Choose a valid ticket policy.');
  validatePrice(plan.price, maxTicketPriceFor(state, state.managedClubId));
  return { ...state, finance: { ...state.finance, plans: { ...state.finance.plans, [state.managedClubId]: { ...plan } } } };
}

/**
 * A club joining the full world (step 3.4d-2) at a season's opening: a delegated default ticket plan and, the first
 * time it joins, the same opening funds as every club at the career's start (`opening-s<season>`). A returning club
 * keeps its earlier ledger.
 */
export function openClubFinances(state: SeasonState, clubIds: readonly string[], firstTime: ReadonlySet<string>): SeasonState {
  if (!clubIds.length) return state;
  const plans = { ...state.finance.plans }, roundPrices = { ...state.finance.roundPrices };
  for (const clubId of clubIds) { plans[clubId] ??= { delegated: true, price: defaultTicketPriceFor(state, clubId) }; roundPrices[clubId] ??= defaultTicketPriceFor(state, clubId); }
  let next: SeasonState = { ...state, finance: { ...state.finance, plans, roundPrices } };
  if (!state.finance.enabledSince) return next;
  for (const clubId of clubIds) if (firstTime.has(clubId)) next = book(next, clubId, 'opening', openingCashFor(state, clubId), `opening-s${state.seasonNumber}`);
  return next;
}

/** Calendar preparation only: UI edits update plans and cannot rewrite these locked prices. */
export function prepareFinanceRound(state: SeasonState): SeasonState {
  if (!state.finance.enabledSince) return state;
  const roundCapacities = state.facilities?.enabledSince ? Object.fromEntries(state.clubs.map(club => [club.id, getArenaCapacity(state, club.id)])) : undefined;
  const prepared = roundCapacities ? { ...state, finance: { ...state.finance, roundCapacities } } : state;
  const roundPrices = Object.fromEntries(state.clubs.map(club => {
    const plan = state.finance.plans[club.id]!;
    validatePrice(plan.price, maxTicketPriceFor(state, club.id));
    const fixture = state.fixtures.find(fixture => fixture.round === state.round && fixture.homeClubId === club.id);
    return [club.id, plan.delegated && fixture ? recommendTicketPrice(prepared, fixture) : plan.price];
  }));
  return { ...prepared, finance: { ...prepared.finance, roundPrices } };
}

export function enableFinance(state: SeasonState): SeasonState {
  if (state.finance.enabledSince) return state;
  if (state.status === 'complete') throw new Error('Start the next season before enabling club finances.');
  let next: SeasonState = { ...state, finance: { ...state.finance, enabledSince: { seasonNumber: state.seasonNumber, round: state.round } } };
  for (const club of state.clubs) next = book(next, club.id, 'opening', openingCashFor(state, club.id), 'opening');
  const rounds = seasonRounds(state);
  for (const club of state.clubs) next = book(next, club.id, 'sponsor', Math.floor(annualSponsorshipFor(state, club.id) * (rounds + 1 - state.round) / rounds), `sponsor-s${state.seasonNumber}`);
  next = bookSeasonFunding(next, (rounds + 1 - state.round) / rounds);
  for (const contract of state.coaching.contracts) next = book(next, contract.clubId, 'coaching', 0 - coachFee(state, contract), `coaching-${contract.id}`, null, { contractId: contract.id, coachId: contract.coachId });
  return prepareFinanceRound(next);
}

/** Post all gates before mandatory operating costs; sporting results never consume finance RNG. */
export function processFinanceRound(state: SeasonState): SeasonState {
  if (!state.finance.enabledSince) return state;
  const fixtures = state.fixtures.filter(fixture => fixture.round === state.round).sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  if (fixtures.some(fixture => !fixture.result)) throw new Error('Commit every game in the matchday before recording finances.');
  requireCalendarWeek(state, true);
  let next = state;
  for (const fixture of fixtures) {
    // Step 3.5b: a background side's home European game earns the full world nothing.
    if (!Object.hasOwn(state.finance.roundPrices, fixture.homeClubId)) continue;
    // Format 85: a game at one venue earns neither club a gate (the organiser keeps it).
    if (playsAtNeutralVenue(state, fixture)) continue;
    const gate = forecastGate(state, fixture, state.finance.roundPrices[fixture.homeClubId]!);
    next = book(next, fixture.homeClubId, 'tickets', gate.revenue, `tickets-${fixture.id}`, { fixtureId: fixture.id, price: gate.price, attendance: gate.attendance, ...(state.facilities?.enabledSince ? { capacity: gate.capacity } : {}) });
  }
  for (const club of state.clubs) next = book(next, club.id, 'operations', -roundOperatingCostFor(state, club.id), `operations-s${state.seasonNumber}-r${state.round}`);
  if (state.facilities?.enabledSince) for (const club of state.clubs) {
    const { total, ...facilityUpkeep } = getFacilityUpkeepBreakdown(state, club.id);
    if (total) next = append(next, { clubId: club.id, kind: 'facility-upkeep', amount: -total, sourceId: `facility-upkeep-s${state.seasonNumber}-r${state.round}`, seasonNumber: state.seasonNumber, round: state.round, ticket: null, coach: null, payroll: null, facilityUpkeep });
  }
  // Format 71: scheduled loan and lease payments are mandatory; whatever cash cannot cover becomes unpaid costs.
  for (const { debt, payment } of dueDebtPayments(state)) next = recordDebtEntry(next, { clubId: debt.clubId, kind: debt.kind === 'lease' ? 'lease' : 'loan-repayment', amount: -payment.amount, debt: { debtId: debt.id, payment: payment.number } });
  return next;
}

/**
 * Format 71: one loan or lease entry on the current boundary: the loan received (or the lease agreed, at no cost), a
 * scheduled payment, or an early settlement. Its source identity follows from the debt and the payment.
 */
export function recordDebtEntry(state: SeasonState, entry: Pick<FinanceEntry, 'clubId' | 'amount'> & { kind: 'loan' | 'loan-repayment' | 'lease'; debt: NonNullable<FinanceEntry['debt']> }): SeasonState {
  if (!state.finance.enabledSince) throw new Error('Enable club finances before recording loans and leases.');
  return append(state, { clubId: entry.clubId, kind: entry.kind, amount: entry.amount, sourceId: debtSourceId(entry.debt.debtId, entry.debt.payment), seasonNumber: state.seasonNumber, round: state.round, ticket: null, coach: null, payroll: null, debt: { ...entry.debt } });
}

/**
 * New-year sponsorship is received before selected staff renewals are considered. Under negotiated agreements
 * only covered clubs receive their first installment; an unsold sponsorship slot earns nothing.
 */
export function startFinanceSeason(state: SeasonState): SeasonState {
  if (!state.finance.enabledSince) return state;
  if (state.status !== 'active' || state.round !== 1) throw new Error('New-season funding requires the opening matchday.');
  let next = state;
  if (commercialGovernsSeason(state.commercial, state.seasonNumber)) {
    for (const clubId of openingSponsorshipClubs(state.commercial, state.clubs, state.seasonNumber)) {
      const agreement = agreementFor(state.commercial, clubId, state.seasonNumber)!;
      next = append(next, { clubId, kind: 'sponsor', amount: sponsorshipInstallment(agreement, 1), sourceId: sponsorshipSourceId(agreement, state.seasonNumber, 1), seasonNumber: state.seasonNumber, round: state.round, ticket: null, coach: null, payroll: null, sponsorship: { agreementId: agreement.id, sponsorId: agreement.sponsorId, installment: 1 } });
    }
  } else for (const club of state.clubs) next = book(next, club.id, 'sponsor', annualSponsorshipFor(state, club.id), `sponsor-s${state.seasonNumber}`);
  return prepareFinanceRound(bookSeasonFunding(next, 1));
}

/**
 * Format 62: each club's season funding (league and European distributions, public money and the owner's
 * contribution), booked after the sponsors at the season opening; `share` pro-rates a mid-season activation. Clubs
 * without funding (every world without an economy) book nothing.
 */
function bookSeasonFunding(state: SeasonState, share: number): SeasonState {
  let next = state;
  for (const club of state.clubs) {
    const funding = annualFundingFor(state, club.id);
    if (funding > 0) next = book(next, club.id, 'sponsor', share === 1 ? funding : seasonFundingShare(funding, seasonRounds(state), state.round), fundingSourceId(state.seasonNumber));
  }
  return next;
}

/** The season funding for an activation at `round` (whole season at round one), as for the fixed sponsorship. */
export const seasonFundingShare = (funding: number, rounds: number, round: number): number => Math.floor(funding * (rounds + 1 - round) / rounds);

/** Format 64: books a naming-rights installment, a sponsor's exit payment or the club's termination fee on the current boundary. */
export function recordCommercialEntry(state: SeasonState, entry: Pick<FinanceEntry, 'clubId' | 'amount' | 'sourceId'> & ({ kind: 'naming-rights'; namingRights: NonNullable<FinanceEntry['namingRights']> } | { kind: 'sponsor-exit'; sponsorExit: NonNullable<FinanceEntry['sponsorExit']> })): SeasonState {
  if (!state.finance.enabledSince) throw new Error('Enable club finances before recording sponsorship payments.');
  return append(state, { ...entry, seasonNumber: state.seasonNumber, round: state.round, ticket: null, coach: null, payroll: null });
}

/** Books a later agreement payment (matchday-six installment or earned bonus) exactly once, on its due boundary. */
export function recordSponsorshipPayment(state: SeasonState, payment: DueSponsorshipPayment): SeasonState {
  if (!state.finance.enabledSince || !commercialGovernsSeason(state.commercial, payment.seasonNumber) || payment.seasonNumber !== state.seasonNumber || payment.round !== state.round || payment.sponsorship.installment === 1) throw new Error('Record only a sponsorship payment due on the current matchday.');
  return append(state, { clubId: payment.clubId, kind: 'sponsor', amount: payment.amount, sourceId: payment.sourceId, seasonNumber: payment.seasonNumber, round: payment.round, ticket: null, coach: null, payroll: null, sponsorship: { ...payment.sponsorship } });
}
