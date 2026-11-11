import { stripRosterHistory, withUnavailableArchivedStats } from './helpers/legacy-season';
import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { setAutoSubstitutions, simulateToEnd, simulateToQuarterEnd, stepMatch } from '../src/engine/match';
import { parseSeason, serializeSeason, validateSeasonState } from '../src/storage/season-storage';
import { advanceSeason, createSeason, managedSide, rolloverSeason } from '../src/world/season';
import { createTraining, developClub, enableTraining, setTrainingPlan } from '../src/world/training';

const clubId = 'atlantic-pilots';
let second: SeasonState, complete: SeasonState, nextYear: SeasonState, legacyLive: SeasonState, legacyNextYear: SeasonState;
const restore = (season: SeasonState): SeasonState => parseSeason(serializeSeason(season));
const finish = (season: SeasonState): SeasonState => ({ ...season, activeMatch: season.activeMatch.status === 'finished' ? season.activeMatch : simulateToEnd(setAutoSubstitutions(season.activeMatch, managedSide(season), true)) });
function oldFormat(season: SeasonState, version: 1 | 2 | 3): string {
  const state = structuredClone(season) as unknown as Record<string, unknown>;
  state.schemaVersion = version; delete state.training; delete state.coaching; delete state.finance; delete state.payroll; delete state.manager; stripRosterHistory(state);
  if (version < 3) { delete state.seasonNumber; delete state.history; }
  if (version === 1) {
    delete state.injuryMode; delete state.injuries;
    for (const fixture of state.fixtures as Array<{ result: Record<string, unknown> | null }>) if (fixture.result) delete fixture.result.injuries;
  }
  return JSON.stringify({ format: 'basketball-manager-season', formatVersion: version, engineVersion: 'possession-3', state });
}

beforeAll(() => {
  let season = createSeason(9, clubId, 'standard', true, false, false);
  season = setTrainingPlan(season, { ...season.training.plans[clubId]!, delegated: false, intensity: 'heavy', focus: 'freeThrow' });
  second = advanceSeason(finish(season));
  expect(second.training.lastWeek!.players['atl-8']!.availableDays).toBe(0);
  season = second;
  while (season.status !== 'complete') season = restore(advanceSeason(finish(season)));
  complete = season; nextYear = rolloverSeason(complete);

  let legacy = advanceSeason(finish(createSeason(37, clubId, 'off', false, false, false)));
  legacyLive = { ...legacy, activeMatch: simulateToQuarterEnd(setAutoSubstitutions(legacy.activeMatch, managedSide(legacy), true)) };
  while (legacy.status !== 'complete') legacy = advanceSeason(finish(legacy));
  legacyNextYear = rolloverSeason(legacy);
}, 60_000);

describe('training-aware season saves', () => {
  it.each([true, false])('round-trips format 8 with training enabled=%s', enabled => {
    const season = createSeason(7, clubId, 'off', enabled, false, false), text = serializeSeason(season);
    expect(JSON.parse(text).formatVersion).toBe(24);
    expect(restore(season)).toEqual(season);
    expect(season.training.enabledSince !== null).toBe(enabled);
  });

  it('reconciles weekly progress, condition and absence from actual committed matches', () => {
    const restored = restore(second), report = restored.training.lastWeek!;
    expect(restored).toEqual(second);
    expect(report).toMatchObject({ seasonNumber: 1, afterRound: 1, fromDate: '2026-09-05', toDate: '2026-09-12' });
    expect(report.players['atl-8']!.availableDays).toBe(0);
    expect(Object.values(report.players['atl-8']!.gains).every(points => points === 0)).toBe(true);
    expect(restored.activeMatch.preExistingInjuries).toContain('atl-8');
    for (const [id, result] of Object.entries(report.players)) expect(restored.conditions[id]).toBe(result.conditionAfter);
  });

  it('retains improved match attributes while keeping the authored club pack canonical', () => {
    const restored = restore(complete), club = restored.clubs.find(club => club.id === clubId)!;
    expect(restored).toEqual(complete);
    const projected = developClub(club, restored.training);
    expect(projected.players.some((player, index) => player.attributes.freeThrow > club.players[index]!.attributes.freeThrow)).toBe(true);
    expect(restored.activeMatch[managedSide(restored)]).toEqual(projected);
    expect(restored.training.lastWeek!.afterRound).toBe(9);
    expect(restored.training.lastWeek!.players['atl-9']!.conditionAfter).not.toBe(restored.conditions['atl-9']);
  });

  it('allows editing the upcoming plan without rewriting the applied weekly report', () => {
    const report = structuredClone(second.training.lastWeek);
    const changed = setTrainingPlan(second, { ...second.training.plans[clubId]!, intensity: 'light', focus: 'defense', individual: { ...second.training.plans[clubId]!.individual, 'atl-9': 'passing' } });
    expect(restore(changed)).toEqual(changed);
    expect(changed.training.lastWeek).toEqual(report);
    expect(changed.training.lastWeek!.plans[clubId]!.intensity).toBe('heavy');
  });

  it('resumes a trained live match and the next training boundary with identical RNG outcomes', () => {
    const live = { ...second, activeMatch: simulateToQuarterEnd(setAutoSubstitutions(second.activeMatch, managedSide(second), true)) };
    const restored = restore(live);
    expect(stepMatch(restored.activeMatch)).toEqual(stepMatch(live.activeMatch));
    expect(advanceSeason(finish(restored))).toEqual(advanceSeason(finish(live)));
  });

  it('preserves long-term progress across rollover without retaining a stale weekly report', () => {
    const restored = restore(nextYear);
    expect(restored.training.points).toEqual(complete.training.points);
    expect(restored.training.enabledSince).toEqual({ seasonNumber: 1, round: 1 });
    expect(restored.training.lastWeek).toBeNull();
    expect(Object.values(restored.conditions).every(condition => condition === 100)).toBe(true);
    expect(restore(advanceSeason(finish(restored))).training.lastWeek).toMatchObject({ seasonNumber: 2, afterRound: 1 });
  });

  it('enables a migrated game prospectively without changing the prepared match', () => {
    const migrated = parseSeason(oldFormat(legacyLive, 3)), enabled = enableTraining(migrated);
    expect(enabled.training.enabledSince).toEqual({ seasonNumber: 1, round: 2 });
    expect(enabled.training.lastWeek).toBeNull();
    expect(restore(enabled).activeMatch).toEqual(legacyLive.activeMatch);
    const trained = restore(advanceSeason(finish(enabled)));
    expect(trained.training.lastWeek).toMatchObject({ seasonNumber: 1, afterRound: 2 });
  });
});

describe('strict older format migration', () => {
  it.each([1, 2, 3] as const)('migrates format %s with training off and unchanged future simulation', version => {
    const text = oldFormat(legacyLive, version), snapshot = JSON.parse(text).state;
    const restored = parseSeason(text);
    expect(restored).toEqual(legacyLive);
    expect(restored.training).toEqual(createTraining(restored.clubs, false));
    expect(restored.activeMatch).toEqual(snapshot.activeMatch);
    expect(stepMatch(restored.activeMatch)).toEqual(stepMatch(legacyLive.activeMatch));
    expect(advanceSeason(finish(restored))).toEqual(advanceSeason(finish(legacyLive)));
    expect(JSON.parse(text).state).toEqual(snapshot);
  });

  it('migrates a later format 3 career without discarding its archive or activating training', () => {
    const restored = parseSeason(oldFormat(legacyNextYear, 3));
    expect(restored).toEqual(withUnavailableArchivedStats(legacyNextYear));
    expect(restored.history).toHaveLength(1);
    expect(restored.training.enabledSince).toBeNull();
    expect(advanceSeason(finish(restored))).toEqual(advanceSeason(finish(withUnavailableArchivedStats(legacyNextYear))));
  });

  it.each([1, 2, 3] as const)('validates original format %s fields before adding training defaults', version => {
    const envelope = JSON.parse(oldFormat(legacyLive, version));
    envelope.state.training = createTraining(legacyLive.clubs, false);
    expect(() => parseSeason(JSON.stringify(envelope))).toThrow(/unsupported fields/);
    delete envelope.state.training;
    envelope.state.fixtures[0].result.stats[legacyLive.clubs[0]!.players[0]!.id].condition = -1;
    expect(() => parseSeason(JSON.stringify(envelope))).toThrow();
  });

  it('rejects developed squads disguised as an old format rather than silently losing their growth', () => {
    expect(() => parseSeason(oldFormat(complete, 3))).toThrow(/squads/);
  });
});

describe('training state and report tampering', () => {
  const cases: Array<[string, (season: SeasonState) => void]> = [
    ['unknown training model', season => { Object.assign(season.training, { model: 'training-2' }); }],
    ['unknown field', season => { Object.assign(season.training, { coachBonus: 1 }); }],
    ['missing club plan', season => { delete season.training.plans[clubId]; }],
    ['foreign player instruction', season => { season.training.plans[clubId]!.individual.missing = 'passing'; }],
    ['unknown focus', season => { Object.assign(season.training.plans[clubId]!, { focus: 'dunking' }); }],
    ['unknown intensity', season => { Object.assign(season.training.plans[clubId]!, { intensity: 'extreme' }); }],
    ['non-boolean delegation', season => { Object.assign(season.training.plans[clubId]!, { delegated: 1 }); }],
    ['missing progress player', season => { delete season.training.points['atl-8']; }],
    ['unknown progress attribute', season => { Object.assign(season.training.points['atl-9']!, { dunking: 3 }); }],
    ['fractional progress', season => { season.training.points['atl-9']!.freeThrow = 1.5; }],
    ['excessive progress', season => { season.training.points['atl-9']!.freeThrow = 201; }],
    ['negative progress', season => { season.training.points['atl-9']!.freeThrow = -1; }],
    ['development before first enabled week', season => { season.training.points['atl-8']!.passing = 1; }],
    ['future activation year', season => { season.training.enabledSince!.seasonNumber = 2; }],
    ['future activation round', season => { season.training.enabledSince!.round = 3; }],
    ['disabled training with retained progress', season => { season.training.enabledSince = null; }],
    ['missing completed weekly report', season => { season.training.lastWeek = null; }],
    ['wrong report year', season => { season.training.lastWeek!.seasonNumber = 2; }],
    ['wrong report interval', season => { season.training.lastWeek!.afterRound = 2; }],
    ['wrong report starting date', season => { season.training.lastWeek!.fromDate = '2026-09-04'; }],
    ['wrong report ending date', season => { season.training.lastWeek!.toDate = '2026-09-13'; }],
    ['missing report player', season => { delete season.training.lastWeek!.players['atl-8']; }],
    ['altered injury eligibility', season => { season.training.lastWeek!.players['atl-8']!.availableDays = 7; }],
    ['altered report gain', season => { season.training.lastWeek!.players['atl-9']!.gains.freeThrow -= 1; }],
    ['altered applied focus', season => { season.training.lastWeek!.players['atl-9']!.focus = 'passing'; }],
    ['altered applied plan', season => { season.training.lastWeek!.plans[clubId]!.intensity = 'recovery'; }],
    ['invented pre-training condition', season => { season.training.lastWeek!.players['atl-9']!.conditionBefore -= 1; }],
    ['invented post-training condition', season => { season.training.lastWeek!.players['atl-9']!.conditionAfter -= 1; }],
    ['incorrect world condition', season => { season.conditions['atl-9']! -= 1; }],
    ['altered projected match attribute', season => { const player = season.activeMatch[managedSide(season)].players[0]!; Object.assign(player.attributes, { freeThrow: player.attributes.freeThrow + 1 }); }],
    ['altered canonical club attribute', season => { const player = season.clubs[0]!.players[0]!; Object.assign(player.attributes, { freeThrow: player.attributes.freeThrow + 1 }); }],
  ];
  it.each(cases)('rejects %s without mutating the original game', (_name, mutate) => {
    const damaged = structuredClone(second), original = structuredClone(second);
    mutate(damaged);
    expect(() => validateSeasonState(damaged)).toThrow();
    expect(second).toEqual(original);
  });

  it('rejects a stale weekly report carried into a new season', () => {
    const damaged = structuredClone(nextYear);
    damaged.training.lastWeek = structuredClone(complete.training.lastWeek);
    expect(() => validateSeasonState(damaged)).toThrow(/after rollover/);
  });

  it('rejects progression while training is disabled even with no report', () => {
    const disabled = createSeason(7, clubId, 'off', false, false, false);
    disabled.training.points['atl-9']!.passing = 1;
    expect(() => validateSeasonState(disabled)).toThrow(/training weeks/);
  });

});
