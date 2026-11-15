import type { TransferInstallment, TransferPayment, TransferPaymentPlan } from './transfer-payments';

export interface ContractOfferOptions {
  releaseFee?: number;
  transferMode?: 'negotiated' | 'release-clause';
}

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
  /** Optional fee agreed with this contract; absence preserves ordinary transfer negotiation. */
  releaseFee?: number;
  signedSeason: number;
  signedRound: number;
  /** `joined`: an opening term for a player of a club joining the full world (format 55). */
  kind: 'initial' | 'renewal' | 'free-agent' | 'transfer' | 'midseason' | 'midseason-transfer' | 'joined';
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
  mode?: 'release-clause';
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

/** Format 55: a club leaving the full world ends its players' terms from its first season outside (step 3.4d-2). */
export interface EmploymentDeparture {
  clubId: string;
  /** The season whose end the club leaves after. */
  seasonNumber: number;
  startsSeason: number;
  releasedContractIds: string[];
}

export interface SeasonEmployment {
  model: 'employment-1';
  enabledSince: { seasonNumber: number; round: number } | null;
  delegated: boolean;
  contracts: EmploymentContract[];
  transfers: EmploymentTransfer[];
  buyouts: EmploymentBuyout[];
  /** Format 55: terms ended because their club left the full world. */
  departures?: EmploymentDeparture[];
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
  releaseFee?: number;
  canOffer: boolean;
  reason: string | null;
}
