import { describe, expect, it } from 'vitest';
import { testWorld } from './world-fixtures';
import { advanceSeason, createSeason, managedSide, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { parseSeason, serializeSeason, serializeSeasonCompact } from '../src/storage/season-storage';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { setEmploymentDelegation } from '../src/world/employment';
import { europeanOnlyClubIds, fullWorldClubs, validateWorld, worldPlayers } from '../src/world/career-world';
import { getActiveCareerPlayers } from '../src/world/player-catalog';
import { europeanKind, withEuropeanCompetitions, worldFromPack } from '../src/world/real-world';

const play = state => advanceSeason(state.activeMatch ? { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) } : state);
const roundTrip = state => parseSeason(serializeSeasonCompact(state));

/** A six-club league; three more clubs play only in Europe (their own squads), two league clubs join them in a EuroCup. */
function europeanWorld() {
  const base = testWorld(9);
  const league = base.clubs.slice(0, 6), outside = base.clubs.slice(6);
  const keep = ids => Object.fromEntries(Object.entries(ids).filter(([id]) => league.some(club => club.players.some(player => player.id === id))));
  const domestic = { ...base, id: 'european-test', rosterModel: 'club-roster-1', clubs: league, playerProfiles: keep(base.playerProfiles), wages: keep(base.wages),
    finances: base.finances.filter(item => league.some(club => club.id === item.clubId)), presidents: base.presidents.filter(item => league.some(club => club.id === item.clubId)), rivalries: [],
    domesticLeagues: [{ id: 'league', name: 'Test league', country: 'Testland', tier: 1, clubIds: league.map(club => club.id) }] };
  const entrants = outside.map(team => ({ team, venue: `${team.name} Hall`, profiles: Object.fromEntries(team.players.map(player => [player.id, base.playerProfiles[player.id]])) }));
  return withEuropeanCompetitions(domestic, [{ id: 'eurocup', name: 'Test EuroCup', kind: 'eurocup', season: '2026-27', clubIds: [league[0].id, league[1].id, ...outside.map(club => club.id)] }], entrants);
}

describe('European competitions and their entrants in the world (step 3.5a)', () => {
  it('adds entrants from outside the chosen leagues as background clubs with their real squads and estimated club data', () => {
    const world = europeanWorld();
    expect(() => validateWorld(world)).not.toThrow();
    expect(world.clubs).toHaveLength(9);
    const outside = europeanOnlyClubIds(world);
    expect([...outside]).toEqual(world.clubs.slice(6).map(club => club.id));
    expect(fullWorldClubs(world).map(club => club.id)).toEqual(world.domesticLeagues[0].clubIds);
    expect(worldPlayers(world).some(player => world.clubs.slice(6).some(club => club.players.includes(player)))).toBe(false);
    for (const club of world.clubs.slice(6)) {
      expect(world.finances.find(item => item.clubId === club.id).venue).toBe(`${club.name} Hall`);
      expect(world.presidents.some(item => item.clubId === club.id)).toBe(true);
      expect(club.players.every(player => world.wages[player.id] > 0 && world.playerProfiles[player.id])).toBe(true);
    }
    expect(() => withEuropeanCompetitions(world, [], [])).toThrow(/already/);
  });

  it('keeps background clubs out of every system while the career plays, with strict saves', () => {
    const world = europeanWorld();
    let state = setEmploymentDelegation(createSeason({ world, seed: 8, managedClubId: world.clubs[0].id, ...NEW_CAREER_SYSTEMS }), true);
    const outside = europeanOnlyClubIds(world);
    const players = new Set(world.clubs.filter(club => outside.has(club.id)).flatMap(club => club.players.map(player => player.id)));
    for (let week = 0; week < 3; week += 1) state = play(state);
    expect(state.clubs.some(club => outside.has(club.id))).toBe(false);
    expect(state.fixtures.some(fixture => outside.has(fixture.homeClubId) || outside.has(fixture.awayClubId))).toBe(false);
    expect(getActiveCareerPlayers(state).some(player => players.has(player.id))).toBe(false);
    expect(state.finance.ledger.some(entry => outside.has(entry.clubId))).toBe(false);
    expect(roundTrip(state)).toEqual(state);
  }, 300_000);

  it('refuses a competition named twice, a club in two competitions or outside the world, an uncovered club and format 55', () => {
    const world = europeanWorld();
    const check = (change, pattern) => { const copy = structuredClone(world); change(copy); expect(() => validateWorld(copy)).toThrow(pattern); };
    check(copy => { copy.europeanCompetitions.push({ ...copy.europeanCompetitions[0], id: 'second' }); }, /once/);
    check(copy => { copy.europeanCompetitions.push({ id: 'cl', name: 'Champions', kind: 'bcl', season: '2026-27', clubIds: [copy.clubs[0].id, copy.clubs[2].id] }); }, /one competition/);
    check(copy => { copy.europeanCompetitions[0].clubIds.push('nobody'); }, /cover every club|clubs of this world/);
    check(copy => { copy.europeanCompetitions[0].clubIds.pop(); }, /cover every club/);
    check(copy => { copy.europeanCompetitions[0].kind = 'cup'; }, /once/);
    const envelope = JSON.parse(serializeSeason(createSeason({ world })));
    envelope.formatVersion = 55; envelope.state.schemaVersion = 55;
    expect(() => parseSeason(JSON.stringify(envelope))).toThrow(/requires format 56/);
  });

  it('builds a real-data world with the season\'s competitions: chosen clubs referenced, other entrants added with their pack squads', () => {
    const positions = ['PG', 'SG', 'SF', 'PF', 'C'];
    const clubs = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const players = clubs.flatMap((club, clubIndex) => Array.from({ length: 10 }, (_, index) => ({ id: `p-${club}-${index}`, name: `${club.toUpperCase()} ${index}`, clubId: `club-${club}`, number: index + 4, position: positions[index % 5], nationality: 'X', age: 20 + index, heightCm: 200, weightKg: 95,
      attributes: { twoPoint: 8 + (clubIndex % 5), threePoint: 10, freeThrow: 11, passing: 9, defense: 10, rebounding: 10, stamina: 13 }, estimated: [] })));
    const pack = {
      format: 'basketball-manager-data-pack', formatVersion: 1, version: 'euro.1', season: '2026-27', source: { provider: 'test' }, notice: 'Private test data.',
      competitions: [
        { id: 'liga', name: 'Test Liga', country: 'X', tier: 1, kind: 'domestic', season: '2026-27', clubIds: ['club-a', 'club-b', 'club-c', 'club-d'] },
        { id: 'other', name: 'Other Liga', country: 'Y', tier: 1, kind: 'domestic', season: '2026-27', clubIds: ['club-e', 'club-f', 'club-g', 'club-h'] },
        { id: 'el', name: 'EuroLeague', country: null, tier: 1, kind: 'european', season: '2026-27', clubIds: ['club-a', 'club-e', 'club-f'] },
        { id: 'bcl', name: 'Basketball Champions League', country: null, tier: 1, kind: 'european', season: '2026-27', clubIds: ['club-b', 'club-g', 'club-e'] },
        { id: 'old', name: 'EuroCup', country: null, tier: 1, kind: 'european', season: '2025-26', clubIds: ['club-c', 'club-h'] },
      ],
      clubs: clubs.map(id => ({ id: `club-${id}`, name: `Club ${id.toUpperCase()}`, shortName: id.toUpperCase().repeat(3), country: 'X', city: null, arena: id === 'e' ? 'E Dome' : null, color: '#336699', secondaryColor: null, identitySource: null, playerIds: players.filter(item => item.clubId === `club-${id}`).map(item => item.id) })),
      players,
    };
    expect(['EuroLeague', 'Euro Cup', 'Basketball Champions League', 'Liga'].map(europeanKind)).toEqual(['euroleague', 'eurocup', 'bcl', null]);
    const world = worldFromPack(pack, 'liga');
    expect(world.europeanCompetitions).toEqual([
      { id: 'el', name: 'EuroLeague', kind: 'euroleague', season: '2026-27', clubIds: ['club-a', 'club-e', 'club-f'] },
      { id: 'bcl', name: 'Basketball Champions League', kind: 'bcl', season: '2026-27', clubIds: ['club-b', 'club-g'] },
    ]);
    expect([...europeanOnlyClubIds(world)]).toEqual(['club-e', 'club-f', 'club-g']);
    expect(world.clubs.find(club => club.id === 'club-e').players).toHaveLength(10);
    expect(world.finances.find(item => item.clubId === 'club-e').venue).toBe('E Dome');
    expect(fullWorldClubs(world)).toHaveLength(4);
    const state = createSeason({ world, managedClubId: 'club-a' });
    expect(roundTrip(state)).toEqual(state);
  });
});
