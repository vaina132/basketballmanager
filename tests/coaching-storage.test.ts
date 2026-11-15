import { stripRosterHistory, withUnavailableArchivedStats } from './helpers/legacy-season';
import { beforeAll, describe, expect, it } from 'vitest';
import { SEASON_SCHEMA_VERSION } from './helpers/season-format';
import type { CoachingContract } from '../src/domain/coaching';
import type { SeasonState } from '../src/domain/season';
import { DEVELOPMENT_COACHES } from '../src/data/development-coaches';
import { setAutoSubstitutions, simulateToEnd, simulateToQuarterEnd, stepMatch } from '../src/engine/match';
import { parseSeason, serializeSeason, validateSeasonState } from '../src/storage/season-storage';
import { advanceSeason, createSeason, managedSide, rolloverSeason } from '../src/world/season';
import { COACHING_BUDGET, coachingCommitted, enableCoaching, getClubCoaching, hireCoach, releaseCoach, setCoachAssignment, setCoachRenewal } from '../src/world/coaching';
import { setTrainingPlan, TRAINING_ATTRIBUTES } from '../src/world/training';

const clubId = 'atlantic-pilots';
let initial: SeasonState, second: SeasonState, edited: SeasonState, completed: SeasonState, nextYear: SeasonState;
let legacyLive: SeasonState, legacyComplete: SeasonState;
let starterId: string, specialistId: string;
const restore = (season: SeasonState) => parseSeason(serializeSeason(season));
const finish = (season: SeasonState): SeasonState => ({ ...season, activeMatch: season.activeMatch!.status === 'finished' ? season.activeMatch! : simulateToEnd(setAutoSubstitutions(season.activeMatch!, managedSide(season), true)) });
function completeSeason(season: SeasonState): SeasonState {
  let current = season;
  while (current.status !== 'complete') current = advanceSeason(finish(current));
  return current;
}
function formatFour(season: SeasonState): string {
  const state = structuredClone(season) as unknown as Record<string, unknown>;
  state.schemaVersion = 4; delete state.coaching; delete state.finance; delete state.payroll; delete state.manager; stripRosterHistory(state);
  const training = state.training as { lastWeek: null | Record<string, unknown> };
  if (training.lastWeek) {
    delete training.lastWeek.coaching;
    for (const player of Object.values(training.lastWeek.players as Record<string, Record<string, unknown>>)) delete player.coachingGains;
  }
  return JSON.stringify({ format: 'basketball-manager-season', formatVersion: 4, engineVersion: 'possession-3', state });
}

beforeAll(() => {
  initial = createSeason(9, clubId, 'standard', true, true, false);
  starterId = getClubCoaching(initial.coaching, clubId)[0]!.id;
  initial = setCoachAssignment(initial, starterId, 'freeThrow');
  initial = hireCoach(initial, 'coach-09', 'freeThrow');
  specialistId = getClubCoaching(initial.coaching, clubId).find(contract => contract.coachId === 'coach-09')!.id;
  initial = setTrainingPlan(initial, { ...initial.training.plans[clubId]!, delegated: false, intensity: 'heavy', focus: 'freeThrow' });
  second = advanceSeason(finish(initial));
  expect(second.training.lastWeek!.players['atl-8']!.availableDays).toBe(0);
  expect(Object.values(second.training.lastWeek!.players).some(player => Object.values(player.coachingGains).some(gain => gain > 0))).toBe(true);
  edited = setCoachAssignment(second, specialistId, 'passing');
  edited = setCoachRenewal(edited, specialistId, false);
  edited = releaseCoach(edited, starterId);
  completed = completeSeason(edited); nextYear = rolloverSeason(completed);

  let legacy = createSeason(37, clubId, 'off', true, false, false);
  legacy = setTrainingPlan(legacy, { ...legacy.training.plans[clubId]!, delegated: false, intensity: 'light', focus: 'passing' });
  legacy = advanceSeason(finish(legacy));
  legacyLive = { ...legacy, activeMatch: simulateToQuarterEnd(setAutoSubstitutions(legacy.activeMatch!, managedSide(legacy), true)) };
  legacyComplete = completeSeason(legacy);
}, 60_000);

describe('coaching-aware season persistence', () => {
  it('writes format 9 with exact appointments, commitments and future instructions', () => {
    const text = serializeSeason(initial);
    expect(JSON.parse(text).formatVersion).toBe(SEASON_SCHEMA_VERSION);
    expect(restore(initial)).toEqual(initial);
    expect(coachingCommitted(restore(initial).coaching, clubId)).toBe(10_500_000);
    expect(restore(initial).activeMatch!).toEqual(initial.activeMatch!);
  });

  it('round-trips applied coach identities and actual bonus gains for every club', () => {
    const restored = restore(second), report = restored.training.lastWeek!;
    expect(restored).toEqual(second);
    expect(Object.keys(report.coaching!)).toEqual(second.clubs.map(club => club.id));
    expect(report.coaching![clubId]).toContainEqual({ contractId: specialistId, coachId: 'coach-09', focus: 'freeThrow' });
    expect(Object.values(report.players['atl-8']!.coachingGains).every(gain => gain === 0)).toBe(true);
    for (const player of Object.values(report.players)) for (const attribute of TRAINING_ATTRIBUTES) expect(player.coachingGains[attribute]).toBeLessThanOrEqual(player.gains[attribute]);
  });

  it('reconciles apportioned coaching bonuses for balanced practice', () => {
    let season = createSeason(37, clubId, 'off', true, true, false);
    season = setTrainingPlan(season, { ...season.training.plans[clubId]!, delegated: false, intensity: 'heavy', focus: 'balanced' });
    const trained = advanceSeason(finish(season));
    const club = trained.clubs.find(club => club.id === clubId)!;
    expect(trained.training.lastWeek!.coaching![clubId]!.every(assignment => assignment.focus === 'balanced')).toBe(true);
    expect(club.players.some(player => Object.values(trained.training.lastWeek!.players[player.id]!.coachingGains).some(gain => gain > 0))).toBe(true);
    expect(restore(trained)).toEqual(trained);
  });

  it('retains the historical applied focus after release, reassignment and renewal edits', () => {
    const restored = restore(edited);
    expect(restored).toEqual(edited);
    expect(restored.training.lastWeek).toEqual(second.training.lastWeek);
    expect(restored.coaching.contracts.find(contract => contract.id === starterId)!.releasedRound).toBe(2);
    expect(restored.coaching.contracts.find(contract => contract.id === specialistId)).toMatchObject({ focus: 'passing', renew: false });
    expect(restored.training.lastWeek!.coaching![clubId]!.find(assignment => assignment.contractId === specialistId)!.focus).toBe('freeThrow');
    expect(coachingCommitted(restored.coaching, clubId)).toBe(10_500_000);
    expect(advanceSeason(finish(restored))).toEqual(advanceSeason(finish(edited)));
  });

  it('preserves exact live-match RNG and the next coaching/training interval on import', () => {
    const live = { ...edited, activeMatch: simulateToQuarterEnd(setAutoSubstitutions(edited.activeMatch!, managedSide(edited), true)) };
    const restored = restore(live);
    expect(JSON.stringify(restored.activeMatch!)).toBe(JSON.stringify(live.activeMatch!));
    expect(stepMatch(restored.activeMatch!)).toEqual(stepMatch(live.activeMatch!));
    expect(advanceSeason(finish(restored))).toEqual(advanceSeason(finish(live)));
  });

  it('saves the final report and renews the next season with fresh current-year commitments', () => {
    expect(restore(completed)).toEqual(completed);
    expect(completed.training.lastWeek!.afterRound).toBe(9);
    expect(rolloverSeason(restore(completed))).toEqual(nextYear);
    expect(restore(nextYear)).toEqual(nextYear);
    expect(nextYear.training.lastWeek).toBeNull();
    expect(nextYear.coaching.enabledSince).toEqual({ seasonNumber: 1, round: 1 });
    expect(getClubCoaching(nextYear.coaching, clubId)).toHaveLength(0);
    expect(coachingCommitted(nextYear.coaching, clubId)).toBe(0);
    expect(nextYear.coaching.contracts.every((contract, index) => contract.id === `coach-s2-c${index + 1}` && contract.startedRound === 1 && contract.releasedRound === null)).toBe(true);
    expect(restore(advanceSeason(finish(nextYear))).training.lastWeek!.seasonNumber).toBe(2);
  });

  it('can enable coaching after an earlier uncoached report without rewriting that report', () => {
    const enabled = enableCoaching(parseSeason(formatFour(legacyLive)));
    expect(enabled.coaching.enabledSince).toEqual({ seasonNumber: 1, round: 2 });
    expect(enabled.training.lastWeek!.coaching).toBeNull();
    expect(restore(enabled)).toEqual(enabled);
    expect(enabled.activeMatch!).toEqual(legacyLive.activeMatch!);
    expect(restore(advanceSeason(finish(enabled))).training.lastWeek!.coaching).not.toBeNull();
  });

  it('preserves a rehire in the same round without losing the released contract commitment', () => {
    const released = releaseCoach(initial, starterId), coach = initial.coaching.contracts.find(contract => contract.id === starterId)!.coachId;
    const rehired = hireCoach(released, coach, 'defense');
    expect(coachingCommitted(rehired.coaching, clubId)).toBe(14_500_000);
    expect(restore(rehired)).toEqual(rehired);
    expect(rehired.coaching.contracts.filter(contract => contract.coachId === coach)).toHaveLength(2);
  });
});

describe('format 4 migration without coaching side effects', () => {
  it.each(['live', 'complete'] as const)('migrates a real %s training save with unchanged match and development outcomes', boundary => {
    const original = boundary === 'live' ? legacyLive : legacyComplete;
    const text = formatFour(original), snapshot = JSON.parse(text).state;
    const restored = parseSeason(text);
    expect(restored).toEqual(withUnavailableArchivedStats(original));
    expect(restored.coaching).toEqual({ model: 'coaching-1', enabledSince: null, contracts: [] });
    expect(restored.training.plans).toEqual(snapshot.training.plans);
    expect(restored.training.points).toEqual(snapshot.training.points);
    expect(JSON.stringify(restored.activeMatch!)).toBe(JSON.stringify(snapshot.activeMatch!));
    for (const [id, report] of Object.entries(restored.training.lastWeek!.players)) {
      expect(report.gains).toEqual(snapshot.training.lastWeek.players[id].gains);
      expect(Object.values(report.coachingGains).every(gain => gain === 0)).toBe(true);
    }
    expect(restored.training.lastWeek!.coaching).toBeNull();
    expect(JSON.parse(text).state).toEqual(snapshot);
    if (boundary === 'live') expect(advanceSeason(finish(restored))).toEqual(advanceSeason(finish(withUnavailableArchivedStats(original))));
    else expect(rolloverSeason(restored)).toEqual(rolloverSeason(withUnavailableArchivedStats(original)));
  });

  it('migrates a later-year format 4 save with its archive and activation anchor intact', () => {
    const later = rolloverSeason(legacyComplete), restored = parseSeason(formatFour(later));
    expect(restored).toEqual(withUnavailableArchivedStats(later));
    expect(restored.history).toHaveLength(1);
    expect(restored.training.enabledSince).toEqual({ seasonNumber: 1, round: 1 });
    expect(restored.coaching.enabledSince).toBeNull();
    expect(advanceSeason(finish(restored))).toEqual(advanceSeason(finish(withUnavailableArchivedStats(later))));
  });

  it.each(['extra staff field', 'extra report staff field', 'extra bonus field', 'invalid original gain'] as const)('rejects format 4 %s before migration', change => {
    const envelope = JSON.parse(formatFour(legacyLive));
    if (change === 'extra staff field') envelope.state.coaching = initial.coaching;
    if (change === 'extra report staff field') envelope.state.training.lastWeek.coaching = null;
    if (change === 'extra bonus field') envelope.state.training.lastWeek.players['atl-9'].coachingGains = {};
    if (change === 'invalid original gain') envelope.state.training.lastWeek.players['atl-9'].gains.passing += 1;
    expect(() => parseSeason(JSON.stringify(envelope))).toThrow();
  });

  it('rejects a coached report disguised as format 4 instead of discarding the bonus history', () => {
    expect(() => parseSeason(formatFour(second))).toThrow();
  });
});

describe('strict coaching contract and training provenance validation', () => {
  const mutations: Array<[string, (season: SeasonState) => void]> = [
    ['missing coaching', season => { delete (season as Partial<SeasonState>).coaching; }],
    ['unknown model', season => { Object.assign(season.coaching, { model: 'coaching-2' }); }],
    ['extra metadata', season => { Object.assign(season.coaching, { balance: 0 }); }],
    ['disabled anchor with appointments', season => { season.coaching.enabledSince = null; }],
    ['future activation season', season => { season.coaching.enabledSince!.seasonNumber = 2; }],
    ['future activation round', season => { season.coaching.enabledSince!.round = 3; }],
    ['fractional activation', season => { season.coaching.enabledSince!.round = 1.5; }],
    ['extra activation metadata', season => { Object.assign(season.coaching.enabledSince!, { date: season.date }); }],
    ['unknown coach', season => { season.coaching.contracts[0]!.coachId = 'missing'; }],
    ['unknown club', season => { season.coaching.contracts[0]!.clubId = 'missing'; }],
    ['duplicate coach appointment', season => { season.coaching.contracts[1]!.coachId = season.coaching.contracts[0]!.coachId; }],
    ['duplicate contract identity', season => { season.coaching.contracts[1]!.id = season.coaching.contracts[0]!.id; }],
    ['wrong contract year', season => { season.coaching.contracts[0]!.seasonNumber = 2; }],
    ['future start', season => { season.coaching.contracts[0]!.startedRound = 3; }],
    ['invalid start', season => { season.coaching.contracts[0]!.startedRound = 0; }],
    ['release before hiring', season => { season.coaching.contracts[0]!.releasedRound = 0; }],
    ['future release', season => { season.coaching.contracts[0]!.releasedRound = 3; }],
    ['unknown assignment', season => { Object.assign(season.coaching.contracts[0]!, { focus: 'dunking' }); }],
    ['invalid renewal', season => { Object.assign(season.coaching.contracts[0]!, { renew: 1 }); }],
    ['invented discount', season => { Object.assign(season.coaching.contracts[0]!, { fee: 0 }); }],
    ['missing report assignments', season => { delete (season.training.lastWeek as unknown as Record<string, unknown>).coaching; }],
    ['null report after activation', season => { season.training.lastWeek!.coaching = null; }],
    ['missing snapshot club', season => { delete season.training.lastWeek!.coaching![clubId]; }],
    ['missing assigned coach', season => { season.training.lastWeek!.coaching![clubId]!.pop(); }],
    ['duplicate snapshot coach', season => { season.training.lastWeek!.coaching![clubId]![1] = { ...season.training.lastWeek!.coaching![clubId]![0]! }; }],
    ['wrong snapshot coach identity', season => { season.training.lastWeek!.coaching![clubId]![0]!.coachId = 'coach-01'; }],
    ['wrong snapshot contract', season => { season.training.lastWeek!.coaching![clubId]![0]!.contractId = 'coach-s2-c1'; }],
    ['unknown snapshot focus', season => { Object.assign(season.training.lastWeek!.coaching![clubId]![0]!, { focus: 'dunking' }); }],
    ['altered frozen assignment', season => { season.training.lastWeek!.coaching![clubId]!.find(item => item.contractId === specialistId)!.focus = 'passing'; }],
    ['missing bonus map', season => { delete (season.training.lastWeek!.players['atl-9'] as unknown as Record<string, unknown>).coachingGains; }],
    ['foreign bonus attribute', season => { Object.assign(season.training.lastWeek!.players['atl-9']!.coachingGains, { dunking: 1 }); }],
    ['negative bonus', season => { season.training.lastWeek!.players['atl-9']!.coachingGains.freeThrow = -1; }],
    ['fractional bonus', season => { season.training.lastWeek!.players['atl-9']!.coachingGains.freeThrow = 1.5; }],
    ['bonus above weekly limit', season => { season.training.lastWeek!.players['atl-9']!.coachingGains.freeThrow = 9; }],
    ['altered bonus attribution', season => { season.training.lastWeek!.players['atl-9']!.coachingGains.freeThrow = 0; }],
    ['bonus despite full injury absence', season => { season.training.lastWeek!.players['atl-8']!.coachingGains.freeThrow = 1; }],
    ['unreconciled total practice', season => { season.training.points['atl-9']!.freeThrow += 1; }],
  ];
  it.each(mutations)('rejects %s without modifying the valid save', (_name, mutate) => {
    const damaged = structuredClone(second), before = structuredClone(second);
    mutate(damaged);
    expect(() => validateSeasonState(damaged)).toThrow();
    expect(second).toEqual(before);
  });

  it('counts released fees toward the annual limit even when no extra active slots are used', () => {
    const damaged = structuredClone(edited);
    while (coachingCommitted(damaged.coaching, clubId) <= COACHING_BUDGET) damaged.coaching.contracts.push({ id: `coach-s1-c${damaged.coaching.contracts.length + 1}`, coachId: 'coach-25', clubId, seasonNumber: 1, startedRound: 2, releasedRound: 2, focus: 'balanced', renew: false });
    expect(() => validateSeasonState(damaged)).toThrow(/annual coaching budget/);
  });

  it('rejects four simultaneous coaches even when their combined fees fit the budget', () => {
    const damaged = createSeason(17, clubId, 'off', true, true, false);
    damaged.coaching.contracts = DEVELOPMENT_COACHES.slice(-4).map((coach, index): CoachingContract => ({ id: `coach-s1-c${index + 1}`, coachId: coach.id, clubId, seasonNumber: 1, startedRound: 1, releasedRound: null, focus: 'balanced', renew: true }));
    expect(coachingCommitted(damaged.coaching, clubId)).toBeLessThanOrEqual(COACHING_BUDGET);
    expect(() => validateSeasonState(damaged)).toThrow(/staff limit/);
  });

  it('rejects historical overlap even after the duplicate coach has been released', () => {
    const damaged = structuredClone(edited), source = damaged.coaching.contracts[0]!;
    damaged.coaching.contracts[1]!.coachId = source.coachId;
    damaged.coaching.contracts[1]!.releasedRound = 2;
    expect(() => validateSeasonState(damaged)).toThrow(/simultaneous/);
  });

  it('requires zero coaching attribution when an old training save has coaching disabled', () => {
    const damaged = parseSeason(formatFour(legacyLive));
    damaged.training.lastWeek!.players['atl-9']!.coachingGains.passing = 1;
    expect(() => validateSeasonState(damaged)).toThrow(/reconcile/);
  });
});
