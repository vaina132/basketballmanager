import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { getSeasonWage } from '../src/data/development-wages';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { offerPlayerContract } from '../src/world/employment';
import { contractForRound, contractForSeason, quotePlayerContract } from '../src/world/employment-policy';
import { advanceMarket, decideClubTransfer, submitMarketOffer, submitTransferOffer } from '../src/world/market';
import { getMarketOffers } from '../src/world/market-policy';
import { evaluateNegotiation, getNegotiationDemands, requiredNegotiationWage } from '../src/world/negotiations-policy';
import { decideInSeasonTransfer, scheduleInSeasonRecruitment, submitInSeasonOffer, submitInSeasonTransferOffer } from '../src/world/recruitment';
import { getInSeasonCandidates, getInSeasonOffers, quoteInSeasonTransferOffer, requiredInSeasonTransferFee } from '../src/world/recruitment-policy';
import { getApplicableReleaseClause, MAX_RELEASE_FEE, MIN_RELEASE_FEE } from '../src/world/release-clauses';
import { advanceSeason, createSeason, dateForRound, managedSide, rolloverSeason } from '../src/world/season';
import { quoteTransferOffer, requiredTransferFee } from '../src/world/transfers-policy';

const seller = 'rhine-falcons', buyer = 'aegean-waves', target = 'rhf-1', second = 'rhf-2', clause = 500_000;
const play = (state: SeasonState) => advanceSeason({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch!, managedSide(state), true)) });
function finish(state: SeasonState): SeasonState { while (state.status === 'active') state = play(state); return state; }
function freeze<T>(value: T): T { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }

describe('negotiated release clauses', () => {
  let initial: SeasonState, renewed: SeasonState, completed: SeasonState, opening: SeasonState, nextOffseason: SeasonState;
  beforeAll(() => {
    initial = freeze(createSeason(53, seller, 'off', true, true, true, true, null, true, true, true, true));
    renewed = offerPlayerContract(initial, target, requiredNegotiationWage(target, 3, clause), 3, { releaseFee: clause });
    renewed = freeze(offerPlayerContract(renewed, second, requiredNegotiationWage(second, 3, clause), 3, { releaseFee: clause }));
    completed = freeze(advanceMarket(finish(renewed)));
    let state = completed;
    for (const player of state.clubs.find(club => club.id === seller)!.players.filter(player => ![target, second].includes(player.id))) state = submitMarketOffer(state, player.id, getSeasonWage(player.id), 1);
    opening = freeze(rolloverSeason(advanceMarket(state)));
    nextOffseason = freeze(advanceMarket(finish(opening)));
  }, 30_000);

  it('caps only the three-year premium and preserves the proposed clause in counter and alternative terms', () => {
    expect(requiredNegotiationWage(target, 1, clause)).toBe(getSeasonWage(target));
    expect(requiredNegotiationWage(target, 2, clause)).toBe(requiredNegotiationWage(target, 2));
    expect(requiredNegotiationWage(target, 3, clause)).toBe(requiredNegotiationWage(target, 2));
    expect(requiredNegotiationWage(target, 3, clause)).toBeLessThan(requiredNegotiationWage(target, 3));
    expect(evaluateNegotiation(target, getSeasonWage(target), 3, clause)).toMatchObject({ outcome: 'countered', counterOffer: { releaseFee: clause, seasons: 3 }, alternativeOffer: { releaseFee: clause, seasons: 1 } });
    expect(getNegotiationDemands(target).terms.every(term => !Object.hasOwn(term, 'releaseFee'))).toBe(true);
    expect(getNegotiationDemands(target, clause).terms.every(term => term.releaseFee === clause)).toBe(true);
  });

  it('creates clauses only on new accepted terms and distinguishes revised clauses at unchanged salary and duration', () => {
    expect(initial.employment.contracts.every(contract => !Object.hasOwn(contract, 'releaseFee'))).toBe(true);
    const salary = requiredNegotiationWage(target, 3, clause);
    const counter = offerPlayerContract(initial, target, salary, 3);
    expect(counter.negotiations.records.at(-1)?.outcome).toBe('countered');
    const accepted = offerPlayerContract(counter, target, salary, 3, { releaseFee: clause });
    expect(accepted.negotiations.records).toHaveLength(counter.negotiations.records.length + 1);
    expect(contractForSeason(accepted.employment, target, 2)).toMatchObject({ releaseFee: clause, seasonWage: salary });
    expect(contractForSeason(accepted.employment, target, 1)).not.toHaveProperty('releaseFee');
    expect(offerPlayerContract(accepted, target, salary, 3, { releaseFee: clause })).toBe(accepted);
    const pending = submitMarketOffer(completed, 'rhf-3', getSeasonWage('rhf-3'), 3, seller, undefined, 'upfront', { releaseFee: clause });
    const replaced = submitMarketOffer(pending, 'rhf-3', getSeasonWage('rhf-3'), 3, seller, undefined, 'upfront', { releaseFee: clause + 100_000 });
    expect(getMarketOffers(replaced, seller).filter(offer => offer.playerId === 'rhf-3').map(offer => offer.status)).toEqual(['replaced', 'pending']);
    expect(replaced.employment).toBe(completed.employment);
  });

  it('preserves ordinary terms and rejects invalid clauses or legacy unnegotiated clause signing', () => {
    const salary = getSeasonWage('rhf-3');
    expect(submitMarketOffer(completed, 'rhf-3', salary, 1)).toEqual(submitMarketOffer(completed, 'rhf-3', salary, 1, seller, undefined, 'upfront', { transferMode: 'negotiated' }));
    for (const releaseFee of [MIN_RELEASE_FEE - 1, MAX_RELEASE_FEE + 1, 100_001, NaN]) expect(quotePlayerContract(initial, 'rhf-3', salary, 1, seller, undefined, undefined, 'upfront', { releaseFee }).canOffer).toBe(false);
    const legacy = createSeason(53, seller, 'off', true, true, true, true, null, true, false, false, false);
    expect(() => offerPlayerContract(legacy, target, getSeasonWage(target), 1, { releaseFee: clause })).toThrow(/negotiations/i);
    expect(() => submitMarketOffer(completed, 'rhf-3', salary, 1, seller, undefined, 'upfront', { transferMode: 'release-clause' })).toThrow(/paid/i);
  });

  it('waits for clause commencement and protects separately promised future agreements', () => {
    expect(getApplicableReleaseClause(renewed, target).canTrigger).toBe(false);
    expect(getApplicableReleaseClause(completed, target)).toMatchObject({ fee: clause, canTrigger: false });
    expect(getApplicableReleaseClause(completed, target).reason).toMatch(/future contract/i);
    expect(getApplicableReleaseClause(opening, target)).toMatchObject({ fee: clause, canTrigger: true });
    const extra = { ...opening, employment: { ...opening.employment, contracts: [...opening.employment.contracts, { ...opening.employment.contracts.at(-1)!, id: 'policy-future-right', playerId: target, clubId: seller, startsSeason: 5, startsRound: 1, endsSeason: 5, kind: 'renewal' as const }] } };
    expect(getApplicableReleaseClause(extra, target).reason).toMatch(/separate future/i);
    expect(quoteInSeasonTransferOffer(extra, target, getSeasonWage(target), 1, requiredInSeasonTransferFee(extra, target), buyer).canOffer).toBe(true);
  });

  it('requires explicit activation at the exact upfront fee and retains normal seller review for regular bids', () => {
    const wage = getSeasonWage(target), options = { transferMode: 'release-clause' as const };
    expect(quoteInSeasonTransferOffer(opening, target, wage, 1, clause, buyer, 'upfront', undefined, options).canOffer).toBe(true);
    expect(quoteInSeasonTransferOffer(opening, target, wage, 1, clause + 100_000, buyer, 'upfront', undefined, options).reason).toMatch(/exact/i);
    expect(quoteInSeasonTransferOffer(opening, target, wage, 1, clause, buyer, 'two-payments', undefined, options).reason).toMatch(/full/i);
    const ordinary = submitInSeasonTransferOffer(opening, target, wage, 1, requiredInSeasonTransferFee(opening, target), buyer);
    expect(getInSeasonOffers(ordinary, buyer, true)[0]).toMatchObject({ status: 'club-review', transfer: { clubStatus: 'review' } });
    const triggered = submitInSeasonTransferOffer(opening, target, wage, 1, clause, buyer, 'upfront', options), offer = getInSeasonOffers(triggered, buyer, true)[0]!;
    expect(offer).toMatchObject({ status: 'pending', transfer: { mode: 'release-clause', clubStatus: 'accepted', fee: clause, paymentPlan: 'upfront' } });
    expect(triggered.recruitment.events.at(-1)).toMatchObject({ type: 'offer', transferMode: 'release-clause', transferPaymentPlan: 'upfront' });
    expect(() => decideInSeasonTransfer(triggered, offer.id, 'reject')).toThrow(/awaiting/i);
    expect(triggered.activeMatch!).toBe(opening.activeMatch!);
    expect(triggered.finance).toBe(opening.finance);
    const joined = play(triggered), transfer = joined.employment.transfers.at(-1)!;
    expect(transfer).toMatchObject({ playerId: target, startsRound: 2, mode: 'release-clause', fee: clause });
    expect(transfer.payments).toHaveLength(1);
    expect(transfer.payments[0]!.amount).toBe(clause);
    expect(contractForRound(joined.employment, target, 2, 1)?.clubId).toBe(seller);
    expect(contractForRound(joined.employment, target, 2, 2)?.clubId).toBe(buyer);
  });

  it('keeps player acceptance and receiving contract clauses independent of the triggered source clause', () => {
    const low = submitInSeasonTransferOffer(opening, target, 500_000, 1, clause, buyer, 'upfront', { transferMode: 'release-clause' });
    const rejected = play(low);
    expect(getInSeasonOffers(rejected, buyer)[0]?.status).toBe('rejected');
    expect(rejected.employment.transfers).toHaveLength(0);
    const newClause = 800_000;
    const terms = { transferMode: 'release-clause' as const, releaseFee: newClause };
    const joined = play(submitInSeasonTransferOffer(opening, target, requiredNegotiationWage(target, 3, newClause), 3, clause, buyer, 'upfront', terms));
    expect(joined.employment.transfers.at(-1)?.fee).toBe(clause);
    expect(contractForRound(joined.employment, target, 2, 2)?.releaseFee).toBe(newClause);
    expect(joined.negotiations.records.at(-1)?.releaseFee).toBe(newClause);
  });

  it('includes clause departures in the same minimum-eight and pending-reservation checks', () => {
    let pending = submitInSeasonTransferOffer(opening, target, getSeasonWage(target), 1, clause, buyer, 'upfront', { transferMode: 'release-clause' });
    pending = submitInSeasonTransferOffer(pending, second, getSeasonWage(second), 1, clause, buyer, 'upfront', { transferMode: 'release-clause' });
    const third = opening.clubs.find(club => club.id === seller)!.players.find(player => ![target, second].includes(player.id))!;
    expect(quoteInSeasonTransferOffer(pending, third.id, getSeasonWage(third.id), 1, requiredInSeasonTransferFee(pending, third.id), 'alpine-stags').reason).toMatch(/eight/i);
    expect(play(pending).clubs.find(club => club.id === seller)!.players).toHaveLength(8);
  });

  it('supports new free-agent clauses and treats a changed clause as an amended dated offer', () => {
    const free = getInSeasonCandidates(opening)[0]!;
    const first = submitInSeasonOffer(opening, free.id, getSeasonWage(free.id), seller, { releaseFee: clause });
    const revised = submitInSeasonOffer(first, free.id, getSeasonWage(free.id), seller, { releaseFee: clause + 100_000 });
    expect(getInSeasonOffers(revised, seller).map(offer => offer.status)).toEqual(['replaced', 'pending']);
    expect(contractForRound(play(revised).employment, free.id, 2, 2)?.releaseFee).toBe(clause + 100_000);
  });

  it('skips only the offseason selling-club stage for an already active clause', () => {
    expect(getApplicableReleaseClause(nextOffseason, target).canTrigger).toBe(true);
    expect(quoteTransferOffer(nextOffseason, target, getSeasonWage(target), 1, clause, buyer, 'upfront', { transferMode: 'release-clause' }).canOffer).toBe(true);
    const ordinary = submitTransferOffer(nextOffseason, target, getSeasonWage(target), 1, requiredTransferFee(nextOffseason, target), buyer);
    expect(getMarketOffers(ordinary, buyer, true).find(offer => offer.playerId === target)?.transfer?.clubStatus).toBe('pending');
    const pending = submitTransferOffer(nextOffseason, target, getSeasonWage(target), 1, clause, buyer, 'upfront', { transferMode: 'release-clause' });
    const offer = getMarketOffers(pending, buyer, true).find(offer => offer.playerId === target)!;
    expect(offer.transfer).toMatchObject({ mode: 'release-clause', clubStatus: 'accepted' });
    expect(() => decideClubTransfer(pending, offer.id, 'reject')).toThrow(/awaiting/i);
    const signed = advanceMarket(pending);
    expect(signed.employment.transfers.at(-1)).toMatchObject({ mode: 'release-clause', startsSeason: 3, startsRound: 1, fee: clause });
    expect(contractForRound(signed.employment, target, 2, 10)?.clubId).toBe(seller);
    expect(contractForSeason(signed.employment, target, 3)?.clubId).toBe(buyer);
    expect(signed.clubs).toBe(pending.clubs);
  });

  it('lets automated buyers use an existing valid clause through the same offer guards', () => {
    const club = opening.clubs.find(club => club.id === buyer)!;
    const unavailable = [...getInSeasonCandidates(opening), ...club.players.slice(0, 1), ...opening.clubs.find(team => team.id === seller)!.players.filter(player => player.id !== target)];
    const noFree: SeasonState = { ...opening, injuries: unavailable.map((player, index) => ({ id: `policy-injury-${index}`, playerId: player.id, clubId: buyer, kind: 'ankle', fixtureId: opening.fixtures[0]!.id, occurredOn: opening.date, returnOn: dateForRound(4, 2) })) };
    const scheduled = scheduleInSeasonRecruitment(noFree);
    const offers = getInSeasonOffers(scheduled, buyer, true);
    expect(offers).toHaveLength(1);
    const selected = offers[0]!;
    expect(selected.playerId).toBe(target);
    expect(selected.transfer?.mode).toBe('release-clause');
    expect(selected.transfer?.fee).toBeLessThanOrEqual(requiredInSeasonTransferFee(noFree, selected.playerId));
  });
});
