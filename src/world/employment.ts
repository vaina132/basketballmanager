import { leavingClubIds } from './background';
import { worldOf } from './career-world';
import { clubRosterLimitText, clubRosterLimit, clubRosterTarget } from './club-roster-policy';
import type { ContractOfferOptions, EmploymentContract, EmploymentTransfer, SeasonEmployment } from '../domain/employment';
import type { MarketOffer } from '../domain/market';
import type { SeasonState } from '../domain/season';
import type { Player } from '../domain/types';
import { getCareerPlayer } from './player-catalog';
import { contractForSeason, effectiveContractsForSeason, getAvailablePlayers, getClubContractSummary, getContractedClubs, MIN_ROSTER_SIZE, quotePlayerContract } from './employment-policy';
import { coachRecruitmentRating, scoutingActualAttributes, scoutingRecruitmentRating } from './scouting-policy';
import { clubStyleFit } from './head-coaches';
import { evaluateNegotiation } from './negotiations-policy';
import { appendNegotiationResponse, getLatestNegotiation } from './negotiations';
import { finishMarketWindow, prepareMarketWindow, scheduleMarketRecruitment, submitMarketOffer } from './market';
import { getLiveMarketOffers } from './market-policy';
import { recordTransferFee } from './finance';
import { sellerReplacementReason } from './transfers-policy';
import { getTransferPaymentSchedule } from './transfer-payments';
import { scheduleInSeasonRecruitment } from './recruitment';
import { contractAskingWage, offeredContractRole } from './contract-roles';
import { automaticWageCheck } from './automatic-wages';

export function createEmployment(): SeasonEmployment {
  return { model: 'employment-1', enabledSince: null, delegated: false, contracts: [], transfers: [], buyouts: [], market: null };
}

/** Activation records existing employment without changing already agreed wages or prepared matches. */
export function enableEmployment(state: SeasonState): SeasonState {
  if (state.employment.enabledSince) return state;
  if (!state.finance.enabledSince || !state.payroll.enabledSince) throw new Error('Enable finances and player payroll before enabling player contracts.');
  const contracts: EmploymentContract[] = state.clubs.flatMap(club => club.players.map(player => {
    const agreement = state.payroll.agreements.find(agreement => agreement.playerId === player.id && agreement.clubId === club.id && agreement.seasonNumber === state.seasonNumber);
    if (!agreement) throw new Error('Every current player needs an agreed seasonal wage before enabling contracts.');
    // Owner feedback (15 November 2026): real-club worlds give opening contracts estimated lengths, so a career does not begin with renewing everyone.
    return { id: '', playerId: player.id, clubId: club.id, startsSeason: state.seasonNumber, startsRound: 1, endsSeason: state.seasonNumber + (worldOf(state).playerContracts?.[player.id] ?? 1) - 1, seasonWage: agreement.seasonWage, signedSeason: state.seasonNumber, signedRound: state.round, kind: 'initial' as const };
  })).map((contract, index) => ({ ...contract, id: `employment-contract-${index + 1}` }));
  const next: SeasonState = { ...state, employment: { model: 'employment-1', enabledSince: { seasonNumber: state.seasonNumber, round: state.round }, delegated: false, contracts, transfers: [], buyouts: [], market: null } };
  return state.status === 'complete' ? prepareEmploymentMarket(next) : next;
}

/** The contract options a scheduled market offer carries (its release fee, transfer mode and squad role). */
function scheduledOfferOptions(offer: Pick<MarketOffer, 'releaseFee' | 'transfer' | 'role'>): ContractOfferOptions {
  return { ...(offer.releaseFee === undefined ? {} : { releaseFee: offer.releaseFee }), ...(offer.transfer?.mode ? { transferMode: offer.transfer.mode } : {}), ...(offer.role === undefined ? {} : { role: offer.role }) };
}

/**
 * The shared contract guard for a scheduled market offer on its response day, exactly as `commitPlayerOffer` checks it
 * (its own reservation excluded): the dated market resolver withdraws an offer the club can no longer afford instead of
 * failing (a club's own sale accepted after its offer adds a replacement reserve to its wage budget).
 */
export function scheduledOfferQuote(state: SeasonState, offer: MarketOffer) {
  return quotePlayerContract(state, offer.playerId, offer.seasonWage, offer.seasons, offer.clubId, offer.id, offer.transfer?.fee, offer.transfer?.paymentPlan ?? 'upfront', scheduledOfferOptions(offer));
}

/** Internal immediate response used by legacy/active renewals and the dated market resolver. */
export function commitPlayerOffer(state: SeasonState, clubId: string, playerId: string, seasonWage: number, seasons: number, resolvingOfferId?: string, options: ContractOfferOptions = {}): SeasonState {
  const scheduled = getLiveMarketOffers(state).find(offer => offer.id === resolvingOfferId && offer.clubId === clubId && offer.playerId === playerId && offer.seasonWage === seasonWage && offer.seasons === seasons && offer.status === 'pending' && offer.responseOn === state.date);
  if (scheduled) options = scheduledOfferOptions(scheduled);
  if (state.market?.enabledSince && state.status === 'complete' && !scheduled) throw new Error('Send an offer and continue to its scheduled response before signing.');
  const enabled = state.negotiations.enabledSince !== null;
  // relationships-3: every offer carries a squad role, the chosen one or the player's natural role at this club.
  const role = offeredContractRole(state, clubId, playerId, options);
  const latest = enabled ? getLatestNegotiation(state, playerId, clubId) : null;
  const duplicate = latest && latest.seasonNumber === state.seasonNumber && latest.round === state.round && latest.status === state.status && latest.date === state.date && latest.offeredWage === seasonWage && latest.offeredSeasons === seasons && latest.releaseFee === options.releaseFee && latest.role === role;
  if (duplicate && latest.outcome === 'accepted') {
    const signed = state.employment.contracts.find(contract => contract.id === latest.contractId);
    if (signed && signed.playerId === playerId && signed.clubId === clubId && signed.startsSeason === state.seasonNumber + 1 && signed.endsSeason === state.seasonNumber + seasons && signed.seasonWage === seasonWage && signed.releaseFee === options.releaseFee && signed.role === role && contractForSeason(state.employment, playerId, state.seasonNumber + 1)?.id === signed.id) return state;
  }
  const quote = quotePlayerContract(state, playerId, seasonWage, seasons, clubId, resolvingOfferId, scheduled?.transfer?.fee, scheduled?.transfer?.paymentPlan ?? 'upfront', options);
  if (!quote.canOffer) throw new Error(quote.reason!);
  if (duplicate) return state;
  const decision = enabled ? evaluateNegotiation(playerId, seasonWage, seasons, options.releaseFee, state, role) : null;
  const contractCountBefore = state.employment.contracts.length;
  if (decision && decision.outcome !== 'accepted') return appendNegotiationResponse(state, clubId, playerId, seasonWage, seasons, decision, null, contractCountBefore, quote.startsSeason, options.releaseFee, role);
  if (scheduled?.transfer) {
    const saleReason = sellerReplacementReason(state, scheduled);
    if (saleReason) throw new Error(saleReason);
  }
  const current = contractForSeason(state.employment, playerId, state.seasonNumber);
  const contract: EmploymentContract = {
    id: `employment-contract-${state.employment.contracts.length + 1}`, playerId, clubId,
    startsSeason: quote.startsSeason, startsRound: 1, endsSeason: quote.endsSeason, seasonWage,
    signedSeason: state.seasonNumber, signedRound: state.round,
    kind: scheduled?.transfer ? 'transfer' : current?.clubId === clubId && current.endsSeason === state.seasonNumber ? 'renewal' : 'free-agent',
    ...(options.releaseFee === undefined ? {} : { releaseFee: options.releaseFee }),
    ...(role === undefined ? {} : { role }),
    // Format 92: an NBA club's cap route (the offer's, kept from the day it was made).
    ...(quote.capRoute ? { capRoute: quote.capRoute } : {}),
  };
  let next = { ...state, employment: { ...state.employment, contracts: [...state.employment.contracts, contract] } };
  if (scheduled?.transfer) {
    const sellerId = scheduled.transfer.sellerClubId;
    const released = new Set<string>();
    for (let year = quote.startsSeason; year <= Math.max(quote.endsSeason, ...state.employment.contracts.filter(item => item.playerId === playerId && item.clubId === sellerId).map(item => item.endsSeason)); year += 1) {
      for (const old of effectiveContractsForSeason(state.employment, year)) if (old.playerId === playerId && old.clubId === sellerId) released.add(old.id);
    }
    const transfer: EmploymentTransfer = {
      id: `employment-transfer-${(state.employment.transfers ?? []).length + 1}`, offerId: scheduled.id, playerId,
      fromClubId: sellerId, toClubId: clubId, seasonNumber: state.seasonNumber, completedOn: state.date,
      startsSeason: quote.startsSeason, startsRound: 1, fee: scheduled.transfer.fee, releasedContractIds: [...released], contractId: contract.id,
      paymentPlan: scheduled.transfer.paymentPlan ?? 'upfront',
      ...(scheduled.transfer.mode ? { mode: scheduled.transfer.mode } : {}),
      installments: getTransferPaymentSchedule(scheduled.transfer.fee, scheduled.transfer.paymentPlan ?? 'upfront', state.date, quote.startsSeason),
      payments: [],
    };
    next = recordTransferFee({ ...next, employment: { ...next.employment, transfers: [...(state.employment.transfers ?? []), transfer] } }, transfer);
  }
  return decision ? appendNegotiationResponse(next, clubId, playerId, seasonWage, seasons, decision, contract.id, contractCountBefore, quote.startsSeason, options.releaseFee, role) : next;
}

export function offerPlayerContract(state: SeasonState, playerId: string, seasonWage: number, seasons: number, options: ContractOfferOptions = {}): SeasonState {
  return state.market?.enabledSince && state.status === 'complete' ? submitMarketOffer(state, playerId, seasonWage, seasons, state.managedClubId, undefined, 'upfront', options) : commitPlayerOffer(state, state.managedClubId, playerId, seasonWage, seasons, undefined, options);
}

function rankCandidates(state: SeasonState, clubId: string, players: readonly Player[]): Player[] {
  const positions = new Map<string, number>();
  for (const contract of getClubContractSummary(state, clubId).contracts) {
    const position = getCareerPlayer(state, contract.playerId).position;
    positions.set(position, (positions.get(position) ?? 0) + 1);
  }
  // Format 86: a club whose head coach steers prefers players who fit his style (`clubStyleFit`).
  const fit = clubStyleFit(state, clubId), fitted = fit ? coachRecruitmentRating(state, clubId, fit) : null;
  const assessed = (player: Player): number => fitted ? fitted(player.id) : state.scouting.enabledSince ? scoutingRecruitmentRating(state, clubId, player.id) : Object.values(state.lifecycle?.enabledSince ? scoutingActualAttributes(state, player.id) : player.attributes).reduce((sum, skill) => sum + skill, 0);
  return [...players].sort((left, right) => (positions.get(left.position) ?? 0) - (positions.get(right.position) ?? 0) || assessed(right) - assessed(left) || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

function retainPlayers(state: SeasonState, clubId: string, target: number): SeasonState {
  let next = state;
  const club = state.clubs.find(club => club.id === clubId)!;
  while (getClubContractSummary(next, clubId).rosterSize < target) {
    const candidates = rankCandidates(next, clubId, club.players.filter(player => !contractForSeason(next.employment, player.id, next.seasonNumber + 1)));
    const affordable = automaticWageCheck(next, clubId);
    const player = candidates.find(player => quotePlayerContract(next, player.id, contractAskingWage(next, clubId, player.id), 1, clubId).canOffer && affordable(contractAskingWage(next, clubId, player.id), 1, next.seasonNumber + 1));
    if (!player) break;
    next = commitPlayerOffer(next, clubId, player.id, contractAskingWage(next, clubId, player.id), 1);
  }
  return next;
}

function recruitPlayers(state: SeasonState, clubId: string, target: number): SeasonState {
  let next = state;
  while (getClubContractSummary(next, clubId).rosterSize < target) {
    const affordable = automaticWageCheck(next, clubId);
    const player = rankCandidates(next, clubId, getAvailablePlayers(next)).find(player => quotePlayerContract(next, player.id, contractAskingWage(next, clubId, player.id), 1, clubId).canOffer && affordable(contractAskingWage(next, clubId, player.id), 1, next.seasonNumber + 1));
    if (!player) break;
    next = commitPlayerOffer(next, clubId, player.id, contractAskingWage(next, clubId, player.id), 1);
  }
  return next;
}

/** Deterministic AI retention happens once; completed rosters and match state stay untouched. */
export function prepareEmploymentMarket(state: SeasonState): SeasonState {
  if (!state.employment.enabledSince || state.status !== 'complete' || state.seasonNumber >= 7974) return state;
  if (state.market?.enabledSince) return prepareMarketWindow(state);
  if (state.employment.market) {
    if (state.employment.market.seasonNumber !== state.seasonNumber + 1) throw new Error('The recruitment window must prepare the next season.');
    return state;
  }
  let next: SeasonState = { ...state, employment: { ...state.employment, market: { seasonNumber: state.seasonNumber + 1 } } };
  // Clubs leaving the full world sit out the offseason market (step 3.4d-2).
  const leaving = leavingClubIds(next);
  for (const club of next.clubs) if (club.id !== next.managedClubId && !leaving.has(club.id)) next = retainPlayers(next, club.id, MIN_ROSTER_SIZE);
  // Format 69: an unemployed manager (no managed club) has no squad of their own to recruit for.
  if (next.employment.delegated && next.managedClubId) {
    next = retainPlayers(next, next.managedClubId, clubRosterTarget(next, next.managedClubId));
    next = recruitPlayers(next, next.managedClubId, clubRosterTarget(next, next.managedClubId));
  }
  return next;
}

/** Delegation is prospective; previously signed terms remain binding when it is switched off. */
export function setEmploymentDelegation(state: SeasonState, delegated: boolean): SeasonState {
  if (!state.employment.enabledSince) throw new Error('Enable player contracts before delegating recruitment.');
  if (typeof delegated !== 'boolean') throw new Error('Choose manual or delegated recruitment.');
  let next: SeasonState = { ...state, employment: { ...state.employment, delegated } };
  if (state.market?.enabledSince && state.status === 'complete') return delegated ? scheduleMarketRecruitment(prepareMarketWindow(next)) : next;
  if (delegated) {
    next = prepareEmploymentMarket(next);
    next = retainPlayers(next, next.managedClubId, clubRosterTarget(next, next.managedClubId));
    if (next.status === 'complete') next = recruitPlayers(next, next.managedClubId, clubRosterTarget(next, next.managedClubId));
    else next = scheduleInSeasonRecruitment(next);
  }
  return next;
}

/** Rollover-only intermediate: callers must atomically rebuild plans, snapshots and opening fixtures. */
export function finalizeEmploymentMarket(state: SeasonState): SeasonState {
  if (!state.employment.enabledSince) return state;
  if (state.status !== 'complete') throw new Error('Finish the season before applying next-year registrations.');
  if (state.seasonNumber >= 7974) throw new Error('This career has reached the last supported season.');
  if (state.market?.enabledSince) {
    const next = finishMarketWindow(state);
    const clubs = getContractedClubs(next, next.seasonNumber + 1);
    if (clubs.some(club => club.players.length < MIN_ROSTER_SIZE || club.players.length > clubRosterLimit(state))) throw new Error(`Every club needs eight to ${clubRosterLimitText(state)} signed players before the new season can begin.`);
    return { ...next, clubs, employment: { ...next.employment, market: null } };
  }
  let next = prepareEmploymentMarket(state);
  if (next.employment.delegated && next.managedClubId) next = recruitPlayers(next, next.managedClubId, MIN_ROSTER_SIZE);
  if (next.managedClubId && getClubContractSummary(next, next.managedClubId).rosterSize < MIN_ROSTER_SIZE) throw new Error('Contract at least eight players for next season or delegate recruitment before starting the new season.');
  // Every club reaches its minimum before any club receives optional extra players.
  const leaving = leavingClubIds(next);
  for (const club of next.clubs) if (club.id !== next.managedClubId && !leaving.has(club.id)) next = recruitPlayers(next, club.id, MIN_ROSTER_SIZE);
  for (const club of next.clubs) if ((club.id !== next.managedClubId || next.employment.delegated) && !leaving.has(club.id)) next = recruitPlayers(next, club.id, clubRosterTarget(next, club.id));
  const clubs = getContractedClubs(next, next.seasonNumber + 1);
  if (clubs.some(club => club.players.length < MIN_ROSTER_SIZE || club.players.length > clubRosterLimit(state))) throw new Error(`Every club needs eight to ${clubRosterLimitText(state)} registered players before the new season can begin.`);
  return { ...next, clubs, employment: { ...next.employment, market: null } };
}
