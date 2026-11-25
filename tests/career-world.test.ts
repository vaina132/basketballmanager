import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CareerWorld } from '../src/domain/world';
import type { SeasonState } from '../src/domain/season';
import { DEVELOPMENT_WORLD } from '../src/data/development-world';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { parseSeason, serializeSeason, serializeSeasonCompact } from '../src/storage/season-storage';
import { clubFinanceDefinition, clubPresident, requireWorldContexts, validateWorld, worldOf, worldRivalryFor } from '../src/world/career-world';
import { setEmploymentDelegation } from '../src/world/employment';
import { advanceMarket } from '../src/world/market';
import { getMarketStartReason } from '../src/world/market-policy';
import { getCareerPlayers, getCareerWage } from '../src/world/player-catalog';
import { advanceSeason, createSeason, managedSide, NEW_CAREER_SYSTEMS, rolloverSeason } from '../src/world/season';

/**
 * A copy of the built-in league in which every club, player, venue, president and rivalry has a new identity.
 * If any part of the game still read the built-in league instead of the career's world, these careers would
 * fail: the built-in data knows none of these identities.
 */
function renamedWorld(): CareerWorld {
  const club = (id: string) => `w-${id}`, player = (id: string) => `w-${id}`;
  const remap = <T>(record: Readonly<Record<string, T>>) => Object.fromEntries(Object.entries(record).map(([id, value]) => [player(id), value]));
  return {
    id: 'test-world-1', name: 'Test league', source: 'real-data-pack', startDate: DEVELOPMENT_WORLD.startDate,
    clubs: DEVELOPMENT_WORLD.clubs.map(item => ({ ...item, id: club(item.id), name: `World ${item.name}`, players: item.players.map(entry => ({ ...entry, id: player(entry.id), name: `${entry.name} W` })) })),
    playerProfiles: remap(DEVELOPMENT_WORLD.playerProfiles), wages: remap(DEVELOPMENT_WORLD.wages),
    finances: DEVELOPMENT_WORLD.finances.map(item => ({ ...item, clubId: club(item.clubId), venue: `World ${item.venue}` })),
    presidents: DEVELOPMENT_WORLD.presidents.map(item => ({ ...item, clubId: club(item.clubId) })),
    sponsors: DEVELOPMENT_WORLD.sponsors.map(item => ({ ...item })),
    rivalries: DEVELOPMENT_WORLD.rivalries.map(item => ({ ...item, id: `w-${item.id}`, clubIds: [club(item.clubIds[0]), club(item.clubIds[1])] as const })),
  };
}

const advance = (state: SeasonState) => advanceSeason({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch!, managedSide(state), true)) });
const roundTrip = (state: SeasonState) => parseSeason(serializeSeason(state));
const world = renamedWorld();
let opening: SeasonState, complete: SeasonState, nextSeason: SeasonState;

beforeAll(() => {
  // Any rule that lost the career's world fails instead of quietly using the built-in league.
  requireWorldContexts(true);
  opening = createSeason({ seed: 227, managedClubId: 'w-rhine-falcons', injuryMode: 'standard', world, ...NEW_CAREER_SYSTEMS, playerDevelopment: false, positionProfiles: false });
  let state = setEmploymentDelegation(opening, true);
  while (state.status === 'active') state = advance(state);
  for (let steps = 0; steps < 80 && getMarketStartReason(state); steps += 1) state = advanceMarket(state);
  complete = state;
  nextSeason = rolloverSeason(complete);
}, 300_000);
afterAll(() => requireWorldContexts(false));

describe('careers in another world', () => {
  it('accept a complete world and refuse an inconsistent one', () => {
    expect(() => validateWorld(world)).not.toThrow();
    expect(() => validateWorld(DEVELOPMENT_WORLD)).not.toThrow();
    const twice = { ...world, clubs: world.clubs.map((item, index) => index === 1 ? { ...item, players: [world.clubs[0]!.players[0]!, ...item.players.slice(1)] } : item) };
    expect(() => validateWorld(twice)).toThrow(/unique supported identifier/);
    expect(() => validateWorld({ ...world, wages: {} })).toThrow(/season wage/);
    expect(() => validateWorld({ ...world, presidents: world.presidents.slice(1) })).toThrow(/every club exactly once/);
    expect(() => validateWorld({ ...world, startDate: '2027-09-04' })).toThrow(/shared career calendar/);
    expect(() => createSeason({ world, managedClubId: 'rhine-falcons' })).toThrow(/Choose a club from this league/);
  });

  it('start with the world\'s clubs, players, wages, venues, presidents and rivalries', () => {
    expect(opening.dataPackId).toBe('test-world-1');
    expect(opening.world).toBe(world);
    expect(opening.clubs.map(item => item.name)).toEqual(world.clubs.map(item => item.name));
    expect(getCareerPlayers(opening).every(item => item.id.startsWith('w-'))).toBe(true);
    expect(getCareerWage(opening, 'w-rhf-1')).toBe(world.wages['w-rhf-1']);
    expect(clubFinanceDefinition(worldOf(opening), 'w-rhine-falcons').venue).toBe('World RHF Arena');
    expect(clubPresident(worldOf(opening), 'w-rhine-falcons').name).toBe('Helena Varga');
    expect(worldRivalryFor(worldOf(opening), 'w-rhine-falcons')?.rivalId).toBe('w-danube-lynx');
  });

  it('play a whole season, its offseason and the next opening with every system on', () => {
    expect(complete.status).toBe('complete');
    expect(complete.fixtures.every(fixture => fixture.result && fixture.homeClubId.startsWith('w-') && fixture.awayClubId.startsWith('w-'))).toBe(true);
    // Derbies count: the board review of the managed club's rival games uses the world's rivalry.
    expect(complete.board.reviews.some(review => review.clubs['w-rhine-falcons']?.rivalryImpact !== 0)).toBe(true);
    expect(nextSeason.seasonNumber).toBe(2);
    expect(nextSeason.world).toBe(world);
  });

  it('carry the world in the save and load it back exactly', () => {
    for (const state of [opening, complete, nextSeason]) {
      const file = JSON.parse(serializeSeason(state));
      expect(file.formatVersion).toBe(state.schemaVersion);
      expect(file.state.world.id).toBe('test-world-1');
      expect(roundTrip(state)).toEqual(state);
      expect(parseSeason(serializeSeasonCompact(state))).toEqual(state);
    }
  }, 300_000);

  it('refuse a save whose world is missing, renamed or damaged', () => {
    const file = JSON.parse(serializeSeason(opening));
    const { world: _missing, ...withoutWorld } = file.state;
    expect(() => parseSeason(JSON.stringify({ ...file, state: withoutWorld }))).toThrow(/unsupported data pack/);
    expect(() => parseSeason(JSON.stringify({ ...file, state: { ...file.state, dataPackId: 'other-world' } }))).toThrow(/must name the world/);
    const damaged = structuredClone(file); damaged.state.world.wages['w-rhf-1'] = -1;
    expect(() => parseSeason(JSON.stringify(damaged))).toThrow(/season wage/);
    expect(() => parseSeason(JSON.stringify({ ...file, formatVersion: 38, state: { ...file.state, schemaVersion: 38 } }))).toThrow(/missing or unsupported fields/);
  });

  it('keep careers in the built-in league free of a stored world', () => {
    const builtIn = createSeason({ seed: 227, ...NEW_CAREER_SYSTEMS, playerDevelopment: false, positionProfiles: false });
    expect(builtIn.dataPackId).toBe('development-league-1');
    expect(Object.hasOwn(builtIn, 'world')).toBe(false);
    expect(Object.hasOwn(JSON.parse(serializeSeason(builtIn)).state, 'world')).toBe(false);
  });
});
