import { leavingClubIds } from './background';
import type { MarketOffer, MarketWindow } from '../domain/market';
import type { SeasonState } from '../domain/season';
import { contractForSeason, effectiveContractsForSeason, MIN_ROSTER_SIZE } from './employment-policy';

export const MARKET_WINDOW_DAYS = 28;
export const MARKET_RESPONSE_DAYS = 1;
export const MARKET_OFFER_DAYS = 7;
export const MARKET_MAX_EVENTS = 20_000;

export function addMarketDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export function getMarketWindow(state: Pick<SeasonState, 'market' | 'seasonNumber'>): MarketWindow | null {
  return state.market?.windows.find(window => window.seasonNumber === state.seasonNumber) ?? null;
}

export function isLiveMarketOffer(offer: MarketOffer): boolean { return offer.status === 'pending' || offer.status === 'countered' || offer.status === 'club-review'; }

export function getReservedTransferFees(state: { market?: SeasonState['market']; seasonNumber?: number }, clubId: string, excludeOfferId?: string): number {
  if (state.seasonNumber === undefined) return 0;
  return getLiveMarketOffers({ market: state.market, seasonNumber: state.seasonNumber }).filter(offer => offer.clubId === clubId && offer.id !== excludeOfferId).reduce((total, offer) => total + (offer.transfer?.fee ?? 0), 0);
}

export function isCompetitiveMarket(state: { market?: SeasonState['market']; seasonNumber: number }): boolean {
  const window = state.market?.windows.find(item => item.seasonNumber === state.seasonNumber);
  return !!window && window.competitionFromEvent !== null && window.events.length >= window.competitionFromEvent;
}

export function getRivalMarketOffers(state: SeasonState, playerId: string, clubId = state.managedClubId): MarketOffer[] {
  return getLiveMarketOffers(state).filter(offer => offer.playerId === playerId && offer.clubId !== clubId);
}

/** Stable tie-break independent of command order and the sporting random stream. */
function clubPreference(playerId: string, clubId: string): number {
  let hash = 2166136261;
  for (const character of `${playerId}:${clubId}`) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  return hash;
}

export function compareMarketOffers(state: SeasonState, left: MarketOffer, right: MarketOffer): number {
  const current = contractForSeason(state.employment, left.playerId, state.seasonNumber)?.clubId;
  return right.seasonWage - left.seasonWage || right.seasons - left.seasons
    || Number(right.clubId === current) - Number(left.clubId === current)
    || clubPreference(left.playerId, left.clubId) - clubPreference(right.playerId, right.clubId)
    || left.clubId.localeCompare(right.clubId, 'en');
}

export function isMarketActive(state: Pick<SeasonState, 'market' | 'seasonNumber' | 'status'>): boolean {
  const window = getMarketWindow(state);
  return !!state.market?.enabledSince && state.status === 'complete' && !!window && !window.closed;
}

export function getMarketOffers(state: SeasonState, clubId = state.managedClubId, liveOnly = false): MarketOffer[] {
  return (getMarketWindow(state)?.offers ?? []).filter(offer => offer.clubId === clubId && (!liveOnly || isLiveMarketOffer(offer)));
}

// Step 3.7: live offers are picked out once per offer list (lists and offers are replaced, never edited; the length guards
// against an edited list). Contract and spending guards ask for them many times per decision. Each caller gets a copy.
const liveOffersCache = new WeakMap<readonly MarketOffer[], { length: number; live: readonly MarketOffer[] }>();
export function getLiveMarketOffers(state: { market?: SeasonState['market']; seasonNumber: number }): MarketOffer[] {
  const offers = state.market?.windows.find(window => window.seasonNumber === state.seasonNumber && !window.closed)?.offers;
  if (!offers) return [];
  let known = liveOffersCache.get(offers);
  if (!known || known.length !== offers.length) { known = { length: offers.length, live: offers.filter(isLiveMarketOffer) }; liveOffersCache.set(offers, known); }
  return [...known.live];
}

/** Advancing stops at the first response or expiry, so a decision cannot silently be skipped. */
export function getNextMarketDate(state: SeasonState): string | null {
  const window = getMarketWindow(state);
  if (!isMarketActive(state) || !window || window.date >= window.closesOn) return null;
  const dates = [addMarketDays(window.date, 7), window.closesOn, ...window.offers.filter(isLiveMarketOffer).map(offer => offer.status === 'pending' ? offer.responseOn : offer.expiresOn)];
  return dates.filter(date => date > window.date).sort()[0] ?? null;
}

export function quoteMarketDates(state: SeasonState, transfer = false): { responseOn: string; expiresOn: string; clubResponseOn?: string } | null {
  const window = getMarketWindow(state);
  if (!isMarketActive(state) || !window || state.date >= window.closesOn) return null;
  const responseOn = addMarketDays(state.date, transfer ? 2 : MARKET_RESPONSE_DAYS);
  if (responseOn > window.closesOn) return null;
  return { responseOn, expiresOn: [addMarketDays(state.date, MARKET_OFFER_DAYS), window.closesOn].sort()[0]!, ...(transfer ? { clubResponseOn: addMarketDays(state.date, 1) } : {}) };
}

export function getMarketStartReason(state: SeasonState): string | null {
  if (!state.market?.enabledSince) return null;
  if (!isMarketActive(state)) return 'Finish this season before starting the next one.';
  // Say whose offers still wait and what to do (browser play-through, 16 November 2026: "Resolve or withdraw outstanding
  // offers" showed while the manager had none open; the open offers were other clubs').
  const live = getLiveMarketOffers(state);
  if (live.some(offer => offer.clubId === state.managedClubId)) return 'Your offers are still waiting for replies. Continue the offseason to get the replies, or withdraw the offers.';
  if (live.some(offer => offer.transfer?.sellerClubId === state.managedClubId && offer.status === 'club-review')) return 'Clubs are waiting for your answer to their offers for your players. Answer them, or continue the offseason until they expire.';
  if (live.length) return 'Other clubs\' offers are still open. Continue the offseason to let the players answer them.';
  const year = state.seasonNumber + 1;
  const effective = effectiveContractsForSeason(state.employment, year);
  const leaving = leavingClubIds(state);
  const incomplete = state.clubs.filter(club => !leaving.has(club.id) && effective.filter(contract => contract.clubId === club.id).length < MIN_ROSTER_SIZE);
  if (!incomplete.length) return null;
  return incomplete.some(club => club.id === state.managedClubId) ? 'Your squad needs at least eight signed players for next season. Make offers to players, then continue the offseason to get their replies.' : 'Other clubs still need at least eight signed players for next season. Continue the offseason to let them sign players.';
}

/** Whether continuing the offseason is the way to the next season now: the start is blocked and a decision date remains. */
export function offseasonContinueFirst(state: SeasonState): boolean {
  return !!getMarketStartReason(state) && getNextMarketDate(state) !== null;
}
