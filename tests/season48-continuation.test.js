import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseSeason, serializeSeasonCompact } from '../src/storage/season-storage';
import { advanceSeason, managedSide } from '../src/world/season';
import { seasonRounds } from '../src/world/career-world';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { expectValidOldSaveWeek, parseCapturedState } from './helpers/old-save-week';

describe('original format-48 shared-calendar baseline', () => {
  // Match calibration and realistic injuries (sprint 4) changed the simulated results after this old save, so the week is
  // checked for what must hold under intended rule changes (tests/helpers/old-save-week.ts).
  it('keeps its regular-season-only calendar and continues a valid week that follows the one captured before the postseason (step 3.4)', () => {
    const root = new URL('./fixtures/', import.meta.url);
    const manifest = JSON.parse(readFileSync(new URL('season48-postseason-legacy-manifest.json', root), 'utf8'));
    const bytes = readFileSync(new URL('season48-postseason-legacy.json.gz', root));
    const nextBytes = readFileSync(new URL('season48-postseason-legacy-next.json.gz', root));
    const hash = value => createHash('sha256').update(value).digest('hex');
    expect(hash(bytes)).toBe(manifest.inputSha256);
    expect(hash(nextBytes)).toBe(manifest.nextSha256);
    const state = parseSeason(gunzipSync(bytes).toString('utf8'));
    expect(state.world.domesticLeagues.every(league => !Object.hasOwn(league, 'postseason'))).toBe(true);
    expect(seasonRounds(state)).toBe(10);
    expect(parseSeason(serializeSeasonCompact(state))).toEqual(state);
    const next = advanceSeason(state.activeMatch ? { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) } : state);
    const original = JSON.parse(gunzipSync(nextBytes).toString('utf8'));
    expect(original.schemaVersion).toBe(48);
    expectValidOldSaveWeek(state, next, parseCapturedState(original));
    // Still no postseason: the calendar keeps its ten regular-season weeks.
    expect(seasonRounds(next)).toBe(10);
    expect(next.fixtures.some(fixture => fixture.stage)).toBe(false);
  }, 120000);
});
