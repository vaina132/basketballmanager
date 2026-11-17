/** Medical and scouting facilities exist only in `facilities-2` and `facilities-3` careers (formats 65 and 74). */
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
  /**
   * `facilities-2` (format 65): a repair restores condition to 100 at the same level; upgrades omit this field.
   * `loans-1` (format 71): a leased level (`lease`) is installed for the next matchday without an upfront payment.
   * `facilities-3` (format 74): an arena expansion (`expansion`) adds `seats` when it completes; its levels stay 1.
   */
  kind?: 'repair' | 'lease' | 'expansion';
  /** `facilities-3`: the seats an arena expansion adds when it completes. */
  seats?: number;
  /** A repair's condition when it was commissioned. */
  conditionBefore?: number;
  /** Format 71: the date a leased level was handed back when its lease ended early; it no longer counts after that day. */
  returnedOn?: string;
}

/**
 * Format 71 (`loans-1`): a bank loan for one facility upgrade or repair, or a lease of one arena or training level.
 * Format 74 (`bank-1`, new careers): a bank loan for anything (`bank`), tied to no project, repaid from next season.
 * Payments fall on fixed weeks of each season (`FACILITY_FINANCING_RULES`); the ledger holds them.
 */
export interface FacilityDebt {
  /** `facility-debt-<n>`, sequential across the career. */
  id: string;
  kind: 'loan' | 'lease' | 'bank';
  clubId: string;
  /** The project the loan pays for, or the leased level's project; absent for a `bank` loan. */
  projectId?: string;
  /** Absent for a `bank` loan. */
  facilityType?: FacilityType;
  /** Loan: the amount borrowed. Lease: the purchase price of the leased level. */
  principal: number;
  /** Loan and bank loan: the fixed yearly interest rate in basis points (500 = 5%). Lease: 0. */
  rateBasisPoints: number;
  /** Term in seasons; two payments fall in each season. */
  seasons: number;
  /** The regular payment (the last one may be slightly smaller) and the total of every payment. */
  payment: number;
  total: number;
  seasonNumber: number;
  round: number;
  date: string;
  /** Logical ledger position of the start entry (loan received, or lease agreed). */
  ledgerIndex: number;
  startEventIndex: number;
  /** Early repayment of a loan (balance plus fee), or a lease ended early (penalty); null while running. */
  settled: { seasonNumber: number; round: number; date: string; ledgerIndex: number; amount: number } | null;
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

/** Format 71: a bank loan for the upgrade or repair that starts immediately afterwards (the principal is received first). */
export interface FacilityLoanDecision {
  type: 'loan';
  debtId: string;
  clubId: string;
  facilityType: FacilityType;
  project: 'upgrade' | 'repair';
  principal: number;
  seasons: number;
  /** Decision evidence, recomputed during validation. */
  rateBasisPoints: number;
}

/** Format 74 (`bank-1`): a bank loan for anything; the principal is added to Remaining budget at once. */
export interface BankLoanDecision {
  type: 'borrow';
  debtId: string;
  clubId: string;
  principal: number;
  seasons: number;
  /** Decision evidence, recomputed during validation. */
  rateBasisPoints: number;
}

export type FacilityEvent = FacilityAnchor & (
  /** `facilities-3` (format 74): an arena start names the `seats` the expansion adds. */
  | { type: 'start'; projectId: string; clubId: string; facilityType: FacilityType; seats?: number }
  /** `facilities-2` (format 65): a repair project, paid in full on approval like an upgrade. */
  | { type: 'repair'; projectId: string; clubId: string; facilityType: FacilityType }
  | { type: 'cancel'; projectId: string }
  | { type: 'delegate'; clubId: string; delegated: boolean }
  | { type: 'process' }
  | FacilityFundingDecision
  /** Format 36: a club's upkeep plan, applied from the next matchday. */
  | { type: 'maintenance'; clubId: string; plan: MaintenancePlan }
  /** Format 71 (`loans-1`): a loan, a lease of the next level, an early loan repayment or a lease ended early. */
  | FacilityLoanDecision
  | { type: 'lease'; debtId: string; projectId: string; clubId: string; facilityType: FacilityType; seasons: number }
  | { type: 'repay'; debtId: string }
  | { type: 'end-lease'; debtId: string }
  | BankLoanDecision
);

export interface SeasonFacilities {
  /**
   * `facilities-1`: arena, training and youth; condition only under reduced upkeep. `facilities-2` (new careers, format
   * 65): adds medical and scouting facilities, seasonal wear of every upgraded facility and the arena, and repairs.
   * `facilities-3` (new careers, format 74): six named levels per facility from a starting level that fits the club,
   * an arena of seats expanded by size, no wear, repairs, upkeep plans, leases or board capital (`FACILITY_RULES_3`).
   */
  model: 'facilities-1' | 'facilities-2' | 'facilities-3';
  enabledSince: FacilityAnchor | null;
  delegated: Record<string, boolean>;
  projects: FacilityProject[];
  events: FacilityEvent[];
  /** Board funding requests (format 32); absent in older formats, null until enabled. */
  fundingSince?: FacilityAnchor | null;
  /** Upkeep plans and facility condition (format 36); absent in older formats, null until enabled. */
  maintenanceSince?: FacilityAnchor | null;
  /** Format 71: careers can finance projects with loans and leases (`loans-1`); format 74: a bank loan for anything (`bank-1`); older careers pay upfront (field absent). */
  financing?: 'loans-1' | 'bank-1';
  /** Format 71: every loan and lease (format 74: every bank loan), present with `financing`. */
  debts?: FacilityDebt[];
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

/** `facilities-3` (format 74): the terms of adding `seats` to a club's arena. */
export interface ArenaExpansionQuote {
  clubId: string;
  seats: number;
  capacityBefore: number;
  capacityAfter: number;
  cost: number;
  durationDays: number;
  dueOn: string;
  remainingBudgetAfter: number;
  /** The arena's upkeep per senior week after completion, and the club's total facilities upkeep. */
  upkeepAfter: number;
  totalUpkeepAfter: number;
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
  /** `facilities-3`: the arena expansion sizes on offer (empty in older careers). */
  expansions: ArenaExpansionQuote[];
  rows: {
    type: FacilityType;
    level: number;
    /** 4, or 6 in `facilities-3`. */
    maxLevel: number;
    /** `facilities-3`: the level's name (Very Poor to Excellent); null in older careers and for the arena. */
    levelName: string | null;
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
