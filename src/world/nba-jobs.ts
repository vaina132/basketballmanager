import type { CareerWorld } from '../domain/world';
import type { RealCoach } from '../data/real-coaches';
import { isNbaClub } from './career-world';
import { COACH_LEVELS } from './coach-ratings';

/**
 * NBA step 10 (format 91, new careers in a world with the NBA, option `nbaJobs`, marker `world.nbaJobs`): NBA careers.
 *
 * - NBA clubs start with their real head coaches (`REAL_NBA_COACHES`, `REAL_NBA_COACH_POSTS`), rated by the format-82
 *   formula (`src/world/coach-ratings.ts`) at the NBA job level `COACH_LEVELS.nba`, a step above a EuroLeague club. An
 *   NBA championship weighs like a EuroLeague title in the record (`NBA_CHAMPIONSHIPS`).
 * - Job offers rank NBA clubs first, then EuroLeague clubs, then other top-division clubs, then lower divisions
 *   (`jobLevel`). Careers without the marker keep ordering by league tier alone.
 * - An NBA vacancy asks for a reputation of 70 from the league's best record down to 60 from its worst, or the usual
 *   requirement within the club's conference of 15 when that is higher (`nbaVacancyRequirement`). A manager below an
 *   NBA requirement is never handed that job as the job of last resort while a club outside the NBA can take him.
 *
 * Worlds without the NBA never carry the marker, so European careers are unchanged.
 */
export const NBA_JOBS_MODEL = 'nba-jobs-1' as const;

export const NBA_JOB_RULES = Object.freeze({
  /** Reputation an NBA vacancy asks for: the best regular-season record, and the worst. */
  bestRequirement: 70, weakestRequirement: 60,
  /** Job levels for offers (lower is better); other clubs keep their league's tier (1 top division, 2 second, ...). */
  nbaLevel: 0, euroleagueLevel: 0.5,
});

/** Whether this career has NBA careers (format 91). */
export const usesNbaJobs = (world: Pick<CareerWorld, 'nbaJobs'> | undefined | null): boolean => !!world?.nbaJobs;

/** Whether a club's job follows the NBA job rules in this world. */
export const isNbaJob = (world: CareerWorld | undefined | null, clubId: string): boolean => !!world && usesNbaJobs(world) && isNbaClub(world, clubId);

/**
 * The reputation an NBA vacancy asks for: 70 for the league's best record falling evenly to 60 for its worst, or the
 * usual requirement (25 for last place, 6 more for each place higher) within the club's conference, when higher.
 */
export function nbaVacancyRequirement(leaguePosition: number, leagueClubs: number, conferencePosition: number, conferenceClubs: number, base: number, step: number): number {
  const span = Math.max(1, leagueClubs - 1), { bestRequirement: best, weakestRequirement: weakest } = NBA_JOB_RULES;
  const floor = Math.round(best - (best - weakest) * (leaguePosition - 1) / span);
  return Math.max(floor, base + step * (conferenceClubs - conferencePosition));
}

/**
 * NBA championships won as a head coach by the NBA's head coaches in the data (widely known facts). The data's league
 * titles include them; `nbaCoachFacts` moves them to their own count, which weighs like a EuroLeague title.
 */
export const NBA_CHAMPIONSHIPS: Readonly<Record<string, number>> = Object.freeze({
  'coach-steve-kerr': 4, 'coach-erik-spoelstra': 2, 'coach-rick-carlisle': 1, 'coach-tyronn-lue': 1, 'coach-nick-nurse': 1, 'coach-joe-mazzulla': 1, 'coach-mark-daigneault': 1,
});

/** A real NBA head coach's facts for the formula: his NBA championships counted apart and the NBA job level. */
export function nbaCoachFacts(coach: RealCoach): RealCoach {
  const nba = Math.min(NBA_CHAMPIONSHIPS[coach.id] ?? 0, coach.titles.league);
  return { ...coach, level: COACH_LEVELS.nba, titles: { ...coach.titles, league: coach.titles.league - nba, ...(nba ? { nba } : {}) } };
}
