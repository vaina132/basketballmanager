import { describe, expect, it } from 'vitest';
import type { FixtureResult, SeasonState } from '../src/domain/season';
import type { PlayerStats } from '../src/domain/types';
import { setAutoSubstitutions, simulateToEnd, stepMatch } from '../src/engine/match';
import { getSeasonPerformance, isQualifiedLeader, leaderQualificationThreshold, LEADER_QUALIFICATION_TEXT, performanceValue, sortPerformance } from '../src/world/performance';
import type { PerformanceMetric, PerformanceMode, SeasonPlayerPerformance } from '../src/world/performance';
import { advanceSeason, createSeason, managedSide, rolloverSeason } from '../src/world/season';
import { rosterForRound } from '../src/world/rosters';

function stats(change: Partial<PlayerStats> = {}): PlayerStats {
  const value: PlayerStats = { secondsPlayed: 0, points: 0, fieldGoalsMade: 0, fieldGoalsAttempted: 0, threePointersMade: 0, threePointersAttempted: 0, freeThrowsMade: 0, freeThrowsAttempted: 0, rebounds: 0, assists: 0, steals: 0, blocks: 0, turnovers: 0, fouls: 0, condition: 100, ...change };
  if (change.points === undefined) value.points = 2 * value.fieldGoalsMade + value.threePointersMade + value.freeThrowsMade;
  return value;
}

function commit(state: SeasonState, round: number, changes: Record<string, Partial<PlayerStats>>, overrides: Partial<FixtureResult> = {}): SeasonState {
  const club = state.clubs[0]!;
  const fixture = state.fixtures.find(fixture => fixture.round === round && [fixture.homeClubId, fixture.awayClubId].includes(club.id))!;
  const home = state.clubs.find(team => team.id === fixture.homeClubId)!, away = state.clubs.find(team => team.id === fixture.awayClubId)!;
  const records = Object.fromEntries([...home.players, ...away.players].map(player => [player.id, stats(changes[player.id])]));
  const score = { home: home.players.reduce((sum, player) => sum + records[player.id]!.points, 0), away: away.players.reduce((sum, player) => sum + records[player.id]!.points, 0) };
  const result: FixtureResult = { score, officialScore: { ...score }, winnerClubId: score.home >= score.away ? home.id : away.id, kind: 'normal', periods: 4, stats: records, injuries: {}, rosterIds: { home: rosterForRound(state.rosters, home.id, round).id, away: rosterForRound(state.rosters, away.id, round).id }, ...overrides };
  return { ...state, fixtures: state.fixtures.map(item => item.id === fixture.id ? { ...item, result } : item) };
}

function playerRow(state: SeasonState, playerId = state.clubs[0]!.players[0]!.id): SeasonPlayerPerformance {
  return getSeasonPerformance(state).find(row => row.player.id === playerId)!;
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

describe('committed current-season performance', () => {
  it('includes every roster player with no invented appearances or undefined averages', () => {
    const state = createSeason(), rows = getSeasonPerformance(state);
    expect(rows).toHaveLength(60);
    expect(new Set(rows.map(row => row.player.id)).size).toBe(60);
    for (const row of rows) {
      expect(row.games).toBe(0); expect(row.clubGames).toBe(0); expect(row.log).toEqual([]);
      expect(Object.values(row.totals).every(value => value === 0)).toBe(true);
      expect(row.totals).not.toHaveProperty('condition');
      expect(isQualifiedLeader(row)).toBe(false);
      for (const mode of ['totals', 'per-game', 'per-40'] as const) {
        expect(performanceValue(row, 'games', mode)).toBe(0);
        expect(performanceValue(row, 'points', mode)).toBe(mode === 'totals' ? 0 : null);
        expect(performanceValue(row, 'minutes', mode)).toBe(mode === 'totals' ? 0 : null);
        expect(performanceValue(row, 'fgPercent', mode)).toBeNull();
      }
    }
  });

  it('excludes a finished but uncommitted match and includes a partially committed fixture list exactly once', () => {
    const initial = createSeason(4, undefined, 'off', false);
    const pending = { ...initial, activeMatch: simulateToEnd(setAutoSubstitutions(initial.activeMatch, managedSide(initial), true)) };
    expect(pending.activeMatch.status).toBe('finished');
    expect(getSeasonPerformance(pending).every(row => row.clubGames === 0 && row.games === 0)).toBe(true);
    const id = initial.clubs[0]!.players[0]!.id;
    const partial = commit(pending, 1, { [id]: { secondsPlayed: 600, fieldGoalsMade: 3, fieldGoalsAttempted: 6 } });
    const rows = getSeasonPerformance(partial);
    expect(rows.filter(row => row.clubGames === 1)).toHaveLength(20);
    expect(rows.filter(row => row.clubGames === 0)).toHaveLength(40);
    expect(playerRow(partial).totals.points).toBe(6);
    expect(playerRow(partial).games).toBe(1);
  });

  it('distinguishes played injuries, unavailable absences, DNP and non-time statistical appearances', () => {
    const initial = createSeason(), [played, injured, dnp, foulOnly] = initial.clubs[0]!.players;
    const state = commit(initial, 1, {
      [played!.id]: { secondsPlayed: 90, fieldGoalsMade: 1, fieldGoalsAttempted: 1 },
      [injured!.id]: { condition: 35 }, [dnp!.id]: { condition: 61 }, [foulOnly!.id]: { fouls: 1 },
    }, { injuries: { [played!.id]: 'ankle', [injured!.id]: 'muscle' } });
    expect(playerRow(state, played!.id)).toMatchObject({ games: 1, clubGames: 1, log: [{ participation: 'played' }] });
    expect(playerRow(state, injured!.id)).toMatchObject({ games: 0, clubGames: 1, log: [{ participation: 'injured' }] });
    expect(playerRow(state, dnp!.id)).toMatchObject({ games: 0, clubGames: 1, log: [{ participation: 'dnp' }] });
    const zeroTime = playerRow(state, foulOnly!.id);
    expect(zeroTime).toMatchObject({ games: 1, log: [{ participation: 'played' }] });
    expect(performanceValue(zeroTime, 'minutes', 'per-40')).toBe(0);
    expect(performanceValue(zeroTime, 'points', 'per-game')).toBe(0);
    expect(performanceValue(zeroTime, 'points', 'per-40')).toBeNull();
  });

  it('uses combined shooting attempts and actual playing time for every display mode', () => {
    let state = createSeason();
    const id = state.clubs[0]!.players[0]!.id;
    state = commit(state, 1, { [id]: { secondsPlayed: 1200, fieldGoalsMade: 1, fieldGoalsAttempted: 1, rebounds: 4, assists: 3, steals: 1, blocks: 1, turnovers: 2 } });
    state = commit(state, 2, { [id]: { secondsPlayed: 1800, fieldGoalsMade: 1, fieldGoalsAttempted: 9, threePointersMade: 1, threePointersAttempted: 4, freeThrowsMade: 1, freeThrowsAttempted: 2, rebounds: 6, assists: 5, steals: 2, blocks: 1, turnovers: 3 } });
    const row = playerRow(state);
    expect(row.games).toBe(2);
    const expected: Record<PerformanceMetric, [number, number, number]> = {
      games: [2, 2, 2], minutes: [50, 25, 25], points: [6, 3, 4.8], rebounds: [10, 5, 8], assists: [8, 4, 6.4],
      steals: [3, 1.5, 2.4], blocks: [2, 1, 1.6], turnovers: [5, 2.5, 4], fgPercent: [20, 20, 20], threePercent: [25, 25, 25], ftPercent: [50, 50, 50],
    };
    const modes: PerformanceMode[] = ['totals', 'per-game', 'per-40'];
    for (const [metric, values] of Object.entries(expected)) modes.forEach((mode, index) => expect(performanceValue(row, metric as PerformanceMetric, mode)).toBeCloseTo(values[index]!));
    expect(performanceValue(row, 'fgPercent', 'per-game')).not.toBeCloseTo((100 + 100 / 9) / 2);
  });

  it('reports overtime per 40 minutes using exposure rather than the scheduled period count', () => {
    const initial = createSeason(), id = initial.clubs[0]!.players[0]!.id;
    const state = commit(initial, 1, { [id]: { secondsPlayed: 2700, fieldGoalsMade: 9, fieldGoalsAttempted: 18, threePointersMade: 2, threePointersAttempted: 5 } }, { periods: 5 });
    const row = playerRow(state);
    expect(row.log[0]!.periods).toBe(5);
    expect(performanceValue(row, 'points', 'totals')).toBe(20);
    expect(performanceValue(row, 'points', 'per-40')).toBeCloseTo(20 * 40 / 45);
    expect(performanceValue(row, 'minutes', 'per-40')).toBe(45);
  });

  it('retains earned personal points while game logs use awarded scores and the official winner', () => {
    const initial = createSeason(), fixture = initial.fixtures[0]!;
    const home = initial.clubs.find(club => club.id === fixture.homeClubId)!, away = initial.clubs.find(club => club.id === fixture.awayClubId)!;
    const state = commit(initial, 1, { [home.players[0]!.id]: { secondsPlayed: 600, fieldGoalsMade: 9, fieldGoalsAttempted: 10, freeThrowsMade: 1, freeThrowsAttempted: 1 }, [away.players[0]!.id]: { secondsPlayed: 600, fieldGoalsMade: 11, fieldGoalsAttempted: 12 } }, { kind: 'default', periods: 2, officialScore: { home: 2, away: 0 }, winnerClubId: home.id });
    const winner = playerRow(state, home.players[0]!.id), loser = playerRow(state, away.players[0]!.id);
    expect(winner.totals.points).toBe(19);
    expect(winner.log[0]).toMatchObject({ home: true, opponentClubId: away.id, result: 'W', teamScore: 2, opponentScore: 0, kind: 'default', periods: 2, stats: { points: 19 } });
    expect(loser.log[0]).toMatchObject({ home: false, opponentClubId: home.id, result: 'L', teamScore: 0, opponentScore: 2, stats: { points: 22 } });
  });

  it('orders logs newest first independently of fixture storage order and never mutates state or RNG', () => {
    let state = createSeason(), id = state.clubs[0]!.players[0]!.id;
    state = commit(state, 1, { [id]: { secondsPlayed: 600, fieldGoalsMade: 1, fieldGoalsAttempted: 1 } });
    state = commit(state, 3, { [id]: { secondsPlayed: 900, fieldGoalsMade: 3, fieldGoalsAttempted: 5 } });
    state = commit(state, 2, { [id]: { secondsPlayed: 700, fieldGoalsMade: 2, fieldGoalsAttempted: 3 } });
    const original = freeze(state), before = structuredClone(original);
    const rows = getSeasonPerformance(original), reversed = getSeasonPerformance({ ...original, fixtures: [...original.fixtures].reverse() });
    expect(rows).toEqual(reversed);
    expect(rows.find(row => row.player.id === id)!.log.map(log => log.round)).toEqual([3, 2, 1]);
    expect(original).toEqual(before);
    expect(stepMatch(original.activeMatch)).toEqual(stepMatch(before.activeMatch));
    const row = rows.find(row => row.player.id === id)!;
    row.log[0]!.stats.points = 999; row.totals.points = 999;
    expect(original).toEqual(before);
  });

  it('starts fresh after rollover and excludes archived scores from player statistics', () => {
    let state = createSeason(6, undefined, 'off', false);
    while (state.status !== 'complete') {
      const activeMatch = state.activeMatch.status === 'finished' ? state.activeMatch : simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true));
      state = advanceSeason({ ...state, activeMatch });
    }
    const completed = getSeasonPerformance(state);
    expect(completed.every(row => row.clubGames === 10 && row.log.length === 10)).toBe(true);
    expect(completed.reduce((sum, row) => sum + row.totals.points, 0)).toBe(state.fixtures.reduce((sum, fixture) => sum + fixture.result!.score.home + fixture.result!.score.away, 0));
    const next = rolloverSeason(state);
    expect(next.history).toHaveLength(1);
    expect(getSeasonPerformance(next).every(row => row.clubGames === 0 && row.games === 0 && row.totals.points === 0 && row.log.length === 0)).toBe(true);
  }, 30_000);
});

describe('performance ordering and leader qualification', () => {
  it('sorts values without mutation, keeps nulls last and resolves ties by locale-independent identity', () => {
    const base = playerRow(createSeason());
    const row = (name: string, id: string, points: number, games = 1, clubId = 'club'): SeasonPlayerPerformance => ({ ...base, player: { ...base.player, name, id }, club: { ...base.club, id: clubId }, games, totals: { ...base.totals, points, secondsPlayed: games * 600 } });
    const original = freeze([row('Zed', 'p-b', 2), row('Zed', 'p-a', 2, 1, 'z'), row('Zed', 'p-a', 2, 1, 'a'), row('Ada', 'p-c', 10), row('Aardvark', 'p-null', 0, 0), row('\u00c1da', 'p-d', 2)]);
    const before = structuredClone(original), ascending = sortPerformance(original, 'points', 'per-game', 'asc'), descending = sortPerformance(original, 'points', 'per-game', 'desc');
    expect(ascending.map(row => `${row.player.id}/${row.club.id}`)).toEqual(['p-a/a', 'p-a/z', 'p-b/club', 'p-d/club', 'p-c/club', 'p-null/club']);
    expect(descending.map(row => row.player.id)).toEqual(['p-c', 'p-a', 'p-a', 'p-b', 'p-d', 'p-null']);
    expect(original).toEqual(before);
    expect(ascending).not.toBe(original);
    expect(sortPerformance([...original].reverse(), 'points', 'per-game', 'asc')).toEqual(ascending);
  });

  it('requires appearances in half the club games and five total minutes per club game', () => {
    const base = playerRow(createSeason());
    expect(LEADER_QUALIFICATION_TEXT).toMatch(/half.*5 minutes/);
    expect(leaderQualificationThreshold({ clubGames: 5 })).toEqual({ games: 3, minutes: 25 });
    const eligible = { ...base, clubGames: 5, games: 3, totals: { ...base.totals, secondsPlayed: 1500 } };
    expect(isQualifiedLeader(eligible)).toBe(true);
    expect(isQualifiedLeader({ ...eligible, games: 2 })).toBe(false);
    expect(isQualifiedLeader({ ...eligible, totals: { ...eligible.totals, secondsPlayed: 1499 } })).toBe(false);
    expect(isQualifiedLeader({ ...eligible, clubGames: 0 })).toBe(false);
    expect(isQualifiedLeader({ ...eligible, clubGames: 6, totals: { ...eligible.totals, secondsPlayed: 1800 } })).toBe(true);
    expect(isQualifiedLeader({ ...eligible, clubGames: 7, totals: { ...eligible.totals, secondsPlayed: 2100 } })).toBe(false);
  });
});
