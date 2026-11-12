import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { setAutoSubstitutions, simulateToEnd, stepMatch } from '../src/engine/match';
import { advanceSeason, createSeason, managedSide, rolloverSeason } from '../src/world/season';
import { agreeSquadRole, createRelationships, enableRelationships, getPlayerRelationship, talkToPlayer } from '../src/world/relationships';
import { setEmploymentDelegation } from '../src/world/employment';
import { advanceMarket } from '../src/world/market';
import { getMarketStartReason } from '../src/world/market-policy';

const fixture = name => gunzipSync(readFileSync(new URL(`./fixtures/${name}.json.gz`, import.meta.url))).toString('utf8');
const upgrade = state => ({ ...state, schemaVersion: 29, relationships: createRelationships() });
const restore = state => parseSeason(serializeSeason(state));
const advance = state => advanceSeason({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) });
const changed = (state, mutate) => { const copy = structuredClone(state); mutate(copy); return JSON.stringify({ format: 'basketball-manager-season', formatVersion: 29, engineVersion: 'possession-3', state: copy }); };
const playerId = 'rhf-10';
let legacy, enabled, promoted, initial, role, concern, promised, answered, complete, opening;
beforeAll(() => {
  legacy = parseSeason(fixture('season28-facilities-career'));
  enabled = enableRelationships(legacy); promoted = advance(enabled);
  initial = createSeason(227, 'rhine-falcons', 'off', true, true, true, true, null, true, true, true, true, true, true, true, true, true, true, true, true, true, true);
  role = agreeSquadRole(initial, playerId, 'starter'); concern = role;
  while (concern.round < 5) concern = advance(concern);
  promised = talkToPlayer(concern, playerId, 'minutes-promise'); answered = promised;
  while (answered.round < 9) answered = advance(answered);
  complete = setEmploymentDelegation(answered, true);
  while (complete.status === 'active') complete = advance(complete);
  for (let count = 0; count < 80 && getMarketStartReason(complete); count += 1) complete = advanceMarket(complete);
  opening = rolloverSeason(complete);
}, 90_000);

describe('relationship journal, frozen morale and genuine format28 compatibility', () => {
  it('preserves the complete earlier facilities career and independent next matchday exactly', () => {
    const original = JSON.parse(fixture('season28-facilities-career'));
    expect(original.formatVersion).toBe(28);
    expect(legacy).toEqual(upgrade(original.state));
    expect(legacy.facilities.projects.some(project => project.completedOn)).toBe(true);
    expect(legacy.recruitment.offers.some(offer => offer.status === 'pending')).toBe(true);
    expect(advance(legacy)).toEqual(upgrade(JSON.parse(fixture('season28-facilities-career-next')).state));
    expect(restore(legacy)).toEqual(legacy);
  });
  it('preserves independently captured offseason and next opening with relationships disabled', () => {
    const complete = parseSeason(fixture('season28-facilities-complete'));
    expect(rolloverSeason(complete)).toEqual(upgrade(JSON.parse(fixture('season28-facilities-opening')).state));
  });
  it('enables prospectively without altering current morale or the prepared sporting step', () => {
    expect(enabled.activeMatch).toBe(legacy.activeMatch);
    expect(enabled.activeMatch).not.toHaveProperty('morale');
    expect(stepMatch(restore(enabled).activeMatch)).toEqual(stepMatch(legacy.activeMatch));
    expect(restore(enabled)).toEqual(enabled);
    expect(promoted.activeMatch.morale).toBeDefined();
    expect(promoted.academy.graduates.length).toBeGreaterThan(legacy.academy.graduates.length);
    expect(restore(promoted)).toEqual(promoted);
  });
  it('retains a role decision and its future evidence without rewriting the current match snapshot', () => {
    expect(role.activeMatch).toBe(initial.activeMatch);
    expect(role.activeMatch.morale.eventCount).toBe(1);
    expect(role.relationships.events.at(-1)).toMatchObject({ type: 'role', playerId, role: 'starter' });
    expect(restore(role)).toEqual(role);
    expect(getPlayerRelationship(concern, playerId).concern).toBeTruthy();
    expect(restore(concern)).toEqual(concern);
  });
  it('replays actual measured promise outcomes and retains them over offseason and rollover', () => {
    expect(getPlayerRelationship(promised, playerId).promise).toMatchObject({ status: 'active', targetMinutes: 24 });
    expect(['kept', 'broken']).toContain(getPlayerRelationship(answered, playerId).promises.at(-1).status);
    for (const state of [promised, answered, complete, opening]) expect(restore(state)).toEqual(state);
    expect(rolloverSeason(restore(complete))).toEqual(opening);
  });
  it('rejects morale metadata inserted into a format28 career even when the match shape is valid', () => {
    const original = JSON.parse(fixture('season28-facilities-career'));
    original.state.activeMatch.morale = { model: 'morale-1', eventCount: 1, values: Object.fromEntries([...original.state.activeMatch.home.players, ...original.state.activeMatch.away.players].map(player => [player.id, 50])) };
    expect(() => parseSeason(JSON.stringify(original))).toThrow(/predating player relationships/);
  });
  it('accepts harmless JSON map-key reordering without changing the decision history', () => {
    const text = changed(role, state => {
      const preparation = state.relationships.events[0];
      preparation.values = Object.fromEntries(Object.entries(preparation.values).reverse());
      preparation.rosterIds = Object.fromEntries(Object.entries(preparation.rosterIds).reverse());
      state.activeMatch.morale.values = Object.fromEntries(Object.entries(state.activeMatch.morale.values).reverse());
    });
    expect(parseSeason(text)).toEqual(role);
  });
  it('rejects a managed conversation moved before its already prepared fixture', () => {
    const text = changed(role, state => {
      const preparation = state.relationships.events[0], agreement = state.relationships.events[1];
      state.relationships.events = [{ ...agreement, id: 'relationship-event-1' }, { ...preparation, id: 'relationship-event-2' }];
      state.activeMatch.morale.eventCount = 2;
    });
    expect(() => parseSeason(text)).toThrow(/before subsequent manager conversations/);
  });

  const cases = [
    ['unsupported model', () => role, state => { state.relationships.model = 'relationships-2'; }],
    ['invented aggregate morale', () => role, state => { state.relationships.morale = 100; }],
    ['disabled journal', () => role, state => { state.relationships.enabledSince = null; }],
    ['future activation date', () => enabled, state => { state.relationships.enabledSince.date = '2026-10-04'; }],
    ['activation result prefix', () => enabled, state => { state.relationships.enabledSince.completedRounds -= 1; }],
    ['activation registration prefix', () => enabled, state => { state.relationships.enabledSince.rosterCount -= 1; }],
    ['split initial employment', () => initial, state => { state.relationships.enabledSince.contractCount = 1; }],
    ['event identity', () => role, state => { state.relationships.events[1].id = 'relationship-event-7'; }],
    ['future conversation date', () => role, state => { state.relationships.events[1].date = '2026-09-06'; }],
    ['unregistered target', () => role, state => { state.relationships.events[1].playerId = 'not-registered'; }],
    ['unowned target', () => role, state => { state.relationships.events[1].clubId = 'aegean-waves'; }],
    ['unsupported role', () => role, state => { state.relationships.events[1].role = 'superstar'; }],
    ['unsupported conversation', () => promised, state => { state.relationships.events.at(-1).choice = 'instant-happiness'; }],
    ['fabricated promise bonus', () => promised, state => { state.relationships.events.at(-1).morale = 100; }],
    ['prepared roster identity', () => initial, state => { state.relationships.events[0].rosterIds[state.managedClubId] = 'wrong-roster'; }],
    ['prepared morale value', () => initial, state => { state.relationships.events[0].values[playerId] = 51; }],
    ['prepared extra identity', () => initial, state => { state.relationships.events[0].values.unknown = 50; }],
    ['prepared missing identity', () => initial, state => { delete state.relationships.events[0].values[playerId]; }],
    ['active match morale', () => role, state => { state.activeMatch.morale.values[playerId] += 1; }],
    ['active match prefix', () => role, state => { state.activeMatch.morale.eventCount += 1; }],
    ['missing match morale', () => concern, state => { delete state.activeMatch.morale; }],
    ['late activation snapshot', () => enabled, state => { state.activeMatch.morale = { model: 'morale-1', eventCount: 1, values: Object.fromEntries([...state.activeMatch.home.players, ...state.activeMatch.away.players].map(player => [player.id, 50])) }; }],
    ['rewritten frozen and displayed morale', () => initial, state => { state.relationships.events[0].values[playerId] += 1; state.activeMatch.morale.values[playerId] += 1; }],
    ['removed future preparation', () => promoted, state => { state.relationships.events = []; delete state.activeMatch.morale; }],
    ['retroactive result boundary', () => promised, state => { state.relationships.events.at(-1).completedRounds += 1; }],
  ];
  it.each(cases)('rejects %s', (_name, source, mutate) => {
    expect(() => parseSeason(changed(source(), mutate))).toThrow();
  });
});
