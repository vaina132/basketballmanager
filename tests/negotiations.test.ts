import { describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { DEVELOPMENT_CLUBS } from '../src/data/development-league';
import { getSeasonWage } from '../src/data/development-wages';
import { offerPlayerContract, prepareEmploymentMarket, setEmploymentDelegation } from '../src/world/employment';
import { contractForSeason, getClubContractSummary, quotePlayerContract } from '../src/world/employment-policy';
import { createNegotiations, enableNegotiations, getLatestNegotiation, getNegotiationHistory } from '../src/world/negotiations';
import { evaluateNegotiation, getNegotiationDemands, negotiationReasonText, requiredNegotiationWage } from '../src/world/negotiations-policy';
import { createSeason } from '../src/world/season';

const clubId = DEVELOPMENT_CLUBS[0]!.id, otherClubId = DEVELOPMENT_CLUBS[1]!.id;
const own = DEVELOPMENT_CLUBS[0]!.players, playerId = own[0]!.id;
const create = () => createSeason(31, clubId, 'off', true, true, true, true, null, true, true, true);
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

describe('contract negotiation demands and explainable responses', () => {
  it('offers a one-year base floor and rounded premiums for longer fixed salaries', () => {
    expect(getNegotiationDemands(playerId)).toEqual({ baseWage: 1_800_000, terms: [{ seasonWage: 1_800_000, seasons: 1 }, { seasonWage: 1_900_000, seasons: 2 }, { seasonWage: 2_000_000, seasons: 3 }] });
    for (const club of DEVELOPMENT_CLUBS) for (const player of club.players) {
      expect(requiredNegotiationWage(player.id, 1)).toBe(getSeasonWage(player.id));
      for (const years of [1, 2, 3]) expect(requiredNegotiationWage(player.id, years) % 50_000).toBe(0);
    }
    expect(() => requiredNegotiationWage(playerId, 4)).toThrow();
    expect(() => evaluateNegotiation(playerId, 1_800_001, 1)).toThrow();
  });

  it('rejects low offers, counters nearer offers and supplies the longest affordable shorter term', () => {
    expect(evaluateNegotiation(playerId, 1_300_000, 1)).toMatchObject({ outcome: 'rejected', reason: 'far-below-demand', requiredWage: 1_800_000, counterOffer: null, alternativeOffer: null });
    expect(evaluateNegotiation(playerId, 1_350_000, 1)).toMatchObject({ outcome: 'countered', reason: 'below-demand', counterOffer: { seasonWage: 1_800_000, seasons: 1 }, alternativeOffer: null });
    expect(evaluateNegotiation(playerId, 1_900_000, 3)).toMatchObject({ outcome: 'countered', reason: 'term-premium', counterOffer: { seasonWage: 2_000_000, seasons: 3 }, alternativeOffer: { seasonWage: 1_900_000, seasons: 2 } });
    expect(evaluateNegotiation(playerId, 1_800_000, 3).alternativeOffer).toEqual({ seasonWage: 1_800_000, seasons: 1 });
    expect(evaluateNegotiation(playerId, 2_000_000, 3)).toMatchObject({ outcome: 'accepted', reason: 'terms-met', counterOffer: null, alternativeOffer: null });
    expect(negotiationReasonText(evaluateNegotiation(playerId, 1_900_000, 3))).toMatch(/longer/);
  });
});

describe('prospective negotiation activation and immutable history', () => {
  it('retains legacy rules until explicit activation and anchors existing contracts at the same matchday', () => {
    let legacy = createSeason(31, clubId, 'off', true, true, true, true, null, true);
    expect(legacy.negotiations).toEqual(createNegotiations());
    expect(quotePlayerContract(legacy, playerId, 1_350_000, 1).canOffer).toBe(false);
    legacy = offerPlayerContract(legacy, own[1]!.id, getSeasonWage(own[1]!.id), 3);
    const enabled = enableNegotiations(freeze(legacy));
    expect(enabled.negotiations.enabledSince).toEqual({ seasonNumber: 1, round: 1, contractCount: 61 });
    expect(enabled.employment).toBe(legacy.employment);
    expect(enabled.activeMatch).toBe(legacy.activeMatch);
    expect(enabled.finance).toBe(legacy.finance);
    expect(enabled.negotiations.records).toEqual([]);
    expect(enableNegotiations(enabled)).toBe(enabled);
    expect(quotePlayerContract(enabled, playerId, 1_350_000, 1).canOffer).toBe(true);
    expect(() => enableNegotiations(createSeason(31))).toThrow(/Enable player contracts/);
  });

  it('records rejections and counters without signing, reserving budget, charging money or changing the match', () => {
    const initial = freeze(create());
    const rejected = offerPlayerContract(initial, playerId, 1_000_000, 3);
    const countered = offerPlayerContract(rejected, playerId, 1_800_000, 3);
    expect(countered.negotiations.records).toHaveLength(2);
    expect(countered.negotiations.records.map(record => record.id)).toEqual(['negotiation-1', 'negotiation-2']);
    expect(getLatestNegotiation(countered, playerId)).toMatchObject({ clubId, playerId, seasonNumber: 1, round: 1, date: initial.date, status: 'active', startsSeason: 2, offeredWage: 1_800_000, offeredSeasons: 3, contractCountBefore: 60, contractId: null, outcome: 'countered' });
    expect(countered.employment).toBe(initial.employment);
    expect(countered.activeMatch).toBe(initial.activeMatch);
    expect(countered.finance).toBe(initial.finance);
    expect(countered.payroll).toBe(initial.payroll);
    expect(countered.training).toBe(initial.training);
    expect(countered.scouting).toBe(initial.scouting);
    expect(getClubContractSummary(countered, clubId)).toEqual(getClubContractSummary(initial, clubId));
    expect(getNegotiationHistory(countered, playerId).map(record => record.outcome)).toEqual(['rejected', 'countered']);
  });

  it('atomically binds accepted offered terms and links the response to its exact contract', () => {
    let state = offerPlayerContract(create(), playerId, 1_800_000, 3);
    const alternative = getLatestNegotiation(state, playerId)!.alternativeOffer!;
    const before = freeze(state);
    state = offerPlayerContract(before, playerId, alternative.seasonWage, alternative.seasons);
    const record = getLatestNegotiation(state, playerId)!;
    expect(record).toMatchObject({ outcome: 'accepted', contractCountBefore: 60, contractId: 'employment-contract-61', offeredWage: 1_800_000, offeredSeasons: 1 });
    expect(contractForSeason(state.employment, playerId, 2)).toMatchObject({ id: record.contractId, clubId, playerId, startsSeason: 2, endsSeason: 2, seasonWage: 1_800_000 });
    expect(state.employment.contracts).toHaveLength(61);
    expect(state.clubs).toBe(before.clubs);
    expect(state.activeMatch).toBe(before.activeMatch);
    expect(state.finance).toBe(before.finance);
    expect(offerPlayerContract(state, playerId, alternative.seasonWage, alternative.seasons)).toBe(state);
    expect(() => offerPlayerContract(state, playerId, 1_850_000, 1)).toThrow(/already has a contract/);
  });

  it('does not reroll identical proposals and re-evaluates changed terms without patience lockouts', () => {
    let state = offerPlayerContract(create(), playerId, 1_000_000, 2);
    expect(offerPlayerContract(state, playerId, 1_000_000, 2)).toBe(state);
    for (const wage of [1_050_000, 1_100_000, 1_150_000, 1_200_000]) state = offerPlayerContract(state, playerId, wage, 2);
    const accepted = offerPlayerContract(state, playerId, requiredNegotiationWage(playerId, 2), 2);
    expect(getLatestNegotiation(accepted, playerId)?.outcome).toBe('accepted');
    const counter = offerPlayerContract(create(), playerId, 1_800_000, 3);
    const newRound = { ...counter, round: 2, date: counter.fixtures.find(fixture => fixture.round === 2)!.date };
    const repeated = offerPlayerContract(newRound, playerId, 1_800_000, 3);
    expect(repeated.negotiations.records).toHaveLength(2);
    expect(repeated.negotiations.records[1]!.counterOffer).toEqual(counter.negotiations.records[0]!.counterOffer);
    expect(repeated.negotiations.records[1]!.round).toBe(2);
  });

  it('checks present budget and ownership before replaying a duplicate counter', () => {
    let state = offerPlayerContract(create(), playerId, 1_800_000, 3);
    for (const player of own.slice(1, 4)) state = offerPlayerContract(state, player.id, 5_000_000, 1);
    // At three expensive players, only the protected eight-player minimum remains affordable.
    state = offerPlayerContract(state, own[4]!.id, 1_800_000, 1);
    expect(quotePlayerContract(state, playerId, 1_800_000, 3).canOffer).toBe(true);
    state = offerPlayerContract(state, own[5]!.id, 1_800_000, 1);
    state = offerPlayerContract(state, own[6]!.id, 1_800_000, 1);
    state = offerPlayerContract(state, own[7]!.id, 1_800_000, 1);
    state = offerPlayerContract(state, own[8]!.id, 1_800_000, 1);
    const counted = state.negotiations.records.length;
    expect(() => offerPlayerContract(state, playerId, 1_800_000, 3)).toThrow(/wage budget/);
    expect(state.negotiations.records).toHaveLength(counted);
    const foreign = offerPlayerContract(create(), playerId, 1_800_000, 3);
    const blocked: SeasonState = { ...foreign, employment: { ...foreign.employment, contracts: [...foreign.employment.contracts, { id: 'employment-contract-61', playerId, clubId: otherClubId, startsSeason: 2, endsSeason: 2, seasonWage: 1_800_000, signedSeason: 1, signedRound: 10, kind: 'free-agent' }] } };
    expect(() => offerPlayerContract(blocked, playerId, 1_800_000, 3)).toThrow(/already has a contract/);
  });

  it('rejects structurally invalid or unaffordable offers before appending a response', () => {
    const state = freeze(create());
    for (const [wage, years] of [[499_999, 1], [5_050_000, 1], [1_800_001, 1], [1_800_000, 4]]) expect(() => offerPlayerContract(state, playerId, wage!, years!)).toThrow();
    expect(() => offerPlayerContract(state, DEVELOPMENT_CLUBS[1]!.players[0]!.id, 1_800_000, 1)).toThrow(/own players/);
    expect(state.negotiations.records).toEqual([]);
  });
});

describe('shared negotiation rules for delegated and AI recruitment', () => {
  it('keeps the guaranteed one-year baseline affordable and records every automatic agreement', () => {
    const delegated = setEmploymentDelegation(create(), true);
    expect(getClubContractSummary(delegated, clubId).rosterSize).toBe(10);
    expect(delegated.negotiations.records).toHaveLength(10);
    expect(delegated.negotiations.records.every(record => record.outcome === 'accepted' && record.offeredSeasons === 1 && record.offeredWage === requiredNegotiationWage(record.playerId, 1))).toBe(true);
    /** Isolated market policy boundary; actual rollover is covered by integration tests. */
    const market = prepareEmploymentMarket({ ...delegated, round: 10, date: delegated.fixtures.find(fixture => fixture.round === 10)!.date, status: 'complete' });
    expect(market.negotiations.records).toHaveLength(50);
    expect(market.employment.contracts).toHaveLength(110);
    for (const [index, record] of market.negotiations.records.entries()) {
      expect(record.contractCountBefore).toBe(60 + index);
      expect(record.contractId).toBe(`employment-contract-${61 + index}`);
      expect(record.outcome).toBe('accepted');
    }
    expect(market.clubs).toBe(delegated.clubs);
  });

  it('uses public term rules independent of hidden skills or fabricated personal traits', () => {
    const state = create();
    const before = evaluateNegotiation(playerId, 1_800_000, 3);
    const changed = { ...state, training: { ...state.training, points: { ...state.training.points, [playerId]: { twoPoint: 200, threePoint: 200, freeThrow: 200, passing: 200, defense: 200, rebounding: 200, stamina: 200 } } } };
    const after = offerPlayerContract(changed, playerId, 1_800_000, 3);
    expect(getLatestNegotiation(after, playerId)).toMatchObject(before);
    expect(after.training).toBe(changed.training);
  });
});
