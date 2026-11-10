import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { DEVELOPMENT_PLAYERS } from '../src/data/development-players';
import { getSeasonWage } from '../src/data/development-wages';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { offerPlayerContract } from '../src/world/employment';
import { contractForSeason, getAvailablePlayers, getClubContractSummary, MAX_CONTRACT_WAGE, quotePlayerContract } from '../src/world/employment-policy';
import { advanceMarket, createMarket, enableMarket, submitMarketOffer, withdrawMarketOffer } from '../src/world/market';
import { getLiveMarketOffers, getMarketOffers, getMarketStartReason, getMarketWindow, getNextMarketDate, isMarketActive } from '../src/world/market-policy';
import { requiredNegotiationWage } from '../src/world/negotiations-policy';
import { advanceSeason, createSeason, dateForRound, managedSide } from '../src/world/season';

const clubId = 'rhine-falcons', playerId = 'rhf-1';
const ownIds = Array.from({ length: 10 }, (_, index) => `rhf-${index + 1}`);
const create = (enabled = true) => createSeason(53, clubId, 'off', true, true, true, true, null, true, true, true, enabled);
const play = (state: SeasonState) => advanceSeason({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) });
function finish(state: SeasonState): SeasonState { while (state.status === 'active') state = play(state); return state; }
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
const plusDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

describe('dated offseason offers and reserved commitments', () => {
  let initial: SeasonState, completed: SeasonState;
  beforeAll(() => { initial = create(); completed = freeze(finish(initial)); }, 30_000);

  it('lists approachable players again after a hold ends, while signed players stay unavailable', () => {
    const listed = (state: SeasonState, id = playerId) => getAvailablePlayers(state).some(player => player.id === id);
    expect(listed(completed)).toBe(true);
    expect(listed(completed, getLiveMarketOffers(completed)[0]!.playerId)).toBe(true);
    const pending = submitMarketOffer(completed, playerId, getSeasonWage(playerId), 3);
    expect(listed(pending)).toBe(false);
    expect(listed(withdrawMarketOffer(pending, getMarketOffers(pending)[0]!.id))).toBe(true);
    const counter = advanceMarket(pending);
    expect(listed(counter)).toBe(false);
    expect(listed(advanceMarket(counter))).toBe(true);
    const signed = advanceMarket(submitMarketOffer(completed, playerId, getSeasonWage(playerId), 1));
    expect(listed(signed)).toBe(false);
  });

  it('is prospective and keeps active-season renewals on the existing contract path', () => {
    const legacy = create(false);
    expect(legacy.market).toEqual(createMarket());
    expect(isMarketActive(legacy)).toBe(false);
    const enabled = enableMarket(legacy);
    for (const key of ['activeMatch', 'fixtures', 'conditions', 'clubs', 'employment', 'finance', 'payroll', 'negotiations'] as const) expect(enabled[key]).toBe(legacy[key]);
    expect(enableMarket(enabled)).toBe(enabled);
    expect(() => advanceMarket(enabled)).toThrow();
    expect(() => submitMarketOffer(enabled, playerId, getSeasonWage(playerId), 1)).toThrow();
    const renewed = offerPlayerContract(enabled, playerId, getSeasonWage(playerId), 1);
    expect(contractForSeason(renewed.employment, playerId, 2)?.clubId).toBe(clubId);
    expect(renewed.market).toBe(enabled.market);
    expect(renewed.activeMatch).toBe(legacy.activeMatch);
  });

  it('opens real dated decisions without changing final results, cash or current registrations', () => {
    expect(isMarketActive(completed)).toBe(true);
    expect(completed.date).toBe(dateForRound(10));
    expect(getNextMarketDate(completed)).toBe(plusDays(completed.date, 1));
    expect(getClubContractSummary(completed, clubId).rosterSize).toBe(0);
    expect(getMarketStartReason(completed)).toBeTruthy();
    const submitted = submitMarketOffer(completed, playerId, requiredNegotiationWage(playerId, 3), 3);
    for (const key of ['activeMatch', 'fixtures', 'conditions', 'clubs', 'rosters', 'finance', 'payroll', 'employment', 'negotiations'] as const) expect(submitted[key]).toBe(completed[key]);
    expect(contractForSeason(submitted.employment, playerId, 2)).toBeNull();
    expect(submitMarketOffer(submitted, playerId, requiredNegotiationWage(playerId, 3), 3)).toEqual(submitted);
  });

  it('reserves enough annual funds for a legal minimum squad across every proposed year', () => {
    let state = completed;
    for (const id of ownIds.slice(0, 3)) state = submitMarketOffer(state, id, MAX_CONTRACT_WAGE, 3);
    expect(state.employment.contracts).toBe(completed.employment.contracts);
    for (const year of [2, 3, 4]) expect(getClubContractSummary(state, clubId, year)).toMatchObject({ rosterSize: 0, seasonWages: 0, reservedRosterSize: 3, reservedWages: 15_000_000, minimumReserve: 9_000_000, spendableBudget: 0 });
    expect(quotePlayerContract(state, ownIds[3]!, MAX_CONTRACT_WAGE, 1).canOffer).toBe(false);
    expect(quotePlayerContract(state, ownIds[3]!, 2_000_000, 3).canOffer).toBe(false);
    const before = structuredClone(state);
    expect(() => submitMarketOffer(state, ownIds[3]!, MAX_CONTRACT_WAGE, 3)).toThrow(/budget|allocation|reserve/i);
    expect(state).toEqual(before);
    for (const id of ownIds.slice(5)) state = submitMarketOffer(state, id, getSeasonWage(id), 1);
    expect(quotePlayerContract(state, ownIds[3]!, 2_000_000, 1).canOffer).toBe(false);
    state = advanceMarket(state);
    expect(quotePlayerContract(state, ownIds[3]!, 2_000_000, 1).canOffer).toBe(true);
    expect(quotePlayerContract(state, ownIds[3]!, 2_000_000, 2).canOffer).toBe(false);
  });

  it('replaces only the acting club’s existing reservation and leaves failed amendments intact', () => {
    let state = submitMarketOffer(completed, playerId, getSeasonWage(playerId), 3);
    state = submitMarketOffer(state, playerId, MAX_CONTRACT_WAGE, 3);
    for (const id of ownIds.slice(1, 3)) state = submitMarketOffer(state, id, MAX_CONTRACT_WAGE, 3);
    expect(quotePlayerContract(state, ownIds[3]!, MAX_CONTRACT_WAGE, 1).canOffer).toBe(false);
    state = submitMarketOffer(state, playerId, getSeasonWage(playerId), 1);
    expect(getMarketOffers(state, clubId, true)).toHaveLength(3);
    expect(getClubContractSummary(state, clubId, 3)).toMatchObject({ reservedRosterSize: 2, reservedWages: 10_000_000 });
    expect(quotePlayerContract(state, ownIds[3]!, 2_000_000, 3).canOffer).toBe(true);
    const before = structuredClone(state);
    expect(() => submitMarketOffer(state, playerId, MAX_CONTRACT_WAGE + 50_000, 3)).toThrow();
    expect(state).toEqual(before);
    const otherClub = completed.clubs.find(club => club.id !== clubId)!.id;
    const competed = submitMarketOffer(state, playerId, getSeasonWage(playerId), 1, otherClub);
    expect(getMarketOffers(competed, clubId, true)).toEqual(getMarketOffers(state, clubId, true));
    expect(getMarketOffers(competed, otherClub, true).some(offer => offer.playerId === playerId)).toBe(true);
  });

  it('counts pending players against the maximum squad size before any contract is signed', () => {
    let state = completed;
    for (const id of ownIds) state = submitMarketOffer(state, id, getSeasonWage(id), 1);
    for (let count = 0; count < 2; count += 1) {
      const incoming = DEVELOPMENT_PLAYERS.find(player => !ownIds.includes(player.id) && !getLiveMarketOffers(state).some(offer => offer.playerId === player.id) && quotePlayerContract(state, player.id, getSeasonWage(player.id), 1).canOffer)!;
      expect(incoming).toBeTruthy();
      state = submitMarketOffer(state, incoming.id, getSeasonWage(incoming.id), 1);
    }
    expect(getClubContractSummary(state, clubId).rosterSize).toBe(0);
    expect(getClubContractSummary(state, clubId).reservedRosterSize).toBe(12);
    expect(DEVELOPMENT_PLAYERS.filter(player => !getLiveMarketOffers(state).some(offer => offer.playerId === player.id)).some(player => quotePlayerContract(state, player.id, getSeasonWage(player.id), 1).canOffer)).toBe(false);
  });

  it('advances one decision date and applies identical accepted terms without spending current cash', () => {
    const offered = submitMarketOffer(completed, playerId, requiredNegotiationWage(playerId, 3), 3);
    const next = advanceMarket(offered);
    expect(next.date).toBe(plusDays(completed.date, 1));
    expect(contractForSeason(next.employment, playerId, 2)).toMatchObject({ clubId, startsSeason: 2, endsSeason: 4, seasonWage: requiredNegotiationWage(playerId, 3) });
    for (const key of ['activeMatch', 'fixtures', 'clubs', 'rosters', 'finance', 'payroll', 'training'] as const) expect(next[key]).toBe(offered[key]);
    expect(next.conditions).toEqual(Object.fromEntries(Object.entries(offered.conditions).map(([id, condition]) => [id, Math.min(100, Math.round((condition + 3) * 1000) / 1000)])));
    expect(advanceMarket(offered)).toEqual(next);
    expect(next.negotiations.records.at(-1)?.date).toBe(next.date);
  });

  it('does not allow another club to withdraw the manager’s proposal', () => {
    const state = submitMarketOffer(completed, playerId, getSeasonWage(playerId), 1);
    const offer = getMarketOffers(state).find(offer => offer.playerId === playerId)!;
    const otherClub = completed.clubs.find(club => club.id !== clubId)!.id;
    expect(() => withdrawMarketOffer(state, offer.id, otherClub)).toThrow();
    const withdrawn = withdrawMarketOffer(state, offer.id);
    expect(withdrawn.employment).toBe(state.employment);
    expect(withdrawn.finance).toBe(state.finance);
    expect(quotePlayerContract(withdrawn, playerId, MAX_CONTRACT_WAGE, 3).canOffer).toBe(true);
    expect(contractForSeason(withdrawn.employment, playerId, 2)).toBeNull();
  });

  it('holds the original proposed terms through a counteroffer, then releases them on expiry', () => {
    let state = submitMarketOffer(completed, playerId, getSeasonWage(playerId), 3);
    const original = getMarketOffers(state).find(offer => offer.playerId === playerId)!;
    expect(original).toMatchObject({ status: 'pending', offeredOn: completed.date, responseOn: plusDays(completed.date, 1), expiresOn: plusDays(completed.date, 7) });
    state = advanceMarket(state);
    expect(getMarketOffers(state).find(offer => offer.id === original.id)).toMatchObject({ status: 'countered', respondedOn: state.date, closedOn: null });
    expect(contractForSeason(state.employment, playerId, 2)).toBeNull();
    for (const year of [2, 3, 4]) expect(getClubContractSummary(state, clubId, year)).toMatchObject({ reservedRosterSize: 1, reservedWages: getSeasonWage(playerId) });
    while (state.date < original.expiresOn) state = advanceMarket(state);
    expect(state.date).toBe(original.expiresOn);
    expect(getMarketOffers(state).find(offer => offer.id === original.id)).toMatchObject({ status: 'expired', closedOn: original.expiresOn });
    for (const year of [2, 3, 4]) expect(getClubContractSummary(state, clubId, year)).toMatchObject({ reservedRosterSize: 0, reservedWages: 0 });
    const resumed = submitMarketOffer(state, playerId, getSeasonWage(playerId), 3);
    expect(getMarketOffers(resumed, clubId, true)).toHaveLength(1);
    expect(getMarketOffers(resumed, clubId, true)[0]!.offeredOn).toBe(state.date);
    const replied = advanceMarket(resumed);
    expect(getMarketOffers(replied, clubId, true)[0]!.status).toBe('countered');
    expect(replied.negotiations.records.filter(record => record.clubId === clubId && record.playerId === playerId)).toHaveLength(2);
  });

  it('releases rejected proposals while accepted contracts remain binding', () => {
    const offered = submitMarketOffer(completed, playerId, 1_000_000, 1);
    const rejected = advanceMarket(offered);
    expect(getMarketOffers(rejected).find(offer => offer.playerId === playerId)).toMatchObject({ status: 'rejected', respondedOn: rejected.date, closedOn: rejected.date });
    expect(getClubContractSummary(rejected, clubId)).toMatchObject({ reservedRosterSize: 0, reservedWages: 0, seasonWages: 0 });
    const accepted = advanceMarket(submitMarketOffer(rejected, playerId, getSeasonWage(playerId), 1));
    const acceptedOffer = getMarketOffers(accepted).find(offer => offer.playerId === playerId && offer.status === 'accepted')!;
    expect(getClubContractSummary(accepted, clubId)).toMatchObject({ rosterSize: 1, seasonWages: getSeasonWage(playerId), reservedRosterSize: 0, reservedWages: 0 });
    expect(() => withdrawMarketOffer(accepted, acceptedOffer.id)).toThrow();
    expect(accepted.finance).toBe(completed.finance);
    expect(accepted.payroll).toBe(completed.payroll);
  });

  it('keeps the last playable decision date when closing would strand an incomplete squad', () => {
    let state = completed;
    const close = getMarketWindow(state)!.closesOn;
    expect(close).toBe(plusDays(completed.date, 28));
    while (getNextMarketDate(state) !== close) state = advanceMarket(state);
    const before = structuredClone(state);
    expect(() => advanceMarket(state)).toThrow(/eight|squad|recruit/i);
    expect(state).toEqual(before);
    expect(isMarketActive(state)).toBe(true);
    for (const id of ownIds.slice(0, 8)) state = submitMarketOffer(state, id, getSeasonWage(id), 1);
    state = advanceMarket(state);
    expect(getClubContractSummary(state, clubId).rosterSize).toBe(8);
    expect(getLiveMarketOffers(state)).toHaveLength(0);
    expect(getMarketStartReason(state)).toBeNull();
  });
});
