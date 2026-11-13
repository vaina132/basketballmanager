#!/usr/bin/env node
/**
 * Builds a versioned real-data game pack from the database: the current season's clubs (with their maintained
 * identities), squads and ratings for every pilot competition. The pack is a private file on this computer
 * (.local-data/real-data/packs/, ignored by Git): real player data is not published until its rights are cleared.
 * A version is immutable: rebuilding it with different contents is refused, so newer data needs a new version.
 *
 *   node scripts/real-data-pack.mjs [--version 2026.11-pilot] [--season 2026-27]
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argument = (name, fallback) => { const index = process.argv.indexOf(name); return index > 0 ? process.argv[index + 1] : fallback; };
const VERSION = argument('--version', '2026.11-pilot');
const SEASON = argument('--season', '2026-27');
export const PACK_FORMAT = 'basketball-manager-data-pack';
export const PACK_FORMAT_VERSION = 1;
const ABILITIES = ['two_point', 'three_point', 'free_throw', 'passing', 'defense', 'rebounding', 'stamina'];
const GAME_KEYS = { two_point: 'twoPoint', three_point: 'threePoint', free_throw: 'freeThrow', passing: 'passing', defense: 'defense', rebounding: 'rebounding', stamina: 'stamina' };
/** Squad members without any stored statistics yet: below-average abilities by position, all marked estimated. */
const UNRATED = Object.freeze({ ability: 9, position: { Guard: 'SG', Forward: 'SF', Center: 'C' }, build: { PG: [188, 84], SG: [194, 89], SF: [200, 97], PF: [206, 106], C: [211, 113] } });

/** Pure assembly and checks; `input` mirrors the database rows. Returns the pack and the problems found. */
export function buildPack(input) {
  const { version, season, competitions, clubs, memberships, players, ratings, source } = input;
  const problems = [], warnings = [];
  const clubById = new Map(clubs.map(club => [club.id, club]));
  const playerById = new Map(players.filter(player => !player.merged_into).map(player => [player.id, player]));
  const ratingById = new Map(ratings.map(rating => [rating.player_id, rating]));
  // A player's current club is the squad he was seen in most recently this season.
  const latest = new Map();
  for (const row of memberships) {
    if (!playerById.has(row.player_id)) continue;
    const previous = latest.get(row.player_id);
    if (!previous || row.last_seen_on > previous.last_seen_on || row.last_seen_on === previous.last_seen_on && row.first_seen_on > previous.first_seen_on) latest.set(row.player_id, row);
  }
  const packPlayers = [...latest.values()].map(row => {
    const player = playerById.get(row.player_id), rating = ratingById.get(row.player_id);
    const position = rating?.game_position ?? UNRATED.position[player.position] ?? 'SF';
    const [height, weight] = rating ? [rating.height_cm, rating.weight_kg] : UNRATED.build[position];
    const attributes = Object.fromEntries(ABILITIES.map(key => [GAME_KEYS[key], rating ? rating[key] : UNRATED.ability]));
    return {
      id: `player-${row.player_id}`, name: player.full_name, clubId: `club-${row.club_id}`, number: row.shirt_number ?? null, position,
      nationality: player.nationality ?? null, age: player.age_observed ?? null, heightCm: height, weightKg: weight, attributes,
      estimated: rating ? [...rating.estimated].sort() : ['all-abilities', 'game_position', 'height_cm', 'weight_kg'],
    };
  }).sort((a, b) => a.clubId.localeCompare(b.clubId) || a.name.localeCompare(b.name));
  const squads = new Map();
  for (const player of packPlayers) squads.set(player.clubId, [...(squads.get(player.clubId) ?? []), player.id]);
  const clubIds = [...new Set(competitions.flatMap(competition => competition.clubIds))];
  const packClubs = clubIds.map(id => clubById.get(id)).filter(Boolean).map(club => ({
    id: `club-${club.id}`, name: club.name, shortName: club.short_name ?? club.name.slice(0, 3).toUpperCase(), country: club.country ?? null, city: club.city ?? null, arena: club.venue ?? null,
    color: club.color_primary ?? null, secondaryColor: club.color_secondary ?? null, identitySource: club.identity_source ?? null, playerIds: squads.get(`club-${club.id}`) ?? [],
  })).sort((a, b) => a.name.localeCompare(b.name));
  const packCompetitions = competitions.map(competition => ({ id: `competition-${competition.id}`, name: competition.name, country: competition.country ?? null, tier: competition.tier, kind: competition.kind, season, clubIds: competition.clubIds.map(id => `club-${id}`).sort() }));

  // Checks: a failed pack is never written.
  for (const club of packClubs) if (club.playerIds.length < 10) problems.push(`${club.name} has only ${club.playerIds.length} players in ${season}`);
  for (const player of packPlayers) for (const [key, value] of Object.entries(player.attributes)) if (!Number.isInteger(value) || value < 1 || value > 20) problems.push(`${player.name} has ${key} ${value}`);
  const names = new Map();
  for (const player of packPlayers) names.set(`${player.clubId}/${player.name}`, (names.get(`${player.clubId}/${player.name}`) ?? 0) + 1);
  for (const [key, count] of names) if (count > 1) warnings.push(`${count} players named ${key.split('/')[1]} in one squad (kept: the provider shows them in the same games)`);
  const shortNames = packClubs.map(club => club.shortName);
  if (new Set(shortNames).size !== shortNames.length) problems.push('Two clubs share a short name');
  const missingColours = packClubs.filter(club => !club.color).map(club => club.name);
  if (missingColours.length) warnings.push(`No verified colours yet for ${missingColours.length} clubs: ${missingColours.join(', ')}`);
  const unrated = packPlayers.filter(player => player.estimated.includes('all-abilities')).length;
  if (unrated) warnings.push(`${unrated} squad members have no statistics yet and carry estimated abilities`);

  const pack = {
    format: PACK_FORMAT, formatVersion: PACK_FORMAT_VERSION, version, season, source,
    notice: 'Private evaluation data from API-SPORTS. Rights for publication or distribution are not cleared; do not upload or share.',
    competitions: packCompetitions, clubs: packClubs, players: packPlayers,
  };
  return { pack, problems, warnings, summary: { competitions: packCompetitions.length, clubs: packClubs.length, players: packPlayers.length, unrated } };
}

/** A stable fingerprint of the pack contents (ignoring when it was written). */
export function packChecksum(pack) {
  return createHash('sha256').update(JSON.stringify(pack)).digest('hex');
}

async function main() {
  const { db, selectAll, write } = await (await import('./real-data-import.mjs')).databaseHelpers();
  const [versionRow] = await db('GET', `dataset_versions?id=eq.${encodeURIComponent(VERSION)}&select=*`);
  if (!versionRow) throw new Error(`Dataset version ${VERSION} has no ratings yet; run npm.cmd run data:ratings first.`);
  const seasons = await selectAll(`seasons?label=eq.${SEASON}&select=id,competition_id,competitions(id,name,country,tier,kind)`);
  const participations = await selectAll(`participations?select=season_id,club_id&season_id=in.(${seasons.map(row => row.id).join(',')})`);
  const competitions = seasons.map(row => ({ ...row.competitions, clubIds: participations.filter(item => item.season_id === row.id).map(item => item.club_id) }));
  const memberships = await selectAll(`roster_memberships?select=player_id,club_id,shirt_number,first_seen_on,last_seen_on&season_id=in.(${seasons.map(row => row.id).join(',')})`);
  const clubs = await selectAll('clubs?select=id,name,short_name,country,city,venue,color_primary,color_secondary,identity_source');
  const players = await selectAll('players?select=id,full_name,nationality,position,age_observed,merged_into');
  const ratings = await selectAll(`player_ratings?dataset_version_id=eq.${encodeURIComponent(VERSION)}&select=*`);
  const source = { provider: 'API-SPORTS (API-BASKETBALL)', importRun: versionRow.source_run_id, ratings: 'rating-1', ratingsNote: versionRow.notes };
  const { pack, problems, warnings, summary } = buildPack({ version: VERSION, season: SEASON, competitions, clubs, memberships, players, ratings, source });
  if (problems.length) throw new Error(`Pack ${VERSION} failed its checks and was not written:\n- ${problems.join('\n- ')}`);
  const checksum = packChecksum(pack);
  const directory = path.join(ROOT, '.local-data', 'real-data', 'packs'), file = path.join(directory, `real-${VERSION}.json`);
  if (versionRow.checksum && versionRow.checksum !== checksum) throw new Error(`Version ${VERSION} was already built with different contents; versions never change. Build a new version, for example --version ${VERSION}b.`);
  if (existsSync(file) && packChecksum(JSON.parse(await readFile(file, 'utf8')).pack) !== checksum) throw new Error(`${path.relative(ROOT, file)} holds different contents for ${VERSION}; versions never change.`);
  await mkdir(directory, { recursive: true });
  await writeFile(file, JSON.stringify({ checksum, writtenAt: new Date().toISOString(), pack }, null, 1));
  await write('dataset_versions', [{ id: VERSION, status: 'published', checksum, storage_path: `local:${path.relative(ROOT, file).replace(/\\/g, '/')}`, notes: versionRow.notes }], { onConflict: 'id' });
  console.log(`Pack ${VERSION} written: ${summary.competitions} competitions, ${summary.clubs} clubs, ${summary.players} players. File: ${path.relative(ROOT, file)}`);
  for (const warning of warnings) console.log(`Note: ${warning}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
