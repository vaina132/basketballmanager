import type { AcademyWeek, AcademyWeekOutcome, AcademyWeekPlayer } from '../domain/academy';
import type { SeasonState } from '../domain/season';
import { managedClubAtRound, managedClubFor } from './career';

type AcademyHistoryState = Pick<SeasonState, 'seasonNumber' | 'managedClubId' | 'career' | 'academy'>;

/** Retention decisions shared by rollover, migration and strict history validation. */
export interface AcademyHistoryContext {
  readonly seasonNumber: number;
  readonly latestWeekId: string | undefined;
  readonly latestWeekByClub: ReadonlyMap<string, string>;
  readonly managedClubBySeason: ReadonlyMap<number, string>;
  /** The club the manager ran in a week; later moves never change it (format 73). */
  readonly managedAt: (seasonNumber: number, round: number) => string;
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
  return { seasonNumber: state.seasonNumber, latestWeekId: state.academy.weeks.at(-1)?.id, latestWeekByClub, managedClubBySeason, managedAt: (seasonNumber, round) => managedClubAtRound(state, seasonNumber, round) };
}

/**
 * Each club's latest report and the reports of clubs the manager ran must remain available for review. Format 73
 * (step 3.7): a rival's older report of the current season is summarized weekly too, when the manager did not run
 * that club in the report's week; once summarizable, a report stays so (later weeks and moves never change it).
 */
export function canSummarizeAcademyReport(context: AcademyHistoryContext, week: AcademyWeek, player: AcademyWeekPlayer): boolean {
  if (week.id === context.latestWeekId || week.id === context.latestWeekByClub.get(player.clubId)) return false;
  if (player.clubId !== context.managedAt(week.seasonNumber, week.afterRound) && player.clubId !== context.managedAt(week.seasonNumber, week.afterRound + 1)) return true;
  return week.seasonNumber < context.seasonNumber && player.clubId !== context.managedClubBySeason.get(week.seasonNumber);
}

/** A fresh projection, never a replacement for checking the original report or its development rules. */
export function summarizeAcademyPlayer(player: AcademyWeekPlayer): AcademyWeekOutcome {
  return { detail: 'outcome', clubId: player.clubId, focus: player.focus, pointsAfter: { ...player.pointsAfter } };
}

/**
 * Reduce rival reports that are no longer any club's latest (completed seasons, and from format 73 the current one). Every week, player, instruction and exact accumulated point total
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
