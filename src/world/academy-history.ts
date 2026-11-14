import type { AcademyWeek, AcademyWeekOutcome, AcademyWeekPlayer } from '../domain/academy';
import type { SeasonState } from '../domain/season';
import { managedClubFor } from './career';

type AcademyHistoryState = Pick<SeasonState, 'seasonNumber' | 'managedClubId' | 'career' | 'academy'>;

/** Retention decisions shared by rollover, migration and strict history validation. */
export interface AcademyHistoryContext {
  readonly seasonNumber: number;
  readonly latestWeekId: string | undefined;
  readonly latestWeekByClub: ReadonlyMap<string, string>;
  readonly managedClubBySeason: ReadonlyMap<number, string>;
}

export function isAcademyOutcome(player: AcademyWeekPlayer): player is AcademyWeekOutcome {
  return 'detail' in player && player.detail === 'outcome';
}

/** Build once per history operation, rather than rescanning every week for every player. */
export function createAcademyHistoryContext(state: AcademyHistoryState): AcademyHistoryContext {
  const latestWeekByClub = new Map<string, string>(), managedClubBySeason = new Map<number, string>();
  for (const week of state.academy.weeks) {
    for (const player of Object.values(week.players)) latestWeekByClub.set(player.clubId, week.id);
    if (!managedClubBySeason.has(week.seasonNumber)) managedClubBySeason.set(week.seasonNumber, managedClubFor(state, week.seasonNumber, false));
  }
  return { seasonNumber: state.seasonNumber, latestWeekId: state.academy.weeks.at(-1)?.id, latestWeekByClub, managedClubBySeason };
}

/** Full current-season, historical manager and latest club reports must remain available for review. */
export function canSummarizeAcademyReport(context: AcademyHistoryContext, week: AcademyWeek, player: AcademyWeekPlayer): boolean {
  return week.seasonNumber < context.seasonNumber
    && week.id !== context.latestWeekId
    && week.id !== context.latestWeekByClub.get(player.clubId)
    && player.clubId !== context.managedClubBySeason.get(week.seasonNumber);
}

/** A fresh projection, never a replacement for checking the original report or its development rules. */
export function summarizeAcademyPlayer(player: AcademyWeekPlayer): AcademyWeekOutcome {
  return { detail: 'outcome', clubId: player.clubId, focus: player.focus, pointsAfter: { ...player.pointsAfter } };
}

/**
 * Reduce only completed-season rival reports. Every week, player, instruction and exact accumulated point total
 * remains. Current prospects, graduate sources, youth fixtures and all command/finance boundaries are unchanged.
 * Existing full reports are valid too; calling this again without new eligible reports returns the same state.
 */
export function summarizeAcademyHistory(state: SeasonState): SeasonState {
  if (!state.academy.weeks.length) return state;
  const context = createAcademyHistoryContext(state);
  let changed = false;
  const weeks = state.academy.weeks.map(week => {
    let players: Record<string, AcademyWeekPlayer> | undefined;
    for (const [id, player] of Object.entries(week.players)) {
      if (isAcademyOutcome(player) || !canSummarizeAcademyReport(context, week, player)) continue;
      players ??= { ...week.players };
      players[id] = summarizeAcademyPlayer(player);
    }
    if (!players) return week;
    changed = true;
    return { ...week, players };
  });
  return changed ? { ...state, academy: { ...state.academy, weeks } } : state;
}
