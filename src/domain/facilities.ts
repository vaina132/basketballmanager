/** Medical and scouting facilities exist only in `facilities-2` careers (format 65). */
export type FacilityType = 'arena' | 'training' | 'youth' | 'medical' | 'scouting';
/** Full upkeep keeps upgraded facilities in condition; reduced upkeep halves the cost while they wear. */
export type MaintenancePlan = 'full' | 'reduced';

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
  /** `facilities-2` (format 65): a repair restores condition to 100 at the same level; upgrades omit this field. */
  kind?: 'repair';
  /** A repair's condition when it was commissioned. */
  conditionBefore?: number;
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
  /** `facilities-2` (format 65): present when the capital funds a repair, which then starts at once. */
  project?: 'repair';
}

export type FacilityEvent = FacilityAnchor & (
  | { type: 'start'; projectId: string; clubId: string; facilityType: FacilityType }
  /** `facilities-2` (format 65): a repair project, paid in full on approval like an upgrade. */
  | { type: 'repair'; projectId: string; clubId: string; facilityType: FacilityType }
  | { type: 'cancel'; projectId: string }
  | { type: 'delegate'; clubId: string; delegated: boolean }
  | { type: 'process' }
  | FacilityFundingDecision
  /** Format 36: a club's upkeep plan, applied from the next matchday. */
  | { type: 'maintenance'; clubId: string; plan: MaintenancePlan }
);

export interface SeasonFacilities {
  /**
   * `facilities-1`: arena, training and youth; condition only under reduced upkeep. `facilities-2` (new careers, format
   * 65): adds medical and scouting facilities, seasonal wear of every upgraded facility and the arena, and repairs.
   */
  model: 'facilities-1' | 'facilities-2';
  enabledSince: FacilityAnchor | null;
  delegated: Record<string, boolean>;
  projects: FacilityProject[];
  events: FacilityEvent[];
  /** Board funding requests (format 32); absent in older formats, null until enabled. */
  fundingSince?: FacilityAnchor | null;
  /** Upkeep plans and facility condition (format 36); absent in older formats, null until enabled. */
  maintenanceSince?: FacilityAnchor | null;
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

/** `facilities-2`: the terms of restoring one facility's condition to 100. */
export interface FacilityRepairQuote {
  clubId: string;
  type: FacilityType;
  level: number;
  conditionBefore: number;
  cost: number;
  durationDays: number;
  dueOn: string;
  remainingBudgetAfter: number;
  canStart: boolean;
  reason: string | null;
}

export interface ClubFacilities {
  enabled: boolean;
  model: SeasonFacilities['model'];
  /** Upkeep choices (format 36): the plan chosen and the plan in force for the current matchday. */
  maintenance: { enabled: boolean; chosen: MaintenancePlan; current: MaintenancePlan };
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
    /** 0-100; standard facilities stay at 100 (except the arena in `facilities-2`). */
    condition: number;
    /** Share of the facility's benefit that its condition still delivers (100 when not worn). */
    effectPercent: number;
    /** `facilities-2` only; null in older careers. */
    repair: FacilityRepairQuote | null;
  }[];
}
