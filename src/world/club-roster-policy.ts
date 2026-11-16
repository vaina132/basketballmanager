import type { WorldContext } from '../domain/world';
import { FULL_ROSTER_MODEL, MAX_CLUB_ROSTER_SIZE } from '../domain/roster';
import { salaryBudgetRatio } from './economy';

export const usesFullClubRoster = (context: WorldContext): boolean => context.world?.rosterModel === FULL_ROSTER_MODEL;
export const clubRosterLimit = (context: WorldContext): number => usesFullClubRoster(context) ? MAX_CLUB_ROSTER_SIZE : 12;
/** Keep legacy decision text stable because historical offer replies retain it. */
export const clubRosterLimitText = (context: WorldContext): string => usesFullClubRoster(context) ? String(MAX_CLUB_ROSTER_SIZE) : 'twelve';
export const clubRosterTarget = (context: WorldContext, clubId: string, legacyTarget = 10): number => usesFullClubRoster(context) ? context.world!.clubs.find(club => club.id === clubId)!.players.length : legacyTarget;

/**
 * New worlds fund their whole imported roster. This is an estimated annual allocation, never a cash balance. Format 72:
 * in careers with per-season club money it follows the season's player wage bill (`salaryBudgetRatio`), from the
 * figures known by `knownThrough` (the context's season by default; a later contract season reads the latest known).
 */
export function clubSalaryBudget(context: WorldContext, clubId: string, seasonNumber = context.seasonNumber ?? 1, knownThrough = context.seasonNumber ?? seasonNumber): number {
  const world = context.world;
  if (!usesFullClubRoster(context) || !world) return 24_000_000;
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
