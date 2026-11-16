import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { advanceSeason, managedSide, rolloverSeason } from '../src/world/season';
import { expectValidOldSaveWeek } from './helpers/old-save-week';

// Genuine format-35 saves from scripts/capture-season-fixtures.mjs; see tests/fixtures/README.md.
const NAMES = ['career', 'career-next', 'complete', 'opening'];
const fixture = name => gunzipSync(readFileSync(new URL(`./fixtures/season35-board-${name}.json.gz`, import.meta.url))).toString('utf8');
const advance = state => advanceSeason({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) });
let raw, career, careerNext, complete, opening;

beforeAll(() => {
  const texts = Object.fromEntries(NAMES.map(name => [name, fixture(name)]));
  raw = Object.fromEntries(NAMES.map(name => [name, JSON.parse(texts[name])]));
  [career, careerNext, complete, opening] = NAMES.map(name => parseSeason(texts[name]));
}, 120_000);

describe('genuine format-35 careers', () => {
  it('were written by the format-35 runtime with rivalries from the opening matchday and derby reviews', () => {
    for (const file of Object.values(raw)) expect(file.formatVersion).toBe(35);
    expect(raw.career.state.rivalries.enabledSince.effectiveFrom).toEqual({ seasonNumber: 1, round: 1 });
    expect(raw.complete.state.board.reviews.some(review => review.clubs['rhine-falcons'].rivalryImpact === 3)).toBe(true);
    expect(raw.complete.state.facilities.projects.filter(project => project.completedOn).length).toBeGreaterThan(0);
    expect([career.round, careerNext.round, complete.status, opening.seasonNumber]).toEqual([5, 6, 'complete', 2]);
  });

  // Match calibration and realistic injuries (sprint 4) changed the simulated results after this old save, so the week is
  // checked for what must hold under intended rule changes (tests/helpers/old-save-week.ts).
  it('continues the mid-season career for a valid week that follows the recorded matchday', () => {
    expectValidOldSaveWeek(career, advance(career), careerNext);
  }, 120_000);

  it('rolls the completed offseason into the recorded opening', () => {
    expect(rolloverSeason(complete)).toEqual(opening);
  }, 120_000);

  it('round-trips every captured career through the current save format', () => {
    for (const state of [career, careerNext, complete, opening]) expect(parseSeason(serializeSeason(state))).toEqual(state);
  }, 120_000);
});
