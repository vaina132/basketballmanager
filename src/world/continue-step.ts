import type { SeasonEndDecision } from '../domain/career';
import type { SeasonState } from '../domain/season';
import { careerMovesGovern } from './career';
import type { SeasonEndOutlook } from './career-policy';
import { isUnemployed } from './career-rules';
import { seasonRounds } from './career-world';
import { clubRosterLimit } from './club-roster-policy';
import { getClubContractSummary, MIN_ROSTER_SIZE } from './employment-policy';
import { advanceMarket } from './market';
import { getMarketStartReason, getNextMarketDate } from './market-policy';
import { advanceSeason, MAX_SEASON_NUMBER, midSeasonDismissalPossible, previewSeasonEnd, rolloverSeason } from './season';

/**
 * What the one Continue control does next (owner request, 16 November 2026: one Continue button that moves the calendar
 * day by day). Each step is exactly one of the game's existing operations, so a run of steps reaches the same state as
 * the earlier continue buttons pressed in turn:
 * - `match`: the manager's match is not finished; Continue opens it (watch or simulate it as before).
 * - `round`: the next game day (`advanceSeason`), with the week's club business after its last game day.
 * - `market`: the next offseason recruitment day (`advanceMarket`).
 * - `rollover`: the next season (`rolloverSeason`), once nothing holds it up.
 * - `blocked`: nothing can move on until the manager acts; `reason` says what to do.
 */
export type ContinueAction =
  | { kind: 'match' }
  | { kind: 'round' }
  | { kind: 'market'; date: string }
  | { kind: 'rollover' }
  | { kind: 'blocked'; reason: string };

export function continueAction(state: SeasonState): ContinueAction {
  if (state.status === 'active') {
    const match = state.activeMatch;
    return match && (match.status !== 'finished' || match.requiredSubstitutions.length) ? { kind: 'match' } : { kind: 'round' };
  }
  if (state.seasonNumber >= MAX_SEASON_NUMBER) return { kind: 'blocked', reason: 'The calendar has reached its final supported season.' };
  if (state.market?.enabledSince) {
    const reason = getMarketStartReason(state), date = getNextMarketDate(state);
    if (!reason) return { kind: 'rollover' };
    return date ? { kind: 'market', date } : { kind: 'blocked', reason };
  }
  // Contracts without the dated market (older careers): next season's squad must fit the roster limits first.
  if (state.employment?.enabledSince && !isUnemployed(state)) {
    const size = getClubContractSummary(state, state.managedClubId, state.seasonNumber + 1).rosterSize, limit = clubRosterLimit(state);
    if (size < MIN_ROSTER_SIZE) return { kind: 'blocked', reason: `Sign ${MIN_ROSTER_SIZE - size} more ${MIN_ROSTER_SIZE - size === 1 ? 'player' : 'players'} for next season.` };
    if (size > limit) return { kind: 'blocked', reason: `The squad must contain no more than ${limit} players.` };
  }
  return { kind: 'rollover' };
}

/**
 * Format 63: a week whose review could end the manager's job (the final matchday, or a mid-season review within reach
 * of dismissal) is previewed first, so the manager can choose among job offers before it is committed.
 */
export function needsSeasonEndPreview(state: SeasonState): boolean {
  return !isUnemployed(state) && (state.round === seasonRounds(state) && careerMovesGovern(state.career, state.seasonNumber) || midSeasonDismissalPossible(state));
}

/** A step's result: the next state and the operation that made it, or the board's decision for the manager to answer first. */
export type ContinueStepResult = { state: SeasonState; step: 'round' | 'market' | 'rollover' } | { outlook: SeasonEndOutlook };

/**
 * One Continue step from `state`. `decided` is set once the manager answered the season-end choice (`decision` empty:
 * stay); the step then commits the week with that answer instead of previewing it again.
 */
export function runContinueStep(state: SeasonState, choice: { decided?: boolean; decision?: SeasonEndDecision } = {}): ContinueStepResult {
  const action = continueAction(state);
  if (action.kind === 'match') throw new Error('Finish the current match and resolve required decisions before continuing.');
  if (action.kind === 'blocked') throw new Error(action.reason);
  if (action.kind === 'round') {
    if (!choice.decided && needsSeasonEndPreview(state)) {
      const outlook = previewSeasonEnd(state);
      if (outlook && (outlook.dismissed || outlook.offers.length)) return { outlook };
    }
    return { state: advanceSeason(state, choice.decided ? choice.decision : undefined), step: 'round' };
  }
  return action.kind === 'market' ? { state: advanceMarket(state), step: 'market' } : { state: rolloverSeason(state), step: 'rollover' };
}
