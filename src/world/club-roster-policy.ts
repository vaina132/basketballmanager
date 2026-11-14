import type { WorldContext } from '../domain/world';
import { FULL_ROSTER_MODEL, MAX_CLUB_ROSTER_SIZE } from '../domain/roster';

export const usesFullClubRoster = (context: WorldContext): boolean => context.world?.rosterModel === FULL_ROSTER_MODEL;
export const clubRosterLimit = (context: WorldContext): number => usesFullClubRoster(context) ? MAX_CLUB_ROSTER_SIZE : 12;
/** Keep legacy decision text stable because historical offer replies retain it. */
export const clubRosterLimitText = (context: WorldContext): string => usesFullClubRoster(context) ? String(MAX_CLUB_ROSTER_SIZE) : 'twelve';
export const clubRosterTarget = (context: WorldContext, clubId: string, legacyTarget = 10): number => usesFullClubRoster(context) ? context.world!.clubs.find(club => club.id === clubId)!.players.length : legacyTarget;

/** New worlds fund their whole imported roster. This is an estimated annual allocation, never a cash balance. */
export function clubSalaryBudget(context: WorldContext, clubId: string): number {
  const world = context.world;
  if (!usesFullClubRoster(context) || !world) return 24_000_000;
  const club = world.clubs.find(club => club.id === clubId);
  if (!club) throw new Error('Choose a club in this career.');
  const openingWages = club.players.reduce((sum, player) => sum + world.wages[player.id]!, 0);
  return Math.max(24_000_000, Math.ceil(openingWages * 1.1 / 500_000) * 500_000);
}
