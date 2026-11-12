import type { PlayerAttributes } from './types';
import type { CoachingWeekAssignment } from './coaching';
import type { FitnessWeekAssignment } from './fitness';

export type TrainingFocus = 'balanced' | keyof PlayerAttributes;
export type TrainingIntensity = 'recovery' | 'light' | 'standard' | 'heavy';
export type TrainingPoints = Record<keyof PlayerAttributes, number>;

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
  model: 'training-1';
  /** Null retains the original recovery-only career model until explicitly enabled. */
  enabledSince: { seasonNumber: number; round: number } | null;
  plans: Record<string, TrainingPlan>;
  points: Record<string, TrainingPoints>;
  lastWeek: TrainingWeekReport | null;
}
