import type { FacilityProject } from '../domain/facilities';
import type { SeasonState } from '../domain/season';
import type { WorldContext } from '../domain/world';
import { seasonRounds } from './career-world';
import { addCalendarDays, calendarDaysBetween } from './competition-calendar';
import { dateForRound } from './season';

/**
 * Owner feedback (11): how long a facility project still needs, read from its saved dates only. A project completes at
 * the first calendar step on or after its planned date (`processFacilityProjects`). During a season every step is a
 * week's Saturday, so it completes on the first Saturday on or after `dueOn`. When that Saturday falls after the
 * season's last week, or the season is over, the offseason calendar or next season's opening day decides the day, so
 * only the earliest day is known.
 */
export interface FacilityProjectSchedule {
  /** The Saturday it completes this season, or the earliest planned day when completion falls after the season. */
  completesOn: string;
  /** False when completion falls after the season's last week: `completesOn` is then the earliest day. */
  inSeason: boolean;
  /** Whole weeks from today until `completesOn` (at least this many when not `inSeason`). */
  weeksLeft: number;
  /** Whole weeks from the start until `completesOn`, never below one. */
  weeksTotal: number;
}

const weeksBetween = (from: string, to: string) => Math.max(0, Math.ceil(calendarDaysBetween(from, to) / 7));

export function facilityProjectSchedule(state: Pick<SeasonState, 'date' | 'status' | 'seasonNumber'> & WorldContext, project: Pick<FacilityProject, 'startedOn' | 'dueOn'>): FacilityProjectSchedule {
  const saturday = addCalendarDays(project.dueOn, (6 - new Date(`${project.dueOn}T00:00:00Z`).getUTCDay() + 7) % 7);
  const inSeason = state.status === 'active' && saturday <= dateForRound(seasonRounds(state), state.seasonNumber);
  const completesOn = inSeason ? saturday : project.dueOn;
  return { completesOn, inSeason, weeksLeft: weeksBetween(state.date, completesOn), weeksTotal: Math.max(1, weeksBetween(project.startedOn, completesOn)) };
}
