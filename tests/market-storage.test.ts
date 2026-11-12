import { stripInSeasonRecruitment } from './helpers/legacy-season';
import { beforeAll, describe, expect, it } from 'vitest';
import { SEASON_SCHEMA_VERSION } from './helpers/season-format';
import type { SeasonState } from '../src/domain/season';
import { getSeasonWage } from '../src/data/development-wages';
import { setAutoSubstitutions, simulateToEnd, stepMatch } from '../src/engine/match';
import { parseSeason, serializeSeason, validateSeasonState } from '../src/storage/season-storage';
import { offerPlayerContract } from '../src/world/employment';
import { advanceMarket, enableMarket, submitMarketOffer, withdrawMarketOffer } from '../src/world/market';
import { getMarketWindow } from '../src/world/market-policy';
import { requiredNegotiationWage } from '../src/world/negotiations-policy';
import { advanceSeason, createSeason, managedSide, rolloverSeason } from '../src/world/season';

const clubId = 'rhine-falcons', playerId = 'rhf-1';
const play = (state: SeasonState): SeasonState => advanceSeason({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) });
function complete(state: SeasonState): SeasonState { while (state.status === 'active') state = play(state); return state; }
const envelope = (state: unknown, formatVersion: number = SEASON_SCHEMA_VERSION) => JSON.stringify({ format: 'basketball-manager-season', formatVersion, engineVersion: 'possession-3', state });
const window = (state: SeasonState) => getMarketWindow(state)!;
const firstOffer = (state: SeasonState) => window(state).offers.find(offer => offer.playerId === playerId)!;
let legacy: SeasonState, opened: SeasonState, pending: SeasonState, countered: SeasonState, expired: SeasonState, withdrawn: SeasonState, replaced: SeasonState, accepted: SeasonState, ready: SeasonState, second: SeasonState, secondComplete: SeasonState;

beforeAll(() => {
  legacy = complete(createSeason(73, clubId, 'standard', true, true, true, true, null, true, true, true));
  opened = enableMarket(legacy);
  pending = submitMarketOffer(opened, playerId, getSeasonWage(playerId), 3);
  countered = advanceMarket(pending);
  expired = advanceMarket(countered);
  withdrawn = withdrawMarketOffer(pending, firstOffer(pending).id);
  replaced = submitMarketOffer(pending, playerId, requiredNegotiationWage(playerId, 3), 3);
  accepted = advanceMarket(replaced);
  ready = opened;
  for (const player of ready.clubs.find(club => club.id === clubId)!.players.slice(0, 8)) ready = submitMarketOffer(ready, player.id, getSeasonWage(player.id), 1);
  ready = advanceMarket(ready);
  second = rolloverSeason(ready);
  secondComplete = complete(second);
}, 120_000);

describe('dated recruitment persistence', () => {
  it('round-trips each offer state, partial calendar, accepted wages and closed historic windows', () => {
    for (const state of [opened, pending, countered, expired, withdrawn, replaced, accepted, ready, second, secondComplete]) {
      const text = serializeSeason(state), restored = parseSeason(text);
      expect(JSON.parse(text).formatVersion).toBe(SEASON_SCHEMA_VERSION);
      expect(restored).toEqual(state);
      expect(stepMatch(restored.activeMatch)).toEqual(stepMatch(state.activeMatch));
    }
  });

  it('replays pending replies and expiry identically after reload', () => {
    expect(advanceMarket(parseSeason(serializeSeason(pending)))).toEqual(countered);
    expect(advanceMarket(parseSeason(serializeSeason(countered)))).toEqual(expired);
    expect(advanceMarket(parseSeason(serializeSeason(replaced)))).toEqual(accepted);
  });

  it('preserves results and cash while deriving recovered condition from the advanced date', () => {
    const restored = parseSeason(serializeSeason(expired));
    expect(restored.date).toBe(firstOffer(pending).expiresOn);
    expect(restored.activeMatch).toEqual(legacy.activeMatch);
    expect(restored.fixtures).toEqual(legacy.fixtures);
    expect(restored.finance).toEqual(legacy.finance);
    expect(restored.payroll).toEqual(legacy.payroll);
    expect(restored.clubs).toEqual(legacy.clubs);
    expect(Object.values(restored.conditions).every(condition => condition === 100)).toBe(true);
  });

  it('migrates a real format-12 career without changing its prior immediate negotiation behavior', () => {
    const previous = structuredClone(legacy) as unknown as Record<string, unknown>;
    stripInSeasonRecruitment(previous); delete (previous.employment as Record<string, unknown>).transfers; delete (previous.employment as Record<string, unknown>).buyouts; delete previous.market; previous.schemaVersion = 12;
    const restored = parseSeason(envelope(previous, 12));
    expect(restored).toEqual({ ...legacy, recruitment: { model: 'recruitment-1', enabledSince: null, transfersEnabledSince: null, events: [], offers: [] } });
    expect(restored.market).toEqual({ model: 'market-1', enabledSince: null, windows: [] });
    const signed = offerPlayerContract(restored, playerId, getSeasonWage(playerId), 1);
    expect(signed.employment.contracts.length).toBe(restored.employment.contracts.length + 1);
    expect(signed.negotiations.records.length).toBe(restored.negotiations.records.length + 1);
    expect(signed.activeMatch).toEqual(restored.activeMatch);
    expect(parseSeason(serializeSeason(signed))).toEqual(signed);
  });

  it('anchors opt-in after same-day legacy replies and retains them through later rollover', () => {
    expect(opened.market.enabledSince!.contractCount).toBe(legacy.employment.contracts.length);
    expect(opened.market.enabledSince!.negotiationCount).toBe(legacy.negotiations.records.length);
    expect(window(opened).contractCountBefore).toBe(legacy.employment.contracts.length);
    expect(second.market.windows[0]!.closed).toBe(true);
    expect(second.negotiations.records.slice(0, legacy.negotiations.records.length)).toEqual(legacy.negotiations.records);
    expect(parseSeason(serializeSeason(secondComplete)).market.windows).toEqual(secondComplete.market.windows);
  });

  it('preserves active-season opt-in before the first window exists', () => {
    const state = enableMarket(createSeason(19, clubId, 'off', true, true, true, true, null, true, true, true));
    expect(state.market.windows).toEqual([]);
    expect(parseSeason(serializeSeason(state))).toEqual(state);
  });
});

describe('market save tamper rejection', () => {
  const mutations: Array<[string, (state: SeasonState) => void]> = [
    ['missing market', state => { delete (state as Partial<SeasonState>).market; }],
    ['unknown market model', state => { Object.assign(state.market, { model: 'market-99' }); }],
    ['unsupported market field', state => { Object.assign(state.market, { reservedCash: 0 }); }],
    ['disabled market with retained windows', state => { state.market.enabledSince = null; }],
    ['activation after the current matchday', state => { state.market.enabledSince!.round = 11; }],
    ['activation skips accepted contracts', state => { state.market.enabledSince!.contractCount += 1; }],
    ['activation skips response history', state => { state.market.enabledSince!.negotiationCount += 1; }],
    ['missing recruitment window', state => { state.market.windows = []; }],
    ['wrong opening date', state => { window(state).openedOn = '2026-11-08'; }],
    ['extended recruitment deadline', state => { window(state).closesOn = '2026-12-31'; }],
    ['unlogged calendar advancement', state => { state.date = window(state).date = '2026-11-12'; }],
    ['career date disagrees with window', state => { state.date = '2026-11-12'; }],
    ['invalid window date', state => { window(state).date = '2026-11-31'; }],
    ['window skips accepted contracts', state => { window(state).contractCountBefore += 1; }],
    ['window skips player responses', state => { window(state).negotiationCountBefore += 1; }],
    ['window prematurely marked closed', state => { window(state).closed = true; }],
    ['offer cache omits its command', state => { window(state).events.shift(); }],
    ['offer cache invents a reservation', state => { window(state).offers.push({ ...firstOffer(state), id: 'invented' }); }],
    ['offer identity is changed', state => { firstOffer(state).id = 'invented'; }],
    ['offer wage is changed', state => { firstOffer(state).seasonWage += 50_000; }],
    ['offer contract length is changed', state => { firstOffer(state).seasons = 2; }],
    ['offer expiry is reset', state => { firstOffer(state).expiresOn = '2026-12-31'; }],
    ['offer response date is reset', state => { firstOffer(state).responseOn = '2026-12-31'; }],
    ['offer status is changed', state => { firstOffer(state).status = 'accepted'; }],
    ['offer response link is changed', state => { firstOffer(state).negotiationId = 'negotiation-1'; }],
    ['offer employer is changed', state => { firstOffer(state).clubId = state.clubs[1]!.id; }],
    ['event submits unknown player', state => { const event = window(state).events[0]!; if (event.type === 'offer') event.playerId = 'invented'; }],
    ['event exceeds wage budget', state => { const event = window(state).events[0]!; if (event.type === 'offer') event.seasonWage = 100_000_000; }],
    ['unknown event kind', state => { Object.assign(window(state).events[0]!, { type: 'approve' }); }],
    ['current condition reverts after recovery', state => { state.conditions = { ...legacy.conditions }; }],
  ];
  it.each(mutations)('rejects %s before replacing the live career', (_name, mutate) => {
    const state = structuredClone(countered); mutate(state);
    expect(() => validateSeasonState(state)).toThrow();
    expect(() => parseSeason(envelope(state))).toThrow();
  });

  it('rejects a response or accepted contract hidden outside the market journal', () => {
    const state = structuredClone(accepted);
    const response = state.negotiations.records.at(-1)!;
    response.date = window(state).openedOn;
    expect(() => validateSeasonState(state)).toThrow();
    const omitted = structuredClone(accepted);
    window(omitted).events.pop();
    expect(() => validateSeasonState(omitted)).toThrow();
  });

  it('rejects an archived window reopened with a reset pending offer', () => {
    const state = structuredClone(second);
    state.market.windows[0]!.closed = false;
    expect(() => validateSeasonState(state)).toThrow();
    const altered = structuredClone(second);
    altered.market.windows[0]!.offers[0]!.status = 'pending';
    expect(() => parseSeason(envelope(altered))).toThrow();
  });
});
