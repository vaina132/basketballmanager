export type FacilityType = 'arena' | 'training' | 'youth';

/** Exact command ordering protects salary and transfer reservations at construction approval. */
export interface FacilityAnchor {
  seasonNumber: number;
  round: number;
  date: string;
  ledgerIndex: number;
  contractCount: number;
  negotiationCount: number;
  recruitmentEventCount: number;
  marketEventCount: number;
}

export interface FacilityProject {
  id: string;
  clubId: string;
  type: FacilityType;
  fromLevel: number;
  toLevel: number;
  /** Fully funded euro cents, retained after cancellation. */
  cost: number;
  startedOn: string;
  dueOn: string;
  completedOn: string | null;
  cancelledOn: string | null;
  startEventIndex: number;
}

/** A board capital decision for one facility upgrade; an approval is immediately followed by that upgrade's start. */
export interface FacilityFundingDecision {
  type: 'funding';
  clubId: string;
  facilityType: FacilityType;
  /** Requested capital in euro cents: the shortfall for the manager, or the shortfall to the cash cushion for automatic control. */
  amount: number;
  mode: 'manager' | 'automatic';
  approved: boolean;
  /** Decision evidence, recomputed during validation. */
  confidence: number;
  requiredConfidence: number;
  capitalRemaining: number;
}

export type FacilityEvent = FacilityAnchor & (
  | { type: 'start'; projectId: string; clubId: string; facilityType: FacilityType }
  | { type: 'cancel'; projectId: string }
  | { type: 'delegate'; clubId: string; delegated: boolean }
  | { type: 'process' }
  | FacilityFundingDecision
);

export interface SeasonFacilities {
  model: 'facilities-1';
  enabledSince: FacilityAnchor | null;
  delegated: Record<string, boolean>;
  projects: FacilityProject[];
  events: FacilityEvent[];
  /** Board funding requests (format 32); absent in older formats, null until enabled. */
  fundingSince?: FacilityAnchor | null;
}

export interface FacilityUpgradeQuote {
  clubId: string;
  type: FacilityType;
  fromLevel: number;
  toLevel: number;
  cost: number;
  durationDays: number;
  dueOn: string;
  remainingBudgetAfter: number;
  /** This facility's upkeep after completion, in cents per senior matchday. */
  upkeepAfter: number;
  totalUpkeepAfter: number;
  bonusAfter: number;
  /** Completed arena seats without temporary construction closures. */
  capacityAfter: number;
  canStart: boolean;
  reason: string | null;
}

export interface ClubFacilities {
  enabled: boolean;
  clubId: string;
  delegated: boolean;
  remainingBudget: number;
  upkeepPerRound: number;
  /** Capacity available to the prepared/current fixture. */
  arenaCapacity: number;
  arenaFullCapacity: number;
  rows: {
    type: FacilityType;
    level: number;
    maxLevel: 4;
    bonusPercent: number;
    capacity: number;
    upkeepPerRound: number;
    project: FacilityProject | null;
    quote: FacilityUpgradeQuote;
  }[];
}
