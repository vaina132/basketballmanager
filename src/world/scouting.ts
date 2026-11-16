import { requireCalendarWeek } from './calendar-boundary';
import type { ClubScouting, ScoutingReview, SeasonScouting, SquadObservation } from '../domain/scouting';
import type { SeasonState } from '../domain/season';
import type { Player, Team } from '../domain/types';
import { isPlayerRetired } from './lifecycle-policy';
import { getCareerPlayers } from './player-catalog';
import { rosterForRound } from './rosters';
import { getPlayerKnowledge, getScoutingCapacity, quoteScoutingAssignment, scoutingActualAttributes, scoutingQuoter } from './scouting-policy';

export function createScouting(clubs: readonly Team[], managedClubId: string): SeasonScouting {
  return { model: 'scouting-1', enabledSince: null, clubs: Object.fromEntries(clubs.map(club => [club.id, { delegated: club.id !== managedClubId, shortlist: [], assignments: [], reviews: [], squadKnowledge: {} }])) };
}

function updateClub(state: SeasonState, clubId: string, club: ClubScouting): SeasonState {
  return { ...state, scouting: { ...state.scouting, clubs: { ...state.scouting.clubs, [clubId]: club } } };
}

function requireEnabled(state: SeasonState): void {
  if (!state.scouting.enabledSince) throw new Error('Enable scouting before changing its assignments or shortlist.');
}

/** Stable exact own-squad memories become uncertain reports when a player leaves. */
export function refreshSquadKnowledge(state: SeasonState): SeasonState {
  if (!state.scouting.enabledSince) return state;
  const clubs = { ...state.scouting.clubs };
  for (const team of state.clubs) {
    const previous = clubs[team.id]!;
    const squadKnowledge = { ...previous.squadKnowledge };
    const roster = rosterForRound(state.rosters, team.id, state.round);
    for (const player of team.players) {
      const observation: SquadObservation = { playerId: player.id, seasonNumber: state.seasonNumber, round: state.round, date: state.date, clubId: team.id, rosterId: roster.id, attributes: scoutingActualAttributes(state, player.id) };
      squadKnowledge[player.id] = observation;
    }
    clubs[team.id] = { ...previous, squadKnowledge };
  }
  return { ...state, scouting: { ...state.scouting, clubs } };
}

export function enableScouting(state: SeasonState): SeasonState {
  if (state.scouting.enabledSince) return state;
  const enabled: SeasonState = { ...state, scouting: { ...state.scouting, enabledSince: { seasonNumber: state.seasonNumber, round: state.round } } };
  return prepareScoutingAssignments(refreshSquadKnowledge(enabled));
}

function assignForClub(state: SeasonState, clubId: string, playerId: string, scoutContractId?: string | null): SeasonState {
  const quote = quoteScoutingAssignment(state, playerId, clubId, scoutContractId);
  if (!quote.canAssign) throw new Error(quote.reason!);
  const club = state.scouting.clubs[clubId]!;
  return updateClub(state, clubId, { ...club, assignments: [...club.assignments, { playerId, seasonNumber: state.seasonNumber, round: state.round, ...(quote.observer ? { observer: { ...quote.observer } } : {}) }] });
}

export function assignScouting(state: SeasonState, playerId: string, scoutContractId?: string | null): SeasonState {
  return assignForClub(state, state.managedClubId, playerId, scoutContractId);
}

export function cancelScoutingAssignment(state: SeasonState, playerId: string): SeasonState {
  requireEnabled(state);
  const club = state.scouting.clubs[state.managedClubId]!;
  if (!club.assignments.some(assignment => assignment.playerId === playerId)) throw new Error('Choose a pending scouting assignment to cancel.');
  return updateClub(state, state.managedClubId, { ...club, assignments: club.assignments.filter(assignment => assignment.playerId !== playerId) });
}

export function setShortlisted(state: SeasonState, playerId: string, shortlisted: boolean): SeasonState {
  requireEnabled(state);
  if (!getCareerPlayers(state).some(player => player.id === playerId)) throw new Error('Choose a known senior player in this career.');
  if (typeof shortlisted !== 'boolean') throw new Error('Choose whether this player belongs on the shortlist.');
  if (shortlisted && isPlayerRetired(state, playerId)) throw new Error('This player has retired from playing.');
  const club = state.scouting.clubs[state.managedClubId]!;
  const shortlist = club.shortlist.filter(id => id !== playerId);
  if (shortlisted) shortlist.push(playerId);
  if (shortlisted && club.shortlist.includes(playerId) || !shortlisted && !club.shortlist.includes(playerId)) return state;
  return updateClub(state, state.managedClubId, { ...club, shortlist });
}

function candidateOrder(seed: number, clubId: string, playerId: string): number {
  let hash = (2166136261 ^ seed) >>> 0;
  for (const character of `scout-selection:${clubId}:${playerId}`) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  return hash;
}

/** Automatic discovery uses identity, position, saved knowledge and shortlists only. */
function candidates(state: SeasonState, clubId: string): Player[] {
  const club = state.scouting.clubs[clubId]!;
  const positionCounts = new Map<string, number>();
  for (const player of state.clubs.find(team => team.id === clubId)!.players) positionCounts.set(player.position, (positionCounts.get(player.position) ?? 0) + 1);
  // Step 3.7: one shared quote context for every player of this club's decision.
  const quote = scoutingQuoter(state, clubId), shortlist = new Set(club.shortlist);
  const rows = state.clubs.flatMap(team => team.players).filter(player => quote(player.id).canAssign).map(player => ({ player, knowledge: getPlayerKnowledge(state, player.id, clubId), shortlisted: shortlist.has(player.id) }));
  return rows.filter(row => row.knowledge.level < 3 || (row.knowledge.ageDays ?? 0) >= 28).sort((left, right) =>
    Number(right.shortlisted) - Number(left.shortlisted)
    || (positionCounts.get(left.player.position) ?? 0) - (positionCounts.get(right.player.position) ?? 0)
    || left.knowledge.level - right.knowledge.level
    || (right.knowledge.ageDays ?? 0) - (left.knowledge.ageDays ?? 0)
    || candidateOrder(state.seed, clubId, left.player.id) - candidateOrder(state.seed, clubId, right.player.id)
    || (left.player.id < right.player.id ? -1 : 1)
  ).map(row => row.player);
}

export function prepareScoutingAssignments(state: SeasonState): SeasonState {
  if (!state.scouting.enabledSince || state.status !== 'active') return state;
  let next = state;
  for (const team of state.clubs) {
    const club = next.scouting.clubs[team.id]!;
    if (!club.delegated) continue;
    // Step 3.7: the club's ordered candidates are worked out once. An assignment changes no knowledge, position count or
    // order; it only makes that player pending and may use up observers, which can only exclude players. So the next
    // assignable player in the same order is exactly the first candidate a fresh list would give.
    let ordered: Player[] | null = null, cursor = 0;
    while (next.scouting.clubs[team.id]!.assignments.length < getScoutingCapacity(next, team.id)) {
      ordered ??= candidates(next, team.id);
      const quote = scoutingQuoter(next, team.id);
      while (cursor < ordered.length && !quote(ordered[cursor]!.id).canAssign) cursor += 1;
      const player = ordered[cursor];
      if (!player) break;
      next = assignForClub(next, team.id, player.id);
      cursor += 1;
    }
  }
  return next;
}

export function setScoutingDelegation(state: SeasonState, delegated: boolean): SeasonState {
  requireEnabled(state);
  if (typeof delegated !== 'boolean') throw new Error('Choose manual or assistant scouting.');
  const club = state.scouting.clubs[state.managedClubId]!;
  return prepareScoutingAssignments(updateClub(state, state.managedClubId, { ...club, delegated }));
}

/** Called after all fixtures commit, before next-week training or offseason recruitment. */
export function processScoutingRound(state: SeasonState): SeasonState {
  if (!state.scouting.enabledSince) return state;
  const fixtures = state.fixtures.filter(fixture => fixture.round === state.round);
  if (fixtures.some(fixture => !fixture.result)) throw new Error('Commit every matchday result before resolving scouting observations.');
  requireCalendarWeek(state, true);
  let next = state;
  for (const observer of state.clubs) {
    const club = next.scouting.clubs[observer.id]!;
    const reviews: ScoutingReview[] = [];
    for (const assignment of club.assignments) {
      if (assignment.seasonNumber !== state.seasonNumber || assignment.round !== state.round) throw new Error('A scouting assignment must resolve on its scheduled matchday.');
      if (club.reviews.some(review => review.playerId === assignment.playerId && review.seasonNumber === state.seasonNumber && review.round === state.round)) throw new Error('A completed scouting observation cannot be recorded twice.');
      const target = state.clubs.find(team => team.players.some(player => player.id === assignment.playerId));
      if (!target || target.id === observer.id) throw new Error('Observe a registered player outside the scouting club.');
      const fixture = fixtures.find(fixture => fixture.homeClubId === target.id || fixture.awayClubId === target.id)!;
      const roster = rosterForRound(state.rosters, target.id, state.round);
      const stats = fixture.result!.stats[assignment.playerId];
      if (!stats && !Object.hasOwn(fixture.result!.selection?.rested ?? {}, assignment.playerId)) throw new Error('The observed player must belong to the committed fixture roster.');
      const observed = !!stats && stats.secondsPlayed > 0;
      reviews.push({ playerId: assignment.playerId, seasonNumber: state.seasonNumber, round: state.round, date: state.date, clubId: target.id, rosterId: roster.id, outcome: observed ? 'observed' : 'no-minutes', attributes: observed ? scoutingActualAttributes(state, assignment.playerId) : null, ...(assignment.observer ? { observer: { ...assignment.observer } } : {}) });
    }
    if (reviews.length) next = updateClub(next, observer.id, { ...club, assignments: [], reviews: [...club.reviews, ...reviews] });
  }
  return refreshSquadKnowledge(next);
}
