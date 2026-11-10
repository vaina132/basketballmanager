/** An unpaid portion of an existing transfer, in euro cents. */
export interface CashOutlookInstallment {
  transferId: string;
  playerId: string;
  counterpartyClubId: string;
  installmentIndex: number;
  dueOn: string;
  amount: number;
}

/** Positive income/cost categories; the two running balances may be negative. */
export interface CashOutlookRow {
  id: string;
  date: string;
  kind: 'due-now' | 'scheduled';
  round: number | null;
  fixtureIds: string[];
  wages: number;
  operations: number;
  unpaidCosts: number;
  transferOut: number;
  transferIn: number;
  tickets: number;
  adverseTickets: number;
  baselineBalance: number;
  adverseBalance: number;
}

export interface CashOutlookScenario {
  endBalance: number;
  lowBalance: number;
  lowOn: string;
  /** Largest projected shortfall, not a negative actual bank balance. */
  fundingGap: number;
}

export interface ClubCashOutlook {
  enabled: boolean;
  clubId: string;
  seasonNumber: number;
  asOf: string;
  horizon: string;
  startCash: number;
  startUnpaid: number;
  spendableCash: number;
  /** Current cash reservations only, excluded from forecast expenses until agreed. */
  pendingHolds: { wages: number; fees: number; total: number };
  rows: CashOutlookRow[];
  baseline: CashOutlookScenario;
  adverse: CashOutlookScenario;
  laterOutgoing: CashOutlookInstallment[];
  laterIncoming: CashOutlookInstallment[];
  /** Already due and unreceived: no guessed future receipt date. */
  overdueIncoming: CashOutlookInstallment[];
  assumptions: string[];
}
