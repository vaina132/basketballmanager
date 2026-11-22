import { describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { courtCircles } from '../src/engine/positions';
import { advanceSeason, createSeason, managedSide, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { autoPickSquad, getSquadBoard, moveSquadPlayer } from '../src/world/squad-board';
import { parseSeason, serializeSeasonCompact } from '../src/storage/season-storage';
import { fullRosterWorld } from './full-roster-fixtures';
import { renderToStaticMarkup } from 'react-dom/server';
import { SquadStartingFive } from '../src/ui/SquadStartingFive';

const world = fullRosterWorld();
const CLUB = world.clubs[2]!.id; // 17 players: twelve in the matchday squad, five reserves
const opening = () => createSeason({ seed: 8083, world, managedClubId: CLUB, injuryMode: 'off', ...NEW_CAREER_SYSTEMS });
const finish = (state: SeasonState) => ({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch!, managedSide(state), true)) });
const squadOf = (state: SeasonState) => state.activeMatch![managedSide(state)].players.map(player => player.id);

describe('bench and reserves beside the court on the Squad page (owner feedback, 22 November 2026)', () => {
  it('moves players between court, bench and reserves, and the next match uses the five and the matchday squad', () => {
    let state = opening();
    const board = getSquadBoard(state);
    expect(board.five).toHaveLength(5);
    expect(board.five.length + board.bench.length).toBe(12);
    expect(board.reserves).toHaveLength(5);
    const side = board.side, circles = courtCircles(board.match, side);
    const starter = board.five.find(id => circles[id] === 'SF')!, reserve = board.reserves[0]!, benchPlayer = board.bench[0]!;

    // Court to reserves: a bench player takes his circle and he leaves the matchday squad.
    state = moveSquadPlayer(state, starter, { kind: 'reserves' });
    expect(squadOf(state)).not.toContain(starter);
    expect(squadOf(state)).toHaveLength(11);
    expect(state.activeMatch!.lineups[side]).not.toContain(starter);
    expect(state.plans[CLUB]!.matchday).not.toContain(starter);
    expect(Object.values(courtCircles(state.activeMatch!, side))).toContain('SF');

    // Reserves to bench, then bench to court: the reserve starts at SF.
    state = moveSquadPlayer(state, reserve, { kind: 'bench' });
    expect(squadOf(state)).toContain(reserve);
    state = moveSquadPlayer(state, reserve, { kind: 'court', position: 'SF' });
    expect(state.activeMatch!.lineups[side]).toContain(reserve);
    expect(courtCircles(state.activeMatch!, side)[reserve]).toBe('SF');
    expect(state.plans[CLUB]!.lineup).toContain(reserve);

    // Bench to reserves, and a reserve dropped on a bench player swaps with him.
    state = moveSquadPlayer(state, benchPlayer, { kind: 'reserves' });
    expect(squadOf(state)).not.toContain(benchPlayer);
    state = moveSquadPlayer(state, benchPlayer, { kind: 'bench', swapWith: getSquadBoard(state).bench[0]! });
    expect(squadOf(state)).toContain(benchPlayer);
    expect(squadOf(state)).toHaveLength(11);
    state = moveSquadPlayer(state, getSquadBoard(state).reserves[0]!, { kind: 'bench' });
    expect(squadOf(state)).toHaveLength(12);
    // A full squad refuses a thirteenth player on the bench.
    expect(() => moveSquadPlayer(state, getSquadBoard(state).reserves[0]!, { kind: 'bench' })).toThrow(/full \(12\)/);
    expect(parseSeason(serializeSeasonCompact(state))).toEqual(state);

    // The next game is played with this five and squad, and the plan carries into the game after it.
    const five = [...state.activeMatch!.lineups[side]], squad = squadOf(state);
    const played = finish(state);
    expect(played.activeMatch!.events.length).toBeGreaterThan(0);
    const result = advanceSeason(played).fixtures.find(fixture => fixture.id === state.activeFixtureId)!.result!;
    expect(result.selection![side]).toEqual(squad);
    const next = advanceSeason(played);
    expect(new Set(next.activeMatch!.lineups[managedSide(next)])).toEqual(new Set(five));
    expect(squadOf(next)).toEqual(squad);

    // Auto-pick goes back to the automatic matchday squad and the best five.
    const automatic = autoPickSquad(next);
    expect(automatic.plans[CLUB]!.matchday).toBeNull();
    expect(squadOf(automatic)).toHaveLength(12);
  }, 120_000);

  it('refuses injured players and plans between games', () => {
    let state = opening();
    const board = getSquadBoard(state), reserve = board.reserves[0]!;
    const fixture = state.fixtures.find(item => item.id === state.activeFixtureId)!;
    const injured: SeasonState = { ...state, injuries: [...state.injuries, { id: 'test-injury', playerId: reserve, clubId: CLUB, kind: 'ankle-sprain' as never, fixtureId: fixture.id, occurredOn: '2000-01-01', returnOn: '2999-01-01' }] };
    expect(() => moveSquadPlayer(injured, reserve, { kind: 'bench' })).toThrow(/injured/);
    expect(() => moveSquadPlayer(injured, reserve, { kind: 'court', position: 'C' })).toThrow(/injured/);
    // The Squad page lists the reserves beside the bench; the injured reserve is labelled and cannot be picked.
    const html = renderToStaticMarkup(<SquadStartingFive season={injured} busy={false} onUpdate={() => {}} onOpenMatch={() => {}} />);
    expect(html).toContain('data-squad-reserves');
    expect(html).toContain('12/12 in the matchday squad');
    expect(html.match(/data-squad-reserve="/g)).toHaveLength(4);
    expect(html).not.toContain(`data-squad-reserve="${reserve}"`);
    expect(html).toContain('Injured');
    // Between games the plan alone changes; the next game is prepared from it.
    state = advanceSeason(finish(state));
    const between = { ...state, activeMatch: null };
    const out = getSquadBoard(between).bench[0]!;
    const moved = moveSquadPlayer(between, out, { kind: 'reserves' });
    expect(moved.activeMatch).toBeNull();
    expect(moved.plans[CLUB]!.matchday).not.toContain(out);
    expect(getSquadBoard(moved).reserves).toContain(out);
  }, 120_000);
});
