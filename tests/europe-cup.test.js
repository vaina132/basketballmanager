import { beforeAll, describe, expect, it } from 'vitest';
import { testWorld } from './world-fixtures';
import { advanceSeason, createSeason, managedSide, NEW_CAREER_SYSTEMS, rolloverSeason, seasonStartDate } from '../src/world/season';
import { parseSeason, serializeSeason, serializeSeasonCompact } from '../src/storage/season-storage';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { setEmploymentDelegation } from '../src/world/employment';
import { advanceMarket } from '../src/world/market';
import { getMarketStartReason } from '../src/world/market-policy';
import { withEuropeanCompetitions, worldFromPack } from '../src/world/real-world';
import { regularWorldRounds, validateWorld } from '../src/world/career-world';
import { calendarDaysBetween } from '../src/world/competition-calendar';
import { EUROPEAN_FORMATS, knockoutOf } from '../src/world/european-formats';
import { europeanGroups, europeanSlotDay, getEuropeanCompetitions } from '../src/world/europe';

const play = state => advanceSeason(state.activeMatch ? { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) } : state);
const roundTrip = state => parseSeason(serializeSeasonCompact(state));
const EUROCUP = EUROPEAN_FORMATS['eurocup-2026-1'];

/** Outside clubs from a second test world, with their own identities. */
function outsideClubs(label, prefix, count) {
  const size = Math.max(20, count), pool = testWorld(size, label);
  const clubs = pool.clubs.slice(size - count).map(club => ({ ...club, id: `${prefix}-${club.id}`, name: `${prefix.toUpperCase()} ${club.name}`, shortName: `${prefix.slice(0, 1).toUpperCase()}${club.shortName}`.slice(0, 4), players: club.players.map(player => ({ ...player, id: `${prefix}-${player.id}` })) }));
  return clubs.map(team => ({ team, venue: null, profiles: Object.fromEntries(team.players.map(player => [player.id, pool.playerProfiles[player.id.slice(prefix.length + 1)]])) }));
}

/** Testland's two divisions; a ten-club EuroLeague and a EuroCup of two league clubs and `outside` clubs from elsewhere. */
function cupWorld({ outside = 14, euroleague = true } = {}) {
  const base = testWorld(11);
  const playerContracts = Object.fromEntries(base.clubs.flatMap(club => club.players.map((player, index) => [player.id, 1 + (index % 3)])));
  const leagues = { ...base, id: 'europe-cup-test', rosterModel: 'club-roster-1', playerContracts, domesticLeagues: [
    { id: 'first', name: 'First division', country: 'Testland', tier: 1, clubIds: base.clubs.slice(0, 6).map(club => club.id), postseason: 'test-tier1-1', standingsRule: 'fiba-2026-d' },
    { id: 'second', name: 'Second division', country: 'Testland', tier: 2, clubIds: base.clubs.slice(6).map(club => club.id), postseason: 'test-tier2-1', standingsRule: 'fiba-2026-d' },
  ] };
  const el = euroleague ? outsideClubs('europe-pool', 'eu', 8) : [], ec = outsideClubs('eurocup-pool', 'ec', outside);
  return withEuropeanCompetitions(leagues, [
    ...(euroleague ? [{ id: 'euroleague', name: 'Test EuroLeague', kind: 'euroleague', season: '2026-27', format: 'euroleague-2026-1', clubIds: [leagues.clubs[0].id, leagues.clubs[1].id, ...el.map(entry => entry.team.id)] }] : []),
    { id: 'eurocup', name: 'Test EuroCup', kind: 'eurocup', season: '2026-27', format: 'eurocup-2026-1', clubIds: [leagues.clubs[2].id, leagues.clubs[3].id, ...ec.map(entry => entry.team.id)] },
  ], [...el, ...ec]);
}

describe('the EuroCup format and calendar (step 3.5d)', () => {
  it('draws four equal groups that play fourteen rounds from 29 September to 13 January, A and B on Tuesdays, C and D on Wednesdays', () => {
    const world = cupWorld({ outside: 30 });
    expect(() => validateWorld(world)).not.toThrow();
    const competition = world.europeanCompetitions[1];
    const groups = europeanGroups(9, 1, competition);
    expect(groups.map(group => [group.id, group.clubIds.length, group.day])).toEqual([['A', 8, 3], ['B', 8, 3], ['C', 8, 4], ['D', 8, 4]]);
    expect(groups.flatMap(group => group.clubIds).sort()).toEqual([...competition.clubIds].sort());
    expect(europeanGroups(10, 1, competition)).not.toEqual(groups);
    const state = createSeason({ world, seed: 9, ...NEW_CAREER_SYSTEMS });
    const games = state.fixtures.filter(fixture => fixture.competition === 'eurocup');
    expect(games).toHaveLength(4 * 56);
    const start = seasonStartDate(1);
    for (const group of groups) {
      const own = games.filter(fixture => group.clubIds.includes(fixture.homeClubId));
      expect(own).toHaveLength(56);
      expect(own.every(fixture => group.clubIds.includes(fixture.awayClubId) && calendarDaysBetween(start, fixture.date) % 7 === group.day)).toBe(true);
      for (const home of group.clubIds) for (const away of group.clubIds) if (home !== away) expect(own.filter(fixture => fixture.homeClubId === home && fixture.awayClubId === away)).toHaveLength(1);
      const dates = [...new Set(own.map(fixture => fixture.date))].sort();
      expect(dates).toHaveLength(14);
      expect(dates[0]).toBe(group.day === 3 ? '2026-09-29' : '2026-09-30');
      expect(dates.at(-1)).toBe(group.day === 3 ? '2027-01-12' : '2027-01-13');
    }
  });

  it('pairs the eighth-finals across groups and reserves the real knockout dates', () => {
    const knockout = knockoutOf(EUROCUP, 32);
    expect(knockout.series.slice(0, 8).map(series => [series.a.place, series.b.place])).toEqual([[1, 12], [10, 3], [9, 4], [2, 11], [17, 28], [26, 19], [25, 20], [18, 27]]);
    expect(knockout.series.every(series => series.bestOf === 3)).toBe(true);
    expect(knockout.series.some(series => series.stage === 'third-place')).toBe(false);
    expect(knockoutOf(EUROCUP, 16).series[0]).toMatchObject({ a: { place: 1 }, b: { place: 8 } });
    expect(EUROCUP.slots.map((_, index) => europeanSlotDay(EUROCUP, 1, index + 1).date)).toEqual(['2027-02-02', '2027-02-04', '2027-02-10', '2027-03-09', '2027-03-11', '2027-03-17', '2027-03-31', '2027-04-06', '2027-04-08', '2027-04-21', '2027-04-27', '2027-04-29']);
    // The EuroLeague still sets the longest European calendar.
    expect(regularWorldRounds(cupWorld())).toBe(38);
    expect(regularWorldRounds(cupWorld({ euroleague: false }))).toBe(34);
  });

  it('refuses fields that do not divide into four groups of at least four, and the format before format 58', () => {
    expect(() => validateWorld(cupWorld({ outside: 15 }))).toThrow(/equal groups of at least four/);
    expect(() => validateWorld(cupWorld({ outside: 12 }))).toThrow(/16 to 32 entrants/);
    const state = createSeason({ world: cupWorld(), seed: 2 });
    const envelope = JSON.parse(serializeSeason(state));
    envelope.formatVersion = 57; envelope.state.schemaVersion = 57;
    expect(() => parseSeason(JSON.stringify(envelope))).toThrow(/requires format 58/);
  });

  it('keeps the chosen leagues\' clubs and the strongest others when a pack lists more clubs than the format holds', () => {
    const positions = ['PG', 'SG', 'SF', 'PF', 'C'];
    const ids = Array.from({ length: 22 }, (_, index) => `c${index}`);
    const players = ids.flatMap((club, clubIndex) => Array.from({ length: 10 }, (_, index) => ({ id: `p-${club}-${index}`, name: `${club} ${index}`, clubId: `club-${club}`, number: index + 4, position: positions[index % 5], nationality: 'X', age: 24, heightCm: 200, weightKg: 95,
      attributes: { twoPoint: 4 + (clubIndex % 12), threePoint: 10, freeThrow: 11, passing: 9, defense: 10, rebounding: 10, stamina: 13 }, estimated: [] })));
    const pack = {
      format: 'basketball-manager-data-pack', formatVersion: 1, version: 'cup.1', season: '2026-27', source: { provider: 'test' }, notice: 'Private test data.',
      competitions: [
        { id: 'liga', name: 'Test Liga', country: 'X', tier: 1, kind: 'domestic', season: '2026-27', clubIds: ids.slice(0, 4).map(id => `club-${id}`) },
        { id: 'cup', name: 'EuroCup', country: null, tier: 1, kind: 'european', season: '2026-27', clubIds: ids.slice(0, 18).map(id => `club-${id}`) },
      ],
      clubs: ids.map(id => ({ id: `club-${id}`, name: `Club ${id}`, shortName: id.toUpperCase().padEnd(3, 'X'), country: 'X', city: null, arena: null, color: '#336699', secondaryColor: null, identitySource: null, playerIds: players.filter(item => item.clubId === `club-${id}`).map(item => item.id) })),
      players,
    };
    const world = worldFromPack(pack, 'liga');
    const [cup] = world.europeanCompetitions;
    expect(cup.format).toBe('eurocup-2026-1');
    expect(cup.clubIds).toHaveLength(16);
    // The four league clubs stay (even the weakest, c0); of the others the two weakest by squad strength go.
    expect(cup.clubIds.slice(0, 4)).toEqual(['club-c0', 'club-c1', 'club-c2', 'club-c3']);
    expect(cup.clubIds).not.toContain('club-c12');
    expect(cup.clubIds).not.toContain('club-c13');
    expect(world.clubs.some(club => club.id === 'club-c12')).toBe(false);
    expect(() => validateWorld(world)).not.toThrow();
  });
});

describe('a season with a EuroLeague and a EuroCup (step 3.5d)', () => {
  let world, complete, nextSeason;
  beforeAll(() => {
    world = cupWorld();
    let state = setEmploymentDelegation(createSeason({ seed: 77, world, managedClubId: world.clubs[2].id, ...NEW_CAREER_SYSTEMS }), true);
    while (state.status === 'active') state = play(state);
    complete = state;
    for (let steps = 0; steps < 120 && getMarketStartReason(state); steps += 1) state = advanceMarket(state);
    nextSeason = rolloverSeason(state);
    for (let week = 0; week < 5; week += 1) nextSeason = play(nextSeason);
  }, 600_000);

  it('plays the groups, then best-of-three series seeded across groups, to a champion', () => {
    const cup = getEuropeanCompetitions(complete, 1).find(entry => entry.competition.id === 'eurocup');
    expect(cup.tables.map(group => group.rows.every(row => row.played === 6))).toEqual([true, true, true, true]);
    expect(cup.order).toHaveLength(16);
    const place = (group, position) => cup.tables[group].rows[position - 1].clubId;
    const series = new Map(cup.series.map(entry => [entry.id, entry]));
    expect([series.get('ef-a').higher.clubId, series.get('ef-a').lower.clubId].sort()).toEqual([place(0, 1), place(1, 4)].sort());
    expect([series.get('ef-c').higher.clubId, series.get('ef-c').lower.clubId].sort()).toEqual([place(1, 1), place(0, 4)].sort());
    // A group winner always has home advantage over a fourth-placed club.
    expect(series.get('ef-c').higher.clubId).toBe(place(1, 1));
    for (const entry of cup.series) {
      const games = complete.fixtures.filter(fixture => fixture.competition === 'eurocup' && fixture.seriesId === entry.id);
      expect(games.length).toBeGreaterThanOrEqual(2);
      expect(games.length).toBeLessThanOrEqual(3);
      games.forEach(game => expect(game.homeClubId).toBe(game.game === 2 ? entry.lower.clubId : entry.higher.clubId));
      expect(entry.winner).not.toBeNull();
    }
    expect(cup.outcome.champion).toBe(series.get('final').winner);
    const euroleague = getEuropeanCompetitions(complete, 1).find(entry => entry.competition.id === 'euroleague');
    expect(euroleague.outcome.champion).not.toBeNull();
  }, 120_000);

  it('keeps every club\'s games at least two days apart and saves strictly through the rollover', () => {
    const byClub = new Map();
    for (const fixture of complete.fixtures) for (const clubId of [fixture.homeClubId, fixture.awayClubId]) byClub.set(clubId, [...(byClub.get(clubId) ?? []), fixture.date]);
    for (const dates of byClub.values()) expect(dates.slice(1).every((date, index) => calendarDaysBetween(dates[index], date) >= 2)).toBe(true);
    expect(roundTrip(complete)).toEqual(complete);
    expect(roundTrip(nextSeason)).toEqual(nextSeason);
    expect(nextSeason.fixtures.filter(fixture => fixture.competition === 'eurocup' && fixture.result).length).toBeGreaterThan(0);
  }, 120_000);
});
