import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { setAutoSubstitutions, simulateToEnd, stepMatch } from '../src/engine/match';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { getClubScouts } from '../src/world/scout-policy';
import { createScouts, enableScouts, hireScout, releaseScout } from '../src/world/scouts';
import { assignScouting } from '../src/world/scouting';
import { getPlayerKnowledge } from '../src/world/scouting-policy';
import { advanceSeason, createSeason, managedSide } from '../src/world/season';

const club = 'rhine-falcons';
const play = state => advanceSeason({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) });
const fixture = name => gunzipSync(readFileSync(new URL(`./fixtures/${name}.json.gz`, import.meta.url))).toString('utf8');
const changed = (state, mutate) => { const envelope = JSON.parse(serializeSeason(state)); mutate(envelope.state); return JSON.stringify(envelope); };
let staffed, pending, report, expensive;
beforeAll(() => {
  const initial = createSeason(863, club, 'off', true, true, true, true, null, true, true, true, true, true);
  staffed = hireScout(initial, 'scout-19');
  pending = assignScouting(staffed, 'aeg-1', getClubScouts(staffed)[0].id);
  report = play(pending);
  expensive = hireScout(staffed, 'scout-20');
});

describe('scout save provenance and migration', () => {
  it('preserves a genuine format20 pending career and its independently captured next matchday', () => {
    const text = fixture('season20-scouting-pending'), original = JSON.parse(text);
    const restored = parseSeason(text), expected = JSON.parse(fixture('season20-scouting-reply'));
    expect(original.formatVersion).toBe(20);
    expect(restored).toEqual({ ...original.state, schemaVersion: 23, physio: { model: 'physio-1', enabledSince: null, contracts: [], rehabilitation: [] }, fitness: { model: 'fitness-1', enabledSince: null, contracts: [] }, scouts: createScouts() });
    expect(stepMatch(restored.activeMatch)).toEqual(stepMatch(original.state.activeMatch));
    expect(Object.fromEntries(Object.keys(expected.beforeKnowledge).map(id => [id, getPlayerKnowledge(restored, id)]))).toEqual(expected.beforeKnowledge);
    const next = play(restored);
    expect(next.scouting).toEqual(expected.nextScouting);
    expect(next.coaching).toEqual(expected.nextCoaching);
    expect(next.finance.ledger.slice(restored.finance.ledger.length)).toEqual(expected.nextLedger);
    expect(next.activeMatch).toEqual(expected.nextMatch);
    expect(Object.fromEntries(Object.keys(expected.afterKnowledge).map(id => [id, getPlayerKnowledge(next, id)]))).toEqual(expected.afterKnowledge);
    expect(parseSeason(serializeSeason(next))).toEqual(next);
  });

  it('activates prospectively without upgrading queued or completed legacy observations', () => {
    const previous = parseSeason(fixture('season20-scouting-pending'));
    const enabled = enableScouts(previous);
    expect(enabled.scouting.clubs[club]).toEqual(previous.scouting.clubs[club]);
    expect(parseSeason(serializeSeason(enabled))).toEqual(enabled);
    const next = play(enabled);
    expect(next.scouting.clubs[club].reviews).toEqual(play(previous).scouting.clubs[club].reviews);
    expect(parseSeason(serializeSeason(next))).toEqual(next);
  });

  it.each([
    ['activation without finance', state => { state.finance.enabledSince = null; }],
    ['appointment without its payment', state => { state.finance.ledger.pop(); }],
    ['wrong appointment fee', state => { state.finance.ledger.at(-1).amount += 100; }],
    ['wrong hire ledger boundary', state => { state.scouts.contracts.at(-1).hiredLedgerIndex -= 1; }],
    ['release without its boundary', state => { state.scouts.contracts.at(-1).releasedRound = 1; }],
    ['unearned observation quality', state => { state.scouting.clubs[club].assignments[0].observer.evidence = 201; }],
    ['wrong observing person', state => { state.scouting.clubs[club].assignments[0].observer.scoutId = 'scout-20'; }],
    ['observation before hire', state => { state.scouting.clubs[club].assignments[0].observer.assignedLedgerIndex = state.scouts.contracts.at(-1).hiredLedgerIndex; }],
    ['duplicate named workload', state => { state.scouting.clubs[club].assignments.push({ ...state.scouting.clubs[club].assignments[0], playerId: 'aeg-2' }); }],
  ])('rejects %s', (_name, mutate) => {
    expect(() => parseSeason(changed(pending, mutate))).toThrow();
  });

  it('rejects a retained pending job after its scout was released', () => {
    const released = releaseScout(pending, getClubScouts(pending)[0].id);
    expect(() => parseSeason(changed(released, state => { state.scouting.clubs[club].assignments = pending.scouting.clubs[club].assignments; }))).toThrow();
  });

  it('rejects an altered completed observer and unearned report quality', () => {
    for (const mutate of [
      state => { state.scouting.clubs[club].reviews[0].observer.evidence = 100; },
      state => { state.scouting.clubs[club].reviews[0].observer.contractId = state.scouts.contracts[0].id; },
      state => { state.scouting.clubs[club].reviews[0].observer.assignedLedgerIndex = state.finance.ledger.length; },
    ]) expect(() => parseSeason(changed(report, mutate))).toThrow();
  });

  it('rejects a plausible paid appointment that exceeds the combined coach and scout allocation', () => {
    expect(() => parseSeason(changed(expensive, state => {
      const contract = { ...state.scouts.contracts.at(-1), id: `scout-contract-${state.scouts.contracts.length + 1}`, scoutId: 'scout-06', hiredLedgerIndex: state.finance.ledger.length };
      state.scouts.contracts.push(contract);
      state.finance.ledger.push({ ...state.finance.ledger.at(-1), id: `finance-${state.finance.ledger.length + 1}`, sourceId: `scouting-${contract.id}`, amount: -2_000_000, scout: { contractId: contract.id, scoutId: contract.scoutId } });
    }))).toThrow(/shared annual staff allocation/i);
  });

  it('rejects scout-only fields masquerading as an older format', () => {
    const legacy = JSON.parse(fixture('season20-scouting-pending'));
    legacy.state.scouting.clubs[club].assignments[0].observer = pending.scouting.clubs[club].assignments[0].observer;
    expect(() => parseSeason(JSON.stringify(legacy))).toThrow();
  });
});
