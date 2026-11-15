import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { sponsorMarket, SPONSOR_DIRECTORY } from '../src/data/development-sponsors';
import { ASSISTANT_DIRECTORY, COACH_DIRECTORY, FITNESS_DIRECTORY, PHYSIO_DIRECTORY, SCOUT_DIRECTORY, staffMarket, YOUTH_COACH_DIRECTORY } from '../src/data/staff-directory';
import { DEVELOPMENT_COACHES } from '../src/data/development-coaches';
import { DEVELOPMENT_WORLD } from '../src/data/development-world';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { MAX_WORLD_CLUBS, requireWorldContexts, roundOrdinal, seasonRounds, validateWorld, worldRounds } from '../src/world/career-world';
import { availableCoaches } from '../src/world/coaching';
import { offerPlayerContract, setEmploymentDelegation } from '../src/world/employment';
import { getAvailablePlayers, MIN_CONTRACT_WAGE, quotePlayerContract } from '../src/world/employment-policy';
import { getCareerWage } from '../src/world/player-catalog';
import { advanceMarket } from '../src/world/market';
import { getMarketStartReason } from '../src/world/market-policy';
import { advanceSeason, createSchedule, createSeason, managedSide, NEW_CAREER_SYSTEMS, rolloverSeason } from '../src/world/season';
import { testWorld } from './world-fixtures';

const advance = (state: SeasonState) => advanceSeason({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch!, managedSide(state), true)) });

describe('leagues of any even size', () => {
  it('schedules a double round robin: every club plays every matchday and meets every other club home and away', () => {
    for (const size of [4, 8, 18, 20]) {
      const world = testWorld(size), schedule = createSchedule(world.clubs, 2), rounds = worldRounds(world);
      expect(rounds).toBe(2 * (size - 1));
      expect(schedule).toHaveLength(size * (size - 1));
      expect(new Set(schedule.map(fixture => fixture.id)).size).toBe(schedule.length);
      for (let round = 1; round <= rounds; round += 1) {
        const games = schedule.filter(fixture => fixture.round === round);
        expect(new Set(games.flatMap(fixture => [fixture.homeClubId, fixture.awayClubId])).size).toBe(size);
        expect(new Set(games.map(fixture => fixture.date)).size).toBe(1);
      }
      const pairs = new Set(schedule.map(fixture => `${fixture.homeClubId}>${fixture.awayClubId}`));
      expect(pairs.size).toBe(size * (size - 1));
    }
    expect(() => createSchedule(testWorld(8).clubs.slice(0, 7))).toThrow(/even number/);
  });

  it('keeps the built-in league\'s ten matchdays and its date numbering', () => {
    expect(worldRounds(DEVELOPMENT_WORLD)).toBe(10);
    expect(seasonRounds({})).toBe(10);
    expect([roundOrdinal(1, 10, 10), roundOrdinal(2, 1, 10), roundOrdinal(3, 4, 34)]).toEqual([10, 11, 72]);
    expect(createSchedule(DEVELOPMENT_WORLD.clubs).map(fixture => fixture.id).slice(0, 3)).toEqual(['dev-r1-g1', 'dev-r1-g2', 'dev-r1-g3']);
  });

  it('accepts only even leagues of 4 to 40 clubs', () => {
    expect(() => validateWorld(testWorld(18))).not.toThrow();
    expect(() => validateWorld({ ...testWorld(8), clubs: testWorld(8).clubs.slice(0, 7) })).toThrow(/even number of clubs/);
    expect(MAX_WORLD_CLUBS).toBe(40);
  });

  it('grows the staff and sponsor markets with the league, keeping the built-in league\'s candidates', () => {
    const directories: readonly (readonly { id: string; name: string }[])[] = [COACH_DIRECTORY, SCOUT_DIRECTORY, FITNESS_DIRECTORY, PHYSIO_DIRECTORY, ASSISTANT_DIRECTORY, YOUTH_COACH_DIRECTORY];
    for (const directory of directories) {
      expect(new Set(directory.map(item => item.id)).size).toBe(directory.length);
      expect(new Set(directory.map(item => item.name)).size).toBe(directory.length);
      const sixClubs = staffMarket(directory, DEVELOPMENT_WORLD);
      expect(staffMarket(directory, testWorld(18))).toHaveLength(sixClubs.length * 3);
      expect(staffMarket(directory, testWorld(40)).length).toBeLessThanOrEqual(directory.length);
    }
    expect(staffMarket(COACH_DIRECTORY, DEVELOPMENT_WORLD)).toEqual(DEVELOPMENT_COACHES);
    // A generated coach repeats an authored coach's skills and fee under a new identity.
    expect(COACH_DIRECTORY[30]).toMatchObject({ id: 'coach-31', skills: DEVELOPMENT_COACHES[0]!.skills, fee: DEVELOPMENT_COACHES[0]!.fee });
    expect(new Set(SPONSOR_DIRECTORY.map(item => item.id)).size).toBe(SPONSOR_DIRECTORY.length);
    expect([sponsorMarket(6).length, sponsorMarket(18).length]).toEqual([24, 72]);
  });
});

describe('an eighteen-club league (34 matchdays, the size of the German league)', () => {
  it('starts, plays its first matchdays with every system on, and saves and loads exactly', () => {
    requireWorldContexts(true);
    try {
      const world = testWorld(18);
      let state = createSeason({ seed: 9, managedClubId: 'w2-danube-lynx', injuryMode: 'standard', world, ...NEW_CAREER_SYSTEMS });
      expect([seasonRounds(state), state.fixtures.length]).toEqual([34, 306]);
      expect(state.fixtures.at(-1)!.date).toBe('2027-04-24');
      for (let matchday = 0; matchday < 2; matchday += 1) state = advance(state);
      expect(state.round).toBe(3);
      expect(state.fixtures.filter(fixture => fixture.result)).toHaveLength(18);
      expect(parseSeason(serializeSeason(state))).toEqual(state);
    } finally { requireWorldContexts(false); }
  }, 600_000);
});

describe('a full career in an eight-club league (14 matchdays)', () => {
  const world = testWorld(8);
  let opening: SeasonState, complete: SeasonState, nextSeason: SeasonState;
  beforeAll(() => {
    // Any rule that lost the career's world fails instead of quietly using the built-in league.
    requireWorldContexts(true);
    opening = createSeason({ seed: 71, managedClubId: 'w1-rhine-falcons', injuryMode: 'standard', world, ...NEW_CAREER_SYSTEMS });
    let state = setEmploymentDelegation(opening, true);
    while (state.status === 'active') state = advance(state);
    for (let steps = 0; steps < 120 && getMarketStartReason(state); steps += 1) state = advanceMarket(state);
    complete = state;
    nextSeason = rolloverSeason(complete);
  }, 600_000);
  afterAll(() => requireWorldContexts(false));

  it('plays all 14 matchdays and completes the season after the last one', () => {
    expect(seasonRounds(opening)).toBe(14);
    expect(opening.fixtures).toHaveLength(56);
    expect(complete.status).toBe('complete');
    expect(complete.round).toBe(14);
    expect(complete.fixtures.every(fixture => fixture.result)).toBe(true);
    expect(availableCoaches(opening.coaching, opening).length).toBeGreaterThan(0);
  });

  it('pays every full-season wage exactly once, in one installment per matchday', () => {
    const club = 'w1-rhine-falcons';
    const agreements = complete.payroll.agreements.filter(agreement => agreement.clubId === club && agreement.seasonNumber === 1 && agreement.startsRound === 1);
    expect(agreements.length).toBeGreaterThan(0);
    const paid = new Map<string, number>(), rounds = new Set<number>();
    for (const entry of complete.finance.ledger) for (const item of entry.payroll?.items ?? []) {
      paid.set(item.agreementId, (paid.get(item.agreementId) ?? 0) + item.gross);
      if (entry.clubId === club && entry.payroll?.type !== 'prepayment') rounds.add(entry.round);
    }
    for (const agreement of agreements) expect(paid.get(agreement.id)).toBe(agreement.seasonWage);
    expect(Math.max(...rounds)).toBe(14);
  });

  it('runs the offseason and opens season two with the same world', () => {
    expect(nextSeason.seasonNumber).toBe(2);
    expect(nextSeason.round).toBe(1);
    expect(nextSeason.world).toBe(world);
    expect(nextSeason.history[0]!.fixtures).toHaveLength(56);
  });

  it('saves and loads the eight-club career exactly at the start, the end and the next opening', () => {
    for (const state of [opening, complete, nextSeason]) expect(parseSeason(serializeSeason(state))).toEqual(state);
  }, 600_000);

  it('keeps contract offers from the offseason and from the next season in order (step 3.2 fix)', () => {
    // The check once ordered offers as season x 22 + matchday x 2, which only works for ten matchdays: offers in the
    // offseason after matchday 14 sorted after offers early in season two, and the career could no longer be saved
    // (found in a real 34-matchday league at the end of season two).
    const managed = nextSeason.clubs.find(club => club.id === nextSeason.managedClubId)!;
    const candidates = [...managed.players.map(player => player.id), ...getAvailablePlayers(nextSeason).map(player => player.id)];
    const playerId = candidates.find(id => quotePlayerContract(nextSeason, id, getCareerWage(nextSeason, id), 1).canOffer)!;
    // A low offer on the opening matchday of season two: the player turns it down, and the answer is recorded.
    const state = offerPlayerContract(nextSeason, playerId, MIN_CONTRACT_WAGE, 1);
    expect(state.negotiations.records.some(entry => entry.seasonNumber === 1 && entry.status === 'complete')).toBe(true);
    expect(state.negotiations.records.at(-1)).toMatchObject({ seasonNumber: 2, round: 1, status: 'active', playerId });
    expect(parseSeason(serializeSeason(state))).toEqual(state);
  }, 600_000);
});
