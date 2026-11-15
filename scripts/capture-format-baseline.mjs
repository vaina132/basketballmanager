// Captures genuine current-format saves of a public two-division domestic career, for continuation tests.
//
// Run this BEFORE changing the season save format, on unchanged code, so the files come from the old runtime:
//   node scripts/capture-format-baseline.mjs <label>          (writes tests/fixtures/season<version>-<label>-*.json.gz)
//   node scripts/capture-format-baseline.mjs <label> --force  (overwrites files of the same names; unchanged code only)
//   node scripts/capture-format-baseline.mjs <label> --fiba   (both leagues use the FIBA default standings rule; format 51 on)
//   node scripts/capture-format-baseline.mjs <label> --lower  (adds Testland's next division of four generated clubs; format 54 on)
//
// The world is the public test world of tests/division-changes.test.js: one country ("Testland") with a six-club
// first division and a five-club second division, both with postseasons, and opening contracts of one to three
// seasons. The career uses every new-career system and ordinary world commands with automatic substitutions.
// Four files and a manifest are written:
//   <prefix>-mid       season one after three weeks          <prefix>-mid-next   the next week, played by that runtime
//   <prefix>-complete  season one finished, market closed     <prefix>-opening    its rollover into season two
// The manifest records the SHA-256 of every file and of every source module the runtime loaded.
import { createServer } from 'vite';
import { existsSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import assert from 'node:assert/strict';

const label = process.argv[2];
const force = process.argv.includes('--force');
const fiba = process.argv.includes('--fiba');
const lower = process.argv.includes('--lower');
if (!label || label.startsWith('-') || !/^[a-z0-9-]+$/.test(label)) throw new Error('Usage: node scripts/capture-format-baseline.mjs <label> [--force]');
const server = await createServer({
  configFile: false,
  logLevel: 'error',
  cacheDir: 'node_modules/.vite-fixture-capture',
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, hmr: false, watch: null },
  appType: 'custom',
});

try {
  const load = path => server.ssrLoadModule(path);
  const [season, engine, storage, employment, market, marketPolicy, fixtures, lowerDivision] = await Promise.all([
    '/src/world/season.ts', '/src/engine/match.ts', '/src/storage/season-storage.ts', '/src/world/employment.ts',
    '/src/world/market.ts', '/src/world/market-policy.ts', '/tests/world-fixtures.ts', ...(lower ? ['/src/world/lower-division.ts'] : []),
  ].map(load));
  const version = storage.SEASON_SCHEMA_VERSION;
  const prefix = `season${version}-${label}`;
  const names = ['mid', 'mid-next', 'complete', 'opening'].map(name => `${prefix}-${name}`);
  const existing = [...names.map(name => `${name}.json.gz`), `${prefix}-manifest.json`].filter(name => existsSync(`tests/fixtures/${name}`));
  if (existing.length && !force) throw new Error(`Refusing to overwrite ${existing.join(', ')}. Fixtures must come from their own format's runtime; pass --force only to regenerate them on unchanged code.`);

  const base = fixtures.testWorld(11);
  const playerContracts = Object.fromEntries(base.clubs.flatMap(club => club.players.map((player, index) => [player.id, 1 + (index % 3)])));
  const twoDivisions = { ...base, id: 'format-baseline-test', rosterModel: 'club-roster-1', playerContracts, domesticLeagues: [
    { id: 'first', name: 'First division', country: 'Testland', tier: 1, clubIds: base.clubs.slice(0, 6).map(club => club.id), postseason: 'test-tier1-1' },
    { id: 'second', name: 'Second division', country: 'Testland', tier: 2, clubIds: base.clubs.slice(6).map(club => club.id), postseason: 'test-tier2-1' },
  ].map(league => fiba ? { ...league, standingsRule: 'fiba-2026-d' } : league) };
  const world = lower ? lowerDivision.withLowerDivisions(twoDivisions, [{ country: 'Testland', tier: 3, name: 'Third division', clubs: [1, 2, 3, 4].map(index => ({ id: `third-${index}`, name: `Third Club ${index}`, shortName: `TC${index}`, color: '#336699' })) }]) : twoDivisions;
  const manager = { name: 'Fixture Manager', dateOfBirth: '1984-03-17', nationality: 'Germany' };
  const play = state => season.advanceSeason(state.activeMatch ? { ...state, activeMatch: engine.simulateToEnd(engine.setAutoSubstitutions(state.activeMatch, season.managedSide(state), true)) } : state);

  let state = employment.setEmploymentDelegation(season.createSeason({ seed: 5150, world, managedClubId: world.clubs[0].id, manager, ...season.NEW_CAREER_SYSTEMS }), true);
  while (state.round < 4) state = play(state);
  const mid = state;
  const midNext = play(mid);
  let complete = midNext;
  while (complete.status === 'active') complete = play(complete);
  for (let steps = 0; steps < 120 && marketPolicy.getMarketStartReason(complete); steps += 1) complete = market.advanceMarket(complete);
  assert.equal(marketPolicy.getMarketStartReason(complete), null, 'The offseason market must finish before rollover.');
  const opening = season.rolloverSeason(complete);

  const sha = value => createHash('sha256').update(value).digest('hex');
  const files = {};
  for (const [name, value] of [[names[0], mid], [names[1], midNext], [names[2], complete], [names[3], opening]]) {
    const text = storage.serializeSeasonCompact(value);
    assert.deepEqual(storage.parseSeason(text), value, `${name} must reload exactly before it is written.`);
    const bytes = gzipSync(text, { level: 9 });
    await writeFile(`tests/fixtures/${name}.json.gz`, bytes);
    files[name] = { sha256: sha(bytes), round: value.round, seasonNumber: value.seasonNumber, status: value.status, bytes: text.length };
  }
  const modules = Object.fromEntries([...server.moduleGraph.idToModuleMap.keys()]
    .filter(id => id.includes('/src/') && !id.includes('node_modules'))
    .map(id => id.slice(id.indexOf('/src/') + 1).split('?')[0])
    .filter((id, index, all) => all.indexOf(id) === index)
    .sort()
    .map(id => [id, sha(readFileSync(id))]));
  let commit = 'unknown', clean = false;
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    clean = execFileSync('git', ['status', '--porcelain', '--', 'src'], { encoding: 'utf8' }).trim() === '';
  } catch { /* Not a git checkout: the module hashes still identify the runtime. */ }
  const manifest = { source: `commit ${commit}${clean ? ' (src unchanged)' : ' (src has uncommitted changes)'}`, schema: version, world: world.id, seed: 5150, standingsRule: fiba ? 'fiba-2026-d' : null, lowerDivision: lower, files, moduleCount: Object.keys(modules).length, modules };
  await writeFile(`tests/fixtures/${prefix}-manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ prefix, files, moduleCount: manifest.moduleCount, source: manifest.source }, null, 2));
} finally {
  await server.close();
}
