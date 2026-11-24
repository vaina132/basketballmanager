import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { FICTIONAL_AWAY, FICTIONAL_HOME } from '../src/data/fictional-teams';
import { HOME_COURT_MAKE_BONUS } from '../src/engine/calibration';
import { createFixtureMatch, setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { shotContext } from '../src/engine/possession';
import { parseSeason, serializeSeason, serializeSeasonCompact } from '../src/storage/season-storage';
import { validateMatchState } from '../src/storage/validate-match';
import { clubCountry, lowerDivisionClubIds, playsAtNeutralVenue, worldOf } from '../src/world/career-world';
import { getClubCoaching } from '../src/world/coaching';
import { setEmploymentDelegation } from '../src/world/employment';
import { financeLedgerEntries, financeLedgerTicket } from '../src/world/finance-ledger';
import { advanceMarket } from '../src/world/market';
import { getMarketStartReason } from '../src/world/market-policy';
import { worldFromPack } from '../src/world/real-world';
import { advanceSeason, createSeason, managedSide, NEW_CAREER_SYSTEMS, rolloverSeason } from '../src/world/season';
import { staffMarketWorld } from '../src/world/staff-levels';
import { economyPack } from './helpers/economy-pack';

/**
 * Format 85 (new careers): Primera FEB's final stage is played at one venue, so its games have no home-court advantage
 * and earn neither club a gate (`neutralVenues`); clubs promoted from a next division keep their country
 * (`clubCountries`). One Primera FEB season (18 clubs, its real format) and the rollover that brings three Segunda FEB
 * clubs up cover both.
 */
const levels = [16, 16, 15, 15, 14, 14, 13, 13, 12, 12, 11, 11, 10, 10, 9, 9, 8, 8];
const pack = economyPack([{ id: 'feb', name: 'Primera FEB', country: 'Spain', tier: 2, levels }], null, 12);
const packWorld = worldFromPack(pack, 'feb');
const roundTrip = (state: SeasonState) => parseSeason(serializeSeasonCompact(state));
const play = (state: SeasonState) => advanceSeason(state.activeMatch && state.activeMatch.status !== 'finished' ? { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) } : state);

describe('format 85: no home advantage at one venue', () => {
  it('removes the home shooting edge only for a game marked at one venue', () => {
    const home = createFixtureMatch(5, FICTIONAL_HOME, FICTIONAL_AWAY), neutral = createFixtureMatch(5, FICTIONAL_HOME, FICTIONAL_AWAY, { neutralVenue: true });
    expect(neutral.neutralVenue).toBe(true);
    expect(home.neutralVenue).toBeUndefined();
    expect(() => validateMatchState(neutral)).not.toThrow();
    expect(() => validateMatchState({ ...neutral, neutralVenue: false } as never)).toThrow(/neutralVenue/);
    // The same look: the side listed at home shoots 1.6 points better at home, and exactly as well as anywhere at one venue.
    const play = { ...home.possessionPlay!, offense: 'home' as const }, look = (state: typeof home, offense: 'home' | 'away') => shotContext(state, { ...play, offense } as typeof play).makeChance;
    expect(look(home, 'home') - look(neutral, 'home')).toBeCloseTo(HOME_COURT_MAKE_BONUS, 6);
    // The richer play model reads the mark too: the same seed plays out differently without the home edge.
    const options = { playModel: 'plays-3' as const, computerCoach: ['home', 'away'] as const, autoSubstitutions: { home: true, away: true } };
    const atHome = simulateToEnd(createFixtureMatch(11, FICTIONAL_HOME, FICTIONAL_AWAY, options)), atOneVenue = simulateToEnd(createFixtureMatch(11, FICTIONAL_HOME, FICTIONAL_AWAY, { ...options, neutralVenue: true }));
    expect(atOneVenue.neutralVenue).toBe(true);
    expect(atOneVenue.events.length !== atHome.events.length || atOneVenue.score.home !== atHome.score.home || atOneVenue.score.away !== atHome.score.away).toBe(true);
  });

  it('applies to new careers only; older formats refuse the markers', () => {
    const fixture = { neutral: true };
    const opening = createSeason({ seed: 3, world: packWorld, managedClubId: 'feb-3', ...NEW_CAREER_SYSTEMS });
    expect(worldOf(opening).neutralVenues).toBe(true);
    expect(worldOf(opening).nextDivisionCountries).toBe(true);
    expect(playsAtNeutralVenue(opening, fixture)).toBe(true);
    const older = createSeason({ seed: 3, world: packWorld, managedClubId: 'feb-3', ...NEW_CAREER_SYSTEMS, neutralVenues: false, clubCountries: false, economyBalance: false, longCareers: false, careerBalance: false });
    expect(worldOf(older)).toBe(packWorld);
    expect(playsAtNeutralVenue(older, fixture)).toBe(false);
    const envelope = JSON.parse(serializeSeason(opening));
    envelope.formatVersion = 84; envelope.state.schemaVersion = 84;
    expect(() => parseSeason(JSON.stringify(envelope))).toThrow(/requires format 85/);
  });
});

describe('format 85: a Primera FEB season and the promoted clubs that follow', () => {
  let finalStage: SeasonState | undefined, complete: SeasonState, next: SeasonState;
  beforeAll(() => {
    // Seed 4 since format 86 (head coaches steer computer clubs): feb-3 reaches the one-venue final stage.
    let state = setEmploymentDelegation(createSeason({ seed: 4, world: packWorld, managedClubId: 'feb-3', injuryMode: 'standard', ...NEW_CAREER_SYSTEMS }), true);
    while (state.status === 'active') {
      if (!finalStage && state.fixtures.find(fixture => fixture.id === state.activeFixtureId)?.neutral) finalStage = state;
      state = play(state);
    }
    complete = state;
    for (let steps = 0; steps < 200 && getMarketStartReason(state); steps += 1) state = advanceMarket(state);
    next = rolloverSeason(state);
  }, 900_000);

  it('plays the final stage at one venue: no home advantage, no gate, strict saves', () => {
    const neutral = complete.fixtures.filter(fixture => fixture.neutral);
    // Single-game semi-finals and final.
    expect(neutral.map(fixture => fixture.stage)).toEqual(['semi-final', 'semi-final', 'final']);
    expect(neutral.every(fixture => fixture.result)).toBe(true);
    // The manager's semi-final is prepared without home advantage and saves under the strict check.
    expect(finalStage).toBeDefined();
    expect(finalStage!.activeMatch!.neutralVenue).toBe(true);
    expect(roundTrip(finalStage!)).toEqual(finalStage);
    // Neither club books a gate at one venue; the quarter-finals' hosts do.
    for (const fixture of neutral) expect(financeLedgerTicket(complete.finance, fixture.id)).toBeNull();
    const quarterFinals = complete.fixtures.filter(fixture => fixture.stage === 'quarter-final');
    expect(quarterFinals.length).toBeGreaterThan(0);
    for (const fixture of quarterFinals) expect(financeLedgerTicket(complete.finance, fixture.id)).not.toBeNull();
    expect([...financeLedgerEntries(complete.finance)].filter(entry => entry.kind === 'tickets').every(entry => !neutral.some(fixture => fixture.id === entry.ticket!.fixtureId))).toBe(true);
    expect(roundTrip(complete)).toEqual(complete);
  }, 600_000);

  it('gives the promoted next-division clubs their country, and the staff systems use it', () => {
    const world = worldOf(next), joined = next.clubs.filter(club => !complete.clubs.some(old => old.id === club.id)).map(club => club.id);
    expect(joined).toHaveLength(3);
    expect(joined.every(id => lowerDivisionClubIds(world).has(id))).toBe(true);
    expect(joined.map(id => clubCountry(world, id))).toEqual(['Spain', 'Spain', 'Spain']);
    // Older careers keep no country for them.
    expect(joined.map(id => clubCountry(packWorld, id))).toEqual([null, null, null]);
    // Every club of the season counts in the local staff pools, and the joining clubs are staffed.
    expect(staffMarketWorld(next).countries!.every(country => country === 'Spain')).toBe(true);
    for (const id of joined) expect(getClubCoaching(next.coaching, id).length).toBeGreaterThan(0);
    expect(roundTrip(next)).toEqual(next);
    const week = play(next);
    expect(roundTrip(week)).toEqual(week);
  }, 600_000);
});
