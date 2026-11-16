import { describe, expect, it } from 'vitest';
import type { CareerWorld, ClubEconomy, SeasonEconomy } from '../src/domain/world';
import type { DomesticDivisions, SeasonArchive, SeasonEurope, SeasonState } from '../src/domain/season';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ClubMoneyPanel } from '../src/ui/ClubMoneyPanel';
import { clubEconomy, computeEconomySeasons, economyChange, REAL_ECONOMY_RULES, salaryBudgetRatio, withRealEconomy } from '../src/world/economy';
import { fullWorldClubs, seasonRounds } from '../src/world/career-world';
import { createRosterSnapshots } from '../src/world/rosters';
import { createBackground } from '../src/world/background';
import { openingDivisions } from '../src/world/divisions';
import { openingEurope } from '../src/world/european-places';
import { annualFundingFor, annualSponsorshipFor, defaultTicketPriceFor, maxTicketPriceFor, openingCashFor, roundOperatingCostFor } from '../src/world/finance';
import { clubSalaryBudget } from '../src/world/club-roster-policy';
import { staffFee, staffScale } from '../src/world/economy';
import { sponsorshipReferenceFee } from '../src/world/commercial-policy';
import { createSeason, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { DEVELOPMENT_WORLD } from '../src/data/development-world';
// @ts-expect-error JavaScript test helper without types
import { placesWorld } from './helpers/europe-worlds';

/**
 * Testland's two divisions (six and five clubs, test postseasons), a EuroLeague and a EuroCup, an unchosen Otherland
 * league and clubs outside: with researched money (format 62). Seasons are built from recorded divisions and places
 * without simulating, so each rule is checked on its own.
 */
const world = withRealEconomy(placesWorld() as CareerWorld);
const first = world.domesticLeagues![0]!.clubIds, second = world.domesticLeagues![1]!.clubIds;
const euroleague = world.europeanCompetitions!.find(item => item.kind === 'euroleague')!, eurocup = world.europeanCompetitions!.find(item => item.kind === 'eurocup')!;
const opening = (clubId: string, from: CareerWorld = world) => from.finances.find(item => item.clubId === clubId)!.economy!;

/** A season's divisions after the first division's last two and the second division's first two change places. */
function moved(divisions: DomesticDivisions, up: readonly string[], down: readonly string[]): DomesticDivisions {
  return { ...divisions, leagues: divisions.leagues.map(league => league.id === 'first' ? { id: league.id, clubIds: [...league.clubIds.filter(id => !down.includes(id)), ...up] } : { id: league.id, clubIds: [...league.clubIds.filter(id => !up.includes(id)), ...down] }) };
}
const relegated = [first[4]!, first[5]!], promoted = [second[0]!, second[1]!];
/** The EuroCup's first Testland club takes a EuroLeague place from an Otherland club. */
function placesAfter(europe: SeasonEurope): SeasonEurope {
  const leaving = euroleague.clubIds[2]!, entering = eurocup.clubIds[0]!;
  return { ...europe, entrants: europe.entrants.map(entry => entry.competitionId === euroleague.id ? { ...entry, clubIds: [...entry.clubIds.filter(id => id !== leaving), entering] } : { ...entry, clubIds: [...entry.clubIds.filter(id => id !== entering), leaving] }) };
}

/** A career context `seasons` seasons long: the same changes recorded at the end of season one, then unchanged seasons. */
function careerAt(seasonNumber: number, from: CareerWorld = world) {
  const openingDivs = openingDivisions(from)!, openingPlaces = openingEurope(from);
  const divisions = moved(openingDivs, promoted, relegated), europe = placesAfter(openingPlaces);
  const history: SeasonArchive[] = Array.from({ length: seasonNumber - 1 }, (_, index) => ({ seasonNumber: index + 1, fixtures: [], rosters: createRosterSnapshots(fullWorldClubs(from), index + 1), divisions: index === 0 ? openingDivs : divisions, europe: index === 0 ? openingPlaces : europe }));
  const context = { world: from, seasonNumber, history, divisions, europe, background: createBackground() };
  const economySeasons: SeasonEconomy = { model: 'economy-seasons-1', seasons: computeEconomySeasons(context) };
  return { ...context, economySeasons };
}

const gap = (from: number, to: number) => to - from;

describe('club money follows promotion, relegation and European places (format 72)', () => {
  const two = careerAt(2), table = two.economySeasons.seasons[0]!;

  it('records one table for each season after the first, for every full-world club', () => {
    expect(two.economySeasons.seasons.map(item => item.seasonNumber)).toEqual([2]);
    expect(Object.keys(table.clubs).sort()).toEqual(fullWorldClubs(world).map(club => club.id).sort());
    expect(careerAt(4).economySeasons.seasons.map(item => item.seasonNumber)).toEqual([2, 3, 4]);
  });

  it('moves a promoted club halfway towards the higher band: budget, sponsorship and ticket price rise', () => {
    for (const clubId of promoted) {
      const before = opening(clubId), after = table.clubs[clubId]!;
      expect(before.band).toBe('second');
      expect(after.band.startsWith('top')).toBe(true);
      expect(after.reasons).toEqual(['promoted']);
      expect(after.budget).toBeGreaterThan(before.budget);
      expect(after.sponsorship).toBeGreaterThan(before.sponsorship);
      expect(after.ticketPrice).toBeGreaterThan(before.ticketPrice);
      // Half the gap to the target, rounded on the change (EUR 10,000 steps for budgets).
      expect(Math.abs(gap(before.budget, after.budget) - gap(before.budget, after.target) * REAL_ECONOMY_RULES.seasons.share)).toBeLessThanOrEqual(500_000);
      expect(after.target).toBeGreaterThan(after.budget);
    }
  });

  it('moves a relegated club down, never above last season, and only part of the way', () => {
    for (const clubId of relegated) {
      const before = opening(clubId), after = table.clubs[clubId]!;
      expect(before.band.startsWith('top')).toBe(true);
      expect(after.band).toBe('second');
      expect(after.reasons).toEqual(['relegated']);
      expect(after.budget).toBeLessThan(before.budget);
      expect(after.budget).toBeGreaterThan(after.target);
      expect(after.sponsorship).toBeLessThan(before.sponsorship);
      expect(after.ticketPrice).toBeLessThan(before.ticketPrice);
      expect(after.playerBill).toBeLessThan(Math.round(before.budget * REAL_ECONOMY_RULES.wageShare[before.band] / 100 * (100 - REAL_ECONOMY_RULES.headCoachPercent) / 100));
    }
  });

  it('names a European competition entered or left', () => {
    const entering = eurocup.clubIds[0]!, after = table.clubs[entering]!;
    expect(after.reasons).toEqual(['left-eurocup', 'joined-euroleague']);
    expect(after.band.startsWith('euroleague')).toBe(true);
    expect(after.budget).toBeGreaterThan(opening(entering).budget);
  });

  it('keeps an unchanged club\'s figures exactly', () => {
    const stays = first[3]!;
    expect(opening(stays).band).toBe(table.clubs[stays]!.band);
    const { playerBill: _bill, target, reasons, ...figures } = table.clubs[stays]!;
    expect(figures).toEqual(opening(stays));
    expect([target, reasons]).toEqual([opening(stays).budget, []]);
  });

  it('closes half the remaining gap each season', () => {
    const tables = careerAt(4).economySeasons.seasons;
    for (const clubId of [...promoted, ...relegated]) {
      const target = tables[2]!.clubs[clubId]!.target, budgets = [opening(clubId).budget, ...tables.map(item => item.clubs[clubId]!.budget)];
      const gaps = budgets.map(budget => Math.abs(target - budget));
      for (let index = 1; index < gaps.length; index += 1) expect(Math.abs(gaps[index]! - gaps[index - 1]! / 2)).toBeLessThanOrEqual(500_000);
      // Later seasons repeat the same target (same band, same squads), without reasons.
      expect(tables[2]!.clubs[clubId]!.reasons).toEqual([]);
    }
  });

  it('keeps a published budget while the club stays in its band, and leaves it after relegation', () => {
    const named = withRealEconomy({ ...(placesWorld() as CareerWorld), clubs: (placesWorld() as CareerWorld).clubs.map(club => club.id === first[0] ? { ...club, name: 'Real Madrid' } : club.id === relegated[1] ? { ...club, name: 'ESSM Le Portel' } : club) });
    expect([opening(first[0]!, named).budget, opening(relegated[1]!, named).budget]).toEqual([60_000_000_00, 3_700_000_00]);
    const tables = careerAt(3, named).economySeasons.seasons;
    expect(tables.map(item => item.clubs[first[0]!]!.budget)).toEqual([60_000_000_00, 60_000_000_00]);
    const leaving = tables.map(item => item.clubs[relegated[1]!]!);
    expect(leaving[0]!.target).toBeLessThanOrEqual(3_700_000_00);
    expect(leaving[1]!.budget).toBeLessThanOrEqual(leaving[0]!.budget);
  });

  it('makes every money helper read the season in question, and the world\'s figures without per-season records', () => {
    const clubId = promoted[0]!, after = table.clubs[clubId]!, before = opening(clubId);
    const season = (seasonNumber: number) => ({ world, seasonNumber, economySeasons: two.economySeasons });
    const read = (context: object) => [annualSponsorshipFor(context, clubId), annualFundingFor(context, clubId), openingCashFor(context, clubId), defaultTicketPriceFor(context, clubId), maxTicketPriceFor(context, clubId), roundOperatingCostFor(context, clubId), staffFee(context, clubId, 1_000_000), sponsorshipReferenceFee(world, clubId, context)];
    const expected = (economy: ClubEconomy) => [economy.sponsorship, economy.funding, economy.openingCash, economy.ticketPrice, economy.ticketPrice * 3, Math.round(economy.operatingCost / seasonRounds({ world })), Math.max(10_000, Math.round(1_000_000 * staffScale(economy.scale) / 1000 / 10_000) * 10_000), economy.sponsorship];
    expect(read(season(2))).toEqual(expected(after));
    expect(read(season(1))).toEqual(expected(before));
    expect(read(season(1))).toEqual(read({ world }));
    expect(read({ world, seasonNumber: 2 })).toEqual(read({ world }));
    expect(read({ world })[0]).toBe(before.sponsorship);
    // A later season without a table reads the latest known figures.
    expect(clubEconomy(season(5), clubId)).toBe(after);
    // The salary budget follows the player wage bill from the figures known when an offer is made.
    expect(salaryBudgetRatio(season(2), clubId, 2)).toBeCloseTo(after.playerBill / Math.round(before.budget * REAL_ECONOMY_RULES.wageShare[before.band] / 100 * (100 - REAL_ECONOMY_RULES.headCoachPercent) / 100), 10);
    expect(clubSalaryBudget(season(2), clubId, 2)).toBeGreaterThan(clubSalaryBudget(season(1), clubId, 2));
    expect(clubSalaryBudget(season(2), clubId, 3, 1)).toBe(clubSalaryBudget({ world, seasonNumber: 1 }, clubId, 1));
    expect(clubSalaryBudget(season(2), relegated[0]!, 2)).toBeLessThan(clubSalaryBudget({ world }, relegated[0]!, 2));
    expect(economyChange(season(2), clubId)).toMatchObject({ band: after.band, budget: after.budget, previous: before, reasons: ['promoted'] });
    expect(economyChange({ world, seasonNumber: 2 }, clubId)).toBeNull();
  });

  it('shows the club\'s money level, budget and change with its reason on Club', () => {
    const view = (clubId: string, context: object) => renderToStaticMarkup(createElement(ClubMoneyPanel, { season: { ...context, managedClubId: clubId } as unknown as SeasonState }));
    const promotedView = view(promoted[0]!, two), after = table.clubs[promoted[0]!]!;
    expect(promotedView).toContain(`data-club-money-budget="${after.budget}"`);
    expect(promotedView).toContain('Promoted');
    expect(promotedView).toContain(`data-club-money-change="${after.budget - opening(promoted[0]!).budget}"`);
    expect(view(relegated[0]!, two)).toContain('Relegated');
    expect(view(eurocup.clubIds[0]!, two)).toContain(`Entered the ${euroleague.name}`);
    expect(view(promoted[0]!, { ...two, seasonNumber: 1, history: [] })).toContain('Opening figures');
    const { economySeasons: _records, ...older } = two;
    expect(view(promoted[0]!, older)).toBe('');
  });

  it('starts new careers of real-data worlds with per-season records, never the development world or careers without finances', () => {
    const career = createSeason({ seed: 4, world, managedClubId: first[0]!, injuryMode: 'standard', ...NEW_CAREER_SYSTEMS });
    expect(career.economySeasons).toEqual({ model: 'economy-seasons-1', seasons: [] });
    expect(createSeason({ seed: 4, world, managedClubId: first[0]!, finance: false, payroll: false }).economySeasons).toBeUndefined();
    expect(createSeason({ seed: 4, managedClubId: DEVELOPMENT_WORLD.clubs[0]!.id, ...NEW_CAREER_SYSTEMS }).economySeasons).toBeUndefined();
  });
});
