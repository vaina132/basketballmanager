import type { ExtraAttributes, PlayerAttributes, SkillAttributes } from './types';
import type { CoachingWeekAssignment } from './coaching';
import type { FitnessWeekAssignment } from './fitness';

export type TrainingFocus = 'balanced' | keyof SkillAttributes;
export type TrainingIntensity = 'recovery' | 'light' | 'standard' | 'heavy';
export type TrainingPoints = Record<keyof SkillAttributes, number>;

export interface TrainingPlan {
  delegated: boolean;
  intensity: TrainingIntensity;
  focus: TrainingFocus;
  individual: Record<string, TrainingFocus | 'team'>;
}

export interface TrainingPlayerReport {
  focus: TrainingFocus;
  intensity: TrainingIntensity;
  availableDays: number;
  conditionBefore: number;
  conditionAfter: number;
  gains: TrainingPoints;
  coachingGains: TrainingPoints;
  fitness?: { conditionWithoutCoach: number; conditionBenefit: number };
  /** Actual eligible practice before coaching and skill caps; absent in the legacy model. */
  aging?: { ordinaryPracticePoints: number; adjustedPracticePoints: number; rateBasisPoints: number };
  /** Additive facility practice, with actual gains recorded after skill caps. */
  facility?: { earnedPoints: number; gains: TrainingPoints };
}

export interface TrainingWeekReport {
  seasonNumber: number;
  afterRound: number;
  fromDate: string;
  toDate: string;
  rosterIds: Record<string, string>;
  plans: Record<string, TrainingPlan>;
  players: Record<string, TrainingPlayerReport>;
  coaching: Record<string, CoachingWeekAssignment[]> | null;
  fitness?: Record<string, FitnessWeekAssignment | null>;
}

export interface SeasonTraining {
  /**
   * `training-2` (sprint 4, new careers): each player's hidden potential limits his development (`src/world/potential.ts`).
   * `training-1`: careers created before it keep the first model's fixed limit of two rating points per skill.
   */
  model: 'training-1' | 'training-2';
  /** Null retains the original recovery-only career model until explicitly enabled. */
  enabledSince: { seasonNumber: number; round: number } | null;
  plans: Record<string, TrainingPlan>;
  points: Record<string, TrainingPoints>;
  lastWeek: TrainingWeekReport | null;
}
