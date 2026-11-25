import type { SeasonState } from '../domain/season';
import type { CareerWorld, WorldContext } from '../domain/world';
import { isCapClub } from './club-roster-policy';
import { NBA_CAP_2026_27 } from '../data/nba-payrolls';
import { NBA_MID_LEVEL, nbaLuxuryTax, nbaMaximumWage, nbaMinimumWage, usdToCents } from './nba-cap';
import { addMarketDays } from './market-policy';
import { dateForRound } from './season';
import { isNbaClub, seasonRounds, worldOf } from './career-world';
import { overallRating } from './overall-rating';
import { getFinanceBalance } from './finance';
import { nbaPayroll } from './nba-cap-policy';
import { cashKeepShare, dividendTakeShare, usesCashBalance } from './cash-balance';
import { clubEconomy } from './economy';
import { getCareerPlayerAge, type CareerPlayerContext } from './player-catalog';
import { contractForSeason } from './employment-policy';
import { nbaValue } from './nba-moves';

/**
 * Format 107 (new careers in worlds with the NBA's money rules, `world.nbaFreeAgency`): NBA free agency keeps the
 * league's stars, as the real league does.
 *
 * Why stars left before (formats 93-102), measured on the live pack (world-16, NBA alone, seed 7): 17 players rated
 * 86+ had contracts ending after season 1, and all 17 left the world at the next opening (15 rated 88+, two of them 99s).
 * - 12 of them asked more than the most an NBA contract may pay them at their age (25/30/35% of the cap): their wage,
 *   +15% for the Star role, +5% for two seasons. Their clubs could never renew them: the in-season contract request was
 *   declined, the refusal added a premium, and every offseason quote failed on the maximum.
 * - The other 5 did not fit their owner's payroll ceiling, which Bird rights did not pass.
 * - No other club could sign them (over the cap, the mid-level exception is far below a star's ask), every club reached
 *   13 players within about five days, so the offseason ended, and players still unsigned at the opening left the world
 *   (NBA-only worlds keep 15 a club and remove unsigned players above that).
 *
 * Rules with the marker:
 * - **Asks within the maximum and his level.** A player never asks an NBA club more than his maximum contract at his
 *   age, nor more than NBA players of his overall rating earn (`levelPremium` above their median opening salary), in
 *   every demand: one season or longer, after a refused request, the club's role premium.
 * - **Bird rights for stars.** Re-signing the club's own player rated `birdStarLevel` or more (Bird rights) may take the
 *   payroll past the owner's payroll ceiling up to the tax line (an owner who stays below the tax keeps his stars without
 *   paying it; owners who accept the tax already have ceilings above the line).
 * - **The tax within the club's cash.** A club run automatically signs no one whose salary would leave a luxury tax
 *   bill above its cash (with the current season's bill still due; except the players it needs for 13), and takes on no
 *   salary above its owner's ceiling in a trade, so small-market clubs do not run up unpaid costs.
 * - **Asks fall in free agency.** In the offseason a player without a contract for next season asks any NBA club other
 *   than his own at most the non-taxpayer mid-level exception (every club over the cap can sign him once; his own club
 *   keeps his Bird rights at his full ask), and from `minimumAfterDays` days into the window his minimum salary (the
 *   veteran minimum; format 92 waited for the last seven days, after most offseasons had already ended).
 * - **Released salary counts.** An NBA club's wage budget check counts the salary of players it released (dead money),
 *   as the tax does, so making room cannot carry a club past its owner's ceiling.
 * - **Clubs make room.** An NBA club run automatically with a full squad may release one of its weakest players a
 *   window (`roomPerWindow`; the format-102 refresh, judged by overall rating: a free agent of the same position at least
 *   `roomMargin` better than him, the
 *   release paid within `releaseAllowanceUsd`, its salary staying on the payroll as dead money).
 * - **Departures.** In NBA-only worlds, players still unsigned when the season opens leave only below `keepLevel`, from
 *   `keepMaxAge` below `keepVeteranLevel`, or when they were already unsigned the whole season before; better players
 *   stay free agents for one more window.
 *
 * [E] Every value below is the game's estimate; the CBA's figures are in `nba-cap.ts`.
 */
export const NBA_FREE_AGENCY_RULES = Object.freeze({
  model: 'nba-free-agency-1' as const,
  /** [E] Own players at this overall or above may be re-signed past the owner's ceiling (about a club's best one or two). */
  birdStarLevel: 85,
  /**
   * [S] The payroll re-signing such a player may reach: the 2026-27 tax line. Measured (live pack, NBA alone, seed 7):
   * up to the first or second apron, 13-20 of 30 clubs paid the tax in seasons 2-5 (the real league: 7-9).
   */
  birdStarCeilingUsd: NBA_CAP_2026_27.taxLevelUsd,
  /** [E] A player asks at most this much (%) above the median opening salary of NBA players of his overall rating... */
  levelPremium: 20,
  /** [E] ...within this many overall points. */
  levelNeighbourhood: 2,
  /** [E] Days into the offseason window from which a free agent asks other clubs only his minimum salary. */
  minimumAfterDays: 3,
  /** [E] Releases a club makes in one window to sign a clearly better free agent. */
  roomPerWindow: 2,
  /** [E] How much better (overall rating) that free agent must be than the player released. */
  roomMargin: 6,
  /** [E] The most such a release may cost (about two seasons of a veteran's minimum salary). */
  releaseAllowanceUsd: 6_000_000,
  /** [E] NBA-only worlds: unsigned players at this overall or above stay in the world as free agents (an NBA club's 11th man)... */
  keepLevel: 65,
  /** [E] ...but from this age only at `keepVeteranLevel` or above (a rotation player). */
  keepMaxAge: 34,
  keepVeteranLevel: 80,
});

/** Whether a career's world uses format 107's NBA free agency. */
export const usesNbaFreeAgency = (context: WorldContext | undefined): boolean => context?.world?.nbaFreeAgency === true && context.world.nba?.cap === 'nba-cap-1';

export type NbaFreeAgencyContext = CareerPlayerContext & { employment?: SeasonState['employment']; status?: SeasonState['status'] };

/** The most (euro cents) a release to make room may cost. */
export const NBA_RELEASE_ALLOWANCE = usdToCents(NBA_FREE_AGENCY_RULES.releaseAllowanceUsd);

/** Format 107: whether a club makes room for clearly better free agents (an NBA club; the caller runs it automatically). */
export const nbaMakesRoom = (context: WorldContext, clubId: string): boolean => usesNbaFreeAgency(context) && isCapClub(context, clubId);

/** The payroll (euro cents) a club may reach re-signing one of its stars with Bird rights. */
export const NBA_BIRD_STAR_CEILING = Math.floor(usdToCents(NBA_FREE_AGENCY_RULES.birdStarCeilingUsd) / 1_000_000) * 1_000_000;

/**
 * Format 107: whether a club run automatically can pay from its cash the luxury tax a payroll (euro cents) for
 * `seasonNumber` would bring: for a later season, after the tax still due on the current season's payroll (charged at
 * the end of the regular season) and after the owner's take at the next opening (format 99).
 */
export function nbaTaxAffordable(state: SeasonState, clubId: string, payroll: number, seasonNumber: number): boolean {
  if (!usesNbaFreeAgency(state) || !isCapClub(state, clubId)) return true;
  const later = seasonNumber > state.seasonNumber;
  const due = state.status === 'active' && later ? nbaLuxuryTax(nbaPayroll(state, clubId, state.seasonNumber)) : 0;
  let cash = Math.max(0, getFinanceBalance(state.finance, clubId).cash - due);
  // Format 99: at the next opening the owner takes back part of the cash above what the club keeps.
  const economy = later && usesCashBalance(state) ? clubEconomy(state, clubId) : null;
  if (economy && economy.budget > 0) {
    const keep = Math.round(economy.budget * cashKeepShare(state.world!, clubId, true));
    if (cash > keep) cash = keep + Math.floor((cash - keep) * (1 - dividendTakeShare(state.world!, clubId)));
  }
  return nbaLuxuryTax(payroll) <= cash;
}

/**
 * Whether a player asks this club at most the mid-level exception: in the offseason, without a contract for next season,
 * from a club other than his current one. Depends only on the career's phase and contracts, so a save's replay decides
 * it the same way.
 */
function midLevelAsk(context: NbaFreeAgencyContext, clubId: string, playerId: string): boolean {
  if (context.status !== 'complete' || !context.employment || context.seasonNumber === undefined) return false;
  if (contractForSeason(context.employment, playerId, context.seasonNumber + 1)) return false;
  return contractForSeason(context.employment, playerId, context.seasonNumber)?.clubId !== clubId;
}

/** The mid-level exception in contract wage steps (EUR 500, rounded down), the most a free agent asks other clubs early in the window. */
const MID_LEVEL_ASK = Math.floor(NBA_MID_LEVEL / 50_000) * 50_000;

/** Format 107: the most a player asks an NBA club (null when no cap applies: older careers, European clubs). */
export function nbaDemandCap(context: NbaFreeAgencyContext, clubId: string | undefined, playerId: string): number | null {
  if (!clubId || !usesNbaFreeAgency(context) || !isCapClub(context, clubId)) return null;
  let age: number | null = null;
  try { age = context.date ? getCareerPlayerAge(context, playerId, context.date) : null; } catch { age = null; }
  // A player's ask follows his level today: at most what NBA players of his overall rating earn (opening salaries), with
  // the room for role and term premiums.
  const level = nbaLevelWage(context, playerId);
  const maximum = level === null ? nbaMaximumWage(age) : Math.min(nbaMaximumWage(age), level);
  if (!midLevelAsk(context, clubId, playerId)) return maximum;
  const opensOn = dateForRound(seasonRounds(context), context.seasonNumber!);
  return context.date && context.date >= addMarketDays(opensOn, NBA_FREE_AGENCY_RULES.minimumAfterDays) ? nbaMinimumWage(age) : Math.min(maximum, MID_LEVEL_ASK);
}

const levelCurves = new WeakMap<CareerWorld, readonly (number | null)[]>();
/**
 * The most an NBA player asks at an overall rating (euro cents, wage steps): `levelPremium` above the median opening salary
 * of NBA players within `levelNeighbourhood` points of it (widening until some are found), or null without NBA players.
 * Without it, players whose ratings fell kept asking their opening salaries (measured: renewals at the $57.7M maximum
 * for players rated 71-78, and 16 of 30 clubs over the tax line by season 4).
 */
function nbaLevelCurve(world: CareerWorld): readonly (number | null)[] {
  let curve = levelCurves.get(world);
  if (curve) return curve;
  const rows: { rating: number; wage: number }[] = [];
  for (const club of world.clubs) if (isNbaClub(world, club.id)) for (const player of club.players) {
    const wage = world.wages[player.id];
    if (wage !== undefined) rows.push({ rating: overallRating(player.attributes, player.position), wage });
  }
  const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor((sorted.length - 1) / 2)]!; };
  const top = Math.max(-1, ...rows.map(row => row.rating)), rules = NBA_FREE_AGENCY_RULES;
  curve = Array.from({ length: 100 }, (_, rating) => {
    if (!rows.length) return null;
    for (let width = rules.levelNeighbourhood; ; width += 1) {
      const near = rows.filter(row => Math.abs(row.rating - Math.min(rating, top)) <= width).map(row => row.wage);
      if (near.length) return Math.ceil(median(near) * (100 + rules.levelPremium) / 100 / 50_000) * 50_000;
    }
  });
  levelCurves.set(world, curve);
  return curve;
}

/** Format 107: the most a player asks at his overall rating today (null without NBA players). */
export function nbaLevelWage(context: CareerPlayerContext, playerId: string): number | null {
  return nbaLevelCurve(worldOf(context))[Math.max(0, Math.min(99, nbaValue(context, playerId)))] ?? null;
}

/** A demand limited by `nbaDemandCap` (unchanged without a cap). */
export function cappedNbaDemand(context: NbaFreeAgencyContext, clubId: string | undefined, playerId: string, demand: number): number {
  const cap = nbaDemandCap(context, clubId, playerId);
  return cap !== null && cap < demand ? cap : demand;
}

/** Format 107: whether re-signing this player with Bird rights may pass the owner's ceiling (his overall today). */
export function nbaBirdStar(context: CareerPlayerContext, playerId: string): boolean {
  return usesNbaFreeAgency(context) && nbaValue(context, playerId) >= NBA_FREE_AGENCY_RULES.birdStarLevel;
}

/**
 * Format 107 (NBA-only worlds): whether a player still unsigned when the season opens leaves the world (nobody would
 * sign him): below the keep level, an older player below the veteran level, or one already unsigned all last season.
 */
export function nbaUnsignedLeaves(context: NbaFreeAgencyContext, playerId: string): boolean {
  if (!usesNbaFreeAgency(context)) return true;
  const rules = NBA_FREE_AGENCY_RULES, value = nbaValue(context, playerId);
  const age = context.date ? getCareerPlayerAge(context, playerId, context.date) ?? 0 : 0;
  if (value < rules.keepLevel || age >= rules.keepMaxAge && value < rules.keepVeteranLevel) return true;
  return !context.employment || context.seasonNumber === undefined || !contractForSeason(context.employment, playerId, context.seasonNumber - 1);
}
