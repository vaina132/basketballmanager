import type { CareerWorld, EconomyBand, WorldContext } from '../domain/world';
import type { SeasonState } from '../domain/season';
import { clubCountry, worldOf } from './career-world';
export { hasLowerDivision } from './career-world';
import { clubEconomy, moneyAt } from './economy';
import { overallRating } from './overall-rating';
import { nbaValue } from './nba-moves';
import type { CareerPlayerContext } from './player-catalog';
import { clubSalaryCeiling } from './club-roster-policy';
import { seasonSalaryCeiling, type SalaryBudgetContext } from './board-consequences';
import { surplusWageCeiling, usesSurplusSpending } from './surplus-spending';

/**
 * Format 109 (decided 25 November 2026 under the owner's delegation, reversible; new careers with academy position
 * training and researched club money, `world.secondDivisionBalance`): a player good enough for the top division asks a
 * second-division club a top-division wage.
 *
 * Why (measured, ten automatic seasons, Spain seed 11, format 108): Primera FEB's median overall rose 37 -> 66 and its
 * best eight 40 -> 70 (Liga ACB 62 -> 72 and 68 -> 77), its three-point share of shots 32% -> 46%. By season 10, 160 of
 * its 199 players were academy graduates (median 70), most of them from other clubs' academies. A player's asking wage
 * is fixed for the whole career (the opening wage of real players; an academy graduate's intake wage, EUR 5,000-8,000 at
 * his academy club's money level), so graduates who became top-division players still asked a few thousand euros:
 * Primera FEB players rated 75+ were paid a median EUR 71,000 (asking EUR 6,000), Liga ACB players of that level EUR
 * 0.86-1.8M. Second-division clubs, whose budgets stayed at about EUR 1.4-1.7M, could field top-division squads.
 *
 * The rule: when a club in a lower division (economy band `second` or `third` for the contract's season) negotiates, a
 * player rated above its country's second division at the career's start (`levelQuantile` of the opening second
 * division's ratings) asks at least the median opening wage of the country's top-division players of his overall rating
 * (within `neighbourhood` points, widening until some are found). Top-division clubs and every other ask are unchanged.
 * A club's own academy prospect is exempt until the day of his promotion (his first contract at his academy wage).
 * The rating is the player's overall at his position on the context's date, ageing included and practice not (as the
 * NBA's level asks read it, so a save's replay decides each answer the same way).
 */
export const SECOND_DIVISION_RULES = Object.freeze({
  model: 'second-division-1' as const,
  /** [E] The economy bands of clubs below the top division. */
  lowerBands: Object.freeze(['second', 'third'] as readonly EconomyBand[]),
  /** [E] A player rated above this share of the country's opening second-division players asks top-division wages... */
  levelQuantile: 0.9,
  /** [E] ...at least the median opening wage of top-division players within this many overall points of him. */
  neighbourhood: 2,
});

/** Whether a career's world uses format 109's second-division balance. */
export const usesSecondDivisionBalance = (context: WorldContext | undefined): boolean => context?.world?.secondDivisionBalance === true;

interface CountryLevel { threshold: number; wages: readonly number[] }
const levels = new WeakMap<CareerWorld, ReadonlyMap<string, CountryLevel>>();
const median = (values: readonly number[]) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor((sorted.length - 1) / 2)]!; };

/** Each country's threshold and top-division wage by overall rating 0-99 (euro cents, wage steps), from the opening world. */
function countryLevels(world: CareerWorld): ReadonlyMap<string, CountryLevel> {
  let known = levels.get(world);
  if (known) return known;
  const map = new Map<string, CountryLevel>();
  const leagues = world.domesticLeagues ?? [];
  const playersOf = (clubIds: readonly string[]) => clubIds.flatMap(id => world.clubs.find(club => club.id === id)?.players ?? []);
  for (const top of leagues.filter(league => league.tier === 1)) {
    const second = leagues.find(league => league.tier === 2 && league.country === top.country);
    if (!second || map.has(top.country)) continue;
    const rows = playersOf(top.clubIds).flatMap(player => { const wage = world.wages[player.id]; return wage === undefined ? [] : [{ rating: overallRating(player.attributes, player.position), wage }]; });
    const lower = playersOf(second.clubIds).map(player => overallRating(player.attributes, player.position)).sort((a, b) => a - b);
    if (!rows.length || !lower.length) continue;
    const highest = Math.max(...rows.map(row => row.rating)), rules = SECOND_DIVISION_RULES;
    const wages = Array.from({ length: 100 }, (_, rating) => {
      for (let width = rules.neighbourhood; ; width += 1) {
        const near = rows.filter(row => Math.abs(row.rating - Math.min(rating, highest)) <= width).map(row => row.wage);
        if (near.length) return Math.ceil(median(near) / 50_000) * 50_000;
      }
    });
    map.set(top.country, { threshold: lower[Math.min(lower.length - 1, Math.floor(rules.levelQuantile * lower.length))]!, wages });
  }
  levels.set(world, map);
  return map;
}

/** The level from which a player asks this country's second-division clubs top-division wages (null without one). */
export function secondDivisionThreshold(world: CareerWorld, country: string): number | null {
  return countryLevels(world).get(country)?.threshold ?? null;
}

/** The top-division wage of an overall rating in a country (null without the country's two divisions). */
export function topDivisionWage(world: CareerWorld, country: string, rating: number): number | null {
  return countryLevels(world).get(country)?.wages[Math.max(0, Math.min(99, Math.round(rating)))] ?? null;
}

/**
 * A club's own academy prospect signing his first contract (an academy promotion): before it, while he is still a
 * prospect of the club, and on the day of it, once graduated by promotion to this club. Exempt: the club promotes its own
 * youngster at his academy wage, and the answer must not change when he graduates (a graduate is rated with his academy
 * progress, a prospect without it), as the promotion's response is recorded just after his graduation.
 */
function ownAcademyPromotion(context: CareerPlayerContext, clubId: string, playerId: string): boolean {
  const academy = context.academy;
  if (!academy?.prospects.some(prospect => prospect.player.id === playerId && prospect.clubId === clubId)) return false;
  const graduate = academy.graduates.find(item => item.prospectId === playerId);
  return !graduate || graduate.kind === 'promotion' && graduate.clubId === clubId && graduate.graduatedOn === context.date;
}

/**
 * Format 109: a demand (euro cents) raised to the top-division wage of the player's level when the club is in a lower
 * division for the contract's season (the next season in the offseason) and the player is rated above its country's
 * second-division threshold; the demand unchanged otherwise and in older careers.
 */
export function secondDivisionDemand(context: CareerPlayerContext & Partial<Pick<SeasonState, 'status' | 'economySeasons'>>, clubId: string | undefined, playerId: string, demand: number): number {
  if (!clubId || !usesSecondDivisionBalance(context)) return demand;
  const year = context.seasonNumber === undefined ? undefined : context.status === 'complete' ? context.seasonNumber + 1 : context.seasonNumber;
  const band = clubEconomy(moneyAt(context, year), clubId)?.band;
  if (!band || !SECOND_DIVISION_RULES.lowerBands.includes(band)) return demand;
  const world = worldOf(context), country = clubCountry(world, clubId);
  const level = country ? countryLevels(world).get(country) : undefined;
  if (!level) return demand;
  if (ownAcademyPromotion(context, clubId, playerId)) return demand;
  const rating = nbaValue(context, playerId);
  if (rating <= level.threshold) return demand;
  const floor = level.wages[Math.max(0, Math.min(99, rating))]!;
  return floor > demand ? floor : demand;
}

/**
 * Format 109: the wage allocation within which a club may sign the cheap players (at most its minimum-squad wage) it
 * still needs for its minimum squad: its highest allocation for the season under any board verdict, plus the most extra
 * wage room surplus spending can give (the bound the save check holds every registration to). Higher asks at lower
 * divisions made it likelier that a relegated club had agreed wages above its fallen allocation (with board-verdict or
 * surplus room that has since gone) and then could sign nobody to reach eight players, which stopped the offseason.
 */
export function minimumSquadCeiling(context: SalaryBudgetContext, clubId: string, seasonNumber: number): number {
  const ceiling = Math.max(clubSalaryCeiling(context, clubId, seasonNumber), seasonSalaryCeiling(context, clubId, seasonNumber));
  return ceiling + (usesSurplusSpending(context) ? surplusWageCeiling(ceiling) : 0);
}
