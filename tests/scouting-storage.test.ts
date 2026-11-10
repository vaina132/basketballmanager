import { stripInSeasonRecruitment } from './helpers/legacy-season';
import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import type { ScoutingReview } from '../src/domain/scouting';
import { DEVELOPMENT_PLAYERS } from '../src/data/development-players';
import { getSeasonWage } from '../src/data/development-wages';
import { setAutoSubstitutions, simulateToEnd, stepMatch } from '../src/engine/match';
import { parseSeason, serializeSeason, validateSeasonState } from '../src/storage/season-storage';
import { offerPlayerContract } from '../src/world/employment';
import { getAvailablePlayers } from '../src/world/employment-policy';
import { assignScouting, enableScouting, setShortlisted } from '../src/world/scouting';
import { getPlayerKnowledge } from '../src/world/scouting-policy';
import { advanceSeason, createSeason, managedSide, rolloverSeason } from '../src/world/season';

const clubId = 'aegean-waves';
const play = (state: SeasonState): SeasonState => advanceSeason({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) });
function complete(state: SeasonState): SeasonState { while (state.status === 'active') state = play(state); return state; }
const envelope = (state: unknown, formatVersion = 19) => JSON.stringify({ format: 'basketball-manager-season', formatVersion, engineVersion: 'possession-3', state });
const office = (state: SeasonState) => state.scouting.clubs[clubId]!;
const firstPositive = (state: SeasonState): ScoutingReview => office(state).reviews.find(review => review.outcome === 'observed')!;

let initial: SeasonState, pending: SeasonState, second: SeasonState, third: SeasonState, fourth: SeasonState, completed: SeasonState, nextYear: SeasonState;
beforeAll(() => {
  initial = createSeason(9, clubId, 'standard', true, true, true, true, null, true, true);
  pending = assignScouting(assignScouting(setShortlisted(initial, 'atl-10', true), 'atl-8'), 'atl-10');
  second = play(pending);
  third = play(assignScouting(assignScouting(second, 'atl-8'), 'atl-10'));
  fourth = play(assignScouting(third, 'atl-10'));
  completed = complete(fourth);
  const own = completed.clubs.find(club => club.id === clubId)!;
  let recruited = completed;
  for (const player of own.players.slice(0, 7)) recruited = offerPlayerContract(recruited, player.id, getSeasonWage(player.id), 1);
  const incoming = getAvailablePlayers(recruited).find(player => !own.players.some(member => member.id === player.id))!;
  recruited = offerPlayerContract(recruited, incoming.id, getSeasonWage(incoming.id), 2);
  nextYear = rolloverSeason(recruited);
}, 60_000);

describe('scouting report persistence', () => {
  it('round-trips pending missions, repeated observations, unavailability and rollover without changing the match stream', () => {
    for (const state of [initial, pending, second, third, fourth, completed, nextYear]) {
      const restored = parseSeason(serializeSeason(state));
      expect(restored).toEqual(state);
      expect(stepMatch(restored.activeMatch)).toEqual(stepMatch(state.activeMatch));
      expect(getPlayerKnowledge(restored, 'atl-10')).toEqual(getPlayerKnowledge(state, 'atl-10'));
    }
  });

  it('preserves three separate observations and never exports exact outsider ratings through knowledge', () => {
    const reviews = office(fourth).reviews.filter(review => review.playerId === 'atl-10');
    expect(reviews.map(review => review.round)).toEqual([1, 2, 3]);
    expect(reviews.every(review => review.outcome === 'observed')).toBe(true);
    const restored = parseSeason(serializeSeason(fourth));
    const knowledge = getPlayerKnowledge(restored, 'atl-10');
    expect(knowledge.level).toBe(3);
    expect(knowledge.attributes).toBeNull();
    expect(Object.values(knowledge.ranges!).every(range => range.min < range.max)).toBe(true);
    expect(office(restored).shortlist).toContain('atl-10');
  });

  it('retains a no-minutes review without inventing an observation or raising knowledge level', () => {
    const reviews = office(third).reviews.filter(review => review.playerId === 'atl-8');
    expect(reviews.map(review => review.outcome)).toEqual(['observed', 'no-minutes']);
    expect(reviews[1]!.attributes).toBeNull();
    const knowledge = getPlayerKnowledge(parseSeason(serializeSeason(third)), 'atl-8');
    expect(knowledge.level).toBe(1);
    expect(knowledge.observations).toBe(1);
    expect(knowledge.observedOn).toBe(second.fixtures.find(fixture => fixture.round === 1)!.date);
  });

  it('retains historical source clubs and squad memories after players change registration', () => {
    const oldOffice = office(completed), newOffice = office(nextYear);
    expect(newOffice.reviews).toEqual(oldOffice.reviews);
    const oldOwn = completed.clubs.find(club => club.id === clubId)!.players;
    const newOwn = nextYear.clubs.find(club => club.id === clubId)!.players;
    const departed = oldOwn.find(player => !newOwn.some(member => member.id === player.id))!;
    expect(newOffice.squadKnowledge[departed.id]).toEqual(oldOffice.squadKnowledge[departed.id]);
    const memory = getPlayerKnowledge(nextYear, departed.id);
    expect(memory).toMatchObject({ kind: 'report', source: 'squad', attributes: null, observedClubId: clubId, freshness: 'stale' });
    const changedReport = Object.values(nextYear.scouting.clubs).flatMap(club => club.reviews).find(review => nextYear.clubs.find(club => club.players.some(player => player.id === review.playerId))?.id !== review.clubId);
    expect(changedReport).toBeDefined();
    expect(parseSeason(serializeSeason(nextYear))).toEqual(nextYear);
  });

  it('migrates an actual format 10 career with transfers and retains all prior state while scouting remains disabled', () => {
    const previous = structuredClone(nextYear) as unknown as Record<string, unknown>;
    stripInSeasonRecruitment(previous); delete (previous.employment as Record<string, unknown>).transfers; delete (previous.employment as Record<string, unknown>).buyouts; delete previous.market; delete previous.scouting; delete previous.negotiations; previous.schemaVersion = 10;
    const restored = parseSeason(envelope(previous, 10));
    expect(restored.scouting.enabledSince).toBeNull();
    expect(restored.employment).toEqual(nextYear.employment);
    expect(restored.clubs).toEqual(nextYear.clubs);
    expect(restored.history).toEqual(nextYear.history);
    expect(restored.activeMatch).toEqual(nextYear.activeMatch);
    expect(Object.values(restored.scouting.clubs).every(club => !club.reviews.length && !club.assignments.length && !Object.keys(club.squadKnowledge).length)).toBe(true);
    const enabled = enableScouting(restored);
    expect(parseSeason(serializeSeason(enabled))).toEqual(enabled);
  });

  it('records explicit midseason and completed-season activation boundaries', () => {
    const midseason = enableScouting(play(createSeason(9, clubId, 'off')));
    expect(midseason.scouting.enabledSince).toEqual({ seasonNumber: 1, round: 2 });
    expect(parseSeason(serializeSeason(midseason))).toEqual(midseason);
    const end = enableScouting(complete(createSeason(9, clubId, 'off')));
    expect(Object.values(end.scouting.clubs).every(club => club.assignments.length === 0)).toBe(true);
    expect(parseSeason(serializeSeason(end))).toEqual(end);
  });
});

describe('scouting save validation', () => {
  const mutations: Array<[string, (state: SeasonState) => void]> = [
    ['missing scouting', state => { delete (state as Partial<SeasonState>).scouting; }],
    ['unknown model', state => { Object.assign(state.scouting, { model: 'unknown' }); }],
    ['false disabled marker', state => { state.scouting.enabledSince = null; }],
    ['future activation', state => { state.scouting.enabledSince!.round = 5; }],
    ['missing scouting office', state => { delete state.scouting.clubs[clubId]; }],
    ['invalid delegation', state => { Object.assign(office(state), { delegated: 'true' }); }],
    ['duplicate shortlist', state => { office(state).shortlist.push('atl-10'); }],
    ['unknown shortlisted player', state => { office(state).shortlist.push('unknown'); }],
    ['unknown assigned player', state => { office(state).assignments = [{ playerId: 'unknown', seasonNumber: 1, round: 4 }]; }],
    ['own squad assignment', state => { office(state).assignments = [{ playerId: state.clubs.find(club => club.id === clubId)!.players[0]!.id, seasonNumber: 1, round: 4 }]; }],
    ['past pending assignment', state => { office(state).assignments = [{ playerId: 'atl-10', seasonNumber: 1, round: 3 }]; }],
    ['too many pending assignments', state => { office(state).assignments = ['atl-1', 'atl-2', 'atl-3'].map(playerId => ({ playerId, seasonNumber: 1, round: 4 })); }],
    ['duplicate pending assignment', state => { office(state).assignments = ['atl-1', 'atl-1'].map(playerId => ({ playerId, seasonNumber: 1, round: 4 })); }],
    ['future review', state => { firstPositive(state).round = 4; }],
    ['invented review date', state => { firstPositive(state).date = '2026-09-06'; }],
    ['wrong source club', state => { firstPositive(state).clubId = clubId; }],
    ['wrong source roster', state => { firstPositive(state).rosterId = state.rosters[0]!.id; }],
    ['unknown observed player', state => { firstPositive(state).playerId = 'unknown'; }],
    ['duplicate completed observation', state => { office(state).reviews.push(structuredClone(office(state).reviews.at(-1)!)); }],
    ['rewritten no-minutes result', state => { office(state).reviews.find(review => review.outcome === 'no-minutes')!.outcome = 'observed'; }],
    ['ratings for unavailable player', state => { office(state).reviews.find(review => review.outcome === 'no-minutes')!.attributes = structuredClone(firstPositive(state).attributes); }],
    ['missing observed ratings', state => { firstPositive(state).attributes = null; }],
    ['unknown observed skill', state => { Object.assign(firstPositive(state).attributes!, { invented: 12 }); }],
    ['rating beyond development', state => { Object.assign(firstPositive(state).attributes!, { passing: 20 }); }],
    ['rating below base', state => { Object.assign(firstPositive(state).attributes!, { passing: 1 }); }],
    ['fractional rating', state => { Object.assign(firstPositive(state).attributes!, { passing: 12.5 }); }],
    ['wrong latest squad boundary', state => { Object.values(office(state).squadKnowledge)[0]!.round = 2; }],
    ['missing own-squad knowledge', state => { delete office(state).squadKnowledge[Object.keys(office(state).squadKnowledge)[0]!]; }],
    ['unearned own-squad knowledge', state => { const known = structuredClone(Object.values(office(state).squadKnowledge)[0]!); known.playerId = 'atl-1'; office(state).squadKnowledge['atl-1'] = known; }],
  ];
  it.each(mutations)('rejects %s before replacing the open career', (_name, mutate) => {
    const state = structuredClone(fourth); mutate(state);
    expect(() => validateSeasonState(state)).toThrow();
    expect(() => parseSeason(envelope(state))).toThrow();
  });

  it('rejects a third report for the same observer and matchday', () => {
    const state = structuredClone(second), reports = office(state).reviews;
    const source = Object.values(state.scouting.clubs).flatMap(club => club.reviews).find(review => review.clubId !== clubId && !reports.some(existing => existing.playerId === review.playerId));
    expect(source).toBeDefined();
    reports.push(structuredClone(source!));
    expect(() => validateSeasonState(state)).toThrow(/two-assignment/);
  });

  it('rejects current rosters replacing the recorded origin of moved-player observations', () => {
    const state = structuredClone(nextYear);
    const review = Object.values(state.scouting.clubs).flatMap(club => club.reviews).find(review => state.clubs.find(club => club.players.some(player => player.id === review.playerId))?.id !== review.clubId)!;
    const destination = state.clubs.find(club => club.players.some(player => player.id === review.playerId));
    review.clubId = destination?.id ?? clubId;
    expect(() => validateSeasonState(state)).toThrow();
  });

  it('rejects a rewritten old rating that contradicts a later observation while staying within current development bounds', () => {
    let state = createSeason(9, clubId, 'off', true, true, true, true, null, false, true);
    state = { ...state, training: { ...state.training, plans: { ...state.training.plans, 'atlantic-pilots': { ...state.training.plans['atlantic-pilots']!, delegated: false, intensity: 'heavy', focus: 'passing' } } } };
    state = play(assignScouting(state, 'atl-10'));
    state = play(assignScouting(state, 'atl-10'));
    while (state.round < 7) state = play(state);
    expect(() => validateSeasonState(state)).not.toThrow();
    const reviews = office(state).reviews.filter(review => review.playerId === 'atl-10');
    const first = reviews[0]!;
    Object.assign(first.attributes!, { passing: first.attributes!.passing + 1 });
    expect(() => validateSeasonState(state)).toThrow(/simultaneous observations|non-decreasing development/);
  });

  it('rejects pending offseason or unregistered-player missions', () => {
    const closed = structuredClone(completed);
    office(closed).assignments = [{ playerId: 'atl-10', seasonNumber: 1, round: 10 }];
    expect(() => validateSeasonState(closed)).toThrow(/active matchday/);
    const state = structuredClone(nextYear);
    const free = DEVELOPMENT_PLAYERS.find(player => !state.clubs.some(club => club.players.some(member => member.id === player.id)))!;
    office(state).assignments = [{ playerId: free.id, seasonNumber: 2, round: 1 }];
    expect(() => validateSeasonState(state)).toThrow(/registered player/);
  });
});
