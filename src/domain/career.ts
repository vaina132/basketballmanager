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

/** `resigned` (format 63, `career-2` careers only): the manager left of their own accord and took a job offered then. */
export type CareerMoveReason = 'dismissed' | 'moved' | 'resigned';

/**
 * When a `career-2` move happened: `season` before the games of week `round` (the new club manages that week onwards),
 * `end` at the end of the season after its final board review, `offseason` later during that season's offseason.
 */
export type CareerMovePhase = 'season' | 'end' | 'offseason';

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
  /** Format 63, `career-2` careers: the week of the move (the season's last week for `end` and `offseason`). */
  round?: number;
  /** Format 63, `career-2` careers: when in the season the move happened. */
  phase?: CareerMovePhase;
}

/**
 * Format 37: the manager's employment history; moves are in chronological order. `career-1` careers (format 37 onwards)
 * move at most once per season, at its end. `career-2` careers (format 63, new careers) follow `CAREER_RULES`: a
 * protected first season at each club, fresh board confidence for a new coach, mid-season dismissals and resignations,
 * so a season can hold several moves.
 */
export interface SeasonCareer {
  model: 'career-1' | 'career-2';
  enabledSince: CareerAnchor | null;
  moves: CareerMove[];
}

/** The manager's choice when a season ends, or after a mid-season dismissal: stay (no decision) or take over another club. */
export interface SeasonEndDecision {
  moveTo: string;
}
