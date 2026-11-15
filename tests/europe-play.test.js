import { beforeAll, describe, expect, it } from 'vitest';
import { testWorld } from './world-fixtures';
import { advanceSeason, createSeason, getStandings, managedSide, NEW_CAREER_SYSTEMS, rolloverSeason, seasonStartDate } from '../src/world/season';
import { parseSeason, serializeSeason, serializeSeasonCompact } from '../src/storage/season-storage';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { setEmploymentDelegation } from '../src/world/employment';
import { advanceMarket } from '../src/world/market';
import { getMarketStartReason } from '../src/world/market-policy';
import { withEuropeanCompetitions } from '../src/world/real-world';
import { regularWorldRounds, validateWorld, worldRounds } from '../src/world/career-world';
import { calendarDaysBetween } from '../src/world/competition-calendar';
import { EUROPEAN_FORMATS, europeanWeeks } from '../src/world/european-formats';
import { backgroundRosterId, backgroundSide, europeanDrawOrder, europeanRoundDates, europeanSlotDay, getEuropeanCompetitions } from '../src/world/europe';
import { getSeasonPerformance } from '../src/world/performance';
import { currentSeasonFile } from './helpers/season-format';

const play = state => advanceSeason(state.activeMatch ? { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) } : state);
const roundTrip = state => parseSeason(serializeSeasonCompact(state));
const EUROLEAGUE = EUROPEAN_FORMATS['euroleague-2026-1'];

/** Testland's two divisions (six and five clubs, with postseasons); a EuroLeague of two league clubs and eight clubs from outside the world's leagues. */
function europeanWorld({ format = 'euroleague-2026-1', entrants = 8 } = {}) {
  const base = testWorld(11);
  const playerContracts = Object.fromEntries(base.clubs.flatMap(club => club.players.map((player, index) => [player.id, 1 + (index % 3)])));
  const leagues = { ...base, id: 'europe-play-test', rosterModel: 'club-roster-1', playerContracts, domesticLeagues: [
    { id: 'first', name: 'First division', country: 'Testland', tier: 1, clubIds: base.clubs.slice(0, 6).map(club => club.id), postseason: 'test-tier1-1', standingsRule: 'fiba-2026-d' },
    { id: 'second', name: 'Second division', country: 'Testland', tier: 2, clubIds: base.clubs.slice(6).map(club => club.id), postseason: 'test-tier2-1', standingsRule: 'fiba-2026-d' },
  ] };
  const pool = testWorld(20, 'europe-pool');
  const outside = pool.clubs.slice(20 - entrants).map(club => ({ ...club, id: `eu-${club.id}`, name: `Euro ${club.name}`, players: club.players.map(player => ({ ...player, id: `eu-${player.id}` })) }));
  return withEuropeanCompetitions(leagues, [{ id: 'euroleague', name: 'Test EuroLeague', kind: 'euroleague', season: '2026-27', ...(format ? { format } : {}), clubIds: [leagues.clubs[0].id, leagues.clubs[1].id, ...outside.map(club => club.id)] }],
    outside.map(team => ({ team, venue: null, profiles: Object.fromEntries(team.players.map(player => [player.id, pool.playerProfiles[player.id.slice(3)]])) })));
}

describe('the EuroLeague format and calendar (steps 3.5b-c)', () => {
  it('plays 38 rounds on Thursdays of weeks 3-32, with Tuesday rounds in eight evenly spread double weeks', () => {
    const dates = europeanRoundDates(EUROLEAGUE, 1, 38), start = seasonStartDate(1);
    expect(dates).toHaveLength(38);
    expect(dates[0]).toBe('2026-09-24');
    expect(dates.at(-1)).toBe('2027-04-15');
    const days = dates.map(date => calendarDaysBetween(start, date));
    expect(days.every(day => [3, 5].includes(day % 7))).toBe(true);
    const weeks = days.map(day => Math.floor(day / 7) + 1);
    expect(Math.min(...weeks)).toBe(3);
    expect(Math.max(...weeks)).toBe(32);
    const doubles = [...new Set(weeks.filter((week, index) => weeks.indexOf(week) !== index))];
    expect(doubles).toHaveLength(8);
    // Evenly spread: never two double weeks in a row, and every gap within one week of the others.
    const gaps = doubles.slice(1).map((week, index) => week - doubles[index]);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1);
    expect(days.slice(1).every((day, index) => day - days[index] >= 2)).toBe(true);
    // A ten-club field has 18 rounds, one a week, spread over the same weeks.
    const small = europeanRoundDates(EUROLEAGUE, 1, 18).map(date => calendarDaysBetween(start, date));
    expect(small.every(day => day % 7 === 5)).toBe(true);
    expect([Math.floor(small[0] / 7) + 1, Math.floor(small.at(-1) / 7) + 1]).toEqual([3, 32]);
  });

  it('reserves Play-In, playoff and Final Four days before the domestic postseasons, with no third-place game', () => {
    expect(EUROLEAGUE.knockout.series.map(series => [series.id, series.bestOf])).toEqual([['pi-a', 1], ['pi-b', 1], ['pi-c', 1], ['qf-a', 5], ['qf-b', 5], ['qf-c', 5], ['qf-d', 5], ['sf-a', 1], ['sf-b', 1], ['final', 1]]);
    expect(EUROLEAGUE.knockout.series.filter(series => series.neutral).map(series => series.id)).toEqual(['sf-a', 'sf-b', 'final']);
    expect(EUROLEAGUE.slots.map((_, index) => europeanSlotDay(EUROLEAGUE, 1, index + 1).date)).toEqual(['2027-04-20', '2027-04-22', '2027-04-27', '2027-04-29', '2027-05-04', '2027-05-06', '2027-05-11', '2027-05-25', '2027-05-27']);
    const world = europeanWorld();
    expect(europeanWeeks(world)).toBe(38);
    // The domestic regular season lasts until the last European week; the postseasons follow.
    expect(regularWorldRounds(world)).toBe(38);
    expect(worldRounds(world)).toBe(38 + 2);
    expect(regularWorldRounds(europeanWorld({ format: null }))).toBe(10);
  });

  it('draws the regular season from the career seed: every pair meets home and away, other seeds draw differently', () => {
    const world = europeanWorld(), ids = world.europeanCompetitions[0].clubIds;
    const order = europeanDrawOrder(4, 1, 'euroleague', ids);
    expect([...order].sort()).toEqual([...ids].sort());
    expect(europeanDrawOrder(4, 1, 'euroleague', ids)).toEqual(order);
    expect(europeanDrawOrder(5, 1, 'euroleague', ids)).not.toEqual(order);
    expect(europeanDrawOrder(4, 2, 'euroleague', ids)).not.toEqual(order);
    const state = createSeason({ world, seed: 4, ...NEW_CAREER_SYSTEMS });
    const games = state.fixtures.filter(fixture => fixture.competition === 'euroleague');
    expect(games).toHaveLength(90);
    for (const home of ids) for (const away of ids) if (home !== away) expect(games.filter(fixture => fixture.homeClubId === home && fixture.awayClubId === away)).toHaveLength(1);
  });

  it('refuses a format of another competition, a field the format cannot hold, worlds without full rosters and an id shared with a league', () => {
    const world = europeanWorld();
    expect(() => validateWorld(world)).not.toThrow();
    const check = (change, pattern) => { const copy = structuredClone(world); change(copy); expect(() => validateWorld(copy)).toThrow(pattern); };
    check(copy => { copy.europeanCompetitions[0].format = 'eurocup-2026-1'; }, /format of this competition/);
    check(copy => { copy.europeanCompetitions[0].kind = 'bcl'; }, /format of this competition/);
    check(copy => { delete copy.rosterModel; }, /full rosters/);
    check(copy => { copy.europeanCompetitions[0].id = 'first'; }, /domestic league/);
    expect(() => validateWorld(europeanWorld({ entrants: 7 }))).toThrow(/10 to 20 entrants/);
  });
});

describe('a season with a EuroLeague (steps 3.5b-c)', () => {
  let world, opening, midway, complete, nextSeason;
  beforeAll(() => {
    world = europeanWorld();
    opening = setEmploymentDelegation(createSeason({ seed: 5150, world, managedClubId: world.clubs[0].id, ...NEW_CAREER_SYSTEMS }), true);
    let state = opening;
    while (state.status === 'active') {
      state = play(state);
      if (!midway && state.round === 20) midway = state;
    }
    complete = state;
    for (let steps = 0; steps < 120 && getMarketStartReason(state); steps += 1) state = advanceMarket(state);
    nextSeason = rolloverSeason(state);
    for (let week = 0; week < 4; week += 1) nextSeason = play(nextSeason);
  }, 600_000);

  it('keeps every game in calendar order, a club never playing twice within two days', () => {
    for (const state of [opening, complete]) {
      expect(state.fixtures.map(fixture => fixture.date)).toEqual(state.fixtures.map(fixture => fixture.date).sort());
      const byClub = new Map();
      for (const fixture of state.fixtures) for (const clubId of [fixture.homeClubId, fixture.awayClubId]) byClub.set(clubId, [...(byClub.get(clubId) ?? []), fixture.date]);
      for (const dates of byClub.values()) expect(dates.slice(1).every((date, index) => calendarDaysBetween(dates[index], date) >= 2)).toBe(true);
    }
    // Domestic games on Saturdays, European games midweek; the domestic postseasons start after the last European week.
    const start = seasonStartDate(1);
    expect(complete.fixtures.filter(fixture => fixture.competition).every(fixture => [3, 5].includes(calendarDaysBetween(start, fixture.date) % 7))).toBe(true);
    expect(complete.fixtures.filter(fixture => !fixture.competition && !fixture.stage).every(fixture => calendarDaysBetween(start, fixture.date) % 7 === 0)).toBe(true);
    expect(Math.min(...complete.fixtures.filter(fixture => !fixture.competition && fixture.stage).map(fixture => fixture.round))).toBe(39);
    expect(Math.max(...complete.fixtures.filter(fixture => fixture.competition).map(fixture => fixture.round))).toBeLessThanOrEqual(38);
  });

  it('fields clubs outside the full world as background sides: their best available players, no club records', () => {
    const outside = world.europeanCompetitions[0].clubIds.slice(2);
    expect(complete.clubs.some(club => outside.includes(club.id))).toBe(false);
    const games = complete.fixtures.filter(fixture => fixture.competition && (outside.includes(fixture.homeClubId) || outside.includes(fixture.awayClubId)));
    expect(games.length).toBeGreaterThan(70);
    for (const fixture of games) for (const side of ['home', 'away']) {
      const clubId = side === 'home' ? fixture.homeClubId : fixture.awayClubId;
      if (!outside.includes(clubId)) continue;
      expect(fixture.result.rosterIds[side]).toBe(backgroundRosterId(clubId, 1));
      const squad = new Set(backgroundSide(complete, clubId, 1).players.map(player => player.id));
      expect(fixture.result.selection[side].length).toBeGreaterThanOrEqual(5);
      expect(fixture.result.selection[side].every(id => squad.has(id))).toBe(true);
    }
    // No finances, plans, conditions or registrations for background clubs; their injuries are recorded like every other.
    expect(complete.finance.ledger.some(entry => outside.includes(entry.clubId))).toBe(false);
    expect(Object.keys(complete.plans).some(id => outside.includes(id))).toBe(false);
    expect(complete.rosters.some(roster => outside.includes(roster.clubId))).toBe(false);
    expect(Object.keys(complete.conditions).some(id => id.startsWith('eu-'))).toBe(false);
    expect(complete.injuries.some(injury => outside.includes(injury.clubId))).toBe(true);
    // A background side's home game earns nothing; a full-world club's European home game earns its gate.
    const own = complete.fixtures.find(fixture => fixture.competition && fixture.homeClubId === world.clubs[0].id);
    expect(complete.finance.ledger.some(entry => entry.sourceId === `tickets-${own.id}`)).toBe(true);
  });

  it('keeps European games out of the domestic tables and plays the EuroLeague knockouts by its format', () => {
    const firstDivision = complete.divisions.leagues[0].clubIds;
    expect(getStandings(complete).filter(row => firstDivision.includes(row.clubId)).every(row => row.played === 10)).toBe(true);
    const [euroleague] = getEuropeanCompetitions(complete, 1);
    expect(euroleague.order).toHaveLength(10);
    expect(euroleague.table.every(row => row.played === 18)).toBe(true);
    const series = new Map(euroleague.series.map(entry => [entry.id, entry]));
    expect(series.get('pi-a').higher.clubId).toBe(euroleague.order[6]);
    expect(series.get('pi-b').higher.clubId).toBe(euroleague.order[8]);
    expect(series.get('qf-a').higher.clubId).toBe(euroleague.order[0]);
    expect([series.get('qf-a').lower.clubId]).toEqual([series.get('pi-c').winner]);
    // Best of five, games 1, 2 and 5 at the better seed; the Final Four at one venue.
    for (const id of ['qf-a', 'qf-b', 'qf-c', 'qf-d']) {
      const games = complete.fixtures.filter(fixture => fixture.competition === 'euroleague' && fixture.seriesId === id);
      expect(games.length).toBeGreaterThanOrEqual(3);
      expect(games.length).toBeLessThanOrEqual(5);
      games.forEach(game => expect(game.homeClubId).toBe([1, 2, 5].includes(game.game) ? series.get(id).higher.clubId : series.get(id).lower.clubId));
    }
    const finalFour = complete.fixtures.filter(fixture => fixture.competition === 'euroleague' && ['semi-final', 'final'].includes(fixture.stage));
    expect(finalFour).toHaveLength(3);
    expect(finalFour.every(fixture => fixture.neutral)).toBe(true);
    expect(complete.fixtures.some(fixture => fixture.stage === 'third-place')).toBe(false);
    expect(euroleague.outcome.champion).toBe(series.get('final').winner);
  });

  it('counts European games in the manager\'s player statistics', () => {
    const rows = getSeasonPerformance(complete).filter(row => row.club.id === complete.managedClubId);
    expect(rows.some(row => row.log.some(game => complete.fixtures.find(fixture => fixture.id === game.fixtureId).competition))).toBe(true);
  });

  it('saves strictly through the season, the rollover and season two\'s European calendar', () => {
    expect(roundTrip(midway)).toEqual(midway);
    expect(roundTrip(complete)).toEqual(complete);
    expect(roundTrip(nextSeason)).toEqual(nextSeason);
    expect(nextSeason.fixtures.filter(fixture => fixture.competition === 'euroleague')).toHaveLength(90);
    expect(complete.history).toHaveLength(0);
    const archived = nextSeason.history[0].fixtures.filter(fixture => fixture.competition);
    expect(archived.length).toBe(complete.fixtures.filter(fixture => fixture.competition).length);
  });

  it('refuses a changed background selection, roster reference, European game or starting condition', () => {
    const fixtureIndex = midway.fixtures.findIndex(fixture => fixture.competition && fixture.result && fixture.awayClubId.startsWith('eu-'));
    const changed = (change, pattern) => { const copy = structuredClone(midway); change(copy); expect(() => parseSeason(currentSeasonFile(copy))).toThrow(pattern); };
    changed(copy => { copy.fixtures[fixtureIndex].result.rosterIds.away = 'roster-x'; }, /background club's squad/);
    changed(copy => { const selection = copy.fixtures[fixtureIndex].result.selection.away; selection.push(selection.shift()); }, /best available players/);
    changed(copy => { copy.fixtures[fixtureIndex].competition = 'another'; }, /versioned schedule/);
    changed(copy => { const [game] = copy.fixtures.splice(fixtureIndex, 1); copy.fixtures.push(game); }, /versioned schedule/);
    let state = opening;
    while (!(state.activeMatch && state.fixtures.find(fixture => fixture.id === state.activeFixtureId).competition && state.activeMatch.status === 'ready' && state.fixtures.some(fixture => fixture.competition && fixture.result))) state = play(state);
    const fixture = state.fixtures.find(item => item.id === state.activeFixtureId), side = fixture.homeClubId === state.managedClubId ? 'away' : 'home';
    const copy = structuredClone(state);
    const player = copy.activeMatch[side].players[0].id;
    copy.activeMatch.stats[player].condition = copy.activeMatch.stats[player].condition === 100 ? 99 : 100;
    expect(() => parseSeason(currentSeasonFile(copy))).toThrow(/condition|activeMatch/);
    expect(() => parseSeason(serializeSeason(state))).not.toThrow();
  }, 300_000);
});
