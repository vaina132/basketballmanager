import { describe, expect, it } from 'vitest';
import type { PlayerKnowledge } from '../src/domain/scouting';
import type { ArchivedFixture, SeasonState } from '../src/domain/season';
import type { PlayerAttributes, PlayerStats, Team } from '../src/domain/types';
import { setAutoSubstitutions, simulateToEnd, stepMatch } from '../src/engine/match';
import { abilityRating, attributeAbilityStars, getFixtureMvp, getMatchMvp, hasPlayerParticipated, overallAbilityStars, playerMatchRating, playerPIR, selectMatchMvp } from '../src/world/performance-rating';
import { advanceSeason, createSeason, managedSide } from '../src/world/season';

const attributes = (value: number): PlayerAttributes => ({ twoPoint: value, threePoint: value, freeThrow: value, passing: value, defense: value, rebounding: value, stamina: value });
const stats = (change: Partial<PlayerStats> = {}): PlayerStats => ({ secondsPlayed: 0, points: 0, fieldGoalsMade: 0, fieldGoalsAttempted: 0, threePointersMade: 0, threePointersAttempted: 0, freeThrowsMade: 0, freeThrowsAttempted: 0, rebounds: 0, assists: 0, steals: 0, blocks: 0, turnovers: 0, fouls: 0, condition: 100, ...change });
const knowledge = (change: Partial<PlayerKnowledge> = {}): PlayerKnowledge => ({ playerId: 'unknown', kind: 'unknown', level: 0, attributes: null, ranges: null, observedOn: null, observedClubId: null, ageDays: null, freshness: 'unknown', source: null, observations: 0, ...change });
const ranges = (min: number, max: number): PlayerKnowledge['ranges'] => Object.fromEntries(Object.keys(attributes(1)).map(key => [key, { min, max }])) as PlayerKnowledge['ranges'];

describe('game box-score rating', () => {
  it('counts all recorded contributions and misses, without counting three-point misses twice', () => {
    const line = stats({ secondsPlayed: 1800, points: 24, fieldGoalsMade: 8, fieldGoalsAttempted: 14, threePointersMade: 3, threePointersAttempted: 7, freeThrowsMade: 5, freeThrowsAttempted: 6, rebounds: 7, assists: 5, steals: 2, blocks: 1, turnovers: 3, fouls: 2 });
    expect(playerPIR(line)).toBe(27);
    expect(playerMatchRating(line)).toBe(8.7);
    const { condition: _condition, ...retainedTotals } = line;
    expect(playerPIR(retainedTotals)).toBe(27);
  });

  it('leaves DNP and missing records unrated, regardless of current stamina', () => {
    for (const line of [undefined, null, stats(), stats({ condition: 4 })]) {
      expect(hasPlayerParticipated(line)).toBe(false);
      expect(playerMatchRating(line)).toBeNull();
    }
    expect(playerMatchRating(stats({ secondsPlayed: 1 }))).toBe(6);
    expect(playerMatchRating(stats({ fouls: 1 }))).toBe(5.9);
    expect(hasPlayerParticipated(stats({ fieldGoalsAttempted: 1 }))).toBe(true);
  });

  it('never amplifies a short early appearance and caps both unusually strong and negative games', () => {
    expect(playerMatchRating(stats({ secondsPlayed: 1, points: 2, fieldGoalsMade: 1, fieldGoalsAttempted: 1 }))).toBe(6.2);
    expect(playerMatchRating(stats({ secondsPlayed: 2400, points: 2, fieldGoalsMade: 1, fieldGoalsAttempted: 1 }))).toBe(6.2);
    expect(playerMatchRating(stats({ secondsPlayed: 2400, points: 45, rebounds: 20 }))).toBe(10);
    expect(playerMatchRating(stats({ secondsPlayed: 2400, fieldGoalsAttempted: 50, turnovers: 9, fouls: 5 }))).toBe(1);
  });
});

describe('ability stars preserve knowledge boundaries', () => {
  it('uses all seven skills and half-star steps within 1–5', () => {
    expect(overallAbilityStars(attributes(1))).toBe(1);
    expect(overallAbilityStars(attributes(20))).toBe(5);
    expect(overallAbilityStars(attributes(10))).toBe(2.5);
    expect(overallAbilityStars({ ...attributes(10), passing: 20, stamina: 20 })).toBe(3);
    expect(attributeAbilityStars(13)).toBe(3.5);
    expect(attributeAbilityStars(12)).toBe(3);
  });

  it('shows exact owned ability while individual skills use the same scale', () => {
    const own = knowledge({ kind: 'own', attributes: { ...attributes(10), defense: 18 } });
    expect(abilityRating(own)).toEqual({ kind: 'exact', min: 3, max: 3 });
    expect(abilityRating(own, 'defense')).toEqual({ kind: 'exact', min: 4.5, max: 4.5 });
  });

  it('never uses raw attribute fields for unknown or scouted outsiders', () => {
    expect(abilityRating(knowledge({ attributes: attributes(20) }))).toEqual({ kind: 'unknown', min: null, max: null });
    expect(abilityRating(knowledge({ kind: 'report', ranges: ranges(8, 16), attributes: attributes(20) }))).toEqual({ kind: 'range', min: 2, max: 4 });
    expect(abilityRating(knowledge({ kind: 'report' }))).toEqual({ kind: 'unknown', min: null, max: null });
  });

  it('retains visible uncertainty when half-star rounding would collapse a scouting range', () => {
    expect(abilityRating(knowledge({ kind: 'report', ranges: ranges(10, 10.5) }))).toEqual({ kind: 'range', min: 2, max: 3 });
    expect(abilityRating(knowledge({ kind: 'report', ranges: ranges(1, 2) }))).toEqual({ kind: 'range', min: 1, max: 1.5 });
    expect(abilityRating(knowledge({ kind: 'report', ranges: ranges(19, 20) }), 'passing')).toEqual({ kind: 'range', min: 4.5, max: 5 });
  });
});

describe('PIR match MVP', () => {
  const initial = createSeason(91, undefined, 'off', false);
  const home = initial.activeMatch.home, away = initial.activeMatch.away;
  const h = home.players[0]!, h2 = home.players[1]!, a = away.players[0]!;
  const teams = [home, away];

  it('uses highest PIR even on the losing team, without an unrated reserve beating negative performances', () => {
    expect(selectMatchMvp(teams, { [h.id]: stats({ secondsPlayed: 600, points: 10 }), [a.id]: stats({ secondsPlayed: 600, points: 11 }) }, home.id)).toMatchObject({ playerId: a.id, clubId: away.id, pir: 11, rating: 7.1 });
    expect(selectMatchMvp(teams, { [h.id]: stats({ secondsPlayed: 30, turnovers: 3 }), [a.id]: stats({ secondsPlayed: 30, turnovers: 2 }), [h2.id]: stats() }, home.id)).toMatchObject({ playerId: a.id, pir: -2 });
    expect(selectMatchMvp(teams, { [h.id]: stats() }, home.id)).toBeNull();
    expect(selectMatchMvp(teams, null, home.id)).toBeNull();
  });

  it('breaks equal PIR by winning club before points, then uses deterministic statistical ties', () => {
    expect(selectMatchMvp(teams, { [h.id]: stats({ secondsPlayed: 1, assists: 10 }), [a.id]: stats({ secondsPlayed: 1, points: 10 }) }, home.id)?.playerId).toBe(h.id);
    const choose = (left: Partial<PlayerStats>, right: Partial<PlayerStats>) => selectMatchMvp([home], { [h.id]: stats({ secondsPlayed: 1, ...left }), [h2.id]: stats({ secondsPlayed: 1, ...right }) }, home.id)!.playerId;
    expect(choose({ points: 10 }, { points: 9, assists: 1 })).toBe(h.id);
    expect(choose({ points: 9, assists: 1 }, { points: 9, rebounds: 1 })).toBe(h.id);
    expect(choose({ points: 9, rebounds: 1 }, { points: 9, steals: 1 })).toBe(h.id);
    expect(choose({ points: 9 }, { points: 9, steals: 1, turnovers: 1 })).toBe(h.id);
  });

  it('uses stable player identity for complete ties, independently of roster and team order', () => {
    const lines = { [h.id]: stats({ secondsPlayed: 1 }), [h2.id]: stats({ secondsPlayed: 1 }), [a.id]: stats({ secondsPlayed: 1 }) };
    const alternate: Team[] = [...teams].reverse().map(club => ({ ...club, players: [...club.players].reverse() }));
    const expected = [h.id, h2.id, a.id].sort()[0];
    expect(selectMatchMvp(teams, lines, null)?.playerId).toBe(expected);
    expect(selectMatchMvp(alternate, lines, null)?.playerId).toBe(expected);
  });

  it('ignores box-score entries for players outside the recorded teams', () => {
    expect(selectMatchMvp(teams, { absent: stats({ points: 100 }), [h.id]: stats({ secondsPlayed: 1 }) }, home.id)?.playerId).toBe(h.id);
  });

  it('keeps live, committed and archived results coherent without mutating simulation state', () => {
    const finished = simulateToEnd(setAutoSubstitutions(initial.activeMatch, managedSide(initial), true));
    const before = structuredClone(finished);
    expect(getMatchMvp({ ...finished, status: 'playing' })).toBeNull();
    const mvp = getMatchMvp(finished)!;
    expect(mvp).not.toBeNull();
    for (const line of Object.values(finished.stats)) { playerPIR(line); playerMatchRating(line); }
    expect(finished).toEqual(before);
    expect(stepMatch(finished)).toEqual(stepMatch(before));
    const committed = advanceSeason({ ...initial, activeMatch: finished });
    const fixture = committed.fixtures.find(item => item.id === initial.activeFixtureId)!;
    expect(getFixtureMvp(committed, fixture)).toMatchObject({ playerId: mvp.playerId, clubId: mvp.clubId, pir: mvp.pir, rating: mvp.rating });
    // Synthetic archive isolates identity lookup: today's roster no longer contains the MVP.
    const archived = fixture as ArchivedFixture;
    const later: SeasonState = { ...committed, seasonNumber: 2, clubs: committed.clubs.map(club => ({ ...club, players: club.players.filter(player => player.id !== mvp.playerId) })), history: [{ seasonNumber: 1, rosters: committed.rosters, fixtures: [archived] }] };
    expect(getFixtureMvp(later, archived, 1)).toMatchObject({ playerId: mvp.playerId, clubId: mvp.clubId, player: { name: mvp.player.name } });
    expect(getFixtureMvp(later, { ...archived, result: { ...archived.result, stats: null } }, 1)).toBeNull();
    expect(getFixtureMvp(initial, initial.fixtures[0]!)).toBeNull();
  });
});
