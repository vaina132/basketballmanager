import type { PlayerKnowledge, ScoutingAssignmentQuote, ScoutingRanges } from '../domain/scouting';
import type { SeasonState } from '../domain/season';
import type { PlayerAttributes } from '../domain/types';
import { DEVELOPMENT_PLAYERS, getDevelopmentPlayer } from '../data/development-players';

export const SCOUTING_CAPACITY = 2;
export const MAX_KNOWLEDGE_LEVEL = 3;
export const SCOUTING_ATTRIBUTES = ['twoPoint', 'threePoint', 'freeThrow', 'passing', 'defense', 'rebounding', 'stamina'] as const;

/** The same rating projection as training, without importing world orchestration. */
export function scoutingActualAttributes(state: Pick<SeasonState, 'training'>, playerId: string): PlayerAttributes {
  const player = getDevelopmentPlayer(playerId);
  return Object.fromEntries(SCOUTING_ATTRIBUTES.map(attribute => [attribute, Math.min(20, player.attributes[attribute] + Math.floor((state.training.points[playerId]?.[attribute] ?? 0) / 100))])) as unknown as PlayerAttributes;
}

function stableBias(seed: number, clubId: string, playerId: string, attribute: string): number {
  let hash = (2166136261 ^ seed) >>> 0;
  for (const character of `scouting:${clubId}:${playerId}:${attribute}`) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  return hash % 3 - 1;
}

/** Stable observer bias survives repeat visits; uncertainty never becomes a singleton. */
export function scoutingRanges(seed: number, clubId: string, playerId: string, attributes: PlayerAttributes, level: number, ageDays: number): ScoutingRanges {
  const width = 5 - level + Math.floor(Math.max(0, ageDays) / 28);
  return Object.fromEntries(SCOUTING_ATTRIBUTES.map(attribute => {
    const center = Math.max(1, Math.min(20, attributes[attribute] + stableBias(seed, clubId, playerId, attribute)));
    return [attribute, { min: Math.max(1, center - width), max: Math.min(20, center + width) }];
  })) as ScoutingRanges;
}

export function getPlayerKnowledge(state: SeasonState, playerId: string, clubId = state.managedClubId): PlayerKnowledge {
  getDevelopmentPlayer(playerId);
  const owner = state.clubs.find(club => club.players.some(player => player.id === playerId));
  if (owner?.id === clubId) return { playerId, kind: 'own', level: 3, attributes: scoutingActualAttributes(state, playerId), ranges: null, observedOn: state.date, observedClubId: clubId, ageDays: 0, freshness: 'current', source: 'squad', observations: 0 };
  const empty: PlayerKnowledge = { playerId, kind: 'unknown', level: 0, attributes: null, ranges: null, observedOn: null, observedClubId: null, ageDays: null, freshness: 'unknown', source: null, observations: 0 };
  if (!state.scouting.enabledSince) return empty;
  const knowledge = state.scouting.clubs[clubId];
  if (!knowledge) return empty;
  const reviews = knowledge.reviews.filter(review => review.playerId === playerId && review.outcome === 'observed');
  const review = reviews.at(-1), own = knowledge.squadKnowledge[playerId];
  const useOwn = own && (!review || own.date >= review.date);
  const source = useOwn ? own : review;
  if (!source?.attributes) return empty;
  const level = (useOwn || own ? 3 : Math.min(3, reviews.length)) as 1 | 2 | 3;
  const ageDays = Math.max(0, Math.round((Date.parse(`${state.date}T00:00:00Z`) - Date.parse(`${source.date}T00:00:00Z`)) / 86_400_000));
  return { playerId, kind: 'report', level, attributes: null, ranges: scoutingRanges(state.seed, clubId, playerId, source.attributes, level, ageDays), observedOn: source.date, observedClubId: source.clubId, ageDays, freshness: ageDays <= 28 ? 'recent' : ageDays <= 84 ? 'aging' : 'stale', source: useOwn ? 'squad' : 'observation', observations: reviews.length };
}

export function quoteScoutingAssignment(state: SeasonState, playerId: string, clubId = state.managedClubId): ScoutingAssignmentQuote {
  const club = state.scouting.clubs[clubId];
  const owner = state.clubs.find(club => club.players.some(player => player.id === playerId));
  let reason: string | null = null;
  if (!state.scouting.enabledSince) reason = 'Enable scouting before assigning observations.';
  else if (!club || !DEVELOPMENT_PLAYERS.some(player => player.id === playerId)) reason = 'Choose a club and player in this league.';
  else if (state.status !== 'active') reason = 'New observations become available when the next season starts.';
  else if (!owner) reason = 'This player needs a registered club and a scheduled match before he can be observed.';
  else if (owner.id === clubId) reason = 'Your own squad already has exact skill assessments.';
  else if (club.assignments.some(assignment => assignment.playerId === playerId)) reason = 'This player already has a pending assignment.';
  else if (club.assignments.length >= SCOUTING_CAPACITY) reason = 'Both scouting assignments are occupied for this matchday.';
  else if (club.reviews.some(review => review.playerId === playerId && review.seasonNumber === state.seasonNumber && review.round === state.round)) reason = 'This player has already been reviewed on this matchday.';
  return { playerId, clubId, canAssign: reason === null, reason };
}

/** Unknown outsiders receive a neutral prior, never a peek at catalog skill ratings. */
export function scoutingRecruitmentRating(state: SeasonState, clubId: string, playerId: string): number {
  const knowledge = getPlayerKnowledge(state, playerId, clubId);
  if (knowledge.attributes) return SCOUTING_ATTRIBUTES.reduce((sum, attribute) => sum + knowledge.attributes![attribute], 0);
  if (knowledge.ranges) return SCOUTING_ATTRIBUTES.reduce((sum, attribute) => sum + (knowledge.ranges![attribute].min + knowledge.ranges![attribute].max) / 2, 0);
  return 10.5 * SCOUTING_ATTRIBUTES.length;
}
