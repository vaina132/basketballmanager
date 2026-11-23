#!/usr/bin/env node
/**
 * Current club rosters from English Wikipedia (17 November 2026), for clubs whose league site cannot be read
 * (Turkey's federation site refuses automated access; France's league data needs a login) and to narrow broad roles
 * elsewhere. Wikipedia text is CC BY-SA 4.0: only facts (position, height, birth date) are taken, each with its page
 * link as attribution. Pages are read one at a time with a pause, as raw wikitext.
 *
 *   node scripts/real-data-wikipedia-rosters.mjs --pack PACK.json --competition "Basketbol Süper Ligi" \
 *     --start "Basketbol Süper Ligi" [--start ...] --out ROSTERS.json [--raw DIR]
 *
 * The start pages (league articles) give the club articles; each club article's "Current roster" (directly, through
 * a roster template or a season article section) gives the players. A page counts for a pack club only when at least
 * three of its players are in that club's squad and no other club comes close (scripts/real-data-official-rosters.mjs).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchClub, matchClubByPlayers } from './real-data-official-rosters.mjs';

const WIKI = 'https://en.wikipedia.org';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const strip = text => String(text ?? '').replace(/<ref[\s\S]*?(<\/ref>|\/>)/g, '').replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1').replace(/\{\{[^{}]*\}\}/g, '').replace(/'''?/g, '').replace(/<[^>]+>/g, '').trim();

/** Parameters of every player template on a page ({{player3 | num = 0 | first = … | last = … | pos = PG | m = 1.82 …}}). */
export function wikiPlayers(text) {
  const players = [];
  for (const match of text.matchAll(/\{\{\s*(?:player\d?|basketball roster player|bs player)\s*\|((?:[^{}]|\{\{[^{}]*\}\})*)\}\}/gi)) {
    const params = {};
    for (const part of match[1].split('|')) { const at = part.indexOf('='); if (at > 0) params[part.slice(0, at).trim().toLowerCase()] = part.slice(at + 1).trim(); }
    const name = params.first || params.last ? `${strip(params.first)} ${strip(params.last)}`.trim() : strip(params.name ?? params.p);
    const position = strip(params.pos).toUpperCase();
    if (!name || !position) continue;
    const height = Number(String(params.m ?? '').replace(',', '.')), born = /^\d{4}$/.test(params.year ?? '') && /^\d{1,2}$/.test(params.month ?? '') && /^\d{1,2}$/.test(params.date ?? params.day ?? '') ? `${params.year}-${params.month.padStart(2, '0')}-${(params.date ?? params.day).padStart(2, '0')}` : undefined;
    players.push({ name, number: /^\d{1,2}$/.test(params.num ?? '') ? Number(params.num) : null, position, ...(height >= 1.5 && height <= 2.4 ? { heightCm: Math.round(height * 100) } : {}), ...(born && Number.isFinite(Date.parse(born)) ? { birthDate: born } : {}), ...(strip(params.nat) ? { nationality: strip(params.nat) } : {}) });
  }
  return players;
}

/** Pages a club article points to for its current roster: section transclusions and roster templates. */
export function rosterReferences(text) {
  const at = text.search(/==\s*(Current roster|Roster|Players|Current squad)\s*==/i);
  const part = at >= 0 ? text.slice(at, at + 4000) : text;
  const pages = [...part.matchAll(/\{\{#section(?:-h)?:\s*([^|}]+)\|/g)].map(match => match[1].trim());
  pages.push(...[...part.matchAll(/\{\{\s*([^|{}#\n]*roster[^|{}\n]*)\s*(\||\}\})/gi)].map(match => match[1].trim()).filter(name => !/^(basketball roster|transcluded|see also|main)/i.test(name)).map(name => `Template:${name}`));
  return [...new Set(pages)];
}

async function raw(title) {
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(`${WIKI}/w/index.php?title=${encodeURIComponent(title.replace(/ /g, '_'))}&action=raw`, { headers: { 'User-Agent': 'CourtsideRosterCheck/1.0 (basketball game data research)' }, signal: AbortSignal.timeout(45_000) }).catch(error => ({ ok: false, status: error.message }));
    if (response.ok) return response.text();
    if (response.status === 404) return null;
    if (attempt >= 3) throw new Error(`${title}: ${response.status}`);
    await pause(10_000 * attempt);
  }
}

async function page(title, seen = new Set()) {
  if (seen.has(title) || seen.size > 4) return null;
  seen.add(title);
  await pause(1500);
  const text = await raw(title);
  if (!text) return null;
  const redirect = /^#REDIRECT\s*\[\[([^\]#|]+)/i.exec(text);
  if (redirect) return page(redirect[1].trim(), seen);
  return { title, text };
}

/** The roster players reachable from one club article, with the page they came from. */
export async function clubRoster(title) {
  const article = await page(title);
  if (!article) return null;
  let players = wikiPlayers(article.text);
  if (players.length >= 5) return { title: article.title, players };
  for (const reference of rosterReferences(article.text)) {
    const found = await page(reference);
    players = found ? wikiPlayers(found.text) : [];
    if (players.length >= 5) return { title: found.title, players };
  }
  return null;
}

async function main() {
  const argument = name => { const index = process.argv.indexOf(name); return index > 0 ? process.argv[index + 1] : null; };
  const starts = process.argv.flatMap((value, index) => process.argv[index - 1] === '--start' ? [value] : []);
  const out = argument('--out'), raw = argument('--raw');
  if (!argument('--pack') || !argument('--competition') || !starts.length || !out) throw new Error('Usage: --pack PACK.json --competition NAME --start PAGE [--start PAGE] --out ROSTERS.json [--raw DIR]');
  if (existsSync(out)) throw new Error(`${out} exists; choose a new output file.`);
  const envelope = JSON.parse(await readFile(argument('--pack'), 'utf8')), pack = envelope.pack ?? envelope;
  const competition = pack.competitions.find(item => item.name === argument('--competition'));
  const clubs = competition.clubIds.map(id => pack.clubs.find(club => club.id === id));
  if (raw) await mkdir(raw, { recursive: true });
  // Candidate club articles: links on the start pages whose words name one of the competition's clubs.
  const candidates = new Map();
  for (const start of starts) {
    const found = await page(start);
    for (const match of found?.text.matchAll(/\[\[([^\]|#]+)(?:\|([^\]]*))?\]\]/g) ?? []) {
      const title = match[1].trim();
      if (/^(File|Image|Category|Template|wikt|w):/i.test(title) || /season|league|ligi|cup|coupe|championship|\d{4}/i.test(title)) continue;
      const club = matchClub(title, clubs) ?? matchClub(match[2] ?? '', clubs);
      if (club) candidates.set(club.id, [...new Set([...(candidates.get(club.id) ?? []), title])].slice(0, 3));
    }
  }
  const observedOn = new Date().toISOString().slice(0, 10);
  const result = { source: `${WIKI}/wiki/${encodeURIComponent(starts[0].replace(/ /g, '_'))}`, sourceName: 'en.wikipedia.org', license: 'CC BY-SA 4.0 (facts only, with page links)', observedOn, competition: competition.name, clubs: [], unmatched: [], missing: [] };
  for (const club of clubs) {
    let done = false;
    for (const title of candidates.get(club.id) ?? []) {
      const roster = await clubRoster(title).catch(error => { result.unmatched.push({ club: club.name, title, error: error.message }); return null; });
      if (!roster) continue;
      if (raw) await writeFile(path.join(raw, `${club.id}.json`), JSON.stringify(roster));
      const owner = matchClubByPlayers(roster.players, clubs, pack);
      if (owner?.id !== club.id) { result.unmatched.push({ club: club.name, title: roster.title, matched: owner?.name ?? null }); continue; }
      result.clubs.push({ clubId: club.id, club: club.name, sourceTeam: roster.title, sources: [`${WIKI}/wiki/${encodeURIComponent(roster.title.replace(/ /g, '_'))}`], players: roster.players });
      done = true;
      break;
    }
    if (!done) result.missing.push({ club: club.name, candidates: candidates.get(club.id) ?? [] });
  }
  await writeFile(out, JSON.stringify(result, null, 1));
  console.log(`${competition.name}: ${result.clubs.length}/${clubs.length} clubs from Wikipedia, ${result.clubs.reduce((sum, club) => sum + club.players.length, 0)} players; missing: ${result.missing.map(item => item.club).join(', ') || 'none'}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
