import type { MarketEvent, MarketOffer, MarketWindow, SeasonMarket } from '../domain/market';
import type { SeasonState } from '../domain/season';
import { getSeasonWage } from '../data/development-wages';
import { DEVELOPMENT_PLAYERS } from '../data/development-players';
import { contractForSeason, getClubContractSummary, MIN_ROSTER_SIZE, quotePlayerContract } from './employment-policy';
import { commitPlayerOffer } from './employment';
import { scoutingRecruitmentRating } from './scouting-policy';
import { DAILY_RECOVERY, dateForRound, MAX_SEASON_NUMBER, SEASON_ROUNDS } from './season';
import { addMarketDays, getLiveMarketOffers, getMarketStartReason, getMarketWindow, getNextMarketDate, isLiveMarketOffer, isMarketActive, MARKET_MAX_EVENTS, MARKET_OFFER_DAYS, MARKET_RESPONSE_DAYS, MARKET_WINDOW_DAYS } from './market-policy';

export function createMarket(): SeasonMarket { return { model: 'market-1', enabledSince: null, windows: [] }; }

function replaceWindow(state: SeasonState, window: MarketWindow): SeasonState {
  return { ...state, market: { ...state.market, windows: state.market.windows.map(previous => previous.seasonNumber === window.seasonNumber ? window : previous) } };
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
  const openedOn = dateForRound(SEASON_ROUNDS, state.seasonNumber);
  if (state.date !== openedOn || state.round !== SEASON_ROUNDS) throw new Error('Open recruitment after committing the final matchday.');
  const window: MarketWindow = {
    seasonNumber: state.seasonNumber, openedOn, closesOn: addMarketDays(openedOn, MARKET_WINDOW_DAYS), date: openedOn,
    contractCountBefore: state.employment.contracts.length, negotiationCountBefore: state.negotiations.records.length,
    closed: false, events: [], offers: [],
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
  if (state.market.windows.reduce((sum, item) => sum + item.events.length, 0) >= MARKET_MAX_EVENTS) throw new Error('This development career has reached its retained recruitment-event limit.');
  if (event.type !== 'advance' && event.date !== state.date) throw new Error('An offer decision must use the current recruitment date.');
  if (event.type === 'offer') {
    if (event.id !== `market-${state.seasonNumber}-${window.offers.length + 1}`) throw new Error('Offer identity is not sequential.');
    const previous = window.offers.find(offer => offer.clubId === event.clubId && offer.playerId === event.playerId && isLiveMarketOffer(offer));
    if (previous?.seasonWage === event.seasonWage && previous.seasons === event.seasons) throw new Error('The same offer is already open.');
    const quote = quotePlayerContract(state, event.playerId, event.seasonWage, event.seasons, event.clubId);
    if (!quote.canOffer) throw new Error(quote.reason!);
    const responseOn = addMarketDays(event.date, MARKET_RESPONSE_DAYS);
    if (responseOn > window.closesOn) throw new Error('Allow a decision day before recruitment closes.');
    const offer: MarketOffer = {
      id: event.id, clubId: event.clubId, playerId: event.playerId, seasonNumber: state.seasonNumber,
      offeredOn: event.date, responseOn, expiresOn: [addMarketDays(event.date, MARKET_OFFER_DAYS), window.closesOn].sort()[0]!,
      seasonWage: event.seasonWage, seasons: event.seasons, status: 'pending', respondedOn: null, closedOn: null, negotiationId: null,
    };
    const offers = window.offers.map(item => item.id === previous?.id ? { ...item, status: 'replaced' as const, closedOn: state.date } : item);
    return replaceWindow(state, { ...window, events: [...window.events, { ...event }], offers: [...offers, offer] });
  }
  if (event.type === 'withdraw') {
    const offer = window.offers.find(item => item.id === event.offerId);
    if (!offer || !isLiveMarketOffer(offer)) throw new Error('Only an outstanding offer can be withdrawn.');
    return replaceWindow(state, { ...window, events: [...window.events, { ...event }], offers: window.offers.map(item => item.id === offer.id ? { ...item, status: 'withdrawn', closedOn: state.date } : item) });
  }
  const date = getNextMarketDate(state);
  if (!date || event.date !== date) throw new Error('Continue to the next scheduled recruitment decision.');
  const days = (Date.parse(date) - Date.parse(state.date)) / 86_400_000;
  let next = replaceWindow({ ...state, date, conditions: Object.fromEntries(Object.entries(state.conditions).map(([id, condition]) => [id, Math.min(100, Math.round((condition + DAILY_RECOVERY * days) * 1000) / 1000)])) }, { ...window, date, events: [...window.events, { ...event }], offers: window.offers.map(offer => ({ ...offer })) });
  for (const scheduled of window.offers.filter(offer => offer.status === 'pending' && offer.responseOn <= date)) {
    // The command excludes this offer's own reservation and rechecks every covered season.
    const resolvingWindow = getMarketWindow(next)!;
    const answered = commitPlayerOffer(next, scheduled.clubId, scheduled.playerId, scheduled.seasonWage, scheduled.seasons, scheduled.id);
    const reply = answered.negotiations.records.at(-1)!;
    if (answered.negotiations.records.length !== next.negotiations.records.length + 1) throw new Error('Every scheduled offer must receive one new player response.');
    const offers = resolvingWindow.offers.map(offer => offer.id === scheduled.id ? { ...offer, status: reply.outcome, respondedOn: date, closedOn: reply.outcome === 'countered' ? null : date, negotiationId: reply.id } : offer);
    next = replaceWindow(answered, { ...resolvingWindow, offers });
  }
  const resolved = getMarketWindow(next)!;
  next = replaceWindow(next, { ...resolved, offers: resolved.offers.map(offer => isLiveMarketOffer(offer) && offer.expiresOn <= date ? { ...offer, status: 'expired', closedOn: date } : offer) });
  if (date === window.closesOn && next.clubs.some(club => getClubContractSummary(next, club.id).rosterSize < MIN_ROSTER_SIZE)) throw new Error('Recruitment cannot close with an incomplete squad. Sign eight players, improve outstanding offers or delegate recruitment before continuing.');
  return next;
}

export function submitMarketOffer(state: SeasonState, playerId: string, seasonWage: number, seasons: number, clubId = state.managedClubId): SeasonState {
  const window = requireWindow(state);
  const existing = window.offers.find(offer => offer.clubId === clubId && offer.playerId === playerId && isLiveMarketOffer(offer));
  if (existing?.seasonWage === seasonWage && existing.seasons === seasons) return state;
  return applyMarketEvent(state, { type: 'offer', id: `market-${state.seasonNumber}-${window.offers.length + 1}`, date: state.date, clubId, playerId, seasonWage, seasons });
}

export function withdrawMarketOffer(state: SeasonState, offerId: string, clubId = state.managedClubId): SeasonState {
  const window = requireWindow(state), offer = window.offers.find(item => item.id === offerId);
  if (!offer || offer.clubId !== clubId) throw new Error('Choose one of your own offers.');
  if (offer.status === 'withdrawn') return state;
  return applyMarketEvent(state, { type: 'withdraw', date: state.date, offerId });
}

/** Identical proposal guards for every club; automation never signs around the decision calendar. */
export function scheduleMarketRecruitment(state: SeasonState): SeasonState {
  if (!isMarketActive(state) || state.date >= getMarketWindow(state)!.closesOn) return state;
  let next = state;
  for (const club of state.clubs) {
    if (club.id === state.managedClubId && !state.employment.delegated) continue;
    const target = club.id === state.managedClubId ? 10 : MIN_ROSTER_SIZE;
    for (let count = 0; count < target; count += 1) {
      const summary = getClubContractSummary(next, club.id);
      if (summary.rosterSize + summary.reservedRosterSize >= target) break;
      const live = getLiveMarketOffers(next), positions = new Map<string, number>();
      for (const id of [...summary.contracts.map(item => item.playerId), ...live.filter(item => item.clubId === club.id).map(item => item.playerId)]) {
        const position = DEVELOPMENT_PLAYERS.find(player => player.id === id)!.position;
        positions.set(position, (positions.get(position) ?? 0) + 1);
      }
      const ranked = DEVELOPMENT_PLAYERS.filter(player => !contractForSeason(next.employment, player.id, next.seasonNumber + 1) && !live.some(item => item.playerId === player.id)).sort((left, right) => {
        const retained = Number(club.players.some(player => player.id === right.id)) - Number(club.players.some(player => player.id === left.id));
        const rating = (id: string) => next.scouting.enabledSince ? scoutingRecruitmentRating(next, club.id, id) : Object.values(DEVELOPMENT_PLAYERS.find(player => player.id === id)!.attributes).reduce((total, skill) => total + skill, 0);
        return retained || (positions.get(left.position) ?? 0) - (positions.get(right.position) ?? 0) || rating(right.id) - rating(left.id) || left.id.localeCompare(right.id, 'en');
      });
      const player = ranked.find(player => quotePlayerContract(next, player.id, getSeasonWage(player.id), 1, club.id).canOffer);
      if (!player) break;
      next = submitMarketOffer(next, player.id, getSeasonWage(player.id), 1, club.id);
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
  return scheduleMarketRecruitment(applyMarketEvent(prepared, { type: 'advance', date }));
}

export function finishMarketWindow(state: SeasonState): SeasonState {
  const reason = getMarketStartReason(state);
  if (reason) throw new Error(reason);
  const window = requireWindow(state);
  return replaceWindow(state, { ...window, closed: true });
}
