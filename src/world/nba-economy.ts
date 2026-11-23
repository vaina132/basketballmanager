/**
 * NBA money, a placeholder (NBA step 4, format 90) that step 6 (salary cap, luxury tax, currency setting) replaces.
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
