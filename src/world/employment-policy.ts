import { leavingClubIds } from './background';
import type { ClubContractSummary, ContractOfferOptions, EmploymentContract, PlayerContractQuote, SeasonEmployment } from '../domain/employment';
import type { SeasonState } from '../domain/season';
import type { Player, Team } from '../domain/types';
import type { TransferPaymentPlan } from '../domain/transfer-payments';
import { fullWorldClubsIn, MAX_SEASON_ROUNDS, playerInList, seasonRounds, worldOf } from './career-world';
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
  return contractForRound(employment, playerId, seasonNumber, MAX_SEASON_ROUNDS);
}

/** Contracts in force at the end of a season, whatever its length (no season has more than MAX_SEASON_ROUNDS matchdays). */
export function effectiveContractsForSeason(employment: SeasonEmployment, seasonNumber: number): EmploymentContract[] {
  return effectiveContractsForRound(employment, seasonNumber, MAX_SEASON_ROUNDS);
}

// Step 3.7: the registration in force at a week is worked out once per employment record. Records are replaced, never
// edited (save checks build a new record for each prefix they replay), and every caller gets its own copy of the list.
const contractsAtCache = new WeakMap<SeasonEmployment, Map<string, readonly EmploymentContract[]>>();
const contractByPlayerCache = new WeakMap<readonly EmploymentContract[], Map<string, EmploymentContract>>();
function contractsAt(employment: SeasonEmployment, seasonNumber: number, round: number): readonly EmploymentContract[] {
  let byWeek = contractsAtCache.get(employment);
  if (!byWeek) { byWeek = new Map(); contractsAtCache.set(employment, byWeek); }
  const key = `${seasonNumber}:${round}`, known = byWeek.get(key);
  if (known) return known;
  const released = new Set([...(employment.transfers ?? []).filter(release => release.startsSeason < seasonNumber || release.startsSeason === seasonNumber && (release.startsRound ?? 1) <= round), ...(employment.buyouts ?? []).filter(release => release.startsSeason <= seasonNumber), ...(employment.departures ?? []).filter(release => release.startsSeason <= seasonNumber)].flatMap(release => release.releasedContractIds));
  const contracts = employment.contracts.filter(contract => contract.startsSeason <= seasonNumber && contract.endsSeason >= seasonNumber && (contract.startsSeason < seasonNumber || (contract.startsRound ?? 1) <= round) && !released.has(contract.id));
  byWeek.set(key, contracts);
  return contracts;
}

const contractsByClubCache = new WeakMap<readonly EmploymentContract[], Map<string, readonly EmploymentContract[]>>();
const NO_CONTRACTS: readonly EmploymentContract[] = Object.freeze([]);
/** One club's contracts in force at the end of a season, in journal order (shared: callers must copy before changing). */
function clubContractsForSeason(employment: SeasonEmployment, clubId: string, seasonNumber: number): readonly EmploymentContract[] {
  const contracts = contractsAt(employment, seasonNumber, MAX_SEASON_ROUNDS);
  let byClub = contractsByClubCache.get(contracts);
  if (!byClub) {
    const groups = new Map<string, EmploymentContract[]>();
    for (const contract of contracts) { const list = groups.get(contract.clubId); if (list) list.push(contract); else groups.set(contract.clubId, [contract]); }
    byClub = groups;
    contractsByClubCache.set(contracts, byClub);
  }
  return byClub.get(clubId) ?? NO_CONTRACTS;
}

/** Registration at one matchday, without applying a later arrival to earlier fixtures. */
export function effectiveContractsForRound(employment: SeasonEmployment, seasonNumber: number, round: number): EmploymentContract[] {
  return [...contractsAt(employment, seasonNumber, round)];
}

export function contractForRound(employment: SeasonEmployment, playerId: string, seasonNumber: number, round: number): EmploymentContract | null {
  const contracts = contractsAt(employment, seasonNumber, round);
  let byPlayer = contractByPlayerCache.get(contracts);
  if (!byPlayer) {
    byPlayer = new Map();
    for (const contract of contracts) if (!byPlayer.has(contract.playerId)) byPlayer.set(contract.playerId, contract);
    contractByPlayerCache.set(contracts, byPlayer);
  }
  return byPlayer.get(playerId) ?? null;
}

/** Approved sales cannot spend the cheap departing player's replacement allowance elsewhere. */
export function outgoingReplacementReserve(state: Pick<SeasonState, 'employment' | 'seasonNumber'> & Partial<Pick<SeasonState, 'market' | 'recruitment'>>, clubId: string, year: number): number {
  const outgoing = new Set([...getLiveMarketOffers(state).filter(offer => offer.transfer?.sellerClubId === clubId && offer.transfer.clubStatus === 'accepted' && offer.seasonNumber + 1 <= year), ...getInSeasonOffers(state, undefined, true).filter(offer => offer.transfer?.sellerClubId === clubId && offer.transfer.clubStatus === 'accepted' && offer.seasonNumber <= year)].map(offer => offer.playerId));
  if (!outgoing.size) return 0;
  return clubContractsForSeason(state.employment, clubId, year).filter(contract => outgoing.has(contract.playerId)).reduce((total, contract) => total + Math.max(0, MIN_ROSTER_WAGE_RESERVE - contract.seasonWage), 0);
}

export function getClubContractSummary(state: Pick<SeasonState, 'employment' | 'seasonNumber'> & Partial<Pick<SeasonState, 'market' | 'recruitment'>> & WorldContext, clubId: string, seasonNumber = state.seasonNumber + 1, excludeOfferId?: string): ClubContractSummary {
  const contracts = [...clubContractsForSeason(state.employment, clubId, seasonNumber)];
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
  return playerContractQuoter(state, clubId)(playerId, seasonWage, seasons, resolvingOfferId, transferFee, transferPaymentPlan, options);
}

export type PlayerContractQuoter = (playerId: string, seasonWage: number, seasons: number, resolvingOfferId?: string, transferFee?: number, transferPaymentPlan?: TransferPaymentPlan, options?: ContractOfferOptions) => PlayerContractQuote;

/**
 * The contract guard for many players of one club at one unchanged moment (step 3.7): club figures that do not depend on
 * the player (season summaries, pending reserves, replacement reserves, live and in-season offers) are worked out once,
 * on first use, in the same order of checks as a single quote. Automatic recruitment asks it for every candidate.
 */
export function playerContractQuoter(state: SeasonState, clubId = state.managedClubId): PlayerContractQuoter {
  const liveOffers = getLiveMarketOffers(state);
  const window = getMarketWindow(state);
  const competitive = once(() => isCompetitiveMarket(state));
  const leaving = once(() => leavingClubIds(state).has(clubId));
  const inSeasonOffers = once(() => getInSeasonOffers(state, undefined, true));
  const clubInSeasonOffers = once(() => getInSeasonOffers(state, clubId, true));
  const summaries = new Map<string, ClubContractSummary>(), shortfalls = new Map<string, number>(), outgoing = new Map<number, number>();
  const summaryFor = (year: number, excludeOfferId: string | undefined) => {
    const key = `${year}|${excludeOfferId ?? ''}`;
    let summary = summaries.get(key);
    if (!summary) { summary = getClubContractSummary(state, clubId, year, excludeOfferId); summaries.set(key, summary); }
    return summary;
  };
  const pendingShortfallsFor = (year: number, openOfferId: string | undefined) => {
    const key = `${year}|${openOfferId ?? ''}`;
    let total = shortfalls.get(key);
    if (total === undefined) {
      total = (competitive() ? liveOffers.filter(offer => offer.clubId === clubId && offer.id !== openOfferId && offer.seasonNumber + 1 <= year && offer.seasonNumber + offer.seasons >= year) : []).reduce((sum, offer) => sum + Math.max(0, MIN_ROSTER_WAGE_RESERVE - offer.seasonWage), 0) + clubInSeasonOffers().filter(offer => offer.seasonNumber <= year && offer.seasonNumber + offer.seasons - 1 >= year).reduce((sum, offer) => sum + Math.max(0, MIN_ROSTER_WAGE_RESERVE - offer.seasonWage), 0);
      shortfalls.set(key, total);
    }
    return total;
  };
  const outgoingFor = (year: number) => {
    let reserve = outgoing.get(year);
    if (reserve === undefined) { reserve = outgoingReplacementReserve(state, clubId, year); outgoing.set(year, reserve); }
    return reserve;
  };
  return (playerId, seasonWage, seasons, resolvingOfferId, transferFee, transferPaymentPlan = 'upfront', options = {}) => {
    const player = playerInList(getCareerPlayers(state), playerId);
    const startsSeason = state.seasonNumber + 1, endsSeason = startsSeason + seasons - 1;
    const askingWage = player ? getCareerWage(state, playerId) : 0;
    const current = contractForSeason(state.employment, playerId, state.seasonNumber);
    const openOffer = liveOffers.find(offer => offer.playerId === playerId && offer.clubId === clubId);
    const rivalOffer = liveOffers.find(offer => offer.playerId === playerId && offer.clubId !== clubId);
    const resolving = !!resolvingOfferId && openOffer?.id === resolvingOfferId && openOffer.clubId === clubId && openOffer.status === 'pending' && openOffer.seasonWage === seasonWage && openOffer.seasons === seasons && openOffer.responseOn === state.date && !!window && state.date <= window.closesOn;
    const paidTransfer = transferFee !== undefined;
    const overlaps = Number.isInteger(seasons) && seasons >= 1 && seasons <= MAX_CONTRACT_SEASONS && Array.from({ length: seasons }, (_, index) => contractForSeason(state.employment, playerId, startsSeason + index)).some(Boolean);
    let reason: string | null = null;
    if (!state.employment.enabledSince) reason = 'Enable player contracts before negotiating.';
    else if (!state.finance.enabledSince || !state.payroll.enabledSince) reason = 'Enable finances and player payroll before negotiating contracts.';
    else if (!player || !state.clubs.some(club => club.id === clubId)) reason = 'Choose a development player and a club in this league.';
    else if (leaving()) reason = 'This club is leaving the game\'s leagues and signs no one for next season.';
    else if (offerOptionsReason(state, options, paidTransfer)) reason = offerOptionsReason(state, options, paidTransfer);
    else if (!Number.isInteger(seasons) || seasons < 1 || seasons > MAX_CONTRACT_SEASONS || endsSeason > 7974) reason = 'Choose a contract lasting one to three supported seasons.';
    else if (retirementContractReason(state, playerId, endsSeason)) reason = retirementContractReason(state, playerId, endsSeason);
    else if (!Number.isInteger(seasonWage) || seasonWage < MIN_CONTRACT_WAGE || seasonWage > maxContractWage(state) || seasonWage % WAGE_STEP !== 0) reason = contractWageRuleText(state);
    else if (seasonWage < askingWage && !state.negotiations.enabledSince) reason = 'The player will not accept less than his asking wage.';
    // Format 66: a player whose contract request this club refused asks more to sign with it (relationships-2).
    else if (refusedContractPremium(state, clubId, playerId) && seasonWage < refusedContractMinimum(state, clubId, playerId, askingWage, WAGE_STEP)) reason = refusedContractText(refusedContractMinimum(state, clubId, playerId, askingWage, WAGE_STEP));
    else if ((state.employment.buyouts ?? []).some(buyout => buyout.playerId === playerId && buyout.clubId === clubId && buyout.seasonNumber === state.seasonNumber)) reason = 'A player you buy out cannot rejoin your club during the same offseason.';
    else if (state.status === 'active' && inSeasonOffers().some(offer => offer.playerId === playerId && offer.transfer?.sellerClubId === clubId)) reason = 'Resolve the current transfer proposals before renewing this player.';
    else if (paidTransfer) reason = transferOfferReason(state, playerId, transferFee, clubId, resolvingOfferId, transferPaymentPlan, options);
    else if (overlaps) reason = 'This player already has a contract covering the proposed seasons.';
    else if (state.status === 'active' && (current?.clubId !== clubId || current.endsSeason !== state.seasonNumber)) reason = 'During the season, renew only your own players whose contracts expire this year.';
    else if (state.status === 'complete' && state.employment.market?.seasonNumber !== startsSeason) reason = 'Open the offseason recruitment window before offering contracts.';
    else if (state.status === 'complete' && state.market?.enabledSince && (!isMarketActive(state) || !window)) reason = 'Open the offseason decision calendar before sending offers.';
    else if (state.status === 'complete' && state.market?.enabledSince && window && state.date >= window.closesOn && !resolving) reason = 'The recruitment period has closed.';
    else if (rivalOffer && !competitive()) reason = `This player is considering an offer from ${state.clubs.find(club => club.id === rivalOffer.clubId)?.name ?? 'another club'}.`;
    if (reason === null) for (let year = startsSeason; year <= endsSeason; year += 1) {
      const summary = summaryFor(year, openOffer?.clubId === clubId ? openOffer.id : undefined), size = summary.rosterSize + summary.reservedRosterSize + 1;
      if (size > clubRosterLimit(state)) { reason = `The squad already has ${clubRosterLimitText(state)} contracted players for season ${year}.`; break; }
      const pendingShortfalls = pendingShortfallsFor(year, openOffer?.id);
      const proposalShortfall = competitive() && !resolving ? Math.max(0, MIN_ROSTER_WAGE_RESERVE - seasonWage) : 0;
      const reserve = Math.max(0, MIN_ROSTER_SIZE - size) * MIN_ROSTER_WAGE_RESERVE + pendingShortfalls + proposalShortfall + outgoingFor(year);
      if (summary.seasonWages + summary.reservedWages + seasonWage + reserve > summary.budget) { reason = `This offer exceeds the season ${year} wage budget after protecting space for eight players${summary.reservedWages ? ' and pending offers' : ''}.`; break; }
    }
    return { playerId, clubId, startsSeason, endsSeason, seasons, seasonWage, askingWage, canOffer: reason === null, reason, ...(options.releaseFee === undefined ? {} : { releaseFee: options.releaseFee }) };
  };
}

/** A lazily computed value, worked out at most once. */
function once<T>(compute: () => T): () => T {
  let known = false, value: T | undefined;
  return () => { if (!known) { value = compute(); known = true; } return value as T; };
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
  // Step 3.7: catalog positions looked up once, instead of filtering the whole catalog for every club.
  const catalogIndex = new Map<string, number>();
  openingPlayers.forEach((player, index) => { if (!catalogIndex.has(player.id)) catalogIndex.set(player.id, index); });
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
    // The club's opening players in catalog order, as filtering the catalog by the club's contracts gave.
    const opening = [...new Set((openingTerms.get(definition.id) ?? []).map(contract => contract.playerId))].filter(id => catalogIndex.has(id)).sort((left, right) => catalogIndex.get(left)! - catalogIndex.get(right)!);
    let players = opening.map(id => append(openingPlayers[catalogIndex.get(id)!]!));
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
