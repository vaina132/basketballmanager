import type { CareerWorld, WorldContext } from '../domain/world';
import type { FinanceEntry } from '../domain/finance';
import { clubEconomy } from './economy';
import { derivePresidentTraits } from './presidents';
import { financeLedgerEntries, type FinanceLedgerSource } from './finance-ledger';

/**
 * Format 99 (owner decision, 24 November 2026: fix "cash piles up"; reversible game defaults, not researched figures).
 * New careers in worlds with researched club money (marker `world.cashBalance`, option `cashBalance`); worlds without the
 * marker (format 97 and earlier) keep their rules exactly, so their saves replay unchanged.
 *
 * Measured before (format 97, ten automatic seasons on the live pack): EuroLeague clubs ended season 10 with 68-176% of
 * their budget in cash, some clubs 240-375%; NBA clubs a median of $654M and the richest over $1B, with player wages only
 * about 38% of revenue. Surplus spending (format 88) already lets every club spend its cash above a 25% reserve, but a
 * club with a full squad cannot turn more wage room into wages, so the money kept piling up.
 *
 * Rules:
 * 1. **The owner's dividend.** At every season opening (from a career's second season), a club whose net cash (cash less
 *    unpaid costs) just before the opening is above `keepShare` of its new season budget gets less season funding: its
 *    owner and backers take `takeShare` of the excess back (at most the whole season funding, so a club never goes below
 *    the kept share). It applies to every club, the manager's too: it is the owner's money and the owner's decision,
 *    as in real clubs, and it only touches cash far above anything a season needs (the manager keeps 75-125% of the
 *    budget, the NBA 25-50% of revenue), so a manager who saves still keeps a large reserve. Money spent on players,
 *    staff or facilities is never taken.
 * 2. **Per-club variety from the president:** ambition sets how much the club keeps (an ambitious owner keeps a war chest:
 *    `keepShare` from its low end at ambition 1 to its high end at ambition 5); generosity sets how much of the excess the
 *    owner takes (`takeShare` from all of it at generosity 1 to half at generosity 5). So some clubs still hold well over
 *    their budget, but cash settles instead of growing season after season.
 * 3. **NBA revenue** (worlds with the NBA's money rules): team revenue by market `NBA_ECONOMY.cashBalanceRevenueUsd` ($260M / $360M / $600M
 *    for the smallest, middle and largest markets, was $300M / $450M / $750M), so player wages are about half of revenue,
 *    as under the NBA's revenue split. NBA owners take their profits every season, so an NBA club keeps a smaller share.
 */
export const CASH_BALANCE_RULES = Object.freeze({
  /** The cash a club keeps at a season opening, as a share of its new season budget: [ambition 1, ambition 5]. */
  keepShare: Object.freeze([0.75, 1.25] as const),
  /** The same for NBA clubs (share of revenue). */
  nbaKeepShare: Object.freeze([0.25, 0.5] as const),
  /** The share of the excess the owner takes back: [generosity 1, generosity 5]. */
  takeShare: Object.freeze([1, 0.5] as const),
  /** Dividends are rounded down to EUR 100 (cents). */
  step: 10_000,
});

/** Format 99: whether the career's world carries the cash balance (new careers of worlds with researched money). */
export function usesCashBalance(context: WorldContext | undefined): boolean {
  return context?.world?.cashBalance === true && !!context.world.economy;
}

const lerp = (low: number, high: number, t: number) => low + (high - low) * t;
const traitShare = (level: number) => Math.max(0, Math.min(1, (level - 1) / 4));

/** Format 99: the share of its season budget a club keeps in cash at a season opening, from its president's ambition. */
export function cashKeepShare(world: CareerWorld, clubId: string, nba: boolean): number {
  const president = world.presidents.find(item => item.clubId === clubId);
  const ambition = (president?.traits ?? derivePresidentTraits(clubId)).ambition;
  const [low, high] = nba ? CASH_BALANCE_RULES.nbaKeepShare : CASH_BALANCE_RULES.keepShare;
  return lerp(low, high, traitShare(ambition));
}

/** Format 99: the share of the excess cash a club's owner takes back, from the president's generosity (3 without one). */
export function dividendTakeShare(world: CareerWorld, clubId: string): number {
  const generosity = world.presidents.find(item => item.clubId === clubId)?.generosity ?? 3;
  const [low, high] = CASH_BALANCE_RULES.takeShare;
  return lerp(low, high, traitShare(generosity));
}

/**
 * Each club's net (cash less unpaid costs) just before `season` opens: the sum of every entry of earlier seasons (the
 * ledger is chronological, so the scan stops at the first entry of `season` or later). Every caller computes it once per
 * season opening.
 */
export function netsBeforeSeason(finance: FinanceLedgerSource, season: number): Map<string, number> {
  const nets = new Map<string, number>();
  for (const entry of financeLedgerEntries(finance)) {
    if (entry.seasonNumber >= season) break;
    nets.set(entry.clubId, (nets.get(entry.clubId) ?? 0) + entry.amount);
  }
  return nets;
}

/** The same for every season opening after the first entry's season, in one pass (the save check reads every season). */
export function netsBeforeEachSeason(ledger: readonly Pick<FinanceEntry, 'clubId' | 'seasonNumber' | 'amount'>[]): Map<number, Map<string, number>> {
  const result = new Map<number, Map<string, number>>(), running = new Map<string, number>();
  let season = ledger[0]?.seasonNumber;
  for (const entry of ledger) {
    while (season !== undefined && entry.seasonNumber > season) { season += 1; result.set(season, new Map(running)); }
    running.set(entry.clubId, (running.get(entry.clubId) ?? 0) + entry.amount);
  }
  if (season !== undefined) result.set(season + 1, new Map(running));
  return result;
}

/**
 * Format 99: the owner's dividend a club pays at the opening of the context's season (cents, taken from that season's
 * funding `funding`): `takeShare` of its net before the opening (`net`) above `keepShare` of the season budget, in EUR 100
 * steps, at most the funding. 0 without the cash balance, in a career's first season or without club money.
 */
export function ownerDividend(context: WorldContext & { seasonNumber: number }, clubId: string, net: number | undefined, funding: number): number {
  if (!usesCashBalance(context) || context.seasonNumber < 2 || net === undefined || funding <= 0) return 0;
  const economy = clubEconomy(context, clubId);
  if (!economy || economy.budget <= 0) return 0;
  const world = context.world!, keep = Math.round(economy.budget * cashKeepShare(world, clubId, economy.band === 'nba'));
  if (net <= keep) return 0;
  const step = CASH_BALANCE_RULES.step;
  return Math.min(funding, Math.floor((net - keep) * dividendTakeShare(world, clubId) / step) * step);
}

/** Format 99, for the screens: the dividend a club's owner took at `season`'s opening (cents; 0 without the cash balance). */
export function seasonOwnerDividend(state: WorldContext & { finance: FinanceLedgerSource }, clubId: string, season: number, funding: number): number {
  if (!usesCashBalance(state) || season < 2) return 0;
  return ownerDividend({ ...state, seasonNumber: season }, clubId, netsBeforeSeason(state.finance, season).get(clubId), funding);
}
