import type { SeasonState } from '../domain/season';
import { clubEconomy, knownMoneySeason, moneyAt, playerBillOf } from './economy';
import { ECONOMY_BALANCE_RULES, usesEconomyBalance } from './economy-balance';
import { remainingSeasonShortfall } from './facilities-policy';
import { getSpendablePosition } from './payroll-policy';
import { getClubContractSummary, MIN_ROSTER_SIZE } from './employment-policy';
import { lastSeasonResult, SPENDING_BALANCE_RULES, usesSpendingBalance } from './spending-balance';

/**
 * Format 87 (`ECONOMY_BALANCE_RULES.wageCap`): a club's projected cash at the end of the current season as a share of
 * its season budget: its spendable position now (cash less unpaid costs, wages, staff salaries, transfer fees and loan
 * payments still owed this season) less what the rest of the season still needs beyond its cautious gate (the same
 * projection automatic facility spending keeps). Null without researched club money.
 */
export function projectedCashShare(state: SeasonState, clubId: string): number | null {
  const economy = clubEconomy(state, clubId);
  if (!economy || economy.budget <= 0) return null;
  return (getSpendablePosition(state, clubId) - remainingSeasonShortfall(state, clubId)) / economy.budget;
}

/** Format 89: whether the low-cash wage limit for `seasonNumber`'s wages looks ahead (a season after the one being played). */
function looksAhead(state: SeasonState, seasonNumber: number): boolean {
  return usesSpendingBalance(state) && (state.status === 'complete' || seasonNumber > state.seasonNumber);
}

/**
 * The cash share the low-cash wage limit reads for `seasonNumber`'s wages (`automaticWageCap`): the projected season-end
 * share (`projectedCashShare`). With the format-89 spending balance, wages of a later season than the one being played
 * (every signing in the offseason, and the later years of an in-season contract) look one season ahead: the share is
 * lowered by the club's loss in the latest completed season (a gain is not counted), as the next season may go as that
 * one did. Null without researched club money.
 */
export function wageCapCashShare(state: SeasonState, clubId: string, seasonNumber = state.seasonNumber + 1): number | null {
  const share = projectedCashShare(state, clubId);
  if (share === null || !looksAhead(state, seasonNumber)) return share;
  const result = lastSeasonResult(state, clubId);
  return result === null || result >= 0 ? share : share + result / clubEconomy(state, clubId)!.budget;
}

/**
 * The share of the budget below which the low-cash wage limit acts for `seasonNumber`'s wages: `targetCashShare` (10%);
 * with the format-89 spending balance, `SPENDING_BALANCE_RULES.wageCapTargetShare` (15%) for the wages of a later season
 * than the one being played (the look-ahead), so a club slows its wages before a bad season. The current season's wages
 * keep 10% (its cash projection is exact; a 15% start held back computer clubs' in-season bids for listed players).
 */
export function wageCapTarget(state: SeasonState, seasonNumber = state.seasonNumber + 1): number {
  return looksAhead(state, seasonNumber) ? SPENDING_BALANCE_RULES.wageCapTargetShare : ECONOMY_BALANCE_RULES.wageCap.targetCashShare;
}

/**
 * Format 87: the most a club run automatically (a computer club, or the manager's club with delegated recruitment)
 * agrees in player wages for `seasonNumber` while its cash is low: `fullShare` of the wage bill that season's known
 * figures fund, less `recovery` of the shortfall of its projected season-end cash below `targetCashShare` of its budget,
 * never below `floorShare` of that bill (cents, in EUR 500 steps). Null when no cap applies: careers without the economy
 * balance, clubs without researched money, and clubs whose projected cash reaches the target.
 */
export function automaticWageCap(state: SeasonState, clubId: string, seasonNumber: number, share = wageCapCashShare(state, clubId, seasonNumber)): number | null {
  if (!usesEconomyBalance(state) || share === null) return null;
  const rules = ECONOMY_BALANCE_RULES.wageCap;
  // Format 89: the look-ahead limit for a later season acts from a higher share (`wageCapTarget`).
  const target = wageCapTarget(state, seasonNumber);
  if (share >= target) return null;
  const money = clubEconomy(moneyAt(state, Math.min(seasonNumber, knownMoneySeason(state, seasonNumber))), clubId);
  if (!money) return null;
  const bill = (money as { playerBill?: number }).playerBill ?? playerBillOf(money);
  const cap = Math.max(bill * rules.floorShare, bill * rules.fullShare - rules.recovery * (target - share) * money.budget);
  return Math.floor(cap / 50_000) * 50_000;
}

/**
 * Format 87: a check for the contracts a club run automatically may still offer at this unchanged moment: whether a
 * season wage over `seasons` seasons from `startsSeason` keeps every covered season's agreed and reserved player wages
 * within `automaticWageCap`. A signing the club still needs for the eight-player minimum squad of a season always
 * passes, so the cap never stops a club fielding a team. Always true in careers without the economy balance.
 */
export function automaticWageCheck(state: SeasonState, clubId: string): (seasonWage: number, seasons: number, startsSeason: number) => boolean {
  if (!usesEconomyBalance(state)) return () => true;
  const shares = new Map<boolean, number | null>();
  const rooms = new Map<number, number | null>();
  const roomFor = (year: number): number | null => {
    if (rooms.has(year)) return rooms.get(year)!;
    // One reading for the current season and one for the seasons after it (format 89 looks ahead for those).
    const ahead = looksAhead(state, year);
    if (!shares.has(ahead)) shares.set(ahead, wageCapCashShare(state, clubId, year));
    const cap = automaticWageCap(state, clubId, year, shares.get(ahead)!);
    let room: number | null = null;
    if (cap !== null) {
      const summary = getClubContractSummary(state, clubId, year);
      room = summary.rosterSize + summary.reservedRosterSize < MIN_ROSTER_SIZE ? null : cap - summary.seasonWages - summary.reservedWages;
    }
    rooms.set(year, room);
    return room;
  };
  return (seasonWage, seasons, startsSeason) => {
    for (let year = startsSeason; year < startsSeason + seasons; year += 1) {
      const room = roomFor(year);
      if (room !== null && seasonWage > room) return false;
    }
    return true;
  };
}
