import { clubRosterTarget } from './club-roster-policy';
import { processFacilityProjects, automateFacilities } from './facilities';
import type { MarketEvent, MarketOffer, MarketWindow, SeasonMarket } from '../domain/market';
import type { ContractOfferOptions } from '../domain/employment';
import type { SeasonState } from '../domain/season';
import type { TransferPaymentPlan } from '../domain/transfer-payments';
import { getActiveCareerPlayers, getCareerPlayers, getCareerWage } from './player-catalog';
import { contractForSeason, getClubContractSummary, MIN_ROSTER_SIZE, quotePlayerContract } from './employment-policy';
import { commitPlayerOffer } from './employment';
import { commitContractBuyout } from './buyouts';
import { scoutingActualAttributes, scoutingRecruitmentRating } from './scouting-policy';
import { evaluateNegotiation } from './negotiations-policy';
import { getApplicableReleaseClause, offerOptionsReason } from './release-clauses';
import { processTransferPayments } from './transfer-payments';
import { getTransferCandidates, MIN_TRANSFER_FEE, quoteTransferOffer, requiredTransferFee, sellerReplacementReason, TRANSFER_FEE_STEP } from './transfers-policy';
import { DAILY_RECOVERY, dateForRound, MAX_SEASON_NUMBER } from './season';
import { addMarketDays, compareMarketOffers, getLiveMarketOffers, getMarketStartReason, getMarketWindow, getNextMarketDate, isCompetitiveMarket, isLiveMarketOffer, isMarketActive, MARKET_MAX_EVENTS, MARKET_OFFER_DAYS, MARKET_RESPONSE_DAYS, MARKET_WINDOW_DAYS } from './market-policy';
import { seasonRounds } from './career-world';

export function createMarket(): SeasonMarket { return { model: 'market-1', enabledSince: null, windows: [] }; }

function replaceWindow(state: SeasonState, window: MarketWindow): SeasonState {
  return { ...state, market: { ...state.market, windows: state.market.windows.map(previous => previous.seasonNumber === window.seasonNumber ? window : previous) } };
}

/** Finish existing imported promises under their original rules, then enable rival bids. */
function activateCompetition(state: SeasonState): SeasonState {
  const window = getMarketWindow(state);
  return isMarketActive(state) && window?.competitionFromEvent === null && !getLiveMarketOffers(state).length
    ? replaceWindow(state, { ...window, competitionFromEvent: window.events.length }) : state;
}

export function enableMarket(state: SeasonState): SeasonState {
  if (state.market.enabledSince) return state;
  if (!state.negotiations.enabledSince || !state.employment.enabledSince) throw new Error('Enable player contracts and negotiations before the offseason calendar.');
  if (state.seasonNumber >= MAX_SEASON_NUMBER) throw new Error('This career has reached the last supported season.');
  const next: SeasonState = { ...state, market: { model: 'market-1', enabledSince: { seasonNumber: state.seasonNumber, round: state.round, contractCount: state.employment.contracts.length, negotiationCount: state.negotiations.records.length }, windows: [] } };
  return state.status === 'complete' ? prepareMarketWindow(next) : next;
}

/** Called once after final matchday commitment; old results and current registrations stay intact. */
export function prepareMarketWindow(state: SeasonState): SeasonState {
  if (!state.market.enabledSince || state.status !== 'complete' || state.seasonNumber >= MAX_SEASON_NUMBER) return state;
  if (getMarketWindow(state)) return state;
  const rounds = seasonRounds(state), openedOn = dateForRound(rounds, state.seasonNumber);
  if (state.date !== openedOn || state.round !== rounds) throw new Error('Open recruitment after committing the final matchday.');
  const window: MarketWindow = {
    seasonNumber: state.seasonNumber, openedOn, closesOn: addMarketDays(openedOn, MARKET_WINDOW_DAYS), date: openedOn,
    contractCountBefore: state.employment.contracts.length, negotiationCountBefore: state.negotiations.records.length,
    closed: false, competitionFromEvent: 0, events: [], offers: [],
  };
  const next: SeasonState = { ...state, employment: { ...state.employment, market: { seasonNumber: state.seasonNumber + 1 } }, market: { ...state.market, windows: [...state.market.windows, window] } };
  return scheduleMarketRecruitment(next);
}

function requireWindow(state: SeasonState): MarketWindow {
  const window = getMarketWindow(state);
  if (!isMarketActive(state) || !window) throw new Error('The offseason calendar is not open.');
  if (window.date !== state.date) throw new Error('The recruitment calendar and career date disagree.');
  return window;
}

/** Pure journal reducer, also used by strict save replay. Automation records separate ordinary offers. */
export function applyMarketEvent(state: SeasonState, event: MarketEvent): SeasonState {
  const window = requireWindow(state);
  const competitive = isCompetitiveMarket(state);
  if (state.market.windows.reduce((sum, item) => sum + item.events.length, 0) >= MARKET_MAX_EVENTS) throw new Error('This development career has reached its retained recruitment-event limit.');
  if (event.type !== 'advance' && event.date !== state.date) throw new Error('An offer decision must use the current recruitment date.');
  if (event.type === 'offer') {
    if (event.id !== `market-${state.seasonNumber}-${window.offers.length + 1}`) throw new Error('Offer identity is not sequential.');
    const previous = window.offers.find(offer => offer.clubId === event.clubId && offer.playerId === event.playerId && isLiveMarketOffer(offer));
    const paymentPlan = event.transferPaymentPlan ?? 'upfront';
    if (event.transferPaymentPlan !== undefined && event.transferFee === undefined) throw new Error('Payment plans require a club transfer fee.');
    if (previous?.seasonWage === event.seasonWage && previous.seasons === event.seasons && previous.releaseFee === event.releaseFee && (previous.transfer?.mode ?? undefined) === event.transferMode && (previous.transfer?.fee ?? undefined) === event.transferFee && (previous.transfer?.paymentPlan ?? 'upfront') === paymentPlan) throw new Error('The same offer is already open.');
    const options: ContractOfferOptions = { ...(event.releaseFee === undefined ? {} : { releaseFee: event.releaseFee }), ...(event.transferMode ? { transferMode: event.transferMode } : {}) };
    const quote = quotePlayerContract(state, event.playerId, event.seasonWage, event.seasons, event.clubId, undefined, event.transferFee, paymentPlan, options);
    if (!quote.canOffer) throw new Error(quote.reason!);
    const responseOn = addMarketDays(event.date, MARKET_RESPONSE_DAYS);
    if (responseOn > window.closesOn) throw new Error('Allow a decision day before recruitment closes.');
    const offer: MarketOffer = {
      id: event.id, clubId: event.clubId, playerId: event.playerId, seasonNumber: state.seasonNumber,
      offeredOn: event.date, responseOn, expiresOn: [addMarketDays(event.date, MARKET_OFFER_DAYS), window.closesOn].sort()[0]!,
      seasonWage: event.seasonWage, seasons: event.seasons, status: 'pending', respondedOn: null, closedOn: null, negotiationId: null, chosenOfferId: null,
      ...(event.releaseFee === undefined ? {} : { releaseFee: event.releaseFee }),
      transfer: event.transferFee === undefined ? null : {
        sellerClubId: contractForSeason(state.employment, event.playerId, state.seasonNumber + 1)!.clubId,
        contractId: contractForSeason(state.employment, event.playerId, state.seasonNumber + 1)!.id,
        fee: event.transferFee, paymentPlan, requiredFee: requiredTransferFee(state, event.playerId), clubStatus: event.transferMode === 'release-clause' ? 'accepted' : 'pending',
        clubResponseOn: event.transferMode === 'release-clause' ? event.date : responseOn, clubRespondedOn: event.transferMode === 'release-clause' ? event.date : null, clubReason: event.transferMode === 'release-clause' ? 'Release clause invoked. The player decides next; selling-club consent is not required.' : null, counterFee: null,
        ...(event.transferMode === 'release-clause' ? { mode: 'release-clause' as const } : {}),
      },
    };
    if (offer.transfer?.mode === 'release-clause') { const reason = sellerReplacementReason(state, offer); if (reason) throw new Error(reason); }
    const offers = window.offers.map(item => item.id === previous?.id ? { ...item, status: 'replaced' as const, closedOn: state.date } : item);
    return replaceWindow(state, { ...window, events: [...window.events, { ...event }], offers: [...offers, offer] });
  }
  if (event.type === 'buyout') {
    if (event.id !== `employment-buyout-${(state.employment.buyouts ?? []).length + 1}`) throw new Error('Buyout identity is not sequential.');
    const next = commitContractBuyout(state, event.playerId, event.clubId);
    return replaceWindow(next, { ...window, events: [...window.events, { ...event }] });
  }
  if (event.type === 'withdraw') {
    const offer = window.offers.find(item => item.id === event.offerId);
    if (!offer || !isLiveMarketOffer(offer)) throw new Error('Only an outstanding offer can be withdrawn.');
    return replaceWindow(state, { ...window, events: [...window.events, { ...event }], offers: window.offers.map(item => item.id === offer.id ? { ...item, status: 'withdrawn', closedOn: state.date } : item) });
  }
  if (event.type === 'club-decision') {
    const offer = window.offers.find(item => item.id === event.offerId);
    if (!offer?.transfer || offer.status !== 'club-review' || offer.transfer.clubStatus !== 'review') throw new Error('Choose a transfer offer awaiting the selling club’s decision.');
    if (state.date < offer.transfer.clubResponseOn || state.date >= offer.expiresOn) throw new Error('Decide on the club offer before its deadline.');
    let updated: MarketOffer;
    if (event.response === 'accept') {
      const reason = sellerReplacementReason(state, offer);
      if (reason) throw new Error(reason);
      const responseOn = addMarketDays(state.date, 1);
      if (responseOn > window.closesOn || responseOn > offer.expiresOn) throw new Error('Allow a player decision before the transfer offer expires.');
      updated = { ...offer, status: 'pending', responseOn, transfer: { ...offer.transfer, clubStatus: 'accepted', clubRespondedOn: state.date, clubReason: 'Fee agreed with the selling club.', counterFee: null } };
    } else if (event.response === 'counter') {
      if (offer.transfer.fee >= offer.transfer.requiredFee) throw new Error('This offer already meets the club’s asking fee. Accept or reject it.');
      updated = { ...offer, status: 'countered', transfer: { ...offer.transfer, clubStatus: 'countered', clubRespondedOn: state.date, clubReason: 'The selling club asks for its full asking fee.', counterFee: offer.transfer.requiredFee } };
    } else if (event.response === 'reject') {
      const clubReason = sellerReplacementReason(state, offer) ?? (offer.transfer.fee * 2 < offer.transfer.requiredFee ? 'The transfer fee is below half the club’s asking price.' : 'The selling club declined this offer.');
      updated = { ...offer, status: 'rejected', closedOn: state.date, transfer: { ...offer.transfer, clubStatus: 'rejected', clubRespondedOn: state.date, clubReason, counterFee: null } };
    } else throw new Error('Choose accept, reject or the asking fee.');
    return replaceWindow(state, { ...window, events: [...window.events, { ...event }], offers: window.offers.map(item => item.id === offer.id ? updated : item) });
  }
  const date = getNextMarketDate(state);
  if (!date || event.date !== date) throw new Error('Continue to the next scheduled recruitment decision.');
  const days = (Date.parse(date) - Date.parse(state.date)) / 86_400_000;
  // Use the policy at the start of the event, including when replay reaches an upgrade boundary.
  let next = replaceWindow({ ...state, date, conditions: Object.fromEntries(Object.entries(state.conditions).map(([id, condition]) => [id, Math.min(100, Math.round((condition + DAILY_RECOVERY * days) * 1000) / 1000)])) }, { ...window, competitionFromEvent: competitive ? window.competitionFromEvent : null, date, events: [...window.events, { ...event }], offers: window.offers.map(offer => ({ ...offer })) });
  const clubDue = window.offers.filter(offer => offer.status === 'pending' && offer.transfer?.clubStatus === 'pending' && offer.responseOn <= date);
  const clubWindow = getMarketWindow(next)!;
  next = replaceWindow(next, { ...clubWindow, offers: clubWindow.offers.map(offer => clubDue.some(due => due.id === offer.id) ? { ...offer, status: 'club-review', transfer: { ...offer.transfer!, clubStatus: 'review' } } : offer) });
  const scheduled = window.offers.filter(offer => offer.status === 'pending' && (!offer.transfer || offer.transfer.clubStatus === 'accepted') && offer.responseOn <= date);
  function answer(offer: MarketOffer) {
    // The command excludes this offer's own reservation and rechecks every covered season.
    const resolvingWindow = getMarketWindow(next)!;
    const answered = commitPlayerOffer(next, offer.clubId, offer.playerId, offer.seasonWage, offer.seasons, offer.id);
    const reply = answered.negotiations.records.at(-1)!;
    if (answered.negotiations.records.length !== next.negotiations.records.length + 1) throw new Error('Every scheduled offer must receive one new player response.');
    const offers = resolvingWindow.offers.map(item => item.id === offer.id ? { ...item, status: reply.outcome, respondedOn: date, closedOn: reply.outcome === 'countered' ? null : date, negotiationId: reply.id } : item);
    next = replaceWindow(answered, { ...resolvingWindow, offers });
  }
  if (!competitive) for (const offer of scheduled) answer(offer);
  else for (const playerId of [...new Set(scheduled.map(offer => offer.playerId))].sort()) {
    const proposals = scheduled.filter(offer => offer.playerId === playerId).sort((left, right) => compareMarketOffers(next, left, right));
    const winner = proposals.find(offer => evaluateNegotiation(offer.playerId, offer.seasonWage, offer.seasons, offer.releaseFee, state).outcome === 'accepted');
    if (!winner) { for (const offer of proposals) answer(offer); continue; }
    answer(winner);
    const chosen = getMarketWindow(next)!;
    next = replaceWindow(next, { ...chosen, offers: chosen.offers.map(offer => offer.playerId === playerId && offer.id !== winner.id && isLiveMarketOffer(offer) ? { ...offer, status: 'lost', closedOn: date, chosenOfferId: winner.id } : offer) });
  }
  const resolved = getMarketWindow(next)!;
  next = replaceWindow(next, { ...resolved, competitionFromEvent: window.competitionFromEvent, offers: resolved.offers.map(offer => isLiveMarketOffer(offer) && offer.expiresOn <= date ? { ...offer, status: 'expired', closedOn: date } : offer) });
  const incomplete = next.clubs.filter(club => getClubContractSummary(next, club.id).rosterSize < MIN_ROSTER_SIZE);
  if (date === window.closesOn && incomplete.length) throw new Error(`Recruitment cannot close: ${incomplete.map(club => club.name).join(', ')} need eight signed players. The date and offers are unchanged. Improve or withdraw competing offers, or delegate recruitment before continuing.`);
  return processTransferPayments(next);
}

export function submitMarketOffer(state: SeasonState, playerId: string, seasonWage: number, seasons: number, clubId = state.managedClubId, transferFee?: number, transferPaymentPlan: TransferPaymentPlan = 'upfront', options: ContractOfferOptions = {}): SeasonState {
  const reason = offerOptionsReason(state, options, transferFee !== undefined); if (reason) throw new Error(reason);
  state = activateCompetition(state);
  const window = requireWindow(state);
  const existing = window.offers.find(offer => offer.clubId === clubId && offer.playerId === playerId && isLiveMarketOffer(offer));
  if (existing?.seasonWage === seasonWage && existing.seasons === seasons && existing.releaseFee === options.releaseFee && (existing.transfer?.mode ?? 'negotiated') === (options.transferMode ?? 'negotiated') && (existing.transfer?.fee ?? undefined) === transferFee && (existing.transfer?.paymentPlan ?? 'upfront') === transferPaymentPlan) return state;
  return applyMarketEvent(state, { type: 'offer', id: `market-${state.seasonNumber}-${window.offers.length + 1}`, date: state.date, clubId, playerId, seasonWage, seasons, ...(transferFee === undefined ? {} : { transferFee }), ...(transferPaymentPlan === 'upfront' && options.transferMode !== 'release-clause' ? {} : { transferPaymentPlan }), ...(options.releaseFee === undefined ? {} : { releaseFee: options.releaseFee }), ...(options.transferMode === 'release-clause' ? { transferMode: 'release-clause' } : {}) });
}

export function submitTransferOffer(state: SeasonState, playerId: string, seasonWage: number, seasons: number, fee: number, clubId = state.managedClubId, paymentPlan: TransferPaymentPlan = 'upfront', options: ContractOfferOptions = {}): SeasonState {
  return submitMarketOffer(state, playerId, seasonWage, seasons, clubId, fee, paymentPlan, options);
}

/** Review and payment use the same guards as replay; the calendar does not advance. */
export function buyoutPlayerContract(state: SeasonState, playerId: string, clubId = state.managedClubId): SeasonState {
  state = activateCompetition(state);
  return applyMarketEvent(state, { type: 'buyout', id: `employment-buyout-${(state.employment.buyouts ?? []).length + 1}`, date: state.date, clubId, playerId });
}

export function decideClubTransfer(state: SeasonState, offerId: string, response: 'accept' | 'reject' | 'counter', clubId = state.managedClubId): SeasonState {
  const window = requireWindow(state), offer = window.offers.find(item => item.id === offerId);
  if (!offer?.transfer || offer.transfer.sellerClubId !== clubId) throw new Error('Choose an offer for a player at your club.');
  return applyMarketEvent(state, { type: 'club-decision', date: state.date, offerId, response });
}

export function withdrawMarketOffer(state: SeasonState, offerId: string, clubId = state.managedClubId): SeasonState {
  const window = requireWindow(state), offer = window.offers.find(item => item.id === offerId);
  if (!offer || offer.clubId !== clubId) throw new Error('Choose one of your own offers.');
  if (offer.status === 'withdrawn') return state;
  return activateCompetition(applyMarketEvent(state, { type: 'withdraw', date: state.date, offerId }));
}

/** Identical proposal guards for every club; automation never signs around the decision calendar. */
export function scheduleMarketRecruitment(state: SeasonState): SeasonState {
  if (!isMarketActive(state) || state.date >= getMarketWindow(state)!.closesOn) return state;
  let next = activateCompetition(state);
  for (const offer of getLiveMarketOffers(next)) {
    if (!offer.transfer || offer.status !== 'club-review' || offer.transfer.sellerClubId === state.managedClubId && !state.employment.delegated) continue;
    const response = sellerReplacementReason(next, offer) || offer.transfer.fee * 2 < offer.transfer.requiredFee ? 'reject' : offer.transfer.fee < offer.transfer.requiredFee ? 'counter' : 'accept';
    next = decideClubTransfer(next, offer.id, response, offer.transfer.sellerClubId);
  }
  for (const offer of getLiveMarketOffers(next)) {
    if (!offer.transfer || offer.transfer.clubStatus !== 'countered' || offer.clubId === state.managedClubId && !state.employment.delegated) continue;
    const fee = offer.transfer.counterFee!;
    const quote = quoteTransferOffer(next, offer.playerId, offer.seasonWage, offer.seasons, fee, offer.clubId, offer.transfer.paymentPlan);
    next = quote.canOffer && fee <= offer.transfer.requiredFee
      ? submitTransferOffer(next, offer.playerId, offer.seasonWage, offer.seasons, fee, offer.clubId, offer.transfer.paymentPlan, { ...(offer.releaseFee === undefined ? {} : { releaseFee: offer.releaseFee }) })
      : withdrawMarketOffer(next, offer.id, offer.clubId);
  }
  const finalProposalDay = isCompetitiveMarket(next) && addMarketDays(next.date, MARKET_RESPONSE_DAYS) === getMarketWindow(next)!.closesOn;
  // On the last proposal day, an automatic club must be able to recover from a
  // losing bid. Withdraw only its own unsafe holds and offer ordinary terms to
  // unopposed alternatives, rather than trapping the calendar in an AI tie.
  if (finalProposalDay) for (const club of state.clubs) {
    if (club.id === state.managedClubId && !state.employment.delegated || getClubContractSummary(next, club.id).rosterSize >= MIN_ROSTER_SIZE) continue;
    for (const offer of getLiveMarketOffers(next).filter(item => item.clubId === club.id)) {
      const acceptable = offer.status === 'pending' && (!offer.transfer || offer.transfer.clubStatus === 'accepted') && evaluateNegotiation(offer.playerId, offer.seasonWage, offer.seasons, offer.releaseFee, next).outcome === 'accepted';
      const better = getLiveMarketOffers(next).some(rival => rival.playerId === offer.playerId && rival.clubId !== club.id && rival.status === 'pending' && evaluateNegotiation(rival.playerId, rival.seasonWage, rival.seasons, rival.releaseFee, next).outcome === 'accepted' && compareMarketOffers(next, rival, offer) < 0);
      if (!acceptable || better) next = withdrawMarketOffer(next, offer.id, club.id);
    }
  }
  for (const club of state.clubs) {
    if (club.id === state.managedClubId && !state.employment.delegated) continue;
    const target = clubRosterTarget(state, club.id, club.id === state.managedClubId ? 10 : MIN_ROSTER_SIZE);
    for (let count = 0; count < target; count += 1) {
      const summary = getClubContractSummary(next, club.id);
      if (summary.rosterSize + summary.reservedRosterSize >= target) break;
      const live = getLiveMarketOffers(next), positions = new Map<string, number>();
      for (const id of [...summary.contracts.map(item => item.playerId), ...live.filter(item => item.clubId === club.id).map(item => item.playerId)]) {
        const position = getCareerPlayers(next).find(player => player.id === id)!.position;
        positions.set(position, (positions.get(position) ?? 0) + 1);
      }
      const ranked = getActiveCareerPlayers(next, next.seasonNumber + 1, 1).filter(player => !contractForSeason(next.employment, player.id, next.seasonNumber + 1) && !live.some(item => item.playerId === player.id && (!isCompetitiveMarket(next) || finalProposalDay || item.clubId === club.id))).sort((left, right) => {
        const retained = Number(club.players.some(player => player.id === right.id)) - Number(club.players.some(player => player.id === left.id));
        const rating = (id: string) => next.scouting.enabledSince ? scoutingRecruitmentRating(next, club.id, id) : Object.values(next.lifecycle?.enabledSince ? scoutingActualAttributes(next, id) : getCareerPlayers(next).find(player => player.id === id)!.attributes).reduce((total, skill) => total + skill, 0);
        return retained || (positions.get(left.position) ?? 0) - (positions.get(right.position) ?? 0) || rating(right.id) - rating(left.id) || left.id.localeCompare(right.id, 'en');
      });
      const player = ranked.find(player => quotePlayerContract(next, player.id, getCareerWage(next, player.id), 1, club.id).canOffer);
      // A club that has sold a player can buy a stronger, known replacement.
      // Retain/free recruitment remains the default, with identical fee guards.
      const sold = next.employment.transfers.some(transfer => transfer.seasonNumber === next.seasonNumber && transfer.fromClubId === club.id);
      const triedPaidTarget = getMarketWindow(next)!.offers.some(offer => offer.clubId === club.id && offer.transfer);
      if (sold && !triedPaidTarget && !finalProposalDay) {
        const assessed = (id: string) => next.scouting.enabledSince ? scoutingRecruitmentRating(next, club.id, id) : Object.values(next.lifecycle?.enabledSince ? scoutingActualAttributes(next, id) : getCareerPlayers(next).find(player => player.id === id)!.attributes).reduce((sum, value) => sum + value, 0);
        const approach = (id: string): { fee: number; options: ContractOfferOptions } => {
          const asking = requiredTransferFee(next, id), clause = getApplicableReleaseClause(next, id);
          return clause.canTrigger && clause.fee! <= asking && quoteTransferOffer(next, id, getCareerWage(next, id), 1, clause.fee!, club.id, 'upfront', { transferMode: 'release-clause' }).canOffer ? { fee: clause.fee!, options: { transferMode: 'release-clause' } } : { fee: asking, options: {} };
        };
        const paid = [...getTransferCandidates(next, club.id)].filter(candidate => !getMarketWindow(next)!.offers.some(offer => offer.clubId === club.id && offer.playerId === candidate.id && offer.transfer)).sort((a, b) => assessed(b.id) - assessed(a.id) || a.id.localeCompare(b.id, 'en')).find(candidate => { const terms = approach(candidate.id); return (!player || assessed(candidate.id) > assessed(player.id)) && quoteTransferOffer(next, candidate.id, getCareerWage(next, candidate.id), 1, terms.fee, club.id, 'upfront', terms.options).canOffer; });
        if (paid) {
          const terms = approach(paid.id);
          const openingFee = terms.options.transferMode === 'release-clause' ? terms.fee : Math.max(MIN_TRANSFER_FEE, Math.floor(terms.fee * .9 / TRANSFER_FEE_STEP) * TRANSFER_FEE_STEP);
          next = submitTransferOffer(next, paid.id, getCareerWage(next, paid.id), 1, openingFee, club.id, 'upfront', terms.options); continue;
        }
      }
      if (!player) break;
      next = submitMarketOffer(next, player.id, getCareerWage(next, player.id), 1, club.id);
    }
  }
  return next;
}

export function advanceMarket(state: SeasonState): SeasonState {
  requireWindow(state);
  // Delegation can be switched on at any decision point, including the last proposal day.
  const prepared = scheduleMarketRecruitment(state);
  const date = getNextMarketDate(prepared);
  if (!date) throw new Error('Recruitment has closed. Review the squad and start next season.');
  const advanced = scheduleMarketRecruitment(activateCompetition(applyMarketEvent(prepared, { type: 'advance', date })));
  return automateFacilities(processFacilityProjects(advanced));
}

export function finishMarketWindow(state: SeasonState): SeasonState {
  const reason = getMarketStartReason(state);
  if (reason) throw new Error(reason);
  const window = requireWindow(state);
  return replaceWindow(state, { ...window, closed: true });
}
