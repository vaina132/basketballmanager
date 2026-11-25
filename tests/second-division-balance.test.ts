import { describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import type { SeasonClubEconomy } from '../src/domain/world';
import { economyPack } from './helpers/economy-pack';
import { worldFromPack } from '../src/world/real-world';
import { createSeason, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { validateWorld, worldOf } from '../src/world/career-world';
import { overallRating } from '../src/world/overall-rating';
import { clubEconomy } from '../src/world/economy';
import { contractAskingWage } from '../src/world/contract-roles';
import { evaluateNegotiation, requiredNegotiationWage } from '../src/world/negotiations-policy';
import { nbaValue } from '../src/world/nba-moves';
import { clubSalaryCeiling } from '../src/world/club-roster-policy';
import { seasonSalaryCeiling } from '../src/world/board-consequences';
import { surplusWageCeiling } from '../src/world/surplus-spending';
import { getClubContractSummary } from '../src/world/employment-policy';
import { minimumSquadCeiling, SECOND_DIVISION_RULES, secondDivisionDemand, secondDivisionThreshold, topDivisionWage, usesSecondDivisionBalance } from '../src/world/second-division-balance';

/**
 * Format 109 (decided 25 November 2026 under the owner's delegation, `world.secondDivisionBalance`): a player rated above
 * his country's opening second division asks a lower-division club at least the top-division wage of his level. Ten
 * automatic seasons had filled Primera FEB with academy graduates of top-division level who still asked their academy
 * wage (a few thousand euros), so the second division's median rose from 37 to 66 (Liga ACB 62 to 72).
 */
const ACB = { id: 'acb', name: 'Liga Endesa', country: 'Spain', tier: 1 as const, levels: [14, 14, 13, 13, 13, 12, 12, 12, 11, 11, 11, 10] };
const FEB = { id: 'feb', name: 'Primera FEB', country: 'Spain', tier: 2 as const, levels: [10, 9, 9, 9, 8, 8, 8, 7, 7, 7, 6, 6] };
const world = worldFromPack(economyPack([ACB, FEB]), ['acb', 'feb']);
const topOnly = worldFromPack(economyPack([ACB]), 'acb');
const career = (options: Record<string, unknown> = {}) => createSeason({ seed: 5, world, managedClubId: 'acb-6', ...NEW_CAREER_SYSTEMS, ...options });
const leagueClubs = new Set(world.domesticLeagues!.flatMap(league => league.clubIds));
const players = world.clubs.filter(club => leagueClubs.has(club.id)).flatMap(club => club.players.map(player => ({ id: player.id, clubId: club.id, rating: overallRating(player.attributes, player.position) })));

describe('the second-division balance marker (format 109)', () => {
  it('marks new careers with academy position training, club money and a second division; format 108 refuses it', () => {
    const state = career();
    expect(state.world!.secondDivisionBalance).toBe(true);
    expect(usesSecondDivisionBalance(state)).toBe(true);
    expect(career({ secondDivisionBalance: false }).world!.secondDivisionBalance).toBeUndefined();
    // Needs academy position training (format 108) and a country with both divisions.
    expect(career({ academyPositionTraining: false }).world!.secondDivisionBalance).toBeUndefined();
    expect(createSeason({ seed: 5, world: topOnly, managedClubId: 'acb-6', ...NEW_CAREER_SYSTEMS }).world!.secondDivisionBalance).toBeUndefined();
    expect(createSeason({ seed: 5, ...NEW_CAREER_SYSTEMS }).world?.secondDivisionBalance).toBeUndefined();
    expect(() => career({ secondDivisionBalance: 'yes' })).toThrow(/second-division balance setting/);
    expect(parseSeason(serializeSeason(state)).world!.secondDivisionBalance).toBe(true);
    const envelope = JSON.parse(serializeSeason(state));
    envelope.formatVersion = 108; envelope.state.schemaVersion = 108;
    expect(() => parseSeason(JSON.stringify(envelope))).toThrow(/world\.secondDivisionBalance.*format 109 or later/);
    const older = JSON.parse(serializeSeason(career({ secondDivisionBalance: false })));
    older.formatVersion = 108; older.state.schemaVersion = 108;
    expect(parseSeason(JSON.stringify(older)).world!.secondDivisionBalance).toBeUndefined();
    const marked = worldOf(state);
    expect(() => validateWorld({ ...marked, secondDivisionBalance: 'yes' })).toThrow(/secondDivisionBalance/);
    const { academyPositionTraining: _a, secondDivisionBalance: _s, ...plain } = marked;
    expect(() => validateWorld({ ...plain, secondDivisionBalance: true })).toThrow(/secondDivisionBalance.*academy position training/);
    expect(() => validateWorld({ ...plain, domesticLeagues: plain.domesticLeagues!.filter(league => league.tier === 1), academyPositionTraining: true, secondDivisionBalance: true })).toThrow(/secondDivisionBalance.*second division/);
  }, 120_000);
});

describe('top-division wages for top-division players at lower-division clubs', () => {
  const state = career(), plain = career({ secondDivisionBalance: false });
  const threshold = secondDivisionThreshold(worldOf(state), 'Spain')!;

  it('reads the threshold from the opening second division and the wages from the opening top division', () => {
    const lower = players.filter(player => player.clubId.startsWith('feb-')).map(player => player.rating).sort((a, b) => a - b);
    expect(threshold).toBe(lower[Math.floor(SECOND_DIVISION_RULES.levelQuantile * lower.length)]);
    const top = players.filter(player => player.clubId.startsWith('acb-'));
    for (const player of top) {
      const near = top.filter(other => Math.abs(other.rating - player.rating) <= SECOND_DIVISION_RULES.neighbourhood).map(other => world.wages[other.id]!).sort((a, b) => a - b);
      expect(topDivisionWage(worldOf(state), 'Spain', player.rating)).toBe(Math.ceil(near[Math.floor((near.length - 1) / 2)]! / 50_000) * 50_000);
    }
    expect(topDivisionWage(worldOf(state), 'Italy', 60)).toBeNull();
  });

  it('raises a good player\'s ask from a second-division club only; top-division clubs and older careers are unchanged', () => {
    const good = players.filter(player => nbaValue(state, player.id) > threshold);
    const ordinary = players.filter(player => nbaValue(state, player.id) <= threshold);
    expect(good.length).toBeGreaterThan(20);
    expect(ordinary.length).toBeGreaterThan(20);
    let raised = 0;
    for (const player of good) {
      const floor = topDivisionWage(worldOf(state), 'Spain', nbaValue(state, player.id))!;
      const ask = contractAskingWage(state, 'feb-3', player.id);
      expect(ask).toBe(Math.max(contractAskingWage(plain, 'feb-3', player.id), floor));
      expect(requiredNegotiationWage(player.id, 1, undefined, state, 'rotation', 'feb-3')).toBeGreaterThanOrEqual(floor);
      if (ask > contractAskingWage(plain, 'feb-3', player.id)) raised += 1;
      // The club's own offer at the ask is accepted.
      expect(evaluateNegotiation(player.id, ask, 1, undefined, state, undefined, 'feb-3').outcome).not.toBe('rejected');
    }
    expect(raised).toBeGreaterThan(10);
    for (const player of ordinary) expect(contractAskingWage(state, 'feb-3', player.id)).toBe(contractAskingWage(plain, 'feb-3', player.id));
    for (const player of players) {
      expect(contractAskingWage(state, 'acb-3', player.id)).toBe(contractAskingWage(plain, 'acb-3', player.id));
      expect(requiredNegotiationWage(player.id, 2, undefined, state, 'starter', 'acb-3')).toBe(requiredNegotiationWage(player.id, 2, undefined, plain, 'starter', 'acb-3'));
    }
  });

  it('follows the club\'s band for the contract\'s season: next season\'s in the offseason', () => {
    const relegated = 'acb-12', promoted = 'feb-1';
    const entry = (clubId: string, band: SeasonClubEconomy['band']) => ({ ...clubEconomy(state, clubId)!, band, playerBill: 1, target: 1, reasons: [] }) as unknown as SeasonClubEconomy;
    const economySeasons = { model: 'economy-seasons-1', seasons: [{ seasonNumber: 2, clubs: { [relegated]: entry(relegated, 'second'), [promoted]: entry(promoted, 'top-lower') } }] } as unknown as NonNullable<SeasonState['economySeasons']>;
    const good = players.filter(player => nbaValue(state, player.id) > threshold && topDivisionWage(worldOf(state), 'Spain', nbaValue(state, player.id))! > contractAskingWage(plain, relegated, player.id));
    expect(good.length).toBeGreaterThan(5);
    const during = { ...state, economySeasons }, offseason = { ...state, status: 'complete' as const, economySeasons };
    for (const player of good) {
      const floor = topDivisionWage(worldOf(state), 'Spain', nbaValue(state, player.id))!;
      // During the season the relegated club is still a top-division club and the promoted club a second-division club.
      expect(secondDivisionDemand(during, relegated, player.id, 600_000)).toBe(600_000);
      expect(secondDivisionDemand(during, promoted, player.id, 600_000)).toBe(Math.max(600_000, floor));
      // In the offseason both sign for next season.
      expect(secondDivisionDemand(offseason, relegated, player.id, 600_000)).toBe(Math.max(600_000, floor));
      expect(secondDivisionDemand(offseason, promoted, player.id, 600_000)).toBe(600_000);
    }
    // Older careers: never changed.
    for (const player of good) expect(secondDivisionDemand({ ...plain, status: 'complete', economySeasons }, relegated, player.id, 600_000)).toBe(600_000);
  });

  it('leaves a club\'s own academy prospect at his academy wage until the day of his promotion', () => {
    const prospect = state.academy.prospects.find(item => item.clubId === 'feb-3')!;
    expect(prospect).toBeDefined();
    const strong = { ...prospect.player, attributes: Object.fromEntries(Object.entries(prospect.player.attributes).map(([key, value]) => [key, key === 'stamina' ? value : 16])) } as typeof prospect.player;
    const graduate = (date: string, clubId = 'feb-3') => ({ id: 'academy-graduate-1', prospectId: prospect.player.id, player: strong, dateOfBirth: prospect.dateOfBirth, seasonWage: prospect.seasonWage, clubId, availableSince: { seasonNumber: 1, round: 1 }, graduatedOn: date, kind: 'promotion' as const, sourcePoints: { twoPoint: 0, threePoint: 0, freeThrow: 0, passing: 0, defense: 0, rebounding: 0, stamina: 0 }, offerId: null, contractId: null });
    const promotedToday = { ...state, academy: { ...state.academy, graduates: [graduate(state.date)] } };
    expect(nbaValue(promotedToday, prospect.player.id)).toBeGreaterThan(threshold);
    expect(secondDivisionDemand(promotedToday, 'feb-3', prospect.player.id, 500_000)).toBe(500_000);
    // Promoted on an earlier day (a renewal later) or graduated by another club's academy: the usual rule.
    const earlier = { ...state, academy: { ...state.academy, graduates: [graduate('2026-01-01')] } };
    expect(secondDivisionDemand(earlier, 'feb-3', prospect.player.id, 500_000)).toBe(Math.max(500_000, topDivisionWage(worldOf(state), 'Spain', nbaValue(earlier, prospect.player.id))!));
    expect(secondDivisionDemand(promotedToday, 'feb-4', prospect.player.id, 500_000)).toBeGreaterThan(500_000);
  });

  it('lets a club short of eight sign cheap players within the save check\'s allocation bound', () => {
    for (const clubId of ['acb-3', 'feb-3']) {
      const ceiling = Math.max(clubSalaryCeiling(state, clubId, 2), seasonSalaryCeiling(state, clubId, 2));
      expect(minimumSquadCeiling(state, clubId, 2)).toBe(ceiling + surplusWageCeiling(ceiling));
      expect(minimumSquadCeiling(state, clubId, 2)).toBeGreaterThan(getClubContractSummary(state, clubId, 2).minimumSquadBudget);
    }
  });
});
