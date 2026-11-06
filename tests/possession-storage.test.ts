import { beforeAll, describe, expect, it } from 'vitest';
import type { MatchEvent, MatchState, PossessionPlay } from '../src/domain/types';
import { createMatch, isPlayerEligible, requestTimeout, setAutoSubstitutions, setInjuryMode, setTactics, simulateToEnd, stepMatch, substitutePlayer } from '../src/engine/match';
import { MAX_SAVE_BYTES, parseMatch, serializeMatch } from '../src/storage/match-storage';

interface Envelope { engineVersion: string; state: MatchState }

function automatic(seed: number, version: MatchState['engineVersion'] = 'possession-3'): MatchState {
  return setAutoSubstitutions(setInjuryMode(createMatch(seed, version), 'off'), 'home', true);
}

function corrupted(state: MatchState, change: (state: MatchState) => void): string {
  const envelope = JSON.parse(serializeMatch(state)) as Envelope;
  change(envelope.state);
  return JSON.stringify(envelope);
}

function alterPlay(state: MatchState, change: (play: PossessionPlay, state: MatchState) => void): string {
  return corrupted(state, (snapshot) => change(snapshot.possessionPlay!, snapshot));
}

let passed: MatchState;
let driven: MatchState;
let assisted: MatchState;
let finished: MatchState;

beforeAll(() => {
  let state = automatic(312);
  for (let step = 0; step < 5000 && state.status !== 'finished'; step += 1) {
    const next = stepMatch(state);
    const added = next.events.slice(state.events.length);
    if (!passed && next.possessionPlay?.passerId && added.some((event) => event.type === 'pass')) passed = next;
    if (!driven && next.possessionPlay && added.some((event) => event.type === 'drive')) driven = next;
    if (!assisted && added.some((event) => event.assistPlayerId)) assisted = next;
    state = next;
  }
  finished = state;
  expect(passed).toBeDefined();
  expect(driven).toBeDefined();
  expect(assisted).toBeDefined();
  expect(finished.status).toBe('finished');
});

describe('versioned possession saves', () => {
  it.each(['pass', 'drive'] as const)('resumes a completed %s boundary with the exact positions, assignments and random stream', (boundary) => {
    const state = boundary === 'pass' ? passed : driven;
    const text = serializeMatch(state);
    const restored = parseMatch(text);
    expect(restored.engineVersion).toBe('possession-3');
    expect(restored).toEqual(state);
    expect(serializeMatch(restored)).toBe(text);
    expect(simulateToEnd(restored)).toEqual(simulateToEnd(state));
  });

  it('preserves the completed pass through zero-time tactical instructions', () => {
    const state = setTactics(passed, passed.possession, { tempo: 0.8 });
    expect(state.possessionPlay!.passerId).toBe(passed.possessionPlay!.passerId);
    expect(parseMatch(serializeMatch(state))).toEqual(state);
  });

  it('saves a live pass with queued coaching commands without applying them early', () => {
    const side = passed.possession;
    const incoming = passed[side].players.find((player) => !passed.lineups[side].includes(player.id))!.id;
    let state = substitutePlayer(passed, side, passed.lineups[side][0]!, incoming);
    state = requestTimeout(state, side);
    expect(state.pendingSubstitutions[side]).toHaveLength(1);
    expect(state.lineups[side]).not.toContain(incoming);
    expect(state.possessionPlay).toEqual(passed.possessionPlay);
    const restored = parseMatch(serializeMatch(state));
    expect(restored).toEqual(state);
    expect(simulateToEnd(restored)).toEqual(simulateToEnd(state));
  });

  it('saves a mandatory replacement and its legal completion with the new active players', () => {
    let state = setTactics(setInjuryMode(createMatch(4), 'off'), 'home', { pressure: 1 });
    for (let step = 0; step < 5000 && !state.requiredSubstitutions.length && state.status !== 'finished'; step += 1) state = stepMatch(state);
    const required = state.requiredSubstitutions[0]!;
    expect(required).toBeDefined();
    expect(state.possessionPlay).toBeNull();
    expect(parseMatch(serializeMatch(state))).toEqual(state);
    const incoming = state[required.side].players.find((player) => !state.lineups[required.side].includes(player.id) && isPlayerEligible(state, player.id))!.id;
    state = substitutePlayer(state, required.side, required.playerId, incoming);
    expect(state.lineups[required.side]).toContain(incoming);
    expect(parseMatch(serializeMatch(state))).toEqual(state);
    state = stepMatch(state);
    expect(parseMatch(serializeMatch(state))).toEqual(state);
  });

  it('keeps authoritative geometry and outcomes when optional animation history is removed', () => {
    const noScenes = structuredClone(passed);
    for (const event of noScenes.events) delete event.scene;
    const restored = parseMatch(serializeMatch(noScenes));
    expect(restored.possessionPlay).toEqual(passed.possessionPlay);
    const { events: _originalEvents, ...original } = simulateToEnd(passed);
    const { events: _restoredEvents, ...continued } = simulateToEnd(restored);
    expect(continued).toEqual(original);
  });

  it('retains rules-2 saves verbatim and dispatches their original simulation on resume', () => {
    let state = automatic(312, 'rules-2');
    for (let step = 0; step < 35; step += 1) state = stepMatch(state);
    expect(Object.hasOwn(state, 'possessionPlay')).toBe(false);
    const text = serializeMatch(state);
    const restored = parseMatch(text);
    expect(JSON.parse(text).engineVersion).toBe('rules-2');
    expect(restored).toEqual(state);
    expect(serializeMatch(restored)).toBe(text);
    expect(Object.hasOwn(restored, 'possessionPlay')).toBe(false);
    expect(simulateToEnd(restored)).toEqual(simulateToEnd(state));
  });

  it.each(['rules-2', 'possession-3'] as const)('rejects a %s envelope naming a different state engine', (version) => {
    const envelope = JSON.parse(serializeMatch(automatic(9, version))) as Envelope;
    envelope.engineVersion = version === 'rules-2' ? 'possession-3' : 'rules-2';
    expect(() => parseMatch(JSON.stringify(envelope))).toThrow(/engine version does not match/);
  });

  it('requires modern possession state and rejects it inside a legacy snapshot', () => {
    expect(() => parseMatch(corrupted(passed, (state) => { delete state.possessionPlay; }))).toThrow(/missing fields/);
    expect(() => parseMatch(corrupted(automatic(7, 'rules-2'), (state) => { state.possessionPlay = null; }))).toThrow(/unsupported fields/);
  });

  it('round-trips initial, free-throw, quarter and finished boundaries within the existing save bound', () => {
    let state = automatic(313);
    const seen = new Set<string>();
    for (let step = 0; step < 5000; step += 1) {
      const boundary = state.status === 'ready' || state.status === 'finished' ? state.status : `${state.period}:${state.phase}`;
      if (!seen.has(boundary)) {
        seen.add(boundary);
        expect(parseMatch(serializeMatch(state))).toEqual(state);
      }
      if (state.status === 'finished') break;
      state = stepMatch(state);
    }
    expect(seen).toContain('ready');
    expect(seen).toContain('1:free-throws');
    expect(seen).toContain('1:period-end');
    expect(seen).toContain('finished');
    const text = serializeMatch(finished);
    expect(new TextEncoder().encode(text).byteLength).toBeLessThan(MAX_SAVE_BYTES);
    expect(parseMatch(text)).toEqual(finished);
  }, 30_000);

  it('preserves legal reused defensive assignments when exclusions leave unequal lineups', () => {
    let state = automatic(4);
    state.home = { ...state.home, players: state.home.players.slice(0, 5) };
    state.away = { ...state.away, players: state.away.players.slice(0, 5) };
    const retained = new Set([...state.home.players, ...state.away.players].map((player) => player.id));
    state.stats = Object.fromEntries(Object.entries(state.stats).filter(([playerId]) => retained.has(playerId)));
    state = setTactics(setTactics(state, 'home', { pressure: 1 }), 'away', { pressure: 1 });
    for (let step = 0; step < 5000 && state.status !== 'finished'; step += 1) {
      const pairs = state.possessionPlay?.matchups;
      if (pairs && new Set(pairs.map((pair) => pair.defenderId)).size < pairs.length) break;
      state = stepMatch(state);
    }
    const pairs = state.possessionPlay!.matchups;
    expect(new Set(pairs.map((pair) => pair.defenderId)).size).toBeLessThan(pairs.length);
    expect(parseMatch(serializeMatch(state))).toEqual(state);
    expect(parseMatch(serializeMatch(simulateToEnd(state))).status).toBe('finished');
  });
});

describe('authoritative possession validation', () => {
  it('rejects expired live and dead-ball clocks that cannot resume a modern action', () => {
    for (const state of [passed, automatic(7)]) {
      expect(() => parseMatch(corrupted(state, (snapshot) => { snapshot.shotClockSeconds = 0; }))).toThrow(/positive before the next live action/);
    }
  });

  const invalid: Array<[string, (play: PossessionPlay, state: MatchState) => void]> = [
    ['opposing possession', (play) => { play.offense = play.offense === 'home' ? 'away' : 'home'; }],
    ['unknown handler', (play) => { play.handlerId = 'missing'; }],
    ['bench handler', (play, state) => { play.handlerId = state[play.offense].players.find((player) => !state.lineups[play.offense].includes(player.id))!.id; }],
    ['opposing handler', (play, state) => { play.handlerId = state.lineups[play.offense === 'home' ? 'away' : 'home'][0]!; }],
    ['self pass', (play) => { play.passerId = play.handlerId; }],
    ['unrecorded passer', (play, state) => { play.passerId = state.lineups[play.offense].find((id) => id !== play.handlerId && id !== play.passerId)!; }],
    ['negative action count', (play) => { play.actions = -1; }],
    ['fractional action count', (play) => { play.actions = 1.5; }],
    ['excessive action count', (play) => { play.actions = 25; }],
    ['missing actor', (play) => { play.positions.pop(); }],
    ['duplicate actor', (play) => { play.positions[1]!.playerId = play.positions[0]!.playerId; }],
    ['unknown actor', (play) => { play.positions[0]!.playerId = 'missing'; }],
    ['off-court position', (play) => { play.positions[0]!.x = 1.01; }],
    ['non-finite position', (play) => { play.positions[0]!.y = Number.NaN; }],
    ['missing matchup', (play) => { play.matchups.pop(); }],
    ['duplicate attacker', (play) => { play.matchups[1]!.attackerId = play.matchups[0]!.attackerId; }],
    ['repeated defender with five available', (play) => { play.matchups[1]!.defenderId = play.matchups[0]!.defenderId; }],
    ['attacker assigned to self', (play) => { play.matchups[0]!.defenderId = play.matchups[0]!.attackerId; }],
    ['unsupported possession field', (play) => { Object.assign(play, { future: true }); }],
    ['unsupported position field', (play) => { Object.assign(play.positions[0]!, { future: true }); }],
    ['unsupported matchup field', (play) => { Object.assign(play.matchups[0]!, { future: true }); }],
  ];
  it.each(invalid)('rejects %s without changing the active match', (_name, change) => {
    const before = serializeMatch(passed);
    expect(() => parseMatch(alterPlay(passed, change))).toThrow(/Invalid match save/);
    expect(serializeMatch(passed)).toBe(before);
  });

  it('rejects live possession data retained after the match ends', () => {
    expect(() => parseMatch(corrupted(finished, (state) => {
      state.possessionPlay = structuredClone(passed.possessionPlay);
      state.possessionPlay!.offense = state.possession;
    }))).toThrow(/stopped-play boundary/);
  });
});

describe('shot context and genuine assists', () => {
  const invalid: Array<[string, (shot: MatchEvent, state: MatchState) => void]> = [
    ['missing defender', (event) => { delete event.shot!.defenderId; }],
    ['opposing-team error', (event) => { event.shot!.defenderId = event.playerId; }],
    ['bench defender without scenes', (event, state) => {
      const side = event.side === 'home' ? 'away' : 'home';
      const actors = new Set(event.scene!.start.map((position) => position.playerId));
      event.shot!.defenderId = state[side].players.find((player) => !actors.has(player.id))!.id;
      for (const entry of state.events) delete entry.scene;
    }],
    ['missing contest', (event) => { delete event.shot!.contest; }],
    ['contest inconsistent with geometry', (event) => { event.shot!.contest = event.shot!.contest === 'open' ? 'contested' : 'open'; }],
    ['distance inconsistent with shot location', (event) => { event.shot!.distanceM = 31; }],
    ['negative distance', (event) => { event.shot!.distanceM = -1; }],
    ['unsupported shot property', (event) => { Object.assign(event.shot!, { future: true }); }],
    ['self assist', (event) => { event.assistPlayerId = event.playerId; }],
    ['unrecorded assister', (event, state) => {
      const actors = new Set(event.scene!.start.map((position) => position.playerId));
      event.assistPlayerId = state[event.side!].players.find((player) => actors.has(player.id) && player.id !== event.assistPlayerId && player.id !== event.playerId)!.id;
    }],
  ];
  it.each(invalid)('rejects %s', (_name, change) => {
    const text = corrupted(assisted, (state) => {
      const event = state.events.find((entry) => entry.assistPlayerId)!;
      change(event, state);
    });
    expect(() => parseMatch(text)).toThrow(/Invalid match save/);
  });

  it('rejects assist credit on a missed field goal or a non-shot action', () => {
    for (const type of ['miss', 'pass']) {
      expect(() => parseMatch(corrupted(finished, (state) => {
        const event = state.events.find((entry) => type === 'miss' ? entry.shot && !entry.shot.made : entry.type === 'pass')!;
        event.assistPlayerId = state[event.side!].players.find((player) => player.id !== event.playerId)!.id;
      }))).toThrow(/assisting a made field goal/);
    }
  });

  it('reconciles assist totals with completed-pass shot events', () => {
    expect(() => parseMatch(corrupted(assisted, (state) => {
      const event = state.events.find((entry) => entry.assistPlayerId)!;
      state.stats[event.assistPlayerId!]!.assists += 1;
    }))).toThrow(/assisted shot events/);
  });

  it('rejects drive animation whose ball leaves the handler', () => {
    expect(() => parseMatch(corrupted(driven, (state) => {
      const event = state.events.find((entry) => entry.type === 'drive')!;
      event.scene!.ball.to.y = event.scene!.ball.to.y === 0 ? 1 : 0;
    }))).toThrow(/driving player/);
  });
});
