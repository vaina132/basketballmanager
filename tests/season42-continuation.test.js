import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { parseSealedSeason, parseSeason, serializeSeasonCompact } from '../src/storage/season-storage';
import { saveSeal, sealMatches } from '../src/storage/save-seal';
import { advanceSeason, managedSide, rolloverSeason } from '../src/world/season';
import { SEASON_SCHEMA_VERSION } from './helpers/season-format';

// Captured at unchanged 76fa3bd before youth summaries existed. Never rewrite these old envelopes.
const names = ['career', 'career-next', 'complete', 'opening'];
const files = Object.fromEntries(names.map(name => [name, gunzipSync(readFileSync(new URL(`./fixtures/season42-board-${name}.json.gz`, import.meta.url))).toString('utf8')]));
const originals = Object.fromEntries(names.map(name => [name, JSON.parse(files[name]).state]));
const fixtures = state => state.youthCompetition.seasons.flatMap(season => season.fixtures);
const advance = state => advanceSeason({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) });
let states;
beforeAll(() => { states = Object.fromEntries(names.map(name => [name, parseSeason(files[name])])); }, 120_000);

/** Independent original squads may restore discarded detail only after every retained field has matched. */
function fullReference(candidate, original) {
  const restored = structuredClone(candidate), byId = new Map(fixtures(original).map(fixture => [fixture.id, fixture]));
  for (const fixture of fixtures(restored)) if (fixture.detail === 'outcome') {
    const previous = byId.get(fixture.id);
    expect(previous, `${fixture.id} requires independent original evidence`).toBeDefined();
    expect(previous.detail).toBeUndefined();
    expect(fixture).toEqual({ ...previous, home: null, away: null, startingConditions: null, detail: 'outcome', playerIds: { home: previous.home.players.map(player => player.id), away: previous.away.players.map(player => player.id) } });
    delete fixture.detail;
    delete fixture.playerIds;
    fixture.home = structuredClone(previous.home);
    fixture.away = structuredClone(previous.away);
    fixture.startingConditions = structuredClone(previous.startingConditions);
  }
  restored.schemaVersion = 42;
  return restored;
}

describe('genuine format-42 youth fixture history', () => {
  it('migrates full old fixtures without changing retained membership/results, other state or source data', () => {
    for (const name of names) {
      const file = JSON.parse(files[name]);
      expect(file.formatVersion).toBe(42);
      expect(file.encoding).toBeUndefined();
      expect(fullReference(states[name], originals[name])).toEqual(originals[name]);
      expect(fixtures(originals[name]).some(fixture => fixture.detail === 'outcome')).toBe(false);
    }
    for (const name of ['career', 'career-next', 'complete']) expect(states[name].youthCompetition).toEqual(originals[name].youthCompetition);
    const summaries = fixtures(states.opening).filter(fixture => fixture.detail === 'outcome');
    expect(summaries.length).toBeGreaterThan(0);
    for (const fixture of summaries) {
      expect(fixture.seasonNumber).toBeLessThan(states.opening.seasonNumber);
      expect([fixture.homeClubId, fixture.awayClubId]).not.toContain(states.opening.managedClubId);
    }
  });

  it('continues and rolls over exactly as the independently captured previous runtime', () => {
    expect(fullReference(advance(states.career), originals['career-next'])).toEqual(originals['career-next']);
    expect(fullReference(rolloverSeason(states.complete), originals.opening)).toEqual(originals.opening);
    expect(advance(states.career)).toEqual(states['career-next']);
    expect(rolloverSeason(states.complete)).toEqual(states.opening);
  }, 120_000);

  it('preserves youth outcomes through strict portable saves and verified local reloads', async () => {
    for (const name of names) {
      const text = serializeSeasonCompact(states[name]);
      expect(JSON.parse(text)).toMatchObject({ formatVersion: SEASON_SCHEMA_VERSION, encoding: 'compact-2' });
      expect(parseSeason(text)).toEqual(states[name]);
      expect(await sealMatches(text, await saveSeal(text))).toBe(true);
      expect(parseSealedSeason(text)).toEqual(states[name]);
    }
    expect(advance(parseSeason(serializeSeasonCompact(states.opening)))).toEqual(advance(states.opening));
  }, 120_000);
});
