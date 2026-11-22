import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { checkAgainstTrustedPrefix, parseSeason, serializeSeason, serializeSeasonCompact, validateSeasonState } from '../src/storage/season-storage';
import { lastPrefixSkips, matchesTrustedPrefix, withPrefixCheck } from '../src/storage/trusted-prefix';
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

  // Sealed games follow the season's schedule and the result rules; their diagnoses are the deterministic ones.
  const swap = pair => { [pair.home, pair.away] = [pair.away, pair.home]; };
  it.each([
    ['removed season marker', fixture => { delete fixture.detail; }],
    ['changed score', fixture => { fixture.result.score.home += 1; }],
    ['changed official score', fixture => { fixture.result.officialScore.away += 1; }],
    ['changed winner', fixture => { fixture.result.winnerClubId = fixture.result.winnerClubId === fixture.homeClubId ? fixture.awayClubId : fixture.homeClubId; }],
    ['changed game id', fixture => { fixture.id = `${fixture.id}x`; }],
    ['changed date', fixture => { fixture.date = '2026-01-01'; }],
    ['home and away swapped', fixture => { [fixture.homeClubId, fixture.awayClubId] = [fixture.awayClubId, fixture.homeClubId]; swap(fixture.result.score); swap(fixture.result.officialScore); }],
    ['changed result kind', fixture => { fixture.result.kind = 'default'; }],
    ['changed reason', fixture => { fixture.result.reason = 'Abandoned.'; }],
  ])('rejects a sealed game without diagnoses with a %s', (_label, damage) => {
    const changed = structuredClone(opening), fixture = fixtures(changed).find(item => item.detail === 'season' && !item.result.injuries.length);
    damage(fixture);
    rejected(changed);
  });

  it.each([
    ['changed return date', injury => { injury.returnOn = '2099-01-01'; }],
    ['changed diagnosis', injury => { injury.kind = injury.kind === 'ankle' ? 'muscle' : 'ankle'; }],
  ])('rejects a sealed diagnosis with a %s', (_label, damage) => {
    const changed = structuredClone(opening);
    damage(find(changed, injuredId).result.injuries[0]);
    rejected(changed);
  });

  it('rejects a removed diagnosis whose absence shows in a kept academy report', () => {
    const changed = structuredClone(opening);
    find(changed, injuredId).result.injuries = [];
    rejected(changed);
  });

  it('rejects one game copied over another', () => {
    const changed = structuredClone(opening), list = changed.youthCompetition.seasons[0].fixtures;
    const target = list.findIndex(item => item.detail === 'season' && item.id !== injuredId);
    list[target] = structuredClone(find(changed, injuredId));
    rejected(changed);
  });

  // Not verifiable once sealed: a rival game is not simulated again and its squads and player lines are gone, so a
  // consistent new score with the same winner, or a diagnosis without later consequences, cannot be told apart.
  it('still accepts a rival score changed consistently with its winner', () => {
    const changed = structuredClone(opening), fixture = fixtures(changed).find(item => item.detail === 'season' && item.result.kind === 'played');
    const winner = fixture.result.winnerClubId === fixture.homeClubId ? 'home' : 'away';
    fixture.result.score[winner] += 1; fixture.result.officialScore[winner] += 1;
    expect(parseSeason(currentSeasonFile(changed))).toEqual(changed);
  });
});

// The managed club's games of a completed season stay complete (format 73) and keep their squads, box scores and
// conditions: the squads' identities are exact and their development lies within the season's kept academy reports.
describe('the managed club\'s youth games of a completed season (format 73)', () => {
  const ownGame = state => fixtures(state).find(fixture => fixture.seasonNumber < state.seasonNumber && own(state, fixture) && fixture.result.played);
  const ownSide = (state, fixture) => fixture.homeClubId === state.managedClubId ? 'home' : 'away';
  const base = (state, id) => state.academy.prospects.find(prospect => prospect.player.id === id).player.attributes;

  it.each([
    ['sealed like another club\'s game', (fixture) => { Object.assign(fixture, sealed(fixture)); }],
    ['summarized like another club\'s game', (fixture) => { Object.assign(fixture, outcome(fixture)); }],
    ['changed player points', (fixture, side) => { fixture.result.stats[fixture[side].players[0].id].points += 1; }],
    ['changed score', fixture => { fixture.result.score.home += 1; fixture.result.officialScore.home += 1; }],
    ['changed starting condition', (fixture, side) => { const id = fixture[side].players[0].id; fixture.startingConditions[id] = fixture.startingConditions[id] === 100 ? 99 : 100; }],
    ['changed frozen squad', (fixture, side) => { fixture[side].players.reverse(); }],
    ['development below the prospect\'s intake', (fixture, side, state) => { const player = fixture[side].players[0]; player.attributes.passing = base(state, player.id).passing - 1; }],
    ['invented injury', (fixture, side) => { const player = fixture[side].players[0]; fixture.result.injuries.push({ id: `${fixture.id}:${player.id}`, playerId: player.id, clubId: fixture[side].id, kind: 'ankle', fixtureId: fixture.id, occurredOn: fixture.date, returnOn: '2099-01-01' }); }],
  ])('rejects a managed club game of a completed season with %s', (_label, damage) => {
    const changed = structuredClone(opening), fixture = ownGame(changed);
    expect(fixture).toBeDefined();
    validateSeasonState(changed);
    damage(fixture, ownSide(changed, fixture), changed);
    rejected(changed);
  });
});

// Incremental checkpoint checks resume the academy replay inside the current season and skip the sealed checks; the
// resumed replay holds the sealed records the trusted check accepted, so a changed one is still refused.
describe('sealed seasons on the incremental checkpoint check', () => {
  it('refuses a sealed youth game or academy report changed after a trusted checkpoint', () => {
    const trusted = structuredClone(live), next = advanceMatchday(live);
    const record = withPrefixCheck(trusted, null, true, () => validateSeasonState(trusted));
    checkAgainstTrustedPrefix(structuredClone(next), record);
    expect(lastPrefixSkips()['academy.weeks']).toBeGreaterThan(0);
    const youth = structuredClone(next), game = fixtures(youth).find(item => item.detail === 'season');
    game.result.reason = 'Abandoned.';
    const academy = structuredClone(next), week = academy.academy.weeks.findLast(item => item.seasonNumber < academy.seasonNumber);
    const report = Object.values(week.players).find(item => !item.detail && Object.values(item.gains).some(Boolean));
    report.gains[Object.keys(report.gains).find(key => report.gains[key] > 0)] += 1;
    // Youth seasons are not a trusted journal: the incremental check runs and refuses the changed game itself.
    expect(matchesTrustedPrefix(record, youth)).toBe(true);
    expect(() => checkAgainstTrustedPrefix(youth, record)).toThrow(/Invalid season save/);
    // Sealed academy weeks are trusted journal records: a changed one loses the trust, and the full check refuses it.
    expect(matchesTrustedPrefix(record, academy)).toBe(false);
    rejected(academy);
  }, 120_000);
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
