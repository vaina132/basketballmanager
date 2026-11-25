import type { EmploymentBuyout } from '../domain/employment';
import type { SeasonState } from '../domain/season';
import { getCareerPlayers } from './player-catalog';
import { contractForSeason, effectiveContractsForSeason, getClubContractSummary } from './employment-policy';
import { minRosterSize, minRosterText } from './club-roster-policy';
import { getFinanceBalance, recordContractBuyout } from './finance';
import { addMarketDays, getLiveMarketOffers, getMarketWindow, isCompetitiveMarket, isMarketActive } from './market-policy';
import { getSpendableCash } from './payroll-policy';
import { getTransferPaymentSummary } from './transfer-payments';
import { usesSquadRefresh } from './squad-refresh';
import { nbaMakesRoom } from './nba-free-agency';

export interface ContractBuyoutQuote {
  playerId: string;
  clubId: string;
  startsSeason: number;
  endsSeason: number;
  amount: number;
  releasedContractIds: string[];
  contractCountBefore: number;
  negotiationCountBefore: number;
  seasonWageFreed: number;
  rosterSizeAfter: number;
  remainingBudgetAfter: number;
  canBuyout: boolean;
  reason: string | null;
}

/** The development settlement pays every remaining guaranteed future salary in full. */
export function quoteContractBuyout(state: SeasonState, playerId: string, clubId = state.managedClubId): ContractBuyoutQuote {
  const startsSeason = state.seasonNumber + 1;
  const own = contractForSeason(state.employment, playerId, startsSeason);
  const lastPossibleSeason = Math.max(startsSeason, ...state.employment.contracts.filter(contract => contract.playerId === playerId && contract.clubId === clubId).map(contract => contract.endsSeason));
  const released = new Set<string>();
  let amount = 0, endsSeason = startsSeason;
  for (let year = startsSeason; year <= lastPossibleSeason; year += 1) {
    for (const contract of effectiveContractsForSeason(state.employment, year)) if (contract.playerId === playerId && contract.clubId === clubId) {
      released.add(contract.id);
      amount += contract.seasonWage;
      endsSeason = year;
    }
  }
  const releasedContractIds = state.employment.contracts.filter(contract => released.has(contract.id)).map(contract => contract.id);
  const contractCountBefore = state.employment.contracts.length, negotiationCountBefore = state.negotiations.records.length;
  const record: EmploymentBuyout = {
    id: `employment-buyout-${(state.employment.buyouts ?? []).length + 1}`, playerId, clubId,
    seasonNumber: state.seasonNumber, completedOn: state.date, startsSeason, amount,
    releasedContractIds, contractCountBefore, negotiationCountBefore,
  };
  const after = { ...state, employment: { ...state.employment, buyouts: [...(state.employment.buyouts ?? []), record] } };
  const rosterSizeAfter = getClubContractSummary(after, clubId, startsSeason).rosterSize;
  const cash = getSpendableCash(state, clubId), window = getMarketWindow(state);
  let reason: string | null = null;
  if (!state.employment.enabledSince || !state.finance.enabledSince || !state.payroll.enabledSince) reason = 'Enable player contracts, finances and payroll before buying out a contract.';
  else if (!getCareerPlayers(state).some(player => player.id === playerId) || !state.clubs.some(club => club.id === clubId)) reason = 'Choose a player and a club in this league.';
  else if (!isMarketActive(state) || !isCompetitiveMarket(state) || !window || startsSeason > 7974) reason = 'Contract buyouts are available during the competitive offseason.';
  else if (state.date >= window.closesOn) reason = 'The recruitment period has closed.';
  else if (!own || own.clubId !== clubId || !releasedContractIds.length || amount <= 0) reason = 'Choose one of your players under contract for next season.';
  else if (getLiveMarketOffers(state).some(offer => offer.playerId === playerId)) reason = 'Resolve or withdraw all open offers for this player before buying out the contract.';
  else if (getFinanceBalance(state.finance, clubId).unpaid > 0) reason = 'Settle unpaid club costs before buying out a contract.';
  else if (getTransferPaymentSummary(state, clubId).overdue > 0) reason = 'Settle overdue transfer payments before buying out a contract.';
  else if (cash < amount) reason = 'The buyout exceeds your Spending left after protecting salaries and transfer commitments.';
  else if (rosterSizeAfter < minRosterSize(state, clubId) && addMarketDays(state.date, 1) > window.closesOn) reason = 'Keep a reply day available to sign a replacement before recruitment closes.';
  // Format 102 (`squad-refresh.ts`; format 103 for NBA clubs, `nba-free-agency.ts`): a later season already above its wages budget (contracts agreed with extra wage room,
  // which reaches only next season) refuses only a buyout that leaves it further above, not one that brings it down.
  const tolerance = (year: number) => { if (!usesSquadRefresh(state) && !nbaMakesRoom(state, clubId)) return 0; const before = getClubContractSummary(state, clubId, year); return Math.max(0, before.seasonWages + before.reservedWages + before.minimumReserve - before.budget); };
  if (reason === null) for (let year = startsSeason; year <= endsSeason; year += 1) {
    const summary = getClubContractSummary(after, clubId, year);
    if (summary.seasonWages + summary.reservedWages + summary.minimumReserve > summary.budget + tolerance(year)) {
      reason = `The buyout would leave too little wages budget to complete a ${minRosterText(state, clubId)}-player squad in season ${year}.`;
      break;
    }
  }
  return {
    playerId, clubId, startsSeason, endsSeason, amount, releasedContractIds, contractCountBefore, negotiationCountBefore,
    seasonWageFreed: own?.clubId === clubId ? own.seasonWage : 0, rosterSizeAfter,
    remainingBudgetAfter: Math.max(0, cash - amount), canBuyout: reason === null, reason,
  };
}

/** Internal market command; release metadata and compensation are one immutable commit. */
export function commitContractBuyout(state: SeasonState, playerId: string, clubId = state.managedClubId): SeasonState {
  const quote = quoteContractBuyout(state, playerId, clubId);
  if (!quote.canBuyout) throw new Error(quote.reason!);
  const buyout: EmploymentBuyout = {
    id: `employment-buyout-${(state.employment.buyouts ?? []).length + 1}`, playerId, clubId,
    seasonNumber: state.seasonNumber, completedOn: state.date, startsSeason: quote.startsSeason,
    amount: quote.amount, releasedContractIds: [...quote.releasedContractIds],
    contractCountBefore: quote.contractCountBefore, negotiationCountBefore: quote.negotiationCountBefore,
  };
  return recordContractBuyout({ ...state, employment: { ...state.employment, buyouts: [...(state.employment.buyouts ?? []), buyout] } }, buyout);
}
