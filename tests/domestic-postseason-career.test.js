import { describe, expect, it } from 'vitest';
import { testWorld } from './world-fixtures';
import { advanceSeason, createSeason, currentGameDay, getPostseasons, getStandings, managedSide, NEW_CAREER_SYSTEMS, rolloverSeason } from '../src/world/season';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { parseSeason, serializeSeasonCompact } from '../src/storage/season-storage';
import { advanceMarket } from '../src/world/market';
import { getMarketStartReason } from '../src/world/market-policy';
import { setEmploymentDelegation } from '../src/world/employment';
import { seasonRounds, validateWorld } from '../src/world/career-world';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PostseasonPanel } from '../src/ui/PostseasonPanel';

/** Two public leagues (6 and 5 clubs) with the generic top-four playoffs: semi-finals and final, best of three. */
function playoffWorld(postseason = 'top4-1') {
  const world = testWorld(11);
  return { ...world, id: 'postseason-test', rosterModel: 'club-roster-1', domesticLeagues: [
    { id: 'league-a', name: 'League A', country: 'Testland', tier: 1, clubIds: world.clubs.slice(0, 6).map(club => club.id), postseason },
    { id: 'league-b', name: 'League B', country: 'Otherland', tier: 1, clubIds: world.clubs.slice(6).map(club => club.id), postseason },
  ] };
}
const play = state => state.activeMatch ? { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) } : state;
const roundTrip = state => parseSeason(serializeSeasonCompact(state));

describe('domestic postseasons in a career (steps 3.4a and 3.4b)', () => {
  it('reserve playoff weeks after the regular season and refuse formats a league cannot hold', () => {
    const world = playoffWorld();
    expect(() => validateWorld(world)).not.toThrow();
    expect(seasonRounds({ world })).toBe(10 + 2);
    expect(() => validateWorld({ ...world, domesticLeagues: world.domesticLeagues.map((league, index) => index ? { ...league, postseason: undefined } : league).map(({ postseason, ...league }) => postseason ? { ...league, postseason } : league) })).toThrow(/every league or none/);
    expect(() => validateWorld({ ...world, domesticLeagues: world.domesticLeagues.map(league => ({ ...league, country: 'Germany' })) })).toThrow(/this country and division's format/);
    const opening = createSeason({ world, managedClubId: world.clubs[0].id, ...NEW_CAREER_SYSTEMS });
    expect(opening.fixtures).toHaveLength(6 * 5 + 5 * 4);
    expect(opening.fixtures.every(fixture => !fixture.stage)).toBe(true);
  });

  it('play several game days in a playoff week one at a time, strictly reloading at every step, then crown champions and roll over', () => {
    const world = playoffWorld();
    let state = setEmploymentDelegation(createSeason({ world, managedClubId: world.clubs[0].id, ...NEW_CAREER_SYSTEMS, injuryMode: 'standard' }), true);
    const gameDaysByWeek = new Map(), managedPlayoffGames = [];
    while (state.status === 'active') {
      expect(roundTrip(state)).toEqual(state);
      const day = currentGameDay(state);
      if (day) gameDaysByWeek.set(state.round, new Set([...(gameDaysByWeek.get(state.round) ?? []), day]));
      if (state.activeFixtureId) { const fixture = state.fixtures.find(item => item.id === state.activeFixtureId); if (fixture.stage) managedPlayoffGames.push(fixture.id); expect(fixture.date).toBe(day); }
      state = advanceSeason(play(state));
    }
    expect(roundTrip(state)).toEqual(state);
    // Regular weeks have one game day (Saturday); playoff weeks use Saturday, Tuesday and Thursday.
    for (let week = 1; week <= 10; week += 1) expect(gameDaysByWeek.get(week)?.size ?? 0).toBeLessThanOrEqual(1);
    expect(gameDaysByWeek.get(11).size).toBe(3);
    const postseasons = getPostseasons(state, 1);
    expect(postseasons.map(entry => entry.league.id)).toEqual(['league-a', 'league-b']);
    for (const entry of postseasons) {
      expect(entry.series.every(series => series.winner)).toBe(true);
      expect(entry.outcome.champion).toBe(entry.series.find(series => series.id === 'final').winner);
      expect(entry.order.slice(0, 4)).toContain(entry.outcome.champion);
      for (const series of entry.series) expect(series.fixtureIds.length).toBeGreaterThanOrEqual(2);
    }
    // League tables count regular-season games only.
    const table = getStandings(state);
    expect(table.filter(row => row.played === 10)).toHaveLength(6);
    expect(table.filter(row => row.played === 8)).toHaveLength(5);
    expect(state.fixtures.filter(fixture => fixture.stage).every(fixture => fixture.result && fixture.round > 10)).toBe(true);
    // The manager's club plays every playoff game it reaches through the match screen.
    const managedInPlayoffs = state.fixtures.filter(fixture => fixture.stage && [fixture.homeClubId, fixture.awayClubId].includes(world.clubs[0].id));
    expect(managedPlayoffGames).toEqual(managedInPlayoffs.map(fixture => fixture.id));

    // The Competition screen's playoff panel shows each series, its score and the champion.
    const panel = renderToStaticMarkup(createElement(PostseasonPanel, { season: state, seasonNumber: 1, leagueId: 'league-a', managedId: world.clubs[0].id }));
    const championA = state.clubs.find(club => club.id === postseasons[0].outcome.champion).name;
    expect(panel).toContain('Playoffs');
    expect(panel).toContain('Semi-finals');
    expect(panel).toContain('Best of 3');
    expect(panel).toContain(championA + '</li>');
    expect((panel.match(/data-series-id=/g) ?? []).length).toBe(3);
    for (let steps = 0; steps < 120 && getMarketStartReason(state); steps += 1) state = advanceMarket(state);
    expect(getMarketStartReason(state)).toBeNull();
    state = rolloverSeason(state);
    expect(state.seasonNumber).toBe(2);
    expect(state.history[0].fixtures.filter(fixture => fixture.stage).length).toBe(postseasons.flatMap(entry => entry.fixtures).length);
    expect(roundTrip(state)).toEqual(state);
    for (let week = 0; week < 2; week += 1) state = advanceSeason(play(state));
    expect(roundTrip(state)).toEqual(state);
  }, 600_000);
});
