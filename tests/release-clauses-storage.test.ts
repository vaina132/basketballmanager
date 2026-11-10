import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { getSeasonWage } from '../src/data/development-wages';
import { setAutoSubstitutions, simulateToEnd, stepMatch } from '../src/engine/match';
import { parseSeason, serializeSeason, validateSeasonState } from '../src/storage/season-storage';
import { offerPlayerContract, setEmploymentDelegation } from '../src/world/employment';
import { contractForRound } from '../src/world/employment-policy';
import { advanceMarket, decideClubTransfer, enableMarket, submitTransferOffer } from '../src/world/market';
import { requiredNegotiationWage } from '../src/world/negotiations-policy';
import { decideInSeasonTransfer, submitInSeasonOffer, submitInSeasonTransferOffer, withdrawInSeasonOffer } from '../src/world/recruitment';
import { getInSeasonCandidates } from '../src/world/recruitment-policy';
import { getApplicableReleaseClause } from '../src/world/release-clauses';
import { advanceSeason, createSeason, managedSide, rolloverSeason } from '../src/world/season';

const managed = 'rhine-falcons', buyer = 'aegean-waves', playerId = 'rhf-1';
const sourceFee = 1_000_000, newFee = 2_000_000;
const play = (state: SeasonState) => advanceSeason({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) });
const complete = (state: SeasonState): SeasonState => { while (state.status === 'active') state = play(state); return state; };
const sourceTerms = (state: SeasonState) => state.employment.contracts.find(contract => contract.playerId === playerId && contract.releaseFee === sourceFee)!;
const triggered = (state: SeasonState) => state.recruitment.offers.find(offer => offer.playerId === playerId && offer.transfer?.mode === 'release-clause')!;
let counter: SeasonState, changedCounter: SeasonState, renewal: SeasonState, opening: SeasonState;
let pending: SeasonState, arrived: SeasonState, salaryCounter: SeasonState, withdrawn: SeasonState;
let offseasonPending: SeasonState, offseasonArrived: SeasonState, futureOnlySale: SeasonState;
let freeArrival: SeasonState, distinctFutureSale: SeasonState;

beforeAll(() => {
  const initial = createSeason(81, managed, 'off', true, true, true, true, null, true, true, true);
  counter = offerPlayerContract(initial, playerId, getSeasonWage(playerId), 3, { releaseFee: sourceFee });
  changedCounter = offerPlayerContract(counter, playerId, getSeasonWage(playerId), 3, { releaseFee: sourceFee + 100_000 });
  renewal = offerPlayerContract(changedCounter, playerId, requiredNegotiationWage(playerId, 3, sourceFee), 3, { releaseFee: sourceFee });
  const completedFirst = complete(setEmploymentDelegation(renewal, true));
  opening = setEmploymentDelegation(rolloverSeason(completedFirst), false);
  pending = submitInSeasonTransferOffer(opening, playerId, requiredNegotiationWage(playerId, 3, newFee), 3, sourceFee, buyer, 'upfront', { transferMode: 'release-clause', releaseFee: newFee });
  arrived = play(pending);
  withdrawn = withdrawInSeasonOffer(pending, triggered(pending).id, buyer);
  salaryCounter = play(submitInSeasonTransferOffer(opening, playerId, getSeasonWage(playerId), 3, sourceFee, buyer, 'upfront', { transferMode: 'release-clause', releaseFee: newFee }));

  const offseason = complete(enableMarket(setEmploymentDelegation(opening, true)));
  offseasonPending = submitTransferOffer(offseason, playerId, requiredNegotiationWage(playerId, 2, newFee), 2, sourceFee, buyer, 'upfront', { transferMode: 'release-clause', releaseFee: newFee });
  offseasonArrived = advanceMarket(offseasonPending);

  let futureOnly = submitTransferOffer(setEmploymentDelegation(enableMarket(completedFirst), false), playerId, requiredNegotiationWage(playerId, 2), 2, 5_000_000, buyer);
  futureOnly = advanceMarket(futureOnly);
  const offerId = futureOnly.market.windows.at(-1)!.offers.find(offer => offer.playerId === playerId && offer.clubId === buyer)!.id;
  futureOnlySale = advanceMarket(decideClubTransfer(futureOnly, offerId, 'accept'));

  let limitedSquad = complete(renewal);
  for (const player of initial.clubs.find(club => club.id === managed)!.players.slice(1, 8)) limitedSquad = offerPlayerContract(limitedSquad, player.id, getSeasonWage(player.id), 1);
  const freeOpening = rolloverSeason(limitedSquad), freePlayer = getInSeasonCandidates(freeOpening)[0]!;
  freeArrival = play(submitInSeasonOffer(freeOpening, freePlayer.id, getSeasonWage(freePlayer.id), managed, { releaseFee: sourceFee }));
  const withFuture = offerPlayerContract(freeArrival, freePlayer.id, requiredNegotiationWage(freePlayer.id, 3), 3);
  const negotiated = submitInSeasonTransferOffer(withFuture, freePlayer.id, getSeasonWage(freePlayer.id), 1, 5_000_000, buyer);
  const id = negotiated.recruitment.offers.at(-1)!.id;
  // A normal transfer can acquire both agreements; a clause cannot cancel the separate renewal.
  distinctFutureSale = play(decideInSeasonTransfer(negotiated, id, 'accept'));
}, 60_000);

describe('release-clause persistence and historical replay', () => {
  it('round-trips negotiated clauses, counters, triggers, withdrawals and both registration calendars', () => {
    for (const state of [counter, changedCounter, renewal, opening, pending, arrived, salaryCounter, withdrawn, offseasonPending, offseasonArrived, futureOnlySale, freeArrival, distinctFutureSale]) {
      const restored = parseSeason(serializeSeason(state));
      expect(restored).toEqual(state);
      expect(stepMatch(restored.activeMatch)).toEqual(stepMatch(state.activeMatch));
    }
  });

  it('retains each offered fee and its counterterms without collapsing a changed clause into a duplicate', () => {
    expect(changedCounter.negotiations.records).toHaveLength(2);
    expect(counter.negotiations.records[0]).toMatchObject({ releaseFee: sourceFee, counterOffer: { releaseFee: sourceFee }, alternativeOffer: { releaseFee: sourceFee } });
    expect(changedCounter.negotiations.records[1]!.releaseFee).toBe(sourceFee + 100_000);
    expect(sourceTerms(renewal).startsSeason).toBe(2);
  });

  it('keeps player agreement necessary while clause activation bypasses only the selling club decision', () => {
    expect(triggered(pending)).toMatchObject({ status: 'pending', transfer: { mode: 'release-clause', clubStatus: 'accepted', fee: sourceFee, paymentPlan: 'upfront' } });
    expect(pending.activeMatch).toEqual(opening.activeMatch);
    expect(pending.recruitment.events.some(event => event.type === 'club-decision')).toBe(false);
    expect(arrived.employment.transfers.at(-1)).toMatchObject({ mode: 'release-clause', fee: sourceFee, startsSeason: 2, startsRound: 2 });
    expect(contractForRound(arrived.employment, playerId, 2, 1)?.clubId).toBe(managed);
    expect(contractForRound(arrived.employment, playerId, 2, 2)).toMatchObject({ clubId: buyer, releaseFee: newFee });
    expect(triggered(salaryCounter).status).toBe('countered');
    expect(salaryCounter.employment.transfers).toHaveLength(0);
    expect(offseasonArrived.employment.transfers.at(-1)).toMatchObject({ mode: 'release-clause', startsSeason: 3, startsRound: 1 });
  });

  it('protects future-only clauses and separately negotiated future employment during save replay', () => {
    expect(getApplicableReleaseClause(renewal, playerId).canTrigger).toBe(false);
    const futureOnly = structuredClone(futureOnlySale);
    futureOnly.employment.transfers.at(-1)!.mode = 'release-clause';
    expect(() => validateSeasonState(futureOnly)).toThrow(/active agreement/);
    const distinct = structuredClone(distinctFutureSale);
    distinct.employment.transfers.at(-1)!.mode = 'release-clause';
    expect(distinct.employment.transfers.at(-1)!.releasedContractIds).toHaveLength(2);
    expect(() => validateSeasonState(distinct)).toThrow(/active agreement|distinct future/);
  });

  it.each<[string, (state: SeasonState) => void]>([
    ['unnegotiated initial clause', state => { state.employment.contracts[0]!.releaseFee = sourceFee; }],
    ['historical seller clause', state => { sourceTerms(state).releaseFee = sourceFee + 100_000; }],
    ['removed seller clause', state => { delete sourceTerms(state).releaseFee; }],
    ['buyer clause', state => { state.employment.contracts.at(-1)!.releaseFee = newFee + 100_000; }],
    ['missing trigger mode', state => { delete state.employment.transfers.at(-1)!.mode; }],
    ['unknown trigger mode', state => { Object.assign(state.employment.transfers.at(-1)!, { mode: 'automatic' }); }],
    ['partial clause payment', state => { state.employment.transfers.at(-1)!.paymentPlan = 'two-payments'; }],
    ['different trigger amount', state => { state.employment.transfers.at(-1)!.fee += 100_000; }],
    ['missing explicit trigger', state => { const event = state.recruitment.events.find(event => event.type === 'offer' && event.playerId === playerId)!; if (event.type === 'offer') delete event.transferMode; }],
    ['unsupported journal mode', state => { Object.assign(state.recruitment.events.find(event => event.type === 'offer' && event.playerId === playerId)!, { transferMode: 'negotiated' }); }],
    ['missing upfront journal plan', state => { const event = state.recruitment.events.find(event => event.type === 'offer' && event.playerId === playerId)!; if (event.type === 'offer') delete event.transferPaymentPlan; }],
    ['altered buyer proposal clause', state => { triggered(state).releaseFee = newFee + 100_000; }],
    ['false consent mode', state => { delete triggered(state).transfer!.mode; }],
    ['missing response clause', state => { delete state.negotiations.records.find(entry => entry.id === triggered(state).negotiationId)!.releaseFee; }],
    ['rewritten old response clause', state => { state.negotiations.records[0]!.releaseFee = sourceFee + 100_000; }],
    ['null clause', state => { Object.assign(sourceTerms(state), { releaseFee: null }); }],
    ['fractional clause', state => { sourceTerms(state).releaseFee = sourceFee + 1; }],
    ['oversized clause', state => { sourceTerms(state).releaseFee = 50_100_000; }],
  ])('rejects forged %s', (_label, mutate) => {
    const state = structuredClone(arrived); mutate(state);
    expect(() => validateSeasonState(state)).toThrow();
  });

  it('rejects rewriting the clause promised in counteroffer alternatives', () => {
    const state = structuredClone(counter);
    state.negotiations.records[0]!.alternativeOffer!.releaseFee = newFee;
    expect(() => validateSeasonState(state)).toThrow(/canonical player response/);
  });

  it('rejects an implicit offseason trigger even when the materialized transfer still looks accepted', () => {
    const state = structuredClone(offseasonArrived);
    const event = state.market.windows.at(-1)!.events.find(event => event.type === 'offer' && event.playerId === playerId)!;
    if (event.type === 'offer') delete event.transferMode;
    expect(() => validateSeasonState(state)).toThrow();
  });
});
