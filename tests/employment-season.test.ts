import { restoreSeniorDetail } from './helpers/senior-reference';
import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { DEVELOPMENT_PLAYERS } from '../src/data/development-players';
import { getSeasonWage } from '../src/data/development-wages';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { enableEmployment, offerPlayerContract, setEmploymentDelegation } from '../src/world/employment';
import { contractForSeason, getAvailablePlayers } from '../src/world/employment-policy';
import { getSeasonPerformance } from '../src/world/performance';
import { advanceSeason, createSeason, managedSide, rolloverSeason } from '../src/world/season';

function play(state: SeasonState): SeasonState {
  return advanceSeason({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) });
}
function finish(state: SeasonState): SeasonState {
  while (state.status === 'active') state = play(state);
  return state;
}

describe('employment across real season boundaries', () => {
  let initial: SeasonState, completed: SeasonState, recruited: SeasonState;
  let incomingId: string, retainedId: string;
  beforeAll(() => {
    initial = createSeason(31, 'rhine-falcons', 'standard', true, true, true, true, null, true);
    retainedId = initial.clubs.find(club => club.id === initial.managedClubId)!.players[0]!.id;
    const renewed = offerPlayerContract(initial, retainedId, 2_000_000, 2);
    completed = finish(renewed);
    recruited = completed;
    const own = initial.clubs.find(club => club.id === initial.managedClubId)!;
    for (const player of own.players.slice(1, 7)) recruited = offerPlayerContract(recruited, player.id, getSeasonWage(player.id), 1);
    incomingId = getAvailablePlayers(recruited).find(player => !own.players.some(member => member.id === player.id))!.id;
    recruited = offerPlayerContract(recruited, incomingId, getSeasonWage(incomingId), 2);
  }, 30_000);

  it('keeps renewals pending without changing sporting state or current payroll', () => {
    const renewed = offerPlayerContract(initial, retainedId, 2_000_000, 2);
    expect(renewed.activeMatch).toBe(initial.activeMatch);
    expect(renewed.clubs).toBe(initial.clubs);
    expect(renewed.rosters).toBe(initial.rosters);
    expect(renewed.finance).toBe(initial.finance);
    expect(renewed.payroll).toBe(initial.payroll);
    expect(contractForSeason(renewed.employment, retainedId, 2)?.seasonWage).toBe(2_000_000);
    expect(contractForSeason(initial.employment, retainedId, 2)).toBeNull();
  });

  it('rejects an incomplete next squad without partially changing the completed season', () => {
    const before = structuredClone(completed);
    expect(() => rolloverSeason(completed)).toThrow(/eight|8|minimum/i);
    expect(completed).toEqual(before);
    expect(completed.status).toBe('complete');
    expect(completed.history).toHaveLength(0);
  });

  it('changes registrations, wages, lineups and training together while preserving archives', () => {
    const original = structuredClone(recruited);
    const historical = getSeasonPerformance(recruited);
    const next = rolloverSeason(recruited);
    const club = next.clubs.find(team => team.id === next.managedClubId)!;
    expect(recruited).toEqual(original);
    expect(club.players).toHaveLength(8);
    expect(club.players.some(player => player.id === incomingId)).toBe(true);
    expect(new Set(club.players.map(player => player.number)).size).toBe(8);
    expect(next.clubs.filter(team => team.id !== club.id).every(team => team.players.length >= 8 && team.players.length <= 12)).toBe(true);
    const allIds = next.clubs.flatMap(team => team.players.map(player => player.id));
    expect(new Set(allIds).size).toBe(allIds.length);
    expect(Object.keys(next.conditions).sort()).toEqual(DEVELOPMENT_PLAYERS.map(player => player.id).sort());
    expect(next.training.points).toEqual(recruited.training.points);
    for (const team of next.clubs) {
      const ids = team.players.map(player => player.id);
      expect(next.plans[team.id]!.lineup.every(id => ids.includes(id))).toBe(true);
      expect(Object.keys(next.training.plans[team.id]!.individual).sort()).toEqual(ids.sort());
    }
    expect(next.payroll.agreements.find(term => term.playerId === retainedId && term.seasonNumber === 2)?.seasonWage).toBe(2_000_000);
    expect(next.payroll.agreements.find(term => term.playerId === incomingId && term.seasonNumber === 2)?.clubId).toBe(club.id);
    expect(next.history[0]!.rosters).toEqual(recruited.rosters);
    expect(getSeasonPerformance(restoreSeniorDetail(next, recruited), 1)).toEqual(historical);
    expect(next.activeMatch[managedSide(next)].players.map(player => player.id)).toEqual(club.players.map(player => player.id));
    expect(parseSeason(serializeSeason(next))).toEqual(next);
  });

  it('preserves free-agent development and audits new payroll after training and another rollover', () => {
    let next = rolloverSeason(recruited);
    const free = DEVELOPMENT_PLAYERS.find(player => !next.clubs.some(club => club.players.some(member => member.id === player.id)))!;
    expect(free).toBeTruthy();
    const before = structuredClone(next.training.points[free.id]);
    next = play(next);
    expect(next.training.points[free.id]).toEqual(before);
    expect(next.training.lastWeek!.players[free.id]).toBeUndefined();
    expect(parseSeason(serializeSeason(next))).toEqual(next);
    next = rolloverSeason(finish(setEmploymentDelegation(next, true)));
    expect(next.seasonNumber).toBe(3);
    expect(contractForSeason(next.employment, retainedId, 3)?.seasonWage).toBe(2_000_000);
    expect(next.payroll.agreements.find(term => term.playerId === retainedId && term.seasonNumber === 3)?.seasonWage).toBe(2_000_000);
    expect(parseSeason(serializeSeason(next))).toEqual(next);
  }, 30_000);

  it('lets an existing completed career opt in without rewriting its results or payment history', () => {
    const legacy = { ...completed, employment: { model: 'employment-1' as const, enabledSince: null, delegated: false, contracts: [], transfers: [], buyouts: [], market: null } };
    const enabled = enableEmployment(legacy);
    expect(enabled.activeMatch).toBe(legacy.activeMatch);
    expect(enabled.fixtures).toBe(legacy.fixtures);
    expect(enabled.payroll).toBe(legacy.payroll);
    expect(enabled.employment.enabledSince).toEqual({ seasonNumber: 1, round: 10 });
    expect(enabled.employment.market).toEqual({ seasonNumber: 2 });
    expect(parseSeason(serializeSeason(enabled))).toEqual(enabled);
  });
});
