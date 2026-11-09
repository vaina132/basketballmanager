import type { EmploymentContract, SeasonEmployment } from '../domain/employment';
import type { SeasonState } from '../domain/season';
import type { Player } from '../domain/types';
import { getDevelopmentPlayer } from '../data/development-players';
import { getSeasonWage } from '../data/development-wages';
import { contractForSeason, getAvailablePlayers, getClubContractSummary, getContractedClubs, MAX_ROSTER_SIZE, MIN_ROSTER_SIZE, quotePlayerContract } from './employment-policy';
import { scoutingRecruitmentRating } from './scouting-policy';

export function createEmployment(): SeasonEmployment {
  return { model: 'employment-1', enabledSince: null, delegated: false, contracts: [], market: null };
}

/** Activation records existing employment without changing already agreed wages or prepared matches. */
export function enableEmployment(state: SeasonState): SeasonState {
  if (state.employment.enabledSince) return state;
  if (!state.finance.enabledSince || !state.payroll.enabledSince) throw new Error('Enable finances and player payroll before enabling player contracts.');
  const contracts: EmploymentContract[] = state.clubs.flatMap(club => club.players.map(player => {
    const agreement = state.payroll.agreements.find(agreement => agreement.playerId === player.id && agreement.clubId === club.id && agreement.seasonNumber === state.seasonNumber);
    if (!agreement) throw new Error('Every current player needs an agreed seasonal wage before enabling contracts.');
    return { id: '', playerId: player.id, clubId: club.id, startsSeason: state.seasonNumber, endsSeason: state.seasonNumber, seasonWage: agreement.seasonWage, signedSeason: state.seasonNumber, signedRound: state.round, kind: 'initial' as const };
  })).map((contract, index) => ({ ...contract, id: `employment-contract-${index + 1}` }));
  const next: SeasonState = { ...state, employment: { model: 'employment-1', enabledSince: { seasonNumber: state.seasonNumber, round: state.round }, delegated: false, contracts, market: null } };
  return state.status === 'complete' ? prepareEmploymentMarket(next) : next;
}

function offerForClub(state: SeasonState, clubId: string, playerId: string, seasonWage: number, seasons: number): SeasonState {
  const quote = quotePlayerContract(state, playerId, seasonWage, seasons, clubId);
  if (!quote.canOffer) throw new Error(quote.reason!);
  const current = contractForSeason(state.employment, playerId, state.seasonNumber);
  const contract: EmploymentContract = {
    id: `employment-contract-${state.employment.contracts.length + 1}`, playerId, clubId,
    startsSeason: quote.startsSeason, endsSeason: quote.endsSeason, seasonWage,
    signedSeason: state.seasonNumber, signedRound: state.round,
    kind: current?.clubId === clubId ? 'renewal' : 'free-agent',
  };
  return { ...state, employment: { ...state.employment, contracts: [...state.employment.contracts, contract] } };
}

export function offerPlayerContract(state: SeasonState, playerId: string, seasonWage: number, seasons: number): SeasonState {
  return offerForClub(state, state.managedClubId, playerId, seasonWage, seasons);
}

const rating = (player: Player): number => Object.values(player.attributes).reduce((sum, skill) => sum + skill, 0);
function rankCandidates(state: SeasonState, clubId: string, players: readonly Player[]): Player[] {
  const positions = new Map<string, number>();
  for (const contract of getClubContractSummary(state, clubId).contracts) {
    const position = getDevelopmentPlayer(contract.playerId).position;
    positions.set(position, (positions.get(position) ?? 0) + 1);
  }
  const assessed = (player: Player): number => state.scouting.enabledSince ? scoutingRecruitmentRating(state, clubId, player.id) : rating(player);
  return [...players].sort((left, right) => (positions.get(left.position) ?? 0) - (positions.get(right.position) ?? 0) || assessed(right) - assessed(left) || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

function retainPlayers(state: SeasonState, clubId: string, target: number): SeasonState {
  let next = state;
  const club = state.clubs.find(club => club.id === clubId)!;
  while (getClubContractSummary(next, clubId).rosterSize < target) {
    const candidates = rankCandidates(next, clubId, club.players.filter(player => !contractForSeason(next.employment, player.id, next.seasonNumber + 1)));
    const player = candidates.find(player => quotePlayerContract(next, player.id, getSeasonWage(player.id), 1, clubId).canOffer);
    if (!player) break;
    next = offerForClub(next, clubId, player.id, getSeasonWage(player.id), 1);
  }
  return next;
}

function recruitPlayers(state: SeasonState, clubId: string, target: number): SeasonState {
  let next = state;
  while (getClubContractSummary(next, clubId).rosterSize < target) {
    const player = rankCandidates(next, clubId, getAvailablePlayers(next)).find(player => quotePlayerContract(next, player.id, getSeasonWage(player.id), 1, clubId).canOffer);
    if (!player) break;
    next = offerForClub(next, clubId, player.id, getSeasonWage(player.id), 1);
  }
  return next;
}

/** Deterministic AI retention happens once; completed rosters and match state stay untouched. */
export function prepareEmploymentMarket(state: SeasonState): SeasonState {
  if (!state.employment.enabledSince || state.status !== 'complete' || state.seasonNumber >= 7974) return state;
  if (state.employment.market) {
    if (state.employment.market.seasonNumber !== state.seasonNumber + 1) throw new Error('The recruitment window must prepare the next season.');
    return state;
  }
  let next: SeasonState = { ...state, employment: { ...state.employment, market: { seasonNumber: state.seasonNumber + 1 } } };
  for (const club of next.clubs) if (club.id !== next.managedClubId) next = retainPlayers(next, club.id, MIN_ROSTER_SIZE);
  if (next.employment.delegated) {
    next = retainPlayers(next, next.managedClubId, 10);
    next = recruitPlayers(next, next.managedClubId, 10);
  }
  return next;
}

/** Delegation is prospective; previously signed terms remain binding when it is switched off. */
export function setEmploymentDelegation(state: SeasonState, delegated: boolean): SeasonState {
  if (!state.employment.enabledSince) throw new Error('Enable player contracts before delegating recruitment.');
  if (typeof delegated !== 'boolean') throw new Error('Choose manual or delegated recruitment.');
  let next: SeasonState = { ...state, employment: { ...state.employment, delegated } };
  if (delegated) {
    next = prepareEmploymentMarket(next);
    next = retainPlayers(next, next.managedClubId, 10);
    if (next.status === 'complete') next = recruitPlayers(next, next.managedClubId, 10);
  }
  return next;
}

/** Rollover-only intermediate: callers must atomically rebuild plans, snapshots and opening fixtures. */
export function finalizeEmploymentMarket(state: SeasonState): SeasonState {
  if (!state.employment.enabledSince) return state;
  if (state.status !== 'complete') throw new Error('Finish the season before applying next-year registrations.');
  if (state.seasonNumber >= 7974) throw new Error('This career has reached the last supported season.');
  let next = prepareEmploymentMarket(state);
  if (next.employment.delegated) next = recruitPlayers(next, next.managedClubId, MIN_ROSTER_SIZE);
  if (getClubContractSummary(next, next.managedClubId).rosterSize < MIN_ROSTER_SIZE) throw new Error('Contract at least eight players for next season or delegate recruitment before starting the new season.');
  // Every club reaches its minimum before any club receives optional extra players.
  for (const club of next.clubs) if (club.id !== next.managedClubId) next = recruitPlayers(next, club.id, MIN_ROSTER_SIZE);
  for (const club of next.clubs) if (club.id !== next.managedClubId || next.employment.delegated) next = recruitPlayers(next, club.id, 10);
  const clubs = getContractedClubs(next, next.seasonNumber + 1);
  if (clubs.some(club => club.players.length < MIN_ROSTER_SIZE || club.players.length > MAX_ROSTER_SIZE)) throw new Error('Every club needs eight to twelve registered players before the new season can begin.');
  return { ...next, clubs, employment: { ...next.employment, market: null } };
}
