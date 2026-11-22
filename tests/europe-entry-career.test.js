import { beforeAll, describe, expect, it } from 'vitest';
import { advanceSeason, createSeason, europeanPlacesAfter, managedSide, NEW_CAREER_SYSTEMS, rolloverSeason } from '../src/world/season';
import { parseSeason, serializeSeasonCompact } from '../src/storage/season-storage';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { setEmploymentDelegation } from '../src/world/employment';
import { advanceMarket } from '../src/world/market';
import { getMarketStartReason } from '../src/world/market-policy';
import { answerEuropeanOffer } from '../src/world/european-entry-day';
import { clubPlace, openingEuropeTwo } from '../src/world/european-entry';
import { placesWorld } from './helpers/europe-worlds';
import { currentSeasonFile } from './helpers/season-format';

const play = state => advanceSeason(state.activeMatch ? { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) } : state);
const roundTrip = state => parseSeason(serializeSeasonCompact(state));

/**
 * Format 83 in a whole career: a season of Testland with a EuroLeague of ten and a EuroCup of sixteen, the places day,
 * the manager's answer, strict save checks of every part and the next season's games with the decided places.
 */
describe('European entry in a career (format 83)', () => {
  let world, complete, answered, next;
  beforeAll(() => {
    world = placesWorld();
    let state = setEmploymentDelegation(createSeason({ seed: 12, world, managedClubId: world.clubs[0].id, ...NEW_CAREER_SYSTEMS }), true);
    expect(state.europe).toEqual(openingEuropeTwo(world));
    while (state.status === 'active') state = play(state);
    complete = state;
    for (let steps = 0; steps < 3 && getMarketStartReason(state); steps += 1) state = advanceMarket(state);
    answered = answerEuropeanOffer(state, 'euroleague', false);
    state = answered;
    for (let steps = 0; steps < 120 && getMarketStartReason(state); steps += 1) state = advanceMarket(state);
    next = rolloverSeason(state);
    for (let week = 0; week < 3; week += 1) next = play(next);
  }, 900_000);

  it('opens with typed places and decides next season at the opening sizes', () => {
    const opening = complete.history.length ? complete.history[0].europe : complete.europe;
    expect(opening.model).toBe('places-2');
    expect(clubPlace(opening, world.europeanCompetitions[0].oneYear[0]).place).toMatchObject({ type: 'wild-card', until: 1 });
    const places = europeanPlacesAfter(complete);
    expect(places.entrants.map(entry => entry.clubIds.length)).toEqual([10, 16]);
    expect(places.decision.seasonNumber).toBe(1);
    expect(places.decision.offers.some(offer => offer.clubId === world.clubs[0].id)).toBe(true);
  });

  it('records the manager\'s Decline: the club leaves the EuroLeague, another club takes the place, and saves check it', () => {
    const clubId = world.clubs[0].id;
    const before = europeanPlacesAfter(complete), after = europeanPlacesAfter(answered);
    expect(answered.europe.answers).toEqual([{ clubId, competitionId: 'euroleague', accept: false }]);
    expect(clubPlace(before, clubId).competitionId).toBe('euroleague');
    expect(clubPlace(after, clubId)?.competitionId).not.toBe('euroleague');
    expect(after.entrants[0].clubIds).toHaveLength(10);
    expect(after.decision.offers).toContainEqual(expect.objectContaining({ clubId, competitionId: 'euroleague', outcome: 'declined', by: 'manager', answered: true }));
    expect(roundTrip(answered)).toEqual(answered);
    const changed = (state, change, pattern) => { const copy = structuredClone(state); change(copy); expect(() => parseSeason(currentSeasonFile(copy))).toThrow(pattern); };
    changed(answered, copy => { copy.europe.answers = [{ clubId, competitionId: 'nowhere', accept: false }]; }, /answers/);
    changed(answered, copy => { copy.europe.answers = [{ clubId: world.clubs[1].id, competitionId: 'euroleague', accept: false }]; }, /answers/);
    changed(complete, copy => { copy.europe.entrants[0].places[0] = { type: 'wild-card', until: 1, reason: 'opening' }; }, /europe/);
    expect(() => answerEuropeanOffer({ ...answered, status: 'active' }, 'euroleague', true)).toThrow(/end of the season/);
  }, 300_000);

  it('plays season two with the decided places, keeps the answer in the archive and rebuilds the places day in saves', () => {
    expect(next.europe).toEqual(europeanPlacesAfter(answered));
    expect(next.history[0].europe.answers).toEqual(answered.europe.answers);
    const games = next.fixtures.filter(fixture => fixture.competition === 'euroleague');
    expect(new Set(games.flatMap(fixture => [fixture.homeClubId, fixture.awayClubId]))).toEqual(new Set(next.europe.entrants[0].clubIds));
    expect(roundTrip(next)).toEqual(next);
    const changed = (change, pattern) => { const copy = structuredClone(next); change(copy); expect(() => parseSeason(currentSeasonFile(copy))).toThrow(pattern); };
    changed(copy => { delete copy.history[0].europe.answers; }, /europe/);
    changed(copy => { copy.europe.decision.lost = []; }, /europe/);
    changed(copy => { copy.europe.decision.chosen = ['nobody']; }, /europe/);
    changed(copy => { copy.europe.held = [...copy.europe.held, { clubId: world.clubs[5].id, competitionId: 'eurocup', type: 'licence', until: null, reason: 'relegated' }]; }, /europe/);
  }, 300_000);
});
