import type { FinanceEntry, SeasonFinance } from '../domain/finance';
import { scopedCalculation } from './pure-cache';

/** Logical transaction positions are shared by staff, recruitment, facilities and historical reviews. */
export interface FinanceLedgerSource { readonly ledger: readonly FinanceEntry[] }

export function financeLedgerCount(finance: FinanceLedgerSource): number { return finance.ledger.length; }

/** Absolute, zero-based lookup; unlike Array.at, negative positions never refer to the end. */
export function financeLedgerEntry(finance: FinanceLedgerSource, index: number): FinanceEntry | undefined {
  return Number.isSafeInteger(index) && index >= 0 ? finance.ledger[index] : undefined;
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
    for (let index = from; index < to; index += 1) yield financeLedgerEntry(finance, index)!;
  })();
}

interface LedgerOrigin { source: FinanceLedgerSource; through: number }
const PREFIX_ORIGIN = Symbol('validation financial prefix origin');

function originInScope(finance: FinanceLedgerSource): LedgerOrigin | undefined {
  const through = financeLedgerCount(finance);
  // Length participates in the key because chronological replay may append to a local work array.
  return scopedCalculation(finance.ledger, PREFIX_ORIGIN, String(through), () => ({ source: finance, through }));
}

/** A fresh array, with ordinary slice isolation. Prefix provenance exists only inside a validation scope. */
export function financeLedgerSlice(finance: FinanceLedgerSource, from = 0, to = financeLedgerCount(finance)): FinanceEntry[] {
  checkRange(finance, from, to);
  const ledger = finance.ledger.slice(from, to);
  if (from === 0) {
    const origin = originInScope(finance);
    if (origin) scopedCalculation(ledger, PREFIX_ORIGIN, String(ledger.length), () => ({ source: origin.source, through: to }));
  }
  return ledger;
}

/** Keep the original absolute prefix: do not rebase staff/contract/board anchors or infer it from a date. */
export function financeAtLedgerBoundary(finance: SeasonFinance, count: number): SeasonFinance {
  return { ...finance, ledger: financeLedgerSlice(finance, 0, count) };
}

/** One source of sequential IDs and duplicate-event protection for both live commands and historical replay. */
export function appendFinanceLedgerEntry(finance: SeasonFinance, entry: Omit<FinanceEntry, 'id'>): SeasonFinance {
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
  const index = scopedCalculation(origin.source.ledger, namespace, String(financeLedgerCount(origin.source)), () => build(origin.source));
  return index === undefined ? undefined : { index, through: origin.through };
}
