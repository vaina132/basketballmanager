import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { acceptSponsorshipOffer, declineSponsorshipOffer, enableCommercial, requestSponsorshipImprovement } from '../src/world/commercial';
import { setEmploymentDelegation } from '../src/world/employment';
import { advanceMarket } from '../src/world/market';
import { getMarketStartReason } from '../src/world/market-policy';
import { advanceSeason, createSeason, managedSide, NEW_CAREER_SYSTEMS, rolloverSeason } from '../src/world/season';
import { currentSeasonFile, expectedMigration } from './helpers/season-format';

const club = 'rhine-falcons';
const fixture = name => gunzipSync(readFileSync(new URL(`./fixtures/${name}.json.gz`, import.meta.url))).toString('utf8');
const advance = state => advanceSeason({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) });
const restore = state => parseSeason(serializeSeason(state));
const changed = (state, mutate) => { const copy = structuredClone(state); mutate(copy); return currentSeasonFile(copy); };
const own = state => state.commercial.offers.filter(offer => offer.clubId === club);
let opening, renewal, negotiated, complete, nextOpening, nextRenewal, legacy;

beforeAll(() => {
  opening = createSeason({ seed: 227, managedClubId: club, injuryMode: 'standard', ...NEW_CAREER_SYSTEMS });
  renewal = opening;
  while (renewal.round < 6) renewal = advance(renewal);
  const [first, second, third] = own(renewal);
  negotiated = declineSponsorshipOffer(requestSponsorshipImprovement(renewal, second.id), third.id);
  if (own(negotiated).find(offer => offer.id === second.id).status === 'open') negotiated = acceptSponsorshipOffer(negotiated, second.id);
  else negotiated = acceptSponsorshipOffer(negotiated, first.id);
  complete = setEmploymentDelegation(negotiated, true);
  while (complete.status === 'active') complete = advance(complete);
  for (let step = 0; step < 80 && getMarketStartReason(complete); step += 1) complete = advanceMarket(complete);
  nextOpening = rolloverSeason(complete);
  nextRenewal = nextOpening;
  while (nextRenewal.round < 6) nextRenewal = advance(nextRenewal);
  legacy = parseSeason(fixture('season30-board-career'));
}, 180_000);

describe('sponsorship persistence and strict replay', () => {
  it('round-trips every stage of negotiated sponsorship through format 31', () => {
    for (const state of [opening, renewal, negotiated, complete, nextOpening, nextRenewal]) {
      const text = serializeSeason(state);
      expect(JSON.parse(text).formatVersion).toBe(31);
      expect(parseSeason(text)).toEqual(state);
    }
    expect(nextRenewal.finance.ledger.some(entry => entry.sponsorship?.installment === 2)).toBe(true);
  });

  it('migrates genuine format-30 careers with sponsorship negotiations disabled, then opts in prospectively', () => {
    expect(legacy).toEqual(expectedMigration(JSON.parse(fixture('season30-board-career')).state, 30));
    expect(legacy.commercial.enabledSince).toBeNull();
    const enabled = enableCommercial(legacy);
    expect(restore(enabled)).toEqual(enabled);
    let next = advance(enabled);
    expect(next.commercial.offers.length).toBeGreaterThan(0);
    expect(restore(next)).toEqual(next);
  }, 120_000);

  it.each([
    ['an altered offer fee', state => { state.commercial.offers.find(offer => offer.clubId === club).initialAnnualFee += 100_000; }],
    ['an invented extra offer', state => { const offer = state.commercial.offers.at(-1); state.commercial.offers.push({ ...offer, id: `sponsorship-offer-${state.commercial.offers.length + 1}` }); }],
    ['a changed agreement fee', state => { state.commercial.agreements.at(-1).annualFee += 100_000; }],
    ['a rival club under manual control', state => { state.commercial.plans['aegean-waves'].delegated = false; }],
    ['a removed automatic acceptance', state => { const index = state.commercial.events.findIndex(event => event.type === 'accept'); state.commercial.events.splice(index, 1); }],
    ['an acceptance of a different offer', state => { const event = state.commercial.events.find(event => event.type === 'accept'); event.offerId = state.commercial.offers.find(offer => offer.clubId !== club && offer.id !== event.offerId).id; }],
    ['a request answered twice', state => { const event = state.commercial.events.find(event => event.type === 'request'); state.commercial.events.splice(state.commercial.events.indexOf(event), 0, { ...event }); }],
    ['agreements kept after disabling', state => { state.commercial.enabledSince = null; }],
  ])('rejects %s', (_label, mutate) => {
    expect(() => parseSeason(changed(negotiated, mutate))).toThrow(/Invalid season save/);
  });

  it.each([
    ['a changed installment amount', state => { state.finance.ledger.find(entry => entry.sponsorship).amount += 1; }],
    ['an installment without its agreement detail', state => { delete state.finance.ledger.find(entry => entry.sponsorship).sponsorship; }],
    ['a missing matchday-six installment', state => { const index = state.finance.ledger.findIndex(entry => entry.sponsorship?.installment === 2); state.finance.ledger.splice(index, 1); state.finance.ledger.forEach((entry, position) => { entry.id = `finance-${position + 1}`; }); }],
    ['fixed sponsorship paid in a negotiated season', state => { const entry = state.finance.ledger.find(item => item.sponsorship?.installment === 1); entry.sourceId = `sponsor-s${entry.seasonNumber}`; entry.amount = 20_000_000; delete entry.sponsorship; }],
  ])('rejects %s', (_label, mutate) => {
    expect(() => parseSeason(changed(nextRenewal, mutate))).toThrow(/Invalid season save/);
  });

  it('rejects a missing expiry at the season opening', () => {
    let waiting = setEmploymentDelegation(renewal, true);
    while (waiting.status === 'active') waiting = advance(waiting);
    for (let step = 0; step < 80 && getMarketStartReason(waiting); step += 1) waiting = advanceMarket(waiting);
    const opened = rolloverSeason(waiting);
    expect(restore(opened)).toEqual(opened);
    expect(() => parseSeason(changed(opened, state => { state.commercial.events.pop(); }))).toThrow(/Invalid season save/);
  }, 120_000);
});
