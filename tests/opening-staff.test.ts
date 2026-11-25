import { staffLimit } from '../src/world/wage-pool';
import { describe, expect, it } from 'vitest';
import type { CareerWorld } from '../src/domain/world';
import type { SeasonState } from '../src/domain/season';
import { testWorld } from './world-fixtures';
import { advanceSeason, createSeason, managedSide, NEW_CAREER_SYSTEMS, rolloverSeason } from '../src/world/season';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { parseSeason, serializeSeason, serializeSeasonCompact } from '../src/storage/season-storage';
import { advanceMarket } from '../src/world/market';
import { getMarketStartReason } from '../src/world/market-policy';
import { setEmploymentDelegation } from '../src/world/employment';
import { clubEconomy, withRealEconomy } from '../src/world/economy';
import { withLowerDivisions } from '../src/world/lower-division';
import { requireWorldContexts } from '../src/world/career-world';
import { remainingStaffBudget, staffAllocation, staffCommitted } from '../src/world/staff-policy';
import { clubStaffLevels, STAFF_LEVEL_RULES } from '../src/world/staff-levels';
import { availableCoaches } from '../src/world/coaching';
import { availableFitnessCoaches } from '../src/world/fitness-policy';
import { availablePhysios } from '../src/world/physio-policy';
import { availableYouthCoaches } from '../src/world/youth-policy';
import { hirePhysio } from '../src/world/physio';
import { quoteStaffReplacement, releaseStaff, replaceStaff, replacementWarning, roleStaff, sackingTerms, STAFF_ROLES, type StaffRole } from '../src/world/staff-roster';
import { staffFee } from '../src/world/economy';

/** Two divisions of six clubs with researched money, and a next division whose promoted club joins the full world. */
function moneyWorld(): CareerWorld {
  const base = testWorld(12);
  const playerContracts = Object.fromEntries(base.clubs.flatMap(club => club.players.map((player, index) => [player.id, 1 + (index % 3)])));
  return withRealEconomy(withLowerDivisions({ ...base, id: 'opening-staff-test', rosterModel: 'club-roster-1', playerContracts, domesticLeagues: [
    { id: 'first', name: 'First division', country: 'Testland', tier: 1, clubIds: base.clubs.slice(0, 6).map(club => club.id), postseason: 'test-tier1-1', standingsRule: 'fiba-2026-d' },
    { id: 'second', name: 'Second division', country: 'Testland', tier: 2, clubIds: base.clubs.slice(6).map(club => club.id), postseason: 'test-tier2-2', standingsRule: 'fiba-2026-d' },
  ] }, [{ country: 'Testland', tier: 3, name: 'Third division', clubs: Array.from({ length: 4 }, (_, index) => ({ id: `third-${index + 1}`, name: `Third Club ${index + 1}`, shortName: `TC${index + 1}`, color: '#336699' })) }]));
}
const roundTrip = (state: SeasonState) => parseSeason(serializeSeasonCompact(state));
const play = (state: SeasonState) => state.activeMatch ? { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) } : state;
const average = (state: SeasonState, clubId: string) => STAFF_ROLES.reduce((sum, role) => sum + roleStaff(state, role, clubId)[0]!.rating, 0) / STAFF_ROLES.length;
const money = (cents: number) => `EUR ${cents / 100}`;

function expectFullyStaffed(state: SeasonState): void {
  for (const club of state.clubs) {
    for (const role of STAFF_ROLES) expect(roleStaff(state, role, club.id).length, `${club.id} ${role}`).toBeGreaterThanOrEqual(1);
    expect(staffCommitted(state, club.id), club.id).toBeLessThanOrEqual(staffAllocation(state, club.id));
  }
}

// The coaching-3 rules of formats 74-75 on purpose (fees paid at the hire, `staffContracts: false`); weekly staff
// contracts (format 76, coaching-4) are covered by tests/staff-contracts.test.ts.
describe('opening staff for every club (format 74, coaching-2)', () => {
  it('staffs every club in every role at ratings fitting its level and within its staff budget', () => {
    for (const world of [undefined, moneyWorld()]) {
      const state = createSeason({ seed: 5, ...(world ? { world, managedClubId: world.clubs[3]!.id } : {}), injuryMode: 'off', ...NEW_CAREER_SYSTEMS, staffContracts: false });
      expect(state.coaching.model).toBe('coaching-3'); // format 75: club-level staff with the wage pool
      expectFullyStaffed(state);
      // One person per role at the opening (training coaches and scouts can add more later).
      for (const club of state.clubs) for (const role of STAFF_ROLES) expect(roleStaff(state, role, club.id)).toHaveLength(1);
      if (!world) continue;
      // Richer clubs field better staff; the poorest club's opening staff fit its smaller budget.
      const levels = clubStaffLevels(state);
      const ranked = [...state.clubs].sort((left, right) => levels.get(left.id)! - levels.get(right.id)!);
      const [poorest, richest] = [ranked[0]!, ranked.at(-1)!];
      expect(clubEconomy(state, richest.id)!.budget).toBeGreaterThan(clubEconomy(state, poorest.id)!.budget);
      expect(average(state, richest.id)).toBeGreaterThan(average(state, poorest.id) + 2);
      // Each opening appointment uses at most the role's share of the staff budget whenever someone fits that share.
      for (const club of state.clubs) for (const role of STAFF_ROLES) {
        const share = Math.floor(staffAllocation(state, club.id) * STAFF_LEVEL_RULES.shares[role] / 100);
        expect(roleStaff(state, role, club.id)[0]!.fee, `${club.id} ${role}`).toBeLessThanOrEqual(share);
      }
      expect(roundTrip(state)).toEqual(state);
    }
  });

  it('sacks and replaces with a warning, frees the sacked fee from the staff budget and passes the strict save check', () => {
    const world = moneyWorld();
    let state = createSeason({ seed: 5, world, managedClubId: world.clubs[2]!.id, injuryMode: 'off', ...NEW_CAREER_SYSTEMS, staffContracts: false });
    const clubId = state.managedClubId;

    // Sacking: the fee was paid at the hire and is not refunded, but it leaves the staff budget.
    const physio = roleStaff(state, 'physio')[0]!;
    expect(sackingTerms(state, physio, money)).toContain('is not refunded');
    const cash = state.finance.ledger.length;
    const before = remainingStaffBudget(state, clubId);
    state = releaseStaff(state, 'physio', physio.contractId);
    expect(state.finance.ledger.length).toBe(cash);
    expect(roleStaff(state, 'physio')).toHaveLength(0);
    expect(remainingStaffBudget(state, clubId)).toBe(before + physio.fee);
    state = roundTrip(state);

    // Replacing in one step: the warning names the person who leaves; the new person's fee is paid now.
    const replacements: [StaffRole, (state: SeasonState) => { id: string; fee: number }[]][] = [
      ['coaches', state => availableCoaches(state.coaching, state)],
      ['fitness', availableFitnessCoaches],
    ];
    for (const [role, candidates] of replacements) {
      const outgoing = roleStaff(state, role)[0]!;
      expect(replacementWarning(outgoing)).toBe(`This replaces ${outgoing.name} as ${role === 'coaches' ? 'training coach' : 'fitness coach'}. ${outgoing.name} leaves the club; their fee is not refunded.`);
      const choice = [...candidates(state)].sort((left, right) => left.fee - right.fee || (left.id < right.id ? -1 : 1)).find(candidate => quoteStaffReplacement(state, role, outgoing.contractId, candidate.id).canReplace)!;
      expect(choice).toBeDefined();
      const ledger = state.finance.ledger.length;
      state = replaceStaff(state, role, outgoing.contractId, choice.id);
      expect(roleStaff(state, role).map(member => member.personId)).toEqual([choice.id]);
      expect(state.finance.ledger.length).toBe(ledger + 1);
      expect(state.finance.ledger.at(-1)!.amount).toBe(-staffFee(state, clubId, choice.fee));
      state = roundTrip(state);
    }
    expect(staffCommitted(state, clubId)).toBeLessThanOrEqual(staffAllocation(state, clubId));

    // A replacement that does not fit says why and changes nothing.
    const fitness = roleStaff(state, 'fitness')[0]!;
    const unaffordable = availableFitnessCoaches(state).filter(candidate => staffFee(state, clubId, candidate.fee) > remainingStaffBudget(state, clubId) + fitness.fee)[0];
    if (unaffordable) expect(quoteStaffReplacement(state, 'fitness', fitness.contractId, unaffordable.id)).toMatchObject({ canReplace: false, reason: expect.any(String) });

    // A new physio fills the vacancy, and the week after still saves.
    state = hirePhysio(state, [...availablePhysios(state)].sort((left, right) => left.fee - right.fee)[0]!.id);
    state = advanceSeason(play(state));
    expect(roundTrip(state)).toEqual(state);
  });

  it('keeps computer clubs staffed across a rollover, including a club joining the full world', () => {
    requireWorldContexts(true);
    try {
      const world = moneyWorld();
      // Seed 11 (found before format 105, whose new names give generated coaches other styles, so run without it) relegates Atlantic Pilots (w0), who can neither renew their coaches nor afford a fitting new one. Before
      // format 84 they started season two without a coach; now the training (head) coach is appointed first and, when the
      // club can afford no one, the cheapest coach on the market is the minimum appointment.
      let state = setEmploymentDelegation(createSeason({ seed: 11, world, managedClubId: world.clubs[0]!.id, ...NEW_CAREER_SYSTEMS, staffContracts: false, generatedPeople: false }), true);
      while (state.status === 'active') state = advanceSeason(play(state));
      for (let steps = 0; steps < 120 && getMarketStartReason(state); steps += 1) state = advanceMarket(state);
      state = rolloverSeason(state);
      expect(state.seasonNumber).toBe(2);
      expect(state.coaching.model).toBe('coaching-3'); // format 75: club-level staff with the wage pool
      for (const club of state.clubs.filter(club => club.id !== state.managedClubId)) for (const role of STAFF_ROLES) expect(roleStaff(state, role, club.id).length, `${club.id} ${role}`).toBeGreaterThanOrEqual(1);
      // Format 75: staff fees may also use unused player salary budget (one wage pool). Format 84: only a minimum
      // appointment goes beyond it. Atlantic Pilots' coach (first) and four cheapest people leave less than the cheapest
      // youth coach costs, so their youth coach is the cheapest on the market and Wages left is exceeded by less than his fee.
      const over = state.clubs.filter(club => staffCommitted(state, club.id) > staffLimit(state, club.id)).map(club => club.id);
      expect(over).toEqual(['w0-atlantic-pilots']);
      const pilots = 'w0-atlantic-pilots', youthCoach = roleStaff(state, 'youth', pilots)[0]!;
      expect(youthCoach.fee).toBe(Math.min(...availableYouthCoaches(state).map(coach => staffFee(state, pilots, coach.fee))));
      expect(staffCommitted(state, pilots) - staffLimit(state, pilots)).toBeLessThan(youthCoach.fee);
      expect(roleStaff(state, 'coaches', pilots)).toHaveLength(1);
      expect(roundTrip(state)).toEqual(state);
    } finally { requireWorldContexts(false); }
  }, 600_000);
});

/** A computer club's empty staff roles after a season change (none expected from format 84). */
function staffGaps(state: SeasonState): string[] {
  return state.clubs.filter(club => club.id !== state.managedClubId).flatMap(club => STAFF_ROLES.filter(role => !roleStaff(state, role, club.id).length).map(role => `${club.id} ${role}`));
}
function playToRollover(state: SeasonState): SeasonState {
  let next = state;
  while (next.status === 'active') next = advanceSeason(play(next));
  for (let steps = 0; steps < 120 && getMarketStartReason(next); steps += 1) next = advanceMarket(next);
  return rolloverSeason(next);
}

// Format 84 (`coaching.fullStaff`, owner report 22 November 2026): a professional club never starts a season short of staff.
describe('computer clubs always fill every staff role (format 84)', () => {
  it('leaves no computer club without a training coach or any other role after season changes, and saves pass the strict check', () => {
    requireWorldContexts(true);
    try {
      // Seed 11 under staff contracts (format 76): before format 84 Adriatic Comets started season two with no fitness
      // coach or physio and Danube Lynx with no physio or youth coach; seeds 1-5 each left three to five clubs short.
      for (const [seed, seasons] of [[11, 2], [1, 1], [2, 1], [3, 1], [4, 1], [5, 1]] as const) {
        const world = moneyWorld();
        let state = setEmploymentDelegation(createSeason({ seed, world, managedClubId: world.clubs[0]!.id, ...NEW_CAREER_SYSTEMS }), true);
        expect(state.coaching).toMatchObject({ model: 'coaching-4', fullStaff: true });
        for (let season = 2; season <= 1 + seasons; season += 1) {
          state = playToRollover(state);
          expect(state.seasonNumber).toBe(season);
          expect(staffGaps(state), `seed ${seed} season ${season}`).toEqual([]);
        }
        expect(roundTrip(state)).toEqual(state);
      }
    } finally { requireWorldContexts(false); }
  }, 900_000);

  it('keeps careers without the rule unchanged and refuses the rule in older saves', () => {
    requireWorldContexts(true);
    try {
      // Without the rule (careers before format 84) seed 11 still relegates Atlantic Pilots into a season without a coach.
      const world = moneyWorld();
      const opening = setEmploymentDelegation(createSeason({ seed: 11, world, managedClubId: world.clubs[0]!.id, ...NEW_CAREER_SYSTEMS, staffContracts: false, fullStaff: false, generatedPeople: false }), true);
      expect(Object.hasOwn(opening.coaching, 'fullStaff')).toBe(false);
      expect(staffGaps(playToRollover(opening))).toEqual(['w0-atlantic-pilots coaches']);
      // The rule is stored as `coaching.fullStaff: true` from format 84, only with the wage pool.
      // Without the format-85 and format-87 world rules and format 86's steering head coaches, so the same file can be relabelled as formats 83 and 84.
      const created = createSeason({ seed: 5, world, managedClubId: world.clubs[3]!.id, injuryMode: 'off', ...NEW_CAREER_SYSTEMS, neutralVenues: false, clubCountries: false, coachSteering: false, economyBalance: false, longCareers: false, careerBalance: false, cashBalance: false, squadRefresh: false, playerDevelopment: false, managerOfferWithdrawal: false, nbaFreeAgency: false, generatedPeople: false, positionProfiles: false });
      const plain = JSON.parse(serializeSeason(created));
      const variant = (version: number, coaching: object) => JSON.stringify({ ...plain, formatVersion: version, state: { ...plain.state, schemaVersion: version, coaching: { ...plain.state.coaching, ...coaching } } });
      expect(parseSeason(variant(84, {}))).toEqual(created);
      expect(() => parseSeason(variant(83, {}))).toThrow(/coaching\.fullStaff/);
      expect(() => parseSeason(variant(84, { fullStaff: false }))).toThrow(/coaching\.fullStaff/);
      const { fullStaff: _rule, ...older } = plain.state.coaching;
      expect(parseSeason(JSON.stringify({ ...plain, formatVersion: 83, state: { ...plain.state, schemaVersion: 83, coaching: older } })).coaching).not.toHaveProperty('fullStaff');
    } finally { requireWorldContexts(false); }
  }, 600_000);
});
