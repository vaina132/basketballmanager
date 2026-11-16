import { describe, expect, it } from 'vitest';
import { testWorld } from './world-fixtures';
import { advanceSeason, createSeason, managedSide, NEW_CAREER_SYSTEMS, rolloverSeason } from '../src/world/season';
import { parseSeason, serializeSeasonCompact } from '../src/storage/season-storage';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { setEmploymentDelegation } from '../src/world/employment';
import { advanceMarket } from '../src/world/market';
import { getMarketStartReason } from '../src/world/market-policy';
import { seasonRounds, validateWorld } from '../src/world/career-world';
import { withLowerDivisions } from '../src/world/lower-division';

// Step 3.7 acceptance regressions: season ends that live play reaches and the strict save check must accept.
const play = state => advanceSeason(state.activeMatch ? { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) } : state);
const roundTrip = state => parseSeason(serializeSeasonCompact(state));

/** Fourteen Greek clubs (final best of five, so a sweep leaves the reserved last week empty) and a next division. */
function greekWorld() {
  const base = testWorld(14);
  return withLowerDivisions({ ...base, id: 'greek-season-end-test', rosterModel: 'club-roster-1', domesticLeagues: [
    { id: 'gbl', name: 'Greek league', country: 'Greece', tier: 1, clubIds: base.clubs.map(club => club.id), postseason: 'gbl-2026-1', standingsRule: 'fiba-2026-d' },
  ] }, [{ country: 'Greece', tier: 2, name: 'Second division', clubs: [1, 2].map(index => ({ id: `second-${index}`, name: `Second Club ${index}`, shortName: `SC${index}`, color: '#336699' })) }]);
}

describe('season ends in the strict save check (step 3.7)', () => {
  it('accepts sponsor exits and second-round offers when the final was settled before the last reserved week', () => {
    const world = greekWorld();
    expect(() => validateWorld(world)).not.toThrow();
    // Seed 11: the final ends in a sweep, so the season's last week has no game; sponsors leave at the season end.
    let state = setEmploymentDelegation(createSeason({ world, seed: 11, managedClubId: world.clubs[0].id, ...NEW_CAREER_SYSTEMS }), true);
    while (state.status === 'active') state = play(state);
    const rounds = seasonRounds(state);
    expect(state.fixtures.some(fixture => fixture.round === rounds)).toBe(false);
    const seasonEnd = state.commercial.events.filter(event => event.round === rounds).map(event => event.type);
    expect(seasonEnd).toContain('exit');
    expect(seasonEnd).toContain('offers');
    expect(roundTrip(state)).toEqual(state);
    // A later season still places that season's end after its completion.
    for (let step = 0; step < 120 && getMarketStartReason(state); step += 1) state = advanceMarket(state);
    state = rolloverSeason(state);
    expect(roundTrip(state)).toEqual(state);
  }, 600_000);
});
