#!/usr/bin/env node
/**
 * Offline preview of the rating balance (owner decision, 22 November 2026): applies the same calculation as the
 * publishing function (supabase/functions/publish-starter-pack/rating-balance.ts) to a published pack file, under a
 * new version name, and writes a checksummed pack the game can load. With an unchanged database, the function's own
 * preview of the same version has the same checksum. No network, no database.
 *
 *   node scripts/real-data-rating-balance.mjs --in real-pack.json --version 2026.11-world-11-online --out preview-pack.json
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { balanceRatings } from '../supabase/functions/publish-starter-pack/rating-balance.ts';

const argument = name => { const index = process.argv.indexOf(name); return index > 0 ? process.argv[index + 1] : undefined; };

/** The pack with balanced abilities under `version`; source gains `ratingBalance` after the existing fields, as in the function. */
export function balancedPack(pack, version) {
  if (pack.source?.ratingBalance) throw new Error('This pack is already balanced; start from a pack built without the rating balance.');
  const { players, summary } = balanceRatings(pack.players, pack.competitions);
  return { ...pack, version, source: { ...pack.source, ratingBalance: summary }, players };
}

async function main() {
  const input = argument('--in'), output = argument('--out'), version = argument('--version');
  if (!input || !output || !version) throw new Error('Usage: --in <pack file> --version <new version> --out <file>');
  const file = JSON.parse(await readFile(input, 'utf8'));
  const pack = balancedPack(file.pack, version);
  const checksum = createHash('sha256').update(JSON.stringify(pack)).digest('hex');
  await writeFile(output, JSON.stringify({ checksum, writtenAt: new Date().toISOString(), pack }));
  console.log(`Balanced ${pack.source.ratingBalance.changedPlayers} of ${pack.players.length} players; ${version}; checksum ${checksum}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
