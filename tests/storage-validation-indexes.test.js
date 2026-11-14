import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { SEASON_SCHEMA_VERSION } from '../src/domain/season';
import { ledgerBoundaryIndex } from '../src/storage/ledger-boundaries';
import { SAVE_CHECKS_VERSION, sealMatches } from '../src/storage/save-seal';
import { parseSeason, serializeSeason, validateSeasonState } from '../src/storage/season-storage';
import { roundKey } from '../src/world/career-world';
import { withCalculationCache } from '../src/world/pure-cache';

const entry = (seasonNumber, round, kind = 'operations', payroll = null) => ({ seasonNumber, round, kind, payroll });
const bruteBoundary = (ledger, offset, boundary) => ledger.every((row, index) => index < offset
  ? !(roundKey(row.seasonNumber, row.round) > boundary)
  : !(roundKey(row.seasonNumber, row.round) < boundary));
const indexedBoundary = (index, offset, boundary) => !(index.prefixLatest[offset] > boundary || index.suffixEarliest[offset] < boundary);

describe('validation ledger indexes', () => {
  it('preserves all prefix checks for empty, repeated-date, unsorted and distant-year rows', () => {
    const samples = [
      [], [entry(1, 1)], [entry(1, 1), entry(1, 1), entry(1, 2), entry(2, 1)],
      [entry(1, 1), entry(3, 1), entry(1, 2), entry(2, 1)],
      [entry(1, 3), entry(1, 2), entry(1, 1)],
    ];
    for (const ledger of samples) withCalculationCache(() => {
      const indexed = ledgerBoundaryIndex(ledger);
      for (let offset = 0; offset <= ledger.length; offset += 1) {
        for (let year = 1; year <= 3; year += 1) for (let round = 1; round <= 4; round += 1) {
          const boundary = roundKey(year, round);
          expect(indexedBoundary(indexed, offset, boundary)).toBe(bruteBoundary(ledger, offset, boundary));
        }
      }
    });
  });

  it('retains exact first/last financial commits without treating prepayments as match results', () => {
    const ledger = [entry(1, 2, 'payroll', { type: 'prepayment' }), entry(1, 2, 'tickets'), entry(1, 2),
      entry(1, 2, 'facility-upkeep'), entry(1, 2, 'payroll', { type: 'installment' }), entry(2, 1, 'payroll', { type: 'prepayment' }), entry(2, 1)];
    const index = ledgerBoundaryIndex(ledger);
    expect([...index.commits]).toEqual([[roundKey(1, 2), { first: 1, last: 4 }], [roundKey(2, 1), { first: 6, last: 6 }]]);
    expect(ledgerBoundaryIndex([entry(1, 2, 'payroll', { type: 'prepayment' })]).commits.size).toBe(0);
  });

  it('reuses derived data only within its validation scope and sees later mutations of the same ledger', () => {
    const ledger = [entry(1, 1), entry(1, 2)];
    const previous = withCalculationCache(() => {
      const index = ledgerBoundaryIndex(ledger);
      expect(ledgerBoundaryIndex(ledger)).toBe(index);
      return index;
    });
    ledger[0].seasonNumber = 2;
    const next = withCalculationCache(() => ledgerBoundaryIndex(ledger));
    expect(next).not.toBe(previous);
    expect(indexedBoundary(next, 1, roundKey(1, 2))).toBe(false);
    ledger[0].seasonNumber = 1;
    expect(indexedBoundary(ledgerBoundaryIndex(ledger), 1, roundKey(1, 2))).toBe(true);
    ledger[0].seasonNumber = 2;
    expect(indexedBoundary(ledgerBoundaryIndex(ledger), 1, roundKey(1, 2))).toBe(false);
  });
});

const fixture = name => gunzipSync(readFileSync(new URL(`./fixtures/${name}.json.gz`, import.meta.url))).toString('utf8');
let original;
beforeAll(() => { original = parseSeason(fixture('season40-board-career-next')); });
const renumber = ledger => { ledger.forEach((row, index) => { row.id = `finance-${index + 1}`; }); };

describe('strict saves with validation-scoped calculations', () => {
  it('preserves the exact sporting and accounting data through repeated checks and exports', () => {
    const before = JSON.stringify(original);
    validateSeasonState(original);
    validateSeasonState(original);
    expect(JSON.stringify(original)).toBe(before);
    expect(parseSeason(serializeSeason(original))).toEqual(original);
  });

  it.each(['before the last operating charge', 'after payroll starts'])('still rejects upkeep %s', timing => {
    const changed = structuredClone(original), ledger = changed.finance.ledger;
    validateSeasonState(changed);
    const upkeepIndex = ledger.findIndex(row => row.kind === 'facility-upkeep');
    expect(upkeepIndex).toBeGreaterThan(0);
    const [upkeep] = ledger.splice(upkeepIndex, 1);
    const sameDay = row => row.seasonNumber === upkeep.seasonNumber && row.round === upkeep.round;
    const at = timing === 'before the last operating charge'
      ? ledger.findLastIndex(row => sameDay(row) && row.kind === 'operations')
      : ledger.findIndex(row => sameDay(row) && row.kind === 'payroll' && row.payroll?.type === 'installment') + 1;
    expect(at).toBeGreaterThan(0);
    ledger.splice(at, 0, upkeep); renumber(ledger);
    expect(() => validateSeasonState(changed)).toThrow(/upkeep after all operating costs and before matchday payroll/);
  });

  it('rejects a scout observation moved past the first financial commit after the same state already passed', () => {
    const changed = structuredClone(original);
    validateSeasonState(changed);
    const review = Object.values(changed.scouting.clubs).flatMap(office => office.reviews).find(review => review.observer?.contractId);
    expect(review).toBeDefined();
    const commit = ledgerBoundaryIndex(changed.finance.ledger).commits.get(roundKey(review.seasonNumber, review.round));
    review.observer.assignedLedgerIndex = commit.first + 1;
    expect(() => validateSeasonState(changed)).toThrow(/before its matchday result is financially committed/);
  });

  it('does not retain staff ledger-boundary proofs after a valid input is changed in place', () => {
    const changed = structuredClone(original);
    validateSeasonState(changed);
    const scout = changed.scouts.contracts[0];
    const charged = changed.finance.ledger[scout.hiredLedgerIndex];
    const originalRound = charged.round;
    charged.round = changed.round;
    expect(() => validateSeasonState(changed)).toThrow();
    charged.round = originalRound;
    expect(() => validateSeasonState(changed)).not.toThrow();
  });

  it('revalidates certificates issued before the corrected archive-roster checks', async () => {
    expect(SAVE_CHECKS_VERSION).toBeGreaterThan(2);
    const text = serializeSeason(original);
    const oldSeal = createHash('sha256').update(`courtside-save-seal|format-${SEASON_SCHEMA_VERSION}|checks-2|${text}`).digest('hex');
    expect(await sealMatches(text, oldSeal)).toBe(false);
  });
});
