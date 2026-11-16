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
import { contractForSeason, getClubContractSummary, MIN_ROSTER_WAGE_RESERVE, WAGE_STEP } from '../src/world/employment-policy';

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

  it('lets a club whose agreed wages exceed a fallen allocation complete eight players, so the offseason closes', () => {
    // Format 72 can lower a club's allocation below wages it agreed earlier (in the real-data acceptance career two
    // clubs were left with 3 and 7 players over budget and the offseason never closed). Only the large run reaches that
    // by play, so the agreed wages are raised here: three players whose wages exceed the whole allocation, nobody else.
    const world = { ...testWorld(6), rosterModel: 'club-roster-1' };
    let state = setEmploymentDelegation(createSeason({ world, seed: 5, managedClubId: world.clubs[0].id, ...NEW_CAREER_SYSTEMS }), true);
    // Before the final matchday, so the offseason opens on these terms.
    while (state.round < seasonRounds(state)) state = play(state);
    const clubId = world.clubs[3].id, next = state.seasonNumber + 1;
    const budget = getClubContractSummary(state, clubId).budget;
    const kept = state.employment.contracts.filter(contract => contract.clubId === clubId && contractForSeason(state.employment, contract.playerId, state.seasonNumber)?.id === contract.id && [undefined, clubId].includes(contractForSeason(state.employment, contract.playerId, next)?.clubId)).slice(0, 3);
    const wage = (Math.floor(budget / 2 / WAGE_STEP) + 1) * WAGE_STEP;
    const agreed = kept.map((contract, index) => ({ ...contract, id: `employment-contract-agreed-${index + 1}`, startsSeason: next, startsRound: 1, endsSeason: next, seasonWage: wage, signedSeason: state.seasonNumber, signedRound: 1, kind: 'renewal' }));
    state = { ...state, employment: { ...state.employment, contracts: [
      ...state.employment.contracts.filter(contract => contract.clubId !== clubId || contract.startsSeason <= state.seasonNumber).map(contract => contract.clubId === clubId ? { ...contract, endsSeason: state.seasonNumber } : contract),
      ...agreed,
    ] } };
    while (state.status === 'active') state = play(state);
    const before = getClubContractSummary(state, clubId);
    expect(before.rosterSize).toBeLessThan(8);
    expect(before.seasonWages).toBeGreaterThan(before.budget);
    for (let step = 0; step < 120 && getMarketStartReason(state); step += 1) state = advanceMarket(state);
    expect(getMarketStartReason(state)).toBeNull();
    const after = getClubContractSummary(state, clubId);
    expect(after.rosterSize).toBeGreaterThanOrEqual(8);
    // Only players at no more than the protected reserve wage were added over the allocation.
    expect(after.contracts.filter(contract => !agreed.some(item => item.id === contract.id)).every(contract => contract.seasonWage <= MIN_ROSTER_WAGE_RESERVE)).toBe(true);
  }, 600_000);
});
