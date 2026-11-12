import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { setAutoSubstitutions, simulateToEnd, stepMatch } from '../src/engine/match';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { advanceSeason, managedSide } from '../src/world/season';
import { expectedMigration } from './helpers/season-format';

const play = (state) => advanceSeason({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) });
const fixture = (name) => gunzipSync(readFileSync(new URL(`./fixtures/${name}.json.gz`, import.meta.url))).toString('utf8');

describe('release-clause save migration', () => {
  it.each(['free-agent', 'paid'])('preserves the genuine format19 pending %s offer and its original reply', kind => {
    const text = fixture(`season19-pending-${kind}`);
    const original = JSON.parse(text);
    expect(original.formatVersion).toBe(19);
    const restored = parseSeason(text);
    expect(restored).toEqual(expectedMigration(original.state, 19));
    expect(restored.employment.contracts.every(contract => !Object.hasOwn(contract, 'releaseFee'))).toBe(true);
    expect(stepMatch(restored.activeMatch)).toEqual(stepMatch(original.state.activeMatch));
    const next = play(restored);
    const outcome = {
      offers: next.recruitment.offers,
      contracts: next.employment.contracts.slice(restored.employment.contracts.length),
      responses: next.negotiations.records.slice(restored.negotiations.records.length),
      transfers: next.employment.transfers,
      ledger: next.finance.ledger.slice(restored.finance.ledger.length),
      agreements: next.payroll.agreements.slice(restored.payroll.agreements.length),
    };
    expect(outcome).toEqual(JSON.parse(fixture(`season19-reply-${kind}`)));
    expect(parseSeason(serializeSeason(next))).toEqual(next);
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
