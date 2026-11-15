import { describe, expect, it } from 'vitest';
import type { MatchState } from '../src/domain/types';
import {
  canSubstituteNow, createMatch as createVersionedMatch, isPlayerEligible, remainingTimeouts, requestTimeout, setAutoSubstitutions,
  setInjuryMode, setTactics, simulateToEnd, simulateToQuarterEnd, stepMatch, substitutePlayer,
} from '../src/engine/match';
import { MAX_SAVE_BYTES, parseMatch, serializeMatch } from '../src/storage/match-storage';
import { validateMatchState } from '../src/storage/validate-match';

// Preserve the legacy sporting contract independently of the current default engine.
const createMatch = (seed = 42) => createVersionedMatch(seed, 'rules-2');


interface Envelope {
  format: string;
  formatVersion: number;
  engineVersion: string;
  state: MatchState;
}

function corrupt(change: (envelope: Envelope) => void): string {
  const envelope = JSON.parse(serializeMatch(createMatch(42))) as Envelope;
  change(envelope);
  return JSON.stringify(envelope);
}

function automatic(seed: number): MatchState {
  return setAutoSubstitutions(setInjuryMode(createMatch(seed), 'off'), 'home', true);
}

function until(state: MatchState, predicate: (state: MatchState) => boolean): MatchState {
  for (let index = 0; index < 5000; index += 1) {
    if (predicate(state)) return state;
    if (state.status === 'finished' || state.requiredSubstitutions.length > 0) break;
    state = stepMatch(state);
  }
  throw new Error('The deterministic fixture did not reach its expected boundary.');
}

describe('exhibition save files', () => {
  it('retains a changed lineup, instructions, events and RNG, then continues identically', () => {
    let match = simulateToQuarterEnd(automatic(312));
    match = setTactics(match, 'home', { outsideShare: 0.8, pressure: 0.3 });
    const incoming = match.home.players.find((player) => !match.lineups.home.includes(player.id) && isPlayerEligible(match, player.id))!;
    match = substitutePlayer(match, 'home', match.lineups.home[0]!, incoming.id);
    const restored = parseMatch(serializeMatch(match));

    expect(restored).toEqual(match);
    expect(restored).not.toBe(match);
    expect(simulateToEnd(restored)).toEqual(simulateToEnd(match));
  });

  it('round-trips initial seed zero and completed matches', () => {
    const initial = automatic(0);
    expect(parseMatch(serializeMatch(initial))).toEqual(initial);
    const completed = simulateToEnd(initial);
    expect(parseMatch(serializeMatch(completed))).toEqual(completed);
  });

  const invalidCases: Array<[string, (envelope: Envelope) => void]> = [
    ['unsupported envelope version', (e) => { e.formatVersion = 99; }],
    ['unsupported envelope engine', (e) => { e.engineVersion = 'future'; }],
    ['unsupported state engine', (e) => { (e.state as unknown as Record<string, unknown>).engineVersion = 'future'; }],
    ['duplicate lineup identity', (e) => { e.state.lineups.home[1] = e.state.lineups.home[0]!; }],
    ['opponent in lineup', (e) => { e.state.lineups.home[0] = e.state.away.players[0]!.id; }],
    ['unknown stats reference', (e) => { e.state.stats.unknown = { ...e.state.stats[e.state.home.players[0]!.id]! }; }],
    ['missing stats', (e) => { delete e.state.stats[e.state.home.players[0]!.id]; }],
    ['score inconsistent with box score', (e) => { e.state.score.home = 5; }],
    ['negative score', (e) => { e.state.score.home = -1; }],
    ['wrong time for period', (e) => { e.state.clockSeconds = 601; }],
    ['invalid RNG stream', (e) => { e.state.rngState = 0; }],
    ['out-of-range RNG', (e) => { e.state.rngState = 0x1_0000_0000; }],
    ['fractional RNG', (e) => { e.state.rngState = 3.14; }],
    ['invalid tactics', (e) => { e.state.tactics.away.pressure = 1.01; }],
    ['incorrect lineup minutes', (e) => { e.state.stats[e.state.home.players[0]!.id]!.secondsPlayed = 1; }],
    ['invalid shot totals', (e) => { e.state.stats[e.state.home.players[0]!.id]!.fieldGoalsMade = 1; }],
    ['invalid condition', (e) => { e.state.stats[e.state.home.players[0]!.id]!.condition = 101; }],
    ['unknown event player', (e) => { e.state.events[0]!.playerId = 'unknown'; }],
    ['wrong event order', (e) => { e.state.events[0]!.id = 7; }],
    ['future event', (e) => { e.state.events[0]!.period = 2; }],
    ['invalid finished state', (e) => { e.state.status = 'finished'; }],
    ['shot clock above 24', (e) => { e.state.shotClockSeconds = 25; }],
    ['unsupported live phase', (e) => { (e.state as unknown as Record<string, unknown>).phase = 'random'; }],
    ['free throw phase without a sequence', (e) => { e.state.phase = 'free-throws'; }],
    ['free throw sequence in wrong phase', (e) => { e.state.freeThrows = { side: 'home', shooterId: e.state.lineups.home[0]!, total: 2, remaining: 2 }; }],
    ['foreign player queued for substitution', (e) => { e.state.pendingSubstitutions.home = [{ outId: e.state.lineups.home[0]!, inId: e.state.away.players[5]!.id }]; }],
    ['two requests for one outgoing player', (e) => { e.state.pendingSubstitutions.home = [5, 6].map((index) => ({ outId: e.state.lineups.home[0]!, inId: e.state.home.players[index]!.id })); }],
    ['foul-out decision for eligible player', (e) => { e.state.requiredSubstitutions = [{ side: 'home', playerId: e.state.lineups.home[0]!, reason: 'fouled-out' }]; }],
    ['timeout usage above first-half limit', (e) => { e.state.timeoutUsage.home.firstHalf = 3; }],
    ['future-half timeout usage', (e) => { e.state.timeoutUsage.home.secondHalf = 1; }],
    ['unknown player substitution lock', (e) => { e.state.substitutionLocks = ['missing']; }],
    ['unreconciled team fouls', (e) => { e.state.teamFouls.home = 1; }],
    ['unreconciled integrated minutes', (e) => { e.state.courtSeconds.home = 1; }],
    ['non-boolean timeout request', (e) => { (e.state.timeoutRequested as unknown as Record<string, unknown>).home = 'yes'; }],
    ['injury without a player record', (e) => { e.state.injuries.missing = { kind: 'ankle-sprain', occurredAtSeconds: 0 }; }],
    ['result before match completion', (e) => { e.state.result = { winner: 'home', kind: 'default', officialScore: { home: 2, away: 0 } }; }],
    ['timeout opportunity before tipoff', (e) => { e.state.stoppage!.timeoutSides = ['home']; }],
    ['missing team from pregame substitution window', (e) => { e.state.stoppage!.substitutionSides = ['home']; }],
  ];

  it.each(invalidCases)('rejects %s without changing the active state', (_name, change) => {
    const active = createMatch(17);
    const before = serializeMatch(active);
    expect(() => parseMatch(corrupt(change))).toThrow();
    expect(serializeMatch(active)).toBe(before);
  });

  it('rejects duplicate player identities across teams', () => {
    const text = corrupt((envelope) => {
      const away = envelope.state.away.players[0] as unknown as Record<string, unknown>;
      away.id = envelope.state.home.players[0]!.id;
    });
    expect(() => parseMatch(text)).toThrow(/duplicate identity/);
  });

  it('explains that legacy exhibitions need the earlier engine instead of silently migrating them', () => {
    const legacy = corrupt((envelope) => {
      envelope.formatVersion = 1;
      envelope.engineVersion = 'prototype-1';
      (envelope.state as unknown as Record<string, unknown>).schemaVersion = 1;
      (envelope.state as unknown as Record<string, unknown>).engineVersion = 'prototype-1';
    });
    expect(() => parseMatch(legacy)).toThrow(/earlier prototype engine.*start a new exhibition.*has not been changed/);
  });

  it('preserves queued live-ball coaching commands and their future result', () => {
    let state = until(automatic(21), (match) => match.phase === 'live-ball' && !canSubstituteNow(match, 'home') && match.stoppage === null);
    const incoming = state.home.players.find((player) => !state.lineups.home.includes(player.id) && isPlayerEligible(state, player.id))!;
    state = substitutePlayer(state, 'home', state.lineups.home[0]!, incoming.id);
    state = requestTimeout(state, 'home');
    expect(state.pendingSubstitutions.home).toHaveLength(1);
    expect(state.timeoutRequested.home).toBe(true);
    const restored = parseMatch(serializeMatch(state));
    expect(restored).toEqual(state);
    expect(simulateToEnd(restored)).toEqual(simulateToEnd(state));
    const forged = JSON.parse(serializeMatch(state)) as Envelope;
    forged.state.stoppage = { reason: 'whistle', substitutionSides: ['home', 'away'], timeoutSides: ['home', 'away'] };
    expect(() => parseMatch(JSON.stringify(forged))).toThrow(/live play/);
  });

  it('resumes an unfinished free-throw series without repeating attempts or changing the random stream', () => {
    const state = until(automatic(7), (match) => match.freeThrows !== null && match.freeThrows.remaining < match.freeThrows.total);
    const restored = parseMatch(serializeMatch(state));
    expect(restored.freeThrows).toEqual(state.freeThrows);
    expect(simulateToEnd(restored)).toEqual(simulateToEnd(state));
    const corrupted = JSON.parse(serializeMatch(state)) as Envelope;
    corrupted.state.freeThrows!.remaining = 0;
    expect(() => parseMatch(JSON.stringify(corrupted))).toThrow(/freeThrows.remaining/);
    corrupted.state.freeThrows!.remaining = 4;
    expect(() => parseMatch(JSON.stringify(corrupted))).toThrow(/freeThrows.remaining/);
  });

  it('retains a required replacement and stays paused after loading until a legal substitution', () => {
    const state = until(setTactics(setInjuryMode(createMatch(4), 'off'), 'home', { pressure: 1 }), (match) => match.requiredSubstitutions.length > 0);
    const restored = parseMatch(serializeMatch(state));
    expect(restored.requiredSubstitutions).toEqual(state.requiredSubstitutions);
    expect(simulateToEnd(restored)).toEqual(restored);
    const decision = state.requiredSubstitutions[0]!;
    const incoming = state[decision.side].players.find((player) => !state.lineups[decision.side].includes(player.id) && isPlayerEligible(state, player.id))!;
    const resumed = substitutePlayer(restored, decision.side, decision.playerId, incoming.id);
    const expected = substitutePlayer(state, decision.side, decision.playerId, incoming.id);
    expect(resumed.requiredSubstitutions).toHaveLength(0);
    expect(simulateToEnd(resumed)).toEqual(simulateToEnd(expected));
  });

  it('accepts every generated action and coaching boundary across ordinary and injury-enabled matches', () => {
    const phases = new Set<string>();
    for (let seed = 101; seed <= 115; seed += 1) {
      let state = setAutoSubstitutions(setInjuryMode(createMatch(seed), seed <= 110 ? 'off' : 'standard'), 'home', true);
      const check = () => { validateMatchState(state); phases.add(state.phase); };
      check();
      for (let action = 0; action < 2500 && state.status !== 'finished'; action += 1) {
        if (action % 43 === 3 && remainingTimeouts(state, 'home') > 0 && !state.timeoutRequested.home) {
          state = requestTimeout(state, 'home');
          check();
        }
        if (action % 61 === 9 && state.pendingSubstitutions.home.length === 0) {
          const out = state.lineups.home.find((playerId) => !state.substitutionLocks.includes(playerId) && state.freeThrows?.shooterId !== playerId);
          const incoming = state.home.players.find((player) => !state.lineups.home.includes(player.id) && !state.substitutionLocks.includes(player.id) && isPlayerEligible(state, player.id));
          if (out && incoming) {
            state = substitutePlayer(state, 'home', out, incoming.id);
            check();
          }
        }
        if (action % 79 === 12) {
          state = setTactics(state, 'home', { tempo: seed % 2 ? 0.25 : 0.75 });
          check();
        }
        const next = stepMatch(state);
        expect(next).not.toBe(state);
        state = next;
        check();
      }
      expect(state.status).toBe('finished');
      expect(parseMatch(serializeMatch(state))).toEqual(state);
    }
    expect([...phases].sort()).toEqual(['dead-ball', 'free-throws', 'live-ball', 'period-end']);
  }, 90_000);

  it('saves depleted lineups and a default result without inventing player points', () => {
    let shortHanded = false;
    let defaulted: MatchState | undefined;
    for (let seed = 1; seed <= 12 && !defaulted; seed += 1) {
      let state = automatic(seed);
      // A valid five-player roster has no bench replacements when players foul out.
      state.home = { ...state.home, players: state.home.players.slice(0, 5) };
      state.away = { ...state.away, players: state.away.players.slice(0, 5) };
      const retained = new Set([...state.home.players, ...state.away.players].map((player) => player.id));
      state.stats = Object.fromEntries(Object.entries(state.stats).filter(([playerId]) => retained.has(playerId)));
      state = setTactics(setTactics(state, 'home', { pressure: 1 }), 'away', { pressure: 1 });
      validateMatchState(state);
      for (let action = 0; action < 2500 && state.status !== 'finished'; action += 1) {
        state = stepMatch(state);
        validateMatchState(state);
        if (state.status !== 'finished' && (state.lineups.home.length < 5 || state.lineups.away.length < 5)) {
          shortHanded = true;
          expect(parseMatch(serializeMatch(state))).toEqual(state);
        }
      }
      if (state.result?.kind === 'default') defaulted = state;
    }
    expect(shortHanded).toBe(true);
    expect(defaulted?.result?.kind).toBe('default');
    expect(parseMatch(serializeMatch(defaulted!))).toEqual(defaulted);
    for (const side of ['home', 'away'] as const) {
      expect(defaulted![side].players.reduce((sum, player) => sum + defaulted!.stats[player.id]!.points, 0)).toBe(defaulted!.score[side]);
    }
  }, 30_000);

  it('retains a recorded injury and excludes that player after restoration', () => {
    let injured: MatchState | undefined;
    for (let seed = 1; seed <= 80 && !injured; seed += 1) {
      let state = setAutoSubstitutions(createMatch(seed), 'home', true);
      for (let action = 0; action < 2500 && state.status !== 'finished'; action += 1) {
        state = stepMatch(state);
        if (Object.keys(state.injuries).length > 0) { injured = state; break; }
      }
    }
    expect(injured).toBeDefined();
    const restored = parseMatch(serializeMatch(injured!));
    expect(restored.injuries).toEqual(injured!.injuries);
    for (const playerId of Object.keys(restored.injuries)) {
      expect(isPlayerEligible(restored, playerId)).toBe(false);
      expect([...restored.lineups.home, ...restored.lineups.away]).not.toContain(playerId);
    }
    expect(simulateToEnd(restored)).toEqual(simulateToEnd(injured!));
    const corrupted = JSON.parse(serializeMatch(injured!)) as Envelope;
    const first = Object.keys(corrupted.state.injuries)[0]!;
    corrupted.state.injuries[first]!.occurredAtSeconds -= 1;
    expect(() => parseMatch(JSON.stringify(corrupted))).toThrow(/injury/);
  }, 30_000);

  it('rejects non-finite JSON numbers and malformed JSON', () => {
    const text = serializeMatch(createMatch(9)).replace(/"rngState":\d+/u, '"rngState":1e999');
    expect(() => parseMatch(text)).toThrow(/rngState/);
    expect(() => parseMatch('{unfinished')).toThrow(/valid JSON/);
    expect(() => parseMatch('null')).toThrow(/exhibition save/);
  });

  it.each(['__proto__', 'constructor', 'prototype'])('rejects unsafe property %s anywhere in the document', (key) => {
    const text = serializeMatch(createMatch(9)).replace('"state":{', `"state":{"${key}":{},`);
    expect(() => parseMatch(text)).toThrow(/unsafe property/);
    expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false);
  });

  it('limits file bytes, including multibyte text, before parsing', () => {
    expect(() => parseMatch(' '.repeat(MAX_SAVE_BYTES + 1))).toThrow(/too large/);
    expect(() => parseMatch(JSON.stringify({ text: '🏀'.repeat(MAX_SAVE_BYTES / 4) }))).toThrow(/too large/);
  });

  it('rejects pathological nesting', () => {
    const text = `${'['.repeat(45)}0${']'.repeat(45)}`;
    expect(() => parseMatch(text)).toThrow(/nested/);
  });
});
