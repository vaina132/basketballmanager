#!/usr/bin/env node
/**
 * Offline preview of the rating balance (owner decisions, 22 November 2026): applies the same calculation as the
 * publishing function (supabase/functions/publish-starter-pack/rating-balance.ts) to a pack built without the
 * balance, under a new version name, and writes a checksummed pack the game can load. No network, no database.
 *
 * The role factor (position-balance-2) needs each player's games behind his ratings. The function reads them from the
 * rating rows (`method.weightedGames`) and writes them to the pack as `ratingGames`. For a pack without them:
 *   --games <file>     a JSON object { "player-<id>": weightedGames } exported from the rating rows (read-only query in
 *                      the runbook). The players then carry `ratingGames` exactly as the function writes them, so with
 *                      an unchanged database the function's own preview of the same version has the same checksum.
 *   --estimate-games   estimates minutes per game from the database stamina (0.7 x minutes per game + 0.3 x
 *                      availability, one point less a year above 32); for a look at the shape only. The estimates are
 *                      used for the balance but not written to the pack.
 *
 *   node scripts/real-data-rating-balance.mjs --in unbalanced-pack.json --version 2026.11-world-13-online --games games.json --out preview-pack.json
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { balanceRatings } from '../supabase/functions/publish-starter-pack/rating-balance.ts';

const argument = name => { const index = process.argv.indexOf(name); return index > 0 ? process.argv[index + 1] : undefined; };

/** Games as the publishing function writes them: the rating row's weighted games to one decimal. */
export const packGames = weightedGames => Math.round(weightedGames * 10) / 10;

/** The player with `ratingGames` placed right after `ratingMinutes`, the function's key order. */
export function withGames(player, games) {
  if (!(typeof games === 'number' && Number.isFinite(games)) || player.ratingMinutes === undefined) return player;
  const out = {};
  for (const [key, value] of Object.entries(player)) { if (key === 'ratingGames') continue; out[key] = value; if (key === 'ratingMinutes') out.ratingGames = packGames(games); }
  return out;
}

/**
 * Estimated games for a pack without them (preview only): the stamina skill is 12 + 3.2 x a standardised mix of 0.7 x
 * minutes per game and 0.3 x availability (scripts/real-data-ratings.mjs), minus one point a year above 32. Without
 * availability, the expected minutes-per-game deviation is about 0.93 x the stamina's deviation; it is read on an
 * assumed scale of 20 minutes a game with a spread of 6 (the role compares players within a position, so only the
 * order matters, apart from the pull of few games).
 */
export function estimatedGames(player) {
  if (!(player.ratingMinutes > 0)) return undefined;
  const age = typeof player.age === 'number' ? player.age : 26;
  const deviation = 0.93 * (player.attributes.stamina + Math.min(4, Math.max(0, age - 32)) - 12) / 3.2;
  const minutesPerGame = Math.max(4, Math.min(38, 20 + 6 * deviation));
  return player.ratingMinutes / minutesPerGame;
}

/** The pack with balanced abilities under `version`; source gains `ratingBalance` after the existing fields, as in the function. */
export function balancedPack(pack, version, { games, estimate = false } = {}) {
  if (pack.source?.ratingBalance) throw new Error('This pack is already balanced; start from a pack built without the rating balance.');
  const input = games ? pack.players.map(player => withGames(player, games[player.id])) : pack.players;
  const hasGames = input.some(player => typeof player.ratingGames === 'number');
  if (!hasGames && !estimate) throw new Error('The pack has no games per player: pass --games <file> (from the rating rows) or --estimate-games for a shape-only preview.');
  const options = !hasGames ? { gamesOf: estimatedGames, gamesSource: 'estimated from the database stamina (offline preview only)' } : games ? { gamesSource: 'ratingGames (rating rows, recency-weighted games)' } : {};
  const { players, summary } = balanceRatings(input, pack.competitions, options);
  return { ...pack, version, source: { ...pack.source, ratingBalance: summary }, players };
}

async function main() {
  const input = argument('--in'), output = argument('--out'), version = argument('--version'), gamesFile = argument('--games');
  if (!input || !output || !version) throw new Error('Usage: --in <pack file> --version <new version> --out <file> [--games <file> | --estimate-games]');
  const file = JSON.parse(await readFile(input, 'utf8'));
  const games = gamesFile ? JSON.parse(await readFile(gamesFile, 'utf8')) : undefined;
  const pack = balancedPack(file.pack, version, { games, estimate: process.argv.includes('--estimate-games') });
  const checksum = createHash('sha256').update(JSON.stringify(pack)).digest('hex');
  await writeFile(output, JSON.stringify({ checksum, writtenAt: new Date().toISOString(), pack }));
  const { changedPlayers, role } = pack.source.ratingBalance;
  console.log(`Balanced ${changedPlayers} of ${pack.players.length} players (${pack.source.ratingBalance.model}; games: ${role.gamesSource}, ${role.playersWithGames} players); ${version}; checksum ${checksum}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
