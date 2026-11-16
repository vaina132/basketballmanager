import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { MatchState } from '../src/domain/types';
import { createMatch, setAutoSubstitutions, setInjuryMode, simulateToEnd, stepMatch, substitutePlayer, swapActivePlayers } from '../src/engine/match';
import { parseMatch, serializeMatch } from '../src/storage/match-storage';
import { MatchLineup } from '../src/ui/MatchLineup';

const noop = () => {};
const start = (seed: number) => setInjuryMode(createMatch(seed), 'off');
/** The assistant replaces fouled-out players so that the match runs to its end. */
const finish = (state: MatchState) => simulateToEnd(setAutoSubstitutions(state, 'home', true));
/** Steps until the ball is live mid-possession: a substitution now would have to wait for a stoppage. */
function livePlay(state: MatchState): MatchState {
  let next = state;
  while (next.stepCount < 20 || next.stoppage || !next.possessionPlay) next = stepMatch(next);
  return next;
}

describe('swapping two players on the court (owner feedback, 16 November 2026)', () => {
  it('swaps their places in the five at once, before tipoff and during live play, without randomness', () => {
    const ready = start(11), [a, b, c, d, e] = ready.lineups.home as [string, string, string, string, string];
    const swapped = swapActivePlayers(ready, 'home', a, c);
    expect(swapped.lineups.home).toEqual([c, b, a, d, e]);
    expect(ready.lineups.home).toEqual([a, b, c, d, e]);
    expect(swapped.rngState).toBe(ready.rngState);
    expect(swapped.events.at(-1)).toMatchObject({ type: 'command', side: 'home' });
    expect(swapped.events.at(-1)!.text).toContain('swap places on the floor');
    expect(parseMatch(serializeMatch(swapped)).lineups.home).toEqual([c, b, a, d, e]);

    const live = livePlay(ready), [first, , , , last] = live.lineups.home as string[];
    const moved = swapActivePlayers(live, 'home', first!, last!);
    expect(moved.lineups.home[0]).toBe(last);
    expect(moved.lineups.home[4]).toBe(first);
    expect(moved.pendingSubstitutions.home).toEqual([]);
    expect(moved.stepCount).toBe(live.stepCount);
    const finished = finish(moved);
    expect(finished.status).toBe('finished');
    expect(() => serializeMatch(finished)).not.toThrow();
  });

  it('keeps a queued substitution with the player it names after he swaps places', () => {
    const live = livePlay(start(23)), [outgoing, , other] = live.lineups.home as string[];
    const incoming = live.home.players.find(player => !live.lineups.home.includes(player.id))!.id;
    const queued = substitutePlayer(live, 'home', outgoing!, incoming);
    expect(queued.pendingSubstitutions.home).toEqual([{ outId: outgoing, inId: incoming }]);
    let next = swapActivePlayers(queued, 'home', outgoing!, other!);
    expect(next.lineups.home.indexOf(outgoing!)).toBe(2);
    while (next.pendingSubstitutions.home.length && next.status !== 'finished') next = stepMatch(next);
    expect(next.lineups.home).not.toContain(outgoing);
    expect(next.lineups.home[2]).toBe(incoming);
    expect(next.lineups.home[0]).toBe(other);
  });

  it('refuses a bench player, the same player twice and a finished match', () => {
    const ready = start(5), bench = ready.home.players.find(player => !ready.lineups.home.includes(player.id))!.id, [a, b] = ready.lineups.home as string[];
    expect(() => swapActivePlayers(ready, 'home', a!, bench)).toThrow(/on the court/);
    expect(() => swapActivePlayers(ready, 'home', a!, a!)).toThrow(/two different/);
    expect(() => swapActivePlayers(ready, 'home', a!, ready.lineups.away[0]!)).toThrow(/on the court/);
    expect(() => swapActivePlayers(finish(ready), 'home', a!, b!)).toThrow(/finished/);
  });

  it('offers drag, click and keyboard selection on the court as well as the bench, only for the managed team', () => {
    const ready = start(7), [a] = ready.lineups.home as string[];
    const name = ready.home.players.find(player => player.id === a)!.name;
    const html = renderToStaticMarkup(<MatchLineup match={ready} managedSide="home" apply={noop} onInteractionStart={noop} />);
    expect(html.match(/<article[^>]*draggable="true"/g)).toHaveLength(ready.home.players.length);
    expect(html).toContain(`aria-label="Select ${name} on court,`);
    expect(html).toContain('Drag or select two on-court players to swap their places at once.');
    const finished = renderToStaticMarkup(<MatchLineup match={finish(ready)} managedSide="home" apply={noop} onInteractionStart={noop} />);
    expect(finished).not.toContain('draggable="true"');
    expect(finished).not.toContain('data-sub-out');
  });
});
