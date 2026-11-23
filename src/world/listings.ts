import type { PlayerListing } from '../domain/recruitment';
import type { SeasonState } from '../domain/season';
import { contractAskingWage, offeredContractRole } from './contract-roles';
import { requiredNegotiationWage } from './negotiations-policy';
import { contractForRound, contractForSeason, effectiveContractsForRound } from './employment-policy';
import { isRecovering } from './health';
import { getInSeasonOffers } from './recruitment-policy';
import { loanReason, quoteInSeasonTransferOffer, requiredInSeasonTransferFee } from './midseason-transfer-policy';
import { submitInSeasonTransferOffer } from './recruitment';
import { maxTransferFee, MIN_TRANSFER_FEE, requiredTransferFee, TRANSFER_FEE_STEP } from './transfers-policy';
import { seasonRounds } from './career-world';
import { dateForRound } from './season';
import { leavingClubIds } from './background';
import { automaticWageCheck } from './automatic-wages';

/**
 * Format 78 (`recruitment-2`, owner feedback 22 November 2026): the transfer and loan list. Computer clubs bid for
 * listed players more often and now and then for others; each bid waits for the manager in the Inbox until the next
 * matchday. Calm volume: at most one new bid a week and a few a season. Chances use a seeded hash, never match randomness.
 */
export const LISTING_RULES = Object.freeze({
  /** The chance of a bid in a week when at least one player is listed. */
  listedWeeklyChance: 0.45,
  /** The chance of a bid for an unlisted player in a week. */
  unlistedWeeklyChance: 0.06,
  maxBidsPerSeason: 6,
  /** Share of the asking price a listed player's bid offers. */
  listedFeeShare: [0.8, 1] as const,
  /** Share of the suggested price an unsolicited bid offers. */
  unlistedFeeShare: [1.1, 1.4] as const,
  /** A loan fee: this share of the suggested price. */
  loanFeeShare: 0.1,
  /** Clubs ignore an asking price above this multiple of the suggested price. */
  maxAskingMultiple: 2,
  /** Buyers considered for one bid. */
  buyersConsidered: 16,
});

export function usesPlayerListings(state: Pick<SeasonState, 'recruitment'>): boolean { return state.recruitment?.model === 'recruitment-2'; }

/** The suggested asking price: the fee the player's remaining contract is worth (the same rule clubs ask other clubs). */
export function suggestedAskingFee(state: SeasonState, playerId: string): number {
  return state.status === 'complete' ? requiredTransferFee(state, playerId) : requiredInSeasonTransferFee(state, playerId);
}

const roundFee = (state: SeasonState, amount: number) => Math.min(maxTransferFee(state), Math.max(MIN_TRANSFER_FEE, Math.round(amount / TRANSFER_FEE_STEP) * TRANSFER_FEE_STEP));

/** The club's listings that still count: the player is registered there now (or for next season in the offseason). */
export function getClubListings(state: SeasonState, clubId = state.managedClubId): PlayerListing[] {
  if (!usesPlayerListings(state)) return [];
  return (state.recruitment.listings ?? []).filter(listing => listing.clubId === clubId && (listing.transfer || listing.loan) && (state.status === 'complete' ? contractForSeason(state.employment, listing.playerId, state.seasonNumber + 1) : contractForRound(state.employment, listing.playerId, state.seasonNumber, state.round))?.clubId === clubId);
}

export function getPlayerListing(state: SeasonState, playerId: string, clubId = state.managedClubId): PlayerListing | null {
  return getClubListings(state, clubId).find(listing => listing.playerId === playerId) ?? null;
}

export function playerListingReason(state: SeasonState, playerId: string, clubId = state.managedClubId): string | null {
  if (!usesPlayerListings(state)) return 'Transfer and loan lists are part of new careers.';
  const contract = state.status === 'complete' ? contractForSeason(state.employment, playerId, state.seasonNumber + 1) : contractForRound(state.employment, playerId, state.seasonNumber, state.round);
  if (contract?.clubId !== clubId) return 'Only players under contract with your club can be listed.';
  return null;
}

/** Put a player on (or take him off) the transfer list and the loan list. A manager's choice; it changes no agreement. */
export function setPlayerListing(state: SeasonState, playerId: string, choice: { transfer: boolean; loan: boolean; askingFee?: number }, clubId = state.managedClubId): SeasonState {
  const reason = playerListingReason(state, playerId, clubId);
  if (reason) throw new Error(reason);
  if (typeof choice.transfer !== 'boolean' || typeof choice.loan !== 'boolean') throw new Error('Choose the transfer list, the loan list or neither.');
  const askingFee = choice.askingFee ?? getPlayerListing(state, playerId, clubId)?.askingFee ?? suggestedAskingFee(state, playerId);
  if (!Number.isSafeInteger(askingFee) || askingFee < MIN_TRANSFER_FEE || askingFee > maxTransferFee(state) || askingFee % TRANSFER_FEE_STEP !== 0) throw new Error('Choose an asking price in whole thousand-euro steps.');
  // Listings of players who left the club are dropped on every change.
  const kept = getClubListings(state, clubId).filter(listing => listing.playerId !== playerId);
  const others = (state.recruitment.listings ?? []).filter(listing => listing.clubId !== clubId);
  const listings = [...others, ...kept, ...(choice.transfer || choice.loan ? [{ clubId, playerId, transfer: choice.transfer, loan: choice.loan, askingFee, listedOn: state.date }] : [])];
  return { ...state, recruitment: { ...state.recruitment, listings } };
}

function unit(seed: number, ...parts: (string | number)[]): number {
  let hash = (2166136261 ^ seed) >>> 0;
  for (const character of `listing:${parts.join(':')}`) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  hash ^= hash >>> 15; hash = Math.imul(hash, 2246822507) >>> 0; hash ^= hash >>> 13;
  return (hash >>> 0) / 4294967296;
}

interface BidTarget { playerId: string; kind: 'transfer' | 'loan'; listed: boolean; fee: number }

/** At most one bid a week for the manager's players from computer clubs, more likely for listed players. */
export function scheduleListingBids(state: SeasonState): SeasonState {
  const clubId = state.managedClubId;
  if (!usesPlayerListings(state) || !clubId || !state.recruitment.transfersEnabledSince || state.status !== 'active' || state.round >= seasonRounds(state) || state.employment.delegated) return state;
  const seasonOffers = state.recruitment.offers.filter(offer => offer.seasonNumber === state.seasonNumber && offer.transfer?.sellerClubId === clubId);
  if (seasonOffers.some(offer => offer.offeredRound === state.round)) return state;
  // A buyer whose bid the manager countered last week comes back once at the asking fee when it can.
  for (const offer of seasonOffers.filter(item => item.status === 'countered' && item.offeredRound === state.round - 1 && item.transfer?.counterFee)) {
    const fee = offer.transfer!.counterFee!;
    if (quoteInSeasonTransferOffer(state, offer.playerId, offer.seasonWage, offer.seasons, fee, offer.clubId).canOffer) return submitInSeasonTransferOffer(state, offer.playerId, offer.seasonWage, offer.seasons, fee, offer.clubId);
  }
  if (seasonOffers.length >= LISTING_RULES.maxBidsPerSeason) return state;
  const responseOn = dateForRound(state.round + 1, state.seasonNumber);
  const live = new Set(getInSeasonOffers(state, undefined, true).filter(offer => offer.transfer?.sellerClubId === clubId).map(offer => offer.playerId));
  const fit = (playerId: string) => !live.has(playerId) && !state.injuries.some(injury => injury.playerId === playerId && isRecovering(injury, responseOn));
  const registered = effectiveContractsForRound(state.employment, state.seasonNumber, state.round).filter(contract => contract.clubId === clubId).map(contract => contract.playerId).filter(fit);
  const listings = getClubListings(state, clubId).filter(listing => fit(listing.playerId) && (listing.loan || listing.askingFee <= suggestedAskingFee(state, listing.playerId) * LISTING_RULES.maxAskingMultiple));
  const roll = unit(state.seed, 'week', state.seasonNumber, state.round);
  let target: BidTarget | null = null;
  if (listings.length && roll < LISTING_RULES.listedWeeklyChance) {
    const listing = listings[Math.floor(unit(state.seed, 'pick', state.seasonNumber, state.round) * listings.length)]!;
    const loanOnly = listing.loan && (!listing.transfer || unit(state.seed, 'kind', state.seasonNumber, state.round) < 0.5);
    const suggested = suggestedAskingFee(state, listing.playerId);
    const [low, high] = LISTING_RULES.listedFeeShare;
    target = loanOnly
      ? { playerId: listing.playerId, kind: 'loan', listed: true, fee: roundFee(state, suggested * LISTING_RULES.loanFeeShare) }
      : { playerId: listing.playerId, kind: 'transfer', listed: true, fee: roundFee(state, listing.askingFee * (low + (high - low) * unit(state.seed, 'fee', state.seasonNumber, state.round))) };
  } else if (roll >= 1 - LISTING_RULES.unlistedWeeklyChance) {
    const listed = new Set(getClubListings(state, clubId).map(listing => listing.playerId));
    const others = registered.filter(playerId => !listed.has(playerId));
    if (others.length) {
      const playerId = others[Math.floor(unit(state.seed, 'pick', state.seasonNumber, state.round) * others.length)]!;
      const [low, high] = LISTING_RULES.unlistedFeeShare;
      target = { playerId, kind: 'transfer', listed: false, fee: roundFee(state, suggestedAskingFee(state, playerId) * (low + (high - low) * unit(state.seed, 'fee', state.seasonNumber, state.round))) };
    }
  }
  if (!target) return state;
  if (target.kind === 'loan' && loanReason(state, target.playerId, 1, 'upfront', clubId)) return state;
  const leaving = leavingClubIds(state);
  const buyers = state.clubs.filter(club => club.id !== clubId && !leaving.has(club.id))
    .sort((left, right) => unit(state.seed, 'buyer', state.seasonNumber, state.round, target!.playerId, left.id) - unit(state.seed, 'buyer', state.seasonNumber, state.round, target!.playerId, right.id) || left.id.localeCompare(right.id, 'en'))
    .slice(0, LISTING_RULES.buyersConsidered);
  const options = target.kind === 'loan' ? { transferMode: 'loan' as const } : {};
  for (const buyer of buyers) {
    for (const seasons of target.kind === 'loan' ? [1] : [2, 1]) {
      // The wage the player asks for this term and his natural role at the buyer, so he would sign.
      const wage = Math.max(contractAskingWage(state, buyer.id, target.playerId), requiredNegotiationWage(target.playerId, seasons, undefined, state, offeredContractRole(state, buyer.id, target.playerId), buyer.id));
      // Format 87: a buyer whose cash is low keeps its wages within what its money funds.
      if (quoteInSeasonTransferOffer(state, target.playerId, wage, seasons, target.fee, buyer.id, 'upfront', undefined, options).canOffer && automaticWageCheck(state, buyer.id)(wage, seasons, state.seasonNumber)) return submitInSeasonTransferOffer(state, target.playerId, wage, seasons, target.fee, buyer.id, 'upfront', options);
    }
  }
  return state;
}
