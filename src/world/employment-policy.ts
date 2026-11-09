import type { ClubContractSummary, EmploymentContract, PlayerContractQuote, SeasonEmployment } from '../domain/employment';
import type { SeasonState } from '../domain/season';
import type { Player, Team } from '../domain/types';
import { DEVELOPMENT_CLUBS } from '../data/development-league';
import { DEVELOPMENT_PLAYERS } from '../data/development-players';
import { getSeasonWage } from '../data/development-wages';

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

export function getClubContractSummary(state: Pick<SeasonState, 'employment' | 'seasonNumber'>, clubId: string, seasonNumber = state.seasonNumber + 1): ClubContractSummary {
  const contracts = state.employment.contracts.filter(contract => contract.clubId === clubId && contract.startsSeason <= seasonNumber && contract.endsSeason >= seasonNumber);
  const rosterSize = contracts.length, seasonWages = contracts.reduce((total, contract) => total + contract.seasonWage, 0);
  const remainingBudget = EMPLOYMENT_BUDGET - seasonWages;
  const minimumReserve = Math.max(0, MIN_ROSTER_SIZE - rosterSize) * MIN_ROSTER_WAGE_RESERVE;
  return { clubId, seasonNumber, rosterSize, seasonWages, budget: EMPLOYMENT_BUDGET, remainingBudget, minimumReserve, spendableBudget: Math.max(0, remainingBudget - minimumReserve), contracts };
}

/** Public offers and automation share ownership, term, roster and annual-budget guards. */
export function quotePlayerContract(state: SeasonState, playerId: string, seasonWage: number, seasons: number, clubId = state.managedClubId): PlayerContractQuote {
  const player = DEVELOPMENT_PLAYERS.find(candidate => candidate.id === playerId);
  const startsSeason = state.seasonNumber + 1, endsSeason = startsSeason + seasons - 1;
  const askingWage = player ? getSeasonWage(playerId) : 0;
  const current = contractForSeason(state.employment, playerId, state.seasonNumber);
  let reason: string | null = null;
  if (!state.employment.enabledSince) reason = 'Enable player contracts before negotiating.';
  else if (!state.finance.enabledSince || !state.payroll.enabledSince) reason = 'Enable finances and player payroll before negotiating contracts.';
  else if (!player || !state.clubs.some(club => club.id === clubId)) reason = 'Choose a development player and a club in this league.';
  else if (!Number.isInteger(seasons) || seasons < 1 || seasons > MAX_CONTRACT_SEASONS || endsSeason > 7974) reason = 'Choose a contract lasting one to three supported seasons.';
  else if (!Number.isInteger(seasonWage) || seasonWage < MIN_CONTRACT_WAGE || seasonWage > MAX_CONTRACT_WAGE || seasonWage % WAGE_STEP !== 0) reason = 'Choose an annual wage from €5,000 to €50,000 in €500 steps.';
  else if (seasonWage < askingWage) reason = 'The player will not accept less than his asking wage.';
  else if (state.employment.contracts.some(contract => contract.playerId === playerId && contract.startsSeason <= endsSeason && contract.endsSeason >= startsSeason)) reason = 'This player already has a contract covering the proposed seasons.';
  else if (state.status === 'active' && (current?.clubId !== clubId || current.endsSeason !== state.seasonNumber)) reason = 'During the season, renew only your own players whose contracts expire this year.';
  else if (state.status === 'complete' && state.employment.market?.seasonNumber !== startsSeason) reason = 'Open the offseason recruitment window before offering contracts.';
  if (reason === null) for (let year = startsSeason; year <= endsSeason; year += 1) {
    const summary = getClubContractSummary(state, clubId, year), size = summary.rosterSize + 1;
    if (size > MAX_ROSTER_SIZE) { reason = `The squad already has twelve contracted players for season ${year}.`; break; }
    const reserve = Math.max(0, MIN_ROSTER_SIZE - size) * MIN_ROSTER_WAGE_RESERVE;
    if (summary.seasonWages + seasonWage + reserve > EMPLOYMENT_BUDGET) { reason = `This offer exceeds the season ${year} wage budget after protecting space for eight players.`; break; }
  }
  return { playerId, clubId, startsSeason, endsSeason, seasons, seasonWage, askingWage, canOffer: reason === null, reason };
}

/** Players without an opening-day employer; current-season ownership is preserved. */
export function getAvailablePlayers(state: Pick<SeasonState, 'employment' | 'seasonNumber' | 'status'>): readonly Player[] {
  if (!state.employment.enabledSince || state.status !== 'complete' || state.employment.market?.seasonNumber !== state.seasonNumber + 1) return [];
  return DEVELOPMENT_PLAYERS.filter(player => !contractForSeason(state.employment, player.id, state.seasonNumber + 1));
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
