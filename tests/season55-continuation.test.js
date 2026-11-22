import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseSeason, serializeSeasonCompact, SEASON_SCHEMA_VERSION } from '../src/storage/season-storage';
import { advanceSeason, getStandings, managedSide, rolloverSeason } from '../src/world/season';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { seasonLeagues } from '../src/world/divisions';
import { expandJson } from '../src/storage/compact-json';
import { expectValidOldSaveWeek, withFormat73Records } from './helpers/old-save-week';
import { classificationPoints } from '../src/world/fiba-ranking';

const root = new URL('./fixtures/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('season55-europe-legacy-manifest.json', root), 'utf8'));
const hash = value => createHash('sha256').update(value).digest('hex');
/** The genuine file and its decoded format-55 state, after checking the recorded hash. */
function fixture(name) {
  const bytes = readFileSync(new URL(`season55-europe-legacy-${name}.json.gz`, root));
  expect(hash(bytes)).toBe(manifest.files[`season55-europe-legacy-${name}`].sha256);
  const text = gunzipSync(bytes).toString('utf8');
  const envelope = JSON.parse(text);
  expect(envelope).toMatchObject({ formatVersion: 55, encoding: 'compact-2' });
  return { text, raw: expandJson({ strings: envelope.strings, shapes: envelope.shapes, nodes: envelope.nodes, value: envelope.state }) };
}
const play = state => advanceSeason(state.activeMatch ? { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) } : state);
const roundTrip = state => parseSeason(serializeSeasonCompact(state));

describe('original format-55 career with a next division (captured before format 56, step 3.5a)', () => {
  it('was captured from the unchanged format-55 runtime', () => {
    expect(manifest.schema).toBe(55);
    expect(manifest.lowerDivision).toBe(true);
    expect(manifest.standingsRule).toBe('fiba-2026-d');
    expect(manifest.source).toMatch(/^commit 664d1c15fe0a1a586572a93cc1160ff7252a0a08 \(src unchanged\)$/);
    expect(manifest.moduleCount).toBeGreaterThan(100);
    expect(SEASON_SCHEMA_VERSION).toBeGreaterThan(55);
  });

  it('keeps its next division outside the full world and continues a valid week that follows the captured one', () => {
    const state = parseSeason(fixture('mid').text);
    expect(state.schemaVersion).toBe(SEASON_SCHEMA_VERSION);
    expect(state.world.domesticLeagues.map(league => league.standingsRule)).toEqual(['fiba-2026-d', 'fiba-2026-d']);
    expect(state.world.lowerDivisions[0].clubIds).toEqual(['third-1', 'third-2', 'third-3', 'third-4']);
    expect(state.clubs.some(club => club.id.startsWith('third-'))).toBe(false);
    for (const league of seasonLeagues(state.world, state.divisions)) {
      const points = getStandings(state).filter(row => league.clubIds.includes(row.clubId)).map(classificationPoints);
      expect(points).toEqual([...points].sort((a, b) => b - a));
    }
    expect(roundTrip(state)).toEqual(state);
    const next = play(state);
    // Format 55 lets exchanges with a next division begin after the next season.
    // Match calibration and realistic injuries (sprint 4) changed the simulated results after this old save, so the week is
    // checked for what must hold under intended rule changes (tests/helpers/old-save-week.ts); the rollover plays no games.
    expectValidOldSaveWeek(state, next, parseSeason(fixture('mid-next').text));
    // The week's new results are still ranked by the rule the career was created with.
    for (const league of seasonLeagues(next.world, next.divisions)) {
      const points = getStandings(next).filter(row => league.clubIds.includes(row.clubId)).map(classificationPoints);
      expect(points).toEqual([...points].sort((a, b) => b - a));
    }
  }, 300_000);

  it('keeps its divisions and record of clubs outside the full world and rolls over exactly as captured', () => {
    const { text, raw } = fixture('complete');
    const complete = parseSeason(text);
    expect(complete.status).toBe('complete');
    expect(complete.divisions).toEqual(raw.divisions);
    expect(roundTrip(complete)).toEqual(complete);
    const opening = rolloverSeason(complete);
    const captured = fixture('opening');
    expect(opening).toEqual(withFormat73Records({ ...captured.raw, schemaVersion: opening.schemaVersion }));
    // Season two's recorded divisions differ from the opening leagues; loading must not reset them.
    const loaded = parseSeason(captured.text);
    expect(loaded.divisions).toEqual(captured.raw.divisions);
    expect(loaded).toEqual(opening);
  }, 300_000);
});
