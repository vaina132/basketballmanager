import { describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import type { Position } from '../src/domain/types';
import { placeInCircle, setAutoSubstitutions, simulateToEnd, substitutePlayer } from '../src/engine/match';
import { advanceSeason, createSeason, managedSide } from '../src/world/season';
import { courtCircles } from '../src/engine/positions';
import { parseSeason, serializeSeasonCompact } from '../src/storage/season-storage';

const finish = (state: SeasonState) => ({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch!, managedSide(state), true)) });

describe('the next game\'s starting five (browser play-through, 16 November 2026)', () => {
  it('starts from the planned five, not the five on the floor at the final buzzer, and keeps a change made before tip-off', () => {
    let state = createSeason({ seed: 77, managedClubId: 'rhine-falcons', injuryMode: 'off' });
    const side = managedSide(state), planned = [...state.plans['rhine-falcons']!.lineup];
    expect(state.activeMatch!.lineups[side]).toEqual(planned);
    // Automatic rotation, no planned change: the closing five never becomes the next starting five.
    let finished = finish(state);
    expect(finished.activeMatch!.lineups[side]).not.toEqual(planned);
    state = advanceSeason(finished);
    expect(state.plans['rhine-falcons']!.lineup).toEqual(planned);
    expect(state.activeMatch!.lineups[managedSide(state)]).toEqual(planned);
    // A reserve chosen before tip-off takes his starter's place in the plan for the next game.
    const nextSide = managedSide(state), reserve = state.activeMatch![nextSide].players.find(player => !planned.includes(player.id))!;
    state = { ...state, activeMatch: substitutePlayer(state.activeMatch!, nextSide, planned[2]!, reserve.id) };
    expect(state.activeMatch!.lineups[nextSide][2]).toBe(reserve.id);
    finished = finish(state);
    state = advanceSeason(finished);
    const expected = planned.map((id, slot) => slot === 2 ? reserve.id : id);
    expect(state.plans['rhine-falcons']!.lineup).toEqual(expected);
    expect(state.activeMatch!.lineups[managedSide(state)]).toEqual(expected);
    // The save check accepts the plans and the prepared match.
    expect(parseSeason(serializeSeasonCompact(state))).toEqual(state);
  }, 60_000);

  it('keeps the court picture\'s circles chosen before tip-off, an out-of-position player included, for the next game', () => {
    let state = createSeason({ seed: 77, managedClubId: 'rhine-falcons', injuryMode: 'off' });
    const side = managedSide(state), planned = [...state.plans['rhine-falcons']!.lineup];
    // New careers choose no circles: every player plays his listed position, as before.
    expect(state.plans['rhine-falcons']!.slots).toBeUndefined();
    expect(state.activeMatch!.slots).toBeUndefined();
    // Before tip-off: a reserve centre takes the small forward's circle and the point guard plays shooting guard.
    const shown = courtCircles(state.activeMatch!, side), guard = planned.find(id => shown[id] === 'PG')!, forward = planned.find(id => shown[id] === 'SF')!, shooter = planned.find(id => shown[id] === 'SG')!;
    const reserve = state.activeMatch![side].players.find(player => !planned.includes(player.id) && player.position === 'C')!;
    let match = placeInCircle(state.activeMatch!, side, reserve.id, 'SF');
    match = placeInCircle(match, side, guard, 'SG');
    const chosen: Record<string, Position> = { [reserve.id]: 'SF', [guard]: 'SG', [shooter]: 'PG' };
    expect(match.slots![side]).toEqual(chosen);
    state = advanceSeason(finish({ ...state, activeMatch: match }));
    const plan = state.plans['rhine-falcons']!, nextSide = managedSide(state);
    expect(plan.lineup).toEqual(planned.map(id => id === forward ? reserve.id : id));
    expect(plan.slots).toEqual(chosen);
    expect(state.activeMatch!.slots).toEqual({ [nextSide]: chosen });
    expect(state.activeMatch!.slots![nextSide === 'home' ? 'away' : 'home']).toBeUndefined();
    // The strict save check keeps the plan's circles and the prepared match's.
    const loaded = parseSeason(serializeSeasonCompact(state));
    expect(loaded).toEqual(state);
    expect(loaded.plans['rhine-falcons']!.slots).toEqual(chosen);
    // A broken plan and circles for the opponent are refused.
    const broken = { ...state, plans: { ...state.plans, 'rhine-falcons': { ...plan, slots: { ...chosen, [guard]: 'SF' as const } } } };
    expect(() => parseSeason(serializeSeasonCompact(broken))).toThrow(/court position/);
    const opponent = state.activeMatch!.lineups[nextSide === 'home' ? 'away' : 'home'][0]!;
    const cheated = { ...state, activeMatch: { ...state.activeMatch!, slots: { ...state.activeMatch!.slots, [nextSide === 'home' ? 'away' : 'home']: { [opponent]: 'C' as const } } } };
    expect(() => parseSeason(serializeSeasonCompact(cheated))).toThrow(/listed positions/);
  }, 60_000);
});
