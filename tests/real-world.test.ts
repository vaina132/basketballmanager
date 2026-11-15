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
    expect(world).toMatchObject({ id: 'real-europe-test-2-competition-league', rosterModel: 'club-roster-1', name: 'Test Liga 2026-27', source: 'real-data-pack', rivalries: [] });
    expect(world.clubs.map(club => club.players.length)).toEqual([14, 14, 14, 14]);
    // Missing statistics must not silently discard a real identity.
    expect(world.clubs.every(club => club.players.some(item => item.id.endsWith('-13')))).toBe(true);
    expect(world.clubs[0]!.players[0]).toMatchObject(NEUTRAL_APPEARANCE);
    expect(world.clubs[1]!.color).toBe(NEUTRAL_CLUB_COLOR);
    expect(world.finances[0]!.venue).toBe('Alpha Hall');
    expect(world.finances[1]!.venue).toBe('Club B Arena');
    expect(new Set(world.clubs[0]!.players.map(item => item.number)).size).toBe(14);
  });

  it('opts new French top and second divisions into sourced ranking and every other league into the labelled FIBA default', () => {
    for (const tier of [1, 2]) {
      const frenchPack = { ...pack, competitions: pack.competitions.map(item => item.id === 'competition-league' ? { ...item, country: 'France', tier } : item) };
      const world = worldFromPack(frenchPack, 'competition-league');
      expect(world.domesticLeagues![0]!.standingsRule).toBe('lnb-2026-1');
      expect(() => validateWorld(world)).not.toThrow();
    }
    // Step 3.4e-1: leagues without a verified rule of their own use FIBA Appendix D; the French rule is never applied elsewhere.
    // Step 3.4e-2: Spain's, Germany's and Italy's top divisions use their own verified rules.
    for (const [country, rule] of [['Greece', 'fiba-2026-d'], ['X', 'fiba-2026-d'], ['Spain', 'acb-art7-2026'], ['Germany', 'bbl-art20-2026'], ['Italy', 'fip-art62-2026']] as const) {
      const otherPack = { ...pack, competitions: pack.competitions.map(item => item.id === 'competition-league' ? { ...item, country, tier: 1 } : item) };
      expect(worldFromPack(otherPack, 'competition-league').domesticLeagues![0]!.standingsRule).toBe(rule);
    }
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

  it('gives opening contracts estimated lengths of one to three seasons by age, so a career does not start with renewals (owner feedback)', () => {
    const world = worldFromPack(pack, 'competition-league');
    const ids = world.clubs.flatMap(club => club.players.map(item => item.id));
    expect(Object.keys(world.playerContracts!).sort()).toEqual([...ids].sort());
    for (const id of ids) expect([1, 2, 3]).toContain(world.playerContracts![id]);
    // Ages 21-33 in this pack: the youngest get two or three seasons, the 33-year-olds one.
    expect(ids.filter(id => id.endsWith('-1')).every(id => world.playerContracts![id]! >= 2)).toBe(true);
    expect(ids.filter(id => id.endsWith('-13')).every(id => world.playerContracts![id] === 1)).toBe(true);
    const state = createSeason({ seed: 3, world, managedClubId: 'club-c', injuryMode: 'standard', ...NEW_CAREER_SYSTEMS });
    for (const contract of state.employment.contracts) expect(contract.endsSeason - contract.startsSeason + 1).toBe(world.playerContracts![contract.playerId]);
    const ending = state.employment.contracts.filter(contract => contract.endsSeason === 1).length;
    expect(ending).toBeGreaterThan(0);
    expect(ending).toBeLessThan(state.employment.contracts.length * 0.7);
    expect(parseSeason(serializeSeason(state))).toEqual(state);
    expect(() => validateWorld({ ...world, playerContracts: { ...world.playerContracts, [ids[0]!]: 4 } })).toThrow(/one to three seasons/);
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
