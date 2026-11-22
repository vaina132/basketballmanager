import type { EconomyBand, WorldContext } from '../domain/world';
import type { SeasonFixture } from '../domain/season';
import { clubEconomy } from './economy';
import { playsAtNeutralVenue } from './career-world';

/**
 * Format 87 (economy balance, 22 November 2026; reversible game defaults, not researched figures): weak clubs stay
 * sustainable over long careers, as real small clubs do (they cut wages, rely on cheap and young players, and leagues
 * and federations share solidarity money). Measured before (five automatic seasons of a real Turkey world and a real
 * Spain world): consistently weak clubs lost a few percent of their budget every season, because
 * - automatic facility spending counted the season's expected gate evenly over every remaining week, while the home
 *   games (and their gate) end weeks before the season's last costs, so upgrades bought in the second half of a season
 *   spent gate that never came (a Spanish second-division club ended its first season with no cash and unpaid costs);
 * - computer clubs signed players up to their full salary allocation (110% of the wage bill their figures fund) whatever
 *   their cash, so a club whose gate fell short of its figures drifted down season after season.
 * Rules, for new careers of worlds with researched club money (`world.economyBalance`):
 * 1. League solidarity: clubs of the smaller money bands receive `solidarityPercent` of their season budget with their
 *    season funding (one `funding-s<season>` entry, as the league and federation distributions already are).
 * 2. Automatic facility spending (computer clubs, "Let the board handle facilities") counts the expected gate only for
 *    the club's home games still to play this season (`remainingHomeShare`), not for every remaining week.
 * 3. Automatic wage targets (computer clubs, delegated recruitment; `src/world/automatic-wages.ts`): while a club's
 *    projected season-end cash is below `wageCap.targetCashShare` of its budget, its new player wages for a season stay
 *    within `wageCap.fullShare` of the wage bill its figures fund, less `wageCap.recovery` of the cash shortfall, never
 *    below `wageCap.floorShare` of that bill. Signings needed for the eight-player minimum squad are never held back.
 *    The manager's own offers keep the shared guards only.
 */
export const ECONOMY_BALANCE_RULES = Object.freeze({
  /** League solidarity, % of the season budget, by money band. */
  solidarityPercent: Object.freeze({ 'euroleague-top': 0, euroleague: 0, 'top-upper': 0, 'top-lower': 1, second: 2, third: 3 } as Readonly<Record<EconomyBand, number>>),
  wageCap: Object.freeze({
    /** The season-end cash, as a share of the budget, automatic control aims to keep (as automatic facility spending does). */
    targetCashShare: 0.1,
    /** The wage bill share of a club with enough cash: its usual salary allocation (110% of the bill its figures fund). */
    fullShare: 1.1,
    /** Share of the cash shortfall (target minus projected season-end cash) taken off next season's wages. */
    recovery: 0.75,
    /** Wages never need to fall below this share of the funded bill. */
    floorShare: 0.6,
  }),
});

/** Format 87: whether the career's world carries the economy balance (new careers of worlds with researched money). */
export function usesEconomyBalance(context: WorldContext | undefined): boolean {
  return !!context?.world?.economyBalance && !!context.world.economy;
}

/** Format 87: the league solidarity money a club receives with its season funding (cents); zero in other careers. */
export function solidarityPayment(context: WorldContext, clubId: string): number {
  if (!usesEconomyBalance(context)) return 0;
  const economy = clubEconomy(context, clubId);
  if (!economy) return 0;
  return Math.round(economy.budget * ECONOMY_BALANCE_RULES.solidarityPercent[economy.band] / 100 / 10_000) * 10_000;
}

/**
 * Format 87: the share of this season's gate still to come for a club: its home games without a result over all its
 * home games scheduled this season (games at one venue earn no gate). 1 before any home game is scheduled.
 */
export function remainingHomeShare(context: WorldContext & { fixtures?: readonly SeasonFixture[] }, clubId: string): number {
  let total = 0, remaining = 0;
  for (const fixture of context.fixtures ?? []) {
    if (fixture.homeClubId !== clubId || playsAtNeutralVenue(context, fixture)) continue;
    total += 1;
    if (!fixture.result) remaining += 1;
  }
  return total ? remaining / total : 1;
}
