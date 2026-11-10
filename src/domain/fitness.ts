export interface FitnessCoach {
  id: string;
  name: string;
  skills: { recovery: number; workload: number };
  /** Full-season fee in euro cents, including midseason appointments. */
  fee: number;
}

export interface FitnessContract {
  id: string;
  coachId: string;
  clubId: string;
  seasonNumber: number;
  startedRound: number;
  releasedRound: number | null;
  renew: boolean;
  hiredLedgerIndex: number;
  releasedLedgerIndex: number | null;
}

export interface SeasonFitness {
  model: 'fitness-1';
  enabledSince: { seasonNumber: number; round: number; ledgerIndex: number } | null;
  /** Historical appointments explain staff applied to earlier training intervals. */
  contracts: FitnessContract[];
}

export interface FitnessEffects {
  recoveryPerDay: number;
  practiceCostReductionPercent: number;
}

export interface FitnessWeekAssignment extends FitnessEffects {
  contractId: string;
  coachId: string;
}

export interface FitnessHireQuote {
  coachId: string;
  clubId: string;
  fee: number;
  remainingAllocation: number;
  remainingBudget: number;
  canHire: boolean;
  reason: string | null;
}
