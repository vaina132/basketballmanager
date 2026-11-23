import type { TransferInstallment, TransferPayment, TransferPaymentPlan } from './transfer-payments';

import type { SquadRole } from './relationships';
import type { NbaCapRoute } from '../world/nba-cap';
import type { EmploymentTrade } from './trades';

export interface ContractOfferOptions {
  releaseFee?: number;
  /** `loan` (format 78, `recruitment-2`): the buyer takes the player for the rest of this season only. */
  transferMode?: 'negotiated' | 'release-clause' | 'loan';
  /** `relationships-3`: the squad role offered; omitted, the player's natural role at the offering club. */
  role?: SquadRole;
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
  /** `relationships-3`: the squad role agreed as a contract term; the player expects it while the contract runs. */
  role?: SquadRole;
  /** Format 92 (NBA clubs of worlds with `world.nba.cap`): how the signing fitted the salary cap (`nba-cap.ts`). */
  capRoute?: NbaCapRoute;
  signedSeason: number;
  signedRound: number;
  /** `joined`: an opening term for a player of a club joining the full world (format 55). `trade` (format 94): a traded player's term carried on unchanged at his new club. `drafted` (format 95): a rookie contract signed with an NBA draft pick. */
  kind: 'initial' | 'renewal' | 'free-agent' | 'transfer' | 'midseason' | 'midseason-transfer' | 'joined' | 'trade' | 'drafted';
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
  /** `loan` (format 78): the released terms come back to the lending club from the next season. */
  mode?: 'release-clause' | 'loan';
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
  /** Format 94 (NBA step 9): completed trades between NBA clubs; each releases the traded players' former terms. */
  trades?: EmploymentTrade[];
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
  /** The wage kept free for each missing place of the eight-player minimum squad (a cheap player at the club's level). */
  reserveWage: number;
  /**
   * The most the season's wages may reach with a cheap signing (at most `reserveWage`) still needed for the eight-player
   * minimum squad: the budget, or the highest allocation the club has had for the season when its money has since
   * fallen (format 72).
   */
  minimumSquadBudget: number;
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
  /** `relationships-3`: the role on the offer (chosen or natural); `askingWage` includes its effect. */
  role?: SquadRole;
  /** Format 92: an NBA club's cap route for this signing (`nba-cap.ts`). */
  capRoute?: NbaCapRoute;
  canOffer: boolean;
  reason: string | null;
}
