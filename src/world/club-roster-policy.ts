import type { WorldContext } from '../domain/world';
import { FULL_ROSTER_MODEL, MAX_CLUB_ROSTER_SIZE } from '../domain/roster';
import type { SeasonState } from '../domain/season';
import { knownMoneySeason, salaryBudgetRatio } from './economy';
import { isNbaClub } from './career-world';
import { NBA_CAP_RULES } from './nba-cap';
import { nbaOwnerCeiling } from './nba-owner';

export const usesFullClubRoster = (context: WorldContext): boolean => context.world?.rosterModel === FULL_ROSTER_MODEL;
/** Format 92 (`world.nba.cap`): an NBA club under the NBA's money rules (cap, rosters of 13-15, luxury tax). */
export const isCapClub = (context: WorldContext, clubId: string | null | undefined): boolean => !!clubId && context.world?.nba?.cap === 'nba-cap-1' && isNbaClub(context.world, clubId);
/** The most players a club may contract; NBA clubs under the cap rules (format 92) carry at most 15 standard contracts. */
export const clubRosterLimit = (context: WorldContext, clubId?: string | null): number => isCapClub(context, clubId) ? NBA_CAP_RULES.roster.max : usesFullClubRoster(context) ? MAX_CLUB_ROSTER_SIZE : 12;
/** Keep legacy decision text stable because historical offer replies retain it. */
export const clubRosterLimitText = (context: WorldContext, clubId?: string | null): string => isCapClub(context, clubId) ? String(NBA_CAP_RULES.roster.max) : usesFullClubRoster(context) ? String(MAX_CLUB_ROSTER_SIZE) : 'twelve';
/** The fewest players a club must contract for a season: eight, or 13 for NBA clubs under the cap rules (format 92). */
export const minRosterSize = (context: WorldContext, clubId: string | null | undefined): number => isCapClub(context, clubId) ? NBA_CAP_RULES.roster.min : 8;
/** The words for the minimum squad in guard texts ("eight" as before; "13" for NBA clubs). */
export const minRosterText = (context: WorldContext, clubId: string | null | undefined): string => isCapClub(context, clubId) ? String(NBA_CAP_RULES.roster.min) : 'eight';
export const clubRosterTarget = (context: WorldContext, clubId: string, legacyTarget = 10): number => {
  if (!usesFullClubRoster(context)) return legacyTarget;
  const size = context.world!.clubs.find(club => club.id === clubId)!.players.length;
  return isCapClub(context, clubId) ? Math.max(NBA_CAP_RULES.roster.min, Math.min(NBA_CAP_RULES.roster.max, size)) : size;
};

/**
 * New worlds fund their whole imported roster. This is an estimated annual allocation, never a cash balance. Format 72:
 * in careers with per-season club money it follows the season's player wage bill (`salaryBudgetRatio`), from the
 * figures known by `knownThrough` (by default the context's season, or the next one once that season is complete and
 * has decided it; a later contract season reads the latest known).
 */
export function clubSalaryBudget(context: WorldContext & { status?: SeasonState['status'] }, clubId: string, seasonNumber = context.seasonNumber ?? 1, knownThrough = knownMoneySeason(context, seasonNumber)): number {
  const world = context.world;
  if (!usesFullClubRoster(context) || !world) return 24_000_000;
  // Format 92: an NBA club's player wages pool is its owner's payroll ceiling (`nba-cap-policy.ts`).
  if (isCapClub(context, clubId)) return nbaOwnerCeiling(world, clubId);
  const club = world.clubs.find(club => club.id === clubId);
  if (!club) throw new Error('Choose a club in this career.');
  const openingWages = club.players.reduce((sum, player) => sum + world.wages[player.id]!, 0);
  const ratio = salaryBudgetRatio(context, clubId, seasonNumber, knownThrough);
  return Math.max(24_000_000, Math.ceil((ratio === 1 ? openingWages * 1.1 : openingWages * 1.1 * ratio) / 500_000) * 500_000);
}

/**
 * Format 72: the largest salary allocation a club had for contracts of `seasonNumber` at any point up to it. Agreed
 * wages stay when the allocation falls (relegation), so registrations are checked against this ceiling.
 */
export function clubSalaryCeiling(context: WorldContext, clubId: string, seasonNumber: number): number {
  if (!context.economySeasons) return clubSalaryBudget(context, clubId, seasonNumber, seasonNumber);
  let ceiling = 0;
  for (let known = 1; known <= seasonNumber; known += 1) ceiling = Math.max(ceiling, clubSalaryBudget(context, clubId, seasonNumber, known));
  return ceiling;
}
