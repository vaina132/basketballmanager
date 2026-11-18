import { describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import type { Position } from '../src/domain/types';
import { arrangeBestFive, placeInCircle, setAutoSubstitutions, simulateToEnd, stepMatch } from '../src/engine/match';
import { courtCircles } from '../src/engine/positions';
import { advanceSeason, createSeason, managedSide, setPlannedFive, startingFivePlanBlock, startingFivePlanMatch } from '../src/world/season';
import { parseSeason, serializeSeasonCompact } from '../src/storage/season-storage';

const CLUB = 'rhine-falcons';
const finish = (state: SeasonState) => ({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch!, managedSide(state), true)) });
/** What the Squad page does with a court-picture change: the engine edits the planning match and the plan takes its five and circles. */
const plan = (state: SeasonState, edit: (match: ReturnType<typeof startingFivePlanMatch>, side: 'home' | 'away') => ReturnType<typeof startingFivePlanMatch>) => {
  const match = startingFivePlanMatch(state), side = match.home.id === CLUB ? 'home' : 'away', edited = edit(match, side);
  return setPlannedFive(state, edited.lineups[side], edited.slots?.[side] ?? {});
};

describe('the starting five on the Squad page (owner request, 18 November 2026)', () => {
  it('changes the plan and the prepared match before tip-off, and the next game starts from the same five and circles', () => {
    let state = createSeason({ seed: 77, managedClubId: CLUB, injuryMode: 'off' });
    const side = managedSide(state), planned = [...state.plans[CLUB]!.lineup];
    const shown = courtCircles(state.activeMatch!, side), guard = planned.find(id => shown[id] === 'PG')!, forward = planned.find(id => shown[id] === 'SF')!, shooter = planned.find(id => shown[id] === 'SG')!;
    const reserve = state.activeMatch![side].players.find(player => !planned.includes(player.id) && player.position === 'C')!;
    // A tactic set in the Match center before tip-off is kept when the match is prepared again.
    state = { ...state, activeMatch: { ...state.activeMatch!, tactics: { ...state.activeMatch!.tactics, [side]: { tempo: .8, outsideShare: .3, pressure: .6 } } } };
    state = plan(state, (match, own) => placeInCircle(placeInCircle(match, own, reserve.id, 'SF'), own, guard, 'SG'));
    const chosen: Record<string, Position> = { [reserve.id]: 'SF', [guard]: 'SG', [shooter]: 'PG' };
    const expected = planned.map(id => id === forward ? reserve.id : id);
    // The Squad change is the Match center's five before tip-off.
    expect(state.plans[CLUB]!.lineup).toEqual(expected);
    expect(state.plans[CLUB]!.slots).toEqual(chosen);
    expect(new Set(state.activeMatch!.lineups[side])).toEqual(new Set(expected));
    expect(state.activeMatch!.slots).toEqual({ [side]: chosen });
    expect(state.activeMatch!.tactics[side]).toEqual({ tempo: .8, outsideShare: .3, pressure: .6 });
    expect(state.activeMatch!.stepCount).toBe(0);
    // The strict save check keeps the plan and the prepared match.
    expect(parseSeason(serializeSeasonCompact(state))).toEqual(state);
    // A change in the Match center shows on the Squad page: both use the prepared match.
    const centre = arrangeBestFive(state.activeMatch!, side);
    expect(startingFivePlanMatch({ ...state, activeMatch: centre })).toBe(centre);
    // While the game is played or waits for Continue, the Squad page cannot change the five.
    const playing = { ...state, activeMatch: stepMatch(state.activeMatch!) };
    expect(startingFivePlanBlock(playing)).toMatch(/Match center/);
    expect(() => setPlannedFive(playing, expected, chosen)).toThrow(/Match center/);
    const finished = finish(state);
    expect(startingFivePlanBlock(finished)).toMatch(/Continue/);
    // The next game starts from the planned five and circles.
    state = advanceSeason(finished);
    const nextSide = managedSide(state);
    expect(state.plans[CLUB]!.lineup).toEqual(expected);
    expect(new Set(state.activeMatch!.lineups[nextSide])).toEqual(new Set(expected));
    expect(state.activeMatch!.slots).toEqual({ [nextSide]: chosen });
  }, 60_000);

  it('plans the next game between games and refuses an illegal five', () => {
    let state = createSeason({ seed: 77, managedClubId: CLUB, injuryMode: 'off' });
    const side = managedSide(state), planned = [...state.plans[CLUB]!.lineup];
    const reserve = state.activeMatch![side].players.find(player => !planned.includes(player.id))!;
    // Between games (no prepared match), the plan alone changes and the next game is prepared from it.
    state = advanceSeason(finish(state));
    const between = { ...state, activeMatch: null };
    expect(startingFivePlanBlock(between)).toBeNull();
    const five = [reserve.id, ...planned.slice(1)];
    const changed = setPlannedFive(between, five, { [reserve.id]: 'C' });
    expect(changed.activeMatch).toBeNull();
    expect(changed.plans[CLUB]).toMatchObject({ lineup: five, slots: { [reserve.id]: 'C' } });
    const next = startingFivePlanMatch(changed), nextSide = next.home.id === CLUB ? 'home' : 'away';
    expect(new Set(next.lineups[nextSide])).toEqual(new Set(five));
    expect(next.slots?.[nextSide]).toEqual({ [reserve.id]: 'C' });
    // The same guards as the match's.
    expect(() => setPlannedFive(state, planned.slice(0, 4), {})).toThrow(/five different/);
    expect(() => setPlannedFive(state, [planned[0]!, ...planned.slice(0, 4)], {})).toThrow(/five different/);
    expect(() => setPlannedFive(state, planned, { [planned[0]!]: 'C', [planned[1]!]: 'C' })).toThrow(/different position/);
    expect(() => setPlannedFive(state, planned, { [reserve.id]: 'C' })).toThrow(/different position/);
    expect(() => setPlannedFive({ ...state, status: 'complete' }, planned, {})).toThrow(/season is over/);
  }, 60_000);
});
