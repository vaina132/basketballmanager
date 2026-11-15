import type { SeasonState } from '../domain/season';
import { createSchedule } from './season';

/** A weekly settlement must cover the canonical games, including a week's legitimate empty leagues. */
export function requireCalendarWeek(state: SeasonState, completed: boolean): void {
  const expected = createSchedule(state.clubs, state.seasonNumber, state).filter(fixture => fixture.round === state.round);
  const actual = state.fixtures.filter(fixture => fixture.round === state.round);
  if (actual.length !== expected.length || actual.some((fixture, index) => {
    const wanted = expected[index]!;
    return fixture.id !== wanted.id || fixture.date !== wanted.date || fixture.homeClubId !== wanted.homeClubId || fixture.awayClubId !== wanted.awayClubId || (completed ? !fixture.result : !!fixture.result);
  })) throw new Error(completed ? 'Commit every scheduled game before settling this week.' : 'This calendar week is not awaiting exactly its scheduled match results.');
}
