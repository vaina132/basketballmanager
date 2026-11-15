import { afterAll, describe, expect, it } from 'vitest';
import type { DataPack, DataPackPlayer } from '../src/world/data-pack';
import { NEUTRAL_APPEARANCE, NEUTRAL_CLUB_COLOR } from '../src/world/data-pack';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { requireWorldContexts, seasonRounds, validateWorld } from '../src/world/career-world';
import { MAX_CONTRACT_WAGE, MIN_CONTRACT_WAGE, WAGE_STEP } from '../src/world/employment-policy';
import { overallRating } from '../src/world/overall-rating';
import { careerCompetitions, isGeneratedReserve, REAL_WORLD_RULES, realWorldWage, worldFromPack } from '../src/world/real-world';
import { advanceSeason, createSeason, managedSide, NEW_CAREER_SYSTEMS } from '../src/world/season';

const positions = ['PG', 'SG', 'SF', 'PF', 'C'] as const;
// A small private-pack lookalike: four domestic clubs of fourteen (club d is the strongest), two of them also in a European cup.
function player(club: string, index: number, boost: number): DataPackPlayer {
  const base = 8 + (index % 7) + boost;
  return {
    id: `player-${club}-${index}`, name: `${club.toUpperCase()} Player ${index}`, clubId: `club-${club}`, number: index === 3 ? null : index % 9, position: positions[index % 5]!,
    nationality: 'X', age: index === 0 ? null : 20 + index, heightCm: 200, weightKg: 97,
    attributes: { twoPoint: Math.min(20, base), threePoint: 10, freeThrow: 12, passing: 9, defense: Math.min(20, base), rebounding: 10, stamina: 14 },
    estimated: index === 13 ? ['all-abilities'] : ['defense'],
  };
}
const ids = ['a', 'b', 'c', 'd'];
const players = ids.flatMap((club, clubIndex) => Array.from({ length: 14 }, (_, index) => player(club, index, clubIndex)));
const pack: DataPack = {
  format: 'basketball-manager-data-pack', formatVersion: 1, version: 'test.2', season: '2026-27', source: { provider: 'test' }, notice: 'Private test data.',
  competitions: [
    { id: 'competition-league', name: 'Test Liga', country: 'X', tier: 1, kind: 'domestic', season: '2026-27', clubIds: ids.map(id => `club-${id}`) },
    { id: 'competition-cup', name: 'Euro Cup', country: null, tier: 1, kind: 'european', season: '2026-27', clubIds: ['club-a', 'club-d'] },
    { id: 'competition-odd', name: 'Odd Liga', country: 'Y', tier: 2, kind: 'domestic', season: '2026-27', clubIds: ['club-a', 'club-b', 'club-c'] },
  ],
  clubs: ids.map((id, index) => ({ id: `club-${id}`, name: `Club ${id.toUpperCase()}`, shortName: id.toUpperCase().repeat(3), country: 'X', city: null, arena: index === 0 ? 'Alpha Hall' : null, color: index === 1 ? null : '#336699', secondaryColor: null, identitySource: null, playerIds: players.filter(item => item.clubId === `club-${id}`).map(item => item.id) })),
  players,
};

describe('a career world from a real-data pack', () => {
  afterAll(() => requireWorldContexts(false));

  it('offers only domestic leagues with an even number of clubs', () => {
    expect(careerCompetitions(pack).map(item => item.id)).toEqual(['competition-league']);
    expect(() => worldFromPack(pack, 'competition-cup')).toThrow(/domestic league/);
  });

  it('builds the league\'s real clubs with complete imported squads, neutral figures and the pack\'s identities', () => {
    const world = worldFromPack(pack, 'competition-league');
    expect(() => validateWorld(world)).not.toThrow();
    expect(world).toMatchObject({ id: 'real-calendar-test-2-competition-league', rosterModel: 'club-roster-1', name: 'Test Liga 2026-27', source: 'real-data-pack', rivalries: [] });
    expect(world.clubs.map(club => club.players.length)).toEqual([14, 14, 14, 14]);
    // Missing statistics must not silently discard a real identity.
    expect(world.clubs.every(club => club.players.some(item => item.id.endsWith('-13')))).toBe(true);
    expect(world.clubs[0]!.players[0]).toMatchObject(NEUTRAL_APPEARANCE);
    expect(world.clubs[1]!.color).toBe(NEUTRAL_CLUB_COLOR);
    expect(world.finances[0]!.venue).toBe('Alpha Hall');
    expect(world.finances[1]!.venue).toBe('Club B Arena');
    expect(new Set(world.clubs[0]!.players.map(item => item.number)).size).toBe(14);
  });

  it('keeps smaller squads intact and rejects incomplete data without invented reserves', () => {
    const shortPack: DataPack = { ...pack, clubs: pack.clubs.map(club => club.id === 'club-a' ? { ...club, playerIds: club.playerIds.slice(0, 9) } : club) };
    const world = worldFromPack(shortPack, 'competition-league');
    expect(world.clubs.map(club => club.players.length)).toEqual([9, 14, 14, 14]);
    expect(world.clubs.flatMap(club => club.players).some(player => isGeneratedReserve(player.id))).toBe(false);
    expect(() => validateWorld(world)).not.toThrow();
    const incomplete = { ...shortPack, clubs: shortPack.clubs.map(club => ({ ...club, playerIds: club.playerIds.slice(0, 7) })) };
    expect(() => worldFromPack(incomplete, 'competition-league')).toThrow(/no players have been added or discarded/);
  });

  it('estimates birth dates from ages and gives fictional wages within the contract rules', () => {
    const world = worldFromPack(pack, 'competition-league');
    expect(world.playerProfiles['player-a-1']).toEqual({ dateOfBirth: '2005-01-01', source: 'estimated-from-age', positionSource: 'unverified' });
    expect(world.playerProfiles['player-a-0']!.dateOfBirth).toBe(`${2026 - REAL_WORLD_RULES.defaultAge}-01-01`);
    for (const club of world.clubs) {
      for (const item of club.players) {
        const wage = world.wages[item.id]!;
        expect(wage).toBe(realWorldWage(overallRating(item.attributes, item.position)));
        expect(wage).toBeGreaterThanOrEqual(MIN_CONTRACT_WAGE);
        expect(wage).toBeLessThanOrEqual(MAX_CONTRACT_WAGE);
        expect(wage % WAGE_STEP).toBe(0);
      }
    }
    expect(realWorldWage(90)).toBeGreaterThan(realWorldWage(60));
  });

  it('keeps researched birth dates and position evidence through career saves without rewriting older careers', () => {
    const oldWorld = worldFromPack(pack, 'competition-league');
    const oldSaved = serializeSeason(createSeason({ seed: 3, world: oldWorld, managedClubId: 'club-a' }));
    const corrected = structuredClone(pack);
    corrected.version = 'test.3';
    const player = corrected.players.find(item => item.id === 'player-a-1')!;
    player.birthDate = '2001-01-19';
    player.profileEvidence = { observedAt: '2026-11-14T12:00:00Z', positionSource: 'official', membership: 'official-registration-observed', sources: ['https://official.example/roster'] };
    const world = worldFromPack(corrected, 'competition-league');
    const loaded = parseSeason(serializeSeason(createSeason({ seed: 3, world, managedClubId: 'club-a' })));
    expect(loaded.world!.playerProfiles['player-a-1']).toEqual({ dateOfBirth: '2001-01-19', source: 'official-profile', positionSource: 'official' });
    expect(parseSeason(oldSaved).world!.playerProfiles).toEqual(oldWorld.playerProfiles);
  });

  it('gives stronger squads bigger arenas and labels the board, sponsors and budgets as fictional estimates', () => {
    const world = worldFromPack(pack, 'competition-league');
    const capacity = (id: string) => world.finances.find(item => item.clubId === id)!.capacity;
    expect(capacity('club-d')).toBe(REAL_WORLD_RULES.arena.largest);
    expect(capacity('club-a')).toBe(REAL_WORLD_RULES.arena.smallest);
    expect(world.finances.every(item => item.referenceDemand < item.capacity)).toBe(true);
    expect(world.presidents.every(item => item.name.split(' ').length === 2)).toBe(true);
    expect(world.sponsors.length).toBeGreaterThanOrEqual(world.clubs.length);
  });

  it('starts a career in the real league that plays, saves and loads with every system on', () => {
    requireWorldContexts(true);
    const world = worldFromPack(pack, 'competition-league');
    let state = createSeason({ seed: 3, world, managedClubId: 'club-c', injuryMode: 'standard', ...NEW_CAREER_SYSTEMS });
    expect([state.dataPackId, seasonRounds(state), state.clubs.map(club => club.name)]).toEqual([world.id, 6, ['Club A', 'Club B', 'Club C', 'Club D']]);
    for (let matchday = 0; matchday < 3; matchday += 1) state = advanceSeason({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch!, managedSide(state), true)) });
    expect(state.round).toBe(4);
    expect(parseSeason(serializeSeason(state))).toEqual(state);
  }, 300_000);
});
