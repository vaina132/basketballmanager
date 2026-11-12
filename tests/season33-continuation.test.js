import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { advanceSeason, managedSide, rolloverSeason } from '../src/world/season';
import { staffAllocation, staffCommitted } from '../src/world/staff-policy';

// Genuine format-33 saves from scripts/capture-season-fixtures.mjs; see tests/fixtures/README.md.
const NAMES = ['career', 'career-next', 'complete', 'opening'];
const fixture = name => gunzipSync(readFileSync(new URL(`./fixtures/season33-board-${name}.json.gz`, import.meta.url))).toString('utf8');
const advance = state => advanceSeason({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) });
let raw, career, careerNext, complete, opening;

beforeAll(() => {
  const texts = Object.fromEntries(NAMES.map(name => [name, fixture(name)]));
  raw = Object.fromEntries(NAMES.map(name => [name, JSON.parse(texts[name])]));
  [career, careerNext, complete, opening] = NAMES.map(name => parseSeason(texts[name]));
}, 120_000);

describe('genuine format-33 careers', () => {
  it('were written by the format-33 runtime with season verdicts governing the second season', () => {
    for (const file of Object.values(raw)) expect(file.formatVersion).toBe(33);
    expect(raw.career.state.board.consequencesSince).toMatchObject({ seasonNumber: 1, round: 1 });
    expect([career.round, careerNext.round, complete.status, opening.seasonNumber]).toEqual([5, 6, 'complete', 2]);
    expect(staffAllocation(opening, 'aegean-waves')).toBe(16_500_000);
    expect(staffAllocation(opening, 'adriatic-comets')).toBe(12_000_000);
    for (const club of opening.clubs) expect(staffCommitted(opening, club.id)).toBeLessThanOrEqual(staffAllocation(opening, club.id));
  });

  it('continues the mid-season career into the next matchday exactly as recorded', () => {
    expect(advance(career)).toEqual(careerNext);
  }, 120_000);

  it('rolls the completed offseason into the recorded opening under the season verdicts', () => {
    expect(rolloverSeason(complete)).toEqual(opening);
  }, 120_000);

  it('round-trips every captured career through the current save format', () => {
    for (const state of [career, careerNext, complete, opening]) expect(parseSeason(serializeSeason(state))).toEqual(state);
  }, 120_000);
});
