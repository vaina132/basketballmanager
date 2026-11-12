import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { advanceSeason, managedSide, rolloverSeason } from '../src/world/season';

// Genuine format-32 saves from scripts/capture-season-fixtures.mjs; see tests/fixtures/README.md.
const NAMES = ['career', 'career-next', 'complete', 'opening'];
const fixture = name => gunzipSync(readFileSync(new URL(`./fixtures/season32-board-${name}.json.gz`, import.meta.url))).toString('utf8');
const advance = state => advanceSeason({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) });
let raw, career, careerNext, complete, opening;

beforeAll(() => {
  const texts = Object.fromEntries(NAMES.map(name => [name, fixture(name)]));
  raw = Object.fromEntries(NAMES.map(name => [name, JSON.parse(texts[name])]));
  [career, careerNext, complete, opening] = NAMES.map(name => parseSeason(texts[name]));
}, 120_000);

describe('genuine format-32 careers', () => {
  it('were written by the format-32 runtime with board funding requests and a recorded automatic approval', () => {
    for (const file of Object.values(raw)) expect(file.formatVersion).toBe(32);
    expect(raw.career.state.facilities.fundingSince).toMatchObject({ seasonNumber: 1, round: 1 });
    expect(raw.career.state.facilities.events.filter(event => event.type === 'funding')).toEqual([]);
    const decisions = raw.complete.state.facilities.events.filter(event => event.type === 'funding');
    expect(decisions).toEqual([expect.objectContaining({ clubId: 'aegean-waves', mode: 'automatic', approved: true })]);
    expect(raw.complete.state.finance.ledger.filter(entry => entry.kind === 'board-capital')).toEqual([expect.objectContaining({ clubId: 'aegean-waves', amount: decisions[0].amount })]);
    expect([career.round, careerNext.round, complete.status, opening.seasonNumber]).toEqual([5, 6, 'complete', 2]);
  });

  it('continues the mid-season career into the next matchday exactly as recorded', () => {
    expect(advance(career)).toEqual(careerNext);
  }, 120_000);

  it('rolls the completed offseason into the recorded opening', () => {
    expect(rolloverSeason(complete)).toEqual(opening);
  }, 120_000);

  it('round-trips every captured career through the current save format', () => {
    for (const state of [career, careerNext, complete, opening]) expect(parseSeason(serializeSeason(state))).toEqual(state);
  }, 120_000);
});
