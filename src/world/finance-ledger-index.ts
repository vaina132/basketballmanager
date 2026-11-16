import type { FinanceBalance, FinanceEntry } from '../domain/finance';
import type { PayrollCharge } from '../domain/payroll';
import { archivedFinanceIndex, financeLedgerCount, financeLedgerEntries, scopedFinanceLedgerIndex, type FinanceLedgerSource } from './finance-ledger';

interface Point<T> { through: number; value: T }
interface ClubTotals extends FinanceBalance { net: number }
export interface LedgerPayrollTotals { gross: number; amount: number; discount: number; prepaid: boolean }
export type PayrollLedgerReader = (agreementId: string) => LedgerPayrollTotals;
const CLUB_TOTALS = Symbol('validation club financial prefixes');
const WAGE_TOTALS = Symbol('validation wage financial prefixes');
const emptyClub = (): ClubTotals => ({ cash: 0, unpaid: 0, net: 0 });
const emptyWage = (): LedgerPayrollTotals => ({ gross: 0, amount: 0, discount: 0, prepaid: false });
const ARCHIVED_CLUB_POINTS = Symbol('archived club financial prefixes');
const ARCHIVED_WAGE_POINTS = Symbol('archived wage prefixes');

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

// Step 3.7: running values at each ledger position. Archived seasons come first in ledger order and never change, so their
// points are built once per archive list and the active seasons continue from each key's last archived value (same
// order, same result); calculation scopes and quick reads no longer re-read every archived season.
interface PrefixIndex<T> { archived: ReadonlyMap<string, readonly Point<T>[]> | undefined; active: Map<string, Point<T>[]> }
function prefixValue<T>(index: PrefixIndex<T>, key: string, through: number): T | undefined {
  return atBoundary(index.active.get(key), through) ?? atBoundary(index.archived?.get(key), through);
}
const lastValue = <T>(points: readonly Point<T>[] | undefined): T | undefined => points?.[points.length - 1]?.value;
const activeStart = (finance: FinanceLedgerSource) => financeLedgerCount(finance) - finance.ledger.length;

function clubPoints(entries: Iterable<FinanceEntry>, through: number, before: (clubId: string) => ClubTotals | undefined): Map<string, Point<ClubTotals>[]> {
  const clubs = new Map<string, Point<ClubTotals>[]>();
  for (const row of entries) {
    through += 1;
    let points = clubs.get(row.clubId);
    if (!points) { points = []; clubs.set(row.clubId, points); }
    points.push({ through, value: addAmount(lastValue(points) ?? before(row.clubId) ?? emptyClub(), row.amount) });
  }
  return clubs;
}
const archivedClubPoints = (finance: FinanceLedgerSource) => archivedFinanceIndex(finance, ARCHIVED_CLUB_POINTS, source => clubPoints(financeLedgerEntries(source), 0, () => undefined));

function clubIndex(finance: FinanceLedgerSource): PrefixIndex<ClubTotals> {
  const archived = archivedClubPoints(finance);
  return { archived, active: clubPoints(finance.ledger, activeStart(finance), clubId => lastValue(archived?.get(clubId))) };
}

/**
 * Step 3.7: a per-key fold over an active ledger, worked out once per ledger array (and start). Ledgers grow by copying
 * (`[...ledger, entry]`), so a new array that begins with exactly the entries of a recently folded one (same objects, in
 * order) continues from that fold instead of reading the season again; the result equals a fold from the start. The
 * value maps are shared: callers must not change them.
 */
interface LedgerFold<T> { ledger: readonly FinanceEntry[]; length: number; start: unknown; values: ReadonlyMap<string, T> }
function ledgerFold<T>(add: (values: Map<string, T>, entry: FinanceEntry, start: unknown) => void): (ledger: readonly FinanceEntry[], start: unknown) => ReadonlyMap<string, T> {
  const known = new WeakMap<readonly FinanceEntry[], LedgerFold<T>>();
  let recent: LedgerFold<T>[] = [];
  const extendsFold = (ledger: readonly FinanceEntry[], fold: LedgerFold<T>) => {
    if (fold.length > ledger.length) return false;
    for (let index = fold.length - 1; index >= 0; index -= 1) if (ledger[index] !== fold.ledger[index]) return false;
    return true;
  };
  return (ledger, start) => {
    const cached = known.get(ledger);
    if (cached && cached.length === ledger.length && cached.start === start) return cached.values;
    let base: LedgerFold<T> | undefined;
    for (const fold of recent) if (fold.start === start && (!base || fold.length > base.length) && extendsFold(ledger, fold)) base = fold;
    const values = new Map(base?.values);
    for (let index = base?.length ?? 0; index < ledger.length; index += 1) add(values, ledger[index]!, start);
    const fold: LedgerFold<T> = { ledger, length: ledger.length, start, values };
    known.set(ledger, fold);
    recent = [...recent.filter(item => item.ledger !== ledger).slice(-3), fold];
    return values;
  };
}

type ArchivedClubPoints = ReturnType<typeof archivedClubPoints>;
const activeClubTotals = ledgerFold<ClubTotals>((values, row, archived) => {
  values.set(row.clubId, addAmount(values.get(row.clubId) ?? lastValue((archived as ArchivedClubPoints)?.get(row.clubId)) ?? emptyClub(), row.amount));
});

function clubTotals(finance: FinanceLedgerSource, clubId: string): ClubTotals {
  const scoped = scopedFinanceLedgerIndex(finance, CLUB_TOTALS, clubIndex, true);
  if (scoped) return prefixValue(scoped.index, clubId, scoped.through) ?? emptyClub();
  // Each club's active totals continue from its last archived value (archived seasons come first in ledger order).
  const archived = archivedClubPoints(finance);
  return activeClubTotals(finance.ledger, archived).get(clubId) ?? lastValue(archived?.get(clubId)) ?? emptyClub();
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

function wagePoints(entries: Iterable<FinanceEntry>, through: number, before: (agreementId: string) => LedgerPayrollTotals | undefined): Map<string, Point<LedgerPayrollTotals>[]> {
  const wages = new Map<string, Point<LedgerPayrollTotals>[]>();
  for (const row of entries) {
    through += 1;
    if (!row.payroll) continue;
    for (const [id, charge] of wagesInCharge(row.payroll)) {
      let points = wages.get(id);
      if (!points) { points = []; wages.set(id, points); }
      points.push({ through, value: addWages(lastValue(points) ?? before(id) ?? emptyWage(), charge) });
    }
  }
  return wages;
}
const archivedWagePoints = (finance: FinanceLedgerSource) => archivedFinanceIndex(finance, ARCHIVED_WAGE_POINTS, source => wagePoints(financeLedgerEntries(source), 0, () => undefined));

function wageIndex(finance: FinanceLedgerSource): PrefixIndex<LedgerPayrollTotals> {
  const archived = archivedWagePoints(finance);
  return { archived, active: wagePoints(finance.ledger, activeStart(finance), id => lastValue(archived?.get(id))) };
}

/** One local reader can serve all players in a squad; only validation scopes retain reusable prefix indexes. */
export function payrollLedgerReader(finance: FinanceLedgerSource): PayrollLedgerReader {
  const scoped = scopedFinanceLedgerIndex(finance, WAGE_TOTALS, wageIndex, true);
  if (scoped) return id => ({ ...(prefixValue(scoped.index, id, scoped.through) ?? emptyWage()) });
  // Step 3.7: wage totals are summed once per ledger (they were summed again for every club and agreement asked about,
  // many times a week in large worlds). Archived seasons' totals come from their last points; sums and the prepaid flag
  // combine in any order.
  const archived = archivedWagePoints(finance), totals = activeWageTotals(finance.ledger, undefined);
  if (!archived?.size) return id => ({ ...(totals.get(id) ?? emptyWage()) });
  return id => {
    const old = lastValue(archived.get(id)), active = totals.get(id);
    return old && active ? addWages(old, active) : { ...(old ?? active ?? emptyWage()) };
  };
}

const activeWageTotals = ledgerFold<LedgerPayrollTotals>((wages, row) => {
  if (row.payroll) for (const [id, charge] of wagesInCharge(row.payroll)) wages.set(id, addWages(wages.get(id) ?? emptyWage(), charge));
});
