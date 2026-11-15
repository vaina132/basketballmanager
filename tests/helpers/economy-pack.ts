import type { DataPack, DataPackPlayer } from '../../src/world/data-pack';

const positions = ['PG', 'SG', 'SF', 'PF', 'C'] as const;

/** A club's players: `level` sets every ability (4-18), so squads differ in strength; each squad spreads ±3 around it, with one best player. */
function squad(clubId: string, level: number, size: number): DataPackPlayer[] {
  return Array.from({ length: size }, (_, index) => {
    const value = Math.max(1, Math.min(20, level + 3 - Math.floor((index + 1) / 2)));
    return {
      id: `${clubId}-p${index}`, name: `${clubId} Player ${index}`, clubId, number: index + 4, position: positions[index % 5]!, nationality: 'X', age: 21 + (index % 12), heightCm: 200, weightKg: 97,
      attributes: { twoPoint: value, threePoint: value, freeThrow: value, passing: value, defense: value, rebounding: value, stamina: 14 }, estimated: [],
    };
  });
}

export interface EconomyPackLeague { id: string; name: string; country: string; tier: 1 | 2; levels: readonly number[] }

/**
 * A synthetic real-data pack for economy tests: domestic leagues whose clubs have squads of the given levels, and
 * optionally a EuroLeague listing named league clubs plus `foreign` clubs from countries without a league.
 */
export function economyPack(leagues: readonly EconomyPackLeague[], euroleague: { members: readonly string[]; foreign?: readonly { id: string; country: string; level: number }[] } | null = null, size = 12): DataPack {
  const clubs = leagues.flatMap(league => league.levels.map((level, index) => ({ id: `${league.id}-${index + 1}`, country: league.country, level })));
  const foreign = euroleague?.foreign ?? [];
  const all = [...clubs, ...foreign];
  const players = all.flatMap(club => squad(club.id, club.level, size));
  return {
    format: 'basketball-manager-data-pack', formatVersion: 1, version: 'economy.1', season: '2026-27', source: { provider: 'test' }, notice: 'Synthetic test data.',
    competitions: [
      ...leagues.map(league => ({ id: league.id, name: league.name, country: league.country, tier: league.tier, kind: 'domestic' as const, season: '2026-27', clubIds: league.levels.map((_, index) => `${league.id}-${index + 1}`) })),
      ...(euroleague ? [{ id: 'euroleague', name: 'EuroLeague', country: null, tier: 1, kind: 'european' as const, season: '2026-27', clubIds: [...euroleague.members, ...foreign.map(club => club.id)] }] : []),
    ],
    clubs: all.map(club => ({ id: club.id, name: `Club ${club.id}`, shortName: club.id.replace(/[^a-z0-9]/gi, '').slice(-6).toUpperCase(), country: club.country, city: null, arena: null, color: '#336699', secondaryColor: null, identitySource: null, playerIds: players.filter(item => item.clubId === club.id).map(item => item.id) })),
    players,
  };
}
