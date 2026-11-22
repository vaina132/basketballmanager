import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';

// The longer injury lengths (`injuryModel: 'injuries-2'`) arrived with format 76: a save of an older format that records
// them is refused, while older saves without the field load as before. Plain JavaScript to read the fixture with Node.
const fixture = name => gunzipSync(readFileSync(new URL(`./fixtures/${name}.json.gz`, import.meta.url))).toString('utf8');

describe('injury model format guard', () => {
  it('refuses the injury model in saves older than format 76 and keeps older saves without it', () => {
    // A genuine format-75 save (no injury model), written again as a plain format-75 file.
    const state = parseSeason(fixture('season75-playtest-career'));
    expect(state).not.toHaveProperty('injuryModel');
    const plain = JSON.parse(serializeSeason(state));
    const asFormat = (version, extra = {}) => JSON.stringify({ ...plain, formatVersion: version, state: { ...plain.state, schemaVersion: version, ...extra } });
    expect(parseSeason(asFormat(75))).toEqual(state);
    expect(() => parseSeason(asFormat(75, { injuryModel: 'injuries-2' }))).toThrow(/injuryModel requires format 76 or later/);
    // A format-78 save that recorded the model still loads with it.
    expect(parseSeason(fixture('season78-playtest-career')).injuryModel).toBe('injuries-2');
  }, 600_000);
});
