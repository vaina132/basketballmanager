import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { advanceSeason, managedSide, rolloverSeason } from '../src/world/season';

// Genuine format-31 saves from scripts/capture-season-fixtures.mjs; see tests/fixtures/README.md.
const NAMES = ['career', 'career-next', 'complete', 'opening'];
const fixture = name => gunzipSync(readFileSync(new URL(`./fixtures/season31-board-${name}.json.gz`, import.meta.url))).toString('utf8');
const advance = state => advanceSeason({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) });
let raw, career, careerNext, complete, opening;

beforeAll(() => {
  const texts = Object.fromEntries(NAMES.map(name => [name, fixture(name)]));
  raw = Object.fromEntries(NAMES.map(name => [name, JSON.parse(texts[name])]));
  [career, careerNext, complete, opening] = NAMES.map(name => parseSeason(texts[name]));
}, 120_000);

describe('genuine format-31 careers', () => {
  it('were written by the format-31 runtime with sponsorship negotiations and the recorded decisions', () => {
    for (const file of Object.values(raw)) expect(file.formatVersion).toBe(31);
    expect(raw.career.state.commercial.enabledSince).toMatchObject({ seasonNumber: 1, round: 1 });
    expect(raw.career.state.commercial.offers).toEqual([]);
    const managedOffers = raw['career-next'].state.commercial.offers.filter(offer => offer.clubId === 'rhine-falcons');
    expect(managedOffers.length).toBe(3);
    expect(managedOffers.every(offer => offer.status === 'open')).toBe(true);
    expect(raw.opening.state.commercial.offers.filter(offer => offer.clubId === 'rhine-falcons').every(offer => offer.status === 'expired')).toBe(true);
    expect([career.round, careerNext.round, complete.status, opening.seasonNumber]).toEqual([5, 6, 'complete', 2]);
  });

  it('continues the mid-season career into the matchday-six offers exactly as recorded', () => {
    expect(advance(career)).toEqual(careerNext);
  }, 120_000);

  it('rolls the completed offseason into the recorded opening, expiring unsigned offers', () => {
    expect(rolloverSeason(complete)).toEqual(opening);
  }, 120_000);

  it('round-trips every captured career through the current save format', () => {
    for (const state of [career, careerNext, complete, opening]) expect(parseSeason(serializeSeason(state))).toEqual(state);
  }, 120_000);
});
