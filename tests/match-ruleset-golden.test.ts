import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { goldenCases, goldenHashes } from './helpers/fiba-golden';

/**
 * NBA step 3: FIBA matches replay bit for bit after the per-competition rulesets were added. The hashes were captured
 * before the engine change by scripts/capture-fiba-golden.mjs (event lists, box scores and final states of about sixty
 * seeded matches across both engines, the possession actions, plays-2, plays-3, head-coach rotations, neutral venues,
 * youth squads, injuries, morale, circles and a manager playing by hand).
 */
const golden = JSON.parse(readFileSync(new URL('./fixtures/fiba-golden.json', import.meta.url), 'utf8')) as { count: number; matches: Record<string, unknown> };

describe('FIBA golden matches', () => {
  const cases = goldenCases();
  it('covers every captured match', () => {
    expect(cases.length).toBe(golden.count);
    expect(cases.map(item => item.name).sort()).toEqual(Object.keys(golden.matches).sort());
  });
  for (const { name, run } of cases) it(`replays ${name} exactly`, () => {
    expect(goldenHashes(run())).toEqual(golden.matches[name]);
  });
});
