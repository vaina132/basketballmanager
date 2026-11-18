import { describe, expect, it } from 'vitest';
import type { CareerWorld } from '../src/domain/world';
import type { SeasonState } from '../src/domain/season';
import { testWorld } from './world-fixtures';
import { advanceSeason, createSeason, managedSide, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { parseSeason, serializeSeasonCompact } from '../src/storage/season-storage';
import { staffFee, withRealEconomy } from '../src/world/economy';
import { availableCoaches, coachHireReason, coachingCommitted, COACHING_BUDGET, getClubCoaching, hireCoach } from '../src/world/coaching';
import { staffCommitted, staffMoneyReason } from '../src/world/staff-policy';
import { staffLimit } from '../src/world/wage-pool';
import { clubStaffLevels } from '../src/world/staff-levels';

/** Two countries of eighteen clubs with researched money (a real-club career's shape, format 75). */
function twoCountryWorld(): CareerWorld {
  const base = testWorld(36);
  const playerContracts = Object.fromEntries(base.clubs.flatMap(club => club.players.map((player, index) => [player.id, 1 + (index % 3)])));
  const countryOf = (id: string) => base.clubs.findIndex(club => club.id === id) < 18 ? 'Spain' : 'Germany';
  return withRealEconomy({ ...base, id: 'staff-market-test', rosterModel: 'club-roster-1', playerContracts, domesticLeagues: [
    { id: 'es', name: 'Spanish league', country: 'Spain', tier: 1, clubIds: base.clubs.slice(0, 18).map(club => club.id), postseason: 'acb-2026-1', standingsRule: 'fiba-2026-d' },
    { id: 'de', name: 'German league', country: 'Germany', tier: 1, clubIds: base.clubs.slice(18).map(club => club.id), postseason: 'bbl-2026-1', standingsRule: 'fiba-2026-d' },
  ] }, countryOf);
}
const world = twoCountryWorld();
const ranked = (state: SeasonState) => { const levels = clubStaffLevels(state); return [...state.clubs].sort((left, right) => levels.get(left.id)! - levels.get(right.id)!); };
/** A new real-club career (format 75, `coaching-3`), or with `wagePool: false` a format-74 one (`coaching-2`). */
const career = (pick: 'richest' | 'poorest', wagePool = true) => {
  const probe = createSeason({ seed: 5, world, injuryMode: 'off', ...NEW_CAREER_SYSTEMS });
  const club = pick === 'richest' ? ranked(probe).at(-1)! : ranked(probe)[0]!;
  return createSeason({ seed: 5, world, managedClubId: club.id, injuryMode: 'off', ...NEW_CAREER_SYSTEMS, wagePool });
};
const roundTrip = (state: SeasonState) => parseSeason(serializeSeasonCompact(state));
const play = (state: SeasonState) => advanceSeason(state.activeMatch ? { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) } : state);

describe('coach hiring in club-level careers (no fixed catalog cap)', () => {
  it('hires a coach whose catalog fee breaks the old fixed cap when Wages left and Spending left allow it', () => {
    let state = career('richest');
    expect(state.coaching.model).toBe('coaching-3');
    const clubId = state.managedClubId;
    const remaining = () => staffLimit(state, clubId) - staffCommitted(state, clubId);
    // The most expensive affordable coach whose catalog fee, with the coaches employed now, is above the old cap.
    const pick = availableCoaches(state.coaching, state)
      .filter(coach => coachingCommitted(state.coaching, clubId) + coach.fee > COACHING_BUDGET && staffFee(state, clubId, coach.fee) <= remaining())
      .sort((left, right) => right.fee - left.fee || (left.id < right.id ? -1 : 1))[0];
    expect(pick, 'a coach above the old cap that the club can afford').toBeDefined();
    expect(coachHireReason(state, pick!.id)).toBeNull();
    const before = getClubCoaching(state.coaching, clubId).length;
    state = hireCoach(state, pick!.id);
    expect(getClubCoaching(state.coaching, clubId)).toHaveLength(before + 1);
    expect(coachingCommitted(state.coaching, clubId)).toBeGreaterThan(COACHING_BUDGET);
    // The strict save check accepts it, and a week of play keeps it valid.
    expect(roundTrip(state)).toEqual(state);
    state = play(state);
    expect(roundTrip(state)).toEqual(state);
  }, 300_000);

  it('names the real reason for every refusal in plain words', () => {
    // Without the wage pool the staff budget alone limits staff fees, so the poorest club cannot afford every coach.
    let state = career('poorest', false);
    expect(state.coaching.model).toBe('coaching-2');
    const clubId = state.managedClubId;
    const remaining = Math.max(0, staffLimit(state, clubId) - staffCommitted(state, clubId));
    const tooDear = availableCoaches(state.coaching, state).find(coach => staffFee(state, clubId, coach.fee) > remaining);
    expect(tooDear, 'a coach above the poorest club\'s Wages left').toBeDefined();
    expect(coachHireReason(state, tooDear!.id)).toMatch(/^Not enough Wages left: this coach costs €[\d.,]+M? a season, you have €[\d.,]+M? left\.$/);
    expect(() => hireCoach(state, tooDear!.id)).toThrow(/^Not enough Wages left/);
    // Spending left: the fee is paid in full when hired.
    expect(staffMoneyReason(state, 'physio', 5_000_000, 10_000_000, 2_000_000)).toBe('Not enough Spending left: the €50,000 season fee is paid when hired, you have €20,000 to spend.');
    expect(staffMoneyReason(state, 'physio', 5_000_000, 10_000_000, 6_000_000)).toBeNull();
    // A coach already working for a club, and full coaching places.
    const employed = getClubCoaching(state.coaching, state.clubs.find(club => club.id !== clubId)!.id)[0]!;
    expect(coachHireReason(state, employed.coachId)).toBe('This coach is not available: he already works for a club.');
    const cheap = () => availableCoaches(state.coaching, state).filter(coach => coachHireReason(state, coach.id) === null).sort((left, right) => left.fee - right.fee)[0];
    while (getClubCoaching(state.coaching, clubId).length < 3 && cheap()) state = hireCoach(state, cheap()!.id);
    if (getClubCoaching(state.coaching, clubId).length === 3) expect(coachHireReason(state, availableCoaches(state.coaching, state)[0]!.id)).toBe('All three coaching places are filled. Release a coach first.');
  }, 300_000);
});
