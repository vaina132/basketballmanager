#!/usr/bin/env node
/**
 * Positions from English Wikipedia player articles (17 November 2026), for players whose position is still a guess
 * after the official rosters and club roster templates, mostly players the pack keeps at a club whose current roster
 * no longer lists them. Only the primary position is taken (the first in the infobox), with the article as source;
 * the player's club is never changed. Wikipedia text is CC BY-SA 4.0; only facts are used, with page links.
 *
 *   node scripts/real-data-wikipedia-players.mjs --pack PACK.json --overrides OVERRIDES.json --out ROSTERS.json
 *
 * An article counts only if it is a basketball biography and it names the pack club, or the birth year agrees with
 * the pack's age. Abbreviated names ("K. Curry") are not looked up.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchClub } from './real-data-official-rosters.mjs';

const WIKI = 'https://en.wikipedia.org';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const POSITIONS = [['point guard', 'PG'], ['shooting guard', 'SG'], ['small forward', 'SF'], ['power forward', 'PF'], ['center', 'C'], ['centre', 'C'], ['guard', 'G'], ['forward', 'F']];

async function raw(title) {
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(`${WIKI}/w/index.php?title=${encodeURIComponent(title.replace(/ /g, '_'))}&action=raw`, { headers: { 'User-Agent': 'CourtsideRosterCheck/1.0 (basketball game data research)' }, signal: AbortSignal.timeout(45_000) }).catch(error => ({ ok: false, status: error.message }));
    if (response.ok) return response.text();
    if (response.status === 404) return null;
    if (attempt >= 3) return null;
    await pause(10_000 * attempt);
  }
}

/** The basketball biography for a name: the article itself, its "(basketball)" variant, following one redirect. */
async function article(name) {
  for (const title of [`${name} (basketball)`, name]) {
    await pause(1200);
    let text = await raw(title), page = title;
    const redirect = text && /^#REDIRECT\s*\[\[([^\]#|]+)/i.exec(text);
    if (redirect) { await pause(1200); page = redirect[1].trim(); text = await raw(page); }
    if (text && /\{\{\s*Infobox basketball biography/i.test(text)) return { title: page, text };
  }
  return null;
}

/** The infobox's first position, the birth year and the text naming clubs. */
export function biography(text) {
  const box = text.slice(text.search(/\{\{\s*Infobox basketball biography/i), text.search(/\{\{\s*Infobox basketball biography/i) + 6000);
  const field = name => new RegExp(`\\|\\s*${name}\\s*=([^\\n]*)`, 'i').exec(box)?.[1] ?? '';
  const words = field('position').replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1').toLowerCase();
  const first = POSITIONS.map(([label, code]) => [words.indexOf(label), code]).filter(([at]) => at >= 0).sort((a, b) => a[0] - b[0] || 0)[0];
  const year = /birth[ _]date[^|]*\|\s*(?:df=y(?:es)?\s*\|\s*|mf=y(?:es)?\s*\|\s*)?(\d{4})/i.exec(box)?.[1];
  return { position: first?.[1] ?? null, birthYear: year ? Number(year) : null, clubs: `${field('team')} ${box}` };
}

async function main() {
  const argument = name => { const index = process.argv.indexOf(name); return index > 0 ? process.argv[index + 1] : null; };
  const out = argument('--out');
  if (!argument('--pack') || !argument('--overrides') || !out) throw new Error('Usage: --pack PACK.json --overrides OVERRIDES.json --out ROSTERS.json');
  if (existsSync(out)) throw new Error(`${out} exists; choose a new output file.`);
  const pack = (JSON.parse(await readFile(argument('--pack'), 'utf8'))).pack;
  const overrides = JSON.parse(await readFile(argument('--overrides'), 'utf8'));
  const exact = new Set(overrides.rows.filter(row => row.field === 'position' && row.value.value).map(row => `player-${row.entity_id}`));
  const names = new Map(overrides.rows.filter(row => row.field === 'full_name').map(row => [`player-${row.entity_id}`, row.value.value]));
  // --list FILE: [{ id, rosterName }] players a current roster lists, looked up by the roster's full name.
  const listed = argument('--list') ? JSON.parse(await readFile(argument('--list'), 'utf8')) : null;
  const byId = new Map(pack.players.map(player => [player.id, player]));
  const todo = (listed ? listed.map(item => ({ player: byId.get(item.id), name: item.rosterName })) : pack.players.filter(player => player.estimated.includes('game_position') && !exact.has(player.id)).map(player => ({ player, name: names.get(player.id) ?? player.name })))
    .filter(({ player, name }) => player && name && !/(^|\s)\p{L}\.(\s|$)/u.test(name) && name.split(/\s+/).length >= 2);
  const observedOn = new Date().toISOString().slice(0, 10);
  const result = { source: WIKI, sourceName: 'en.wikipedia.org', license: 'CC BY-SA 4.0 (facts only, with page links)', observedOn, clubs: [], rejected: [], notFound: 0 };
  for (const [index, { player, name }] of todo.entries()) {
    const page = await article(name).catch(() => null);
    if (!page) { result.notFound += 1; continue; }
    const bio = biography(page.text), club = pack.clubs.find(item => item.id === player.clubId);
    const namesClub = !!matchClub(bio.clubs.replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1'), [club]);
    const sameYear = bio.birthYear && player.age && Math.abs(2026 - bio.birthYear - player.age) <= 1;
    if (!bio.position || !(namesClub || sameYear)) { result.rejected.push({ name, title: page.title, position: bio.position, namesClub, birthYear: bio.birthYear }); continue; }
    // The row carries the pack's own name so the profile matcher pairs it with this player.
    result.clubs.push({ clubId: player.clubId, sources: [`${WIKI}/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`], players: [{ name: listed ? player.name : name, number: player.number, position: bio.position }] });
    if (index % 50 === 0) await writeFile(out + '.partial', JSON.stringify(result));
  }
  await writeFile(out, JSON.stringify(result, null, 1));
  console.log(`Wikipedia player articles: ${todo.length} looked up, ${result.clubs.length} positions, ${result.rejected.length} rejected, ${result.notFound} without an article.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
