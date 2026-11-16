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

/**
 * `resigned` (format 63, `career-2` careers onwards): the manager left of their own accord and took a job offered then
 * (`career-3`: or became unemployed). `appointed` (format 69, `career-3` careers only): an unemployed manager took a job.
 */
export type CareerMoveReason = 'dismissed' | 'moved' | 'resigned' | 'appointed';

/**
 * When a `career-2` move happened: `season` before the games of week `round` (the new club manages that week onwards),
 * `end` at the end of the season after its final board review, `offseason` later during that season's offseason.
 */
export type CareerMovePhase = 'season' | 'end' | 'offseason';

/**
 * The manager changed clubs at the end of `seasonNumber`: after that season's final board review and before its
 * offseason opened. The former club managed the season itself; the new club manages its offseason and later seasons.
 * Format 69 (`career-3` careers): an empty club id (`NO_CLUB`) is no club. A dismissal or resignation to no club starts
 * a period of unemployment, which an `appointed` move from no club ends; `managedClubId` is empty in between.
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
  /**
   * Format 72, `career-3` careers created from this version: an appointment from unemployment records the club the
   * manager last left, so rivalries grow as for a direct move between the two clubs. Older appointments lack it.
   */
  formerClubId?: string;
}

/**
 * Format 37: the manager's employment history; moves are in chronological order. `career-1` careers (format 37 onwards)
 * move at most once per season, at its end. `career-2` careers (format 63, new careers) follow `CAREER_RULES`: a
 * protected first season at each club, fresh board confidence for a new coach, mid-season dismissals and resignations,
 * so a season can hold several moves.
 */
export interface SeasonCareer {
  /** `career-3` (format 69, new careers): `career-2` rules plus unemployed seasons. */
  model: 'career-1' | 'career-2' | 'career-3';
  enabledSince: CareerAnchor | null;
  moves: CareerMove[];
}

/**
 * The manager's choice when a season ends, or after a mid-season dismissal: stay (no decision) or take over another club.
 * `career-3` careers: an empty `moveTo` declines every offer after a dismissal, and the manager becomes unemployed.
 */
export interface SeasonEndDecision {
  moveTo: string;
}
