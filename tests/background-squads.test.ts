import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import type { CareerWorld } from '../src/domain/world';
import { testWorld } from './world-fixtures';
import { advanceSeason, createSeason, managedSide, NEW_CAREER_SYSTEMS, rolloverSeason } from '../src/world/season';
import { parseSeason, serializeSeason, serializeSeasonCompact } from '../src/storage/season-storage';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { setEmploymentDelegation } from '../src/world/employment';
import { advanceMarket } from '../src/world/market';
import { getMarketStartReason } from '../src/world/market-policy';
import { withEuropeanCompetitions } from '../src/world/real-world';
import { backgroundRosterId, backgroundSide } from '../src/world/europe';
import { BACKGROUND_SQUAD_RULES, backgroundSeasonStart, backgroundSquadClubIds, usesBackgroundSquads } from '../src/world/background-squads';
import { squadStrength } from '../src/world/lower-division';
import { fractionalAge } from '../src/world/player-development';

/**
 * Format 104 (owner request 24 November 2026, `world.backgroundSquads`): background clubs (European entrants outside
 * the chosen leagues, unchosen top divisions) develop, age, retire and renew their squads at each season change, kept
 * near their starting strength, all derived from the career's seed.
 */
const play = (state: SeasonState) => advanceSeason(state.activeMatch ? { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) } : state);
const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor((sorted.length - 1) / 2)]!; };

/** Testland's two divisions and a EuroLeague of two league clubs and `entrants` clubs from outside the leagues. */
function europeanWorld(entrants = 18): CareerWorld {
  const base = testWorld(11);
  const playerContracts = Object.fromEntries(base.clubs.flatMap(club => club.players.map((player, index) => [player.id, 1 + (index % 3)])));
  const leagues = { ...base, id: 'background-squads-test', rosterModel: 'club-roster-1', playerContracts, domesticLeagues: [
    { id: 'first', name: 'First division', country: 'Testland', tier: 1, clubIds: base.clubs.slice(0, 6).map(club => club.id), postseason: 'test-tier1-1', standingsRule: 'fiba-2026-d' },
    { id: 'second', name: 'Second division', country: 'Testland', tier: 2, clubIds: base.clubs.slice(6).map(club => club.id), postseason: 'test-tier2-1', standingsRule: 'fiba-2026-d' },
  ] } as CareerWorld;
  const pool = testWorld(20, 'europe-pool');
  const outside = pool.clubs.slice(20 - entrants).map(club => ({ ...club, id: `eu-${club.id}`, name: `Euro ${club.name}`, players: club.players.map(player => ({ ...player, id: `eu-${player.id}` })) }));
  return withEuropeanCompetitions(leagues, [{ id: 'euroleague', name: 'Test EuroLeague', kind: 'euroleague', season: '2026-27', format: 'euroleague-2026-1', clubIds: [leagues.clubs[0]!.id, leagues.clubs[1]!.id, ...outside.map(club => club.id)] }],
    outside.map(team => ({ team, venue: null, profiles: Object.fromEntries(team.players.map(player => [player.id, pool.playerProfiles[player.id.slice(3)]!])) })));
}

/** The derivation's own context: the world, the seed and the aging start (what a career passes). */
function context(world: CareerWorld, seed: number) {
  return { world, seed, lifecycle: { model: 'lifecycle-1' as const, enabledSince: { seasonNumber: 1, round: 1, date: world.startDate, ledgerIndex: 0, contractCount: 0, negotiationCount: 0, recruitmentEventCount: 0, marketEventCount: 0 }, reviews: [], notices: [] } };
}

describe('the background squads marker (format 104)', () => {
  const world = europeanWorld();
  it('marks new careers with player development and background clubs; format 103 refuses the marker', () => {
    const state = createSeason({ seed: 5, world, managedClubId: world.clubs[0]!.id, ...NEW_CAREER_SYSTEMS });
    expect(state.world!.backgroundSquads).toBe(true);
    expect(usesBackgroundSquads(state)).toBe(true);
    expect(createSeason({ seed: 5, world, managedClubId: world.clubs[0]!.id, ...NEW_CAREER_SYSTEMS, backgroundSquads: false }).world!.backgroundSquads).toBeUndefined();
    // Only with player development (format 101), and never in the built-in league.
    expect(createSeason({ seed: 5, world, managedClubId: world.clubs[0]!.id, ...NEW_CAREER_SYSTEMS, playerDevelopment: false }).world!.backgroundSquads).toBeUndefined();
    expect(createSeason({ seed: 5, ...NEW_CAREER_SYSTEMS }).world?.backgroundSquads).toBeUndefined();
    expect(() => createSeason({ seed: 5, world, backgroundSquads: 'yes' as unknown as boolean })).toThrow(/background squads setting/);
    expect(parseSeason(serializeSeason(state)).world!.backgroundSquads).toBe(true);
    const envelope = JSON.parse(serializeSeason(state));
    envelope.formatVersion = 103; envelope.state.schemaVersion = 103;
    expect(() => parseSeason(JSON.stringify(envelope))).toThrow(/backgroundSquads.*format 104/);
    const withoutDevelopment = structuredClone(state);
    delete withoutDevelopment.world!.playerDevelopment;
    expect(() => parseSeason(serializeSeason(withoutDevelopment))).toThrow(/backgroundSquads.*player development/);
  }, 120_000);
});

describe('background squads over ten season changes', () => {
  const world = europeanWorld(), ids = [...backgroundSquadClubIds(world)];
  const on = context({ ...world, playerDevelopment: true, backgroundSquads: true }, 77), off = context({ ...world, playerDevelopment: true }, 77);
  const squads = (ctx: ReturnType<typeof context>, season: number) => ids.map(id => backgroundSide(ctx, id, season));

  it('opens the career with the real squads, exactly as before', () => {
    expect(squads(on, 1)).toEqual(squads(off, 1));
    expect(ids).toHaveLength(18);
  });

  it('derives the same squads from the same world and seed, and other squads from another seed', () => {
    const again = context(structuredClone({ ...world, playerDevelopment: true, backgroundSquads: true }) as CareerWorld, 77);
    expect(squads(again, 7)).toEqual(squads(on, 7));
    expect(squads(context(on.world, 78), 7)).not.toEqual(squads(on, 7));
  });

  it('ages, retires and renews players, keeping each squad legal and its shape', () => {
    const first = squads(on, 1);
    let generated = 0, moved = 0;
    const home = new Map(first.flatMap(team => team.players.map(player => [player.id, team.id])));
    for (let season = 2; season <= 11; season += 1) {
      const teams = squads(on, season), everyone = teams.flatMap(team => team.players.map(player => player.id));
      // Nobody plays for two clubs; each squad keeps its size, its positions and unique shirt numbers.
      expect(new Set(everyone).size).toBe(everyone.length);
      teams.forEach((team, index) => {
        expect(team.players).toHaveLength(first[index]!.players.length);
        const shape = (players: typeof team.players) => ['PG', 'SG', 'SF', 'PF', 'C'].map(position => players.filter(player => player.position === position).length);
        expect(shape(team.players)).toEqual(shape(first[index]!.players));
        expect(new Set(team.players.map(player => player.number)).size).toBe(team.players.length);
        for (const player of team.players) for (const value of Object.values(player.attributes)) expect(value >= 1 && value <= 20).toBe(true);
      });
      // Nobody plays on past the oldest retirement age.
      for (const team of teams) for (const player of team.players) {
        const dob = world.playerProfiles[player.id]?.dateOfBirth;
        if (dob) expect(fractionalAge(dob, backgroundSeasonStart(season))).toBeLessThan(41);
      }
      if (season === 11) {
        generated = everyone.filter(id => id.includes('-bgen-')).length;
        moved = teams.reduce((count, team) => count + team.players.filter(player => home.has(player.id) && home.get(player.id) !== team.id).length, 0);
      }
    }
    expect(generated).toBeGreaterThan(20);
    expect(moved).toBeGreaterThan(0);
    // Real players who stay keep developing: some rise, some decline.
    const later = new Map(squads(on, 6).flatMap(team => team.players.map(player => [player.id, player])));
    const changes = first.flatMap(team => team.players.flatMap(player => later.has(player.id) ? [Object.values(later.get(player.id)!.attributes).reduce((sum, value) => sum + value, 0) - Object.values(player.attributes).reduce((sum, value) => sum + value, 0)] : []));
    expect(changes.some(change => change > 0)).toBe(true);
    expect(changes.some(change => change < 0)).toBe(true);
  });

  it('keeps every club near its starting strength, where unchanged squads only decline', () => {
    const start = new Map(ids.map((id, index) => [id, squadStrength(squads(on, 1)[index]!.players)]));
    for (let season = 2; season <= 11; season += 1) {
      const change = squads(on, season).map(team => squadStrength(team.players) - start.get(team.id)!);
      expect(Math.abs(median(change))).toBeLessThan(2.5);
      expect(Math.min(...change)).toBeGreaterThan(-(BACKGROUND_SQUAD_RULES.cycleMax + 4));
      expect(Math.max(...change)).toBeLessThan(BACKGROUND_SQUAD_RULES.cycleMax + 4);
    }
    // Not frozen: squads move a little from season to season.
    const moves = ids.map((id, index) => Math.abs(squadStrength(squads(on, 6)[index]!.players) - start.get(id)!));
    expect(moves.some(value => value > 0.5)).toBe(true);
    // Before format 104 the same squads only lost ground.
    const old = squads(off, 11).map(team => squadStrength(team.players) - start.get(team.id)!);
    expect(median(old)).toBeLessThan(-3);
  });

  it('leaves older careers\' background sides unchanged', () => {
    expect(squads(off, 6).map(team => team.players.map(player => player.id))).toEqual(squads(off, 1).map(team => team.players.map(player => player.id)));
  });
});

describe('a career whose background squads change at the season change', () => {
  let world: CareerWorld, complete: SeasonState, nextSeason: SeasonState;
  beforeAll(() => {
    world = europeanWorld(8);
    let state = setEmploymentDelegation(createSeason({ seed: 5150, world, managedClubId: world.clubs[0]!.id, ...NEW_CAREER_SYSTEMS }), true);
    expect(state.world!.backgroundSquads).toBe(true);
    while (state.status === 'active') state = play(state);
    complete = state;
    for (let steps = 0; steps < 120 && getMarketStartReason(state); steps += 1) state = advanceMarket(state);
    nextSeason = rolloverSeason(state);
    for (let week = 0; week < 6; week += 1) nextSeason = play(nextSeason);
  }, 900_000);

  it('plays season two\'s European games with the renewed squads and saves strictly', () => {
    const outside = world.europeanCompetitions![0]!.clubIds.slice(2);
    const changed = outside.filter(id => backgroundSide(nextSeason, id, 2).players.map(player => player.id).join() !== backgroundSide(nextSeason, id, 1).players.map(player => player.id).join());
    expect(changed.length).toBeGreaterThan(0);
    const games = nextSeason.fixtures.filter(fixture => fixture.competition && fixture.result && (outside.includes(fixture.homeClubId) || outside.includes(fixture.awayClubId)));
    expect(games.length).toBeGreaterThan(0);
    for (const fixture of games) for (const side of ['home', 'away'] as const) {
      const clubId = side === 'home' ? fixture.homeClubId : fixture.awayClubId;
      if (!outside.includes(clubId)) continue;
      expect(fixture.result!.rosterIds![side]).toBe(backgroundRosterId(clubId, 2));
      const squad = new Set(backgroundSide(nextSeason, clubId, 2).players.map(player => player.id));
      expect(fixture.result!.selection![side].every(id => squad.has(id))).toBe(true);
    }
    expect(parseSeason(serializeSeasonCompact(complete))).toEqual(complete);
    expect(parseSeason(serializeSeasonCompact(nextSeason))).toEqual(nextSeason);
    // Season one's archived games still name season one's squads.
    const archived = nextSeason.history[0]!.fixtures.filter(fixture => fixture.competition && outside.includes(fixture.awayClubId));
    for (const fixture of archived.slice(0, 20)) {
      const squad = new Set(backgroundSide(nextSeason, fixture.awayClubId, 1).players.map(player => player.id));
      expect(fixture.result!.selection!.away.every(id => squad.has(id))).toBe(true);
    }
  }, 300_000);
});
