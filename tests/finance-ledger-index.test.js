import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseSeason } from '../src/storage/season-storage';
import { financeAtLedgerBoundary, financeLedgerCount, financeLedgerSlice } from '../src/world/finance-ledger';
import { ledgerClubBalance, ledgerClubNet, payrollLedgerReader } from '../src/world/finance-ledger-index';
import { getFinanceBalance, financeLedgerRows } from '../src/world/finance';
import { agreementCommitted, isAgreementPrepaid, payrollInstallment } from '../src/world/payroll-policy';
import { withCalculationCache } from '../src/world/pure-cache';

const empty = ledger => ({ model: 'finance-1', enabledSince: { seasonNumber: 1, round: 1 }, plans: {}, roundPrices: {}, ledger });
const row = (index, clubId, amount, payroll = null) => ({ id: `finance-${index}`, clubId, kind: payroll ? 'payroll' : amount >= 0 ? 'sponsor' : 'operations', amount, sourceId: `source-${index}`, seasonNumber: 1, round: 1, ticket: null, coach: null, payroll });
const charge = (type, agreementId, gross, discount = 0) => ({ type, fromRound: 1, throughRound: type === 'prepayment' ? 10 : 1, items: [{ agreementId, playerId: agreementId, gross, discount, amount: gross - discount }] });
const sample = () => empty([row(1, 'a', 100), row(2, 'b', 200), row(3, 'a', -130), row(4, 'a', -20, charge('installment', 'wage-a', 20)), row(5, 'a', 40), row(6, 'b', -95, charge('prepayment', 'wage-b', 100, 5)), row(7, 'a', 0, { type: 'installment', fromRound: 1, throughRound: 1, items: [] }), row(8, 'a', 70), row(9, 'a', -57, charge('prepayment', 'wage-a', 60, 3))]);
const freeze = value => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };

// Original exhaustive rules, independent of the proposed ledger adapter/index.
function oldBalance(ledger, clubId) {
  return ledger.filter(entry => entry.clubId === clubId).reduce((balance, entry) => {
    if (entry.amount >= 0) { const settled = Math.min(balance.unpaid, entry.amount); return { cash: balance.cash + entry.amount - settled, unpaid: balance.unpaid - settled }; }
    const paid = Math.min(balance.cash, -entry.amount);
    return { cash: balance.cash - paid, unpaid: balance.unpaid - entry.amount - paid };
  }, { cash: 0, unpaid: 0 });
}
function oldWages(ledger, id) {
  const items = ledger.flatMap(entry => entry.payroll?.items.filter(item => item.agreementId === id) ?? []);
  return { gross: items.reduce((sum, item) => sum + item.gross, 0), amount: items.reduce((sum, item) => sum + item.amount, 0), discount: items.reduce((sum, item) => sum + item.discount, 0), prepaid: ledger.some(entry => entry.payroll?.type === 'prepayment' && entry.payroll.items.some(item => item.agreementId === id)) };
}
function check(finance, clubs, agreements) {
  const reader = payrollLedgerReader(finance);
  for (const club of clubs) {
    expect(ledgerClubBalance(finance, club)).toEqual(oldBalance(finance.ledger, club));
    expect(getFinanceBalance(finance, club)).toEqual(oldBalance(finance.ledger, club));
    expect(ledgerClubNet(finance, club)).toBe(finance.ledger.filter(entry => entry.clubId === club).reduce((sum, entry) => sum + entry.amount, 0));
  }
  for (const id of agreements) { expect(reader(id)).toEqual(oldWages(finance.ledger, id)); expect(isAgreementPrepaid(id, finance.ledger)).toBe(oldWages(finance.ledger, id).prepaid); }
}
let genuine;
beforeAll(() => { genuine = parseSeason(gunzipSync(readFileSync(new URL('./fixtures/season42-board-opening.json.gz', import.meta.url))).toString('utf8')); }, 120_000);

describe('validation-scoped financial prefix accounting', () => {
  it('matches old scans at every boundary with debt, mixed clubs, installments, prepayment and empty payroll rows', () => {
    const finance = freeze(sample()), before = structuredClone(finance);
    for (const scoped of [false, true]) {
      const run = () => { for (let end = 0; end <= finance.ledger.length; end += 1) check(financeAtLedgerBoundary(finance, end), ['a', 'b', 'missing'], ['wage-a', 'wage-b', 'unknown']); };
      if (scoped) withCalculationCache(run); else run();
    }
    expect(ledgerClubBalance(financeAtLedgerBoundary(finance, 4), 'a')).toEqual({ cash: 0, unpaid: 50 });
    expect(ledgerClubBalance(finance, 'a')).toEqual({ cash: 3, unpaid: 0 });
    expect(payrollLedgerReader(finance)('wage-a')).toEqual({ gross: 80, amount: 77, discount: 3, prepaid: true });
    expect(finance).toEqual(before);
  });

  it('matches original scans for every genuine public-fixture prefix and nested prefix', () => {
    const finance = freeze(structuredClone(genuine.finance)), clubs = [...genuine.clubs.map(club => club.id), 'missing'];
    const ids = [...genuine.payroll.agreements.map(agreement => agreement.id), 'unknown'];
    withCalculationCache(() => {
      for (let end = 0; end <= financeLedgerCount(finance); end += 1) {
        const prefix = financeAtLedgerBoundary(finance, end);
        check(prefix, clubs, ids);
        const nested = financeAtLedgerBoundary(prefix, Math.floor(end / 2));
        check(nested, clubs, ids.slice(-3));
      }
    });
  }, 120_000);

  it('keeps nonzero slices independent and never exposes later same-round transactions through a prefix', () => {
    const finance = freeze(sample());
    withCalculationCache(() => {
      const partial = empty(financeLedgerSlice(finance, 2, 5));
      check(partial, ['a', 'b'], ['wage-a', 'wage-b']);
      expect(ledgerClubBalance(partial, 'a')).toEqual({ cash: 0, unpaid: 110 });
      const earlier = financeAtLedgerBoundary(finance, 5), reader = payrollLedgerReader(earlier);
      expect(reader('wage-b').prepaid).toBe(false);
      expect(reader('wage-a')).toEqual({ gross: 20, amount: 20, discount: 0, prepaid: false });
      expect(ledgerClubBalance(earlier, 'a')).toEqual({ cash: 0, unpaid: 10 });
      check(finance, ['a', 'b'], ['wage-a', 'wage-b']);
      check(earlier, ['a', 'b'], ['wage-a', 'wage-b']);
    });
  });

  it('returns fresh values so caller mutation cannot poison repeat accounting queries', () => {
    withCalculationCache(() => {
      const finance = freeze(sample()), reader = payrollLedgerReader(finance);
      const balance = ledgerClubBalance(finance, 'a'), wages = reader('wage-a');
      balance.cash = -999; wages.gross = -999; wages.prepaid = false;
      expect(ledgerClubBalance(finance, 'a')).toEqual({ cash: 3, unpaid: 0 });
      expect(reader('wage-a')).toEqual({ gross: 80, amount: 77, discount: 3, prepaid: true });
    });
  });

  it('rebuilds after source mutation between scopes and discards prefix aliases outside their original scope', () => {
    const finance = sample();
    let prefix;
    withCalculationCache(() => { prefix = financeAtLedgerBoundary(finance, 6); check(prefix, ['a', 'b'], ['wage-a', 'wage-b']); });
    prefix.ledger[0] = { ...prefix.ledger[0], amount: 1000 };
    prefix.ledger.pop();
    check(prefix, ['a', 'b'], ['wage-a', 'wage-b']);
    withCalculationCache(() => check(prefix, ['a', 'b'], ['wage-a', 'wage-b']));
    expect(finance.ledger[0].amount).toBe(100);
    finance.ledger[0].amount = 300;
    finance.ledger[3].payroll.items[0].gross = 40;
    finance.ledger[3].payroll.items[0].amount = 40;
    withCalculationCache(() => check(finance, ['a', 'b'], ['wage-a', 'wage-b']));
    check(finance, ['a', 'b'], ['wage-a', 'wage-b']);
  });

  it('accounts for newly appended replay rows in the same scope without extending earlier prefixes', () => {
    const finance = sample();
    withCalculationCache(() => {
      const prefix = financeAtLedgerBoundary(finance, 5);
      check(finance, ['a', 'b'], ['wage-a', 'wage-b']);
      finance.ledger.push(row(10, 'a', 37), row(11, 'b', -19, charge('installment', 'wage-b', 19)));
      check(finance, ['a', 'b'], ['wage-a', 'wage-b']);
      check(prefix, ['a', 'b'], ['wage-a', 'wage-b']);
      expect(ledgerClubBalance(prefix, 'a')).toEqual({ cash: 0, unpaid: 10 });
    });
  });

  it('preserves detailed ledger cash transitions and gross commitments in accounting consumers', () => {
    const finance = freeze(sample()), agreement = { id: 'wage-a', playerId: 'a', clubId: 'a', seasonNumber: 1, startsRound: 1, seasonWage: 200 };
    withCalculationCache(() => {
      for (let end = 0; end <= finance.ledger.length; end += 1) {
        const prefix = financeAtLedgerBoundary(finance, end), original = prefix.ledger;
        const expected = original.filter(entry => entry.clubId === 'a').map((entry, index, entries) => {
          const before = oldBalance(entries.slice(0, index), 'a'), after = oldBalance(entries.slice(0, index + 1), 'a');
          return { ...entry, cashDelta: after.cash - before.cash, unpaidDelta: after.unpaid - before.unpaid, cashAfter: after.cash, unpaidAfter: after.unpaid };
        }).reverse();
        expect(financeLedgerRows(prefix, 'a')).toEqual(expected);
        const gross = Array.from({ length: 10 }, (_, index) => payrollInstallment(agreement.seasonWage, index + 1, 10)).reduce((sum, amount) => sum + amount, 0);
        expect(agreementCommitted(agreement, prefix.ledger, 10, 10)).toBe(Math.max(0, gross - oldWages(original, agreement.id).gross));
      }
    });
  });
});
