// Captures genuine current-format season saves for migration tests.
//
// Run this BEFORE changing the season save format, so the fixtures are produced by the unchanged runtime:
//   node scripts/capture-season-fixtures.mjs            (writes tests/fixtures/season<version>-*.json.gz)
//   node scripts/capture-season-fixtures.mjs --force    (overwrites existing files of the same names)
//
// The career is created exactly like the New career screen, then advanced with ordinary world commands only.
import { createServer } from 'vite';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import assert from 'node:assert/strict';

const force = process.argv.includes('--force');
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
  const [world, engine, storage, finance, facilities, employment, market, marketPolicy] = await Promise.all([
    '/src/world/season.ts', '/src/engine/match.ts', '/src/storage/season-storage.ts', '/src/world/finance.ts',
    '/src/world/facilities.ts', '/src/world/employment.ts', '/src/world/market.ts', '/src/world/market-policy.ts',
  ].map(load));
  const version = storage.SEASON_SCHEMA_VERSION;
  const prefix = `season${version}-board`;
  const names = ['career', 'career-next', 'complete', 'opening'].map(name => `${prefix}-${name}`);
  const existing = names.filter(name => existsSync(`tests/fixtures/${name}.json.gz`));
  if (existing.length && !force) throw new Error(`Refusing to overwrite ${existing.join(', ')}. Fixtures must come from their own format's runtime; pass --force only to regenerate them on unchanged code.`);

  // The same flags as App.startSeason: every system enabled for a new career.
  const manager = { name: 'Fixture Manager', dateOfBirth: '1984-03-17', nationality: 'Germany' };
  const enabled = Array.from({ length: 16 }, () => true);
  let state = world.createSeason(227, 'rhine-falcons', 'standard', true, true, true, true, manager, ...enabled);
  const advance = value => world.advanceSeason({ ...value, activeMatch: engine.simulateToEnd(engine.setAutoSubstitutions(value.activeMatch, world.managedSide(value), true)) });

  // A few ordinary manager decisions so the fixtures exercise more than defaults.
  state = finance.setTicketPlan(state, { delegated: false, price: 2200 });
  state = advance(state);
  state = facilities.startFacilityUpgrade(state, 'training');
  while (state.round < 5) state = advance(state);
  const career = state;
  const careerNext = advance(career);

  let complete = employment.setEmploymentDelegation(careerNext, true);
  while (complete.status === 'active') complete = advance(complete);
  for (let steps = 0; steps < 80 && marketPolicy.getMarketStartReason(complete); steps += 1) complete = market.advanceMarket(complete);
  assert.equal(marketPolicy.getMarketStartReason(complete), null, 'The offseason market must finish before rollover.');
  const opening = world.rolloverSeason(complete);

  const report = [];
  for (const [name, value] of [[names[0], career], [names[1], careerNext], [names[2], complete], [names[3], opening]]) {
    const text = storage.serializeSeason(value);
    assert.equal(JSON.parse(text).formatVersion, version);
    assert.deepEqual(storage.parseSeason(text), value);
    const zipped = gzipSync(text);
    await writeFile(`tests/fixtures/${name}.json.gz`, zipped);
    report.push({ name, season: value.seasonNumber, round: value.round, date: value.date, status: value.status, ledgerEntries: value.finance.ledger.length, boardReviews: value.board.reviews.length, jsonBytes: text.length, gzipBytes: zipped.length });
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  await server.close();
}
