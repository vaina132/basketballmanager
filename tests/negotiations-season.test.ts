import { restoreSeniorDetail } from './helpers/senior-reference';
import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { getSeasonWage } from '../src/data/development-wages';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { offerPlayerContract, setEmploymentDelegation } from '../src/world/employment';
import { contractForSeason, getAvailablePlayers, getClubContractSummary } from '../src/world/employment-policy';
import { enableNegotiations, getLatestNegotiation } from '../src/world/negotiations';
import { requiredNegotiationWage } from '../src/world/negotiations-policy';
import { getSeasonPerformance } from '../src/world/performance';
import { advanceSeason, createSeason, managedSide, rolloverSeason } from '../src/world/season';

const clubId = 'rhine-falcons', playerId = 'rhf-1';
const create = (enabled = true) => createSeason(53, clubId, 'standard', true, true, true, true, null, true, true, enabled);
const play = (state: SeasonState) => advanceSeason({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) });
function finish(state: SeasonState): SeasonState { while (state.status === 'active') state = play(state); return state; }

describe('contract negotiations in persistent careers', () => {
  let initial: SeasonState, countered: SeasonState, completed: SeasonState;
  beforeAll(() => {
    initial = create();
    countered = offerPlayerContract(offerPlayerContract(initial, playerId, 1_000_000, 1), playerId, getSeasonWage(playerId), 3);
    completed = finish(countered);
  }, 30_000);

  it('commits responses independently of match outcomes, cash and payroll', () => {
    expect(countered.negotiations.records.map(record => record.outcome)).toEqual(['rejected', 'countered']);
    expect(countered.employment).toBe(initial.employment);
    for (const key of ['activeMatch', 'fixtures', 'training', 'scouting', 'finance', 'payroll', 'clubs'] as const) expect(countered[key]).toBe(initial[key]);
    const enabledNext = play(countered), legacyNext = play(create(false));
    for (const key of ['activeMatch', 'fixtures', 'training', 'scouting', 'finance', 'payroll', 'clubs'] as const) expect(enabledNext[key]).toEqual(legacyNext[key]);
    expect(parseSeason(serializeSeason(enabledNext))).toEqual(enabledNext);
    expect(getLatestNegotiation(enabledNext, playerId)?.date).toBe(initial.date);
  });

  it('records every automated signing through the same accepted-term policy', () => {
    const anchor = completed.negotiations.enabledSince!.contractCount;
    const added = completed.employment.contracts.slice(anchor);
    expect(added).toHaveLength(40);
    const accepted = completed.negotiations.records.filter(record => record.outcome === 'accepted');
    expect(accepted).toHaveLength(added.length);
    for (const contract of added) {
      const record = accepted.find(record => record.contractId === contract.id)!;
      expect(record).toMatchObject({ clubId: contract.clubId, playerId: contract.playerId, offeredWage: contract.seasonWage, status: 'complete', offeredSeasons: 1 });
      expect(record.requiredWage).toBe(requiredNegotiationWage(contract.playerId, 1));
    }
    expect(parseSeason(serializeSeason(completed))).toEqual(completed);
  });

  it('applies negotiated multi-year salaries to opening-day payroll and keeps the old reports', () => {
    let market = offerPlayerContract(completed, playerId, requiredNegotiationWage(playerId, 3), 3);
    const own = market.clubs.find(club => club.id === clubId)!;
    for (const player of own.players.slice(1, 7)) market = offerPlayerContract(market, player.id, getSeasonWage(player.id), 1);
    const incoming = getAvailablePlayers(market).find(player => !own.players.some(member => member.id === player.id))!;
    market = offerPlayerContract(market, incoming.id, getSeasonWage(incoming.id), 3);
    expect(getLatestNegotiation(market, incoming.id)?.outcome).toBe('countered');
    const agreement = getLatestNegotiation(market, incoming.id)!.counterOffer!;
    market = offerPlayerContract(market, incoming.id, agreement.seasonWage, agreement.seasons);
    const history = structuredClone(market.negotiations.records);
    const performances = getSeasonPerformance(market);
    const next = rolloverSeason(market);
    expect(next.negotiations.records.slice(0, history.length)).toEqual(history);
    expect(getSeasonPerformance(restoreSeniorDetail(next, market), 1)).toEqual(performances);
    expect(next.payroll.agreements.find(term => term.playerId === incoming.id && term.seasonNumber === 2)).toMatchObject({ clubId, seasonWage: agreement.seasonWage });
    expect(contractForSeason(next.employment, incoming.id, 4)?.seasonWage).toBe(agreement.seasonWage);
    expect(getLatestNegotiation(next, playerId)).toBeNull();
    expect(getLatestNegotiation(next, playerId, clubId, 2)?.outcome).toBe('accepted');
    expect(parseSeason(serializeSeason(next))).toEqual(next);
    expect(parseSeason(serializeSeason(play(next)))).toEqual(play(next));
  }, 30_000);

  it('preserves existing binding multi-year terms when negotiations activate on the same matchday', () => {
    const old = offerPlayerContract(create(false), playerId, getSeasonWage(playerId), 3);
    const activated = enableNegotiations(old);
    expect(activated.employment).toBe(old.employment);
    expect(activated.negotiations.enabledSince?.contractCount).toBe(61);
    expect(activated.negotiations.records).toEqual([]);
    expect(activated.activeMatch).toBe(old.activeMatch);
    expect(parseSeason(serializeSeason(activated))).toEqual(activated);
    const after = setEmploymentDelegation(activated, true);
    expect(getClubContractSummary(after, clubId).rosterSize).toBe(10);
    expect(after.negotiations.records).toHaveLength(9);
    expect(after.employment.contracts[60]).toEqual(old.employment.contracts[60]);
    expect(setEmploymentDelegation(after, false).negotiations).toBe(after.negotiations);
  });

  it('rechecks a saved counteroffer after other agreements consume the budget', () => {
    let state = offerPlayerContract(initial, playerId, getSeasonWage(playerId), 3);
    const counter = getLatestNegotiation(state, playerId)!.counterOffer!;
    for (const id of ['rhf-2', 'rhf-3', 'rhf-4']) state = offerPlayerContract(state, id, 5_000_000, 3);
    const original = structuredClone(state);
    expect(() => offerPlayerContract(state, playerId, counter.seasonWage, counter.seasons)).toThrow(/budget/);
    expect(state).toEqual(original);
    state = offerPlayerContract(state, playerId, getSeasonWage(playerId), 1);
    expect(getLatestNegotiation(state, playerId)?.outcome).toBe('accepted');
    expect(parseSeason(serializeSeason(state))).toEqual(state);
  });
});
