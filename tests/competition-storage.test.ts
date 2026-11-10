import { stripInSeasonRecruitment } from './helpers/legacy-season';
import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { getSeasonWage } from '../src/data/development-wages';
import { setAutoSubstitutions, simulateToEnd, stepMatch } from '../src/engine/match';
import { parseSeason, serializeSeason, validateSeasonState } from '../src/storage/season-storage';
import { contractForSeason, getClubContractSummary } from '../src/world/employment-policy';
import { advanceMarket, applyMarketEvent, enableMarket, submitMarketOffer, withdrawMarketOffer } from '../src/world/market';
import { getMarketWindow } from '../src/world/market-policy';
import { advanceSeason, createSeason, managedSide, rolloverSeason } from '../src/world/season';

const clubId = 'rhine-falcons', playerId = 'rhf-1';
const window = (state: SeasonState) => getMarketWindow(state)!;
const envelope = (state: unknown, formatVersion = 22) => JSON.stringify({ format: 'basketball-manager-season', formatVersion, engineVersion: 'possession-3', state });
const play = (state: SeasonState): SeasonState => advanceSeason({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) });
function complete(state: SeasonState): SeasonState { while (state.status === 'active') state = play(state); return state; }

/** Reconstruct the format13 shape from a window explicitly replayed under its original rules. */
function format13(state: SeasonState): string {
  const previous = structuredClone(state) as unknown as Record<string, unknown>;
  stripInSeasonRecruitment(previous); previous.schemaVersion = 13;
  delete (previous.employment as Record<string, unknown>).transfers; delete (previous.employment as Record<string, unknown>).buyouts;
  const market = previous.market as { windows: Array<Record<string, unknown>> };
  for (const oldWindow of market.windows) {
    delete oldWindow.competitionFromEvent;
    for (const offer of oldWindow.offers as Array<Record<string, unknown>>) { delete offer.chosenOfferId; delete offer.transfer; }
  }
  return envelope(previous, 13);
}

let opened: SeasonState, pending: SeasonState, resolved: SeasonState, counterLost: SeasonState, ready: SeasonState, second: SeasonState;
let legacyPending: SeasonState, legacyResolved: SeasonState, legacySecond: SeasonState;
let rivalId: string, winnerId: string;
beforeAll(() => {
  opened = enableMarket(complete(createSeason(83, clubId, 'standard', true, true, true, true, null, true, true, true)));
  [rivalId, winnerId] = opened.clubs.filter(club => club.id !== clubId).slice(0, 2).map(club => club.id) as [string, string];
  pending = submitMarketOffer(opened, playerId, 1_800_000, 1);
  pending = submitMarketOffer(pending, playerId, 1_900_000, 1, rivalId);
  pending = submitMarketOffer(pending, playerId, 2_000_000, 1, winnerId);
  resolved = advanceMarket(pending);
  let counter = advanceMarket(submitMarketOffer(opened, playerId, 1_500_000, 1));
  counterLost = advanceMarket(submitMarketOffer(counter, playerId, 2_000_000, 1, winnerId));
  ready = resolved;
  for (const player of opened.clubs.find(club => club.id === clubId)!.players.slice(1, 9)) ready = submitMarketOffer(ready, player.id, getSeasonWage(player.id), 1);
  ready = advanceMarket(ready);
  second = rolloverSeason(ready);

  const old = structuredClone(opened);
  window(old).competitionFromEvent = null;
  legacyPending = submitMarketOffer(old, playerId, 1_800_000, 1);
  legacyResolved = advanceMarket(legacyPending);
  let legacyReady = legacyResolved;
  for (const player of opened.clubs.find(club => club.id === clubId)!.players.slice(1, 8)) legacyReady = submitMarketOffer(legacyReady, player.id, getSeasonWage(player.id), 1);
  legacySecond = rolloverSeason(advanceMarket(legacyReady));
}, 60_000);

describe('competing recruitment persistence', () => {
  it('round-trips simultaneous reservations, selected offers and lost bids without changing match RNG', () => {
    for (const state of [opened, pending, resolved, counterLost, ready, second]) {
      const text = serializeSeason(state), restored = parseSeason(text);
      expect(JSON.parse(text).formatVersion).toBe(22);
      expect(restored).toEqual(state);
      expect(stepMatch(restored.activeMatch)).toEqual(stepMatch(state.activeMatch));
    }
    expect(advanceMarket(parseSeason(serializeSeason(pending)))).toEqual(resolved);
  });

  it('releases only the losing clubs’ reservations and links the player choice to its accepted offer', () => {
    const chosen = window(resolved).offers.find(offer => offer.clubId === winnerId)!;
    expect(chosen.status).toBe('accepted');
    expect(contractForSeason(resolved.employment, playerId, 2)?.clubId).toBe(winnerId);
    for (const id of [clubId, rivalId]) {
      expect(getClubContractSummary(pending, id).reservedRosterSize).toBe(1);
      expect(getClubContractSummary(resolved, id).reservedRosterSize).toBe(0);
      expect(window(resolved).offers.find(offer => offer.clubId === id)).toMatchObject({ status: 'lost', chosenOfferId: chosen.id, respondedOn: null, closedOn: resolved.date, negotiationId: null });
    }
    expect(resolved.negotiations.records.length).toBe(pending.negotiations.records.length + 1);
    expect(resolved.finance).toEqual(pending.finance);
    expect(resolved.payroll).toEqual(pending.payroll);
  });

  it('retains the original counter response when a player later signs for a rival', () => {
    const lost = window(counterLost).offers.find(offer => offer.clubId === clubId)!;
    expect(lost.status).toBe('lost');
    expect(lost.respondedOn! < lost.closedOn!).toBe(true);
    expect(counterLost.negotiations.records.find(record => record.id === lost.negotiationId)?.outcome).toBe('countered');
    expect(parseSeason(serializeSeason(counterLost))).toEqual(counterLost);
  });

  it('retains choice history through rollover and registers the winner’s salary in the new payroll', () => {
    expect(second.market.windows[0]!.offers).toEqual(window(ready).offers);
    expect(second.clubs.find(club => club.id === winnerId)!.players.some(player => player.id === playerId)).toBe(true);
    expect(second.clubs.find(club => club.id === clubId)!.players.some(player => player.id === playerId)).toBe(false);
    expect(second.payroll.agreements.find(agreement => agreement.seasonNumber === 2 && agreement.playerId === playerId)).toMatchObject({ clubId: winnerId, seasonWage: 2_000_000 });
  });

  it('preserves format13 pending offer rules until every old proposal has resolved', () => {
    const restored = parseSeason(format13(legacyPending));
    expect(restored.schemaVersion).toBe(22);
    expect(window(restored).competitionFromEvent).toBeNull();
    expect(window(restored).offers).toEqual(window(legacyPending).offers);
    expect(restored.negotiations).toEqual(legacyPending.negotiations);
    expect(restored.employment).toEqual(legacyPending.employment);
    expect(restored.activeMatch).toEqual(legacyPending.activeMatch);
    expect(restored.finance).toEqual(legacyPending.finance);
    expect(restored.payroll).toEqual(legacyPending.payroll);
    expect(() => submitMarketOffer(restored, playerId, 2_000_000, 1, winnerId)).toThrow();
    const settled = advanceMarket(restored);
    expect(settled.employment).toEqual(legacyResolved.employment);
    expect(settled.negotiations).toEqual(legacyResolved.negotiations);
    expect(window(settled).competitionFromEvent).toBe(window(settled).events.length);
    let competed = submitMarketOffer(settled, 'rhf-2', 1_800_000, 1);
    competed = submitMarketOffer(competed, 'rhf-2', 2_000_000, 1, winnerId);
    expect(parseSeason(serializeSeason(competed))).toEqual(competed);
    const decided = advanceMarket(competed);
    expect(contractForSeason(decided.employment, 'rhf-2', 2)?.clubId).toBe(winnerId);
    expect(parseSeason(serializeSeason(decided))).toEqual(decided);
  });

  it('preserves already accepted format13 offers and historical single-offer windows', () => {
    const restored = parseSeason(format13(legacyResolved));
    expect(restored.employment).toEqual(legacyResolved.employment);
    expect(restored.negotiations).toEqual(legacyResolved.negotiations);
    expect(window(restored).offers).toEqual(window(legacyResolved).offers);
    expect(parseSeason(serializeSeason(restored))).toEqual(restored);
    const historic = parseSeason(format13(legacySecond));
    expect(historic.market.windows[0]!.competitionFromEvent).toBeNull();
    expect(historic.market.windows[0]!.offers).toEqual(legacySecond.market.windows[0]!.offers);
    expect(historic.history).toEqual(legacySecond.history);
    expect(historic.activeMatch).toEqual(legacySecond.activeMatch);
    const nextWindow = complete(historic);
    expect(window(nextWindow).competitionFromEvent).toBe(0);
    expect(parseSeason(serializeSeason(nextWindow))).toEqual(nextWindow);
  }, 30_000);

  it('supports withdrawing a migrated offer without reviving old holds on reload', () => {
    const restored = parseSeason(format13(legacyPending));
    const withdrawn = withdrawMarketOffer(restored, window(restored).offers[0]!.id);
    expect(parseSeason(serializeSeason(withdrawn))).toEqual(withdrawn);
    expect(getClubContractSummary(withdrawn, clubId).reservedRosterSize).toBe(0);
  });

  it('keeps a format13 low-salary reservation under its old budget rule until the final hold clears', () => {
    let old = structuredClone(opened);
    window(old).competitionFromEvent = null;
    const ids = opened.clubs.find(club => club.id === clubId)!.players.slice(0, 8).map(player => player.id);
    // Raw logged commands model the original executable before prospective automatic activation existed.
    for (const [index, id] of ids.entries()) old = applyMarketEvent(old, { type: 'offer', id: `market-1-${index + 1}`, date: old.date, clubId, playerId: id, seasonWage: index < 5 ? 500_000 : 5_000_000, seasons: 1 });
    let restored = parseSeason(format13(old));
    expect(getClubContractSummary(restored, clubId)).toEqual(getClubContractSummary(old, clubId));
    expect(window(restored).competitionFromEvent).toBeNull();
    for (const offer of window(old).offers.slice(0, -1)) {
      restored = withdrawMarketOffer(restored, offer.id);
      expect(window(restored).competitionFromEvent).toBeNull();
      expect(parseSeason(serializeSeason(restored))).toEqual(restored);
    }
    restored = withdrawMarketOffer(restored, window(old).offers.at(-1)!.id);
    expect(window(restored).competitionFromEvent).toBe(window(restored).events.length);
    expect(getClubContractSummary(restored, clubId).reservedRosterSize).toBe(0);
    expect(parseSeason(serializeSeason(restored))).toEqual(restored);
  });
});

describe('competing recruitment corruption rejection', () => {
  const changes: Array<[string, (state: SeasonState) => void]> = [
    ['missing policy boundary', state => { delete (window(state) as Partial<ReturnType<typeof window>>).competitionFromEvent; }],
    ['fractional policy boundary', state => { window(state).competitionFromEvent = 0.5; }],
    ['future policy boundary', state => { window(state).competitionFromEvent = window(state).events.length + 1; }],
    ['negative policy boundary', state => { window(state).competitionFromEvent = -1; }],
    ['policy activation with an earlier live bid', state => { window(state).competitionFromEvent = 1; }],
    ['unrecorded competing policy', state => { window(state).competitionFromEvent = null; }],
    ['invented winning offer', state => { window(state).offers.find(offer => offer.status === 'lost')!.chosenOfferId = 'invented'; }],
    ['losing offer selected as winner', state => { const lost = window(state).offers.find(offer => offer.status === 'lost')!; lost.chosenOfferId = lost.id; }],
    ['missing winning link', state => { window(state).offers.find(offer => offer.status === 'lost')!.chosenOfferId = null; }],
    ['lost reservation revived', state => { window(state).offers.find(offer => offer.status === 'lost')!.status = 'pending'; }],
    ['loss changed to withdrawal', state => { window(state).offers.find(offer => offer.status === 'lost')!.status = 'withdrawn'; }],
    ['fabricated losing response', state => { window(state).offers.find(offer => offer.status === 'lost')!.respondedOn = state.date; }],
    ['loss date moved', state => { window(state).offers.find(offer => offer.status === 'lost')!.closedOn = window(state).openedOn; }],
    ['winner points to a rival', state => { window(state).offers.find(offer => offer.status === 'accepted')!.chosenOfferId = window(state).offers.find(offer => offer.status === 'lost')!.id; }],
    ['winning offer wage edited', state => { window(state).offers.find(offer => offer.status === 'accepted')!.seasonWage += 50_000; }],
  ];
  it.each(changes)('rejects %s before replacing live state', (_label, change) => {
    const state = structuredClone(resolved); change(state);
    expect(() => validateSeasonState(state)).toThrow();
    expect(() => parseSeason(envelope(state))).toThrow();
  });

  it('rejects tampered format13 histories before assigning the new policy boundary', () => {
    const altered = JSON.parse(format13(legacyResolved));
    altered.state.market.windows[0].offers[0].expiresOn = '2026-12-31';
    expect(() => parseSeason(JSON.stringify(altered))).toThrow();
    const fakeLoss = JSON.parse(format13(legacyResolved));
    fakeLoss.state.market.windows[0].offers[0].status = 'lost';
    expect(() => parseSeason(JSON.stringify(fakeLoss))).toThrow();
    expect(() => parseSeason(format13(pending))).toThrow();
  });
});
