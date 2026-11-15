import type { SeasonState } from '../domain/season';
import { scheduledFixtures } from './season';

/**
 * A weekly settlement must cover the canonical games, including a week's legitimate empty leagues. Step 3.4a: during
 * a week with several game days, the games already played are exactly those of the earlier game days.
 */
export function requireCalendarWeek(state: SeasonState, completed: boolean): void {
  const expected = scheduledFixtures(state, state.seasonNumber).filter(fixture => fixture.round === state.round);
  const actual = state.fixtures.filter(fixture => fixture.round === state.round);
  let firstPending: string | null = null;
  for (const fixture of actual) if (!fixture.result && (firstPending === null || fixture.date < firstPending)) firstPending = fixture.date;
  if (actual.length !== expected.length || actual.some((fixture, index) => {
    const wanted = expected[index]!;
    const timing = completed ? !fixture.result : !!fixture.result && (firstPending === null || fixture.date >= firstPending);
    return fixture.id !== wanted.id || fixture.date !== wanted.date || fixture.homeClubId !== wanted.homeClubId || fixture.awayClubId !== wanted.awayClubId || timing;
  })) throw new Error(completed ? 'Commit every scheduled game before settling this week.' : 'This calendar week is not awaiting exactly its scheduled match results.');
}
