import type { FinanceEntry } from '../domain/finance';
import type { PlayerWageAgreement } from '../domain/payroll';
import type { SeasonState } from '../domain/season';
import { getReservedTransferFees } from './market-policy';
import { getTransferObligationReserve } from './transfer-payments';
import { getReservedInSeasonFees, getReservedInSeasonWages } from './recruitment-policy';

export const PAYROLL_INSTALLMENTS = 10;
export const PREPAYMENT_DISCOUNT_PERCENT = 5;
export const PAYROLL_AUTOMATION_CUSHION = 10_000_000;

/** Prefix differences allocate every cent exactly, even for a wage not divisible by ten. */
export function payrollInstallment(seasonWage: number, round: number): number {
  if (!Number.isSafeInteger(seasonWage) || seasonWage < 0 || !Number.isInteger(round) || round < 1 || round > PAYROLL_INSTALLMENTS) throw new Error('Choose a valid wage and payroll matchday.');
  const base = Math.floor(seasonWage / PAYROLL_INSTALLMENTS), remainder = seasonWage % PAYROLL_INSTALLMENTS;
  return base + Math.floor(round * remainder / PAYROLL_INSTALLMENTS) - Math.floor((round - 1) * remainder / PAYROLL_INSTALLMENTS);
}

export function isAgreementPrepaid(agreementId: string, ledger: readonly FinanceEntry[]): boolean {
  return ledger.some(entry => entry.payroll?.type === 'prepayment' && entry.payroll.items.some(item => item.agreementId === agreementId));
}

/** Remaining gross obligations exclude both posted installments and prepaid future installments. */
export function agreementCommitted(agreement: PlayerWageAgreement, ledger: readonly FinanceEntry[], throughRound = PAYROLL_INSTALLMENTS): number {
  const gross = Array.from({ length: Math.max(0, throughRound - agreement.startsRound + 1) }, (_, index) => payrollInstallment(agreement.seasonWage, agreement.startsRound + index)).reduce((sum, amount) => sum + amount, 0);
  const recorded = ledger.reduce((sum, entry) => sum + (entry.payroll?.items.reduce((amount, item) => amount + (item.agreementId === agreement.id ? item.gross : 0), 0) ?? 0), 0);
  return Math.max(0, gross - recorded);
}

/** Original wage terms and prepaid charges remain intact; a sale ends unposted liability. */
export function agreementThroughRound(state: Partial<Pick<SeasonState, 'employment'>>, agreement: PlayerWageAgreement): number {
  const departure = state.employment?.transfers.find(transfer => transfer.playerId === agreement.playerId && transfer.fromClubId === agreement.clubId && transfer.startsSeason === agreement.seasonNumber && transfer.startsRound > agreement.startsRound);
  return departure ? departure.startsRound - 1 : PAYROLL_INSTALLMENTS;
}

export function getPayrollReserve(state: Pick<SeasonState, 'payroll' | 'finance' | 'seasonNumber'> & Partial<Pick<SeasonState, 'round' | 'employment'>>, clubId: string): number {
  if (!state.payroll.enabledSince) return 0;
  return state.payroll.agreements.filter(agreement => agreement.clubId === clubId && agreement.seasonNumber === state.seasonNumber && agreement.startsRound <= (state.round ?? 10)).reduce((sum, agreement) => sum + agreementCommitted(agreement, state.finance.ledger, agreementThroughRound(state, agreement)), 0);
}

/** Reconciled net wealth after every reservation; negative when commitments already exceed cash. */
export function getSpendablePosition(state: Pick<SeasonState, 'payroll' | 'finance' | 'seasonNumber'> & Partial<Pick<SeasonState, 'market' | 'employment' | 'recruitment' | 'round'>>, clubId: string, excludeOfferId?: string, excludeTransferId?: string, excludeInSeasonOfferId?: string): number {
  const net = state.finance.ledger.filter(entry => entry.clubId === clubId).reduce((sum, entry) => sum + entry.amount, 0);
  return net - getPayrollReserve(state, clubId) - getReservedTransferFees(state, clubId, excludeOfferId) - getTransferObligationReserve(state, clubId, excludeTransferId) - getReservedInSeasonWages(state, clubId, excludeInSeasonOfferId) - getReservedInSeasonFees(state, clubId, excludeInSeasonOfferId);
}

/** Reconciled net wealth yields cash when positive and unpaid obligations when negative. */
export function getSpendableCash(state: Pick<SeasonState, 'payroll' | 'finance' | 'seasonNumber'> & Partial<Pick<SeasonState, 'market' | 'employment' | 'recruitment' | 'round'>>, clubId: string, excludeOfferId?: string, excludeTransferId?: string, excludeInSeasonOfferId?: string): number {
  return Math.max(0, getSpendablePosition(state, clubId, excludeOfferId, excludeTransferId, excludeInSeasonOfferId));
}
