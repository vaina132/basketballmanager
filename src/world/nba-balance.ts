import type { WorldContext } from '../domain/world';

/**
 * NBA step 12 (format 96, provisional number; new NBA worlds with `world.nba.balance`): the balance measured on five
 * automatic seasons of the live world-14 pack (NBA alone, seeds 7 and 11; NBA with Spain's top two divisions, seed 7).
 * Worlds without the marker (formats 90-95) keep every rule below as before, so their saves replay exactly.
 *
 * - Matches play the `nba-2026b` calibration (src/engine/calibration.ts): stars' minutes 32-36 instead of 36-38, NBA
 *   late-game fouling and more overtime.
 * - Money: an NBA club's player wages pool is its owner's payroll ceiling, changed by the board's verdict as before,
 *   with nothing more on top. Before, unused staff budget (about $20-34M at NBA money levels, `staffRoomForWages`) was
 *   added as well, so payrolls rose over five seasons until two thirds of the league paid the luxury tax (7 -> 20).
 *   Measured after: 7, 1-2, 2-3, 8-9, 10-12 taxpayers a season (NBA alone), 7, 2, 4, 5, 7 (NBA and Spain).
 * - A signing at the player's minimum salary that a club needs for its 13 is always allowed, under the cap as over it
 *   (`employment-policy.ts`); without the staff budget a club short of players could otherwise afford no one.
 */
export const NBA_BALANCE_RULES = Object.freeze({ model: 'nba-balance-1' as const });

/** Whether a career's world uses the step-12 NBA balance (format 96). */
export const usesNbaBalance = (context: WorldContext | undefined): boolean => context?.world?.nba?.balance === NBA_BALANCE_RULES.model;
