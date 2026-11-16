import type { FinanceArchiveBlock, FinanceEntry, SeasonFinance } from '../domain/finance';
import type { PayrollCharge } from '../domain/payroll';
import { scopedCalculation } from './pure-cache';
import { expandFinanceArchiveRow, MAX_FINANCE_LOGICAL_ENTRIES, MAX_FINANCE_SEGMENT_ENTRIES } from './finance-archives';

/** Logical transaction positions are shared by staff, recruitment, facilities and historical reviews. */
export interface FinanceLedgerSource { readonly ledger: readonly FinanceEntry[]; readonly archives?: readonly FinanceArchiveBlock[] }

function archivedCount(finance: FinanceLedgerSource): number {
  const last = finance.archives?.at(-1);
  return last ? last.firstIndex + last.rows.length : 0;
}
export function financeLedgerCount(finance: FinanceLedgerSource): number { return archivedCount(finance) + finance.ledger.length; }

/** Absolute, zero-based lookup; unlike Array.at, negative positions never refer to the end. */
export function financeLedgerEntry(finance: FinanceLedgerSource, index: number): FinanceEntry | undefined {
  if (!Number.isSafeInteger(index) || index < 0) return undefined;
  const archived = archivedCount(finance);
  if (index >= archived) return finance.ledger[index - archived];
  const blocks = finance.archives!;
  let low = 0, high = blocks.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (blocks[middle]!.firstIndex <= index) low = middle + 1; else high = middle;
  }
  return expandFinanceArchiveRow(blocks[low - 1]!, index - blocks[low - 1]!.firstIndex);
}

function checkRange(finance: FinanceLedgerSource, from: number, to: number): void {
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || from > to || to > financeLedgerCount(finance)) {
    throw new Error('Choose a financial history boundary within the recorded transactions.');
  }
}

/** Ordered half-open range. Read-only consumers need not materialize a second complete ledger. */
export function financeLedgerEntries(finance: FinanceLedgerSource, from = 0, to = financeLedgerCount(finance)): IterableIterator<FinanceEntry> {
  checkRange(finance, from, to);
  return (function* () {
    for (const block of finance.archives ?? []) {
      const end = Math.min(block.rows.length, to - block.firstIndex);
      for (let index = Math.max(0, from - block.firstIndex); index < end; index += 1) yield expandFinanceArchiveRow(block, index);
      if (block.firstIndex + block.rows.length >= to) return;
    }
    const archived = archivedCount(finance);
    for (let index = Math.max(0, from - archived); index < to - archived; index += 1) yield finance.ledger[index]!;
  })();
}

// Step 3.7: completed seasons never change once archived (archive lists are replaced, never edited), so lookups over
// them are built once per archive list instead of reading every archived row again on each question; later seasons
// used to slow down with every season of history. The archived row and block counts guard against an edited list.
interface ArchiveIndexes { blocks: number; rows: number; values: Map<symbol, unknown> }
const archiveIndexes = new WeakMap<readonly FinanceArchiveBlock[], ArchiveIndexes>();

/**
 * A lookup over the archived seasons only (`build` receives a source holding just the archives), built once per archive
 * list and namespace. Undefined when nothing is archived. Callers treat the result as immutable.
 */
export function archivedFinanceIndex<T>(finance: FinanceLedgerSource, namespace: symbol, build: (archived: FinanceLedgerSource) => T): T | undefined {
  const blocks = finance.archives;
  if (!blocks?.length) return undefined;
  const rows = archivedCount(finance);
  let known = archiveIndexes.get(blocks);
  if (!known || known.blocks !== blocks.length || known.rows !== rows) { known = { blocks: blocks.length, rows, values: new Map() }; archiveIndexes.set(blocks, known); }
  if (!known.values.has(namespace)) known.values.set(namespace, build({ ledger: [], archives: blocks }));
  return known.values.get(namespace) as T;
}

const ARCHIVED_EVENTS = Symbol('archived financial events');
function archivedEvents(finance: FinanceLedgerSource): Map<string, Map<string, Set<string>>> | undefined {
  return archivedFinanceIndex(finance, ARCHIVED_EVENTS, archived => {
    const events = new Map<string, Map<string, Set<string>>>();
    for (const entry of financeLedgerEntries(archived)) {
      let kinds = events.get(entry.clubId);
      if (!kinds) { kinds = new Map(); events.set(entry.clubId, kinds); }
      let sources = kinds.get(entry.kind);
      if (!sources) { sources = new Set(); kinds.set(entry.kind, sources); }
      sources.add(entry.sourceId);
    }
    return events;
  });
}

/** Whether the club's event of this kind and source is already recorded anywhere in the logical ledger. */
export function financeLedgerHasEvent(finance: FinanceLedgerSource, clubId: string, kind: FinanceEntry['kind'], sourceId: string): boolean {
  if (archivedEvents(finance)?.get(clubId)?.get(kind)?.has(sourceId)) return true;
  for (const entry of finance.ledger) if (entry.clubId === clubId && entry.kind === kind && entry.sourceId === sourceId) return true;
  return false;
}

/** Hot accounting reads borrow the retained values directly; they need no reconstructed transaction objects. */
export function* financeLedgerAmounts(finance: FinanceLedgerSource, clubId: string): IterableIterator<number> {
  for (const block of finance.archives ?? []) for (const row of block.rows) if (row[0] === clubId) yield row[3];
  for (const row of finance.ledger) if (row.clubId === clubId) yield row.amount;
}

/** Includes zero-value and empty-item charges in their original order. Payloads are read-only borrowed data. */
export function* financeLedgerPayrollCharges(finance: FinanceLedgerSource): IterableIterator<PayrollCharge> {
  for (const block of finance.archives ?? []) for (const row of block.rows) if (row[5].payroll) yield row[5].payroll;
  for (const row of finance.ledger) if (row.payroll) yield row.payroll;
}

/** Ticket-price previews repeatedly ask for the same fixture; scan retained payloads without expanding rows. */
const ARCHIVED_TICKETS = Symbol('archived tickets');
export function financeLedgerTicket(finance: FinanceLedgerSource, fixtureId: string): FinanceEntry['ticket'] {
  // The first archived ticket of each fixture, as the full scan found it.
  const archived = archivedFinanceIndex(finance, ARCHIVED_TICKETS, source => {
    const tickets = new Map<string, NonNullable<FinanceEntry['ticket']>>();
    for (const block of source.archives ?? []) for (const row of block.rows) {
      const ticket = row[5].ticket;
      if (ticket && !tickets.has(ticket.fixtureId)) tickets.set(ticket.fixtureId, ticket);
    }
    return tickets;
  });
  const ticket = archived?.get(fixtureId);
  if (ticket) return ticket;
  for (const row of finance.ledger) if (row.ticket?.fixtureId === fixtureId) return row.ticket;
  return null;
}

interface LedgerOrigin { source: FinanceLedgerSource; through: number }
const PREFIX_ORIGIN = Symbol('validation financial prefix origin');

function originInScope(finance: FinanceLedgerSource): LedgerOrigin | undefined {
  const through = financeLedgerCount(finance);
  // Length participates in the key because chronological replay may append to a local work array.
  return scopedCalculation(finance.archives?.length ? finance : finance.ledger, PREFIX_ORIGIN, String(through), () => ({ source: finance, through }));
}

/** A fresh array, with ordinary slice isolation. Prefix provenance exists only inside a validation scope. */
export function financeLedgerSlice(finance: FinanceLedgerSource, from = 0, to = financeLedgerCount(finance)): FinanceEntry[] {
  checkRange(finance, from, to);
  const ledger = finance.archives?.length ? Array.from(financeLedgerEntries(finance, from, to)) : finance.ledger.slice(from, to);
  if (from === 0) {
    const origin = originInScope(finance);
    if (origin) scopedCalculation(ledger, PREFIX_ORIGIN, String(ledger.length), () => ({ source: origin.source, through: to }));
  }
  return ledger;
}

/** Keep the original absolute prefix: do not rebase staff/contract/board anchors or infer it from a date. */
export function financeAtLedgerBoundary(finance: SeasonFinance, count: number): SeasonFinance {
  const { archives: _archives, ...active } = finance;
  return { ...active, ledger: financeLedgerSlice(finance, 0, count) };
}

/** One source of sequential IDs and duplicate-event protection for both live commands and historical replay. */
export function appendFinanceLedgerEntry(finance: SeasonFinance, entry: Omit<FinanceEntry, 'id'>): SeasonFinance {
  // Strict replay may hold a temporary flat prefix spanning many archived seasons. Bound the season being
  // appended, not that prefix's total length; the stored active-tail limit is checked separately on save/load.
  let seasonEntries = 0;
  for (let index = finance.ledger.length - 1; index >= 0 && finance.ledger[index]!.seasonNumber === entry.seasonNumber; index -= 1) seasonEntries += 1;
  if (seasonEntries >= MAX_FINANCE_SEGMENT_ENTRIES || financeLedgerCount(finance) >= MAX_FINANCE_LOGICAL_ENTRIES) throw new Error('This career has reached the supported financial history limit.');
  const last = finance.archives?.at(-1);
  if (last && entry.seasonNumber <= last.seasonNumber) throw new Error('Completed financial seasons cannot receive new transactions.');
  if (archivedEvents(finance)?.get(entry.clubId)?.get(entry.kind)?.has(entry.sourceId)) throw new Error('This financial event has already been recorded.');
  for (const previous of finance.ledger) {
    if (previous.clubId === entry.clubId && previous.kind === entry.kind && previous.sourceId === entry.sourceId) {
      throw new Error('This financial event has already been recorded.');
    }
  }
  return { ...finance, ledger: [...finance.ledger, { ...entry, id: `finance-${financeLedgerCount(finance) + 1}` }] };
}

/**
 * Read indexes may share the original log across fresh prefix arrays within one synchronous validation only.
 * The index is derived evidence, never an acceptance verdict; callers cannot retain a cached proof between loads.
 */
export function scopedFinanceLedgerIndex<T>(finance: FinanceLedgerSource, namespace: symbol, build: (source: FinanceLedgerSource) => T): { index: T; through: number } | undefined {
  const origin = originInScope(finance);
  if (!origin) return undefined;
  const index = scopedCalculation(origin.source.archives?.length ? origin.source : origin.source.ledger, namespace, String(financeLedgerCount(origin.source)), () => build(origin.source));
  return index === undefined ? undefined : { index, through: origin.through };
}
