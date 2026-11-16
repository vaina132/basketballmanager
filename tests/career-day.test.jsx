import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { advanceSeason, createSeason, dateForRound, managedSide } from '../src/world/season';
import { parseSeason, serializeSeasonCompact } from '../src/storage/season-storage';
import { getMarketStartReason, offseasonContinueFirst } from '../src/world/market-policy';
import { careerDay, roundNotice, worldSeasonName } from '../src/ui/career-text';
import { RestWeek } from '../src/ui/RestWeek';
import { placesWorld } from './helpers/europe-worlds';
import { testWorld } from './world-fixtures';

/** Two leagues of five and four clubs on one calendar: the five-club league's clubs have real byes (as in domestic-calendar-career). */
function calendarWorld() {
  const world = testWorld(9);
  return { ...world, id: 'calendar-day-test', rosterModel: 'club-roster-1', domesticLeagues: [
    { id: 'league-0', name: 'League 0', country: 'Test', tier: 1, clubIds: world.clubs.slice(0, 5).map(club => club.id) },
    { id: 'league-1', name: 'League 1', country: 'Test', tier: 1, clubIds: world.clubs.slice(5).map(club => club.id) },
  ] };
}
const play = state => state.activeMatch ? { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) } : state;
const panel = state => renderToStaticMarkup(<RestWeek season={state} busy={false} onTraining={() => {}} />);
const text = markup => markup.replace(/<[^>]+>/g, ' ');

describe('a day without the manager\'s match (browser play-through, 16 November 2026)', () => {
  it('names a midweek European day "No game today" and words each Continue truthfully until the week is recorded', () => {
    const world = placesWorld(), clubId = world.clubs[4].id;
    let state = createSeason({ world, seed: 31, managedClubId: clubId, injuryMode: 'off' });
    // The first week in which the club plays on its Saturday and European games follow later that week.
    const round = state.fixtures.find(fixture => fixture.date === dateForRound(fixture.round) && [fixture.homeClubId, fixture.awayClubId].includes(clubId)
      && state.fixtures.some(other => other.round === fixture.round && other.competition && other.date > fixture.date)).round;
    while (state.round < round) state = advanceSeason(play(state));
    expect(state.activeMatch).not.toBeNull();
    const before = play(state);
    let after = advanceSeason(before);
    expect(after.round).toBe(round);
    expect(after.activeMatch).toBeNull();
    const day = careerDay(after);
    expect(day).toMatchObject({ label: 'No game today', kind: 'European' });
    expect(day.gamesToday).toBeGreaterThan(0);
    const notice = roundNotice(before, after);
    expect(notice).toMatch(/^Sat \d+ \w+ recorded: your game and \d+ other games\. Next: \d+ European games? on (Tue|Wed|Thu) \d+ \w+, without your club\. Your next game: Sat \d+ \w+ vs .+ \((home|away)\)\.$/);
    expect(notice).not.toMatch(/Week|rest week/i);
    const markup = panel(after);
    expect(markup).toContain('No game today');
    expect(markup).not.toContain('Rest week');
    expect(markup).toContain('No game for');
    expect(markup).toContain('Your next game:');
    expect(text(markup)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    // A day in the middle of the week passes the strict save check.
    expect(parseSeason(serializeSeasonCompact(after))).toEqual(after);
    // Each later Continue plays one game day; the week is "recorded" only once its last game day is played.
    for (let steps = 0; steps < 4 && after.round === round; steps += 1) {
      const previous = after;
      after = advanceSeason(play(previous));
      const message = roundNotice(previous, after);
      if (after.round === round) expect(message).toMatch(/^Midweek European games played \((Tue|Wed|Thu) \d+ \w+\)\./);
      else expect(message).toMatch(new RegExp(`^Matchday ${round} recorded\\. `));
    }
    expect(after.round).toBe(round + 1);
  }, 120_000);

  it('keeps "Rest week" for a real calendar gap and names the current season in the world label', () => {
    const world = calendarWorld();
    const state = createSeason({ world, managedClubId: world.clubs[0].id, injuryMode: 'off' });
    expect(state.activeMatch).toBeNull();
    expect(careerDay(state).label).toBe('Rest week');
    const markup = panel(state);
    expect(markup).toContain('Rest week');
    expect(markup).toContain('this week');
    expect(text(markup)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    const named = { ...state, world: { ...state.world, name: 'European domestic leagues 2026-27' } };
    expect(worldSeasonName(named)).toBe('European domestic leagues 2026-27');
    expect(worldSeasonName({ ...named, seasonNumber: 2 })).toBe('European domestic leagues 2027-28');
  });
});

describe('what holds up the next season', () => {
  const offseason = offers => ({
    seasonNumber: 1, status: 'complete', managedClubId: 'mine', date: '2027-07-03',
    market: { enabledSince: { seasonNumber: 1, round: 1 }, windows: [{ seasonNumber: 1, closed: false, openedOn: '2027-07-03', date: '2027-07-03', closesOn: '2027-07-31', offers }] },
  });
  const offer = (clubId, extra = {}) => ({ id: `${clubId}-offer`, clubId, playerId: 'p1', status: 'pending', responseOn: '2027-07-04', expiresOn: '2027-07-10', ...extra });

  it('says whose offers are open and that continuing the offseason is the next step', () => {
    const others = offseason([offer('rival')]);
    expect(getMarketStartReason(others)).toBe('Other clubs\' offers are still open. Continue the offseason to let the players answer them.');
    expect(offseasonContinueFirst(others)).toBe(true);
    expect(getMarketStartReason(offseason([offer('rival'), offer('mine')]))).toMatch(/^Your offers are still waiting for replies\. Continue the offseason/);
    expect(getMarketStartReason(offseason([offer('rival', { status: 'club-review', transfer: { sellerClubId: 'mine' } })]))).toMatch(/^Clubs are waiting for your answer/);
  });
});
