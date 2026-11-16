import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseSeason, serializeSeasonCompact } from '../src/storage/season-storage';
import { advanceSeason, managedSide } from '../src/world/season';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { expectValidOldSaveWeek, parseCapturedState } from './helpers/old-save-week';

describe('original format-47 shared-calendar baseline', () => {
  // Match calibration and realistic injuries (sprint 4) changed the simulated results after this old save, so the week is
  // checked for what must hold under intended rule changes (tests/helpers/old-save-week.ts).
  it('retains the original ranking rules and continues a valid week that follows the independently captured one', () => {
    const root = new URL('./fixtures/', import.meta.url);
    const manifest = JSON.parse(readFileSync(new URL('season47-standings-legacy-manifest.json', root), 'utf8'));
    const bytes = readFileSync(new URL('season47-standings-legacy.json.gz', root));
    const nextBytes = readFileSync(new URL('season47-standings-legacy-next.json.gz', root));
    const hash = value => createHash('sha256').update(value).digest('hex');
    expect(hash(bytes)).toBe(manifest.inputSha256);
    expect(hash(nextBytes)).toBe(manifest.nextSha256);
    const state = parseSeason(gunzipSync(bytes).toString('utf8'));
    expect(state.world.domesticLeagues.every(league => !Object.hasOwn(league,'standingsRule'))).toBe(true);
    expect(parseSeason(serializeSeasonCompact(state))).toEqual(state);
    const next = advanceSeason(state.activeMatch ? { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) } : state);
    const original = JSON.parse(gunzipSync(nextBytes).toString('utf8'));
    expect(original.schemaVersion).toBe(47);
    expectValidOldSaveWeek(state, next, parseCapturedState(original));
    expect(next.world.domesticLeagues.every(league => !Object.hasOwn(league, 'standingsRule'))).toBe(true);
  },120000);
});
