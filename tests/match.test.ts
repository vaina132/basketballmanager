import { describe, expect, it } from 'vitest';
import type { MatchState, Side } from '../src/domain/types';
import {
  createMatch as rawCreateMatch, setAutoSubstitutions, setInjuryMode, attackingDirection, setTactics, simulateToEnd, simulateToQuarterEnd, stepMatch, substitutePlayer,
} from '../src/engine/match';

function createMatch(seed = 42): MatchState { return setInjuryMode(setAutoSubstitutions(rawCreateMatch(seed, 'rules-2'), 'home', true), 'off'); }

function playSteps(state: MatchState, steps: number): MatchState {
  let next = state;
  for (let index = 0; index < steps; index += 1) next = stepMatch(next);
  return next;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function sumStat(state: MatchState, side: Side, key: 'secondsPlayed' | 'points' | 'threePointersAttempted' | 'fieldGoalsAttempted'): number {
  return state[side].players.reduce((sum, player) => sum + state.stats[player.id]![key], 0);
}

describe('deterministic match foundation', () => {
  it('produces identical matches in step, period-skip, and instant modes', () => {
    const initial = createMatch(876);
    let stepped = initial;
    while (stepped.status !== 'finished') stepped = stepMatch(stepped);
    let quarters = initial;
    while (quarters.status !== 'finished') quarters = simulateToQuarterEnd(quarters);
    expect(quarters).toEqual(stepped);
    expect(simulateToEnd(initial)).toEqual(stepped);
  });

  it('continues identically after serialization, including changed tactics and lineup', () => {
    let state = playSteps(createMatch(0), 17);
    state = setTactics(state, 'home', { outsideShare: 0.8, tempo: 0.7 });
    state = substitutePlayer(state, 'home', state.lineups.home[0]!, state.home.players[5]!.id);
    const restored = JSON.parse(JSON.stringify(state)) as MatchState;
    expect(simulateToEnd(restored)).toEqual(simulateToEnd(state));
    expect(restored.seed).toBe(0);
    expect(restored.rngState).not.toBe(0);
  });

  it('never mutates a prior snapshot or consumes gameplay randomness for commands', () => {
    const initial = deepFreeze(createMatch(5));
    const next = stepMatch(initial);
    const tactics = setTactics(initial, 'home', { pressure: 0.8 });
    const substitution = substitutePlayer(initial, 'home', initial.lineups.home[0]!, initial.home.players[5]!.id);
    expect(initial.clockSeconds).toBe(600);
    expect(initial.stepCount).toBe(0);
    expect(initial.events).toHaveLength(3);
    expect(next.clockSeconds).toBeLessThan(600);
    expect(tactics.rngState).toBe(initial.rngState);
    expect(substitution.rngState).toBe(initial.rngState);
    expect(initial.stats[initial.lineups.home[0]!]!.secondsPlayed).toBe(0);
  });

  it('stops exactly at the current period and advances the next one when requested again', () => {
    const quarter = simulateToQuarterEnd(playSteps(createMatch(9), 7));
    expect(quarter.period).toBe(1);
    expect(quarter.clockSeconds).toBe(0);
    expect(sumStat(quarter, 'home', 'secondsPlayed')).toBe(5 * 600);
    const second = simulateToQuarterEnd(quarter);
    expect(second.period).toBe(2);
    expect(second.clockSeconds).toBe(0);
    expect(sumStat(second, 'away', 'secondsPlayed')).toBe(5 * 1200);
  });

  it('records minutes only for active players and preserves exact team court time after substitutions', () => {
    let state = simulateToQuarterEnd(createMatch(44));
    const outgoing = state.lineups.home[0]!;
    const incoming = state.home.players[5]!.id;
    state = substitutePlayer(state, 'home', outgoing, incoming);
    state = simulateToQuarterEnd(state);
    expect(state.stats[outgoing]!.secondsPlayed).toBe(600);
    expect(state.stats[incoming]!.secondsPlayed).toBe(600);
    expect(sumStat(state, 'home', 'secondsPlayed')).toBe(6000);
    expect(state.stats[outgoing]!.condition).toBeGreaterThan(state.stats[state.lineups.home[1]!]!.condition);
  });

  it('rejects invalid substitutions, malformed lineups, and unsafe tactics without changing state', () => {
    const state = createMatch(22);
    const before = JSON.stringify(state);
    expect(() => substitutePlayer(state, 'home', state.lineups.home[0]!, state.lineups.home[1]!)).toThrow(/already/);
    expect(() => substitutePlayer(state, 'home', state.lineups.home[0]!, state.away.players[5]!.id)).toThrow(/belong/);
    expect(() => substitutePlayer(state, 'home', state.home.players[5]!.id, state.home.players[6]!.id)).toThrow(/outgoing/);
    expect(() => setTactics(state, 'home', { tempo: Number.NaN })).toThrow(/finite/);
    expect(() => setTactics(state, 'away', { outsideShare: 1.1 })).toThrow(/between/);
    expect(JSON.stringify(state)).toBe(before);
    const invalid = { ...state, lineups: { ...state.lineups, home: Array<string>(5).fill(state.lineups.home[0]!) } };
    expect(() => stepMatch(invalid)).toThrow(/five unique/);
  });

  it('rejects invalid seeds and prevents zero from creating a stuck random stream', () => {
    for (const seed of [-1, 1.5, Number.NaN, 0x1_0000_0000]) expect(() => createMatch(seed)).toThrow(/seed/);
    expect(simulateToEnd(createMatch(0))).toEqual(simulateToEnd(createMatch(0)));
    expect(playSteps(createMatch(0), 10).rngState).not.toBe(createMatch(0).rngState);
  });

  it('uses five-minute overtime when regulation is tied and guards runaway overtime', () => {
    const tied = createMatch(7);
    tied.status = 'playing';
    tied.period = 4;
    tied.clockSeconds = 0;
    const overtime = stepMatch(tied);
    expect(overtime.period).toBe(5);
    expect(overtime.clockSeconds).toBeGreaterThanOrEqual(276);
    expect(overtime.clockSeconds).toBeLessThan(300);
    expect(overtime.events.some((event) => event.type === 'period-start' && event.period === 5 && event.clockSeconds === 300)).toBe(true);
    const runaway = { ...tied, period: 24 };
    expect(() => stepMatch(runaway)).toThrow(/no winner was fabricated/);
  });

  it('reconciles scores, boxscores, clock time, and event order across varied seeds', () => {
    const results: string[] = [];
    for (let seed = 0; seed < 32; seed += 1) {
      const result = simulateToEnd(createMatch(seed));
      results.push(`${result.score.home}:${result.score.away}`);
      expect(result.status).toBe('finished');
      expect(result.period).toBeGreaterThanOrEqual(4);
      expect(result.clockSeconds).toBe(0);
      expect(result.score.home).not.toBe(result.score.away);
      const elapsedSeconds = 2400 + Math.max(0, result.period - 4) * 300;
      for (const side of ['home', 'away'] as const) {
        expect(sumStat(result, side, 'points')).toBe(result.score[side]);
        expect(sumStat(result, side, 'secondsPlayed')).toBe(5 * elapsedSeconds);
        expect(new Set(result.lineups[side]).size).toBe(5);
      }
      for (const stats of Object.values(result.stats)) {
        expect(stats.points).toBe(2 * stats.fieldGoalsMade + stats.threePointersMade + stats.freeThrowsMade);
        expect(stats.fieldGoalsMade).toBeLessThanOrEqual(stats.fieldGoalsAttempted);
        expect(stats.threePointersMade).toBeLessThanOrEqual(stats.threePointersAttempted);
        expect(stats.freeThrowsMade).toBeLessThanOrEqual(stats.freeThrowsAttempted);
        expect(stats.threePointersAttempted).toBeLessThanOrEqual(stats.fieldGoalsAttempted);
        expect(stats.condition).toBeGreaterThanOrEqual(0);
        expect(stats.condition).toBeLessThanOrEqual(100);
      }
      for (let index = 0; index < result.events.length; index += 1) {
        const event = result.events[index]!;
        expect(event.id).toBe(index + 1);
        expect(event.clockSeconds).toBeGreaterThanOrEqual(0);
        if (event.shot) {
          expect(event.shot.x).toBeGreaterThanOrEqual(0);
          expect(event.shot.x).toBeLessThanOrEqual(1);
          expect(event.shot.y).toBeGreaterThanOrEqual(0);
          expect(event.shot.y).toBeLessThanOrEqual(1);
          const hoopMetres = attackingDirection({period: event.period}, event.side!) === 1 ? 26.425 : 1.575;
          const radius = Math.hypot(event.shot.x * 28 - hoopMetres, event.shot.y * 15 - 7.5);
          if (event.shot.value === 3) expect(radius).toBeGreaterThan(6.75);
          else expect(radius).toBeLessThan(6.75);
        }
        if (index > 0) {
          const previous = result.events[index - 1]!;
          expect(event.period).toBeGreaterThanOrEqual(previous.period);
          if (event.period === previous.period) expect(event.clockSeconds).toBeLessThanOrEqual(previous.clockSeconds);
          expect(event.score.home).toBeGreaterThanOrEqual(previous.score.home);
          expect(event.score.away).toBeGreaterThanOrEqual(previous.score.away);
        }
      }
      expect(result.events.at(-1)!.score).toEqual(result.score);
      expect(stepMatch(result)).toBe(result);
    }
    expect(new Set(results).size).toBeGreaterThan(20);
  }, 30_000);

  it('makes tempo and outside emphasis affect their intended aggregate behavior', () => {
    let fastSteps = 0;
    let slowSteps = 0;
    let outsideAttempts = 0;
    let outsideTotal = 0;
    let insideAttempts = 0;
    let insideTotal = 0;
    for (let seed = 1; seed <= 8; seed += 1) {
      let fast = createMatch(seed * 91);
      let slow = createMatch(seed * 91);
      for (const side of ['home', 'away'] as const) {
        fast = setTactics(fast, side, { tempo: 1, outsideShare: 1 });
        slow = setTactics(slow, side, { tempo: 0, outsideShare: 0 });
      }
      fast = simulateToEnd(fast);
      slow = simulateToEnd(slow);
      fastSteps += fast.stepCount;
      slowSteps += slow.stepCount;
      outsideAttempts += sumStat(fast, 'home', 'threePointersAttempted');
      outsideTotal += sumStat(fast, 'home', 'fieldGoalsAttempted');
      insideAttempts += sumStat(slow, 'home', 'threePointersAttempted');
      insideTotal += sumStat(slow, 'home', 'fieldGoalsAttempted');
    }
    expect(fastSteps).toBeGreaterThan(slowSteps * 1.5);
    expect(outsideAttempts / outsideTotal).toBeGreaterThan(insideAttempts / insideTotal + 0.4);
  }, 30_000);

  it('gives aggressive defensive pressure a measurable disruption and foul tradeoff', () => {
    let aggressiveFouls = 0;
    let cautiousFouls = 0;
    let aggressiveTurnovers = 0;
    let cautiousTurnovers = 0;
    for (let seed = 1; seed <= 16; seed += 1) {
      const aggressive = simulateToEnd(setTactics(createMatch(seed * 173), 'home', { pressure: 1 }));
      const cautious = simulateToEnd(setTactics(createMatch(seed * 173), 'home', { pressure: 0 }));
      for (const player of aggressive.home.players) aggressiveFouls += aggressive.stats[player.id]!.fouls;
      for (const player of cautious.home.players) cautiousFouls += cautious.stats[player.id]!.fouls;
      for (const player of aggressive.away.players) aggressiveTurnovers += aggressive.stats[player.id]!.turnovers;
      for (const player of cautious.away.players) cautiousTurnovers += cautious.stats[player.id]!.turnovers;
    }
    expect(aggressiveFouls).toBeGreaterThan(cautiousFouls);
    expect(aggressiveTurnovers).toBeGreaterThan(cautiousTurnovers);
  }, 30_000);
});
