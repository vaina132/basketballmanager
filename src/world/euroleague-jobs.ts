import type { CareerWorld } from '../domain/world';

/**
 * Format 100 (provisional number; owner decision, 24 November 2026; new careers without the NBA, option `euroleagueJobs`,
 * marker `world.euroleagueJobs`): clubs playing in that season's EuroLeague are bigger jobs than other top-division
 * clubs, the order worlds with the NBA already use (format 91: NBA > EuroLeague clubs > other top division > lower
 * divisions).
 *
 * - Job offers rank that season's EuroLeague clubs first, then the tiers (`clubLevel` in `career-policy.ts`, with the
 *   format-91 level `NBA_JOB_RULES.euroleagueLevel`).
 * - A EuroLeague club's vacancy asks for the usual requirement for its place in its domestic table plus `premium` (one
 *   place higher), and at least `bestRequirement` from the top of the table falling evenly to `weakestRequirement`
 *   from the bottom (`euroleagueVacancyRequirement`): a collapsing EuroLeague club still wants a proven coach.
 * - A manager below a EuroLeague requirement is never handed that job as the job of last resort while another club can
 *   take him, as with NBA jobs (format 91), so a dismissed manager keeps the format-98 way back through ordinary clubs.
 *
 * Board expectations, coach ratings and the head-coach market do not read the job order: coaches already rate a
 * EuroLeague club above other top-division clubs in every world (`worldClubLevel`, format 82). Worlds with the NBA keep
 * the format-91 rules, and careers without the marker keep ordering by league tier alone and replay exactly.
 */
export const EUROLEAGUE_JOBS_MODEL = 'euroleague-jobs-1' as const;

export const EUROLEAGUE_JOB_RULES = Object.freeze({
  /** The lowest reputation a EuroLeague vacancy asks for: from the top of its domestic table, and from the bottom. */
  bestRequirement: 60, weakestRequirement: 50,
  /** Points above the usual requirement for the club's place (one place higher). */
  premium: 6,
});

/** Whether this career ranks EuroLeague clubs above other top-division clubs without the NBA (format 100). */
export const usesEuroleagueJobs = (world: Pick<CareerWorld, 'euroleagueJobs'> | undefined | null): boolean => !!world?.euroleagueJobs;

/** Whether a new career's world can carry the marker: domestic leagues and a EuroLeague, without the NBA. */
export const euroleagueJobsWorld = (world: CareerWorld): boolean => !!world.domesticLeagues && !world.nba && !!world.europeanCompetitions?.some(competition => competition.kind === 'euroleague');

/**
 * The reputation a EuroLeague club's vacancy asks for: the usual requirement for its place (`usual`) plus the premium,
 * and at least 60 from the top of its domestic table falling evenly to 50 from the bottom.
 */
export function euroleagueVacancyRequirement(position: number, leagueClubs: number, usual: number): number {
  const { bestRequirement: best, weakestRequirement: weakest, premium } = EUROLEAGUE_JOB_RULES;
  const span = Math.max(1, leagueClubs - 1);
  const floor = Math.round(best - (best - weakest) * (Math.min(leagueClubs, Math.max(1, position)) - 1) / span);
  return Math.max(floor, usual + premium);
}

/** Plain-English job rule for careers with the marker (format 100), shown after the offer rule. */
export function euroleagueJobsNote(world: CareerWorld | undefined | null): string {
  if (!usesEuroleagueJobs(world)) return '';
  const { bestRequirement, weakestRequirement, premium } = EUROLEAGUE_JOB_RULES;
  return ` Clubs playing in this season's Euro Elite League are the biggest jobs: they offer first, and look for ${premium} points more than other clubs in the same place, and never less than ${weakestRequirement} (${bestRequirement} at the top of their table).`;
}
