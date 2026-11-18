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
  /**
   * 'coaching-2' (format 74, new careers): every club starts with one person in each staff role, fitted to its level;
   * computer clubs fill empty roles the same way; a sacked person's fee no longer counts against the staff budget
   * (`src/world/staff-levels.ts`). 'coaching-1': earlier careers, whose released fees stay committed for the season.
   */
  /** 'coaching-3' (format 75, new careers): 'coaching-2' with one wage pool for player wages and staff fees (`src/world/wage-pool.ts`). */
  model: 'coaching-1' | 'coaching-2' | 'coaching-3';
  enabledSince: { seasonNumber: number; round: number } | null;
  /** Current-season obligations, including released contracts. */
  contracts: CoachingContract[];
}

export interface CoachingWeekAssignment {
  contractId: string;
  coachId: string;
  focus: TrainingFocus;
}
