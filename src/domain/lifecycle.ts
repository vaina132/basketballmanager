import type { TrainingPoints } from './training';

/** Journal prefixes freeze the information available when retirement plans were reviewed. */
export interface LifecycleAnchor {
  seasonNumber: number;
  round: number;
  date: string;
  ledgerIndex: number;
  contractCount: number;
  negotiationCount: number;
  recruitmentEventCount: number;
  marketEventCount: number;
}

export interface LifecycleReview extends LifecycleAnchor {
  id: string;
  noticeIds: string[];
}

export interface RetirementNotice {
  id: string;
  reviewId: string;
  playerId: string;
  clubId: string | null;
  announcedSeason: number;
  announcedRound: number;
  announcedOn: string;
  targetAge: number;
  lastSeason: number;
  retirementSeason: number;
  retiredOn: string;
}

export interface SeasonLifecycle {
  model: 'lifecycle-1';
  enabledSince: LifecycleAnchor | null;
  reviews: LifecycleReview[];
  notices: RetirementNotice[];
}

export interface PlayerAging {
  active: boolean;
  age: number | null;
  asOf: string;
  startedOn: string | null;
  trainingPercent: number;
  /** Calendar decline in hundredths of a skill point; these are not practice points. */
  lossPoints: TrainingPoints;
  skillLoss: TrainingPoints;
}
