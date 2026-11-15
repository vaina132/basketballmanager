import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseSeason, serializeSeason, serializeSeasonCompact, SEASON_SCHEMA_VERSION } from '../src/storage/season-storage';
import { advanceSeason, managedSide, rolloverSeason } from '../src/world/season';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { expandJson } from '../src/storage/compact-json';
import { regularWorldRounds } from '../src/world/career-world';

const root = new URL('./fixtures/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('season58-bcl-legacy-manifest.json', root), 'utf8'));
const hash = value => createHash('sha256').update(value).digest('hex');
/** The genuine file and its decoded format-56 state, after checking the recorded hash. */
function fixture(name) {
  const bytes = readFileSync(new URL(`season58-bcl-legacy-${name}.json.gz`, root));
  expect(hash(bytes)).toBe(manifest.files[`season58-bcl-legacy-${name}`].sha256);
  const text = gunzipSync(bytes).toString('utf8');
  const envelope = JSON.parse(text);
  expect(envelope).toMatchObject({ formatVersion: 58, encoding: 'compact-2' });
  return { text, raw: expandJson({ strings: envelope.strings, shapes: envelope.shapes, nodes: envelope.nodes, value: envelope.state }) };
}
const play = state => advanceSeason(state.activeMatch ? { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) } : state);
const roundTrip = state => parseSeason(serializeSeasonCompact(state));

describe('original format-58 career playing a EuroLeague (captured before format 59, step 3.5e)', () => {
  it('was captured from the unchanged format-58 runtime', () => {
    expect(manifest.schema).toBe(58);
    expect(manifest.europe).toBe(true);
    expect(manifest.source).toMatch(/^commit 5feca33fc7909043adab5bcdfbe5351322dea0ad \(src unchanged\)$/);
    expect(manifest.moduleCount).toBeGreaterThan(100);
    expect(SEASON_SCHEMA_VERSION).toBeGreaterThan(58);
  });

  it('keeps its EuroLeague calendar and results and continues a week exactly', () => {
    const state = parseSeason(fixture('mid').text);
    expect(state.schemaVersion).toBe(SEASON_SCHEMA_VERSION);
    expect(state.world.europeanCompetitions[0].format).toBe('euroleague-2026-1');
    expect(regularWorldRounds(state.world)).toBe(38);
    expect(state.fixtures.filter(fixture => fixture.competition === 'euroleague')).toHaveLength(90);
    expect(state.fixtures.some(fixture => fixture.competition && fixture.result)).toBe(true);
    expect(roundTrip(state)).toEqual(state);
    const next = play(state);
    expect(next).toEqual({ ...fixture('mid-next').raw, schemaVersion: next.schemaVersion });
  }, 300_000);

  it('keeps its completed EuroLeague and rolls over exactly as captured', () => {
    const { text } = fixture('complete');
    const complete = parseSeason(text);
    expect(complete.status).toBe('complete');
    expect(complete.fixtures.some(fixture => fixture.competition === 'euroleague' && fixture.stage === 'final' && fixture.result)).toBe(true);
    expect(roundTrip(complete)).toEqual(complete);
    const opening = rolloverSeason(complete);
    const captured = fixture('opening');
    expect(opening).toEqual({ ...captured.raw, schemaVersion: opening.schemaVersion });
    expect(parseSeason(captured.text)).toEqual(opening);
  }, 300_000);
});
