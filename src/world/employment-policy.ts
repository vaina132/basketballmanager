import { leavingClubIds } from './background';
import type { ClubContractSummary, ContractOfferOptions, EmploymentContract, PlayerContractQuote, SeasonEmployment } from '../domain/employment';
import type { SeasonState } from '../domain/season';
import type { Player, Team } from '../domain/types';
import type { TransferPaymentPlan } from '../domain/transfer-payments';
import { fullWorldClubsIn, MAX_SEASON_ROUNDS, seasonRounds, worldOf } from './career-world';
import { getCareerPlayers, getActiveCareerPlayers, getCareerWage, type CareerPlayerContext } from './player-catalog';
import { getLiveMarketOffers, getMarketWindow, isCompetitiveMarket, isMarketActive } from './market-policy';
import { transferOfferReason } from './transfers-policy';
import { getInSeasonOffers } from './recruitment-policy';
import { offerOptionsReason } from './release-clauses';
import { retirementContractReason } from './lifecycle-policy';
import type { WorldContext } from '../domain/world';
import { clubRosterLimitText, clubRosterLimit } from './club-roster-policy';
import { seasonSalaryBudget } from './board-consequences';
import { REAL_ECONOMY_RULES, worldEconomy } from './economy';
import { refusedContractMinimum, refusedContractPremium } from './contract-requests-policy';

export const EMPLOYMENT_BUDGET = 24_000_000;
export const MIN_ROSTER_SIZE = 8;
/** Historical career limit. New rules must ask clubRosterLimit(context). */
export const MAX_ROSTER_SIZE = 12;
export const MIN_CONTRACT_WAGE = 500_000;
export const MAX_CONTRACT_WAGE = 5_000_000;
export const WAGE_STEP = 50_000;
export const MAX_CONTRACT_SEASONS = 3;
/** Retain room for eight players even if every remaining signing asks the catalog maximum. */
export const MIN_ROSTER_WAGE_RESERVE = 1_800_000;
/**
 * The largest annual wage a contract may carry: EUR 50,000 in the development economy; with a researched economy
 * (format 62) EUR 15 million, above any real salary. Wages are the club's gross cost.
 */
export const maxContractWage = (context?: WorldContext): number => worldEconomy(context) ? REAL_ECONOMY_RULES.limits.maxContractWage * 100 : MAX_CONTRACT_WAGE;
/** The wage rule's wording for a context (the development text is kept for historical replies). */
export const contractWageRuleText = (context?: WorldContext): string => worldEconomy(context) ? `Choose an annual wage from €5,000 to €${(maxContractWage(context) / 100).toLocaleString('en-GB')} in €500 steps.` : 'Choose an annual wage from €5,000 to €50,000 in €500 steps.';

export function contractForSeason(employment: SeasonEmployment, playerId: string, seasonNumber: number): EmploymentContract | null {
  return effectiveContractsForSeason(employment, seasonNumber).find(contract => contract.playerId === playerId) ?? null;
}

/** Contracts in force at the end of a season, whatever its length (no season has more than MAX_SEASON_ROUNDS matchdays). */
export function effectiveContractsForSeason(employment: SeasonEmployment, seasonNumber: number): EmploymentContract[] {
  return effectiveContractsForRound(employment, seasonNumber, MAX_SEASON_ROUNDS);
}

/** Registration at one matchday, without applying a later arrival to earlier fixtures. */
export function effectiveContractsForRound(employment: SeasonEmployment, seasonNumber: number, round: number): EmploymentContract[] {
  const released = new Set([...(employment.transfers ?? []).filter(release => release.startsSeason < seasonNumber || release.startsSeason === seasonNumber && (release.startsRound ?? 1) <= round), ...(employment.buyouts ?? []).filter(release => release.startsSeason <= seasonNumber), ...(employment.departures ?? []).filter(release => release.startsSeason <= seasonNumber)].flatMap(release => release.releasedContractIds));
  return employment.contracts.filter(contract => contract.startsSeason <= seasonNumber && contract.endsSeason >= seasonNumber && (contract.startsSeason < seasonNumber || (contract.startsRound ?? 1) <= round) && !released.has(contract.id));
}

export function contractForRound(employment: SeasonEmployment, playerId: string, seasonNumber: number, round: number): EmploymentContract | null {
  return effectiveContractsForRound(employment, seasonNumber, round).find(contract => contract.playerId === playerId) ?? null;
}

/** Approved sales cannot spend the cheap departing player's replacement allowance elsewhere. */
export function outgoingReplacementReserve(state: Pick<SeasonState, 'employment' | 'seasonNumber'> & Partial<Pick<SeasonState, 'market' | 'recruitment'>>, clubId: string, year: number): number {
  const outgoing = new Set([...getLiveMarketOffers(state).filter(offer => offer.transfer?.sellerClubId === clubId && offer.transfer.clubStatus === 'accepted' && offer.seasonNumber + 1 <= year), ...getInSeasonOffers(state, undefined, true).filter(offer => offer.transfer?.sellerClubId === clubId && offer.transfer.clubStatus === 'accepted' && offer.seasonNumber <= year)].map(offer => offer.playerId));
  return effectiveContractsForSeason(state.employment, year).filter(contract => contract.clubId === clubId && outgoing.has(contract.playerId)).reduce((total, contract) => total + Math.max(0, MIN_ROSTER_WAGE_RESERVE - contract.seasonWage), 0);
}

export function getClubContractSummary(state: Pick<SeasonState, 'employment' | 'seasonNumber'> & Partial<Pick<SeasonState, 'market' | 'recruitment'>> & WorldContext, clubId: string, seasonNumber = state.seasonNumber + 1, excludeOfferId?: string): ClubContractSummary {
  const contracts = effectiveContractsForSeason(state.employment, seasonNumber).filter(contract => contract.clubId === clubId);
  const rosterSize = contracts.length, seasonWages = contracts.reduce((total, contract) => total + contract.seasonWage, 0);
  const inSeasonReserved = getInSeasonOffers(state, clubId, true).filter(offer => offer.id !== excludeOfferId && offer.seasonNumber <= seasonNumber && offer.seasonNumber + offer.seasons - 1 >= seasonNumber);
  const reserved = [...getLiveMarketOffers(state).filter(offer => offer.clubId === clubId && offer.id !== excludeOfferId && offer.seasonNumber + 1 <= seasonNumber && offer.seasonNumber + offer.seasons >= seasonNumber), ...inSeasonReserved];
  const reservedWages = reserved.reduce((total, offer) => total + offer.seasonWage, 0), reservedRosterSize = reserved.length;
  // Format 70 (board-2): the season verdict changes the player salary budget (`seasonSalaryBudget`); otherwise the standard budget.
  const budget = seasonSalaryBudget(state, clubId, seasonNumber), remainingBudget = budget - seasonWages - reservedWages;
  // A rival can win any pending player. Keep enough to replace a cheap held slot
  // until that player actually signs, so losing a bid cannot strand the club.
  const pendingShortfalls = (isCompetitiveMarket(state) ? reserved : inSeasonReserved).reduce((total, offer) => total + Math.max(0, MIN_ROSTER_WAGE_RESERVE - offer.seasonWage), 0);
  const minimumReserve = Math.max(0, MIN_ROSTER_SIZE - rosterSize - reservedRosterSize) * MIN_ROSTER_WAGE_RESERVE + pendingShortfalls + outgoingReplacementReserve(state, clubId, seasonNumber);
  return { clubId, seasonNumber, rosterSize, seasonWages, reservedWages, reservedRosterSize, budget, remainingBudget, minimumReserve, spendableBudget: Math.max(0, remainingBudget - minimumReserve), contracts };
}

/** Public offers and automation share ownership, term, roster and annual-budget guards. */
export function quotePlayerContract(state: SeasonState, playerId: string, seasonWage: number, seasons: number, clubId = state.managedClubId, resolvingOfferId?: string, transferFee?: number, transferPaymentPlan: TransferPaymentPlan = 'upfront', options: ContractOfferOptions = {}): PlayerContractQuote {
  const player = getCareerPlayers(state).find(candidate => candidate.id === playerId);
  const startsSeason = state.seasonNumber + 1, endsSeason = startsSeason + seasons - 1;
  const askingWage = player ? getCareerWage(state, playerId) : 0;
  const current = contractForSeason(state.employment, playerId, state.seasonNumber);
  const liveOffers = getLiveMarketOffers(state);
  const openOffer = liveOffers.find(offer => offer.playerId === playerId && offer.clubId === clubId);
  const rivalOffer = liveOffers.find(offer => offer.playerId === playerId && offer.clubId !== clubId);
  const window = getMarketWindow(state);
  const resolving = !!resolvingOfferId && openOffer?.id === resolvingOfferId && openOffer.clubId === clubId && openOffer.status === 'pending' && openOffer.seasonWage === seasonWage && openOffer.seasons === seasons && openOffer.responseOn === state.date && !!window && state.date <= window.closesOn;
  const paidTransfer = transferFee !== undefined;
  const overlaps = Number.isInteger(seasons) && seasons >= 1 && seasons <= MAX_CONTRACT_SEASONS && Array.from({ length: seasons }, (_, index) => contractForSeason(state.employment, playerId, startsSeason + index)).some(Boolean);
  let reason: string | null = null;
  if (!state.employment.enabledSince) reason = 'Enable player contracts before negotiating.';
  else if (!state.finance.enabledSince || !state.payroll.enabledSince) reason = 'Enable finances and player payroll before negotiating contracts.';
  else if (!player || !state.clubs.some(club => club.id === clubId)) reason = 'Choose a development player and a club in this league.';
  else if (leavingClubIds(state).has(clubId)) reason = 'This club is leaving the game\'s leagues and signs no one for next season.';
  else if (offerOptionsReason(state, options, paidTransfer)) reason = offerOptionsReason(state, options, paidTransfer);
  else if (!Number.isInteger(seasons) || seasons < 1 || seasons > MAX_CONTRACT_SEASONS || endsSeason > 7974) reason = 'Choose a contract lasting one to three supported seasons.';
  else if (retirementContractReason(state, playerId, endsSeason)) reason = retirementContractReason(state, playerId, endsSeason);
  else if (!Number.isInteger(seasonWage) || seasonWage < MIN_CONTRACT_WAGE || seasonWage > maxContractWage(state) || seasonWage % WAGE_STEP !== 0) reason = contractWageRuleText(state);
  else if (seasonWage < askingWage && !state.negotiations.enabledSince) reason = 'The player will not accept less than his asking wage.';
  // Format 66: a player whose contract request this club refused asks more to sign with it (relationships-2).
  else if (refusedContractPremium(state, clubId, playerId) && seasonWage < refusedContractMinimum(state, clubId, playerId, askingWage, WAGE_STEP)) reason = refusedContractText(refusedContractMinimum(state, clubId, playerId, askingWage, WAGE_STEP));
  else if ((state.employment.buyouts ?? []).some(buyout => buyout.playerId === playerId && buyout.clubId === clubId && buyout.seasonNumber === state.seasonNumber)) reason = 'A player you buy out cannot rejoin your club during the same offseason.';
  else if (state.status === 'active' && getInSeasonOffers(state, undefined, true).some(offer => offer.playerId === playerId && offer.transfer?.sellerClubId === clubId)) reason = 'Resolve the current transfer proposals before renewing this player.';
  else if (paidTransfer) reason = transferOfferReason(state, playerId, transferFee, clubId, resolvingOfferId, transferPaymentPlan, options);
  else if (overlaps) reason = 'This player already has a contract covering the proposed seasons.';
  else if (state.status === 'active' && (current?.clubId !== clubId || current.endsSeason !== state.seasonNumber)) reason = 'During the season, renew only your own players whose contracts expire this year.';
  else if (state.status === 'complete' && state.employment.market?.seasonNumber !== startsSeason) reason = 'Open the offseason recruitment window before offering contracts.';
  else if (state.status === 'complete' && state.market?.enabledSince && (!isMarketActive(state) || !window)) reason = 'Open the offseason decision calendar before sending offers.';
  else if (state.status === 'complete' && state.market?.enabledSince && window && state.date >= window.closesOn && !resolving) reason = 'The recruitment period has closed.';
  else if (rivalOffer && !isCompetitiveMarket(state)) reason = `This player is considering an offer from ${state.clubs.find(club => club.id === rivalOffer.clubId)?.name ?? 'another club'}.`;
  if (reason === null) for (let year = startsSeason; year <= endsSeason; year += 1) {
    const summary = getClubContractSummary(state, clubId, year, openOffer?.clubId === clubId ? openOffer.id : undefined), size = summary.rosterSize + summary.reservedRosterSize + 1;
    if (size > clubRosterLimit(state)) { reason = `The squad already has ${clubRosterLimitText(state)} contracted players for season ${year}.`; break; }
    const pendingShortfalls = (isCompetitiveMarket(state) ? liveOffers.filter(offer => offer.clubId === clubId && offer.id !== openOffer?.id && offer.seasonNumber + 1 <= year && offer.seasonNumber + offer.seasons >= year) : []).reduce((total, offer) => total + Math.max(0, MIN_ROSTER_WAGE_RESERVE - offer.seasonWage), 0) + getInSeasonOffers(state, clubId, true).filter(offer => offer.seasonNumber <= year && offer.seasonNumber + offer.seasons - 1 >= year).reduce((total, offer) => total + Math.max(0, MIN_ROSTER_WAGE_RESERVE - offer.seasonWage), 0);
    const proposalShortfall = isCompetitiveMarket(state) && !resolving ? Math.max(0, MIN_ROSTER_WAGE_RESERVE - seasonWage) : 0;
    const reserve = Math.max(0, MIN_ROSTER_SIZE - size) * MIN_ROSTER_WAGE_RESERVE + pendingShortfalls + proposalShortfall + outgoingReplacementReserve(state, clubId, year);
    if (summary.seasonWages + summary.reservedWages + seasonWage + reserve > summary.budget) { reason = `This offer exceeds the season ${year} wage budget after protecting space for eight players${summary.reservedWages ? ' and pending offers' : ''}.`; break; }
  }
  return { playerId, clubId, startsSeason, endsSeason, seasons, seasonWage, askingWage, canOffer: reason === null, reason, ...(options.releaseFee === undefined ? {} : { releaseFee: options.releaseFee }) };
}

/** The guard text when a player who remembers a refused contract request asks more of this club. */
export const refusedContractText = (minimum: number): string => `After the club turned down his contract request, he asks at least €${(minimum / 100).toLocaleString('en-GB')} a season to sign.`;

/** Players without an opening-day employer; current-season ownership is preserved. */
export function getAvailablePlayers(state: Pick<SeasonState, 'employment' | 'seasonNumber' | 'status'> & Partial<Pick<SeasonState, 'market' | 'managedClubId'>> & CareerPlayerContext): readonly Player[] {
  if (!state.employment.enabledSince || state.status !== 'complete' || state.employment.market?.seasonNumber !== state.seasonNumber + 1) return [];
  const held = new Set(getLiveMarketOffers(state).filter(offer => !isCompetitiveMarket(state) || offer.clubId === state.managedClubId).map(offer => offer.playerId));
  return getActiveCareerPlayers(state, state.seasonNumber + 1, 1).filter(player => !held.has(player.id) && !contractForSeason(state.employment, player.id, state.seasonNumber + 1));
}

/** Stable catalog order and collision-free jerseys make registrations reproducible on import. */
export function getContractedClubs(state: { employment: SeasonEmployment; clubs: readonly Team[] } & CareerPlayerContext, seasonNumber: number): readonly Team[] {
  const definitions = fullWorldClubsIn(state, seasonNumber);
  if (!state.employment.enabledSince || seasonNumber < state.employment.enabledSince.seasonNumber) return definitions;
  return definitions.map(definition => {
    const club = state.clubs.find(club => club.id === definition.id) ?? definition;
    const numbers = new Set<number>();
    const players = getCareerPlayers(state, seasonNumber, seasonRounds(state)).filter(player => contractForSeason(state.employment, player.id, seasonNumber)?.clubId === club.id).map(player => {
      let number = player.number;
      if (numbers.has(number)) { number = 1; while (numbers.has(number)) number += 1; }
      numbers.add(number);
      return { ...player, number, attributes: { ...player.attributes } };
    });
    return { id: club.id, name: club.name, shortName: club.shortName, color: club.color, players };
  });
}

/** Canonical opening jerseys plus chronological arrivals; incumbents keep their numbers. */
/**
 * Registrations depend only on the employment journal, the academy's graduates and the world, all immutable per
 * career state; save validation asks for the same matchday many times, so results are remembered per those
 * objects (step 2.8d). Remembered results are frozen, so a caller can never change another caller's copy.
 */
const contractedByEmployment = new WeakMap<SeasonEmployment, WeakMap<object, Map<string, readonly Team[]>>>();
const NO_ACADEMY = {};
export function getContractedClubsForRound(state: { employment: SeasonEmployment; clubs: readonly Team[] } & CareerPlayerContext, seasonNumber: number, round: number): readonly Team[] {
  const definitions = fullWorldClubsIn(state, seasonNumber);
  if (!state.employment.enabledSince || seasonNumber < state.employment.enabledSince.seasonNumber) return definitions;
  let byAcademy = contractedByEmployment.get(state.employment);
  if (!byAcademy) { byAcademy = new WeakMap(); contractedByEmployment.set(state.employment, byAcademy); }
  const academyKey = state.academy ?? NO_ACADEMY;
  let byBoundary = byAcademy.get(academyKey);
  if (!byBoundary) { byBoundary = new Map(); byAcademy.set(academyKey, byBoundary); }
  const key = `${worldOf(state).id}|${seasonNumber}|${round}|${state.background?.exchanges?.length ?? 0}`;
  const known = byBoundary.get(key);
  if (known) return known;
  const result = deepFreeze(contractedClubsForRound(state, definitions, seasonNumber, round));
  byBoundary.set(key, result);
  return result;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); }
  return value;
}

/** Possible in-season registration changes. Opening contracts/buyouts are handled by the opening squad.
 * This derives work boundaries, not permission: callers must still validate the journal and compare actual squads.
 */
export function registrationChangeRounds(employment: SeasonEmployment, seasonNumber: number, throughRound: number): number[] {
  return [...new Set([
    ...employment.contracts.filter(contract => contract.startsSeason === seasonNumber).map(contract => contract.startsRound ?? 1),
    ...employment.transfers.filter(transfer => transfer.startsSeason === seasonNumber).map(transfer => transfer.startsRound ?? 1),
  ].filter(at => at > 1 && at <= throughRound))].sort((left, right) => left - right);
}

function contractedClubsForRound(state: { employment: SeasonEmployment; clubs: readonly Team[] } & CareerPlayerContext, definitions: readonly Team[], seasonNumber: number, round: number): readonly Team[] {
  const changeRounds = registrationChangeRounds(state.employment, seasonNumber, round);
  // One catalog and registration grouping per boundary, shared by every club in this reconstruction.
  // Keep catalog order for opening squads and contract order for later arrivals: both decide shirt numbers.
  const termsByClub = (at: number) => {
    const groups = new Map<string, EmploymentContract[]>();
    for (const contract of effectiveContractsForRound(state.employment, seasonNumber, at)) {
      const terms = groups.get(contract.clubId) ?? [];
      terms.push(contract); groups.set(contract.clubId, terms);
    }
    return groups;
  };
  const openingTerms = termsByClub(1), openingPlayers = getCareerPlayers(state, seasonNumber, 1);
  const changes = changeRounds.map(at => ({ terms: termsByClub(at),
    players: new Map(getCareerPlayers(state, seasonNumber, at).map(player => [player.id, player])) }));
  return definitions.map(definition => {
    let numbers = new Set<number>();
    const append = (player: Player): Player => {
      let number = player.number;
      if (numbers.has(number)) { number = 1; while (numbers.has(number)) number += 1; }
      numbers.add(number);
      return { ...player, number, attributes: { ...player.attributes } };
    };
    const opening = new Set((openingTerms.get(definition.id) ?? []).map(contract => contract.playerId));
    let players = openingPlayers.filter(player => opening.has(player.id)).map(append);
    for (const changed of changes) {
      const terms = changed.terms.get(definition.id) ?? [];
      const registered = new Set(terms.map(contract => contract.playerId));
      players = players.filter(player => registered.has(player.id));
      numbers = new Set(players.map(player => player.number));
      const present = new Set(players.map(player => player.id));
      for (const contract of terms) if (!present.has(contract.playerId)) {
        players.push(append(changed.players.get(contract.playerId)!)); present.add(contract.playerId);
      }
    }
    return { ...definition, players };
  });
}
