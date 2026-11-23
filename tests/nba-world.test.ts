import { nbaPayrollTarget } from '../src/world/nba-economy';
import { nbaOwnerCeiling } from '../src/world/nba-owner';
import { NBA_LOWEST_MINIMUM } from '../src/world/nba-cap';
import { describe, expect, it } from 'vitest';
import { nbaCompetition, nbaPack, NBA_CLUB_IDS } from './helpers/nba-pack';
import { economyPack } from './helpers/economy-pack';
import { parseDataPack, type DataPack } from '../src/world/data-pack';
import { careerCompetitions, worldFromPack } from '../src/world/real-world';
import { clubHasAcademy, fixtureRuleset, isNbaClub, NO_LOWER_DIVISION_COUNTRIES, presidentTitle, validateWorld, worldOf } from '../src/world/career-world';
import { NBA_ECONOMY, NBA_MAXIMUM_WAGE } from '../src/world/nba-economy';
import { maxContractWage } from '../src/world/employment-policy';
import { createSeason, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { startingFacilityLevel } from '../src/world/facilities-policy';
import { usesNationalTeams } from '../src/world/national';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';

const SPAIN = { id: 'acb', name: 'Liga Endesa', country: 'Spain', tier: 1 as const, levels: [16, 16, 15, 15, 14, 14, 13, 13, 12, 12, 11, 11, 10, 10, 9, 9, 8, 8] };
async function packFile(pack: DataPack): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(pack)));
  return JSON.stringify({ checksum: [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join(''), pack });
}
const usd = (cents: number) => cents / 100 * NBA_ECONOMY.usdPerEur;

describe('NBA data in the pack (optional groups and arena capacity)', () => {
  it('reads conferences and divisions that divide the clubs, and refuses groups that do not', async () => {
    const pack = nbaPack();
    const parsed = await parseDataPack(await packFile(pack));
    expect(parsed.competitions[0]!.groups).toHaveLength(8);
    expect(parsed.clubs[0]!.capacity).toBe(19156);
    const broken = structuredClone(pack);
    broken.competitions[0]!.groups![2]!.clubIds.pop();
    await expect(parseDataPack(await packFile(broken))).rejects.toThrow(/groups must divide/);
    const overlap = structuredClone(pack);
    overlap.competitions[0]!.groups![0]!.clubIds.push(overlap.competitions[0]!.groups![1]!.clubIds[0]!);
    await expect(parseDataPack(await packFile(overlap))).rejects.toThrow(/groups/);
    const seats = structuredClone(pack);
    seats.clubs[0]!.capacity = 90_000;
    await expect(parseDataPack(await packFile(seats))).rejects.toThrow(/capacity/);
  });

  it('offers the NBA in the career setup like any other league, and nothing when a pack has no USA league', () => {
    expect(careerCompetitions(nbaPack([SPAIN])).map(item => item.id)).toEqual(['acb', 'nba']);
    expect(careerCompetitions(nbaPack([SPAIN]), { nba: false }).map(item => item.id)).toEqual(['acb']);
    expect(careerCompetitions(economyPack([SPAIN])).map(item => item.id)).toEqual(['acb']);
    // A USA league without conferences and divisions is not offered.
    const plain = nbaPack();
    delete plain.competitions[0]!.groups;
    expect(careerCompetitions(plain)).toEqual([]);
  });
});

describe('NBA world builder', () => {
  const world = worldFromPack(nbaPack(), 'nba');

  it('builds the NBA league with its conferences, divisions, ruleset, standings rule and postseason', () => {
    expect(world.nba).toEqual({ model: 'nba-1', leagueId: 'nba', conferences: expect.any(Array), ruleset: 'nba-2026', cap: 'nba-cap-1' });
    expect(world.nba!.conferences.map(conference => [conference.name, conference.divisions.map(division => division.name)])).toEqual([
      ['Eastern Conference', ['Atlantic', 'Central', 'Southeast']], ['Western Conference', ['Northwest', 'Pacific', 'Southwest']]]);
    expect(world.domesticLeagues).toEqual([{ id: 'nba', name: 'NBA', country: 'USA', tier: 1, clubIds: NBA_CLUB_IDS, standingsRule: 'nba-2026', postseason: 'nba-2026-1' }]);
    expect(world.lowerDivisions).toBeUndefined();
    expect(NO_LOWER_DIVISION_COUNTRIES).toContain('USA');
    expect(world.rivalries).toEqual([]);
    expect(world.finances.find(item => item.clubId === 'nba-nyk')!.capacity).toBe(19812);
    expect(NBA_CLUB_IDS.every(id => isNbaClub(world, id) && !clubHasAcademy(world, id) && presidentTitle(world, id) === 'Owner')).toBe(true);
  });

  // NBA step 6 (format 92): each payroll is shaped on the club's published one; money plans on the owner's ceiling.
  it('pays NBA money: payrolls of about $145-215M, the minimum and maximum salaries, revenue that covers them', () => {
    for (const finance of world.finances) {
      const economy = finance.economy!;
      expect(economy.band).toBe('nba');
      const club = world.clubs.find(item => item.id === finance.clubId)!;
      const payroll = club.players.reduce((sum, player) => sum + world.wages[player.id]!, 0);
      expect(usd(payroll)).toBeGreaterThan(140e6);
      expect(usd(payroll)).toBeLessThan(215e6);
      expect(Math.abs(payroll - nbaPayrollTarget(club.name))).toBeLessThan(nbaPayrollTarget(club.name) * 0.01);
      expect(usd(economy.budget)).toBeGreaterThanOrEqual(295e6);
      expect(usd(economy.budget)).toBeLessThanOrEqual(755e6);
      expect(economy.budget).toBeGreaterThan(nbaOwnerCeiling(world, finance.clubId) + economy.operatingCost);
      expect(economy.openingCash).toBeGreaterThan(0);
      const wages = club.players.map(player => world.wages[player.id]!);
      expect(Math.min(...wages)).toBeGreaterThanOrEqual(NBA_LOWEST_MINIMUM);
      expect(Math.max(...wages)).toBeLessThanOrEqual(NBA_MAXIMUM_WAGE);
      expect(usd(Math.max(...wages))).toBeGreaterThan(30e6);
      expect(startingFacilityLevel({ world }, finance.clubId, 'training')).toBeGreaterThanOrEqual(5);
    }
    expect(maxContractWage({ world })).toBe(NBA_MAXIMUM_WAGE);
    // A top EuroLeague payroll is about EUR 25-40M; every NBA payroll is far above it.
    const european = worldFromPack(economyPack([SPAIN]), 'acb');
    const bill = (target: typeof world, clubId: string) => target.clubs.find(item => item.id === clubId)!.players.reduce((sum, player) => sum + target.wages[player.id]!, 0);
    expect(Math.min(...NBA_CLUB_IDS.map(id => bill(world, id)))).toBeGreaterThan(3 * Math.max(...european.clubs.map(club => bill(european, club.id))));
  });

  it('accepts a 30-club league only as the NBA the world names', () => {
    const { nba, ...withoutNba } = world;
    expect(nba).toBeDefined();
    expect(() => validateWorld(withoutNba)).toThrow(/invalid league/);
    const swapped = structuredClone(world);
    swapped.nba!.conferences[0]!.divisions[0]!.clubIds[0] = swapped.nba!.conferences[1]!.divisions[0]!.clubIds[0]!;
    expect(() => validateWorld(swapped)).toThrow(/divide the league/);
    expect(() => validateWorld({ ...world, nba: { ...world.nba!, ruleset: 'fiba-2024' } })).toThrow(/world.nba/);
  });

  it('plays NBA games under the NBA rules and every other game under FIBA\'s, alone or with European leagues', () => {
    const combined = worldFromPack(nbaPack([SPAIN]), ['acb', 'nba']);
    expect(combined.name).toBe('NBA and European leagues 2026-27');
    expect(combined.domesticLeagues!.map(league => league.id)).toEqual(['acb', 'nba']);
    expect(fixtureRuleset({ world: combined }, { homeClubId: 'nba-bos', awayClubId: 'nba-lal' })).toBe('nba-2026');
    expect(fixtureRuleset({ world: combined }, { homeClubId: 'acb-1', awayClubId: 'acb-2' })).toBeUndefined();
    expect(fixtureRuleset({ world: combined }, { homeClubId: 'nba-bos', awayClubId: 'nba-lal', competition: 'other' })).toBeUndefined();
    expect(combined.finances.find(item => item.clubId === 'acb-1')!.economy!.band).not.toBe('nba');
    // The NBA never becomes an unchosen "background" league of a European world.
    const european = worldFromPack(nbaPack([SPAIN]), 'acb');
    expect(european.nba).toBeUndefined();
    expect(european.clubs.some(club => club.id.startsWith('nba-'))).toBe(false);
  });

  it('leaves European worlds exactly as they were when the pack also has the NBA', () => {
    const leagues = [SPAIN, { id: 'feb', name: 'Primera FEB', country: 'Spain', tier: 2 as const, levels: SPAIN.levels }, { id: 'bsl', name: 'Basketbol Süper Ligi', country: 'Turkey', tier: 1 as const, levels: SPAIN.levels.slice(0, 16) }];
    const base = economyPack(leagues, { members: ['acb-1', 'acb-2', 'bsl-1', 'bsl-2'], foreign: [{ id: 'gr-1', country: 'Greece', level: 15 }, { id: 'gr-2', country: 'Greece', level: 14 }] });
    const withNba: DataPack = { ...base, competitions: [...base.competitions, nbaCompetition()], clubs: [...base.clubs, ...nbaPack().clubs], players: [...base.players, ...nbaPack().players] };
    for (const ids of [['acb', 'feb'], ['acb', 'feb', 'bsl'], ['bsl']]) expect(worldFromPack(withNba, ids)).toEqual(worldFromPack(base, ids));
  });
});

describe('NBA careers (new careers only, format 90)', () => {
  const world = worldFromPack(nbaPack(), 'nba');

  it('needs the NBA option, opens without academies or youth coaches at NBA clubs, and refuses formats before 90', () => {
    expect(() => createSeason({ seed: 2, world, managedClubId: 'nba-bos', ...NEW_CAREER_SYSTEMS, nba: false })).toThrow(/NBA/);
    const state = createSeason({ seed: 2, world, managedClubId: 'nba-bos', ...NEW_CAREER_SYSTEMS });
    expect(worldOf(state).nba?.leagueId).toBe('nba');
    expect(state.academy.prospects).toEqual([]);
    expect(state.youth.contracts).toEqual([]);
    expect(state.youthCompetition.seasons[0]!.fixtures).toEqual([]);
    expect(usesNationalTeams(world)).toBe(false);
    expect(state.national).toBeUndefined();
    expect(state.fixtures).toHaveLength(1230);
    expect(parseSeason(serializeSeason(state)).fixtures).toHaveLength(1230);
    const envelope = JSON.parse(serializeSeason(state));
    envelope.formatVersion = 88; envelope.state.schemaVersion = 88;
    expect(() => parseSeason(JSON.stringify(envelope))).toThrow(/format 90/);
  });
});
