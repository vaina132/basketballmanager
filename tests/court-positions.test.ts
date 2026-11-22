import { describe, expect, it } from 'vitest';
import { FICTIONAL_AWAY, FICTIONAL_HOME } from '../src/data/fictional-teams';
import type { MatchState } from '../src/domain/types';
import { arrangeBestFive, bestCircles, cancelSubstitution, createFixtureMatch, placeInCircle, setAutoSubstitutions, setInjuryMode, simulateToEnd, stepMatch } from '../src/engine/match';
import { arrangeCircles, asPlayedIn, courtCircles, outOfPositionPercent, playedAttributes } from '../src/engine/positions';
import { parseMatch, serializeMatch } from '../src/storage/match-storage';

const fixture = (seed: number, options: Parameters<typeof createFixtureMatch>[3] = {}) => setInjuryMode(createFixtureMatch(seed, FICTIONAL_HOME, FICTIONAL_AWAY, options), 'off');
const finish = (state: MatchState) => simulateToEnd(setAutoSubstitutions(state, 'home', true));
const texts = (state: MatchState) => state.events.filter(event => event.type !== 'command').map(event => event.text);

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

  it('changes the game deterministically only for players the manager placed; automatic choices play listed positions', () => {
    const plain = fixture(17);
    expect(plain.slots).toBeUndefined();
    expect(courtCircles(plain, 'home')).toEqual({ 'rhf-1': 'PG', 'rhf-2': 'SG', 'rhf-3': 'SF', 'rhf-4': 'PF', 'rhf-5': 'C' });
    // The centre is put in the point guard's circle: the two trade circles and both play out of position.
    const swapped = placeInCircle(plain, 'home', 'rhf-5', 'PG');
    expect(swapped.slots).toEqual({ home: { 'rhf-5': 'PG', 'rhf-1': 'C' } });
    expect(swapped.rngState).toBe(plain.rngState);
    const first = finish(swapped), again = finish(placeInCircle(fixture(17), 'home', 'rhf-5', 'PG')), normal = finish(plain);
    expect(again.score).toEqual(first.score);
    expect(texts(again)).toEqual(texts(first));
    expect(texts(normal)).not.toEqual(texts(first));
    expect(first.startingSlots).toEqual({ home: { 'rhf-5': 'PG', 'rhf-1': 'C' } });
    expect(first.slots!.away).toBeUndefined();
    expect(parseMatch(serializeMatch(first))).toEqual(first);
    // Placing every starter in his own position, and the automatic rotation's changes, leave the game exactly as it was.
    let own = plain;
    for (const [id, circle] of [['rhf-1', 'SG'], ['rhf-1', 'PG']] as const) own = placeInCircle(own, 'home', id, circle);
    expect(own.slots).toEqual({ home: { 'rhf-1': 'PG', 'rhf-2': 'SG' } });
    const inPosition = finish(own);
    expect(inPosition.score).toEqual(normal.score);
    expect(texts(inPosition)).toEqual(texts(normal));
    expect(inPosition.events.some(event => event.type === 'substitution')).toBe(true);
  });

  it('shows a five with two guards at the smallest distance from listed positions and keeps chosen circles', () => {
    const players = [FICTIONAL_HOME.players[0]!, FICTIONAL_HOME.players[5]!, FICTIONAL_HOME.players[2]!, FICTIONAL_HOME.players[3]!, FICTIONAL_HOME.players[4]!];
    expect(arrangeCircles(players)).toEqual({ 'rhf-1': 'PG', 'rhf-6': 'SG', 'rhf-3': 'SF', 'rhf-4': 'PF', 'rhf-5': 'C' });
    expect(arrangeCircles(players, [{ 'rhf-6': 'PG' }])).toMatchObject({ 'rhf-6': 'PG', 'rhf-1': 'SG' });
    // A planned circle is played from the start; the others play as listed.
    const planned = fixture(4, { slots: { home: { 'rhf-3': 'PF', 'rhf-9': 'C' } } });
    expect(planned.slots).toEqual({ home: { 'rhf-3': 'PF' } });
    expect(courtCircles(planned, 'home')).toMatchObject({ 'rhf-3': 'PF', 'rhf-4': 'SF' });
  });
});

describe('the court picture\'s commands', () => {
  it('puts a reserve in a circle at once before tip-off, as often as the manager likes, and swaps circles', () => {
    const ready = fixture(5);
    let next = placeInCircle(ready, 'home', 'rhf-6', 'SF');
    expect(next.lineups.home).toContain('rhf-6');
    expect(next.lineups.home).not.toContain('rhf-3');
    expect(next.slots).toEqual({ home: { 'rhf-6': 'SF' } });
    expect(next.substitutionLocks).toEqual([]);
    expect(next.rngState).toBe(ready.rngState);
    // The guard just brought in can be replaced again before tip-off.
    next = placeInCircle(next, 'home', 'rhf-8', 'SF');
    expect(next.lineups.home).not.toContain('rhf-6');
    expect(next.slots).toEqual({ home: { 'rhf-8': 'SF' } });
    // On-court players trade circles; putting a player where he already is changes nothing.
    next = placeInCircle(next, 'home', 'rhf-1', 'SF');
    expect(next.slots!.home).toEqual({ 'rhf-1': 'SF', 'rhf-8': 'PG' });
    expect(placeInCircle(next, 'home', 'rhf-1', 'SF')).toBe(next);
    expect(() => placeInCircle(next, 'home', 'aeg-6', 'PG')).toThrow(/belong to this team/);
    expect(parseMatch(serializeMatch(next))).toEqual(next);
  });

  it('queues a reserve during play for the circle\'s player, who hands over his circle at the stoppage', () => {
    let live = fixture(9);
    while (live.stepCount < 20 || live.stoppage || !live.possessionPlay) live = stepMatch(live);
    const shown = courtCircles(live, 'home'), occupant = Object.keys(shown).find(id => shown[id] === 'PF')!;
    const [reserve, other] = live.home.players.filter(player => !live.lineups.home.includes(player.id)).map(player => player.id) as [string, string];
    // A cancelled request leaves no circle behind.
    const queuedOther = placeInCircle(live, 'home', other, 'PF');
    expect(queuedOther.slots!.home).toEqual({ [other]: 'PF' });
    expect(parseMatch(serializeMatch(queuedOther))).toEqual(queuedOther);
    expect(cancelSubstitution(queuedOther, 'home', occupant).slots!.home).toEqual({});
    let next = placeInCircle(live, 'home', reserve, 'PF');
    expect(next.pendingSubstitutions.home).toEqual([{ outId: occupant, inId: reserve }]);
    expect(next.lineups.home).toContain(occupant);
    while (next.pendingSubstitutions.home.length && next.status !== 'finished') next = stepMatch(next);
    expect(next.lineups.home).toContain(reserve);
    expect(next.slots!.home).toEqual({ [reserve]: 'PF' });
    expect(courtCircles(next, 'home')[reserve]).toBe('PF');
    expect(next.startingSlots).toBeUndefined();
    expect(parseMatch(serializeMatch(finish(next))).status).toBe('finished');
  });

  it('fills the five circles with healthy players in balanced positions with "Best five"', () => {
    // A guard, a reserve guard, two centres and a reserve forward start; one of the best starters is injured.
    const injured = 'rhf-3';
    let ready = setInjuryMode(createFixtureMatch(3, FICTIONAL_HOME, FICTIONAL_AWAY, { lineups: { home: ['rhf-1', 'rhf-6', 'rhf-5', 'rhf-10', 'rhf-9'] }, preExistingInjuries: { [injured]: 'ankle-sprain' } }), 'standard');
    const target = bestCircles(ready, 'home');
    expect(Object.values(target).sort()).toEqual(['C', 'PF', 'PG', 'SF', 'SG']);
    expect(Object.keys(target)).not.toContain(injured);
    expect(target).toMatchObject({ 'rhf-1': 'PG', 'rhf-2': 'SG', 'rhf-4': 'PF', 'rhf-5': 'C' });
    ready = arrangeBestFive(ready, 'home');
    expect(ready.slots!.home).toEqual(target);
    expect(courtCircles(ready, 'home')).toEqual(target);
    expect(ready.stepCount).toBe(0);
    expect(arrangeBestFive(ready, 'home')).toBe(ready);
    // A five already in its best circles is left alone.
    const plain = fixture(3);
    expect(arrangeBestFive(plain, 'home')).toBe(plain);
  });
});
