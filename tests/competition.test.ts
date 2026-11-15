import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { getSeasonWage } from '../src/data/development-wages';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { contractForSeason, getAvailablePlayers, getClubContractSummary, quotePlayerContract } from '../src/world/employment-policy';
import { advanceMarket, applyMarketEvent, scheduleMarketRecruitment, submitMarketOffer, withdrawMarketOffer } from '../src/world/market';
import { addMarketDays, getLiveMarketOffers, getMarketOffers, getMarketStartReason, getMarketWindow, getNextMarketDate, getRivalMarketOffers, isCompetitiveMarket } from '../src/world/market-policy';
import { advanceSeason, createSeason, managedSide } from '../src/world/season';

const managed = 'rhine-falcons', playerId = 'rhf-1';
const rivals = ['aegean-waves', 'alpine-stags'] as const;
const create = () => createSeason(53, managed, 'off', true, true, true, true, null, true, true, true, true);
function finish(state: SeasonState): SeasonState {
  while (state.status === 'active') state = advanceSeason({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch!, managedSide(state), true)) });
  return state;
}
function clearOffers(state: SeasonState): SeasonState {
  for (const offer of getLiveMarketOffers(state)) state = withdrawMarketOffer(state, offer.id, offer.clubId);
  return state;
}
const respond = (state: SeasonState) => applyMarketEvent(state, { type: 'advance', date: getNextMarketDate(state)! });
const offerFor = (state: SeasonState, clubId: string, target = playerId) => getMarketOffers(state, clubId).filter(offer => offer.playerId === target).at(-1)!;
function propose(state: SeasonState, bids: { clubId: string; wage: number; years?: number }[], target = playerId): SeasonState {
  for (const bid of bids) state = submitMarketOffer(state, target, bid.wage, bid.years ?? 1, bid.clubId);
  return state;
}

describe('competing offers and player choice', () => {
  let completed: SeasonState, clean: SeasonState;
  beforeAll(() => { completed = finish(create()); clean = clearOffers(completed); }, 30_000);
  function lastDayWithSeven(shortClub: string): SeasonState {
    let state = clean;
    for (const club of state.clubs) for (const player of club.players.slice(0, club.id === shortClub ? 7 : 8)) state = submitMarketOffer(state, player.id, getSeasonWage(player.id), 1, club.id);
    state = respond(state);
    const closing = getMarketWindow(state)!.closesOn, weekBefore = addMarketDays(closing, -7);
    while (getNextMarketDate(state)! <= weekBefore) state = respond(state);
    while (addMarketDays(state.date, 1) < closing) state = respond(submitMarketOffer(state, 'rhf-9', 500_000, 1));
    return state;
  }

  it('keeps rival targets approachable and reserves each club’s own annual salary budget', () => {
    expect(isCompetitiveMarket(completed)).toBe(true);
    const rivalTarget = getLiveMarketOffers(completed)[0]!;
    expect(getAvailablePlayers(completed).some(player => player.id === rivalTarget.playerId)).toBe(true);
    const state = propose(clean, [{ clubId: managed, wage: 2_000_000, years: 3 }, { clubId: rivals[0], wage: 2_100_000, years: 2 }]);
    expect(getAvailablePlayers(state).some(player => player.id === playerId)).toBe(false);
    expect(getRivalMarketOffers(state, playerId).map(offer => offer.clubId)).toEqual([rivals[0]]);
    for (const year of [2, 3, 4]) {
      expect(getClubContractSummary(state, managed, year)).toMatchObject({ reservedWages: 2_000_000, reservedRosterSize: 1, seasonWages: 0 });
      expect(getClubContractSummary(state, rivals[0], year)).toMatchObject({ reservedWages: year <= 3 ? 2_100_000 : 0, reservedRosterSize: year <= 3 ? 1 : 0, seasonWages: 0 });
    }
    expect(state.finance).toBe(clean.finance);
    expect(state.payroll).toBe(clean.payroll);
    expect(state.activeMatch!).toBe(clean.activeMatch!);
    expect(state.employment).toBe(clean.employment);
  });

  it('chooses the highest acceptable annual salary, regardless of submission order or contract total', () => {
    const bids = [{ clubId: managed, wage: 2_000_000, years: 3 }, { clubId: rivals[0], wage: 2_100_000, years: 1 }, { clubId: rivals[1], wage: 2_000_000, years: 2 }];
    for (const order of [bids, [...bids].reverse(), [bids[1]!, bids[0]!, bids[2]!]]) {
      const pending = propose(clean, order), snapshot = structuredClone(pending), resolved = respond(pending);
      const winning = offerFor(resolved, rivals[0]);
      expect(contractForSeason(resolved.employment, playerId, 2)).toMatchObject({ clubId: rivals[0], seasonWage: 2_100_000, startsSeason: 2, endsSeason: 2 });
      expect(winning).toMatchObject({ status: 'accepted', chosenOfferId: null, respondedOn: resolved.date, closedOn: resolved.date });
      for (const club of [managed, rivals[1]]) {
        expect(offerFor(resolved, club)).toMatchObject({ status: 'lost', chosenOfferId: winning.id, negotiationId: null, respondedOn: null, closedOn: resolved.date });
        for (const year of [2, 3, 4]) expect(getClubContractSummary(resolved, club, year)).toMatchObject({ reservedRosterSize: 0, reservedWages: 0, seasonWages: 0 });
      }
      expect(resolved.negotiations.records).toHaveLength(clean.negotiations.records.length + 1);
      expect(resolved.employment.contracts.filter(contract => contract.playerId === playerId && contract.startsSeason === 2)).toHaveLength(1);
      expect(getLiveMarketOffers(resolved).filter(offer => offer.playerId === playerId)).toHaveLength(0);
      expect(getAvailablePlayers(resolved).some(player => player.id === playerId)).toBe(false);
      expect(quotePlayerContract(resolved, playerId, 5_000_000, 1).canOffer).toBe(false);
      for (const key of ['activeMatch', 'clubs', 'fixtures', 'rosters', 'finance', 'payroll', 'training', 'scouting'] as const) expect(resolved[key]).toBe(pending[key]);
      expect(resolved.activeMatch!.rngState).toBe(pending.activeMatch!.rngState);
      expect(respond(pending)).toEqual(resolved);
      expect(pending).toEqual(snapshot);
    }
  });

  it('breaks equal salaries by term length before current-club continuity', () => {
    const state = respond(propose(clean, [{ clubId: managed, wage: 2_000_000, years: 1 }, { clubId: rivals[0], wage: 2_000_000, years: 3 }]));
    expect(contractForSeason(state.employment, playerId, 2)?.clubId).toBe(rivals[0]);
    expect(contractForSeason(state.employment, playerId, 4)?.clubId).toBe(rivals[0]);
  });

  it('prefers the current club when both salary and length are equal', () => {
    for (const order of [[rivals[0], managed], [managed, rivals[0]]]) {
      const resolved = respond(propose(clean, order.map(clubId => ({ clubId, wage: 2_000_000, years: 3 }))));
      expect(contractForSeason(resolved.employment, playerId, 2)?.clubId).toBe(managed);
    }
  });

  it('resolves equal outsider bids independently of insertion order and the sporting RNG', () => {
    const bids = rivals.map(clubId => ({ clubId, wage: 2_000_000, years: 3 }));
    const forward = respond(propose(clean, bids)), reverse = respond(propose(clean, [...bids].reverse()));
    const chosen = contractForSeason(forward.employment, playerId, 2)?.clubId;
    expect(rivals).toContain(chosen);
    expect(contractForSeason(reverse.employment, playerId, 2)?.clubId).toBe(chosen);
    expect(forward.activeMatch!.rngState).toBe(clean.activeMatch!.rngState);
    expect(reverse.activeMatch!.rngState).toBe(clean.activeMatch!.rngState);
  });

  it('only replaces the acting club’s offer and releases its old multi-year holds', () => {
    let state = propose(clean, [{ clubId: managed, wage: 2_100_000, years: 3 }, { clubId: rivals[0], wage: 2_000_000, years: 3 }]);
    const original = offerFor(state, managed), rival = offerFor(state, rivals[0]);
    state = submitMarketOffer(state, playerId, 1_800_000, 1);
    expect(getMarketOffers(state).find(offer => offer.id === original.id)).toMatchObject({ status: 'replaced', chosenOfferId: null, closedOn: state.date });
    expect(offerFor(state, rivals[0])).toEqual(rival);
    expect(getClubContractSummary(state, managed, 2)).toMatchObject({ reservedWages: 1_800_000, reservedRosterSize: 1 });
    for (const year of [3, 4]) expect(getClubContractSummary(state, managed, year)).toMatchObject({ reservedWages: 0, reservedRosterSize: 0 });
    const snapshot = structuredClone(state);
    expect(() => submitMarketOffer(state, playerId, 5_050_000, 3)).toThrow();
    expect(state).toEqual(snapshot);
    expect(submitMarketOffer(state, playerId, 1_800_000, 1)).toBe(state);
    const resolved = respond(state);
    expect(contractForSeason(resolved.employment, playerId, 2)?.clubId).toBe(rivals[0]);
    expect(getMarketOffers(resolved).find(offer => offer.id === original.id)?.status).toBe('replaced');
  });

  it('protects minimum-squad funds even when a cheap pending target is lost to another club', () => {
    let state = clean;
    for (const index of [1, 2, 3]) state = submitMarketOffer(state, `rhf-${index}`, 5_000_000, 1);
    for (const index of [4, 5, 6, 7, 8]) state = submitMarketOffer(state, `rhf-${index}`, getSeasonWage(`rhf-${index}`), 1);
    const summary = getClubContractSummary(state, managed);
    expect(summary.rosterSize + summary.reservedRosterSize).toBe(8);
    expect(summary.seasonWages + summary.reservedWages + summary.minimumReserve).toBe(summary.budget);
    expect(quotePlayerContract(state, 'rhf-9', 2_000_000, 1).canOffer).toBe(false);
    state = submitMarketOffer(state, 'rhf-8', 2_000_000, 1, rivals[0]);
    const resolved = respond(state), remaining = getClubContractSummary(resolved, managed);
    expect(offerFor(resolved, managed, 'rhf-8').status).toBe('lost');
    expect(remaining).toMatchObject({ rosterSize: 7, reservedRosterSize: 0, reservedWages: 0, minimumReserve: 1_800_000 });
    expect(remaining.seasonWages + remaining.minimumReserve).toBeLessThanOrEqual(remaining.budget);
    expect(quotePlayerContract(resolved, 'rhf-9', getSeasonWage('rhf-9'), 1).canOffer).toBe(true);
  });

  it('withdraws the leading bid without touching the other club’s promise', () => {
    let state = propose(clean, [{ clubId: managed, wage: 2_100_000 }, { clubId: rivals[0], wage: 1_800_000 }]);
    const original = offerFor(state, managed), rival = offerFor(state, rivals[0]);
    expect(() => withdrawMarketOffer(state, rival.id)).toThrow();
    state = withdrawMarketOffer(state, original.id);
    expect(getClubContractSummary(state, managed)).toMatchObject({ reservedWages: 0, reservedRosterSize: 0 });
    expect(offerFor(state, rivals[0])).toEqual(rival);
    expect(getAvailablePlayers(state).some(player => player.id === playerId)).toBe(true);
    const resolved = respond(state);
    expect(contractForSeason(resolved.employment, playerId, 2)?.clubId).toBe(rivals[0]);
    expect(offerFor(resolved, managed)).toMatchObject({ status: 'withdrawn', chosenOfferId: null });
    expect(() => withdrawMarketOffer(resolved, offerFor(resolved, rivals[0]).id, rivals[0])).toThrow();
  });

  it('issues ordinary counters and rejections if no offer meets the player’s demand', () => {
    const pending = propose(clean, [{ clubId: managed, wage: 1_500_000 }, { clubId: rivals[0], wage: 1_000_000 }, { clubId: rivals[1], wage: 1_800_000, years: 3 }]);
    const resolved = respond(pending);
    expect(contractForSeason(resolved.employment, playerId, 2)).toBeNull();
    expect(offerFor(resolved, managed)).toMatchObject({ status: 'countered', chosenOfferId: null });
    expect(offerFor(resolved, rivals[0])).toMatchObject({ status: 'rejected', chosenOfferId: null });
    expect(offerFor(resolved, rivals[1])).toMatchObject({ status: 'countered', chosenOfferId: null });
    expect(resolved.negotiations.records).toHaveLength(clean.negotiations.records.length + 3);
    expect(getClubContractSummary(resolved, managed)).toMatchObject({ reservedWages: 1_500_000, reservedRosterSize: 1 });
    expect(getClubContractSummary(resolved, rivals[0])).toMatchObject({ reservedWages: 0, reservedRosterSize: 0 });
  });

  it('closes an existing counter after a rival signs, retaining its original response history', () => {
    let state = respond(submitMarketOffer(clean, playerId, 1_800_000, 3));
    const counter = offerFor(state, managed), originalRecord = state.negotiations.records.at(-1)!;
    expect(counter.status).toBe('countered');
    state = respond(submitMarketOffer(state, playerId, 2_000_000, 3, rivals[0]));
    expect(offerFor(state, managed)).toMatchObject({ status: 'lost', chosenOfferId: offerFor(state, rivals[0]).id, negotiationId: counter.negotiationId, respondedOn: counter.respondedOn, closedOn: state.date });
    expect(state.negotiations.records.find(record => record.id === originalRecord.id)).toEqual(originalRecord);
    expect(state.negotiations.records).toHaveLength(clean.negotiations.records.length + 2);
    expect(getRivalMarketOffers(state, playerId)).toHaveLength(0);
    for (const year of [2, 3, 4]) expect(getClubContractSummary(state, managed, year)).toMatchObject({ reservedWages: 0, reservedRosterSize: 0 });
  });

  it('replenishes an AI club after losing a target using another dated offer', () => {
    const target = getMarketOffers(completed, rivals[0], true)[0]!;
    const pending = submitMarketOffer(completed, target.playerId, getSeasonWage(target.playerId) + 200_000, 1);
    const firstReply = advanceMarket(pending), lost = getMarketOffers(firstReply, rivals[0]).find(offer => offer.id === target.id)!;
    expect(lost.status).toBe('lost');
    expect(contractForSeason(firstReply.employment, target.playerId, 2)?.clubId).toBe(managed);
    const repair = getMarketOffers(firstReply, rivals[0], true);
    expect(repair).toHaveLength(1);
    expect(repair[0]).toMatchObject({ status: 'pending', offeredOn: firstReply.date });
    expect(repair[0]!.responseOn > firstReply.date).toBe(true);
    expect(getClubContractSummary(firstReply, rivals[0])).toMatchObject({ rosterSize: 7, reservedRosterSize: 1 });
    const secondReply = advanceMarket(firstReply);
    expect(getClubContractSummary(secondReply, rivals[0])).toMatchObject({ rosterSize: 8, reservedRosterSize: 0 });
    expect(secondReply.activeMatch!).toBe(completed.activeMatch!);
    expect(secondReply.finance).toBe(completed.finance);
    expect(getMarketWindow(secondReply)!.offers.find(offer => offer.id === lost.id)?.chosenOfferId).toBe(lost.chosenOfferId);
  });

  it('finds an ordinary dated alternative when the manager wins an AI club’s last-day target', () => {
    let state = scheduleMarketRecruitment(lastDayWithSeven(rivals[0]));
    const closing = getMarketWindow(state)!.closesOn;
    const finalAiBid = getMarketOffers(state, rivals[0], true)[0]!;
    expect(finalAiBid.responseOn).toBe(closing);
    state = submitMarketOffer(state, finalAiBid.playerId, finalAiBid.seasonWage + 500_000, 1);
    const snapshot = structuredClone(state);
    const resolved = advanceMarket(state);
    expect(state).toEqual(snapshot);
    const repaired = getMarketOffers(resolved, rivals[0]).at(-1)!;
    expect(getMarketOffers(resolved, rivals[0]).find(offer => offer.id === finalAiBid.id)?.status).toBe('withdrawn');
    expect(repaired).toMatchObject({ status: 'accepted', offeredOn: state.date, responseOn: closing, respondedOn: closing, seasons: 1 });
    expect(repaired.playerId).not.toBe(finalAiBid.playerId);
    expect(repaired.seasonWage).toBe(getSeasonWage(repaired.playerId));
    expect(contractForSeason(resolved.employment, finalAiBid.playerId, 2)?.clubId).toBe(managed);
    expect(resolved.date).toBe(closing);
    expect(getMarketWindow(resolved)!.closesOn).toBe(closing);
    expect(getClubContractSummary(resolved, rivals[0])).toMatchObject({ rosterSize: 8, reservedRosterSize: 0 });
    expect(getMarketStartReason(resolved)).toBeNull();
  });

  it('repairs an AI-versus-AI deadline collision without requiring the manager to withdraw another club’s offer', () => {
    let state = scheduleMarketRecruitment(lastDayWithSeven(rivals[0]));
    const closing = getMarketWindow(state)!.closesOn, original = getMarketOffers(state, rivals[0], true)[0]!;
    state = submitMarketOffer(state, original.playerId, original.seasonWage + 500_000, 1, rivals[1]);
    const snapshot = structuredClone(state), resolved = advanceMarket(state);
    expect(state).toEqual(snapshot);
    expect(getMarketOffers(resolved, rivals[0]).find(offer => offer.id === original.id)?.status).toBe('withdrawn');
    expect(contractForSeason(resolved.employment, original.playerId, 2)?.clubId).toBe(rivals[1]);
    const replacement = getMarketOffers(resolved, rivals[0]).at(-1)!;
    expect(replacement).toMatchObject({ offeredOn: state.date, responseOn: closing, respondedOn: closing, status: 'accepted' });
    expect(getMarketStartReason(resolved)).toBeNull();
    expect(getMarketWindow(resolved)!.closesOn).toBe(closing);
    expect(resolved.finance).toBe(state.finance);
    expect(resolved.activeMatch!).toBe(state.activeMatch!);
    expect(parseSeason(serializeSeason(resolved))).toEqual(resolved);
  });

  it('retains the manager’s date and offers if a final-day loss leaves the manual squad incomplete', () => {
    let state = lastDayWithSeven(managed);
    const closing = getMarketWindow(state)!.closesOn, target = 'rhf-8';
    state = submitMarketOffer(state, target, getSeasonWage(target), 1);
    state = submitMarketOffer(state, target, getSeasonWage(target) + 500_000, 1, rivals[0]);
    const snapshot = structuredClone(state);
    expect(() => advanceMarket(state)).toThrow(/Rhine Falcons.*eight signed players/i);
    expect(state).toEqual(snapshot);
    expect(getMarketWindow(state)!.closesOn).toBe(closing);
    const resolved = advanceMarket(submitMarketOffer(state, target, getSeasonWage(target) + 1_000_000, 1));
    expect(getClubContractSummary(resolved, managed)).toMatchObject({ rosterSize: 8, reservedRosterSize: 0 });
    expect(contractForSeason(resolved.employment, target, 2)?.clubId).toBe(managed);
    expect(resolved.date).toBe(closing);
    expect(getMarketStartReason(resolved)).toBeNull();
  });
});
