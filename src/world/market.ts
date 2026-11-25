import { leavingClubIds } from './background';
import { clubRosterTarget, isCapClub, minRosterSize } from './club-roster-policy';
import { processFacilityProjects, automateFacilities } from './facilities';
import type { MarketEvent, MarketOffer, MarketWindow, SeasonMarket } from '../domain/market';
import type { ContractOfferOptions } from '../domain/employment';
import type { SeasonState } from '../domain/season';
import type { TransferPaymentPlan } from '../domain/transfer-payments';
import { getActiveCareerPlayers, getCareerPlayers } from './player-catalog';
import { contractForSeason, getClubContractSummary, MIN_ROSTER_SIZE, playerContractQuoter, quotePlayerContract } from './employment-policy';
import { commitPlayerOffer, scheduledOfferQuote } from './employment';
import { commitContractBuyout, quoteContractBuyout } from './buyouts';
import { NBA_FREE_AGENCY_RULES, nbaMakesRoom } from './nba-free-agency';
import { refreshBudget, refreshesThisWindow, refreshLimit, refreshRating, releaseCandidates, SQUAD_REFRESH_RULES, usesSquadRefresh } from './squad-refresh';
import { coachRecruitmentRating, scoutingActualAttributes, scoutingRecruitmentRating } from './scouting-policy';
import { clubStyleFit } from './head-coaches';
import { evaluateNegotiation } from './negotiations-policy';
import { getApplicableReleaseClause, offerOptionsReason } from './release-clauses';
import { processTransferPayments } from './transfer-payments';
import { getTransferCandidates, MIN_TRANSFER_FEE, quoteTransferOffer, requiredTransferFee, sellerReplacementReason, TRANSFER_FEE_STEP } from './transfers-policy';
import { DAILY_RECOVERY, dateForRound, MAX_SEASON_NUMBER } from './season';
import { addMarketDays, compareMarketOffers, getLiveMarketOffers, getMarketStartReason, getMarketWindow, getNextMarketDate, isCompetitiveMarket, isLiveMarketOffer, isMarketActive, MARKET_MAX_EVENTS, MARKET_OFFER_DAYS, MARKET_RESPONSE_DAYS, MARKET_WINDOW_DAYS } from './market-policy';
import { playerInList, seasonRounds } from './career-world';
import { contractAskingWage, offeredContractRole } from './contract-roles';
import { automaticWageCheck } from './automatic-wages';
import { paidSigningLimit, saleReplacementBudget, spendsSurplus, surplusOfferWage, surplusTransferBudget } from './surplus-spending';
import { usesSpendingBalance } from './spending-balance';
import { isNbaPaidPlayer, NBA_MOVES_RULES, nbaEligibilityReason, nbaValue, usesNbaMoves } from './nba-moves';
import { draftClassOf, draftRightsHolder, heldDraftRights, isDraftComplete } from './draft-index';
import { overallRating } from './overall-rating';
import { rookieContract } from './nba-draft';
import { usesNbaDraft } from './nba-draft-policy';
import { applyDraftPicks, automaticPicks, draftRoomFor, managerOnTheClock, openDraft, pendingDraftDay } from './nba-draft-policy';
import { answerOffseasonTrades } from './trades';

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
    if (previous?.seasonWage === event.seasonWage && previous.seasons === event.seasons && previous.releaseFee === event.releaseFee && previous.role === event.role && (previous.transfer?.mode ?? undefined) === event.transferMode && (previous.transfer?.fee ?? undefined) === event.transferFee && (previous.transfer?.paymentPlan ?? 'upfront') === paymentPlan) throw new Error('The same offer is already open.');
    const options: ContractOfferOptions = { ...(event.releaseFee === undefined ? {} : { releaseFee: event.releaseFee }), ...(event.transferMode ? { transferMode: event.transferMode } : {}), ...(event.role === undefined ? {} : { role: event.role }) };
    const quote = quotePlayerContract(state, event.playerId, event.seasonWage, event.seasons, event.clubId, undefined, event.transferFee, paymentPlan, options);
    if (!quote.canOffer) throw new Error(quote.reason!);
    const responseOn = addMarketDays(event.date, MARKET_RESPONSE_DAYS);
    if (responseOn > window.closesOn) throw new Error('Allow a decision day before recruitment closes.');
    const offer: MarketOffer = {
      id: event.id, clubId: event.clubId, playerId: event.playerId, seasonNumber: state.seasonNumber,
      offeredOn: event.date, responseOn, expiresOn: [addMarketDays(event.date, MARKET_OFFER_DAYS), window.closesOn].sort()[0]!,
      seasonWage: event.seasonWage, seasons: event.seasons, ...(quote.capRoute ? { capRoute: quote.capRoute } : {}), status: 'pending', respondedOn: null, closedOn: null, negotiationId: null, chosenOfferId: null,
      ...(event.releaseFee === undefined ? {} : { releaseFee: event.releaseFee }),
      ...(event.role === undefined ? {} : { role: event.role }),
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
  if (event.type === 'draft') {
    // Format 95 (NBA step 8): picks of this season's draft, on draft day.
    const next = applyDraftPicks(state, event.picks, event.playerId), picked = getMarketWindow(next)!;
    return replaceWindow(next, { ...picked, events: [...picked.events, { ...event }] });
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
  // Format 95: the draft finishes on draft day (the manager's open picks are made first, by him or his assistant).
  const drafting = draftClassOf(state, state.seasonNumber);
  if (drafting && !isDraftComplete(drafting)) throw new Error('Finish the NBA draft before the offseason continues.');
  const draftDay = pendingDraftDay(state);
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
    const winner = proposals.find(offer => evaluateNegotiation(offer.playerId, offer.seasonWage, offer.seasons, offer.releaseFee, state, offer.role, offer.clubId).outcome === 'accepted');
    if (!winner) { for (const offer of proposals) answer(offer); continue; }
    answer(winner);
    const chosen = getMarketWindow(next)!;
    next = replaceWindow(next, { ...chosen, offers: chosen.offers.map(offer => offer.playerId === playerId && offer.id !== winner.id && isLiveMarketOffer(offer) ? { ...offer, status: 'lost', closedOn: date, chosenOfferId: winner.id } : offer) });
  }
  const resolved = getMarketWindow(next)!;
  next = replaceWindow(next, { ...resolved, competitionFromEvent: window.competitionFromEvent, offers: resolved.offers.map(offer => isLiveMarketOffer(offer) && offer.expiresOn <= date ? { ...offer, status: 'expired', closedOn: date } : offer) });
  const leaving = leavingClubIds(next);
  const incomplete = next.clubs.filter(club => !leaving.has(club.id) && getClubContractSummary(next, club.id).rosterSize < minRosterSize(next, club.id));
  if (date === window.closesOn && incomplete.length) throw new Error(`Recruitment cannot close: ${incomplete.map(club => club.name).join(', ')} need ${incomplete.some(club => isCapClub(next, club.id)) ? 'their minimum of' : 'eight'} signed players. The date and offers are unchanged. Improve or withdraw competing offers, or delegate recruitment before continuing.`);
  const paid = processTransferPayments(next);
  // Format 95 (NBA step 8): draft day records the lottery, the order and the class of prospects.
  return draftDay === date ? openDraft(paid) : paid;
}

export function submitMarketOffer(state: SeasonState, playerId: string, seasonWage: number, seasons: number, clubId = state.managedClubId, transferFee?: number, transferPaymentPlan: TransferPaymentPlan = 'upfront', options: ContractOfferOptions = {}): SeasonState {
  const reason = offerOptionsReason(state, options, transferFee !== undefined); if (reason) throw new Error(reason);
  state = activateCompetition(state);
  const window = requireWindow(state);
  const existing = window.offers.find(offer => offer.clubId === clubId && offer.playerId === playerId && isLiveMarketOffer(offer));
  // relationships-3: the role offered is recorded with the offer (the chosen one, or his natural role at this club).
  const role = offeredContractRole(state, clubId, playerId, options);
  if (existing?.seasonWage === seasonWage && existing.seasons === seasons && existing.releaseFee === options.releaseFee && existing.role === role && (existing.transfer?.mode ?? 'negotiated') === (options.transferMode ?? 'negotiated') && (existing.transfer?.fee ?? undefined) === transferFee && (existing.transfer?.paymentPlan ?? 'upfront') === transferPaymentPlan) return state;
  return applyMarketEvent(state, { type: 'offer', id: `market-${state.seasonNumber}-${window.offers.length + 1}`, date: state.date, clubId, playerId, seasonWage, seasons, ...(transferFee === undefined ? {} : { transferFee }), ...(transferPaymentPlan === 'upfront' && options.transferMode !== 'release-clause' ? {} : { transferPaymentPlan }), ...(options.releaseFee === undefined ? {} : { releaseFee: options.releaseFee }), ...(options.transferMode === 'release-clause' ? { transferMode: 'release-clause' } : {}), ...(role === undefined ? {} : { role }) });
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
      ? submitTransferOffer(next, offer.playerId, offer.seasonWage, offer.seasons, fee, offer.clubId, offer.transfer.paymentPlan, { ...(offer.releaseFee === undefined ? {} : { releaseFee: offer.releaseFee }), ...(offer.role === undefined ? {} : { role: offer.role }) })
      : withdrawMarketOffer(next, offer.id, offer.clubId);
  }
  // Format 89: a club run automatically that has agreed to sell one of its players reserves wages to replace him, which
  // can leave one of its own pending offers beyond its wage budget before the player answers (the answer then stopped the
  // window with an error, measured in a real Turkey world): it withdraws such an offer (a recorded command, so the save
  // check replays it exactly).
  if (usesSpendingBalance(next)) for (const offer of getLiveMarketOffers(next)) {
    if (offer.status !== 'pending' || offer.clubId === state.managedClubId && !state.employment.delegated) continue;
    if (!getLiveMarketOffers(next).some(item => item.transfer?.sellerClubId === offer.clubId && item.transfer.clubStatus === 'accepted')) continue;
    if (!scheduledOfferQuote(next, offer).canOffer) next = withdrawMarketOffer(next, offer.id, offer.clubId);
  }
  const finalProposalDay = isCompetitiveMarket(next) && addMarketDays(next.date, MARKET_RESPONSE_DAYS) === getMarketWindow(next)!.closesOn;
  // On the last proposal day, an automatic club must be able to recover from a
  // losing bid. Withdraw only its own unsafe holds and offer ordinary terms to
  // unopposed alternatives, rather than trapping the calendar in an AI tie.
  const leaving = leavingClubIds(state);
  if (finalProposalDay) for (const club of state.clubs) {
    if (club.id === state.managedClubId && !state.employment.delegated || leaving.has(club.id) || getClubContractSummary(next, club.id).rosterSize >= minRosterSize(next, club.id)) continue;
    for (const offer of getLiveMarketOffers(next).filter(item => item.clubId === club.id)) {
      const acceptable = offer.status === 'pending' && (!offer.transfer || offer.transfer.clubStatus === 'accepted') && evaluateNegotiation(offer.playerId, offer.seasonWage, offer.seasons, offer.releaseFee, next, offer.role, offer.clubId).outcome === 'accepted';
      const better = getLiveMarketOffers(next).some(rival => rival.playerId === offer.playerId && rival.clubId !== club.id && rival.status === 'pending' && evaluateNegotiation(rival.playerId, rival.seasonWage, rival.seasons, rival.releaseFee, next, rival.role, rival.clubId).outcome === 'accepted' && compareMarketOffers(next, rival, offer) < 0);
      if (!acceptable || better) next = withdrawMarketOffer(next, offer.id, club.id);
    }
  }
  // Format 95 (draft-and-stash): rights holders run automatically bring their stashed players over when it pays.
  next = bringOverStashedPlayers(next);
  for (const club of state.clubs) {
    if (club.id === state.managedClubId && !state.employment.delegated || leaving.has(club.id)) continue;
    // Format 95: an NBA club keeps room for its first-round picks until the draft is over.
    const target = clubRosterTarget(state, club.id, club.id === state.managedClubId ? 10 : MIN_ROSTER_SIZE) - draftRoomFor(next, club.id);
    // Format 102: a rich club with a full squad releases a weak player to sign a clearly better one (`squad-refresh.ts`).
    next = refreshSquad(next, club.id, target, finalProposalDay);
    for (let count = 0; count < target; count += 1) {
      const summary = getClubContractSummary(next, club.id);
      if (summary.rosterSize + summary.reservedRosterSize >= target) break;
      const live = getLiveMarketOffers(next), positions = new Map<string, number>();
      for (const id of [...summary.contracts.map(item => item.playerId), ...live.filter(item => item.clubId === club.id).map(item => item.playerId)]) {
        const position = playerInList(getCareerPlayers(next), id)!.position;
        positions.set(position, (positions.get(position) ?? 0) + 1);
      }
      // Step 3.7: each candidate's rating and the club's own players are worked out once, not in every comparison, and one
      // club quoter serves every candidate of this unchanged state (same values, same order, same first offerable player).
      const own = new Set(club.players.map(player => player.id)), ratings = new Map<string, number>();
      // Format 86: a club whose head coach steers prefers players who fit his style (`clubStyleFit`).
      const fit = clubStyleFit(next, club.id), fitted = fit ? coachRecruitmentRating(next, club.id, fit) : null;
      const rating = (id: string) => {
        const known = ratings.get(id);
        if (known !== undefined) return known;
        const value: number = fitted ? fitted(id) : next.scouting.enabledSince ? scoutingRecruitmentRating(next, club.id, id) : Object.values(next.lifecycle?.enabledSince ? scoutingActualAttributes(next, id) : playerInList(getCareerPlayers(next), id)!.attributes).reduce((total, skill) => total + skill, 0);
        ratings.set(id, value);
        return value;
      };
      // Format 88: a club spending from its surplus ranks its own expiring players with free agents (by need, then rating)
      // instead of renewing its own first, so its extra wage room buys better players.
      const spending = spendsSurplus(next, club.id);
      // Format 93: a computer-run NBA club signs at most `europeansPerWindow` Europeans (players never paid on the NBA's
      // scale) in one offseason window, counting its open and accepted offers (on the last proposal day it may take more to reach 13).
      const capMoves = usesNbaMoves(next) && isCapClub(next, club.id);
      const europeansLeft = capMoves && !finalProposalDay ? NBA_MOVES_RULES.europeansPerWindow - getMarketWindow(next)!.offers.filter(offer => offer.clubId === club.id && (offer.status === 'accepted' || isLiveMarketOffer(offer)) && !isNbaPaidPlayer(next.world!, offer.playerId)).length : Infinity;
      const ranked = getActiveCareerPlayers(next, next.seasonNumber + 1, 1).filter(player => (europeansLeft > 0 || isNbaPaidPlayer(next.world!, player.id)) && !contractForSeason(next.employment, player.id, next.seasonNumber + 1) && !live.some(item => item.playerId === player.id && (!isCompetitiveMarket(next) || finalProposalDay || item.clubId === club.id))).sort((left, right) => {
        const retained = spending ? 0 : Number(own.has(right.id)) - Number(own.has(left.id));
        return retained || (positions.get(left.position) ?? 0) - (positions.get(right.position) ?? 0) || rating(right.id) - rating(left.id) || Number(own.has(right.id)) - Number(own.has(left.id)) || left.id.localeCompare(right.id, 'en');
      });
      const quote = playerContractQuoter(next, club.id);
      // relationships-3: computer clubs offer each player his natural role at the asking wage for it.
      // Format 88: a club spending from its surplus offers more than the asking wage (a premium, or its own pay scale for
      // the player's place in its squad, this season's players and those signed for the next), so it wins contested players
      // and pays as a rich club does; when such an offer does not fit its guards, it offers the asking wage as before.
      const asking = (id: string) => contractAskingWage(next, club.id, id);
      const squad = spending ? [...new Set([...club.players.map(item => item.id), ...summary.contracts.map(item => item.playerId), ...live.filter(item => item.clubId === club.id).map(item => item.playerId)])] : [];
      const offers = new Map<string, number>();
      const offered = (id: string): number => {
        let value = offers.get(id);
        if (value === undefined) { value = surplusOfferWage(next, club.id, asking(id), 1 + squad.filter(other => other !== id && rating(other) > rating(id)).length, target, next.seasonNumber + 1); offers.set(id, value); }
        return value;
      };
      // Format 87: while its cash is low, a club keeps its new wages within what its money funds (`automaticWageCheck`).
      const affordable = automaticWageCheck(next, club.id), startsSeason = next.seasonNumber + 1;
      const wage = spending ? (id: string) => offered(id) > asking(id) && quote(id, offered(id), 1).canOffer && affordable(offered(id), 1, startsSeason) ? offered(id) : asking(id) : asking;
      const player = ranked.find(player => quote(player.id, wage(player.id), 1).canOffer && affordable(wage(player.id), 1, startsSeason));
      // A club that has sold a player can buy a stronger, known replacement.
      // Retain/free recruitment remains the default, with identical fee guards.
      const sold = next.employment.transfers.some(transfer => transfer.seasonNumber === next.seasonNumber && transfer.fromClubId === club.id);
      // Format 88: a club with a transfer budget from its surplus also tries paid signings (one, or two with a bigger
      // appetite), each fee within that budget; a club that sold keeps its one stronger replacement as before.
      const paidTries = getMarketWindow(next)!.offers.filter(offer => offer.clubId === club.id && offer.transfer).length;
      // Format 93: an NBA club tries one buyout a window: a European it may sign (`nbaEligibilityReason`) through his
      // release clause (`nba-moves.ts`); it never pays fees to another NBA club.
      const buyout = capMoves;
      const transferBudget = buyout ? Infinity : sold ? saleReplacementBudget(next, club.id) : surplusTransferBudget(next, club.id);
      if (paidTries < (buyout ? 1 : paidSigningLimit(next, club.id, sold)) && !finalProposalDay) {
        const assessed = (id: string) => fitted ? rating(id) : next.scouting.enabledSince ? scoutingRecruitmentRating(next, club.id, id) : Object.values(next.lifecycle?.enabledSince ? scoutingActualAttributes(next, id) : playerInList(getCareerPlayers(next), id)!.attributes).reduce((sum, value) => sum + value, 0);
        const approach = (id: string): { fee: number; options: ContractOfferOptions } => {
          const askingFee = requiredTransferFee(next, id), clause = getApplicableReleaseClause(next, id);
          return clause.canTrigger && clause.fee! <= askingFee && quoteTransferOffer(next, id, asking(id), 1, clause.fee!, club.id, 'upfront', { transferMode: 'release-clause' }).canOffer ? { fee: clause.fee!, options: { transferMode: 'release-clause' } } : { fee: askingFee, options: {} };
        };
        // Format 88: the wage of a paid signing, as for free agents (the transfer's own guard decides whether more fits).
        const signingWage = (id: string, terms: { fee: number; options: ContractOfferOptions }) => spending && offered(id) > asking(id) && affordable(offered(id), 1, startsSeason) && quoteTransferOffer(next, id, offered(id), 1, terms.fee, club.id, 'upfront', terms.options).canOffer ? offered(id) : asking(id);
        const paid = [...getTransferCandidates(next, club.id)].filter(candidate => (!buyout || europeansLeft > 0 && !isCapClub(next, contractForSeason(next.employment, candidate.id, next.seasonNumber + 1)!.clubId) && getApplicableReleaseClause(next, candidate.id).canTrigger && !nbaEligibilityReason(next, club.id, candidate.id)) && (!usesNbaMoves(next) || buyout || !isCapClub(next, contractForSeason(next.employment, candidate.id, next.seasonNumber + 1)!.clubId)) && (transferBudget === Infinity || requiredTransferFee(next, candidate.id) <= transferBudget) && !getMarketWindow(next)!.offers.some(offer => offer.clubId === club.id && offer.playerId === candidate.id && offer.transfer)).sort((a, b) => assessed(b.id) - assessed(a.id) || a.id.localeCompare(b.id, 'en')).find(candidate => { const terms = approach(candidate.id); return (!player || assessed(candidate.id) > assessed(player.id)) && terms.fee <= transferBudget && affordable(signingWage(candidate.id, terms), 1, startsSeason) && quoteTransferOffer(next, candidate.id, signingWage(candidate.id, terms), 1, terms.fee, club.id, 'upfront', terms.options).canOffer; });
        if (paid) {
          const terms = approach(paid.id);
          const openingFee = terms.options.transferMode === 'release-clause' || buyout ? terms.fee : Math.max(MIN_TRANSFER_FEE, Math.floor(terms.fee * .9 / TRANSFER_FEE_STEP) * TRANSFER_FEE_STEP);
          next = submitTransferOffer(next, paid.id, signingWage(paid.id, terms), 1, openingFee, club.id, 'upfront', terms.options); continue;
        }
      }
      if (!player) break;
      next = submitMarketOffer(next, player.id, wage(player.id), 1, club.id);
    }
  }
  return next;
}

/**
 * Format 102 (`squad-refresh.ts`, owner decision 24 November 2026): a club run automatically that spends from a surplus
 * and has a full squad releases one of its weakest players (the existing contract buyout) when a clearly better player
 * of the same position is affordable once the released wage is freed, and offers him a contract at once (a free agent,
 * or a paid transfer, the release and the fee within its planned spending, `refreshBudget`). Both are recorded commands, so the save check replays them; a lost
 * bid leaves a gap the club's ordinary recruitment fills. Unchanged state without the rule.
 */
function refreshSquad(state: SeasonState, clubId: string, target: number, finalProposalDay: boolean): SeasonState {
  // Format 103: NBA clubs also make room for a clearly better free agent (`nba-free-agency.ts`).
  if (finalProposalDay || !usesSquadRefresh(state) && !nbaMakesRoom(state, clubId) || !isCompetitiveMarket(state)) return state;
  if (addMarketDays(state.date, MARKET_RESPONSE_DAYS) > getMarketWindow(state)!.closesOn) return state;
  let next = state;
  const startsSeason = state.seasonNumber + 1;
  while (refreshesThisWindow(next, clubId) < refreshLimit(next, clubId)) {
    const summary = getClubContractSummary(next, clubId);
    if (summary.rosterSize + summary.reservedRosterSize < target) break;
    const live = getLiveMarketOffers(next), busy = new Set(live.map(offer => offer.playerId)), players = getCareerPlayers(next);
    // A refresh judges players by their real skills (`refreshRating`): a computer club's scouting rarely covers free
    // agents, whose unknown ratings would otherwise all read as the neutral prior.
    const ratings = new Map<string, number>();
    // Format 103: an NBA club making room judges players by their overall rating at their position (`nbaValue`), as the
    // NBA's level is read everywhere else; the sum of skills undervalues specialists such as centres.
    const nbaRoom = nbaMakesRoom(next, clubId), margin = nbaRoom ? NBA_FREE_AGENCY_RULES.roomMargin : SQUAD_REFRESH_RULES.margin;
    const rating = (id: string): number => { let value = ratings.get(id); if (value === undefined) { value = nbaRoom ? nbaValue(next, id) : refreshRating(next, id); ratings.set(id, value); } return value; };
    // The wages a release still owes (every remaining guaranteed season), to release the cheaper of two equal players.
    const owed = (id: string) => next.employment.contracts.filter(contract => contract.playerId === id && contract.clubId === clubId && contract.endsSeason >= startsSeason).reduce((sum, contract) => sum + contract.seasonWage * (contract.endsSeason - Math.max(startsSeason, contract.startsSeason) + 1), 0);
    const budget = refreshBudget(next, clubId), capClub = isCapClub(next, clubId);
    const free = getActiveCareerPlayers(next, startsSeason, 1).filter(player => !contractForSeason(next.employment, player.id, startsSeason) && !live.some(offer => offer.playerId === player.id && offer.clubId === clubId) && (!capClub || isNbaPaidPlayer(next.world!, player.id)));
    const paidPool = capClub ? [] : getTransferCandidates(next, clubId).filter(candidate => !(usesNbaMoves(next) && isCapClub(next, contractForSeason(next.employment, candidate.id, startsSeason)!.clubId)) && !getMarketWindow(next)!.offers.some(offer => offer.clubId === clubId && offer.playerId === candidate.id));
    let refreshed: SeasonState | null = null;
    for (const weakId of releaseCandidates(next, clubId, summary.contracts, rating, busy, owed)) {
      const release = quoteContractBuyout(next, weakId, clubId);
      if (!release.canBuyout || release.amount >= budget) continue;
      const position = playerInList(players, weakId)!.position, bar = rating(weakId) + margin;
      const fee = (id: string): { fee: number; options: ContractOfferOptions } => {
        const askingFee = requiredTransferFee(next, id), clause = getApplicableReleaseClause(next, id);
        return clause.canTrigger && clause.fee! <= askingFee ? { fee: clause.fee!, options: { transferMode: 'release-clause' } } : { fee: askingFee, options: {} };
      };
      type Terms = { fee: number; options: ContractOfferOptions } | null;
      const targets: { id: string; terms: Terms }[] = [
        ...free.filter(player => player.position === position && rating(player.id) >= bar).map(player => ({ id: player.id, terms: null as Terms })),
        // A paid target only while a free agent as good as the released player is there too, in case the bid fails.
        ...paidPool.filter(player => player.position === position && rating(player.id) >= bar && free.some(other => other.position === position && rating(other.id) >= rating(weakId))).map(player => ({ id: player.id, terms: fee(player.id) as Terms })).filter(item => release.amount + item.terms!.fee <= budget),
      ].sort((left, right) => rating(right.id) - rating(left.id) || left.id.localeCompare(right.id, 'en'));
      if (!targets.length) continue;
      // Every check reads the state after the release (pure), so the released wage is freed for the new contract.
      const released = buyoutPlayerContract(next, weakId, clubId);
      const quote = playerContractQuoter(released, clubId), affordable = automaticWageCheck(released, clubId), asking = (id: string) => contractAskingWage(released, clubId, id);
      const squad = [...getClubContractSummary(released, clubId).contracts.map(contract => contract.playerId), ...getLiveMarketOffers(released).filter(offer => offer.clubId === clubId).map(offer => offer.playerId)];
      const offered = (id: string) => surplusOfferWage(released, clubId, asking(id), 1 + squad.filter(other => rating(other) > rating(id)).length, target, startsSeason);
      const fits = (id: string, wage: number, terms: Terms) => affordable(wage, 1, startsSeason) && (terms ? quoteTransferOffer(released, id, wage, 1, terms.fee, clubId, 'upfront', terms.options) : quote(id, wage, 1)).canOffer;
      for (const { id, terms } of targets) {
        const wage = offered(id) > asking(id) && fits(id, offered(id), terms) ? offered(id) : asking(id);
        if (!fits(id, wage, terms)) continue;
        if (!terms) refreshed = submitMarketOffer(released, id, wage, 1, clubId);
        else {
          const opening = terms.options.transferMode === 'release-clause' ? terms.fee : Math.max(MIN_TRANSFER_FEE, Math.floor(terms.fee * .9 / TRANSFER_FEE_STEP) * TRANSFER_FEE_STEP);
          refreshed = submitTransferOffer(released, id, wage, 1, opening, clubId, 'upfront', terms.options);
        }
        break;
      }
      if (refreshed) break;
    }
    if (!refreshed) break;
    next = refreshed;
  }
  return next;
}

export function advanceMarket(state: SeasonState): SeasonState {
  requireWindow(state);
  // Format 95 (NBA step 8): continuing on draft day leaves the manager's open picks to his assistant.
  const drafting = draftClassOf(state, state.seasonNumber);
  if (drafting && !isDraftComplete(drafting)) state = delegateDraft(state);
  // Delegation can be switched on at any decision point, including the last proposal day.
  const prepared = scheduleMarketRecruitment(state);
  const date = getNextMarketDate(prepared);
  if (!date) throw new Error('Recruitment has closed. Review the squad and start next season.');
  // Format 95: on draft day the computer clubs pick until the manager's club is on the clock (all picks when he
  // delegates recruitment or has no club), before the clubs make their offers of the day.
  const advanced = scheduleMarketRecruitment(runDraftClock(activateCompetition(applyMarketEvent(prepared, { type: 'advance', date }))));
  // Format 94: trade offers due on the new day are answered.
  return answerOffseasonTrades(automateFacilities(processFacilityProjects(advanced)));
}

/** Format 95: the computer's picks until the manager's club is on the clock (every pick left when he delegates or has no club). */
function runDraftClock(state: SeasonState): SeasonState {
  const entry = draftClassOf(state, state.seasonNumber);
  if (!entry || isDraftComplete(entry) || entry.date !== state.date) return state;
  const picks = automaticPicks(state, state.employment.delegated || !state.managedClubId);
  return picks > 0 ? applyMarketEvent(state, { type: 'draft', date: state.date, picks, playerId: null }) : state;
}

/** Format 95 (NBA step 8): the manager's draft pick ("Make pick"); the computer clubs then pick until his club is next on the clock. */
export function makeDraftPick(state: SeasonState, playerId: string): SeasonState {
  requireWindow(state);
  if (!managerOnTheClock(state)) throw new Error('Your club is not on the clock in the NBA draft.');
  return applyMarketEvent(state, { type: 'draft', date: state.date, picks: 1 + automaticPicks(state, false, 1), playerId });
}

/** Format 95: the assistant makes every pick left in this season's draft, the manager's club's too. */
export function delegateDraft(state: SeasonState): SeasonState {
  requireWindow(state);
  const entry = draftClassOf(state, state.seasonNumber);
  if (!entry || isDraftComplete(entry)) return state;
  return applyMarketEvent(state, { type: 'draft', date: state.date, picks: automaticPicks(state, true), playerId: null });
}

export function finishMarketWindow(state: SeasonState): SeasonState {
  const reason = getMarketStartReason(state);
  if (reason) throw new Error(reason);
  const window = requireWindow(state);
  return replaceWindow(state, { ...window, closed: true });
}

/** Format 95: the terms to bring a stashed player over: his asking wage at the club, for his pick's rookie term. */
function bringOverTerms(state: SeasonState, clubId: string, playerId: string): { seasonWage: number; seasons: number; fee: number | null } {
  const right = heldDraftRights(state).find(item => item.playerId === playerId && item.clubId === clubId)!;
  const european = contractForSeason(state.employment, playerId, state.seasonNumber + 1);
  return { seasonWage: contractAskingWage(state, clubId, playerId), seasons: rookieContract(right.pick).seasons, fee: european ? requiredTransferFee(state, playerId) : null };
}

/**
 * Format 95 (draft-and-stash, owner 23 November 2026): the rights holder brings a stashed player over in the offseason:
 * an ordinary transfer offer paying his European club its asking fee (the buyout, received as transfer income), or a
 * contract offer when he has no contract for next season. The player and his club answer as for any offer.
 */
export function bringOverStashedPlayer(state: SeasonState, playerId: string, clubId = state.managedClubId): SeasonState {
  if (draftRightsHolder(state, playerId) !== clubId) throw new Error('Your club does not hold this player\'s draft rights.');
  const terms = bringOverTerms(state, clubId, playerId);
  return terms.fee === null ? submitMarketOffer(state, playerId, terms.seasonWage, terms.seasons, clubId) : submitTransferOffer(state, playerId, terms.seasonWage, terms.seasons, terms.fee, clubId);
}

/** Whether the rights holder brings him over now: he would play in its rotation (top ten by rating), or a first-round pick has stayed two seasons. */
function wantsStashedPlayer(state: SeasonState, clubId: string, playerId: string, pick: number, draftedIn: number): boolean {
  const rating = (id: string) => { const player = getCareerPlayers(state).find(item => item.id === id)!; return overallRating(player.attributes, player.position); };
  const squad = getClubContractSummary(state, clubId).contracts.map(contract => rating(contract.playerId));
  const better = squad.filter(value => value > rating(playerId)).length;
  return better < 10 || pick <= 30 && state.seasonNumber - draftedIn >= 2;
}

function bringOverStashedPlayers(state: SeasonState): SeasonState {
  if (!usesNbaDraft(state) || !state.draft?.rights?.length) return state;
  const drafting = draftClassOf(state, state.seasonNumber);
  if (drafting && !isDraftComplete(drafting)) return state;
  let next = state;
  for (const right of heldDraftRights(state)) {
    if (right.clubId === state.managedClubId && !state.employment.delegated) continue;
    if (getMarketWindow(next)!.offers.some(offer => offer.clubId === right.clubId && offer.playerId === right.playerId)) continue;
    if (!wantsStashedPlayer(next, right.clubId, right.playerId, right.pick, right.seasonNumber)) continue;
    const terms = bringOverTerms(next, right.clubId, right.playerId);
    const quote = terms.fee === null ? quotePlayerContract(next, right.playerId, terms.seasonWage, terms.seasons, right.clubId) : quoteTransferOffer(next, right.playerId, terms.seasonWage, terms.seasons, terms.fee, right.clubId);
    if (quote.canOffer) next = bringOverStashedPlayer(next, right.playerId, right.clubId);
  }
  return next;
}
