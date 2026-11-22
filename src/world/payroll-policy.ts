import type { FinanceEntry } from '../domain/finance';
import type { PlayerWageAgreement } from '../domain/payroll';
import type { SeasonState } from '../domain/season';
import { staffWageReserve } from './staff-contracts';
import type { WorldContext } from '../domain/world';
import { seasonRounds } from './career-world';
import { getReservedTransferFees } from './market-policy';
import { getTransferObligationReserve } from './transfer-payments';
import { getReservedInSeasonFees, getReservedInSeasonWages } from './recruitment-policy';
import { ledgerClubNet, payrollLedgerReader, type PayrollLedgerReader } from './finance-ledger-index';
import { debtReserve } from './facility-debt';

/** Installments in the built-in league's season; every season pays one installment per matchday (`seasonRounds`). */
export const PAYROLL_INSTALLMENTS = 10;
export const PREPAYMENT_DISCOUNT_PERCENT = 5;
export const PAYROLL_AUTOMATION_CUSHION = 10_000_000;

/** Prefix differences allocate every cent exactly, even for a wage not divisible by the number of installments. */
export function payrollInstallment(seasonWage: number, round: number, installments: number): number {
  if (!Number.isSafeInteger(seasonWage) || seasonWage < 0 || !Number.isInteger(installments) || installments < 1 || !Number.isInteger(round) || round < 1 || round > installments) throw new Error('Choose a valid wage and payroll matchday.');
  const base = Math.floor(seasonWage / installments), remainder = seasonWage % installments;
  return base + Math.floor(round * remainder / installments) - Math.floor((round - 1) * remainder / installments);
}

export function isAgreementPrepaid(agreementId: string, ledger: readonly FinanceEntry[]): boolean {
  return payrollLedgerReader({ ledger })(agreementId).prepaid;
}

/** Remaining gross obligations exclude both posted installments and prepaid future installments. */
export function agreementCommitted(agreement: PlayerWageAgreement, ledger: readonly FinanceEntry[], throughRound: number, installments: number): number {
  return agreementCommittedFromLedger(agreement, throughRound, installments, payrollLedgerReader({ ledger }));
}

/** The same obligation calculation when a caller already owns a reader for this exact ledger boundary. */
export function agreementCommittedFromLedger(agreement: PlayerWageAgreement, throughRound: number, installments: number, readPayroll: PayrollLedgerReader): number {
  const gross = installmentsBetween(agreement.seasonWage, agreement.startsRound, Math.max(0, throughRound - agreement.startsRound + 1), installments);
  const recorded = readPayroll(agreement.id).gross;
  return Math.max(0, gross - recorded);
}

/**
 * The sum of `count` consecutive installments from `first` (step 3.7: in closed form, since the installments' prefix
 * differences telescope; it was summed round by round for every agreement many times a week). The first and last rounds
 * are checked like every round, so invalid terms fail exactly as before; whole cents keep the sum exact.
 */
function installmentsBetween(seasonWage: number, first: number, rounds: number, installments: number): number {
  const count = Math.trunc(Math.min(rounds, Number.MAX_SAFE_INTEGER));
  if (!(count > 0)) return 0;
  const last = first + count - 1;
  payrollInstallment(seasonWage, first, installments); payrollInstallment(seasonWage, last, installments);
  const base = Math.floor(seasonWage / installments), remainder = seasonWage % installments;
  return count * base + Math.floor(last * remainder / installments) - Math.floor((first - 1) * remainder / installments);
}

/** Original wage terms and prepaid charges remain intact; a sale ends unposted liability. */
// Step 3.7: indexes built once per immutable array (state arrays are replaced, never edited), because large worlds ask
// for every club's reserve many times a week and each ask used to scan the whole career.
type EmploymentTransfer = SeasonState['employment']['transfers'][number];
const transfersByPlayerCache = new WeakMap<readonly EmploymentTransfer[], Map<string, EmploymentTransfer[]>>();
function transfersOfPlayer(transfers: readonly EmploymentTransfer[], playerId: string): readonly EmploymentTransfer[] {
  let index = transfersByPlayerCache.get(transfers);
  if (!index) {
    index = new Map();
    for (const transfer of transfers) { const list = index.get(transfer.playerId); if (list) list.push(transfer); else index.set(transfer.playerId, [transfer]); }
    transfersByPlayerCache.set(transfers, index);
  }
  return index.get(playerId) ?? [];
}
const agreementsByClubSeasonCache = new WeakMap<readonly PlayerWageAgreement[], Map<string, PlayerWageAgreement[]>>();
function clubSeasonAgreements(agreements: readonly PlayerWageAgreement[], clubId: string, seasonNumber: number): readonly PlayerWageAgreement[] {
  let index = agreementsByClubSeasonCache.get(agreements);
  if (!index) {
    index = new Map();
    for (const agreement of agreements) { const key = `${agreement.clubId}\u0000${agreement.seasonNumber}`, list = index.get(key); if (list) list.push(agreement); else index.set(key, [agreement]); }
    agreementsByClubSeasonCache.set(agreements, index);
  }
  return index.get(`${clubId}\u0000${seasonNumber}`) ?? [];
}

export function agreementThroughRound(state: Partial<Pick<SeasonState, 'employment'>> & WorldContext, agreement: PlayerWageAgreement): number {
  const departure = state.employment ? transfersOfPlayer(state.employment.transfers, agreement.playerId).find(transfer => transfer.fromClubId === agreement.clubId && transfer.startsSeason === agreement.seasonNumber && transfer.startsRound > agreement.startsRound) : undefined;
  return departure ? departure.startsRound - 1 : seasonRounds(state);
}

export function getPayrollReserve(state: Pick<SeasonState, 'payroll' | 'finance' | 'seasonNumber'> & Partial<Pick<SeasonState, 'round' | 'employment'>> & WorldContext, clubId: string): number {
  if (!state.payroll.enabledSince) return 0;
  const rounds = seasonRounds(state);
  const readPayroll = payrollLedgerReader(state.finance);
  return clubSeasonAgreements(state.payroll.agreements, clubId, state.seasonNumber).filter(agreement => agreement.startsRound <= (state.round ?? rounds)).reduce((sum, agreement) => sum + agreementCommittedFromLedger(agreement, agreementThroughRound(state, agreement), rounds, readPayroll), 0);
}

/**
 * Reconciled net wealth after every reservation; negative when commitments already exceed cash. Format 71: this
 * season's loan and lease payments still to come are reserved too (none in older careers).
 */
export function getSpendablePosition(state: Pick<SeasonState, 'payroll' | 'finance' | 'seasonNumber'> & Partial<Pick<SeasonState, 'market' | 'employment' | 'recruitment' | 'round' | 'facilities'>> & WorldContext, clubId: string, excludeOfferId?: string, excludeTransferId?: string, excludeInSeasonOfferId?: string): number {
  const net = ledgerClubNet(state.finance, clubId);
  // Format 76 (`coaching-4`): the staff salaries still to pay this season are held back like player wages.
  return net - getPayrollReserve(state, clubId) - staffWageReserve(state as Parameters<typeof staffWageReserve>[0], clubId) - getReservedTransferFees(state, clubId, excludeOfferId) - getTransferObligationReserve(state, clubId, excludeTransferId) - getReservedInSeasonWages(state, clubId, excludeInSeasonOfferId) - getReservedInSeasonFees(state, clubId, excludeInSeasonOfferId) - debtReserve(state, clubId);
}

/** Reconciled net wealth yields cash when positive and unpaid obligations when negative. */
export function getSpendableCash(state: Pick<SeasonState, 'payroll' | 'finance' | 'seasonNumber'> & Partial<Pick<SeasonState, 'market' | 'employment' | 'recruitment' | 'round' | 'facilities'>>, clubId: string, excludeOfferId?: string, excludeTransferId?: string, excludeInSeasonOfferId?: string): number {
  return Math.max(0, getSpendablePosition(state, clubId, excludeOfferId, excludeTransferId, excludeInSeasonOfferId));
}
