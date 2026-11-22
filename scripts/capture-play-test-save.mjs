// Captures a genuine save of a small real-club career, as the player's browser writes it, for old-save tests of the
// formats players may hold since the play test began (format 73 on).
//
// Run it from the root of a read-only checkout of the commit whose format is wanted (node_modules may be a link to
// another checkout's; the packages have not changed since format 73), writing into this repository's fixtures:
//   git worktree add --detach <dir> <commit>
//   cd <dir> && node <this repository>/scripts/capture-play-test-save.mjs <this repository>/tests/fixtures [--force]
//
// The world is built like a browser career: `worldFromPack` on a synthetic real-data pack (`tests/helpers/economy-pack.ts`
// of that checkout): one Turkish top division of eight clubs with squads of twelve. The career is created with the
// browser's options (every new-career system, standard injuries) at the fourth club. On its first day the manager buys
// a player from the weakest club (an in-season transfer, fee paid upfront) and, where the format has transfer lists
// (78 on), lists one of his own players. Weeks are played with automatic substitutions until the career has played at
// least four weeks, completed the transfer and recorded an injury; from format 80 (national teams) also until the
// November window has been played. Three files are written:
//   season<version>-playtest-career.json.gz       that save (compact, exactly as `serializeSeasonCompact` writes it)
//   season<version>-playtest-career-next.json.gz  the next week, played by the same runtime
//   season<version>-playtest-manifest.json        commit, file hashes, what the career holds, and every loaded module's hash
import { createServer } from 'vite';
import { existsSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import assert from 'node:assert/strict';

const out = process.argv[2];
const force = process.argv.includes('--force');
if (!out || out.startsWith('-') || !existsSync(out)) throw new Error('Usage: node capture-play-test-save.mjs <fixtures directory> [--force]');
const server = await createServer({
  configFile: false,
  logLevel: 'error',
  cacheDir: 'node_modules/.vite-play-test-capture',
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, hmr: false, watch: null },
  appType: 'custom',
});

try {
  const load = path => server.ssrLoadModule(path);
  const [season, engine, storage, realWorld, recruitment, recruitmentPolicy, negotiationsPolicy, packs] = await Promise.all([
    '/src/world/season.ts', '/src/engine/match.ts', '/src/storage/season-storage.ts', '/src/world/real-world.ts', '/src/world/recruitment.ts',
    '/src/world/recruitment-policy.ts', '/src/world/negotiations-policy.ts', '/tests/helpers/economy-pack.ts',
  ].map(load));
  const listings = existsSync('src/world/listings.ts') ? await load('/src/world/listings.ts') : null;
  const version = storage.SEASON_SCHEMA_VERSION;
  const prefix = `season${version}-playtest`;
  const names = { career: `${prefix}-career`, next: `${prefix}-career-next` };
  const existing = [`${names.career}.json.gz`, `${names.next}.json.gz`, `${prefix}-manifest.json`].filter(name => existsSync(`${out}/${name}`));
  if (existing.length && !force) throw new Error(`Refusing to overwrite ${existing.join(', ')}. Fixtures must come from their own format's runtime.`);

  const levels = [16, 15, 14, 13, 12, 11, 10, 8];
  const pack = packs.economyPack([{ id: 'bsl', name: 'Basketbol Super Ligi', country: 'Turkey', tier: 1, levels }], null, 12);
  const world = realWorld.worldFromPack({ ...pack, players: pack.players.map(player => ({ ...player, nationality: 'Turkey' })) }, 'bsl');
  const manager = { name: 'Play Test Manager', dateOfBirth: '1984-03-17', nationality: 'Turkey' };
  const play = state => season.advanceSeason(state.activeMatch && state.activeMatch.status !== 'finished' ? { ...state, activeMatch: engine.simulateToEnd(engine.setAutoSubstitutions(state.activeMatch, season.managedSide(state), true)) } : state);

  // The browser's new career: `startSeason` in src/App.tsx passes these options.
  let state = season.createSeason({ seed: 7300 + version, world, managedClubId: 'bsl-4', injuryMode: 'standard', manager, ...season.NEW_CAREER_SYSTEMS });
  const signing = 'bsl-8-p3';
  state = recruitment.submitInSeasonTransferOffer(state, signing, negotiationsPolicy.requiredNegotiationWage(signing, 2, undefined, state), 2, recruitmentPolicy.requiredInSeasonTransferFee(state, signing), state.managedClubId, 'upfront');
  let listed = null;
  if (listings?.usesPlayerListings(state)) {
    listed = 'bsl-4-p11';
    state = listings.setPlayerListing(state, listed, { transfer: true, loan: false });
  }
  const signed = current => current.employment.transfers.some(transfer => transfer.playerId === signing);
  // Format 80 on (national teams, a Turkish world): the career also plays through the November window (window 1).
  const windowOpen = current => !!current.national?.competitions.some(competition => competition.fixtures.some(fixture => fixture.window === 1 && !fixture.result));
  while (state.round < 5 || !signed(state) || state.injuries.length === 0 || windowOpen(state)) {
    assert.ok(state.round < (state.national ? 20 : 12) && state.status === 'active', 'The career must complete the transfer and record an injury within eleven weeks (and the November window within nineteen).');
    state = play(state);
  }
  const career = state;
  const next = play(career);
  assert.ok(career.fixtures.some(fixture => fixture.result && [fixture.homeClubId, fixture.awayClubId].includes(career.managedClubId)), 'The manager\'s club must have played.');

  const sha = value => createHash('sha256').update(value).digest('hex');
  const files = {};
  for (const [name, value] of [[names.career, career], [names.next, next]]) {
    // What the browser stores: the compact save text, written only after the full career check accepts the career.
    const text = storage.serializeSeasonCompact(value);
    assert.deepEqual(storage.parseSeason(text), value, `${name} must reload exactly before it is written.`);
    const bytes = gzipSync(text, { level: 9 });
    await writeFile(`${out}/${name}.json.gz`, bytes);
    files[name] = { sha256: sha(bytes), seasonNumber: value.seasonNumber, round: value.round, date: value.date, status: value.status, bytes: text.length };
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
    clean = execFileSync('git', ['status', '--porcelain', '--', 'src', 'tests/helpers'], { encoding: 'utf8' }).trim() === '';
  } catch { /* Not a git checkout: the module hashes still identify the runtime. */ }
  const career_ = {
    managedClubId: career.managedClubId, signing, listed,
    transfers: career.employment.transfers.length, injuries: career.injuries.length,
    playedFixtures: career.fixtures.filter(fixture => fixture.result).length,
    // Format 80 on: the national games played so far (the November window).
    ...(career.national ? { nationalPlayed: career.national.competitions.flatMap(competition => competition.fixtures).filter(fixture => fixture.result).length } : {}),
    // Every system's model (the walk of `careerRules` in tests/helpers/old-save-week.ts, models only).
    models: Object.fromEntries(Object.entries(career).flatMap(([key, value]) => key === 'world' || key === 'activeMatch' ? [] : /(^model|Model)$/.test(key) ? [[key, value]] : value && typeof value === 'object' && !Array.isArray(value) && typeof value.model === 'string' ? [[`${key}.model`, value.model]] : [])),
  };
  const manifest = { source: `commit ${commit}${clean ? ' (src unchanged)' : ' (src has uncommitted changes)'}`, schema: version, world: world.id, seed: 7300 + version, career: career_, files, moduleCount: Object.keys(modules).length, modules };
  await writeFile(`${out}/${prefix}-manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ prefix, files, career: career_, moduleCount: manifest.moduleCount, source: manifest.source }, null, 2));
} finally {
  await server.close();
}
