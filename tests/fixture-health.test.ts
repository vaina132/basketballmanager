import { describe, expect, it } from 'vitest';
import type { MatchState, Side } from '../src/domain/types';
import { FICTIONAL_HOME, FICTIONAL_AWAY } from '../src/data/fictional-teams';
import { createFixtureMatch, createMatch, isPlayerEligible, simulateToEnd, simulateToQuarterEnd, stepMatch, substitutePlayer } from '../src/engine/match';
import { parseMatch, serializeMatch } from '../src/storage/match-storage';

const home = FICTIONAL_HOME, away = FICTIONAL_AWAY;
const automatic = { home: true, away: true };
const injured = home.players[0]!.id;
const carried = () => createFixtureMatch(47, home, away, { injuryMode: 'off', autoSubstitutions: automatic, preExistingInjuries: { [injured]: 'ankle-sprain', [away.players[1]!.id]: 'hamstring' } });
const corrupt = (state: MatchState, edit: (state: MatchState) => void): string => {
  const envelope = JSON.parse(serializeMatch(state)) as { state: MatchState };
  edit(envelope.state);
  return JSON.stringify(envelope);
};

describe('scheduled fixture carried injuries', () => {
  it('preserves the default exhibition and adds no empty carried-health fields', () => {
    const plain = createFixtureMatch(42, home, away);
    expect(plain).toEqual(createMatch(42));
    expect(createFixtureMatch(42, home, away, { preExistingInjuries: {} })).toEqual(plain);
    expect(Object.hasOwn(createMatch(42, 'rules-2'), 'preExistingInjuries')).toBe(false);
    expect(parseMatch(serializeMatch(createMatch(42, 'rules-2')))).toEqual(createMatch(42, 'rules-2'));
  });

  it('fills injured requested starters from eligible reserves without consuming extra randomness', () => {
    const state = carried();
    expect(state.rngState).toBe(createFixtureMatch(47, home, away).rngState);
    expect(state.preExistingInjuries).toEqual([injured, away.players[1]!.id]);
    expect(state.lineups.home).toEqual(home.players.slice(1, 6).map(player => player.id));
    expect(state.lineups.away).not.toContain(away.players[1]!.id);
    expect(state.lineups.away).toHaveLength(5);
    expect(state.events.map(event => event.type)).toEqual(['tipoff']);
    expect(state.injuries[injured]).toEqual({ kind: 'ankle-sprain', occurredAtSeconds: 0 });
    expect(state.requiredSubstitutions).toEqual([]);
    expect(isPlayerEligible(state, injured)).toBe(false);
    expect(() => substitutePlayer(state, 'home', state.lineups.home[0]!, injured)).toThrow(/injured/);
    expect(parseMatch(serializeMatch(state))).toEqual(state);
  });

  it('does not give carried injuries minutes, actions, shots, or fresh injury events', () => {
    const state = simulateToEnd(carried());
    expect(state.status).toBe('finished');
    for (const id of state.preExistingInjuries!) {
      for (const [key, value] of Object.entries(state.stats[id]!)) if (key !== 'condition') expect(value).toBe(0);
      expect(state.events.some(event => event.playerId === id || event.receiverId === id || event.assistPlayerId === id || event.shot?.defenderId === id)).toBe(false);
      expect(state.events.some(event => event.scene?.start.some(point => point.playerId === id))).toBe(false);
    }
    expect(parseMatch(serializeMatch(state))).toEqual(state);
  });

  it('resumes a carried-health game identically through watched, quarter and instant progression', () => {
    const initial = carried();
    let boundary = initial;
    for (let i = 0; i < 30; i += 1) boundary = stepMatch(boundary);
    const restored = parseMatch(serializeMatch(boundary));
    const instant = simulateToEnd(restored);
    let stepped = initial, quarters = initial;
    while (stepped.status !== 'finished') stepped = stepMatch(stepped);
    while (quarters.status !== 'finished') quarters = simulateToQuarterEnd(quarters);
    expect(instant).toEqual(stepped);
    expect(quarters).toEqual(stepped);
    expect(initial.preExistingInjuries).not.toBe(boundary.preExistingInjuries);
    expect(initial.stats[injured]!.secondsPlayed).toBe(0);
  });

  it.each([2, 3, 4])('runs safely with %i healthy players under the development minimum', available => {
    const health = Object.fromEntries(home.players.slice(available).map(player => [player.id, 'hamstring' as const]));
    const state = createFixtureMatch(8, home, away, { injuryMode: 'off', autoSubstitutions: automatic, preExistingInjuries: health });
    expect(state.lineups.home).toHaveLength(available);
    expect(state.status).toBe('ready');
    expect(parseMatch(serializeMatch(state))).toEqual(state);
    const final = simulateToEnd(state);
    expect(final.status).toBe('finished');
    expect(parseMatch(serializeMatch(final))).toEqual(final);
  });

  it.each(['home', 'away'] as Side[])('awards an immediate %s shortage default without fake play or injury events', side => {
    const team = side === 'home' ? home : away;
    for (const available of [0, 1]) {
      const health = Object.fromEntries(team.players.slice(available).map(player => [player.id, 'ankle-sprain' as const]));
      const state = createFixtureMatch(8, home, away, { injuryMode: 'off', preExistingInjuries: health });
      expect(state.status).toBe('finished');
      expect(state.result).toEqual({ kind: 'default', winner: side === 'home' ? 'away' : 'home', officialScore: side === 'home' ? { home: 0, away: 2 } : { home: 2, away: 0 } });
      expect(state.events.map(event => event.type)).toEqual(['final']);
      expect(state.clockSeconds).toBe(600);
      expect(state.stepCount).toBe(0);
      expect(state.possessionPlay).toBeNull();
      expect(Object.values(state.stats).every(stats => stats.secondsPlayed === 0)).toBe(true);
      expect(stepMatch(state)).toBe(state);
      expect(parseMatch(serializeMatch(state))).toEqual(state);
    }
  });

  it('rejects invalid factory health identities and kinds', () => {
    expect(() => createFixtureMatch(1, home, away, { preExistingInjuries: { unknown: 'ankle-sprain' } })).toThrow(/known players/);
    expect(() => createFixtureMatch(1, home, away, { preExistingInjuries: { [injured]: 'broken' as 'ankle-sprain' } })).toThrow(/injury kinds/);
  });

  it('rejects forged carried availability, exposure, actors and duplicate fresh injuries', () => {
    const state = carried();
    const changes: ((state: MatchState) => void)[] = [
      s => { s.preExistingInjuries = []; },
      s => { s.preExistingInjuries!.push(injured); },
      s => { s.preExistingInjuries!.push('unknown'); },
      s => { delete s.injuries[injured]; },
      s => { s.injuries[injured]!.occurredAtSeconds = 1; },
      s => { s.lineups.home[0] = injured; },
      s => { s.stats[injured]!.rebounds = 1; },
      s => { s.events[0]!.scene!.start[0]!.playerId = injured; },
      s => { s.events.push({ id: 2, type: 'injury', period: 1, clockSeconds: 600, playerId: injured, side: 'home', text: 'Duplicate injury', score: { home: 0, away: 0 } }); },
    ];
    for (const change of changes) expect(() => parseMatch(corrupt(state, change))).toThrow(/Invalid match save/);
    expect(() => parseMatch(corrupt(createMatch(1, 'rules-2'), s => { s.preExistingInjuries = [injured]; }))).toThrow(/unsupported fields/);
  });

  it('rejects carried players in historical scene endpoints and non-scoring commands', () => {
    const state = simulateToQuarterEnd(carried());
    // Keep the scene's identities internally consistent and all statistics zero
    // for the carried player; the explicit availability guard must still reject it.
    expect(() => parseMatch(corrupt(state, s => {
      const scene = s.events[0]!.scene!;
      const originalId = scene.start.find(point => s.home.players.some(player => player.id === point.playerId))!.playerId;
      for (const endpoint of [scene.start, scene.end]) for (const point of endpoint) if (point.playerId === originalId) point.playerId = injured;
    }))).toThrow(/cannot involve a player unavailable before tipoff/);
    expect(() => parseMatch(corrupt(carried(), s => {
      s.events.push({ id: 2, type: 'command', playerId: injured, side: 'home', period: 1, clockSeconds: 600, text: 'Forged actor', score: { home: 0, away: 0 } });
    }))).toThrow(/cannot involve a player unavailable before tipoff/);
  });

  it('does not use the pre-match-default exception to accept a played match with a reset clock', () => {
    const state = simulateToEnd(carried());
    expect(() => parseMatch(corrupt(state, s => { s.period = 1; s.clockSeconds = 600; s.stepCount = 0; }))).toThrow(/Invalid match save/);
  });
});
