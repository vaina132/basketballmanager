#!/usr/bin/env node
/**
 * Club presidents, head coaches and assistant coaches from English Wikipedia (18 November 2026), for the game's
 * real-people list (src/data/real-club-people.ts). API-Sports has no staff or president data. Wikipedia text is
 * CC BY-SA 4.0: only facts (who holds which job) are taken, each with its page link. Pages are read one at a time,
 * as raw wikitext, with a pause between pages.
 *
 *   node scripts/real-data-wikipedia-people.mjs --pack PACK.json --rosters DIR --out PEOPLE.json [--raw DIR]
 *
 * For each club of the pack's domestic leagues: the club article (from the roster page found earlier in
 * DIR/wiki-*.json, else a link on the league article whose words name the club) gives the infobox president and
 * coach; the roster page (a season article or roster template) gives the "Basketball roster footer" head coach and
 * assistant coaches. A value is kept only when every page that names it agrees; the review in the game data skips
 * anything ambiguous.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { matchClub } from './real-data-official-rosters.mjs';

const WIKI = 'https://en.wikipedia.org';
const LEAGUE_PAGES = { 'LNB Élite': 'LNB Élite', 'Élite 2': 'LNB Élite 2', 'Basketbol Süper Ligi': 'Basketbol Süper Ligi', 'Türkiye Basketbol Ligi': 'Türkiye Basketbol Ligi', 'Liga ACB': 'Liga ACB', 'Greek Basket League': 'Greek Basket League', 'Primera FEB': 'Primera FEB', 'Basketball Bundesliga': 'Basketball Bundesliga', 'Serie A2': 'Serie A2 Basket', 'Lega Basket Serie A': 'Lega Basket Serie A' };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let rawDir = null;

async function raw(title) {
  const file = rawDir && path.join(rawDir, `${title.replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 120)}.txt`);
  if (file && existsSync(file)) return (await readFile(file, 'utf8')) || null;
  for (let attempt = 1; ; attempt += 1) {
    await pause(2000);
    const response = await fetch(`${WIKI}/w/index.php?title=${encodeURIComponent(title.replace(/ /g, '_'))}&action=raw`, { headers: { 'User-Agent': 'CourtsideRosterCheck/1.0 (basketball game data research)' }, signal: AbortSignal.timeout(45_000) }).catch(error => ({ ok: false, status: error.message }));
    const text = response.ok ? await response.text() : null;
    if (text !== null && !text.startsWith('<!DOCTYPE html')) { if (file) await writeFile(file, text); return text; }
    if (response.status === 404) { if (file) await writeFile(file, ''); return null; }
    if (attempt >= 4) throw new Error(`${title}: ${response.status}`);
    await pause(15_000 * attempt);
  }
}

async function page(title, seen = new Set()) {
  if (!title || seen.has(title) || seen.size > 4) return null;
  seen.add(title);
  const text = await raw(title);
  if (!text) return null;
  const redirect = /^#REDIRECT\s*\[\[([^\]#|]+)/i.exec(text);
  return redirect ? page(redirect[1].trim(), seen) : { title, text };
}

/** Plain text of a wikitext value: links to their labels, templates removed except a person's name inside {{player}}. */
export function plain(value) {
  let text = String(value ?? '').replace(/<!--[\s\S]*?-->/g, '').replace(/<ref[\s\S]*?(<\/ref>|\/>)/g, '');
  text = text.replace(/\{\{\s*(?:player|bs player)\s*\|[^|{}]*\|([^|{}]*)\|((?:[^{}]|\[\[[^\]]*\]\])*?)\}\}/gi, '$2');
  for (let i = 0; i < 4; i += 1) text = text.replace(/\{\{\s*(?:nowrap|nobr)\s*\|((?:[^{}]|\{\{[^{}]*\}\})*)\}\}/gi, '$1').replace(/\{\{\s*(?:flagicon|flag icon|flagdeco|flagathlete)[^{}]*\}\}/gi, '');
  text = text.replace(/\{\{[^{}]*\}\}/g, '').replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1').replace(/'''?/g, '').replace(/<br\s*\/?>/gi, ' / ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ');
  return text.replace(/\s+/g, ' ').trim();
}

/** The named parameters of the first template whose name matches, as raw wikitext values. */
export function templateParams(text, name) {
  const start = text.search(new RegExp(`\\{\\{\\s*${name}`, 'i'));
  if (start < 0) return null;
  let depth = 0, end = start;
  for (; end < text.length - 1; end += 1) {
    if (text[end] === '{' && text[end + 1] === '{') { depth += 1; end += 1; } else if (text[end] === '}' && text[end + 1] === '}') { depth -= 1; end += 1; if (depth === 0) break; }
  }
  const body = text.slice(start + 2, end - 1), params = {};
  let level = 0, current = '';
  const parts = [];
  for (let i = 0; i < body.length; i += 1) {
    const two = body.slice(i, i + 2);
    if (two === '{{' || two === '[[') { level += 1; current += two; i += 1; continue; }
    if (two === '}}' || two === ']]') { level -= 1; current += two; i += 1; continue; }
    if (body[i] === '|' && level === 0) { parts.push(current); current = ''; continue; }
    current += body[i];
  }
  parts.push(current);
  for (const part of parts.slice(1)) { const at = part.indexOf('='); if (at > 0) params[part.slice(0, at).trim().toLowerCase().replace(/[\s_]+/g, '_')] = part.slice(at + 1).trim(); }
  return params;
}

/** One person's name from a value, or null when it lists several people or none. */
function single(value) {
  const name = plain(value).replace(/^\*\s*/, '').replace(/\s*\((?:interim|caretaker|acting)\)\s*$/i, ' (interim)');
  if (!name || /vacant|n\/a|^-$|\//i.test(name) || /,| and | & /.test(name) || name.split(' ').length > 5 || /interim/.test(name)) return null;
  return name;
}
/** The people of a bulleted list ("* {{player||ESP|Name}}"), each with the nationality code when given. */
function people(value) {
  return String(value ?? '').split('\n').map(line => line.trim()).filter(line => line.startsWith('*')).map(line => {
    const nat = /\{\{\s*(?:player|bs player)\s*\|[^|{}]*\|([A-Z]{3})/i.exec(line)?.[1] ?? /\{\{\s*flagicon\s*\|\s*([A-Z]{3})/i.exec(line)?.[1] ?? null;
    return { name: single(line), nationality: nat ? nat.toUpperCase() : null };
  }).filter(item => item.name);
}

const link = title => `${WIKI}/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
const clubArticleOf = title => title.startsWith('Template:') ? title.slice(9).replace(/\s*(current\s+)?roster$/i, '') : title.replace(/^\d{4}[–-]\d{2,4}\s+/, '').replace(/\s+season$/i, '');

async function main() {
  const argument = name => { const index = process.argv.indexOf(name); return index > 0 ? process.argv[index + 1] : null; };
  const out = argument('--out');
  rawDir = argument('--raw');
  if (!argument('--pack') || !argument('--rosters') || !out) throw new Error('Usage: --pack PACK.json --rosters DIR --out PEOPLE.json [--raw DIR]');
  if (rawDir) await mkdir(rawDir, { recursive: true });
  const envelope = JSON.parse(await readFile(argument('--pack'), 'utf8')), pack = envelope.pack ?? envelope;
  const rosterPages = new Map();
  for (const file of readdirSync(argument('--rosters')).filter(name => /^wiki-.*\.json$/.test(name) && name !== 'wiki-players.json')) {
    for (const club of JSON.parse(await readFile(path.join(argument('--rosters'), file), 'utf8')).clubs ?? []) if (!rosterPages.has(club.clubId)) rosterPages.set(club.clubId, club.sourceTeam);
  }
  const result = { source: WIKI, license: 'CC BY-SA 4.0 (facts only, with page links)', fetchedOn: new Date().toISOString().slice(0, 10), clubs: [] };
  for (const competition of pack.competitions.filter(item => item.kind !== 'european')) {
    const clubs = competition.clubIds.map(id => pack.clubs.find(club => club.id === id));
    const leagueLinks = new Map();
    if (clubs.some(club => !rosterPages.has(club.id))) {
      const league = await page(LEAGUE_PAGES[competition.name] ?? competition.name).catch(() => null);
      for (const match of league?.text.matchAll(/\[\[([^\]|#]+)(?:\|([^\]]*))?\]\]/g) ?? []) {
        const title = match[1].trim();
        if (/^(File|Image|Category|Template|wikt|w):/i.test(title) || /season|league|ligi|cup|coupe|championship|\d{4}/i.test(title)) continue;
        const club = matchClub(title, clubs) ?? matchClub(match[2] ?? '', clubs);
        if (club && !leagueLinks.has(club.id)) leagueLinks.set(club.id, title);
      }
    }
    for (const club of clubs) {
      const entry = { clubId: club.id, club: club.name, country: competition.country, competition: competition.name, pages: [], president: [], headCoach: [], assistants: [], notes: [] };
      try {
        const rosterTitle = rosterPages.get(club.id) ?? null;
        const roster = rosterTitle && rosterTitle.startsWith('Template:') || /season$/i.test(rosterTitle ?? '') ? await page(rosterTitle) : null;
        const article = await page(rosterTitle ? clubArticleOf(rosterTitle) : leagueLinks.get(club.id));
        if (!rosterTitle && article) {
          const infoName = plain(templateParams(article.text, 'Infobox basketball club')?.name ?? article.title);
          if (matchClub(infoName, clubs)?.id !== club.id && matchClub(article.title, clubs)?.id !== club.id) { entry.notes.push(`club article ${article.title} not confirmed`); result.clubs.push(entry); continue; }
          entry.notes.push('club article matched by name only');
        }
        // The roster section of the club article may point to the season article.
        let seasonPage = roster;
        if (!seasonPage && article) {
          const section = /\{\{#section(?:-h)?:\s*([^|}]+)\|/.exec(article.text.slice(Math.max(0, article.text.search(/==\s*(Current roster|Roster|Players)\s*==/i))))?.[1]?.trim();
          if (section && /20(26|27)/.test(section)) seasonPage = await page(section);
        }
        for (const source of [article, seasonPage].filter(Boolean)) {
          const ai = /\{\{\s*ai-generated/i.test(source.text);
          entry.pages.push({ title: source.title, url: link(source.title), aiGenerated: ai });
          const box = templateParams(source.text, 'Infobox basketball club season') ?? templateParams(source.text, 'Infobox basketball club');
          if (box) {
            const chair = /president/i.test(plain(box.chrtitle ?? 'President')) ? box.chairman : null;
            const president = single(box.president ?? chair ?? (box.president === undefined && box.chrtitle === undefined ? box.chairman : null));
            if (president) entry.president.push({ name: president, url: link(source.title), aiGenerated: ai });
            const coach = single(box.head_coach ?? box.coach ?? box.manager);
            if (coach) entry.headCoach.push({ name: coach, url: link(source.title), aiGenerated: ai });
          }
          const footer = templateParams(source.text, 'Basketball roster footer');
          if (footer) {
            const head = people(footer.head_coach);
            if (head.length === 1) entry.headCoach.push({ name: head[0].name, url: link(source.title), aiGenerated: ai });
            const assistants = people(footer.asst_coach);
            if (assistants.length) entry.assistants.push({ people: assistants, url: link(source.title), aiGenerated: ai, accessed: plain(footer.accessdate ?? '') });
          }
        }
      } catch (error) { entry.notes.push(`error: ${error.message}`); }
      result.clubs.push(entry);
      process.stdout.write(`${competition.name} | ${club.name}: president ${entry.president.map(item => item.name).join(' / ') || '-'}; coach ${entry.headCoach.map(item => item.name).join(' / ') || '-'}; assistants ${entry.assistants[0]?.people.length ?? 0}\n`);
      await writeFile(out, JSON.stringify(result, null, 1));
    }
  }
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main().catch(error => { console.error(error.message); process.exitCode = 1; });
