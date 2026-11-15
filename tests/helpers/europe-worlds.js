import { testWorld } from '../world-fixtures';
import { withEuropeanCompetitions } from '../../src/world/real-world';

/**
 * Testland's two divisions (chosen); Otherland's top division of ten clubs (not chosen: an estimated table); clubs of
 * Farland and Nearland (no domestic data). A EuroLeague of ten with two one-year places and a EuroCup of sixteen.
 */
export function placesWorld() {
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

