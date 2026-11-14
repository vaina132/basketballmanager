import type { FinanceEntry } from '../domain/finance';
import { roundKey } from '../world/career-world';
import { cachedCalculation } from '../world/pure-cache';

const LEDGER_BOUNDARIES = Symbol('validation ledger boundaries');

export interface LedgerBoundaryIndex {
  /** Latest calendar value strictly before each ledger offset. */
  prefixLatest: Float64Array;
  /** Earliest calendar value at or after each ledger offset. */
  suffixEarliest: Float64Array;
  /** First and last committed matchday rows, excluding discretionary salary prepayments. */
  commits: ReadonlyMap<number, { first: number; last: number }>;
}

/**
 * One index per ledger during a validation call. Min/max preserves the original all-row comparisons even before
 * chronology has been validated: a misplaced earlier or later row cannot disappear behind a binary search.
 * Outside a calculation scope this rebuilds, so mutable caller-owned data never leaves a persistent cached proof.
 */
export function ledgerBoundaryIndex(ledger: readonly FinanceEntry[]): LedgerBoundaryIndex {
  return cachedCalculation(ledger, LEDGER_BOUNDARIES, '', () => {
    const prefixLatest = new Float64Array(ledger.length + 1), suffixEarliest = new Float64Array(ledger.length + 1);
    const commits = new Map<number, { first: number; last: number }>();
    prefixLatest[0] = -Infinity;
    for (let index = 0; index < ledger.length; index += 1) {
      const entry = ledger[index]!, boundary = roundKey(entry.seasonNumber, entry.round);
      // Comparisons intentionally match the old scanner; malformed non-numeric dates receive the full shape checks.
      prefixLatest[index + 1] = boundary > prefixLatest[index]! ? boundary : prefixLatest[index]!;
      if (entry.kind === 'tickets' || entry.kind === 'operations' || entry.kind === 'payroll' && entry.payroll?.type === 'installment') {
        const previous = commits.get(boundary);
        commits.set(boundary, { first: previous?.first ?? index, last: index });
      }
    }
    suffixEarliest[ledger.length] = Infinity;
    for (let index = ledger.length - 1; index >= 0; index -= 1) {
      const entry = ledger[index]!, boundary = roundKey(entry.seasonNumber, entry.round);
      suffixEarliest[index] = boundary < suffixEarliest[index + 1]! ? boundary : suffixEarliest[index + 1]!;
    }
    return { prefixLatest, suffixEarliest, commits };
  });
}
