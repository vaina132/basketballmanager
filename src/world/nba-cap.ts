import { NBA_CAP_2026_27 } from '../data/nba-payrolls';

/**
 * NBA step 6 (format 92): the NBA's salary cap, exceptions, minimum and maximum contracts and luxury tax, in the game's
 * money (euro cents at the fixed game rate of 1.16 US dollars per euro). Pure figures and arithmetic only; the guards
 * that read a career's contracts live in `nba-cap-policy.ts`, shared by the manager and every computer club.
 *
 * Sources: [S] the NBA's 2026-27 salary cap announcement (https://pr.nba.com/2026-27-salary-cap/, `NBA_CAP_2026_27`):
 * cap $164.961M, tax line $200.428M, first apron $209.015M, non-taxpayer mid-level $15.044M, taxpayer mid-level
 * $6.064M; [S] the 2023 CBA: maximum contracts 25% / 30% / 35% of the cap by years of service (0-6, 7-9, 10+), the
 * minimum salary scale by years of service, and the tax rates per $5M above the line (1.5, 1.75, 2.5, 3.25, then +0.5 for
 * each further $5M; the repeater rates are left out). [D] The minimum scale for 2026-27 is the 2025-26 scale grown with
 * the cap (x 1.0667). [E] Years of service are not in the data: the game counts them from age (age - 21, 0 to 10), and
 * the maximum's bands follow the owner's age bands (24 or younger 25%, 25-28 30%, 29 or older 35%).
 *
 * Simplified on purpose (docs/nba.md): one cap for every season (no growth), no second apron, no repeater tax, no
 * stretch provision, Bird rights as "re-sign your own player", one mid-level exception a season, no room exception.
 */
export const NBA_CAP_RULES = Object.freeze({
  model: 'nba-cap-1' as const,
  usdPerEur: 1.16,
  capUsd: NBA_CAP_2026_27.salaryCapUsd,
  taxUsd: NBA_CAP_2026_27.taxLevelUsd,
  firstApronUsd: NBA_CAP_2026_27.firstApronUsd,
  nonTaxpayerMidLevelUsd: NBA_CAP_2026_27.nonTaxpayerMidLevelUsd,
  taxpayerMidLevelUsd: NBA_CAP_2026_27.taxpayerMidLevelUsd,
  /** [S]/[E] Maximum contract, % of the cap, by age: 24 or younger, 25-28, 29 or older. */
  maximumPercent: Object.freeze([25, 30, 35] as const),
  /** [D] Minimum salary in dollars by years of service 0-10+ (2025-26 scale x 1.0667). */
  minimumUsd: Object.freeze([1_357_000, 2_185_000, 2_449_000, 2_537_000, 2_625_000, 2_845_000, 3_064_000, 3_284_000, 3_504_000, 3_523_000, 3_876_000] as const),
  /** [E] Years of service counted from age. */
  serviceStartAge: 21,
  /** [S] Tax rates per $5M bracket above the tax line; each further bracket adds `rateStep`. */
  taxBracketUsd: 5_000_000,
  taxRates: Object.freeze([1.5, 1.75, 2.5, 3.25] as const),
  rateStep: 0.5,
  /** [S] Standard contracts an NBA club carries in the regular season (two-way contracts are left out). */
  roster: Object.freeze({ min: 13, max: 15 }),
});

/** The contract wage step (EUR 500), as `WAGE_STEP` in employment-policy (kept here so this file imports no policy). */
const WAGE_STEP = 50_000;

/** Dollars to euro cents at the game rate. */
export const usdToCents = (usd: number): number => Math.round(usd / NBA_CAP_RULES.usdPerEur * 100);
/** Euro cents to dollars at the game rate. */
export const centsToUsd = (cents: number): number => cents / 100 * NBA_CAP_RULES.usdPerEur;

export const NBA_SALARY_CAP = usdToCents(NBA_CAP_RULES.capUsd);
export const NBA_TAX_LINE = usdToCents(NBA_CAP_RULES.taxUsd);
export const NBA_FIRST_APRON = usdToCents(NBA_CAP_RULES.firstApronUsd);
export const NBA_MID_LEVEL = usdToCents(NBA_CAP_RULES.nonTaxpayerMidLevelUsd);
export const NBA_TAXPAYER_MID_LEVEL = usdToCents(NBA_CAP_RULES.taxpayerMidLevelUsd);

/** Years of service counted from age (0 to 10). */
export const nbaService = (age: number | null): number => Math.max(0, Math.min(10, (age ?? NBA_CAP_RULES.serviceStartAge) - NBA_CAP_RULES.serviceStartAge));

/** A player's minimum salary (euro cents, rounded up to the wage step) at his age. */
export function nbaMinimumWage(age: number | null): number {
  return Math.ceil(usdToCents(NBA_CAP_RULES.minimumUsd[nbaService(age)]!) / WAGE_STEP) * WAGE_STEP;
}

/** The rookie minimum: the lowest wage any NBA contract may carry. */
export const NBA_LOWEST_MINIMUM = nbaMinimumWage(0);

/** A player's maximum contract (euro cents, rounded down to the wage step) at his age. */
export function nbaMaximumWage(age: number | null): number {
  const [young, prime, veteran] = NBA_CAP_RULES.maximumPercent, years = age ?? 25;
  const percent = years <= 24 ? young : years <= 28 ? prime : veteran;
  return Math.floor(NBA_SALARY_CAP * percent / 100 / WAGE_STEP) * WAGE_STEP;
}
/** The largest wage an NBA contract may carry at any age (35% of the cap). */
export const NBA_HIGHEST_MAXIMUM = nbaMaximumWage(40);

/** The mid-level exception a club may use: the non-taxpayer amount while its payroll after the signing stays at or below the first apron, else the taxpayer amount. */
export const nbaMidLevel = (payrollAfter: number): number => payrollAfter <= NBA_FIRST_APRON ? NBA_MID_LEVEL : NBA_TAXPAYER_MID_LEVEL;

/**
 * The luxury tax (euro cents) on a payroll (euro cents): each $5M bracket above the tax line at its rate (1.5, 1.75, 2.5,
 * 3.25, then 0.5 more per further bracket), the last bracket in proportion. Rounded down to whole cents.
 */
export function nbaLuxuryTax(payroll: number): number {
  const over = payroll - NBA_TAX_LINE;
  if (over <= 0) return 0;
  const bracket = NBA_CAP_RULES.taxBracketUsd / NBA_CAP_RULES.usdPerEur * 100, rates = NBA_CAP_RULES.taxRates;
  let tax = 0;
  for (let index = 0, left = over; left > 0; index += 1, left -= bracket) {
    const rate = index < rates.length ? rates[index]! : rates[rates.length - 1]! + NBA_CAP_RULES.rateStep * (index - rates.length + 1);
    tax += Math.min(left, bracket) * rate;
  }
  return Math.floor(tax);
}

/**
 * How an NBA signing is legal (format 92): `room` (the payroll after it stays at or below the cap), `minimum` (a
 * minimum contract), `bird` (re-signing the club's own player: simplified Bird rights), `mle` (the club's one mid-level
 * exception of the season, within its amount), or null when none applies.
 */
export type NbaCapRoute = 'room' | 'minimum' | 'bird' | 'mle';
export const NBA_CAP_ROUTES: readonly NbaCapRoute[] = ['room', 'minimum', 'bird', 'mle'];

export interface NbaSigningInput {
  /** The club's payroll for the season before this signing: contracts, live offers and released salary (euro cents). */
  payrollBefore: number;
  seasonWage: number;
  /** The player's minimum salary at his age. */
  minimum: number;
  /** The player is under contract with this club this season (re-signing him uses Bird rights). */
  ownPlayer: boolean;
  /** The club's mid-level exception for that season is already used or held by an open offer. */
  midLevelUsed: boolean;
}

/** The route that makes a signing legal, preferring routes that use up nothing (room, minimum, Bird) before the mid-level. */
export function nbaSigningRoute(input: NbaSigningInput): NbaCapRoute | null {
  const after = input.payrollBefore + input.seasonWage;
  if (after <= NBA_SALARY_CAP) return 'room';
  if (input.seasonWage <= input.minimum) return 'minimum';
  if (input.ownPlayer) return 'bird';
  if (!input.midLevelUsed && input.seasonWage <= nbaMidLevel(after)) return 'mle';
  return null;
}

/** Equal shares (euro cents, rounded down) of the season's tax among the clubs that paid none; what cannot be split stays with the league. */
export function nbaTaxShare(totalTax: number, receivers: number): number {
  return receivers > 0 ? Math.floor(totalTax / receivers) : 0;
}
