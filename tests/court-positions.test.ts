import { describe, expect, it } from 'vitest';
import { FICTIONAL_AWAY, FICTIONAL_HOME } from '../src/data/fictional-teams';
import type { MatchState } from '../src/domain/types';
import { arrangeBestFive, bestCircles, createFixtureMatch, placeInCircle, setAutoSubstitutions, setInjuryMode, simulateToEnd, stepMatch, swapActivePlayers } from '../src/engine/match';
import { arrangeCircles, asPlayedIn, outOfPositionPercent, playedAttributes } from '../src/engine/positions';
import { parseMatch, serializeMatch } from '../src/storage/match-storage';

const ids = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => `${prefix}-${index + 1}`);
/** A fixture in which the home side plays the court picture's circles and the away side its listed positions. */
const circled = (seed: number, slots: Record<string, 'PG' | 'SG' | 'SF' | 'PF' | 'C'> = {}) => setInjuryMode(createFixtureMatch(seed, FICTIONAL_HOME, FICTIONAL_AWAY, { slots: { home: slots } }), 'off');
const finish = (state: MatchState) => simulateToEnd(setAutoSubstitutions(state, 'home', true));

describe('playing out of position (owner request, 16 November 2026)', () => {
  it('costs nothing in a player\'s own position, 5% next to it, 12% two steps away and 25% further', () => {
    expect([outOfPositionPercent('PG', 'PG'), outOfPositionPercent('PG', 'SG'), outOfPositionPercent('PG', 'SF'), outOfPositionPercent('PG', 'PF'), outOfPositionPercent('PG', 'C')]).toEqual([0, 5, 12, 25, 25]);
    expect(outOfPositionPercent('C', 'PF')).toBe(5);
    const guard = FICTIONAL_HOME.players[0]!;
    expect(asPlayedIn(guard, 'PG')).toBe(guard);
    const atCentre = asPlayedIn(guard, 'C');
    expect(atCentre).toMatchObject({ id: guard.id, position: 'C' });
    expect(atCentre.attributes.passing).toBeCloseTo(guard.attributes.passing * 0.75);
    expect(atCentre.attributes.freeThrow).toBe(guard.attributes.freeThrow);
    expect(atCentre.attributes.stamina).toBe(guard.attributes.stamina);
    expect(playedAttributes(guard.attributes, 'PG', 'SG').defense).toBeCloseTo(guard.attributes.defense * 0.95);
  });

  it('changes the game deterministically while the opponent keeps its listed positions', () => {
    const [pg, sg, sf, pf, c] = ids('rhf', 5) as [string, string, string, string, string];
    const own = circled(17);
    expect(own.slots).toEqual({ home: { [pg]: 'PG', [sg]: 'SG', [sf]: 'SF', [pf]: 'PF', [c]: 'C' } });
    expect(own.slots!.away).toBeUndefined();
    // The centre plays point guard and the point guard centre: the same seed gives the same, different game.
    const swapped = swapActivePlayers(own, 'home', pg, c);
    expect(swapped.slots!.home).toMatchObject({ [pg]: 'C', [c]: 'PG' });
    expect(swapped.rngState).toBe(own.rngState);
    const first = finish(swapped), again = finish(swapActivePlayers(circled(17), 'home', pg, c)), normal = finish(own);
    expect(again.score).toEqual(first.score);
    expect(again.events.map(event => event.text)).toEqual(first.events.map(event => event.text));
    expect(normal.events.map(event => event.text)).not.toEqual(first.events.map(event => event.text));
    // Until a substitution, a five in its own positions plays exactly the game without circles.
    const steps = (state: MatchState) => { let next = state; for (let index = 0; index < 40; index += 1) next = stepMatch(next); return next; };
    const inPosition = steps(own), listed = steps(setInjuryMode(createFixtureMatch(17, FICTIONAL_HOME, FICTIONAL_AWAY), 'off'));
    expect(inPosition.events.some(event => event.type === 'substitution')).toBe(false);
    expect(inPosition.events.map(event => event.text)).toEqual(listed.events.map(event => event.text));
    expect(first.startingSlots!.home).toMatchObject({ [pg]: 'C', [c]: 'PG' });
    expect(parseMatch(serializeMatch(first)).startingSlots).toEqual(first.startingSlots);
  });

  it('arranges a five with two guards at the smallest cost and keeps the circles a plan names', () => {
    const players = [FICTIONAL_HOME.players[0]!, FICTIONAL_HOME.players[5]!, FICTIONAL_HOME.players[2]!, FICTIONAL_HOME.players[3]!, FICTIONAL_HOME.players[4]!];
    expect(arrangeCircles(players)).toEqual({ 'rhf-1': 'PG', 'rhf-6': 'SG', 'rhf-3': 'SF', 'rhf-4': 'PF', 'rhf-5': 'C' });
    expect(arrangeCircles(players, [{ 'rhf-6': 'PG' }])).toMatchObject({ 'rhf-6': 'PG', 'rhf-1': 'SG' });
  });
});

describe('the court picture\'s commands', () => {
  it('puts a reserve in a circle at once before tip-off, as often as the manager likes, and swaps circles', () => {
    const ready = circled(5), [pg, , sf] = ids('rhf', 3) as [string, string, string];
    const reserveGuard = 'rhf-6', reserveForward = 'rhf-8';
    let next = placeInCircle(ready, 'home', reserveGuard, 'SF');
    expect(next.lineups.home).toContain(reserveGuard);
    expect(next.lineups.home).not.toContain(sf);
    expect(next.slots!.home![reserveGuard]).toBe('SF');
    expect(next.substitutionLocks).toEqual([]);
    expect(next.rngState).toBe(ready.rngState);
    // The guard just brought in can be replaced again before tip-off.
    next = placeInCircle(next, 'home', reserveForward, 'SF');
    expect(next.lineups.home).not.toContain(reserveGuard);
    expect(next.slots!.home![reserveForward]).toBe('SF');
    // On-court players trade circles; an own-position move is no change.
    next = placeInCircle(next, 'home', pg, 'SF');
    expect(next.slots!.home).toMatchObject({ [pg]: 'SF', [reserveForward]: 'PG' });
    expect(placeInCircle(next, 'home', pg, 'SF')).toBe(next);
    expect(() => placeInCircle(next, 'away', 'aeg-6', 'PG')).toThrow(/listed positions/);
    expect(() => placeInCircle(setInjuryMode(createFixtureMatch(5, FICTIONAL_HOME, FICTIONAL_AWAY), 'off'), 'home', reserveGuard, 'PG')).toThrow(/listed positions/);
  });

  it('queues a reserve during play for the circle\'s player, who hands over his circle at the stoppage', () => {
    let live = circled(9);
    while (live.stepCount < 20 || live.stoppage || !live.possessionPlay) live = stepMatch(live);
    const occupant = Object.entries(live.slots!.home!).find(([, circle]) => circle === 'PF')![0];
    const reserve = live.home.players.find(player => !live.lineups.home.includes(player.id))!.id;
    let next = placeInCircle(live, 'home', reserve, 'PF');
    expect(next.pendingSubstitutions.home).toEqual([{ outId: occupant, inId: reserve }]);
    expect(next.lineups.home).toContain(occupant);
    while (next.pendingSubstitutions.home.length && next.status !== 'finished') next = stepMatch(next);
    expect(next.lineups.home).toContain(reserve);
    expect(next.slots!.home![reserve]).toBe('PF');
    expect(Object.keys(next.slots!.home!).sort()).toEqual([...next.lineups.home].sort());
    expect(next.startingSlots!.home![occupant]).toBe('PF');
  });

  it('fills the five circles with healthy players in balanced positions with "Best five"', () => {
    // A guard, a reserve guard, two centres and a reserve forward start; one of the best starters is injured.
    const injured = 'rhf-3';
    let ready = setInjuryMode(createFixtureMatch(3, FICTIONAL_HOME, FICTIONAL_AWAY, { slots: { home: {} }, lineups: { home: ['rhf-1', 'rhf-6', 'rhf-5', 'rhf-10', 'rhf-9'] }, preExistingInjuries: { [injured]: 'ankle-sprain' } }), 'standard');
    const target = bestCircles(ready, 'home');
    expect(Object.values(target).sort()).toEqual(['C', 'PF', 'PG', 'SF', 'SG']);
    expect(Object.keys(target)).not.toContain(injured);
    expect(target).toMatchObject({ 'rhf-1': 'PG', 'rhf-2': 'SG', 'rhf-4': 'PF', 'rhf-5': 'C' });
    ready = arrangeBestFive(ready, 'home');
    expect(ready.slots!.home).toEqual(target);
    expect([...ready.lineups.home].sort()).toEqual(Object.keys(target).sort());
    expect(ready.stepCount).toBe(0);
    expect(bestCircles(ready, 'home')).toEqual(target);
  });
});
