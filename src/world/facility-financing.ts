import type { FacilityDebt, FacilityType } from '../domain/facilities';
import type { SeasonState } from '../domain/season';
import { seasonRounds } from './career-world';
import { scaledMoney } from './economy';
import { BANK_LOAN_RULES, bankLoanLimit, borrowingLimit, clubDebts, debtLimit, debtPosition, debtSchedule, FACILITY_FINANCING_RULES, hasClubDebts, isLoanDebt, leaseTerms, loanRateBasisPoints, loanTerms, outstandingDebt, paymentRounds, usesBankLoans, usesFacilityFinancing, type DebtPayment, type DebtPosition } from './facility-debt';
import { facilityAutomationBuffer, FACILITY_FUNDS_REASON, FACILITY_REPAIR_FUNDS_REASON, getActiveFacilityProject, quoteFacilityRepair, quoteFacilityUpgrade } from './facilities-policy';
import { getFinanceBalance } from './finance';
import { getSpendableCash } from './payroll-policy';

const RULES = FACILITY_FINANCING_RULES;
const sum = (payments: readonly DebtPayment[]) => payments.reduce((total, item) => total + item.amount, 0);

/** Format 71: the terms of a bank loan for one upgrade or repair, as the bank and the club's position give them. */
export interface FacilityLoanQuote {
  clubId: string;
  facilityType: FacilityType;
  project: 'upgrade' | 'repair';
  cost: number;
  /** Remaining budget before borrowing. */
  available: number;
  principal: number;
  /** The most the club may borrow for this project: the cost, within its borrowing limit. */
  maxPrincipal: number;
  minimumPrincipal: number;
  /** The part of the cost paid from Remaining budget now. */
  downPayment: number;
  rateBasisPoints: number;
  seasons: number;
  payments: number;
  payment: number;
  total: number;
  interest: number;
  schedule: readonly DebtPayment[];
  /** This season's repayments, reserved in Remaining budget from the start. */
  dueThisSeason: number;
  limit: number;
  existingDebt: number;
  debtAfter: number;
  canBorrow: boolean;
  reason: string | null;
}

/**
 * A loan pays for an upgrade or repair the club would otherwise pay upfront. The principal is received, the project
 * is paid in full and the loan is repaid in equal payments, two a season, from the first payment week after today.
 * The club must pay any part not borrowed now and keep this season's repayments in its Remaining budget.
 */
export function quoteFacilityLoan(state: SeasonState, type: FacilityType, clubId = state.managedClubId, project: 'upgrade' | 'repair' = 'upgrade', seasons = 3, principal?: number): FacilityLoanQuote {
  const base = project === 'repair' ? quoteFacilityRepair(state, type, clubId) : quoteFacilityUpgrade(state, type, clubId);
  const fundsReason = project === 'repair' ? FACILITY_REPAIR_FUNDS_REASON : FACILITY_FUNDS_REASON;
  const cost = base.cost, available = state.finance.enabledSince ? getSpendableCash(state, clubId) : 0;
  const limit = borrowingLimit(state, clubId), existingDebt = outstandingDebt(state, clubId);
  const maxPrincipal = Math.max(0, Math.floor(Math.min(cost, limit - existingDebt) / 100) * 100), minimumPrincipal = scaledMoney(state, clubId, RULES.minimumPrincipal);
  const amount = principal ?? maxPrincipal, validTerm = RULES.termSeasons.includes(seasons);
  const validAmount = Number.isSafeInteger(amount) && amount % 100 === 0 && amount >= minimumPrincipal && amount <= maxPrincipal;
  const rateBasisPoints = loanRateBasisPoints(existingDebt + Math.max(0, amount), limit, available < facilityAutomationBuffer(state, clubId));
  const rounds = seasonRounds(state);
  const terms = validTerm && validAmount ? loanTerms(amount, rateBasisPoints, seasons, state.seasonNumber, state.round, rounds) : { payment: 0, total: 0, payments: validTerm ? seasons * paymentRounds(rounds).length : 0 };
  const schedule = validTerm && validAmount ? debtSchedule({ kind: 'loan', principal: amount, rateBasisPoints, seasons, payment: terms.payment, total: terms.total, seasonNumber: state.seasonNumber, round: state.round }, rounds) : [];
  const dueThisSeason = sum(schedule.filter(item => item.seasonNumber === state.seasonNumber));
  let reason: string | null = null;
  if (!usesFacilityFinancing(state.facilities)) reason = 'Bank loans belong to careers started with facility financing.';
  else if (!validTerm) reason = 'Choose a loan term of 2 to 5 seasons.';
  else if (base.reason && base.reason !== fundsReason) reason = base.reason;
  else if (maxPrincipal < minimumPrincipal) reason = 'The club has reached its borrowing limit.';
  else if (!validAmount) reason = 'Choose a whole-euro loan amount within the project cost and the borrowing limit.';
  else if (available < cost - amount + dueThisSeason) reason = 'Remaining budget must pay the rest of the cost now and cover this season\'s repayments.';
  return { clubId, facilityType: type, project, cost, available, principal: amount, maxPrincipal, minimumPrincipal, downPayment: Math.max(0, cost - amount), rateBasisPoints, seasons, payments: terms.payments, payment: terms.payment, total: terms.total, interest: Math.max(0, terms.total - amount), schedule, dueThisSeason, limit, existingDebt, debtAfter: existingDebt + Math.max(0, amount), canBorrow: reason === null, reason };
}

/** Format 74 (`bank-1`): the terms of a bank loan for anything, as the bank and the club's position give them. */
export interface BankLoanQuote {
  clubId: string;
  /** Remaining budget before borrowing; the whole loan is added to it. */
  available: number;
  principal: number;
  /** The most the club may borrow now: its limit less what it already owes. */
  maxPrincipal: number;
  minimumPrincipal: number;
  rateBasisPoints: number;
  seasons: number;
  payments: number;
  payment: number;
  total: number;
  interest: number;
  schedule: readonly DebtPayment[];
  limit: number;
  existingDebt: number;
  debtAfter: number;
  /** Remaining budget straight after borrowing (repayments start next season). */
  remainingBudgetAfter: number;
  canBorrow: boolean;
  reason: string | null;
}

/**
 * Format 74: a bank loan adds its whole amount to Remaining budget at once, to spend on anything. It is repaid with
 * interest in equal payments, two a season, from the first payment week of next season. The club may owe at most its
 * limit (`bankLoanLimit`) in all; the rate follows the facility loan rate (4-7%).
 */
export function quoteBankLoan(state: SeasonState, clubId = state.managedClubId, seasons = 2, principal?: number): BankLoanQuote {
  const available = state.finance.enabledSince ? getSpendableCash(state, clubId) : 0;
  const limit = bankLoanLimit(state, clubId), existingDebt = outstandingDebt(state, clubId);
  const maxPrincipal = Math.max(0, Math.floor((limit - existingDebt) / 100) * 100), minimumPrincipal = scaledMoney(state, clubId, BANK_LOAN_RULES.minimumPrincipal);
  const amount = principal ?? maxPrincipal, validTerm = BANK_LOAN_RULES.termSeasons.includes(seasons);
  const validAmount = Number.isSafeInteger(amount) && amount % 100 === 0 && amount >= minimumPrincipal && amount <= maxPrincipal;
  const rateBasisPoints = loanRateBasisPoints(existingDebt + Math.max(0, amount), limit, available < facilityAutomationBuffer(state, clubId));
  const rounds = seasonRounds(state);
  const terms = validTerm && validAmount ? loanTerms(amount, rateBasisPoints, seasons, state.seasonNumber, state.round, rounds, 'bank') : { payment: 0, total: 0, payments: validTerm ? seasons * paymentRounds(rounds).length : 0 };
  const schedule = validTerm && validAmount ? debtSchedule({ kind: 'bank', principal: amount, rateBasisPoints, seasons, payment: terms.payment, total: terms.total, seasonNumber: state.seasonNumber, round: state.round }, rounds) : [];
  let reason: string | null = null;
  if (!usesBankLoans(state.facilities)) reason = 'The simple bank loan belongs to careers started with the current facilities model.';
  else if (!state.facilities.enabledSince || !state.finance.enabledSince) reason = 'Enable club finances and facilities before borrowing.';
  else if (!state.clubs.some(club => club.id === clubId)) reason = 'Choose a club in this career.';
  else if (!validTerm) reason = `Choose a term of ${BANK_LOAN_RULES.termSeasons.join(', ')} seasons.`;
  else if (getFinanceBalance(state.finance, clubId).unpaid > 0) reason = 'Settle unpaid club costs before borrowing more.';
  else if (maxPrincipal < minimumPrincipal) reason = 'The club has reached its borrowing limit.';
  else if (!validAmount) reason = 'Choose a whole-euro amount within the borrowing limit.';
  return { clubId, available, principal: amount, maxPrincipal, minimumPrincipal, rateBasisPoints, seasons, payments: terms.payments, payment: terms.payment, total: terms.total, interest: Math.max(0, terms.total - amount), schedule, limit, existingDebt, debtAfter: existingDebt + Math.max(0, amount), remainingBudgetAfter: available + (reason === null ? amount : 0), canBorrow: reason === null, reason };
}

/** Format 71: the terms of leasing the next arena or training level. */
export interface FacilityLeaseQuote {
  clubId: string;
  facilityType: FacilityType;
  fromLevel: number;
  toLevel: number;
  /** The upgrade's purchase price. */
  price: number;
  seasons: number;
  payments: number;
  payment: number;
  total: number;
  /** What the lease costs above the purchase price. */
  premium: number;
  schedule: readonly DebtPayment[];
  dueThisSeason: number;
  available: number;
  limit: number;
  existingDebt: number;
  debtAfter: number;
  canLease: boolean;
  reason: string | null;
}

/**
 * A lease installs the next level for the next matchday with nothing paid now. Its payments, two a season, total the
 * purchase price plus a premium per season; the level is the club's once they are all paid. Ending it early hands the
 * level back and costs a share of the payments still to come.
 */
export function quoteFacilityLease(state: SeasonState, type: FacilityType, clubId = state.managedClubId, seasons = 3): FacilityLeaseQuote {
  const upgrade = quoteFacilityUpgrade(state, type, clubId), rounds = seasonRounds(state), validTerm = RULES.termSeasons.includes(seasons);
  const price = upgrade.cost, terms = leaseTerms(price, validTerm ? seasons : 2, rounds);
  const schedule = validTerm && price > 0 ? debtSchedule({ kind: 'lease', principal: price, rateBasisPoints: 0, seasons, payment: terms.payment, total: terms.total, seasonNumber: state.seasonNumber, round: state.round }, rounds) : [];
  const available = state.finance.enabledSince ? getSpendableCash(state, clubId) : 0;
  const limit = borrowingLimit(state, clubId), existingDebt = outstandingDebt(state, clubId), dueThisSeason = sum(schedule.filter(item => item.seasonNumber === state.seasonNumber));
  let reason: string | null = null;
  if (!usesFacilityFinancing(state.facilities)) reason = 'Leases belong to careers started with facility financing.';
  else if (!RULES.leaseTypes.includes(type)) reason = 'Only arena seating and training equipment can be leased.';
  else if (!validTerm) reason = 'Choose a lease term of 2 to 5 seasons.';
  else if (upgrade.reason && upgrade.reason !== FACILITY_FUNDS_REASON) reason = upgrade.reason;
  else if (existingDebt + terms.total > limit) reason = 'The lease would take the club beyond its borrowing limit.';
  else if (available < dueThisSeason) reason = 'Remaining budget must cover this season\'s lease payments.';
  return { clubId, facilityType: type, fromLevel: upgrade.fromLevel, toLevel: upgrade.toLevel, price, seasons, payments: validTerm ? terms.payments : 0, payment: validTerm ? terms.payment : 0, total: validTerm ? terms.total : 0, premium: validTerm ? terms.total - price : 0, schedule, dueThisSeason, available, limit, existingDebt, debtAfter: existingDebt + (validTerm ? terms.total : 0), canLease: reason === null, reason };
}

/** Format 71: repaying a loan early (remaining principal plus the fee) or ending a lease early (the penalty). */
export interface DebtSettlementQuote {
  debt: FacilityDebt;
  position: DebtPosition;
  /** Loan: remaining principal. Lease: payments still to come. */
  outstanding: number;
  /** Loan: the early repayment fee. Lease: the penalty. */
  charge: number;
  amount: number;
  /** Remaining budget plus this debt's own payments reserved this season, which settling releases. */
  available: number;
  canSettle: boolean;
  reason: string | null;
}

export function quoteDebtSettlement(state: SeasonState, debtId: string): DebtSettlementQuote {
  const debt = state.facilities.debts?.find(item => item.id === debtId);
  if (!debt || !clubDebts(state, debt.clubId).includes(debt)) throw new Error('Choose a loan or lease of this career.');
  const position = debtPosition(state, debt), loan = isLoanDebt(debt);
  const charge = Math.round(position.outstanding * (loan ? RULES.earlyRepaymentFeePercent : RULES.leaseEndPenaltyPercent) / 100);
  const amount = loan ? position.outstanding + charge : charge;
  const available = state.finance.enabledSince ? getSpendableCash(state, debt.clubId) + position.dueThisSeason : 0;
  const project = debt.projectId === undefined ? undefined : state.facilities.projects.find(item => item.id === debt.projectId), active = getActiveFacilityProject(state, debt.clubId);
  let reason: string | null = null;
  if (!hasClubDebts(state.facilities)) reason = 'Loans and leases belong to careers started with facility financing.';
  else if (position.settled) reason = loan ? 'This loan has already been repaid.' : 'This lease has already ended.';
  else if (position.outstanding === 0) reason = loan ? 'This loan is fully repaid.' : 'This lease is fully paid; the level is the club\'s.';
  else if (state.status !== 'active') reason = loan ? 'Repay a loan early during the season.' : 'End a lease during the season.';
  else if (!loan && (!project || project.completedOn === null)) reason = 'The leased level is still being installed.';
  else if (!loan && active?.type === debt.facilityType) reason = 'Finish or cancel the current project on this facility first.';
  else if (getFinanceBalance(state.finance, debt.clubId).unpaid > 0) reason = 'Settle unpaid club costs first.';
  else if (available < amount) reason = loan ? 'Remaining budget does not cover the early repayment.' : 'Remaining budget does not cover the penalty for ending the lease.';
  return { debt, position, outstanding: position.outstanding, charge, amount, available, canSettle: reason === null, reason };
}

/** Format 71: a club's loans and leases for the Club page. */
export interface ClubDebts {
  enabled: boolean;
  limit: number;
  outstanding: number;
  ratioPercent: number;
  dueThisSeason: number;
  rows: { debt: FacilityDebt; position: DebtPosition; settlement: DebtSettlementQuote }[];
}

export function getClubDebts(state: SeasonState, clubId = state.managedClubId): ClubDebts {
  // Format 74: the bank limit with the simple bank loan.
  const limit = debtLimit(state, clubId);
  const rows = clubDebts(state, clubId).map(debt => ({ debt, position: debtPosition(state, debt), settlement: quoteDebtSettlement(state, debt.id) }));
  const outstanding = rows.reduce((total, row) => total + row.position.outstanding, 0);
  return { enabled: hasClubDebts(state.facilities), limit, outstanding, ratioPercent: Math.round(outstanding * 100 / limit), dueThisSeason: rows.reduce((total, row) => total + row.position.dueThisSeason, 0), rows };
}
