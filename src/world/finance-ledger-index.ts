import type { FinanceBalance, FinanceEntry } from '../domain/finance';
import type { PayrollCharge } from '../domain/payroll';
import { archivedFinanceIndex, financeLedgerCount, financeLedgerEntries, scopedFinanceLedgerIndex, type FinanceLedgerSource } from './finance-ledger';
import { scopedCalculation } from './pure-cache';

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
 * Inside a calculation scope (`withCalculationCache`) inputs may have been edited since an earlier batch, so there only
 * folds made in the same scope are reused: the first reading of a ledger in each scope folds it afresh. Outside scopes
 * ledgers are replaced, never edited, and every fold is reused.
 */
interface LedgerFold<T> { ledger: readonly FinanceEntry[]; length: number; start: unknown; values: ReadonlyMap<string, T>; scope: object | undefined }
const FOLD_SCOPE_OWNER = {}, FOLD_SCOPE = Symbol('ledger fold calculation scope');
function ledgerFold<T>(add: (values: Map<string, T>, entry: FinanceEntry, start: unknown) => void): (ledger: readonly FinanceEntry[], start: unknown) => ReadonlyMap<string, T> {
  const known = new WeakMap<readonly FinanceEntry[], LedgerFold<T>>();
  let recent: LedgerFold<T>[] = [];
  const extendsFold = (ledger: readonly FinanceEntry[], fold: LedgerFold<T>) => {
    if (fold.length > ledger.length) return false;
    for (let index = fold.length - 1; index >= 0; index -= 1) if (ledger[index] !== fold.ledger[index]) return false;
    return true;
  };
  return (ledger, start) => {
    // One token per calculation scope (undefined outside scopes).
    const scope = scopedCalculation(FOLD_SCOPE_OWNER, FOLD_SCOPE, '', () => ({}));
    const usable = (fold: LedgerFold<T>) => !scope || fold.scope === scope;
    const cached = known.get(ledger);
    if (cached && usable(cached) && cached.length === ledger.length && cached.start === start) return cached.values;
    let base: LedgerFold<T> | undefined;
    for (const fold of recent) if (usable(fold) && fold.start === start && (!base || fold.length > base.length) && extendsFold(ledger, fold)) base = fold;
    const values = new Map(base?.values);
    for (let index = base?.length ?? 0; index < ledger.length; index += 1) add(values, ledger[index]!, start);
    const fold: LedgerFold<T> = { ledger, length: ledger.length, start, values, scope };
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

/** One staff appointment as its ledger entry records it (format 76: amount 0, the person in the entry's details). */
export interface StaffAppointmentEvidence { kind: FinanceEntry['kind']; contractId: string; personId: string; round: number }
type StaffEvidence = number | readonly StaffAppointmentEvidence[];
function appointmentPerson(row: FinanceEntry): { contractId: string; personId: string } | undefined {
  switch (row.kind) {
    case 'coaching': return row.coach ? { contractId: row.coach.contractId, personId: row.coach.coachId } : undefined;
    case 'scouting': return row.scout ? { contractId: row.scout.contractId, personId: row.scout.scoutId } : undefined;
    case 'fitness': return row.fitness ? { contractId: row.fitness.contractId, personId: row.fitness.coachId } : undefined;
    case 'physio': return row.physio ? { contractId: row.physio.contractId, personId: row.physio.physioId } : undefined;
    case 'assistant': return row.assistant ? { contractId: row.assistant.contractId, personId: row.assistant.assistantId } : undefined;
    case 'youth': return row.youth ? { contractId: row.youth.contractId, personId: row.youth.coachId } : undefined;
    default: return undefined;
  }
}
/**
 * Format 76 (`coaching-4`): the staff money evidence of a ledger, read by the staff salary reserve. Keys: `a` + season +
 * club for the season's appointments in ledger order, `c` + season + club + compensation source for the week of an
 * early release, and `w` + season for the last week whose staff salaries were paid (any club). Values are never edited
 * (folds share them), so an appointment list is copied when it grows.
 */
const activeStaffEvidence = ledgerFold<StaffEvidence>((values, row) => {
  if (row.kind === 'staff-wages') {
    const key = `w\u0000${row.seasonNumber}`;
    if (row.round > ((values.get(key) as number | undefined) ?? 0)) values.set(key, row.round);
  } else if (row.kind === 'staff-compensation') values.set(`c\u0000${row.seasonNumber}\u0000${row.clubId}\u0000${row.sourceId}`, row.round);
  else {
    const person = appointmentPerson(row);
    if (!person) return;
    const key = `a\u0000${row.seasonNumber}\u0000${row.clubId}`;
    values.set(key, [...((values.get(key) as readonly StaffAppointmentEvidence[] | undefined) ?? []), { kind: row.kind, ...person, round: row.round }]);
  }
});
export interface StaffLedgerEvidence {
  /** A club's appointments booked in a season, in ledger order. */
  appointments: (seasonNumber: number, clubId: string) => readonly StaffAppointmentEvidence[];
  /** The week of a booked compensation (an early release), if any. */
  releasedRound: (seasonNumber: number, clubId: string, sourceId: string) => number | undefined;
  /** The last week of the season whose staff salaries were paid (0 before the first). */
  paidThrough: (seasonNumber: number) => number;
}
/**
 * Read from the ledger alone, so a ledger cut at a past decision (strict replays, even of earlier seasons whose staff
 * contracts are no longer kept) gives that moment's evidence. A live ledger holds the current season in its active part.
 */
export function staffLedgerEvidence(finance: FinanceLedgerSource): StaffLedgerEvidence {
  const values = activeStaffEvidence(finance.ledger, undefined);
  return {
    appointments: (seasonNumber, clubId) => (values.get(`a\u0000${seasonNumber}\u0000${clubId}`) as readonly StaffAppointmentEvidence[] | undefined) ?? [],
    releasedRound: (seasonNumber, clubId, sourceId) => values.get(`c\u0000${seasonNumber}\u0000${clubId}\u0000${sourceId}`) as number | undefined,
    paidThrough: seasonNumber => (values.get(`w\u0000${seasonNumber}`) as number | undefined) ?? 0,
  };
}
