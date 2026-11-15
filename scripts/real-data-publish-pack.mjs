#!/usr/bin/env node
/**
 * Publishes a finished real-club data pack to the owner's Supabase project, where every player's game reads it
 * (owner decision, 15 November 2026: real clubs are the default and the data rights are granted). Run on the owner's
 * computer, where the Supabase secret key is saved in supabase-key.local:
 *
 *   npm.cmd run data:publish -- --file .local-data/real-2026.11-world-3.json
 *
 * The file must pass the same checks the game uses before it is uploaded; it replaces the published pack.
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SUPABASE_URL = 'https://kesxznybhotzduvcwiwm.supabase.co';
const OBJECT = 'game-data/real-pack.json';

async function main() {
  const at = process.argv.indexOf('--file'), file = at > 0 ? process.argv[at + 1] : null;
  if (!file) throw new Error('Name the pack file, for example: npm.cmd run data:publish -- --file .local-data/real-2026.11-world-3.json');
  const keyFile = path.join(ROOT, 'supabase-key.local');
  if (!existsSync(keyFile)) throw new Error('Missing supabase-key.local: save your Supabase secret key in that file first.');
  const key = (await readFile(keyFile, 'utf8')).trim();
  const text = await readFile(path.resolve(ROOT, file), 'utf8');
  const envelope = JSON.parse(text);
  if (createHash('sha256').update(JSON.stringify(envelope.pack)).digest('hex') !== envelope.checksum) throw new Error('The pack does not match its checksum; nothing was uploaded.');
  // The game's own parser decides whether players can use the file.
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try { const { parseDataPack } = await server.ssrLoadModule('/src/world/data-pack.ts'); await parseDataPack(text); }
  finally { await server.close(); }
  const headers = { apikey: key, 'Content-Type': 'application/json', 'x-upsert': 'true', 'cache-control': 'max-age=300', ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}) };
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/${OBJECT}`, { method: 'POST', headers, body: text, signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Upload failed: ${response.status} ${(await response.text()).slice(0, 300)}`);
  console.log(`Published ${envelope.pack.version} (${envelope.pack.clubs.length} clubs, ${envelope.pack.players.length} players). Every player's game reads it within about five minutes.`);
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
