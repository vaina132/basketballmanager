/** When a career opted in to dismissal and job changes. */
export interface CareerAnchor {
  seasonNumber: number;
  round: number;
  date: string;
  /** Completed senior matchdays across the career at activation. */
  completedRounds: number;
  /** First season whose end can bring a board decision or a job change: 1 for a new career, otherwise the next season. */
  effectiveFrom: number;
}

export type CareerMoveReason = 'dismissed' | 'moved';

/**
 * The manager changed clubs at the end of `seasonNumber`: after that season's final board review and before its
 * offseason opened. The former club managed the season itself; the new club manages its offseason and later seasons.
 */
export interface CareerMove {
  seasonNumber: number;
  date: string;
  fromClubId: string;
  toClubId: string;
  reason: CareerMoveReason;
  /** Finance ledger entries recorded when the move happened, which orders it against every dated command. */
  ledgerCount: number;
}

/** Format 37: the manager's employment history; moves are in chronological order, at most one per season. */
export interface SeasonCareer {
  model: 'career-1';
  enabledSince: CareerAnchor | null;
  moves: CareerMove[];
}

/** The manager's choice when a season ends: stay (no decision) or take over another club. */
export interface SeasonEndDecision {
  moveTo: string;
}
