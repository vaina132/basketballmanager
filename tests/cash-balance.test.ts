import { describe, expect, it } from 'vitest';
import type { CareerWorld } from '../src/domain/world';
import type { SeasonState } from '../src/domain/season';
import { testWorld } from './world-fixtures';
import { nbaPack, NBA_CLUB_IDS } from './helpers/nba-pack';
import { worldFromPack } from '../src/world/real-world';
import { advanceSeason, createSeason, managedSide, NEW_CAREER_SYSTEMS, rolloverSeason } from '../src/world/season';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { parseSeason, serializeSeason, serializeSeasonCompact, validateSeasonState } from '../src/storage/season-storage';
import { advanceMarket } from '../src/world/market';
import { getMarketStartReason } from '../src/world/market-policy';
import { setEmploymentDelegation } from '../src/world/employment';
import { setFacilityDelegation } from '../src/world/facilities';
import { setPayrollDelegation } from '../src/world/payroll';
import { setSponsorshipDelegation } from '../src/world/commercial';
import { clubEconomy, withRealEconomy } from '../src/world/economy';
import { annualFundingFor, fundingSourceId, getFinanceBalance } from '../src/world/finance';
import { financeAtLedgerBoundary, financeLedgerCount, financeLedgerEntries } from '../src/world/finance-ledger';
import { fullWorldClubsIn, requireWorldContexts } from '../src/world/career-world';
import { withLowerDivisions } from '../src/world/lower-division';
import { CASH_BALANCE_RULES, cashKeepShare, dividendTakeShare, netsBeforeEachSeason, netsBeforeSeason, ownerDividend, usesCashBalance } from '../src/world/cash-balance';
import { nbaOwnerCeiling } from '../src/world/nba-owner';
import { NBA_ECONOMY, nbaRevenueEuros } from '../src/world/nba-economy';

/**
 * Format 99 (owner decision 24 November 2026, `world.cashBalance`): cash no longer piles up. At each season opening the
 * owner takes back part of a club's cash above what it keeps (from the season funding), with per-club variety from the
 * president; NBA revenue is trimmed so wages are about half of it. Worlds without the marker keep their rules.
 */
const RICH = 'w1-alpine-stags';
/** One country, two divisions of six and a third division of four, with researched money; one club opens with 140% of its budget in cash. */
function moneyWorld(richShare = 1.4): CareerWorld {
  const base = testWorld(12);
  const playerContracts = Object.fromEntries(base.clubs.flatMap(club => club.players.map((player, index) => [player.id, 1 + (index % 3)])));
  const world = withRealEconomy(withLowerDivisions({ ...base, id: 'cash-balance-test', rosterModel: 'club-roster-1', playerContracts, domesticLeagues: [
    { id: 'first', name: 'First division', country: 'Testland', tier: 1, clubIds: base.clubs.slice(0, 6).map(club => club.id), postseason: 'test-tier1-1', standingsRule: 'fiba-2026-d' },
    { id: 'second', name: 'Second division', country: 'Testland', tier: 2, clubIds: base.clubs.slice(6).map(club => club.id), postseason: 'test-tier2-2', standingsRule: 'fiba-2026-d' },
  ] }, [{ country: 'Testland', tier: 3, name: 'Third division', clubs: Array.from({ length: 4 }, (_, index) => ({ id: `third-${index + 1}`, name: `Third Club ${index + 1}`, shortName: `TC${index + 1}`, color: '#336699' })) }]));
  // A test lever: the rich club's opening cash (a world figure, so the save check replays it).
  return { ...world, finances: world.finances.map(item => item.clubId === RICH && item.economy ? { ...item, economy: { ...item.economy, openingCash: Math.round(item.economy.budget * richShare / 10_000) * 10_000 } } : item) };
}
const MANAGED = testWorld(12).clubs[0]!.id;
const withoutMarker = (world: CareerWorld): CareerWorld => { const { cashBalance: _marker, ...rest } = world; return rest as CareerWorld; };
const play = (state: SeasonState) => state.activeMatch ? { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) } : state;
/** Everything automatic: recruitment, facilities, wage prepayments and sponsorship of the manager's club too. */
const delegate = (state: SeasonState) => setSponsorshipDelegation(setPayrollDelegation(setFacilityDelegation(setEmploymentDelegation(state, true), true), true), true);
const roundTrip = (state: SeasonState) => parseSeason(serializeSeasonCompact(state));
/** Season 1 and its offseason played automatically, then the rollover into season 2 (seeded before format 105, whose new names give generated coaches other styles, so without it). */
function secondSeason(cashBalance: boolean): SeasonState {
  let state = delegate(createSeason({ seed: 12, world: moneyWorld(), managedClubId: MANAGED, ...NEW_CAREER_SYSTEMS, cashBalance, generatedPeople: false }));
  while (state.status === 'active') state = advanceSeason(play(state));
  for (let steps = 0; steps < 120 && getMarketStartReason(state); steps += 1) state = advanceMarket(state);
  return rolloverSeason(state);
}
const fundingOf = (state: SeasonState, clubId: string, season: number) => [...financeLedgerEntries(state.finance)].find(entry => entry.clubId === clubId && entry.kind === 'sponsor' && entry.sourceId === fundingSourceId(season))?.amount ?? 0;

describe('the cash balance marker (format 99)', () => {
  const world = moneyWorld();

  it('marks new careers with researched money, and format 98 refuses the marker', () => {
    const state = createSeason({ seed: 5, world, managedClubId: MANAGED, ...NEW_CAREER_SYSTEMS });
    expect(state.world!.cashBalance).toBe(true);
    expect(usesCashBalance(state)).toBe(true);
    expect(createSeason({ seed: 5, world, managedClubId: MANAGED, ...NEW_CAREER_SYSTEMS, cashBalance: false, squadRefresh: false, playerDevelopment: false, managerOfferWithdrawal: false, nbaFreeAgency: false, generatedPeople: false }).world!.cashBalance).toBeUndefined();
    expect(createSeason({ seed: 5, ...NEW_CAREER_SYSTEMS }).world?.cashBalance).toBeUndefined();
    expect(() => createSeason({ seed: 5, world, cashBalance: 'yes' as unknown as boolean })).toThrow(/cash balance setting/);
    const envelope = JSON.parse(serializeSeason(state));
    envelope.formatVersion = 98; envelope.state.schemaVersion = 98;
    expect(() => parseSeason(JSON.stringify(envelope))).toThrow(/cashBalance.*format 99/);
    const older = JSON.parse(serializeSeason(createSeason({ seed: 5, world, managedClubId: MANAGED, ...NEW_CAREER_SYSTEMS, cashBalance: false, squadRefresh: false, playerDevelopment: false, managerOfferWithdrawal: false, nbaFreeAgency: false, generatedPeople: false, positionProfiles: false })));
    older.formatVersion = 98; older.state.schemaVersion = 98;
    expect(parseSeason(JSON.stringify(older)).world!.cashBalance).toBeUndefined();
    const bad = JSON.parse(serializeSeason(state));
    bad.state.world.cashBalance = 'yes';
    expect(() => parseSeason(JSON.stringify(bad))).toThrow(/cashBalance/);
  });
});

describe('the owner\'s dividend (format 99)', () => {
  const world = { ...moneyWorld(), cashBalance: true as const };
  const withTraits = (generosity: 1 | 2 | 3 | 4 | 5, ambition: 1 | 2 | 3 | 4 | 5): CareerWorld => ({ ...world, presidents: world.presidents.map(president => president.clubId === RICH ? { ...president, generosity, traits: { ...president.traits!, ambition } } : president) });

  it('keeps more for an ambitious owner and takes less for a generous one', () => {
    expect(cashKeepShare(withTraits(3, 1), RICH, false)).toBeCloseTo(0.75);
    expect(cashKeepShare(withTraits(3, 5), RICH, false)).toBeCloseTo(1.25);
    expect(cashKeepShare(withTraits(3, 3), RICH, true)).toBeCloseTo(0.375);
    expect(dividendTakeShare(withTraits(1, 3), RICH)).toBeCloseTo(1);
    expect(dividendTakeShare(withTraits(5, 3), RICH)).toBeCloseTo(0.5);
  });

  it('takes the share of the excess above the kept cash, in EUR 100 steps, at most the funding, never in season 1', () => {
    const traits = withTraits(3, 3), context = { world: traits, seasonNumber: 2 };
    const budget = clubEconomy(context, RICH)!.budget, keep = Math.round(budget * cashKeepShare(traits, RICH, false));
    const funding = 10 * budget;
    expect(ownerDividend(context, RICH, keep, funding)).toBe(0);
    expect(ownerDividend(context, RICH, keep + 1_000_000, funding)).toBe(Math.floor(1_000_000 * 0.75 / CASH_BALANCE_RULES.step) * CASH_BALANCE_RULES.step);
    expect(ownerDividend(context, RICH, keep + budget * 4, budget)).toBe(budget);
    expect(ownerDividend({ ...context, seasonNumber: 1 }, RICH, keep * 3, funding)).toBe(0);
    expect(ownerDividend({ world: withoutMarker(traits), seasonNumber: 2 }, RICH, keep * 3, funding)).toBe(0);
    expect(ownerDividend(context, RICH, undefined, funding)).toBe(0);
  });

  it('reads each club\'s net before a season opening from the ledger, as the save check does in one pass', () => {
    const ledger = [
      { clubId: 'a', seasonNumber: 1, amount: 500 }, { clubId: 'b', seasonNumber: 1, amount: 200 },
      { clubId: 'a', seasonNumber: 2, amount: -100 }, { clubId: 'a', seasonNumber: 4, amount: 50 },
    ];
    const all = netsBeforeEachSeason(ledger);
    expect([...all.keys()]).toEqual([2, 3, 4, 5]);
    expect(Object.fromEntries(all.get(2)!)).toEqual({ a: 500, b: 200 });
    expect(Object.fromEntries(all.get(4)!)).toEqual({ a: 400, b: 200 });
    expect(Object.fromEntries(all.get(5)!)).toEqual({ a: 450, b: 200 });
    for (const season of [2, 3, 4, 5]) expect(netsBeforeSeason({ ledger: ledger as never }, season)).toEqual(all.get(season));
  });

  it('takes a dividend from the rich club\'s season-2 funding only, saves strictly, and format 98 pays the full funding', () => {
    requireWorldContexts(true);
    try {
      const balanced = secondSeason(true), older = secondSeason(false);
      const nets = netsBeforeSeason(balanced.finance, 2);
      let paid = 0;
      for (const club of fullWorldClubsIn(balanced, 2)) {
        const annual = annualFundingFor(balanced, club.id), dividend = ownerDividend(balanced, club.id, nets.get(club.id), annual);
        expect(fundingOf(balanced, club.id, 2)).toBe(annual - dividend);
        if (dividend > 0) paid += 1;
        // The club keeps at least its kept share of the budget after the opening.
        if (dividend > 0) expect(nets.get(club.id)! - dividend).toBeGreaterThanOrEqual(Math.round(clubEconomy(balanced, club.id)!.budget * cashKeepShare(balanced.world!, club.id, false)));
      }
      const richDividend = annualFundingFor(balanced, RICH) - fundingOf(balanced, RICH, 2);
      expect(richDividend).toBeGreaterThan(0);
      expect(fundingOf(balanced, RICH, 2)).toBeGreaterThan(0);
      expect(paid).toBe(1);
      // Without the marker the rich club receives its whole funding.
      expect(fundingOf(older, RICH, 2)).toBe(annualFundingFor(older, RICH));
      expect(getFinanceBalance(balanced.finance, RICH).cash).toBeLessThan(getFinanceBalance(older.finance, RICH).cash);
      expect(roundTrip(balanced)).toEqual(balanced);
      expect(roundTrip(older)).toEqual(older);
      // A tampered funding amount is refused by the save check.
      const damaged = structuredClone(balanced);
      damaged.finance = financeAtLedgerBoundary(damaged.finance, financeLedgerCount(damaged.finance));
      validateSeasonState(damaged);
      damaged.finance.ledger.find(item => item.clubId === RICH && item.sourceId === fundingSourceId(2))!.amount += richDividend;
      expect(() => validateSeasonState(damaged)).toThrow(/required financial event/);
    } finally {
      requireWorldContexts(false);
    }
  }, 900_000);
});

describe('NBA revenue (format 99)', () => {
  const world = worldFromPack(nbaPack(), 'nba');

  it('opens NBA clubs on the trimmed revenue range, with the same payroll ceiling, and leaves format 98 worlds alone', () => {
    const state = createSeason({ seed: 7, world, managedClubId: NBA_CLUB_IDS[4]!, ...NEW_CAREER_SYSTEMS });
    const older = createSeason({ seed: 7, world, managedClubId: NBA_CLUB_IDS[4]!, ...NEW_CAREER_SYSTEMS, cashBalance: false, squadRefresh: false, playerDevelopment: false, managerOfferWithdrawal: false, nbaFreeAgency: false, generatedPeople: false });
    expect(state.world!.cashBalance).toBe(true);
    const shares: number[] = [];
    for (const clubId of NBA_CLUB_IDS) {
      const now = clubEconomy(state, clubId)!, before = clubEconomy(older, clubId)!;
      const name = world.clubs.find(club => club.id === clubId)!.name;
      expect(before.budget).toBe(Math.round(nbaRevenueEuros(name) / 10_000) * 10_000 * 100);
      expect(now.budget).toBe(Math.round(nbaRevenueEuros(name, true) / 10_000) * 10_000 * 100);
      expect(now.budget).toBeLessThan(before.budget);
      // The expected gate and the ticket price stay; the money balances on the lower revenue.
      expect(now.budget - now.sponsorship - now.funding).toBeGreaterThanOrEqual(before.budget - before.sponsorship - before.funding - 10_000);
      expect(now.ticketPrice).toBe(before.ticketPrice);
      expect(now.operatingCost).toBeLessThan(before.operatingCost);
      shares.push(nbaOwnerCeiling(state.world!, clubId) / now.budget);
    }
    // Player wages at the owner's ceiling are about half of a typical club's revenue (they were about 40%).
    const sorted = [...shares].sort((a, b) => a - b), median = sorted[Math.floor(sorted.length / 2)]!;
    expect(median).toBeGreaterThan(0.42);
    expect(median).toBeLessThan(0.6);
    expect(NBA_ECONOMY.cashBalanceRevenueUsd[1]).toBeLessThan(NBA_ECONOMY.revenueUsd[1]);
    expect(serializeSeason(older)).not.toContain('"cashBalance"');
    expect(parseSeason(serializeSeason(state))).toEqual(state);
  }, 300_000);
});
