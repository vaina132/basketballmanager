import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseSeason, serializeSeasonCompact, validateSeasonState } from '../src/storage/season-storage';
import { financeAtLedgerBoundary, financeLedgerCount, financeLedgerEntry } from '../src/world/finance-ledger';
import { getFinanceBalance } from '../src/world/finance';
import { payrollLedgerReader } from '../src/world/finance-ledger-index';
import { withCalculationCache } from '../src/world/pure-cache';
import { currentSeasonFile } from './helpers/season-format';

let original;
beforeAll(() => {
  const text = gunzipSync(readFileSync(new URL('./fixtures/season42-board-career-next.json.gz', import.meta.url))).toString('utf8');
  original = parseSeason(text);
}, 120_000);

describe('absolute financial boundaries in strict saves', () => {
  it('keeps later same-day fees and salary charges out of a staff hiring prefix', () => {
    const contract = original.scouts.contracts[0], position = contract.hiredLedgerIndex;
    const fee = financeLedgerEntry(original.finance, position);
    expect(fee.kind).toBe('scouting');
    expect(fee.clubId).toBe(contract.clubId);
    const futureCharge = original.finance.ledger.find((row, index) => index > position && row.clubId === contract.clubId && row.seasonNumber === fee.seasonNumber && row.round === fee.round);
    expect(futureCharge).toBeDefined();
    const prepaid = original.finance.ledger.find((row, index) => index < position && row.payroll?.type === 'prepayment');
    expect(prepaid).toBeDefined();
    const item = prepaid.payroll.items[0];
    withCalculationCache(() => {
      const before = financeAtLedgerBoundary(original.finance, position), after = financeAtLedgerBoundary(original.finance, position + 1);
      const total = original.finance.ledger.slice(0, position).filter(row => row.clubId === contract.clubId).reduce((sum, row) => sum + row.amount, 0);
      expect(getFinanceBalance(before, contract.clubId)).toEqual({ cash: Math.max(0, total), unpaid: Math.max(0, -total) });
      expect(getFinanceBalance(after, contract.clubId).cash).toBe(getFinanceBalance(before, contract.clubId).cash + fee.amount);
      expect(payrollLedgerReader(before)(item.agreementId)).toEqual({ gross: item.gross, amount: item.amount, discount: item.discount, prepaid: true });
      expect(financeLedgerCount(before)).toBe(position);
      expect(financeLedgerEntry(before, position)).toBeUndefined();
    });
  });

  it.each([
    ['staff fee moved to another same-day row', state => { state.scouts.contracts[0].hiredLedgerIndex += 1; }],
    ['facility payment moved past its approval', state => { state.facilities.events.find(event => event.type === 'start').ledgerIndex += 1; }],
    ['board review before its last mandatory payment', state => { state.board.reviews[0].ledgerCount -= 1; }],
    ['payroll activation before opening funds', state => { state.payroll.enabledSince.ledgerIndex = 0; }],
  ])('rechecks %s after the same state was already accepted', (_label, damage) => {
    const changed = structuredClone(original);
    validateSeasonState(changed);
    damage(changed);
    expect(() => validateSeasonState(changed)).toThrow();
    expect(() => parseSeason(currentSeasonFile(changed))).toThrow();
  });

  it('does not retain future-prefix facts or acceptance after original payment evidence changes', () => {
    const changed = structuredClone(original), staff = changed.scouts.contracts[0];
    const fee = financeLedgerEntry(changed.finance, staff.hiredLedgerIndex), amount = fee.amount;
    validateSeasonState(changed);
    fee.amount += 1;
    expect(() => validateSeasonState(changed)).toThrow();
    fee.amount = amount;
    expect(() => validateSeasonState(changed)).not.toThrow();
    const before = JSON.stringify(changed);
    expect(parseSeason(serializeSeasonCompact(changed))).toEqual(changed);
    expect(JSON.stringify(changed)).toBe(before);
  });
});
