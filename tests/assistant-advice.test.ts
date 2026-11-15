import { describe, expect, it } from 'vitest';
import type { MatchState, PlayerAttributes, Side } from '../src/domain/types';
import { DEVELOPMENT_ASSISTANTS } from '../src/data/development-assistants';
import { createMatch, setAutoSubstitutions, setInjuryMode, setTactics, simulateToEnd, stepMatch, substitutePlayer } from '../src/engine/match';
import { applyAssistantRotation, applyAssistantTactics, getAssistantAdvice } from '../src/world/assistant-advice';

const coach = DEVELOPMENT_ASSISTANTS.find(item => item.assessment === 10)!;
const basic = DEVELOPMENT_ASSISTANTS[0]!;
const create = () => setInjuryMode(createMatch(91), 'off');
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function skills(state: MatchState, side: Side, attributes: Partial<PlayerAttributes>): MatchState {
  return { ...state, [side]: { ...state[side], players: state[side].players.map(player => ({ ...player, attributes: { ...player.attributes, ...attributes } })) } };
}
function tired(state = create(), side: Side = 'home'): MatchState {
  const result = structuredClone(state);
  result.stats[result.lineups[side][0]!]!.condition = 40;
  return result;
}
/** Compare sporting behavior while allowing human-readable source attribution. */
const sporting = (state: MatchState) => ({ ...state, events: state.events.map(({ text: _text, ...event }) => event) });

describe('assistant advice from owned squad state', () => {
  it('is deterministic, immutable and independent of hidden opponent skills or their statistics', () => {
    const initial = freeze(tired());
    const before = structuredClone(initial);
    const advice = getAssistantAdvice(initial, 'home', coach);
    const changedOpponent = skills(structuredClone(initial), 'away', { twoPoint: 1, threePoint: 20, passing: 1, defense: 20 });
    for (const player of changedOpponent.away.players) { changedOpponent.stats[player.id]!.points = 100; changedOpponent.stats[player.id]!.condition = 35; }
    expect(getAssistantAdvice(changedOpponent, 'home', coach)).toEqual(advice);
    expect(getAssistantAdvice(initial, 'home', coach)).toEqual(advice);
    expect(initial).toEqual(before);
    expect(advice.rotation?.priority).toBe('fatigue');
  });

  it('responds to shooting strengths, readiness and foul trouble instead of offering a fixed tactic', () => {
    const perimeter = skills(create(), 'home', { threePoint: 20, twoPoint: 4 });
    const inside = skills(create(), 'home', { threePoint: 4, twoPoint: 20 });
    expect(getAssistantAdvice(perimeter, 'home', coach).tactics!.outsideShare).toBeGreaterThan(getAssistantAdvice(inside, 'home', coach).tactics!.outsideShare);
    const fatigued = structuredClone(perimeter);
    for (const id of fatigued.lineups.home) { fatigued.stats[id]!.condition = 45; fatigued.stats[id]!.fouls = 4; }
    const fresh = getAssistantAdvice(perimeter, 'home', coach), careful = getAssistantAdvice(fatigued, 'home', coach);
    expect(careful.tactics!.tempo).toBeLessThan(fresh.tactics!.tempo);
    expect(careful.tactics!.pressure).toBeLessThan(fresh.tactics!.pressure);
    expect(careful.reasons.pressure).toContain('4.0 fouls');
    for (const value of Object.values(careful.tactics!)) { expect(value).toBeGreaterThanOrEqual(.2); expect(value).toBeLessThanOrEqual(.75); expect(value * 20).toBeCloseTo(Math.round(value * 20)); }
  });

  it('uses a finer assessment for better staff while keeping medical eligibility exact for all', () => {
    const fixture = skills(create(), 'home', { passing: 10, defense: 10, stamina: 10, twoPoint: 10, threePoint: 11 });
    expect(getAssistantAdvice(fixture, 'home', basic).tactics).not.toEqual(getAssistantAdvice(fixture, 'home', coach).tactics);
    const out = fixture.lineups.home[0]!;
    fixture.injuries[out] = { kind: 'ankle-sprain', occurredAtSeconds: 0 };
    for (const adviser of [basic, coach]) {
      const advice = getAssistantAdvice(fixture, 'home', adviser);
      expect(advice.rotation).toMatchObject({ outId: out, priority: 'required' });
      expect(fixture.injuries[advice.rotation!.inId]).toBeUndefined();
    }
  });

  it('never recommends unavailable reserves or overwrites a pending change', () => {
    const state = tired();
    const bench = state.home.players.filter(player => !state.lineups.home.includes(player.id));
    for (const player of bench) state.stats[player.id]!.fouls = 5;
    expect(getAssistantAdvice(state, 'home', coach)).toMatchObject({ rotation: null, rotationNote: 'No eligible reserves available.' });
    const queued = tired();
    queued.pendingSubstitutions.home.push({ outId: queued.lineups.home[0]!, inId: bench[0]!.id });
    expect(getAssistantAdvice(queued, 'home', coach).rotation).toBeNull();
    expect(applyAssistantRotation(queued, 'home', coach)).toBe(queued);
  });

  it.each(['fatigue', 'fouls'] as const)('chooses an available solution to %s before comparing ability', concern => {
    const state = create(), outId = state.lineups.home[0]!;
    const bench = state.home.players.filter(player => !state.lineups.home.includes(player.id));
    const riskyId = bench[0]!.id, saferId = bench[1]!.id;
    state.home = { ...state.home, players: state.home.players.map(player => [riskyId, saferId].includes(player.id) ? { ...player, attributes: Object.fromEntries(Object.keys(player.attributes).map(key => [key, player.id === riskyId ? 20 : 5])) as unknown as PlayerAttributes } : player) };
    for (const player of bench.slice(2)) state.stats[player.id]!.fouls = 5;
    if (concern === 'fatigue') { state.stats[outId]!.condition = 40; state.stats[riskyId]!.condition = 40; }
    else { state.stats[outId]!.fouls = 4; state.stats[riskyId]!.fouls = 4; }
    expect(getAssistantAdvice(state, 'home', coach).rotation).toMatchObject({ outId, inId: saferId, priority: concern });
  });

  it('ignores bench changes when assessing the current five and ignores ineligible starters', () => {
    const state = create(), altered = structuredClone(state);
    altered.home = { ...altered.home, players: altered.home.players.map(player => altered.lineups.home.includes(player.id) ? player : { ...player, attributes: { ...player.attributes, passing: 1, threePoint: 1, defense: 1 } }) };
    expect(getAssistantAdvice(altered, 'home', coach).tactics).toEqual(getAssistantAdvice(state, 'home', coach).tactics);
    const outId = altered.lineups.home[0]!;
    altered.injuries[outId] = { kind: 'hamstring', occurredAtSeconds: 0 };
    const expected = getAssistantAdvice(altered, 'home', coach).tactics;
    altered.home = { ...altered.home, players: altered.home.players.map(player => player.id === outId ? { ...player, attributes: { ...player.attributes, passing: 1, threePoint: 1, defense: 1 } } : player) };
    expect(getAssistantAdvice(altered, 'home', coach).tactics).toEqual(expected);
  });

  it('applies tactics exactly through the normal command with coach attribution and no random draw', () => {
    const state = freeze(tired());
    const recommendation = getAssistantAdvice(state, 'home', coach).tactics!;
    const applied = applyAssistantTactics(state, 'home', coach);
    expect(sporting(applied)).toEqual(sporting(setTactics(state, 'home', recommendation)));
    expect(applied.events.at(-1)!.text).toContain(coach.name);
    expect(applied.rngState).toBe(state.rngState);
    expect(applyAssistantTactics(applied, 'home', coach)).toBe(applied);
  });

  it.each(['home', 'away'] as const)('uses the legal substitution queue for %s without altering sporting behavior', side => {
    let state = create();
    for (let n = 0; n < 100 && (state.status === 'ready' || state.stoppage); n++) state = stepMatch(state);
    expect(state.stoppage).toBeNull();
    state = freeze(tired(state, side));
    const choice = getAssistantAdvice(state, side, coach).rotation!;
    const actual = applyAssistantRotation(state, side, coach);
    const expected = substitutePlayer(state, side, choice.outId, choice.inId);
    expect(sporting(actual)).toEqual(sporting(expected));
    expect(actual.pendingSubstitutions[side]).toContainEqual({ outId: choice.outId, inId: choice.inId });
    expect(actual.lineups[side]).toEqual(state.lineups[side]);
    expect(actual.rngState).toBe(state.rngState);
    expect(actual.events.some(event => event.text.startsWith(`${coach.name}'s advice:`))).toBe(true);
  });

  it('makes no recommendation after full time and cannot apply one', () => {
    const final = simulateToEnd(setAutoSubstitutions(create(), 'home', true));
    expect(final.status).toBe('finished');
    expect(getAssistantAdvice(final, 'home', coach)).toMatchObject({ tactics: null, rotation: null, tacticsChanged: false });
    expect(() => applyAssistantTactics(final, 'home', coach)).toThrow(/finished/);
    expect(() => applyAssistantRotation(final, 'home', coach)).toThrow(/finished/);
  });
});
