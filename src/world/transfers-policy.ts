import type { MarketOffer } from '../domain/market';
import type { PlayerContractQuote } from '../domain/employment';
import type { SeasonState } from '../domain/season';
import type { Player } from '../domain/types';
import type { TransferPaymentPlan } from '../domain/transfer-payments';
import { DEVELOPMENT_PLAYERS } from '../data/development-players';
import { contractForSeason, effectiveContractsForSeason, getClubContractSummary, MIN_ROSTER_SIZE, MIN_ROSTER_WAGE_RESERVE, quotePlayerContract } from './employment-policy';
import { getFinanceBalance } from './finance';
import { addMarketDays, getLiveMarketOffers, getMarketWindow, isCompetitiveMarket, isMarketActive } from './market-policy';
import { getSpendableCash } from './payroll-policy';
import { getTransferPaymentSummary, TRANSFER_PAYMENT_PLANS } from './transfer-payments';

export const MIN_TRANSFER_FEE = 100_000;
export const MAX_TRANSFER_FEE = 50_000_000;
export const TRANSFER_FEE_STEP = 100_000;

/** Fictional asking price based on remaining contracted salary, never hidden ability. */
export function requiredTransferFee(state: Pick<SeasonState, 'employment' | 'seasonNumber'>, playerId: string): number {
  const contract = contractForSeason(state.employment, playerId, state.seasonNumber + 1);
  if (!contract) return 0;
  const remainingSalary = contract.seasonWage * (contract.endsSeason - Math.max(contract.startsSeason, state.seasonNumber + 1) + 1);
  return Math.min(MAX_TRANSFER_FEE, Math.max(MIN_TRANSFER_FEE, Math.ceil(remainingSalary / TRANSFER_FEE_STEP) * TRANSFER_FEE_STEP));
}

export function getTransferCandidates(state: SeasonState, clubId = state.managedClubId): readonly Player[] {
  if (!isMarketActive(state) || !isCompetitiveMarket(state)) return [];
  return DEVELOPMENT_PLAYERS.filter(player => {
    const contract = contractForSeason(state.employment, player.id, state.seasonNumber + 1);
    return contract && contract.clubId !== clubId && !(state.employment.transfers ?? []).some(transfer => transfer.playerId === player.id && transfer.seasonNumber === state.seasonNumber);
  });
}

/** Shared basic paid-offer guard; wage/roster checks remain in quotePlayerContract. */
export function transferOfferReason(state: SeasonState, playerId: string, fee: number, buyerId: string, resolvingOfferId?: string, paymentPlan: TransferPaymentPlan = 'upfront'): string | null {
  const window = getMarketWindow(state), contract = contractForSeason(state.employment, playerId, state.seasonNumber + 1);
  const own = getLiveMarketOffers(state).find(offer => offer.playerId === playerId && offer.clubId === buyerId);
  const resolving = !!resolvingOfferId && own?.id === resolvingOfferId && own.status === 'pending' && own.responseOn === state.date;
  if (!isMarketActive(state) || !isCompetitiveMarket(state) || !window) return 'Club transfers are available during the competitive offseason.';
  if (!contract || contract.clubId === buyerId) return 'Choose a player under contract at another club for next season.';
  if ((state.employment.transfers ?? []).some(transfer => transfer.playerId === playerId && transfer.seasonNumber === state.seasonNumber)) return 'This player has already changed clubs this offseason.';
  if (!TRANSFER_PAYMENT_PLANS.includes(paymentPlan)) return 'Choose a supported transfer payment plan.';
  if (!Number.isSafeInteger(fee) || fee < MIN_TRANSFER_FEE || fee > MAX_TRANSFER_FEE || fee % TRANSFER_FEE_STEP !== 0) return 'Choose a transfer fee from €1,000 to €500,000 in €1,000 steps.';
  if (resolving) {
    if (!own?.transfer || own.transfer.clubStatus !== 'accepted' || own.transfer.contractId !== contract.id || own.transfer.sellerClubId !== contract.clubId || own.transfer.fee !== fee || (own.transfer.paymentPlan ?? 'upfront') !== paymentPlan) return 'The selling club must approve these transfer terms before the player can sign.';
    if (state.date > window.closesOn || state.date > own.expiresOn) return 'The transfer offer has expired.';
  } else if (addMarketDays(state.date, 2) > window.closesOn) return 'Allow a club decision and a player reply before recruitment closes.';
  if (getFinanceBalance(state.finance, buyerId).unpaid > 0) return 'Settle unpaid club costs before offering a transfer fee.';
  if (getTransferPaymentSummary(state, buyerId).overdue > 0) return 'Settle overdue transfer payments before offering another transfer fee.';
  if (getSpendableCash(state, buyerId, own?.id) < fee) return 'The transfer fee exceeds the remaining budget after other commitments.';
  return null;
}

export interface TransferOfferQuote extends PlayerContractQuote {
  sellerClubId: string | null;
  contractId: string | null;
  requiredFee: number;
  fee: number;
  paymentPlan: TransferPaymentPlan;
}

export function quoteTransferOffer(state: SeasonState, playerId: string, seasonWage: number, seasons: number, fee: number, clubId = state.managedClubId, paymentPlan: TransferPaymentPlan = 'upfront'): TransferOfferQuote {
  const contract = contractForSeason(state.employment, playerId, state.seasonNumber + 1);
  return { ...quotePlayerContract(state, playerId, seasonWage, seasons, clubId, undefined, fee, paymentPlan), sellerClubId: contract?.clubId ?? null, contractId: contract?.id ?? null, requiredFee: requiredTransferFee(state, playerId), fee, paymentPlan };
}

/** Protect replacements for every approved outgoing player, including concurrent sales. */
export function sellerReplacementReason(state: SeasonState, offer: MarketOffer): string | null {
  const transfer = offer.transfer, window = getMarketWindow(state);
  if (!transfer || !window || !isMarketActive(state)) return 'Choose an open club transfer.';
  const target = contractForSeason(state.employment, offer.playerId, state.seasonNumber + 1);
  if (!target || target.id !== transfer.contractId || target.clubId !== transfer.sellerClubId) return 'This player is no longer available from the selling club.';
  const approved = getLiveMarketOffers(state).filter(item => item.id !== offer.id && item.transfer?.sellerClubId === transfer.sellerClubId && item.transfer.clubStatus === 'accepted');
  const outgoing = new Set([offer.playerId, ...approved.map(item => item.playerId)]);
  const endsSeason = Math.max(...state.employment.contracts.filter(contract => outgoing.has(contract.playerId) && contract.clubId === transfer.sellerClubId).map(contract => contract.endsSeason));
  for (let year = state.seasonNumber + 1; year <= endsSeason; year += 1) {
    const summary = getClubContractSummary(state, transfer.sellerClubId, year);
    const removed = effectiveContractsForSeason(state.employment, year).filter(contract => contract.clubId === transfer.sellerClubId && outgoing.has(contract.playerId));
    const remainingSize = summary.rosterSize - removed.length;
    const remainingWages = summary.seasonWages - removed.reduce((sum, contract) => sum + contract.seasonWage, 0);
    const live = getLiveMarketOffers(state).filter(item => item.clubId === transfer.sellerClubId && item.seasonNumber + 1 <= year && item.seasonNumber + item.seasons >= year);
    const shortfalls = live.reduce((sum, item) => sum + Math.max(0, MIN_ROSTER_WAGE_RESERVE - item.seasonWage), 0);
    const minimum = Math.max(0, MIN_ROSTER_SIZE - remainingSize - summary.reservedRosterSize) * MIN_ROSTER_WAGE_RESERVE + shortfalls;
    if (remainingWages + summary.reservedWages + minimum > summary.budget) return 'The selling club needs salary budget to replace its departing players.';
    if (year === state.seasonNumber + 1 && remainingSize < MIN_ROSTER_SIZE) {
      const playerReplyOn = transfer.clubStatus === 'accepted' ? offer.responseOn : addMarketDays(state.date, 1);
      if (playerReplyOn >= window.closesOn) return 'The selling club needs a day to sign a replacement before recruitment closes.';
    }
  }
  return null;
}
