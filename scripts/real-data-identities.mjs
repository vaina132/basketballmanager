#!/usr/bin/env node
/**
 * Applies the hand-maintained club identities (real-data/club-identities.csv) to the real-data database: display name,
 * short name, country, city, arena and colours. API-Sports supplies none of these. No API requests are made, so the
 * owner can correct the file and apply it again at no cost. Unknown colours stay empty rather than guessed.
 *
 *   node scripts/real-data-identities.mjs
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'real-data', 'club-identities.csv');
const COLUMNS = ['api_sports_id', 'display_name', 'short_name', 'country', 'city', 'arena', 'primary_colour', 'primary_hex', 'secondary_colour', 'secondary_hex', 'confidence', 'notes'];
const CONFIDENCE = ['sure', 'likely', 'unknown'];

/** Minimal CSV: commas separate fields; a field in double quotes may contain commas and doubled quotes. */
export function parseCsv(text) {
  const rows = [];
  for (const line of text.replace(/^﻿/, '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const fields = [];
    let field = '', quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (quoted) {
        if (char === '"' && line[index + 1] === '"') { field += '"'; index += 1; }
        else if (char === '"') quoted = false;
        else field += char;
      } else if (char === '"' && field === '') quoted = true;
      else if (char === ',') { fields.push(field); field = ''; }
      else field += char;
    }
    fields.push(field);
    rows.push(fields.map(value => value.trim()));
  }
  return rows;
}

/** Validated identity rows; every problem names the line so the owner can fix the file. */
export function readIdentities(text) {
  const [header, ...lines] = parseCsv(text);
  if (header?.join(',') !== COLUMNS.join(',')) throw new Error(`club-identities.csv must start with the line: ${COLUMNS.join(',')}`);
  const problems = [], seen = new Set(), shortNames = new Set();
  const rows = lines.map((fields, index) => {
    const row = Object.fromEntries(COLUMNS.map((column, at) => [column, fields[at] ?? '']));
    const where = `line ${index + 2} (${row.display_name || row.api_sports_id})`;
    if (!/^\d+$/.test(row.api_sports_id) || seen.has(row.api_sports_id)) problems.push(`${where}: api_sports_id must be a unique number`);
    if (!row.display_name) problems.push(`${where}: display_name is empty`);
    if (!/^[A-Z]{3}$/.test(row.short_name) || shortNames.has(row.short_name)) problems.push(`${where}: short_name must be three unique capital letters`);
    for (const column of ['primary_hex', 'secondary_hex']) if (row[column] && !/^#[0-9a-f]{6}$/.test(row[column])) problems.push(`${where}: ${column} must look like #1a2b3c`);
    if (!CONFIDENCE.includes(row.confidence)) problems.push(`${where}: confidence must be sure, likely or unknown`);
    seen.add(row.api_sports_id); shortNames.add(row.short_name);
    return row;
  });
  if (problems.length) throw new Error(`club-identities.csv has problems:\n- ${problems.join('\n- ')}`);
  return rows;
}

/** Writes the identities through the importer's database helpers; returns the clubs updated and the unmatched rows. */
export async function applyIdentities({ selectAll, write, provider = 'api-sports' }) {
  const rows = readIdentities(await readFile(FILE, 'utf8'));
  const clubIds = new Map((await selectAll(`club_provider_ids?provider=eq.${provider}&select=provider_id,club_id`)).map(row => [row.provider_id, row.club_id]));
  const matched = rows.filter(row => clubIds.has(row.api_sports_id));
  await write('clubs', matched.map(row => ({
    id: clubIds.get(row.api_sports_id), name: row.display_name, short_name: row.short_name, country: row.country || null, city: row.city || null, venue: row.arena || null,
    color_primary: row.primary_hex || null, color_secondary: row.secondary_hex || null,
    identity_source: `real-data/club-identities.csv (${row.confidence})`, updated_at: new Date().toISOString(),
  })), { onConflict: 'id' });
  return { updated: matched.length, unmatched: rows.filter(row => !clubIds.has(row.api_sports_id)).map(row => row.display_name), missingColours: matched.filter(row => !row.primary_hex).map(row => row.display_name) };
}

async function main() {
  const { databaseHelpers } = await import('./real-data-import.mjs');
  const result = await applyIdentities(await databaseHelpers());
  console.log(`Club identities applied to ${result.updated} clubs.${result.unmatched.length ? ` Not in the database yet: ${result.unmatched.join(', ')}.` : ''} Colours still missing for ${result.missingColours.length}: ${result.missingColours.join(', ') || 'none'}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
