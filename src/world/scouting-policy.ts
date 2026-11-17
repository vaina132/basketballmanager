import { financeLedgerCount } from './finance-ledger';
import type { PlayerKnowledge, ScoutingAssignmentQuote, ScoutingRanges, ScoutingReview } from '../domain/scouting';
import type { SeasonState } from '../domain/season';
import type { PlayerAttributes } from '../domain/types';
import { applyAgingAttributes, isPlayerRetired } from './lifecycle-policy';
import { getCareerPlayer, getCareerPlayers, type CareerPlayerContext } from './player-catalog';
import { DEVELOPMENT_SCOUTS } from '../data/development-scouts';
import { getClubScouts, scoutEvidence } from './scout-policy';
import { SCOUT_DIRECTORY, staffMember } from '../data/staff-directory';
import { potentialAttributes, trainingHeadroom } from './potential';
import { scoutingEvidencePercent } from './facilities-policy';

export const SCOUTING_CAPACITY = 2;
export const MAX_KNOWLEDGE_LEVEL = 3;
export const SCOUTING_ATTRIBUTES = ['twoPoint', 'threePoint', 'freeThrow', 'passing', 'defense', 'rebounding', 'stamina'] as const;

export function getScoutingEvidence(review: ScoutingReview): number { return review.outcome === 'observed' ? review.observer?.evidence ?? 100 : 0; }

/**
 * The evidence an observation gives the observing club: its recorded evidence plus the club's scouting office on the
 * review date (format 65, `scoutingEvidencePercent`). Recorded reviews keep their original evidence.
 */
export function clubScoutingEvidence(state: SeasonState, clubId: string, review: ScoutingReview): number {
  const evidence = getScoutingEvidence(review), bonus = evidence ? scoutingEvidencePercent(state, clubId, review.date) : 0;
  // Format 74: a Very Poor or Poor scouting office (a negative percent) gives less evidence.
  return bonus !== 0 ? Math.floor(evidence * (100 + bonus) / 100) : evidence;
}

export function getScoutingCapacity(state: SeasonState, clubId = state.managedClubId): number {
  return SCOUTING_CAPACITY + (state.scouts.enabledSince ? getClubScouts(state, clubId).length : 0);
}

export interface ScoutingObserverOption { contractId: string | null; scoutId: string | null; name: string; evidence: number; available: boolean; reason: string | null }
export function getScoutingObservers(state: SeasonState, clubId = state.managedClubId): ScoutingObserverOption[] {
  const club = state.scouting.clubs[clubId];
  const baselineUsed = (club?.assignments ?? []).filter(assignment => !assignment.observer?.contractId).length + (club?.reviews ?? []).filter(review => review.seasonNumber === state.seasonNumber && review.round === state.round && !review.observer?.contractId).length;
  const baseline: ScoutingObserverOption = { contractId: null, scoutId: null, name: 'Club observation', evidence: 100, available: baselineUsed < SCOUTING_CAPACITY, reason: baselineUsed < SCOUTING_CAPACITY ? null : 'Both club observation slots are occupied for this matchday.' };
  if (!state.scouts.enabledSince) return [baseline];
  return [baseline, ...getClubScouts(state, clubId).map(contract => {
    const scout = staffMember(SCOUT_DIRECTORY, contract.scoutId)!;
    const busy = club?.assignments.some(assignment => assignment.observer?.scoutId === scout.id) || club?.reviews.some(review => review.seasonNumber === state.seasonNumber && review.round === state.round && review.observer?.scoutId === scout.id);
    return { contractId: contract.id, scoutId: scout.id, name: scout.name, evidence: scoutEvidence(scout), available: !busy, reason: busy ? 'This scout already has an observation for this matchday.' : null };
  })];
}

/** The same rating projection as training, without importing world orchestration. */
export function scoutingActualAttributes(state: Pick<SeasonState, 'training'> & CareerPlayerContext, playerId: string): PlayerAttributes {
  const player = getCareerPlayer(state, playerId);
  const trained = Object.fromEntries(SCOUTING_ATTRIBUTES.map(attribute => [attribute, Math.min(20, player.attributes[attribute] + Math.floor((state.training.points[playerId]?.[attribute] ?? 0) / 100))])) as unknown as PlayerAttributes;
  return state.date ? applyAgingAttributes(state, playerId, trained, state.date) : trained;
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

function stablePotentialBias(seed: number, clubId: string, playerId: string, attribute: string): number {
  let hash = (2166136261 ^ seed) >>> 0;
  for (const character of `potential-scouting:${clubId}:${playerId}:${attribute}`) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  return hash % 3 - 1;
}

/**
 * Hidden potential as far as this club knows it (sprint 4), as skill ranges for a star range. Potential is always an
 * estimate, so the projection is report-kind even for the club's own players. Never-scouted outsiders stay unknown.
 * Reports range one point wider than their ability ranges (narrowing with knowledge, widening with age), centred on
 * the skills reachable at the observation with a stable observer bias, and never below the ability range. Own
 * players get a narrow range: their exact current skills up to one point either side of the reachable skills.
 */
export function getPotentialKnowledge(state: SeasonState, playerId: string, clubId = state.managedClubId): PlayerKnowledge {
  const knowledge = getPlayerKnowledge(state, playerId, clubId);
  if (knowledge.kind === 'unknown') return knowledge;
  const peak = potentialAttributes(state, getCareerPlayer(state, playerId), trainingHeadroom(state, playerId));
  const reachableOn = (date: string | null) => date ? applyAgingAttributes(state, playerId, peak, date) : peak;
  if (knowledge.kind === 'own') {
    const current = knowledge.attributes!, reachable = reachableOn(state.date);
    const ranges = Object.fromEntries(SCOUTING_ATTRIBUTES.map(attribute => [attribute, { min: Math.max(current[attribute], reachable[attribute] - 1), max: Math.min(20, Math.max(current[attribute], reachable[attribute]) + 1) }])) as ScoutingRanges;
    return { ...knowledge, kind: 'report', attributes: null, ranges };
  }
  const reachable = reachableOn(knowledge.observedOn), width = 6 - knowledge.level + Math.floor(Math.max(0, knowledge.ageDays ?? 0) / 28);
  const ranges = Object.fromEntries(SCOUTING_ATTRIBUTES.map(attribute => {
    const center = Math.max(1, Math.min(20, reachable[attribute] + stablePotentialBias(state.seed, clubId, playerId, attribute))), ability = knowledge.ranges![attribute];
    return [attribute, { min: Math.max(1, center - width, ability.min), max: Math.max(Math.min(20, center + width), ability.max) }];
  })) as ScoutingRanges;
  return { ...knowledge, ranges };
}

// Step 3.7: lookups built once per immutable array instead of once per player (large worlds evaluate thousands of
// players for every club each week). Arrays in the state are replaced, never edited, so these caches stay correct.
const ownerIndexCache = new WeakMap<readonly SeasonState['clubs'][number][], Map<string, SeasonState['clubs'][number]>>();
function clubOfPlayer(clubs: SeasonState['clubs'], playerId: string): SeasonState['clubs'][number] | undefined {
  let index = ownerIndexCache.get(clubs);
  if (!index) {
    index = new Map();
    for (const club of clubs) for (const player of club.players) if (!index.has(player.id)) index.set(player.id, club);
    ownerIndexCache.set(clubs, index);
  }
  return index.get(playerId);
}

const observedReviewCache = new WeakMap<readonly ScoutingReview[], Map<string, ScoutingReview[]>>();
function observedReviews(reviews: readonly ScoutingReview[], playerId: string): ScoutingReview[] {
  let index = observedReviewCache.get(reviews);
  if (!index) {
    index = new Map();
    for (const review of reviews) if (review.outcome === 'observed') { const list = index.get(review.playerId); if (list) list.push(review); else index.set(review.playerId, [review]); }
    observedReviewCache.set(reviews, index);
  }
  return index.get(playerId) ?? [];
}

export function getPlayerKnowledge(state: SeasonState, playerId: string, clubId = state.managedClubId): PlayerKnowledge {
  getCareerPlayer(state, playerId);
  const owner = clubOfPlayer(state.clubs, playerId);
  if (owner?.id === clubId) return { playerId, kind: 'own', level: 3, attributes: scoutingActualAttributes(state, playerId), ranges: null, observedOn: state.date, observedClubId: clubId, ageDays: 0, freshness: 'current', source: 'squad', observations: 0 };
  const empty: PlayerKnowledge = { playerId, kind: 'unknown', level: 0, attributes: null, ranges: null, observedOn: null, observedClubId: null, ageDays: null, freshness: 'unknown', source: null, observations: 0 };
  if (!state.scouting.enabledSince) return empty;
  const knowledge = state.scouting.clubs[clubId];
  if (!knowledge) return empty;
  const reviews = observedReviews(knowledge.reviews, playerId);
  const review = reviews.at(-1), own = knowledge.squadKnowledge[playerId];
  const useOwn = own && (!review || own.date >= review.date);
  const source = useOwn ? own : review;
  if (!source?.attributes) return empty;
  const level = (useOwn || own ? 3 : Math.min(3, Math.floor(reviews.reduce((sum, review) => sum + clubScoutingEvidence(state, clubId, review), 0) / 100))) as 1 | 2 | 3;
  const ageDays = Math.max(0, Math.round((Date.parse(`${state.date}T00:00:00Z`) - Date.parse(`${source.date}T00:00:00Z`)) / 86_400_000));
  return { playerId, kind: 'report', level, attributes: null, ranges: scoutingRanges(state.seed, clubId, playerId, source.attributes, level, ageDays), observedOn: source.date, observedClubId: source.clubId, ageDays, freshness: ageDays <= 28 ? 'recent' : ageDays <= 84 ? 'aging' : 'stale', source: useOwn ? 'squad' : 'observation', observations: reviews.length };
}

/** Owned match ability stays at the prepared roster; later calendar aging cannot rewrite it. */
export function getMatchPlayerKnowledge(state: SeasonState, playerId: string): PlayerKnowledge {
  const knowledge = getPlayerKnowledge(state, playerId);
  if (knowledge.kind !== 'own') return knowledge;
  const player = [...(state.activeMatch?.home.players ?? []), ...(state.activeMatch?.away.players ?? [])].find(candidate => candidate.id === playerId);
  return player ? { ...knowledge, attributes: player.attributes } : knowledge;
}

export function quoteScoutingAssignment(state: SeasonState, playerId: string, clubId = state.managedClubId, scoutContractId?: string | null): ScoutingAssignmentQuote {
  return scoutingQuoter(state, clubId, scoutContractId)(playerId);
}

/**
 * The assignment check for many players of one club at one moment (step 3.7): everything that does not depend on the
 * player (observers, career players, this week's fixtures, pending and reviewed players) is worked out once.
 */
export function scoutingQuoter(state: SeasonState, clubId = state.managedClubId, scoutContractId?: string | null): (playerId: string) => ScoutingAssignmentQuote {
  const club = state.scouting.clubs[clubId];
  const observers = getScoutingObservers(state, clubId);
  const selected = scoutContractId === undefined ? observers.filter(observer => observer.available).sort((left, right) => right.evidence - left.evidence || (left.contractId ?? '').localeCompare(right.contractId ?? '', 'en'))[0] : observers.find(observer => observer.contractId === scoutContractId);
  let careerIds: Set<string> | null = null;
  const playingClubs = new Set<string>();
  for (const fixture of state.fixtures) if (fixture.round === state.round) { playingClubs.add(fixture.homeClubId); playingClubs.add(fixture.awayClubId); }
  const pending = new Set(club?.assignments.map(assignment => assignment.playerId) ?? []);
  const reviewedNow = new Set(club?.reviews.filter(review => review.seasonNumber === state.seasonNumber && review.round === state.round).map(review => review.playerId) ?? []);
  const observer = state.scouts.enabledSince && selected ? { observer: { contractId: selected.contractId, scoutId: selected.scoutId, evidence: selected.evidence, assignedLedgerIndex: financeLedgerCount(state.finance) } } : {};
  return playerId => {
    const owner = clubOfPlayer(state.clubs, playerId);
    let reason: string | null = null;
    if (!state.scouting.enabledSince) reason = 'Enable scouting before assigning observations.';
    else if (!club || !(careerIds ??= new Set(getCareerPlayers(state).map(player => player.id))).has(playerId)) reason = 'Choose a club and player in this league.';
    else if (isPlayerRetired(state, playerId)) reason = 'This player has retired from playing.';
    else if (state.status !== 'active') reason = 'New observations become available when the next season starts.';
    else if (!owner) reason = 'This player needs a registered club and a scheduled match before he can be observed.';
    else if (owner.id === clubId) reason = 'Your own squad already has exact skill assessments.';
    else if (!playingClubs.has(owner.id)) reason = 'This player has a rest week. Keep him shortlisted and assign an observation when his next match opens.';
    else if (pending.has(playerId)) reason = 'This player already has a pending assignment.';
    else if (!selected) reason = scoutContractId !== undefined && scoutContractId !== null ? 'Choose an active scout at this club.' : state.scouts.enabledSince ? 'All observation slots are occupied for this matchday.' : 'Both scouting assignments are occupied for this matchday.';
    else if (!selected.available) reason = selected.reason;
    else if (reviewedNow.has(playerId)) reason = 'This player has already been reviewed on this matchday.';
    return { playerId, clubId, canAssign: reason === null, reason, ...observer };
  };
}

/** Unknown outsiders receive a neutral prior, never a peek at catalog skill ratings. */
export function scoutingRecruitmentRating(state: SeasonState, clubId: string, playerId: string): number {
  const knowledge = getPlayerKnowledge(state, playerId, clubId);
  if (knowledge.attributes) return SCOUTING_ATTRIBUTES.reduce((sum, attribute) => sum + knowledge.attributes![attribute], 0);
  if (knowledge.ranges) return SCOUTING_ATTRIBUTES.reduce((sum, attribute) => sum + (knowledge.ranges![attribute].min + knowledge.ranges![attribute].max) / 2, 0);
  return 10.5 * SCOUTING_ATTRIBUTES.length;
}
