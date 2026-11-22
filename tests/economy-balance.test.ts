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
import { clubEconomy, playerBillOf, withRealEconomy } from '../src/world/economy';
import { annualFundingFor, fundingSourceId, getFinanceBalance } from '../src/world/finance';
import { financeLedgerEntries } from '../src/world/finance-ledger';
import { fullWorldClubsIn, requireWorldContexts } from '../src/world/career-world';
import { withLowerDivisions } from '../src/world/lower-division';
import { ECONOMY_BALANCE_RULES, remainingHomeShare, solidarityPayment, usesEconomyBalance } from '../src/world/economy-balance';
import { automaticWageCap } from '../src/world/automatic-wages';
import { remainingSeasonShortfall, upgradeAutomationCushion } from '../src/world/facilities-policy';
import { DEVELOPMENT_WORLD } from '../src/data/development-world';

/** The economy tests' world: one country, two divisions of six and a third division of four, with researched money. */
function moneyWorld(): CareerWorld {
  const base = testWorld(12);
  const playerContracts = Object.fromEntries(base.clubs.flatMap(club => club.players.map((player, index) => [player.id, 1 + (index % 3)])));
  return withRealEconomy(withLowerDivisions({ ...base, id: 'economy-balance-test', rosterModel: 'club-roster-1', playerContracts, domesticLeagues: [
    { id: 'first', name: 'First division', country: 'Testland', tier: 1, clubIds: base.clubs.slice(0, 6).map(club => club.id), postseason: 'test-tier1-1', standingsRule: 'fiba-2026-d' },
    { id: 'second', name: 'Second division', country: 'Testland', tier: 2, clubIds: base.clubs.slice(6).map(club => club.id), postseason: 'test-tier2-2', standingsRule: 'fiba-2026-d' },
  ] }, [{ country: 'Testland', tier: 3, name: 'Third division', clubs: Array.from({ length: 4 }, (_, index) => ({ id: `third-${index + 1}`, name: `Third Club ${index + 1}`, shortName: `TC${index + 1}`, color: '#336699' })) }]));
}
const play = (state: SeasonState) => state.activeMatch ? { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) } : state;
const roundTrip = (state: SeasonState) => parseSeason(serializeSeasonCompact(state));
const career = (world: CareerWorld, seed: number, economyBalance = true) => setEmploymentDelegation(createSeason({ seed, world, managedClubId: world.clubs[0]!.id, ...NEW_CAREER_SYSTEMS, economyBalance }), true);
/** Everything automatic: recruitment, facilities, wage prepayments and sponsorship of the manager's club too. */
const delegate = (state: SeasonState) => state.clubs.some(club => club.id === state.managedClubId) ? setSponsorshipDelegation(setPayrollDelegation(setFacilityDelegation(setEmploymentDelegation(state, true), true), true), true) : state;

describe('the economy balance option (format 87)', () => {
  const world = moneyWorld();

  it('marks new careers of worlds with researched money only, and older formats refuse the marker', () => {
    const state = career(world, 3);
    expect(state.world!.economyBalance).toBe(true);
    expect(usesEconomyBalance(state)).toBe(true);
    expect(career(world, 3, false).world!.economyBalance).toBeUndefined();
    expect(createSeason({ seed: 3, ...NEW_CAREER_SYSTEMS }).world?.economyBalance).toBeUndefined();
    expect(() => createSeason({ seed: 3, world, economyBalance: 'yes' as unknown as boolean })).toThrow(/club money setting/);
    expect(usesEconomyBalance({ world: { ...DEVELOPMENT_WORLD, economyBalance: true } })).toBe(false);
    const envelope = JSON.parse(serializeSeason(state));
    envelope.formatVersion = 86; envelope.state.schemaVersion = 86;
    expect(() => parseSeason(JSON.stringify(envelope))).toThrow(/economyBalance.*format 87/);
  });

  it('pays smaller clubs league solidarity with their season funding, which the strict save check replays', () => {
    const state = career(world, 3), older = career(world, 3, false);
    for (const club of fullWorldClubsIn(state, 1)) {
      const economy = clubEconomy(state, club.id)!, solidarity = solidarityPayment(state, club.id);
      expect(solidarity).toBe(Math.round(economy.budget * ECONOMY_BALANCE_RULES.solidarityPercent[economy.band] / 100 / 10_000) * 10_000);
      expect(annualFundingFor(state, club.id)).toBe(economy.funding + solidarity);
      expect(annualFundingFor(older, club.id)).toBe(economy.funding);
      expect(solidarityPayment(older, club.id)).toBe(0);
      const booked = [...financeLedgerEntries(state.finance)].find(entry => entry.clubId === club.id && entry.sourceId === fundingSourceId(1))?.amount ?? 0;
      expect(booked).toBe(annualFundingFor(state, club.id));
    }
    const bands = new Set(fullWorldClubsIn(state, 1).filter(club => solidarityPayment(state, club.id) > 0).map(club => clubEconomy(state, club.id)!.band));
    expect([...bands].sort()).toEqual(['second', 'top-lower']);
    expect(roundTrip(state)).toEqual(state);
  });

  it('counts the gate still to come by home games left, and caps automatic wages only while cash is low', () => {
    let state = career(world, 3);
    const clubId = world.clubs[3]!.id;
    expect(remainingHomeShare(state, clubId)).toBe(1);
    while (state.status === 'active' && remainingHomeShare(state, clubId) > 0) state = advanceSeason(play(state));
    // Every home game played: no gate is counted for the weeks still to run, so automatic spending keeps more.
    const older = { ...state, world: { ...state.world!, economyBalance: undefined } };
    if (state.status === 'active') {
      expect(remainingSeasonShortfall(state, clubId)).toBeGreaterThanOrEqual(remainingSeasonShortfall(older, clubId));
      expect(upgradeAutomationCushion(state, clubId)).toBeGreaterThanOrEqual(upgradeAutomationCushion(older, clubId));
    }
    const economy = clubEconomy(state, clubId)!, bill = playerBillOf(economy), rules = ECONOMY_BALANCE_RULES.wageCap;
    expect(automaticWageCap(state, clubId, 1, rules.targetCashShare)).toBeNull();
    expect(automaticWageCap(older, clubId, 1, 0)).toBeNull();
    const low = automaticWageCap(state, clubId, 1, 0.05)!;
    expect(low).toBeLessThan(bill * rules.fullShare);
    expect(low).toBeGreaterThan(bill * rules.floorShare);
    expect(automaticWageCap(state, clubId, 1, -1)).toBe(Math.floor(bill * rules.floorShare / 50_000) * 50_000);
  }, 120_000);
});

describe('long careers stay sustainable with the economy balance (format 87)', () => {
  /** Five automatic seasons (every club run automatically): every club's season-end cash share and unpaid costs, and the money totals each season. */
  function seasons(seed: number, economyBalance: boolean) {
    const world = moneyWorld();
    let state = delegate(career(world, seed, economyBalance));
    const ends: { clubId: string; band: string; share: number; unpaid: number }[][] = [];
    for (let year = 1; year <= 5; year += 1) {
      while (state.status === 'active') state = advanceSeason(play(state));
      const entries = [...financeLedgerEntries(state.finance)];
      ends.push(fullWorldClubsIn(state, year).map(club => {
        const balance = getFinanceBalance(state.finance, club.id), economy = clubEconomy(state, club.id)!;
        // The money totals balance: every receipt and cost of the club's ledger ends in its cash or its unpaid costs.
        const total = entries.filter(entry => entry.clubId === club.id).reduce((sum, entry) => sum + entry.amount, 0);
        expect(balance.cash - balance.unpaid).toBe(total);
        return { clubId: club.id, band: economy.band, share: balance.cash / economy.budget, unpaid: balance.unpaid };
      }));
      if (year === 5) break;
      for (let steps = 0; steps < 120 && getMarketStartReason(state); steps += 1) state = advanceMarket(state);
      state = delegate(rolloverSeason(state));
    }
    return { state, ends };
  }

  it('ends five seasons without unpaid costs, with weak clubs holding at least the older rules\' cash share, and saves', () => {
    requireWorldContexts(true);
    try {
      // Seed 12, the economy tests' career seed.
      const balanced = seasons(12, true), older = seasons(12, false);
      for (const season of balanced.ends) for (const club of season) expect(club.unpaid).toBe(0);
      const lowest = (ends: typeof balanced.ends) => ends.map(season => Math.min(...season.map(club => club.share)));
      const smallest = (ends: typeof balanced.ends) => ends.map(season => Math.min(...season.filter(club => club.band === 'second' || club.band === 'top-lower').map(club => club.share)));
      // Weak clubs end every season with at least 5% of their budget in cash, and no worse than under the older rules.
      for (const share of lowest(balanced.ends)) expect(share).toBeGreaterThanOrEqual(0.05);
      const [mine, theirs] = [smallest(balanced.ends), smallest(older.ends)];
      expect(mine.reduce((sum, value) => sum + value, 0)).toBeGreaterThanOrEqual(theirs.reduce((sum, value) => sum + value, 0));
      expect(roundTrip(balanced.state)).toEqual(balanced.state);
    } finally {
      requireWorldContexts(false);
    }
  }, 900_000);
});
