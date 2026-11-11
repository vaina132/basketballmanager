import { stripRosterHistory } from './helpers/legacy-season';
import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { setAutoSubstitutions, simulateToEnd, stepMatch } from '../src/engine/match';
import { parseSeason, serializeSeason, validateSeasonState } from '../src/storage/season-storage';
import { advanceSeason, createSeason, managedSide } from '../src/world/season';
import { createSeasonInjury, getPlayerHealth, getSeasonInjuries } from '../src/world/health';

const clubId = 'atlantic-pilots', playerId = 'atl-8';
let live: SeasonState, firstFinished: SeasonState, second: SeasonState, third: SeasonState;
const finish = (season: SeasonState): SeasonState => ({ ...season, activeMatch: simulateToEnd(setAutoSubstitutions(season.activeMatch, managedSide(season), true)) });
const restore = (season: SeasonState) => parseSeason(serializeSeason(season));
function legacyText(season: SeasonState): string {
  const legacy = structuredClone(season) as unknown as Record<string, unknown>;
  legacy.schemaVersion = 1;
  delete legacy.seasonNumber; delete legacy.history; delete legacy.training; delete legacy.coaching; delete legacy.finance; delete legacy.payroll; delete legacy.manager; stripRosterHistory(legacy);
  delete legacy.injuryMode; delete legacy.injuries;
  for (const fixture of legacy.fixtures as Array<{ result: Record<string, unknown> | null }>) if (fixture.result) delete fixture.result.injuries;
  return JSON.stringify({ format: 'basketball-manager-season', formatVersion: 1, engineVersion: 'possession-3', state: legacy });
}

beforeAll(() => {
  const season = createSeason(9, clubId, 'standard', false, false, false);
  let match = setAutoSubstitutions(season.activeMatch, managedSide(season), true);
  for (let count = 0; count < 2000 && !match.injuries[playerId] && match.status !== 'finished'; count += 1) match = stepMatch(match);
  expect(match.injuries[playerId]).toBeDefined();
  live = { ...season, activeMatch: match };
  firstFinished = finish(live);
  second = advanceSeason(firstFinished);
  third = advanceSeason(finish(second));
}, 30_000);

describe('health-aware season persistence', () => {
  it.each(['standard', 'reduced', 'off'] as const)('writes format 9 with a uniform %s injury mode', mode => {
    const season = createSeason(17, clubId, mode, false, false, false), text = serializeSeason(season);
    expect(JSON.parse(text).formatVersion).toBe(24);
    expect(restore(season)).toEqual(season);
    expect(restore(season).activeMatch.injuryMode).toBe(mode);
  });

  it('preserves a new in-match injury without prematurely committing its history', () => {
    const restored = restore(live);
    expect(restored).toEqual(live);
    expect(restored.injuries).toEqual([]);
    expect(restored.activeMatch.rngState).toBe(live.activeMatch.rngState);
    expect(getPlayerHealth(restored, playerId)?.returnOn).toBe('2026-09-15');
    expect(getSeasonInjuries(restored)).toEqual(getSeasonInjuries(live));
    expect(advanceSeason(finish(restored))).toEqual(second);
  });

  it('restores inherited unavailability and excludes the recovering player from exposure', () => {
    const restored = restore(second);
    expect(restored).toEqual(second);
    expect(restored.activeMatch.preExistingInjuries).toContain(playerId);
    expect(restored.activeMatch.lineups[managedSide(restored)]).not.toContain(playerId);
    const played = finish(restored);
    expect(played.activeMatch.stats[playerId]!.secondsPlayed).toBe(0);
    expect(played.activeMatch.events.filter(event => event.type === 'injury' && event.playerId === playerId)).toEqual([]);
    expect(advanceSeason(played)).toEqual(third);
  });

  it('retains history when the return date passes without restarting recovery', () => {
    const restored = restore(third);
    expect(restored.date).toBe('2026-09-19');
    expect(getPlayerHealth(restored, playerId)).toBeNull();
    expect(restored.activeMatch.preExistingInjuries ?? []).not.toContain(playerId);
    expect(restored.injuries.filter(injury => injury.playerId === playerId)).toHaveLength(1);
    expect(restored.injuries.find(injury => injury.playerId === playerId)?.returnOn).toBe('2026-09-15');
  });

  it('round-trips a complete health-enabled season and its final result boundary', () => {
    let season = third;
    while (season.status !== 'complete') season = restore(advanceSeason(finish(season)));
    expect(season.fixtures.filter(fixture => fixture.result)).toHaveLength(30);
    expect(season.injuries.some(injury => injury.clubId !== clubId)).toBe(true);
    expect(restore(season)).toEqual(season);
    expect(season.fixtures.every(fixture => Object.hasOwn(fixture.result!, 'injuries'))).toBe(true);
  }, 30_000);
});

describe('strict health history and eligibility validation', () => {
  const mutations: Array<[string, (state: SeasonState) => void]> = [
    ['missing episode', state => { state.injuries = []; }],
    ['duplicate episode', state => { state.injuries.push({ ...state.injuries[0]! }); }],
    ['foreign player', state => { state.injuries[0]!.playerId = 'missing'; }],
    ['foreign club', state => { state.injuries[0]!.clubId = 'missing'; }],
    ['wrong source fixture', state => { state.injuries[0]!.fixtureId = 'dev-r2-g1'; }],
    ['altered occurrence date', state => { state.injuries[0]!.occurredOn = '2026-09-04'; }],
    ['early clearance', state => { state.injuries[0]!.returnOn = '2026-09-12'; }],
    ['impossible clearance date', state => { state.injuries[0]!.returnOn = '2026-02-31'; }],
    ['altered diagnosis', state => { state.injuries[0]!.kind = state.injuries[0]!.kind === 'muscle' ? 'ankle' : 'muscle'; }],
    ['unsupported episode field', state => { Object.assign(state.injuries[0]!, { rehabBonus: 10 }); }],
    ['invalid injury mode', state => { Object.assign(state, { injuryMode: 'rare' }); }],
    ['one-fixture mode override', state => { state.activeMatch.injuryMode = 'off'; }],
    ['foreign result diagnosis', state => { state.fixtures[0]!.result!.injuries.missing = 'ankle'; }],
    ['unsupported result diagnosis', state => { Object.assign(state.fixtures[0]!.result!.injuries, { [playerId]: 'unknown' }); }],
    ['erased result injury', state => { delete state.fixtures[0]!.result!.injuries[playerId]; }],
    ['removed inherited marker', state => { delete state.activeMatch.preExistingInjuries; }],
    ['removed inherited injury', state => { delete state.activeMatch.injuries[playerId]; }],
    ['changed inherited diagnosis', state => { state.activeMatch.injuries[playerId]!.kind = 'ankle'; }],
  ];
  it.each(mutations)('rejects %s without altering the original season', (_label, mutate) => {
    const damaged = structuredClone(second), original = structuredClone(second);
    mutate(damaged);
    expect(() => validateSeasonState(damaged)).toThrow();
    expect(second).toEqual(original);
  });

  it('rejects a committed game that silently removes a still-recovering player', () => {
    const damaged = structuredClone(third);
    const fixture = damaged.fixtures.find(fixture => fixture.round === 2 && [fixture.homeClubId, fixture.awayClubId].includes(clubId))!;
    delete fixture.result!.injuries[playerId];
    expect(() => validateSeasonState(damaged)).toThrow(/recovering/);
  });

  it('rejects playing statistics for a carried absence in a compact result', () => {
    const damaged = structuredClone(third);
    const fixture = damaged.fixtures.find(fixture => fixture.round === 2 && [fixture.homeClubId, fixture.awayClubId].includes(clubId))!;
    fixture.result!.stats[playerId]!.fouls = 1;
    expect(() => validateSeasonState(damaged)).toThrow(/zero personal statistics/);
  });

  it('counts injuries as exclusions when validating a compact default result', () => {
    const season = advanceSeason(finish(createSeason(37, clubId, 'standard', false, false, false)));
    const fixture = season.fixtures.find(item => item.round === 1 && item.result && [item.homeClubId, item.awayClubId].some(id => ![season.activeMatch.home.id, season.activeMatch.away.id].includes(id)))!;
    const result = fixture.result!;
    const losingClub = season.clubs.find(club => [fixture.homeClubId, fixture.awayClubId].includes(club.id) && ![season.activeMatch.home.id, season.activeMatch.away.id].includes(club.id))!;
    const winner = losingClub.id === fixture.homeClubId ? 'away' : 'home';
    const injured = losingClub.players.find(player => result.stats[player.id]!.secondsPlayed > 0)!;
    for (const player of losingClub.players) result.stats[player.id]!.fouls = player.id === injured.id ? 0 : 5;
    result.injuries[injured.id] = 'ankle';
    result.kind = 'default'; result.winnerClubId = winner === 'home' ? fixture.homeClubId : fixture.awayClubId;
    result.officialScore = result.score[winner] > result.score[winner === 'home' ? 'away' : 'home'] ? { ...result.score } : { home: winner === 'home' ? 2 : 0, away: winner === 'away' ? 2 : 0 };
    season.injuries.push(createSeasonInjury(season.seed, fixture, losingClub.id, injured.id, 'ankle'));
    expect(restore(season)).toEqual(season);
  });

  it('rejects health history committed before its originating matchday', () => {
    const damaged = structuredClone(live);
    damaged.injuries = structuredClone(second.injuries);
    expect(() => validateSeasonState(damaged)).toThrow(/committed fixture injury history/);
  });
});

describe('explicit injury-free legacy migration', () => {
  it('upgrades schema 1 only in memory and preserves every active match field', () => {
    const previous = advanceSeason(finish(createSeason(37, clubId, 'off', false, false, false)));
    const text = legacyText(previous), snapshot = JSON.parse(text).state;
    const restored = parseSeason(text);
    expect(restored.schemaVersion).toBe(24);
    expect(restored.injuryMode).toBe('off');
    expect(restored.injuries).toEqual([]);
    expect(restored.activeMatch).toEqual(snapshot.activeMatch);
    expect(restored.conditions).toEqual(snapshot.conditions);
    expect(restored.plans).toEqual(snapshot.plans);
    expect(restored.fixtures.filter(fixture => fixture.result).every(fixture => Object.keys(fixture.result!.injuries).length === 0)).toBe(true);
    expect(JSON.parse(text).state).toEqual(snapshot);
    expect(advanceSeason(finish(restored))).toEqual(advanceSeason(finish(previous)));
    expect(JSON.parse(serializeSeason(restored)).formatVersion).toBe(24);
  });

  it('migrates completed seasons without changing the retained final replay', () => {
    let season = createSeason(5, clubId, 'off', false, false, false);
    while (season.status !== 'complete') season = advanceSeason(finish(season));
    expect(parseSeason(legacyText(season))).toEqual(season);
  }, 30_000);

  it('runs strict original validation before adding default health fields', () => {
    const season = advanceSeason(finish(createSeason(37, clubId, 'off', false, false, false)));
    const envelope = JSON.parse(legacyText(season));
    envelope.state.fixtures[0].result.score.home += 1;
    expect(() => parseSeason(JSON.stringify(envelope))).toThrow(/officialScore|points/);
    const extra = JSON.parse(legacyText(season)); extra.state.injuries = [];
    expect(() => parseSeason(JSON.stringify(extra))).toThrow(/unsupported fields/);
    const injuring = JSON.parse(legacyText(season)); injuring.state.activeMatch.injuryMode = 'standard';
    expect(() => parseSeason(JSON.stringify(injuring))).toThrow(/season-wide injury/);
  });

  it('rejects schema/envelope version mismatches instead of guessing a migration', () => {
    const envelope = JSON.parse(serializeSeason(createSeason(17, clubId, 'off', false, false, false)));
    envelope.formatVersion = 1;
    expect(() => parseSeason(JSON.stringify(envelope))).toThrow();
    const legacy = JSON.parse(legacyText(createSeason(17, clubId, 'off', false, false, false)));
    legacy.formatVersion = 2;
    expect(() => parseSeason(JSON.stringify(legacy))).toThrow();
  });
});
