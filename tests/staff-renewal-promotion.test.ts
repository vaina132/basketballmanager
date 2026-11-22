import { describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { parseSeason, serializeSeasonCompact } from '../src/storage/season-storage';
import { COACH_DIRECTORY, staffMarket } from '../src/data/staff-directory';
import { coachHireReason, getClubCoaching, hireCoach } from '../src/world/coaching';
import { lowerDivisionClubIds } from '../src/world/career-world';
import { setEmploymentDelegation } from '../src/world/employment';
import { advanceMarket } from '../src/world/market';
import { getMarketStartReason } from '../src/world/market-policy';
import { worldFromPack } from '../src/world/real-world';
import { advanceSeason, createSeason, managedSide, NEW_CAREER_SYSTEMS, rolloverSeason } from '../src/world/season';
import { staffMarketWorld } from '../src/world/staff-levels';
import { economyPack } from './helpers/economy-pack';

/**
 * Live bug (22 November 2026): real-club careers crashed at the season change with "This coach is not available: he
 * already works for a club." The staff market is sized to the clubs and their countries, and clubs promoted from a
 * country's next division have no country in the world, so the new season's local pool is shorter: a coach hired from
 * the end of it dropped out of the market, and renewing him failed the availability check. A renewal keeps him now.
 */
// Greece's top division (14 clubs, the last relegated) is the smallest real league with a next division (the Elite League).
const levels = [16, 16, 15, 15, 14, 14, 13, 13, 12, 12, 11, 11, 10, 9];
const pack = economyPack([{ id: 'gbl', name: 'Greek Basket League', country: 'Greece', tier: 1, levels }], null, 12);
const world = worldFromPack({ ...pack, players: pack.players.map(player => ({ ...player, nationality: 'Greece' })) }, 'gbl');
const roundTrip = (state: SeasonState) => parseSeason(serializeSeasonCompact(state));
const play = (state: SeasonState) => advanceSeason(state.activeMatch && state.activeMatch.status !== 'finished' ? { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) } : state);

describe('staff renewals when promoted clubs join (live season-change crash)', () => {
  it('rolls a Greek real-club career over with the manager\'s coach from the end of the local pool, passing the strict check', () => {
    expect(lowerDivisionClubIds(world).size).toBeGreaterThan(0);
    // Careers before format 85 (no `clubCountries`) give promoted clubs no country, so their local pools shrink.
    let state = setEmploymentDelegation(createSeason({ seed: 7, world, managedClubId: 'gbl-1', injuryMode: 'standard', ...NEW_CAREER_SYSTEMS, clubCountries: false }), true);
    expect(state.coaching.model).toBe('coaching-4');
    // The coaches the market loses when one Greek club of the full world is counted without a country.
    const scope = staffMarketWorld(state);
    const now = staffMarket(COACH_DIRECTORY, scope);
    const shorter = new Set(staffMarket(COACH_DIRECTORY, { ...scope, countries: scope.countries!.map((country, index) => index === 0 ? null : country) }).map(coach => coach.id));
    const dropping = now.filter(coach => !shorter.has(coach.id));
    expect(dropping.length).toBeGreaterThan(0);
    const coach = dropping.find(candidate => coachHireReason(state, candidate.id) === null);
    expect(coach).toBeDefined();
    state = hireCoach(state, coach!.id);
    while (state.status === 'active') state = play(state);
    for (let steps = 0; steps < 200 && getMarketStartReason(state); steps += 1) state = advanceMarket(state);
    const before = state;
    state = rolloverSeason(state);
    // Clubs from the next division joined, and the new season's market no longer lists the manager's coach.
    expect(state.clubs.some(club => lowerDivisionClubIds(world).has(club.id) && !before.clubs.some(old => old.id === club.id))).toBe(true);
    expect(staffMarket(COACH_DIRECTORY, staffMarketWorld(state)).some(candidate => candidate.id === coach!.id)).toBe(false);
    // He stays (renewed at his club, or still under contract), and nobody holds two jobs.
    expect(getClubCoaching(state.coaching, 'gbl-1').map(contract => contract.coachId)).toContain(coach!.id);
    const active = state.coaching.contracts.filter(contract => contract.releasedRound === null).map(contract => contract.coachId);
    expect(new Set(active).size).toBe(active.length);
    expect(roundTrip(state)).toEqual(state);
    const week = play(state);
    expect(roundTrip(week)).toEqual(week);
  }, 900_000);
});
