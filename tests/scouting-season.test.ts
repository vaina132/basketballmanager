import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { getSeasonWage } from '../src/data/development-wages';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { offerPlayerContract } from '../src/world/employment';
import { getAvailablePlayers } from '../src/world/employment-policy';
import { assignScouting, enableScouting, setShortlisted } from '../src/world/scouting';
import { getPlayerKnowledge, SCOUTING_ATTRIBUTES, scoutingRecruitmentRating } from '../src/world/scouting-policy';
import { advanceSeason, createSeason, managedSide, rolloverSeason } from '../src/world/season';

function play(state: SeasonState): SeasonState {
  return advanceSeason({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch!, managedSide(state), true)) });
}
function finish(state: SeasonState): SeasonState { while (state.status === 'active') state = play(state); return state; }

describe('scouting in the career calendar', () => {
  let initial: SeasonState, threeReports: SeasonState, completed: SeasonState;
  const targetId = 'aeg-1';
  beforeAll(() => {
    initial = createSeason(43, 'rhine-falcons', 'off', true, true, true, true, null, true, true);
    threeReports = setShortlisted(initial, targetId, true);
    for (let round = 1; round <= 3; round++) threeReports = play(assignScouting(threeReports, targetId));
    completed = finish(threeReports);
  }, 30_000);

  it('delivers actual matchday reports before advancing and retains all clubs’ queues', () => {
    const first = play(assignScouting(initial, targetId));
    const report = first.scouting.clubs[first.managedClubId]!.reviews[0]!;
    expect(report).toMatchObject({ playerId: targetId, seasonNumber: 1, round: 1, date: initial.date, outcome: 'observed' });
    expect(first.round).toBe(2);
    expect(getPlayerKnowledge(first, targetId)).toMatchObject({ kind: 'report', level: 1, observedOn: initial.date, ageDays: 7, attributes: null });
    for (const club of first.clubs.filter(club => club.id !== first.managedClubId)) {
      expect(first.scouting.clubs[club.id]!.assignments).toHaveLength(2);
      expect(first.scouting.clubs[club.id]!.assignments.every(item => item.round === 2)).toBe(true);
      expect(first.scouting.clubs[club.id]!.reviews).toHaveLength(2);
    }
    expect(parseSeason(serializeSeason(first))).toEqual(first);
  });

  it('improves knowledge over separate appearances without changing the played competition', () => {
    const knowledge = getPlayerKnowledge(threeReports, targetId);
    expect(knowledge).toMatchObject({ kind: 'report', level: 3, observations: 3, attributes: null });
    for (const range of Object.values(knowledge.ranges!)) expect(range.max).toBeGreaterThan(range.min);
    const withoutScouting = finish(createSeason(43, 'rhine-falcons', 'off', true, true, true, true, null, true));
    expect(completed.fixtures).toEqual(withoutScouting.fixtures);
    expect(completed.activeMatch!).toEqual(withoutScouting.activeMatch!);
    expect(completed.training).toEqual(withoutScouting.training);
    expect(completed.finance).toEqual(withoutScouting.finance);
    expect(completed.scouting.clubs[completed.managedClubId]!.shortlist).toEqual([targetId]);
    expect(parseSeason(serializeSeason(completed))).toEqual(completed);
  }, 30_000);

  it('records a zero-minute assignment without inventing a skill assessment', () => {
    const injured = play(createSeason(325, 'aegean-waves', 'standard', true, true, true, true, null, true, true));
    expect(injured.injuries.some(injury => injury.playerId === 'atl-9' && injury.returnOn > injured.date)).toBe(true);
    const next = play(assignScouting(injured, 'atl-9'));
    expect(next.scouting.clubs[next.managedClubId]!.reviews[0]).toMatchObject({ playerId: 'atl-9', outcome: 'no-minutes', attributes: null });
    expect(getPlayerKnowledge(next, 'atl-9')).toMatchObject({ kind: 'unknown', observations: 0, ranges: null, attributes: null });
    expect(parseSeason(serializeSeason(next))).toEqual(next);
  });

  it('carries shortlists and uncertain former-squad memory through real transfers and offseason aging', () => {
    let market = completed;
    const own = market.clubs.find(club => club.id === market.managedClubId)!;
    const departedId = own.players[9]!.id;
    market = setShortlisted(market, departedId, true);
    for (const player of own.players.slice(0, 7)) market = offerPlayerContract(market, player.id, getSeasonWage(player.id), 1);
    const arrival = getAvailablePlayers(market).find(player => !own.players.some(member => member.id === player.id))!;
    market = offerPlayerContract(market, arrival.id, getSeasonWage(arrival.id), 1);
    const oldKnowledge = getPlayerKnowledge(market, targetId);
    const next = rolloverSeason(market);
    expect(getPlayerKnowledge(next, arrival.id).kind).toBe('own');
    expect(getPlayerKnowledge(next, departedId)).toMatchObject({ kind: 'report', source: 'squad', level: 3, attributes: null, freshness: 'stale', observedOn: completed.date });
    expect(next.scouting.clubs[next.managedClubId]!.shortlist).toEqual([targetId, departedId]);
    const aged = getPlayerKnowledge(next, targetId);
    expect(aged.freshness).toBe('stale');
    for (const key of SCOUTING_ATTRIBUTES) {
      expect(aged.ranges![key].min).toBeLessThanOrEqual(oldKnowledge.ranges![key].min);
      expect(aged.ranges![key].max).toBeGreaterThanOrEqual(oldKnowledge.ranges![key].max);
    }
    expect(parseSeason(serializeSeason(next))).toEqual(next);
    const continued = play(next);
    expect(parseSeason(serializeSeason(continued))).toEqual(continued);
  }, 30_000);

  it('keeps stored outsider reports and AI evaluation independent of new hidden development', () => {
    const before = getPlayerKnowledge(threeReports, targetId);
    const changed: SeasonState = { ...threeReports, training: { ...threeReports.training, points: { ...threeReports.training.points, [targetId]: Object.fromEntries(SCOUTING_ATTRIBUTES.map(key => [key, Math.min(200, threeReports.training.points[targetId]![key] + 100)])) as typeof threeReports.training.points[string] } } };
    expect(getPlayerKnowledge(changed, targetId)).toEqual(before);
    expect(scoutingRecruitmentRating(changed, changed.managedClubId, targetId)).toBe(scoutingRecruitmentRating(threeReports, threeReports.managedClubId, targetId));
    const legacy = createSeason(43);
    const activated = enableScouting(legacy);
    expect(activated.activeMatch!).toBe(legacy.activeMatch!);
    expect(activated.employment).toBe(legacy.employment);
    expect(activated.finance).toBe(legacy.finance);
    expect(parseSeason(serializeSeason(activated))).toEqual(activated);
  });
});
