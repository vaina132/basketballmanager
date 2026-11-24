import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import type { CareerWorld } from '../src/domain/world';
import type { CareerMove } from '../src/domain/career';
import { economyPack } from './helpers/economy-pack';
import { nbaPack, NBA_CLUB_IDS } from './helpers/nba-pack';
import { worldFromPack } from '../src/world/real-world';
import { advanceSeason, createSeason, getStandings, managedSide, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { balancedResultsImpact, balancedWinRate, CAREER_BALANCE_RULES, careerBalanceNote, fadeFloor, isNbaOnlyWorld, nbaSecondChanceRequirement, usesCareerBalance } from '../src/world/career-balance';
import { CAREER_RULES, fadedReputation, NO_CLUB } from '../src/world/career-rules';
import { jobMarketAt } from '../src/world/career-policy';
import { ambitionWinRate, presidentTraits } from '../src/world/presidents';
import { seasonRounds, worldOf } from '../src/world/career-world';
import { addCalendarDays } from '../src/world/competition-calendar';
import { verdictOnLine } from '../src/world/board-consequences';

/**
 * Format 98 (owner decision, 24 November 2026: "fix manager careers", `world.careerBalance`):
 * results targets in proportion to the squad's rank in its league, patient results judgement, a floor on a fading good
 * name and, in a world of the NBA alone, a way back into NBA jobs after a wait. Careers without the marker keep their rules.
 */
const SPAIN = { id: 'acb', name: 'Liga Endesa', country: 'Spain', tier: 1 as const, levels: [16, 16, 15, 15, 14, 14, 13, 13, 12, 12, 11, 11, 10, 10, 9, 9, 8, 8] };
const withoutMarker = (world: CareerWorld): CareerWorld => { const { careerBalance: _marker, ...rest } = world; return rest as CareerWorld; };
const play = (state: SeasonState) => advanceSeason(state.activeMatch && state.activeMatch.status !== 'finished' ? { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) } : state);

describe('the rules (format 98)', () => {
  it('sets a mid club about 45-50% wins, moved a little by ambition, and follows the squad rank evenly', () => {
    expect(balancedWinRate(9, 18, { ambition: 3 })).toBe(0.48);
    expect(balancedWinRate(9, 18, { ambition: 4 })).toBe(0.51);
    expect(balancedWinRate(9, 18, { ambition: 2 })).toBe(0.45);
    expect(balancedWinRate(10, 18, { ambition: 3 })).toBe(0.46);
    expect(balancedWinRate(1, 18, { ambition: 3 })).toBe(0.69);
    expect(balancedWinRate(18, 18, { ambition: 3 })).toBe(0.25);
    expect(balancedWinRate(1, 18, { ambition: 5 })).toBe(CAREER_BALANCE_RULES.maxRate);
    expect(balancedWinRate(18, 18, { ambition: 1 })).toBe(CAREER_BALANCE_RULES.minRate);
    // NBA squads are judged on a narrower spread.
    expect(balancedWinRate(15, 30, { ambition: 3 }, true)).toBe(0.47);
    expect(balancedWinRate(1, 30, { ambition: 3 }, true)).toBe(0.61);
    expect(balancedWinRate(30, 30, { ambition: 3 }, true)).toBe(0.33);
    for (let rank = 2; rank <= 18; rank += 1) expect(balancedWinRate(rank, 18, null)).toBeLessThanOrEqual(balancedWinRate(rank - 1, 18, null));
  });

  it('judges a few wins short as Concerned and a clearly bad season as a dismissal', () => {
    // A 34-game season with a 17-win target: no change within about a win, and capped at 30 either way.
    expect(balancedResultsImpact(17, 17, 34, 34)).toBe(0);
    expect(balancedResultsImpact(16, 17, 34, 34)).toBe(0);
    expect(balancedResultsImpact(14, 17, 34, 34)).toBe(-12);
    expect(balancedResultsImpact(12, 17, 34, 34)).toBe(-27);
    expect(balancedResultsImpact(11, 17, 34, 34)).toBe(-30);
    expect(balancedResultsImpact(20, 17, 34, 34)).toBe(12);
    // Three wins short: 50 - 12 = 38 is Concerned for every president; six short is Under pressure for every one.
    for (const line of [24, 27, 30, 33, 36]) {
      expect(verdictOnLine(50 + balancedResultsImpact(14, 17, 34, 34), line)).toBe('concerned');
      expect(verdictOnLine(50 + balancedResultsImpact(11, 17, 34, 34), line)).toBe('pressure');
    }
    // Early in the season the gap counts against half the season's games, not the few played.
    expect(balancedResultsImpact(2, 4, 8, 34)).toBe(balancedResultsImpact(2, 4, 17, 34));
    // An 82-game NBA season: three wins short is nothing, twelve short is a dismissal.
    expect(balancedResultsImpact(38, 41, 82, 82)).toBe(0);
    expect(balancedResultsImpact(29, 41, 82, 82)).toBeLessThanOrEqual(-26);
  });

  it('stops a fading good name a few points below the reputation left with', () => {
    const level = CAREER_RULES.unemployedReputationLevel;
    expect(fadeFloor(60, level)).toBe(50);
    expect(fadeFloor(35, level)).toBe(level);
    expect(fadedReputation(60, 35 * 30)).toBe(level);
    expect(fadedReputation(60, 35 * 30, fadeFloor(60, level))).toBe(50);
    expect(fadedReputation(60, 35 * 4, fadeFloor(60, level))).toBe(56);
    // A poor name still recovers to the resting level.
    expect(fadedReputation(20, 35 * 30, fadeFloor(20, level))).toBe(level);
  });

  it('lowers the NBA requirement of the weaker records after a wait, never below the floor', () => {
    expect(nbaSecondChanceRequirement(60, 30, 30, 0)).toBe(60);
    expect(nbaSecondChanceRequirement(60, 30, 30, 35 * 4)).toBe(48);
    expect(nbaSecondChanceRequirement(60, 30, 30, 35 * 40)).toBe(CAREER_BALANCE_RULES.reliefFloor);
    expect(nbaSecondChanceRequirement(65, 16, 30, 35 * 40)).toBe(CAREER_BALANCE_RULES.reliefFloor);
    expect(nbaSecondChanceRequirement(67, 15, 30, 35 * 40)).toBe(67);
    expect(nbaSecondChanceRequirement(25, 30, 30, 35 * 40)).toBe(25);
  });
});

describe('the career balance marker (format 98)', () => {
  const world = worldFromPack(economyPack([SPAIN]), 'acb');

  it('marks new careers, keeps older careers unchanged, and format 98 refuses the marker', () => {
    const state = createSeason({ seed: 5, world, managedClubId: 'acb-9', ...NEW_CAREER_SYSTEMS });
    expect(worldOf(state).careerBalance).toBe(true);
    expect(usesCareerBalance(state)).toBe(true);
    const older = createSeason({ seed: 5, world, managedClubId: 'acb-9', ...NEW_CAREER_SYSTEMS, careerBalance: false, cashBalance: false, squadRefresh: false, playerDevelopment: false });
    expect(worldOf(older).careerBalance).toBeUndefined();
    expect(createSeason({ seed: 5, ...NEW_CAREER_SYSTEMS }).world?.careerBalance).toBeUndefined();
    expect(() => createSeason({ seed: 5, world, careerBalance: 'yes' as unknown as boolean })).toThrow(/career balance setting/);
    const envelope = JSON.parse(serializeSeason(state));
    expect(parseSeason(JSON.stringify(envelope))).toEqual(state);
    envelope.formatVersion = 97; envelope.state.schemaVersion = 97;
    expect(() => parseSeason(JSON.stringify(envelope))).toThrow(/careerBalance.*format 98/);
    const plain = JSON.parse(serializeSeason(older));
    plain.formatVersion = 97; plain.state.schemaVersion = 97;
    expect(parseSeason(JSON.stringify(plain)).world!.careerBalance).toBeUndefined();
    const wrong = JSON.parse(serializeSeason(state));
    wrong.state.world.careerBalance = false;
    expect(() => parseSeason(JSON.stringify(wrong))).toThrow(/careerBalance/);
    expect(careerBalanceNote(state)).toMatch(/never fades more than 10 points/);
    expect(careerBalanceNote(older)).toBe('');
  });

  it('sets every club\'s target from its squad rank and ambition; older careers keep the thirds', () => {
    const state = createSeason({ seed: 5, world, managedClubId: 'acb-9', ...NEW_CAREER_SYSTEMS });
    const older = createSeason({ seed: 5, world, managedClubId: 'acb-9', ...NEW_CAREER_SYSTEMS, careerBalance: false });
    const objectives = state.board.mandates[0]!.clubs, before = older.board.mandates[0]!.clubs;
    for (const [clubId, objective] of Object.entries(objectives)) {
      expect(objective.targetWins).toBe(Math.ceil(objective.games * balancedWinRate(objective.resourceRank, 18, presidentTraits(world, clubId))));
      expect(before[clubId]!.resourceRank).toBe(objective.resourceRank);
    }
    const middle = Object.values(objectives).filter(objective => objective.resourceRank === 9 || objective.resourceRank === 10);
    for (const objective of middle) expect(objective.targetWins / objective.games).toBeLessThanOrEqual(0.55);
    for (const [clubId, objective] of Object.entries(before)) expect(objective.targetWins).toBe(Math.ceil(objective.games * ambitionWinRate(objective.resourceRank <= 6 ? 0.6 : objective.resourceRank <= 12 ? 0.5 : 0.4, presidentTraits(world, clubId))));
  });

  it('reviews results by share of the games and saves strictly after a few weeks', () => {
    let state = createSeason({ seed: 5, world, managedClubId: 'acb-9', ...NEW_CAREER_SYSTEMS });
    for (let week = 0; week < 8 && state.status === 'active'; week += 1) state = play(state);
    const review = state.board.reviews.at(-1)!, mandate = state.board.mandates[0]!;
    for (const [clubId, club] of Object.entries(review.clubs)) {
      const objective = mandate.clubs[clubId]!;
      if (club.played >= 3) expect(club.resultsImpact).toBe(balancedResultsImpact(club.wins, club.targetPace, club.played, objective.games));
    }
    expect(parseSeason(serializeSeason(state))).toEqual(state);
  }, 300_000);
});

describe('a way back into NBA jobs in a world of the NBA alone (format 98)', () => {
  const world = worldFromPack(nbaPack(), 'nba');
  let complete: SeasonState;

  beforeAll(() => {
    let state = createSeason({ seed: 7, world, managedClubId: 'nba-mia', ...NEW_CAREER_SYSTEMS });
    for (let guard = 0; guard < 400 && state.status === 'active'; guard += 1) state = play(state);
    complete = state;
  }, 3_500_000);

  /** The completed season with the manager dismissed by `clubId` at its end, his final confidence `confidence`, and the given clubs Under pressure. */
  function unemployedAfter(state: SeasonState, clubId: string, confidence: number, pressure: readonly string[]): { state: SeasonState; moves: CareerMove[] } {
    const rounds = seasonRounds(state);
    const reviews = state.board.reviews.map(review => review.seasonNumber === 1 && review.round === rounds ? { ...review, clubs: Object.fromEntries(Object.entries(review.clubs).map(([id, club]) => [id, { ...club, confidence: id === clubId ? confidence : pressure.includes(id) ? 5 : Math.max(club.confidence, 60) }])) } : review);
    const move: CareerMove = { seasonNumber: 1, date: state.date, fromClubId: clubId, toClubId: NO_CLUB, reason: 'dismissed', ledgerCount: 0, round: rounds, phase: 'end' };
    const moves = [move];
    return { state: { ...state, managedClubId: NO_CLUB, career: { ...state.career, moves }, board: { ...state.board, reviews, restarts: [] } }, moves };
  }

  it('is a world of the NBA alone, with NBA targets on the narrower spread', () => {
    expect(isNbaOnlyWorld(world)).toBe(true);
    expect(isNbaOnlyWorld(worldFromPack(nbaPack([SPAIN]), ['acb', 'nba']))).toBe(false);
    expect(isNbaOnlyWorld(worldFromPack(economyPack([SPAIN]), 'acb'))).toBe(false);
    for (const [clubId, objective] of Object.entries(complete.board.mandates[0]!.clubs)) expect(objective.targetWins).toBe(Math.ceil(objective.games * balancedWinRate(objective.resourceRank, 30, presidentTraits(world, clubId), true)));
    expect(careerBalanceNote(complete)).toMatch(/NBA clubs in the lower half/);
  });

  it('opens the weakest records\' NBA jobs to a dismissed manager after a wait; older careers never do', () => {
    const table = getStandings(complete);
    const position = (id: string) => table.find(row => row.clubId === id)!.position;
    const byRecord = NBA_CLUB_IDS.filter(id => id !== 'nba-mia').sort((a, b) => position(b) - position(a));
    const weak = byRecord[0]!, strong = byRecord.at(-1)!;
    const { state, moves } = unemployedAfter(complete, 'nba-mia', 40, [weak, strong]);
    const point = (days: number) => ({ seasonNumber: 1, round: seasonRounds(state), phase: 'offseason' as const, date: addCalendarDays(state.date, days) });
    const now = jobMarketAt(state, moves, point(1));
    const weakNow = now.vacancies.find(item => item.clubId === weak)!, strongNow = now.vacancies.find(item => item.clubId === strong)!;
    expect(weakNow.requirement).toBeGreaterThanOrEqual(60);
    expect(weakNow.offered).toBe(false);
    const later = jobMarketAt(state, moves, point(35 * 14));
    const weakLater = later.vacancies.find(item => item.clubId === weak)!;
    expect(weakLater.requirement).toBe(Math.max(CAREER_BALANCE_RULES.reliefFloor, weakNow.requirement - 14 * CAREER_BALANCE_RULES.reliefPoints));
    expect(later.reputation.value).toBeGreaterThanOrEqual(CAREER_BALANCE_RULES.reliefFloor);
    expect(weakLater.requirement).toBeLessThanOrEqual(later.reputation.value);
    expect(weakLater.offered).toBe(true);
    // The best records' jobs ask as before.
    expect(later.vacancies.find(item => item.clubId === strong)!.requirement).toBe(strongNow.requirement);
    // Older careers: the same market keeps every NBA job at 60 or more.
    const older: SeasonState = { ...state, world: withoutMarker(worldOf(state)) };
    const before = jobMarketAt(older, moves, point(35 * 14));
    expect(before.vacancies.find(item => item.clubId === weak)!.requirement).toBe(weakNow.requirement);
    expect(before.vacancies.find(item => item.clubId === weak)!.offered).toBe(false);
  });

  it('keeps a good name from fading below ten points under the reputation left with', () => {
    const { state, moves } = unemployedAfter(complete, 'nba-mia', 75, []);
    const point = { seasonNumber: 1, round: seasonRounds(state), phase: 'offseason' as const, date: addCalendarDays(state.date, 35 * 80) };
    const market = jobMarketAt(state, moves, point);
    expect(market.reputation.base).toBeGreaterThan(45);
    expect(market.reputation.value).toBe(market.reputation.base - CAREER_BALANCE_RULES.maxFade);
    const older = jobMarketAt({ ...state, world: withoutMarker(worldOf(state)) }, moves, point);
    expect(older.reputation.value).toBe(CAREER_RULES.unemployedReputationLevel);
  });
});
