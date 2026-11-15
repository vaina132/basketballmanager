import { describe, expect, it } from 'vitest';
import type { CourtScene, MatchState, Side } from '../src/domain/types';
import { freeThrowPosition, hoopPosition, passScene, reboundScene, setupScene, shotScene, turnoverScene } from '../src/engine/court-events';
import { createMatch as createVersionedMatch, setAutoSubstitutions, setInjuryMode, simulateToEnd, stepMatch, substitutePlayer } from '../src/engine/match';

// Preserve the legacy sporting contract independently of the current default engine.
const createMatch = (seed = 42) => createVersionedMatch(seed, 'rules-2');

function autonomous(seed: number): MatchState {
  let state = setInjuryMode(createMatch(seed), 'off');
  for (const side of ['home', 'away'] as const) state = setAutoSubstitutions(state, side, true);
  return state;
}
function sportingState(state: MatchState): Omit<MatchState, 'events'> {
  const { events: _events, ...rest } = state;
  return rest;
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze); Object.freeze(value);
  }
  return value;
}
async function sha256(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

describe('event-authored court scenes', () => {
  it('preserves the pre-scene rules-2 sporting state and random stream across 100 seeds', async () => {
    // Captured before presentation metadata was added; events are intentionally excluded.
    const hashes = await Promise.all(Array.from({ length: 100 }, async (_, index) => {
      const seed = index + 1, result = simulateToEnd(autonomous(seed));
      return { seed, score: result.score, hash: await sha256(sportingState(result)) };
    }));
    expect(await sha256(hashes)).toBe('960af650db6c2c013ef37690b3dbdcbf874cf43b358b1dff8efa2a3262a5b9aa');
  }, 30_000);

  it('captures actual active actors, continuous poses and bounded geometry through a complete match', () => {
    const initial = autonomous(876), result = simulateToEnd(initial);
    const lineups = { home: [...initial.lineups.home], away: [...initial.lineups.away] };
    let previous: CourtScene | undefined, count = 0;
    for (const event of result.events) {
      if (event.type === 'substitution' && event.side && event.outgoingPlayerId) {
        lineups[event.side] = lineups[event.side].filter(id => id !== event.outgoingPlayerId);
        if (event.playerId) lineups[event.side].push(event.playerId);
      }
      const scene = event.scene;
      if (!scene) continue;
      count += 1;
      const active = [...lineups.home, ...lineups.away].sort();
      expect(scene.start.map(actor => actor.playerId).sort()).toEqual(active);
      expect(scene.end.map(actor => actor.playerId).sort()).toEqual(active);
      for (const actor of scene.start) {
        const old = previous?.end.find(position => position.playerId === actor.playerId);
        if (old) expect(actor).toEqual(old);
      }
      for (const point of [...scene.start, ...scene.end, scene.ball.from, scene.ball.to]) {
        expect(point.x).toBeGreaterThanOrEqual(0); expect(point.x).toBeLessThanOrEqual(1);
        expect(point.y).toBeGreaterThanOrEqual(0); expect(point.y).toBeLessThanOrEqual(1);
      }
      for (const height of [scene.ball.from.height, scene.ball.to.height, scene.ball.arcHeight]) {
        expect(height).toBeGreaterThanOrEqual(0); expect(height).toBeLessThanOrEqual(8);
      }
      expect(scene.durationMs).toBeGreaterThanOrEqual(250); expect(scene.durationMs).toBeLessThanOrEqual(3000);
      previous = scene;
    }
    expect(count).toBeGreaterThan(300);
  });

  it('logs each credited assist as a pass to the actual shooter before the basket is credited', () => {
    const result = simulateToEnd(autonomous(42)), passes = result.events.filter(event => event.type === 'pass');
    expect(passes.length).toBeGreaterThan(10);
    for (const pass of passes) {
      const shot = result.events.slice(pass.id).find(event => event.type === 'shot')!;
      expect(shot.shot?.made).toBe(true); expect(shot.playerId).toBe(pass.receiverId); expect(shot.side).toBe(pass.side);
      expect(shot.score[pass.side!] - pass.score[pass.side!]).toBe(shot.shot!.value);
      expect(shot.clockSeconds).toBe(pass.clockSeconds);
      const passer = pass.scene!.start.find(actor => actor.playerId === pass.playerId)!;
      const receiver = pass.scene!.end.find(actor => actor.playerId === pass.receiverId)!;
      expect(pass.scene!.ball.from).toMatchObject({ x: passer.x, y: passer.y });
      expect(pass.scene!.ball.to).toMatchObject({ x: receiver.x, y: receiver.y });
      expect(shot.scene!.ball.from.x).toBe(pass.scene!.ball.to.x);
      expect(shot.scene!.ball.from.y).toBe(pass.scene!.ball.to.y);
    }
    for (const [id, stats] of Object.entries(result.stats)) expect(passes.filter(event => event.playerId === id)).toHaveLength(stats.assists);
  });

  it('uses the sampled shot position, correct attacking hoop and prior miss endpoint for rebounds', () => {
    const result = simulateToEnd(autonomous(13));
    let previous: CourtScene | undefined;
    for (const event of result.events) {
      const scene = event.scene;
      if (!scene) continue;
      if (event.type === 'shot') {
        expect(scene.ball.from.x).toBe(event.shot!.x); expect(scene.ball.from.y).toBe(event.shot!.y);
        expect(scene.start.find(actor => actor.playerId === event.playerId)).toMatchObject({ x: event.shot!.x, y: event.shot!.y });
        if (event.shot!.made) expect(scene.ball.to).toMatchObject(hoopPosition({ ...result, period: event.period }, event.side!));
      }
      if (event.type === 'free-throw') expect(scene.ball.from).toMatchObject(freeThrowPosition({ ...result, period: event.period }, event.side!));
      if (event.type === 'rebound') {
        expect(['shot', 'free-throw']).toContain(previous!.kind);
        expect(scene.ball.from).toEqual(previous!.ball.to);
        const actor = scene.end.find(position => position.playerId === event.playerId)!;
        expect(scene.ball.to).toMatchObject({ x: actor.x, y: actor.y });
      }
      previous = scene;
    }
    for (const side of ['home', 'away'] as const) {
      expect(hoopPosition({ ...result, period: 2 }, side).x + hoopPosition({ ...result, period: 3 }, side).x).toBeCloseTo(1);
      expect(hoopPosition({ ...result, period: 5 }, side)).toEqual(hoopPosition({ ...result, period: 4 }, side));
    }
  });

  it('never adds absent players to a short-handed scene', () => {
    let state = setInjuryMode(createMatch(19), 'off');
    state.lineups.home = state.lineups.home.slice(0, 2); state.lineups.away = state.lineups.away.slice(0, 3);
    state.autoSubstitutions = { home: false, away: false }; state.events = [];
    const expected = [...state.lineups.home, ...state.lineups.away].sort();
    for (let index = 0; index < 10; index += 1) state = stepMatch(state);
    expect(state.events.some(event => event.scene)).toBe(true);
    for (const event of state.events) if (event.scene) {
      expect(event.scene.start.map(actor => actor.playerId).sort()).toEqual(expected);
      expect(event.scene.end.map(actor => actor.playerId).sort()).toEqual(expected);
    }
  });

  it('keeps old actors and frozen geometry intact when a substitute enters', () => {
    const initial = freeze(setInjuryMode(createMatch(7), 'off'));
    const oldScene = initial.events[0]!.scene!, outgoing = initial.lineups.home[0]!, incoming = initial.home.players[5]!.id;
    const substituted = substitutePlayer(initial, 'home', outgoing, incoming);
    const substitutionScene = substituted.events.at(-1)!.scene!;
    expect(substituted.events.at(-1)!.type).toBe('substitution');
    expect(substitutionScene.kind).toBe('setup');
    expect(substitutionScene.end.some(actor => actor.playerId === incoming)).toBe(true);
    expect(substitutionScene.end.some(actor => actor.playerId === outgoing)).toBe(false);
    const next = stepMatch(substituted), newScenes = next.events.slice(substituted.events.length).filter(event => event.scene);
    expect(oldScene.end.some(actor => actor.playerId === outgoing)).toBe(true);
    expect(oldScene.end.some(actor => actor.playerId === incoming)).toBe(false);
    expect(newScenes.length).toBeGreaterThan(0);
    for (const event of newScenes) {
      expect(event.scene!.start.some(actor => actor.playerId === incoming)).toBe(true);
      expect(event.scene!.start.some(actor => actor.playerId === outgoing)).toBe(false);
    }
  });

  it('authors the new lineup immediately when a paused critical replacement is made', () => {
    const initial = setInjuryMode(createMatch(7), 'off');
    const outgoing = initial.lineups.home[0]!, incoming = initial.home.players[5]!.id;
    initial.injuries[outgoing] = { kind: 'ankle-sprain', occurredAtSeconds: 0 };
    const paused = stepMatch(initial);
    expect(paused.requiredSubstitutions).toEqual([{ side: 'home', playerId: outgoing, reason: 'injured' }]);
    const replaced = substitutePlayer(paused, 'home', outgoing, incoming);
    const scene = replaced.events.at(-1)!.scene!;
    expect(replaced.requiredSubstitutions).toHaveLength(0);
    expect(scene.kind).toBe('setup');
    expect(scene.end.map(actor => actor.playerId).sort()).toEqual([...replaced.lineups.home, ...replaced.lineups.away].sort());
    expect(scene.end.some(actor => actor.playerId === outgoing)).toBe(false);
    expect(scene.end.some(actor => actor.playerId === incoming)).toBe(true);
    expect(replaced.clockSeconds).toBe(paused.clockSeconds);
    expect(replaced.rngState).toBe(paused.rngState);
  });

  it('authors outgoing-only replacements when play can continue short-handed', () => {
    const initial = setInjuryMode(createMatch(2), 'off');
    initial.home = { ...initial.home, players: initial.home.players.slice(0, 5) };
    const outgoing = initial.lineups.home[0]!;
    initial.stats[outgoing]!.fouls = 5;
    const next = stepMatch(initial);
    const departure = next.events.find(event => event.type === 'substitution' && event.outgoingPlayerId === outgoing)!;
    expect(departure.playerId).toBeUndefined();
    expect(departure.scene!.end).toHaveLength(9);
    expect(departure.scene!.end.some(actor => actor.playerId === outgoing)).toBe(false);
  });

  it('generates geometry without mutating state or taking random draws', () => {
    const state = freeze(autonomous(12)), before = JSON.stringify(state), side: Side = 'home';
    const handler = state.lineups.home[0]!, receiver = state.lineups.home[1]!, defender = state.lineups.away[0]!;
    setupScene(state, side, handler); passScene(state, side, handler, receiver, { x: 0.8, y: 0.6 });
    shotScene(state, side, handler, { x: 0.8, y: 0.6 }, false, defender);
    reboundScene(state, side, defender); turnoverScene(state, side, handler, defender);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('continues an old rules-2 snapshot without scene metadata with unchanged sporting outcomes', () => {
    let original = autonomous(31);
    for (let index = 0; index < 12; index += 1) original = stepMatch(original);
    const legacy = JSON.parse(JSON.stringify(original)) as MatchState;
    legacy.events = legacy.events.filter(event => event.type !== 'pass').map((event, index) => {
      const { scene: _scene, receiverId: _receiverId, ...old } = event;
      return { ...old, id: index + 1 };
    });
    expect(sportingState(simulateToEnd(legacy))).toEqual(sportingState(simulateToEnd(original)));
  });
});
