import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import type { CareerWorld } from '../src/domain/world';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { validateSeasonState } from '../src/storage/season-storage';
import { sponsorClause } from '../src/world/commercial-policy';
import { setEmploymentDelegation } from '../src/world/employment';
import { advanceSeason, createSeason, managedSide, NEW_CAREER_SYSTEMS, resignManager, rolloverSeason } from '../src/world/season';
import { advanceMarket } from '../src/world/market';
import { getMarketStartReason } from '../src/world/market-policy';
import { resignationOutlook } from '../src/world/career-policy';
import { restartBoard, transferManager } from '../src/world/career';
import { asCareer2 } from './helpers/career-rules';
import { testWorld } from './world-fixtures';

/**
 * Exact save checks for the saved ideas (22 November 2026): naming-rights offers and sponsors' clause exits are rebuilt
 * from the calendar, not checked for plausibility. Each tamper keeps the save's own shapes consistent, so only the
 * rebuild can refuse it.
 */
const play = (state: SeasonState) => advanceSeason(state.activeMatch ? { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) } : state);
const clone = (state: SeasonState): SeasonState => structuredClone(state);
const check = (state: SeasonState) => () => validateSeasonState(clone(state));

/** One test country with two divisions: six clubs (last two relegated) and five (first and the playoff winner promoted). */
function twoDivisionWorld(): CareerWorld {
  const world = testWorld(11);
  const playerContracts = Object.fromEntries(world.clubs.flatMap(item => item.players.map((player, index) => [player.id, 1 + (index % 3)])));
  return { ...world, id: 'divisions-test', rosterModel: 'club-roster-1', playerContracts, domesticLeagues: [
    { id: 'first', name: 'First division', country: 'Testland', tier: 1, clubIds: world.clubs.slice(0, 6).map(item => item.id), postseason: 'test-tier1-1' },
    { id: 'second', name: 'Second division', country: 'Testland', tier: 2, clubIds: world.clubs.slice(6).map(item => item.id), postseason: 'test-tier2-1' },
  ] };
}

// Seed 1 (as in commercial-clauses): sponsors leave relegated clubs at the season end.
let complete: SeasonState;
beforeAll(() => {
  const world = twoDivisionWorld();
  complete = setEmploymentDelegation(createSeason({ seed: 1, world, managedClubId: world.clubs[0]!.id, ...NEW_CAREER_SYSTEMS, matchFlow: false }), true);
  while (complete.status === 'active') complete = play(complete);
}, 600_000);

describe('naming rights are rebuilt from the calendar', () => {
  it('accepts the honest career', () => {
    expect(complete.commercial.naming!.offers.length).toBeGreaterThan(0);
    expect(check(complete)).not.toThrow();
  }, 300_000);

  it('refuses a naming offer whose fee was raised, even with consistent terms', () => {
    const edited = clone(complete), naming = edited.commercial.naming!;
    const index = naming.offers.findIndex(offer => offer.status !== 'accepted' && offer.request === null);
    expect(index).toBeGreaterThanOrEqual(0);
    const offer = naming.offers[index]!;
    naming.offers[index] = { ...offer, initialAnnualFee: offer.initialAnnualFee + 100_000, annualFee: offer.annualFee + 100_000 };
    expect(check(edited)).toThrow(/commercial\.naming/);
  }, 300_000);

  it('refuses a naming offer valued on more arena seats than the club had', () => {
    const edited = clone(complete), naming = edited.commercial.naming!;
    const index = naming.offers.findIndex(offer => offer.status !== 'accepted');
    const offer = naming.offers[index]!;
    naming.offers[index] = { ...offer, basis: { ...offer.basis, capacity: offer.basis.capacity + 2_000 } };
    expect(check(edited)).toThrow(/commercial\.naming/);
  }, 300_000);

  it('refuses a computer club\'s naming agreement with a sponsor it was not offered first', () => {
    const edited = clone(complete), naming = edited.commercial.naming!;
    // Swap the automatic acceptance to another of the club's offers: the agreement, offer statuses and event agree.
    const agreementIndex = naming.agreements.findIndex(agreement => agreement.automatic && naming.offers.some(offer => offer.clubId === agreement.clubId && offer.status === 'superseded'));
    expect(agreementIndex).toBeGreaterThanOrEqual(0);
    const agreement = naming.agreements[agreementIndex]!, other = naming.offers.find(offer => offer.clubId === agreement.clubId && offer.status === 'superseded')!;
    const chosen = naming.offers.find(offer => offer.id === agreement.offerId)!;
    naming.offers = naming.offers.map(offer => offer.id === other.id ? { ...offer, status: 'accepted' } : offer.id === chosen.id ? { ...offer, status: 'superseded' } : offer);
    naming.agreements[agreementIndex] = { ...agreement, offerId: other.id, sponsorId: other.sponsorId, arenaName: other.arenaName, endsSeason: other.forSeason + other.seasons - 1, annualFee: other.annualFee, clause: sponsorClause(null, other.appeal, other.annualFee) };
    naming.events = naming.events.map(event => event.type === 'accept' && event.agreementId === agreement.id ? { ...event, offerId: other.id } : event);
    expect(check(edited)).toThrow(/Invalid season save/);
  }, 300_000);
});

describe('sponsors\' clause exits are decided again at each season end', () => {
  it('refuses an exit recorded with another reason than the clause decided', () => {
    const exits = complete.commercial.agreements.filter(agreement => agreement.exit?.by === 'sponsor');
    expect(exits.length).toBeGreaterThan(0);
    const edited = clone(complete), id = exits[0]!.id;
    edited.commercial.agreements = edited.commercial.agreements.map(agreement => agreement.id === id ? { ...agreement, exit: { ...agreement.exit!, reason: 'decline' } } : agreement);
    edited.commercial.events = edited.commercial.events.map(event => event.type === 'exit' && event.agreementId === id ? { ...event, reason: 'decline' } : event);
    expect(check(edited)).toThrow(/sponsor exits the clauses decide/);
  }, 300_000);
});

describe('a resignation takes a job offered at that point', () => {
  it('accepts an offered job and refuses a club that made no offer', () => {
    // Career-2 rules (format 63): a resigning manager always has an offer, at least from the least confident board.
    let state = setEmploymentDelegation(asCareer2(createSeason({ seed: 5, managedClubId: 'rhine-falcons', injuryMode: 'off', ...NEW_CAREER_SYSTEMS, matchFlow: false })), true);
    while (state.status === 'active') state = play(state);
    const outlook = resignationOutlook(state)!;
    expect(outlook.offers.length).toBeGreaterThan(0);
    expect(check(resignManager(state, outlook.offers[0]!.clubId))).not.toThrow();
    // The same move to a club that offered nothing, made with the game's own steps but without its offer check.
    const other = state.clubs.find(club => club.id !== state.managedClubId && !outlook.offers.some(offer => offer.clubId === club.id))!;
    const from = state.managedClubId;
    const illegal = restartBoard(restartBoard(transferManager(state, other.id, 'resigned', 'offseason'), from, 'ai', 'offseason'), other.id, 'manager', 'offseason');
    expect(check(illegal)).toThrow(/job offered to the resigning manager/);
  }, 600_000);
});

describe('president requests are rebuilt from each review', () => {
  // Adriatic Comets has the most interfering president: find a career whose first request reads the squad.
  let asked: SeasonState | undefined, settled: SeasonState | undefined;
  beforeAll(() => {
    for (let seed = 1; seed <= 40 && !asked; seed += 1) {
      let state = createSeason({ seed, managedClubId: 'adriatic-comets', injuryMode: 'standard', ...NEW_CAREER_SYSTEMS, matchFlow: false });
      while (state.status === 'active' && !(state.board.requests ?? []).length) state = play(state);
      if (state.board.requests?.[0] && state.board.requests[0].kind !== 'raise-ticket-price') asked = state;
    }
    if (asked) { settled = asked; while (settled.status === 'active' && settled.board.requests![0]!.outcome === 'open') settled = play(settled); }
  }, 600_000);

  it('accepts the honest requests, open and settled', () => {
    expect(asked).toBeDefined();
    expect(check(asked!)).not.toThrow();
    expect(check(settled!)).not.toThrow();
  }, 300_000);

  it('refuses a career that hides a request the seeded draw made', () => {
    const edited = clone(asked!);
    edited.board.requests = [];
    expect(check(edited)).toThrow(/president's request at the review/);
  }, 300_000);

  it('refuses a request whose terms differ from the draw', () => {
    const edited = clone(asked!), request = edited.board.requests![0]!;
    if (request.kind === 'play-player') {
      const other = edited.rosters.filter(roster => roster.clubId === request.clubId).at(-1)!.players.find(player => player.id !== request.playerId)!;
      edited.board.requests![0] = { ...request, playerId: other.id };
    } else edited.board.requests![0] = { ...request, position: request.position === 'C' ? 'PG' : 'C' };
    expect(check(edited)).toThrow(/seeded draw picks/);
  }, 300_000);
});

describe('the latest completed season\'s board history is rebuilt after sealing (format 73)', () => {
  it('refuses a changed review of the previous season in season three', () => {
    const finish = (from: SeasonState) => { let state = from; while (state.status === 'active') state = play(state); for (let step = 0; step < 120 && getMarketStartReason(state); step += 1) state = advanceMarket(state); return state; };
    let state = setEmploymentDelegation(createSeason({ seed: 31, managedClubId: 'rhine-falcons', injuryMode: 'standard', ...NEW_CAREER_SYSTEMS, matchFlow: false }), true);
    state = rolloverSeason(finish(rolloverSeason(finish(state))));
    state = play(state);
    expect(state.seasonNumber).toBe(3);
    expect(check(state)).not.toThrow();
    // A mid-season review of season two: its senior games still keep each player's minutes, so it is rebuilt.
    const edited = clone(state), index = edited.board.reviews.findIndex(review => review.seasonNumber === 2 && review.round === 10);
    const club = Object.keys(edited.board.reviews[index]!.clubs).find(id => id !== edited.managedClubId)!;
    const review = edited.board.reviews[index]!.clubs[club]!;
    edited.board.reviews[index]!.clubs[club] = { ...review, wins: review.wins + 1 };
    expect(check(edited)).toThrow(/board\.reviews/);
  }, 900_000);
});
