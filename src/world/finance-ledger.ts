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
export function financeLedgerTicket(finance: FinanceLedgerSource, fixtureId: string): FinanceEntry['ticket'] {
  for (const block of finance.archives ?? []) for (const row of block.rows) {
    const ticket = row[5].ticket;
    if (ticket?.fixtureId === fixtureId) return ticket;
  }
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
  for (const block of finance.archives ?? []) for (const row of block.rows) {
    if (row[0] === entry.clubId && row[2] === entry.kind && row[4] === entry.sourceId) throw new Error('This financial event has already been recorded.');
  }
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
