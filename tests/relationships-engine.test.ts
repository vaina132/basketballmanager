import { describe, expect, it } from 'vitest';
import { FICTIONAL_HOME, FICTIONAL_AWAY } from '../src/data/fictional-teams';
import { createFixtureMatch, moraleTurnoverAdjustment, simulateToEnd, stepMatch } from '../src/engine/match';
import type { MatchState } from '../src/domain/types';
import { parseMatch, serializeMatch } from '../src/storage/match-storage';

const values = (value: number) => Object.fromEntries([...FICTIONAL_HOME.players, ...FICTIONAL_AWAY.players].map(player => [player.id, value]));
const snapshot = (value: number): NonNullable<MatchState['morale']> => ({ model: 'morale-1', eventCount: 1, values: values(value) });
const create = (morale?: MatchState['morale'], seed = 227) => createFixtureMatch(seed, FICTIONAL_HOME, FICTIONAL_AWAY, { morale, injuryMode: 'off', autoSubstitutions: { home: true, away: true } });

describe('frozen morale and bounded decision consistency', () => {
  it('preserves the complete original match and random sequence at neutral morale', () => {
    const original = simulateToEnd(create()), neutral = simulateToEnd(create(snapshot(50)));
    const { morale, ...sporting } = neutral;
    expect(sporting).toEqual(original);
    expect(morale).toEqual(snapshot(50));
    expect(parseMatch(serializeMatch(neutral))).toEqual(neutral);
  });

  it('uses a small focused influence without changing permanent skills or initial condition', () => {
    const low = create(snapshot(0)), high = create(snapshot(100));
    const id = FICTIONAL_HOME.players[0]!.id;
    expect(moraleTurnoverAdjustment(low, id)).toBe(.005);
    expect(moraleTurnoverAdjustment(high, id)).toBe(-.005);
    expect(moraleTurnoverAdjustment(create(), id)).toBe(0);
    expect(low.home).toEqual(high.home);
    expect(low.stats).toEqual(high.stats);
    expect(low.rngState).toBe(high.rngState);
    // Find an actual identical action boundary whose error decision is affected.
    let ordinary = create(), affected = false;
    for (let action = 0; action < 800 && ordinary.status !== 'finished'; action += 1) {
      const lessFocused = stepMatch({ ...ordinary, morale: snapshot(0) });
      const moreFocused = stepMatch({ ...ordinary, morale: snapshot(100) });
      const errors = (match: MatchState) => Object.values(match.stats).reduce((sum, stats) => sum + stats.turnovers, 0);
      if (errors(lessFocused) > errors(moreFocused)) { affected = true; break; }
      ordinary = stepMatch(ordinary);
    }
    expect(affected).toBe(true);
  });

  it('copies preparation values so later manager state cannot alter a running match', () => {
    const input = snapshot(40), match = create(input), next = stepMatch(match);
    input.values[FICTIONAL_HOME.players[0]!.id] = 100;
    expect(match.morale!.values[FICTIONAL_HOME.players[0]!.id]).toBe(40);
    expect(next.morale).toEqual(match.morale);
    expect(next.morale).not.toBe(match.morale);
    expect(parseMatch(serializeMatch(next))).toEqual(next);
  });

  it.each(['partial', 'unknown', 'fractional', 'range', 'prefix', 'model'] as const)('rejects an invalid %s preparation through both fixture and save entry', kind => {
    const morale = snapshot(50), id = FICTIONAL_HOME.players[0]!.id;
    if (kind === 'partial') delete morale.values[id];
    if (kind === 'unknown') morale.values.unknown = 50;
    if (kind === 'fractional') morale.values[id] = 49.5;
    if (kind === 'range') morale.values[id] = 101;
    if (kind === 'prefix') morale.eventCount = 0;
    if (kind === 'model') (morale as { model: string }).model = 'other';
    expect(() => create(morale)).toThrow(/morale/);
    expect(() => serializeMatch({ ...create(), morale })).toThrow(/morale/);
  });
});
