import type { PayrollCharge } from './payroll';

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
  kind: 'opening' | 'sponsor' | 'operations' | 'tickets' | 'coaching' | 'scouting' | 'fitness' | 'physio' | 'assistant' | 'payroll' | 'transfer' | 'buyout';
  /** Income or cost in signed euro cents; cash effects also depend on unpaid obligations. */
  amount: number;
  sourceId: string;
  ticket: { fixtureId: string; price: number; attendance: number } | null;
  coach: { contractId: string; coachId: string } | null;
  payroll: PayrollCharge | null;
  scout?: { contractId: string; scoutId: string };
  fitness?: { contractId: string; coachId: string };
  physio?: { contractId: string; physioId: string };
  assistant?: { contractId: string; assistantId: string };
}

export interface SeasonFinance {
  model: 'finance-1';
  enabledSince: { seasonNumber: number; round: number } | null;
  plans: Record<string, FinancePlan>;
  /** Prices already chosen for the prepared matchday; future plan edits leave these intact. */
  roundPrices: Record<string, number>;
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
