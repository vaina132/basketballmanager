import type { EmploymentTransfer } from '../domain/employment';
import type { SeasonState } from '../domain/season';
import type { TransferInstallment, TransferPayment, TransferPaymentPlan, TransferPaymentSummary } from '../domain/transfer-payments';
import { getFinanceBalance, recordTransferPayment } from './finance';
import { getPayrollReserve } from './payroll-policy';
import { dateForRound } from './season';

export const TRANSFER_PAYMENT_PLANS: readonly TransferPaymentPlan[] = ['upfront', 'two-payments', 'three-payments'];

export function paymentPlanLabel(plan: TransferPaymentPlan): string {
  return { upfront: 'Pay in full', 'two-payments': '2 payments', 'three-payments': '3 payments' }[plan];
}

/** Frozen dates use the real development calendar; the final portion owns rounding cents. */
export function getTransferPaymentSchedule(fee: number, plan: TransferPaymentPlan, completedOn: string, startsSeason: number): TransferInstallment[] {
  if (!Number.isSafeInteger(fee) || fee < 4 || !TRANSFER_PAYMENT_PLANS.includes(plan)) throw new Error('Choose a valid transfer fee and payment plan.');
  if (plan === 'upfront') return [{ dueOn: completedOn, amount: fee }];
  const first = Math.floor(fee / 2);
  if (plan === 'two-payments') return [{ dueOn: completedOn, amount: first }, { dueOn: dateForRound(1, startsSeason), amount: fee - first }];
  const second = Math.floor(fee / 4);
  return [{ dueOn: completedOn, amount: first }, { dueOn: dateForRound(1, startsSeason), amount: second }, { dueOn: dateForRound(6, startsSeason), amount: fee - first - second }];
}

/** Pre-format-16 records were paid fully on completion. */
export function getTransferInstallments(transfer: EmploymentTransfer): TransferInstallment[] {
  return transfer.installments ?? [{ dueOn: transfer.completedOn, amount: transfer.fee }];
}

export function getTransferPayments(transfer: EmploymentTransfer): TransferPayment[] {
  return transfer.payments ?? [{ id: transfer.id, installmentIndex: 0, paidOn: transfer.completedOn, seasonNumber: transfer.seasonNumber, round: 10, amount: transfer.fee }];
}

export function getTransferInstallmentRemaining(transfer: EmploymentTransfer, installmentIndex: number): number {
  return Math.max(0, (getTransferInstallments(transfer)[installmentIndex]?.amount ?? 0) - getTransferPayments(transfer).filter(payment => payment.installmentIndex === installmentIndex).reduce((sum, payment) => sum + payment.amount, 0));
}

export function getTransferObligationReserve(state: Partial<Pick<SeasonState, 'employment'>>, clubId: string, excludeTransferId?: string): number {
  return (state.employment?.transfers ?? []).filter(transfer => transfer.toClubId === clubId && transfer.id !== excludeTransferId).reduce((total, transfer) => total + getTransferInstallments(transfer).reduce((sum, _installment, index) => sum + getTransferInstallmentRemaining(transfer, index), 0), 0);
}

export function getTransferPaymentSummary(state: Pick<SeasonState, 'date'> & Partial<Pick<SeasonState, 'employment'>>, clubId: string): TransferPaymentSummary {
  const summary: TransferPaymentSummary = { outgoingRemaining: 0, futureDue: 0, overdue: 0, nextDueOn: null, incomingRemaining: 0, incomingOverdue: 0 };
  for (const transfer of state.employment?.transfers ?? []) {
    if (transfer.toClubId !== clubId && transfer.fromClubId !== clubId) continue;
    for (const [index, installment] of getTransferInstallments(transfer).entries()) {
      const remaining = getTransferInstallmentRemaining(transfer, index);
      if (!remaining) continue;
      if (transfer.toClubId === clubId) {
        summary.outgoingRemaining += remaining;
        if (installment.dueOn <= state.date) summary.overdue += remaining;
        else summary.futureDue += remaining;
        if (summary.nextDueOn === null || installment.dueOn < summary.nextDueOn) summary.nextDueOn = installment.dueOn;
      } else {
        summary.incomingRemaining += remaining;
        if (installment.dueOn <= state.date) summary.incomingOverdue += remaining;
      }
    }
  }
  return summary;
}

/** Append one actual receipt together with its balanced ledger entries. */
export function payTransferInstallment(state: SeasonState, transferId: string, installmentIndex: number, amount: number): SeasonState {
  const transfer = state.employment.transfers.find(item => item.id === transferId);
  if (!transfer?.payments || !transfer.installments[installmentIndex]) throw new Error('Choose a recorded transfer installment.');
  if (transfer.installments[installmentIndex]!.dueOn > state.date) throw new Error('This transfer installment is not due yet.');
  if (transfer.installments.some((_installment, index) => index < installmentIndex && getTransferInstallmentRemaining(transfer, index) > 0)) throw new Error('Pay earlier installments of this transfer first.');
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > getTransferInstallmentRemaining(transfer, installmentIndex)) throw new Error('Pay only an outstanding transfer installment amount.');
  const payment: TransferPayment = {
    id: transfer.payments.length ? `${transfer.id}-payment-${transfer.payments.length + 1}` : transfer.id,
    installmentIndex, amount, paidOn: state.date, seasonNumber: state.seasonNumber, round: state.round,
  };
  const updated = { ...transfer, payments: [...transfer.payments, payment] };
  return recordTransferPayment({ ...state, employment: { ...state.employment, transfers: state.employment.transfers.map(item => item.id === transfer.id ? updated : item) } }, updated, payment);
}

/** Due fees use available cash after protected player wages; receipts never anticipate payment. */
export function processTransferPayments(state: SeasonState): SeasonState {
  if (!state.finance.enabledSince) return state;
  const due = state.employment.transfers.flatMap(transfer => getTransferInstallments(transfer).map((installment, index) => ({ transferId: transfer.id, buyerId: transfer.toClubId, dueOn: installment.dueOn, index })).filter(item => item.dueOn <= state.date && getTransferInstallmentRemaining(transfer, item.index) > 0))
    .sort((left, right) => left.dueOn.localeCompare(right.dueOn, 'en') || Number(left.transferId.split('-').at(-1)) - Number(right.transferId.split('-').at(-1)) || left.index - right.index);
  let next = state;
  for (const installment of due) {
    const transfer = next.employment.transfers.find(item => item.id === installment.transferId)!;
    if (getTransferInstallments(transfer).some((_item, index) => index < installment.index && getTransferInstallmentRemaining(transfer, index) > 0)) continue;
    const balance = getFinanceBalance(next.finance, installment.buyerId);
    const available = balance.unpaid ? 0 : Math.max(0, balance.cash - getPayrollReserve(next, installment.buyerId));
    const amount = Math.min(available, getTransferInstallmentRemaining(transfer, installment.index));
    if (amount > 0) next = payTransferInstallment(next, transfer.id, installment.index, amount);
  }
  return next;
}
