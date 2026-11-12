import { createRosterSnapshots, rosterForRound } from '../src/world/rosters';
import { stripRosterHistory, withUnavailableArchivedStats } from './helpers/legacy-season';
import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonArchive, SeasonState } from '../src/domain/season';
import { createFixtureMatch, setAutoSubstitutions, simulateToEnd, simulateToQuarterEnd, stepMatch } from '../src/engine/match';
import { MAX_SEASON_SAVE_BYTES, parseSeason, serializeSeason, validateSeasonState } from '../src/storage/season-storage';
import { getPlayerHealth } from '../src/world/health';
import { advanceSeason, createSchedule, createSeason, fixtureSeed, getStandings, managedSide, MAX_SEASON_NUMBER, rolloverSeason } from '../src/world/season';

const clubId = 'atlantic-pilots';
type PreviousState = Omit<SeasonState, 'schemaVersion' | 'seasonNumber' | 'history'> & { schemaVersion: number; history?: unknown[] };
let firstLive: SeasonState, firstSecondRound: SeasonState, firstComplete: SeasonState;
let secondStart: SeasonState, secondLive: SeasonState, secondComplete: SeasonState, thirdStart: SeasonState;
const restore = (season: SeasonState) => parseSeason(serializeSeason(season));
const finish = (season: SeasonState): SeasonState => ({ ...season, activeMatch: season.activeMatch.status === 'finished' ? season.activeMatch : simulateToEnd(setAutoSubstitutions(season.activeMatch, managedSide(season), true)) });

function completeSeason(season: SeasonState): SeasonState {
  let state = season;
  while (state.status !== 'complete') state = advanceSeason(finish(state));
  return state;
}

function previousFormat(season: SeasonState, version: 1 | 2): string {
  const state = structuredClone(season) as unknown as Record<string, unknown>;
  state.schemaVersion = version;
  delete state.seasonNumber; delete state.history; delete state.training; delete state.coaching; delete state.finance; delete state.payroll; delete state.manager; stripRosterHistory(state);
  if (version === 1) {
    delete state.injuryMode; delete state.injuries;
    for (const fixture of state.fixtures as Array<{ result: Record<string, unknown> | null }>) if (fixture.result) delete fixture.result.injuries;
  }
  return JSON.stringify({ format: 'basketball-manager-season', formatVersion: version, engineVersion: 'possession-3', state });
}

beforeAll(() => {
  const first = createSeason(9, clubId, 'standard', false, false, false);
  let match = setAutoSubstitutions(first.activeMatch, managedSide(first), true);
  while (!match.injuries['atl-8'] && match.status !== 'finished') match = stepMatch(match);
  expect(match.injuries['atl-8']).toBeDefined();
  firstLive = { ...first, activeMatch: match };
  firstSecondRound = advanceSeason(finish(firstLive));
  firstComplete = completeSeason(firstSecondRound);
  secondStart = rolloverSeason(firstComplete);
  secondLive = { ...secondStart, activeMatch: simulateToQuarterEnd(setAutoSubstitutions(secondStart.activeMatch, managedSide(secondStart), true)) };
  secondComplete = completeSeason(secondLive);
  thirdStart = rolloverSeason(secondComplete);
}, 60_000);

describe('career save boundaries', () => {
  it('writes format 9 with the original season table preserved after rollover', () => {
    const text = serializeSeason(secondStart), restored = parseSeason(text);
    expect(JSON.parse(text).formatVersion).toBe(28);
    expect(restored).toEqual(secondStart);
    expect(restored.history).toHaveLength(1);
    expect(getStandings({ clubs: restored.clubs, fixtures: restored.history[0]!.fixtures })).toEqual(getStandings(firstComplete));
    expect(restored.history[0]!.fixtures.every(fixture => fixture.result.stats !== null)).toBe(true);
    expect(restored.activeFixtureId).toBe('dev-s2-r1-g1');
    expect(restored.date).toBe('2027-09-04');
  });

  it('continues a live second-year match and next matchday identically after import', () => {
    const restored = restore(secondLive);
    expect(restored.activeMatch.rngState).toBe(secondLive.activeMatch.rngState);
    expect(restored.activeMatch).toEqual(secondLive.activeMatch);
    expect(advanceSeason(finish(restored))).toEqual(advanceSeason(finish(secondLive)));
  }, 30_000);

  it('saves a completed later season and rolls it over exactly once', () => {
    const restored = restore(secondComplete);
    expect(restored).toEqual(secondComplete);
    expect(rolloverSeason(restored)).toEqual(thirdStart);
    expect(restore(thirdStart)).toEqual(thirdStart);
    expect(thirdStart.history.map(archive => archive.seasonNumber)).toEqual([1, 2]);
    expect(() => rolloverSeason(restore(thirdStart))).toThrow();
  });

  it('retains past medical episodes while allowing cleared players to play next year', () => {
    const restored = restore(secondStart);
    expect(restored.injuries).toEqual(firstComplete.injuries);
    expect(restored.injuries.length).toBeGreaterThan(0);
    expect(restored.injuries.some(injury => injury.playerId === 'atl-8')).toBe(true);
    expect(getPlayerHealth(restored, 'atl-8')).toBeNull();
    expect(restored.activeMatch.preExistingInjuries ?? []).toEqual([]);
    expect(Object.values(restored.conditions).every(condition => condition === 100)).toBe(true);
    expect(thirdStart.injuries.some(injury => injury.fixtureId.startsWith('dev-s2-'))).toBe(true);
    expect(restore(thirdStart).injuries).toEqual(secondComplete.injuries);
  });

  it('retains one hundred legacy compact prior seasons below the save limit without truncating results', () => {
    // A structural-size fixture, not one hundred newly simulated seasons.
    const season = createSeason(7, clubId, 'off', false, false, false);
    season.seasonNumber = 101;
    season.rosters = createRosterSnapshots(season.clubs, season.seasonNumber);
    season.history = Array.from({ length: 100 }, (_, index): SeasonArchive => ({
      seasonNumber: index + 1,
      rosters: createRosterSnapshots(season.clubs, index + 1),
      fixtures: createSchedule(season.clubs, index + 1).map((fixture, fixtureIndex) => ({
        ...fixture, result: { ...structuredClone(secondStart.history[0]!.fixtures[fixtureIndex]!.result), injuries: {}, stats: null, rosterIds: { home: rosterForRound(createRosterSnapshots(season.clubs, index + 1), fixture.homeClubId, fixture.round).id, away: rosterForRound(createRosterSnapshots(season.clubs, index + 1), fixture.awayClubId, fixture.round).id } },
      })),
    }));
    season.fixtures = createSchedule(season.clubs, season.seasonNumber);
    const fixture = season.fixtures.find(item => item.round === 1 && [item.homeClubId, item.awayClubId].includes(clubId))!;
    season.activeFixtureId = fixture.id; season.date = fixture.date;
    const home = season.clubs.find(club => club.id === fixture.homeClubId)!, away = season.clubs.find(club => club.id === fixture.awayClubId)!;
    season.activeMatch = createFixtureMatch(fixtureSeed(season.seed, fixture.id), home, away, { injuryMode: 'off', autoSubstitutions: { home: home.id !== clubId, away: away.id !== clubId } });
    const text = serializeSeason(season);
    expect(new TextEncoder().encode(text).byteLength).toBeLessThan(MAX_SEASON_SAVE_BYTES);
    const restored = parseSeason(text);
    expect(restored).toEqual(season);
    expect(restored.history.flatMap(archive => archive.fixtures)).toHaveLength(3000);
  });
});

describe('explicit career migrations', () => {
  it.each(['live', 'recovering', 'complete'] as const)('validates and upgrades a format 2 %s save without rewriting game state', boundary => {
    const original = boundary === 'live' ? firstLive : boundary === 'recovering' ? firstSecondRound : firstComplete;
    const text = previousFormat(original, 2), snapshot = JSON.parse(text).state;
    const restored = parseSeason(text);
    expect(restored).toEqual(withUnavailableArchivedStats(original));
    expect(restored.schemaVersion).toBe(28);
    expect(restored.seasonNumber).toBe(1);
    expect(restored.history).toEqual([]);
    expect(restored.activeMatch).toEqual(snapshot.activeMatch);
    expect(restored.injuries).toEqual(snapshot.injuries);
    expect(restored.fixtures).toEqual(original.fixtures);
    expect(JSON.parse(text).state).toEqual(snapshot);
    if (boundary === 'complete') expect(rolloverSeason(restored)).toEqual(secondStart);
  });

  it('preserves the next RNG outcome after format 2 migration', () => {
    const restored = parseSeason(previousFormat(firstLive, 2));
    expect(stepMatch(restored.activeMatch)).toEqual(stepMatch(firstLive.activeMatch));
    expect(advanceSeason(finish(restored))).toEqual(firstSecondRound);
  });

  it('migrates format 1 through its injury-free rules into the first career season', () => {
    const season = createSeason(37, clubId, 'off', false, false, false);
    season.activeMatch = simulateToQuarterEnd(setAutoSubstitutions(season.activeMatch, managedSide(season), true));
    const restored = parseSeason(previousFormat(season, 1));
    expect(restored).toEqual(season);
    expect(stepMatch(restored.activeMatch)).toEqual(stepMatch(season.activeMatch));
  });

  it.each([
    ['extra career field', (state: PreviousState) => { state.history = []; }],
    ['wrong source schema', (state: PreviousState) => { state.schemaVersion = 3; }],
    ['bad current result', (state: PreviousState) => { state.fixtures[0]!.result!.score.home += 1; }],
    ['wrong recovery origin', (state: PreviousState) => { state.injuries[0]!.fixtureId = 'dev-s2-r1-g1'; }],
  ] as const)('rejects malformed format 2 %s before migration', (_name, mutate) => {
    const envelope = JSON.parse(previousFormat(firstSecondRound, 2));
    mutate(envelope.state);
    expect(() => parseSeason(JSON.stringify(envelope))).toThrow();
  });
});

describe('career history validation', () => {
  const mutations: Array<[string, (season: SeasonState) => void]> = [
    ['missing prior year', season => { season.history.shift(); }],
    ['duplicate prior year', season => { season.history[1] = structuredClone(season.history[0]!); }],
    ['reordered prior years', season => { season.history.reverse(); }],
    ['future year archived', season => { season.history[1]!.seasonNumber = 3; }],
    ['fractional year', season => { season.seasonNumber = 3.5; }],
    ['calendar beyond supported range', season => { season.seasonNumber = MAX_SEASON_NUMBER + 1; }],
    ['extra archive metadata', season => { Object.assign(season.history[0]!, { champion: 'missing' }); }],
    ['missing historical fixture', season => { season.history[0]!.fixtures.pop(); }],
    ['duplicate historical fixture', season => { season.history[0]!.fixtures[1] = structuredClone(season.history[0]!.fixtures[0]!); }],
    ['reused first-year identity', season => { season.history[1]!.fixtures[0]!.id = 'dev-r1-g1'; }],
    ['incorrect calendar year', season => { season.history[1]!.fixtures[0]!.date = season.history[0]!.fixtures[0]!.date; }],
    ['unplayed historical result', season => { Object.assign(season.history[0]!.fixtures[0]!, { result: null }); }],
    ['retained historical box score', season => { Object.assign(season.history[0]!.fixtures[0]!.result, { stats: {} }); }],
    ['foreign winning club', season => { season.history[0]!.fixtures[0]!.result.winnerClubId = 'missing'; }],
    ['historical tied final', season => { const result = season.history[0]!.fixtures[0]!.result; result.score.away = result.score.home; result.officialScore.away = result.officialScore.home; }],
    ['inconsistent normal award', season => { season.history[0]!.fixtures[0]!.result.officialScore.home += 1; }],
    ['inconsistent default award', season => { const result = season.history[0]!.fixtures[0]!.result; result.kind = 'default'; result.officialScore.home += 10; }],
    ['incomplete regulation period', season => { season.history[0]!.fixtures[0]!.result.periods = 3; }],
    ['unknown historical diagnosis', season => { Object.assign(season.history[0]!.fixtures[0]!.result.injuries, { 'atl-8': 'fracture' }); }],
    ['foreign historical injured player', season => { season.history[0]!.fixtures[0]!.result.injuries.missing = 'ankle'; }],
    ['deleted historical episode', season => { season.injuries.shift(); }],
    ['duplicate historical episode', season => { season.injuries.push({ ...season.injuries[0]! }); }],
    ['changed historical recovery date', season => { season.injuries[0]!.returnOn = '2030-01-01'; }],
    ['reused prior-year injury source', season => { const injury = season.injuries.find(injury => injury.fixtureId.startsWith('dev-s2-'))!; injury.fixtureId = injury.fixtureId.replace('dev-s2-', 'dev-'); }],
    ['omitted inherited historical absence', season => { delete season.history[0]!.fixtures.find(fixture => fixture.round === 2 && [fixture.homeClubId, fixture.awayClubId].includes(clubId))!.result.injuries['atl-8']; }],
    ['unrecovered new-season condition', season => { season.conditions['atl-8'] = 90; }],
    ['injuries disabled after injuring seasons', season => { season.injuryMode = 'off'; season.activeMatch.injuryMode = 'off'; }],
  ];
  it.each(mutations)('rejects %s without changing the loaded career', (_name, mutate) => {
    const damaged = structuredClone(thirdStart), original = structuredClone(thirdStart);
    mutate(damaged);
    expect(() => validateSeasonState(damaged)).toThrow();
    expect(thirdStart).toEqual(original);
  });

  it('retains strict player-stat validation for the current season after an archive exists', () => {
    const damaged = structuredClone(secondComplete);
    const result = damaged.fixtures[0]!.result!;
    Object.values(result.stats)[0]!.secondsPlayed += 1;
    expect(() => validateSeasonState(damaged)).toThrow();
  });
});
