import { describe, expect, it } from 'vitest';
import type { SeasonFixture, SeasonState } from '../src/domain/season';
import type { MatchState, PlayerStats, Side } from '../src/domain/types';
import { DEVELOPMENT_CLUBS, DEVELOPMENT_START_DATE } from '../src/data/development-league';
import { FICTIONAL_AWAY, FICTIONAL_HOME } from '../src/data/fictional-teams';
import { createFixtureMatch, createMatch, setAutoSubstitutions, setTactics, simulateToEnd, simulateToQuarterEnd, stepMatch } from '../src/engine/match';
import { advanceSeason, createSchedule, createSeason, DAILY_RECOVERY, dateForRound, fixtureSeed, getActiveFixture, getStandings, managedSide, ROUND_INTERVAL_DAYS } from '../src/world/season';

const sides: Side[] = ['home', 'away'];
function finishCurrent(state: SeasonState): SeasonState {
  return { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) };
}
function sum(match: MatchState, side: Side, stat: keyof PlayerStats): number {
  return match[side].players.reduce((total, player) => total + match.stats[player.id]![stat], 0);
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze); Object.freeze(value);
  }
  return value;
}

describe('development league schedule and initialization', () => {
  it('creates thirty distinct home/away fixtures without club or date conflicts', () => {
    const fixtures = createSchedule();
    expect(fixtures).toHaveLength(30);
    expect(new Set(fixtures.map(fixture => fixture.id)).size).toBe(30);
    expect(fixtures[0]!.date).toBe(DEVELOPMENT_START_DATE);
    expect(fixtures.at(-1)!.date).toBe('2026-11-07');
    for (let round = 1; round <= 10; round += 1) {
      const games = fixtures.filter(fixture => fixture.round === round);
      expect(games).toHaveLength(3);
      expect(new Set(games.flatMap(fixture => [fixture.homeClubId, fixture.awayClubId])).size).toBe(6);
      expect(new Set(games.map(fixture => fixture.date))).toEqual(new Set([dateForRound(round)]));
    }
    for (const club of DEVELOPMENT_CLUBS) {
      expect(fixtures.filter(fixture => fixture.homeClubId === club.id)).toHaveLength(5);
      expect(fixtures.filter(fixture => fixture.awayClubId === club.id)).toHaveLength(5);
      for (const opponent of DEVELOPMENT_CLUBS.filter(candidate => candidate.id !== club.id)) {
        expect(fixtures.filter(fixture => fixture.homeClubId === club.id && fixture.awayClubId === opponent.id)).toHaveLength(1);
      }
    }
  });

  it('initializes any of the six clubs with correct home/away control and unique identities', () => {
    expect(new Set(DEVELOPMENT_CLUBS.flatMap(club => club.players.map(player => player.id))).size).toBe(60);
    for (const club of DEVELOPMENT_CLUBS) {
      const state = createSeason(12, club.id), side = managedSide(state), opponent = side === 'home' ? 'away' : 'home';
      expect(state.activeMatch[side].id).toBe(club.id);
      expect(state.activeMatch.autoSubstitutions[side]).toBe(false);
      expect(state.activeMatch.autoSubstitutions[opponent]).toBe(true);
      expect(state.activeMatch.injuryMode).toBe('off');
      expect(state.activeMatch.seed).toBe(fixtureSeed(12, getActiveFixture(state).id));
      expect(state.activeMatch.status).toBe('ready');
      expect(Object.values(state.conditions).every(condition => condition === 100)).toBe(true);
      expect(getStandings(state).every(row => row.played === 0 && row.wins === 0)).toBe(true);
    }
  });

  it('uses stable fixture seeds independent of traversal order and rejects invalid setup', () => {
    const fixtures = createSchedule();
    const seeds = Object.fromEntries(fixtures.map(fixture => [fixture.id, fixtureSeed(96, fixture.id)]));
    expect(new Set(Object.values(seeds)).size).toBe(30);
    expect(Object.fromEntries([...fixtures].reverse().map(fixture => [fixture.id, fixtureSeed(96, fixture.id)]))).toEqual(seeds);
    expect(fixtureSeed(97, fixtures[0]!.id)).not.toBe(seeds[fixtures[0]!.id]);
    expect(() => createSeason(-1)).toThrow(/seed/);
    expect(() => createSeason(3, 'missing-club')).toThrow(/club/);
    expect(() => createSchedule(DEVELOPMENT_CLUBS.slice(0, 5))).toThrow(/six/);
    expect(() => dateForRound(11)).toThrow(/round/);
  });
});

describe('generic match construction', () => {
  it('leaves the default exhibition state exactly equal to the generic modern factory', () => {
    expect(createFixtureMatch(42, FICTIONAL_HOME, FICTIONAL_AWAY)).toEqual(createMatch(42));
  });

  it('accepts club preparation while resetting every match counter and isolating instructions', () => {
    const home = DEVELOPMENT_CLUBS[2]!, away = DEVELOPMENT_CLUBS[4]!;
    const lineup = home.players.slice(5).map(player => player.id);
    const conditions = Object.fromEntries([...home.players, ...away.players].map(player => [player.id, 61]));
    const match = createFixtureMatch(91, home, away, { lineups: { home: lineup }, conditions, tactics: { away: { tempo: .8, outsideShare: .7, pressure: .2 } }, autoSubstitutions: { home: true, away: false }, injuryMode: 'off' });
    expect(match.lineups.home).toEqual(lineup);
    expect(match.tactics.away).toEqual({ tempo: .8, outsideShare: .7, pressure: .2 });
    expect(Object.values(match.stats).every(stats => stats.condition === 61 && stats.fouls === 0 && stats.secondsPlayed === 0 && stats.points === 0)).toBe(true);
    expect(match.home.id).toBe(home.id); expect(match.away.id).toBe(away.id);
    expect(() => createFixtureMatch(91, home, home)).toThrow(/different/);
    expect(() => createFixtureMatch(91, home, away, { lineups: { home: [home.players[0]!.id] } })).toThrow(/five/);
    expect(() => createFixtureMatch(91, home, away, { conditions: { unknown: 100 } })).toThrow(/condition/);
  });
});

describe('atomic season progression', () => {
  it('refuses an unfinished or critical match without advancing its date', () => {
    const state = createSeason(42);
    expect(() => advanceSeason(state)).toThrow(/Finish/);
    const critical = { ...state, activeMatch: { ...state.activeMatch, requiredSubstitutions: [{ side: managedSide(state), playerId: state.activeMatch.lineups[managedSide(state)][0]!, reason: 'fouled-out' as const }] } };
    expect(() => advanceSeason(critical)).toThrow(/Finish/);
    expect(state.date).toBe(DEVELOPMENT_START_DATE);
    expect(state.fixtures.every(fixture => fixture.result === null)).toBe(true);
  });

  it('commits one whole round immutably, carries plans and recovers everyone exactly once', () => {
    let state = createSeason(23, DEVELOPMENT_CLUBS[1]!.id);
    const side = managedSide(state);
    expect(side).toBe('away');
    state = { ...state, activeMatch: setTactics(state.activeMatch, side, { tempo: .9, pressure: .85 }) };
    // Let the starters accumulate real fatigue before allowing the assistant to
    // resolve a late foul-out; next week must not simply reset everyone to 100.
    state = { ...state, activeMatch: simulateToEnd(state.activeMatch) };
    const completed = freeze(finishCurrent(state));
    const before = structuredClone(completed);
    const next = advanceSeason(completed);
    expect(completed).toEqual(before);
    expect(next.round).toBe(2); expect(next.date).toBe('2026-09-12');
    expect(next.fixtures.filter(fixture => fixture.result)).toHaveLength(3);
    expect(next.plans[state.managedClubId]!.tactics).toEqual(completed.activeMatch.tactics[side]);
    expect(next.activeMatch[managedSide(next)].id).toBe(state.managedClubId);
    expect(next.activeMatch.tactics[managedSide(next)]).toEqual(completed.activeMatch.tactics[side]);
    for (const fixture of next.fixtures.filter(fixture => fixture.round === 1)) {
      for (const [id, stats] of Object.entries(fixture.result!.stats)) {
        expect(next.conditions[id]).toBe(Math.min(100, Math.round((stats.condition + DAILY_RECOVERY * ROUND_INTERVAL_DAYS) * 1000) / 1000));
      }
    }
    expect(Object.values(next.activeMatch.stats).every(stats => stats.fouls === 0 && stats.secondsPlayed === 0 && stats.points === 0)).toBe(true);
    for (const [id, stats] of Object.entries(next.activeMatch.stats)) expect(stats.condition).toBe(next.conditions[id]);
    expect(next.activeMatch[managedSide(next)].players.some(player => next.conditions[player.id]! < 100)).toBe(true);
    expect(advanceSeason(completed)).toEqual(next);
    expect(() => advanceSeason(next)).toThrow(/Finish/);
    expect(next.fixtures.filter(fixture => fixture.result)).toHaveLength(3);
  });

  it('rejects already-posted fixture results without duplicating the standings', () => {
    const state = finishCurrent(createSeason(9));
    const advanced = advanceSeason(state);
    const inconsistent = { ...state, fixtures: advanced.fixtures };
    const standings = getStandings(inconsistent);
    expect(() => advanceSeason(inconsistent)).toThrow(/awaiting/);
    expect(getStandings(inconsistent)).toEqual(standings);
  });

  it('keeps watched, quarter-skipped and instant match results equivalent in the season', () => {
    const season = createSeason(88, DEVELOPMENT_CLUBS[3]!.id);
    const initial = setAutoSubstitutions(season.activeMatch, managedSide(season), true);
    let stepped = initial, quarters = initial;
    for (let count = 0; count < 5000 && stepped.status !== 'finished'; count += 1) stepped = stepMatch(stepped);
    for (let count = 0; count < 24 && quarters.status !== 'finished'; count += 1) quarters = simulateToQuarterEnd(quarters);
    const instant = simulateToEnd(initial);
    expect(stepped).toEqual(instant); expect(quarters).toEqual(instant);
    const continued = advanceSeason({ ...season, activeMatch: stepped });
    expect(advanceSeason({ ...season, activeMatch: instant })).toEqual(continued);
    for (const side of sides) expect(sum(instant, side, 'points')).toBe(instant.score[side]);
  }, 30_000);

  it('allows all six managed clubs to finish a season with conserved fixtures and statistics', () => {
    for (const club of DEVELOPMENT_CLUBS) {
      let state = createSeason(6, club.id);
      const seen = new Set<string>();
      const venues: Side[] = [];
      for (let round = 1; round <= 10; round += 1) {
        expect(state.round).toBe(round);
        expect(seen.has(state.activeFixtureId)).toBe(false);
        seen.add(state.activeFixtureId); venues.push(managedSide(state));
        state = advanceSeason(finishCurrent(state));
      }
      expect(state.status).toBe('complete');
      expect(state.activeMatch.status).toBe('finished');
      expect(state.fixtures.every(fixture => fixture.result)).toBe(true);
      expect(state.fixtures.filter(fixture => fixture.result)).toHaveLength(30);
      expect(venues.filter(side => side === 'home')).toHaveLength(5);
      expect(venues.filter(side => side === 'away')).toHaveLength(5);
      const table = getStandings(state);
      expect(table.every(row => row.played === 10 && row.wins + row.losses === 10)).toBe(true);
      expect(table.reduce((total, row) => total + row.wins, 0)).toBe(30);
      expect(table.reduce((total, row) => total + row.losses, 0)).toBe(30);
      expect(table.reduce((total, row) => total + row.pointsFor - row.pointsAgainst, 0)).toBe(0);
      for (const fixture of state.fixtures) {
        expect(Object.hasOwn(fixture.result!, 'events')).toBe(false);
        for (const side of sides) {
          const team = state.clubs.find(team => team.id === (side === 'home' ? fixture.homeClubId : fixture.awayClubId))!;
          expect(team.players.reduce((total, player) => total + fixture.result!.stats[player.id]!.points, 0)).toBe(fixture.result!.score[side]);
        }
      }
      for (const fixture of state.fixtures.filter(fixture => fixture.round === 10)) for (const [id, stats] of Object.entries(fixture.result!.stats)) expect(state.conditions[id]).toBe(stats.condition);
      expect(() => advanceSeason(state)).toThrow(/complete/);
    }
  }, 120_000);

  it('ranks equal records by the published point-difference and scoring rules with stable ties', () => {
    const state = createSeason(1);
    const fixtures: SeasonFixture[] = state.fixtures.slice(0, 3).map((fixture, index) => ({
      ...fixture,
      result: { score: { home: 80 + index * 10, away: 70 + index * 10 }, officialScore: { home: 80 + index * 10, away: 70 + index * 10 }, winnerClubId: fixture.homeClubId, kind: 'normal', periods: 4, stats: {} },
    }));
    const table = getStandings({ clubs: state.clubs, fixtures });
    expect(table.slice(0, 3).map(row => row.clubId)).toEqual([...fixtures].reverse().map(fixture => fixture.homeClubId));
    expect(getStandings(state).map(row => row.clubId)).toEqual(state.clubs.map(club => club.id).sort());
    fixtures[0]!.result!.officialScore = { home: 2, away: 0 };
    fixtures[0]!.result!.kind = 'default';
    const awarded = getStandings({ clubs: state.clubs, fixtures }).find(row => row.clubId === fixtures[0]!.homeClubId)!;
    expect(awarded.pointsFor).toBe(2); expect(awarded.pointsAgainst).toBe(0);
  });
});
