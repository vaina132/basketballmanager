import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FICTIONAL_AWAY, FICTIONAL_HOME } from '../src/data/fictional-teams';
import type { MatchState } from '../src/domain/types';
import { cancelSubstitution, createFixtureMatch, createMatch, placeInCircle, setAutoSubstitutions, setInjuryMode, simulateToEnd, stepMatch } from '../src/engine/match';
import { createSeason } from '../src/world/season';
import { SquadStartingFive } from '../src/ui/SquadStartingFive';
import { courtCircles } from '../src/engine/positions';
import { MatchLineup } from '../src/ui/MatchLineup';
import { outOfPositionWarning, resolveCourtPick, sortBench, type CourtPick } from '../src/ui/court-five-moves';

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

  it('shows each player\'s live match rating on his circle and bench row, "–" before he has played, and sorts the bench by it', () => {
    let match = ready();
    for (let i = 0; i < 6; i += 1) match = stepMatch(match);
    expect(match.stepCount).toBeGreaterThan(0);
    // A known box score for the point guard: 12 pts, 5 reb, 3 ast, 2 TO on 5/9 FG and 2/2 FT = PIR 14, rating 7.4.
    const pg = { ...match.stats['rhf-1'], points: 12, rebounds: 5, assists: 3, steals: 0, blocks: 0, turnovers: 2, fouls: 0, fieldGoalsMade: 5, fieldGoalsAttempted: 9, freeThrowsMade: 2, freeThrowsAttempted: 2 };
    // A reserve who came on and played well, and one who has not played.
    const reserve = { ...match.stats['rhf-9'], secondsPlayed: 120, points: 4, fieldGoalsMade: 2, fieldGoalsAttempted: 2, rebounds: 1 };
    match = { ...match, stats: { ...match.stats, 'rhf-1': pg, 'rhf-9': reserve } };
    const html = render(match);
    expect(html).toContain('Match rating so far: 7.4 · 12 pts, 5 reb, 3 ast, 2 TO · PIR 14');
    expect(html).toMatch(/data-court-circle="PG"[^>]*>.*?data-match-rating="7.4"/);
    expect(html).toContain(', 100% stamina, match rating 7.4'.replace('100', String(Math.round(pg.condition))));
    // Reserves who have not played show "–"; the one who played shows his rating.
    const unrated = html.match(/data-match-rating="unrated"[^>]*><span aria-hidden="true">–<\/span>/g) ?? [];
    expect(unrated.length).toBeGreaterThanOrEqual(1);
    expect(html).toContain('Match rating so far: – (not played yet)');
    expect(html).toContain('data-match-rating="6.5"');
    expect(html).toContain('data-bench-sort="rating"');
    // Sorted by match rating, the reserve who played comes first; by position the bench runs PG to C.
    const reserves = match.home.players.filter(player => !match.lineups.home.includes(player.id));
    expect(sortBench(reserves, match.stats, 'rating')[0].id).toBe('rhf-9');
    const order = sortBench(reserves, match.stats, 'position').map(player => ['PG', 'SG', 'SF', 'PF', 'C'].indexOf(player.position));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // Before tip-off and on the Squad page there are no match ratings.
    expect(render(ready())).not.toContain('data-match-rating');
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

describe('withdrawing a queued substitution (owner feedback, 22 November 2026)', () => {
  it('offers Cancel on the list, the circle and the bench row, restores the five, and is refused once the change is made', () => {
    let live = ready(9);
    while (live.stepCount < 20 || live.stoppage || !live.possessionPlay) live = stepMatch(live);
    const shown = courtCircles(live, 'home'), occupant = Object.keys(shown).find(id => shown[id] === 'PF')!;
    const reserveId = live.home.players.find(player => !live.lineups.home.includes(player.id))!.id;
    const queued = placeInCircle(live, 'home', reserveId, 'PF');
    expect(queued.pendingSubstitutions.home).toEqual([{ outId: occupant, inId: reserveId }]);
    const html = render(queued);
    // One tap or key on any of three buttons: the queued list, the label under the circle and the reserve's row.
    expect(html).toMatch(new RegExp(`<button[^>]*data-cancel-lineup-sub="${occupant}"[^>]*>`));
    expect(html).toMatch(new RegExp(`<button[^>]*data-cancel-court-sub="${occupant}"[^>]*>`));
    expect(html).toMatch(new RegExp(`<button[^>]*data-cancel-bench-sub="${occupant}"[^>]*>`));
    expect(html).toContain('drag the reserve back to the bench');
    // Cancelling restores the five, the circles and the randomness exactly.
    const cancelled = cancelSubstitution(queued, 'home', occupant);
    expect(cancelled.pendingSubstitutions.home).toEqual([]);
    expect(cancelled.lineups).toEqual(live.lineups);
    expect(cancelled.slots?.home ?? {}).toEqual(live.slots?.home ?? {});
    expect(cancelled.rngState).toBe(live.rngState);
    expect(render(cancelled)).not.toContain('data-cancel-lineup-sub');
    // Played on, a cancelled change never happens; a change that was made cannot be cancelled any more.
    let played = cancelled;
    for (let step = 0; step < 40 && played.status !== 'finished'; step += 1) played = stepMatch(played);
    expect(played.events.some(event => event.type === 'substitution' && event.playerId === reserveId)).toBe(false);
    let applied = queued;
    while (applied.pendingSubstitutions.home.length && applied.status !== 'finished') applied = stepMatch(applied);
    expect(applied.lineups.home).toContain(reserveId);
    expect(() => cancelSubstitution(applied, 'home', occupant)).toThrow(/no longer waiting/);
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

  it('is on the Squad page for the next game, and points to the Match center while a game is in play', () => {
    const season = createSeason({ seed: 77, managedClubId: 'rhine-falcons', injuryMode: 'off' });
    const squad = (state: typeof season) => renderToStaticMarkup(<SquadStartingFive season={state} busy={false} onUpdate={noop} onOpenMatch={noop} />);
    const html = squad(season);
    expect(html).toContain('>Starting five</h2>');
    expect(html).toContain('Next game: ');
    expect(html).toContain('Your five for the next game.');
    expect(html.match(/data-court-circle="/g)).toHaveLength(5);
    expect(html).toContain('data-best-five');
    expect(html).toMatch(/data-court-reserve="/);
    const playing = squad({ ...season, activeMatch: stepMatch(season.activeMatch!) });
    expect(playing).not.toContain('data-court-circle');
    expect(playing).toContain('A game is in play. Change your five in the Match center.');
    expect(playing).toContain('Open Match center');
    expect(squad({ ...season, status: 'complete' })).toBe('');
  });
});
