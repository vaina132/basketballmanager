import { describe, expect, it } from 'vitest';
import type { SeasonState, FixtureResult } from '../src/domain/season';
import { createSeason, createSchedule, dateForRound } from '../src/world/season';
import { rosterForRound } from '../src/world/rosters';
import { agreeSquadRole, applyRelationshipEvent, automateRelationships, createRelationships, enableRelationships, getPlayerRelationship, getPreparedRelationshipMorale, getSquadRelationships, prepareRelationshipsRound, quoteRelationshipTalk, quoteSquadRole, relationshipEventAnchor, relationshipsAtEventCount, talkToPlayer } from '../src/world/relationships';

const clubId = 'rhine-falcons';
const initial = () => enableRelationships(createSeason(227, clubId, 'off', false, false, false, false));
const target = (state: SeasonState) => state.clubs.find(club => club.id === clubId)!.players[0]!.id;
const freeze = <T>(value: T): T => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };

/** Explicit policy fixtures with controlled minutes/eligibility, never presented as valid career exports. */
function atRound(state: SeasonState, nextRound: number, minutes: number | number[] = 0, excluded: Record<number, 'injury' | 'fouls' | 'default'> = {}): SeasonState {
  const playerId = target(state), baseline = Object.values(state.activeMatch!.stats)[0]!;
  return { ...state, round: Math.min(nextRound, 10), date: dateForRound(Math.min(nextRound, 10)), status: nextRound > 10 ? 'complete' : 'active', fixtures: state.fixtures.map(fixture => {
    if (fixture.round >= nextRound) return { ...fixture, result: null };
    const home = rosterForRound(state.rosters, fixture.homeClubId, fixture.round), away = rosterForRound(state.rosters, fixture.awayClubId, fixture.round);
    const result: FixtureResult = { score: { home: 70, away: 60 }, officialScore: { home: 70, away: 60 }, winnerClubId: fixture.homeClubId, kind: excluded[fixture.round] === 'default' ? 'default' : 'normal', periods: 4, rosterIds: { home: home.id, away: away.id }, injuries: excluded[fixture.round] === 'injury' ? { [playerId]: 'ankle-sprain' } : {}, stats: Object.fromEntries([...home.players, ...away.players].map(player => [player.id, { ...baseline, secondsPlayed: 60 * (player.id === playerId ? typeof minutes === 'number' ? minutes : minutes[fixture.round - 1] ?? 0 : 20), fouls: player.id === playerId && excluded[fixture.round] === 'fouls' ? 5 : 0 }])) };
    return { ...fixture, result };
  }) };
}

describe('roles, meaningful conversations and dated playing-time promises', () => {
  it('opts in prospectively and freezes neutral exact-roster morale without mutating a prepared match', () => {
    const before = freeze(createSeason(227, clubId, 'off', false, false, false, false)), enabled = enableRelationships(before);
    expect(before.relationships).toEqual(createRelationships());
    expect(enabled.activeMatch!).toBe(before.activeMatch!);
    expect(getPreparedRelationshipMorale(enabled)).toBeUndefined();
    expect(enableRelationships(enabled)).toBe(enabled);
    const prepared = prepareRelationshipsRound(enabled), snapshot = getPreparedRelationshipMorale(prepared)!;
    expect(snapshot.eventCount).toBe(1);
    expect(Object.keys(snapshot.values)).toHaveLength(60);
    expect(new Set(Object.values(snapshot.values))).toEqual(new Set([50]));
    expect(prepareRelationshipsRound(prepared)).toBe(prepared);
    const event = structuredClone(prepared.relationships.events[0]!);
    if (event.type !== 'prepare') throw new Error('Expected preparation.');
    event.values = Object.fromEntries(Object.entries(event.values).reverse()); event.rosterIds = Object.fromEntries(Object.entries(event.rosterIds).reverse());
    expect(applyRelationshipEvent(enabled, event).relationships.events[0]).toEqual(event);
    expect(relationshipsAtEventCount(prepared.relationships, 0)).toEqual(enabled.relationships);
    expect(() => relationshipsAtEventCount(prepared.relationships, 2)).toThrow(/existing/);
  });

  it('counts healthy nonappearances, evaluates rolling eligible averages and never penalizes extra minutes', () => {
    const state = initial(), id = target(state);
    expect(getPlayerRelationship(atRound(state, 3), id).concern).toBeNull();
    expect(getPlayerRelationship(atRound(state, 4), id)).toMatchObject({ eligibleGames: 3, averageMinutes: 0, minMinutes: 12 });
    expect(getPlayerRelationship(atRound(state, 4), id).concern).toMatch(/below/);
    expect(getPlayerRelationship(atRound(state, 5, [0, 0, 0, 48]), id)).toMatchObject({ eligibleGames: 4, averageMinutes: 12, concern: null });
    expect(getPlayerRelationship(atRound(state, 6, 40), id)).toMatchObject({ eligibleGames: 4, averageMinutes: 40, concern: null });
  });

  it('exempts injuries, disqualifications and default results instead of fabricating eligible opportunities', () => {
    const state = initial(), id = target(state), status = getPlayerRelationship(atRound(state, 5, 0, { 1: 'injury', 2: 'fouls', 3: 'default' }), id);
    expect(status).toMatchObject({ eligibleGames: 1, averageMinutes: 0, concern: null });
    expect(status.evidenceFixtureIds).toHaveLength(1);
  });

  it('limits explanations to real concerns and prevents repeat conversation farming', () => {
    const state = initial(), id = target(state);
    expect(quoteRelationshipTalk(state, id, 'explain').canTalk).toBe(false);
    const concerned = freeze(atRound(state, 4)), explained = talkToPlayer(concerned, id, 'explain');
    expect(getPlayerRelationship(explained, id).trust).toBe(52);
    expect(getPlayerRelationship(explained, id).concern).not.toBeNull();
    expect(() => talkToPlayer(explained, id, 'explain')).toThrow(/4 more/);
    expect(quoteRelationshipTalk(atRound(explained, 7), id, 'explain').canTalk).toBe(false);
    const later = talkToPlayer(atRound(explained, 8), id, 'explain');
    expect(getPlayerRelationship(later, id).trust).toBeLessThan(54);
    expect(concerned.relationships.events).toHaveLength(0);
  });

  it('uses explicit role agreements, protects regulation minutes and cannot erase a concern with an upgrade', () => {
    let state = initial(); const id = target(state), players = state.clubs.find(club => club.id === clubId)!.players;
    expect(quoteSquadRole(state, id, 'development').canAgree).toBe(false);
    expect(quoteSquadRole(state, id, 'rotation').reason).toMatch(/already/);
    for (const player of players.slice(0, 6)) state = agreeSquadRole(state, player.id, 'starter');
    expect(quoteSquadRole(state, players[6]!.id, 'starter')).toMatchObject({ totalMinimum: 204, canAgree: false });
    const concern = atRound(initial(), 4);
    expect(quoteSquadRole(concern, id, 'starter').reason).toMatch(/existing playing-time concern/);
    const reduced = agreeSquadRole(concern, id, 'development');
    expect(getPlayerRelationship(reduced, id)).toMatchObject({ roleLabel: 'Reserve', minMinutes: 0, trust: 46, concern: null });
    expect(getPlayerRelationship(atRound(reduced, 8), id).reasons[0]!.label).toBe('Reserve role accepted');
  });

  it('starts promises after the current matchday, preserves commitments and settles only real eligible evidence', () => {
    const state = atRound(initial(), 4), id = target(state), promised = talkToPlayer(state, id, 'minutes-promise');
    expect(getPlayerRelationship(promised, id).promise).toMatchObject({ targetMinutes: 12, eligibleGames: 0, remainingClubGames: 6 });
    expect(getPlayerRelationship(atRound(promised, 5, 40), id).promise).toMatchObject({ eligibleGames: 0, remainingClubGames: 6 });
    expect(quoteSquadRole(promised, id, 'development').reason).toMatch(/active playing-time promise/);
    const kept = getPlayerRelationship(atRound(promised, 8, 12), id), broken = getPlayerRelationship(atRound(promised, 8), id);
    expect(kept.promise).toBeNull(); expect(kept.promises[0]).toMatchObject({ status: 'kept', eligibleGames: 3, averageMinutes: 12, outcomeDate: dateForRound(7) });
    expect(kept.trust).toBeGreaterThan(50);
    expect(broken.promises[0]!.status).toBe('broken'); expect(broken.trust).toBeLessThan(50);
    const exempt = getPlayerRelationship(atRound(promised, 11, 0, { 5: 'injury', 6: 'injury', 7: 'fouls', 8: 'default' }), id);
    expect(exempt.promises[0]).toMatchObject({ status: 'unresolved', eligibleGames: 2, remainingClubGames: 0 });
    expect(exempt.trust).toBe(50);
  });

  it('keeps prior commitments after arrivals and permits an honest staged reduction of an overcommitted plan', () => {
    let state = initial(); const club = state.clubs.find(club => club.id === clubId)!;
    for (const player of club.players.slice(0, 6)) state = agreeSquadRole(state, player.id, 'starter');
    const arrivals = state.clubs.find(club => club.id !== clubId)!.players.slice(0, 2);
    state = { ...atRound(state, 6, 30), clubs: state.clubs.map(club => club.id === clubId ? { ...club, players: [...club.players, ...arrivals] } : club) };
    expect(getSquadRelationships(state).reduce((sum, row) => sum + row.minMinutes, 0)).toBe(216);
    expect(quoteSquadRole(state, club.players[6]!.id, 'development')).toMatchObject({ totalMinimum: 204, canAgree: true, trustChange: -4 });
    state = agreeSquadRole(state, club.players[6]!.id, 'development');
    expect(getSquadRelationships(state).reduce((sum, row) => sum + row.minMinutes, 0)).toBe(204);
    expect(quoteSquadRole(state, club.players[7]!.id, 'starter').canAgree).toBe(false);
    expect(quoteSquadRole(state, club.players[7]!.id, 'development')).toMatchObject({ totalMinimum: 192, canAgree: true });
  });

  it('closes departed promises neutrally and does not reuse an earlier stint role for a returning player', () => {
    const base = initial(), id = target(base), club = base.clubs.find(club => club.id === clubId)!;
    const oldRole = agreeSquadRole(base, id, 'starter');
    const promised = talkToPlayer(atRound(oldRole, 5), id, 'minutes-promise');
    const roster = base.rosters.find(roster => roster.clubId === clubId)!;
    const returnState = { ...promised, rosters: [...promised.rosters, { ...roster, id: `${roster.id}-depart`, fromRound: 6, players: roster.players.filter(player => player.id !== id) }, { ...roster, id: `${roster.id}-return`, fromRound: 7, players: [...club.players] }] };
    const current = atRound(returnState, 10);
    expect(getPlayerRelationship(current, id)).toMatchObject({ role: 'rotation', trust: 50 });
    expect(getPlayerRelationship(current, id).promises[0]).toMatchObject({ status: 'departed', outcomeDate: dateForRound(6) });
    const renewed = talkToPlayer(current, id, 'minutes-promise');
    expect(getPlayerRelationship(renewed, id).promise).toMatchObject({ targetMinutes: 12, deadlineRound: 16 });
  });

  it('retains an already closed unresolved promise when the player leaves in a later season', () => {
    const state = atRound(initial(), 4), id = target(state), promised = talkToPlayer(state, id, 'minutes-promise');
    const complete = atRound(promised, 11, 0, { 5: 'injury', 6: 'injury', 7: 'fouls', 8: 'default' });
    const before = getPlayerRelationship(complete, id).promises[0]!;
    expect(before.status).toBe('unresolved');
    const clubs = complete.clubs.map(club => club.id === clubId ? { ...club, players: club.players.filter(player => player.id !== id) } : club);
    const next: SeasonState = { ...complete, seasonNumber: 2, round: 1, status: 'active', date: dateForRound(1, 2), clubs, fixtures: createSchedule(clubs, 2), history: [{ seasonNumber: 1, rosters: complete.rosters, fixtures: complete.fixtures.map(fixture => ({ ...fixture, result: fixture.result! })) }], rosters: complete.rosters.map(roster => ({ ...roster, id: `${roster.id}-year2`, players: roster.clubId === clubId ? roster.players.filter(player => player.id !== id) : roster.players })) };
    expect(getPlayerRelationship(next, id).promises[0]).toEqual(before);
  });

  it('keeps squad evidence chronological when fixture and roster storage order differs', () => {
    const state = atRound(initial(), 6, [4, 8, 12, 16, 20]);
    const expected = getSquadRelationships(freeze(structuredClone(state)));
    const shuffled = freeze({ ...state, fixtures: [...state.fixtures].reverse(), rosters: [...state.rosters].reverse() });
    expect(getSquadRelationships(shuffled)).toEqual(expected);
    expect(getPlayerRelationship(shuffled, target(state))).toEqual(expected[0]);
    const missing = { ...state, rosters: state.rosters.filter(roster => roster.clubId !== clubId) };
    expect(() => getSquadRelationships(missing)).toThrow(/roster|registration/i);
  });

  it('finds the last four eligible games even when the latest three opportunities were excluded', () => {
    const state = atRound(initial(), 10, [1, 2, 3, 4, 5, 6, 7, 8, 9], { 7: 'injury', 8: 'fouls', 9: 'default' });
    const row = getPlayerRelationship(freeze(state), target(state));
    expect(row).toMatchObject({ eligibleGames: 4, averageMinutes: 4.5 });
    expect(row.evidenceFixtureIds).toEqual([3, 4, 5, 6].map(round => state.fixtures.find(fixture => fixture.round === round && [fixture.homeClubId, fixture.awayClubId].includes(clubId))!.id));
  });

  it('counts the promise deadline itself and excludes an eligible result dated after the current boundary', () => {
    const concern = atRound(initial(), 4), promised = talkToPlayer(concern, target(concern), 'minutes-promise');
    const state = atRound(promised, 11, [0, 0, 0, 0, 0, 0, 0, 28, 30, 32], { 5: 'injury', 6: 'fouls', 7: 'default' });
    const id = target(state), before = getPlayerRelationship(state, id).promises[0]!;
    expect(before).toMatchObject({ status: 'kept', eligibleGames: 3, averageMinutes: 30, outcomeDate: dateForRound(10) });
    const last = state.fixtures.find(fixture => fixture.round === 10 && [fixture.homeClubId, fixture.awayClubId].includes(clubId))!;
    last.date = dateForRound(1, 2);
    expect(getPlayerRelationship(state, id).promises[0]).toMatchObject({ status: 'unresolved', eligibleGames: 2, averageMinutes: 29 });
    expect(before.status).toBe('kept');
  });

  it('reads a newly appended role decision on the next calculation using the same state object', () => {
    const state = atRound(initial(), 5), id = target(state), before = getSquadRelationships(state);
    const changed = agreeSquadRole(state, id, 'development');
    state.relationships.events.push(changed.relationships.events.at(-1)!);
    expect(getSquadRelationships(state)[0]).toMatchObject({ role: 'development', minMinutes: 0 });
    expect(getPlayerRelationship(state, id)).toEqual(getSquadRelationships(state)[0]);
    expect(before[0]!.role).toBe('rotation');
  });

  it('rechecks edited minutes, eligibility and dates on the next call with the same state object', () => {
    const state = atRound(initial(), 5, 20), id = target(state);
    const before = getSquadRelationships(state)[0]!;
    expect(before).toMatchObject({ eligibleGames: 4, averageMinutes: 20 });
    const fixture = state.fixtures.find(fixture => fixture.round === 4 && [fixture.homeClubId, fixture.awayClubId].includes(clubId))!;
    fixture.result!.stats[id]!.secondsPlayed = 0;
    expect(getSquadRelationships(state)[0]).toMatchObject({ eligibleGames: 4, averageMinutes: 15 });
    fixture.result!.stats[id]!.fouls = 5;
    expect(getSquadRelationships(state)[0]).toMatchObject({ eligibleGames: 3, averageMinutes: 20 });
    state.date = dateForRound(2);
    expect(getSquadRelationships(state)[0]).toMatchObject({ eligibleGames: 2, averageMinutes: 20 });
    expect(before).toMatchObject({ eligibleGames: 4, averageMinutes: 20 });
  });

  it('rechecks a departure and return appended after reading the same squad', () => {
    const base = initial(), id = target(base);
    const state = atRound(agreeSquadRole(base, id, 'starter'), 6, 24);
    expect(getSquadRelationships(state)[0]!.role).toBe('starter');
    const roster = state.rosters.find(roster => roster.clubId === clubId)!;
    state.rosters.push({ ...roster, id: `${roster.id}-depart`, fromRound: 4, players: roster.players.filter(player => player.id !== id) });
    state.rosters.push({ ...roster, id: `${roster.id}-return`, fromRound: 5, players: [...roster.players] });
    expect(getSquadRelationships(state)[0]).toMatchObject({ role: 'rotation', eligibleGames: 1, averageMinutes: 24 });
    expect(getPlayerRelationship(state, id)).toEqual(getSquadRelationships(state)[0]);
  });

  it('freezes the same round for all matches and AI obeys normal conversation guards', () => {
    const concerned = prepareRelationshipsRound(atRound(initial(), 4)), id = target(concerned), before = getPreparedRelationshipMorale(concerned)!;
    const spoken = talkToPlayer(concerned, id, 'explain');
    expect(getPlayerRelationship(spoken, id).morale).toBeGreaterThan(getPlayerRelationship(concerned, id).morale);
    expect(getPreparedRelationshipMorale(spoken)).toEqual(before);
    const automatic = automateRelationships(atRound(initial(), 4));
    expect(automatic.relationships.events.filter(event => event.type !== 'prepare' && event.clubId === clubId)).toHaveLength(0);
    expect(automateRelationships(automatic)).toEqual(automatic);
    expect(getSquadRelationships(automatic).every(row => row.morale >= 0 && row.morale <= 100)).toBe(true);
    const event = { ...relationshipEventAnchor(spoken), id: 'relationship-event-3', type: 'talk' as const, clubId, playerId: id, choice: 'explain' as const };
    expect(() => applyRelationshipEvent(spoken, { ...event, completedRounds: 0 })).toThrow(/exact calendar/);
  });
});
