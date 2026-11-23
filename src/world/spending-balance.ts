import type { SeasonState } from '../domain/season';
import type { WorldContext } from '../domain/world';
import { usesEconomyBalance } from './economy-balance';
import { seasonRounds } from './career-world';
import { financeLedgerCount, financeLedgerEntries } from './finance-ledger';

/**
 * Format 89 (owner decisions, 23 November 2026; reversible game defaults, not researched figures). Measured before
 * (format 88, five automatic seasons of real Turkey and Spain worlds and the synthetic test worlds):
 * - the format-87 low-cash wage limit acted only once a club's projected season-end cash fell below 10% of its budget, so
 *   a weak club whose money ran down a little every season (KSK, Turkey seed 11: 10%, 11%, 4%, then 0% with EUR 20k of
 *   unpaid costs) signed its squad for the next season as if the last one had broken even;
 * - careful clubs (spending appetite 0, about one club in 11) never spent anything and kept piling up money (Efes 88-113%
 *   of its budget), and how a club spent did not depend on how its season went.
 * Rules, for new careers with surplus spending (`world.spendingBalance`):
 * 1. **Look-ahead wage limit:** for the low-cash wage limit of clubs run automatically, the projected season-end cash is
 *    lowered by the loss of the latest completed season (its net result from season end to season end; gains are not
 *    counted): a club that lost money last season expects to lose it again next season, and keeps its new wages lower
 *    in time. After a losing season the limit acts once that look-ahead is below `wageCapTargetShare` of the budget
 *    (instead of 10%), so a club on the way down slows down before a bad season; a club that broke even keeps 10% (a 15%
 *    start for every club held back in-season bids for listed players). The eight-player minimum squad is still never
 *    held back.
 * 2. **Careful clubs spend a little:** every club's spending appetite is at least `minAppetite`.
 * 3. **Spending follows success:** a club that fell short of its board's results target in the latest completed season
 *    (regular-season wins against the target pace at the season's last board review) spends more of its surplus on the
 *    squad (wages and transfers): its squad appetite rises by up to `successBoost`, reached when it missed the target by
 *    `missFull` of its games. A club that met its target keeps its usual appetite; facility and staff spending keep it
 *    too, so the extra money goes to the squad first.
 * 4. **Better staff within reach:** measured, EuroLeague clubs used 47-79% of their staff budget because they already
 *    held the best people in four roles (rated at the top of the scale), while training coaches stayed at the top of
 *    the authored range (rated 8) and extra coaches were chosen per euro (rated 6), although elite coaches rated 9-10 were
 *    free and within their budget. A club with staff reach (format 88) places its training coach aim on a ladder that
 *    rises towards the market's best coach by its reach (`staffTargetRating`), looks at local and foreign candidates
 *    alike when reaching (`fittingLocalStaffChoice`), and weighs an extra coach's fee less by its reach
 *    (`recruitAiCoaches`). Real assistant coaches stay with their clubs as before.
 */
export const SPENDING_BALANCE_RULES = Object.freeze({
  /** The lowest spending appetite of any club (format 88 careful clubs had 0). */
  minAppetite: 0.25,
  /** The look-ahead cash share, of the budget, below which the low-cash wage limit acts after a losing season (else 10%). */
  wageCapTargetShare: 0.15,
  /** The most a missed results target adds to a club's squad appetite. */
  successBoost: 0.4,
  /** The share of its games by which a club must miss its results target for the full boost (in proportion below). */
  missFull: 0.15,
});

/** Format 89: whether the career's world carries the spending balance (new careers with surplus spending). */
export function usesSpendingBalance(context: WorldContext | undefined): boolean {
  return !!context?.world?.spendingBalance && !!context.world.surplusSpending && usesEconomyBalance(context);
}

type LedgerContext = WorldContext & Partial<Pick<SeasonState, 'finance' | 'status'>> & { seasonNumber?: number };

/** The latest completed season of a state: this one once it is complete (its offseason), else the one before. */
export function latestCompletedSeason(state: { status?: SeasonState['status']; seasonNumber?: number }): number {
  return state.seasonNumber === undefined ? 0 : state.status === 'complete' ? state.seasonNumber : state.seasonNumber - 1;
}

type SeasonEnd = { through: number; nets: ReadonlyMap<string, number>; openings: ReadonlyMap<string, number> };
// Each club's net (cash less unpaid costs) after its last weekly operating costs of a season, and its opening cash booked
// in that season (a career's first season, or a club joining the full world), found once per career ledger and season:
// completed seasons never change (the ledger only grows), so the values hold for every later state.
const seasonEndCache = new WeakMap<object, Map<number, SeasonEnd>>();
function seasonEnd(state: LedgerContext & { finance: NonNullable<LedgerContext['finance']> }, season: number): SeasonEnd {
  const finance = state.finance, key: object = finance.archives?.[0] ?? finance.ledger[0] ?? finance;
  let bySeason = seasonEndCache.get(key);
  if (!bySeason) { bySeason = new Map(); seasonEndCache.set(key, bySeason); }
  const count = financeLedgerCount(finance), known = bySeason.get(season);
  // A ledger holding the season's last week reads the stored values; a shorter one (an earlier prefix) works it out.
  if (known && count > known.through) return known;
  const rounds = seasonRounds(state), running = new Map<string, number>(), nets = new Map<string, number>(), openings = new Map<string, number>();
  let index = 0, through = -1;
  for (const entry of financeLedgerEntries(finance)) {
    running.set(entry.clubId, (running.get(entry.clubId) ?? 0) + entry.amount);
    if (entry.kind === 'opening' && entry.seasonNumber === season) openings.set(entry.clubId, (openings.get(entry.clubId) ?? 0) + entry.amount);
    if (entry.kind === 'operations' && entry.seasonNumber === season && entry.round === rounds) { nets.set(entry.clubId, running.get(entry.clubId)!); through = index; }
    index += 1;
  }
  const value = { through, nets, openings };
  if (through >= 0 && (!known || through >= known.through)) bySeason.set(season, value);
  return value;
}

/** Format 88: each club's net (cash less unpaid costs) after its last weekly operating costs of `season`. */
export function seasonEndNets(state: LedgerContext & { finance: NonNullable<LedgerContext['finance']> }, season: number): ReadonlyMap<string, number> {
  return seasonEnd(state, season).nets;
}

/**
 * Format 89: a club's net result of the latest completed season (cents): its net at that season's end less its net at the
 * season end before (or the opening cash it was given that season, in a career's first season or after joining the full
 * world). Null without a completed season, without club money or for a club without both figures.
 */
export function lastSeasonResult(state: LedgerContext, clubId: string): number | null {
  if (!state.finance) return null;
  const season = latestCompletedSeason(state);
  if (season < 1) return null;
  const ledger = state as LedgerContext & { finance: NonNullable<LedgerContext['finance']> };
  const end = seasonEnd(ledger, season), net = end.nets.get(clubId);
  if (net === undefined) return null;
  const before = season > 1 ? seasonEnd(ledger, season - 1).nets.get(clubId) : undefined;
  const start = before ?? end.openings.get(clubId);
  return start === undefined ? null : net - start;
}

// One reading per board review history: reviews are only appended, and a completed season's last review never changes.
const needCache = new WeakMap<object, Map<string, number>>();
/**
 * Format 89: how far a club fell short of its board's results target in the latest completed season, 0 (met) to 1:
 * its regular-season wins against the target pace at that season's last board review, as a share of its games, over
 * `missFull`. 0 without the spending balance, a completed season or a review of the club.
 */
export function successNeed(state: WorldContext & Partial<Pick<SeasonState, 'board' | 'status'>> & { seasonNumber?: number }, clubId: string): number {
  if (!usesSpendingBalance(state) || !state.board) return 0;
  const season = latestCompletedSeason(state);
  if (season < 1) return 0;
  const reviews = state.board.reviews;
  let cache = needCache.get(reviews);
  if (!cache) { cache = new Map(); needCache.set(reviews, cache); }
  const key = `${season}|${clubId}`, known = cache.get(key);
  if (known !== undefined) return known;
  let value = 0;
  for (let index = reviews.length - 1; index >= 0; index -= 1) {
    const review = reviews[index]!;
    if (review.seasonNumber > season) continue;
    if (review.seasonNumber < season) break;
    const club = review.clubs[clubId];
    if (!club) continue;
    value = club.played > 0 ? Math.max(0, Math.min(1, (club.targetPace - club.wins) / club.played / SPENDING_BALANCE_RULES.missFull)) : 0;
    break;
  }
  cache.set(key, value);
  return value;
}
