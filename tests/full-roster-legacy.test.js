import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseSeason } from '../src/storage/season-storage';
import { advanceSeason, managedSide } from '../src/world/season';
import { simulateToEnd, setAutoSubstitutions } from '../src/engine/match';
import { expectValidOldSaveWeek, parseCapturedState } from './helpers/old-save-week';
const completeRound = state => advanceSeason({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) });

describe('original format-45 continuation', () => {
  // Match calibration and realistic injuries (sprint 4) changed the simulated results after this old save, so the week is
  // checked for what must hold under intended rule changes (tests/helpers/old-save-week.ts).
  it('keeps all original fields and continues a valid matchday that follows the captured one in existing careers', () => {
    const base = new URL('./fixtures/', import.meta.url);
    const input = readFileSync(new URL('season45-roster-legacy.json.gz', base));
    const next = readFileSync(new URL('season45-roster-legacy-next.json.gz', base));
    const manifest = JSON.parse(readFileSync(new URL('season45-roster-legacy-manifest.json', base), 'utf8'));
    const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
    expect(hash(input)).toBe(manifest.inputSha256); expect(hash(next)).toBe(manifest.nextSha256);
    const state = parseSeason(gunzipSync(input).toString('utf8'));
    const expected = JSON.parse(gunzipSync(next).toString('utf8'));
    expect(expected.schemaVersion).toBe(45);
    const played = completeRound(state);
    expectValidOldSaveWeek(state, played, parseCapturedState(expected));
    // Every field the format-45 runtime wrote is still there.
    for (const key of Object.keys(expected)) expect(played, key).toHaveProperty(key);
  });
});
