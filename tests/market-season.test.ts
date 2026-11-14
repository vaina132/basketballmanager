import { restoreSeniorDetail } from './helpers/senior-reference';
import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { DEVELOPMENT_PLAYERS } from '../src/data/development-players';
import { getSeasonWage } from '../src/data/development-wages';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { offerPlayerContract, setEmploymentDelegation } from '../src/world/employment';
import { contractForSeason, getClubContractSummary, MAX_CONTRACT_WAGE, MIN_CONTRACT_WAGE, quotePlayerContract } from '../src/world/employment-policy';
import { advanceMarket, enableMarket, submitMarketOffer, withdrawMarketOffer } from '../src/world/market';
import { addMarketDays, getLiveMarketOffers, getMarketOffers, getMarketStartReason, getMarketWindow, getNextMarketDate } from '../src/world/market-policy';
import { requiredNegotiationWage } from '../src/world/negotiations-policy';
import { getSeasonPerformance } from '../src/world/performance';
import { advanceSeason, createSeason, managedSide, rolloverSeason, seasonStartDate } from '../src/world/season';

const clubId = 'rhine-falcons';
const create = (market = true) => createSeason(53, clubId, 'off', true, true, true, true, null, true, true, true, market);
const play = (state: SeasonState) => advanceSeason({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) });
function finish(state: SeasonState): SeasonState { while (state.status === 'active') state = play(state); return state; }
function resolvePending(state: SeasonState): SeasonState {
  for (let count = 0; getLiveMarketOffers(state).length && count < 20; count += 1) state = advanceMarket(state);
  expect(getLiveMarketOffers(state)).toHaveLength(0);
  return state;
}

/** Reach the last proposal day through real weekly progression and rejected daily replies. */
function lastProposalDay(state: SeasonState, playerId: string): SeasonState {
  const window = getMarketWindow(state)!;
  const weekBeforeClose = addMarketDays(window.closesOn, -7);
  while (getNextMarketDate(state)! <= weekBeforeClose) state = advanceMarket(state);
  while (addMarketDays(state.date, 1) < window.closesOn) state = advanceMarket(submitMarketOffer(state, playerId, MIN_CONTRACT_WAGE, 1));
  expect(addMarketDays(state.date, 1)).toBe(window.closesOn);
  return state;
}

describe('offseason calendar through genuine season boundaries', () => {
  let completed: SeasonState, legacyCompleted: SeasonState;
  beforeAll(() => { completed = finish(create()); legacyCompleted = finish(create(false)); }, 30_000);

  it('opens AI proposals through the same delayed response and reservation rules as manual offers', () => {
    expect(completed.employment.contracts).toHaveLength(60);
    expect(legacyCompleted.employment.contracts).toHaveLength(100);
    for (const key of ['activeMatch', 'fixtures', 'conditions', 'clubs', 'rosters', 'finance', 'payroll', 'training', 'scouting'] as const) expect(completed[key]).toEqual(legacyCompleted[key]);
    expect(completed.negotiations.records).toHaveLength(0);
    for (const club of completed.clubs.filter(club => club.id !== clubId)) {
      const pending = getMarketOffers(completed, club.id, true);
      expect(pending).toHaveLength(8);
      expect(getClubContractSummary(completed, club.id)).toMatchObject({ rosterSize: 0, reservedRosterSize: 8 });
      for (const proposal of pending) expect(quotePlayerContract(completed, proposal.playerId, proposal.seasonWage, proposal.seasons, club.id).canOffer).toBe(true);
    }
    expect(() => rolloverSeason(completed)).toThrow(/offer|signed|eight|recruit/i);
    const resolved = resolvePending(completed);
    for (const club of resolved.clubs.filter(club => club.id !== clubId)) expect(getClubContractSummary(resolved, club.id)).toMatchObject({ rosterSize: 8, reservedRosterSize: 0, reservedWages: 0 });
    expect(getMarketStartReason(resolved)).toMatch(/Your squad|eight/i);
    for (const offer of getMarketWindow(resolved)!.offers.filter(offer => offer.status === 'accepted')) {
      const record = resolved.negotiations.records.find(record => record.id === offer.negotiationId)!;
      expect(record).toMatchObject({ clubId: offer.clubId, playerId: offer.playerId, date: offer.respondedOn, offeredWage: offer.seasonWage, offeredSeasons: offer.seasons, outcome: 'accepted' });
      expect(contractForSeason(resolved.employment, offer.playerId, 2)?.seasonWage).toBe(offer.seasonWage);
    }
  });

  it('delegates prospective proposals, preserves them when delegation stops, and never signs on the toggle', () => {
    const delegated = setEmploymentDelegation(completed, true);
    expect(delegated.employment.contracts).toBe(completed.employment.contracts);
    expect(getMarketOffers(delegated, clubId, true)).toHaveLength(10);
    expect(delegated.activeMatch).toBe(completed.activeMatch);
    const manual = setEmploymentDelegation(delegated, false);
    expect(getMarketOffers(manual, clubId, true)).toEqual(getMarketOffers(delegated, clubId, true));
    const resolved = resolvePending(manual);
    expect(getClubContractSummary(resolved, clubId)).toMatchObject({ rosterSize: 10, reservedRosterSize: 0 });
    expect(getMarketStartReason(resolved)).toBeNull();
  });

  it('activates on an already-completed legacy season without redoing its binding AI signings', () => {
    const enabled = enableMarket(legacyCompleted);
    expect(enabled.employment.contracts).toBe(legacyCompleted.employment.contracts);
    expect(enabled.negotiations.records).toBe(legacyCompleted.negotiations.records);
    expect(enabled.activeMatch).toBe(legacyCompleted.activeMatch);
    expect(enabled.finance).toBe(legacyCompleted.finance);
    expect(enabled.market.enabledSince).toMatchObject({ seasonNumber: 1, round: 10, contractCount: 100, negotiationCount: 40 });
    expect(getMarketWindow(enabled)).toMatchObject({ contractCountBefore: 100, negotiationCountBefore: 40 });
    const pending = submitMarketOffer(enabled, 'rhf-1', getSeasonWage('rhf-1'), 1);
    expect(pending.employment.contracts).toHaveLength(100);
    expect(offerPlayerContract(enabled, 'rhf-1', getSeasonWage('rhf-1'), 1)).toEqual(pending);
    expect(parseSeason(serializeSeason(pending))).toEqual(pending);
  });

  it('resumes pending and countered offers on the exact saved dates without duplicate replies or payments', () => {
    const pending = submitMarketOffer(completed, 'rhf-1', getSeasonWage('rhf-1'), 3);
    expect(parseSeason(serializeSeason(pending))).toEqual(pending);
    const countered = advanceMarket(pending);
    expect(advanceMarket(parseSeason(serializeSeason(pending)))).toEqual(countered);
    expect(getMarketOffers(countered, clubId, true)[0]!.status).toBe('countered');
    const accepted = advanceMarket(submitMarketOffer(countered, 'rhf-1', requiredNegotiationWage('rhf-1', 3), 3));
    const fromSave = advanceMarket(submitMarketOffer(parseSeason(serializeSeason(countered)), 'rhf-1', requiredNegotiationWage('rhf-1', 3), 3));
    expect(fromSave).toEqual(accepted);
    expect(parseSeason(serializeSeason(accepted))).toEqual(accepted);
    expect(accepted.finance).toEqual(completed.finance);
    expect(accepted.payroll).toEqual(completed.payroll);
    expect(accepted.activeMatch).toEqual(completed.activeMatch);
  });

  it('registers a recruited player and agreed wages only at rollover, retaining dated market and sporting history', () => {
    let state = completed;
    for (const player of state.clubs.find(club => club.id === clubId)!.players.slice(0, 7)) state = submitMarketOffer(state, player.id, getSeasonWage(player.id), 1);
    const incoming = DEVELOPMENT_PLAYERS.find(player => !player.id.startsWith('rhf-') && quotePlayerContract(state, player.id, requiredNegotiationWage(player.id, 3), 3).canOffer)!;
    expect(incoming).toBeTruthy();
    state = submitMarketOffer(state, incoming.id, requiredNegotiationWage(incoming.id, 3), 3);
    const registeredBefore = state.clubs.find(club => club.id === clubId)!;
    expect(registeredBefore.players.some(player => player.id === incoming.id)).toBe(false);
    const resolved = resolvePending(state);
    expect(resolved.clubs).toBe(completed.clubs);
    expect(getMarketStartReason(resolved)).toBeNull();
    expect(resolved.date < getMarketWindow(resolved)!.closesOn).toBe(true);
    const oldPerformance = getSeasonPerformance(resolved);
    const next = rolloverSeason(resolved);
    expect(next.date).toBe(seasonStartDate(2));
    expect(next.status).toBe('active');
    expect(next.clubs.find(club => club.id === clubId)!.players.some(player => player.id === incoming.id)).toBe(true);
    expect(next.payroll.agreements.find(term => term.playerId === incoming.id && term.seasonNumber === 2)).toMatchObject({ clubId, seasonWage: requiredNegotiationWage(incoming.id, 3) });
    expect(next.market.windows).toHaveLength(1);
    expect(next.market.windows[0]).toMatchObject({ closed: true, seasonNumber: 1, date: resolved.date, offers: getMarketWindow(resolved)!.offers });
    expect(next.negotiations.records).toEqual(resolved.negotiations.records);
    expect(getSeasonPerformance(restoreSeniorDetail(next, resolved), 1)).toEqual(oldPerformance);
    expect(Object.values(next.conditions).every(condition => condition === 100)).toBe(true);
    expect(parseSeason(serializeSeason(next))).toEqual(next);
    expect(play(parseSeason(serializeSeason(next)))).toEqual(play(next));
    const second = finish(next);
    expect(second.market.windows).toHaveLength(2);
    expect(second.market.windows[0]).toEqual(next.market.windows[0]);
    expect(getMarketWindow(second)!.seasonNumber).toBe(2);
    expect(getLiveMarketOffers(second).some(offer => offer.playerId === incoming.id)).toBe(false);
    expect(contractForSeason(second.employment, incoming.id, 4)?.clubId).toBe(clubId);
    expect(parseSeason(serializeSeason(second))).toEqual(second);
  }, 30_000);

  it('withdraws an unresolved proposal before early rollover rather than silently dropping it', () => {
    let state = resolvePending(setEmploymentDelegation(completed, true));
    state = setEmploymentDelegation(state, false);
    const spare = DEVELOPMENT_PLAYERS.find(player => quotePlayerContract(state, player.id, getSeasonWage(player.id), 1).canOffer);
    expect(spare).toBeTruthy();
    state = submitMarketOffer(state, spare!.id, getSeasonWage(spare!.id), 1);
    expect(() => rolloverSeason(state)).toThrow(/offer|resolve|withdraw/i);
    const pending = getMarketOffers(state, clubId, true).find(offer => offer.playerId === spare!.id)!;
    state = withdrawMarketOffer(state, pending.id);
    expect(getMarketStartReason(state)).toBeNull();
    expect(rolloverSeason(state).seasonNumber).toBe(2);
  });

  it('honors an accepted last-day response without extending the advertised closing date', () => {
    let state = setEmploymentDelegation(resolvePending(setEmploymentDelegation(completed, true)), false);
    const extra = DEVELOPMENT_PLAYERS.find(player => quotePlayerContract(state, player.id, getSeasonWage(player.id), 1).canOffer)!;
    expect(extra).toBeTruthy();
    state = lastProposalDay(state, extra.id);
    const close = getMarketWindow(state)!.closesOn;
    const offered = submitMarketOffer(state, extra.id, getSeasonWage(extra.id), 1);
    expect(getMarketOffers(offered, clubId, true)[0]).toMatchObject({ responseOn: close, expiresOn: close });
    const resolved = advanceMarket(offered);
    expect(resolved.date).toBe(close);
    expect(getMarketWindow(resolved)!.closesOn).toBe(close);
    expect(getMarketOffers(resolved).at(-1)).toMatchObject({ playerId: extra.id, status: 'accepted', respondedOn: close, closedOn: close });
    expect(getNextMarketDate(resolved)).toBeNull();
    expect(getMarketStartReason(resolved)).toBeNull();
    expect(() => submitMarketOffer(resolved, 'rhf-1', getSeasonWage('rhf-1'), 1)).toThrow();
    expect(parseSeason(serializeSeason(resolved))).toEqual(resolved);
    expect(rolloverSeason(resolved).seasonNumber).toBe(2);
  });

  it('expires a last-day counter at the same published deadline without retaining wages or a slot', () => {
    let state = setEmploymentDelegation(resolvePending(setEmploymentDelegation(completed, true)), false);
    const extra = DEVELOPMENT_PLAYERS.find(player => quotePlayerContract(state, player.id, getSeasonWage(player.id), 3).canOffer)!;
    expect(extra).toBeTruthy();
    state = lastProposalDay(state, extra.id);
    const close = getMarketWindow(state)!.closesOn;
    state = advanceMarket(submitMarketOffer(state, extra.id, getSeasonWage(extra.id), 3));
    const offer = getMarketOffers(state).at(-1)!;
    expect(offer).toMatchObject({ status: 'expired', responseOn: close, expiresOn: close, respondedOn: close, closedOn: close });
    expect(state.negotiations.records.find(record => record.id === offer.negotiationId)?.outcome).toBe('countered');
    expect(contractForSeason(state.employment, extra.id, 2)).toBeNull();
    for (const year of [2, 3, 4]) expect(getClubContractSummary(state, clubId, year)).toMatchObject({ reservedRosterSize: 0, reservedWages: 0 });
    expect(parseSeason(serializeSeason(state))).toEqual(state);
    expect(getMarketStartReason(state)).toBeNull();
  });

  it('rejects an irreversible closing with only seven signings, then accepts an improved eighth offer on time', () => {
    let state = completed;
    for (let index = 1; index <= 7; index += 1) state = submitMarketOffer(state, `rhf-${index}`, getSeasonWage(`rhf-${index}`), 1);
    state = resolvePending(state);
    expect(getClubContractSummary(state, clubId).rosterSize).toBe(7);
    state = lastProposalDay(state, 'rhf-8');
    state = submitMarketOffer(state, 'rhf-8', getSeasonWage('rhf-8'), 3);
    const snapshot = structuredClone(state);
    expect(() => advanceMarket(state)).toThrow(/eight|incomplete squad/i);
    expect(state).toEqual(snapshot);
    expect(getMarketOffers(state, clubId, true)[0]!.status).toBe('pending');
    const improved = submitMarketOffer(state, 'rhf-8', requiredNegotiationWage('rhf-8', 3), 3);
    const resolved = advanceMarket(improved);
    expect(getClubContractSummary(resolved, clubId)).toMatchObject({ rosterSize: 8, reservedRosterSize: 0 });
    expect(getMarketStartReason(resolved)).toBeNull();
    expect(parseSeason(serializeSeason(resolved))).toEqual(resolved);
    expect(rolloverSeason(resolved).seasonNumber).toBe(2);
  });

  it('protects carried multi-year wages and counts an amended reservation once in the next offseason', () => {
    let state = create();
    for (const id of ['rhf-1', 'rhf-2', 'rhf-3']) state = offerPlayerContract(state, id, MAX_CONTRACT_WAGE, 3);
    for (const id of ['rhf-6', 'rhf-7', 'rhf-8', 'rhf-9', 'rhf-10']) state = offerPlayerContract(state, id, getSeasonWage(id), 1);
    state = finish(rolloverSeason(resolvePending(finish(state))));
    for (const year of [3, 4]) expect(getClubContractSummary(state, clubId, year)).toMatchObject({ rosterSize: 3, seasonWages: 15_000_000, minimumReserve: 9_000_000, reservedRosterSize: 0 });
    state = submitMarketOffer(state, 'rhf-6', getSeasonWage('rhf-6'), 2);
    state = submitMarketOffer(state, 'rhf-6', 1_800_000, 3);
    expect(getMarketOffers(state, clubId, true)).toHaveLength(1);
    for (const year of [3, 4]) expect(getClubContractSummary(state, clubId, year)).toMatchObject({ rosterSize: 3, seasonWages: 15_000_000, reservedRosterSize: 1, reservedWages: 1_800_000, minimumReserve: 7_200_000, spendableBudget: 0 });
    expect(getClubContractSummary(state, clubId, 5)).toMatchObject({ rosterSize: 0, seasonWages: 0, reservedRosterSize: 1, reservedWages: 1_800_000 });
    const before = structuredClone(state);
    expect(() => submitMarketOffer(state, 'rhf-6', 2_000_000, 3)).toThrow(/budget|allocation|reserve/i);
    expect(state).toEqual(before);
    expect(parseSeason(serializeSeason(state))).toEqual(state);
  }, 30_000);
});
