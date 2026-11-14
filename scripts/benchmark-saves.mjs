// Opt-in diagnostics, deliberately outside Vitest discovery. No API calls or private pack paths.
// Use --help for examples. Retained inputs let later implementations measure identical careers.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { gzipSync, gunzipSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const script = fileURLToPath(import.meta.url);
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const timestamp = () => new Date().toISOString().replace(/[:.]/g, '-');
// Object insertion order can change after compact decoding. Preserve values and array order.
const stateHash = state => hash(JSON.stringify(state, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value));
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const measure = async operation => {
  const start = performance.now();
  const value = await operation();
  return { value, ms: performance.now() - start };
};

function help() {
  console.log(`Save benchmark (run serially, without other tests, builds or browser profiling)

  npm.cmd run benchmark:saves -- --pack C:\\path\\to\\pack.json
  npm.cmd run benchmark:saves -- --development --seasons 1 --warm 1
  npm.cmd run benchmark:saves -- --fixture tests/fixtures/season40-board-career.json.gz
  npm.cmd run benchmark:saves -- --reuse .artifacts/save-benchmark-<timestamp>

Choose exactly one input: --pack, --development, --fixture, or --reuse.
  --pack PATH        Owner-supplied data pack; read only, never fetched or changed
  --league NAME/ID   Default: Basketball Bundesliga (only with --pack)
  --club NAME/ID     Default: Bayern Munich; rhine-falcons for --development
  --seed NUMBER      Default: 31
  --seasons NUMBER   Default: 3; saves each season end and the next opening
  --warm NUMBER      Warm samples per operation; default: 1; use 3 for medians
  --out DIRECTORY    New output directory; default: ignored .artifacts/save-benchmark-<timestamp>
  --fixture PATH    Measure one existing JSON/gzip save without generating seasons
  --reuse DIRECTORY Remeasure retained fixtures with the current implementation

Each fixture gets a fresh Node process. Cold strict parse excludes module startup;
warm strict parse, full export, validated checkpoint write plus seal, and verified
sealed loads are separate timings. Assertions and exact next-state comparisons are
outside timers. Input hashes, UTF-8 sizes, gzip sizes and subsystem sizes are retained.
Private fixtures remain in the chosen output directory: keep it ignored/private.
Existing artifacts are never overwritten. The default Vitest suite does not run this.
`);
}

function options() {
  const result = { seasons: 3, warm: 1, seed: 31 };
  for (let i = 2; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--development') { result.development = true; continue; }
    const key = arg.slice(2);
    assert(arg.startsWith('--') && ['pack', 'league', 'club', 'seed', 'seasons', 'warm', 'out', 'fixture', 'reuse', 'worker'].includes(key), `Unknown option: ${arg}`);
    assert(process.argv[i + 1] && !process.argv[i + 1].startsWith('--'), `Missing value for ${arg}`);
    result[key] = process.argv[++i];
  }
  if (result.worker) return result;
  assert.equal(['pack', 'development', 'fixture', 'reuse'].filter(key => result[key]).length, 1, 'Choose exactly one of --pack, --development, --fixture or --reuse.');
  for (const key of ['seed', 'seasons', 'warm']) {
    result[key] = Number(result[key]);
    assert(Number.isSafeInteger(result[key]) && result[key] >= (key === 'seed' ? 0 : 1), `--${key} must be a ${key === 'seed' ? 'nonnegative' : 'positive'} integer.`);
  }
  assert(result.seasons <= 20 && result.warm <= 20, '--seasons and --warm must not exceed 20.');
  assert(!result.league || result.pack, '--league requires --pack.');
  return result;
}

function sourceIdentity() {
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  const files = [...new Set(git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter(name =>
    /^(src\/|scripts\/|tests\/|package(?:-lock)?\.json$|vite\.config\.ts$|tsconfig\.json$)/.test(name)))].sort();
  const digest = createHash('sha256');
  for (const name of files) {
    digest.update(name + '\0');
    digest.update(existsSync(resolve(root, name)) ? readFileSync(resolve(root, name)) : '<deleted>');
    digest.update('\0');
  }
  return { commit: git(['rev-parse', 'HEAD']).trim(), sourceSha256: digest.digest('hex'), node: process.version, platform: process.platform, architecture: process.arch };
}

async function modules() {
  const { createServer } = await import('vite');
  const server = await createServer({ root, configFile: false, logLevel: 'error', cacheDir: 'node_modules/.vite-save-benchmark',
    optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom' });
  try {
    const [world, engine, storage, seals, employment, market, marketPolicy, real, packs, compact] = await Promise.all([
      '/src/world/season.ts', '/src/engine/match.ts', '/src/storage/season-storage.ts', '/src/storage/save-seal.ts',
      '/src/world/employment.ts', '/src/world/market.ts', '/src/world/market-policy.ts', '/src/world/real-world.ts',
      '/src/world/data-pack.ts', '/src/storage/compact-json.ts',
    ].map(path => server.ssrLoadModule(path)));
    const advance = state => world.advanceSeason({ ...state, activeMatch: engine.simulateToEnd(engine.setAutoSubstitutions(state.activeMatch, world.managedSide(state), true)) });
    const rollover = state => {
      for (let steps = 0; steps < 200 && marketPolicy.getMarketStartReason(state); steps += 1) state = market.advanceMarket(state);
      assert.equal(marketPolicy.getMarketStartReason(state), null, 'Offseason must finish before rollover.');
      return world.rolloverSeason(state);
    };
    const continuation = state => advance(state.status === 'active' ? state : rollover(state));
    return { server, world, storage, seals, employment, real, packs, compact, advance, rollover, continuation };
  } catch (error) { await server.close(); throw error; }
}

function describeState(state, compact, serialized) {
  const bytes = value => Buffer.byteLength(JSON.stringify(compact.compactJson(value)) ?? 'null', 'utf8');
  const envelope = JSON.parse(serialized);
  const legacy = compact.compactJson(state);
  // Compare encodings of exactly the same current state, including identical envelope metadata.
  // This hypothetical compact-1 envelope is for sizing only, not an importable old-schema save.
  const compact1Text = JSON.stringify({ format: envelope.format, formatVersion: envelope.formatVersion,
    engineVersion: envelope.engineVersion, encoding: compact.LEGACY_COMPACT_JSON_ENCODING ?? 'compact-1',
    strings: legacy.strings, shapes: legacy.shapes, state: legacy.value });
  assert.deepEqual(compact.expandJson(legacy), state, 'Compact-1 size reference must preserve exactly the same state.');
  const compact1EquivalentBytes = Buffer.byteLength(compact1Text, 'utf8');
  const storedBytes = Buffer.byteLength(serialized, 'utf8');
  return {
    season: state.seasonNumber, round: state.round, date: state.date, status: state.status,
    clubs: state.world?.clubs.length ?? state.clubs.length,
    outputEncoding: envelope.encoding, compact1EquivalentBytes, encodingBytesSaved: compact1EquivalentBytes - storedBytes,
    encodingReductionPercent: 100 * (compact1EquivalentBytes - storedBytes) / compact1EquivalentBytes,
    compact1SubsystemBytes: Object.fromEntries(Object.entries(state).map(([key, value]) => [key, bytes(value)]).sort((a, b) => b[1] - a[1]).slice(0, 15)),
    historySeasons: state.history.length, youthSeasons: state.youthCompetition?.seasons.length ?? 0,
    ledgerEntries: state.finance.ledger.length,
  };
}

async function retainState(runtime, state, name, out) {
  const text = runtime.storage.serializeSeasonCompact(state);
  // Validate once in the generating process; this is not reported as cold parsing.
  assert.deepEqual(runtime.storage.parseSeason(text), state, `${name}: strict roundtrip`);
  const originalHash = stateHash(state);
  const next = runtime.continuation(state);
  assert.equal(stateHash(state), originalHash, `${name}: continuation mutated its source`);
  const fixture = `${name}.json`;
  writeFileSync(resolve(out, fixture), text, { flag: 'wx' });
  return { name, fixture, sha256: hash(text), utf8Bytes: Buffer.byteLength(text, 'utf8'), gzipBytes: gzipSync(text).length,
    expectedStateSha256: originalHash, expectedContinuationSha256: stateHash(next),
    continuation: state.status === 'active' ? 'one matchday' : 'offseason, rollover, one matchday',
    ...describeState(state, runtime.compact, text) };
}

async function generate(opts, out) {
  const runtime = await modules();
  try {
    if (opts.fixture) {
      const input = readFileSync(resolve(opts.fixture));
      const text = (input[0] === 0x1f && input[1] === 0x8b ? gunzipSync(input) : input).toString('utf8');
      const state = runtime.storage.parseSeason(text);
      // Preserve the supplied bytes/schema for cold migration measurements.
      const item = await retainState(runtime, state, 'supplied-current', out);
      writeFileSync(resolve(out, 'supplied-original.json'), text, { flag: 'wx' });
      return { input: { kind: 'fixture', path: resolve(opts.fixture), sha256: hash(input) }, fixtures: [
        { ...item, name: 'supplied-original', fixture: 'supplied-original.json', sha256: hash(text), utf8Bytes: Buffer.byteLength(text), gzipBytes: gzipSync(text).length },
      ] };
    }
    let input = { kind: 'development' }, world, managedClubId = opts.club ?? 'rhine-falcons';
    if (opts.pack) {
      const path = resolve(opts.pack), source = readFileSync(path);
      const pack = await runtime.packs.parseDataPack(source.toString('utf8'));
      const name = opts.league ?? 'Basketball Bundesliga';
      const league = runtime.real.careerCompetitions(pack).find(item => item.id === name || item.name === name);
      assert(league, `Pack has no playable league named ${name}.`);
      world = runtime.real.worldFromPack(pack, league.id);
      const clubName = opts.club ?? 'Bayern Munich';
      const club = world.clubs.find(item => item.id === clubName || item.name === clubName);
      assert(club, `${name} has no club named ${clubName}.`);
      managedClubId = club.id;
      input = { kind: 'pack', path, sha256: hash(source), league: league.name, leagueId: league.id, club: club.name, clubId: club.id };
    }
    let state = runtime.employment.setEmploymentDelegation(runtime.world.createSeason({ seed: opts.seed, ...(world ? { world } : {}), managedClubId,
      injuryMode: 'standard', ...runtime.world.NEW_CAREER_SYSTEMS }), true);
    const fixtures = [], generation = [];
    for (let season = 1; season <= opts.seasons; season += 1) {
      const start = performance.now();
      let matchdays = 0;
      while (state.status === 'active') { assert(++matchdays <= 200, 'Season failed to complete.'); state = runtime.advance(state); }
      generation.push({ season, matchdays, elapsedMs: performance.now() - start });
      console.log(`Season ${season} complete (${matchdays} matchdays). Retaining and checking the fixture.`);
      fixtures.push(await retainState(runtime, state, `season-${season}-end`, out));
      state = runtime.rollover(state);
    }
    fixtures.push(await retainState(runtime, state, `season-${opts.seasons + 1}-opening`, out));
    if (input.path) assert.equal(hash(readFileSync(input.path)), input.sha256, 'Source pack changed during generation.');
    return { input, fixtures, generation, seed: opts.seed, seasons: opts.seasons };
  } finally { await runtime.server.close(); }
}

async function worker(jobPath) {
  const job = readJson(jobPath), item = job.item;
  const bytes = readFileSync(job.fixturePath);
  assert.equal(hash(bytes), item.sha256, 'Retained fixture changed.');
  const text = bytes.toString('utf8');
  const startup = performance.now(), runtime = await modules();
  try {
    const moduleStartupMs = performance.now() - startup;
    // First parse happens in this fresh process, before any season generation or validation.
    const cold = await measure(() => runtime.storage.parseSeason(text));
    const state = cold.value;
    assert.equal(stateHash(state), item.expectedStateSha256, 'Cold parse changed original state.');
    const warmStrictParseMs = [];
    for (let i = 0; i < job.warm; i += 1) {
      const sample = await measure(() => runtime.storage.parseSeason(text));
      warmStrictParseMs.push(sample.ms);
      assert.deepEqual(sample.value, state);
    }
    const exported = await measure(() => runtime.storage.serializeSeasonCompact(state));
    assert.deepEqual(runtime.storage.parseSeason(exported.value), state, 'Export changed state.');
    // Follow the persisted path: full validation before granting a seal, never a structural-only serializer.
    const checkpoint = await measure(async () => {
      const serialized = runtime.storage.serializeSeasonCompact(state);
      return { serialized, seal: await runtime.seals.saveSeal(serialized) };
    });
    assert.equal(checkpoint.value.serialized, exported.value);
    const sealedLoadMs = [];
    for (let i = 0; i < job.warm; i += 1) {
      const sample = await measure(async () => {
        const valid = await runtime.seals.sealMatches(checkpoint.value.serialized, checkpoint.value.seal);
        return valid ? runtime.storage.parseSealedSeason(checkpoint.value.serialized) : runtime.storage.parseSeason(checkpoint.value.serialized);
      });
      sealedLoadMs.push(sample.ms);
      assert.deepEqual(sample.value, state, 'Sealed load changed state.');
    }
    const originalHash = stateHash(state);
    const next = runtime.continuation(state);
    assert.equal(stateHash(next), item.expectedContinuationSha256, 'Independent continuation differs from original career.');
    assert.equal(stateHash(state), originalHash, 'Continuation mutated loaded state.');
    assert.equal(hash(readFileSync(job.fixturePath)), item.sha256, 'Benchmark changed the fixture.');
    const result = { name: item.name, sourceFixtureSha256: item.sha256, inputBytes: bytes.length,
      outputBytes: Buffer.byteLength(exported.value), gzipBytes: gzipSync(exported.value).length,
      moduleStartupMs, coldStrictParseMs: cold.ms, warmStrictParseMs, warmStrictParseMedianMs: median(warmStrictParseMs),
      fullExportMs: exported.ms, validatedCheckpointAndSealMs: checkpoint.ms, sealAvailable: typeof checkpoint.value.seal === 'string',
      verifiedSealedLoadMs: sealedLoadMs, verifiedSealedLoadMedianMs: median(sealedLoadMs),
      exactStateAndContinuation: true, maxResidentSetKiB: process.resourceUsage().maxRSS,
      ...describeState(state, runtime.compact, exported.value) };
    writeFileSync(job.resultPath, json(result), { flag: 'wx' });
    console.log(`${item.name}: ${(result.outputBytes / 1e6).toFixed(2)} MB (${result.encodingReductionPercent.toFixed(1)}% smaller than compact-1 of identical state), cold strict ${(cold.ms / 1000).toFixed(2)} s, warm strict ${(result.warmStrictParseMedianMs / 1000).toFixed(2)} s, sealed ${(result.verifiedSealedLoadMedianMs / 1000).toFixed(2)} s`);
  } finally { await runtime.server.close(); }
}

async function run(opts) {
  const before = sourceIdentity();
  const out = resolve(opts.out ?? resolve(root, '.artifacts', `save-benchmark-${timestamp()}`));
  assert(!existsSync(out), `Output already exists: ${out}. Choose a new --out directory; use --reuse to read old inputs.`);
  mkdirSync(out, { recursive: true });
  console.log(`Saving private benchmark artifacts to ${out}`);
  let manifest, fixtureDirectory = out;
  if (opts.reuse) {
    fixtureDirectory = resolve(opts.reuse);
    manifest = readJson(resolve(fixtureDirectory, 'manifest.json'));
    assert.equal(manifest.benchmarkFormat, 1, 'Unsupported benchmark manifest.');
    for (const item of manifest.fixtures) assert.equal(hash(readFileSync(resolve(fixtureDirectory, item.fixture))), item.sha256, 'Retained fixture changed.');
    manifest = { ...manifest, reusedFrom: fixtureDirectory, measuredSource: before };
  } else {
    manifest = { benchmarkFormat: 1, createdAt: new Date().toISOString(), generatedSource: before, ...(await generate(opts, out)) };
  }
  // In a reused run keep fixture references portable relative to this new manifest.
  manifest = { ...manifest, fixtures: manifest.fixtures.map(item => ({ ...item, fixture: relative(out, resolve(fixtureDirectory, item.fixture)) })) };
  writeFileSync(resolve(out, 'manifest.json'), json(manifest), { flag: 'wx' });
  const results = [];
  for (const item of manifest.fixtures) {
    const resultPath = resolve(out, `${item.name}-result.json`), jobPath = resolve(out, `${item.name}-job.json`);
    writeFileSync(jobPath, json({ item, warm: opts.warm, fixturePath: resolve(out, item.fixture), resultPath }), { flag: 'wx' });
    await new Promise((complete, reject) => {
      const child = spawn(process.execPath, [script, '--worker', jobPath], { cwd: root, stdio: 'inherit', windowsHide: true });
      child.once('error', reject);
      child.once('exit', (code, signal) => code === 0 ? complete() : reject(new Error(`Benchmark worker failed (${signal ?? code}). Retained artifacts: ${out}`)));
    });
    results.push(readJson(resultPath));
  }
  const after = sourceIdentity();
  assert.equal(after.sourceSha256, before.sourceSha256, 'Implementation changed during benchmark: results are not comparable; rerun against the retained fixtures.');
  if (manifest.input?.path && !opts.reuse) assert.equal(hash(readFileSync(manifest.input.path)), manifest.input.sha256, 'Benchmark input changed.');
  writeFileSync(resolve(out, 'report.json'), json({ benchmarkFormat: 1, completedAt: new Date().toISOString(), source: before, warmSamples: opts.warm,
    limitations: ['Node timings exclude IndexedDB and browser structured-clone/worker messaging.', 'Cold parse starts after module loading in a fresh process; warm medians use the requested sample count.', 'Sealed loads include digest verification; full imports always perform strict checks.',
      'compact1EquivalentBytes uses identical current state and envelope metadata: an encoding-only comparison, not an importable old-schema save.',
      'compact1SubsystemBytes lists the largest 15 independently encoded fields; their separate dictionaries mean they must not be summed as whole-save sizes.'], results }), { flag: 'wx' });
  console.log(`Verified identical state and independent continuation for every fixture. Report: ${resolve(out, 'report.json')}`);
}

try {
  const opts = options();
  if (opts.help) help();
  else if (opts.worker) await worker(resolve(opts.worker));
  else await run(opts);
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
}
