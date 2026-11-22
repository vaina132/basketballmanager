import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import type { CareerWorld } from '../src/domain/world';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { validateSeasonState } from '../src/storage/season-storage';
import { sponsorClause } from '../src/world/commercial-policy';
import { setEmploymentDelegation } from '../src/world/employment';
import { advanceSeason, createSeason, managedSide, NEW_CAREER_SYSTEMS } from '../src/world/season';
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
  complete = setEmploymentDelegation(createSeason({ seed: 1, world, managedClubId: world.clubs[0]!.id, ...NEW_CAREER_SYSTEMS }), true);
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
