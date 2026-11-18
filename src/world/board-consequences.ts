import type { SeasonBoard } from '../domain/board';
import type { SeasonState } from '../domain/season';
import type { CareerWorld, WorldContext } from '../domain/world';
import { clubPresident, seasonRounds, worldOf } from './career-world';
import { STAFF_BUDGET } from './staff-constants';
import { clubEconomy, moneyAt, scaledMoney } from './economy';
import { clubSalaryBudget, clubSalaryCeiling } from './club-roster-policy';
import { salaryVerdictPercent, usesPresidentBoard } from './presidents';

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
  return verdictOnLine(confidence, undefined);
}

/** Format 70: the verdict on a club's own scale; board-2 careers move the Under pressure line with the president's patience. */
export function verdictOnLine(confidence: number, pressureBelow: number | undefined): BoardVerdict {
  return confidence >= 65 ? 'confident' : confidence >= 45 ? 'steady' : confidence >= (pressureBelow ?? 30) ? 'concerned' : 'pressure';
}

export interface SeasonVerdict {
  clubId: string;
  seasonNumber: number;
  reviewId: string;
  date: string;
  confidence: number;
  verdict: BoardVerdict;
}

/** The verdict recorded by a season's final review (after its last matchday, `rounds`); null when the club had no final review that season. */
export function seasonVerdict(board: Pick<SeasonBoard, 'reviews'> & Partial<Pick<SeasonBoard, 'mandates'>>, clubId: string, seasonNumber: number, rounds: number): SeasonVerdict | null {
  const review = board.reviews.filter(item => item.seasonNumber === seasonNumber && item.round === rounds).at(-1);
  const club = review?.clubs[clubId];
  if (!review || !club) return null;
  // Format 70: the dismissal line frozen in that season's objectives (the president's patience); 30 otherwise.
  const pressureBelow = board.mandates?.find(mandate => mandate.id === review.mandateId)?.clubs[clubId]?.pressureBelow;
  return { clubId, seasonNumber, reviewId: review.id, date: review.date, confidence: club.confidence, verdict: verdictOnLine(club.confidence, pressureBelow) };
}

/** Consequences govern only seasons that begin after they were switched on. */
export function boardConsequencesGovern(board: Partial<Pick<SeasonBoard, 'consequencesSince'>> | undefined, seasonNumber: number): boolean {
  const since = board?.consequencesSince;
  return !!since && seasonNumber > since.seasonNumber;
}

/** The previous season's verdict, when consequences govern this season. */
export function governingVerdict(state: Partial<Pick<SeasonState, 'board'>> & WorldContext, clubId: string, seasonNumber: number): SeasonVerdict | null {
  if (!state.board || !boardConsequencesGovern(state.board, seasonNumber)) return null;
  return seasonVerdict(state.board, clubId, seasonNumber - 1, seasonRounds(state));
}

const scaled = (amount: number, percent: number) => Math.round(amount * percent / 100);

/**
 * The owner's standard capital for a season, before any verdict. The world records it at the club's opening money
 * level; with per-season club money (format 72) it follows the season's money level in the same proportion, in
 * EUR 100 steps, as the staff allocation does.
 */
export function presidentCapital(context: WorldContext, clubId: string, seasonNumber = context.seasonNumber): number {
  const world = worldOf(context), opening = clubPresident(world, clubId).seasonCapital;
  const before = clubEconomy({ world }, clubId), now = clubEconomy(moneyAt(context, seasonNumber), clubId);
  if (!before || !now || now.scale === before.scale) return opening;
  return Math.max(10_000, Math.round(opening * now.scale / before.scale / 10_000) * 10_000);
}

/**
 * The budgets a verdict gives a club for `seasonNumber`; standard budgets without one. Also used to preview an
 * unfinished season. Format 72: both follow the money figures known for that season (a season not yet decided reads
 * the latest figures known), for every club alike.
 */
export function verdictBudgets(context: WorldContext, clubId: string, verdict: BoardVerdict | null, seasonNumber = context.seasonNumber): { staff: number; capital: number } {
  const effect = BOARD_VERDICT_EFFECTS[verdict ?? 'steady'];
  return { staff: scaled(standardStaffAllocation(context, clubId, seasonNumber), effect.staffPercent), capital: scaled(presidentCapital(context, clubId, seasonNumber), effect.capitalPercent) };
}

/** Format 62: the standard staff allocation at the club's money level; format 72: the level of the season in question. */
const standardStaffAllocation = (context: WorldContext, clubId: string, seasonNumber: number | undefined): number => scaledMoney(moneyAt(context, seasonNumber), clubId, STAFF_BUDGET);

/** Format 70 (board-2): the player salary budget percent change a verdict brings, scaled by the president's generosity. */
export function verdictSalaryPercent(world: CareerWorld, clubId: string, verdict: BoardVerdict | null): number {
  return verdict ? salaryVerdictPercent(clubPresident(world, clubId).generosity, verdict) : 0;
}

/**
 * Format 70 (board-2): a club's player salary budget for a season. From the second season the previous season's
 * verdict changes the standard budget (`PRESIDENT_RULES.salary`). Until that verdict is given, contracts for the
 * season must fit the budget the worst verdict would leave, so a later verdict never puts signed terms over budget.
 * Older careers and clubs without a verdict keep the standard budget. AI clubs use the same guards.
 */
export function seasonSalaryBudget(context: SalaryBudgetContext, clubId: string, seasonNumber: number): number {
  return salaryBudgetBasis(context, clubId, seasonNumber).budget;
}

export interface SalaryBudgetBasis {
  standard: number;
  budget: number;
  /** Percent change from the standard budget. */
  percent: number;
  /** The previous season's verdict that set it; null for the standard budget or while provisional. */
  verdict: SeasonVerdict | null;
  /** Board-2 careers before the previous season's verdict: the budget the worst verdict would leave. */
  provisional: boolean;
  /** Whether season verdicts change this season's salary budget at all (board-2 careers from the second season). */
  governed: boolean;
}

/** How a season's player salary budget is set: the standard budget, a verdict's change, or the provisional figure. */
export function salaryBudgetBasis(context: SalaryBudgetContext, clubId: string, seasonNumber: number): SalaryBudgetBasis {
    // Format 72: the season's own club money figures set the standard budget before the verdict changes it.
  const standard = clubSalaryBudget(context, clubId, seasonNumber);
  const board = context.board;
  if (!board || !usesPresidentBoard(board) || !boardConsequencesGovern(board, seasonNumber)) return { standard, budget: standard, percent: 0, verdict: null, provisional: false, governed: false };
  // The verdict is known after the previous season's final review: later seasons, or that season once complete.
  const known = context.seasonNumber === undefined || context.seasonNumber >= seasonNumber || context.seasonNumber === seasonNumber - 1 && context.status === 'complete';
  const verdict = known ? seasonVerdict(board, clubId, seasonNumber - 1, seasonRounds(context)) : null;
  const percent = verdictSalaryPercent(worldOf(context), clubId, known ? verdict?.verdict ?? null : 'pressure');
  return { standard, budget: scaled(standard, 100 + percent), percent, verdict, provisional: !known, governed: true };
}

/** The most a season's salary budget can be under any verdict: the save check's bound for terms signed before a verdict. */
export function seasonSalaryCeiling(context: SalaryBudgetContext, clubId: string, seasonNumber: number): number {
  let ceiling = Math.max(clubSalaryBudget(context, clubId), clubSalaryCeiling(context, clubId, seasonNumber), seasonSalaryBudget({ ...context, seasonNumber: undefined, status: undefined }, clubId, seasonNumber));
  // Step 3.7: format 72 money figures change, so terms signed earlier met the verdict applied to the budget known then:
  // during a season its own figures, and once it is complete the next season's figures it decided.
  if (context.economySeasons) for (let known = 1; known <= seasonNumber; known += 1) for (const status of ['active', 'complete'] as const) ceiling = Math.max(ceiling, seasonSalaryBudget({ ...context, seasonNumber: known, status }, clubId, seasonNumber));
  return ceiling;
}

export type SalaryBudgetContext = WorldContext & { board?: Pick<SeasonBoard, 'model' | 'reviews' | 'consequencesSince'> & Partial<Pick<SeasonBoard, 'mandates'>>; seasonNumber?: number; status?: SeasonState['status'] };

/** The shared annual staff allocation for a club and season, in euro cents. */
export function staffAllocation(state: Partial<Pick<SeasonState, 'board'>> & Pick<SeasonState, 'seasonNumber'> & WorldContext, clubId: string, seasonNumber = state.seasonNumber): number {
  const verdict = governingVerdict(state, clubId, seasonNumber), standard = standardStaffAllocation(state, clubId, seasonNumber);
  return verdict ? scaled(standard, BOARD_VERDICT_EFFECTS[verdict.verdict].staffPercent) : standard;
}

/** Format 75: the most a season's staff budget can be under any verdict (the save check's bound for the wage pool). */
export function staffAllocationCeiling(context: WorldContext, clubId: string, seasonNumber: number): number {
  const standard = standardStaffAllocation(context, clubId, seasonNumber);
  return Math.max(...Object.values(BOARD_VERDICT_EFFECTS).map(effect => scaled(standard, Math.max(100, effect.staffPercent))));
}

/** The owner's capital for facility projects in a season, in euro cents (format 72: at that season's money level). */
export function ownerCapital(state: Partial<Pick<SeasonState, 'board'>> & Pick<SeasonState, 'seasonNumber'> & WorldContext, clubId: string, seasonNumber = state.seasonNumber): number {
  return verdictBudgets(state, clubId, governingVerdict(state, clubId, seasonNumber)?.verdict ?? null, seasonNumber).capital;
}
