import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { getPlayerRelationship } from '../src/world/relationships';
import { advanceSeason, managedSide, rolloverSeason } from '../src/world/season';

// Genuine format-34 saves from scripts/capture-season-fixtures.mjs; see tests/fixtures/README.md.
const NAMES = ['career', 'career-next', 'complete', 'opening'];
const fixture = name => gunzipSync(readFileSync(new URL(`./fixtures/season34-board-${name}.json.gz`, import.meta.url))).toString('utf8');
const advance = state => advanceSeason({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) });
let raw, career, careerNext, complete, opening;

beforeAll(() => {
  const texts = Object.fromEntries(NAMES.map(name => [name, fixture(name)]));
  raw = Object.fromEntries(NAMES.map(name => [name, JSON.parse(texts[name])]));
  [career, careerNext, complete, opening] = NAMES.map(name => parseSeason(texts[name]));
}, 120_000);

describe('genuine format-34 careers', () => {
  it('were written by the format-34 runtime with a recorded press answer', () => {
    for (const file of Object.values(raw)) expect(file.formatVersion).toBe(34);
    expect(raw.career.state.relationships.events.filter(event => event.type === 'press')).toEqual([expect.objectContaining({ topic: 'winning-run', triggerRound: 4, answer: 'credit', clubId: 'rhine-falcons' })]);
    expect([career.round, careerNext.round, complete.status, opening.seasonNumber]).toEqual([5, 6, 'complete', 2]);
    const player = career.relationships.events.find(event => event.type === 'press').playerIds[0];
    expect(getPlayerRelationship(career, player).reasons.find(reason => reason.label === 'Press comments')?.impact).toBe(2);
  });

  it('continues the mid-season career, with the press answer in the next frozen morale, exactly as recorded', () => {
    expect(advance(career)).toEqual(careerNext);
  }, 120_000);

  it('rolls the completed offseason into the recorded opening', () => {
    expect(rolloverSeason(complete)).toEqual(opening);
  }, 120_000);

  it('round-trips every captured career through the current save format', () => {
    for (const state of [career, careerNext, complete, opening]) expect(parseSeason(serializeSeason(state))).toEqual(state);
  }, 120_000);
});
