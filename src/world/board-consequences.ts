import type { SeasonBoard } from '../domain/board';
import type { SeasonState } from '../domain/season';
import { getDevelopmentPresident } from '../data/development-presidents';
import { STAFF_BUDGET } from './staff-constants';

/** The board's end-of-season judgement, named after the confidence labels shown throughout the game. */
export type BoardVerdict = 'confident' | 'steady' | 'concerned' | 'pressure';

/**
 * The final confidence of a season sets the next season's shared staff budget and the owner's capital for facility
 * projects; with dismissal on, Under pressure also ends the manager's job. Signed contracts are never cut.
 */
export const BOARD_VERDICT_EFFECTS: Readonly<Record<BoardVerdict, { label: string; staffPercent: number; capitalPercent: number }>> = Object.freeze({
  confident: { label: 'Confident', staffPercent: 110, capitalPercent: 150 },
  steady: { label: 'Steady', staffPercent: 100, capitalPercent: 100 },
  concerned: { label: 'Concerned', staffPercent: 90, capitalPercent: 50 },
  pressure: { label: 'Under pressure', staffPercent: 80, capitalPercent: 0 },
});

export function verdictForConfidence(confidence: number): BoardVerdict {
  return confidence >= 65 ? 'confident' : confidence >= 45 ? 'steady' : confidence >= 30 ? 'concerned' : 'pressure';
}

export interface SeasonVerdict {
  clubId: string;
  seasonNumber: number;
  reviewId: string;
  date: string;
  confidence: number;
  verdict: BoardVerdict;
}

/** The verdict recorded by a season's final (matchday-ten) review; null when the club had no final review that season. */
export function seasonVerdict(board: Pick<SeasonBoard, 'reviews'>, clubId: string, seasonNumber: number): SeasonVerdict | null {
  const review = board.reviews.filter(item => item.seasonNumber === seasonNumber && item.round === 10).at(-1);
  const club = review?.clubs[clubId];
  if (!review || !club) return null;
  return { clubId, seasonNumber, reviewId: review.id, date: review.date, confidence: club.confidence, verdict: verdictForConfidence(club.confidence) };
}

/** Consequences govern only seasons that begin after they were switched on. */
export function boardConsequencesGovern(board: Partial<Pick<SeasonBoard, 'consequencesSince'>> | undefined, seasonNumber: number): boolean {
  const since = board?.consequencesSince;
  return !!since && seasonNumber > since.seasonNumber;
}

/** The previous season's verdict, when consequences govern this season. */
export function governingVerdict(state: Partial<Pick<SeasonState, 'board'>>, clubId: string, seasonNumber: number): SeasonVerdict | null {
  if (!state.board || !boardConsequencesGovern(state.board, seasonNumber)) return null;
  return seasonVerdict(state.board, clubId, seasonNumber - 1);
}

const scaled = (amount: number, percent: number) => Math.round(amount * percent / 100);

/** The budgets a verdict gives a club; standard budgets without one. Also used to preview an unfinished season. */
export function verdictBudgets(clubId: string, verdict: BoardVerdict | null): { staff: number; capital: number } {
  const effect = BOARD_VERDICT_EFFECTS[verdict ?? 'steady'];
  return { staff: scaled(STAFF_BUDGET, effect.staffPercent), capital: scaled(getDevelopmentPresident(clubId).seasonCapital, effect.capitalPercent) };
}

/** The shared annual staff allocation for a club and season, in euro cents. */
export function staffAllocation(state: Partial<Pick<SeasonState, 'board'>> & Pick<SeasonState, 'seasonNumber'>, clubId: string, seasonNumber = state.seasonNumber): number {
  const verdict = governingVerdict(state, clubId, seasonNumber);
  return verdict ? scaled(STAFF_BUDGET, BOARD_VERDICT_EFFECTS[verdict.verdict].staffPercent) : STAFF_BUDGET;
}

/** The owner's capital for facility projects in a season, in euro cents. */
export function ownerCapital(state: Partial<Pick<SeasonState, 'board'>> & Pick<SeasonState, 'seasonNumber'>, clubId: string, seasonNumber = state.seasonNumber): number {
  return verdictBudgets(clubId, governingVerdict(state, clubId, seasonNumber)?.verdict ?? null).capital;
}
