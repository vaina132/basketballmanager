import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseSeason } from '../src/storage/season-storage';
import { getSquadRelationships } from '../src/world/relationships';

// Captured from untouched 75deff4 before the optimization. These hashes include every displayed field,
// promise, evidence identity and conversation in original player order; no private data is included.
const baseline = JSON.parse(readFileSync(new URL('./fixtures/relationships-read-models-44.json', import.meta.url), 'utf8'));
const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);

describe('original relationship report compatibility', () => {
  it.each(baseline.fixtures)('preserves the complete independent report for $file', expected => {
    const bytes = readFileSync(new URL(`./fixtures/${expected.file}`, import.meta.url));
    expect(hash(bytes)).toBe(expected.sha256);
    const state = parseSeason(gunzipSync(bytes).toString('utf8'));
    const before = canonical(state);
    const rows = state.clubs.flatMap(club => getSquadRelationships(state, club.id));
    expect(rows).toHaveLength(expected.players);
    expect(rows.reduce((sum, row) => sum + row.promises.length, 0)).toBe(expected.promises);
    expect(hash(canonical(rows))).toBe(expected.readModelSha256);
    expect(canonical(state)).toBe(before);
  }, 120_000);
});
