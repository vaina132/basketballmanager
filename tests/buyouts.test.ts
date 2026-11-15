import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { getSeasonWage } from '../src/data/development-wages';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { commitContractBuyout, quoteContractBuyout } from '../src/world/buyouts';
import { setEmploymentDelegation } from '../src/world/employment';
import { contractForSeason, effectiveContractsForSeason, getAvailablePlayers, getClubContractSummary, quotePlayerContract } from '../src/world/employment-policy';
import { getFinanceBalance, recordContractBuyout } from '../src/world/finance';
import { advanceMarket, applyMarketEvent, buyoutPlayerContract, decideClubTransfer, submitMarketOffer, submitTransferOffer, withdrawMarketOffer } from '../src/world/market';
import { getLiveMarketOffers, getMarketStartReason, getMarketWindow } from '../src/world/market-policy';
import { requiredNegotiationWage } from '../src/world/negotiations-policy';
import { getSpendableCash } from '../src/world/payroll-policy';
import { advanceSeason, createSeason, managedSide, rolloverSeason } from '../src/world/season';
import { getTransferObligationReserve } from '../src/world/transfer-payments';
import { requiredTransferFee } from '../src/world/transfers-policy';

const managed = 'rhine-falcons', seller = 'aegean-waves', rival = 'alpine-stags', ownPlayer = 'rhf-1';
const create = () => createSeason(53, managed, 'off', true, true, true, true, null, true, true, true, true);
const play = (state: SeasonState) => advanceSeason({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch!, managedSide(state), true)) });
function finish(state: SeasonState): SeasonState { while (state.status === 'active') state = play(state); return state; }
function settle(initial: SeasonState): SeasonState {
  let state = initial;
  for (let count = 0; getMarketStartReason(state); count += 1) {
    if (count > 30) throw new Error('Recruitment should settle with ordinary proposals.');
    for (const offer of getLiveMarketOffers(state).filter(offer => offer.status === 'club-review' && offer.transfer?.sellerClubId === managed)) state = decideClubTransfer(state, offer.id, 'reject');
    if (getMarketStartReason(state)) state = advanceMarket(state);
  }
  return state;
}

describe('offseason contract buyouts', () => {
  let active: SeasonState, opened: SeasonState, ready: SeasonState, bought: SeasonState, transferTarget: string;
  beforeAll(() => {
    active = create();
    opened = advanceMarket(finish(active));
    let state = opened;
    for (const player of state.clubs.find(club => club.id === managed)!.players.slice(0, 8)) state = submitMarketOffer(state, player.id, player.id === ownPlayer ? requiredNegotiationWage(player.id, 3) : getSeasonWage(player.id), player.id === ownPlayer ? 3 : 1);
    ready = advanceMarket(state);
    transferTarget = effectiveContractsForSeason(ready.employment, 2).find(contract => contract.clubId === seller)!.playerId;
    bought = advanceMarket(advanceMarket(submitTransferOffer(ready, transferTarget, 5_000_000, 3, 50_000_000, managed, 'three-payments')));
  }, 90_000);

  it('pays all future guaranteed salary once and frees future terms without changing sporting history', () => {
    const contract = contractForSeason(ready.employment, ownPlayer, 2)!;
    const quote = quoteContractBuyout(ready, ownPlayer);
    expect(quote).toMatchObject({ canBuyout: true, amount: contract.seasonWage * 3, seasonWageFreed: contract.seasonWage, startsSeason: 2, endsSeason: 4, rosterSizeAfter: 7, releasedContractIds: [contract.id] });
    const next = buyoutPlayerContract(ready, ownPlayer), buyout = next.employment.buyouts.at(-1)!;
    expect(buyout).toEqual({ id: 'employment-buyout-1', playerId: ownPlayer, clubId: managed, seasonNumber: 1, completedOn: ready.date, startsSeason: 2, amount: quote.amount, releasedContractIds: [contract.id], contractCountBefore: ready.employment.contracts.length, negotiationCountBefore: ready.negotiations.records.length });
    expect(next.employment.contracts).toBe(ready.employment.contracts);
    expect(next.negotiations).toBe(ready.negotiations);
    expect(getMarketWindow(next)!.events.at(-1)).toEqual({ type: 'buyout', id: buyout.id, date: ready.date, clubId: managed, playerId: ownPlayer });
    expect(next.finance.ledger.slice(ready.finance.ledger.length)).toMatchObject([{ clubId: managed, kind: 'buyout', sourceId: buyout.id, amount: -quote.amount, ticket: null, coach: null, payroll: null }]);
    expect(getSpendableCash(next, managed)).toBe(quote.remainingBudgetAfter);
    expect(getFinanceBalance(next.finance, managed)).toEqual({ cash: getFinanceBalance(ready.finance, managed).cash - quote.amount, unpaid: 0 });
    expect(getFinanceBalance(next.finance, seller)).toEqual(getFinanceBalance(ready.finance, seller));
    expect(contractForSeason(next.employment, ownPlayer, 1)).toEqual(contractForSeason(ready.employment, ownPlayer, 1));
    for (const year of [2, 3, 4, 5]) expect(contractForSeason(next.employment, ownPlayer, year)).toBeNull();
    expect(getClubContractSummary(next, managed).seasonWages).toBe(getClubContractSummary(ready, managed).seasonWages - contract.seasonWage);
    for (const key of ['activeMatch', 'fixtures', 'clubs', 'rosters', 'payroll', 'training', 'scouting', 'conditions', 'injuries', 'plans', 'date'] as const) expect(next[key]).toBe(ready[key]);
  });

  it('rejects repeated releases and changed payment data without mutating input', () => {
    const released = buyoutPlayerContract(ready, ownPlayer), buyout = released.employment.buyouts.at(-1)!;
    const snapshot = structuredClone(released);
    expect(() => buyoutPlayerContract(released, ownPlayer)).toThrow(/contract for next season/);
    expect(() => commitContractBuyout(released, ownPlayer)).toThrow(/contract for next season/);
    expect(() => recordContractBuyout(released, buyout)).toThrow(/already/);
    expect(() => recordContractBuyout(released, { ...buyout, amount: buyout.amount - 1 })).toThrow(/exact/);
    expect(released).toEqual(snapshot);
    const prior = structuredClone(ready);
    expect(() => applyMarketEvent(ready, { type: 'buyout', id: 'employment-buyout-9', date: ready.date, playerId: ownPlayer, clubId: managed })).toThrow(/sequential/);
    expect(ready).toEqual(prior);
  });

  it('requires the open offseason, next-season ownership and enabled financial systems', () => {
    expect(quoteContractBuyout(active, ownPlayer)).toMatchObject({ canBuyout: false, reason: expect.stringMatching(/offseason/) });
    expect(quoteContractBuyout(ready, transferTarget)).toMatchObject({ canBuyout: false, reason: expect.stringMatching(/one of your players/) });
    expect(quoteContractBuyout(ready, 'missing')).toMatchObject({ canBuyout: false });
    expect(quoteContractBuyout(ready, ownPlayer, 'missing')).toMatchObject({ canBuyout: false });
    expect(quoteContractBuyout({ ...ready, finance: { ...ready.finance, enabledSince: null } }, ownPlayer)).toMatchObject({ canBuyout: false });
    const window = getMarketWindow(ready)!;
    expect(quoteContractBuyout({ ...ready, date: window.closesOn }, ownPlayer)).toMatchObject({ canBuyout: false, reason: expect.stringMatching(/closed/) });
    expect(quoteContractBuyout({ ...ready, market: { ...ready.market, windows: ready.market.windows.map(item => ({ ...item, competitionFromEvent: null })) } }, ownPlayer)).toMatchObject({ canBuyout: false });
  });

  it('requires pending player offers to resolve before either club can release the same terms', () => {
    const pending = submitTransferOffer(ready, ownPlayer, getSeasonWage(ownPlayer), 1, requiredTransferFee(ready, ownPlayer), rival);
    const previous = structuredClone(pending);
    expect(quoteContractBuyout(pending, ownPlayer)).toMatchObject({ canBuyout: false, reason: expect.stringMatching(/open offers/) });
    expect(() => buyoutPlayerContract(pending, ownPlayer)).toThrow(/open offers/);
    expect(pending).toEqual(previous);
    const offer = getLiveMarketOffers(pending).find(offer => offer.playerId === ownPlayer)!;
    expect(quoteContractBuyout(withdrawMarketOffer(pending, offer.id, rival), ownPlayer).canBuyout).toBe(true);
  });

  it('protects pending fees and agreed unpaid transfer installments from compensation spending', () => {
    const reserve = getTransferObligationReserve(bought, managed);
    expect(reserve).toBe(25_000_000);
    const quote = quoteContractBuyout(bought, transferTarget);
    expect(quote).toMatchObject({ amount: 15_000_000, canBuyout: true, releasedContractIds: [contractForSeason(bought.employment, transferTarget, 2)!.id] });
    const other = effectiveContractsForSeason(bought.employment, 2).find(contract => contract.clubId === rival)!.playerId;
    const pending = submitTransferOffer(bought, other, getSeasonWage(other), 1, 12_000_000);
    expect(quoteContractBuyout(pending, transferTarget)).toMatchObject({ canBuyout: false, reason: expect.stringMatching(/remaining budget/) });
    const released = buyoutPlayerContract(bought, transferTarget);
    expect(released.employment.transfers).toBe(bought.employment.transfers);
    expect(getTransferObligationReserve(released, managed)).toBe(reserve);
    expect(getFinanceBalance(released.finance, seller)).toEqual(getFinanceBalance(bought.finance, seller));
    expect(getSpendableCash(released, managed)).toBe(getSpendableCash(bought, managed) - quote.amount);
  });

  it('refuses unpaid operating costs or overdue transfer payments even if nominal cash would cover compensation', () => {
    // Accounting snapshots isolate each mandatory-obligation guard.
    const balance = getFinanceBalance(ready.finance, managed);
    const owing = { ...ready, finance: { ...ready.finance, ledger: [...ready.finance.ledger, { id: `finance-${ready.finance.ledger.length + 1}`, clubId: managed, seasonNumber: 1, round: 10, kind: 'operations' as const, amount: -balance.cash - 1, sourceId: 'guard-fixture', ticket: null, coach: null, payroll: null }] } };
    expect(quoteContractBuyout(owing, ownPlayer)).toMatchObject({ canBuyout: false, reason: expect.stringMatching(/unpaid club costs/) });
    const overdue = { ...bought, employment: { ...bought.employment, transfers: bought.employment.transfers.map(transfer => transfer.playerId === transferTarget ? { ...transfer, installments: transfer.installments.map((installment, index) => index === 1 ? { ...installment, dueOn: bought.date } : installment) } : transfer) } };
    expect(quoteContractBuyout(overdue, transferTarget)).toMatchObject({ canBuyout: false, reason: expect.stringMatching(/overdue transfer/) });
  });

  it('keeps salary capacity for replacing a cheap player after an otherwise affordable buyout', () => {
    const cheap = 'rhf-8';
    let state = advanceMarket(submitMarketOffer(opened, cheap, getSeasonWage(cheap), 1));
    const others = state.clubs.find(club => club.id === managed)!.players.slice(0, 7);
    for (const [index, player] of others.entries()) state = submitMarketOffer(state, player.id, index === 6 ? 4_500_000 : 3_000_000, 1);
    state = advanceMarket(state);
    expect(getClubContractSummary(state, managed)).toMatchObject({ rosterSize: 8, seasonWages: 23_850_000 });
    expect(getSpendableCash(state, managed)).toBeGreaterThan(getSeasonWage(cheap));
    const previous = structuredClone(state);
    expect(quoteContractBuyout(state, cheap)).toMatchObject({ canBuyout: false, reason: expect.stringMatching(/salary budget.*eight-player/) });
    expect(() => buyoutPlayerContract(state, cheap)).toThrow(/salary budget/);
    expect(state).toEqual(previous);
  });

  it('lets other clubs recruit while the assistant respects the release decision through rollover', () => {
    let state = buyoutPlayerContract(ready, ownPlayer);
    expect(getAvailablePlayers(state).some(player => player.id === ownPlayer)).toBe(true);
    expect(quotePlayerContract(state, ownPlayer, getSeasonWage(ownPlayer), 1)).toMatchObject({ canOffer: false, reason: expect.stringMatching(/cannot rejoin/) });
    state = submitMarketOffer(state, ownPlayer, requiredNegotiationWage(ownPlayer, 2), 2, rival);
    state = setEmploymentDelegation(state, true);
    expect(getLiveMarketOffers(state).filter(offer => offer.clubId === managed).every(offer => offer.playerId !== ownPlayer)).toBe(true);
    state = settle(state);
    expect(contractForSeason(state.employment, ownPlayer, 2)?.clubId).toBe(rival);
    const released = state.employment.buyouts[0]!;
    state = rolloverSeason(state);
    expect(state.clubs.find(club => club.id === managed)!.players.some(player => player.id === ownPlayer)).toBe(false);
    expect(state.clubs.find(club => club.id === rival)!.players.some(player => player.id === ownPlayer)).toBe(true);
    expect(state.payroll.agreements.find(agreement => agreement.playerId === ownPlayer && agreement.seasonNumber === 2)).toMatchObject({ clubId: rival, seasonWage: requiredNegotiationWage(ownPlayer, 2) });
    expect(state.employment.buyouts[0]).toEqual(released);
    expect(state.history[0]!.rosters.find(roster => roster.clubId === managed)!.players.some(player => player.id === ownPlayer)).toBe(true);
  });

  it('allows an earlier owner to rehire after a different buyer releases a long-running contract', () => {
    let state = finish(rolloverSeason(settle(ready)));
    state = advanceMarket(state);
    const original = contractForSeason(state.employment, ownPlayer, 2)!;
    expect(original.endsSeason).toBe(4);
    state = submitTransferOffer(state, ownPlayer, getSeasonWage(ownPlayer), 1, requiredTransferFee(state, ownPlayer), rival);
    state = advanceMarket(state);
    const offer = getLiveMarketOffers(state).find(offer => offer.playerId === ownPlayer && offer.clubId === rival)!;
    state = decideClubTransfer(state, offer.id, 'accept');
    state = advanceMarket(state);
    expect(contractForSeason(state.employment, ownPlayer, 3)?.clubId).toBe(rival);
    state = buyoutPlayerContract(state, ownPlayer, rival);
    expect(quotePlayerContract(state, ownPlayer, getSeasonWage(ownPlayer), 1, managed).canOffer).toBe(true);
    state = advanceMarket(submitMarketOffer(state, ownPlayer, getSeasonWage(ownPlayer), 1, managed));
    expect(contractForSeason(state.employment, ownPlayer, 3)).toMatchObject({ clubId: managed, kind: 'free-agent' });
    expect(contractForSeason(state.employment, ownPlayer, 4)).toBeNull();
    expect(state.employment.contracts.find(contract => contract.id === original.id)).toEqual(original);
  }, 60_000);
});
