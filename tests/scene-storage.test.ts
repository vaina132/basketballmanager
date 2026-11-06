import { describe, expect, it } from 'vitest';
import type { CourtScene, MatchState } from '../src/domain/types';
import { createMatch as createVersionedMatch, isPlayerEligible, setAutoSubstitutions, setInjuryMode, setTactics, simulateToEnd, simulateToQuarterEnd, stepMatch, substitutePlayer } from '../src/engine/match';
import { MAX_SAVE_BYTES, parseMatch, serializeMatch } from '../src/storage/match-storage';

// Preserve the legacy sporting contract independently of the current default engine.
const createMatch = (seed = 42) => createVersionedMatch(seed, 'rules-2');


function automatic(seed: number): MatchState {
  return setAutoSubstitutions(setInjuryMode(createMatch(seed), 'off'), 'home', true);
}

function sceneFor(state: MatchState): CourtScene {
  const actors = [...state.lineups.home, ...state.lineups.away].map((playerId, index) => ({ playerId, x: (index + 1) / 12, y: 0.5 }));
  return {
    kind: 'setup', durationMs: 700, offense: 'home',
    start: actors, end: actors.map((actor) => ({ ...actor })),
    ball: { from: { x: 0.5, y: 0.5, height: 1 }, to: { x: 0.5, y: 0.5, height: 1 }, arcHeight: 0 },
  };
}

function sceneFixture(): MatchState {
  const state = automatic(24);
  state.events[0]!.scene = sceneFor(state);
  return state;
}

function changeScene(change: (scene: CourtScene, state: MatchState) => void): string {
  const envelope = JSON.parse(serializeMatch(sceneFixture())) as { state: MatchState };
  change(envelope.state.events[0]!.scene!, envelope.state);
  return JSON.stringify(envelope);
}

function withoutEvents(state: MatchState): Omit<MatchState, 'events'> {
  const { events: _events, ...simulation } = state;
  return simulation;
}

describe('optional court scenes in version 2 saves', () => {
  it('loads scene-free version 2 data verbatim and resumes a custom starting lineup', () => {
    const legacy = automatic(240);
    for (const event of legacy.events) delete event.scene;
    legacy.lineups.home[0] = legacy.home.players[7]!.id;
    const text = serializeMatch(legacy);
    const restored = parseMatch(text);
    expect(restored).toEqual(legacy);
    expect(serializeMatch(restored)).toBe(text);
    expect(restored.events.every((event) => event.scene === undefined)).toBe(true);
    const continued = simulateToQuarterEnd(restored);
    expect(continued.events.some((event) => event.scene !== undefined)).toBe(true);
    expect(parseMatch(serializeMatch(continued))).toEqual(continued);
  });

  it('preserves scene metadata and the exact random stream across save/resume', () => {
    const state = simulateToQuarterEnd(automatic(241));
    const before = JSON.stringify(state);
    const restored = parseMatch(serializeMatch(state));
    expect(restored).toEqual(state);
    expect(JSON.stringify(state)).toBe(before);
    expect(simulateToEnd(restored)).toEqual(simulateToEnd(state));

    const noScenes = structuredClone(state);
    for (const event of noScenes.events) delete event.scene;
    expect(parseMatch(serializeMatch(noScenes))).toEqual(noScenes);
    expect(withoutEvents(simulateToEnd(noScenes))).toEqual(withoutEvents(simulateToEnd(state)));
  });

  it('checks historical actors rather than replacing them with the latest lineup', () => {
    let state = sceneFixture();
    const outgoing = state.lineups.home[0]!;
    const incoming = state.home.players[5]!.id;
    state = substitutePlayer(state, 'home', outgoing, incoming);
    expect(state.lineups.home).toContain(incoming);
    expect(parseMatch(serializeMatch(state)).events[0]!.scene!.start.map((actor) => actor.playerId)).toContain(outgoing);
    const envelope = JSON.parse(serializeMatch(state)) as { state: MatchState };
    for (const endpoint of ['start', 'end'] as const) {
      const actor = envelope.state.events[0]!.scene![endpoint].find((actor) => actor.playerId === outgoing)!;
      actor.playerId = incoming;
    }
    expect(() => parseMatch(JSON.stringify(envelope))).toThrow(/active players/);
  });

  it('saves a defensive pregame substitution with the new actors and the other team in possession', () => {
    let state = automatic(247);
    const side = state.possession === 'home' ? 'away' : 'home';
    const outgoing = state.lineups[side][0]!;
    const incoming = state[side].players[5]!.id;
    state = substitutePlayer(state, side, outgoing, incoming);
    const substitution = state.events.at(-1)!;
    expect(substitution.type).toBe('substitution');
    expect(substitution.scene!.offense).not.toBe(substitution.side);
    expect(substitution.scene!.end.map((actor) => actor.playerId)).toContain(incoming);
    expect(substitution.scene!.end.map((actor) => actor.playerId)).not.toContain(outgoing);
    expect(parseMatch(serializeMatch(state))).toEqual(state);
  });

  it('saves the updated scene after a mandatory replacement without rewriting old actors', () => {
    let state = setTactics(setInjuryMode(createMatch(4), 'off'), 'home', { pressure: 1 });
    for (let action = 0; action < 2500 && !state.requiredSubstitutions.length && state.status !== 'finished'; action += 1) state = stepMatch(state);
    const decision = state.requiredSubstitutions[0]!;
    expect(decision).toBeDefined();
    const incoming = state[decision.side].players.find((player) => !state.lineups[decision.side].includes(player.id) && isPlayerEligible(state, player.id))!.id;
    const history = JSON.stringify(state.events);
    const replacement = substitutePlayer(state, decision.side, decision.playerId, incoming);
    expect(JSON.stringify(state.events)).toBe(history);
    const event = [...replacement.events].reverse().find((event) => event.type === 'substitution' && event.outgoingPlayerId === decision.playerId)!;
    expect(event.scene!.end.map((actor) => actor.playerId)).toContain(incoming);
    expect(event.scene!.end.map((actor) => actor.playerId)).not.toContain(decision.playerId);
    expect(parseMatch(serializeMatch(replacement))).toEqual(replacement);
  });

  it('saves an outgoing-only substitution scene when no eligible reserve remains', () => {
    let state = automatic(4);
    state.home = { ...state.home, players: state.home.players.slice(0, 5) };
    state.away = { ...state.away, players: state.away.players.slice(0, 5) };
    const retained = new Set([...state.home.players, ...state.away.players].map((player) => player.id));
    state.stats = Object.fromEntries(Object.entries(state.stats).filter(([playerId]) => retained.has(playerId)));
    state = setTactics(setTactics(state, 'home', { pressure: 1 }), 'away', { pressure: 1 });
    for (let action = 0; action < 2500 && !state.events.some((event) => event.type === 'substitution' && !event.playerId) && state.status !== 'finished'; action += 1) state = stepMatch(state);
    const departure = state.events.find((event) => event.type === 'substitution' && !event.playerId)!;
    expect(departure).toBeDefined();
    expect(departure.scene!.end.map((actor) => actor.playerId)).not.toContain(departure.outgoingPlayerId);
    expect(departure.scene!.end).toHaveLength(9);
    expect(parseMatch(serializeMatch(state))).toEqual(state);
  });

  const invalidScenes: Array<[string, (scene: CourtScene, state: MatchState) => void]> = [
    ['zero duration', (scene) => { scene.durationMs = 0; }],
    ['excessive duration', (scene) => { scene.durationMs = 3001; }],
    ['fractional duration', (scene) => { scene.durationMs = 700.5; }],
    ['negative coordinate', (scene) => { scene.start[0]!.x = -0.1; }],
    ['coordinate beyond court', (scene) => { scene.end[0]!.y = 1.1; }],
    ['non-finite coordinate', (scene) => { scene.start[0]!.x = Infinity; }],
    ['unknown actor', (scene) => { scene.start[0]!.playerId = 'missing'; }],
    ['duplicate actor', (scene) => { scene.start[1]!.playerId = scene.start[0]!.playerId; }],
    ['different actor sets', (scene, state) => { scene.end[0]!.playerId = state.home.players[5]!.id; }],
    ['bench actor in both endpoints', (scene, state) => { scene.start[0]!.playerId = state.home.players[5]!.id; scene.end[0]!.playerId = state.home.players[5]!.id; }],
    ['missing active actor', (scene) => { scene.start.pop(); scene.end.pop(); }],
    ['six actors from one side', (scene, state) => { scene.start[5]!.playerId = state.home.players[5]!.id; scene.end[5]!.playerId = state.home.players[5]!.id; }],
    ['negative ball height', (scene) => { scene.ball.from.height = -1; }],
    ['excessive ball height', (scene) => { scene.ball.to.height = 8.01; }],
    ['excessive arc height', (scene) => { scene.ball.arcHeight = 9; }],
    ['ball beyond court', (scene) => { scene.ball.to.x = 2; }],
    ['wrong action kind', (scene) => { scene.kind = 'shot'; }],
    ['unsupported scene property', (scene) => { (scene as unknown as Record<string, unknown>).future = true; }],
    ['unsupported actor property', (scene) => { (scene.start[0] as unknown as Record<string, unknown>).future = true; }],
    ['unsupported ball property', (scene) => { (scene.ball as unknown as Record<string, unknown>).future = true; }],
    ['unsupported point property', (scene) => { (scene.ball.to as unknown as Record<string, unknown>).future = true; }],
  ];
  it.each(invalidScenes)('rejects %s without changing the active snapshot', (_name, change) => {
    const active = sceneFixture();
    const before = serializeMatch(active);
    expect(() => parseMatch(changeScene(change))).toThrow(/Invalid match save/);
    expect(serializeMatch(active)).toBe(before);
  });

  it('validates pass receivers, teams and endpoints', () => {
    let state = automatic(242);
    for (let action = 0; action < 1000 && !state.events.some((event) => event.type === 'pass'); action += 1) state = stepMatch(state);
    const passing = state.events.find((event) => event.type === 'pass')!;
    expect(passing).toBeDefined();
    expect(parseMatch(serializeMatch(state))).toEqual(state);
    const mutations: Array<(event: typeof passing, state: MatchState) => void> = [
      (event) => { delete event.receiverId; },
      (event) => { event.receiverId = event.playerId; },
      (event) => { event.receiverId = 'missing'; },
      (event, state) => { event.receiverId = state[event.side === 'home' ? 'away' : 'home'].players[0]!.id; },
      (event) => { event.scene!.offense = event.side === 'home' ? 'away' : 'home'; },
      (event) => { event.scene!.ball.from.x = event.scene!.ball.from.x === 0 ? 1 : 0; },
      (event) => { event.scene!.ball.to.y = event.scene!.ball.to.y === 0 ? 1 : 0; },
      (event) => { event.type = 'command'; },
    ];
    for (const mutate of mutations) {
      const envelope = JSON.parse(serializeMatch(state)) as { state: MatchState };
      mutate(envelope.state.events[passing.id - 1]!, envelope.state);
      expect(() => parseMatch(JSON.stringify(envelope))).toThrow(/Invalid match save/);
    }
  });

  it('rejects shot metadata that disagrees with the recorded shot location', () => {
    const state = simulateToQuarterEnd(automatic(243));
    const envelope = JSON.parse(serializeMatch(state)) as { state: MatchState };
    const shot = envelope.state.events.find((event) => event.type === 'shot')!;
    shot.scene!.ball.from.x = shot.shot!.x === 0 ? 1 : 0;
    expect(() => parseMatch(JSON.stringify(envelope))).toThrow(/recorded shot location/);
  });

  it('rejects a pass to a bench player even when optional scenes are absent', () => {
    let state = automatic(242);
    for (let action = 0; action < 1000 && !state.events.some((event) => event.type === 'pass'); action += 1) state = stepMatch(state);
    for (const event of state.events) delete event.scene;
    const envelope = JSON.parse(serializeMatch(state)) as { state: MatchState };
    const pass = envelope.state.events.find((event) => event.type === 'pass')!;
    pass.receiverId = state[pass.side!].players.find((player) => !state.lineups[pass.side!].includes(player.id))!.id;
    expect(() => parseMatch(JSON.stringify(envelope))).toThrow(/active players/);
  });

  it('fits complete scene-bearing exhibitions within the bounded save format', () => {
    for (const seed of [0, 244, 245, 246]) {
      const state = simulateToEnd(automatic(seed));
      const text = serializeMatch(state);
      expect(state.events.filter((event) => event.scene).length).toBeGreaterThan(100);
      expect(new TextEncoder().encode(text).byteLength).toBeLessThan(MAX_SAVE_BYTES);
      expect(parseMatch(text)).toEqual(state);
    }
  });

  it('still bounds total JSON values and individual collections below the byte limit', () => {
    const tooManyValues = JSON.stringify(Array.from({ length: 26 }, () => Array<number>(20_000).fill(0)));
    expect(new TextEncoder().encode(tooManyValues).byteLength).toBeLessThan(MAX_SAVE_BYTES);
    expect(() => parseMatch(tooManyValues)).toThrow(/too many values/);
    expect(() => parseMatch(JSON.stringify(Array<number>(20_001).fill(0)))).toThrow(/oversized collection/);
  });
});
