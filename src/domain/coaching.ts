import type { ExtraAttributes, PlayerAttributes, SkillAttributes } from './types';
import type { TrainingFocus } from './training';

export interface Coach {
  id: string;
  name: string;
  skills: Record<keyof SkillAttributes, number>;
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
  /** 'coaching-4' (format 76, new careers): 'coaching-3' with staff contracts of 1-3 seasons, weekly salaries and compensation (`src/world/staff-contracts.ts`). */
  model: 'coaching-1' | 'coaching-2' | 'coaching-3' | 'coaching-4';
  enabledSince: { seasonNumber: number; round: number } | null;
  /** Current-season obligations, including released contracts. */
  contracts: CoachingContract[];
  /** Format 76 ('coaching-4'): each employed person's contract (every staff role), by person. */
  terms?: Record<string, StaffTerm>;
  /**
   * Format 84 (new careers with the wage pool): computer clubs always fill their six staff roles, the training (head)
   * coach first, down to the cheapest candidate regardless of money (`usesFullStaff` in `src/world/staff-policy.ts`).
   */
  fullStaff?: true;
}

/** A staff member's contract at a club: from the season signed to the last season (1-3 seasons). */
export interface StaffTerm { clubId: string; fromSeason: number; untilSeason: number }

export interface CoachingWeekAssignment {
  contractId: string;
  coachId: string;
  focus: TrainingFocus;
}
