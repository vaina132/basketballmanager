import type { PlayerAttributes } from './types';
import type { TrainingFocus } from './training';

export interface Coach {
  id: string;
  name: string;
  skills: Record<keyof PlayerAttributes, number>;
  /** Full-season commitment in euro cents, including contracts signed midseason. */
  fee: number;
}

export interface CoachingContract {
  id: string;
  coachId: string;
  clubId: string;
  seasonNumber: number;
  startedRound: number;
  releasedRound: number | null;
  focus: TrainingFocus;
  renew: boolean;
}

export interface SeasonCoaching {
  model: 'coaching-1';
  enabledSince: { seasonNumber: number; round: number } | null;
  /** Current-season obligations, including released contracts. */
  contracts: CoachingContract[];
}

export interface CoachingWeekAssignment {
  contractId: string;
  coachId: string;
  focus: TrainingFocus;
}
