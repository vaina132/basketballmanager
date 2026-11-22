import type { CareerWorld } from '../../src/domain/world';
import { testWorld } from '../world-fixtures';

/**
 * A small real-club-like world for national teams (format 80): a Turkish top division of twelve clubs (room in its
 * calendar: it pauses on the window weekends) and a second division of sixteen (no room: it plays on), with players
 * of Turkey, Spain and Greece (the rest of each country's twelve are generated fillers).
 */
export function nationalWorld(): CareerWorld {
  const base = testWorld(28, 'national-test-world');
  const countries = ['Turkey', 'Turkey', 'Spain', 'Greece'];
  let index = 0;
  const playerProfiles = Object.fromEntries(base.clubs.flatMap(club => club.players.map(player => [player.id, { ...base.playerProfiles[player.id]!, nationality: countries[index++ % countries.length]! }])));
  return { ...base, rosterModel: 'club-roster-1', playerProfiles, domesticLeagues: [
    { id: 'test-bsl', name: 'Test Süper Ligi', country: 'Turkey', tier: 1, clubIds: base.clubs.slice(0, 12).map(club => club.id) },
    { id: 'test-tbl', name: 'Test Basketbol Ligi', country: 'Turkey', tier: 2, clubIds: base.clubs.slice(12).map(club => club.id) },
  ] };
}
