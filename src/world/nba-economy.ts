import { NBA_PAYROLLS_2026_27 } from '../data/nba-payrolls';
import type { Team } from '../domain/types';
import { overallRating } from './overall-rating';
import { nbaMaximumWage, nbaMinimumWage, usdToCents } from './nba-cap';

/**
 * NBA money. NBA step 4 (format 90) placed every NBA club in one revenue range by squad strength and shared a payroll
 * derived from it (kept below for format-90 worlds). NBA step 6 (format 91, worlds with `world.nba.cap`) replaces it:
 * revenue by market size (`NBA_MARKETS`), each club's payroll shaped on its published 2026-27 payroll
 * (`src/data/nba-payrolls.ts`) and individual salaries estimated from rating, age and role (`nbaSquadWages`).
 *
 * The NBA pays far more than Europe (owner, 23 November 2026). Amounts are in US dollars here and stored in euro cents
 * at the game's fixed rate. [S] 2025-26/2026-27: team revenue about $300-750M (Forbes valuations 2025), team payrolls
 * about $150-200M (salary cap about $155M, luxury tax about $188M), minimum salary about $1.2M, maximum contracts
 * 25-35% of the cap ($39-55M). [E] Arena seats and ticket yield: about 18,500 seats, 95% full, about $110 a ticket.
 * Each club is placed in these ranges by squad strength among the NBA's clubs, as European clubs are within their band.
 */
export const NBA_ECONOMY = Object.freeze({
  /** US dollars per euro (fixed game rate, reversible). */
  usdPerEur: 1.16,
  /** [S] Team revenue, dollars: [weakest squad, median, strongest]. */
  revenueUsd: Object.freeze([300e6, 450e6, 750e6] as const),
  /** [S] Team payroll, dollars, at the same three revenue points (it rises with revenue, much less steeply). */
  payrollUsd: Object.freeze([145e6, 175e6, 205e6] as const),
  /** [S] Minimum salary, dollars (each player's floor). */
  minimumUsd: 1.2e6,
  /** [S] The largest contract a club may pay, dollars (35% of the cap plus room for its yearly rises). */
  maximumUsd: 60e6,
  /** [E] Arena and tickets: seats, usual fill and ticket yield in dollars. */
  gate: Object.freeze({ seats: 18_500, fill: 0.95, price: 110 }),
  /** [S] 41 home games in the regular season. */
  homeGames: 41,
  /**
   * [S] Wage weights of a club's twelve best players: NBA stars take a far larger share than in Europe (a maximum
   * contract is 25-35% of the cap); the best paid still takes at most a quarter of the payroll.
   */
  wageRanks: Object.freeze([36, 22, 14, 10, 8, 6.5, 5.5, 4.5, 4, 3.5, 3, 2.5] as const),
  /** [E] Revenue mix, % of revenue: national media and league money count as central money. */
  revenueMix: Object.freeze({ tickets: 22, sponsorship: 14, central: 44, public: 0, owner: 5, other: 15 }),
});

/** Dollars to euros at the game rate. */
export const usdToEur = (usd: number): number => usd / NBA_ECONOMY.usdPerEur;

/** The three revenue points in euros: the NBA band's [low, typical, high]. */
export const NBA_BUDGET_EUROS: readonly [number, number, number] = Object.freeze(NBA_ECONOMY.revenueUsd.map(usdToEur) as unknown as [number, number, number]);

/**
 * The player wage bill (euro cents) a club with this budget (euro cents) pays: the payroll range follows the revenue
 * range piecewise linearly, held at its ends, so the bill is always derived from the stored budget alone.
 */
export function nbaPlayerBill(budget: number): number {
  const [r0, r1, r2] = NBA_ECONOMY.revenueUsd, [p0, p1, p2] = NBA_ECONOMY.payrollUsd;
  const usd = budget / 100 * NBA_ECONOMY.usdPerEur;
  const payroll = usd <= r0 ? p0 : usd >= r2 ? p2 : usd <= r1 ? p0 + (p1 - p0) * (usd - r0) / (r1 - r0) : p1 + (p2 - p1) * (usd - r1) / (r2 - r1);
  return Math.round(usdToEur(payroll) / 10_000) * 10_000 * 100;
}

/** Each player's floor (euro cents): the minimum salary. */
export const NBA_MINIMUM_WAGE = Math.round(usdToEur(NBA_ECONOMY.minimumUsd) / 500) * 500 * 100;
/** The largest wage an NBA club pays one player (euro cents). */
export const NBA_MAXIMUM_WAGE = Math.round(usdToEur(NBA_ECONOMY.maximumUsd) / 10_000) * 10_000 * 100;

/**
 * [E] NBA step 6: each club's market, 0 (smallest) to 1 (largest), from its metropolitan area, local TV market and
 * reported revenue standing (Forbes 2025 valuations: Warriors, Knicks and Lakers far ahead; Memphis and New Orleans the
 * smallest). It places the club's revenue in `revenueUsd` ($300M / $450M / $750M at 0 / 0.5 / 1). Reversible default.
 */
export const NBA_MARKETS: Readonly<Record<string, number>> = Object.freeze({
  'Golden State Warriors': 1, 'New York Knicks': 1, 'Los Angeles Lakers': 1,
  'Boston Celtics': 0.85, 'Chicago Bulls': 0.85,
  'Los Angeles Clippers': 0.75, 'Brooklyn Nets': 0.75, 'Philadelphia 76ers': 0.75, 'Miami Heat': 0.75, 'Toronto Raptors': 0.75, 'Dallas Mavericks': 0.75, 'Houston Rockets': 0.75,
  'Phoenix Suns': 0.55, 'Denver Nuggets': 0.55, 'Cleveland Cavaliers': 0.55, 'Atlanta Hawks': 0.55, 'Washington Wizards': 0.55, 'Milwaukee Bucks': 0.55,
  'Detroit Pistons': 0.45, 'Portland Trail Blazers': 0.45, 'Sacramento Kings': 0.45, 'Utah Jazz': 0.45, 'San Antonio Spurs': 0.45, 'Orlando Magic': 0.45, 'Indiana Pacers': 0.45, 'Minnesota Timberwolves': 0.45, 'Charlotte Hornets': 0.45,
  'Oklahoma City Thunder': 0.3, 'Memphis Grizzlies': 0.15, 'New Orleans Pelicans': 0.15,
});
/** Other spellings of NBA club names (the pack and older lists). */
const NBA_NAME_ALIASES: Readonly<Record<string, string>> = Object.freeze({ 'LA Clippers': 'Los Angeles Clippers', 'L.A. Clippers': 'Los Angeles Clippers', 'L.A. Lakers': 'Los Angeles Lakers', 'Philadelphia Sixers': 'Philadelphia 76ers' });
const nbaName = (name: string): string => NBA_NAME_ALIASES[name] ?? name;

export const NBA_PAYROLL_RULES = Object.freeze({
  /**
   * [E] The share of a club's published payroll its squad in the game carries: the trackers' totals also count dead
   * money, cap holds and players outside the game's 13-15 standard contracts (two-way and released players).
   */
  squadShare: 0.95,
  /** [S] The median published 2026-27 payroll, for a club missing from the list (dollars). */
  fallbackUsd: 197_000_000,
  /**
   * [E] Salary shape inside a squad: weights by rank in the squad (best first; NBA stars take a far larger share than in
   * Europe: a maximum contract is 25-35% of the cap), multiplied by e for each `ratingSpread` overall points above the
   * squad's average (within `ratingLimits`); players under 23 earn `youngShare` of their weight (rookie-scale deals).
   * Every salary stays between the player's minimum and maximum contract at his age.
   */
  ranks: Object.freeze([30, 22, 16, 12, 9, 7, 5.5, 4.5, 3.5, 3, 2.5, 2, 1.5, 1.2, 1] as const),
  ratingSpread: 10,
  ratingLimits: Object.freeze([0.6, 1.6] as const),
  youngShare: 0.7,
  youngAge: 22,
});

/** NBA step 6: a club's market (0-1), 0.5 when unknown. */
export const nbaMarket = (name: string): number => NBA_MARKETS[nbaName(name)] ?? 0.5;
/** NBA step 6: a club's revenue in euros from its market. */
export function nbaRevenueEuros(name: string): number {
  const t = nbaMarket(name), [r0, r1, r2] = NBA_ECONOMY.revenueUsd;
  return usdToEur(t < 0.5 ? r0 + (r1 - r0) * t * 2 : r1 + (r2 - r1) * (t * 2 - 1));
}
/** NBA step 6: the payroll target (euro cents) of a club's squad, shaped on its published payroll. */
export function nbaPayrollTarget(name: string): number {
  const published = NBA_PAYROLLS_2026_27.find(item => item.team === nbaName(name))?.payrollUsd ?? NBA_PAYROLL_RULES.fallbackUsd;
  return usdToCents(published * NBA_PAYROLL_RULES.squadShare);
}

/**
 * NBA step 6: each player's estimated salary (euro cents) sharing the club's payroll target by rank, rating and age
 * (`NBA_PAYROLL_RULES`), each between his minimum and maximum contract; the total lands within a few thousand euros of
 * the target unless the limits make it impossible. `ageOf` gives a player's age at the season's opening.
 */
export function nbaSquadWages(players: readonly Team['players'][number][], target: number, ageOf: (playerId: string) => number | null): Record<string, number> {
  const rules = NBA_PAYROLL_RULES, ratings = players.map(player => overallRating(player.attributes, player.position));
  const order = players.map((_, index) => index).sort((a, b) => ratings[b]! - ratings[a]! || (players[a]!.id < players[b]!.id ? -1 : 1));
  const average = ratings.reduce((sum, value) => sum + value, 0) / Math.max(1, ratings.length);
  const weights = new Array<number>(players.length);
  order.forEach((index, rank) => {
    const age = ageOf(players[index]!.id);
    const rating = Math.min(rules.ratingLimits[1], Math.max(rules.ratingLimits[0], Math.exp((ratings[index]! - average) / rules.ratingSpread)));
    weights[index] = (rules.ranks[rank] ?? rules.ranks[rules.ranks.length - 1]!) * rating * (age !== null && age <= rules.youngAge ? rules.youngShare : 1);
  });
  const minimum = players.map(player => nbaMinimumWage(ageOf(player.id))), maximum = players.map(player => nbaMaximumWage(ageOf(player.id)));
  // Share the target by weight, holding each salary within its limits; the others share what is left (a few passes settle it).
  const fixed = new Array<number | null>(players.length).fill(null);
  for (let pass = 0; pass < 12; pass += 1) {
    const free = players.map((_, index) => index).filter(index => fixed[index] === null);
    const left = target - fixed.reduce<number>((sum, value) => sum + (value ?? 0), 0), weight = free.reduce((sum, index) => sum + weights[index]!, 0);
    let changed = false;
    for (const index of free) {
      const amount = weight > 0 ? left * weights[index]! / weight : minimum[index]!;
      if (amount < minimum[index]!) { fixed[index] = minimum[index]!; changed = true; } else if (amount > maximum[index]!) { fixed[index] = maximum[index]!; changed = true; }
    }
    if (!changed) {
      for (const index of free) fixed[index] = weight > 0 ? left * weights[index]! / weight : minimum[index]!;
      break;
    }
  }
  return Object.fromEntries(players.map((player, index) => {
    const amount = fixed[index] ?? minimum[index]!;
    const rounded = amount <= minimum[index]! ? minimum[index]! : Math.min(maximum[index]!, Math.max(minimum[index]!, Math.round(amount / 500_000) * 500_000));
    return [player.id, rounded];
  }));
}
