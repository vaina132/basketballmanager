import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { testWorld } from './world-fixtures';
import { advanceSeason, createSeason, getPostseasons, getStandings, managedSide, NEW_CAREER_SYSTEMS, rolloverSeason } from '../src/world/season';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { parseSeason, serializeSeasonCompact } from '../src/storage/season-storage';
import { advanceMarket } from '../src/world/market';
import { getMarketStartReason } from '../src/world/market-policy';
import { setEmploymentDelegation } from '../src/world/employment';
import { divisionChanges, seasonLeagues } from '../src/world/divisions';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PostseasonPanel } from '../src/ui/PostseasonPanel';

/** One test country with two divisions: six clubs (last two relegated) and five (first and the playoff winner promoted). */
function twoDivisionWorld() {
  const world = testWorld(11);
  // Opening contracts of one to three seasons (owner feedback, 15 November 2026), so the season end keeps longer deals.
  const playerContracts = Object.fromEntries(world.clubs.flatMap(club => club.players.map((player, index) => [player.id, 1 + (index % 3)])));
  return { ...world, id: 'divisions-test', rosterModel: 'club-roster-1', playerContracts, domesticLeagues: [
    { id: 'first', name: 'First division', country: 'Testland', tier: 1, clubIds: world.clubs.slice(0, 6).map(club => club.id), postseason: 'test-tier1-1' },
    { id: 'second', name: 'Second division', country: 'Testland', tier: 2, clubIds: world.clubs.slice(6).map(club => club.id), postseason: 'test-tier2-1' },
  ] };
}
const play = state => state.activeMatch ? { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) } : state;
const roundTrip = state => parseSeason(serializeSeasonCompact(state));

describe('promotion and relegation between a country\'s divisions (step 3.4c)', () => {
  it('moves the relegated and promoted clubs at the season end, schedules the next season by the new divisions and keeps every save checkable', () => {
    const world = twoDivisionWorld();
    let state = setEmploymentDelegation(createSeason({ seed: 9, world, managedClubId: world.clubs[0].id, ...NEW_CAREER_SYSTEMS }), true);
    expect(state.divisions).toEqual({ changesFrom: 1, leagues: [{ id: 'first', clubIds: world.domesticLeagues[0].clubIds }, { id: 'second', clubIds: world.domesticLeagues[1].clubIds }] });
    while (state.status === 'active') state = advanceSeason(play(state));
    expect(roundTrip(state)).toEqual(state);
    const [first, second] = getPostseasons(state, 1);
    const relegated = first.outcome.relegated.map(entry => entry.clubId), promoted = second.outcome.promoted;
    expect(relegated).toEqual(first.order.slice(-2));
    expect(promoted[0]).toBe(second.order[0]);
    expect(promoted[1]).toBe(second.series.find(series => series.id === 'final').winner);
    // The first division's relegations move; the second division's have no division below in this game yet.
    const panel = league => renderToStaticMarkup(createElement(PostseasonPanel, { season: state, seasonNumber: 1, leagueId: league, managedId: world.clubs[0].id }));
    expect(panel('first')).not.toContain('they stay for now');
    expect(panel('second')).toContain('Promoted');
    for (let steps = 0; steps < 120 && getMarketStartReason(state); steps += 1) state = advanceMarket(state);
    state = rolloverSeason(state);
    // Players whose opening contracts run three seasons are still under contract and paid in season two.
    const longDeals = Object.entries(world.playerContracts).filter(([, years]) => years === 3).map(([id]) => id);
    expect(longDeals.length).toBeGreaterThan(0);
    for (const id of longDeals) expect(state.employment.contracts.some(contract => contract.playerId === id && contract.kind === 'initial' && contract.endsSeason === 3)).toBe(true);
    expect(state.payroll.agreements.some(agreement => agreement.seasonNumber === 2 && longDeals.includes(agreement.playerId))).toBe(true);
    // Season two: the clubs changed places; sizes are unchanged.
    const leagues = seasonLeagues(state.world, state.divisions);
    expect(leagues.map(league => league.clubIds.length)).toEqual([6, 5]);
    for (const id of promoted) expect(leagues[0].clubIds).toContain(id);
    for (const id of relegated) expect(leagues[1].clubIds).toContain(id);
    expect(state.history[0].divisions).toEqual({ changesFrom: 1, leagues: world.domesticLeagues.map(league => ({ id: league.id, clubIds: league.clubIds })) });
    // The new schedule pairs clubs within their new divisions only.
    for (const fixture of state.fixtures) expect(leagues.some(league => league.clubIds.includes(fixture.homeClubId) && league.clubIds.includes(fixture.awayClubId))).toBe(true);
    expect(roundTrip(state)).toEqual(state);
    for (let week = 0; week < 2; week += 1) state = advanceSeason(play(state));
    expect(getStandings(state).filter(row => leagues[0].clubIds.includes(row.clubId))).toHaveLength(6);
    expect(roundTrip(state)).toEqual(state);
    // A save whose divisions do not follow the results is refused.
    const swapped = structuredClone(state);
    const [a, b] = [swapped.divisions.leagues[0].clubIds[0], swapped.divisions.leagues[1].clubIds[0]];
    swapped.divisions.leagues[0].clubIds[0] = b; swapped.divisions.leagues[1].clubIds[0] = a;
    expect(() => parseSeason(JSON.stringify({ format: 'basketball-manager-season', formatVersion: 50, engineVersion: 'possession-3', state: swapped }))).toThrow(/Invalid season save/);
  }, 600_000);

  it('keep France\'s 15th up when it wins the second division\'s promotion final, and refuse unbalanced counts', () => {
    const league = (id, tier, clubIds) => ({ id, name: id, country: 'France', tier, clubIds });
    const top = league('elite', 1, ['t1', 't2', 't15', 't16']), lower = league('elite2', 2, ['s1', 's2', 's3']);
    const entry = (target, relegated, promoted, finalWinner) => ({ league: target, format: {}, series: [{ id: 'final', winner: finalWinner }], outcome: { champion: null, promoted, relegated } });
    const relegation = [{ clubId: 't16', unlessWinsLowerFinal: false }, { clubId: 't15', unlessWinsLowerFinal: true }];
    // The top division's 15th wins the promotion final: only 16th goes down, only the second division's first goes up.
    const stays = divisionChanges([top, lower], [entry(top, relegation, [], null), entry(lower, [], ['s1', 't15'], 't15')]);
    expect(stays.moves).toEqual([{ clubId: 't16', fromLeagueId: 'elite', toLeagueId: 'elite2' }, { clubId: 's1', fromLeagueId: 'elite2', toLeagueId: 'elite' }]);
    expect(stays.leagues.find(item => item.id === 'elite').clubIds).toEqual(['t1', 't2', 't15', 's1']);
    // A second-division club wins it: two down, two up.
    const swaps = divisionChanges([top, lower], [entry(top, relegation, [], null), entry(lower, [], ['s1', 's2'], 's2')]);
    expect(swaps.leagues.map(item => item.clubIds)).toEqual([['t1', 't2', 's1', 's2'], ['s3', 't16', 't15']]);
    expect(() => divisionChanges([top, lower], [entry(top, relegation, [], null), entry(lower, [], ['s1'], 'x')])).toThrow(/do not balance/);
    expect(() => divisionChanges([top, lower], [entry(top, [{ clubId: null, unlessWinsLowerFinal: false }], [], null), entry(lower, [], ['s1'], 's1')])).toThrow(/Complete both/);
  });

  it('upgrade a genuine format-49 career: seasons already played keep their divisions, changes begin at the current season\'s end', () => {
    const root = new URL('./fixtures/', import.meta.url);
    const manifest = JSON.parse(readFileSync(new URL('season49-divisions-legacy-manifest.json', root), 'utf8'));
    const bytes = readFileSync(new URL('season49-divisions-legacy.json.gz', root)), nextBytes = readFileSync(new URL('season49-divisions-legacy-next.json.gz', root));
    const hash = value => createHash('sha256').update(value).digest('hex');
    expect(hash(bytes)).toBe(manifest.inputSha256);
    expect(hash(nextBytes)).toBe(manifest.nextSha256);
    const state = parseSeason(gunzipSync(bytes).toString('utf8'));
    expect(state.seasonNumber).toBe(2);
    expect(state.history[0].divisions).toBeUndefined();
    expect(state.divisions).toEqual({ changesFrom: 2, leagues: state.world.domesticLeagues.map(league => ({ id: league.id, clubIds: league.clubIds })) });
    expect(roundTrip(state)).toEqual(state);
    const next = advanceSeason(play(state));
    const { divisions, ...rest } = next;
    expect(divisions).toEqual(state.divisions);
    expect(rest).toEqual({ ...JSON.parse(gunzipSync(nextBytes).toString('utf8')), schemaVersion: next.schemaVersion });
  }, 300_000);
});
