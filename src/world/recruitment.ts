import type { EmploymentContract, EmploymentTransfer } from '../domain/employment';
import type { InSeasonEvent, InSeasonEventAnchor, InSeasonOffer, SeasonRecruitment } from '../domain/recruitment';
import type { SeasonState } from '../domain/season';
import type { TransferPaymentPlan } from '../domain/transfer-payments';
import { DEVELOPMENT_PLAYERS } from '../data/development-players';
import { getSeasonWage } from '../data/development-wages';
import { effectiveContractsForRound, MAX_ROSTER_SIZE } from './employment-policy';
import { recordTransferFee } from './finance';
import { isRecovering } from './health';
import { appendNegotiationResponse } from './negotiations';
import { evaluateNegotiation, negotiationReasonText } from './negotiations-policy';
import { addInSeasonWageAgreement } from './payroll';
import { getInSeasonCandidates, getInSeasonOffers, IN_SEASON_EVENT_LIMIT, isLiveInSeasonOffer, quoteInSeasonOffer } from './recruitment-policy';
import { getInSeasonReleasedContractIds, getInSeasonTransferCandidates, quoteInSeasonSale, quoteInSeasonTransferOffer, requiredInSeasonTransferFee } from './midseason-transfer-policy';
import { registerInSeasonArrivals } from './rosters';
import { scoutingRecruitmentRating } from './scouting-policy';
import { dateForRound, SEASON_ROUNDS } from './season';
import { getTransferPaymentSchedule } from './transfer-payments';

export function createInSeasonRecruitment(): SeasonRecruitment { return { model: 'recruitment-1', enabledSince: null, transfersEnabledSince: null, events: [], offers: [] }; }

function eventAnchor(state: SeasonState): InSeasonEventAnchor {
  return { seasonNumber: state.seasonNumber, round: state.round, date: state.date, ledgerIndexBefore: state.finance.ledger.length, contractCountBefore: state.employment.contracts.length, negotiationCountBefore: state.negotiations.records.length };
}

function boundary(state: SeasonState): { seasonNumber: number; round: number } {
  const enabled = state.recruitment.enabledSince;
  if (!enabled) throw new Error('Enable in-season recruitment before using its offers.');
  return state.recruitment.events.filter(event => event.type === 'resolve').at(-1) ?? enabled;
}

function requirePreparedBoundary(state: SeasonState): void {
  const previous = boundary(state);
  if (state.status !== 'active' || previous.seasonNumber !== state.seasonNumber || previous.round !== state.round) throw new Error('Use the current prepared matchday for an in-season offer.');
}

function replaceOffers(state: SeasonState, offers: InSeasonOffer[]): SeasonState { return { ...state, recruitment: { ...state.recruitment, offers } }; }

function preference(playerId: string, clubId: string): number {
  let hash = 2166136261;
  for (const character of `${playerId}:${clubId}`) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  return hash;
}

/** Equal terms use the same stable, non-sporting club tie-break as the offseason. */
function compareOffers(left: InSeasonOffer, right: InSeasonOffer): number {
  return right.seasonWage - left.seasonWage || right.seasons - left.seasons || preference(left.playerId, left.clubId) - preference(right.playerId, right.clubId) || left.clubId.localeCompare(right.clubId, 'en');
}

export function enableInSeasonRecruitment(state: SeasonState): SeasonState {
  if (state.recruitment?.enabledSince) return state;
  if (state.status !== 'active') throw new Error('Start the next season before enabling in-season recruitment.');
  if (!state.employment.enabledSince || !state.finance.enabledSince || !state.payroll.enabledSince || !state.negotiations.enabledSince) throw new Error('Enable player contracts, finances, payroll and negotiations first.');
  const next: SeasonState = { ...state, recruitment: { model: 'recruitment-1', enabledSince: { seasonNumber: state.seasonNumber, round: state.round, ledgerIndex: state.finance.ledger.length, contractCount: state.employment.contracts.length, negotiationCount: state.negotiations.records.length }, transfersEnabledSince: null, events: [], offers: [] } };
  return scheduleInSeasonRecruitment(next);
}

/** Pure event replay: calendar advancement, registration and response all commit together. */
export function applyInSeasonEvent(state: SeasonState, event: InSeasonEvent): SeasonState {
  boundary(state);
  if (state.recruitment.events.length >= IN_SEASON_EVENT_LIMIT) throw new Error('This development career has reached its retained in-season recruitment-event limit.');
  const anchor = eventAnchor(state);
  for (const key of Object.keys(anchor) as (keyof InSeasonEventAnchor)[]) if (event[key] !== anchor[key]) throw new Error('The recruitment command must retain its exact date and financial/contract history boundary.');
  if (state.date !== dateForRound(state.round, state.seasonNumber) || state.status !== 'active') throw new Error('In-season decisions must use an active matchday date.');
  if (event.type === 'enable-transfers') {
    requirePreparedBoundary(state);
    if (state.recruitment.transfersEnabledSince) throw new Error('In-season club transfers are already enabled.');
    return { ...state, recruitment: { ...state.recruitment, transfersEnabledSince: { seasonNumber: state.seasonNumber, round: state.round, ledgerIndex: state.finance.ledger.length, contractCount: state.employment.contracts.length, negotiationCount: state.negotiations.records.length }, events: [...state.recruitment.events, { ...event }] } };
  }
  if (event.type === 'offer') {
    requirePreparedBoundary(state);
    if (event.id !== `inseason-offer-${state.recruitment.offers.length + 1}`) throw new Error('In-season offer identity is not sequential.');
    const seasons = event.seasons ?? 1, plan = event.transferPaymentPlan ?? 'upfront';
    if (event.transferFee === undefined && (seasons !== 1 || event.transferPaymentPlan !== undefined)) throw new Error('Free-agent recruitment covers the rest of this season without a transfer payment plan.');
    const quote = event.transferFee === undefined ? quoteInSeasonOffer(state, event.playerId, event.seasonWage, event.clubId) : quoteInSeasonTransferOffer(state, event.playerId, event.seasonWage, seasons, event.transferFee, event.clubId, plan);
    if (!quote.canOffer) throw new Error(quote.reason!);
    const previous = getInSeasonOffers(state, event.clubId, true).find(offer => offer.playerId === event.playerId);
    if (previous?.seasonWage === event.seasonWage && previous.seasons === seasons && (previous.transfer?.fee ?? undefined) === event.transferFee && (previous.transfer?.paymentPlan ?? 'upfront') === plan) throw new Error('The same in-season offer is already open.');
    const paid = event.transferFee === undefined ? null : quoteInSeasonTransferOffer(state, event.playerId, event.seasonWage, seasons, event.transferFee, event.clubId, plan);
    const offer: InSeasonOffer = { id: event.id, clubId: event.clubId, playerId: event.playerId, seasonNumber: state.seasonNumber, offeredRound: state.round, responseRound: quote.responseRound, offeredOn: state.date, responseOn: quote.responseOn, seasonWage: event.seasonWage, seasons, transfer: paid ? { sellerClubId: paid.sellerClubId!, contractId: paid.contractId!, fee: paid.fee, paymentPlan: plan, requiredFee: paid.requiredFee, clubStatus: 'review', clubResponseOn: state.date, clubRespondedOn: null, clubReason: null, counterFee: null } : null, remainingWages: quote.remainingWages, status: paid ? 'club-review' : 'pending', respondedOn: null, closedOn: null, negotiationId: null, chosenOfferId: null, reason: null };
    return { ...state, recruitment: { ...state.recruitment, events: [...state.recruitment.events, { ...event }], offers: [...state.recruitment.offers.map(item => item.id === previous?.id ? { ...item, status: 'replaced' as const, closedOn: state.date } : item), offer] } };
  }
  if (event.type === 'withdraw') {
    requirePreparedBoundary(state);
    const offer = state.recruitment.offers.find(item => item.id === event.offerId);
    if (!offer || offer.seasonNumber !== state.seasonNumber || !isLiveInSeasonOffer(offer)) throw new Error('Choose a pending in-season offer to withdraw.');
    return { ...state, recruitment: { ...state.recruitment, events: [...state.recruitment.events, { ...event }], offers: state.recruitment.offers.map(item => item.id === offer.id ? { ...item, status: 'withdrawn' as const, closedOn: state.date } : item) } };
  }
  if (event.type === 'club-decision') {
    requirePreparedBoundary(state);
    const offer = state.recruitment.offers.find(item => item.id === event.offerId);
    if (!offer?.transfer || offer.status !== 'club-review' || offer.transfer.clubStatus !== 'review' || offer.offeredRound !== state.round || offer.seasonNumber !== state.seasonNumber) throw new Error('Choose an incoming transfer awaiting this matchday\'s club decision.');
    const sale = quoteInSeasonSale(state, offer.id);
    let updated: InSeasonOffer;
    if (event.response === 'accept') {
      if (!sale.canAccept) throw new Error(sale.acceptReason!);
      updated = { ...offer, status: 'pending', transfer: { ...offer.transfer, clubStatus: 'accepted', clubRespondedOn: state.date, clubReason: 'Fee agreed. The player replies on the next matchday.', counterFee: null } };
    } else if (event.response === 'counter') {
      if (!sale.canCounter) throw new Error(sale.counterReason!);
      const reason = 'The selling club asks for its full asking fee. Send revised terms to continue.';
      updated = { ...offer, status: 'countered', respondedOn: state.date, closedOn: state.date, reason, transfer: { ...offer.transfer, clubStatus: 'countered', clubRespondedOn: state.date, clubReason: reason, counterFee: offer.transfer.requiredFee } };
    } else if (event.response === 'reject') {
      const reason = sale.acceptReason ?? 'The selling club declined this transfer offer.';
      updated = { ...offer, status: 'rejected', respondedOn: state.date, closedOn: state.date, reason, transfer: { ...offer.transfer, clubStatus: 'rejected', clubRespondedOn: state.date, clubReason: reason, counterFee: null } };
    } else throw new Error('Choose accept, reject or the asking fee.');
    return { ...state, recruitment: { ...state.recruitment, events: [...state.recruitment.events, { ...event }], offers: state.recruitment.offers.map(item => item.id === offer.id ? updated : item) } };
  }
  if (event.type !== 'resolve') throw new Error('Choose a supported in-season recruitment command.');
  const previous = boundary(state);
  const expectedYear = previous.round === SEASON_ROUNDS ? previous.seasonNumber + 1 : previous.seasonNumber;
  const expectedRound = previous.round === SEASON_ROUNDS ? 1 : previous.round + 1;
  if (state.seasonNumber !== expectedYear || state.round !== expectedRound) throw new Error('Resolve in-season replies once at each next matchday.');
  if (state.recruitment.offers.some(offer => isLiveInSeasonOffer(offer) && (offer.seasonNumber < state.seasonNumber || offer.responseRound < state.round))) throw new Error('An earlier in-season reply cannot be skipped.');
  let next: SeasonState = { ...state, recruitment: { ...state.recruitment, events: [...state.recruitment.events, { ...event }], offers: state.recruitment.offers.map(offer => offer.status === 'club-review' && offer.responseRound <= state.round ? { ...offer, status: 'expired', respondedOn: state.date, closedOn: state.date, reason: 'The selling club did not approve the transfer before the next matchday.' } : { ...offer }) } };
  const due = getInSeasonOffers(next, undefined, true).filter(offer => offer.status === 'pending' && offer.responseRound === state.round);
  const players = [...new Set(due.map(offer => offer.playerId))];
  const arrivals: EmploymentContract[] = [];
  for (const playerId of players) {
    const proposals = due.filter(offer => offer.playerId === playerId);
    const valid: InSeasonOffer[] = [];
    for (const offer of proposals) {
      const quote = offer.transfer ? quoteInSeasonTransferOffer(next, offer.playerId, offer.seasonWage, offer.seasons, offer.transfer.fee, offer.clubId, offer.transfer.paymentPlan, offer.id) : quoteInSeasonOffer(next, offer.playerId, offer.seasonWage, offer.clubId, offer.id);
      if (quote.canOffer) valid.push(offer);
      else next = replaceOffers(next, next.recruitment.offers.map(item => item.id === offer.id ? { ...item, status: 'cancelled', respondedOn: next.date, closedOn: next.date, reason: quote.reason } : item));
    }
    const chosen = valid.filter(offer => evaluateNegotiation(offer.playerId, offer.seasonWage, offer.seasons).outcome === 'accepted').sort(compareOffers)[0];
    if (chosen) {
      const contractCountBefore = next.employment.contracts.length;
      const contract: EmploymentContract = { id: `employment-contract-${contractCountBefore + 1}`, playerId, clubId: chosen.clubId, startsSeason: next.seasonNumber, startsRound: next.round, endsSeason: next.seasonNumber + chosen.seasons - 1, seasonWage: chosen.seasonWage, signedSeason: next.seasonNumber, signedRound: next.round, kind: chosen.transfer ? 'midseason-transfer' : 'midseason' };
      const transfer: EmploymentTransfer | null = chosen.transfer ? { id: `employment-transfer-${next.employment.transfers.length + 1}`, offerId: chosen.id, playerId, fromClubId: chosen.transfer.sellerClubId, toClubId: chosen.clubId, seasonNumber: next.seasonNumber, completedOn: next.date, startsSeason: next.seasonNumber, startsRound: next.round, fee: chosen.transfer.fee, releasedContractIds: getInSeasonReleasedContractIds(next, playerId, chosen.transfer.sellerClubId), contractId: contract.id, paymentPlan: chosen.transfer.paymentPlan, installments: getTransferPaymentSchedule(chosen.transfer.fee, chosen.transfer.paymentPlan, next.date, next.seasonNumber, next.round), payments: [] } : null;
      next = { ...next, employment: { ...next.employment, contracts: [...next.employment.contracts, contract] } };
      if (transfer) next = { ...next, employment: { ...next.employment, transfers: [...next.employment.transfers, transfer] } };
      next = addInSeasonWageAgreement(next, contract);
      if (transfer) next = recordTransferFee(next, transfer);
      next = appendNegotiationResponse(next, chosen.clubId, playerId, chosen.seasonWage, chosen.seasons, evaluateNegotiation(playerId, chosen.seasonWage, chosen.seasons), contract.id, contractCountBefore, next.seasonNumber);
      const negotiationId = next.negotiations.records.at(-1)!.id;
      next = replaceOffers(next, next.recruitment.offers.map(offer => offer.id === chosen.id ? { ...offer, status: 'accepted', respondedOn: next.date, closedOn: next.date, negotiationId } : offer.playerId === playerId && offer.seasonNumber === next.seasonNumber && isLiveInSeasonOffer(offer) ? { ...offer, status: 'lost', respondedOn: next.date, closedOn: next.date, chosenOfferId: chosen.id, reason: 'The player accepted another club\'s offer.' } : offer));
      arrivals.push(contract);
    } else for (const offer of valid) {
      const decision = evaluateNegotiation(playerId, offer.seasonWage, offer.seasons);
      next = appendNegotiationResponse(next, offer.clubId, playerId, offer.seasonWage, offer.seasons, decision, null, next.employment.contracts.length, next.seasonNumber);
      const negotiationId = next.negotiations.records.at(-1)!.id;
      next = replaceOffers(next, next.recruitment.offers.map(item => item.id === offer.id ? { ...item, status: decision.outcome === 'countered' ? 'countered' : 'rejected', respondedOn: next.date, closedOn: next.date, negotiationId, reason: negotiationReasonText(decision) } : item));
    }
  }
  return registerInSeasonArrivals(next, arrivals);
}

export function submitInSeasonOffer(state: SeasonState, playerId: string, seasonWage: number, clubId = state.managedClubId): SeasonState {
  requirePreparedBoundary(state);
  const previous = getInSeasonOffers(state, clubId, true).find(offer => offer.playerId === playerId);
  if (previous?.seasonWage === seasonWage && !previous.transfer) return state;
  return applyInSeasonEvent(state, { ...eventAnchor(state), type: 'offer', id: `inseason-offer-${state.recruitment.offers.length + 1}`, clubId, playerId, seasonWage });
}

export function enableInSeasonTransfers(state: SeasonState): SeasonState {
  if (state.recruitment?.transfersEnabledSince) return state;
  const next = applyInSeasonEvent(state, { ...eventAnchor(state), type: 'enable-transfers' });
  return scheduleInSeasonRecruitment(next);
}

export function submitInSeasonTransferOffer(state: SeasonState, playerId: string, seasonWage: number, seasons: number, fee: number, clubId = state.managedClubId, paymentPlan: TransferPaymentPlan = 'upfront'): SeasonState {
  requirePreparedBoundary(state);
  const previous = getInSeasonOffers(state, clubId, true).find(offer => offer.playerId === playerId);
  if (previous?.transfer && previous.seasonWage === seasonWage && previous.seasons === seasons && previous.transfer.fee === fee && previous.transfer.paymentPlan === paymentPlan) return state;
  const next = applyInSeasonEvent(state, { ...eventAnchor(state), type: 'offer', id: `inseason-offer-${state.recruitment.offers.length + 1}`, clubId, playerId, seasonWage, seasons, transferFee: fee, transferPaymentPlan: paymentPlan });
  return reviewAutomaticTransfers(next);
}

export function decideInSeasonTransfer(state: SeasonState, offerId: string, response: 'accept' | 'reject' | 'counter', clubId = state.managedClubId): SeasonState {
  requirePreparedBoundary(state);
  const offer = state.recruitment.offers.find(item => item.id === offerId);
  if (offer?.transfer?.sellerClubId !== clubId) throw new Error('Choose an incoming transfer for a player at your club.');
  return applyInSeasonEvent(state, { ...eventAnchor(state), type: 'club-decision', offerId, response });
}

function reviewAutomaticTransfers(state: SeasonState): SeasonState {
  let next = state;
  for (const offer of getInSeasonOffers(state, undefined, true)) {
    if (!offer.transfer || offer.status !== 'club-review' || offer.transfer.sellerClubId === state.managedClubId && !state.employment.delegated) continue;
    const sale = quoteInSeasonSale(next, offer.id);
    const response = !sale.canAccept || offer.transfer.fee * 2 < offer.transfer.requiredFee ? 'reject' : offer.transfer.fee < offer.transfer.requiredFee ? 'counter' : 'accept';
    next = decideInSeasonTransfer(next, offer.id, response, offer.transfer.sellerClubId);
  }
  return next;
}

export function withdrawInSeasonOffer(state: SeasonState, offerId: string, clubId = state.managedClubId): SeasonState {
  requirePreparedBoundary(state);
  const offer = state.recruitment.offers.find(item => item.id === offerId);
  if (!offer || offer.clubId !== clubId || offer.seasonNumber !== state.seasonNumber) throw new Error('Choose an in-season offer from your club.');
  if (offer.status === 'withdrawn') return state;
  return applyInSeasonEvent(state, { ...eventAnchor(state), type: 'withdraw', offerId });
}

export function resolveInSeasonRecruitment(state: SeasonState): SeasonState {
  if (!state.recruitment?.enabledSince) return state;
  const previous = boundary(state);
  if (previous.seasonNumber === state.seasonNumber && previous.round === state.round) return state;
  return applyInSeasonEvent(state, { ...eventAnchor(state), type: 'resolve' });
}

/** AI repairs injury shortages; a delegated manager recruits toward a ten-player squad. */
export function scheduleInSeasonRecruitment(state: SeasonState): SeasonState {
  if (!state.recruitment?.enabledSince || state.status !== 'active' || state.round >= SEASON_ROUNDS) return state;
  requirePreparedBoundary(state);
  let next = reviewAutomaticTransfers(state);
  const responseOn = dateForRound(state.round + 1, state.seasonNumber);
  for (const club of state.clubs) {
    if (club.id === state.managedClubId && !state.employment.delegated) continue;
    for (let count = 0; count < MAX_ROSTER_SIZE; count += 1) {
      const registered = effectiveContractsForRound(next.employment, next.seasonNumber, next.round).filter(contract => contract.clubId === club.id);
      const pending = getInSeasonOffers(next, club.id, true);
      const departing = new Set(getInSeasonOffers(next, undefined, true).filter(offer => offer.transfer?.sellerClubId === club.id && offer.transfer.clubStatus === 'accepted').map(offer => offer.playerId));
      const healthy = registered.filter(contract => !departing.has(contract.playerId) && !next.injuries.some(injury => injury.playerId === contract.playerId && isRecovering(injury, responseOn))).length;
      const needed = club.id === state.managedClubId ? 10 - registered.length + departing.size - pending.length : 8 - healthy - pending.length;
      if (needed <= 0 || registered.length + pending.length >= MAX_ROSTER_SIZE) break;
      const positions = new Map<string, number>();
      for (const playerId of [...registered.map(contract => contract.playerId), ...pending.map(offer => offer.playerId)]) {
        const position = DEVELOPMENT_PLAYERS.find(player => player.id === playerId)!.position;
        positions.set(position, (positions.get(position) ?? 0) + 1);
      }
      const assessed = (playerId: string): number => next.scouting.enabledSince ? scoutingRecruitmentRating(next, club.id, playerId) : Object.values(DEVELOPMENT_PLAYERS.find(player => player.id === playerId)!.attributes).reduce((sum, value) => sum + value, 0);
      const candidates = getInSeasonCandidates(next).filter(player => !pending.some(offer => offer.playerId === player.id) && !next.injuries.some(injury => injury.playerId === player.id && isRecovering(injury, responseOn))).sort((left, right) => (positions.get(left.position) ?? 0) - (positions.get(right.position) ?? 0) || assessed(right.id) - assessed(left.id) || left.id.localeCompare(right.id, 'en'));
      const player = candidates.find(player => quoteInSeasonOffer(next, player.id, getSeasonWage(player.id), club.id).canOffer);
      if (player) { next = submitInSeasonOffer(next, player.id, getSeasonWage(player.id), club.id); continue; }
      if (!next.recruitment.transfersEnabledSince) break;
      const paid = [...getInSeasonTransferCandidates(next, club.id)].filter(candidate => !pending.some(offer => offer.playerId === candidate.id) && !next.injuries.some(injury => injury.playerId === candidate.id && isRecovering(injury, responseOn))).sort((left, right) => (positions.get(left.position) ?? 0) - (positions.get(right.position) ?? 0) || assessed(right.id) - assessed(left.id) || left.id.localeCompare(right.id, 'en')).find(candidate => quoteInSeasonTransferOffer(next, candidate.id, getSeasonWage(candidate.id), 1, requiredInSeasonTransferFee(next, candidate.id), club.id).canOffer);
      if (!paid) break;
      next = submitInSeasonTransferOffer(next, paid.id, getSeasonWage(paid.id), 1, requiredInSeasonTransferFee(next, paid.id), club.id);
    }
  }
  return next;
}
