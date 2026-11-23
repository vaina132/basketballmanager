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
import { getClubContractSummary, MIN_ROSTER_SIZE } from '../src/world/employment-policy';
import { automaticWageCap, automaticWageCheck, projectedCashShare, wageCapCashShare } from '../src/world/automatic-wages';
import { clubAppetite, clubSurplus, plannedSurplusSpend, spendingAppetite, staffReach, SURPLUS_SPENDING_RULES } from '../src/world/surplus-spending';
import { lastSeasonResult, seasonEndNets, SPENDING_BALANCE_RULES, successNeed, usesSpendingBalance } from '../src/world/spending-balance';
import { ECONOMY_BALANCE_RULES } from '../src/world/economy-balance';
import { staffTargetRating } from '../src/world/staff-levels';
import { coachRatingRange } from '../src/world/coaching';

/** The world with one careful president (generosity and ambition 1). */
function carefulPresident(world: CareerWorld, clubId: string): CareerWorld {
  return { ...world, presidents: world.presidents.map(president => president.clubId === clubId ? { ...president, generosity: 1, traits: { ...president.traits!, ambition: 1 } } : president) };
}
/** The economy tests' world: one country, two divisions of six and a third division of four, with researched money. */
function moneyWorld(): CareerWorld {
  const base = carefulPresident(testWorld(12), 'w1-alpine-stags');
  const playerContracts = Object.fromEntries(base.clubs.flatMap(club => club.players.map((player, index) => [player.id, 1 + (index % 3)])));
  return withRealEconomy(withLowerDivisions({ ...base, id: 'spending-balance-test', rosterModel: 'club-roster-1', playerContracts, domesticLeagues: [
    { id: 'first', name: 'First division', country: 'Testland', tier: 1, clubIds: base.clubs.slice(0, 6).map(club => club.id), postseason: 'test-tier1-1', standingsRule: 'fiba-2026-d' },
    { id: 'second', name: 'Second division', country: 'Testland', tier: 2, clubIds: base.clubs.slice(6).map(club => club.id), postseason: 'test-tier2-2', standingsRule: 'fiba-2026-d' },
  ] }, [{ country: 'Testland', tier: 3, name: 'Third division', clubs: Array.from({ length: 4 }, (_, index) => ({ id: `third-${index + 1}`, name: `Third Club ${index + 1}`, shortName: `TC${index + 1}`, color: '#336699' })) }]));
}
const play = (state: SeasonState) => state.activeMatch ? { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) } : state;
const roundTrip = (state: SeasonState) => parseSeason(serializeSeasonCompact(state));
const career = (world: CareerWorld, seed: number, spendingBalance = true) => createSeason({ seed, world, managedClubId: world.clubs[0]!.id, ...NEW_CAREER_SYSTEMS, spendingBalance });
/** Everything automatic: recruitment, facilities, wage prepayments and sponsorship of the manager's club too. */
const delegate = (state: SeasonState) => state.clubs.some(club => club.id === state.managedClubId) ? setSponsorshipDelegation(setPayrollDelegation(setFacilityDelegation(setEmploymentDelegation(state, true), true), true), true) : state;
/** `share` of a club's budget booked to it in week 1 of season 1 (a test lever: one entry more at the ledger's head). */
function book(state: SeasonState, clubId: string, share: number, kind: 'opening' | 'sponsor' = 'sponsor'): SeasonState {
  const amount = Math.round(clubEconomy(state, clubId)!.budget * share);
  return { ...state, finance: { ...state.finance, ledger: [{ id: `finance-test-${clubId}-${kind}`, clubId, seasonNumber: 1, round: 1, kind, amount, sourceId: 'test', ticket: null, coach: null, payroll: null }, ...state.finance.ledger] } };
}
/** The first season played through, every club run automatically: the offseason that follows it. */
function firstOffseason(world: CareerWorld, spendingBalance = true): SeasonState {
  let state = career(world, 3, spendingBalance);
  while (state.status === 'active') state = advanceSeason(play(state));
  return state;
}
/** The state with one club's results at the latest review of season 1 set to `wins`. */
function withSeasonWins(state: SeasonState, clubId: string, wins: number): SeasonState {
  const reviews = state.board.reviews.map((review, index, all) => index === all.length - 1 ? { ...review, clubs: { ...review.clubs, [clubId]: { ...review.clubs[clubId]!, wins } } } : review);
  return { ...state, board: { ...state.board, reviews } };
}

describe('the spending balance option (format 89)', () => {
  const world = moneyWorld();

  it('marks new careers with surplus spending only, and older formats refuse the marker', () => {
    const state = career(world, 3);
    expect(state.world!.spendingBalance).toBe(true);
    expect(usesSpendingBalance(state)).toBe(true);
    expect(career(world, 3, false).world!.spendingBalance).toBeUndefined();
    expect(createSeason({ seed: 3, world, managedClubId: world.clubs[0]!.id, ...NEW_CAREER_SYSTEMS, surplusSpending: false }).world!.spendingBalance).toBeUndefined();
    expect(createSeason({ seed: 3, ...NEW_CAREER_SYSTEMS }).world?.spendingBalance).toBeUndefined();
    expect(() => createSeason({ seed: 3, world, spendingBalance: 'yes' as unknown as boolean })).toThrow(/spending balance setting/);
    const envelope = JSON.parse(serializeSeason(state));
    envelope.formatVersion = 88; envelope.state.schemaVersion = 88;
    expect(() => parseSeason(JSON.stringify(envelope))).toThrow(/spendingBalance.*format 89/);
    const unbalanced = JSON.parse(serializeSeason(state));
    delete unbalanced.state.world.surplusSpending;
    expect(() => parseSeason(JSON.stringify(unbalanced))).toThrow(/spendingBalance/);
  });

  it('looks one season ahead for the low-cash wage limit, never holding back the eight-player minimum', () => {
    const base = firstOffseason(world), older = firstOffseason(world, false);
    const clubId = fullWorldClubsIn(base, 1).map(club => club.id).find(id => id !== base.managedClubId)!;
    const olderLosingState = () => book(book(older, clubId, 0.6 - projectedCashShare(older, clubId)!, 'opening'), clubId, -0.4);
    const budget = clubEconomy(base, clubId)!.budget;
    // The season's result: its net from the opening cash to the season end (after the last weekly operating costs); a
    // test loss lowers it and the cash alike.
    const result = lastSeasonResult(base, clubId)!;
    expect(result).toBe(seasonEndNets(base, 1).get(clubId)! - [...financeLedgerEntries(base.finance)].filter(entry => entry.clubId === clubId && entry.kind === 'opening').reduce((sum, entry) => sum + entry.amount, 0));
    // Cash at a fifth of the budget, well above the limit's target, after a season that lost 40% of the budget: the
    // limit acts in time.
    const losing = book(book(base, clubId, 0.6 - projectedCashShare(base, clubId)!, 'opening'), clubId, -0.4);
    expect(projectedCashShare(losing, clubId)).toBeCloseTo(0.2, 6);
    expect(lastSeasonResult(losing, clubId)).toBe(result - Math.round(budget * 0.4));
    expect(projectedCashShare(losing, clubId)!).toBeGreaterThan(SPENDING_BALANCE_RULES.wageCapTargetShare);
    expect(wageCapCashShare(losing, clubId)).toBeCloseTo(projectedCashShare(losing, clubId)! + lastSeasonResult(losing, clubId)! / budget, 10);
    const share = wageCapCashShare(losing, clubId)!;
    expect(share).toBeLessThan(SPENDING_BALANCE_RULES.wageCapTargetShare);
    expect(automaticWageCap(losing, clubId, 2)).not.toBeNull();
    // The limit acts from `wageCapTargetShare` of the budget (10% in older careers).
    expect(automaticWageCap(losing, clubId, 2, ECONOMY_BALANCE_RULES.wageCap.targetCashShare)).not.toBeNull();
    expect(automaticWageCap(losing, clubId, 2, SPENDING_BALANCE_RULES.wageCapTargetShare)).toBeNull();
    expect(automaticWageCap(olderLosingState(), clubId, 2, ECONOMY_BALANCE_RULES.wageCap.targetCashShare)).toBeNull();
    // A gain is not counted, and older careers read the season-end projection only.
    const winning = book(book(base, clubId, 0.5, 'opening'), clubId, 0.2);
    expect(wageCapCashShare(winning, clubId)).toBe(projectedCashShare(winning, clubId));
    const olderLosing = olderLosingState();
    expect(wageCapCashShare(olderLosing, clubId)).toBe(projectedCashShare(olderLosing, clubId));
    expect(automaticWageCap(olderLosing, clubId, 2)).toBeNull();
    // The eight-player minimum: a club short of eight players for a season may still sign at any wage.
    const broke = book(base, clubId, -3);
    const short = [2, 3].find(year => { const summary = getClubContractSummary(broke, clubId, year); return summary.rosterSize + summary.reservedRosterSize < MIN_ROSTER_SIZE; })!;
    expect(short).toBeDefined();
    expect(automaticWageCheck(broke, clubId)(budget, 1, short)).toBe(true);
    expect(automaticWageCap(broke, clubId, short)).not.toBeNull();
  }, 120_000);

  it('gives careful clubs a small appetite and lets missed results targets raise squad spending only', () => {
    const base = firstOffseason(world), older = firstOffseason(world, false);
    const careful = 'w1-alpine-stags';
    expect(spendingAppetite(world, careful)).toBe(0);
    const flush = book(base, careful, 2, 'opening'), olderFlush = book(older, careful, 2, 'opening');
    for (const use of ['staff', 'facilities'] as const) expect(clubAppetite(flush, careful, use)).toBe(SPENDING_BALANCE_RULES.minAppetite), expect(clubAppetite(olderFlush, careful, use)).toBe(0);
    expect(plannedSurplusSpend(olderFlush, careful)).toBe(0);
    expect(staffReach(olderFlush, careful)).toBe(0);
    expect(staffReach(flush, careful)).toBe(SPENDING_BALANCE_RULES.minAppetite);
    // A club that met its results target keeps its appetite; one that missed it by `missFull` of its games spends more on its squad.
    const review = base.board.reviews.at(-1)!.clubs[careful]!;
    expect(review.played).toBeGreaterThan(0);
    const met = withSeasonWins(flush, careful, Math.ceil(review.targetPace)), missed = withSeasonWins(flush, careful, 0);
    expect(successNeed(met, careful)).toBe(0);
    expect(successNeed(missed, careful)).toBe(Math.min(1, review.targetPace / review.played / SPENDING_BALANCE_RULES.missFull));
    expect(clubAppetite(met, careful, 'squad')).toBe(SPENDING_BALANCE_RULES.minAppetite);
    expect(clubAppetite(missed, careful, 'squad')).toBeCloseTo(Math.min(1, SPENDING_BALANCE_RULES.minAppetite + SPENDING_BALANCE_RULES.successBoost * successNeed(missed, careful)), 10);
    expect(clubAppetite(missed, careful, 'facilities')).toBe(SPENDING_BALANCE_RULES.minAppetite);
    expect(plannedSurplusSpend(met, careful)).toBe(Math.floor(clubSurplus(met, careful) * SPENDING_BALANCE_RULES.minAppetite * SURPLUS_SPENDING_RULES.seasonSpendShare));
    expect(plannedSurplusSpend(missed, careful)).toBeGreaterThan(plannedSurplusSpend(met, careful));
    expect(successNeed(withSeasonWins(olderFlush, careful, 0), careful)).toBe(0);
    // In season 1 no season has been completed: no need, no result.
    const opening = career(world, 3);
    expect(successNeed(opening, careful)).toBe(0);
    expect(lastSeasonResult(opening, careful)).toBeNull();
  }, 120_000);

  it('lets clubs with a surplus aim at the elite training coaches above the authored range', () => {
    const base = firstOffseason(world), older = firstOffseason(world, false);
    const rich = fullWorldClubsIn(base, 1).map(club => club.id).filter(id => id !== base.managedClubId).sort((left, right) => clubEconomy(base, right)!.budget - clubEconomy(base, left)!.budget)[0]!;
    const flush = book(base, rich, 2, 'opening'), olderFlush = book(older, rich, 2, 'opening');
    const reach = staffReach(flush, rich), range = coachRatingRange();
    expect(reach).toBeGreaterThan(0);
    expect(staffReach(olderFlush, rich)).toBe(reach);
    // The coaches' ladder rises towards the best elite coach (rated 10) by the club's reach; older careers keep the range.
    const aim = staffTargetRating(flush, rich, 'coaches', range), olderAim = staffTargetRating(olderFlush, rich, 'coaches', range);
    const placed = (olderAim - range[0]) / (range[1] - range[0]);
    expect(aim).toBeCloseTo(range[0] + placed * (range[1] + reach * (10 - range[1]) - range[0]), 10);
    expect(aim).toBeGreaterThan(olderAim);
    expect(olderAim).toBeLessThanOrEqual(range[1]);
    // Other roles' best people are within their authored range: the aim is unchanged.
    for (const role of ['scouts', 'fitness', 'physio', 'assistant', 'youth'] as const) expect(staffTargetRating(flush, rich, role, [4, 10])).toBe(staffTargetRating(olderFlush, rich, role, [4, 10]));
  }, 120_000);
});

describe('spending balance over a long career (format 89)', () => {
  /** Five automatic seasons (every club run automatically): season-end cash shares and the money totals each season. */
  function seasons(seed: number, spendingBalance: boolean) {
    const world = moneyWorld();
    let state = delegate(career(world, seed, spendingBalance));
    const ends: { clubId: string; share: number; unpaid: number }[][] = [];
    for (let year = 1; year <= 5; year += 1) {
      while (state.status === 'active') state = advanceSeason(play(state));
      const entries = [...financeLedgerEntries(state.finance)];
      ends.push(fullWorldClubsIn(state, year).map(club => {
        const balance = getFinanceBalance(state.finance, club.id), economy = clubEconomy(state, club.id)!;
        expect(balance.cash - balance.unpaid).toBe(entries.filter(entry => entry.clubId === club.id).reduce((sum, entry) => sum + entry.amount, 0));
        return { clubId: club.id, share: balance.cash / economy.budget, unpaid: balance.unpaid };
      }));
      if (year === 5) break;
      for (let steps = 0; steps < 120 && getMarketStartReason(state); steps += 1) state = advanceMarket(state);
      state = delegate(rolloverSeason(state));
    }
    return { state, ends };
  }

  it('keeps every club out of unpaid costs, lets the careful club spend a little, and saves', () => {
    requireWorldContexts(true);
    try {
      // Seed 12, the economy tests' career seed.
      const balanced = seasons(12, true), older = seasons(12, false);
      for (const season of balanced.ends) for (const club of season) expect(club.unpaid).toBe(0);
      for (const season of balanced.ends) expect(Math.min(...season.map(club => club.share))).toBeGreaterThanOrEqual(0.05);
      // The careful club still keeps money, but less than when it never spent.
      const careful = (run: typeof balanced) => run.ends.slice(1).flatMap(season => season.filter(club => club.clubId === 'w1-alpine-stags').map(club => club.share));
      expect(careful(balanced).reduce((sum, share) => sum + share, 0)).toBeLessThan(careful(older).reduce((sum, share) => sum + share, 0));
      expect(roundTrip(balanced.state)).toEqual(balanced.state);
    } finally {
      requireWorldContexts(false);
    }
  }, 900_000);

  it('plays on identically from a reloaded save', () => {
    let state = delegate(career(moneyWorld(), 12));
    for (let year = 1; year <= 2; year += 1) {
      while (state.status === 'active') state = advanceSeason(play(state));
      for (let steps = 0; steps < 120 && getMarketStartReason(state); steps += 1) state = advanceMarket(state);
      state = delegate(rolloverSeason(state));
    }
    const onward = (from: SeasonState) => {
      let next = from;
      while (next.status === 'active') next = advanceSeason(play(next));
      for (let steps = 0; steps < 120 && getMarketStartReason(next); steps += 1) next = advanceMarket(next);
      return next;
    };
    const live = onward(state), reloaded = onward(roundTrip(state));
    expect(serializeSeasonCompact(reloaded)).toBe(serializeSeasonCompact(live));
  }, 900_000);
});
