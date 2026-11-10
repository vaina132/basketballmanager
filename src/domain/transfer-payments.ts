export type TransferPaymentPlan = 'upfront' | 'two-payments' | 'three-payments';

export interface TransferInstallment {
  dueOn: string;
  amount: number;
}

/** Actual money received by the selling club; unpaid balances are never receipts. */
export interface TransferPayment {
  id: string;
  installmentIndex: number;
  paidOn: string;
  seasonNumber: number;
  round: number;
  amount: number;
}

export interface TransferPaymentSummary {
  outgoingRemaining: number;
  futureDue: number;
  overdue: number;
  nextDueOn: string | null;
  incomingRemaining: number;
  incomingOverdue: number;
}
