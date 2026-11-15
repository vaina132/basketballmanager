import { beforeAll, describe, expect, it } from 'vitest';
import { testWorld } from './world-fixtures';
import { advanceSeason, createSeason, managedSide, NEW_CAREER_SYSTEMS, rolloverSeason, seasonStartDate } from '../src/world/season';
import { parseSeason, serializeSeason, serializeSeasonCompact } from '../src/storage/season-storage';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { setEmploymentDelegation } from '../src/world/employment';
import { advanceMarket } from '../src/world/market';
import { getMarketStartReason } from '../src/world/market-policy';
import { withEuropeanCompetitions } from '../src/world/real-world';
import { regularWorldRounds, validateWorld } from '../src/world/career-world';
import { calendarDaysBetween } from '../src/world/competition-calendar';
import { qualificationSplit } from '../src/world/european-formats';
import { bclDraw, bclField, clubStrength, getEuropeanCompetitions } from '../src/world/europe';

const play = state => advanceSeason(state.activeMatch ? { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) } : state);
const roundTrip = state => parseSeason(serializeSeasonCompact(state));

/** Testland's two divisions and a BCL of two league clubs and `outside` clubs from nine other countries. */
function bclWorld({ outside = 36, countries = index => `Land ${index % 9}` } = {}) {
  const base = testWorld(11);
  const playerContracts = Object.fromEntries(base.clubs.flatMap(club => club.players.map((player, index) => [player.id, 1 + (index % 3)])));
  const leagues = { ...base, id: 'europe-bcl-test', rosterModel: 'club-roster-1', playerContracts, domesticLeagues: [
    { id: 'first', name: 'First division', country: 'Testland', tier: 1, clubIds: base.clubs.slice(0, 6).map(club => club.id), postseason: 'test-tier1-1', standingsRule: 'fiba-2026-d' },
    { id: 'second', name: 'Second division', country: 'Testland', tier: 2, clubIds: base.clubs.slice(6).map(club => club.id), postseason: 'test-tier2-1', standingsRule: 'fiba-2026-d' },
  ] };
  const pool = testWorld(48, 'bcl-pool');
  const clubs = pool.clubs.slice(48 - outside).map(club => ({ ...club, id: `bc-${club.id}`, name: `BC ${club.name}`, players: club.players.map(player => ({ ...player, id: `bc-${player.id}` })) }));
  const entrants = clubs.map(team => ({ team, venue: null, profiles: Object.fromEntries(team.players.map(player => [player.id, pool.playerProfiles[player.id.slice(3)]])) }));
  const ids = [leagues.clubs[0].id, leagues.clubs[1].id, ...clubs.map(club => club.id)];
  return withEuropeanCompetitions(leagues, [{ id: 'bcl', name: 'Test Champions League', kind: 'bcl', season: '2026-27', format: 'bcl-2026-1', clubIds: ids,
    countries: Object.fromEntries(ids.map((id, index) => [id, index < 2 ? 'Testland' : countries(index - 2)])) }], entrants);
}

describe('the BCL format, field and draw (step 3.5e)', () => {
  it('splits the field into 30 direct places and two qualification tournaments by squad strength', () => {
    expect([32, 36, 38, 40, 54].map(qualificationSplit)).toEqual([[0, 0], [2, 4], [4, 4], [2, 8], [8, 16]]);
    expect(() => qualificationSplit(33)).toThrow(/cannot be split/);
    const world = bclWorld(), competition = world.europeanCompetitions[0];
    const field = bclField(world, competition);
    expect(field.direct).toHaveLength(30);
    expect(field.qualification.map(list => list.length)).toEqual([4, 4]);
    const strength = id => clubStrength(world, id);
    expect(Math.min(...field.direct.map(strength))).toBeGreaterThanOrEqual(Math.max(...field.qualification[0].map(strength)));
    expect(Math.min(...field.qualification[0].map(strength))).toBeGreaterThanOrEqual(Math.max(...field.qualification[1].map(strength)));
  });

  it('draws eight groups of four, one club from each pot, never two clubs of one country together', () => {
    const world = bclWorld(), competition = world.europeanCompetitions[0];
    const groups = bclDraw(world, 3, 1, competition);
    expect(groups.map(group => group.length)).toEqual([4, 4, 4, 4, 4, 4, 4, 4]);
    const slots = [...bclField(world, competition).direct, '#q1', '#q2'];
    for (const group of groups) {
      // Pot order: the strongest pot's club first, the qualification places in the last pot.
      expect(group.map(id => Math.floor(slots.indexOf(id) / 8))).toEqual([0, 1, 2, 3]);
      const countries = group.filter(id => !id.startsWith('#')).map(id => competition.countries[id]);
      expect(new Set(countries).size).toBe(countries.length);
    }
    expect(groups.flat().filter(id => id.startsWith('#')).sort()).toEqual(['#q1', '#q2']);
    expect(bclDraw(world, 3, 1, competition)).toBe(groups);
    expect(bclDraw(world, 4, 1, competition)).not.toEqual(groups);
    // A tight field still keeps countries apart: four countries of eight clubs each.
    const tight = bclWorld({ outside: 30, countries: index => `Land ${index % 4}` }), tightCompetition = tight.europeanCompetitions[0];
    for (const group of bclDraw(tight, 9, 1, tightCompetition)) expect(new Set(group.map(id => tightCompetition.countries[id])).size).toBe(4);
  });

  it('refuses missing or inconsistent countries, too many clubs of one country and the format before format 59', () => {
    const world = bclWorld();
    expect(() => validateWorld(world)).not.toThrow();
    const check = (change, pattern) => { const copy = structuredClone(world); change(copy); expect(() => validateWorld(copy)).toThrow(pattern); };
    check(copy => { delete copy.europeanCompetitions[0].countries; }, /every entrant's country/);
    check(copy => { copy.europeanCompetitions[0].countries[copy.clubs[0].id] = 'Elsewhere'; }, /country of each league club/);
    check(copy => { for (const id of copy.europeanCompetitions[0].clubIds.slice(2, 12)) copy.europeanCompetitions[0].countries[id] = 'Land 0'; }, /at most eight/);
    expect(() => validateWorld(bclWorld({ outside: 35 }))).toThrow(/32 to 54 entrants/);
    expect(regularWorldRounds(world)).toBe(36);
    const envelope = JSON.parse(serializeSeason(createSeason({ world, seed: 3 })));
    envelope.formatVersion = 58; envelope.state.schemaVersion = 58;
    expect(() => parseSeason(JSON.stringify(envelope))).toThrow(/requires format 59/);
  });
});

describe('a season with a BCL (step 3.5e)', () => {
  let world, opening, afterQualification, complete, nextSeason;
  beforeAll(() => {
    world = bclWorld();
    opening = setEmploymentDelegation(createSeason({ seed: 21, world, managedClubId: world.clubs[0].id, ...NEW_CAREER_SYSTEMS }), true);
    let state = opening;
    while (state.status === 'active') {
      state = play(state);
      if (!afterQualification && state.round === 3) afterQualification = state;
    }
    complete = state;
    for (let steps = 0; steps < 120 && getMarketStartReason(state); steps += 1) state = advanceMarket(state);
    nextSeason = rolloverSeason(state);
    for (let week = 0; week < 3; week += 1) nextSeason = play(nextSeason);
  }, 900_000);

  it('plays the qualification tournaments at one venue in September, then the groups their winners join', () => {
    const start = seasonStartDate(1), bcl = getEuropeanCompetitions(complete, 1)[0];
    const qualifying = complete.fixtures.filter(fixture => fixture.competition === 'bcl' && fixture.stage === 'qualifying');
    expect(qualifying).toHaveLength(6);
    expect(qualifying.every(fixture => fixture.neutral && calendarDaysBetween(start, fixture.date) < 14)).toBe(true);
    expect(qualifying.filter(fixture => fixture.seriesId.endsWith('final')).map(fixture => fixture.date)).toEqual(['2026-09-17', '2026-09-17']);
    const winners = bcl.series.filter(series => series.id.endsWith('-final') && series.stage === 'qualifying').map(series => series.winner);
    expect(winners).toHaveLength(2);
    // Before the qualification is decided, the groups waiting for its winners have no games yet.
    const waiting = opening.fixtures.filter(fixture => fixture.competition === 'bcl' && !fixture.stage);
    expect(waiting).toHaveLength(6 * 12);
    expect(afterQualification.fixtures.filter(fixture => fixture.competition === 'bcl' && !fixture.stage)).toHaveLength(8 * 12);
    for (const group of bcl.tables) {
      expect(group.rows.every(row => row.played === 6)).toBe(true);
      const own = complete.fixtures.filter(fixture => fixture.competition === 'bcl' && !fixture.stage && group.clubIds.includes(fixture.homeClubId));
      expect([...new Set(own.map(fixture => fixture.date))]).toEqual(['2026-10-06', '2026-10-20', '2026-11-03', '2026-11-17', '2026-12-08', '2026-12-22'].map(date => group.day === 3 ? date : date.replace(/(\d\d)$/, day => String(Number(day) + 1).padStart(2, '0'))));
    }
    expect(winners.every(id => bcl.tables.some(group => group.clubIds.includes(id)))).toBe(true);
  });

  it('pairs the play-ins by group, builds the Round of 16 groups by the draw pattern and plays the quarter-finals and a Final Four with a third-place game', () => {
    const bcl = getEuropeanCompetitions(complete, 1)[0];
    const place = (group, position) => bcl.tables[group].rows[position - 1].clubId;
    const series = new Map(bcl.series.map(entry => [entry.id, entry]));
    expect([series.get('pi-a').higher.clubId, series.get('pi-a').lower.clubId]).toEqual([place(0, 2), place(1, 3)]);
    expect([series.get('pi-b').higher.clubId, series.get('pi-b').lower.clubId]).toEqual([place(1, 2), place(0, 3)]);
    for (const id of ['pi-a', 'pi-b', 'pi-c', 'pi-d', 'pi-e', 'pi-f', 'pi-g', 'pi-h']) {
      complete.fixtures.filter(fixture => fixture.competition === 'bcl' && fixture.seriesId === id).forEach(game => expect(game.homeClubId).toBe(game.game === 2 ? series.get(id).lower.clubId : series.get(id).higher.clubId));
    }
    const groupI = bcl.roundOf16[0];
    expect(groupI.clubIds).toEqual([place(0, 1), place(4, 1), series.get('pi-c').winner, series.get('pi-g').winner]);
    expect(bcl.roundOf16.map(group => group.rows.every(row => row.played === 6))).toEqual([true, true, true, true]);
    const r16 = group => bcl.roundOf16[group].rows;
    expect([series.get('qf-a').higher.clubId, series.get('qf-a').lower.clubId]).toEqual([r16(0)[0].clubId, r16(1)[1].clubId]);
    expect([series.get('qf-b').higher.clubId, series.get('qf-b').lower.clubId]).toEqual([r16(1)[0].clubId, r16(0)[1].clubId]);
    const finalFour = complete.fixtures.filter(fixture => fixture.competition === 'bcl' && ['semi-final', 'third-place', 'final'].includes(fixture.stage));
    expect(finalFour.filter(fixture => fixture.stage === 'semi-final').map(fixture => fixture.date)).toEqual(['2027-05-11', '2027-05-11']);
    expect(finalFour.filter(fixture => fixture.stage !== 'semi-final').map(fixture => fixture.stage).sort()).toEqual(['final', 'third-place']);
    expect(finalFour.every(fixture => fixture.neutral)).toBe(true);
    expect(series.get('third').higher && [series.get('third').higher.clubId, series.get('third').lower.clubId].sort()).toEqual([series.get('sf-a').loser, series.get('sf-b').loser].sort());
    expect(bcl.outcome.champion).toBe(series.get('final').winner);
  });

  it('keeps every club\'s games at least two days apart and saves strictly through the rollover', () => {
    const byClub = new Map();
    for (const fixture of complete.fixtures) for (const clubId of [fixture.homeClubId, fixture.awayClubId]) byClub.set(clubId, [...(byClub.get(clubId) ?? []), fixture.date]);
    for (const dates of byClub.values()) expect(dates.slice(1).every((date, index) => calendarDaysBetween(dates[index], date) >= 2)).toBe(true);
    expect(roundTrip(afterQualification)).toEqual(afterQualification);
    expect(roundTrip(complete)).toEqual(complete);
    expect(roundTrip(nextSeason)).toEqual(nextSeason);
    expect(nextSeason.fixtures.filter(fixture => fixture.competition === 'bcl' && fixture.stage === 'qualifying' && fixture.result)).toHaveLength(6);
  }, 300_000);
});
