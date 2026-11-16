import type { PayrollCharge } from './payroll';
import type { FacilityType } from './facilities';
import type { NamingRightsPayment, SponsorExitPayment, SponsorshipPayment } from './commercial';

export interface FinancePlan {
  delegated: boolean;
  /** Ticket price in euro cents, in one-euro steps. */
  price: number;
}

export interface FinanceEntry {
  id: string;
  clubId: string;
  seasonNumber: number;
  round: number;
  kind: 'opening' | 'sponsor' | 'operations' | 'tickets' | 'coaching' | 'scouting' | 'fitness' | 'physio' | 'assistant' | 'youth' | 'payroll' | 'transfer' | 'buyout' | 'facility' | 'facility-upkeep' | 'board-capital' | 'naming-rights' | 'sponsor-exit' | 'loan' | 'loan-repayment' | 'lease';
  /** Income or cost in signed euro cents; cash effects also depend on unpaid obligations. */
  amount: number;
  sourceId: string;
  ticket: { fixtureId: string; price: number; attendance: number; capacity?: number } | null;
  coach: { contractId: string; coachId: string } | null;
  payroll: PayrollCharge | null;
  scout?: { contractId: string; scoutId: string };
  fitness?: { contractId: string; coachId: string };
  physio?: { contractId: string; physioId: string };
  assistant?: { contractId: string; assistantId: string };
  youth?: { contractId: string; coachId: string };
  facility?: { projectId: string; type: FacilityType };
  /** `facilities-2` (format 65) adds `medical` and `scouting`. */
  facilityUpkeep?: { arena: number; training: number; youth: number; medical?: number; scouting?: number };
  /** Present on sponsorship payments made under a negotiated agreement (format 31). */
  sponsorship?: SponsorshipPayment;
  /** One-off owner capital for the facility upgrade that starts immediately afterwards (format 32). */
  boardCapital?: { projectId: string; facilityType: FacilityType };
  /** Format 64: an arena naming-rights installment. */
  namingRights?: NamingRightsPayment;
  /** Format 64: a sponsor's exit payment (income) or the club's termination fee (cost). */
  sponsorExit?: SponsorExitPayment;
  /**
   * Format 71: a facility loan or lease entry: `start` (loan received, or lease agreed at no cost), a scheduled payment
   * by number, or `settle` (early loan repayment with its fee, or the penalty for ending a lease early).
   */
  debt?: { debtId: string; payment: 'start' | number | 'settle' };
}

export interface SeasonFinance {
  model: 'finance-1';
  enabledSince: { seasonNumber: number; round: number } | null;
  plans: Record<string, FinancePlan>;
  /** Prices already chosen for the prepared matchday; future plan edits leave these intact. */
  roundPrices: Record<string, number>;
  /** Present after facilities activation; prepared seats stay fixed through that matchday. */
  roundCapacities?: Record<string, number>;
  /** Active tail. Use the logical ledger helpers when reading transactions or writing absolute anchors. */
  ledger: FinanceEntry[];
  /** Lossless completed-season prefixes; absent on careers without archived finances. */
  archives?: FinanceArchiveBlock[];
}

export type FinanceArchiveDetails = Omit<FinanceEntry, 'id' | 'clubId' | 'seasonNumber' | 'round' | 'kind' | 'amount' | 'sourceId' | 'ticket' | 'coach' | 'payroll'> &
  Partial<Pick<FinanceEntry, 'ticket' | 'coach' | 'payroll'>>;
/** Null ticket/coach/payroll fields are implicit; every non-null and optional payload is retained. */
export type FinanceArchiveRow = [clubId: string, round: number, kind: FinanceEntry['kind'], amount: number, sourceId: string, details: FinanceArchiveDetails];
export interface FinanceArchiveBlock {
  model: 'finance-archive-1';
  seasonNumber: number;
  /** Absolute zero-based position of the first row. IDs remain finance-(position + 1). */
  firstIndex: number;
  rows: FinanceArchiveRow[];
}

export interface FinanceBalance { cash: number; unpaid: number }
export interface FinanceLedgerRow extends FinanceEntry {
  cashDelta: number;
  unpaidDelta: number;
  cashAfter: number;
  unpaidAfter: number;
}

export interface GateForecast {
  fixtureId: string;
  clubId: string;
  opponentClubId: string;
  price: number;
  attendance: number;
  capacity: number;
  revenue: number;
}
