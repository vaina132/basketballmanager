import type { SeasonState } from '../domain/season';
import { clubEconomy, knownMoneySeason, moneyAt, playerBillOf } from './economy';
import { ECONOMY_BALANCE_RULES, usesEconomyBalance } from './economy-balance';
import { remainingSeasonShortfall } from './facilities-policy';
import { getSpendablePosition } from './payroll-policy';
import { getClubContractSummary, MIN_ROSTER_SIZE } from './employment-policy';

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
 * Format 87: the most a club run automatically (a computer club, or the manager's club with delegated recruitment)
 * agrees in player wages for `seasonNumber` while its cash is low: `fullShare` of the wage bill that season's known
 * figures fund, less `recovery` of the shortfall of its projected season-end cash below `targetCashShare` of its budget,
 * never below `floorShare` of that bill (cents, in EUR 500 steps). Null when no cap applies: careers without the economy
 * balance, clubs without researched money, and clubs whose projected cash reaches the target.
 */
export function automaticWageCap(state: SeasonState, clubId: string, seasonNumber: number, share = projectedCashShare(state, clubId)): number | null {
  if (!usesEconomyBalance(state) || share === null) return null;
  const rules = ECONOMY_BALANCE_RULES.wageCap;
  if (share >= rules.targetCashShare) return null;
  const money = clubEconomy(moneyAt(state, Math.min(seasonNumber, knownMoneySeason(state, seasonNumber))), clubId);
  if (!money) return null;
  const bill = (money as { playerBill?: number }).playerBill ?? playerBillOf(money);
  const cap = Math.max(bill * rules.floorShare, bill * rules.fullShare - rules.recovery * (rules.targetCashShare - share) * money.budget);
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
    share ??= projectedCashShare(state, clubId);
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
