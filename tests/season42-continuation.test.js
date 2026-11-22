import { restoreSeniorDetail } from './helpers/senior-reference';
import { financeAtLedgerBoundary, financeLedgerCount } from '../src/world/finance-ledger';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { parseSealedSeason, parseSeason, serializeSeasonCompact } from '../src/storage/season-storage';
import { saveSeal, sealMatches } from '../src/storage/save-seal';
import { advanceSeason, managedSide, rolloverSeason } from '../src/world/season';
import { SEASON_SCHEMA_VERSION } from './helpers/season-format';
import { expectValidOldSaveWeek, withFormat73Records } from './helpers/old-save-week';

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
  const restored = restoreSeniorDetail(candidate, original), byId = new Map(fixtures(original).map(fixture => [fixture.id, fixture]));
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
  restored.finance = financeAtLedgerBoundary(restored.finance, financeLedgerCount(restored.finance));
  restored.schemaVersion = 42;
  return restored;
}

describe('genuine format-42 youth fixture history', () => {
  it('migrates full old fixtures without changing retained membership/results, other state or source data', () => {
    for (const name of names) {
      const file = JSON.parse(files[name]);
      expect(file.formatVersion).toBe(42);
      expect(file.encoding).toBeUndefined();
      expect(withFormat73Records(fullReference(states[name], originals[name]))).toEqual(withFormat73Records(originals[name]));
      expect(fixtures(originals[name]).some(fixture => fixture.detail === 'outcome')).toBe(false);
    }
    for (const name of ['career', 'career-next', 'complete']) expect(states[name].youthCompetition).toEqual(withFormat73Records(originals[name]).youthCompetition);
    // Format 73 seals rival youth games of completed seasons at the opening (results and diagnoses only).
    const summaries = fixtures(states.opening).filter(fixture => fixture.detail === 'season');
    expect(summaries.length).toBeGreaterThan(0);
    for (const fixture of summaries) {
      expect(fixture.seasonNumber).toBeLessThan(states.opening.seasonNumber);
      expect([fixture.homeClubId, fixture.awayClubId]).not.toContain(states.opening.managedClubId);
    }
  });

  // Match calibration and realistic injuries (sprint 4) changed the simulated results after this old save, so the week is
  // checked for what must hold under intended rule changes (tests/helpers/old-save-week.ts). The rollover plays no games.
  it('continues the old career for a valid week that follows the independently recorded one', () => {
    expectValidOldSaveWeek(states.career, advance(states.career), states['career-next']);
  }, 120_000);

  it('rolls over exactly as the prior implementation independently recorded', () => {
    expect(withFormat73Records(fullReference(rolloverSeason(states.complete), originals.opening))).toEqual(withFormat73Records(originals.opening));
    expect(rolloverSeason(states.complete)).toEqual(states.opening);
  }, 120_000);

  it('preserves youth outcomes through strict portable saves and verified local reloads', async () => {
    for (const name of names) {
      const text = serializeSeasonCompact(states[name]);
      // Format 73 writes every save, older careers included, in the compact-3 layout.
      expect(JSON.parse(text)).toMatchObject({ formatVersion: SEASON_SCHEMA_VERSION, encoding: 'compact-3' });
      expect(parseSeason(text)).toEqual(states[name]);
      expect(await sealMatches(text, await saveSeal(text))).toBe(true);
      expect(parseSealedSeason(text)).toEqual(states[name]);
    }
    expect(advance(parseSeason(serializeSeasonCompact(states.opening)))).toEqual(advance(states.opening));
  }, 120_000);
});
