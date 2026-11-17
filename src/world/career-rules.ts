import type { BoardRestart, SeasonBoard } from '../domain/board';
import type { CareerMove, CareerMovePhase, SeasonCareer } from '../domain/career';

/**
 * Career and board rules for new careers (`career-2`, save format 63; saved ideas level, approved by the owner on
 * 15 November 2026). Every number lives here. Careers started earlier keep `career-1`: boards decide only at season
 * ends, Under pressure dismisses even in the first season, and a new coach inherits the board's confidence.
 * Unemployed seasons (`career-3`, save format 69; owner decision 16 November 2026) add the last four rules: a manager may
 * decline every offer after a dismissal or resign without a new job; the career then continues with every club run
 * automatically, and boards that change coach offer their job to the unemployed manager by reputation.
 */
export const CAREER_RULES = Object.freeze({
  /**
   * Board confidence for a new coach: at the start of a career, after a move, and when a rival club appoints a new
   * coach. 57 is Steady and a little above the 50 an average season earns, so a new coach is neither on probation nor
   * secure; confidence still moves at most 8 points per review.
   */
  freshConfidence: 57,
  /** A season verdict below this (Under pressure) ends the coach's job, except in a protected first season. */
  seasonDismissalBelow: 30,
  /** At an in-season review, confidence below this ends the job of a coach outside a protected first season... */
  midSeasonDismissalBelow: 20,
  /** ...once the club has played at least this share of its regular-season games, and before its regular season ends. */
  midSeasonGamesShare: 1 / 3,
  /** Reputation points lost for a resignation... */
  resignationReputationCost: 5,
  /** ...in the season of the resignation and the next two, the same three seasons that make up reputation. */
  resignationSeasons: 3,
  /**
   * Career-3: while unemployed, reputation moves this many points towards `unemployedReputationLevel`... (one point
   * every five weeks is about ten points a year: a season out costs a good name little, two or three seasons a lot).
   */
  unemployedFadePoints: 1,
  /** ...every this many days without a club, counted from the day the manager left... */
  unemployedFadeDays: 35,
  /**
   * ...and stops there. A better name fades down to it; a poorer one is slowly forgotten up to it. 30 is just above
   * the 25 a last-placed club asks for, so a long wait always leads back to the bottom of a table.
   */
  unemployedReputationLevel: 30,
  /**
   * Career-3: a club whose board replaces its coach at an in-season review keeps the job open to an unemployed manager
   * before the games of this many weeks (an interim coach takes the team meanwhile). Jobs opened at a season end stay
   * open through that offseason.
   */
  vacancyOpenWeeks: 3,
  /**
   * At most this many clubs offer the manager their job at one point (a season end, a dismissal, a resignation or the
   * job market): among the vacancies whose requirement the reputation reaches, the best fits, by club level (league
   * tier, top division first) and then by the reputation each looks for. Reserve and B teams never offer it. Browser
   * play-through, 16 November 2026: a Confident coach of a top club received 24 offers, second divisions and a reserve
   * team among them. A reversible default.
   */
  maxJobOffers: 5,
});

/** The rules of new careers: `career-3` (format 69). */
export const CAREER_MODEL = 'career-3' as const;
/** Format 63 careers: the same rules without unemployment; a dismissed or resigning manager always receives an offer. */
export const CAREER_2_MODEL = 'career-2' as const;
/** Format 69 (`career-3`): the club id of no club, while the manager is unemployed. */
export const NO_CLUB = '' as const;

/** Whether a career follows the format-63 rules above (`career-2`, and `career-3` which adds unemployment). */
export function usesCareerRules(career: Pick<SeasonCareer, 'model'> | null | undefined): boolean {
  return career?.model === CAREER_2_MODEL || career?.model === CAREER_MODEL;
}

/** Whether a career may sit out periods without a club (`career-3`, format 69). */
export function allowsUnemployment(career: Pick<SeasonCareer, 'model'> | null | undefined): boolean {
  return career?.model === CAREER_MODEL;
}

/** Whether the manager is between jobs now (`career-3` careers only). */
export function isUnemployed(state: { managedClubId: string; career?: Pick<SeasonCareer, 'model'> | null }): boolean {
  return state.managedClubId === NO_CLUB && allowsUnemployment(state.career);
}

/**
 * Career-3: reputation after `days` without a club, from the reputation the manager left with. It moves
 * `unemployedFadePoints` every `unemployedFadeDays` towards `unemployedReputationLevel` and never passes it.
 */
export function fadedReputation(base: number, days: number): number {
  const level = CAREER_RULES.unemployedReputationLevel, steps = Math.floor(Math.max(0, days) / CAREER_RULES.unemployedFadeDays) * CAREER_RULES.unemployedFadePoints;
  return base > level ? Math.max(level, base - steps) : Math.min(level, base + steps);
}

/** Regular-season games a club must have played before an in-season review can end its coach's job. */
export function midSeasonMinimumGames(games: number): number {
  return Math.ceil(games * CAREER_RULES.midSeasonGamesShare);
}

const PHASES: readonly CareerMovePhase[] = ['season', 'end', 'offseason'];
/** Moves and restarts as one order: season, then week (a move before week X sorts at X), then phase. */
export function careerPointKey(seasonNumber: number, round: number, phase: CareerMovePhase): number {
  return (seasonNumber * 1_000 + round) * 3 + PHASES.indexOf(phase);
}

/** The season in which a restart's coach is protected: the season of an in-season change, otherwise the next one. */
export function protectedSeasonOf(restart: Pick<BoardRestart, 'seasonNumber' | 'phase'>): number {
  return restart.phase === 'season' ? restart.seasonNumber : restart.seasonNumber + 1;
}

/** Restarts recorded before the given point (a move or restart at the same point is not before it). */
export function restartsBefore(board: Pick<SeasonBoard, 'restarts'>, seasonNumber: number, round: number, phase: CareerMovePhase): BoardRestart[] {
  const key = careerPointKey(seasonNumber, round, phase);
  return (board.restarts ?? []).filter(restart => careerPointKey(restart.seasonNumber, restart.round, restart.phase) < key);
}

/** Whether a club's coach is in his protected first season, judged from the given restarts. */
export function coachProtected(restarts: readonly BoardRestart[], clubId: string, seasonNumber: number): boolean {
  const latest = restarts.filter(restart => restart.clubId === clubId).at(-1);
  return !!latest && protectedSeasonOf(latest) === seasonNumber;
}

/**
 * The confidence a club's next review moves from: a fresh start recorded after the latest review, otherwise the
 * latest review's confidence (50 before any review). Careers without restarts keep the Level 7 behaviour.
 */
export function startingConfidence(board: Pick<SeasonBoard, 'reviews' | 'restarts'>, clubId: string): number {
  const reviewCount = board.reviews.length;
  const restart = board.restarts?.filter(item => item.clubId === clubId && item.reviewCount === reviewCount).at(-1);
  return restart ? restart.confidence : board.reviews.at(-1)?.clubs[clubId]?.confidence ?? 50;
}

/** Resignations before the given point that still cost reputation in `seasonNumber`. */
export function resignationsCounting(career: Pick<SeasonCareer, 'moves'> | undefined, seasonNumber: number, before = Infinity): CareerMove[] {
  return (career?.moves ?? []).filter(move => move.reason === 'resigned' && move.seasonNumber <= seasonNumber && move.seasonNumber > seasonNumber - CAREER_RULES.resignationSeasons
    && careerPointKey(move.seasonNumber, move.round ?? 0, move.phase ?? 'end') < before);
}

/** Plain-English summary of the rules, shared by the Board page and the desk. */
export const CAREER_RULES_TEXT = {
  protectedSeason: 'Your first season at a club is protected: the board will not dismiss you. If that season still ends Under pressure (below 30), you get a final warning instead, and the next season counts.',
  freshStart: `A new coach starts with board confidence ${CAREER_RULES.freshConfidence}, whatever the previous coach left behind.`,
  midSeason: `After a third of the regular season, a board whose confidence falls below ${CAREER_RULES.midSeasonDismissalBelow} at a review dismisses its coach at once (never in a protected first season). Rival clubs follow the same rule.`,
  seasonEnd: `A season that ends Under pressure (final confidence below ${CAREER_RULES.seasonDismissalBelow}) ends your job, unless it was your protected first season.`,
  resignation: `You can resign at any time between matches. It costs ${CAREER_RULES.resignationReputationCost} reputation points for three seasons, and you choose your next club from the jobs offered at once; there is always at least one.`,
  /** Career-3 careers (format 69). */
  resignation3: `You can resign at any time between matches. It costs ${CAREER_RULES.resignationReputationCost} reputation points for three seasons. Clubs whose board is Under pressure may offer you their job at once; you can also leave without a new job and wait for one.`,
  unemployed: `Without a club, the career goes on: every club, including your last one, is run automatically and every competition keeps playing. Boards that change coach during a season keep the job open to you for ${CAREER_RULES.vacancyOpenWeeks} weeks, and jobs opened at a season end stay open through the offseason. A club offers you its job when your reputation reaches what it looks for.`,
  fade: `While you are without a club, your reputation moves ${CAREER_RULES.unemployedFadePoints} point every ${CAREER_RULES.unemployedFadeDays / 7} weeks towards ${CAREER_RULES.unemployedReputationLevel}: a good name fades, a poor one is slowly forgotten.`,
  /** Who offers a job (browser play-through, 16 November 2026). */
  offers: `At most ${CAREER_RULES.maxJobOffers} clubs offer you their job at a time: those in the highest division first, then those looking for the strongest reputation. Reserve and B teams never offer it.`,
  dismissal3: 'After a dismissal, only clubs that are replacing their own coach can offer you a job. You may take one or decline them all and wait without a club.',
};
