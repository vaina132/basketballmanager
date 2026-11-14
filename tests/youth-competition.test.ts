import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { createFixtureMatch, simulateToEnd } from '../src/engine/match';
import { createSeason, dateForRound } from '../src/world/season';
import { academyAtBoundary, processAcademyWeek } from '../src/world/academy';
import { getAcademyCapacity, getClubAcademy } from '../src/world/academy-policy';
import { generateAcademyProspects, generateYouthSquadProspects } from '../src/world/academy-generation';
import { getCareerPlayers } from '../src/world/player-catalog';
import { createYouthCompetition, enableYouthCompetition, getYouthFixtures, getYouthFixtureTeams, getYouthPlayerPerformance, getYouthPlayerStatus, getYouthStandings, prepareYouthFixture, processYouthRound, settleYouthFixture, youthCompetitionAtBoundary, youthFixtureSeed } from '../src/world/youth-competition';

const create = (enabled = true) => createSeason(227, 'rhine-falcons', 'off', true, false, true, true, null, true, false, true, false, false, false, false, false, true, false, false, enabled);
const freeze = <T>(value: T): T => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const week = (state: SeasonState) => ({ rounds: 10, academy: state.academy, youth: state.youth, youthCompetition: state.youthCompetition, clubs: state.clubs, seasonNumber: state.seasonNumber, afterRound: state.round, fromDate: state.date, toDate: dateForRound(state.round + 1, state.seasonNumber) });

describe('real youth fixtures and explicit supplemental intake', () => {
  let initial: SeasonState, played: SeasonState;
  beforeAll(() => { initial = freeze(create()); played = freeze(processYouthRound(initial)); });

  it('keeps the legacy generator intact and creates distinct, age-balanced supplemental identities', () => {
    const old = create(false), enabled = enableYouthCompetition(old);
    expect(old.youthCompetition).toEqual(createYouthCompetition());
    expect(getAcademyCapacity(old)).toBe(6);
    expect(getAcademyCapacity(enabled)).toBe(8);
    expect(enabled.academy.prospects.slice(0, 18)).toEqual(old.academy.prospects);
    const clubId = old.managedClubId, original = old.academy.prospects.filter(prospect => prospect.clubId === clubId);
    expect(original).toEqual(generateAcademyProspects(old.seed, clubId, 1, 1, true, 3));
    const extra = generateYouthSquadProspects(old.seed, clubId, 1, 1, original, 5);
    expect(enabled.academy.prospects.filter(prospect => prospect.clubId === clubId).slice(3)).toEqual(extra);
    expect(extra.map(prospect => 2026 - Number(prospect.dateOfBirth.slice(0, 4)))).toEqual([19, 20, 16, 17, 18]);
    expect(new Set(enabled.academy.prospects.map(prospect => prospect.player.id)).size).toBe(48);
    for (const club of enabled.clubs) {
      const squad = getClubAcademy(enabled, club.id).map(row => row.player);
      expect(new Set(squad.map(player => player.name)).size).toBe(8);
      expect(new Set(squad.map(player => player.number)).size).toBe(8);
      expect(new Set(squad.map(player => player.position)).size).toBe(5);
      const fixture = getYouthFixtures(enabled).find(fixture => fixture.round === 1 && [fixture.homeClubId, fixture.awayClubId].includes(club.id))!;
      const teams = prepareYouthFixture(enabled, fixture);
      expect((teams.home.id === club.id ? teams.home : teams.away).players.map(player => [player.id, player.number])).toEqual(squad.map(player => [player.id, player.number]));
    }
    expect(getCareerPlayers(enabled)).toHaveLength(60);
    expect(enabled.academy.intakes.filter(intake => intake.source === 'youth-squad')).toHaveLength(6);
    expect(() => generateYouthSquadProspects(227, clubId, 1, 1, original, 9)).toThrow(/supplemental/);
    const prefix = academyAtBoundary(enabled.academy, 1, 1, enabled.employment.contracts.length, enabled.youthCompetition.enabledSince!.academyIntakeCount);
    expect(prefix.prospects).toEqual(old.academy.prospects);
    expect(prefix.intakes).toEqual(old.academy.intakes);
  });

  it('schedules only the remaining calendar and allows an uncommitted final matchday', () => {
    const old = create(false), final = { ...old, round: 10, date: dateForRound(10) };
    const enabled = enableYouthCompetition(final);
    expect(getYouthFixtures(enabled)).toHaveLength(3);
    expect(getYouthFixtures(enabled).every(fixture => fixture.round === 10 && fixture.date === final.date)).toBe(true);
    expect(enabled.activeMatch).toBe(final.activeMatch);
    expect(enabled.training).toBe(final.training);
    expect(enabled.finance).toBe(final.finance);
    expect(enableYouthCompetition(enabled)).toBe(enabled);
    expect(() => enableYouthCompetition({ ...old, status: 'complete' })).toThrow(/active season/);
    expect(() => enableYouthCompetition({ ...old, academy: { ...old.academy, enabledSince: null } })).toThrow(/academy/);
    expect(processYouthRound(old)).toBe(old);
  });

  it('records the actual independent engine result, stable jerseys and real court exposure without free development', () => {
    const fixture = getYouthFixtures(initial)[0]!, prepared = prepareYouthFixture(initial, fixture);
    const engine = simulateToEnd(createFixtureMatch(youthFixtureSeed(initial.seed, fixture.id), prepared.home, prepared.away, { lineups: prepared.lineups, conditions: prepared.startingConditions, preExistingInjuries: prepared.unavailable, injuryMode: 'off', autoSubstitutions: { home: true, away: true } }));
    const recorded = getYouthFixtures(played)[0]!;
    expect(recorded.result!.stats).toEqual(engine.stats);
    expect(recorded.result!.score).toEqual(engine.score);
    expect(recorded.result!.officialScore).toEqual(engine.result!.officialScore);
    expect(recorded.result!.winnerClubId).toBe(engine[engine.result!.winner].id);
    for (const team of [recorded.home!, recorded.away!]) {
      expect(new Set(team.players.map(player => player.number)).size).toBe(team.players.length);
      const seconds = team.players.reduce((sum, player) => sum + recorded.result!.stats[player.id]!.secondsPlayed, 0);
      expect(seconds).toBe(5 * (2400 + (recorded.result!.periods - 4) * 300));
    }
    expect(played.academy).toBe(initial.academy);
    expect(played.injuries).toBe(initial.injuries);
    expect(played.conditions).toBe(initial.conditions);
    expect(played.activeMatch).toBe(initial.activeMatch);
    expect(initial.youthCompetition.seasons[0]!.fixtures.every(fixture => fixture.result === null)).toBe(true);
    expect(processYouthRound(played)).toBe(played);
    expect(() => settleYouthFixture(played, recorded)).toThrow(/only once/);
  });

  it('records an honest 20–0 forfeit or no-contest when promotions or injuries leave fewer than five', () => {
    const fixture = getYouthFixtures(initial)[0]!;
    const reduce = (both: boolean) => ({ ...initial, academy: { ...initial.academy, prospects: initial.academy.prospects.filter(prospect => ![fixture.homeClubId, ...(both ? [fixture.awayClubId] : [])].includes(prospect.clubId) || initial.academy.prospects.filter(peer => peer.clubId === prospect.clubId).slice(0, 4).some(peer => peer.player.id === prospect.player.id)) } });
    const one = settleYouthFixture(reduce(false), fixture), both = settleYouthFixture(reduce(true), fixture);
    expect(one.result).toMatchObject({ played: false, kind: 'default', score: { home: 0, away: 20 }, winnerClubId: fixture.awayClubId, periods: 0, stats: {}, injuries: [] });
    expect(both.result).toMatchObject({ played: false, kind: 'no-contest', score: { home: 0, away: 0 }, winnerClubId: null, periods: 0, stats: {}, injuries: [] });
    const context = (entry: typeof one) => ({ ...initial, youthCompetition: { ...initial.youthCompetition, seasons: [{ ...initial.youthCompetition.seasons[0]!, fixtures: [entry] }] } });
    expect(getYouthStandings(context(one)).find(row => row.clubId === fixture.awayClubId)).toMatchObject({ played: 1, wins: 1, losses: 0, pointsFor: 20 });
    expect(getYouthStandings(context(both)).every(row => row.played === 0 && row.wins === 0 && row.losses === 0)).toBe(true);
    expect(getYouthPlayerPerformance(context(one), one.home!.players[0]!.id)).toEqual({ appearances: 0, secondsPlayed: 0, points: 0, rebounds: 0, assists: 0 });
  });

  it('derives condition from actual match workload and applies recovery only once per calendar day', () => {
    const fixture = getYouthFixtures(played)[0]!, id = fixture.home!.players.find(player => fixture.result!.stats[player.id]!.condition < 90)!.id;
    const condition = fixture.result!.stats[id]!.condition;
    expect(getYouthPlayerStatus(played, id, fixture.date).condition).toBe(condition);
    expect(getYouthPlayerStatus(played, id, dateForRound(2)).condition).toBe(Math.min(100, Math.round((condition + 7) * 1000) / 1000));
    expect(getYouthPlayerStatus(played, id, dateForRound(2)).condition).toBe(getYouthPlayerStatus(played, id, dateForRound(2)).condition);
    expect(getYouthPlayerStatus(played, id, '2027-09-04').condition).toBe(100);
    expect(getYouthPlayerStatus(played, id, fixture.date, fixture.id).condition).toBe(100);
    const hidden = youthCompetitionAtBoundary(played.youthCompetition, 1, 1);
    expect(hidden.seasons[0]!.fixtures.every(fixture => fixture.result === null)).toBe(true);
    expect(getYouthPlayerStatus({ ...played, youthCompetition: hidden }, id, fixture.date).condition).toBe(100);
    expect(youthCompetitionAtBoundary(played.youthCompetition, 1, 1, true)).toEqual(played.youthCompetition);
    expect(getYouthPlayerStatus(create(false), id)).toEqual({ playerId: id, condition: 100, available: true, injury: null, returnOn: null });
  });

  it('reduces practice for real dated unavailability and keeps its recovery separate from senior health', () => {
    const fixture = getYouthFixtures(played)[0]!, id = fixture.home!.players[0]!.id;
    const injury = { id: `${fixture.id}:${id}`, playerId: id, clubId: fixture.homeClubId, kind: 'ankle' as const, fixtureId: fixture.id, occurredOn: fixture.date, returnOn: dateForRound(2) };
    const medical = { ...played, youthCompetition: { ...played.youthCompetition, seasons: played.youthCompetition.seasons.map(season => ({ ...season, fixtures: season.fixtures.map(entry => entry.id === fixture.id ? { ...entry, result: { ...entry.result!, injuries: [injury] } } : entry) })) } };
    const trained = processAcademyWeek(week(medical)), report = trained.weeks[0]!.players[id]!;
    expect(report.availability).toMatchObject({ availableDays: 1, conditionBefore: fixture.result!.stats[id]!.condition });
    expect(Object.values(report.gains).reduce((sum, gain) => sum + gain, 0)).toBe(4);
    expect(report.availability!.conditionAfter).toBe(Math.min(100, Math.round((fixture.result!.stats[id]!.condition + 19) * 1000) / 1000));
    expect(getYouthPlayerStatus(medical, id, fixture.date).injury).toEqual(injury);
    expect(getYouthPlayerStatus(medical, id, dateForRound(2)).injury).toBeNull();
    expect(medical.injuries).toBe(initial.injuries);
    const noYouth = processAcademyWeek({ ...week(medical), youthCompetition: createYouthCompetition() });
    expect(noYouth.weeks[0]!.players[id]!.availability).toBeUndefined();
    expect(Object.values(noYouth.weeks[0]!.players[id]!.gains).reduce((sum, gain) => sum + gain, 0)).toBe(28);
  });

  it('retains recorded identities and statistics after later training and rejects skipped matchdays', () => {
    const fixture = getYouthFixtures(played)[0]!, teams = getYouthFixtureTeams(fixture)!;
    const trained = processAcademyWeek(week(played));
    const advanced = { ...played, academy: trained, round: 2, date: dateForRound(2) };
    const next = processYouthRound(advanced);
    expect(getYouthFixtureTeams(getYouthFixtures(next)[0]!)).toEqual(teams);
    const id = teams.home.players.find(player => fixture.result!.stats[player.id]!.secondsPlayed > 0)!.id;
    expect(getYouthPlayerPerformance(played, id)).toMatchObject({ appearances: 1, secondsPlayed: fixture.result!.stats[id]!.secondsPlayed, points: fixture.result!.stats[id]!.points });
    expect(getYouthStandings(played).reduce((sum, row) => sum + row.wins, 0)).toBe(3);
    expect(() => processYouthRound({ ...initial, round: 2, date: dateForRound(2) })).toThrow(/calendar order/);
    expect(getClubAcademy(next)).toHaveLength(8);
    expect(next.academy.intakes).toBe(initial.academy.intakes);
  });
});
