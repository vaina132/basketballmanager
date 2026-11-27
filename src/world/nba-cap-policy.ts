import type { EmploymentContract, SeasonEmployment } from '../domain/employment';
import type { MarketOffer } from '../domain/market';
import type { SeasonFixture, SeasonState } from '../domain/season';
import type { CareerWorld, WorldContext } from '../domain/world';
import { isNbaClub, nbaClubIds, seasonRounds } from './career-world';
import { isCapClub } from './club-roster-policy';
import { clubContractsForRound, clubContractsForSeason, contractForSeason } from './employment-policy';
import { addMarketDays, getLiveMarketOffers, MARKET_WINDOW_DAYS } from './market-policy';
import { dateForRound } from './season';
import { centsToUsd, NBA_CAP_RULES, NBA_FIRST_APRON, NBA_SALARY_CAP, NBA_TAX_LINE, nbaLuxuryTax, nbaMaximumWage, nbaMidLevel, nbaMinimumWage, nbaSigningRoute, nbaTaxShare, type NbaCapRoute } from './nba-cap';
import { getCareerPlayerAge, type CareerPlayerContext } from './player-catalog';
import { nbaOwnerCeiling } from './nba-owner';

/**
 * NBA step 6 (format 92): the salary cap guards every NBA club shares (the manager's club and computer clubs alike), the
 * owner's payroll ceiling, and the luxury tax due at the end of the regular season. Only worlds with `world.nba.cap`
 * use them; every European club and every older career keeps its rules exactly.
 */
/** Whether a career's world uses the NBA's money rules. */
export const usesNbaCap = (context: WorldContext): boolean => context.world?.nba?.cap === 'nba-cap-1';

export { NBA_OWNER_RULES, nbaOwnerCeiling, nbaOwnerCeilingLevel, type NbaOwnerCeiling } from './nba-owner';

/** Salary still counted against the cap for players this club released (bought out) for a season: every released term covering it. */
export function nbaDeadMoney(employment: Pick<SeasonEmployment, 'contracts' | 'buyouts'>, clubId: string, seasonNumber: number): number {
  const released = new Set((employment.buyouts ?? []).filter(buyout => buyout.clubId === clubId && buyout.startsSeason <= seasonNumber).flatMap(buyout => buyout.releasedContractIds));
  if (!released.size) return 0;
  return employment.contracts.filter(contract => released.has(contract.id) && contract.startsSeason <= seasonNumber && contract.endsSeason >= seasonNumber).reduce((sum, contract) => sum + contract.seasonWage, 0);
}

/** A club's cap payroll for a season: its contracts in force at the season's end (or at `round`) plus released salary. */
export function nbaPayroll(state: Pick<SeasonState, 'employment'>, clubId: string, seasonNumber: number, round?: number): number {
  const contracts: readonly EmploymentContract[] = round === undefined ? clubContractsForSeason(state.employment, clubId, seasonNumber) : clubContractsForRound(state.employment, seasonNumber, round, clubId);
  return contracts.reduce((sum, contract) => sum + contract.seasonWage, 0) + nbaDeadMoney(state.employment, clubId, seasonNumber);
}

/** Whether the club's mid-level exception for a season is used (a signed contract) or held (an open offer other than `excludeOfferId`). */
export function nbaMidLevelUsed(state: Pick<SeasonState, 'employment' | 'seasonNumber'> & { market?: SeasonState['market'] }, clubId: string, seasonNumber: number, excludeOfferId?: string): boolean {
  if (state.employment.contracts.some(contract => contract.clubId === clubId && contract.capRoute === 'mle' && contract.startsSeason === seasonNumber)) return true;
  return getLiveMarketOffers(state).some((offer: MarketOffer) => offer.clubId === clubId && offer.id !== excludeOfferId && offer.capRoute === 'mle' && offer.seasonNumber + 1 === seasonNumber);
}

/** A player's age for contract limits: on the given date (the signing day). */
const ageOn = (context: CareerPlayerContext, playerId: string, date: string | undefined): number | null => date ? getCareerPlayerAge(context, playerId, date) : null;

export interface NbaSigningCheck { route: NbaCapRoute | null; reason: string | null; minimum: number; maximum: number }

/**
 * The cap check of one NBA signing for `seasonNumber` (format 92): the wage within the player's minimum and maximum
 * contract, then a legal route (room under the cap, a minimum contract, re-signing the club's own player, or the
 * season's one mid-level exception). `payrollBefore` already holds the club's contracts, its other open offers for
 * that season and released salary. In-season signings (`inSeason`) may use room or a minimum contract only.
 */
export function nbaSigningCheck(state: CareerPlayerContext & Pick<SeasonState, 'employment' | 'seasonNumber'> & { market?: SeasonState['market']; date?: string }, input: { clubId: string; playerId: string; seasonWage: number; seasonNumber: number; payrollBefore: number; excludeOfferId?: string; inSeason?: boolean }): NbaSigningCheck {
  const age = ageOn(state, input.playerId, state.date);
  const minimum = nbaMinimumWage(age), maximum = nbaMaximumWage(age);
  const result = (route: NbaCapRoute | null, reason: string | null): NbaSigningCheck => ({ route, reason, minimum, maximum });
  if (input.seasonWage < minimum) return result(null, `An NAL contract pays at least the player's minimum salary (${euros(minimum)} a season at his experience).`);
  if (input.seasonWage > maximum) return result(null, `An NAL maximum contract for a player of his age is ${euros(maximum)} a season.`);
  const own = clubContractsForSeason(state.employment, input.clubId, state.seasonNumber).some(contract => contract.playerId === input.playerId);
  const midLevelUsed = input.inSeason || nbaMidLevelUsed(state, input.clubId, input.seasonNumber, input.excludeOfferId);
  const route = nbaSigningRoute({ payrollBefore: input.payrollBefore, seasonWage: input.seasonWage, minimum, ownPlayer: own && !input.inSeason, midLevelUsed });
  if (route) return result(route, null);
  const after = input.payrollBefore + input.seasonWage;
  if (input.inSeason) return result(null, `Over the salary cap (${euros(NBA_SALARY_CAP)}), a club signs free agents during the season only on minimum contracts.`);
  return result(null, `This signing takes the payroll over the salary cap (${euros(NBA_SALARY_CAP)}). Over the cap a club may sign only minimum contracts, re-sign its own players, or use its mid-level exception once a season${midLevelUsed ? ' (already used this season)' : ` (up to ${euros(nbaMidLevel(after))})`}.`);
}

const euros = (cents: number): string => `€${(Math.round(cents / 100_000) / 10).toLocaleString('en-GB', { maximumFractionDigits: 1 })}M`;

/** The NBA's last regular-season week this season: the week of its last regular-season game (null without the NBA or its games). */
export function nbaRegularSeasonEndRound(state: Pick<SeasonState, 'fixtures'> & WorldContext): number | null {
  const world = state.world;
  if (!world?.nba) return null;
  const clubs = nbaClubIds(world);
  let last: number | null = null;
  for (const fixture of state.fixtures as readonly SeasonFixture[]) if (!fixture.stage && !fixture.competition && clubs.has(fixture.homeClubId)) last = last === null ? fixture.round : Math.max(last, fixture.round);
  return last;
}

export interface NbaTaxBill { clubId: string; payroll: number; tax: number }
/**
 * The luxury tax of a season (format 92): each NBA club's cap payroll at the end of its regular season (contracts in
 * force in the NBA's last regular-season week plus released salary), the tax on it, and the equal share each club that
 * paid none receives.
 */
export function nbaTaxBills(state: Pick<SeasonState, 'employment' | 'fixtures' | 'seasonNumber'> & WorldContext, round: number): { bills: NbaTaxBill[]; total: number; share: number; receivers: string[] } {
  const world = state.world!;
  const clubs = [...nbaClubIds(world)].filter(clubId => isNbaClub(world, clubId));
  const bills = clubs.map(clubId => { const payroll = nbaPayroll(state, clubId, state.seasonNumber, round); return { clubId, payroll, tax: nbaLuxuryTax(payroll) }; });
  const total = bills.reduce((sum, bill) => sum + bill.tax, 0), receivers = bills.filter(bill => bill.tax === 0).map(bill => bill.clubId);
  return { bills, total, share: nbaTaxShare(total, receivers.length), receivers };
}

/** The cap sheet figures of one NBA club for a season (format 92), for Squad > Contracts. */
export interface NbaCapSheet {
  payroll: number; deadMoney: number; cap: number; taxLine: number; firstApron: number; ceiling: number;
  room: number; midLevelUsed: boolean; midLevel: number; taxDue: number; roster: number; minRoster: number; maxRoster: number;
}
export function nbaCapSheet(state: SeasonState, clubId: string, seasonNumber: number): NbaCapSheet | null {
  if (!isCapClub(state, clubId)) return null;
  const payroll = nbaPayroll(state, clubId, seasonNumber), deadMoney = nbaDeadMoney(state.employment, clubId, seasonNumber);
  return {
    payroll, deadMoney, cap: NBA_SALARY_CAP, taxLine: NBA_TAX_LINE, firstApron: NBA_FIRST_APRON, ceiling: nbaOwnerCeiling(state.world!, clubId),
    room: Math.max(0, NBA_SALARY_CAP - payroll), midLevelUsed: nbaMidLevelUsed(state, clubId, seasonNumber), midLevel: nbaMidLevel(payroll),
    taxDue: nbaLuxuryTax(payroll), roster: clubContractsForSeason(state.employment, clubId, seasonNumber).length, minRoster: NBA_CAP_RULES.roster.min, maxRoster: NBA_CAP_RULES.roster.max,
  };
}

/**
 * Format 92: why an NBA club cannot sign this player during the season (rest-of-season free agents and in-season
 * transfers): only room under the cap or a minimum contract, no mid-level exception or Bird rights. Null when legal or
 * when the club is not an NBA club under the cap rules.
 */
export function nbaInSeasonReason(state: SeasonState, clubId: string, playerId: string, seasonWage: number, reservedWages: number): string | null {
  if (!isCapClub(state, clubId)) return null;
  return nbaSigningCheck(state, { clubId, playerId, seasonWage, seasonNumber: state.seasonNumber, payrollBefore: nbaPayroll(state, clubId, state.seasonNumber, state.round) + reservedWages, inSeason: true }).reason;
}

/** [E] Free agents still unsigned in the last days of the offseason take the minimum salary from any club (as in the NBA, where late free agents sign veteran minimum deals). */
export const NBA_LATE_FREE_AGENCY_DAYS = 7;

/**
 * Format 92: the minimum salary a free agent accepts late in free agency, or null when his usual demand applies. In a
 * world with the NBA's money rules, a player without a contract for next season asks only his minimum salary (when that
 * is below his usual demand) from `NBA_LATE_FREE_AGENCY_DAYS` days before recruitment closes. Depends only on the
 * career's date, its season and the player's contracts, so a save's replay decides it the same way.
 */
export function nbaLateFreeAgentMinimum(context: CareerPlayerContext & { employment?: SeasonState['employment']; status?: SeasonState['status'] }, playerId: string): number | null {
  if (!usesNbaCap(context) || context.status !== 'complete' || !context.employment || context.seasonNumber === undefined || !context.date) return null;
  // The offseason window opens on the season's last week and lasts `MARKET_WINDOW_DAYS` (as the market and its replay know it).
  const closesOn = addMarketDays(dateForRound(seasonRounds(context), context.seasonNumber), MARKET_WINDOW_DAYS);
  if (context.date < addMarketDays(closesOn, -NBA_LATE_FREE_AGENCY_DAYS) || contractForSeason(context.employment, playerId, context.seasonNumber + 1)) return null;
  return nbaMinimumWage(getCareerPlayerAge(context, playerId, context.date));
}

/** Dollars for a cap figure (the NBA's own currency), for notes and tests. */
export const capUsd = (cents: number): number => Math.round(centsToUsd(cents));
