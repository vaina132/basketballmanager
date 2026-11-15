import { beforeAll, describe, expect, it } from 'vitest';
import { testWorld } from './world-fixtures';
import { advanceSeason, createSeason, europeanPlacesAfter, getStandings, managedSide, NEW_CAREER_SYSTEMS, rolloverSeason } from '../src/world/season';
import { parseSeason, serializeSeason, serializeSeasonCompact } from '../src/storage/season-storage';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { setEmploymentDelegation } from '../src/world/employment';
import { advanceMarket } from '../src/world/market';
import { getMarketStartReason } from '../src/world/market-policy';
import { withEuropeanCompetitions } from '../src/world/real-world';
import { backgroundLeagueClubIds, fullWorldClubs, validateWorld } from '../src/world/career-world';
import { getEuropeanCompetitions } from '../src/world/europe';
import { estimatedTable, nextEuropeanPlaces, openingEurope } from '../src/world/european-places';
import { seasonLeagues } from '../src/world/divisions';
import { currentSeasonFile } from './helpers/season-format';

const play = state => advanceSeason(state.activeMatch ? { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) } : state);
const roundTrip = state => parseSeason(serializeSeasonCompact(state));

/**
 * Testland's two divisions (chosen); Otherland's top division of ten clubs (not chosen: an estimated table); clubs of
 * Farland and Nearland (no domestic data). A EuroLeague of ten with two one-year places and a EuroCup of sixteen.
 */
function placesWorld() {
  const base = testWorld(11);
  const playerContracts = Object.fromEntries(base.clubs.flatMap(club => club.players.map((player, index) => [player.id, 1 + (index % 3)])));
  const leagues = { ...base, id: 'europe-places-test', rosterModel: 'club-roster-1', playerContracts, domesticLeagues: [
    { id: 'first', name: 'First division', country: 'Testland', tier: 1, clubIds: base.clubs.slice(0, 6).map(club => club.id), postseason: 'test-tier1-1', standingsRule: 'fiba-2026-d' },
    { id: 'second', name: 'Second division', country: 'Testland', tier: 2, clubIds: base.clubs.slice(6).map(club => club.id), postseason: 'test-tier2-1', standingsRule: 'fiba-2026-d' },
  ] };
  const pool = testWorld(40, 'places-pool');
  const clubs = pool.clubs.slice(0, 27).map(club => ({ ...club, id: `pl-${club.id}`, name: `PL ${club.name}`, players: club.players.map(player => ({ ...player, id: `pl-${player.id}` })) }));
  const entrants = clubs.map(team => ({ team, venue: null, profiles: Object.fromEntries(team.players.map(player => [player.id, pool.playerProfiles[player.id.slice(3)]])) }));
  const other = clubs.slice(0, 10).map(club => club.id), outside = clubs.slice(10).map(club => club.id), testland = leagues.clubs.map(club => club.id);
  const country = id => testland.includes(id) ? 'Testland' : other.includes(id) ? 'Otherland' : outside.indexOf(id) % 2 ? 'Nearland' : 'Farland';
  const competition = (id, kind, format, clubIds, extra = {}) => ({ id, name: `Test ${kind}`, kind, season: '2026-27', format, clubIds, countries: Object.fromEntries(clubIds.map(clubId => [clubId, country(clubId)])), ...extra });
  const euroleague = [testland[0], testland[1], other[0], other[1], other[2], ...outside.slice(0, 5)];
  const eurocup = [testland[2], testland[3], other[3], other[4], ...outside.slice(5, 17)];
  return withEuropeanCompetitions(leagues, [
    competition('euroleague', 'euroleague', 'euroleague-2026-1', euroleague, { oneYear: [other[2], outside[4]] }),
    competition('eurocup', 'eurocup', 'eurocup-2026-1', eurocup),
  ], entrants, { backgroundLeagues: [{ id: 'otherland', name: 'Otherland League', country: 'Otherland', tier: 1, clubIds: other }] });
}

describe('background tables and European places in the world (step 3.5f)', () => {
  it('keeps unchosen top divisions outside the full world and refuses inconsistent place data', () => {
    const world = placesWorld();
    expect(() => validateWorld(world)).not.toThrow();
    expect([...backgroundLeagueClubIds(world)]).toHaveLength(10);
    expect(fullWorldClubs(world).map(club => club.id)).toEqual(world.domesticLeagues.flatMap(league => league.clubIds));
    const check = (change, pattern) => { const copy = structuredClone(world); change(copy); expect(() => validateWorld(copy)).toThrow(pattern); };
    check(copy => { copy.backgroundLeagues[0].country = 'Testland'; }, /unchosen country|country of each league club/);
    check(copy => { copy.backgroundLeagues[0].clubIds.push(copy.clubs[0].id); }, /no other league|cover every club/);
    check(copy => { delete copy.europeanCompetitions[1].countries; }, /country/);
    check(copy => { copy.europeanCompetitions[1].oneYear = []; }, /oneYear/);
    check(copy => { copy.europeanCompetitions[0].oneYear = ['nobody']; }, /oneYear/);
    check(copy => { copy.europeanCompetitions[0].countries[copy.backgroundLeagues[0].clubIds[0]] = 'Farland'; }, /country of each league club/);
    check(copy => { delete copy.europeanPlaces; }, /European places|backgroundLeagues|country/);
  });

  it('estimates an unchosen league\'s table from squad strength with a seeded random element', () => {
    const world = placesWorld(), state = createSeason({ world, seed: 3, ...NEW_CAREER_SYSTEMS });
    const league = world.backgroundLeagues[0];
    const table = estimatedTable(state, league, 1);
    expect(table.map(row => row.clubId).sort()).toEqual([...league.clubIds].sort());
    expect(table.map(row => row.estimate)).toEqual([...table.map(row => row.estimate)].sort((a, b) => b - a));
    expect(estimatedTable(state, league, 1)).toEqual(table);
    const seeds = [1, 2, 3, 4, 5, 6].map(seed => estimatedTable({ ...state, seed }, league, 1).map(row => row.clubId).join());
    expect(new Set(seeds).size).toBeGreaterThan(1);
    expect(state.europe).toEqual(openingEurope(world));
    expect(state.europe.oneYear).toEqual(world.europeanCompetitions[0].oneYear);
    const envelope = JSON.parse(serializeSeason(state));
    envelope.formatVersion = 59; envelope.state.schemaVersion = 59; delete envelope.state.europe;
    expect(() => parseSeason(JSON.stringify(envelope))).toThrow(/requires format 60/);
  });
});

describe('next season\'s European places (step 3.5f)', () => {
  let world, complete, next, places;
  beforeAll(() => {
    world = placesWorld();
    let state = setEmploymentDelegation(createSeason({ seed: 12, world, managedClubId: world.clubs[0].id, ...NEW_CAREER_SYSTEMS }), true);
    while (state.status === 'active') state = play(state);
    complete = state;
    places = europeanPlacesAfter(complete);
    for (let steps = 0; steps < 120 && getMarketStartReason(state); steps += 1) state = advanceMarket(state);
    next = rolloverSeason(state);
    for (let week = 0; week < 4; week += 1) next = play(next);
  }, 900_000);

  it('keeps long-term EuroLeague places, renews one-year holders that reached the playoffs and fills open places with the EuroCup champion, then the best finishers', () => {
    const [euroleague, eurocup] = getEuropeanCompetitions(complete, 1);
    const playoffs = new Set(euroleague.series.filter(series => series.stage === 'quarter-final').flatMap(series => [series.higher.clubId, series.lower.clubId]));
    const holders = world.europeanCompetitions[0].oneYear, el = places.entrants[0].clubIds;
    expect(el).toHaveLength(10);
    for (const clubId of world.europeanCompetitions[0].clubIds.filter(id => !holders.includes(id))) expect(el).toContain(clubId);
    const renewed = holders.filter(id => playoffs.has(id));
    for (const clubId of holders) expect(el.includes(clubId)).toBe(renewed.includes(clubId));
    const champion = eurocup.outcome.champion, runnerUp = eurocup.series.find(series => series.id === 'final').loser;
    if (renewed.length < 2) expect(el).toContain(champion);
    if (renewed.length === 0) expect(el).toContain(runnerUp);
    expect(places.oneYear.sort()).toEqual(el.filter(id => !world.europeanCompetitions[0].clubIds.includes(id) || holders.includes(id)).sort());
    // A holder at its limit of three seasons is not renewed, even after the playoffs.
    const capped = nextEuropeanPlaces({ context: { ...complete, europe: complete.europe }, seasonNumber: 1, domesticOrders: new Map(), topDivisions: [], oneYearSeasons: () => 3 });
    for (const clubId of holders) expect(capped.entrants[0].clubIds).not.toContain(clubId);
  });

  it('keeps the outside clubs\' EuroCup places and each country\'s quota from its final order, at the same size', () => {
    const ec = places.entrants[1].clubIds, el = places.entrants[0].clubIds;
    expect(ec).toHaveLength(16);
    expect(new Set([...el, ...ec]).size).toBe(26);
    const opening = world.europeanCompetitions[1], country = id => opening.countries[id] ?? world.europeanCompetitions[0].countries[id] ?? (world.domesticLeagues.some(league => league.clubIds.includes(id)) ? 'Testland' : 'Otherland');
    for (const clubId of opening.clubIds.filter(id => !['Testland', 'Otherland'].includes(opening.countries[id]) && !el.includes(id))) expect(ec).toContain(clubId);
    const testlandOrder = getStandings(complete).filter(row => seasonLeagues(world, complete.divisions)[0].clubIds.includes(row.clubId)).sort((a, b) => a.position - b.position).map(row => row.clubId).filter(id => !el.includes(id));
    expect(ec.filter(id => country(id) === 'Testland')).toEqual(expect.arrayContaining(testlandOrder.slice(0, 2)));
    const otherlandOrder = estimatedTable(complete, world.backgroundLeagues[0], 1).map(row => row.clubId).filter(id => !el.includes(id));
    expect(ec.filter(id => country(id) === 'Otherland')).toEqual(expect.arrayContaining(otherlandOrder.slice(0, 2)));
  });

  it('plays season two with its new places and checks them strictly in saves', () => {
    expect(next.europe).toEqual(places);
    expect(next.history[0].europe).toEqual(complete.europe);
    const games = next.fixtures.filter(fixture => fixture.competition === 'euroleague');
    expect(new Set(games.flatMap(fixture => [fixture.homeClubId, fixture.awayClubId]))).toEqual(new Set(places.entrants[0].clubIds));
    expect(roundTrip(next)).toEqual(next);
    const changed = (change, pattern) => { const copy = structuredClone(next); change(copy); expect(() => parseSeason(currentSeasonFile(copy))).toThrow(pattern); };
    changed(copy => { copy.europe.oneYear = []; }, /europe|versioned schedule/);
    changed(copy => { [copy.europe.entrants[1].clubIds[0], copy.europe.entrants[1].clubIds[1]] = [copy.europe.entrants[1].clubIds[1], copy.europe.entrants[1].clubIds[0]]; }, /europe|versioned schedule/);
    changed(copy => { copy.history[0].europe.oneYear = []; }, /europe/);
  }, 300_000);
});
