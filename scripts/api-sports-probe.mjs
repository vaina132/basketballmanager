#!/usr/bin/env node
/**
 * Real-data feasibility probe for API-SPORTS (API-BASKETBALL). Research only: nothing here changes the game.
 *
 * The key is read from `api-sports-key.local` in the project folder (ignored by Git, never printed or bundled).
 * Every response is cached under `.local-data/api-sports/` (ignored by Git) so a rerun spends no requests.
 * A run stops after `--budget` uncached requests (default 40; the free plan allows about 100 a day and 10 a minute,
 * so uncached requests are spaced 6.5 seconds apart). Error answers are never cached, so they are retried next run.
 *
 *   node scripts/api-sports-probe.mjs [--budget 40]
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEY_FILE = path.join(ROOT, 'api-sports-key.local');
const CACHE = path.join(ROOT, '.local-data', 'api-sports');
const BASE = 'https://v1.basketball.api-sports.io';
const budgetArg = process.argv.indexOf('--budget');
const BUDGET = budgetArg > 0 ? Number(process.argv[budgetArg + 1]) : 40;

// The first-release scope (docs/decisions.md#first-release-league-scope-and-league-selection).
const DOMESTIC = [
  { country: 'Turkey', tiers: 2 }, { country: 'Spain', tiers: 2 }, { country: 'Italy', tiers: 2 },
  { country: 'France', tiers: 2 }, { country: 'Greece', tiers: 1 }, { country: 'Germany', tiers: 1 },
];
const EUROPEAN = ['Euroleague', 'Eurocup', 'Champions League'];
// The free plan opens seasons 2022-2024 only; player data starts in 2023. European competitions use single-year seasons.
const PILOT = [{ id: 40, name: 'BBL', season: '2024-2025' }, { id: 120, name: 'Euroleague', season: 2024 }];
const SEASONS = ['2026-2027', '2025-2026', '2024-2025', '2023-2024', '2026', '2025', '2024', '2023'];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let lastRequest = 0;

let spent = 0;
const log = [];

async function apiKey() {
  if (!existsSync(KEY_FILE)) throw new Error('No key file yet. Create api-sports-key.local in the project folder containing only your API-Sports key (see the instructions in chat).');
  const key = (await readFile(KEY_FILE, 'utf8')).trim();
  if (!/^[A-Za-z0-9]{16,64}$/.test(key)) throw new Error('api-sports-key.local should contain only the key, letters and digits, on one line.');
  return key;
}

/** One cached GET; uncached calls count against the run budget. Personal account details are never written. */
async function get(endpoint, params = {}) {
  const query = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
  const label = `${endpoint}${query ? `?${query}` : ''}`;
  const file = path.join(CACHE, `${createHash('sha256').update(label).digest('hex').slice(0, 20)}.json`);
  if (existsSync(file)) { log.push({ label, cached: true }); return JSON.parse(await readFile(file, 'utf8')).body; }
  if (spent >= BUDGET) throw new Error(`Request budget of ${BUDGET} reached; rerun later or raise --budget.`);
  spent += 1;
  await pause(Math.max(0, lastRequest + 6500 - Date.now())); lastRequest = Date.now();
  let response, body;
  // A stuck connection is recorded and skipped instead of stopping the run.
  try {
    response = await fetch(`${BASE}/${endpoint}${query ? `?${query}` : ''}`, { headers: { 'x-apisports-key': await apiKey() }, signal: AbortSignal.timeout(45_000) });
    body = await response.json();
  } catch (error) {
    log.push({ label, networkError: error instanceof Error ? error.message : String(error) });
    return { errors: { network: 'The request failed or timed out.' }, results: 0, response: [] };
  }
  if (endpoint === 'status' && body?.response?.account) body.response.account = '[removed]';
  const limits = Object.fromEntries([...response.headers].filter(([name]) => /ratelimit|requests/i.test(name)));
  log.push({ label, status: response.status, results: body?.results, errors: body?.errors, limits });
  const failed = response.status !== 200 || (Array.isArray(body?.errors) ? body.errors.length : Object.keys(body?.errors ?? {}).length) > 0;
  if (!failed) {
    await mkdir(CACHE, { recursive: true });
    await writeFile(file, JSON.stringify({ label, fetchedAt: new Date().toISOString(), status: response.status, body }, null, 2));
  }
  return body;
}

const seasonInfo = league => (league.seasons ?? []).filter(item => SEASONS.includes(String(item.season))).map(item => ({ season: item.season, start: item.start, end: item.end, coverage: item.coverage ?? null }));
const summarize = league => ({ id: league.id, name: league.name, type: league.type, country: league.country?.name, seasons: seasonInfo(league) });

async function main() {
  await apiKey();
  const report = { generatedAt: new Date().toISOString(), base: BASE, notes: [] };
  const status = await get('status');
  report.status = { plan: status?.response?.subscription ?? null, requests: status?.response?.requests ?? null, errors: status?.errors ?? null };

  report.domestic = [];
  for (const { country, tiers } of DOMESTIC) {
    const leagues = await get('leagues', { country });
    report.domestic.push({ country, tiersInScope: tiers, errors: leagues?.errors, leagues: (leagues?.response ?? []).map(summarize) });
  }
  report.european = [];
  for (const name of EUROPEAN) {
    const leagues = await get('leagues', { search: name });
    report.european.push({ search: name, errors: leagues?.errors, leagues: (leagues?.response ?? []).map(summarize) });
  }

  // Pilot depth: clubs, one squad, the schedule, one player box score and the table, for a season the free plan opens.
  report.pilot = [];
  for (const league of PILOT) {
    const entry = { league: league.name, id: league.id, seasons: [] };
    for (const season of [league.season]) {
      const teams = await get('teams', { league: league.id, season });
      const result = { season, teamErrors: teams?.errors, teams: (teams?.response ?? []).map(team => ({ id: team.id, name: team.name, country: team.country?.name })) };
      if (result.teams.length) {
        const players = await get('players', { team: result.teams[0].id, season });
        result.samplePlayers = { team: result.teams[0].name, errors: players?.errors, count: players?.results, fields: Object.keys(players?.response?.[0] ?? {}), first: players?.response?.slice(0, 3) ?? [] };
        const games = await get('games', { league: league.id, season });
        const finished = (games?.response ?? []).filter(game => game.status?.short === 'FT' || game.status?.short === 'AOT');
        result.games = { errors: games?.errors, total: games?.results, finished: finished.length, fields: Object.keys(games?.response?.[0] ?? {}) };
        if (finished.length) {
          const box = await get('games/statistics/players', { id: finished[0].id });
          result.sampleBoxScore = { game: finished[0].id, errors: box?.errors, rows: box?.results, fields: Object.keys(box?.response?.[0] ?? {}), first: box?.response?.slice(0, 2) ?? [] };
          // Whether one request can return several games' player statistics decides the request volume of a full import.
          const several = await get('games/statistics/players', { ids: finished.slice(0, 3).map(game => game.id).join('-') });
          result.multiGameBoxScores = { games: finished.slice(0, 3).map(game => game.id), errors: several?.errors, rows: several?.results };
        }
        const standings = await get('standings', { league: league.id, season });
        result.standings = { errors: standings?.errors, results: standings?.results };
      }
      entry.seasons.push(result);
    }
    report.pilot.push(entry);
  }
  report.requests = { spentThisRun: spent, calls: log };
  await mkdir(CACHE, { recursive: true });
  await writeFile(path.join(CACHE, 'probe-report.json'), JSON.stringify(report, null, 2));
  console.log(`Probe finished: ${spent} new requests this run (budget ${BUDGET}). Report: .local-data/api-sports/probe-report.json`);
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
