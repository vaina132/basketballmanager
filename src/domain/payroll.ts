/** Financial terms for the fixed development roster; this is not an employment expiry. */
export interface PlayerWageAgreement {
  id: string;
  playerId: string;
  clubId: string;
  seasonNumber: number;
  startsRound: number;
  /** Authored full-season gross wage, in euro cents. */
  seasonWage: number;
}

export interface SeasonPayroll {
  model: 'payroll-1';
  /** Ledger length immediately before wage commitments became active. */
  enabledSince: { seasonNumber: number; round: number; ledgerIndex: number } | null;
  delegated: Record<string, boolean>;
  /** Full-career terms keep every recorded wage obligation auditable. */
  agreements: PlayerWageAgreement[];
}

export interface PayrollItem {
  agreementId: string;
  playerId: string;
  gross: number;
  discount: number;
  amount: number;
}

export interface PayrollCharge {
  type: 'installment' | 'prepayment';
  fromRound: number;
  throughRound: number;
  items: PayrollItem[];
}

export interface PayrollSummary {
  seasonWages: number;
  /** Net obligations recorded; these may include unpaid costs, so this is not cash paid. */
  charged: number;
  futureCommitted: number;
  nextInstallment: number;
  savings: number;
}

export interface PlayerPayroll extends PayrollSummary {
  agreement: PlayerWageAgreement;
  prepaid: boolean;
}

export interface ClubPayrollSummary extends PayrollSummary { spendableCash: number }

export interface WagePrepaymentQuote {
  agreementId: string;
  playerId: string;
  clubId: string;
  fromRound: number;
  throughRound: number;
  gross: number;
  discount: number;
  amount: number;
  otherCommitments: number;
  requiredCash: number;
  canPrepay: boolean;
  reason: string | null;
}
