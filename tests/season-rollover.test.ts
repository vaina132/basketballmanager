import { createRelationships } from '../src/world/relationships';
import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { DEVELOPMENT_CLUBS, DEVELOPMENT_START_DATE } from '../src/data/development-league';
import { setAutoSubstitutions, setTactics, simulateToEnd } from '../src/engine/match';
import { getPlayerHealth, isRecovering } from '../src/world/health';
import { advanceSeason, createSchedule, createSeason, DAILY_RECOVERY, dateForRound, fixtureSeed, getActiveFixture, getStandings, managedSide, MAX_SEASON_NUMBER, rolloverSeason, seasonLabel, seasonStartDate } from '../src/world/season';

function finishSeason(initial: SeasonState): SeasonState {
  let state = initial;
  while (state.status === 'active') {
    const match = state.activeMatch.status === 'finished' ? state.activeMatch : simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true));
    state = advanceSeason({ ...state, activeMatch: match });
  }
  return state;
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

describe('annual development calendar', () => {
  it('preserves the original schedule and uses the first September Saturday in later years', () => {
    expect(seasonStartDate()).toBe(DEVELOPMENT_START_DATE);
    expect(seasonLabel()).toBe('2026/27');
    const expected = ['2026-09-05', '2027-09-04', '2028-09-02', '2029-09-01', '2030-09-07'];
    for (let index = 0; index < expected.length; index += 1) {
      const number = index + 1, schedule = createSchedule(DEVELOPMENT_CLUBS, number);
      expect(seasonStartDate(number)).toBe(expected[index]);
      expect(schedule[0]!.date).toBe(expected[index]);
      expect(schedule[0]!.id).toBe(number === 1 ? 'dev-r1-g1' : `dev-s${number}-r1-g1`);
      expect(schedule.at(-1)!.date).toBe(dateForRound(10, number));
      for (let round = 1; round <= 10; round += 1) {
        const fixtures = schedule.filter(fixture => fixture.round === round);
        expect(fixtures).toHaveLength(3);
        expect(new Set(fixtures.flatMap(fixture => [fixture.homeClubId, fixture.awayClubId])).size).toBe(6);
        expect(new Set(fixtures.map(fixture => fixture.date))).toEqual(new Set([dateForRound(round, number)]));
      }
    }
    const all = expected.flatMap((_, index) => createSchedule(DEVELOPMENT_CLUBS, index + 1));
    expect(new Set(all.map(fixture => fixture.id)).size).toBe(150);
    expect(new Set(all.map(fixture => fixtureSeed(9, fixture.id))).size).toBe(150);
    expect(createSchedule()).toEqual(createSchedule(DEVELOPMENT_CLUBS, 1));
    expect(dateForRound(10)).toBe('2026-11-07');
  });

  it('rejects invalid season numbers and keeps the supported boundary in four-digit years', () => {
    for (const number of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, MAX_SEASON_NUMBER + 1]) {
      expect(() => seasonStartDate(number)).toThrow(/season number/);
      expect(() => createSchedule(DEVELOPMENT_CLUBS, number)).toThrow(/season number/);
      expect(() => dateForRound(1, number)).toThrow(/season number/);
      expect(() => seasonLabel(number)).toThrow(/season number/);
    }
    expect(seasonStartDate(MAX_SEASON_NUMBER)).toMatch(/^9999-09-0[1-7]$/);
    expect(dateForRound(10, MAX_SEASON_NUMBER)).toMatch(/^9999-11-0[1-9]$/);
  });
});

describe('same-club career rollover', () => {
  let completed: SeasonState;
  beforeAll(() => {
    completed = freeze(finishSeason(createSeason(9, 'atlantic-pilots')));
  }, 30_000);

  it('archives every final score, roster and player box score without event history', () => {
    const before = structuredClone(completed);
    const next = rolloverSeason(completed), archive = next.history[0]!;
    expect(completed).toEqual(before);
    expect(next).toMatchObject({ schemaVersion: 29, relationships: createRelationships(), seasonNumber: 2, round: 1, status: 'active', date: '2027-09-04', managedClubId: completed.managedClubId, seed: completed.seed });
    expect(next.clubs).toEqual(completed.clubs);
    expect(next.history).toHaveLength(1);
    expect(archive.seasonNumber).toBe(1);
    expect(archive.fixtures).toHaveLength(30);
    expect(getStandings({ clubs: next.clubs, fixtures: archive.fixtures })).toEqual(getStandings(completed));
    for (let index = 0; index < archive.fixtures.length; index += 1) {
      const old = completed.fixtures[index]!, saved = archive.fixtures[index]!;
      expect(saved).toMatchObject({ id: old.id, date: old.date, homeClubId: old.homeClubId, awayClubId: old.awayClubId, round: old.round });
      expect(saved.result).toEqual(old.result);
      expect(saved.result.stats).not.toBe(old.result!.stats);
      expect(saved.result.rosterIds).not.toBe(old.result!.rosterIds);
      expect(saved.result).not.toHaveProperty('events');
      expect(saved.result.score).not.toBe(old.result!.score);
      expect(saved.result.injuries).not.toBe(old.result!.injuries);
    }
    expect(next.fixtures.every(fixture => fixture.result === null)).toBe(true);
    expect(getStandings(next).every(row => row.played === 0 && row.wins === 0 && row.pointsFor === 0)).toBe(true);
    expect(rolloverSeason(completed)).toEqual(next);
  });

  it('carries plans and real health history while applying elapsed-day recovery once', () => {
    const next = rolloverSeason(completed);
    expect(next.plans).toEqual(completed.plans);
    expect(next.plans).not.toBe(completed.plans);
    expect(next.injuryMode).toBe(completed.injuryMode);
    expect(next.injuries.length).toBeGreaterThan(0);
    expect(next.injuries).toEqual(completed.injuries);
    expect(next.injuries).not.toBe(completed.injuries);
    const recoveryDays = (Date.parse(`${next.date}T00:00:00.000Z`) - Date.parse(`${completed.date}T00:00:00.000Z`)) / 86_400_000;
    expect(recoveryDays).toBe(301);
    for (const [id, condition] of Object.entries(completed.conditions)) {
      expect(next.conditions[id]).toBe(Math.min(100, Math.round((condition + DAILY_RECOVERY * recoveryDays) * 1000) / 1000));
      expect(getPlayerHealth(next, id)).toBeNull();
    }
    expect(next.injuries.every(injury => !isRecovering(injury, next.date))).toBe(true);
    expect(next.activeMatch.preExistingInjuries ?? []).toEqual([]);
    expect(next.activeMatch.injuries).toEqual({});
    expect(next.activeMatch.status).toBe('ready');
    expect(next.activeMatch.tactics[managedSide(next)]).toEqual(completed.plans[next.managedClubId]!.tactics);
    expect(next.activeMatch.autoSubstitutions[managedSide(next)]).toBe(completed.plans[next.managedClubId]!.autoSubstitutions);
    expect(next.activeMatch.lineups[managedSide(next)]).toEqual(completed.plans[next.managedClubId]!.lineup);
    expect(next.activeMatch.seed).toBe(fixtureSeed(next.seed, getActiveFixture(next).id));
    for (const [id, stats] of Object.entries(next.activeMatch.stats)) expect(stats).toMatchObject({ condition: next.conditions[id], secondsPlayed: 0, fouls: 0, points: 0 });
    expect(() => rolloverSeason(next)).toThrow(/Complete the current season/);
    expect(next.history).toHaveLength(1);
    expect(completed.date).toBe('2026-11-07');
  });

  it('refuses incomplete, uncommitted, duplicated or inconsistent seasons atomically', () => {
    const missing = structuredClone(completed);
    missing.fixtures[0]!.result = null;
    const wrongFixture = structuredClone(completed);
    wrongFixture.fixtures[0]!.id = 'dev-r1-g2';
    const duplicateHistory = structuredClone(completed);
    duplicateHistory.history = rolloverSeason(completed).history;
    const unfinished = { ...completed, activeMatch: { ...completed.activeMatch, status: 'ready' as const } };
    const changedScore = { ...completed, activeMatch: { ...completed.activeMatch, score: { ...completed.activeMatch.score, home: completed.activeMatch.score.home + 1 } } };
    const invalid = [createSeason(), missing, wrongFixture, duplicateHistory, unfinished, changedScore, { ...completed, round: 9 }, { ...completed, date: '2026-11-08' }, { ...completed, activeMatch: { ...completed.activeMatch, seed: completed.activeMatch.seed + 1 } }];
    for (const state of invalid) {
      const before = structuredClone(state);
      expect(() => rolloverSeason(state)).toThrow();
      expect(state).toEqual(before);
    }
  });

  it('continues for multiple seasons with unique fixtures and injury provenance', () => {
    let state = rolloverSeason(completed);
    const instructions = { tempo: .75, outsideShare: .3, pressure: .65 };
    state = { ...state, activeMatch: setTactics(state.activeMatch, managedSide(state), instructions) };
    const firstArchive = structuredClone(state.history[0]);
    for (const seasonNumber of [2, 3]) {
      state = finishSeason(state);
      expect(state.date).toBe(dateForRound(10, seasonNumber));
      expect(state.fixtures.every(fixture => fixture.id.startsWith(`dev-s${seasonNumber}-`))).toBe(true);
      expect(getStandings(state).every(row => row.played === 10)).toBe(true);
      state = rolloverSeason(state);
      expect(state.seasonNumber).toBe(seasonNumber + 1);
      expect(state.date).toBe(seasonStartDate(seasonNumber + 1));
      expect(state.activeMatch.tactics[managedSide(state)]).toEqual(instructions);
      expect(state.history.map(archive => archive.seasonNumber)).toEqual(Array.from({ length: seasonNumber }, (_, index) => index + 1));
    }
    expect(state.history[0]).toEqual(firstArchive);
    const fixtureIds = [...state.history.flatMap(archive => archive.fixtures.map(fixture => fixture.id)), ...state.fixtures.map(fixture => fixture.id)];
    expect(new Set(fixtureIds).size).toBe(120);
    expect(new Set(state.injuries.map(injury => injury.id)).size).toBe(state.injuries.length);
    for (const episode of state.injuries) {
      const fixture = state.history.flatMap(archive => archive.fixtures).find(fixture => fixture.id === episode.fixtureId)!;
      expect(fixture.result.injuries[episode.playerId]).toBe(episode.kind);
      expect(episode.occurredOn).toBe(fixture.date);
    }
  }, 60_000);

  it('uses official awarded scores when rebuilding historical standings', () => {
    const next = rolloverSeason(completed);
    const fixtures = structuredClone(next.history[0]!.fixtures);
    const fixture = fixtures[0]!;
    fixture.result.score = { home: 19, away: 22 };
    fixture.result.officialScore = { home: 2, away: 0 };
    fixture.result.winnerClubId = fixture.homeClubId;
    fixture.result.kind = 'default';
    const table = getStandings({ clubs: next.clubs, fixtures: [fixture] });
    expect(table.find(row => row.clubId === fixture.homeClubId)).toMatchObject({ wins: 1, pointsFor: 2, pointsAgainst: 0 });
    expect(table.find(row => row.clubId === fixture.awayClubId)).toMatchObject({ losses: 1, pointsFor: 0, pointsAgainst: 2 });
  });
});
