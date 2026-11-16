import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import type { SeasonEndOutlook } from '../src/world/career-policy';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { setEmploymentDelegation } from '../src/world/employment';
import { advanceMarket } from '../src/world/market';
import { getMarketStartReason, getNextMarketDate } from '../src/world/market-policy';
import { advanceSeason, createSeason, dateForRound, managedSide, midSeasonDismissalPossible, NEW_CAREER_SYSTEMS, previewSeasonEnd, rolloverSeason } from '../src/world/season';
import { continueAction } from '../src/world/continue-step';
import { gameDate } from '../src/ui/career-text';
import { continueNotice, continueProgress, continueStepView, continueUntilStop, stoppedRun, type ContinueRun } from '../src/ui/continue-run';
// @ts-expect-error: a plain JavaScript helper shared with the European competition tests (no type declarations).
import { placesWorld } from './helpers/europe-worlds.js';

// The board's season-end preview is replaced in one test to stand for a dismissal; every other call runs the real rules.
vi.mock(import('../src/world/season'), async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, previewSeasonEnd: vi.fn(actual.previewSeasonEnd), midSeasonDismissalPossible: vi.fn(actual.midSeasonDismissalPossible) };
});

/** The manager watches or simulates the prepared match (as on the match screen). */
const finish = (state: SeasonState): SeasonState => state.activeMatch && state.activeMatch.status !== 'finished'
  ? { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) } : state;
/** One press of the buttons before the one Continue (16 November 2026): Continue, Continue offseason or Start season. */
const press = (state: SeasonState, decision?: { moveTo: string }): SeasonState => state.status === 'active' ? advanceSeason(finish(state), decision)
  : getMarketStartReason(state) && getNextMarketDate(state) ? advanceMarket(state) : rolloverSeason(state);

/**
 * Continue from `state` until `done`, next to the same presses made one at a time: after every run both reach the same
 * career. A prepared match is simulated, the board's choice is answered by staying, every other stop is continued.
 */
function compareRuns(state: SeasonState, done: (state: SeasonState, run: ContinueRun) => boolean, options: { maxRuns?: number } = {}) {
  const runs: ContinueRun[] = [];
  let current = state, pressed = state, decided = false;
  for (let index = 0; index < (options.maxRuns ?? 200); index += 1) {
    const run = continueUntilStop(finish(current), decided ? { decided: true } : {});
    for (let step = 0; step < run.steps; step += 1) pressed = press(pressed);
    expect(run.state).toEqual(pressed);
    expect(run.stop).not.toBeNull();
    expect(run.stop!.kind).not.toBe('error');
    runs.push(run);
    decided = run.stop!.kind === 'decision' && !!run.outlook;
    current = run.state;
    if (done(current, run)) break;
  }
  return { runs, state: current };
}

describe('the one Continue (owner request, 16 November 2026)', () => {
  it('plays game day by game day through weeks with midweek European days and stops on each of the manager\'s games', () => {
    const world = placesWorld(), clubId = world.clubs[2].id;
    const opening = createSeason({ world, seed: 31, managedClubId: clubId, injuryMode: 'off' });
    const { runs, state } = compareRuns(opening, current => current.round >= 9);
    // Every stop here is the manager's next game, prepared and not yet played.
    for (const run of runs) {
      expect(run.stop).toMatchObject({ kind: 'match', page: 'match' });
      expect(run.state.activeMatch?.status).toBe('ready');
      expect(continueAction(run.state)).toEqual({ kind: 'match' });
    }
    // Runs pass several game days without stopping, midweek European days among them.
    expect(runs.some(run => run.steps > 1)).toBe(true);
    const midweek = state.fixtures.filter(fixture => fixture.result && fixture.competition && fixture.date !== dateForRound(fixture.round));
    expect(midweek.length).toBeGreaterThan(0);
    const managedMidweek = state.fixtures.some(fixture => fixture.result && fixture.competition && [fixture.homeClubId, fixture.awayClubId].includes(clubId));
    expect(managedMidweek).toBe(true);
  }, 120_000);

  it('describes each step for the progress display and words the stop once', () => {
    const world = placesWorld(), clubId = world.clubs[2].id;
    let state = createSeason({ world, seed: 31, managedClubId: clubId, injuryMode: 'off' });
    // The first run that passes a midweek day of European games without the manager's club.
    for (let index = 0; index < 20; index += 1) {
      const start = finish(state);
      const view = continueStepView(start);
      expect(view.label).toMatch(/^Your game/);
      expect(continueProgress(start, 0)).toBe(0);
      const run = continueUntilStop(start, { maxSteps: 1 });
      state = run.state;
      if (run.stop) continue;
      const next = continueStepView(state);
      expect(next.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(next.label).toMatch(/^\d+ (European )?games?( · weekly club business)?$|^Weekly club business$/);
      // Stopped by the manager after this day: where the career stands and what Continue does next.
      expect(stoppedRun(state)).toEqual({ kind: 'stopped', message: `Stopped. Next: ${next.label.charAt(0).toLowerCase()}${next.label.slice(1)} on ${gameDate(next.day)}.` });
      expect(stoppedRun(state).message).toMatch(/^Stopped\. Next: \d+ (European )?games?( · weekly club business)? on (Tue|Wed|Thu) \d+ \w+\.$/);
      const progress = continueProgress(state, 1);
      expect(progress).toBeGreaterThan(0);
      expect(progress).toBeLessThan(1);
      const rest = continueUntilStop(state);
      expect(rest.stop!.kind).toBe('match');
      expect(continueNotice(start, rest.state, rest.stop!)).toMatch(/Your next game is ready: \w{3} \d+ \w+ vs .+ \((home|away)(, Test euro(league|cup))?\)\.$/);
      return;
    }
    throw new Error('No run passed a day without the manager\'s game.');
  }, 120_000);
});

describe('Continue through a season end, the offseason and the next season', () => {
  let seasonEnd: SeasonState;
  let seasonRuns: ContinueRun[];
  beforeAll(() => {
    const opening = createSeason({ seed: 5, managedClubId: 'rhine-falcons', injuryMode: 'standard', ...NEW_CAREER_SYSTEMS });
    const result = compareRuns(opening, current => current.status === 'complete');
    seasonEnd = result.state; seasonRuns = result.runs;
  }, 300_000);

  it('reaches the same season end as one press at a time and stops there for recruitment', () => {
    expect(seasonRuns.at(-1)!.stop).toMatchObject({ kind: 'season-end', page: 'transfers' });
    expect(seasonRuns.at(-1)!.stop!.message).toMatch(/^Season complete\. .+ Make offers for next season in Transfers; Continue moves through the offseason\.$/);
    expect(seasonEnd.status).toBe('complete');
  });

  it('moves through recruitment days to the start, starts the season and reaches the same career as before', () => {
    // Delegated recruitment fills the squad without the manager's offers.
    const delegated = setEmploymentDelegation(seasonEnd, true);
    const { runs, state } = compareRuns(delegated, current => current.seasonNumber === 2 && current.round >= 3);
    const kinds = runs.map(run => run.stop!.kind);
    const start = kinds.indexOf('season-start');
    expect(start).toBeGreaterThan(-1);
    // The last recruitment day stops the run and says that the season can start (with any news of that day first).
    expect(runs[start - 1]!.stop!.message).toMatch(/Recruitment is complete: 2027\/28 can start\. Continue starts it\.$/);
    expect(runs[start - 1]!.state.status).toBe('complete');
    expect(runs[start]!.steps).toBe(1);
    expect(state.seasonNumber).toBe(2);
  }, 300_000);

  it('stops after each recruitment day while the manager\'s squad is short', () => {
    const run = continueUntilStop(seasonEnd);
    expect(run.steps).toBe(1);
    expect(run.stop).toMatchObject({ kind: 'decision', page: 'transfers' });
    expect(run.stop!.message).toMatch(/^Your squad needs \d+ more signed players? for next season\./);
    expect(run.state).toEqual(advanceMarket(seasonEnd));
  }, 60_000);
});

describe('a decision before the week is committed', () => {
  it('stops before a dismissal is committed and commits the week with the manager\'s answer', () => {
    const world = placesWorld();
    const state = finish(createSeason({ world, seed: 31, managedClubId: world.clubs[2].id, injuryMode: 'off' }));
    const outlook = { timing: 'mid-season', dismissed: true, offers: [], unemployment: true } as unknown as SeasonEndOutlook;
    vi.mocked(midSeasonDismissalPossible).mockReturnValueOnce(true);
    vi.mocked(previewSeasonEnd).mockReturnValueOnce(outlook);
    const stopped = continueUntilStop(state);
    expect(stopped).toMatchObject({ steps: 0, state, stop: { kind: 'decision' }, outlook });
    // Answered (here: staying), the run commits the week as Continue did after the choice.
    const answered = continueUntilStop(state, { decided: true, maxSteps: 1 });
    expect(answered.steps).toBe(1);
    expect(answered.state).toEqual(advanceSeason(state));
  }, 60_000);

  it('opens the prepared match instead of stepping past it', () => {
    const world = placesWorld();
    const state = createSeason({ world, seed: 31, managedClubId: world.clubs[2].id, injuryMode: 'off' });
    expect(continueAction(state)).toEqual({ kind: 'match' });
    expect(continueUntilStop(state)).toMatchObject({ steps: 0, state, stop: { kind: 'match', page: 'match' } });
  });
});
