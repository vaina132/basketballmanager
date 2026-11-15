import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { getSeasonWage } from '../src/data/development-wages';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { commitPlayerOffer } from '../src/world/employment';
import { contractForSeason, effectiveContractsForSeason, getClubContractSummary, getContractedClubs, quotePlayerContract } from '../src/world/employment-policy';
import { getFinanceBalance, recordTransferFee } from '../src/world/finance';
import { advanceMarket, applyMarketEvent, decideClubTransfer, submitMarketOffer, withdrawMarketOffer } from '../src/world/market';
import { addMarketDays, getLiveMarketOffers, getMarketOffers, getMarketWindow, getReservedTransferFees } from '../src/world/market-policy';
import { requiredNegotiationWage } from '../src/world/negotiations-policy';
import { getSpendableCash } from '../src/world/payroll-policy';
import { advanceSeason, createSeason, managedSide, rolloverSeason } from '../src/world/season';
import { getTransferCandidates, MAX_TRANSFER_FEE, quoteTransferOffer, requiredTransferFee, sellerReplacementReason } from '../src/world/transfers-policy';

const buyer = 'rhine-falcons', seller = 'aegean-waves', rival = 'alpine-stags';
const create = () => createSeason(53, buyer, 'off', true, true, true, true, null, true, true, true, true);
function finish(state: SeasonState): SeasonState {
  while (state.status === 'active') state = advanceSeason({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch!, managedSide(state), true)) });
  return state;
}
const offerFor = (state: SeasonState, clubId: string, playerId: string) => getMarketOffers(state, clubId).filter(offer => offer.playerId === playerId).at(-1)!;
function paid(state: SeasonState, playerId: string, wage = requiredNegotiationWage(playerId, 1), years = 1, fee = requiredTransferFee(state, playerId), clubId = buyer) {
  return applyMarketEvent(state, { type: 'offer', id: `market-${state.seasonNumber}-${getMarketWindow(state)!.offers.length + 1}`, date: state.date, clubId, playerId, seasonWage: wage, seasons: years, transferFee: fee });
}

describe('club transfer ownership, fee accounting and protected budgets', () => {
  let opened: SeasonState, ready: SeasonState, target: string;
  beforeAll(() => {
    opened = finish(create());
    let state = advanceMarket(opened);
    for (const player of state.clubs.find(club => club.id === buyer)!.players.slice(0, 8)) state = submitMarketOffer(state, player.id, getSeasonWage(player.id), 1);
    ready = advanceMarket(state);
    target = effectiveContractsForSeason(ready.employment, 2).find(contract => contract.clubId === seller)!.playerId;
  }, 30_000);

  it('offers contracted targets only through club consent with a separate transfer fee', () => {
    expect(getTransferCandidates(ready).some(player => player.id === target)).toBe(true);
    expect(quotePlayerContract(ready, target, getSeasonWage(target), 1).canOffer).toBe(false);
    const quote = quoteTransferOffer(ready, target, getSeasonWage(target), 1, requiredTransferFee(ready, target));
    expect(quote).toMatchObject({ canOffer: true, sellerClubId: seller, contractId: contractForSeason(ready.employment, target, 2)!.id });
    expect(quoteTransferOffer(ready, target, getSeasonWage(target), 1, 999).canOffer).toBe(false);
    expect(quoteTransferOffer(ready, target, getSeasonWage(target), 1, MAX_TRANSFER_FEE + 100_000).canOffer).toBe(false);
    expect(quoteTransferOffer(ready, 'rhf-1', getSeasonWage('rhf-1'), 1, 1_000_000).canOffer).toBe(false);
  });

  it("holds cash without paying, and releases or replaces only the buyer's hold", () => {
    const cash = getSpendableCash(ready, buyer), fee = requiredTransferFee(ready, target);
    let state = paid(ready, target);
    expect(getReservedTransferFees(state, buyer)).toBe(fee);
    expect(getSpendableCash(state, buyer)).toBe(cash - fee);
    expect(state.finance).toBe(ready.finance);
    expect(state.employment).toBe(ready.employment);
    const old = offerFor(state, buyer, target);
    state = paid(state, target, getSeasonWage(target), 1, fee + 100_000);
    expect(getReservedTransferFees(state, buyer)).toBe(fee + 100_000);
    expect(getMarketOffers(state).find(offer => offer.id === old.id)?.status).toBe('replaced');
    const withdrawn = withdrawMarketOffer(state, offerFor(state, buyer, target).id);
    expect(getReservedTransferFees(withdrawn, buyer)).toBe(0);
    expect(getSpendableCash(withdrawn, buyer)).toBe(cash);
    expect(withdrawn.finance).toBe(ready.finance);
  });

  it('cannot reserve the same remaining cash for two simultaneous transfer fees', () => {
    const other = effectiveContractsForSeason(ready.employment, 2).find(contract => contract.clubId === seller && contract.playerId !== target)!.playerId;
    const state = paid(ready, target, getSeasonWage(target), 1, MAX_TRANSFER_FEE);
    const snapshot = structuredClone(state);
    expect(quoteTransferOffer(state, other, getSeasonWage(other), 1, MAX_TRANSFER_FEE)).toMatchObject({ canOffer: false });
    expect(() => paid(state, other, getSeasonWage(other), 1, MAX_TRANSFER_FEE)).toThrow(/remaining budget|commitments/i);
    expect(state).toEqual(snapshot);
    expect(getReservedTransferFees(state, buyer)).toBe(MAX_TRANSFER_FEE);
    expect(state.finance).toBe(ready.finance);
  });

  it('requires both dated decisions, then books an exact fee pair and releases only future ownership', () => {
    const fee = requiredTransferFee(ready, target), original = contractForSeason(ready.employment, target, 2)!;
    const pending = paid(ready, target, requiredNegotiationWage(target, 3), 3);
    expect(() => commitPlayerOffer(pending, buyer, target, requiredNegotiationWage(target, 3), 3, offerFor(pending, buyer, target).id)).toThrow();
    const clubAgreed = advanceMarket(pending);
    expect(offerFor(clubAgreed, buyer, target)).toMatchObject({ status: 'pending', transfer: { clubStatus: 'accepted', fee } });
    expect(clubAgreed.employment.transfers).toHaveLength(0);
    expect(clubAgreed.finance).toBe(ready.finance);
    const state = advanceMarket(clubAgreed), transfer = state.employment.transfers.at(-1)!;
    expect(offerFor(state, buyer, target).status).toBe('accepted');
    expect(transfer).toMatchObject({ offerId: offerFor(state, buyer, target).id, playerId: target, fromClubId: seller, toClubId: buyer, startsSeason: 2, fee, completedOn: state.date, releasedContractIds: [original.id] });
    expect(state.employment.contracts.find(contract => contract.id === original.id)).toEqual(original);
    expect(contractForSeason(state.employment, target, 1)?.clubId).toBe(seller);
    expect(contractForSeason(state.employment, target, 2)).toMatchObject({ clubId: buyer, kind: 'transfer', endsSeason: 4 });
    expect(contractForSeason(state.employment, target, 4)?.clubId).toBe(buyer);
    expect(state.finance.ledger.filter(entry => entry.kind === 'transfer' && entry.sourceId === transfer.id).map(entry => [entry.clubId, entry.amount])).toEqual([[buyer, -fee], [seller, fee]]);
    expect(getFinanceBalance(state.finance, buyer).cash).toBe(getFinanceBalance(ready.finance, buyer).cash - fee);
    expect(getFinanceBalance(state.finance, seller).cash).toBe(getFinanceBalance(ready.finance, seller).cash + fee);
    expect(getReservedTransferFees(state, buyer)).toBe(0);
    expect(() => recordTransferFee(state, transfer)).toThrow();
    for (const key of ['activeMatch', 'fixtures', 'rosters', 'clubs', 'training', 'payroll'] as const) expect(state[key]).toBe(ready[key]);
    expect(getTransferCandidates(state).some(player => player.id === target)).toBe(false);
    expect(quoteTransferOffer(state, target, getSeasonWage(target), 1, fee, rival).canOffer).toBe(false);
  });

  it('does not resurrect an old long contract after a shorter purchased agreement expires', () => {
    const extended = advanceMarket(submitMarketOffer(opened, target, requiredNegotiationWage(target, 3), 3, seller));
    const old = contractForSeason(extended.employment, target, 4)!;
    expect(old).toMatchObject({ clubId: seller, startsSeason: 2, endsSeason: 4 });
    const state = advanceMarket(advanceMarket(paid(extended, target)));
    expect(state.employment.contracts.find(contract => contract.id === old.id)).toEqual(old);
    expect(contractForSeason(state.employment, target, 1)?.clubId).toBe(seller);
    expect(contractForSeason(state.employment, target, 2)?.clubId).toBe(buyer);
    expect(contractForSeason(state.employment, target, 3)).toBeNull();
    expect(contractForSeason(state.employment, target, 4)).toBeNull();
    expect(state.employment.transfers.at(-1)!.releasedContractIds).toEqual([old.id]);
  });

  it('charges no fee for a club counter or player counter, and protects the hold until withdrawal', () => {
    const fee = requiredTransferFee(ready, target);
    const clubCounter = advanceMarket(paid(ready, target, getSeasonWage(target), 1, fee - 100_000));
    expect(offerFor(clubCounter, buyer, target)).toMatchObject({ status: 'countered', transfer: { clubStatus: 'countered', counterFee: fee } });
    expect(clubCounter.finance).toBe(ready.finance);
    expect(clubCounter.employment.transfers).toHaveLength(0);
    const playerCounter = advanceMarket(advanceMarket(paid(ready, target, getSeasonWage(target), 3)));
    expect(offerFor(playerCounter, buyer, target)).toMatchObject({ status: 'countered', transfer: { clubStatus: 'accepted' } });
    expect(playerCounter.finance).toBe(ready.finance);
    expect(getReservedTransferFees(playerCounter, buyer)).toBe(fee);
    expect(getReservedTransferFees(withdrawMarketOffer(playerCounter, offerFor(playerCounter, buyer, target).id), buyer)).toBe(0);
  });

  it("settles only the winning buyer's fee when approved offers compete", () => {
    let pending = paid(ready, target, getSeasonWage(target) + 100_000);
    pending = paid(pending, target, getSeasonWage(target) + 200_000, 1, requiredTransferFee(ready, target), rival);
    const state = advanceMarket(advanceMarket(pending));
    expect(offerFor(state, buyer, target).status).toBe('lost');
    expect(offerFor(state, rival, target).status).toBe('accepted');
    expect(state.employment.transfers).toHaveLength(1);
    expect(state.employment.transfers[0]!.toClubId).toBe(rival);
    expect(state.finance.ledger.filter(entry => entry.kind === 'transfer')).toHaveLength(2);
    expect(getFinanceBalance(state.finance, buyer)).toEqual(getFinanceBalance(ready.finance, buyer));
    expect(getReservedTransferFees(state, buyer)).toBe(0);
    expect(getReservedTransferFees(state, rival)).toBe(0);
  });

  it("keeps the selling manager's decision explicit before the player can reply", () => {
    const playerId = 'rhf-1', pending = paid(ready, playerId, getSeasonWage(playerId), 1, requiredTransferFee(ready, playerId), rival);
    const review = advanceMarket(pending), offer = offerFor(review, rival, playerId);
    expect(offer).toMatchObject({ status: 'club-review', transfer: { sellerClubId: buyer, clubStatus: 'review' } });
    expect(sellerReplacementReason(review, offer)).toBeNull();
    expect(() => decideClubTransfer(review, offer.id, 'accept', seller)).toThrow();
    const rejected = applyMarketEvent(review, { type: 'club-decision', date: review.date, offerId: offer.id, response: 'reject' });
    expect(offerFor(rejected, rival, playerId).status).toBe('rejected');
    expect(rejected.finance).toBe(ready.finance);
    expect(getReservedTransferFees(rejected, rival)).toBe(0);
    const accepted = applyMarketEvent(review, { type: 'club-decision', date: review.date, offerId: offer.id, response: 'accept' });
    expect(offerFor(accepted, rival, playerId).responseOn).toBe(addMarketDays(review.date, 1));
    expect(accepted.employment.transfers).toHaveLength(0);
  });

  it("protects the selling club's replacement allowance while approval is outstanding", () => {
    const playerId = 'rhf-8', old = contractForSeason(ready.employment, playerId, 2)!;
    const review = advanceMarket(paid(ready, playerId, getSeasonWage(playerId), 1, requiredTransferFee(ready, playerId), rival));
    const offer = offerFor(review, rival, playerId);
    const accepted = applyMarketEvent(review, { type: 'club-decision', date: review.date, offerId: offer.id, response: 'accept' });
    const before = getClubContractSummary(ready, buyer), after = getClubContractSummary(accepted, buyer);
    expect(after.minimumReserve).toBe(before.minimumReserve + Math.max(0, 1_800_000 - old.seasonWage));
    expect(after.seasonWages).toBe(before.seasonWages);
    expect(after.rosterSize).toBe(before.rosterSize);
  });

  it("uses the new contract for next season's registration and payroll without rewriting the old season", () => {
    let state = advanceMarket(advanceMarket(paid(ready, target, requiredNegotiationWage(target, 2), 2)));
    for (let step = 0; step < 40 && getLiveMarketOffers(state).length; step += 1) {
      for (const incoming of getLiveMarketOffers(state).filter(offer => offer.status === 'club-review' && offer.transfer?.sellerClubId === buyer)) state = applyMarketEvent(state, { type: 'club-decision', date: state.date, offerId: incoming.id, response: 'reject' });
      state = advanceMarket(state);
    }
    expect(getLiveMarketOffers(state)).toHaveLength(0);
    const clubs = getContractedClubs(state, 2);
    expect(clubs.find(club => club.id === buyer)!.players.some(player => player.id === target)).toBe(true);
    expect(clubs.find(club => club.id === seller)!.players.some(player => player.id === target)).toBe(false);
    const next = rolloverSeason(state);
    expect(next.payroll.agreements.find(agreement => agreement.playerId === target && agreement.seasonNumber === 2)).toMatchObject({ clubId: buyer, seasonWage: requiredNegotiationWage(target, 2) });
    expect(next.history[0]!.rosters.find(roster => roster.clubId === seller)!.players.some(player => player.id === target)).toBe(true);
    expect(next.employment.transfers).toEqual(state.employment.transfers);
  });
});

