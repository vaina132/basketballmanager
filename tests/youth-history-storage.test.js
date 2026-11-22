import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseSeason, serializeSeason, serializeSeasonCompact, validateSeasonState } from '../src/storage/season-storage';
import { sealCompletedHistory } from '../src/world/sealed-history';
import { getYouthStandings } from '../src/world/youth-competition';
import { advanceMatchday } from './helpers/board-funding';
import { currentSeasonFile } from './helpers/season-format';

const original = name => JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/season42-board-${name}.json.gz`, import.meta.url))).toString('utf8'));
// Independent descriptions of the recorded forms, not the implementation's projection helpers.
const outcome = fixture => ({ ...fixture, detail: 'outcome', home: null, away: null, startingConditions: null,
  playerIds: { home: fixture.home.players.map(player => player.id), away: fixture.away.players.map(player => player.id) } });
// Format 73: a rival game of a completed season keeps its calendar, pairing, result and diagnoses; squads and player lines go.
const sealed = fixture => ({ id: fixture.id, seasonNumber: fixture.seasonNumber, round: fixture.round, date: fixture.date, homeClubId: fixture.homeClubId, awayClubId: fixture.awayClubId,
  detail: 'season', home: null, away: null, startingConditions: null, result: { ...fixture.result, stats: {} } });
const fixtures = state => state.youthCompetition.seasons.flatMap(season => season.fixtures);
const own = (state, fixture) => [fixture.homeClubId, fixture.awayClubId].includes(state.managedClubId);
const rejected = state => {
  expect(() => validateSeasonState(state)).toThrow();
  expect(() => parseSeason(currentSeasonFile(state))).toThrow();
};
let opening, complete, live, source, summaryId, injuredId;
beforeAll(() => {
  source = original('opening');
  // Season two's opening: season one is a completed, sealed season. A week later the current season has played games.
  opening = parseSeason(JSON.stringify(source));
  complete = parseSeason(JSON.stringify(original('complete')));
  live = advanceMatchday(opening);
  // Older rival games of the completed season, chosen from the genuine format-42 source: one with diagnoses.
  const managed = source.state.managedClubId, rival = fixtures(source.state).filter(fixture => fixture.seasonNumber < source.state.seasonNumber && fixture.result && ![fixture.homeClubId, fixture.awayClubId].includes(managed));
  summaryId = rival[0]?.id;
  injuredId = rival.find(fixture => fixture.result.injuries.length)?.id;
  expect([summaryId, injuredId].every(Boolean)).toBe(true);
}, 120_000);
const find = (state, id) => fixtures(state).find(fixture => fixture.id === id);

// Format 73 (step 3.7): completed seasons are sealed at rollover and on import. Other clubs' youth games keep their
// results and diagnoses (`detail: 'season'`) and are checked by shape; the current season's games are replayed exactly.
describe('sealed youth fixtures (format 73)', () => {
  it('keeps results and diagnoses of rival games of a completed season; the manager\'s games stay complete', () => {
    const recorded = new Map(fixtures(source.state).map(fixture => [fixture.id, fixture]));
    expect(fixtures(opening).map(fixture => fixture.id)).toEqual([...recorded.keys()]);
    let rivals = 0;
    for (const fixture of fixtures(opening)) {
      const before = recorded.get(fixture.id);
      if (fixture.seasonNumber === opening.seasonNumber || own(opening, fixture)) expect(fixture).toEqual(before);
      else { expect(fixture).toEqual(sealed(before)); rivals += 1; }
    }
    expect(rivals).toBeGreaterThan(0);
    expect(find(opening, injuredId).result.injuries).toEqual(find(source.state, injuredId).result.injuries);
    // The completed season's youth table is unchanged.
    expect(getYouthStandings(opening, 1)).toEqual(getYouthStandings({ ...opening, youthCompetition: source.state.youthCompetition }, 1));
  });

  it('keeps the same record of a season once it is no longer the latest completed one', () => {
    const later = sealCompletedHistory({ ...live, seasonNumber: live.seasonNumber + 1 });
    expect(later.youthCompetition.seasons[0]).toEqual(live.youthCompetition.seasons[0]);
  });

  it('validates, exports and reloads a sealed season and the current season beside it without changing them', () => {
    for (const state of [opening, live]) {
      const before = JSON.stringify(state);
      validateSeasonState(state);
      expect(parseSeason(serializeSeason(state))).toEqual(state);
      expect(parseSeason(serializeSeasonCompact(state))).toEqual(state);
      expect(JSON.stringify(state)).toBe(before);
    }
  });

  it.each([
    ['kept frozen team', fixture => { fixture.home = { id: fixture.homeClubId, players: [] }; }],
    ['kept starting conditions', fixture => { fixture.startingConditions = {}; }],
    ['kept player lines', fixture => { fixture.result.stats = { 'invented-prospect': {} }; }],
    ['unknown detail marker', fixture => { fixture.detail = 'unverified'; }],
    ['outcome marker without its membership record', fixture => { fixture.detail = 'outcome'; }],
    ['hidden unvalidated field', fixture => { fixture.playerIds = { home: [], away: [] }; }],
    ['unplayed result', fixture => { fixture.result = null; }],
    ['missing result field', fixture => { delete fixture.result.officialScore; }],
    ['winner outside the game', fixture => { fixture.result.winnerClubId = 'invented-club'; }],
  ])('rejects a sealed game with %s after the same object previously validated', (_label, damage) => {
    const changed = structuredClone(opening);
    validateSeasonState(changed);
    damage(find(changed, summaryId));
    rejected(changed);
  });

  it.each([
    ['invented injury source', injury => { injury.fixtureId = 'wrong-fixture'; }],
    ['unsupported diagnosis', injury => { injury.kind = 'invented-injury'; }],
    ['return before the injury', injury => { injury.returnOn = injury.occurredOn; }],
    ['club outside the game', injury => { injury.clubId = 'invented-club'; }],
    ['missing diagnosis field', injury => { delete injury.returnOn; }],
  ])('rejects a sealed diagnosis with %s', (_label, damage) => {
    const changed = structuredClone(opening);
    damage(find(changed, injuredId).result.injuries[0]);
    rejected(changed);
  });

  it('rejects a changed calendar of a sealed game with diagnoses', () => {
    const changed = structuredClone(opening);
    find(changed, injuredId).date = '2026-01-01';
    rejected(changed);
  });

  it('rejects omitted and duplicated historical fixtures', () => {
    for (const duplicate of [false, true]) {
      const changed = structuredClone(opening), season = changed.youthCompetition.seasons[0];
      if (duplicate) season.fixtures.push(structuredClone(season.fixtures[0])); else season.fixtures.pop();
      rejected(changed);
    }
  });
});

describe('current-season youth fixtures (format 73)', () => {
  const played = state => fixtures(state).filter(fixture => fixture.seasonNumber === state.seasonNumber && fixture.result);

  it('cannot seal or summarize a game of the current season', () => {
    expect(played(live).length).toBeGreaterThan(0);
    for (const project of [sealed, outcome]) {
      const changed = structuredClone(live), fixture = played(changed).find(item => !own(changed, item));
      Object.assign(fixture, project(fixture));
      rejected(changed);
    }
  });

  it.each([
    ['changed score', fixture => { fixture.result.score.home += 1; }],
    ['changed player scoring', fixture => { fixture.result.stats[fixture.home.players[0].id].points += 1; }],
    ['invalid retained condition', fixture => { fixture.result.stats[fixture.home.players[0].id].condition = -1; }],
    ['changed starting condition', fixture => { fixture.startingConditions[fixture.home.players[0].id] -= 1; }],
    ['changed frozen squad', fixture => { fixture.home.players.reverse(); }],
    ['invented injury', fixture => { fixture.result.injuries.push({ id: 'invented', playerId: fixture.home.players[0].id, clubId: fixture.homeClubId, kind: 'ankle-sprain', fixtureId: fixture.id, occurredOn: fixture.date, returnOn: '2099-01-01' }); }],
    ['changed calendar', fixture => { fixture.date = '2026-01-01'; }],
  ])('replays the games after a sealed season exactly: rejects %s even after the same object previously validated', (_label, damage) => {
    for (const managed of [true, false]) {
      const changed = structuredClone(live);
      validateSeasonState(changed);
      const fixture = played(changed).find(item => own(changed, item) === managed);
      expect(fixture).toBeDefined();
      damage(fixture);
      rejected(changed);
    }
  });

  it.each(['manager', 'latest', 'first'])('requires original detail for the %s fixture of a completed current season', kind => {
    const state = structuredClone(complete), list = played(state);
    expect(list.every(fixture => fixture.detail === undefined)).toBe(true);
    const fixture = kind === 'manager' ? list.find(item => own(state, item)) : kind === 'latest' ? list.findLast(item => !own(state, item)) : list.find(item => !own(state, item));
    expect(fixture).toBeDefined();
    Object.assign(fixture, outcome(fixture));
    rejected(state);
  });
});

describe('format-42 youth games before migration', () => {
  it('rejects corrupt frozen legacy detail before migration can omit it', () => {
    const changed = structuredClone(source), fixture = find(changed.state, summaryId);
    fixture.startingConditions[fixture.home.players[0].id] -= 1;
    expect(() => parseSeason(JSON.stringify(changed))).toThrow();
    const wrongIdentity = structuredClone(source), player = find(wrongIdentity.state, summaryId).home.players[0];
    player.attributes.passing = player.attributes.passing === 20 ? 19 : 20;
    expect(() => parseSeason(JSON.stringify(wrongIdentity))).toThrow();
  });

  it('rejects outcome fields inside an older format-42 save', () => {
    const changed = structuredClone(source), fixture = find(changed.state, summaryId);
    Object.assign(fixture, outcome(fixture));
    expect(() => parseSeason(JSON.stringify(changed))).toThrow();
  });
});
