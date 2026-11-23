/**
 * Captures the FIBA golden matches (NBA step 3): hashes of the event lists, box scores and final states of about sixty
 * seeded matches across every match model, written to tests/fixtures/fiba-golden.json. Run it only before an engine
 * change (never to make tests/match-ruleset-golden.test.ts pass after one): FIBA matches must replay bit for bit.
 *
 *   node scripts/capture-fiba-golden.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'tests/fixtures/fiba-golden.json');
const server = await createServer({ configFile: false, root, server: { middlewareMode: true, watch: null }, appType: 'custom', logLevel: 'error' });
try {
  const { goldenCases, goldenHashes } = await server.ssrLoadModule('/tests/helpers/fiba-golden.ts');
  const matches = {};
  for (const { name, run } of goldenCases()) matches[name] = goldenHashes(run());
  const fixture = {
    description: 'FIBA golden matches captured before the per-competition rulesets (NBA step 3, 23 November 2026). Regenerate only with an intended FIBA engine change.',
    count: Object.keys(matches).length, matches,
  };
  await fs.writeFile(output, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`Saved ${path.relative(root, output)} (${fixture.count} matches).`);
} finally { await server.close(); }
