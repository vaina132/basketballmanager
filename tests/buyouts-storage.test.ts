import { stripInSeasonRecruitment } from './helpers/legacy-season';
import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { getSeasonWage } from '../src/data/development-wages';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { contractForSeason, getAvailablePlayers, getClubContractSummary, quotePlayerContract } from '../src/world/employment-policy';
import { getFinanceBalance } from '../src/world/finance';
import { advanceMarket, buyoutPlayerContract, decideClubTransfer, submitMarketOffer, submitTransferOffer } from '../src/world/market';
import { getLiveMarketOffers, getMarketStartReason } from '../src/world/market-policy';
import { requiredNegotiationWage } from '../src/world/negotiations-policy';
import { requiredTransferFee } from '../src/world/transfers-policy';
import { advanceSeason, createSeason, managedSide, rolloverSeason } from '../src/world/season';

const managed = 'rhine-falcons', rival = 'aegean-waves';
const encode = (state: unknown, formatVersion = 30) => JSON.stringify({ format: 'basketball-manager-season', formatVersion, engineVersion: 'possession-3', state });
const play = (state: SeasonState) => advanceSeason({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) });
const finish = (initial: SeasonState) => { let state = initial; while (state.status === 'active') state = play(state); return state; };
function settle(initial: SeasonState): SeasonState {
  let state = initial;
  for (let step = 0; getMarketStartReason(state) && step < 35; step += 1) {
    for (const offer of getLiveMarketOffers(state).filter(offer => offer.status === 'club-review' && offer.transfer?.sellerClubId === managed)) state = decideClubTransfer(state, offer.id, 'reject');
    while (getClubContractSummary(state, managed).rosterSize + getClubContractSummary(state, managed).reservedRosterSize < 8) {
      const player = getAvailablePlayers(state).find(player => quotePlayerContract(state, player.id, getSeasonWage(player.id), 1).canOffer);
      if (!player) break;
      state = submitMarketOffer(state, player.id, getSeasonWage(player.id), 1);
    }
    if (getMarketStartReason(state)) state = advanceMarket(state);
  }
  expect(getMarketStartReason(state)).toBeNull();
  return state;
}

let ready: SeasonState, released: SeasonState, signed: SeasonState, opening: SeasonState, nextWindow: SeasonState, acquiredRelease: SeasonState;
let playerId: string;
beforeAll(() => {
  let state = advanceMarket(finish(createSeason(53, managed, 'off', true, true, true, true, null, true, true, true, true)));
  playerId = state.clubs.find(club => club.id === managed)!.players[0]!.id;
  for (const player of state.clubs.find(club => club.id === managed)!.players.slice(0, 8)) state = submitMarketOffer(state, player.id, requiredNegotiationWage(player.id, player.id === playerId ? 3 : 1), player.id === playerId ? 3 : 1);
  ready = advanceMarket(state);
  released = buyoutPlayerContract(ready, playerId);
  signed = advanceMarket(submitMarketOffer(released, playerId, getSeasonWage(playerId), 1, rival));
  opening = rolloverSeason(settle(signed));
  nextWindow = finish(opening);
  const target = getClubContractSummary(ready, rival).contracts[0]!.playerId;
  const transferred = advanceMarket(advanceMarket(submitTransferOffer(ready, target, getSeasonWage(target), 1, requiredTransferFee(ready, target), managed, 'three-payments')));
  acquiredRelease = buyoutPlayerContract(transferred, target);
}, 120_000);

describe('contract buyout persistence', () => {
  it('preserves release, competing recruitment, opening payroll and later historical replay', () => {
    for (const state of [ready, released, signed, opening, nextWindow, acquiredRelease]) expect(parseSeason(serializeSeason(state))).toEqual(state);
    expect(contractForSeason(released.employment, playerId, 2)).toBeNull();
    expect(contractForSeason(signed.employment, playerId, 2)?.clubId).toBe(rival);
    expect(opening.payroll.agreements.find(agreement => agreement.playerId === playerId && agreement.seasonNumber === 2)?.clubId).toBe(rival);
    expect(opening.history[0]!.rosters.find(roster => roster.clubId === managed)!.players.some(player => player.id === playerId)).toBe(true);
    expect(advanceMarket(parseSeason(serializeSeason(nextWindow)))).toEqual(advanceMarket(nextWindow));
  }, 60_000);

  it('settles only salary compensation and preserves unpaid fees on an earlier transfer', () => {
    const buyout = acquiredRelease.employment.buyouts.at(-1)!;
    const transfer = acquiredRelease.employment.transfers.find(transfer => transfer.playerId === buyout.playerId)!;
    expect(transfer.paymentPlan).toBe('three-payments');
    expect(transfer.payments).toHaveLength(1);
    expect(acquiredRelease.finance.ledger.filter(entry => entry.kind === 'buyout')).toEqual([expect.objectContaining({ clubId: managed, sourceId: buyout.id, amount: -buyout.amount })]);
    const restored = parseSeason(serializeSeason(acquiredRelease));
    expect(restored.employment.transfers).toEqual(acquiredRelease.employment.transfers);
  });

  it('allows the original employer to rehire after a buyer releases a transferred multi-year player', () => {
    let state = advanceMarket(finish(rolloverSeason(ready)));
    expect(contractForSeason(state.employment, playerId, 2)?.endsSeason).toBe(4);
    state = advanceMarket(submitTransferOffer(state, playerId, getSeasonWage(playerId), 1, requiredTransferFee(state, playerId), rival));
    const incoming = getLiveMarketOffers(state).find(offer => offer.playerId === playerId && offer.clubId === rival)!;
    state = advanceMarket(decideClubTransfer(state, incoming.id, 'accept'));
    expect(contractForSeason(state.employment, playerId, 3)?.clubId).toBe(rival);
    state = buyoutPlayerContract(state, playerId, rival);
    expect(parseSeason(serializeSeason(state))).toEqual(state);
    state = advanceMarket(submitMarketOffer(state, playerId, 5_000_000, 1, managed));
    expect(contractForSeason(state.employment, playerId, 2)?.clubId).toBe(managed);
    expect(contractForSeason(state.employment, playerId, 3)).toMatchObject({ clubId: managed, kind: 'free-agent' });
    expect(parseSeason(serializeSeason(state))).toEqual(state);
  }, 60_000);

  it('migrates a genuine format16-shaped career without changing payments or funds', () => {
    const legacy = structuredClone(ready) as unknown as { schemaVersion: number; employment: Record<string, unknown> };
    stripInSeasonRecruitment(legacy); legacy.schemaVersion = 16; delete legacy.employment.buyouts;
    const restored = parseSeason(encode(legacy, 16));
    expect(restored).toEqual({ ...ready, recruitment: { model: 'recruitment-1', enabledSince: null, transfersEnabledSince: null, events: [], offers: [] } });
    expect(restored.employment.buyouts).toEqual([]);
    expect(getFinanceBalance(restored.finance, managed)).toEqual(getFinanceBalance(ready.finance, managed));
    const forged = structuredClone(legacy);
    forged.employment.buyouts = released.employment.buyouts;
    expect(() => parseSeason(encode(forged, 16))).toThrow();
  });

  it.each([
    ['amount', (state: SeasonState) => { state.employment.buyouts[0]!.amount += 1; }],
    ['owner', (state: SeasonState) => { state.employment.buyouts[0]!.clubId = rival; }],
    ['player', (state: SeasonState) => { state.employment.buyouts[0]!.playerId = 'rhf-2'; }],
    ['date', (state: SeasonState) => { state.employment.buyouts[0]!.completedOn = '2026-11-08'; }],
    ['effective season', (state: SeasonState) => { state.employment.buyouts[0]!.startsSeason += 1; }],
    ['contract prefix', (state: SeasonState) => { state.employment.buyouts[0]!.contractCountBefore -= 1; }],
    ['negotiation prefix', (state: SeasonState) => { state.employment.buyouts[0]!.negotiationCountBefore -= 1; }],
    ['released agreement', (state: SeasonState) => { state.employment.buyouts[0]!.releasedContractIds = [state.employment.contracts[0]!.id]; }],
    ['missing release command', (state: SeasonState) => { state.market.windows.at(-1)!.events = state.market.windows.at(-1)!.events.filter(event => event.type !== 'buyout'); }],
    ['missing settlement', (state: SeasonState) => { state.finance.ledger = state.finance.ledger.filter(entry => entry.kind !== 'buyout').map((entry, index) => ({ ...entry, id: `finance-${index + 1}` })); }],
    ['credit instead of cost', (state: SeasonState) => { state.finance.ledger.find(entry => entry.kind === 'buyout')!.amount *= -1; }],
    ['duplicate release', (state: SeasonState) => { state.employment.buyouts.push({ ...state.employment.buyouts[0]!, id: 'employment-buyout-2' }); }],
  ] as const)('rejects altered %s', (_label, change) => {
    const damaged = structuredClone(released); change(damaged);
    expect(() => parseSeason(encode(damaged))).toThrow();
  });
});
