import { stripRosterHistory, withUnavailableArchivedStats } from './helpers/legacy-season';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ManagerProfile } from '../src/domain/manager';
import type { SeasonState } from '../src/domain/season';
import { DEVELOPMENT_START_DATE } from '../src/data/development-league';
import { setAutoSubstitutions, simulateToEnd, simulateToQuarterEnd, stepMatch } from '../src/engine/match';
import { parseSeason, serializeSeason, validateSeasonState } from '../src/storage/season-storage';
import { managerAge, MAX_MANAGER_NAME_LENGTH, MAX_MANAGER_NATIONALITY_LENGTH, setManagerProfile, validateManagerProfile } from '../src/world/manager';
import { advanceSeason, createSeason, managedSide, rolloverSeason } from '../src/world/season';

const clubId = 'atlantic-pilots';
const profile: ManagerProfile = { name: 'Anıl Türkmen', dateOfBirth: '1990-02-28', nationality: 'Turkish' };
const oldest: ManagerProfile = { ...profile, dateOfBirth: '1925-09-06' };
const finish = (state: SeasonState): SeasonState => state.activeMatch.status === 'finished' ? state : { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) };
function completeSeason(state: SeasonState): SeasonState { while (state.status !== 'complete') state = advanceSeason(finish(state)); return state; }
function legacyText(season: SeasonState, version: number): string {
  const state = structuredClone(season) as unknown as Record<string, unknown>;
  state.schemaVersion = version; delete state.manager; stripRosterHistory(state);
  if (version < 7) {
    delete state.payroll;
    for (const entry of (state.finance as { ledger: Record<string, unknown>[] }).ledger) delete entry.payroll;
  }
  if (version < 6) delete state.finance;
  if (version < 5) delete state.coaching;
  if (version < 4) delete state.training;
  if (version < 3) { delete state.seasonNumber; delete state.history; }
  if (version < 2) {
    delete state.injuryMode; delete state.injuries;
    for (const fixture of state.fixtures as Array<{ result: Record<string, unknown> | null }>) if (fixture.result) delete fixture.result.injuries;
  }
  return JSON.stringify({ format: 'basketball-manager-season', formatVersion: version, engineVersion: 'possession-3', state });
}

let current: SeasonState, live: SeasonState, completed: SeasonState, later: SeasonState, originalLegacy: SeasonState;
beforeAll(() => {
  current = createSeason(37, clubId, 'off', true, true, true, true, oldest);
  live = { ...current, activeMatch: simulateToQuarterEnd(setAutoSubstitutions(current.activeMatch, managedSide(current), true)) };
  completed = completeSeason(live); later = rolloverSeason(completed);
  const baseline = createSeason(37, clubId, 'off', false, false, false, false);
  originalLegacy = { ...baseline, activeMatch: simulateToQuarterEnd(setAutoSubstitutions(baseline.activeMatch, managedSide(baseline), true)) };
}, 60_000);

describe('manager identity and calendar age', () => {
  it('normalizes only outer whitespace without mutating the supplied profile', () => {
    const input = { ...profile, name: `  ${profile.name}  `, nationality: ` ${profile.nationality} ` }, before = structuredClone(input);
    expect(validateManagerProfile(input, DEVELOPMENT_START_DATE)).toEqual(profile);
    expect(input).toEqual(before);
    expect(validateManagerProfile({ ...profile, name: '李 明 — Ana María O’Neill', nationality: 'Türkiye / España' }, DEVELOPMENT_START_DATE)).toMatchObject({ name: '李 明 — Ana María O’Neill', nationality: 'Türkiye / España' });
  });

  it.each([
    ['2008-09-05', 18], ['2008-09-04', 18], ['1925-09-06', 100], ['1926-09-05', 100], ['2000-02-29', 26],
  ])('accepts birth date %s at age %s on the opening day', (dateOfBirth, age) => {
    const manager = validateManagerProfile({ ...profile, dateOfBirth }, DEVELOPMENT_START_DATE);
    expect(managerAge(manager, DEVELOPMENT_START_DATE)).toBe(age);
  });

  it('uses calendar birthdays including leap years without requiring other form fields', () => {
    const manager = { name: '', nationality: '', dateOfBirth: '2000-02-29' };
    expect(managerAge(manager, '2026-02-28')).toBe(25);
    expect(managerAge(manager, '2026-03-01')).toBe(26);
    expect(managerAge(manager, '2028-02-29')).toBe(28);
    expect(managerAge(profile, '2026-02-27')).toBe(35);
    expect(managerAge(profile, '2026-02-28')).toBe(36);
  });

  const invalid: Array<[string, unknown]> = [
    ['null', null], ['array', []], ['missing field', { name: 'Manager', dateOfBirth: profile.dateOfBirth }],
    ['unknown field', { ...profile, reputation: 20 }], ['inherited fields', Object.create(profile)],
    ['blank name', { ...profile, name: '   ' }], ['numeric name', { ...profile, name: 10 }],
    ['long name', { ...profile, name: 'x'.repeat(MAX_MANAGER_NAME_LENGTH + 1) }],
    ['name newline', { ...profile, name: 'Manager\nName' }], ['name tab', { ...profile, name: '\tManager' }],
    ['name null character', { ...profile, name: 'Manager\0Name' }], ['name bidi control', { ...profile, name: 'Manager\u202eName' }],
    ['name paragraph separator', { ...profile, name: 'Manager\u2029Name' }],
    ['blank nationality', { ...profile, nationality: '' }], ['null nationality', { ...profile, nationality: null }],
    ['long nationality', { ...profile, nationality: 'x'.repeat(MAX_MANAGER_NATIONALITY_LENGTH + 1) }],
    ['nationality control', { ...profile, nationality: 'Country\u0085Name' }], ['invisible nationality', { ...profile, nationality: '\u200b' }],
    ['underage', { ...profile, dateOfBirth: '2008-09-06' }], ['older than 100', { ...profile, dateOfBirth: '1925-09-05' }],
    ['future birthday', { ...profile, dateOfBirth: '2027-01-01' }], ['impossible leap date', { ...profile, dateOfBirth: '1990-02-29' }],
    ['impossible day', { ...profile, dateOfBirth: '1990-04-31' }], ['impossible month', { ...profile, dateOfBirth: '1990-13-01' }],
    ['zero month', { ...profile, dateOfBirth: '1990-00-01' }], ['zero year', { ...profile, dateOfBirth: '0000-01-01' }],
    ['unpadded date', { ...profile, dateOfBirth: '1990-2-28' }], ['date with time', { ...profile, dateOfBirth: '1990-02-28T00:00:00Z' }],
    ['date whitespace', { ...profile, dateOfBirth: ' 1990-02-28' }], ['numeric date', { ...profile, dateOfBirth: 19900228 }],
  ];
  it.each(invalid)('rejects %s before creating or updating a career', (_name, value) => {
    expect(() => validateManagerProfile(value, DEVELOPMENT_START_DATE)).toThrow();
    if (value !== null) expect(() => createSeason(37, clubId, 'off', false, false, false, false, value as ManagerProfile)).toThrow();
  });

  it('rejects invalid reference dates and accepts the maximum field lengths', () => {
    expect(() => managerAge(profile, '2026-02-30')).toThrow(/date/);
    expect(() => validateManagerProfile(profile, 'invalid')).toThrow(/date/);
    expect(validateManagerProfile({ ...profile, name: 'x'.repeat(MAX_MANAGER_NAME_LENGTH), nationality: 'x'.repeat(MAX_MANAGER_NATIONALITY_LENGTH) }, DEVELOPMENT_START_DATE).name).toHaveLength(MAX_MANAGER_NAME_LENGTH);
  });
});

describe('manager profiles in saved careers', () => {
  it('writes format 9 with an optional known profile and exact match state', () => {
    expect(JSON.parse(serializeSeason(current)).formatVersion).toBe(9);
    expect(parseSeason(serializeSeason(live))).toEqual(live);
    expect(createSeason().manager).toBeNull();
    expect(parseSeason(serializeSeason(createSeason())).manager).toBeNull();
    const baseline = createSeason(37, clubId, 'off');
    expect(current).toEqual({ ...baseline, manager: oldest });
  });

  it('sets or edits the profile without changing the live simulation, finance, or caller objects', () => {
    const before = structuredClone(live), input = { ...profile, name: ` ${profile.name} ` }, changed = setManagerProfile(live, input);
    expect(changed).toEqual({ ...live, manager: profile });
    expect(changed.activeMatch).toBe(live.activeMatch);
    expect(changed.finance).toBe(live.finance);
    expect(stepMatch(changed.activeMatch)).toEqual(stepMatch(live.activeMatch));
    expect(advanceSeason(finish(changed))).toEqual({ ...advanceSeason(finish(live)), manager: profile });
    expect(parseSeason(serializeSeason(changed))).toEqual(changed);
    expect(live).toEqual(before);
    expect(input.name).toBe(` ${profile.name} `);
    expect(() => setManagerProfile(live, { ...profile, name: '' })).toThrow();
    expect(live).toEqual(before);
  });

  it('preserves a manager past age 100 over rollover and validates updates at career start', () => {
    expect(managerAge(later.manager!, later.date)).toBe(101);
    expect(later.manager).toEqual(oldest);
    expect(parseSeason(serializeSeason(completed))).toEqual(completed);
    expect(parseSeason(serializeSeason(later))).toEqual(later);
    expect(rolloverSeason(parseSeason(serializeSeason(completed)))).toEqual(later);
    expect(setManagerProfile(later, { ...oldest, name: 'Updated name' }).manager).toEqual({ ...oldest, name: 'Updated name' });
  });

  it.each(['missing', 'extra field', 'whitespace', 'underage', 'bad date', 'control'] as const)('rejects malformed saved profile: %s', change => {
    const state = structuredClone(current);
    if (change === 'missing') delete (state as Partial<SeasonState>).manager;
    if (change === 'extra field') Object.assign(state.manager!, { reputation: 10 });
    if (change === 'whitespace') state.manager!.name = ' Manager ';
    if (change === 'underage') state.manager!.dateOfBirth = '2008-09-06';
    if (change === 'bad date') state.manager!.dateOfBirth = '1990-02-30';
    if (change === 'control') state.manager!.nationality = 'A\nB';
    expect(() => validateSeasonState(state)).toThrow();
    expect(() => parseSeason(JSON.stringify({ format: 'basketball-manager-season', formatVersion: 9, engineVersion: 'possession-3', state }))).toThrow();
  });

  it.each([1, 2, 3, 4, 5, 6, 7])('migrates format %s with unknown manager and unchanged active-match RNG', version => {
    const restored = parseSeason(legacyText(originalLegacy, version));
    expect(restored).toEqual(originalLegacy);
    expect(restored.manager).toBeNull();
    expect(JSON.stringify(restored.activeMatch)).toBe(JSON.stringify(originalLegacy.activeMatch));
    expect(stepMatch(restored.activeMatch)).toEqual(stepMatch(originalLegacy.activeMatch));
  });

  it.each(['live', 'complete', 'later year'] as const)('preserves format 7 %s payroll, training and future simulation', boundary => {
    const original = boundary === 'live' ? live : boundary === 'complete' ? completed : later;
    const restored = parseSeason(legacyText(original, 7));
    expect(restored).toEqual({ ...withUnavailableArchivedStats(original), manager: null });
    if (original.status === 'complete') expect(rolloverSeason(restored)).toEqual({ ...rolloverSeason(withUnavailableArchivedStats(original)), manager: null });
    else expect(advanceSeason(finish(restored))).toEqual({ ...advanceSeason(finish(withUnavailableArchivedStats(original))), manager: null });
    expect(setManagerProfile(restored, oldest)).toEqual(withUnavailableArchivedStats(original));
  });

  it('validates original format 7 fields before adding an unknown profile', () => {
    const extra = JSON.parse(legacyText(live, 7)); extra.state.manager = profile;
    expect(() => parseSeason(JSON.stringify(extra))).toThrow();
    const corrupt = JSON.parse(legacyText(live, 7)); corrupt.state.payroll.agreements[0].seasonWage += 1;
    expect(() => parseSeason(JSON.stringify(corrupt))).toThrow();
  });
});
