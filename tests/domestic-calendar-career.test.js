import { describe, it, expect } from 'vitest';
import { testWorld } from './world-fixtures';
import { createSeason, advanceSeason, rolloverSeason, NEW_CAREER_SYSTEMS, managedSide, getStandings } from '../src/world/season';
import { simulateToEnd, setAutoSubstitutions } from '../src/engine/match';
import { serializeSeasonCompact, parseSeason } from '../src/storage/season-storage';
import { advanceMarket } from '../src/world/market';
import { getMarketStartReason } from '../src/world/market-policy';
import { setEmploymentDelegation } from '../src/world/employment';
import { validateWorld } from '../src/world/career-world';
import { quoteScoutingAssignment } from '../src/world/scouting-policy';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RestWeek } from '../src/ui/RestWeek';

export function calendarWorld(sizes = [5, 4]) {
  const world = testWorld(sizes.reduce((sum, size) => sum + size, 0));
  let offset = 0;
  return { ...world, id: 'calendar-test', rosterModel: 'club-roster-1', domesticLeagues: sizes.map((size, index) => ({ id: `league-${index}`, name: `League ${index}`, country: 'Test', tier: 1, clubIds: world.clubs.slice(offset, offset += size).map(club => club.id) })) };
}
function play(state) { return state.activeMatch ? { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) } : state; }
describe('domestic careers on a shared weekly calendar', () => {
  it('starts on a real bye, completes both leagues, strictly reloads every week and rolls over', () => {
    const world = calendarWorld();
    let state = setEmploymentDelegation(createSeason({ world, managedClubId: world.clubs[0].id, ...NEW_CAREER_SYSTEMS, injuryMode: 'off' }), true);
    expect(state.activeMatch).toBeNull();
    expect(state.activeFixtureId).toBeNull();
    expect(state.fixtures).toHaveLength(5 * 4 + 4 * 3);
    let byes = 0;
    while (state.status === 'active') {
      if (!state.activeMatch) byes++;
      expect(parseSeason(serializeSeasonCompact(state))).toEqual(state);
      state = advanceSeason(play(state));
    }
    expect(byes).toBe(2);
    expect(state.fixtures.every(fixture => fixture.result)).toBe(true);
    expect(getStandings(state).filter(row => row.position === 1)).toHaveLength(2);
    expect(getStandings(state).filter(row => row.played === 8)).toHaveLength(5);
    expect(getStandings(state).filter(row => row.played === 6)).toHaveLength(4);
    expect(parseSeason(serializeSeasonCompact(state))).toEqual(state);
    for (let steps = 0; steps < 80 && getMarketStartReason(state); steps++) state = advanceMarket(state);
    expect(getMarketStartReason(state)).toBeNull();
    state = rolloverSeason(state);
    expect(state.seasonNumber).toBe(2);
    expect(parseSeason(serializeSeasonCompact(state))).toEqual(state);
    while (state.status === 'active') state = advanceSeason(play(state));
    expect(parseSeason(serializeSeasonCompact(state))).toEqual(state);
  }, 120000);
  it('supports a final-week bye and rejects missing or invented rest evidence', () => {
    const world = calendarWorld([5]);
    const initial = createSeason({ world, injuryMode: 'off' });
    const finalClubs = new Set(initial.fixtures.filter(fixture => fixture.round === 10).flatMap(fixture => [fixture.homeClubId, fixture.awayClubId]));
    const clubId = world.clubs.find(club => !finalClubs.has(club.id)).id;
    let state = createSeason({ world, managedClubId: clubId, injuryMode: 'off' });
    while (state.status === 'active') {
      state = advanceSeason(play(state));
      expect(parseSeason(serializeSeasonCompact(state))).toEqual(state);
    }
    expect(state.activeMatch).toBeNull();
    expect(state.activeFixtureId).toBeNull();
    expect(parseSeason(serializeSeasonCompact(rolloverSeason(state))).seasonNumber).toBe(2);
    const missing = structuredClone(state); missing.restWeeks.pop();
    expect(() => serializeSeasonCompact(missing)).toThrow(/restWeeks/);
    const invented = structuredClone(state); invented.activeMatch = initial.activeMatch;
    if (initial.activeMatch) expect(() => serializeSeasonCompact(invented)).toThrow(/activeMatch/);
    const changed = structuredClone(state); changed.restWeeks.at(-1).conditions[world.clubs.find(club => club.id === changed.restWeeks.at(-1).clubId).players[0].id] = 1;
    expect(() => serializeSeasonCompact(changed)).toThrow(/restWeeks/);
  }, 120000);
  it('pays weekly wages and operations on a bye without a gate or player appearance', () => {
    const world = calendarWorld(), before = createSeason({ world, injuryMode: 'off' });
    const snapshot = JSON.stringify(before), next = advanceSeason(before);
    const entries = next.finance.ledger.filter(entry => entry.clubId === before.managedClubId && entry.round === 1);
    expect(entries.filter(entry => entry.kind === 'operations')).toHaveLength(1);
    expect(entries.filter(entry => entry.kind === 'payroll')).toHaveLength(1);
    expect(entries.filter(entry => entry.kind === 'tickets')).toHaveLength(0);
    expect(next.fixtures.filter(fixture => fixture.round === 1).every(fixture => !fixture.result.stats[world.clubs[0].players[0].id])).toBe(true);
    expect(next.training.lastWeek.afterRound).toBe(1);
    expect(JSON.stringify(before)).toBe(snapshot);
    expect(() => advanceSeason({ ...before, date: '2026-09-06' })).toThrow(/date/);
    expect(() => advanceSeason({ ...before, fixtures: before.fixtures.slice(1) })).toThrow(/awaiting/);
  });
  it('requires an actual match for scouting and keeps unknown skills unknown on a bye', () => {
    const world = calendarWorld(), state = createSeason({ world, managedClubId: world.clubs[6].id, scouting: true });
    const quote = quoteScoutingAssignment(state, world.clubs[0].players[0].id);
    expect(quote.canAssign).toBe(false);
    expect(quote.reason).toMatch(/rest week/);
  });
  it('rechecks changed league membership even after the same world object was validated', () => {
    const world = calendarWorld(); validateWorld(world);
    world.domesticLeagues[1].clubIds[0] = world.domesticLeagues[0].clubIds[0];
    expect(() => validateWorld(world)).toThrow(/exactly one league/);
  });
  it('renders a compact rest workspace with real condition, without presenting the squad adapter as a match', () => {
    const state = createSeason({ world: calendarWorld() }), before = JSON.stringify(state);
    const markup = renderToStaticMarkup(createElement(RestWeek, { season: state, busy: false, onContinue() {}, onTraining() {} }));
    expect(markup).toContain('No match for');
    expect(markup).toContain('Next match:');
    expect(markup.match(/role="meter"/g)).toHaveLength(state.clubs[0].players.length);
    expect(markup).not.toContain('scoreboard');
    expect(JSON.stringify(state)).toBe(before);
  });
});
