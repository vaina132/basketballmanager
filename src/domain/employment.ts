import type { TransferInstallment, TransferPayment, TransferPaymentPlan } from './transfer-payments';

/** Immutable employment terms. Seasonal payroll remains a separate payment schedule. */
export interface EmploymentContract {
  id: string;
  playerId: string;
  clubId: string;
  startsSeason: number;
  /** First registered matchday in startsSeason; later covered seasons begin at round one. */
  startsRound: number;
  endsSeason: number;
  /** Gross annual wage in euro cents. */
  seasonWage: number;
  signedSeason: number;
  signedRound: number;
  kind: 'initial' | 'renewal' | 'free-agent' | 'transfer' | 'midseason' | 'midseason-transfer';
}

/** Completed club sale; old agreements remain intact for historical registration and payroll. */
export interface EmploymentTransfer {
  id: string;
  offerId: string;
  playerId: string;
  fromClubId: string;
  toClubId: string;
  seasonNumber: number;
  completedOn: string;
  startsSeason: number;
  startsRound: number;
  fee: number;
  releasedContractIds: string[];
  contractId: string;
  paymentPlan: TransferPaymentPlan;
  installments: TransferInstallment[];
  payments: TransferPayment[];
}

/** Paid release of future terms; original agreements retain their historical meaning. */
export interface EmploymentBuyout {
  id: string;
  playerId: string;
  clubId: string;
  seasonNumber: number;
  completedOn: string;
  startsSeason: number;
  amount: number;
  releasedContractIds: string[];
  contractCountBefore: number;
  negotiationCountBefore: number;
}

export interface SeasonEmployment {
  model: 'employment-1';
  enabledSince: { seasonNumber: number; round: number } | null;
  delegated: boolean;
  contracts: EmploymentContract[];
  transfers: EmploymentTransfer[];
  buyouts: EmploymentBuyout[];
  /** Completed-season rosters remain unchanged while next year's terms are agreed. */
  market: { seasonNumber: number } | null;
}

export interface ClubContractSummary {
  clubId: string;
  seasonNumber: number;
  rosterSize: number;
  seasonWages: number;
  reservedWages: number;
  reservedRosterSize: number;
  budget: number;
  remainingBudget: number;
  minimumReserve: number;
  spendableBudget: number;
  contracts: EmploymentContract[];
}

export interface PlayerContractQuote {
  playerId: string;
  clubId: string;
  startsSeason: number;
  endsSeason: number;
  seasons: number;
  seasonWage: number;
  askingWage: number;
  canOffer: boolean;
  reason: string | null;
}
