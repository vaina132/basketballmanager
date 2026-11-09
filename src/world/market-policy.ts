import type { MarketOffer, MarketWindow } from '../domain/market';
import type { SeasonState } from '../domain/season';
import { MIN_ROSTER_SIZE } from './employment-policy';

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

export function isLiveMarketOffer(offer: MarketOffer): boolean { return offer.status === 'pending' || offer.status === 'countered'; }

export function isMarketActive(state: Pick<SeasonState, 'market' | 'seasonNumber' | 'status'>): boolean {
  const window = getMarketWindow(state);
  return !!state.market?.enabledSince && state.status === 'complete' && !!window && !window.closed;
}

export function getMarketOffers(state: SeasonState, clubId = state.managedClubId, liveOnly = false): MarketOffer[] {
  return (getMarketWindow(state)?.offers ?? []).filter(offer => offer.clubId === clubId && (!liveOnly || isLiveMarketOffer(offer)));
}

export function getLiveMarketOffers(state: { market?: SeasonState['market']; seasonNumber: number }): MarketOffer[] {
  return state.market?.windows.find(window => window.seasonNumber === state.seasonNumber && !window.closed)?.offers.filter(isLiveMarketOffer) ?? [];
}

/** Advancing stops at the first response or expiry, so a decision cannot silently be skipped. */
export function getNextMarketDate(state: SeasonState): string | null {
  const window = getMarketWindow(state);
  if (!isMarketActive(state) || !window || window.date >= window.closesOn) return null;
  const dates = [addMarketDays(window.date, 7), window.closesOn, ...window.offers.filter(isLiveMarketOffer).map(offer => offer.status === 'pending' ? offer.responseOn : offer.expiresOn)];
  return dates.filter(date => date > window.date).sort()[0] ?? null;
}

export function quoteMarketDates(state: SeasonState): { responseOn: string; expiresOn: string } | null {
  const window = getMarketWindow(state);
  if (!isMarketActive(state) || !window || state.date >= window.closesOn) return null;
  return { responseOn: addMarketDays(state.date, MARKET_RESPONSE_DAYS), expiresOn: [addMarketDays(state.date, MARKET_OFFER_DAYS), window.closesOn].sort()[0]! };
}

export function getMarketStartReason(state: SeasonState): string | null {
  if (!state.market?.enabledSince) return null;
  if (!isMarketActive(state)) return 'Finish this season before starting the next one.';
  if (getLiveMarketOffers(state).length) return 'Resolve or withdraw outstanding offers before starting next season.';
  const year = state.seasonNumber + 1;
  const incomplete = state.clubs.filter(club => state.employment.contracts.filter(contract => contract.clubId === club.id && contract.startsSeason <= year && contract.endsSeason >= year).length < MIN_ROSTER_SIZE);
  return incomplete.length ? `${incomplete.some(club => club.id === state.managedClubId) ? 'Your squad needs' : 'Other clubs need'} at least eight signed players for next season. Continue recruitment.` : null;
}
