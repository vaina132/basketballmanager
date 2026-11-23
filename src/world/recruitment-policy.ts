import { staffRoomForWages } from './wage-pool';
import { clubRosterLimitText, clubRosterLimit } from './club-roster-policy';
import { seasonSalaryBudget } from './board-consequences';
import { surplusWageRoom } from './surplus-spending';
import type { InSeasonBudget, InSeasonOffer, InSeasonOfferQuote } from '../domain/recruitment';
import type { ContractOfferOptions } from '../domain/employment';
import type { SeasonState } from '../domain/season';
import type { Player } from '../domain/types';
import { getCareerPlayers, getActiveCareerPlayers, getCareerWage } from './player-catalog';
import { retirementContractReason } from './lifecycle-policy';
import { getAcademyProspect } from './academy-policy';
import { getYouthPlayerStatus } from './youth-competition';
import { contractForSeason, effectiveContractsForRound, maxContractWage, MIN_CONTRACT_WAGE, refusedContractText, WAGE_STEP } from './employment-policy';
import { refusedContractMinimum, refusedContractPremium } from './contract-requests-policy';
import { getFinanceBalance } from './finance';
import { getSpendableCash, payrollInstallment } from './payroll-policy';
import { dateForRound } from './season';
import { getTransferPaymentSummary } from './transfer-payments';
import { offerOptionsReason } from './release-clauses';
import { playerInList, seasonRounds } from './career-world';
import { contractRoleReason, offeredContractRole, roleWage } from './contract-roles';

export const IN_SEASON_EVENT_LIMIT = 20_000;

export function isLiveInSeasonOffer(offer: InSeasonOffer): boolean { return offer.status === 'pending' || offer.status === 'club-review'; }

export function getInSeasonOffers(state: Partial<Pick<SeasonState, 'recruitment'>> & Pick<SeasonState, 'seasonNumber'>, clubId?: string, liveOnly = false): InSeasonOffer[] {
  return (state.recruitment?.offers ?? []).filter(offer => offer.seasonNumber === state.seasonNumber && (clubId === undefined || offer.clubId === clubId) && (!liveOnly || isLiveInSeasonOffer(offer)));
}

export function getReservedInSeasonWages(state: Partial<Pick<SeasonState, 'recruitment'>> & Pick<SeasonState, 'seasonNumber'>, clubId: string, excludeOfferId?: string): number {
  return getInSeasonOffers(state, clubId, true).filter(offer => offer.id !== excludeOfferId).reduce((sum, offer) => sum + offer.remainingWages, 0);
}

export function getReservedInSeasonFees(state: Partial<Pick<SeasonState, 'recruitment'>> & Pick<SeasonState, 'seasonNumber'>, clubId: string, excludeOfferId?: string): number {
  return getInSeasonOffers(state, clubId, true).filter(offer => offer.id !== excludeOfferId).reduce((sum, offer) => sum + (offer.transfer?.fee ?? 0), 0);
}

export function remainingSeasonWages(seasonWage: number, startsRound: number, rounds: number): number {
  return Array.from({ length: rounds - startsRound + 1 }, (_, index) => payrollInstallment(seasonWage, startsRound + index, rounds)).reduce((sum, amount) => sum + amount, 0);
}

export function getInSeasonBudget(state: SeasonState, clubId = state.managedClubId, excludeOfferId?: string): InSeasonBudget {
  const contracts = effectiveContractsForRound(state.employment, state.seasonNumber, state.round).filter(contract => contract.clubId === clubId);
  const offers = getInSeasonOffers(state, clubId, true).filter(offer => offer.id !== excludeOfferId);
  const seasonWages = contracts.reduce((sum, contract) => sum + contract.seasonWage, 0);
  const reservedWages = offers.reduce((sum, offer) => sum + offer.seasonWage, 0);
  // Format 75 (`coaching-3`): the wage pool adds the staff budget the employed staff leave unused.
  // Format 88: a club run automatically may also use extra wage room from its cash above a healthy reserve.
  const allocation = seasonSalaryBudget(state, clubId, state.seasonNumber) + staffRoomForWages(state, clubId) + surplusWageRoom(state, clubId, state.seasonNumber);
  return { budget: allocation, seasonWages, reservedWages, remainingBudget: Math.max(0, allocation - seasonWages - reservedWages), rosterSize: contracts.length, reservedRosterSize: offers.length, remainingWagesReserved: offers.reduce((sum, offer) => sum + offer.remainingWages, 0), spendableCash: getSpendableCash(state, clubId, undefined, undefined, excludeOfferId) };
}

/** One rest-of-season proposal; the current prepared match remains unchanged. */
export function quoteInSeasonOffer(state: SeasonState, playerId: string, seasonWage: number, clubId = state.managedClubId, resolvingOfferId?: string, options: ContractOfferOptions = {}, academyProspectId?: string): InSeasonOfferQuote {
  const prospect = academyProspectId ? getAcademyProspect(state, academyProspectId) : null;
  const player = academyProspectId ? prospect?.player : playerInList(getCareerPlayers(state), playerId);
  const own = getInSeasonOffers(state, clubId, true).find(offer => offer.playerId === playerId);
  const resolving = !!resolvingOfferId && own?.id === resolvingOfferId && own.responseRound === state.round && own.responseOn === state.date;
  const rounds = seasonRounds(state), responseRound = resolving ? state.round : Math.min(rounds, state.round + 1);
  const responseOn = dateForRound(responseRound, state.seasonNumber);
  const validWage = Number.isSafeInteger(seasonWage) && seasonWage >= MIN_CONTRACT_WAGE && seasonWage <= maxContractWage(state) && seasonWage % WAGE_STEP === 0;
  const remainingWages = validWage ? remainingSeasonWages(seasonWage, responseRound, rounds) : 0;
  const budget = getInSeasonBudget(state, clubId, own?.id);
  let reason: string | null = null;
  if (!state.recruitment?.enabledSince) reason = 'Enable in-season recruitment before approaching free agents.';
  else if (!state.employment.enabledSince || !state.finance.enabledSince || !state.payroll.enabledSince || !state.negotiations.enabledSince) reason = 'Enable player contracts, finances, payroll and negotiations before approaching free agents.';
  else if (!player || !state.clubs.some(club => club.id === clubId)) reason = 'Choose a player and a club in this league.';
  else if (academyProspectId !== undefined && (academyProspectId !== playerId || !prospect || prospect.clubId !== clubId || options.releaseFee !== undefined || options.transferMode !== undefined)) reason = 'Promote only a current prospect from your own academy with a standard rest-of-season contract.';
  else if (prospect && getYouthPlayerStatus(state, playerId).injury) reason = `This prospect is recovering until ${getYouthPlayerStatus(state, playerId).returnOn}; review promotion after recovery.`;
  else if (offerOptionsReason(state, options, false)) reason = offerOptionsReason(state, options, false);
  else if (state.status !== 'active') reason = 'Use the offseason market after the final matchday.';
  else if (state.round >= rounds && !resolving) reason = 'There is no later matchday available to register a new player this season.';
  else if (!validWage) reason = 'Choose an annual salary from EUR 5,000 to EUR 50,000 in EUR 500 steps.';
  else if (retirementContractReason(state, playerId, state.seasonNumber)) reason = retirementContractReason(state, playerId, state.seasonNumber);
  else if (contractForSeason(state.employment, playerId, state.seasonNumber)) reason = 'Choose a free agent without an employer for this season.';
  // Format 66: a player who remembers this club refusing his contract request asks more (relationships-2).
  else if (!prospect && refusedContractPremium(state, clubId, playerId) && seasonWage < refusedContractMinimum(state, clubId, playerId, roleWage(getCareerWage(state, playerId), offeredContractRole(state, clubId, playerId, options), state), WAGE_STEP)) reason = refusedContractText(refusedContractMinimum(state, clubId, playerId, roleWage(getCareerWage(state, playerId), offeredContractRole(state, clubId, playerId, options), state), WAGE_STEP));
  // relationships-3: a player refuses a role below his standing at this club.
  else if (contractRoleReason(state, clubId, playerId, options.role)) reason = contractRoleReason(state, clubId, playerId, options.role);
  else if (getFinanceBalance(state.finance, clubId).unpaid > 0) reason = 'Settle unpaid club costs before offering another salary.';
  else if (getTransferPaymentSummary(state, clubId).overdue > 0) reason = 'Settle overdue transfer payments before offering another salary.';
  else if (budget.rosterSize + budget.reservedRosterSize + 1 > clubRosterLimit(state)) reason = `The squad already has ${clubRosterLimitText(state)} registered players or reserved places.`;
  else if (budget.seasonWages + budget.reservedWages + seasonWage > budget.budget) reason = 'This offer exceeds the current season player wages budget.';
  else if (budget.spendableCash < remainingWages) reason = 'The remaining salary exceeds the available budget after existing commitments.';
  return { playerId, clubId, seasonWage, remainingWages, responseRound, responseOn, remainingBudgetAfter: Math.max(0, budget.spendableCash - remainingWages), annualBudgetRemaining: Math.max(0, budget.budget - budget.seasonWages - budget.reservedWages - (validWage ? seasonWage : 0)), rosterSize: budget.rosterSize + budget.reservedRosterSize + 1, canOffer: reason === null, reason, ...(options.releaseFee === undefined ? {} : { releaseFee: options.releaseFee }) };
}

export function getInSeasonCandidates(state: SeasonState): readonly Player[] {
  if (!state.employment.enabledSince || state.status !== 'active') return [];
  return getActiveCareerPlayers(state).filter(player => !contractForSeason(state.employment, player.id, state.seasonNumber));
}

export { getInSeasonTransferCandidates, requiredInSeasonTransferFee, quoteInSeasonTransferOffer, quoteInSeasonSale } from './midseason-transfer-policy';
