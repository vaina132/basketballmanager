import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { setAutoSubstitutions, simulateToEnd, simulateToQuarterEnd, stepMatch } from '../src/engine/match';
import { parseSeason, serializeSeason, validateSeasonState } from '../src/storage/season-storage';
import { advanceSeason, createSeason, managedSide, rolloverSeason } from '../src/world/season';
import { stripRosterHistory, withUnavailableArchivedStats } from './helpers/legacy-season';

const clubId = 'atlantic-pilots';
const manager = { name: 'Historical Coach', dateOfBirth: '1980-03-17', nationality: 'Turkish' };
const finish = (state: SeasonState): SeasonState => ({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) });
function completed(state: SeasonState): SeasonState { while (state.status !== 'complete') state = advanceSeason(finish(state)); return state; }
function oldFormat(state: SeasonState, version: 7 | 8): string {
  const previous = structuredClone(state) as unknown as Record<string, unknown>;
  stripRosterHistory(previous); previous.schemaVersion = version;
  if (version === 7) delete previous.manager;
  return JSON.stringify({ format: 'basketball-manager-season', formatVersion: version, engineVersion: 'possession-3', state: previous });
}
let firstComplete: SeasonState, secondLive: SeasonState;
beforeAll(() => {
  firstComplete = completed(createSeason(9, clubId, 'standard', true, true, true, true, manager));
  const next = advanceSeason(finish(rolloverSeason(firstComplete)));
  secondLive = { ...next, activeMatch: simulateToQuarterEnd(setAutoSubstitutions(next.activeMatch, managedSide(next), true)) };
}, 60_000);

describe('historical roster persistence', () => {
  it('round-trips full archived box scores, roster identities and current training references', () => {
    const text = serializeSeason(secondLive), restored = parseSeason(text);
    expect(JSON.parse(text).formatVersion).toBe(29);
    expect(restored).toEqual(secondLive);
    expect(restored.manager).toEqual(manager);
    expect(restored.history[0]!.rosters).toEqual(firstComplete.rosters);
    expect(restored.history[0]!.fixtures.map(fixture => fixture.result)).toEqual(firstComplete.fixtures.map(fixture => fixture.result));
    expect(restored.training.lastWeek!.rosterIds[clubId]).toBe('roster-s2-atlantic-pilots-r1');
    expect(stepMatch(restored.activeMatch)).toEqual(stepMatch(secondLive.activeMatch));
    expect(advanceSeason(finish(restored))).toEqual(advanceSeason(finish(secondLive)));
  });

  it.each([7, 8] as const)('migrates format %s without inventing discarded player statistics or changing play', version => {
    const text = oldFormat(secondLive, version), source = JSON.parse(text).state;
    const restored = parseSeason(text);
    expect(restored).toEqual({ ...withUnavailableArchivedStats(secondLive), manager: version === 8 ? manager : null });
    expect(restored.history[0]!.fixtures.every(fixture => fixture.result.stats === null)).toBe(true);
    expect(restored.fixtures.filter(fixture => fixture.result).every(fixture => fixture.result!.stats !== null)).toBe(true);
    expect(restored.activeMatch).toEqual(source.activeMatch);
    expect(restored.payroll).toEqual(source.payroll);
    expect(restored.finance).toEqual(source.finance);
    expect(restored.injuries).toEqual(source.injuries);
    expect(restored.training.points).toEqual(source.training.points);
    expect(JSON.parse(text).state).toEqual(source);
    expect(serializeSeason(restored)).toBe(serializeSeason(parseSeason(serializeSeason(restored))));
  });

  it('starts retaining complete player records at the first rollover after importing an older save', () => {
    const migrated = parseSeason(oldFormat(firstComplete, 8));
    expect(migrated).toEqual(firstComplete);
    const next = rolloverSeason(migrated);
    expect(next.history[0]!.fixtures.map(fixture => fixture.result)).toEqual(firstComplete.fixtures.map(fixture => fixture.result));
    expect(parseSeason(serializeSeason(next))).toEqual(next);
  });

  it.each(['current rosters', 'archive rosters', 'result references', 'training references', 'archived box scores'] as const)('rejects format 8 %s before recovering metadata', change => {
    const envelope = JSON.parse(oldFormat(secondLive, 8));
    if (change === 'current rosters') envelope.state.rosters = secondLive.rosters;
    if (change === 'archive rosters') envelope.state.history[0].rosters = secondLive.history[0]!.rosters;
    if (change === 'result references') envelope.state.fixtures[0].result.rosterIds = secondLive.fixtures[0]!.result!.rosterIds;
    if (change === 'training references') envelope.state.training.lastWeek.rosterIds = secondLive.training.lastWeek!.rosterIds;
    if (change === 'archived box scores') envelope.state.history[0].fixtures[0].result.stats = secondLive.history[0]!.fixtures[0]!.result.stats;
    expect(() => parseSeason(JSON.stringify(envelope))).toThrow(/unsupported fields/);
  });
});

describe('roster and historical accounting validation', () => {
  const mutations: Array<[string, (state: SeasonState) => void]> = [
    ['missing opening roster', state => { state.rosters.pop(); }],
    ['duplicate snapshot', state => { state.rosters[1] = structuredClone(state.rosters[0]!); }],
    ['unknown snapshot identity', state => { state.rosters[0]!.id = 'invented'; }],
    ['wrong snapshot club', state => { state.rosters[0]!.clubId = state.clubs[1]!.id; }],
    ['future snapshot boundary', state => { state.rosters[0]!.fromRound = 3; }],
    ['missing player', state => { state.rosters[0]!.players = state.rosters[0]!.players.slice(1); }],
    ['duplicate player', state => { state.rosters[0]!.players = state.rosters[0]!.players.map(() => state.rosters[0]!.players[0]!); }],
    ['rewritten historical player name', state => { Object.assign(state.history[0]!.rosters[0]!.players[0]!, { name: 'Rewritten' }); }],
    ['rewritten historical player rating', state => { const player = state.history[0]!.rosters[0]!.players[0]!; Object.assign(player.attributes, { passing: player.attributes.passing + 1 }); }],
    ['missing result reference', state => { delete (state.fixtures[0]!.result as unknown as Record<string, unknown>).rosterIds; }],
    ['wrong result owner', state => { state.fixtures[0]!.result!.rosterIds.home = state.fixtures[0]!.result!.rosterIds.away; }],
    ['current result using prior-year roster', state => { state.fixtures[0]!.result!.rosterIds.home = state.history[0]!.fixtures[0]!.result.rosterIds.home; }],
    ['archive using current-year roster', state => { state.history[0]!.fixtures[0]!.result.rosterIds.home = state.fixtures[0]!.result!.rosterIds.home; }],
    ['missing archive roster', state => { state.history[0]!.rosters.pop(); }],
    ['partial archive coverage', state => { state.history[0]!.fixtures[0]!.result.stats = null; }],
    ['missing archived statistics field', state => { delete (state.history[0]!.fixtures[0]!.result as unknown as Record<string, unknown>).stats; }],
    ['missing archived player', state => { delete state.history[0]!.fixtures[0]!.result.stats![state.clubs[0]!.players[0]!.id]; }],
    ['unknown archived player', state => { const stats = state.history[0]!.fixtures[0]!.result.stats!; stats.unknown = structuredClone(Object.values(stats)[0]!); }],
    ['inconsistent archived player points', state => { Object.values(state.history[0]!.fixtures[0]!.result.stats!)[0]!.points += 1; }],
    ['excessive archived minutes', state => { Object.values(state.history[0]!.fixtures[0]!.result.stats!)[0]!.secondsPlayed = 1_000_000; }],
    ['missing training reference', state => { delete state.training.lastWeek!.rosterIds[clubId]; }],
    ['wrong training owner', state => { state.training.lastWeek!.rosterIds[clubId] = state.rosters[0]!.id; }],
    ['training using prior-year roster', state => { state.training.lastWeek!.rosterIds[clubId] = 'roster-s1-atlantic-pilots-r1'; }],
  ];
  it.each(mutations)('rejects %s before replacing an open career', (_name, mutate) => {
    const damaged = structuredClone(secondLive); mutate(damaged);
    expect(() => validateSeasonState(damaged)).toThrow();
    expect(() => parseSeason(JSON.stringify({ format: 'basketball-manager-season', formatVersion: 29, engineVersion: 'possession-3', state: damaged }))).toThrow();
  });
});
