import type { SeasonState } from '../../src/domain/season';

/** Recreate the actual pre-roster schema, including the archive data those versions discarded. */
export function stripRosterHistory(state: Record<string, unknown>): void {
  delete state.market;
  delete state.negotiations;
  delete state.scouting;
  delete state.employment;
  delete state.rosters;
  for (const fixture of state.fixtures as Array<{ result: Record<string, unknown> | null }>) if (fixture.result) delete fixture.result.rosterIds;
  for (const archive of (state.history ?? []) as Array<{ rosters?: unknown; fixtures: Array<{ result: Record<string, unknown> }> }>) {
    delete archive.rosters;
    for (const fixture of archive.fixtures) { delete fixture.result.rosterIds; delete fixture.result.stats; }
  }
  const training = state.training as { lastWeek: Record<string, unknown> | null } | undefined;
  if (training?.lastWeek) delete training.lastWeek.rosterIds;
}

/** Past player statistics cannot be recovered from an old-format archive. */
export function withUnavailableArchivedStats(state: SeasonState): SeasonState {
  return { ...state, history: state.history.map(archive => ({ ...archive, fixtures: archive.fixtures.map(fixture => ({ ...fixture, result: { ...fixture.result, stats: null } })) })) };
}
