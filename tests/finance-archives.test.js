import { restoreSeniorDetail } from './helpers/senior-reference';
import { SEASON_SCHEMA_VERSION } from './helpers/season-format';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseSeason, serializeSeasonCompact, validateSeasonState } from '../src/storage/season-storage';
import { expandFinanceForValidation } from '../src/storage/finance-archive-validation';
import { archiveCompletedFinance, MAX_FINANCE_LOGICAL_ENTRIES, MAX_FINANCE_SEGMENT_ENTRIES } from '../src/world/finance-archives';
import { appendFinanceLedgerEntry, financeAtLedgerBoundary, financeLedgerAmounts, financeLedgerCount, financeLedgerEntries, financeLedgerEntry, financeLedgerPayrollCharges, financeLedgerSlice, financeLedgerTicket } from '../src/world/finance-ledger';
import { getFinanceBalance, financeLedgerRows } from '../src/world/finance';
import { payrollLedgerReader } from '../src/world/finance-ledger-index';
import { withCalculationCache } from '../src/world/pure-cache';
import { rolloverSeason } from '../src/world/season';
import { currentSeasonFile } from './helpers/season-format';

const originalText = name => gunzipSync(readFileSync(new URL(`./fixtures/season43-board-${name}.json.gz`, import.meta.url))).toString('utf8');
let original, migrated;
beforeAll(() => { original = JSON.parse(originalText('opening')).state; migrated = parseSeason(originalText('opening')); });

describe('lossless completed-season financial archives', () => {
  it('migrates a genuine old save without changing a single logical transaction or other retained field', () => {
    expect(original.schemaVersion).toBe(43);
    expect(migrated.schemaVersion).toBe(SEASON_SCHEMA_VERSION);
    expect(migrated.finance.archives).toHaveLength(1);
    expect(migrated.finance.archives[0]).toMatchObject({ model: 'finance-archive-1', firstIndex: 0, seasonNumber: 1 });
    expect(migrated.finance.ledger.every(row => row.seasonNumber === 2)).toBe(true);
    expect(financeLedgerSlice(migrated.finance)).toEqual(original.finance.ledger);
    const { archives: _archives, ...finance } = migrated.finance;
    expect({ ...restoreSeniorDetail(migrated, original), schemaVersion: 43, finance: { ...finance, ledger: financeLedgerSlice(migrated.finance) } }).toEqual(original);
    expect(JSON.stringify(migrated.finance).length).toBeLessThan(JSON.stringify(original.finance).length);
    expect(parseSeason(serializeSeasonCompact(migrated))).toEqual(migrated);
  });

  it('archives only after the offseason closes and generates the independently captured next opening', () => {
    const complete = parseSeason(originalText('complete'));
    expect(complete.finance.archives).toBeUndefined();
    const next = rolloverSeason(complete);
    expect(next).toEqual(migrated);
    expect(financeLedgerCount(next.finance)).toBe(original.finance.ledger.length);
    expect(next.finance.archives[0].rows).toHaveLength(complete.finance.ledger.length);
    expect(complete.finance.archives).toBeUndefined();
  });

  it('preserves every original prefix, zero payroll marker, cash transition and absolute lookup', () => {
    const source = original.finance.ledger;
    expect(source.some(row => row.kind === 'payroll' && row.amount === 0)).toBe(true);
    withCalculationCache(() => {
      for (let end = 0; end <= source.length; end += 1) {
        const prefix = financeAtLedgerBoundary(migrated.finance, end), old = { ...original.finance, ledger: source.slice(0, end) };
        expect(prefix.archives).toBeUndefined();
        expect(prefix.ledger).toEqual(old.ledger);
        const nowWages = payrollLedgerReader(prefix), oldWages = payrollLedgerReader(old);
        for (const club of original.clubs) expect(getFinanceBalance(prefix, club.id)).toEqual(getFinanceBalance(old, club.id));
        for (const agreement of original.payroll.agreements) expect(nowWages(agreement.id)).toEqual(oldWages(agreement.id));
        expect(financeLedgerEntry(migrated.finance, end)).toEqual(source[end]);
      }
    });
    for (const club of original.clubs) expect(financeLedgerRows(migrated.finance, club.id)).toEqual(financeLedgerRows(original.finance, club.id));
    const boundary = migrated.finance.archives[0].rows.length;
    expect([...financeLedgerEntries(migrated.finance, boundary - 1, boundary + 1)]).toEqual(source.slice(boundary - 1, boundary + 1));
    expect([...financeLedgerEntries(migrated.finance, boundary, boundary)]).toEqual([]);
    expect(financeLedgerEntry(migrated.finance, -1)).toBeUndefined();
    expect(financeLedgerEntry(migrated.finance, 0.5)).toBeUndefined();
  });

  it('appends immutable absolute IDs and rejects duplicate events even when their original row is archived', () => {
    const source = structuredClone(migrated.finance), before = structuredClone(source), old = original.finance.ledger[0];
    const { id: _id, ...entry } = old;
    expect(() => appendFinanceLedgerEntry(source, { ...entry, seasonNumber: 2 })).toThrow(/already/);
    expect(() => appendFinanceLedgerEntry(source, { ...entry, sourceId: 'new' })).toThrow(/completed/i);
    const next = appendFinanceLedgerEntry(source, { ...entry, seasonNumber: 2, sourceId: 'new' });
    expect(next.ledger.at(-1).id).toBe(`finance-${original.finance.ledger.length + 1}`);
    expect(next.archives).toBe(source.archives);
    expect(source).toEqual(before);
  });

  it('does not conflate two archived prefixes sharing the same active tail in a calculation scope', () => {
    const a = structuredClone(migrated.finance), b = { ...a, archives: structuredClone(a.archives) };
    const row = b.archives[0].rows.find(row => row[0] === original.managedClubId && row[3] > 0);
    row[3] += 123;
    withCalculationCache(() => {
      expect(getFinanceBalance(b, original.managedClubId).cash - getFinanceBalance(a, original.managedClubId).cash).toBe(123);
      expect(financeAtLedgerBoundary(a, 1).ledger).toEqual(original.finance.ledger.slice(0, 1));
    });
  });

  it('reads accounting values and gate payloads directly without losing older, zero, or unknown records', () => {
    const expected = original.finance.ledger, finance = structuredClone(migrated.finance);
    expect([...financeLedgerPayrollCharges(finance)]).toEqual(expected.filter(row => row.payroll).map(row => row.payroll));
    const reader = payrollLedgerReader(finance), oldReader = payrollLedgerReader(original.finance);
    for (const agreement of original.payroll.agreements) expect(reader(agreement.id)).toEqual(oldReader(agreement.id));
    for (const club of [...original.clubs.map(club => club.id), 'missing']) {
      expect([...financeLedgerAmounts(finance, club)]).toEqual(expected.filter(row => row.clubId === club).map(row => row.amount));
      expect(getFinanceBalance(finance, club)).toEqual(getFinanceBalance(original.finance, club));
    }
    for (const row of expected) if (row.ticket) expect(financeLedgerTicket(finance, row.ticket.fixtureId)).toEqual(row.ticket);
    expect(financeLedgerTicket(finance, 'not-booked')).toBeNull();
    // No lifetime cache can conceal changes between reads, including old payloads that lack capacity metadata.
    const stored = finance.archives[0].rows.find(row => row[5].ticket)[5].ticket;
    stored.capacity = 9999;
    expect(financeLedgerTicket(finance, stored.fixtureId).capacity).toBe(9999);
    delete stored.capacity;
    expect(financeLedgerTicket(finance, stored.fixtureId).capacity).toBeUndefined();
  });

  it.each([
    ['unknown block field', state => { state.finance.archives[0].extra = true; }],
    ['unknown block model', state => { state.finance.archives[0].model = 'finance-archive-2'; }],
    ['shifted absolute offset', state => { state.finance.archives[0].firstIndex += 1; }],
    ['active-season block', state => { state.finance.archives[0].seasonNumber = state.seasonNumber; }],
    ['duplicate block', state => { state.finance.archives.push(structuredClone(state.finance.archives[0])); }],
    ['missing row', state => { state.finance.archives[0].rows.splice(20, 1); }],
    ['reordered rows', state => { state.finance.archives[0].rows.reverse(); }],
    ['changed amount', state => { state.finance.archives[0].rows[0][3] += 1; }],
    ['changed source', state => { state.finance.archives[0].rows[0][4] = 'invented-source'; }],
    ['overridden ID', state => { state.finance.archives[0].rows[0][5].id = 'finance-1'; }],
    ['extra tuple value', state => { state.finance.archives[0].rows[0].push(1); }],
    ['implicit null stored twice', state => { state.finance.archives[0].rows[0][5].payroll = null; }],
    ['damaged payroll item', state => { state.finance.archives[0].rows.find(row => row[5].payroll?.items.length)[5].payroll.items[0].gross += 1; }],
    ['lost zero payroll marker', state => { const rows = state.finance.archives[0].rows; rows.splice(rows.findIndex(row => row[2] === 'payroll' && row[3] === 0), 1); }],
    ['shifted staff anchor', state => { state.scouts.contracts[0].hiredLedgerIndex += 1; }],
    ['old season in active tail', state => { state.finance.ledger[0].seasonNumber = 1; }],
  ])('strictly rejects %s even after accepting the same object', (_name, damage) => {
    const state = structuredClone(migrated);
    validateSeasonState(state);
    damage(state);
    expect(() => validateSeasonState(state)).toThrow();
    expect(() => parseSeason(currentSeasonFile(state))).toThrow();
  });

  it('does not allow archives to bypass the original format-43 validation', () => {
    const envelope = JSON.parse(originalText('opening'));
    envelope.state.finance = structuredClone(migrated.finance);
    expect(() => parseSeason(JSON.stringify(envelope))).toThrow();
  });
});

// Representation/resource checks, not a claim of a simulated 20,001-row career.
describe('bounded financial archive expansion', () => {
  const row = (i, year) => ({ id: `finance-${i + 1}`, clubId: 'a', seasonNumber: year, round: 1, kind: 'operations', amount: -100,
    sourceId: `source-${i}`, ticket: null, coach: null, payroll: null });
  const flat = count => ({ model: 'finance-1', enabledSince: { seasonNumber: 1, round: 1 }, plans: {}, roundPrices: {},
    ledger: Array.from({ length: count }, (_, i) => row(i, i < 15_000 ? 1 : 2)) });
  it('keeps all 20,001 rows across blocks while preserving the 20,000 active-tail guard', () => {
    const source = flat(20_001), finance = archiveCompletedFinance(source, 2);
    expect(finance.ledger).toHaveLength(5001);
    expect(financeLedgerCount(finance)).toBe(20_001);
    expect(expandFinanceForValidation(finance, 2).ledger).toEqual(source.ledger);
    expect(financeLedgerSlice(finance, 14999, 15001)).toEqual(source.ledger.slice(14999, 15001));
    expect(() => expandFinanceForValidation(source, 2)).toThrow(/active ledger/);
    const replay = expandFinanceForValidation(finance, 2);
    expect(appendFinanceLedgerEntry(replay, { ...row(20_001, 2), sourceId: 'new' }).ledger.at(-1).id).toBe('finance-20002');
    const full = flat(MAX_FINANCE_SEGMENT_ENTRIES);
    full.ledger = full.ledger.map(row => ({ ...row, seasonNumber: 2 }));
    expect(() => appendFinanceLedgerEntry(full, { ...row(20_000, 2), sourceId: 'new' })).toThrow(/limit/);
  });
  it('bounds individual blocks, their count, and the combined reconstructed transactions before allocation', () => {
    const finance = archiveCompletedFinance(flat(1), 2), block = finance.archives[0], one = block.rows[0];
    expect(() => expandFinanceForValidation({ ...finance, archives: [{ ...block, rows: Array(20_001).fill(one) }] }, 2)).toThrow();
    expect(() => expandFinanceForValidation({ ...finance, archives: Array(101).fill(block) }, 102)).toThrow();
    const rows = Array(20_000).fill(one), blocks = Array.from({ length: 10 }, (_, i) => ({ ...block, seasonNumber: i + 1, firstIndex: i * 20_000, rows }));
    expect(MAX_FINANCE_LOGICAL_ENTRIES).toBe(200_000);
    expect(() => expandFinanceForValidation({ ...finance, archives: blocks, ledger: [row(200_000, 11)] }, 11)).toThrow(/expansion limit/);
  });
});
