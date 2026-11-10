import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { getSeasonWage } from '../src/data/development-wages';
import { setAutoSubstitutions, simulateToEnd, stepMatch } from '../src/engine/match';
import { parseSeason, serializeSeason, validateSeasonState } from '../src/storage/season-storage';
import { contractForSeason, getClubContractSummary } from '../src/world/employment-policy';
import { getFinanceBalance } from '../src/world/finance';
import { advanceMarket, decideClubTransfer, submitMarketOffer, submitTransferOffer } from '../src/world/market';
import { getLiveMarketOffers, getMarketOffers, getMarketStartReason, getMarketWindow, getReservedTransferFees } from '../src/world/market-policy';
import { requiredTransferFee } from '../src/world/transfers-policy';
import { advanceSeason, createSeason, managedSide, rolloverSeason } from '../src/world/season';

const managed = 'rhine-falcons', seller = 'aegean-waves', rival = 'alpine-stags';
const envelope = (state: unknown, formatVersion = 17) => JSON.stringify({ format: 'basketball-manager-season', formatVersion, engineVersion: 'possession-3', state });
const window = (state: SeasonState) => getMarketWindow(state)!;
const ownOffer = (state: SeasonState) => getMarketOffers(state).find(offer => offer.transfer)!;
const complete = (initial: SeasonState): SeasonState => {
  let state = initial;
  while (state.status === 'active') state = advanceSeason({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) });
  return state;
};
function legacy14(state: SeasonState): string {
  const old = structuredClone(state) as unknown as Record<string, unknown>;
  old.schemaVersion = 14;
  delete (old.employment as Record<string, unknown>).transfers; delete (old.employment as Record<string, unknown>).buyouts;
  for (const item of (old.market as { windows: Array<{ offers: Array<Record<string, unknown>> }> }).windows) for (const offer of item.offers) delete offer.transfer;
  return envelope(old, 14);
}

let opened: SeasonState, pending: SeasonState, approved: SeasonState, accepted: SeasonState, competing: SeasonState, decided: SeasonState;
let incoming: SeasonState, reviewed: SeasonState, rejected: SeasonState, countered: SeasonState, ready: SeasonState, nextYear: SeasonState;
let target: string, fee: number;
beforeAll(() => {
  opened = advanceMarket(complete(createSeason(113, managed, 'standard', true, true, true, true, null, true, true, true, true)));
  target = getClubContractSummary(opened, seller).contracts[0]!.playerId;
  fee = requiredTransferFee(opened, target);
  pending = submitTransferOffer(opened, target, getSeasonWage(target) + 200_000, 3, fee);
  approved = advanceMarket(pending);
  accepted = advanceMarket(approved);
  competing = submitTransferOffer(pending, target, getSeasonWage(target) + 300_000, 3, fee, rival);
  decided = advanceMarket(advanceMarket(competing));

  let own = opened;
  for (const player of opened.clubs.find(club => club.id === managed)!.players.slice(0, 9)) own = submitMarketOffer(own, player.id, getSeasonWage(player.id), 1);
  own = advanceMarket(own);
  incoming = submitTransferOffer(own, 'rhf-1', getSeasonWage('rhf-1'), 1, requiredTransferFee(own, 'rhf-1'), seller);
  reviewed = advanceMarket(incoming);
  const incomingOffer = getMarketOffers(reviewed, seller).find(offer => offer.transfer?.sellerClubId === managed)!;
  rejected = decideClubTransfer(reviewed, incomingOffer.id, 'reject');
  countered = advanceMarket(submitTransferOffer(opened, target, getSeasonWage(target), 1, Math.max(100_000, fee - 100_000)));

  ready = accepted;
  for (const player of opened.clubs.find(club => club.id === managed)!.players.slice(0, 7)) ready = submitMarketOffer(ready, player.id, getSeasonWage(player.id), 1);
  ready = advanceMarket(ready);
  for (let step = 0; getMarketStartReason(ready) && step < 30; step += 1) {
    for (const offer of getLiveMarketOffers(ready).filter(offer => offer.status === 'club-review' && offer.transfer?.sellerClubId === managed)) ready = decideClubTransfer(ready, offer.id, 'reject');
    if (getMarketStartReason(ready)) ready = advanceMarket(ready);
  }
  nextYear = rolloverSeason(ready);
}, 60_000);

describe('paid transfer persistence and accounting', () => {
  it('round-trips club review, approval, fee counters, player selection and completed transfers', () => {
    for (const state of [opened, pending, approved, accepted, competing, decided, incoming, reviewed, rejected, countered, ready, nextYear]) {
      const text = serializeSeason(state);
      expect(JSON.parse(text).formatVersion).toBe(17);
      const restored = parseSeason(text);
      expect(restored).toEqual(state);
      expect(stepMatch(restored.activeMatch)).toEqual(stepMatch(state.activeMatch));
    }
    expect(advanceMarket(parseSeason(serializeSeason(pending)))).toEqual(approved);
    expect(advanceMarket(parseSeason(serializeSeason(approved)))).toEqual(accepted);
  });

  it('keeps fees reserved until player acceptance and records exactly one balanced payment pair', () => {
    expect(pending.finance).toEqual(opened.finance);
    expect(approved.finance).toEqual(opened.finance);
    expect(getReservedTransferFees(pending, managed)).toBe(fee);
    expect(getReservedTransferFees(approved, managed)).toBe(fee);
    expect(getReservedTransferFees(accepted, managed)).toBe(0);
    const transfer = accepted.employment.transfers[0]!;
    const rows = accepted.finance.ledger.filter(entry => entry.kind === 'transfer');
    expect(rows).toHaveLength(2);
    expect(rows.map(row => [row.clubId, row.amount, row.sourceId])).toEqual([[managed, -fee, transfer.id], [seller, fee, transfer.id]]);
    expect(getFinanceBalance(accepted.finance, managed).cash).toBe(getFinanceBalance(opened.finance, managed).cash - fee);
    expect(getFinanceBalance(accepted.finance, seller).cash).toBe(getFinanceBalance(opened.finance, seller).cash + fee);
    expect(accepted.payroll).toEqual(opened.payroll);
    expect(accepted.activeMatch).toEqual(opened.activeMatch);
    expect(accepted.fixtures).toEqual(opened.fixtures);
  });

  it('releases the losing buyer’s fee without charging it or changing the historic salary response', () => {
    expect(ownOffer(decided).status).toBe('lost');
    expect(getReservedTransferFees(decided, managed)).toBe(0);
    expect(getFinanceBalance(decided.finance, managed)).toEqual(getFinanceBalance(opened.finance, managed));
    expect(decided.employment.transfers).toHaveLength(1);
    expect(decided.employment.transfers[0]!.toClubId).toBe(rival);
    expect(decided.finance.ledger.filter(entry => entry.kind === 'transfer')).toHaveLength(2);
  });

  it('retains immutable seller agreements and applies the new employer only on opening day', () => {
    const original = contractForSeason(opened.employment, target, 2)!;
    expect(accepted.employment.contracts.find(contract => contract.id === original.id)).toEqual(original);
    expect(contractForSeason(accepted.employment, target, 1)?.clubId).toBe(seller);
    expect(contractForSeason(accepted.employment, target, 2)?.clubId).toBe(managed);
    expect(accepted.clubs.find(club => club.id === seller)!.players.some(player => player.id === target)).toBe(true);
    expect(nextYear.clubs.find(club => club.id === managed)!.players.some(player => player.id === target)).toBe(true);
    expect(nextYear.clubs.find(club => club.id === seller)!.players.some(player => player.id === target)).toBe(false);
    expect(nextYear.payroll.agreements.find(agreement => agreement.playerId === target && agreement.seasonNumber === 2)).toMatchObject({ clubId: managed, seasonWage: getSeasonWage(target) + 200_000 });
    expect(nextYear.history[0]!.fixtures).toEqual(ready.fixtures);
  });

  it('preserves format14 state and decisions before allowing new paid proposals', () => {
    const restored = parseSeason(legacy14(opened));
    expect(restored).toEqual(opened);
    expect(submitTransferOffer(restored, target, getSeasonWage(target) + 200_000, 3, fee)).toEqual(pending);
    expect(parseSeason(serializeSeason(restored))).toEqual(restored);
  });
});

describe('transfer save corruption rejection', () => {
  const mutations: Array<[string, (state: SeasonState) => void]> = [
    ['missing transfer journal', state => { delete (state.employment as Partial<SeasonState['employment']>).transfers; }],
    ['missing completed transfer', state => { state.employment.transfers = []; }],
    ['invented transfer identity', state => { state.employment.transfers[0]!.id = 'invented'; }],
    ['wrong buyer', state => { state.employment.transfers[0]!.toClubId = rival; }],
    ['wrong seller', state => { state.employment.transfers[0]!.fromClubId = rival; }],
    ['wrong transferred player', state => { state.employment.transfers[0]!.playerId = 'rhf-1'; }],
    ['changed paid fee', state => { state.employment.transfers[0]!.fee += 100_000; }],
    ['changed effective season', state => { state.employment.transfers[0]!.startsSeason += 1; }],
    ['changed completion date', state => { state.employment.transfers[0]!.completedOn = window(state).openedOn; }],
    ['missing release', state => { state.employment.transfers[0]!.releasedContractIds = []; }],
    ['wrong released contract', state => { state.employment.transfers[0]!.releasedContractIds = ['employment-contract-1']; }],
    ['wrong new contract link', state => { state.employment.transfers[0]!.contractId = 'employment-contract-1'; }],
    ['wrong accepted offer link', state => { state.employment.transfers[0]!.offerId = 'invented'; }],
    ['duplicate transfer', state => { state.employment.transfers.push({ ...state.employment.transfers[0]!, id: 'employment-transfer-2' }); }],
    ['missing debit', state => { state.finance.ledger = state.finance.ledger.filter(entry => entry.kind !== 'transfer' || entry.amount > 0).map((entry, index) => ({ ...entry, id: `finance-${index + 1}` })); }],
    ['missing credit', state => { state.finance.ledger = state.finance.ledger.filter(entry => entry.kind !== 'transfer' || entry.amount < 0).map((entry, index) => ({ ...entry, id: `finance-${index + 1}` })); }],
    ['balanced but wrong fee', state => { for (const entry of state.finance.ledger.filter(entry => entry.kind === 'transfer')) entry.amount += Math.sign(entry.amount) * 100_000; }],
    ['wrong payment source', state => { state.finance.ledger.find(entry => entry.kind === 'transfer')!.sourceId = 'invented'; }],
    ['invented club response reason', state => { ownOffer(state).transfer!.clubReason = 'Invented permission'; }],
    ['changed seller approval', state => { ownOffer(state).transfer!.clubStatus = 'rejected'; }],
    ['changed asking fee', state => { ownOffer(state).transfer!.requiredFee += 100_000; }],
    ['changed fee reservation', state => { ownOffer(state).transfer!.fee += 100_000; }],
    ['missing transfer proposal details', state => { ownOffer(state).transfer = null; }],
    ['omitted club approval event', state => { window(state).events = window(state).events.filter(event => event.type !== 'club-decision'); }],
    ['changed club response', state => { const event = window(state).events.find(event => event.type === 'club-decision')!; if (event.type === 'club-decision') event.response = 'reject'; }],
  ];
  it.each(mutations)('rejects %s without changing the source career', (_name, mutate) => {
    const state = structuredClone(accepted); mutate(state);
    expect(() => validateSeasonState(state)).toThrow();
    expect(() => parseSeason(envelope(state))).toThrow();
    expect(parseSeason(serializeSeason(accepted))).toEqual(accepted);
  });
});
