import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { nbaPack, NBA_CLUB_IDS } from './helpers/nba-pack';
import { worldFromPack } from '../src/world/real-world';
import { advanceSeason, createSeason, getPostseasons, getStandings, managedSide, NEW_CAREER_SYSTEMS, rolloverSeason } from '../src/world/season';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { setEmploymentDelegation } from '../src/world/employment';
import { advanceMarket } from '../src/world/market';
import { getMarketStartReason, getMarketWindow } from '../src/world/market-policy';
import { parseSeason, serializeSeasonCompact } from '../src/storage/season-storage';
import { isNbaClub, seasonRounds } from '../src/world/career-world';
import { getFinanceBalance } from '../src/world/finance';
import { nationalPlayerPool } from '../src/world/national';
import { nationalWindowSaturday } from '../src/world/national-calendar';
import { nbaFacts } from '../src/ui/SeasonProgress';

/**
 * NBA step 5: delegated careers in a world of the NBA alone and in one of the NBA with Spain's Liga Endesa, start to
 * finish, with strict save round trips (the full save check) at week 5, after the play-in and in the offseason.
 */
const play = (state: SeasonState) => advanceSeason(state.activeMatch && state.activeMatch.status !== 'finished' ? { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) } : state);
const roundTrip = (state: SeasonState) => { const text = serializeSeasonCompact(state); return { state: parseSeason(text), bytes: text.length }; };
const SPAIN = { id: 'acb', name: 'Liga Endesa', country: 'Spain', tier: 1 as const, levels: [16, 16, 15, 15, 14, 14, 13, 13, 12, 12, 11, 11, 10, 10, 9, 9, 8, 8] };

describe('an NBA career, start to finish', () => {
  const world = worldFromPack(nbaPack(), 'nba');
  let opening: SeasonState, week5: SeasonState, afterPlayIn: SeasonState | undefined, complete: SeasonState, offseason: SeasonState, next: SeasonState;
  const sizes: Record<string, number> = {};
  let seconds = 0, nbaMatch = false;
  beforeAll(() => {
    opening = setEmploymentDelegation(createSeason({ seed: 11, world, managedClubId: 'nba-bos', ...NEW_CAREER_SYSTEMS }), true);
    let state = opening;
    const started = performance.now();
    while (state.status === 'active') {
      if (state.activeMatch?.ruleset === 'nba-2026b') nbaMatch = true;
      state = play(state);
      if (state.round === 5 && !week5) { week5 = state; sizes.week5 = roundTrip(state).bytes; }
      if (!afterPlayIn && state.fixtures.some(fixture => fixture.stage === 'round-of-16')) { afterPlayIn = state; sizes.afterPlayIn = roundTrip(state).bytes; }
    }
    seconds = (performance.now() - started) / 1000;
    complete = state;
    sizes.complete = roundTrip(state).bytes;
    for (let steps = 0; steps < 200 && getMarketStartReason(state); steps += 1) state = advanceMarket(state);
    offseason = state;
    sizes.offseason = roundTrip(state).bytes;
    next = rolloverSeason(state);
    console.log(`NBA season: ${seconds.toFixed(1)} s automatic, save sizes ${JSON.stringify(sizes)}`);
  }, 3_600_000);

  it('plays 82 games a club under the NBA rules, then the play-in and playoffs to a champion', () => {
    expect(seasonRounds(complete)).toBe(41);
    expect(nbaMatch).toBe(true);
    const regular = complete.fixtures.filter(fixture => !fixture.stage);
    expect(regular).toHaveLength(1230);
    for (const club of NBA_CLUB_IDS) expect(regular.filter(fixture => (fixture.homeClubId === club || fixture.awayClubId === club) && fixture.result)).toHaveLength(82);
    // NBA games last 48 minutes: each side's players share 5 x 2,880 seconds in regulation.
    const game = regular.find(fixture => fixture.result?.stats && fixture.result.periods === 4)!;
    // The game's own home players (computer trades may since have moved some of them to other clubs).
    const homeIds = game.result!.selection?.home ?? complete.clubs.find(club => club.id === game.homeClubId)!.players.map(player => player.id);
    expect(homeIds.reduce((sum, id) => sum + (game.result!.stats![id]?.secondsPlayed ?? 0), 0)).toBe(5 * 2880);
    const standings = getStandings(complete);
    expect(standings).toHaveLength(30);
    expect(standings.every(row => row.played === 82)).toBe(true);
    const [postseason] = getPostseasons(complete, 1);
    expect(postseason!.format.id).toBe('nba-2026-1');
    expect(postseason!.outcome.champion).not.toBeNull();
    expect(postseason!.series.find(series => series.id === 'final')!.winner).toBe(postseason!.outcome.champion);
    expect(postseason!.outcome.promoted).toEqual([]);
    expect(nbaFacts(week5)).toMatch(/^Game 1\/82 · 0-0$/);
    expect(nbaFacts(afterPlayIn!)).toMatch(/^Playoffs · \d+-\d+/);
  });

  it('keeps NBA clubs without academies or youth coaches, with high facilities and money that pays their wages', () => {
    for (const state of [opening, complete, next]) {
      expect(state.academy.prospects.some(prospect => isNbaClub(world, prospect.clubId))).toBe(false);
      expect(state.youth.contracts.some(contract => isNbaClub(world, contract.clubId))).toBe(false);
    }
    expect(NBA_CLUB_IDS.every(club => getFinanceBalance(opening.finance, club).cash > 0)).toBe(true);
    const inDebt = NBA_CLUB_IDS.filter(club => getFinanceBalance(complete.finance, club).unpaid > 0);
    console.log(`NBA clubs with unpaid costs after season one: ${inDebt.length}`);
    expect(inDebt.length).toBeLessThanOrEqual(3);
  });

  it('round-trips strictly at week 5, after the play-in and in the offseason, and opens the market after the final week', () => {
    expect(week5.round).toBe(5);
    expect(afterPlayIn).toBeDefined();
    expect(getMarketWindow(complete)?.openedOn).toBe(complete.date);
    expect(complete.round).toBe(seasonRounds(complete));
    expect(roundTrip(offseason).state.status).toBe('complete');
    expect(Math.max(...Object.values(sizes))).toBeLessThan(32 * 1024 * 1024);
  });

  it('starts season two with a new schedule whose three-game opponents rotate', () => {
    expect(next.seasonNumber).toBe(2);
    expect(next.fixtures).toHaveLength(1230);
    const meetings = (state: SeasonState) => { const counts = new Map<string, number>(); for (const fixture of state.fixtures) { const key = [fixture.homeClubId, fixture.awayClubId].sort().join('|'); counts.set(key, (counts.get(key) ?? 0) + 1); } return [...counts].filter(([, count]) => count === 3).map(([key]) => key).sort(); };
    expect(meetings(next)).not.toEqual(meetings(opening));
  });
});

describe('a combined NBA and Liga Endesa career', () => {
  const world = worldFromPack(nbaPack([SPAIN]), ['acb', 'nba']);
  let complete: SeasonState, bytes = 0, seconds = 0;
  beforeAll(() => {
    let state = setEmploymentDelegation(createSeason({ seed: 7, world, managedClubId: 'acb-3', ...NEW_CAREER_SYSTEMS }), true);
    const started = performance.now();
    while (state.status === 'active') state = play(state);
    seconds = (performance.now() - started) / 1000;
    complete = state;
    bytes = roundTrip(state).bytes;
    console.log(`NBA + Liga Endesa season: ${seconds.toFixed(1)} s automatic, save ${bytes} bytes`);
  }, 3_600_000);

  it('plays both leagues on their own calendars, each with its own postseason, and saves strictly', () => {
    expect(seasonRounds(complete)).toBe(41);
    const postseasons = getPostseasons(complete, 1);
    expect(postseasons.map(entry => [entry.league.id, entry.format.id, !!entry.outcome.champion])).toEqual([['acb', 'acb-2026-1', true], ['nba', 'nba-2026-1', true]]);
    // Liga Endesa keeps its Saturdays; the NBA plays on every day of the week.
    expect(complete.fixtures.filter(fixture => !fixture.stage && fixture.homeClubId.startsWith('acb-')).every(fixture => new Date(`${fixture.date}T00:00:00Z`).getUTCDay() === 6)).toBe(true);
    expect(new Set(complete.fixtures.filter(fixture => fixture.homeClubId.startsWith('nba-')).map(fixture => new Date(`${fixture.date}T00:00:00Z`).getUTCDay())).size).toBe(7);
    expect(bytes).toBeLessThan(32 * 1024 * 1024);
  });

  it('never calls NBA players up for the FIBA windows', () => {
    expect(complete.national).toBeDefined();
    const saturday = nationalWindowSaturday(1, 2);
    const inWindow = nationalPlayerPool(complete, saturday, { saturday }).get('Serbia') ?? [];
    const outside = nationalPlayerPool(complete, '2027-07-01', null).get('Serbia') ?? [];
    expect(outside.some(candidate => !!candidate.clubId && isNbaClub(world, candidate.clubId))).toBe(true);
    expect(inWindow.some(candidate => !!candidate.clubId && isNbaClub(world, candidate.clubId))).toBe(false);
  });
});
