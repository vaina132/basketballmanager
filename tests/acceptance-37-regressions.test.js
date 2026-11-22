import { describe, expect, it } from 'vitest';
import { testWorld } from './world-fixtures';
import { advanceSeason, createSeason, managedSide, NEW_CAREER_SYSTEMS, resignManager, rolloverSeason } from '../src/world/season';
import { NO_CLUB } from '../src/world/career-rules';
import { parseSeason, serializeSeasonCompact } from '../src/storage/season-storage';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { setEmploymentDelegation } from '../src/world/employment';
import { advanceMarket } from '../src/world/market';
import { getMarketStartReason } from '../src/world/market-policy';
import { seasonRounds, validateWorld } from '../src/world/career-world';
import { withLowerDivisions } from '../src/world/lower-division';
import { getClubContractSummary, MIN_ROSTER_SIZE } from '../src/world/employment-policy';
import { withRealEconomy } from '../src/world/economy';
import { leavingClubIds } from '../src/world/background';

// Step 3.7 acceptance regressions: careers that live play reaches and the strict save check must accept.
const play = state => advanceSeason(state.activeMatch ? { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) } : state);
const roundTrip = state => parseSeason(serializeSeasonCompact(state));

/** Two divisions with researched money and a next division (as in economy-seasons-career.test.ts). */
function moneyWorld() {
  const base = testWorld(12);
  const playerContracts = Object.fromEntries(base.clubs.flatMap(club => club.players.map((player, index) => [player.id, 1 + (index % 3)])));
  return withRealEconomy(withLowerDivisions({ ...base, id: 'economy-seasons-test', rosterModel: 'club-roster-1', playerContracts, domesticLeagues: [
    { id: 'first', name: 'First division', country: 'Testland', tier: 1, clubIds: base.clubs.slice(0, 6).map(club => club.id), postseason: 'test-tier1-1', standingsRule: 'fiba-2026-d' },
    { id: 'second', name: 'Second division', country: 'Testland', tier: 2, clubIds: base.clubs.slice(6).map(club => club.id), postseason: 'test-tier2-2', standingsRule: 'fiba-2026-d' },
  ] }, [{ country: 'Testland', tier: 3, name: 'Third division', clubs: Array.from({ length: 4 }, (_, index) => ({ id: `third-${index + 1}`, name: `Third Club ${index + 1}`, shortName: `TC${index + 1}`, color: '#336699' })) }]));
}

/** Fourteen Greek clubs (final best of five, so a sweep leaves the reserved last week empty) and a next division. */
function greekWorld() {
  const base = testWorld(14);
  return withLowerDivisions({ ...base, id: 'greek-season-end-test', rosterModel: 'club-roster-1', domesticLeagues: [
    { id: 'gbl', name: 'Greek league', country: 'Greece', tier: 1, clubIds: base.clubs.map(club => club.id), postseason: 'gbl-2026-1', standingsRule: 'fiba-2026-d' },
  ] }, [{ country: 'Greece', tier: 2, name: 'Second division', clubs: [1, 2].map(index => ({ id: `second-${index}`, name: `Second Club ${index}`, shortName: `SC${index}`, color: '#336699' })) }]);
}

describe('step 3.7 acceptance careers in the strict save check', () => {
  it('accepts sponsor exits and second-round offers when the final was settled before the last reserved week', () => {
    const world = greekWorld();
    expect(() => validateWorld(world)).not.toThrow();
    // Seed 5 (11 before the planned starting five of 16 November 2026): the final ends in a sweep, so the season's last
    // week has no game; sponsors leave at the season end.
    // Seed-found scenario from before every club started with staff (format 74): it keeps the earlier staffing.
    let state = setEmploymentDelegation(createSeason({ world, seed: 5, managedClubId: world.clubs[0].id, ...NEW_CAREER_SYSTEMS, injuryLengths: false, staffing: false, calmPlayingTime: false }), true);
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
    // Format 72 lowers a club's allocation at a rollover while wages agreed earlier stay (real-data acceptance: two clubs
    // with 3 and 7 players over their new allocation, and the season-four offseason never closed). In this world clubs
    // start season two's offseason short of eight players and over their fallen allocation.
    const world = moneyWorld();
    let state = setEmploymentDelegation(createSeason({ seed: 9, world, managedClubId: world.clubs[0].id, ...NEW_CAREER_SYSTEMS, injuryLengths: false }), true);
    while (state.status === 'active') state = play(state);
    for (let step = 0; step < 120 && getMarketStartReason(state); step += 1) state = advanceMarket(state);
    state = rolloverSeason(state);
    while (state.status === 'active') state = play(state);
    const leaving = leavingClubIds(state);
    const short = state.clubs.filter(club => !leaving.has(club.id)).map(club => getClubContractSummary(state, club.id)).filter(summary => summary.rosterSize < MIN_ROSTER_SIZE && summary.seasonWages > summary.budget);
    expect(short.length).toBeGreaterThan(0);
    for (let step = 0; step < 120 && getMarketStartReason(state); step += 1) state = advanceMarket(state);
    expect(getMarketStartReason(state)).toBeNull();
    for (const before of short) {
      const after = getClubContractSummary(state, before.clubId);
      expect(after.rosterSize).toBeGreaterThanOrEqual(MIN_ROSTER_SIZE);
      // Only cheap players needed for the minimum squad were added over the fallen allocation.
      expect(after.contracts.filter(contract => !before.contracts.some(item => item.id === contract.id)).every(contract => contract.seasonWage <= before.reserveWage)).toBe(true);
    }
    // And the save check agrees.
    expect(roundTrip(state)).toEqual(state);
  }, 900_000);
  it('keeps a president\'s requests to the manager\'s club after the manager leaves it mid-season', () => {
    // Real-data acceptance, season five: the manager was dismissed in week 37 without a new club, and the check took the
    // season's final club (none) for the president's earlier requests and the season-opening objectives.
    let state;
    for (let seed = 1; seed <= 30 && !state; seed += 1) {
      let career = setEmploymentDelegation(createSeason({ seed, managedClubId: 'adriatic-comets', injuryMode: 'standard', ...NEW_CAREER_SYSTEMS }), true);
      while (career.status === 'active' && !(career.board.requests ?? []).length) career = play(career);
      if (career.status === 'active') state = career;
    }
    expect(state.board.requests[0].clubId).toBe('adriatic-comets');
    state = play(state);
    const left = resignManager(state, NO_CLUB);
    expect(left.career.moves.at(-1)).toMatchObject({ phase: 'season', fromClubId: 'adriatic-comets', toClubId: NO_CLUB });
    expect(roundTrip(left)).toEqual(left);
  }, 600_000);
});
