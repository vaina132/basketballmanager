import type { PlayerKnowledge } from '../domain/scouting';
import type { Scout } from '../domain/scouts';
import type { SeasonState } from '../domain/season';
import type { Position } from '../domain/types';
import { getActiveCareerPlayers } from './player-catalog';
import { DEVELOPMENT_SCOUTS } from '../data/development-scouts';
import { getClubScouts } from './scout-policy';
import { abilityRating } from './performance-rating';
import { SCOUT_DIRECTORY, staffMember } from '../data/staff-directory';
import { scoutingDiscoveryPercent } from './facilities-policy';

export const BASE_SCOUTING_DISCOVERY = 20;

/** A larger staff and stronger assessment/reporting skills extend the identity pool. */
export function scoutDiscoveryContribution(scout: Scout): number {
  return 2 + Math.floor((scout.skills.evaluation + scout.skills.reporting) / 2);
}

function identityOrder(clubId: string, playerId: string): number {
  let hash = 2166136261;
  for (const character of `discovery:${clubId}:${playerId}`) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  return hash;
}

function outsiderIds(state: SeasonState, clubId: string): string[] {
  const own = new Set(state.clubs.find(club => club.id === clubId)?.players.map(player => player.id) ?? []);
  return getActiveCareerPlayers(state).filter(player => !own.has(player.id)).map(player => player.id)
    .sort((left, right) => identityOrder(clubId, left) - identityOrder(clubId, right) || left.localeCompare(right, 'en'));
}

export interface ScoutingDiscovery {
  playerIds: string[];
  networkPlayerIds: string[];
  baselineOutsideCount: number;
  networkOutsideCount: number;
  totalOutsideCount: number;
  retainedOutsideCount: number;
  scoutCount: number;
}

/** Discovery controls browsing only. It does not grant ability knowledge or alter commands. */
export function getScoutingDiscovery(state: SeasonState, clubId = state.managedClubId): ScoutingDiscovery {
  const outsiders = outsiderIds(state, clubId);
  const scouts = state.scouts.enabledSince ? getClubScouts(state, clubId) : [];
  // Format 65: the club's scouting office widens the pool by a condition-scaled share.
  const staffed = BASE_SCOUTING_DISCOVERY + scouts.reduce((sum, contract) => sum + scoutDiscoveryContribution(staffMember(SCOUT_DIRECTORY, contract.scoutId)!), 0);
  const capacity = Math.floor(staffed * (100 + scoutingDiscoveryPercent(state, clubId)) / 100);
  const networkPlayerIds = outsiders.slice(0, capacity);
  const visible = new Set(networkPlayerIds);
  for (const player of state.clubs.find(club => club.id === clubId)?.players ?? []) visible.add(player.id);
  const office = state.scouting.clubs[clubId];
  for (const playerId of office?.shortlist ?? []) visible.add(playerId);
  for (const assignment of office?.assignments ?? []) visible.add(assignment.playerId);
  for (const review of office?.reviews ?? []) visible.add(review.playerId);
  for (const playerId of Object.keys(office?.squadKnowledge ?? {})) visible.add(playerId);
  const network = new Set(networkPlayerIds);
  return {
    playerIds: getActiveCareerPlayers(state).filter(player => visible.has(player.id)).map(player => player.id), networkPlayerIds,
    baselineOutsideCount: Math.min(BASE_SCOUTING_DISCOVERY, outsiders.length), networkOutsideCount: networkPlayerIds.length,
    totalOutsideCount: outsiders.length, retainedOutsideCount: outsiders.filter(id => visible.has(id) && !network.has(id)).length,
    scoutCount: scouts.length,
  };
}

/** Preview the actual extra visible identities, excluding already retained targets. */
export function scoutDiscoveryGain(state: SeasonState, scout: Scout, clubId = state.managedClubId): { rangeIncrease: number; newPlayers: number } {
  const current = getScoutingDiscovery(state, clubId), visible = new Set(current.playerIds);
  const extended = outsiderIds(state, clubId).slice(0, current.networkOutsideCount + scoutDiscoveryContribution(scout));
  return { rangeIncrease: extended.length - current.networkOutsideCount, newPlayers: extended.filter(id => !visible.has(id)).length };
}

export type ScoutingListSort = 'name-asc' | 'name-desc' | 'age-asc' | 'age-desc' | 'rating-asc' | 'rating-desc';
export interface ScoutingSortEntry { id: string; name: string; position: Position; age: number | null; knowledge: PlayerKnowledge }

/** Unknowns stay last in both directions; estimated ability uses conservative bounds. */
export function compareScoutingPlayers(left: ScoutingSortEntry, right: ScoutingSortEntry, sort: ScoutingListSort): number {
  const byName = left.name.localeCompare(right.name, 'en') || left.id.localeCompare(right.id, 'en');
  if (sort.startsWith('name')) return sort === 'name-desc' ? -byName : byName;
  if (sort.startsWith('age')) {
    if (left.age === null || right.age === null) return left.age === right.age ? byName : left.age === null ? 1 : -1;
    return (sort === 'age-desc' ? right.age - left.age : left.age - right.age) || byName;
  }
  const first = abilityRating(left.knowledge, { position: left.position }), second = abilityRating(right.knowledge, { position: right.position });
  if (first.kind === 'unknown' || second.kind === 'unknown') return first.kind === second.kind ? byName : first.kind === 'unknown' ? 1 : -1;
  return (sort === 'rating-desc' ? second.low! - first.low! || second.high! - first.high! : first.high! - second.high! || first.low! - second.low!) || byName;
}
