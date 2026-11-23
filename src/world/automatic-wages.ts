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

/**
 * The cash share the low-cash wage limit reads (`automaticWageCap`): the projected season-end share
 * (`projectedCashShare`); with the format-89 spending balance it looks one season ahead, lowered by the club's loss in
 * the latest completed season (a gain is not counted), as the next season may go as that one did. Null without
 * researched club money.
 */
export function wageCapCashShare(state: SeasonState, clubId: string): number | null {
  const share = projectedCashShare(state, clubId);
  if (share === null || !usesSpendingBalance(state)) return share;
  const result = lastSeasonResult(state, clubId);
  return result === null || result >= 0 ? share : share + result / clubEconomy(state, clubId)!.budget;
}

/**
 * Format 87: the most a club run automatically (a computer club, or the manager's club with delegated recruitment)
 * agrees in player wages for `seasonNumber` while its cash is low: `fullShare` of the wage bill that season's known
 * figures fund, less `recovery` of the shortfall of its projected season-end cash below `targetCashShare` of its budget,
 * never below `floorShare` of that bill (cents, in EUR 500 steps). Null when no cap applies: careers without the economy
 * balance, clubs without researched money, and clubs whose projected cash reaches the target.
 */
export function automaticWageCap(state: SeasonState, clubId: string, seasonNumber: number, share = wageCapCashShare(state, clubId)): number | null {
  if (!usesEconomyBalance(state) || share === null) return null;
  const rules = ECONOMY_BALANCE_RULES.wageCap;
  // Format 89: the look-ahead limit acts from a higher share (`SPENDING_BALANCE_RULES.wageCapTargetShare`).
  const target = usesSpendingBalance(state) ? SPENDING_BALANCE_RULES.wageCapTargetShare : rules.targetCashShare;
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
  let share: number | null | undefined;
  const rooms = new Map<number, number | null>();
  const roomFor = (year: number): number | null => {
    if (rooms.has(year)) return rooms.get(year)!;
    share ??= wageCapCashShare(state, clubId);
    const cap = automaticWageCap(state, clubId, year, share);
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
