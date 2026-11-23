import { describe, expect, it } from 'vitest';
import { nbaPack, NBA_CLUB_IDS } from './helpers/nba-pack';
import { worldFromPack } from '../src/world/real-world';
import { createSeason, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { centsToUsd, NBA_FIRST_APRON, NBA_LOWEST_MINIMUM, NBA_MID_LEVEL, NBA_SALARY_CAP, NBA_TAX_LINE, NBA_TAXPAYER_MID_LEVEL, nbaLuxuryTax, nbaMaximumWage, nbaMinimumWage, nbaSigningRoute, nbaTaxShare, usdToCents } from '../src/world/nba-cap';
import { nbaDeadMoney, nbaMidLevelUsed, nbaOwnerCeiling, nbaOwnerCeilingLevel, nbaPayroll, nbaSigningCheck, nbaTaxBills } from '../src/world/nba-cap-policy';
import { clubRosterLimit, clubSalaryBudget, isCapClub, minRosterSize } from '../src/world/club-roster-policy';
import { contractAskingWage } from '../src/world/contract-roles';
import { getCareerPlayerAge } from '../src/world/player-catalog';
import { NBA_PAYROLLS_2026_27 } from '../src/data/nba-payrolls';
import { nbaPayrollTarget, nbaRevenueEuros, nbaSquadWages } from '../src/world/nba-economy';

/** NBA step 6 (format 92): the salary cap's figures, signing routes, minimum and maximum contracts and the luxury tax. */
const M = (usd: number) => usdToCents(usd * 1e6);
const SPAIN = { id: 'acb', name: 'Liga Endesa', country: 'Spain', tier: 1 as const, levels: [16, 16, 15, 15, 14, 14, 13, 13, 12, 12, 11, 11, 10, 10, 9, 9, 8, 8] };

describe('the NBA salary cap figures', () => {
  it('uses the 2026-27 cap, tax line, apron and exceptions at the game rate of 1.16 dollars per euro', () => {
    expect(Math.round(centsToUsd(NBA_SALARY_CAP))).toBe(164_961_000);
    expect(Math.round(centsToUsd(NBA_TAX_LINE))).toBe(200_428_000);
    expect(Math.round(centsToUsd(NBA_FIRST_APRON))).toBe(209_015_000);
    expect(Math.round(centsToUsd(NBA_MID_LEVEL))).toBe(15_044_000);
    expect(Math.round(centsToUsd(NBA_TAXPAYER_MID_LEVEL))).toBe(6_064_000);
  });

  it('sets minimum salaries by experience and maximum contracts at 25, 30 and 35% of the cap by age', () => {
    expect(nbaMinimumWage(20)).toBe(NBA_LOWEST_MINIMUM);
    expect(centsToUsd(NBA_LOWEST_MINIMUM)).toBeGreaterThan(1.3e6);
    expect(nbaMinimumWage(31)).toBeGreaterThan(nbaMinimumWage(25));
    expect(nbaMinimumWage(40)).toBe(nbaMinimumWage(31));
    expect(nbaMaximumWage(24) / NBA_SALARY_CAP).toBeCloseTo(0.25, 3);
    expect(nbaMaximumWage(25) / NBA_SALARY_CAP).toBeCloseTo(0.30, 3);
    expect(nbaMaximumWage(28) / NBA_SALARY_CAP).toBeCloseTo(0.30, 3);
    expect(nbaMaximumWage(29) / NBA_SALARY_CAP).toBeCloseTo(0.35, 3);
    for (const wage of [nbaMinimumWage(25), nbaMaximumWage(30)]) expect(wage % 50_000).toBe(0);
  });

  it('charges the luxury tax per $5M bracket: 1.5, 1.75, 2.5, 3.25, then 0.5 more per bracket', () => {
    expect(nbaLuxuryTax(NBA_TAX_LINE)).toBe(0);
    expect(nbaLuxuryTax(NBA_TAX_LINE - 100)).toBe(0);
    const tax = (overUsdM: number) => centsToUsd(nbaLuxuryTax(NBA_TAX_LINE + M(overUsdM))) / 1e6;
    expect(tax(5)).toBeCloseTo(7.5, 3);
    expect(tax(12)).toBeCloseTo(7.5 + 8.75 + 5, 3);
    expect(tax(20)).toBeCloseTo(7.5 + 8.75 + 12.5 + 16.25, 3);
    expect(tax(25)).toBeCloseTo(7.5 + 8.75 + 12.5 + 16.25 + 18.75, 3);
    expect(tax(30)).toBeCloseTo(7.5 + 8.75 + 12.5 + 16.25 + 18.75 + 21.25, 3);
  });

  it('shares the tax equally among the clubs that paid none, keeping only what cannot be split', () => {
    expect(nbaTaxShare(1_000_001, 4)).toBe(250_000);
    expect(nbaTaxShare(500, 0)).toBe(0);
  });
});

describe('the signing routes', () => {
  const base = { minimum: nbaMinimumWage(26), ownPlayer: false, midLevelUsed: false };
  it('allows room under the cap, minimum contracts, own players and the mid-level exception, in that order', () => {
    expect(nbaSigningRoute({ ...base, payrollBefore: NBA_SALARY_CAP - M(20), seasonWage: M(20) })).toBe('room');
    expect(nbaSigningRoute({ ...base, payrollBefore: NBA_SALARY_CAP, seasonWage: base.minimum })).toBe('minimum');
    expect(nbaSigningRoute({ ...base, ownPlayer: true, payrollBefore: NBA_TAX_LINE, seasonWage: M(40) })).toBe('bird');
    expect(nbaSigningRoute({ ...base, payrollBefore: NBA_SALARY_CAP + M(10), seasonWage: NBA_MID_LEVEL })).toBe('mle');
    // Above the first apron after the signing only the taxpayer amount is allowed.
    expect(nbaSigningRoute({ ...base, payrollBefore: NBA_FIRST_APRON, seasonWage: NBA_MID_LEVEL })).toBeNull();
    expect(nbaSigningRoute({ ...base, payrollBefore: NBA_FIRST_APRON, seasonWage: NBA_TAXPAYER_MID_LEVEL })).toBe('mle');
    // One mid-level exception a season.
    expect(nbaSigningRoute({ ...base, midLevelUsed: true, payrollBefore: NBA_SALARY_CAP + M(10), seasonWage: M(5) })).toBeNull();
    expect(nbaSigningRoute({ ...base, payrollBefore: NBA_SALARY_CAP + M(10), seasonWage: NBA_MID_LEVEL + 50_000 })).toBeNull();
  });
});

describe('the cap guards in an NBA world', () => {
  const world = worldFromPack(nbaPack([SPAIN]), ['acb', 'nba']);
  const state = createSeason({ seed: 3, world, managedClubId: 'nba-bos', ...NEW_CAREER_SYSTEMS });
  const club = 'nba-bos', own = state.clubs.find(item => item.id === club)!.players[0]!.id, other = state.clubs.find(item => item.id === 'nba-nyk')!.players[3]!.id;

  it('applies rosters of 13-15 and the owner ceiling to NBA clubs only', () => {
    expect(world.nba?.cap).toBe('nba-cap-1');
    expect(isCapClub(state, club)).toBe(true);
    expect(isCapClub(state, 'acb-1')).toBe(false);
    expect([minRosterSize(state, club), clubRosterLimit(state, club)]).toEqual([13, 15]);
    expect(minRosterSize(state, 'acb-1')).toBe(8);
    expect(clubRosterLimit(state, 'acb-1')).toBe(clubRosterLimit(state));
    expect(clubSalaryBudget(state, club, 1)).toBe(nbaOwnerCeiling(world, club));
    const levels = new Set(NBA_CLUB_IDS.map(id => nbaOwnerCeilingLevel(world, id)));
    expect(levels.size).toBeGreaterThan(1);
    for (const id of NBA_CLUB_IDS) expect(nbaOwnerCeiling(world, id)).toBeLessThanOrEqual(NBA_FIRST_APRON);
  });

  it('estimates NBA payrolls far above Europe, near each club\'s published payroll, with every salary within its limits', () => {
    const payrolls = NBA_CLUB_IDS.map(id => nbaPayroll(state, id, 1));
    for (const [index, id] of NBA_CLUB_IDS.entries()) {
      const name = world.clubs.find(item => item.id === id)!.name, target = nbaPayrollTarget(name);
      expect(Math.abs(payrolls[index]! - target)).toBeLessThan(target * 0.01);
      for (const player of state.clubs.find(item => item.id === id)!.players) {
        const age = getCareerPlayerAge(state, player.id, '2026-10-01');
        expect(world.wages[player.id]!).toBeGreaterThanOrEqual(nbaMinimumWage(age));
        expect(world.wages[player.id]!).toBeLessThanOrEqual(nbaMaximumWage(age));
      }
    }
    expect(Math.min(...payrolls)).toBeGreaterThan(M(140));
    const spanish = state.clubs.filter(item => item.id.startsWith('acb-')).map(item => item.players.reduce((sum, player) => sum + world.wages[player.id]!, 0));
    expect(Math.max(...spanish) * 3).toBeLessThan(Math.min(...payrolls));
    // Stars far above role players.
    const wages = state.clubs.find(item => item.id === club)!.players.map(player => world.wages[player.id]!).sort((a, b) => b - a);
    expect(wages[0]! / wages.at(-1)!).toBeGreaterThan(10);
    // Revenue by market: the biggest markets earn about $750M, the smallest about $300-350M.
    expect(centsToUsd(nbaRevenueEuros('New York Knicks') * 100)).toBeCloseTo(750e6, -6);
    expect(centsToUsd(nbaRevenueEuros('Memphis Grizzlies') * 100)).toBeLessThan(360e6);
    expect(NBA_PAYROLLS_2026_27).toHaveLength(30);
    expect(Object.values(nbaSquadWages([], M(100), () => 25))).toEqual([]);
  });

  it('checks the wage limits and the route of one signing, and keeps the mid-level exception to one a season', () => {
    const at = { ...state, date: '2027-07-01' };
    const minimum = nbaMinimumWage(getCareerPlayerAge(state, other, at.date));
    const over = NBA_SALARY_CAP + M(5);
    expect(nbaSigningCheck(at, { clubId: club, playerId: other, seasonWage: minimum - 50_000, seasonNumber: 2, payrollBefore: 0 }).reason).toMatch(/minimum salary/);
    expect(nbaSigningCheck(at, { clubId: club, playerId: other, seasonWage: NBA_FIRST_APRON, seasonNumber: 2, payrollBefore: 0 }).reason).toMatch(/maximum contract/);
    expect(nbaSigningCheck(at, { clubId: club, playerId: other, seasonWage: M(10), seasonNumber: 2, payrollBefore: M(100) }).route).toBe('room');
    expect(nbaSigningCheck(at, { clubId: club, playerId: other, seasonWage: minimum, seasonNumber: 2, payrollBefore: over }).route).toBe('minimum');
    expect(nbaSigningCheck(at, { clubId: club, playerId: own, seasonWage: M(30), seasonNumber: 2, payrollBefore: over }).route).toBe('bird');
    expect(nbaSigningCheck(at, { clubId: club, playerId: other, seasonWage: M(10), seasonNumber: 2, payrollBefore: over }).route).toBe('mle');
    expect(nbaSigningCheck(at, { clubId: club, playerId: other, seasonWage: M(10), seasonNumber: 2, payrollBefore: over, inSeason: true }).route).toBeNull();
    // Once a contract has used the exception for that season, it is gone.
    const used = { ...at, employment: { ...at.employment, contracts: [...at.employment.contracts, { id: 'x', playerId: other, clubId: club, startsSeason: 2, startsRound: 1, endsSeason: 2, seasonWage: M(10), signedSeason: 1, signedRound: 1, kind: 'free-agent' as const, capRoute: 'mle' as const }] } };
    expect(nbaMidLevelUsed(used, club, 2)).toBe(true);
    expect(nbaMidLevelUsed(used, club, 3)).toBe(false);
    expect(nbaSigningCheck(used, { clubId: club, playerId: other, seasonWage: M(10), seasonNumber: 2, payrollBefore: over }).reason).toMatch(/already used/);
  });

  it('counts released salary against the cap and asks NBA clubs at least the minimum', () => {
    const contract = state.employment.contracts.find(item => item.clubId === club)!;
    const released = { ...state, employment: { ...state.employment, buyouts: [{ id: 'employment-buyout-1', playerId: contract.playerId, clubId: club, seasonNumber: 1, completedOn: '2027-07-01', startsSeason: 1, amount: contract.seasonWage, releasedContractIds: [contract.id], contractCountBefore: 0, negotiationCountBefore: 0 }] } };
    expect(nbaDeadMoney(released.employment, club, 1)).toBe(contract.seasonWage);
    expect(nbaPayroll(released, club, 1)).toBe(nbaPayroll(state, club, 1));
    const european = state.clubs.find(item => item.id === 'acb-3')!.players[10]!.id;
    expect(contractAskingWage({ ...state, date: '2027-07-01' }, club, european)).toBeGreaterThanOrEqual(NBA_LOWEST_MINIMUM);
    expect(contractAskingWage({ ...state, date: '2027-07-01' }, 'acb-1', european)).toBeLessThan(NBA_LOWEST_MINIMUM);
  });

  it('bills the tax on each club\'s payroll above the line and shares it among the others', () => {
    const { bills, total, share, receivers } = nbaTaxBills(state, 1);
    expect(bills).toHaveLength(30);
    expect(total).toBe(bills.reduce((sum, bill) => sum + nbaLuxuryTax(bill.payroll), 0));
    const payers = bills.filter(bill => bill.tax > 0).length;
    expect(payers).toBeGreaterThanOrEqual(3);
    expect(payers).toBeLessThanOrEqual(8);
    expect(receivers).toHaveLength(30 - payers);
    expect(share * receivers.length).toBeLessThanOrEqual(total);
  });
});
