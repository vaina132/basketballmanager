import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { parseSeason, serializeSeason, serializeSeasonCompact } from '../src/storage/season-storage';
import { advanceSeason, managedSide, rolloverSeason } from '../src/world/season';
import { expectValidOldSaveWeek } from './helpers/old-save-week';

// Genuine format-39 saves: the built-in league from scripts/capture-season-fixtures.mjs, and an eight-club test world
// (tests/world-fixtures.ts) captured before format 40 introduced the compact layout; see tests/fixtures/README.md.
const NAMES = ['board-career', 'board-career-next', 'board-complete', 'board-opening', 'world8-career', 'world8-career-next'];
const fixture = name => gunzipSync(readFileSync(new URL(`./fixtures/season39-${name}.json.gz`, import.meta.url))).toString('utf8');
const advance = state => advanceSeason({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) });
let raw, states;

beforeAll(() => {
  const texts = Object.fromEntries(NAMES.map(name => [name, fixture(name)]));
  raw = Object.fromEntries(NAMES.map(name => [name, JSON.parse(texts[name])]));
  states = Object.fromEntries(NAMES.map(name => [name, parseSeason(texts[name])]));
}, 120_000);

describe('genuine format-39 careers', () => {
  it('were written by the format-39 runtime in the plain layout, the eight-club world carrying its world', () => {
    for (const file of Object.values(raw)) { expect(file.formatVersion).toBe(39); expect(Object.keys(file)).toEqual(['format', 'formatVersion', 'engineVersion', 'state']); }
    expect(raw['board-career'].state.dataPackId).toBe('development-league-1');
    expect(raw['world8-career'].state.world.clubs).toHaveLength(8);
    expect(states['world8-career'].world.id).toBe('test-world-8');
  });

  // Match calibration and realistic injuries (sprint 4) changed the simulated results after these old saves, so each week is
  // checked for what must hold under intended rule changes (tests/helpers/old-save-week.ts). The rollover plays no games.
  it('continue mid-season for a valid week that follows the recorded one, in the built-in league and in the eight-club world', () => {
    expectValidOldSaveWeek(states['board-career'], advance(states['board-career']), states['board-career-next']);
    expectValidOldSaveWeek(states['world8-career'], advance(states['world8-career']), states['world8-career-next']);
  }, 120_000);

  it('roll the completed offseason into the recorded opening', () => {
    expect(rolloverSeason(states['board-complete'])).toEqual(states['board-opening']);
  }, 120_000);

  it('round-trip through both current layouts', () => {
    for (const state of Object.values(states)) {
      expect(parseSeason(serializeSeason(state))).toEqual(state);
      expect(parseSeason(serializeSeasonCompact(state))).toEqual(state);
    }
  }, 120_000);
});
