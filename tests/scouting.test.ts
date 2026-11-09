import { describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { DEVELOPMENT_CLUBS } from '../src/data/development-league';
import { createFixtureMatch } from '../src/engine/match';
import { cancelScoutingAssignment, createScouting, enableScouting, assignScouting, prepareScoutingAssignments, processScoutingRound, refreshSquadKnowledge, setScoutingDelegation, setShortlisted } from '../src/world/scouting';
import { getPlayerKnowledge, quoteScoutingAssignment, SCOUTING_ATTRIBUTES, scoutingRecruitmentRating, scoutingRanges } from '../src/world/scouting-policy';
import { createSeason } from '../src/world/season';

const clubId = DEVELOPMENT_CLUBS[0]!.id, otherClubId = DEVELOPMENT_CLUBS[1]!.id;
const own = DEVELOPMENT_CLUBS[0]!.players[0]!, target = DEVELOPMENT_CLUBS[1]!.players[0]!;
const outside = DEVELOPMENT_CLUBS[1]!.players;
const create = () => enableScouting(createSeason(71, clubId, 'off'));
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
/** Isolated observation exposure fixture, not a portable career/save fixture. */
function committed(state: SeasonState, unavailable: string[] = []): SeasonState {
  return { ...state, fixtures: state.fixtures.map(fixture => {
    if (fixture.round !== state.round) return fixture;
    const home = state.clubs.find(club => club.id === fixture.homeClubId)!, away = state.clubs.find(club => club.id === fixture.awayClubId)!;
    const match = createFixtureMatch(1, home, away);
    const stats = Object.fromEntries(Object.entries(match.stats).map(([id, stats]) => [id, { ...stats, secondsPlayed: unavailable.includes(id) ? 0 : 1200 }]));
    return { ...fixture, result: { score: { home: 0, away: 0 }, officialScore: { home: 0, away: 0 }, winnerClubId: home.id, kind: 'normal' as const, periods: 4, stats, injuries: {}, rosterIds: { home: state.rosters.find(roster => roster.clubId === home.id)!.id, away: state.rosters.find(roster => roster.clubId === away.id)!.id } } };
  }) };
}
function nextRound(state: SeasonState): SeasonState {
  const round = state.round + 1;
  return { ...state, round, date: state.fixtures.find(fixture => fixture.round === round)!.date };
}
function observe(state: SeasonState, playerId = target.id, unavailable: string[] = []): SeasonState {
  return processScoutingRound(committed(assignScouting(state, playerId), unavailable));
}

describe('scouting activation and assignment capacity', () => {
  it('preserves old career behavior until enabled, with no finance, match or random-state changes', () => {
    const old = freeze(createSeason(71, clubId, 'off'));
    expect(old.scouting).toEqual(createScouting(old.clubs, clubId));
    expect(processScoutingRound(old)).toBe(old);
    expect(prepareScoutingAssignments(old)).toBe(old);
    const state = enableScouting(old);
    expect(state.activeMatch).toBe(old.activeMatch);
    expect(state.finance).toBe(old.finance);
    expect(state.training).toBe(old.training);
    expect(state.employment).toBe(old.employment);
    expect(state.scouting.enabledSince).toEqual({ seasonNumber: 1, round: 1 });
    for (const club of state.clubs) {
      expect(Object.keys(state.scouting.clubs[club.id]!.squadKnowledge)).toHaveLength(10);
      expect(state.scouting.clubs[club.id]!.assignments).toHaveLength(club.id === clubId ? 0 : 2);
    }
    expect(enableScouting(state)).toBe(state);
    expect(enableScouting(createSeason(71, clubId, 'off', false, false, false)).finance.enabledSince).toBeNull();
  });

  it('allows two distinct registered outsiders, rejects own/unregistered/offseason targets and supports cancellation', () => {
    const initial = freeze(create());
    let state = assignScouting(initial, target.id);
    state = assignScouting(state, outside[1]!.id);
    expect(state.scouting.clubs[clubId]!.assignments).toHaveLength(2);
    expect(() => assignScouting(state, outside[2]!.id)).toThrow(/Both scouting assignments/);
    expect(() => assignScouting(state, target.id)).toThrow(/already has a pending/);
    expect(quoteScoutingAssignment(initial, own.id).reason).toMatch(/own squad/);
    expect(quoteScoutingAssignment(initial, 'missing').canAssign).toBe(false);
    expect(quoteScoutingAssignment({ ...initial, status: 'complete' }, target.id).reason).toMatch(/next season/);
    const withoutTarget = { ...initial, clubs: initial.clubs.map(club => ({ ...club, players: club.players.filter(player => player.id !== target.id) })) };
    expect(quoteScoutingAssignment(withoutTarget, target.id).reason).toMatch(/registered club/);
    state = cancelScoutingAssignment(state, target.id);
    expect(quoteScoutingAssignment(state, target.id).canAssign).toBe(true);
    expect(initial.scouting.clubs[clubId]!.assignments).toEqual([]);
    expect(() => cancelScoutingAssignment(state, target.id)).toThrow(/pending scouting assignment/);
  });

  it('persists unique shortlists independently of knowledge and uses the same assignment guards for the assistant', () => {
    let state = setShortlisted(create(), target.id, true);
    expect(setShortlisted(state, target.id, true)).toBe(state);
    expect(getPlayerKnowledge(state, target.id).kind).toBe('unknown');
    state = setScoutingDelegation(state, true);
    expect(state.scouting.clubs[clubId]!.assignments).toHaveLength(2);
    expect(state.scouting.clubs[clubId]!.assignments.some(assignment => assignment.playerId === target.id)).toBe(true);
    expect(prepareScoutingAssignments(state)).toBe(state);
    const manual = setScoutingDelegation(state, false);
    expect(manual.scouting.clubs[clubId]!.assignments).toBe(state.scouting.clubs[clubId]!.assignments);
    state = setShortlisted(manual, target.id, false);
    expect(state.scouting.clubs[clubId]!.shortlist).toEqual([]);
    expect(() => setShortlisted(createSeason(71), target.id, true)).toThrow(/Enable scouting/);
    expect(() => setShortlisted(state, 'missing', true)).toThrow(/catalog/);
  });
});

describe('frozen scouting observations and imperfect knowledge', () => {
  it('requires committed results and observed court exposure, without granting knowledge to an unused player', () => {
    const state = assignScouting(create(), target.id);
    expect(() => processScoutingRound(state)).toThrow(/Commit every matchday/);
    const result = processScoutingRound(committed(state, [target.id]));
    expect(result.scouting.clubs[clubId]!.reviews).toEqual([{ playerId: target.id, seasonNumber: 1, round: 1, date: state.date, clubId: otherClubId, rosterId: state.rosters.find(roster => roster.clubId === otherClubId)!.id, outcome: 'no-minutes', attributes: null }]);
    expect(result.scouting.clubs[clubId]!.assignments).toEqual([]);
    expect(getPlayerKnowledge(result, target.id)).toMatchObject({ kind: 'unknown', level: 0, attributes: null, ranges: null });
    expect(processScoutingRound(result).scouting.clubs[clubId]!.reviews).toHaveLength(1);
  });

  it('improves through independent matchdays but never exposes exact outside ratings', () => {
    let state = create();
    const widths: number[] = [];
    for (let count = 1; count <= 4; count += 1) {
      state = observe(state);
      const knowledge = getPlayerKnowledge(state, target.id);
      expect(knowledge.level).toBe(Math.min(count, 3));
      expect(knowledge.observations).toBe(count);
      expect(knowledge.attributes).toBeNull();
      expect(knowledge.source).toBe('observation');
      expect(knowledge.observedOn).toBe(state.date);
      widths.push(SCOUTING_ATTRIBUTES.reduce((total, attribute) => total + knowledge.ranges![attribute].max - knowledge.ranges![attribute].min, 0));
      for (const range of Object.values(knowledge.ranges!)) {
        expect(range.min).toBeGreaterThanOrEqual(1);
        expect(range.max).toBeLessThanOrEqual(20);
        expect(range.max - range.min).toBeGreaterThanOrEqual(2);
      }
      expect(quoteScoutingAssignment(state, target.id).reason).toMatch(/already been reviewed/);
      if (count !== 4) state = nextRound(state);
    }
    expect(widths[1]).toBeLessThan(widths[0]!);
    expect(widths[2]).toBeLessThan(widths[1]!);
    expect(widths[3]).toBe(widths[2]);
  });

  it('keeps a saved observation unchanged when the outsider develops, and widens it with calendar age', () => {
    const state = freeze(observe(create()));
    const before = getPlayerKnowledge(state, target.id);
    const points = Object.fromEntries(SCOUTING_ATTRIBUTES.map(attribute => [attribute, 200])) as typeof state.training.points[string];
    const developed = { ...state, training: { ...state.training, points: { ...state.training.points, [target.id]: points } } };
    expect(getPlayerKnowledge(developed, target.id)).toEqual(before);
    expect(scoutingRecruitmentRating(developed, clubId, target.id)).toBe(scoutingRecruitmentRating(state, clubId, target.id));
    const aged = { ...developed, date: '2027-09-04' };
    const later = getPlayerKnowledge(aged, target.id);
    expect(later.freshness).toBe('stale');
    expect(later.observedOn).toBe(before.observedOn);
    for (const attribute of SCOUTING_ATTRIBUTES) {
      expect(later.ranges![attribute].min).toBeLessThanOrEqual(before.ranges![attribute].min);
      expect(later.ranges![attribute].max).toBeGreaterThanOrEqual(before.ranges![attribute].max);
    }
    expect(state.scouting.clubs[clubId]!.reviews[0]!.attributes).toEqual(target.attributes);
  });

  it('retains a successful report when a follow-up has no playing time', () => {
    const first = observe(create());
    const second = observe(nextRound(first), target.id, [target.id]);
    const knowledge = getPlayerKnowledge(second, target.id);
    expect(knowledge).toMatchObject({ level: 1, observations: 1, observedOn: first.date, ageDays: 7 });
    expect(second.scouting.clubs[clubId]!.reviews).toHaveLength(2);
  });

  it('shows current own skills exactly and preserves uncertain squad memory after departure', () => {
    const state = freeze(create());
    expect(getPlayerKnowledge(state, own.id)).toMatchObject({ kind: 'own', level: 3, attributes: own.attributes, ranges: null });
    const moved = { ...state, clubs: state.clubs.map(club => ({ ...club, players: club.id === clubId ? club.players.filter(player => player.id !== own.id) : club.id === otherClubId ? [...club.players, own] : club.players })) };
    const memory = getPlayerKnowledge(moved, own.id);
    expect(memory).toMatchObject({ kind: 'report', level: 3, attributes: null, source: 'squad', observedClubId: clubId });
    expect(memory.ranges).not.toBeNull();
    const incoming = getPlayerKnowledge(moved, own.id, otherClubId);
    expect(incoming).toMatchObject({ kind: 'own', attributes: own.attributes, ranges: null });
    expect(refreshSquadKnowledge(state).activeMatch).toBe(state.activeMatch);
    expect(setShortlisted(moved, own.id, true).scouting.clubs[clubId]!.shortlist).toContain(own.id);
  });
});

describe('fair scouting automation', () => {
  it('uses neutral unknown ratings and independent club knowledge instead of outsider truth', () => {
    const initial = create();
    let state = initial;
    expect(scoutingRecruitmentRating(state, clubId, target.id)).toBe(10.5 * 7);
    expect(scoutingRecruitmentRating(state, clubId, outside[9]!.id)).toBe(10.5 * 7);
    state = observe(state);
    const report = getPlayerKnowledge(state, target.id);
    const mean = Object.values(report.ranges!).reduce((sum, range) => sum + (range.min + range.max) / 2, 0);
    expect(scoutingRecruitmentRating(state, clubId, target.id)).toBe(mean);
    expect(scoutingRecruitmentRating(state, otherClubId, target.id)).toBe(Object.values(target.attributes).reduce((sum, value) => sum + value, 0));
    expect(state.activeMatch).toBe(initial.activeMatch);
  });

  it('is deterministic, leaves frozen inputs untouched and never creates singleton ranges at rating boundaries', () => {
    const state = freeze(create());
    expect(setScoutingDelegation(state, true)).toEqual(setScoutingDelegation(state, true));
    for (const value of [1, 20]) {
      const attributes = Object.fromEntries(SCOUTING_ATTRIBUTES.map(attribute => [attribute, value])) as unknown as typeof target.attributes;
      for (const level of [1, 2, 3]) for (const range of Object.values(scoutingRanges(71, clubId, target.id, attributes, level, 0))) expect(range.max - range.min).toBeGreaterThanOrEqual(2);
    }
    expect(prepareScoutingAssignments({ ...state, status: 'complete' }).scouting).toBe(state.scouting);
    expect(state.scouting.clubs[clubId]!.assignments).toEqual([]);
  });
});
