import type { ClubContractSummary, EmploymentContract, PlayerContractQuote, SeasonEmployment } from '../domain/employment';
import type { SeasonState } from '../domain/season';
import type { Player, Team } from '../domain/types';
import { DEVELOPMENT_CLUBS } from '../data/development-league';
import { DEVELOPMENT_PLAYERS } from '../data/development-players';
import { getSeasonWage } from '../data/development-wages';
import { getLiveMarketOffers, getMarketWindow, isMarketActive } from './market-policy';

export const EMPLOYMENT_BUDGET = 24_000_000;
export const MIN_ROSTER_SIZE = 8;
export const MAX_ROSTER_SIZE = 12;
export const MIN_CONTRACT_WAGE = 500_000;
export const MAX_CONTRACT_WAGE = 5_000_000;
export const WAGE_STEP = 50_000;
export const MAX_CONTRACT_SEASONS = 3;
/** Retain room for eight players even if every remaining signing asks the catalog maximum. */
export const MIN_ROSTER_WAGE_RESERVE = 1_800_000;

export function contractForSeason(employment: SeasonEmployment, playerId: string, seasonNumber: number): EmploymentContract | null {
  return employment.contracts.find(contract => contract.playerId === playerId && contract.startsSeason <= seasonNumber && contract.endsSeason >= seasonNumber) ?? null;
}

export function getClubContractSummary(state: Pick<SeasonState, 'employment' | 'seasonNumber'> & Partial<Pick<SeasonState, 'market'>>, clubId: string, seasonNumber = state.seasonNumber + 1, excludeOfferId?: string): ClubContractSummary {
  const contracts = state.employment.contracts.filter(contract => contract.clubId === clubId && contract.startsSeason <= seasonNumber && contract.endsSeason >= seasonNumber);
  const rosterSize = contracts.length, seasonWages = contracts.reduce((total, contract) => total + contract.seasonWage, 0);
  const reserved = getLiveMarketOffers(state).filter(offer => offer.clubId === clubId && offer.id !== excludeOfferId && offer.seasonNumber + 1 <= seasonNumber && offer.seasonNumber + offer.seasons >= seasonNumber);
  const reservedWages = reserved.reduce((total, offer) => total + offer.seasonWage, 0), reservedRosterSize = reserved.length;
  const remainingBudget = EMPLOYMENT_BUDGET - seasonWages - reservedWages;
  const minimumReserve = Math.max(0, MIN_ROSTER_SIZE - rosterSize - reservedRosterSize) * MIN_ROSTER_WAGE_RESERVE;
  return { clubId, seasonNumber, rosterSize, seasonWages, reservedWages, reservedRosterSize, budget: EMPLOYMENT_BUDGET, remainingBudget, minimumReserve, spendableBudget: Math.max(0, remainingBudget - minimumReserve), contracts };
}

/** Public offers and automation share ownership, term, roster and annual-budget guards. */
export function quotePlayerContract(state: SeasonState, playerId: string, seasonWage: number, seasons: number, clubId = state.managedClubId, resolvingOfferId?: string): PlayerContractQuote {
  const player = DEVELOPMENT_PLAYERS.find(candidate => candidate.id === playerId);
  const startsSeason = state.seasonNumber + 1, endsSeason = startsSeason + seasons - 1;
  const askingWage = player ? getSeasonWage(playerId) : 0;
  const current = contractForSeason(state.employment, playerId, state.seasonNumber);
  const openOffer = getLiveMarketOffers(state).find(offer => offer.playerId === playerId);
  const window = getMarketWindow(state);
  const resolving = !!resolvingOfferId && openOffer?.id === resolvingOfferId && openOffer.clubId === clubId && openOffer.status === 'pending' && openOffer.seasonWage === seasonWage && openOffer.seasons === seasons && openOffer.responseOn === state.date && !!window && state.date <= window.closesOn;
  let reason: string | null = null;
  if (!state.employment.enabledSince) reason = 'Enable player contracts before negotiating.';
  else if (!state.finance.enabledSince || !state.payroll.enabledSince) reason = 'Enable finances and player payroll before negotiating contracts.';
  else if (!player || !state.clubs.some(club => club.id === clubId)) reason = 'Choose a development player and a club in this league.';
  else if (!Number.isInteger(seasons) || seasons < 1 || seasons > MAX_CONTRACT_SEASONS || endsSeason > 7974) reason = 'Choose a contract lasting one to three supported seasons.';
  else if (!Number.isInteger(seasonWage) || seasonWage < MIN_CONTRACT_WAGE || seasonWage > MAX_CONTRACT_WAGE || seasonWage % WAGE_STEP !== 0) reason = 'Choose an annual wage from €5,000 to €50,000 in €500 steps.';
  else if (seasonWage < askingWage && !state.negotiations.enabledSince) reason = 'The player will not accept less than his asking wage.';
  else if (state.employment.contracts.some(contract => contract.playerId === playerId && contract.startsSeason <= endsSeason && contract.endsSeason >= startsSeason)) reason = 'This player already has a contract covering the proposed seasons.';
  else if (state.status === 'active' && (current?.clubId !== clubId || current.endsSeason !== state.seasonNumber)) reason = 'During the season, renew only your own players whose contracts expire this year.';
  else if (state.status === 'complete' && state.employment.market?.seasonNumber !== startsSeason) reason = 'Open the offseason recruitment window before offering contracts.';
  else if (state.status === 'complete' && state.market?.enabledSince && (!isMarketActive(state) || !window)) reason = 'Open the offseason decision calendar before sending offers.';
  else if (state.status === 'complete' && state.market?.enabledSince && window && state.date >= window.closesOn && !resolving) reason = 'The recruitment period has closed.';
  else if (openOffer && openOffer.clubId !== clubId) reason = `This player is considering an offer from ${state.clubs.find(club => club.id === openOffer.clubId)?.name ?? 'another club'}.`;
  if (reason === null) for (let year = startsSeason; year <= endsSeason; year += 1) {
    const summary = getClubContractSummary(state, clubId, year, openOffer?.clubId === clubId ? openOffer.id : undefined), size = summary.rosterSize + summary.reservedRosterSize + 1;
    if (size > MAX_ROSTER_SIZE) { reason = `The squad already has twelve contracted players for season ${year}.`; break; }
    const reserve = Math.max(0, MIN_ROSTER_SIZE - size) * MIN_ROSTER_WAGE_RESERVE;
    if (summary.seasonWages + summary.reservedWages + seasonWage + reserve > EMPLOYMENT_BUDGET) { reason = `This offer exceeds the season ${year} wage budget after protecting space for eight players${summary.reservedWages ? ' and pending offers' : ''}.`; break; }
  }
  return { playerId, clubId, startsSeason, endsSeason, seasons, seasonWage, askingWage, canOffer: reason === null, reason };
}

/** Players without an opening-day employer; current-season ownership is preserved. */
export function getAvailablePlayers(state: Pick<SeasonState, 'employment' | 'seasonNumber' | 'status'> & Partial<Pick<SeasonState, 'market'>>): readonly Player[] {
  if (!state.employment.enabledSince || state.status !== 'complete' || state.employment.market?.seasonNumber !== state.seasonNumber + 1) return [];
  const held = new Set(getLiveMarketOffers(state).map(offer => offer.playerId));
  return DEVELOPMENT_PLAYERS.filter(player => !held.has(player.id) && !contractForSeason(state.employment, player.id, state.seasonNumber + 1));
}

/** Stable catalog order and collision-free jerseys make registrations reproducible on import. */
export function getContractedClubs(state: { employment: SeasonEmployment; clubs: readonly Team[] }, seasonNumber: number): readonly Team[] {
  if (!state.employment.enabledSince || seasonNumber < state.employment.enabledSince.seasonNumber) return DEVELOPMENT_CLUBS;
  return DEVELOPMENT_CLUBS.map(definition => {
    const club = state.clubs.find(club => club.id === definition.id) ?? definition;
    const numbers = new Set<number>();
    const players = DEVELOPMENT_PLAYERS.filter(player => contractForSeason(state.employment, player.id, seasonNumber)?.clubId === club.id).map(player => {
      let number = player.number;
      if (numbers.has(number)) { number = 1; while (numbers.has(number)) number += 1; }
      numbers.add(number);
      return { ...player, number, attributes: { ...player.attributes } };
    });
    return { id: club.id, name: club.name, shortName: club.shortName, color: club.color, players };
  });
}
