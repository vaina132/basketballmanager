#!/usr/bin/env node
/**
 * Real-data pilot importer: API-SPORTS (API-BASKETBALL) into the owner's Supabase database (docs/real-data-feasibility.md).
 *
 * Keys come from `api-sports-key.local` and `supabase-key.local` in the project folder (ignored by Git, never printed).
 * Rerunnable: clubs, players and competitions are matched through their provider IDs and updated in place; finished
 * games whose player statistics are stored are not requested again. Each run is recorded in `import_runs`, and every
 * problem found is listed in `data_quality_issues`. The game never reads this database directly.
 *
 *   node scripts/real-data-import.mjs [--budget 1500] [--only 104,102] [--refresh-stats]   (--only: provider league IDs to import)
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyIdentities } from './real-data-identities.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SUPABASE_URL = 'https://kesxznybhotzduvcwiwm.supabase.co';
const API = 'https://v1.basketball.api-sports.io';
const PROVIDER = 'api-sports';
const budgetArg = process.argv.indexOf('--budget');
const BUDGET = budgetArg > 0 ? Number(process.argv[budgetArg + 1]) : 1500;
const TODAY = new Date().toISOString().slice(0, 10);

const onlyArg = process.argv.indexOf('--only');
const ONLY = onlyArg > 0 ? String(process.argv[onlyArg + 1] ?? '').split(',').map(id => id.trim()).filter(Boolean) : null;
/** --refresh-stats requests the player statistics of every finished game again (for example after a parsing fix); use it with --only. */
const REFRESH_STATS = process.argv.includes('--refresh-stats');
if (REFRESH_STATS && !ONLY) throw new Error('--refresh-stats requests every finished game again: name the leagues with --only.');

const DOMESTIC_SEASONS = Object.freeze([['2025-26', '2025-2026'], ['2026-27', '2026-2027']]);
const EUROPEAN_SEASONS = Object.freeze([['2025-26', '2025'], ['2026-27', '2026']]);
/**
 * First-release scope (owner, 13 November 2026): top and second divisions of Turkey, Spain, Italy and France, top
 * divisions of Greece and Germany, and the three European competitions; previous and current season. The pilot
 * imported the first two; sprint 3 adds the rest (docs/multi-league-world.md, step 3.1). IDs are API-Sports leagues.
 */
export const COMPETITIONS = Object.freeze([
  { providerId: '40', name: 'Basketball Bundesliga', country: 'Germany', tier: 1, kind: 'domestic', seasons: DOMESTIC_SEASONS },
  { providerId: '120', name: 'EuroLeague', country: null, tier: 1, kind: 'european', seasons: EUROPEAN_SEASONS },
  { providerId: '104', name: 'Basketbol Süper Ligi', country: 'Turkey', tier: 1, kind: 'domestic', seasons: DOMESTIC_SEASONS },
  { providerId: '102', name: 'Türkiye Basketbol Ligi', country: 'Turkey', tier: 2, kind: 'domestic', seasons: DOMESTIC_SEASONS },
  { providerId: '117', name: 'Liga ACB', country: 'Spain', tier: 1, kind: 'domestic', seasons: DOMESTIC_SEASONS },
  { providerId: '95', name: 'Primera FEB', country: 'Spain', tier: 2, kind: 'domestic', seasons: DOMESTIC_SEASONS },
  { providerId: '52', name: 'Lega Basket Serie A', country: 'Italy', tier: 1, kind: 'domestic', seasons: DOMESTIC_SEASONS },
  { providerId: '242', name: 'Serie A2', country: 'Italy', tier: 2, kind: 'domestic', seasons: DOMESTIC_SEASONS },
  { providerId: '2', name: 'LNB Élite', country: 'France', tier: 1, kind: 'domestic', seasons: DOMESTIC_SEASONS },
  { providerId: '8', name: 'Élite 2', country: 'France', tier: 2, kind: 'domestic', seasons: DOMESTIC_SEASONS },
  { providerId: '45', name: 'Greek Basket League', country: 'Greece', tier: 1, kind: 'domestic', seasons: DOMESTIC_SEASONS },
  { providerId: '194', name: 'EuroCup', country: null, tier: 2, kind: 'european', seasons: EUROPEAN_SEASONS },
  { providerId: '202', name: 'Basketball Champions League', country: null, tier: 2, kind: 'european', seasons: EUROPEAN_SEASONS },
]);

/** The competitions one run imports: all of them, or those named with --only (unknown IDs are refused). */
export function competitionsToImport(only = null) {
  if (!only) return [...COMPETITIONS];
  const unknown = only.filter(id => !COMPETITIONS.some(competition => competition.providerId === id));
  if (unknown.length || !only.length) throw new Error(`Unknown league ID(s) for --only: ${unknown.join(', ') || '(none given)'}. Known: ${COMPETITIONS.map(item => `${item.providerId} ${item.name}`).join('; ')}.`);
  return COMPETITIONS.filter(competition => only.includes(competition.providerId));
}
const FINISHED = new Set(['FT', 'AOT']);

async function secret(file, label) {
  const full = path.join(ROOT, file);
  if (!existsSync(full)) throw new Error(`Missing ${file}: save your ${label} in that file first (see the instructions in chat).`);
  return (await readFile(full, 'utf8')).trim();
}
let API_KEY = '', DB_KEY = '';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let requests = 0, lastRequest = 0;

/** One API-Sports call; the paid plan allows 300 a minute, so calls are spaced 250 ms apart and retried when throttled. */
async function api(endpoint, params) {
  for (let attempt = 1; ; attempt += 1) {
    if (requests >= BUDGET) throw new Error(`Request budget of ${BUDGET} reached; rerun to continue where it stopped.`);
    await pause(Math.max(0, lastRequest + 250 - Date.now())); lastRequest = Date.now(); requests += 1;
    const query = new URLSearchParams(params).toString();
    const response = await fetch(`${API}/${endpoint}?${query}`, { headers: { 'x-apisports-key': API_KEY }, signal: AbortSignal.timeout(60_000) });
    const body = await response.json().catch(() => ({}));
    const errors = Array.isArray(body.errors) ? body.errors : Object.values(body.errors ?? {});
    if (response.ok && !errors.length) return body.response ?? [];
    const throttled = response.status === 429 || errors.some(error => /rate ?limit|too many/i.test(String(error)));
    if ((throttled || response.status >= 500) && attempt < 4) { await pause(attempt * 15_000); continue; }
    throw new Error(`API-Sports ${endpoint}: ${response.status} ${JSON.stringify(body.errors ?? {})}`);
  }
}

/** Supabase REST with the secret key in the apikey header (new secret keys are not JWTs). */
async function db(method, resource, body, prefer) {
  const headers = { apikey: DB_KEY, 'Content-Type': 'application/json', ...(DB_KEY.startsWith('eyJ') ? { Authorization: `Bearer ${DB_KEY}` } : {}), ...(prefer ? { Prefer: prefer } : {}) };
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${resource}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Supabase ${method} ${resource.split('?')[0]}: ${response.status} ${(await response.text()).slice(0, 400)}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
async function selectAll(resource) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await db('GET', `${resource}${resource.includes('?') ? '&' : '?'}limit=1000&offset=${offset}`);
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}
async function write(table, rows, { onConflict, returning = false } = {}) {
  const saved = [];
  for (let start = 0; start < rows.length; start += 500) {
    const chunk = rows.slice(start, start + 500);
    const prefer = [onConflict ? 'resolution=merge-duplicates' : null, returning ? 'return=representation' : 'return=minimal'].filter(Boolean).join(',');
    const result = await db('POST', `${table}${onConflict ? `?on_conflict=${onConflict}` : ''}`, chunk, prefer);
    if (returning) saved.push(...result);
  }
  return saved;
}

/** Database access for companion scripts (club identities, ratings); reads the Supabase secret key once. */
export async function databaseHelpers() {
  if (!DB_KEY) DB_KEY = await secret('supabase-key.local', 'Supabase secret key');
  return { db, selectAll, write };
}

/** "Larkin Shane" -> "Shane Larkin": the provider lists the surname first. Initials-only names stay as they are. */
export function displayName(providerName) {
  const name = providerName.trim().replace(/\s+/g, ' ');
  if (/^[A-Z]\.\s/.test(name) || !name.includes(' ')) return name;
  const parts = name.split(' ');
  return `${parts.at(-1)} ${parts.slice(0, -1).join(' ')}`;
}
/** Playing time in seconds: the provider writes "25:14" for most leagues and whole minutes ("25") for some, such as the Italian Serie A. */
export const seconds = minutes => {
  const text = String(minutes ?? '').trim(), match = /^(\d+):(\d{1,2})$/.exec(text);
  const value = match && Number(match[2]) < 60 ? Number(match[1]) * 60 + Number(match[2]) : /^\d+$/.test(text) ? Number(text) * 60 : null;
  return Number.isSafeInteger(value) ? value : null;
};
const issues = [];
const issue = (entityType, entityRef, text, details) => issues.push({ entity_type: entityType, entity_ref: entityRef, issue: text, details: details ?? null });

async function main() {
  API_KEY = await secret('api-sports-key.local', 'API-Sports key');
  DB_KEY = await secret('supabase-key.local', 'Supabase secret key');
  const SCOPE = competitionsToImport(ONLY);
  const [run] = await write('import_runs', [{ provider: PROVIDER, scope: { competitions: SCOPE.map(item => ({ provider_id: item.providerId, seasons: item.seasons.map(([label]) => label) })) } }], { returning: true });
  const counts = { clubsAdded: 0, playersAdded: 0, memberships: 0, games: 0, boxScoreGames: 0, boxScoreRows: 0 };
  try {
    const competitionIds = new Map((await selectAll(`competition_provider_ids?provider=eq.${PROVIDER}&select=provider_id,competition_id`)).map(row => [row.provider_id, row.competition_id]));
    const clubIds = new Map((await selectAll(`club_provider_ids?provider=eq.${PROVIDER}&select=provider_id,club_id`)).map(row => [row.provider_id, row.club_id]));
    const playerIds = new Map((await selectAll(`player_provider_ids?provider=eq.${PROVIDER}&select=provider_id,player_id`)).map(row => [row.provider_id, row.player_id]));

    async function clubFor(team, country) {
      const key = String(team.id);
      if (clubIds.has(key)) return clubIds.get(key);
      const [club] = await write('clubs', [{ name: team.name, country: country ?? team.country?.name ?? null, identity_source: null }], { returning: true });
      await write('club_provider_ids', [{ provider: PROVIDER, provider_id: key, club_id: club.id }]);
      clubIds.set(key, club.id); counts.clubsAdded += 1;
      issue('club', club.id, 'City, venue and colours not yet maintained', { name: team.name });
      return club.id;
    }
    async function playersFor(entries) {
      const fresh = entries.filter(entry => !playerIds.has(String(entry.id)));
      if (fresh.length) {
        const saved = await write('players', fresh.map(entry => ({ full_name: displayName(entry.name), provider_name: entry.name, nationality: entry.country ?? null, position: entry.position ?? null, age_observed: entry.age ?? null, age_observed_on: entry.age ? TODAY : null })), { returning: true });
        await write('player_provider_ids', saved.map((player, index) => ({ provider: PROVIDER, provider_id: String(fresh[index].id), player_id: player.id })));
        saved.forEach((player, index) => playerIds.set(String(fresh[index].id), player.id));
        counts.playersAdded += saved.length;
      }
      // Newer squad observations refresh the provider facts of known players.
      // Merged players have several provider IDs; one row per player keeps the batch valid.
      const known = [...new Map(entries.filter(entry => entry.country !== undefined && !fresh.includes(entry)).map(entry => [playerIds.get(String(entry.id)), entry])).values()];
      if (known.length) await write('players', known.map(entry => ({ id: playerIds.get(String(entry.id)), full_name: displayName(entry.name), provider_name: entry.name, nationality: entry.country ?? null, position: entry.position ?? null, age_observed: entry.age ?? null, age_observed_on: entry.age ? TODAY : null, updated_at: new Date().toISOString() })), { onConflict: 'id' });
    }

    for (const competition of SCOPE) {
      let competitionId = competitionIds.get(competition.providerId);
      if (!competitionId) {
        const [row] = await write('competitions', [{ name: competition.name, country: competition.country, tier: competition.tier, kind: competition.kind }], { returning: true });
        await write('competition_provider_ids', [{ provider: PROVIDER, provider_id: competition.providerId, competition_id: row.id }]);
        competitionId = row.id; competitionIds.set(competition.providerId, row.id);
      }
      const [league] = await api('leagues', { id: competition.providerId });
      for (const [label, providerSeason] of competition.seasons) {
        const info = league?.seasons?.find(item => String(item.season) === providerSeason);
        const [season] = await write('seasons', [{ competition_id: competitionId, label, provider_season: providerSeason, starts_on: info?.start ?? null, ends_on: info?.end ?? null }], { onConflict: 'competition_id,label', returning: true });

        const teams = await api('teams', { league: competition.providerId, season: providerSeason });
        const seasonClubs = [];
        for (const team of teams) seasonClubs.push({ team, clubId: await clubFor(team, competition.country) });
        await write('participations', seasonClubs.map(item => ({ season_id: season.id, club_id: item.clubId })), { onConflict: 'season_id,club_id' });

        const existing = new Map((await selectAll(`roster_memberships?season_id=eq.${season.id}&select=club_id,player_id,first_seen_on`)).map(row => [`${row.club_id}/${row.player_id}`, row.first_seen_on]));
        const squadClub = new Map();
        for (const { team, clubId } of seasonClubs) {
          const squad = await api('players', { team: team.id, season: providerSeason });
          await playersFor(squad);
          const memberships = squad.map(entry => {
            const playerId = playerIds.get(String(entry.id));
            if (/^[A-Z]\.\s/.test(entry.name) || !entry.country || !entry.position) issue('player', playerId, 'Incomplete provider details', { provider_id: entry.id, name: entry.name, club: team.name, nationality: entry.country, position: entry.position, number: entry.number });
            if (entry.name.trim().split(/\s+/).length >= 3) issue('player', playerId, 'Name order uncertain; check the display name', { name: entry.name, shown_as: displayName(entry.name) });
            const number = Number.parseInt(entry.number, 10);
            return { season_id: season.id, club_id: clubId, player_id: playerId, shirt_number: Number.isInteger(number) && number >= 0 && number <= 99 ? number : null, first_seen_on: existing.get(`${clubId}/${playerId}`) ?? TODAY, last_seen_on: TODAY, source: PROVIDER };
          });
          const unique = [...new Map(memberships.map(row => [row.player_id, row])).values()];
          await write('roster_memberships', unique, { onConflict: 'season_id,club_id,player_id' });
          for (const membership of memberships) squadClub.set(membership.player_id, clubId);
          counts.memberships += memberships.length;
        }

        const games = await api('games', { league: competition.providerId, season: providerSeason });
        const stored = new Map((await selectAll(`games?season_id=eq.${season.id}&select=id,provider_id,stats_rows`)).map(row => [row.provider_id, row]));
        const gameRows = [];
        for (const game of games) {
          const homeId = await clubFor(game.teams.home, competition.country), awayId = await clubFor(game.teams.away, competition.country);
          const venue = game.venue ?? null;
          if (venue && /^[A-ZÄÖÜ][\p{L}'-]+ [A-Z]\.$/u.test(venue)) issue('game', String(game.id), 'Reported venue looks like a person', { venue });
          gameRows.push({ season_id: season.id, provider: PROVIDER, provider_id: String(game.id), played_at: game.date ?? null, stage: game.stage ?? null, round: game.week ?? null, home_club_id: homeId, away_club_id: awayId, home_score: game.scores?.home?.total ?? null, away_score: game.scores?.away?.total ?? null, status: game.status?.short ?? 'NS', venue_reported: venue });
        }
        const savedGames = await write('games', gameRows, { onConflict: 'provider,provider_id', returning: true });
        counts.games += savedGames.length;

        // Player statistics for finished games not yet stored, several games per request (paid plan).
        const byProviderId = new Map(savedGames.map(row => [row.provider_id, row]));
        const pending = games.filter(game => FINISHED.has(game.status?.short) && (REFRESH_STATS || (stored.get(String(game.id))?.stats_rows ?? null) === null)).map(game => String(game.id));
        let batch = 20;
        for (let start = 0; start < pending.length; start += batch) {
          let ids = pending.slice(start, start + batch), lines;
          // The number of games per request is not documented: halve the batch if the API refuses it.
          for (;;) {
            try { lines = await api('games/statistics/players', { ids: ids.join('-') }); break; }
            catch (error) { if (batch === 1 || !/ids/i.test(String(error))) throw error; batch = Math.max(1, Math.floor(batch / 2)); ids = pending.slice(start, start + batch); }
          }
          const unknown = [...new Map(lines.filter(line => !playerIds.has(String(line.player.id))).map(line => [String(line.player.id), { id: line.player.id, name: line.player.name }])).values()];
          if (unknown.length) await playersFor(unknown);
          // A line naming a club the provider lists nowhere is placed by the player's squad, when that squad played the game.
          const rows = lines.flatMap(line => {
            const game = byProviderId.get(String(line.game.id)), playerId = playerIds.get(String(line.player.id));
            const clubId = clubIds.get(String(line.team.id)) ?? [game.home_club_id, game.away_club_id].find(id => id === squadClub.get(playerId));
            if (!clubId) { issue('game', String(line.game.id), 'Box-score line skipped: unknown club and no matching squad', { team: line.team.id, player: line.player.name }); return []; }
            if (!clubIds.has(String(line.team.id))) issue('game', String(line.game.id), 'Box-score line names an unknown club; placed by the player\'s squad', { team: line.team.id, player: line.player.name });
            return [{
            game_id: game.id, player_id: playerId, club_id: clubId,
            starter: line.type === 'starters', seconds_played: seconds(line.minutes),
            two_made: line.field_goals?.total ?? null, two_attempted: line.field_goals?.attempts ?? null,
            three_made: line.threepoint_goals?.total ?? null, three_attempted: line.threepoint_goals?.attempts ?? null,
            free_made: line.freethrows_goals?.total ?? null, free_attempted: line.freethrows_goals?.attempts ?? null,
            rebounds: line.rebounds?.total ?? null, assists: line.assists ?? null, points: line.points ?? null,
            }];
          });
          await write('player_game_stats', [...new Map(rows.map(row => [`${row.game_id}/${row.player_id}`, row])).values()], { onConflict: 'game_id,player_id' });
          for (const id of ids) {
            const count = rows.filter(row => row.game_id === byProviderId.get(id).id).length;
            if (!count) issue('game', id, 'Finished game without player statistics');
            await db('PATCH', `games?id=eq.${byProviderId.get(id).id}`, { stats_rows: count }, 'return=minimal');
          }
          counts.boxScoreGames += ids.length; counts.boxScoreRows += rows.length;
        }
        console.log(`${competition.name} ${label}: ${teams.length} clubs, ${games.length} games, ${pending.length} new box scores (${requests} requests so far)`);
      }
    }
    // Players the provider lists twice in one squad are merged (supabase/migrations/*merge_duplicate_players.sql).
    const merged = await db('POST', 'rpc/merge_duplicate_players', {});
    if (merged) console.log(`Merged ${merged} duplicate player listing(s); see player_merges.`);
    // Hand-maintained names, cities, arenas and colours (real-data/club-identities.csv) are applied after every import.
    const identities = await applyIdentities({ selectAll, write, provider: PROVIDER });
    for (const name of identities.unmatched) issue('club', name, 'Listed in club-identities.csv but not imported');
    console.log(`Club identities applied to ${identities.updated} clubs; colours still missing for ${identities.missingColours.length}.`);
    if (issues.length) await write('data_quality_issues', issues.map(item => ({ ...item, run_id: run.id })));
    await db('PATCH', `import_runs?id=eq.${run.id}`, { status: 'succeeded', finished_at: new Date().toISOString(), requests_used: requests, notes: JSON.stringify({ ...counts, issues: issues.length }) }, 'return=minimal');
    console.log(`Import ${run.id} succeeded: ${JSON.stringify(counts)}, ${issues.length} issues noted, ${requests} API requests.`);
  } catch (error) {
    await db('PATCH', `import_runs?id=eq.${run.id}`, { status: requests ? 'partial' : 'failed', finished_at: new Date().toISOString(), requests_used: requests, notes: error instanceof Error ? error.message : String(error) }, 'return=minimal').catch(() => {});
    if (issues.length) await write('data_quality_issues', issues.map(item => ({ ...item, run_id: run.id }))).catch(() => {});
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
