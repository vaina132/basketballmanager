import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseSeason } from '../src/storage/season-storage';
import { rolloverSeason } from '../src/world/season';

// Genuine format-37 saves (scripts/capture-season-fixtures.mjs; see tests/fixtures/README.md).
const fixture = name => gunzipSync(readFileSync(new URL(`./fixtures/season37-board-${name}.json.gz`, import.meta.url))).toString('utf8');

describe('rivalries in careers saved before format 68', () => {
  it('keep the fixed rivalries through a rollover into the recorded opening', () => {
    const complete = parseSeason(fixture('complete')), recorded = parseSeason(fixture('opening'));
    const next = rolloverSeason(complete);
    expect(next.rivalries).toEqual({ model: 'rivalries-1', enabledSince: complete.rivalries.enabledSince });
    expect(next).toEqual(recorded);
  }, 120_000);
});
