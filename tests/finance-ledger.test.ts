import { describe, expect, it } from 'vitest';
import type { FinanceEntry, SeasonFinance } from '../src/domain/finance';
import { appendFinanceLedgerEntry, financeAtLedgerBoundary, financeLedgerCount, financeLedgerEntries, financeLedgerEntry, financeLedgerSlice } from '../src/world/finance-ledger';

const row = (index: number, clubId = 'club-a', kind: FinanceEntry['kind'] = 'operations'): FinanceEntry => ({ id: `finance-${index}`, clubId, seasonNumber: 1, round: 1, kind, amount: -100, sourceId: `source-${index}`, ticket: null, coach: null, payroll: null });
const makeFinance = (ledger: FinanceEntry[] = [row(1), row(2, 'club-b'), row(3)]): SeasonFinance => ({ model: 'finance-1', enabledSince: { seasonNumber: 1, round: 1 }, plans: { 'club-a': { delegated: false, price: 1800 } }, roundPrices: { 'club-a': 1800 }, ledger });
const freeze = <T>(value: T): T => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };

describe('absolute financial ledger access', () => {
  it('counts and reads absolute positions without treating negative or invalid indexes as array offsets', () => {
    const finance = freeze(makeFinance());
    expect(financeLedgerCount(finance)).toBe(3);
    expect(financeLedgerEntry(finance, 0)).toBe(finance.ledger[0]);
    expect(financeLedgerEntry(finance, 2)).toBe(finance.ledger[2]);
    for (const index of [-1, 3, 100, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) expect(financeLedgerEntry(finance, index)).toBeUndefined();
    expect(financeLedgerCount(makeFinance([]))).toBe(0);
    expect(financeLedgerEntry(makeFinance([]), 0)).toBeUndefined();
  });

  it('iterates ordered half-open ranges with exact empty boundaries and default endpoints', () => {
    const finance = freeze(makeFinance());
    expect([...financeLedgerEntries(finance)]).toEqual(finance.ledger);
    expect([...financeLedgerEntries(finance, 1)]).toEqual(finance.ledger.slice(1));
    expect([...financeLedgerEntries(finance, 1, 2)]).toEqual([finance.ledger[1]]);
    expect([...financeLedgerEntries(finance, 0, 0)]).toEqual([]);
    expect([...financeLedgerEntries(finance, 3, 3)]).toEqual([]);
    expect([...financeLedgerEntries(makeFinance([]))]).toEqual([]);
  });

  it.each([[-1, 1], [0, 4], [2, 1], [0.5, 2], [0, 1.5], [NaN, 2], [0, Infinity], [0, Number.MAX_SAFE_INTEGER + 1]])('rejects invalid interval %s..%s without silently clamping it', (from, to) => {
    const finance = makeFinance();
    expect(() => financeLedgerEntries(finance, from, to)).toThrow(/boundary/i);
    expect(() => financeLedgerSlice(finance, from, to)).toThrow(/boundary/i);
  });

  it('materializes fresh arrays while preserving transaction identity, order and source isolation', () => {
    const finance = freeze(makeFinance());
    const one = financeLedgerSlice(finance), two = financeLedgerSlice(finance);
    expect(one).toEqual(finance.ledger);
    expect(one).not.toBe(finance.ledger);
    expect(two).not.toBe(one);
    expect(one[0]).toBe(finance.ledger[0]);
    one.reverse();
    one.pop();
    expect(two).toEqual(finance.ledger);
    expect(finance.ledger.map(entry => entry.id)).toEqual(['finance-1', 'finance-2', 'finance-3']);
  });

  it('creates exact financial prefixes without rebasing IDs or changing current plans', () => {
    const finance = freeze(makeFinance()), snapshot = structuredClone(finance);
    for (let end = 0; end <= 3; end += 1) {
      const prefix = financeAtLedgerBoundary(finance, end);
      expect(prefix).toEqual({ ...finance, ledger: finance.ledger.slice(0, end) });
      expect(prefix).not.toBe(finance);
      expect(prefix.ledger).not.toBe(finance.ledger);
      expect(prefix.plans).toBe(finance.plans);
      expect(prefix.roundPrices).toBe(finance.roundPrices);
    }
    for (const end of [-1, 4, 1.5, NaN, Infinity]) expect(() => financeAtLedgerBoundary(finance, end)).toThrow(/boundary/i);
    expect(finance).toEqual(snapshot);
  });

  it('appends one sequential entry without mutating its source or requested transaction', () => {
    const finance = freeze(makeFinance()), { id: _id, ...entry } = row(4);
    freeze(entry);
    const appended = appendFinanceLedgerEntry(finance, entry);
    expect(appended).toEqual({ ...finance, ledger: [...finance.ledger, { ...entry, id: 'finance-4' }] });
    expect(financeLedgerCount(finance)).toBe(3);
    expect(Object.hasOwn(entry, 'id')).toBe(false);
    expect(appended.ledger).not.toBe(finance.ledger);
    expect(appendFinanceLedgerEntry(makeFinance([]), entry).ledger[0]?.id).toBe('finance-1');
  });

  it('rejects a repeated club/kind/source event while allowing different clubs and kinds', () => {
    const finance = freeze(makeFinance()), { id: _id, ...duplicate } = finance.ledger[0]!;
    expect(() => appendFinanceLedgerEntry(finance, { ...duplicate, amount: -500 })).toThrow('This financial event has already been recorded.');
    expect(appendFinanceLedgerEntry(finance, { ...duplicate, clubId: 'club-b' }).ledger.at(-1)).toMatchObject({ clubId: 'club-b', id: 'finance-4' });
    expect(appendFinanceLedgerEntry(finance, { ...duplicate, kind: 'tickets' }).ledger.at(-1)).toMatchObject({ kind: 'tickets', id: 'finance-4' });
  });
});
