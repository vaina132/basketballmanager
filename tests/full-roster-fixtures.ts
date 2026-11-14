import type { CareerWorld } from '../src/domain/world';
import { testWorld } from './world-fixtures';

/** Public synthetic world with real variability, independent from private provider files. */
export function fullRosterWorld(): CareerWorld {
  const base = testWorld(4, 'test-full-roster-1'), sizes = [9, 14, 17, 25];
  const clubs = base.clubs.map((club, index) => ({ ...club, players: Array.from({ length: sizes[index]! }, (_, n) => {
    const original = club.players[n % club.players.length]!;
    return { ...original, id: `${club.id}-member-${n}`, name: `${club.shortName} Player ${n + 1}`, number: n + 1, attributes: { ...original.attributes } };
  }) }));
  return { ...base, rosterModel: 'club-roster-1', clubs,
    playerProfiles: Object.fromEntries(clubs.flatMap(club => club.players.map(player => [player.id, { dateOfBirth: '2000-06-12', source: 'fictional-development' as const }]))),
    wages: Object.fromEntries(clubs.flatMap(club => club.players.map(player => [player.id, 1_200_000]))),
  };
}
