import { describe, expect, it } from 'vitest';
import type { CareerWorld } from '../src/domain/world';
import type { SeasonState } from '../src/domain/season';
import { testWorld } from './world-fixtures';
import { advanceSeason, createSeason, managedSide, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { parseSeason, serializeSeasonCompact } from '../src/storage/season-storage';
import { staffFee, withRealEconomy } from '../src/world/economy';
import { availableScouts, scoutRating } from '../src/world/scout-policy';
import { availableFitnessCoaches, fitnessRating } from '../src/world/fitness-policy';
import { availablePhysios, physioRating } from '../src/world/physio-policy';
import { availableAssistants, assistantRating } from '../src/world/assistant-policy';
import { availableYouthCoaches, youthCoachRating } from '../src/world/youth-policy';
import { coachRating } from '../src/world/coaching';
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
    expect(state.coaching.model).toBe('coaching-4');
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
    expect(coachHireReason(state, tooDear!.id)).toMatch(/^Not enough Wages left: this training coach costs €[\d.,]+M? a season, you have €[\d.,]+M? left\.$/);
    expect(() => hireCoach(state, tooDear!.id)).toThrow(/^Not enough Wages left/);
    // Spending left: the fee is paid in full when hired.
    expect(staffMoneyReason(state, 'physio', 5_000_000, 10_000_000, 2_000_000)).toBe('Not enough Spending left: the €50,000 season fee is paid when hired, you have €20,000 to spend.');
    expect(staffMoneyReason(state, 'physio', 5_000_000, 10_000_000, 6_000_000)).toBeNull();
    // A coach already working for a club, and full coaching places.
    const employed = getClubCoaching(state.coaching, state.clubs.find(club => club.id !== clubId)!.id)[0]!;
    expect(coachHireReason(state, employed.coachId)).toBe('This training coach is not available: he already works for a club.');
    const cheap = () => availableCoaches(state.coaching, state).filter(coach => coachHireReason(state, coach.id) === null).sort((left, right) => left.fee - right.fee)[0];
    while (getClubCoaching(state.coaching, clubId).length < 3 && cheap()) state = hireCoach(state, cheap()!.id);
    if (getClubCoaching(state.coaching, clubId).length === 3) expect(coachHireReason(state, availableCoaches(state.coaching, state)[0]!.id)).toBe('All three training coach places are filled. Release a training coach first.');
  }, 300_000);
});

/** Candidates by stars (a rating of 10 is 5 stars) in each staff role's market. */
function marketStars(state: SeasonState): Record<string, { five: number; four: number; fees: { top: number; modest: number } }> {
  const roles: Record<string, { rating: number; fee: number }[]> = {
    coaches: availableCoaches(state.coaching, state).map(coach => ({ rating: coachRating(coach), fee: coach.fee })),
    scouts: availableScouts(state).map(scout => ({ rating: scoutRating(scout), fee: scout.fee })),
    fitness: availableFitnessCoaches(state).map(coach => ({ rating: fitnessRating(coach), fee: coach.fee })),
    physio: availablePhysios(state).map(physio => ({ rating: physioRating(physio), fee: physio.fee })),
    assistant: availableAssistants(state).map(coach => ({ rating: assistantRating(coach), fee: coach.fee })),
    youth: availableYouthCoaches(state).map(coach => ({ rating: youthCoachRating(coach), fee: coach.fee })),
  };
  return Object.fromEntries(Object.entries(roles).map(([role, list]) => [role, {
    five: list.filter(item => item.rating >= 10).length, four: list.filter(item => item.rating === 8).length,
    fees: { top: Math.min(...list.filter(item => item.rating >= 10).map(item => item.fee)), modest: Math.max(...list.filter(item => item.rating <= 5).map(item => item.fee)) },
  }]));
}

describe('top staff in the market of a new real-club career', () => {
  it('offers 5-star and 4-star candidates in every role, at higher fees than modest ones, also after computer clubs recruit', () => {
    let state = career('richest');
    for (const [role, stars] of Object.entries(marketStars(state))) {
      expect(stars.five, `${role} 5-star`).toBeGreaterThanOrEqual(2);
      expect(stars.four, `${role} 4-star`).toBeGreaterThanOrEqual(2);
      expect(stars.fees.top, `${role} fees`).toBeGreaterThan(stars.fees.modest);
    }
    // Two sets of top coaches for 36 clubs: four 5-star coaches, none taken by the opening staff.
    expect(marketStars(state).coaches.five).toBe(4);
    // Computer clubs hire extra coaches within the role's share of their staff budget, so the top coaches stay.
    for (let week = 0; week < 8; week += 1) state = play(state);
    expect(marketStars(state).coaches.five).toBeGreaterThanOrEqual(2);
    expect(marketStars(state).coaches.four).toBeGreaterThanOrEqual(2);
    // The richest club can hire a 5-star coach, and the save passes the strict check.
    const top = availableCoaches(state.coaching, state).filter(coach => coachRating(coach) === 10).sort((left, right) => left.id < right.id ? -1 : 1)[0]!;
    if (getClubCoaching(state.coaching, state.managedClubId).length < 3 && coachHireReason(state, top.id) === null) {
      state = hireCoach(state, top.id);
      expect(roundTrip(state)).toEqual(state);
    }
  }, 300_000);
});
