import type { PayrollCharge } from './payroll';
import type { FacilityType } from './facilities';
import type { SponsorshipPayment } from './commercial';

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
  kind: 'opening' | 'sponsor' | 'operations' | 'tickets' | 'coaching' | 'scouting' | 'fitness' | 'physio' | 'assistant' | 'youth' | 'payroll' | 'transfer' | 'buyout' | 'facility' | 'facility-upkeep' | 'board-capital';
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
  facilityUpkeep?: { arena: number; training: number; youth: number };
  /** Present on sponsorship payments made under a negotiated agreement (format 31). */
  sponsorship?: SponsorshipPayment;
  /** One-off owner capital for the facility upgrade that starts immediately afterwards (format 32). */
  boardCapital?: { projectId: string; facilityType: FacilityType };
}

export interface SeasonFinance {
  model: 'finance-1';
  enabledSince: { seasonNumber: number; round: number } | null;
  plans: Record<string, FinancePlan>;
  /** Prices already chosen for the prepared matchday; future plan edits leave these intact. */
  roundPrices: Record<string, number>;
  /** Present after facilities activation; prepared seats stay fixed through that matchday. */
  roundCapacities?: Record<string, number>;
  ledger: FinanceEntry[];
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
