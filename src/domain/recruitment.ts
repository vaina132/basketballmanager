export interface InSeasonOffer {
  id: string;
  clubId: string;
  playerId: string;
  seasonNumber: number;
  offeredRound: number;
  responseRound: number;
  offeredOn: string;
  responseOn: string;
  seasonWage: number;
  academyProspectId?: string;
  releaseFee?: number;
  seasons: number;
  transfer: TransferProposal | null;
  remainingWages: number;
  status: 'pending' | 'club-review' | 'accepted' | 'countered' | 'rejected' | 'withdrawn' | 'replaced' | 'lost' | 'cancelled' | 'expired';
  respondedOn: string | null;
  closedOn: string | null;
  negotiationId: string | null;
  chosenOfferId: string | null;
  reason: string | null;
}

export interface InSeasonEventAnchor {
  seasonNumber: number;
  round: number;
  date: string;
  ledgerIndexBefore: number;
  contractCountBefore: number;
  negotiationCountBefore: number;
}

export type InSeasonEvent = InSeasonEventAnchor & (
  | { type: 'offer'; id: string; clubId: string; playerId: string; seasonWage: number; seasons?: number; transferFee?: number; transferPaymentPlan?: TransferPaymentPlan; releaseFee?: number; transferMode?: 'release-clause'; academyProspectId?: string }
  | { type: 'enable-transfers' }
  | { type: 'club-decision'; offerId: string; response: 'accept' | 'reject' | 'counter' }
  | { type: 'withdraw'; offerId: string }
  | { type: 'resolve' }
);

export interface SeasonRecruitment {
  model: 'recruitment-1';
  enabledSince: { seasonNumber: number; round: number; ledgerIndex: number; contractCount: number; negotiationCount: number } | null;
  transfersEnabledSince: { seasonNumber: number; round: number; ledgerIndex: number; contractCount: number; negotiationCount: number } | null;
  events: InSeasonEvent[];
  offers: InSeasonOffer[];
}

export interface InSeasonOfferQuote {
  playerId: string;
  clubId: string;
  seasonWage: number;
  releaseFee?: number;
  remainingWages: number;
  responseRound: number;
  responseOn: string;
  remainingBudgetAfter: number;
  annualBudgetRemaining: number;
  rosterSize: number;
  canOffer: boolean;
  reason: string | null;
}

export interface InSeasonBudget {
  budget: number;
  seasonWages: number;
  reservedWages: number;
  remainingBudget: number;
  rosterSize: number;
  reservedRosterSize: number;
  remainingWagesReserved: number;
  spendableCash: number;
}
import type { TransferProposal } from './market';
import type { TransferInstallment, TransferPaymentPlan } from './transfer-payments';


export interface InSeasonTransferQuote extends InSeasonOfferQuote {
  transferMode?: 'release-clause';
  seasons: number;
  endsSeason: number;
  sellerClubId: string | null;
  contractId: string | null;
  fee: number;
  paymentPlan: TransferPaymentPlan;
  requiredFee: number;
  installments: TransferInstallment[];
  futureBudgets: { seasonNumber: number; remainingBudget: number; rosterSize: number }[];
}

export interface InSeasonSaleQuote {
  offerId: string;
  playerId: string;
  sellerClubId: string;
  buyerClubId: string;
  fee: number;
  paymentPlan: TransferPaymentPlan;
  requiredFee: number;
  rosterAfter: number;
  annualSalaryFreed: number;
  remainingWagesFreed: number;
  salaryAlreadyCharged: number;
  nonRefundablePrepayment: number;
  releasedThroughSeason: number;
  decisionDeadline: string;
  responseRound: number;
  responseOn: string;
  canAccept: boolean;
  acceptReason: string | null;
  canCounter: boolean;
  counterReason: string | null;
}
