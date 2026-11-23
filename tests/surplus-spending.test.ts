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
import { setFacilityDelegation } from '../src/world/facilities';
import { setPayrollDelegation } from '../src/world/payroll';
import { setSponsorshipDelegation } from '../src/world/commercial';
import { clubEconomy, withRealEconomy } from '../src/world/economy';
import { getFinanceBalance } from '../src/world/finance';
import { financeLedgerEntries } from '../src/world/finance-ledger';
import { fullWorldClubsIn, requireWorldContexts } from '../src/world/career-world';
import { withLowerDivisions } from '../src/world/lower-division';
import { getClubContractSummary } from '../src/world/employment-policy';
import { seasonSalaryBudget } from '../src/world/board-consequences';
import { anchoredSurplus, clubSurplus, paidSigningLimit, plannedSurplusSpend, saleReplacementBudget, spendingAppetite, spendsSurplus, SURPLUS_SPENDING_RULES, surplusTransferBudget, surplusWageCeiling, surplusWagePremium, surplusWageRoom, usesSurplusSpending } from '../src/world/surplus-spending';
import { staffShareCap, staffTargetRating } from '../src/world/staff-levels';
import { DEVELOPMENT_WORLD } from '../src/data/development-world';

/** The world with one careful president (generosity and ambition 1): his club keeps piling up money. */
function carefulPresident(world: CareerWorld, clubId: string): CareerWorld {
  return { ...world, presidents: world.presidents.map(president => president.clubId === clubId ? { ...president, generosity: 1, traits: { ...president.traits!, ambition: 1 } } : president) };
}
/** The economy tests' world: one country, two divisions of six and a third division of four, with researched money. */
function moneyWorld(): CareerWorld {
  const base = carefulPresident(testWorld(12), 'w1-alpine-stags');
  const playerContracts = Object.fromEntries(base.clubs.flatMap(club => club.players.map((player, index) => [player.id, 1 + (index % 3)])));
  return withRealEconomy(withLowerDivisions({ ...base, id: 'surplus-spending-test', rosterModel: 'club-roster-1', playerContracts, domesticLeagues: [
    { id: 'first', name: 'First division', country: 'Testland', tier: 1, clubIds: base.clubs.slice(0, 6).map(club => club.id), postseason: 'test-tier1-1', standingsRule: 'fiba-2026-d' },
    { id: 'second', name: 'Second division', country: 'Testland', tier: 2, clubIds: base.clubs.slice(6).map(club => club.id), postseason: 'test-tier2-2', standingsRule: 'fiba-2026-d' },
  ] }, [{ country: 'Testland', tier: 3, name: 'Third division', clubs: Array.from({ length: 4 }, (_, index) => ({ id: `third-${index + 1}`, name: `Third Club ${index + 1}`, shortName: `TC${index + 1}`, color: '#336699' })) }]));
}
const play = (state: SeasonState) => state.activeMatch ? { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) } : state;
const roundTrip = (state: SeasonState) => parseSeason(serializeSeasonCompact(state));
const career = (world: CareerWorld, seed: number, surplusSpending = true) => createSeason({ seed, world, managedClubId: world.clubs[0]!.id, ...NEW_CAREER_SYSTEMS, surplusSpending });
/** Everything automatic: recruitment, facilities, wage prepayments and sponsorship of the manager's club too. */
const delegate = (state: SeasonState) => state.clubs.some(club => club.id === state.managedClubId) ? setSponsorshipDelegation(setPayrollDelegation(setFacilityDelegation(setEmploymentDelegation(state, true), true), true), true) : state;
/** `share` of a club's budget added to its cash from the career's start (a test lever: one entry more at the ledger's head). */
function addCash(state: SeasonState, clubId: string, share: number): SeasonState {
  const amount = Math.round(clubEconomy(state, clubId)!.budget * share);
  return { ...state, finance: { ...state.finance, ledger: [{ id: `finance-test-${clubId}`, clubId, seasonNumber: 1, round: 1, kind: 'opening', amount, sourceId: 'test', ticket: null, coach: null, payroll: null }, ...state.finance.ledger] } };
}
/** The first season played through, every club run automatically: the offseason that follows it. */
function firstOffseason(world: CareerWorld, surplusSpending = true): SeasonState {
  let state = career(world, 3, surplusSpending);
  while (state.status === 'active') state = advanceSeason(play(state));
  return state;
}

describe('the surplus spending option (format 88)', () => {
  const world = moneyWorld();

  it('marks new careers with the economy balance only, and older formats refuse the marker', () => {
    const state = career(world, 3);
    expect(state.world!.surplusSpending).toBe(true);
    expect(usesSurplusSpending(state)).toBe(true);
    expect(career(world, 3, false).world!.surplusSpending).toBeUndefined();
    expect(createSeason({ seed: 3, world, managedClubId: world.clubs[0]!.id, ...NEW_CAREER_SYSTEMS, economyBalance: false }).world!.surplusSpending).toBeUndefined();
    expect(createSeason({ seed: 3, ...NEW_CAREER_SYSTEMS }).world?.surplusSpending).toBeUndefined();
    expect(() => createSeason({ seed: 3, world, surplusSpending: 'yes' as unknown as boolean })).toThrow(/club spending setting/);
    expect(usesSurplusSpending({ world: { ...DEVELOPMENT_WORLD, surplusSpending: true } })).toBe(false);
    const envelope = JSON.parse(serializeSeason(state));
    envelope.formatVersion = 87; envelope.state.schemaVersion = 87;
    expect(() => parseSeason(JSON.stringify(envelope))).toThrow(/surplusSpending.*format 88/);
    const unbalanced = JSON.parse(serializeSeason(state));
    delete unbalanced.state.world.economyBalance;
    expect(() => parseSeason(JSON.stringify(unbalanced))).toThrow(/surplusSpending/);
  });

  it('gives each club a spending style from its president: some careful clubs keep piling up money', () => {
    const real = fullWorldClubsIn(career(world, 3), 1).map(club => spendingAppetite(world, club.id));
    for (const value of real) expect(value).toBeGreaterThanOrEqual(0), expect(value).toBeLessThanOrEqual(1);
    // The president traits of the test world: a careful club (made so above), middle ones and a club of full appetite.
    expect(real).toContain(0);
    expect(real).toContain(1);
    expect(new Set(real).size).toBeGreaterThan(3);
  });

  it('spends only above the healthy reserve, by appetite and within the bounds, and only for automatic decisions', () => {
    const opening = career(world, 3);
    // At the opening every club holds less than the reserve, and no season has ended: nothing changes.
    for (const club of fullWorldClubsIn(opening, 1)) expect(clubSurplus(opening, club.id)).toBe(0), expect(anchoredSurplus(opening, club.id)).toBe(0);
    const base = firstOffseason(world);
    const clubs = fullWorldClubsIn(base, 1).map(club => club.id).filter(clubId => clubId !== base.managedClubId);
    const rich = clubs.find(clubId => spendingAppetite(world, clubId) === 1)!, careful = clubs.find(clubId => spendingAppetite(world, clubId) === 0)!;
    const flush = addCash(addCash(base, rich, 2), careful, 2), budget = clubEconomy(flush, rich)!.budget;
    // The surplus is the cash above the reserve: the season-end cash for the wage room, the current projection otherwise.
    expect(anchoredSurplus(flush, rich)).toBeGreaterThan(budget * (2 - SURPLUS_SPENDING_RULES.reserveShare));
    expect(clubSurplus(flush, rich)).toBeGreaterThan(budget * (2 - SURPLUS_SPENDING_RULES.reserveShare));
    expect(plannedSurplusSpend(flush, rich)).toBe(Math.floor(clubSurplus(flush, rich) * SURPLUS_SPENDING_RULES.seasonSpendShare));
    expect(plannedSurplusSpend(flush, careful)).toBe(0);
    expect(spendsSurplus(flush, careful)).toBe(false);
    expect(spendsSurplus(flush, rich)).toBe(true);
    // The premium grows with the surplus: full from `premiumFullShare` of the budget.
    expect(surplusWagePremium(flush, rich)).toBe(SURPLUS_SPENDING_RULES.wagePremium);
    expect(paidSigningLimit(flush, rich, false)).toBe(2);
    expect(paidSigningLimit(flush, careful, false)).toBe(0);
    expect(paidSigningLimit(flush, careful, true)).toBe(1);
    expect(surplusWagePremium(flush, careful)).toBe(0);
    // Wage room for next season's contracts: capped at the share of the salary budget, counted in the shared contract guard.
    const room = surplusWageRoom(flush, rich, 2);
    expect(room).toBe(Math.floor(seasonSalaryBudget(flush, rich, 2) * SURPLUS_SPENDING_RULES.maxWageRaise / 50_000) * 50_000);
    expect(room).toBeLessThanOrEqual(surplusWageCeiling(seasonSalaryBudget(flush, rich, 2)));
    const without = addCash(base, rich, -5);
    expect(surplusWageRoom(without, rich, 2)).toBe(0);
    expect(getClubContractSummary(flush, rich, 2).budget - getClubContractSummary(without, rich, 2).budget).toBe(room);
    expect(surplusWageRoom(flush, careful, 2)).toBe(0);
    expect(surplusWageRoom(flush, rich, 4)).toBe(0);
    expect(surplusTransferBudget(flush, rich)).toBe(Math.floor(plannedSurplusSpend(flush, rich) * SURPLUS_SPENDING_RULES.transferShare));
    // Staff: a computer club with a surplus aims higher and may use more of its staff budget.
    expect(staffTargetRating(flush, rich, 'scouts', [0, 100])).toBeGreaterThan(staffTargetRating(without, rich, 'scouts', [0, 100]));
    expect(staffShareCap(flush, rich, 'scouts')).toBeGreaterThan(staffShareCap(without, rich, 'scouts'));
    // The manager's own decisions keep piling up money; delegated recruitment ranks, pays premiums and buys, but never
    // widens the shared guard (whether he delegated is not kept for the save check).
    const managed = addCash(base, base.managedClubId, 2), delegated = setEmploymentDelegation(managed, true);
    expect(spendingAppetite(world, base.managedClubId)).toBeGreaterThan(0);
    expect(surplusTransferBudget(managed, base.managedClubId)).toBe(0);
    expect(spendsSurplus(managed, base.managedClubId)).toBe(false);
    expect(surplusTransferBudget(delegated, base.managedClubId)).toBeGreaterThan(0);
    expect(spendsSurplus(delegated, base.managedClubId)).toBe(true);
    expect(surplusWageRoom(delegated, base.managedClubId, 2)).toBe(0);
    expect(staffShareCap(managed, base.managedClubId, 'scouts')).toBe(staffShareCap(addCash(base, base.managedClubId, -5), base.managedClubId, 'scouts'));
    // Older careers: no surplus, no room.
    const older = addCash(firstOffseason(world, false), rich, 2);
    expect(clubSurplus(older, rich)).toBe(0);
    expect(anchoredSurplus(older, rich)).toBe(0);
    expect(surplusWageRoom(older, rich, 2)).toBe(0);
    // A club that sold a player buys its replacement keeping the economy balance's season-end cash (unlimited before).
    expect(saleReplacementBudget(older, rich)).toBe(Infinity);
    expect(saleReplacementBudget(flush, careful)).toBeGreaterThan(clubEconomy(flush, careful)!.budget);
    expect(saleReplacementBudget(addCash(base, careful, -5), careful)).toBe(0);
    expect(saleReplacementBudget(flush, rich)).toBeGreaterThanOrEqual(surplusTransferBudget(flush, rich));
  }, 120_000);
});

describe('rich clubs spend part of their surplus over a long career (format 88)', () => {
  /** Five automatic seasons (every club run automatically): season-end cash shares and the money totals each season. */
  function seasons(seed: number, surplusSpending: boolean) {
    const world = moneyWorld();
    let state = delegate(career(world, seed, surplusSpending));
    const ends: { clubId: string; band: string; share: number; unpaid: number; payroll: number }[][] = [];
    let transfers = 0;
    for (let year = 1; year <= 5; year += 1) {
      while (state.status === 'active') state = advanceSeason(play(state));
      const entries = [...financeLedgerEntries(state.finance)];
      ends.push(fullWorldClubsIn(state, year).map(club => {
        const balance = getFinanceBalance(state.finance, club.id), economy = clubEconomy(state, club.id)!;
        // The money totals balance: every receipt and cost of the club's ledger ends in its cash or its unpaid costs.
        const own = entries.filter(entry => entry.clubId === club.id);
        expect(balance.cash - balance.unpaid).toBe(own.reduce((sum, entry) => sum + entry.amount, 0));
        const payroll = -own.filter(entry => entry.seasonNumber === year && entry.kind === 'payroll').reduce((sum, entry) => sum + entry.amount, 0);
        return { clubId: club.id, band: economy.band, share: balance.cash / economy.budget, unpaid: balance.unpaid, payroll };
      }));
      if (year === 5) break;
      for (let steps = 0; steps < 120 && getMarketStartReason(state); steps += 1) state = advanceMarket(state);
      transfers += state.employment.transfers.filter(transfer => transfer.seasonNumber === year).length;
      state = delegate(rolloverSeason(state));
    }
    return { state, ends, transfers };
  }

  it('lowers the cash rich clubs pile up, keeps every club out of unpaid costs, and saves', () => {
    requireWorldContexts(true);
    try {
      // Seed 12, the economy tests' career seed.
      const spending = seasons(12, true), older = seasons(12, false);
      for (const season of spending.ends) for (const club of season) expect(club.unpaid).toBe(0);
      // Weak clubs stay healthy, as the economy balance made them: every club ends every season with 5% of its budget.
      for (const season of spending.ends) expect(Math.min(...season.map(club => club.share))).toBeGreaterThanOrEqual(0.05);
      // Over five seasons the clubs above the reserve hold less cash than under the older rules, and spend more on wages.
      const total = (run: typeof spending, key: 'share' | 'payroll') => run.ends.slice(1).flat().reduce((sum, club) => sum + club[key], 0);
      expect(total(spending, 'share')).toBeLessThan(total(older, 'share'));
      expect(total(spending, 'payroll')).toBeGreaterThan(total(older, 'payroll'));
      expect(spending.transfers).toBeGreaterThan(older.transfers);
      expect(roundTrip(spending.state)).toEqual(spending.state);
    } finally {
      requireWorldContexts(false);
    }
  }, 900_000);
});
