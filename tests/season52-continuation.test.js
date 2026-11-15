import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseSeason, serializeSeasonCompact, SEASON_SCHEMA_VERSION } from '../src/storage/season-storage';
import { advanceSeason, getStandings, managedSide, rolloverSeason } from '../src/world/season';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { seasonLeagues } from '../src/world/divisions';
import { expandJson } from '../src/storage/compact-json';
import { classificationPoints } from '../src/world/fiba-ranking';

const root = new URL('./fixtures/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('season52-background-legacy-manifest.json', root), 'utf8'));
const hash = value => createHash('sha256').update(value).digest('hex');
/** The genuine file and its decoded format-50 state, after checking the recorded hash. */
function fixture(name) {
  const bytes = readFileSync(new URL(`season52-background-legacy-${name}.json.gz`, root));
  expect(hash(bytes)).toBe(manifest.files[`season52-background-legacy-${name}`].sha256);
  const text = gunzipSync(bytes).toString('utf8');
  const envelope = JSON.parse(text);
  expect(envelope).toMatchObject({ formatVersion: 52, encoding: 'compact-2' });
  return { text, raw: expandJson({ strings: envelope.strings, shapes: envelope.shapes, nodes: envelope.nodes, value: envelope.state }) };
}
const play = state => advanceSeason(state.activeMatch ? { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) } : state);
const roundTrip = state => parseSeason(serializeSeasonCompact(state));

describe('original format-52 two-division baseline (captured before format 53, step 3.4d-1)', () => {
  it('was captured from the unchanged format-50 runtime', () => {
    expect(manifest.schema).toBe(52);
    expect(manifest.standingsRule).toBe('fiba-2026-d');
    expect(manifest.source).toMatch(/^commit 9f159de1cb05f8fe5237e7c1be7ae48a3a522d5d \(src unchanged\)$/);
    expect(manifest.moduleCount).toBeGreaterThan(100);
    expect(SEASON_SCHEMA_VERSION).toBeGreaterThan(52);
  });

  it('gains an empty record of clubs outside the full world and continues a week exactly', () => {
    const state = parseSeason(fixture('mid').text);
    expect(state.schemaVersion).toBe(SEASON_SCHEMA_VERSION);
    expect(state.world.domesticLeagues.map(league => league.standingsRule)).toEqual(['fiba-2026-d', 'fiba-2026-d']);
    for (const league of seasonLeagues(state.world, state.divisions)) {
      const points = getStandings(state).filter(row => league.clubIds.includes(row.clubId)).map(classificationPoints);
      expect(points).toEqual([...points].sort((a, b) => b - a));
    }
    expect(roundTrip(state)).toEqual(state);
    const next = play(state);
    // Format 53 adds an empty record of clubs outside the full world; everything else continues exactly.
    // Format 53 adds an empty record of clubs outside the full world; format 55 lets exchanges begin after the next season.
    expect(next.background).toEqual({ model: 'background-1', clubs: [], changesFrom: 2, exchanges: [] });
    expect(next).toEqual({ ...fixture('mid-next').raw, schemaVersion: next.schemaVersion, background: next.background });
  }, 300_000);

  it('keeps the divisions a format-50 save records and rolls over exactly as captured', () => {
    const { text, raw } = fixture('complete');
    const complete = parseSeason(text);
    expect(complete.status).toBe('complete');
    expect(complete.divisions).toEqual(raw.divisions);
    expect(roundTrip(complete)).toEqual(complete);
    const opening = rolloverSeason(complete);
    const captured = fixture('opening');
    expect(opening).toEqual({ ...captured.raw, schemaVersion: opening.schemaVersion, background: { model: 'background-1', clubs: [], changesFrom: 2, exchanges: [] } });
    // Season two's recorded divisions differ from the opening leagues; loading must not reset them.
    const loaded = parseSeason(captured.text);
    expect(loaded.divisions).toEqual(captured.raw.divisions);
    expect(loaded.divisions.leagues.map(league => league.clubIds)).not.toEqual(loaded.world.domesticLeagues.map(league => league.clubIds));
    // Loaded in season two, the career's exchanges begin a season later; everything else is the same.
    expect(loaded.background.changesFrom).toBe(3);
    expect({ ...loaded, background: opening.background }).toEqual(opening);
  }, 300_000);
});
