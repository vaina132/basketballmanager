// Opt-in full-management continuation diagnostic. No provider calls; input saves are read-only.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = value => createHash('sha256').update(value).digest('hex');
const stateHash = state => hash(JSON.stringify(state, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value));
const json = value => JSON.stringify(value, null, 2) + '\n';
function sourceIdentity() {
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const files = [...new Set(git(['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'src', 'scripts', 'tests', 'package.json', 'package-lock.json']).split('\0').filter(Boolean))].sort();
  return { commit: git(['rev-parse', 'HEAD']).trim(), sha256: hash(files.map(path => path + '\0' + (existsSync(resolve(root, path)) ? hash(readFileSync(resolve(root, path))) : '<deleted>')).join('\n')), node: process.version };
}
function options() {
  const opts = { seasons: 1, maxSeconds: 900 };
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === '--help' || arg === '-h') return { help: true };
    assert(['--fixture', '--seasons', '--max-seconds', '--out'].includes(arg), `Unknown option: ${arg}`);
    const value = process.argv[++i]; assert(value && !value.startsWith('--'), `Missing value for ${arg}`);
    opts[arg === '--max-seconds' ? 'maxSeconds' : arg.slice(2)] = value;
  }
  assert(opts.fixture, 'Supply --fixture PATH (an existing JSON or gzip career save).');
  opts.seasons = Number(opts.seasons); opts.maxSeconds = Number(opts.maxSeconds);
  assert(Number.isSafeInteger(opts.seasons) && opts.seasons >= 1 && opts.seasons <= 5, '--seasons must be 1-5 additional season rollovers.');
  assert(Number.isSafeInteger(opts.maxSeconds) && opts.maxSeconds >= 1 && opts.maxSeconds <= 7200, '--max-seconds must be 1-7200.');
  return opts;
}

const opts = options();
if (opts.help) {
  console.log(`Continue a saved career using all systems already enabled in that save.
  npm.cmd run benchmark:career -- --fixture PATH --seasons 2

  --fixture PATH       Existing JSON/gzip save; never modified
  --seasons 1-5        Additional rollovers to simulate (default 1)
  --max-seconds N      Stop at an operation boundary after this time (default 900)
  --out DIRECTORY     New directory; default ignored .artifacts/career-benchmark-<timestamp>

Progress is retained every five matchdays and during the offseason. Strictly validated
checkpoints are retained at each season end/opening; resume by passing one as --fixture.
A time limit or failure keeps earlier checkpoints and writes failure.json, then exits
unsuccessfully. This limit is checked between synchronous operations, not a hard timeout.
All active matches use assistant rotation; all other manager settings stay as saved.
Run sequentially with other benchmarks/tests. Output can contain private roster data:
keep it local/ignored. Timings are Node diagnostics, not browser latency measurements.`);
} else {
  const path = resolve(opts.fixture), bytes = readFileSync(path), inputHash = hash(bytes);
  const input = (bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes).toString('utf8');
  const out = resolve(opts.out ?? resolve(root, '.artifacts/career-benchmark-' + new Date().toISOString().replace(/[:.]/g, '-')));
  assert(!existsSync(out), 'Choose a new output directory; existing diagnostics are never overwritten.');
  mkdirSync(dirname(out), { recursive: true }); mkdirSync(out);
  const source = sourceIdentity(), started = performance.now(), checkpoints = [], timings = { matchdays: [], marketDays: [], rollovers: [] };
  const meta = { source, input: { path, sha256: inputHash }, requestedRollovers: opts.seasons, maxSeconds: opts.maxSeconds };
  writeFileSync(resolve(out, 'input.json'), json(meta), { flag: 'wx' });
  let server, state, initial, initialHash, targetSeason;
  const elapsed = () => (performance.now() - started) / 1000;
  const checkTime = () => assert(elapsed() < opts.maxSeconds, 'Diagnostic time limit reached; resume from the last retained checkpoint.');
  const progress = (phase, extra = {}) => {
    const row = { phase, season: state?.seasonNumber, round: state?.round, date: state?.date, elapsedSeconds: elapsed(), ...extra };
    appendFileSync(resolve(out, 'progress.jsonl'), JSON.stringify(row) + '\n'); console.log(JSON.stringify(row));
  };
  try {
    server = await createServer({ root, configFile: false, logLevel: 'error', optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, ws: false, watch: null }, appType: 'custom' });
    const [storage, season, engine, market, policy, ledger] = await Promise.all(['/src/storage/season-storage.ts', '/src/world/season.ts', '/src/engine/match.ts', '/src/world/market.ts', '/src/world/market-policy.ts', '/src/world/finance-ledger.ts'].map(path => server.ssrLoadModule(path)));
    state = storage.parseSeason(input); initial = state; initialHash = stateHash(initial); targetSeason = state.seasonNumber + opts.seasons;
    const advance = value => season.advanceSeason({ ...value, activeMatch: engine.simulateToEnd(engine.setAutoSubstitutions(value.activeMatch, season.managedSide(value), true)) });
    const measure = (kind, run) => { checkTime(); const start = performance.now(), value = run(); timings[kind].push(performance.now() - start); return value; };
    const checkpoint = label => {
      checkTime(); progress('checkpoint-start', { label });
      const start = performance.now(), text = storage.serializeSeasonCompact(state), writeMs = performance.now() - start;
      const readStart = performance.now(), restored = storage.parseSeason(text), readMs = performance.now() - readStart;
      assert.deepEqual(restored, state, `${label}: strict roundtrip changed state`);
      const filename = `${label}.json`;
      writeFileSync(resolve(out, filename), text, { flag: 'wx' });
      const row = { file: filename, season: state.seasonNumber, round: state.round, status: state.status, bytes: Buffer.byteLength(text), sha256: hash(text), stateSha256: stateHash(state),
        transactions: ledger.financeLedgerCount(state.finance), activeTransactions: state.finance.ledger.length, financeBlocks: state.finance.archives?.length ?? 0,
        contracts: state.employment.contracts.length, prospects: state.academy.prospects.length, academyWeeks: state.academy.weeks.length, youthSeasons: state.youthCompetition.seasons.length, writeMs, readMs };
      checkpoints.push(row);
      writeFileSync(resolve(out, `${label}.report.json`), json(row), { flag: 'wx' }); progress('checkpoint', row);
    };
    checkpoint('start');
    while (state.seasonNumber < targetSeason) {
      if (state.status === 'active') {
        state = measure('matchdays', () => advance(state));
        if (state.status === 'complete') checkpoint(`season-${state.seasonNumber}-end`);
        else if ((state.round - 1) % 5 === 0) progress('matchdays', { lastAdvanceMs: timings.matchdays.at(-1) });
      } else {
        let days = 0;
        while (policy.getMarketStartReason(state)) {
          assert(days < 200, 'Offseason did not finish within 200 ordinary market steps.');
          state = measure('marketDays', () => market.advanceMarket(state));
          if (++days % 5 === 0) progress('offseason', { days });
        }
        state = measure('rollovers', () => season.rolloverSeason(state));
        checkpoint(`season-${state.seasonNumber}-opening`);
      }
    }
    checkTime();
    const last = checkpoints.at(-1), restored = storage.parseSeason(readFileSync(resolve(out, last.file), 'utf8'));
    const before = stateHash(state), next = advance(state);
    assert.deepEqual(advance(restored), next, 'Final checkpoint changed ordinary continuation.');
    assert.equal(stateHash(state), before, 'Continuation mutated its input.'); assert.equal(stateHash(initial), initialHash, 'Career progression mutated its original state.');
    assert.equal(hash(readFileSync(path)), inputHash, 'Input file changed during the diagnostic.');
    assert.deepEqual(sourceIdentity(), source, 'Source/tests changed during the diagnostic.');
    const summary = values => ({ count: values.length, totalMs: values.reduce((sum, value) => sum + value, 0), medianMs: values.length ? [...values].sort((a,b) => a-b)[Math.floor(values.length / 2)] : null, maxMs: values.length ? Math.max(...values) : null });
    writeFileSync(resolve(out, 'report.json'), json({ ...meta, checkpoints, targetSeason, exactStrictRoundtrips: true, exactReloadContinuation: true, unchangedInputs: true,
      expectedFinalContinuationSha256: stateHash(next), timings: Object.fromEntries(Object.entries(timings).map(([key, values]) => [key, summary(values)])), elapsedSeconds: elapsed(), peakRssKiB: process.resourceUsage().maxRSS }), { flag: 'wx' });
    console.log(`PASSED ${out}`);
  } catch (error) {
    writeFileSync(resolve(out, 'failure.json'), json({ ...meta, checkpoints, elapsedSeconds: elapsed(), season: state?.seasonNumber, round: state?.round, date: state?.date, error: error.stack }), { flag: 'wx' });
    throw error;
  } finally { await server?.close(); }
}
