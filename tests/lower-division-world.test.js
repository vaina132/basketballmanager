import { describe, expect, it } from 'vitest';
import { testWorld } from './world-fixtures';
import { advanceSeason, createSeason, managedSide, NEW_CAREER_SYSTEMS, rolloverSeason } from '../src/world/season';
import { parseSeason, serializeSeasonCompact } from '../src/storage/season-storage';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { setEmploymentDelegation } from '../src/world/employment';
import { advanceMarket } from '../src/world/market';
import { getMarketStartReason } from '../src/world/market-policy';
import { fullWorldClubs, validateWorld, worldPlayers } from '../src/world/career-world';
import { getActiveCareerPlayers } from '../src/world/player-catalog';
import { LOWER_DIVISION_RULES, squadStrength, withLowerDivisions } from '../src/world/lower-division';

/** Testland's two divisions (six and five clubs, with postseasons) and its real third division of four clubs. */
export function lowerWorld(clubs = 4) {
  const base = testWorld(11);
  const world = { ...base, id: 'lower-division-test', rosterModel: 'club-roster-1', domesticLeagues: [
    { id: 'first', name: 'First division', country: 'Testland', tier: 1, clubIds: base.clubs.slice(0, 6).map(club => club.id), postseason: 'test-tier1-1', standingsRule: 'fiba-2026-d' },
    { id: 'second', name: 'Second division', country: 'Testland', tier: 2, clubIds: base.clubs.slice(6).map(club => club.id), postseason: 'test-tier2-1', standingsRule: 'fiba-2026-d' },
  ] };
  return withLowerDivisions(world, [{ country: 'Testland', tier: 3, name: 'Third division', clubs: Array.from({ length: clubs }, (_, index) => ({ id: `third-${index + 1}`, name: `Third Club ${index + 1}`, shortName: `TC${index + 1}`, color: '#336699' })) }]);
}
const play = state => advanceSeason(state.activeMatch ? { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) } : state);
const roundTrip = state => parseSeason(serializeSeasonCompact(state));

describe('next-division clubs built into the world (step 3.4d-2)', () => {
  it('gives each a labelled generated squad just below the division above, with estimated club data', () => {
    const world = lowerWorld();
    expect(() => validateWorld(world)).not.toThrow();
    const lower = world.clubs.filter(club => club.id.startsWith('third-'));
    expect(lower).toHaveLength(4);
    const second = world.domesticLeagues[1].clubIds.map(id => squadStrength(world.clubs.find(club => club.id === id).players));
    for (const club of lower) {
      expect(club.players.every(player => world.playerProfiles[player.id].source === 'generated' && player.id.includes('-generated-'))).toBe(true);
      expect(Math.abs(squadStrength(club.players) - (Math.min(...second) - LOWER_DIVISION_RULES.generatedBelow))).toBeLessThanOrEqual(2);
      expect(world.finances.some(item => item.clubId === club.id) && world.presidents.some(item => item.clubId === club.id)).toBe(true);
      expect(club.players.every(player => world.wages[player.id] > 0 && [1, 2, 3].includes(world.playerContracts?.[player.id] ?? 1))).toBe(true);
    }
    expect(fullWorldClubs(world).map(club => club.id)).toEqual(world.domesticLeagues.flatMap(league => league.clubIds).sort((a, b) => world.clubs.findIndex(club => club.id === a) - world.clubs.findIndex(club => club.id === b)));
    expect(worldPlayers(world).some(player => player.id.includes('-generated-'))).toBe(false);
    // Generated squads must stay labelled, and a next-division club cannot also be in a league.
    const relabelled = structuredClone(world); relabelled.playerProfiles[lower[0].players[0].id].source = 'official-profile';
    expect(() => validateWorld(relabelled)).toThrow(/generated squads/);
    const doubled = structuredClone(world); doubled.domesticLeagues[1].clubIds[0] = 'third-1';
    expect(() => validateWorld(doubled)).toThrow(/domesticLeagues|outside every league/);
    expect(() => withLowerDivisions(world, [])).toThrow(/already/);
  });

  it('keeps them out of the full world: never scheduled, signed, scouted or paid, through a season end and strict saves', () => {
    const world = lowerWorld();
    let state = setEmploymentDelegation(createSeason({ world, seed: 31, managedClubId: world.clubs[0].id, ...NEW_CAREER_SYSTEMS }), true);
    const lower = new Set(world.lowerDivisions[0].clubIds);
    const generated = new Set(world.clubs.filter(club => lower.has(club.id)).flatMap(club => club.players.map(player => player.id)));
    const check = value => {
      expect(value.clubs.some(club => lower.has(club.id))).toBe(false);
      expect(value.fixtures.some(fixture => lower.has(fixture.homeClubId) || lower.has(fixture.awayClubId))).toBe(false);
      expect(getActiveCareerPlayers(value).some(player => generated.has(player.id))).toBe(false);
      expect(value.employment.contracts.some(contract => generated.has(contract.playerId) || lower.has(contract.clubId))).toBe(false);
      expect(value.finance.ledger.some(entry => lower.has(entry.clubId))).toBe(false);
    };
    check(state);
    expect(roundTrip(state)).toEqual(state);
    while (state.status === 'active') state = play(state);
    check(state);
    expect(roundTrip(state)).toEqual(state);
    for (let step = 0; step < 120 && getMarketStartReason(state); step += 1) state = advanceMarket(state);
    check(state);
    state = rolloverSeason(state);
    check(state);
    expect(roundTrip(state)).toEqual(state);
  }, 300_000);
});
