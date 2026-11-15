import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { DEVELOPMENT_PLAYERS } from '../src/data/development-players';
import { getSeasonWage } from '../src/data/development-wages';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { contractForSeason, getClubContractSummary } from '../src/world/employment-policy';
import { advanceMarket, decideClubTransfer, submitMarketOffer, submitTransferOffer } from '../src/world/market';
import { addMarketDays, getMarketOffers, getMarketStartReason, getMarketWindow, getReservedTransferFees } from '../src/world/market-policy';
import { advanceSeason, createSeason, managedSide } from '../src/world/season';
import { requiredTransferFee } from '../src/world/transfers-policy';

const buyer = 'rhine-falcons', seller = 'aegean-waves';
const latest = (state: SeasonState, clubId: string, playerId: string) => getMarketOffers(state, clubId).filter(offer => offer.playerId === playerId).at(-1)!;
function finalProposal(state: SeasonState): SeasonState {
  const closes = getMarketWindow(state)!.closesOn;
  const free = DEVELOPMENT_PLAYERS.find(player => !contractForSeason(state.employment, player.id, state.seasonNumber + 1))!;
  while (addMarketDays(state.date, 2) < closes) state = advanceMarket(submitMarketOffer(state, free.id, 500_000, 1));
  return state;
}

describe('club consent, expiry and the final transfer dates', () => {
  let ready: SeasonState;
  beforeAll(() => {
    ready = createSeason(77, buyer, 'off', true, true, true, true, null, true, true, true, true);
    while (ready.status === 'active') ready = advanceSeason({ ...ready, activeMatch: simulateToEnd(setAutoSubstitutions(ready.activeMatch!, managedSide(ready), true)) });
    for (const player of ready.clubs.find(club => club.id === buyer)!.players.slice(0, 8)) ready = submitMarketOffer(ready, player.id, getSeasonWage(player.id), 1);
    ready = advanceMarket(ready);
    expect(getMarketStartReason(ready)).toBeNull();
  }, 30_000);

  it('expires unanswered incoming offers without selling the player or charging either club', () => {
    const playerId = getClubContractSummary(ready, buyer).contracts[0]!.playerId;
    let state = submitTransferOffer(ready, playerId, getSeasonWage(playerId), 1, requiredTransferFee(ready, playerId), seller);
    state = advanceMarket(state);
    const incoming = latest(state, seller, playerId);
    expect(incoming.status).toBe('club-review');
    expect(() => decideClubTransfer(state, incoming.id, 'accept', seller)).toThrow(/your club/);
    expect(state.finance).toEqual(ready.finance);
    expect(state.employment).toEqual(ready.employment);
    while (state.date < incoming.expiresOn) state = advanceMarket(state);
    expect(latest(state, seller, playerId).status).toBe('expired');
    expect(getReservedTransferFees(state, seller)).toBe(0);
    expect(state.finance).toEqual(ready.finance);
    expect(state.employment.transfers).toHaveLength(0);
    expect(contractForSeason(state.employment, playerId, 2)?.clubId).toBe(buyer);
    expect(() => decideClubTransfer(state, incoming.id, 'accept')).toThrow(/awaiting/);
    expect(parseSeason(serializeSeason(state))).toEqual(state);
  });

  it('records a club refusal when a late sale would leave no time to replace its eighth player', () => {
    const start = finalProposal(ready), playerId = getClubContractSummary(start, seller).contracts[0]!.playerId;
    const pending = submitTransferOffer(start, playerId, getSeasonWage(playerId), 1, requiredTransferFee(start, playerId));
    const replied = advanceMarket(pending), offer = latest(replied, buyer, playerId);
    expect(offer.status).toBe('rejected');
    expect(offer.transfer).toMatchObject({ clubStatus: 'rejected', clubReason: expect.stringMatching(/day.*replacement/) });
    expect(replied.finance).toEqual(start.finance);
    expect(getReservedTransferFees(replied, buyer)).toBe(0);
    expect(replied.employment.transfers).toHaveLength(0);
    expect(contractForSeason(replied.employment, playerId, 2)?.clubId).toBe(seller);
    expect(parseSeason(serializeSeason(replied))).toEqual(replied);
  });

  it('completes on the closing date when club consent leaves a legal seller squad', () => {
    const free = DEVELOPMENT_PLAYERS.find(player => !contractForSeason(ready.employment, player.id, 2))!;
    let state = advanceMarket(submitMarketOffer(ready, free.id, getSeasonWage(free.id), 1, seller));
    expect(getClubContractSummary(state, seller).rosterSize).toBe(9);
    state = finalProposal(state);
    const playerId = getClubContractSummary(state, seller).contracts[0]!.playerId, fee = requiredTransferFee(state, playerId);
    const pending = submitTransferOffer(state, playerId, getSeasonWage(playerId), 1, fee);
    const consented = advanceMarket(pending);
    expect(latest(consented, buyer, playerId).transfer?.clubStatus).toBe('accepted');
    expect(consented.finance).toEqual(state.finance);
    const completed = advanceMarket(consented);
    expect(completed.date).toBe(getMarketWindow(completed)!.closesOn);
    expect(latest(completed, buyer, playerId).status).toBe('accepted');
    expect(getClubContractSummary(completed, seller).rosterSize).toBe(8);
    expect(completed.finance.ledger.slice(state.finance.ledger.length).map(entry => entry.amount)).toEqual([-fee, fee]);
    expect(completed.activeMatch!).toBe(state.activeMatch!);
    expect(getMarketStartReason(completed)).toBeNull();
    expect(parseSeason(serializeSeason(completed))).toEqual(completed);
  });
});
