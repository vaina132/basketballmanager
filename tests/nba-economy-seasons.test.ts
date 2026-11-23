import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { nbaPack, NBA_CLUB_IDS } from './helpers/nba-pack';
import { worldFromPack } from '../src/world/real-world';
import { advanceSeason, createSeason, managedSide, NEW_CAREER_SYSTEMS, rolloverSeason } from '../src/world/season';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { setEmploymentDelegation } from '../src/world/employment';
import { advanceMarket } from '../src/world/market';
import { getMarketStartReason } from '../src/world/market-policy';
import { parseSeason, serializeSeasonCompact } from '../src/storage/season-storage';
import { getFinanceBalance } from '../src/world/finance';
import { financeLedgerEntries } from '../src/world/finance-ledger';
import { effectiveContractsForSeason } from '../src/world/employment-policy';
import { nbaPayroll } from '../src/world/nba-cap-policy';
import { centsToUsd, NBA_SALARY_CAP, nbaLuxuryTax } from '../src/world/nba-cap';

/**
 * NBA step 6 (format 91): three automatic seasons of the synthetic NBA under the cap rules: every club keeps 13-15
 * players, no club runs unpaid costs, three to eight clubs pay the luxury tax each season and the tax is shared among
 * the others, every signing above the cap uses a legal route, and the save passes the strict check at each season end.
 */
const play = (state: SeasonState) => advanceSeason(state.activeMatch && state.activeMatch.status !== 'finished' ? { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) } : state);
const usd = (cents: number) => `$${(centsToUsd(cents) / 1e6).toFixed(1)}M`;

interface SeasonReport { season: number; payers: string[]; taxTotal: number; shares: number; unpaid: string[]; rosters: number[]; payrolls: number[]; cash: number[]; strict: boolean }

describe('three automatic NBA seasons under the salary cap', () => {
  const world = worldFromPack(nbaPack(), 'nba');
  const reports: SeasonReport[] = [];
  let finalState: SeasonState;
  beforeAll(() => {
    let state = setEmploymentDelegation(createSeason({ seed: 21, world, managedClubId: 'nba-bos', ...NEW_CAREER_SYSTEMS }), true);
    for (let season = 1; season <= 3; season += 1) {
      const started = performance.now();
      while (state.status === 'active') state = play(state);
      const ledger = [...financeLedgerEntries(state.finance)].filter(entry => entry.seasonNumber === season);
      const taxes = ledger.filter(entry => entry.kind === 'luxury-tax'), shares = ledger.filter(entry => entry.kind === 'tax-share');
      const strict = (() => { parseSeason(serializeSeasonCompact(state)); return true; })();
      reports.push({
        season, payers: taxes.map(entry => entry.clubId), taxTotal: -taxes.reduce((sum, entry) => sum + entry.amount, 0), shares: shares.reduce((sum, entry) => sum + entry.amount, 0),
        unpaid: NBA_CLUB_IDS.filter(club => getFinanceBalance(state.finance, club).unpaid > 0),
        rosters: NBA_CLUB_IDS.map(club => effectiveContractsForSeason(state.employment, season).filter(contract => contract.clubId === club).length),
        payrolls: NBA_CLUB_IDS.map(club => nbaPayroll(state, club, season)),
        cash: NBA_CLUB_IDS.map(club => getFinanceBalance(state.finance, club).cash), strict,
      });
      const report = reports.at(-1)!;
      console.log(`NBA season ${season}: ${((performance.now() - started) / 1000).toFixed(0)} s; tax payers ${report.payers.length} (${usd(report.taxTotal)}, shared ${usd(report.shares)}); unpaid ${report.unpaid.length}; rosters ${Math.min(...report.rosters)}-${Math.max(...report.rosters)}; payroll ${usd(Math.min(...report.payrolls))}-${usd(Math.max(...report.payrolls))}, median ${usd([...report.payrolls].sort((a, b) => a - b)[15]!)}; cash ${usd(Math.min(...report.cash))}-${usd(Math.max(...report.cash))}`);
      if (season === 3) break;
      for (let steps = 0; steps < 200 && getMarketStartReason(state); steps += 1) state = advanceMarket(state);
      parseSeason(serializeSeasonCompact(state));
      state = rolloverSeason(state);
    }
    finalState = state;
  }, 7_200_000);

  it('keeps every NBA club at 13-15 players and out of unpaid costs', () => {
    for (const report of reports) {
      expect(Math.min(...report.rosters)).toBeGreaterThanOrEqual(13);
      expect(Math.max(...report.rosters)).toBeLessThanOrEqual(15);
      expect(report.unpaid).toEqual([]);
    }
  });

  it('charges the luxury tax to three to eight clubs a season and shares it among the others', () => {
    for (const report of reports) {
      expect(report.payers.length).toBeGreaterThanOrEqual(3);
      expect(report.payers.length).toBeLessThanOrEqual(8);
      expect(report.shares).toBeLessThanOrEqual(report.taxTotal);
      expect(report.taxTotal - report.shares).toBeLessThan(30);
    }
  });

  it('signs above the cap only on a legal route, and every save passes the strict check', () => {
    const signed = finalState.employment.contracts.filter(contract => contract.kind !== 'initial' && NBA_CLUB_IDS.includes(contract.clubId));
    expect(signed.length).toBeGreaterThan(30);
    expect(signed.every(contract => contract.capRoute !== undefined)).toBe(true);
    const midLevel = signed.filter(contract => contract.capRoute === 'mle');
    // One mid-level exception per club and season at most.
    expect(new Set(midLevel.map(contract => `${contract.clubId}/${contract.startsSeason}`)).size).toBe(midLevel.length);
    expect(reports.every(report => report.strict)).toBe(true);
    // The tax follows the payroll at the end of the regular season (the strict check recomputes it).
    expect(nbaLuxuryTax(NBA_SALARY_CAP)).toBe(0);
  });
});
