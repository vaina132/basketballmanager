import type { SeasonState } from '../domain/season';
import type { CareerWorld, WorldContext } from '../domain/world';
import { clubEconomy, REAL_ECONOMY_RULES } from './economy';
import { ECONOMY_BALANCE_RULES, usesEconomyBalance } from './economy-balance';
import { remainingSeasonShortfall } from './facilities-policy';
import { getSpendablePosition } from './payroll-policy';
import { seasonSalaryBudget } from './board-consequences';
import { derivePresidentTraits } from './presidents';
import { seasonEndNets, successNeed, SPENDING_BALANCE_RULES, usesSpendingBalance } from './spending-balance';
import { isCapClub } from './club-roster-policy';
import { usesLongCareers } from './long-careers';

/**
 * Format 88 (owner decision, 23 November 2026: "Rich clubs can spend more on wages, more on signing new players and
 * investing in club facilities, signing better staff, players, etc. Some can still pile up money of course, that's
 * always an option. Depends on how you play the game."). Reversible game defaults, not researched figures.
 *
 * Measured before (format 87, five automatic seasons of real Turkey and Spain worlds): clubs' wages stay at the bill
 * their figures fund while their income runs a little above their budget, so cash piled up at mid and big clubs (median
 * 35-58% of the budget after five seasons, EuroLeague clubs about 90%).
 *
 * Rules, for new careers with the economy balance (`world.surplusSpending`), for clubs run automatically (computer
 * clubs, and the manager's club only for the decisions he delegates; the manager himself may keep piling up money):
 * - **Surplus:** the club's projected season-end cash (spendable cash less what the rest of the season still needs, as
 *   the economy balance reads it) above a healthy reserve of `reserveShare` of its budget. Below it nothing changes.
 * - **Spending style:** each president's generosity and ambition (fictional game traits) give a club its appetite, from
 *   0 (careful: keeps piling up money; at least a small appetite from format 89, `src/world/spending-balance.ts`) to 1. A club plans to spend `seasonSpendShare` x appetite of its surplus in a
 *   season, and pays its full pay scale and premium from `fullPayAppetite` (in proportion below), so spending is
 *   gradual: it falls as cash comes down towards the reserve and stops there.
 * - **Wages** (`wageShare` of the plan): computer clubs get extra room above their player salary budget in the shared
 *   contract guard, at most `maxWageRaise` of that budget, set by the cash at the end of the latest completed season
 *   (`anchoredSurplus`, fixed until the next season ends, so the strict save check replays it). A club spending from
 *   its surplus ranks its own expiring players with free agents by need and rating instead of renewing its own first,
 *   and offers more than the asking wage: up to `wagePremium` (full once the surplus is `premiumFullShare` of the
 *   budget), or its own pay scale for the player's place in its squad when that is more (`surplusOfferWage`), when the
 *   offer fits its guards; it renews its players who ask for new contracts at that scale too. Real players earn what
 *   their new club pays; the highest wage wins a contested player. The manager's club never gets the extra room
 *   (whether he delegated is not kept for the save check), only the ranking, the offers and the transfer budget.
 * - **Transfers** (`transferShare` of the plan): a transfer budget for one paid signing in the offseason window (two
 *   from `secondSigningAppetite`; release clauses count), under the existing market rules (asking fee from the player's
 *   remaining contract, the seller's squad and wage guards, squad limits), for a player rated above the best free one.
 * - **Staff** (from the cash at the latest completed season's end, as the wage room): computer clubs aim up to
 *   `staffLevelBoost` higher on the staff ladder, and a role may use up to `staffCapBoost` more of the staff budget,
 *   within Wages left as before; at a contract's end, a person rated well below that aim (`staffUpgradeGap`) is
 *   replaced (`src/world/staff-upgrades.ts`).
 * - **Facilities:** automatic upgrades may carry upkeep up to `facilityUpkeepShare` of the budget (instead of the usual
 *   share), the weakest facility first; the usual cash cushion still applies.
 * - **Sale replacements:** a club that sold a player still buys one stronger replacement (as before), but its fee now
 *   keeps its projected season-end cash at the economy balance's target (`saleReplacementBudget`).
 * - **Sponsor exits:** an automatic early exit from a sponsorship deal also needs its fee to leave the season-end cash
 *   the economy balance aims for (measured: a promoted club's fee took its cash to nothing, with unpaid costs).
 */
export const SURPLUS_SPENDING_RULES = Object.freeze({
  /** The healthy reserve: season-end cash, as a share of the budget, a club keeps before spending anything. */
  reserveShare: 0.25,
  /** Appetite = (generosity + ambition - `appetiteFloor`) / `appetiteRange`, within 0-1 (both traits 1-5). */
  appetiteFloor: 3,
  appetiteRange: 6,
  /** The share of its surplus a club of full appetite plans to spend in one season. */
  seasonSpendShare: 1,
  /** Pay: a club pays its full pay scale and premium from this appetite (in proportion below). */
  fullPayAppetite: 0.5,
  /** How the plan splits: extra wages and a transfer budget. */
  wageShare: 0.6,
  transferShare: 0.4,
  /** Extra wage room is at most this share of the season's player salary budget. */
  maxWageRaise: 0.6,
  /**
   * The premium on the asking wage a club of full appetite offers while it spends from a surplus, reached once its surplus
   * is `premiumFullShare` of its budget (in proportion below): real players earn more at richer clubs.
   */
  wagePremium: 0.5,
  premiumFullShare: 0.25,
  /** Paid signings a club spending from its surplus may try in one offseason window: one, two from this appetite. */
  secondSigningAppetite: 0.5,
  /** Staff: up to this much higher on the 0-1 staff ladder, and up to this much more of the staff budget per role. */
  staffLevelBoost: 0.3,
  staffCapBoost: 0.5,
  /** Staff: a person whose contract ends is replaced when rated this share of the role's range below the club's aim. */
  staffUpgradeGap: 0.1,
  /** Facilities: the most added upkeep automatic upgrades may carry, as a share of the budget, at full appetite. */
  facilityUpkeepShare: 0.035,
});

type SpendingContext = WorldContext & Partial<Pick<SeasonState, 'finance' | 'payroll' | 'managedClubId' | 'employment' | 'status' | 'round' | 'board' | 'career'>>;

/** Format 88: whether the career's world carries surplus spending (new careers with the economy balance). */
export function usesSurplusSpending(context: WorldContext | undefined): boolean {
  return !!context?.world?.surplusSpending && usesEconomyBalance(context);
}

const appetites = new WeakMap<CareerWorld, Map<string, number>>();
/**
 * A club's spending appetite, 0 (careful) to 1, from its president's generosity and ambition (stored traits, or the
 * ones derived from the club for presidents without them); a club without a president has the middle traits.
 */
export function spendingAppetite(world: CareerWorld, clubId: string): number {
  let cache = appetites.get(world);
  if (!cache) { cache = new Map(); appetites.set(world, cache); }
  const known = cache.get(clubId);
  if (known !== undefined) return known;
  const president = world.presidents.find(item => item.clubId === clubId);
  const generosity = president?.generosity ?? 3, ambition = (president?.traits ?? derivePresidentTraits(clubId)).ambition;
  const rules = SURPLUS_SPENDING_RULES;
  const value = Math.max(0, Math.min(1, (generosity + ambition - rules.appetiteFloor) / rules.appetiteRange));
  cache.set(clubId, value);
  return value;
}

/** What a club's appetite is read for: its squad (wages and transfers), its staff or its facilities. */
export type AppetiteUse = 'squad' | 'staff' | 'facilities';
/**
 * A club's appetite for one kind of spending, 0 to 1: its president's spending style (`spendingAppetite`); with the
 * format-89 spending balance at least `minAppetite`, and for the squad raised by `successBoost` x how far it fell short of
 * its board's results target in the latest completed season (`successNeed`).
 */
export function clubAppetite(state: SpendingContext, clubId: string, use: AppetiteUse): number {
  const base = spendingAppetite(state.world!, clubId);
  if (!usesSpendingBalance(state)) return base;
  const rules = SPENDING_BALANCE_RULES, floor = Math.max(rules.minAppetite, base);
  return use === 'squad' ? Math.min(1, floor + rules.successBoost * successNeed(state as SpendingContext & { seasonNumber?: number }, clubId)) : floor;
}

/** Whether a club's signings are made automatically: a computer club, or the manager's club with delegated recruitment. */
function recruitsAutomatically(context: SpendingContext, clubId: string): boolean {
  return clubId !== context.managedClubId || !!context.employment?.delegated;
}

// One reading per club for each unchanged state it depends on (money, wages, offers, staff, facilities, schedule, week):
// automatic recruitment asks for it for many candidates. Every input is a key, so a reloaded save reads the same value.
const surplusCache = new WeakMap<object, { keys: readonly unknown[]; values: Map<string, number> }>();
/**
 * Format 88: a club's surplus in cents: its projected season-end cash (spendable position less what the rest of the
 * season still needs beyond its cautious gate) above `reserveShare` of its budget; 0 at or below the reserve, without
 * researched money or in careers without surplus spending.
 */
export function clubSurplus(state: SpendingContext, clubId: string): number {
  if (!usesSurplusSpending(state) || !state.finance || !state.payroll) return 0;
  const full = state as Partial<SeasonState>;
  const keys = [state.payroll, full.market, full.recruitment, state.employment, full.facilities, full.coaching, full.scouts, full.fitness, full.physio, full.assistant, full.youth, full.fixtures, full.board, state.world, state.round, state.status, state.seasonNumber, state.economySeasons];
  let entry = surplusCache.get(state.finance);
  if (!entry || entry.keys.length !== keys.length || entry.keys.some((key, index) => key !== keys[index])) { entry = { keys, values: new Map() }; surplusCache.set(state.finance, entry); }
  const known = entry.values.get(clubId);
  if (known !== undefined) return known;
  const economy = clubEconomy(state, clubId);
  let value = 0;
  if (economy && economy.budget > 0) {
    const projected = getSpendablePosition(state as SeasonState, clubId) - remainingSeasonShortfall(state as SeasonState, clubId);
    value = Math.max(0, projected - Math.round(economy.budget * SURPLUS_SPENDING_RULES.reserveShare));
  }
  entry.values.set(clubId, value);
  return value;
}

/** Format 88: what a club run automatically plans to spend of its surplus this season (cents; 0 for a careful club before format 89), by its squad appetite (`clubAppetite`). */
export function plannedSurplusSpend(state: SpendingContext, clubId: string): number {
  if (!usesSurplusSpending(state) || !state.world) return 0;
  const appetite = clubAppetite(state, clubId, 'squad');
  return appetite > 0 ? Math.floor(clubSurplus(state, clubId) * appetite * SURPLUS_SPENDING_RULES.seasonSpendShare) : 0;
}

/**
 * Format 88: the surplus that sets a computer club's extra wage room: its cash at the end of the latest completed season
 * (after that season's last weekly operating costs) above `reserveShare` of its budget. It stays fixed through the
 * offseason and the following season, so an offer's reply and the strict save check's replay read the same room.
 * 0 in a career's first season (no completed season yet) and for a club without that season's figures.
 */
export function anchoredSurplus(state: SpendingContext & { seasonNumber: number }, clubId: string): number {
  if (!usesSurplusSpending(state) || !state.finance) return 0;
  const season = state.status === 'complete' ? state.seasonNumber : state.seasonNumber - 1;
  if (season < 1) return 0;
  const net = seasonEndNets(state as Parameters<typeof seasonEndNets>[0], season).get(clubId), economy = clubEconomy(state, clubId);
  if (net === undefined || !economy || economy.budget <= 0) return 0;
  return Math.max(0, net - Math.round(economy.budget * SURPLUS_SPENDING_RULES.reserveShare));
}

/**
 * Format 88: the extra player wage room a computer club has for contracts of `seasonNumber` (this season, or the next
 * one in the offseason): `wageShare` of what its appetite plans to spend of its anchored surplus (`anchoredSurplus`), at
 * most `maxWageRaise` of that season's player salary budget, in EUR 500 steps. The manager's club never has it, even
 * with recruitment delegated (whether he delegated is not kept for the save check), nor careful clubs (before format 89), clubs at or below
 * the reserve, later seasons and careers without surplus spending.
 */
export function surplusWageRoom(state: SpendingContext & { seasonNumber: number }, clubId: string, seasonNumber: number): number {
  if (!usesSurplusSpending(state) || !state.world || clubId === state.managedClubId && !takenOverThisOffseason(state, clubId) || seasonNumber > state.seasonNumber + 1 || seasonNumber < state.seasonNumber) return 0;
  // Format 92: an NBA club's payroll stays within its owner's ceiling and the cap rules; spare cash adds no wage room.
  if (isCapClub(state, clubId)) return 0;
  const appetite = clubAppetite(state, clubId, 'squad');
  if (appetite <= 0) return 0;
  const plan = anchoredSurplus(state, clubId) * appetite * SURPLUS_SPENDING_RULES.seasonSpendShare;
  if (plan <= 0) return 0;
  const cap = seasonSalaryBudget(state, clubId, seasonNumber) * SURPLUS_SPENDING_RULES.maxWageRaise;
  return Math.floor(Math.min(cap, plan * SURPLUS_SPENDING_RULES.wageShare) / 50_000) * 50_000;
}

/**
 * Format 97 (`long-careers.ts`): a club the manager took over during this offseason keeps a computer club's wage room for
 * the rest of that recruitment window, so the offers it made before he arrived still fit when they are answered (and when
 * the save check replays the window with him in charge).
 */
function takenOverThisOffseason(state: SpendingContext & { seasonNumber: number }, clubId: string): boolean {
  return usesLongCareers(state) && state.status === 'complete' && !!state.career?.moves.some(move => move.toClubId === clubId && move.seasonNumber === state.seasonNumber && move.phase === 'offseason');
}

/** Format 88: the most the save check accepts above a season's salary ceiling for a club (any club, any season). */
export function surplusWageCeiling(ceiling: number): number {
  return Math.floor(ceiling * SURPLUS_SPENDING_RULES.maxWageRaise / 50_000) * 50_000;
}

/** Format 88: the transfer budget of a club run automatically: `transferShare` of its planned spend (cents). */
export function surplusTransferBudget(state: SpendingContext, clubId: string): number {
  if (!recruitsAutomatically(state, clubId)) return 0;
  return Math.floor(plannedSurplusSpend(state, clubId) * SURPLUS_SPENDING_RULES.transferShare);
}

/** How far a club goes towards its full pay scale and premium: its appetite over `fullPayAppetite`, at most 1. */
const payDrive = (state: SpendingContext, clubId: string): number => Math.min(1, clubAppetite(state, clubId, 'squad') / SURPLUS_SPENDING_RULES.fullPayAppetite);

/** Format 88: the premium on the asking wage a club run automatically offers while it spends from a surplus (0 otherwise). */
export function surplusWagePremium(state: SpendingContext, clubId: string): number {
  if (!spendsSurplus(state, clubId)) return 0;
  const rules = SURPLUS_SPENDING_RULES, budget = clubEconomy(state, clubId)!.budget;
  return Math.round(rules.wagePremium * payDrive(state, clubId) * Math.min(1, clubSurplus(state, clubId) / (rules.premiumFullShare * budget)) * 100) / 100;
}

/**
 * Format 88: the wage a club spending from its surplus offers a player who would be `rank` (1 = best) in a squad of
 * `slots` players: the most of the asking wage with the premium (`surplusWagePremium`) and the club's own pay scale for
 * that place, weighted by appetite. The pay scale shares the club's wage target (that season's player salary budget plus
 * its extra wage room) by squad rank, as the real-economy wage bill is shared (`wageRanks`, `wageExtra`, `wageFringe`):
 * real players earn what their new club pays for their place, not what their old one did. In wage steps, within the
 * contract wage limit; the asking wage for clubs not spending from a surplus.
 */
export function surplusOfferWage(state: SpendingContext & { seasonNumber: number }, clubId: string, asking: number, rank: number, slots: number, seasonNumber: number): number {
  const premium = surplusWagePremium(state, clubId);
  if (premium <= 0) return asking;
  const economy = REAL_ECONOMY_RULES, weight = (place: number) => place <= economy.wageRanks.length ? economy.wageRanks[place - 1]! : place <= 14 ? economy.wageExtra : economy.wageFringe;
  let total = 0;
  for (let place = 1; place <= Math.max(slots, rank); place += 1) total += weight(place);
  const target = seasonSalaryBudget(state, clubId, seasonNumber) + surplusWageRoom(state, clubId, seasonNumber);
  const scale = target * weight(rank) / total;
  const wage = Math.max(asking * (1 + premium), asking + payDrive(state, clubId) * Math.max(0, scale - asking));
  return Math.min(economy.limits.maxContractWage * 100, Math.ceil(wage / 50_000) * 50_000);
}

/**
 * Format 88: the most a club that has sold a player pays for its stronger replacement (the existing rule, which spent
 * up to all its spendable cash): its transfer budget from a surplus, or what keeps its projected season-end cash at the
 * economy balance's target, whichever is more (measured: with more sales to rich clubs, mid clubs spent their cash on
 * replacements and ended seasons with 5% of their budget). Unlimited in careers without surplus spending.
 */
export function saleReplacementBudget(state: SpendingContext, clubId: string): number {
  if (!usesSurplusSpending(state) || !state.finance || !state.payroll) return Infinity;
  const economy = clubEconomy(state, clubId);
  if (!economy) return Infinity;
  const projected = getSpendablePosition(state as SeasonState, clubId) - remainingSeasonShortfall(state as SeasonState, clubId);
  return Math.max(surplusTransferBudget(state, clubId), Math.floor(projected - economy.budget * ECONOMY_BALANCE_RULES.wageCap.targetCashShare));
}

/** Format 88: the paid signings a club may try in one offseason window: one after a sale (as before), up to two from a surplus. */
export function paidSigningLimit(state: SpendingContext, clubId: string, sold: boolean): number {
  if (surplusTransferBudget(state, clubId) <= 0) return sold ? 1 : 0;
  return clubAppetite(state, clubId, 'squad') >= SURPLUS_SPENDING_RULES.secondSigningAppetite ? 2 : 1;
}

/** Format 88: whether a club run automatically spends from a surplus now (ranks its own expiring players with free agents). */
export function spendsSurplus(state: SpendingContext, clubId: string): boolean {
  return recruitsAutomatically(state, clubId) && plannedSurplusSpend(state, clubId) > 0;
}

/**
 * Format 88: how far a computer club with a surplus reaches for better staff: 0 to 1, its appetite while its cash at the
 * end of the latest completed season was above the reserve (`anchoredSurplus`; so never in a career's first season and
 * never for its opening staff). 0 for the manager's club, whose staff he hires himself, and without club money.
 */
export function staffReach(state: SpendingContext, clubId: string): number {
  if (!usesSurplusSpending(state) || !state.world || clubId === state.managedClubId || !state.finance || state.seasonNumber === undefined) return 0;
  const appetite = clubAppetite(state, clubId, 'staff');
  return appetite > 0 && anchoredSurplus(state as SpendingContext & { seasonNumber: number }, clubId) > 0 ? appetite : 0;
}

/**
 * Format 88: the upkeep share of the budget automatic facility upgrades may carry for a club with a surplus (between the
 * usual share and `facilityUpkeepShare`, by appetite); null when the usual rule applies.
 */
export function surplusUpkeepShare(state: SpendingContext, clubId: string, usual: number): number | null {
  if (!usesSurplusSpending(state) || !state.world || plannedSurplusSpend(state, clubId) <= 0) return null;
  return usual + (SURPLUS_SPENDING_RULES.facilityUpkeepShare - usual) * clubAppetite(state, clubId, 'facilities');
}
