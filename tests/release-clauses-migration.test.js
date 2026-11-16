import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { setAutoSubstitutions, simulateToEnd, stepMatch } from '../src/engine/match';
import { parseSeason } from '../src/storage/season-storage';
import { advanceSeason, managedSide } from '../src/world/season';
import { expectedMigration } from './helpers/season-format';
import { expectValidOldSaveWeek } from './helpers/old-save-week';

const play = (state) => advanceSeason({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) });
const fixture = (name) => gunzipSync(readFileSync(new URL(`./fixtures/${name}.json.gz`, import.meta.url))).toString('utf8');

describe('release-clause save migration', () => {
  // Match calibration and realistic injuries (sprint 4) changed the simulated results after this old save, so the week is
  // checked for what must hold under intended rule changes (tests/helpers/old-save-week.ts). The reply to the pending
  // offer, its contract, negotiation, transfer, wage agreement and the week's ledger do not depend on the simulated game
  // and still match the recorded reply exactly; new offers by automatic clubs follow the simulated week.
  it.each(['free-agent', 'paid'])('preserves the genuine format19 pending %s offer and its original reply', kind => {
    const text = fixture(`season19-pending-${kind}`);
    const original = JSON.parse(text);
    expect(original.formatVersion).toBe(19);
    const restored = parseSeason(text);
    expect(restored).toEqual(expectedMigration(original.state, 19));
    expect(restored.employment.contracts.every(contract => !Object.hasOwn(contract, 'releaseFee'))).toBe(true);
    expect(stepMatch(restored.activeMatch)).toEqual(stepMatch(original.state.activeMatch));
    const next = play(restored);
    const pending = restored.recruitment.offers.length;
    expect(pending).toBeGreaterThan(0);
    const recorded = JSON.parse(fixture(`season19-reply-${kind}`));
    const outcome = {
      offers: next.recruitment.offers.slice(0, pending),
      contracts: next.employment.contracts.slice(restored.employment.contracts.length),
      responses: next.negotiations.records.slice(restored.negotiations.records.length),
      transfers: next.employment.transfers,
      ledger: next.finance.ledger.slice(restored.finance.ledger.length),
      agreements: next.payroll.agreements.slice(restored.payroll.agreements.length),
    };
    expect(outcome).toEqual({ ...recorded, offers: recorded.offers.slice(0, pending) });
    expectValidOldSaveWeek(restored, next);
  });

  it.each(['contract', 'offer', 'event', 'mode'])('rejects a clause field hidden in a format19 %s', location => {
    const previous = JSON.parse(fixture('season19-pending-paid'));
    if (location === 'contract') previous.state.employment.contracts[0].releaseFee = 1_000_000;
    if (location === 'offer') previous.state.recruitment.offers[0].releaseFee = 1_000_000;
    if (location === 'mode') previous.state.recruitment.offers[0].transfer.mode = 'release-clause';
    if (location === 'event') Object.assign(previous.state.recruitment.events.find(event => event.type === 'offer'), { releaseFee: 1_000_000 });
    expect(() => parseSeason(JSON.stringify(previous))).toThrow();
  });
});
