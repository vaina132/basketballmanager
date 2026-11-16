import type { FinanceBalance } from '../domain/finance';
import type { PayrollCharge } from '../domain/payroll';
import { financeLedgerAmounts, financeLedgerEntries, financeLedgerPayrollCharges, scopedFinanceLedgerIndex, type FinanceLedgerSource } from './finance-ledger';

interface Point<T> { through: number; value: T }
interface ClubTotals extends FinanceBalance { net: number }
export interface LedgerPayrollTotals { gross: number; amount: number; discount: number; prepaid: boolean }
export type PayrollLedgerReader = (agreementId: string) => LedgerPayrollTotals;
const CLUB_TOTALS = Symbol('validation club financial prefixes');
const WAGE_TOTALS = Symbol('validation wage financial prefixes');
const emptyClub = (): ClubTotals => ({ cash: 0, unpaid: 0, net: 0 });
const emptyWage = (): LedgerPayrollTotals => ({ gross: 0, amount: 0, discount: 0, prepaid: false });
const wageTotalsCache = new WeakMap<FinanceLedgerSource, Map<string, LedgerPayrollTotals>>();

function addAmount(previous: ClubTotals, amount: number): ClubTotals {
  if (amount >= 0) {
    const settled = Math.min(previous.unpaid, amount);
    return { cash: previous.cash + amount - settled, unpaid: previous.unpaid - settled, net: previous.net + amount };
  }
  const paid = Math.min(previous.cash, -amount);
  return { cash: previous.cash - paid, unpaid: previous.unpaid - amount - paid, net: previous.net + amount };
}

/** Index positions, not dates: same-day payments must not become visible before their original command. */
function atBoundary<T>(points: readonly Point<T>[] | undefined, through: number): T | undefined {
  if (!points) return undefined;
  let low = 0, high = points.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (points[middle]!.through <= through) low = middle + 1; else high = middle;
  }
  return low ? points[low - 1]!.value : undefined;
}

function clubIndex(finance: FinanceLedgerSource): Map<string, Point<ClubTotals>[]> {
  const clubs = new Map<string, Point<ClubTotals>[]>();
  let through = 0;
  for (const row of financeLedgerEntries(finance)) {
    through += 1;
    const points = clubs.get(row.clubId) ?? [];
    points.push({ through, value: addAmount(points.at(-1)?.value ?? emptyClub(), row.amount) });
    clubs.set(row.clubId, points);
  }
  return clubs;
}

function clubTotals(finance: FinanceLedgerSource, clubId: string): ClubTotals {
  const scoped = scopedFinanceLedgerIndex(finance, CLUB_TOTALS, clubIndex);
  if (scoped) return atBoundary(scoped.index.get(clubId), scoped.through) ?? emptyClub();
  let totals = emptyClub();
  for (const amount of financeLedgerAmounts(finance, clubId)) totals = addAmount(totals, amount);
  return totals;
}

export function ledgerClubBalance(finance: FinanceLedgerSource, clubId: string): FinanceBalance {
  const { cash, unpaid } = clubTotals(finance, clubId);
  return { cash, unpaid };
}

export function ledgerClubNet(finance: FinanceLedgerSource, clubId: string): number { return clubTotals(finance, clubId).net; }

function wagesInCharge(charge: PayrollCharge): Map<string, LedgerPayrollTotals> {
  const wages = new Map<string, LedgerPayrollTotals>();
  for (const item of charge.items) {
    const previous = wages.get(item.agreementId) ?? emptyWage();
    wages.set(item.agreementId, { gross: previous.gross + item.gross, amount: previous.amount + item.amount,
      discount: previous.discount + item.discount, prepaid: charge.type === 'prepayment' });
  }
  return wages;
}

function addWages(previous: LedgerPayrollTotals, charge: LedgerPayrollTotals): LedgerPayrollTotals {
  return { gross: previous.gross + charge.gross, amount: previous.amount + charge.amount,
    discount: previous.discount + charge.discount, prepaid: previous.prepaid || charge.prepaid };
}

function wageIndex(finance: FinanceLedgerSource): Map<string, Point<LedgerPayrollTotals>[]> {
  const wages = new Map<string, Point<LedgerPayrollTotals>[]>();
  let through = 0;
  for (const row of financeLedgerEntries(finance)) {
    through += 1;
    if (!row.payroll) continue;
    for (const [id, charge] of wagesInCharge(row.payroll)) {
      const points = wages.get(id) ?? [];
      points.push({ through, value: addWages(points.at(-1)?.value ?? emptyWage(), charge) });
      wages.set(id, points);
    }
  }
  return wages;
}

/** One local reader can serve all players in a squad; only validation scopes retain reusable prefix indexes. */
export function payrollLedgerReader(finance: FinanceLedgerSource): PayrollLedgerReader {
  const scoped = scopedFinanceLedgerIndex(finance, WAGE_TOTALS, wageIndex);
  if (scoped) return id => ({ ...(atBoundary(scoped.index.get(id), scoped.through) ?? emptyWage()) });
  // Step 3.7: a finance record is replaced, never edited, so its wage totals are summed once (they were summed again for
  // every club and agreement asked about, many times a week in large worlds).
  let wages = wageTotalsCache.get(finance);
  if (!wages) {
    wages = new Map<string, LedgerPayrollTotals>();
    for (const payroll of financeLedgerPayrollCharges(finance)) {
      for (const [id, charge] of wagesInCharge(payroll)) wages.set(id, addWages(wages.get(id) ?? emptyWage(), charge));
    }
    wageTotalsCache.set(finance, wages);
  }
  const totals = wages;
  return id => ({ ...(totals.get(id) ?? emptyWage()) });
}
