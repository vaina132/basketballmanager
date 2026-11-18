import { leavingClubIds } from './background';
import type { WorldContext } from '../domain/world';
import { REAL_ECONOMY_RULES, worldEconomy } from './economy';
import type { MarketOffer } from '../domain/market';
import type { ContractOfferOptions, PlayerContractQuote } from '../domain/employment';
import type { SeasonState } from '../domain/season';
import type { Player } from '../domain/types';
import type { TransferPaymentPlan } from '../domain/transfer-payments';
import { getActiveCareerPlayers } from './player-catalog';
import { contractForSeason, effectiveContractsForSeason, getClubContractSummary, MIN_ROSTER_SIZE, quotePlayerContract } from './employment-policy';
import { getFinanceBalance } from './finance';
import { addMarketDays, getLiveMarketOffers, getMarketWindow, isCompetitiveMarket, isMarketActive } from './market-policy';
import { getSpendableCash } from './payroll-policy';
import { getTransferPaymentSummary, TRANSFER_PAYMENT_PLANS } from './transfer-payments';
import { releaseClauseTriggerReason } from './release-clauses';

export const MIN_TRANSFER_FEE = 100_000;
export const MAX_TRANSFER_FEE = 50_000_000;
export const TRANSFER_FEE_STEP = 100_000;
/** The largest transfer fee: EUR 500,000 in the development economy, EUR 50 million with a researched economy (format 62). */
export const maxTransferFee = (context?: WorldContext): number => worldEconomy(context) ? REAL_ECONOMY_RULES.limits.maxTransferFee * 100 : MAX_TRANSFER_FEE;
/** The fee rule's wording for a context (the development text is kept for historical replies). */
export const transferFeeRuleText = (context?: WorldContext, prefix = '€'): string => `Choose a transfer fee from ${prefix}1,000 to ${prefix}${(maxTransferFee(context) / 100).toLocaleString('en-GB')} in ${prefix}1,000 steps.`;

/** Fictional asking price based on remaining contracted salary, never hidden ability. */
export function requiredTransferFee(state: Pick<SeasonState, 'employment' | 'seasonNumber'> & WorldContext, playerId: string): number {
  const contract = contractForSeason(state.employment, playerId, state.seasonNumber + 1);
  if (!contract) return 0;
  const remainingSalary = contract.seasonWage * (contract.endsSeason - Math.max(contract.startsSeason, state.seasonNumber + 1) + 1);
  return Math.min(maxTransferFee(state), Math.max(MIN_TRANSFER_FEE, Math.ceil(remainingSalary / TRANSFER_FEE_STEP) * TRANSFER_FEE_STEP));
}

export function getTransferCandidates(state: SeasonState, clubId = state.managedClubId): readonly Player[] {
  if (!isMarketActive(state) || !isCompetitiveMarket(state)) return [];
  const leaving = leavingClubIds(state);
  return getActiveCareerPlayers(state, state.seasonNumber + 1, 1).filter(player => {
    const contract = contractForSeason(state.employment, player.id, state.seasonNumber + 1);
    return contract && contract.clubId !== clubId && !leaving.has(contract.clubId) && !(state.employment.transfers ?? []).some(transfer => transfer.playerId === player.id && transfer.startsSeason === state.seasonNumber + 1);
  });
}

/** Shared basic paid-offer guard; wage/roster checks remain in quotePlayerContract. */
export function transferOfferReason(state: SeasonState, playerId: string, fee: number, buyerId: string, resolvingOfferId?: string, paymentPlan: TransferPaymentPlan = 'upfront', options: ContractOfferOptions = {}): string | null {
  const window = getMarketWindow(state), contract = contractForSeason(state.employment, playerId, state.seasonNumber + 1);
  const own = getLiveMarketOffers(state).find(offer => offer.playerId === playerId && offer.clubId === buyerId);
  const resolving = !!resolvingOfferId && own?.id === resolvingOfferId && own.status === 'pending' && own.responseOn === state.date;
  if (!isMarketActive(state) || !isCompetitiveMarket(state) || !window) return 'Club transfers are available during the competitive offseason.';
  if (!contract || contract.clubId === buyerId) return 'Choose a player under contract at another club for next season.';
  if (leavingClubIds(state).has(contract.clubId) || leavingClubIds(state).has(buyerId)) return 'Clubs leaving the game\'s leagues take no part in transfers this offseason.';
  if ((state.employment.transfers ?? []).some(transfer => transfer.playerId === playerId && transfer.startsSeason === state.seasonNumber + 1)) return 'This player has already changed clubs this offseason.';
  if (!TRANSFER_PAYMENT_PLANS.includes(paymentPlan)) return 'Choose a supported transfer payment plan.';
  if (!Number.isSafeInteger(fee) || fee < MIN_TRANSFER_FEE || fee > maxTransferFee(state) || fee % TRANSFER_FEE_STEP !== 0) return transferFeeRuleText(state);
  if (options.transferMode === 'release-clause') { const reason = releaseClauseTriggerReason(state, playerId, fee, paymentPlan); if (reason) return reason; }
  if (resolving) {
    if (!own?.transfer || own.transfer.clubStatus !== 'accepted' || own.transfer.contractId !== contract.id || own.transfer.sellerClubId !== contract.clubId || own.transfer.fee !== fee || (own.transfer.paymentPlan ?? 'upfront') !== paymentPlan || (own.transfer.mode ?? 'negotiated') !== (options.transferMode ?? 'negotiated')) return 'The selling club must approve these transfer terms before the player can sign.';
    if (state.date > window.closesOn || state.date > own.expiresOn) return 'The transfer offer has expired.';
  } else if (addMarketDays(state.date, options.transferMode === 'release-clause' ? 1 : 2) > window.closesOn) return options.transferMode === 'release-clause' ? 'Allow a player reply before recruitment closes.' : 'Allow a club decision and a player reply before recruitment closes.';
  if (options.transferMode === 'release-clause') {
    const reason = sellerReplacementReason(state, { id: own?.id ?? '', playerId, responseOn: resolving ? state.date : addMarketDays(state.date, 1), transfer: { sellerClubId: contract.clubId, contractId: contract.id, fee, paymentPlan, requiredFee: requiredTransferFee(state, playerId), clubStatus: 'accepted', clubResponseOn: state.date, clubRespondedOn: state.date, clubReason: null, counterFee: null, mode: 'release-clause' } });
    if (reason) return reason;
  }
  if (getFinanceBalance(state.finance, buyerId).unpaid > 0) return 'Settle unpaid club costs before offering a transfer fee.';
  if (getTransferPaymentSummary(state, buyerId).overdue > 0) return 'Settle overdue transfer payments before offering another transfer fee.';
  if (getSpendableCash(state, buyerId, own?.id) < fee) return 'The transfer fee exceeds your Spending left after other commitments.';
  return null;
}

export interface TransferOfferQuote extends PlayerContractQuote {
  transferMode?: 'release-clause';
  sellerClubId: string | null;
  contractId: string | null;
  requiredFee: number;
  fee: number;
  paymentPlan: TransferPaymentPlan;
}

export function quoteTransferOffer(state: SeasonState, playerId: string, seasonWage: number, seasons: number, fee: number, clubId = state.managedClubId, paymentPlan: TransferPaymentPlan = 'upfront', options: ContractOfferOptions = {}): TransferOfferQuote {
  const contract = contractForSeason(state.employment, playerId, state.seasonNumber + 1);
  return { ...quotePlayerContract(state, playerId, seasonWage, seasons, clubId, undefined, fee, paymentPlan, options), sellerClubId: contract?.clubId ?? null, contractId: contract?.id ?? null, requiredFee: requiredTransferFee(state, playerId), fee, paymentPlan, ...(options.transferMode === 'release-clause' ? { transferMode: 'release-clause' as const } : {}) };
}

/** Protect replacements for every approved outgoing player, including concurrent sales. */
export function sellerReplacementReason(state: SeasonState, offer: Pick<MarketOffer, 'id' | 'playerId' | 'responseOn' | 'transfer'>): string | null {
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
    const shortfalls = live.reduce((sum, item) => sum + Math.max(0, summary.reserveWage - item.seasonWage), 0);
    const minimum = Math.max(0, MIN_ROSTER_SIZE - remainingSize - summary.reservedRosterSize) * summary.reserveWage + shortfalls;
    if (remainingWages + summary.reservedWages + minimum > summary.budget) return 'The selling club needs wages budget to replace its departing players.';
    if (year === state.seasonNumber + 1 && remainingSize < MIN_ROSTER_SIZE) {
      const playerReplyOn = transfer.clubStatus === 'accepted' ? offer.responseOn : addMarketDays(state.date, 1);
      if (playerReplyOn >= window.closesOn) return 'The selling club needs a day to sign a replacement before recruitment closes.';
    }
  }
  return null;
}
