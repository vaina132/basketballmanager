#!/usr/bin/env node
/**
 * Positions from clubs' own websites (17 November 2026), for leagues whose official data cannot be read (Turkey's
 * federation site refuses automated access; France's league data needs a login). One generic reader: the club's
 * roster page (found from the home page by link words such as "kadro", "effectif", "roster") is read as text cells,
 * and every position label (Turkish, French or English) is paired with the nearest name-like cell. A page counts for
 * the club only when at least three of its players are in that club's squad (scripts/real-data-official-rosters.mjs).
 * A site is tried twice at most; sites that render their roster only in the browser give nothing and are listed.
 *
 *   node scripts/real-data-club-sites.mjs --pack PACK.json --sites SITES.json --out ROSTERS.json
 *
 * SITES.json: { "<pack club name>": { "site": "https://…", "roster"?: "https://…" } }.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cells, matchClubByPlayers } from './real-data-official-rosters.mjs';

const fold = text => String(text).normalize('NFKD').replace(/\p{M}/gu, '').replace(/ı/g, 'i').toLowerCase().trim();
/** Whole-cell position labels; the profile script maps them to positions or broad groups. */
const LABELS = ['oyun kurucu', 'sutor', 'kisa forvet', 'uzun forvet', 'pivot', 'forvet', 'guard', 'kanat', 'meneur', 'arriere', 'ailier', 'ailier fort', 'interieur', 'meneur/arriere', 'arriere/ailier', 'ailier/ailier fort', 'ailier fort/pivot', 'point guard', 'shooting guard', 'small forward', 'power forward', 'center', 'centre', 'forward', 'pg', 'sg', 'sf', 'pf', 'c', 'g', 'f', 'g/f', 'f/c'];
const LINK_WORDS = ['kadro', 'takim', 'oyuncular', 'a-takim', 'roster', 'squad', 'team', 'players', 'effectif', 'equipe', 'joueurs', 'pro', 'basketbol'];
const NAME = /^[\p{Lu}][\p{L}'’.-]+(?:\s+[\p{L}'’.-]+){1,3}$/u;

/** Rows of { name, position, number } read from a page: each label with the closest name-like cell before or after it. */
export function readRoster(html) {
  const list = cells(html).split('|').map(cell => cell.trim()).filter(Boolean);
  const rows = [];
  list.forEach((cell, index) => {
    const label = fold(cell).replace(/\s*\/\s*/g, '/');
    if (!LABELS.includes(label)) return;
    for (let step = 1; step <= 4; step += 1) {
      for (const at of [index - step, index + step]) {
        const candidate = list[at];
        if (candidate && NAME.test(candidate) && !LABELS.includes(fold(candidate))) {
          const near = list.slice(Math.max(0, at - 2), at + 3).find(item => /^\d{1,2}$/.test(item));
          rows.push({ name: candidate.replace(/\s+/g, ' '), position: cell, number: near ? Number(near) : null });
          return;
        }
      }
    }
  });
  const seen = new Set();
  return rows.filter(row => !seen.has(fold(row.name)) && seen.add(fold(row.name)));
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function get(url) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; roster-check)', Accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(30_000) });
      if (response.ok) return { url: response.url, html: await response.text() };
      if (response.status === 401 || response.status === 403) return null;
    } catch { /* try once more */ }
    await pause(3000);
  }
  return null;
}

/** Roster page candidates on a home page, best first. */
function rosterLinks(home) {
  const links = [...home.html.matchAll(/<a\b[^>]*href="([^"#]+)"[^>]*>([\s\S]*?)<\/a>/gi)].map(match => { try { return { url: new URL(match[1], home.url).href, text: fold(match[2].replace(/<[^>]+>/g, ' ')) }; } catch { return null; } }).filter(Boolean);
  const host = new URL(home.url).host;
  const scored = links.filter(link => new URL(link.url).host === host).map(link => ({ ...link, score: LINK_WORDS.reduce((sum, word) => sum + (fold(link.url).includes(word) ? 2 : 0) + (link.text.includes(word) ? 1 : 0), 0) })).filter(link => link.score > 0);
  return [...new Map(scored.sort((a, b) => b.score - a.score).map(link => [link.url, link])).values()].slice(0, 4).map(link => link.url);
}

async function main() {
  const argument = name => { const index = process.argv.indexOf(name); return index > 0 ? process.argv[index + 1] : null; };
  const out = argument('--out');
  if (!argument('--pack') || !argument('--sites') || !out) throw new Error('Usage: --pack PACK.json --sites SITES.json --out ROSTERS.json');
  if (existsSync(out)) throw new Error(`${out} exists; choose a new output file.`);
  const pack = JSON.parse(await readFile(argument('--pack'), 'utf8')).pack, sites = JSON.parse(await readFile(argument('--sites'), 'utf8'));
  const result = { source: 'club websites', sourceName: 'club website', observedOn: new Date().toISOString().slice(0, 10), clubs: [], skipped: [] };
  for (const [name, entry] of Object.entries(sites)) {
    const club = pack.clubs.find(item => item.name === name);
    if (!club || !entry.site) { result.skipped.push({ club: name, reason: 'no website known' }); continue; }
    const home = entry.roster ? null : await get(entry.site);
    const pages = entry.roster ? [entry.roster] : home ? [home.url, ...rosterLinks(home)] : [];
    if (!pages.length) { result.skipped.push({ club: name, site: entry.site, reason: 'site did not answer (two attempts) or refused' }); continue; }
    let done = false;
    for (const url of pages) {
      await pause(1500);
      const page = url === home?.url ? home : await get(url);
      if (!page) continue;
      const players = readRoster(page.html);
      if (players.length < 3) continue;
      const owner = matchClubByPlayers(players, [club, ...pack.clubs.filter(item => item.id !== club.id && item.country === club.country)], pack);
      if (owner?.id !== club.id) continue;
      result.clubs.push({ clubId: club.id, club: name, sourceTeam: page.url, sources: [page.url], players });
      done = true;
      break;
    }
    if (!done) result.skipped.push({ club: name, site: entry.site, reason: 'no roster with position labels found in the page text (it may render in the browser)', tried: pages });
  }
  await writeFile(out, JSON.stringify(result, null, 1));
  console.log(`Club websites: ${result.clubs.length} rosters read, ${result.skipped.length} skipped.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
