import type { MarketEvent, MarketOffer, MarketWindow } from '../domain/market';
import type { SeasonState } from '../domain/season';
import type { WorldContext } from '../domain/world';
import { scheduledOfferQuote } from './employment';
import { getLiveMarketOffers } from './market-policy';
import { usesSpendingBalance } from './spending-balance';

/**
 * Format 103 (owner suggestion after format 89): the manager's own offers get the protection computer
 * clubs have had since format 89.
 *
 * Measured before: when the manager agreed a sale after making offers (the club then keeps wages to replace the player it
 * sells), or anything else shrank his club's wage budget, the player's later answer failed with "This offer exceeds the
 * season N wage budget…" and the offseason could not continue.
 *
 * Rule, for new careers with the spending balance (`world.managerOfferWithdrawal`): when the manager continues to the
 * next offseason day, each of his club's offers the player answers that day is checked with the same wage-budget check
 * the answer uses. An offer that no longer fits is withdrawn first, as a recorded step (a `withdraw` market event carrying
 * `budgetSeason` and, when a sale of his club was agreed and pending, `soldPlayerId`), so the strict save check replays it
 * exactly. Offers are checked in the order they were made, so each withdrawal frees its reservation for the next. The
 * Inbox tells the manager which offer was withdrawn and why.
 */
export function usesManagerOfferWithdrawal(context: WorldContext | undefined): boolean {
  return context?.world?.managerOfferWithdrawal === true && usesSpendingBalance(context);
}

const BUDGET_REASON = /^This offer exceeds the season (\d+) wage budget/;

/** The season whose wage budget a refused quote names, or null when it was refused for another reason. */
export function budgetSeasonOf(reason: string | null | undefined): number | null {
  const match = reason ? BUDGET_REASON.exec(reason) : null;
  return match ? Number(match[1]) : null;
}

/** Whether the player answers this offer on `date` (a pending offer, its fee agreed when it is a transfer). */
function answeredOn(offer: MarketOffer, date: string): boolean {
  return offer.status === 'pending' && (!offer.transfer || offer.transfer.clubStatus === 'accepted') && offer.responseOn <= date;
}

/** The player of the club's agreed sale still waiting for the player's answer, if any (the first by offer order). */
export function pendingSaleOf(state: SeasonState, clubId: string): string | undefined {
  return getLiveMarketOffers(state).find(offer => offer.transfer?.sellerClubId === clubId && offer.transfer.clubStatus === 'accepted' && offer.status === 'pending')?.playerId;
}

/**
 * The next withdrawal for the manager's club before the answers of `date`, or null when every offer answered that day
 * still fits its wage budget.
 */
export function nextBudgetWithdrawal(state: SeasonState, date: string): Extract<MarketEvent, { type: 'withdraw' }> | null {
  if (!usesManagerOfferWithdrawal(state) || !state.managedClubId) return null;
  for (const offer of getLiveMarketOffers(state)) {
    if (offer.clubId !== state.managedClubId || !answeredOn(offer, date)) continue;
    const budgetSeason = budgetSeasonOf(scheduledOfferQuote(state, offer).reason);
    if (budgetSeason === null) continue;
    const soldPlayerId = pendingSaleOf(state, offer.clubId);
    return { type: 'withdraw', date: state.date, offerId: offer.id, budgetSeason, ...(soldPlayerId ? { soldPlayerId } : {}) };
  }
  return null;
}

/** The reason a recorded budget withdrawal does not follow the rule's shape, or null (checked live and on replay). */
export function budgetWithdrawalReason(state: SeasonState, window: MarketWindow, offer: MarketOffer, event: Extract<MarketEvent, { type: 'withdraw' }>): string | null {
  if (event.budgetSeason === undefined && event.soldPlayerId === undefined) return null;
  if (!usesManagerOfferWithdrawal(state)) return 'Only careers with the offer withdrawal record a wage-budget withdrawal.';
  if (offer.status !== 'pending') return 'Only an offer waiting for the player\'s answer is withdrawn for the wage budget.';
  const season = event.budgetSeason;
  if (typeof season !== 'number' || !Number.isInteger(season) || season < offer.seasonNumber + 1 || season > offer.seasonNumber + offer.seasons) return 'A wage-budget withdrawal names a season the offer covers.';
  if (event.soldPlayerId !== undefined && !window.offers.some(item => item.playerId === event.soldPlayerId && item.status === 'pending' && item.transfer?.sellerClubId === offer.clubId && item.transfer.clubStatus === 'accepted')) return 'A wage-budget withdrawal names a sale its club agreed.';
  return null;
}
