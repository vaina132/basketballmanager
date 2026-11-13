#!/usr/bin/env node
/**
 * Real-data update check (pilot step 2.7): proves that published dataset versions never change. For every published
 * version it fingerprints the stored ratings and checks the private pack file against its recorded checksum; it
 * also checks that no statistics or squad places point at a merged duplicate player. Read-only.
 *
 *   node scripts/real-data-verify.mjs [--save before.json] [--compare before.json]
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packProblems } from './real-data-pack.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argument = name => { const index = process.argv.indexOf(name); return index > 0 ? process.argv[index + 1] : null; };

/** A stable fingerprint of one version's rating rows, independent of the order the database returns them in. */
export function ratingsFingerprint(rows) {
  const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
  const lines = rows.map(row => JSON.stringify(stable(row))).sort();
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

/** Differences between two snapshots for the versions that were published in the earlier one. */
export function snapshotChanges(before, after) {
  const changes = [];
  for (const [id, earlier] of Object.entries(before.versions)) {
    const later = after.versions[id];
    if (!later) changes.push(`${id} disappeared`);
    else for (const key of ['status', 'checksum', 'ratings', 'ratingRows']) if (earlier[key] !== later[key]) changes.push(`${id}: ${key} changed`);
  }
  return changes;
}

async function main() {
  const { db, selectAll } = await (await import('./real-data-import.mjs')).databaseHelpers();
  const versions = await db('GET', 'dataset_versions?select=id,status,checksum,storage_path&order=id');
  const published = versions.filter(version => version.status === 'published');
  const snapshot = { takenAt: new Date().toISOString(), versions: {}, counts: {} };
  const files = new Map();
  for (const version of published) {
    const ratings = await selectAll(`player_ratings?dataset_version_id=eq.${encodeURIComponent(version.id)}&select=*`);
    snapshot.versions[version.id] = { status: version.status, checksum: version.checksum, ratings: ratingsFingerprint(ratings), ratingRows: ratings.length };
    const file = path.join(ROOT, (version.storage_path ?? '').replace(/^local:/, ''));
    if (version.storage_path && existsSync(file)) files.set(version.id, JSON.parse(await readFile(file, 'utf8')));
  }
  const problems = packProblems(published, files);
  // The database's keys already prevent duplicate rows; merged duplicate players must keep nothing of their own.
  const players = await selectAll('players?select=id,merged_into');
  const memberships = await selectAll('roster_memberships?select=player_id,club_id,season_id');
  const lines = await selectAll('player_game_stats?select=player_id');
  const merged = new Map(players.filter(player => player.merged_into).map(player => [player.id, player.merged_into]));
  // A duplicate keeps a squad place only where the kept record already holds the same place (rows are never deleted).
  const places = new Set(memberships.map(row => `${row.season_id}/${row.club_id}/${row.player_id}`));
  const strandedPlace = row => merged.has(row.player_id) && !places.has(`${row.season_id}/${row.club_id}/${merged.get(row.player_id)}`);
  snapshot.counts = {
    players: players.length, mergedPlayers: merged.size, squadPlaces: memberships.length, boxScoreLines: lines.length,
    squadPlacesOfMergedPlayers: memberships.filter(strandedPlace).length, boxScoreLinesOfMergedPlayers: lines.filter(row => merged.has(row.player_id)).length,
  };
  if (snapshot.counts.squadPlacesOfMergedPlayers || snapshot.counts.boxScoreLinesOfMergedPlayers) problems.push(`merged players still hold ${snapshot.counts.squadPlacesOfMergedPlayers} squad places and ${snapshot.counts.boxScoreLinesOfMergedPlayers} box-score lines`);
  const compare = argument('--compare');
  if (compare) problems.push(...snapshotChanges(JSON.parse(await readFile(compare, 'utf8')), snapshot));
  const save = argument('--save');
  if (save) await writeFile(save, JSON.stringify(snapshot, null, 1));
  console.log(`Published versions: ${published.map(version => `${version.id} (${snapshot.versions[version.id].ratingRows} ratings)`).join(', ') || 'none'}. Database: ${snapshot.counts.players} players, ${snapshot.counts.squadPlaces} squad places, ${snapshot.counts.boxScoreLines} box-score lines.`);
  if (problems.length) { console.log(`Problems:\n- ${problems.join('\n- ')}`); process.exitCode = 1; }
  else console.log(compare ? 'Every published version is unchanged; merged players hold no statistics.' : 'Every published pack matches its checksum; merged players hold no statistics.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
