import { restoreSeniorDetail } from './helpers/senior-reference';
import { beforeAll, describe, expect, it } from 'vitest';
import { SEASON_SCHEMA_VERSION } from './helpers/season-format';
import type { RosterSnapshot } from '../src/domain/roster';
import type { SeasonState } from '../src/domain/season';
import { DEVELOPMENT_CLUBS } from '../src/data/development-league';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { createRosterSnapshots, getFixtureTeams, getSeasonRosterData, rosterForRound } from '../src/world/rosters';
import { advanceSeason, createSeason, getActiveFixture, managedSide, rolloverSeason } from '../src/world/season';
import { processTrainingWeek } from '../src/world/training';

function finish(state: SeasonState): SeasonState {
  return state.activeMatch!.status === 'finished' ? state : { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch!, managedSide(state), true)) };
}
function complete(initial: SeasonState): SeasonState {
  let state = initial;
  while (state.status !== 'complete') state = advanceSeason(finish(state));
  return state;
}

describe('immutable registration snapshots', () => {
  it('captures independent base identities once, with unique season-specific references', () => {
    const clubs = DEVELOPMENT_CLUBS.map(club => ({ ...club, players: club.players.map(player => ({ ...player, attributes: { ...player.attributes } })) }));
    const first = createRosterSnapshots(clubs, 1), later = createRosterSnapshots(clubs, 2);
    expect(first).toHaveLength(6);
    expect(new Set([...first, ...later].map(roster => roster.id)).size).toBe(12);
    expect(first[0]).toMatchObject({ id: `roster-s1-${clubs[0]!.id}-r1`, clubId: clubs[0]!.id, fromRound: 1, players: clubs[0]!.players });
    expect(first[0]!.players).not.toBe(clubs[0]!.players);
    expect(first[0]!.players[0]!.attributes).not.toBe(clubs[0]!.players[0]!.attributes);
    const identity = structuredClone(first[0]!.players[0]);
    clubs[0]!.players[0]!.name = 'Changed current identity';
    clubs[0]!.players[0]!.attributes.passing = 20;
    expect(first[0]!.players[0]).toEqual(identity);
    expect(() => createRosterSnapshots(clubs, 0)).toThrow(/season/);
    expect(() => createRosterSnapshots([clubs[0]!, clubs[0]!], 1)).toThrow(/distinct clubs/);
    expect(() => createRosterSnapshots([{ ...clubs[0]!, players: [clubs[0]!.players[0]!, clubs[0]!.players[0]!] }], 1)).toThrow(/two clubs/);
  });

  it('resolves the effective historical registration independently of array order', () => {
    const initial = createRosterSnapshots(DEVELOPMENT_CLUBS, 1), first = initial[0]!;
    const changed: RosterSnapshot = { ...first, id: `${first.id}-changed`, fromRound: 4, players: first.players.slice(1) };
    const rosters = [changed, ...initial].reverse();
    expect(rosterForRound(rosters, first.clubId, 3)).toBe(first);
    expect(rosterForRound(rosters, first.clubId, 4)).toBe(changed);
    expect(rosterForRound(rosters, first.clubId, 10)).toBe(changed);
    expect(() => rosterForRound(rosters, 'missing', 2)).toThrow(/no registered roster/);
    expect(() => rosterForRound(rosters, first.clubId, 79)).toThrow(/matchday/);
    expect(() => rosterForRound([...rosters, { ...changed, id: 'duplicate-boundary' }], first.clubId, 4)).toThrow(/ambiguous/);
  });
});

describe('fixture, training and archive ownership', () => {
  let initial: SeasonState, secondRound: SeasonState, completed: SeasonState, nextYear: SeasonState;
  beforeAll(() => {
    initial = createSeason(19, 'atlantic-pilots', 'off');
    secondRound = advanceSeason(finish(initial));
    completed = complete(secondRound);
    nextYear = rolloverSeason(completed);
  }, 30_000);

  it('records the squads used by every committed game and the completed training week', () => {
    expect(initial.schemaVersion).toBe(SEASON_SCHEMA_VERSION);
    expect(initial.rosters).toEqual(createRosterSnapshots(initial.clubs, 1));
    for (const fixture of secondRound.fixtures.filter(fixture => fixture.result)) {
      const teams = getFixtureTeams(secondRound, fixture);
      expect(fixture.result!.rosterIds).toEqual({
        home: rosterForRound(secondRound.rosters, fixture.homeClubId, fixture.round).id,
        away: rosterForRound(secondRound.rosters, fixture.awayClubId, fixture.round).id,
      });
      expect(Object.keys(fixture.result!.stats).sort()).toEqual([...teams.home.players, ...teams.away.players].map(player => player.id).sort());
    }
    expect(secondRound.training.lastWeek!.rosterIds).toEqual(Object.fromEntries(secondRound.clubs.map(club => [club.id, rosterForRound(secondRound.rosters, club.id, 1).id])));
    expect(secondRound.rosters).toEqual(initial.rosters);
    expect(initial.fixtures.every(fixture => fixture.result === null)).toBe(true);
  });

  it('refuses a match squad absent from the registered roster without committing partial results', () => {
    const state = finish(initial), side = managedSide(state), clubId = state.activeMatch![side].id;
    const bad = { ...state, rosters: state.rosters.map(roster => roster.clubId === clubId ? { ...roster, players: roster.players.slice(1) } : roster) };
    const before = structuredClone(bad);
    expect(() => advanceSeason(bad)).toThrow(/registered roster/);
    expect(bad).toEqual(before);
  });

  it('training references its registration and refuses mismatched membership', () => {
    const finished = finish(initial);
    const conditions = { ...initial.conditions, ...Object.fromEntries(Object.entries(finished.activeMatch!.stats).map(([id, stat]) => [id, stat.condition])) };
    const input = { seed: initial.seed, training: initial.training, clubs: initial.clubs, conditions, injuries: [], seasonNumber: 1, afterRound: 1, fromDate: initial.date, toDate: secondRound.date, rosters: initial.rosters };
    const withSnapshots = processTrainingWeek(input), inferred = processTrainingWeek({ ...input, rosters: undefined });
    expect(withSnapshots).toEqual(inferred);
    const first = initial.rosters[0]!;
    const changed = initial.rosters.map(roster => roster === first ? { ...roster, players: roster.players.slice(1) } : roster);
    expect(() => processTrainingWeek({ ...input, rosters: changed })).toThrow(/registered/);
    expect(initial.training.lastWeek).toBeNull();
  });

  it('retains complete player statistics and independent identity snapshots after rollover', () => {
    const archive = nextYear.history[0]!;
    expect(archive.rosters).toEqual(completed.rosters);
    expect(archive.rosters).not.toBe(completed.rosters);
    expect(archive.rosters[0]!.players[0]!.attributes).not.toBe(completed.rosters[0]!.players[0]!.attributes);
    expect(nextYear.rosters).toEqual(createRosterSnapshots(nextYear.clubs, 2));
    expect(restoreSeniorDetail(nextYear, completed).history[0]!.fixtures).toEqual(completed.fixtures);
    for (const [index, fixture] of archive.fixtures.entries()) {
      expect(fixture.result.stats).not.toBe(completed.fixtures[index]!.result!.stats);
      if (fixture.result.stats) {
        const playerId = Object.keys(fixture.result.stats)[0]!;
        expect(fixture.result.stats[playerId]).not.toBe(completed.fixtures[index]!.result!.stats[playerId]);
      } else expect(fixture.result.appearances).toBeDefined();
      expect(fixture.result.rosterIds).not.toBe(completed.fixtures[index]!.result!.rosterIds);
    }
    expect(getSeasonRosterData(nextYear, 1)).toBe(archive);
    expect(getSeasonRosterData(nextYear).rosters).toBe(nextYear.rosters);
    expect(() => getSeasonRosterData(nextYear, 3)).toThrow(/available career season/);
  });

  it('historical teams survive later club changes, jersey edits and departures', () => {
    const fixture = nextYear.history[0]!.fixtures[0]!, before = getFixtureTeams(nextYear, fixture, 1);
    const changedClubs = nextYear.clubs.map(club => ({ ...club, players: club.players.slice(1).map(player => ({ ...player, name: `Current ${player.name}`, number: player.number + 30 })) }));
    const changed = { ...nextYear, clubs: changedClubs, rosters: createRosterSnapshots(changedClubs, 2) };
    expect(getFixtureTeams(changed, fixture, 1)).toEqual(before);
    expect(getFixtureTeams(changed, fixture, 1).home.players[0]!.id).toBe(before.home.players[0]!.id);
    expect(fixture.result.stats).toEqual(completed.fixtures[0]!.result!.stats);
    expect(getFixtureTeams(changed, getActiveFixture(changed)).home.players).toEqual(changedClubs.find(club => club.id === changed.activeMatch!.home.id)!.players);
  });

  it('rejects missing, opposing, obsolete and overlapping roster references', () => {
    const fixture = secondRound.fixtures.find(fixture => fixture.result)!;
    const changedFixture = (home: string) => ({ ...fixture, result: { ...fixture.result!, rosterIds: { ...fixture.result!.rosterIds, home } } });
    expect(() => getFixtureTeams(secondRound, changedFixture('missing'))).toThrow(/historical roster/);
    expect(() => getFixtureTeams(secondRound, changedFixture(fixture.result!.rosterIds.away))).toThrow(/historical roster/);
    const home = rosterForRound(secondRound.rosters, fixture.homeClubId, 1), away = rosterForRound(secondRound.rosters, fixture.awayClubId, 1);
    const later = { ...secondRound, rosters: [...secondRound.rosters, { ...home, id: `${home.id}-later`, fromRound: 2 }] };
    expect(() => getFixtureTeams(later, { ...fixture, round: 2 })).toThrow(/historical roster/);
    const overlap = { ...secondRound, rosters: secondRound.rosters.map(roster => roster.id === away.id ? { ...roster, players: [home.players[0]!, ...roster.players.slice(1)] } : roster) };
    expect(() => getFixtureTeams(overlap, fixture)).toThrow(/same player twice/);
  });

  it('carried injury eligibility follows the registered player rather than the injury origin club', () => {
    const state = createSeason(84, 'atlantic-pilots', 'standard', false, false, false, false);
    const opponentPair = new Set([state.activeMatch!.home.id, state.activeMatch!.away.id]);
    const destination = state.clubs.find(club => !opponentPair.has(club.id))!, player = destination.players[0]!;
    const originClubId = state.managedClubId;
    const injury = { id: `previous-registration:${player.id}`, playerId: player.id, clubId: originClubId, fixtureId: 'previous-registration', kind: 'ankle-sprain' as const, occurredOn: '2026-09-04', returnOn: '2026-09-20' };
    const prepared = { ...finish(state), injuries: [injury] }, before = structuredClone(prepared);
    const next = advanceSeason(prepared);
    const result = next.fixtures.find(fixture => fixture.round === 1 && [fixture.homeClubId, fixture.awayClubId].includes(destination.id))!.result!;
    expect(result.injuries[player.id]).toBe('ankle-sprain');
    expect(result.stats[player.id]).toMatchObject({ secondsPlayed: 0, points: 0, fouls: 0 });
    expect(next.injuries.find(record => record.id === injury.id)).toEqual(injury);
    expect(prepared).toEqual(before);
  });
});
