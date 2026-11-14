import { beforeAll, describe, expect, it } from 'vitest';
import type { FixtureResult, SeasonFixture, SeasonState } from '../src/domain/season';
import type { PlayerStats } from '../src/domain/types';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { getPerformanceCoverage, getSeasonPerformance, performanceRecordKey } from '../src/world/performance';
import { getFixtureTeams, rosterForRound } from '../src/world/rosters';
import { advanceSeason, createSeason, managedSide, rolloverSeason } from '../src/world/season';

let completed: SeasonState, nextYear: SeasonState;
beforeAll(() => {
  completed = createSeason(19, undefined, 'off');
  while (completed.status !== 'complete') completed = advanceSeason({ ...completed, activeMatch: simulateToEnd(setAutoSubstitutions(completed.activeMatch, managedSide(completed), true)) });
  nextYear = rolloverSeason(completed);
}, 30_000);

const emptyStats = (): PlayerStats => ({ secondsPlayed: 0, points: 0, fieldGoalsMade: 0, fieldGoalsAttempted: 0, threePointersMade: 0, threePointersAttempted: 0, freeThrowsMade: 0, freeThrowsAttempted: 0, rebounds: 0, assists: 0, steals: 0, blocks: 0, turnovers: 0, fouls: 0, condition: 100 });
function record(state: SeasonState, fixture: SeasonFixture, scorer?: string): FixtureResult {
  const home = rosterForRound(state.rosters, fixture.homeClubId, fixture.round), away = rosterForRound(state.rosters, fixture.awayClubId, fixture.round);
  const stats = Object.fromEntries([...home.players, ...away.players].map(player => [player.id, emptyStats()]));
  if (scorer) Object.assign(stats[scorer]!, { secondsPlayed: 60, points: 2, fieldGoalsMade: 1, fieldGoalsAttempted: 1 });
  const score = { home: home.players.reduce((sum, player) => sum + stats[player.id]!.points, 0), away: away.players.reduce((sum, player) => sum + stats[player.id]!.points, 0) };
  return { score, officialScore: score, winnerClubId: score.home >= score.away ? home.clubId : away.clubId, periods: 4, kind: 'normal', stats, injuries: {}, rosterIds: { home: home.id, away: away.id } };
}

describe('historical performance and roster attribution', () => {
  it('retains exact season statistics and manager match detail after rollover', () => {
    expect(getPerformanceCoverage(nextYear, 1)).toBe('complete');
    const before = getSeasonPerformance(completed), after = getSeasonPerformance(nextYear, 1);
    const totals = (rows: typeof before) => rows.map(({ log, summaryGames, ...row }) => row);
    expect(totals(after)).toEqual(totals(before));
    expect(after.filter(row => row.club.id === completed.managedClubId)).toEqual(before.filter(row => row.club.id === completed.managedClubId));
    expect(getSeasonPerformance(nextYear).every(row => row.games === 0 && row.log.length === 0)).toBe(true);
    for (const fixture of nextYear.history[0]!.fixtures) {
      if ([fixture.homeClubId, fixture.awayClubId].includes(completed.managedClubId)) expect(fixture.result).toEqual(completed.fixtures.find(row => row.id === fixture.id)!.result);
      else { expect(fixture.result.stats).toBeNull(); expect(fixture.result.appearances).toBeDefined(); }
    }
    expect(getFixtureTeams(nextYear, nextYear.history[0]!.fixtures[0]!, 1)).toEqual(getFixtureTeams(completed, completed.fixtures[0]!));
  });

  it('does not rewrite historical identity or ownership when present squads change', () => {
    const original = getSeasonPerformance(nextYear, 1);
    const changed = structuredClone(nextYear), [oldClub, newClub] = changed.clubs;
    const moved = oldClub!.players[0]!;
    changed.clubs = changed.clubs.map(club => club.id === oldClub!.id ? { ...club, players: club.players.slice(1) } : club.id === newClub!.id ? { ...club, players: [...club.players, { ...moved, name: 'Current name', number: 99 }] } : club);
    expect(getSeasonPerformance(changed, 1)).toEqual(original);
    expect(getFixtureTeams(changed, changed.history[0]!.fixtures[0]!, 1)).toEqual(getFixtureTeams(nextYear, nextYear.history[0]!.fixtures[0]!, 1));
  });

  it('keeps two club stints separate and never adds pre-joining or post-departure DNP records', () => {
    const state = createSeason(12, undefined, 'off');
    const [oldClub, newClub] = state.clubs;
    const moved = oldClub!.players[0]!;
    const oldFirst = state.fixtures.find(fixture => fixture.round === 1 && [fixture.homeClubId, fixture.awayClubId].includes(oldClub!.id))!;
    const newFirst = state.fixtures.find(fixture => fixture.round === 1 && [fixture.homeClubId, fixture.awayClubId].includes(newClub!.id))!;
    oldFirst.result = record(state, oldFirst, moved.id);
    if (newFirst !== oldFirst) newFirst.result = record(state, newFirst);
    state.rosters.push(
      { id: 'old-r2', clubId: oldClub!.id, fromRound: 2, players: oldClub!.players.slice(1) },
      { id: 'new-r2', clubId: newClub!.id, fromRound: 2, players: [...newClub!.players, { ...moved, number: 99 }] },
    );
    const fixture = state.fixtures.find(item => item.round === 2 && [item.homeClubId, item.awayClubId].includes(newClub!.id))!;
    fixture.result = record(state, fixture, moved.id);
    const stints = getSeasonPerformance(state).filter(row => row.player.id === moved.id);
    expect(stints).toHaveLength(2);
    expect(new Set(stints.map(row => row.key)).size).toBe(2);
    const previous = stints.find(row => row.club.id === oldClub!.id)!, current = stints.find(row => row.club.id === newClub!.id)!;
    expect(previous.key).toBe(performanceRecordKey(1, oldClub!.id, moved.id));
    expect(previous.player.number).toBe(moved.number);
    expect(previous.log.map(game => game.fixtureId)).toEqual([oldFirst.id]);
    expect(current.player.number).toBe(99);
    expect(current.log.map(game => game.fixtureId)).toEqual([fixture.id]);
    expect(current.clubGames).toBe(2); // Qualification still uses all completed club games.
    expect(previous.totals.points + current.totals.points).toBe(4);
  });

  it('reports unavailable legacy statistics without inventing zero rows or erasing team scores', () => {
    const legacy = structuredClone(nextYear);
    const scores = legacy.history[0]!.fixtures.map(fixture => fixture.result.officialScore);
    delete legacy.history[0]!.summary;
    for (const fixture of legacy.history[0]!.fixtures) { fixture.result.stats = null; delete fixture.result.appearances; }
    expect(getPerformanceCoverage(legacy, 1)).toBe('unavailable');
    expect(getSeasonPerformance(legacy, 1)).toEqual([]);
    expect(legacy.history[0]!.fixtures.map(fixture => fixture.result.officialScore)).toEqual(scores);
    expect(getPerformanceCoverage(legacy)).toBe('complete');
  });

  it('rejects unknown years and leaves current data and historical RNG untouched', () => {
    const before = structuredClone(nextYear);
    expect(() => getSeasonPerformance(nextYear, 3)).toThrow();
    expect(() => getPerformanceCoverage(nextYear, 0)).toThrow();
    const rows = getSeasonPerformance(nextYear, 1);
    rows[0]!.totals.points = 99999;
    rows[0]!.log[0]!.stats.points = 99999;
    expect(nextYear).toEqual(before);
  });
});
