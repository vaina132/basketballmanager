import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FICTIONAL_AWAY, FICTIONAL_HOME } from '../src/data/fictional-teams';
import type { MatchState } from '../src/domain/types';
import { createFixtureMatch, createMatch, placeInCircle, setAutoSubstitutions, setInjuryMode, simulateToEnd } from '../src/engine/match';
import { courtCircles } from '../src/engine/positions';
import { MatchLineup } from '../src/ui/MatchLineup';
import { outOfPositionWarning, resolveCourtPick, type CourtPick } from '../src/ui/court-five-moves';

const noop = () => {};
const ready = (seed = 7) => setInjuryMode(createFixtureMatch(seed, FICTIONAL_HOME, FICTIONAL_AWAY), 'off');
const render = (match: MatchState, courtPicture = true) => renderToStaticMarkup(<MatchLineup match={match} managedSide="home" courtPicture={courtPicture} apply={noop} onInteractionStart={noop} />);
const circle = (position: 'PG' | 'SG' | 'SF' | 'PF' | 'C'): CourtPick => ({ kind: 'circle', position });
const reserve = (playerId: string): CourtPick => ({ kind: 'bench', playerId });
/** What the court picture does with a pair of picks: a drag from `from` dropped on `to`, or a tap on each in turn. */
const complete = (match: MatchState, from: CourtPick, to: CourtPick) => {
  const move = resolveCourtPick(courtCircles(match, 'home'), from, to);
  return move ? placeInCircle(match, 'home', move.playerId, move.position) : match;
};

describe('the court picture on the match screen (owner request, 16 November 2026)', () => {
  it('shows five circles with name, number, position and stamina, the bench beside them and a Best five button', () => {
    const html = render(ready());
    for (const position of ['PG', 'SG', 'SF', 'PF', 'C']) expect(html).toContain(`data-court-circle="${position}"`);
    expect(html).toContain('Starting five');
    expect(html).toContain('aria-label="Select. PG, point guard: Leon Adler, number 4, listed PG, 100% stamina"');
    expect(html).toContain('>Adler</strong>');
    expect(html.match(/data-court-reserve="/g)).toHaveLength(5);
    expect(html.match(/<button[^>]*data-court-circle="[A-Z]+"[^>]*draggable="true"/g)).toHaveLength(5);
    expect(html).toContain('data-best-five');
    expect(html).toContain('Drag a player onto a circle, or tap a player and then a circle.');
    expect(html).not.toContain('Out of position');
    // A player out of position carries the warning on his circle.
    const moved = placeInCircle(ready(), 'home', 'rhf-1', 'SG');
    const warned = render(moved);
    expect(warned).toContain('data-out-of-position="SG"');
    expect(warned).toContain('Out of position: −5%');
    expect(warned).toContain('listed PG, out of position: −5%');
    // A player the automatic choice shows in another circle plays his listed position, without a warning.
    const covering = render(setInjuryMode(createFixtureMatch(7, FICTIONAL_HOME, FICTIONAL_AWAY, { lineups: { home: ['rhf-1', 'rhf-6', 'rhf-3', 'rhf-4', 'rhf-5'] } }), 'off'));
    expect(covering).toContain('Plays PG');
    expect(covering).not.toContain('Out of position');
  });

  it('puts a reserve in a circle by drag or by tap, swaps circles either way, and never pairs two reserves', () => {
    const start = ready();
    // Drag a reserve onto the small forward's circle, or tap the reserve and then the circle: the same change.
    const dragged = complete(start, reserve('rhf-8'), circle('SF'));
    const tapped = complete(start, reserve('rhf-8'), circle('SF'));
    expect(dragged.slots!.home).toEqual({ 'rhf-8': 'SF' });
    expect(dragged.lineups.home).not.toContain('rhf-3');
    expect(tapped.lineups).toEqual(dragged.lineups);
    // Tapping the circle first and then the reserve does the same.
    expect(complete(start, circle('SF'), reserve('rhf-8')).slots).toEqual(dragged.slots);
    // Circle to circle: the two players swap positions; an empty pairing changes nothing.
    const swapped = complete(start, circle('PG'), circle('C'));
    expect(swapped.slots!.home).toEqual({ 'rhf-1': 'C', 'rhf-5': 'PG' });
    expect(complete(start, reserve('rhf-6'), reserve('rhf-7'))).toBe(start);
    expect(complete(start, circle('PG'), circle('PG'))).toBe(start);
    expect(outOfPositionWarning('PG', 'C')).toBe('Out of position: −25%');
    expect(outOfPositionWarning('C', 'C')).toBeNull();
  });

  it('closes the circles when the match is finished and keeps the old lists for matches without circles', () => {
    const finished = render(simulateToEnd(setAutoSubstitutions(ready(3), 'home', true)));
    expect(finished).toContain('Match finished · substitutions closed.');
    expect(finished).not.toContain('draggable="true"');
    expect(finished).toMatch(/<button[^>]*data-best-five[^>]*disabled=""/);
    const exhibition = render(createMatch(7), false);
    expect(exhibition).not.toContain('data-court-circle');
    expect(exhibition).toContain('Drag or select two on-court players to swap their places at once.');
  });
});

describe('the court picture upside down (owner request, 18 November 2026)', () => {
  it('puts the basket and the centre at the top and the point guard at the bottom, in reading order', () => {
    const html = render(ready());
    const order = [...html.matchAll(/data-court-spot="([A-Z]+)" style="left:(\d+)%;top:(\d+)%"/g)].map(([, position, left, top]) => ({ position, left: Number(left), top: Number(top) }));
    expect(order.map(spot => spot.position)).toEqual(['C', 'PF', 'SF', 'SG', 'PG']);
    const top = Object.fromEntries(order.map(spot => [spot.position, spot.top]));
    expect(Math.min(...order.map(spot => spot.top))).toBe(top.C);
    expect(Math.max(...order.map(spot => spot.top))).toBe(top.PG);
    // The bigs by the basket, the wings below them, the point guard below the wings.
    expect(Math.max(top.C!, top.PF!)).toBeLessThan(Math.min(top.SF!, top.SG!));
    expect(Math.max(top.SF!, top.SG!)).toBeLessThan(top.PG!);
    // The basket is drawn near the top: the court lines are turned upside down.
    expect(html).toContain('transform="matrix(1 0 0 -1 0 150)"');
  });
});
