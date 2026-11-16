import type { SeasonState } from '../domain/season';
import type { YouthFixture, YouthFixtureFull, YouthFixtureOutcome } from '../domain/youth-competition';
import { managedClubFor } from './career';

type YouthHistoryState = Pick<SeasonState, 'seasonNumber' | 'managedClubId' | 'career' | 'youthCompetition'>;

/** Shared retention decisions for rollover, migration and strict historical replay. */
export interface YouthHistoryContext {
  readonly seasonNumber: number;
  readonly latestCompletedFixtureByClub: ReadonlyMap<string, string>;
  readonly managedClubBySeason: ReadonlyMap<number, string>;
}

export function isYouthOutcome(fixture: YouthFixture): fixture is YouthFixtureOutcome {
  return 'detail' in fixture && fixture.detail === 'outcome';
}

/** Build once per operation, including each club's latest completed fixture across season boundaries. */
export function createYouthHistoryContext(state: YouthHistoryState): YouthHistoryContext {
  const latestCompletedFixtureByClub = new Map<string, string>(), managedClubBySeason = new Map<number, string>();
  for (const season of state.youthCompetition.seasons) {
    managedClubBySeason.set(season.seasonNumber, managedClubFor(state, season.seasonNumber, false));
    for (const fixture of season.fixtures) if (fixture.result) {
      latestCompletedFixtureByClub.set(fixture.homeClubId, fixture.id);
      latestCompletedFixtureByClub.set(fixture.awayClubId, fixture.id);
    }
  }
  return { seasonNumber: state.seasonNumber, latestCompletedFixtureByClub, managedClubBySeason };
}

/** Current seasons, historically managed clubs and both clubs' latest results keep their frozen squads. */
export function canSummarizeYouthFixture(context: YouthHistoryContext, fixture: YouthFixture): boolean {
  const managedClubId = context.managedClubBySeason.get(fixture.seasonNumber);
  return fixture.result !== null && fixture.seasonNumber < context.seasonNumber
    && fixture.homeClubId !== managedClubId && fixture.awayClubId !== managedClubId
    && fixture.id !== context.latestCompletedFixtureByClub.get(fixture.homeClubId)
    && fixture.id !== context.latestCompletedFixtureByClub.get(fixture.awayClubId);
}

/** Project verified frozen inputs only; retain every statistic, diagnosis and unplayed result unchanged. */
export function summarizeYouthFixture(fixture: YouthFixtureFull): YouthFixtureOutcome {
  if (!fixture.result || !fixture.home || !fixture.away) throw new Error('Only a settled youth fixture with frozen squads can become an outcome.');
  return {
    ...fixture, detail: 'outcome', home: null, away: null, startingConditions: null,
    playerIds: { home: fixture.home.players.map(player => player.id), away: fixture.away.players.map(player => player.id) },
    result: fixture.result,
  };
}

/** Replace only redundant old rival inputs. Results, academy boundaries and source objects remain unchanged. */
export function summarizeYouthHistory(state: SeasonState): SeasonState {
  if (!state.youthCompetition.seasons.length) return state;
  const context = createYouthHistoryContext(state);
  let changed = false;
  const seasons = state.youthCompetition.seasons.map(season => {
    let seasonChanged = false;
    const fixtures = season.fixtures.map(fixture => {
      // Format 73: a sealed result (`detail: 'season'`) has no squads left to project.
      if (isYouthOutcome(fixture) || 'detail' in fixture || !canSummarizeYouthFixture(context, fixture)) return fixture;
      seasonChanged = true;
      return summarizeYouthFixture(fixture);
    });
    if (!seasonChanged) return season;
    changed = true;
    return { ...season, fixtures };
  });
  return changed ? { ...state, youthCompetition: { ...state.youthCompetition, seasons } } : state;
}
