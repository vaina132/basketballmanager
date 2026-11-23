import type { CareerWorld } from '../domain/world';
import { NBA_FIRST_APRON, NBA_TAX_LINE, usdToCents } from './nba-cap';
import { presidentTraits } from './presidents';

/** NBA step 6 (format 91): the owner's payroll ceiling and the board's NBA aims (`nba-cap-policy.ts` uses them). */
export const NBA_OWNER_RULES = Object.freeze({
  /**
   * [E] The owner's payroll ceiling (the club's player wages pool) from the president's ambition: 1-2 stay below the
   * tax line (`belowTaxUsd` under it), 3 go up to the tax line, 4-5 up to the first apron (and pay the tax).
   */
  belowTaxUsd: 10_000_000,
  /** [E] The board's playoff aim by the club's resource rank among the NBA's clubs: the strongest aim for the playoffs, the next for the play-in. */
  playoffsRank: 10, playInRank: 20,
});

export type NbaOwnerCeiling = 'below-tax' | 'at-tax' | 'apron';

/** The owner's payroll ceiling level from the president's ambition. */
export function nbaOwnerCeilingLevel(world: CareerWorld, clubId: string): NbaOwnerCeiling {
  const ambition = presidentTraits(world, clubId).ambition;
  return ambition <= 2 ? 'below-tax' : ambition === 3 ? 'at-tax' : 'apron';
}

/** The owner's payroll ceiling in euro cents (EUR 10,000 steps): the club's player wages pool before board verdicts. */
export function nbaOwnerCeiling(world: CareerWorld, clubId: string): number {
  const level = nbaOwnerCeilingLevel(world, clubId);
  const amount = level === 'below-tax' ? NBA_TAX_LINE - usdToCents(NBA_OWNER_RULES.belowTaxUsd) : level === 'at-tax' ? NBA_TAX_LINE : NBA_FIRST_APRON;
  return Math.floor(amount / 1_000_000) * 1_000_000;
}

