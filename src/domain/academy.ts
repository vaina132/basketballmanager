import type { Player } from './types';
import type { TrainingFocus, TrainingPoints } from './training';

/** Immutable, fictional intake identity. Academy progress is kept separately. */
export interface AcademyProspect {
  player: Player;
  dateOfBirth: string;
  seasonWage: number;
  clubId: string;
  intakeSeason: number;
  intakeRound: number;
  /** Format 105 (`world.generatedPeople`): the prospect's nationality; absent in older careers. */
  nationality?: string;
}

export interface AcademyIntake {
  id: string;
  clubId: string;
  seasonNumber: number;
  round: number;
  date: string;
  initial: boolean;
  /** Supplemental squads use a separate generator; absence preserves the original intake model. */
  source?: 'youth-squad';
  prospectIds: string[];
}

export interface AcademyWeekFullPlayer {
  clubId: string;
  focus: TrainingFocus;
  pointsBefore: TrainingPoints;
  gains: TrainingPoints;
  coachingGains: TrainingPoints;
  pointsAfter: TrainingPoints;
  availability?: { availableDays: number; conditionBefore: number; conditionAfter: number };
  facility?: { earnedPoints: number; gains: TrainingPoints };
}

/** Historical rival development keeps its exact outcome; the save validator still regenerates the full report. */
export interface AcademyWeekOutcome {
  detail: 'outcome';
  clubId: string;
  focus: TrainingFocus;
  pointsAfter: TrainingPoints;
}

export type AcademyWeekPlayer = AcademyWeekFullPlayer | AcademyWeekOutcome;

export interface AcademyWeek {
  id: string;
  seasonNumber: number;
  afterRound: number;
  fromDate: string;
  toDate: string;
  coaches: Record<string, { contractId: string; coachId: string; bonusPercent: number } | null>;
  players: Record<string, AcademyWeekPlayer>;
}

/** Senior baseline is frozen at graduation; subsequent senior training starts at zero. */
export interface AcademyGraduate {
  id: string;
  prospectId: string;
  player: Player;
  dateOfBirth: string;
  seasonWage: number;
  clubId: string;
  availableSince: { seasonNumber: number; round: number };
  graduatedOn: string;
  kind: 'promotion' | 'age-out';
  sourcePoints: TrainingPoints;
  offerId: string | null;
  contractId: string | null;
  /** Actual recovered youth condition on promotion; legacy and age-out graduates start at 100. */
  condition?: number;
}

export interface SeasonAcademy {
  model: 'academy-1';
  enabledSince: { seasonNumber: number; round: number; ledgerIndex: number; contractCount: number; negotiationCount: number } | null;
  prospects: AcademyProspect[];
  intakes: AcademyIntake[];
  focus: Record<string, TrainingFocus>;
  points: Record<string, TrainingPoints>;
  weeks: AcademyWeek[];
  graduates: AcademyGraduate[];
}
