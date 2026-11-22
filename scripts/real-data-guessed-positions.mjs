#!/usr/bin/env node
/**
 * Exact positions for players whose position is still a guess (positions-2, 22 November 2026). Builds a correction
 * batch for the database's `manual_overrides` table, in the shape of the earlier position batches, from free sources:
 *
 *   1. official league pages: the league rosters of scripts/real-data-official-rosters.mjs, the lnb.fr Élite and
 *      Élite 2 rosters (`lnb`: the public team pages rendered in Chromium; the roster data the page itself loads is
 *      kept) and the FIBA Europe Cup team pages (`fiba-europe-cup`);
 *   2. Wikidata (CC0; `wikidata`) and the infobox of the player's Wikipedia articles (CC BY-SA 4.0; `articles`), and
 *      the Wikipedia rosters read earlier. These are shown as reported, never as official.
 *
 * Rules (as in scripts/real-data-official-profiles.mjs): matches within the player's club only; an official exact
 * label wins, a two-position label is narrowed by the stored broad role ("2/3" with Guard gives SG); an official page
 * that only narrows to Guard or Forward gives a broad row when none is stored; Wikidata/Wikipedia count only when every
 * such source that names a position inside what the official pages and the stored role allow names the same one.
 * A Wikidata person must have the same name and birth date (or, without one, the club among his teams).
 * Added players (ids `player-n…`) live in their club's `added_players` row, which is rewritten with only their
 * position, position source and estimate marker changed.
 *
 * Steps (every page is read once, slowly, and kept in --cache):
 *   node scripts/real-data-guessed-positions.mjs state --uploads A.json,B.json,... --pack PACK.json --out STATE.json
 *   node scripts/real-data-guessed-positions.mjs lnb --out DIR                      (needs Playwright with Chromium)
 *   node scripts/real-data-guessed-positions.mjs lnb-rosters --pack PACK.json --in DIR --out ROSTERS-lnb.json
 *   node scripts/real-data-guessed-positions.mjs fiba-europe-cup --pack PACK.json --cache DIR --out ROSTERS-fibaec.json
 *   node scripts/real-data-guessed-positions.mjs evidence --pack PACK.json --state STATE.json --rosters R1.json,R2.json,...
 *        [--close CLOSE.json] --out EVIDENCE.json --wikidata-in PEOPLE.json
 *   node scripts/real-data-guessed-positions.mjs wikidata --in PEOPLE.json --cache DIR --out WIKIDATA.json
 *   node scripts/real-data-guessed-positions.mjs articles --wikidata WIKIDATA.json --cache DIR --out ARTICLES.json
 *   node scripts/real-data-guessed-positions.mjs build --evidence EVIDENCE.json --state STATE.json --wikidata WIKIDATA.json
 *        --articles ARTICLES.json --batch NAME --observed-on YYYY-MM-DD --out BATCH.json --review REVIEW.json
 *
 * STATE.json is the stored position and added_players rows, rebuilt from the uploaded batches in upload order and
 * checked against the live pack (the added players of every club must match exactly). Roster files are listed in
 * order of preference and hold { source, sourceName, observedOn, clubs: [{ clubId, sources, players }] }.
 * CLOSE.json lists close names checked by hand ([{ id, rosterNames }]) for typos and nicknames.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { combinePosition, GROUP_POSITIONS, matchName, rosterPosition } from './real-data-official-profiles.mjs';
import { matchClub, matchClubByPlayers } from './real-data-official-rosters.mjs';

const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];
const groupOf = position => Object.keys(GROUP_POSITIONS).find(group => GROUP_POSITIONS[group].includes(position));
const fold = text => String(text ?? '').normalize('NFKD').replace(/\p{M}/gu, '').replace(/ı/g, 'i').replace(/ł/g, 'l').replace(/ø/g, 'o').replace(/đ/g, 'd').toLowerCase().trim();
const plain = text => fold(text).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const nameKey = text => plain(text).split(' ').filter(word => !['jr', 'sr', 'ii', 'iii'].includes(word)).sort().join(' ');
const title = text => text.toLowerCase().replace(/(^|[\s'-])\p{L}/gu, letter => letter.toUpperCase());
const isInitial = name => /^[A-Z]\.\s?/.test(name.trim());
const readJson = file => JSON.parse(readFileSync(file, 'utf8'));

// ---------------------------------------------------------------------------------------------- polite cached reads
let lastRequest = 0;
/** GET with a disk cache, one request at a time, at least 1.1 s apart, retried on 429/5xx. */
export async function cachedGet(url, cache, { json = false } = {}) {
  mkdirSync(cache, { recursive: true });
  const file = path.join(cache, createHash('sha1').update(url).digest('hex'));
  if (existsSync(`${file}.meta`)) {
    const meta = readJson(`${file}.meta`);
    if (meta.status === 200 || meta.status === 404) { const body = readFileSync(file, 'utf8'); return { status: meta.status, body: json && meta.status === 200 ? JSON.parse(body) : body }; }
  }
  for (let attempt = 1; ; attempt += 1) {
    const wait = lastRequest + 1100 - Date.now(); if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    lastRequest = Date.now();
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; roster-check)' }, signal: AbortSignal.timeout(40_000) });
      const body = await response.text();
      if (response.status === 429 || response.status >= 500) throw new Error(`HTTP ${response.status}`);
      writeFileSync(file, body); writeFileSync(`${file}.meta`, JSON.stringify({ url, status: response.status, fetchedAt: new Date().toISOString() }));
      return { status: response.status, body: json && response.status === 200 ? JSON.parse(body) : body };
    } catch (error) {
      if (attempt >= 4) return { status: 0, body: null, error: error.message };
      await new Promise(resolve => setTimeout(resolve, 5000 * attempt));
    }
  }
}

// ---------------------------------------------------------------------------------------------------- stored state
/** The stored position and added_players rows after the uploads, in order; checked against the live pack. */
export function storedState(uploads, pack) {
  const state = {};
  for (const batch of uploads) for (const row of batch.rows ?? batch) state[`${row.entity_type}/${row.entity_id}/${row.field}`] = row;
  const position = {}, added = {};
  for (const row of Object.values(state)) { if (row.field === 'position') position[row.entity_id] = row; if (row.field === 'added_players') added[row.entity_id] = row; }
  const inPack = new Map();
  for (const player of pack.players) if (player.id.startsWith('player-n')) inPack.set(player.clubId.slice(5), [...(inPack.get(player.clubId.slice(5)) ?? []), player.id]);
  const mismatched = [...new Set([...inPack.keys(), ...Object.keys(added)])].filter(club => (inPack.get(club) ?? []).sort().join() !== (added[club]?.value.value.map(item => item.id) ?? []).sort().join());
  return { position, added_players: added, mismatched };
}

// ------------------------------------------------------------------------------------------------------- lnb.fr
const LNB_TEAMS = {
  317: [[1858, 10], [1859, 13], [1860, 17], [1861, 20], [1862, 27], [1863, 33], [1864, 38], [1865, 43], [1866, 91], [1868, 51], [1869, 55], [1870, 58], [1871, 60], [1872, 65], [1892, 74], [1873, 75]],
  318: [[1874, 47], [1875, 2], [1876, 9], [1877, 16], [1878, 63], [1879, 26], [1880, 30], [1930, 31], [1881, 34], [1882, 35], [1883, 36], [1884, 37], [1885, 99], [1886, 52], [1887, 57], [1888, 61], [1889, 62], [1890, 66], [1891, 72], [1893, 89]],
};
/** Renders each LNB Élite (317) and Élite 2 (318) team's public roster page and keeps the roster data it loads. */
async function readLnb(out) {
  const require = createRequire(import.meta.url);
  const { chromium } = require(require.resolve('playwright', { paths: [process.cwd(), ...(process.env.NODE_PATH ?? '').split(path.delimiter).filter(Boolean), '/opt/node-tools/node_modules'] }));
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY } } : {});
  const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (compatible; roster-check)', viewport: { width: 1280, height: 1800 } });
  for (const [competition, teams] of Object.entries(LNB_TEAMS)) for (const [tid, clid] of teams) {
    const file = path.join(out, `roster-${tid}.json`);
    if (existsSync(file)) continue;
    const [did, ca] = competition === '317' ? [1, 'PROA'] : [2, 'PROB'];
    const url = `https://lnb.fr/fr/teams/details?tid=${tid}&did=${did}&ca=${ca}&yid=2026&cid=${competition}&clid=${clid}&tab=roster`;
    const page = await context.newPage();
    let roster = null, team = null;
    page.on('response', async response => {
      try { if (response.url().includes(`/teams/getRoster?team_external_id=${tid}`)) roster = await response.json(); else if (response.url().endsWith(`/teams/${tid}`)) team = await response.json(); } catch { /* not JSON */ }
    });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 }).catch(error => console.log(`${tid}: ${error.message}`));
    await page.waitForTimeout(2500);
    if (roster) writeFileSync(file, JSON.stringify({ url, competition: Number(competition), fetchedAt: new Date().toISOString(), team: team?.data ?? null, roster }));
    console.log(tid, roster ? roster.data.length : 'no roster (run again)');
    await page.close();
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  await browser.close();
}
/** The saved lnb.fr roster data as a roster file ("1/2 - Meneur/Arrière" is read by its numbers). */
export function lnbRosters(pack, documents, observedOn) {
  const names = { 317: 'LNB Élite', 318: 'Élite 2' };
  const result = { source: 'https://lnb.fr/fr/teams', sourceName: 'lnb.fr', observedOn, clubs: [], unmatched: [] };
  for (const document of documents) {
    const competition = pack.competitions.find(item => item.name === names[document.competition]);
    const clubs = competition.clubIds.map(id => pack.clubs.find(club => club.id === id));
    const players = document.roster.data.map(item => ({
      name: `${item.person.first_name} ${item.person.family_name}`.replace(/\s+/g, ' ').trim(),
      number: /^\d{1,2}$/.test(item.player_role?.shirt_number ?? '') ? Number(item.player_role.shirt_number) : null,
      position: (item.player_role?.playing_position ?? '').split(' - ')[0].trim() || null, label: item.player_role?.playing_position ?? null,
      birthDate: item.person.dob ? item.person.dob.slice(0, 10) : undefined, heightCm: item.person.height >= 150 && item.person.height <= 240 ? item.person.height : undefined,
    }));
    const teamName = document.team?.team_name ?? '';
    const club = matchClubByPlayers(players, clubs, pack) ?? matchClub(teamName, clubs);
    if (!club) { result.unmatched.push({ url: document.url, teamName }); continue; }
    result.clubs.push({ clubId: club.id, club: club.name, sourceTeam: teamName, sourceName: 'lnb.fr', sources: [document.url], players });
  }
  return result;
}

// ------------------------------------------------------------------------------------------- FIBA Europe Cup pages
/** Players on a FIBA Europe Cup team page (final roster only), as the page's embedded data gives them. */
export function fibaTeamPlayers(html) {
  const text = html.replace(/\\"/g, '"'), rows = [], seen = new Set();
  const starts = [...text.matchAll(/"firstName":"([^"]*)","lastName":"([^"]*)"/g)];
  starts.forEach((match, index) => {
    const window = text.slice(match.index, Math.min(starts[index + 1]?.index ?? text.length, match.index + 2500));
    const value = key => { const found = new RegExp(`"${key}":("([^"]*)"|true|false|null|-?\\d+)`).exec(window); return found ? found[2] ?? JSON.parse(found[1]) : undefined; };
    const name = `${match[1]} ${match[2]}`.trim();
    if (value('clubName') === undefined || seen.has(name)) return;
    seen.add(name);
    if (value('isOnFinalRoster') !== true) return;
    const height = value('heightInCm'), born = value('dateOfBirth');
    rows.push({ name, number: /^\d{1,2}$/.test(String(value('uniformNumber'))) ? Number(value('uniformNumber')) : null, position: value('position') ?? null, ...(typeof born === 'string' && /^\d{4}-\d{2}-\d{2}/.test(born) ? { birthDate: born.slice(0, 10) } : {}), ...(height >= 150 && height <= 240 ? { heightCm: height } : {}) });
  });
  return rows;
}
async function readFibaEuropeCup(pack, cache, observedOn) {
  const base = 'https://www.fiba.basketball/en/events/fiba-europe-cup-26-27';
  const list = await cachedGet(`${base}/teams`, cache);
  const slugs = [...new Set([...String(list.body).matchAll(/\/en\/events\/fiba-europe-cup-26-27\/teams\/([a-z0-9-]+)/g)].map(match => match[1]))];
  const european = new Set(pack.competitions.filter(item => item.kind === 'european').flatMap(item => item.clubIds));
  const candidates = pack.clubs.filter(club => european.has(club.id));
  const result = { source: `${base}/teams`, sourceName: 'fiba.basketball', observedOn, competition: 'FIBA Europe Cup', clubs: [], unmatched: [] };
  for (const slug of slugs) {
    const url = `${base}/teams/${slug}`, page = await cachedGet(url, cache);
    if (page.status !== 200) { result.unmatched.push({ slug, status: page.status }); continue; }
    const players = fibaTeamPlayers(page.body), club = matchClubByPlayers(players, candidates, pack);
    if (!club) { result.unmatched.push({ slug, players: players.length }); continue; }
    result.clubs.push({ clubId: club.id, club: club.name, sourceTeam: slug, sourceName: 'fiba.basketball', sources: [url], players });
  }
  return result;
}

// --------------------------------------------------------------------------------------------------------- evidence
const LANGUAGE = { 'Türkiye Basketbol Ligi': 'tr', 'Basketbol Süper Ligi': 'tr', 'Serie A2': 'it', 'Lega Basket Serie A': 'it', 'LNB Élite': 'fr', 'Élite 2': 'fr', 'Liga ACB': 'es', 'Primera FEB': 'es', 'Basketball Bundesliga': 'de', 'Greek Basket League': 'el' };
/** What every roster source says about each guessed player, his full names and birth date, and the stored role. */
export function gatherEvidence({ pack, state, rosterFiles, close = [] }) {
  const clubs = new Map(pack.clubs.map(club => [club.id, club]));
  const domestic = new Map(), european = new Map();
  for (const competition of pack.competitions) for (const id of competition.clubIds) { if (competition.kind !== 'european') { if (!domestic.has(id)) domestic.set(id, competition.name); } else european.set(id, [...(european.get(id) ?? []), competition.name]); }
  const lists = new Map();
  for (const { name, file } of rosterFiles) for (const club of file.clubs ?? []) {
    if (!club.players?.length) continue;
    const sourceName = club.sourceName ?? file.sourceName;
    const official = !/wikipedia/.test(sourceName ?? '') && !/wiki/.test(name);
    lists.set(club.clubId, [...(lists.get(club.clubId) ?? []), { file: name, sourceName, official, sources: club.sources ?? [file.source], observedOn: file.observedOn, rows: club.players }]);
  }
  const checked = new Map(close.map(item => [item.id, new Set(item.rosterNames)]));
  const evidence = [];
  for (const player of pack.players.filter(item => item.estimated?.includes('game_position'))) {
    const uuid = player.id.startsWith('player-n') ? null : player.id.slice(7);
    const row = uuid ? state.position[uuid] : null;
    const hits = [];
    for (const list of lists.get(player.clubId) ?? []) {
      let match = matchName(player.name, player.number, list.rows);
      if (!match && list.official && checked.has(player.id)) { const rows = list.rows.filter(item => checked.get(player.id).has(item.name)); if (rows.length === 1) match = { row: rows[0], method: 'close-name-and-club-checked' }; }
      if (!match) continue;
      const parsed = rosterPosition(match.row.position ?? null);
      let fullName = match.row.name;
      if (match.row.surnameFirst) { const words = fullName.split(' '); fullName = title(`${words.slice(1).join(' ')} ${words[0]}`); }
      hits.push({ file: list.file, official: list.official, sourceName: list.sourceName, sources: list.sources, label: match.row.position ?? null, options: parsed.options, group: parsed.group, match: match.method, name: match.row.name, fullName, birthDate: match.row.birthDate ?? null });
    }
    const names = [...new Set([...(isInitial(player.name) ? [] : [player.name]), ...hits.filter(hit => !isInitial(hit.fullName)).map(hit => hit.fullName)])];
    evidence.push({
      id: player.id, uuid, name: player.name, number: player.number, club: clubs.get(player.clubId).name, clubId: player.clubId, league: domestic.get(player.clubId) ?? 'EUR', europe: european.get(player.clubId) ?? [],
      position: player.position, minutes: player.ratingMinutes ?? 0, group0: row && !row.value.value ? row.value.group : null,
      dbRow: row ? { sources: row.value.sources, officialPersonCode: row.value.officialPersonCode, matchMethod: row.value.matchMethod } : null,
      names, birthDate: player.birthDate ?? hits.find(hit => hit.official && hit.birthDate)?.birthDate ?? hits.find(hit => hit.birthDate)?.birthDate ?? null,
      birthYears: player.age ? [2026 - player.age - 1, 2026 - player.age] : null, hits,
    });
  }
  const settled = item => item.hits.filter(hit => hit.official && hit.options.length).some(hit => combinePosition(item.group0 ?? hit.group, hit.options).position);
  const clubWords = name => plain(name).split(' ').filter(word => word.length >= 4 && !['basket', 'basketball', 'basketbol', 'club', 'kulubu', 'spor', 'belediyesi', 'baskets'].includes(word));
  const people = evidence.filter(item => !settled(item)).map(item => ({ key: item.id, names: item.names, initial: item.names.length ? null : /^([A-Z])\./.exec(item.name)?.[1] ?? null, surname: item.names.length ? null : item.name.replace(/^[A-Z]\.\s?/, ''), birthDate: item.birthDate, birthYears: item.birthYears, club: item.club, clubWords: clubWords(item.club), language: LANGUAGE[item.league] ?? 'en' }));
  return { evidence, people };
}

// --------------------------------------------------------------------------------------------------------- Wikidata
const BASKET = /basket|pallacanestro|baloncesto|b[aà]squet|basquete|kosarka|košarka|krepšin|koszyk/i;
/** For each person, a unique Wikidata basketball player with his name and birth date (or the club among his teams). */
async function readWikidata(people, cache, onlyInitials) {
  const api = 'https://www.wikidata.org/w/api.php?format=json&';
  const store = new Map(), teams = new Map();
  const entities = async (ids, props, target) => {
    const need = ids.filter(id => !target.has(id));
    for (let i = 0; i < need.length; i += 50) {
      const chunk = need.slice(i, i + 50), { body } = await cachedGet(`${api}action=wbgetentities&ids=${chunk.join('|')}&props=${props}&languages=en|it|fr|es|tr|de`, cache, { json: true });
      for (const id of chunk) target.set(id, body?.entities?.[id] ?? { id });
    }
    return ids.map(id => target.get(id));
  };
  const claim = (entity, property) => (entity?.claims?.[property] ?? []).filter(item => item.rank !== 'deprecated').map(item => item.mainsnak?.datavalue?.value).filter(Boolean);
  const labelOf = entity => entity?.labels?.en?.value ?? Object.values(entity?.labels ?? {})[0]?.value ?? null;
  const namesOf = entity => [...Object.values(entity?.labels ?? {}).map(item => item.value), ...Object.values(entity?.aliases ?? {}).flat().map(item => item.value)];
  const born = entity => claim(entity, 'P569').map(item => item.time?.slice(1, 11)).filter(Boolean);
  const out = [];
  for (const person of people.filter(item => onlyInitials ? !item.names.length : item.names.length)) {
    const found = new Set();
    for (const query of person.names.length ? person.names : [person.surname]) {
      for (const language of [...new Set(['en', person.language ?? 'en'])]) {
        const { body } = await cachedGet(`${api}action=wbsearchentities&search=${encodeURIComponent(query)}&language=${language}&uselang=en&type=item&limit=${person.names.length ? 10 : 20}`, cache, { json: true });
        const hits = (body?.search ?? []).filter(hit => !hit.description || BASKET.test(hit.description) || /player|joueur|giocatore|jugador|oyuncu|spieler/i.test(hit.description));
        hits.forEach(hit => found.add(hit.id));
        if (person.names.length && hits.some(hit => person.names.some(name => nameKey(name) === nameKey(hit.label ?? '')))) break;
      }
    }
    const keys = new Set(person.names.map(nameKey));
    const sameName = entity => person.names.length ? namesOf(entity).some(name => keys.has(nameKey(name))) : namesOf(entity).some(name => { const words = plain(name).split(' '), surname = plain(person.surname).split(' '); return words.length > surname.length && words[0].startsWith(person.initial.toLowerCase()) && words.slice(-surname.length).join(' ') === surname.join(' '); });
    const candidates = (await entities([...found], 'labels|aliases|descriptions|claims|sitelinks', store)).filter(entity => entity?.claims && sameName(entity) && claim(entity, 'P31').some(item => item.id === 'Q5')
      && (claim(entity, 'P106').some(item => item.id === 'Q3665646') || claim(entity, 'P641').some(item => item.id === 'Q5372') || Object.values(entity.descriptions ?? {}).some(item => BASKET.test(item.value))));
    let chosen = null, why = null;
    if (person.birthDate) { const same = candidates.filter(entity => born(entity).includes(person.birthDate)); if (same.length === 1) [chosen, why] = [same[0], 'same-name-and-birth-date']; }
    if (!chosen && candidates.length) {
      const teamOf = new Map((await entities([...new Set(candidates.flatMap(entity => claim(entity, 'P54').map(item => item.id)))], 'labels|aliases', teams)).map(entity => [entity.id, entity]));
      const ok = candidates.filter(entity => {
        const years = born(entity).map(date => Number(date.slice(0, 4))), full = born(entity).filter(date => !date.includes('-00'));
        if (person.birthDate && (full.length || years.length && !years.includes(Number(person.birthDate.slice(0, 4))))) return false; // another birth date is another person
        const yearOk = person.birthDate || !person.birthYears || !years.length || years.some(year => person.birthYears.includes(year));
        const clubOk = claim(entity, 'P54').some(item => { const names = namesOf(teamOf.get(item.id)).map(plain).join(' | '); return person.clubWords.some(word => names.includes(word)); });
        return yearOk && clubOk;
      });
      if (ok.length === 1) [chosen, why] = [ok[0], person.birthYears ? 'same-name-birth-year-and-club' : 'same-name-and-club'];
    }
    const row = { key: person.key, candidates: candidates.map(entity => entity.id), chosen: chosen?.id ?? null, why };
    if (chosen) Object.assign(row, { label: labelOf(chosen), birth: born(chosen), positions: claim(chosen, 'P413').map(item => item.id), sitelinks: Object.fromEntries(Object.entries(chosen.sitelinks ?? {}).filter(([site]) => /^(en|it|fr|es|tr|de|el|lt|sr|hr|pl|cs|he|lv|bg|sl|ro|pt|ca|eu|gl|nl|hu|sk|uk|ru)wiki$/.test(site)).map(([site, value]) => [site, value.title])) });
    out.push(row);
  }
  const positionLabels = Object.fromEntries((await entities([...new Set(out.flatMap(row => row.positions ?? []))], 'labels|aliases|descriptions|claims|sitelinks', store)).map(entity => [entity.id, labelOf(entity)]));
  return { positionLabels, people: out };
}

// ----------------------------------------------------------------------------------------------- Wikipedia infobox
const INFOBOX_FIELDS = { en: ['position'], it: ['ruolo'], fr: ['poste'], es: ['posición', 'posicion'], tr: ['pozisyon', 'mevki'], de: ['position', 'positionen'], el: ['θέση', 'position'], lt: ['pozicija', 'position'], pl: ['pozycja'], pt: ['posição'], ca: ['posició'], nl: ['positie'], sr: ['позиција', 'position'], hr: ['pozicija', 'position'], he: ['עמדה'], cs: ['pozice'], sl: ['položaj'], lv: ['pozīcija', 'position'], bg: ['позиция'] };
const stripWiki = text => text.replace(/<ref[\s\S]*?(<\/ref>|\/>)/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1').replace(/\{\{(?:nowrap|nobr|small)\|([^{}]*)\}\}/gi, '$1').replace(/\{\{[^{}]*\}\}/g, ' ').replace(/<br\s*\/?>/gi, ' / ').replace(/<[^>]+>/g, ' ').replace(/'''?/g, '').replace(/\s+/g, ' ').trim();
/** The infobox position of a player's Wikipedia articles (raw wikitext), up to three languages. */
export function infoboxPosition(wikitext, language) {
  for (const field of INFOBOX_FIELDS[language] ?? ['position']) {
    const match = new RegExp(`\\|\\s*${field}\\s*=([^\\n]*)`, 'i').exec(wikitext);
    if (match && stripWiki(match[1])) return stripWiki(match[1]);
  }
  return null;
}
async function readArticles(wikidata, cache) {
  const out = [];
  for (const person of wikidata.people.filter(item => item.chosen)) {
    const found = [];
    for (const language of Object.keys(INFOBOX_FIELDS)) {
      const page = person.sitelinks?.[`${language}wiki`];
      if (!page || found.length >= 3) continue;
      const slug = encodeURIComponent(page.replace(/ /g, '_'));
      const { status, body } = await cachedGet(`https://${language}.wikipedia.org/w/index.php?title=${slug}&action=raw`, cache);
      if (status !== 200 || !body || /^#\S+\s*\[\[/.test(body.trim())) continue;
      const label = infoboxPosition(body, language);
      if (label) found.push({ lang: language, url: `https://${language}.wikipedia.org/wiki/${slug}`, label });
    }
    out.push({ key: person.key, wikidata: person.chosen, found });
  }
  return out;
}

// --------------------------------------------------------------------------------------------- reading the labels
/** Positions named by an infobox label in the languages read; null when any word is not a known position. */
export function articleOptions(label) {
  const text = fold(label).replace(/\((?:basket[^)]*|baloncesto|pallacanestro|basketbol|basketball)\)/g, '');
  const parts = text.split(/\s*(?:\/|,|;|\band\b|\bet\b|\bou\b|\bo\b|\be\b|\by\b|\bve\b|\bund\b|\bor\b|\bi\b|-(?=\s))\s*/).map(part => part.trim().replace(/[.\s]+$/, '')).filter(Boolean);
  const options = new Set();
  for (const part of parts) {
    const found = [
      [/^(point guard|playmaker|meneur|meneur de jeu|base|oyun kurucu|aufbauspieler|pg|1)$/, ['PG']],
      [/^(shooting guard|guardia tiratrice|guardia|arriere|escolta|sutor guard|sutor|sg|2)$/, ['SG']],
      [/^(small forward|ala piccola|ailier|alero|kisa forvet|sf|3)$/, ['SF']],
      [/^(power forward|ala grande|ailier fort|ala pivot|ala-pivot|uzun forvet|pf|4)$/, ['PF']],
      [/^(center|centre|centro|pivot|pivo|c|5)$/, ['C']],
      [/^(guard|combo guard|g)$/, ['PG', 'SG']],
      [/^(forward|ala|forvet|f)$/, ['SF', 'PF']],
      [/^(swingman|guard-forward|g\/f)$/, ['SG', 'SF']],
      [/^(forward-center|f\/c)$/, ['PF', 'C']],
    ].find(([pattern]) => pattern.test(part));
    if (!found) return null;
    found[1].forEach(position => options.add(position));
  }
  return [...options];
}
const WIKIDATA_POSITIONS = { 'point guard': ['PG'], 'shooting guard': ['SG'], 'small forward': ['SF'], 'power forward': ['PF'], center: ['C'], centre: ['C'], guard: ['PG', 'SG'], forward: ['SF', 'PF'], 'combo guard': ['PG', 'SG'], swingman: ['SG', 'SF'], 'stretch four': ['PF'], 'point forward': ['SF'] };
/** Positions of a Wikidata person (P413 labels); null when one is not a basketball position. */
export function wikidataOptions(ids, labels) {
  const options = new Set();
  for (const id of ids ?? []) { const found = WIKIDATA_POSITIONS[fold(labels[id]).replace(/\s*\(basketball\)$/, '')]; if (!found) return null; found.forEach(position => options.add(position)); }
  return [...options];
}

/**
 * One player's decision: { kind: 'official' | 'group' | 'reported' | 'conflict' | null, ... }. `community` lists the
 * reported sources ({ source, url, label, options, match }).
 */
export function decide(item, community) {
  const official = item.hits.filter(hit => hit.official);
  for (const hit of official.filter(hit => hit.options.length)) {
    const combined = combinePosition(item.group0 ?? hit.group, hit.options);
    if (combined.position) return { kind: 'official', position: combined.position, method: hit.options.length === 1 ? 'official-roster-exact' : 'official-roster-narrowed-by-role', hit, conflict: combined.conflict };
  }
  let allowed = item.group0 ? [...GROUP_POSITIONS[item.group0]] : [...POSITIONS];
  for (const hit of official) { const options = hit.options.length ? hit.options : hit.group ? GROUP_POSITIONS[hit.group] : null; if (options) { const next = allowed.filter(position => options.includes(position)); if (next.length) allowed = next; } }
  const narrowed = community.map(source => ({ ...source, within: source.options.filter(position => allowed.includes(position)) }));
  const singles = [...new Set(narrowed.filter(source => source.within.length === 1).map(source => source.within[0]))];
  const contradicted = singles.length === 1 && narrowed.some(source => !source.within.includes(singles[0]));
  let decision = null;
  if (singles.length === 1 && !contradicted) decision = { kind: 'reported', position: singles[0], sources: narrowed.filter(source => source.within.includes(singles[0])) };
  else if (singles.length > 1 || contradicted) decision = { kind: 'conflict', sources: narrowed };
  if ((!decision || decision.kind === 'conflict') && !item.group0 && item.uuid) {
    const groups = [...new Set(allowed.map(groupOf))];
    const hit = official.find(entry => entry.group && !entry.options.length || entry.options.length && new Set(entry.options.map(groupOf)).size === 1);
    if (groups.length === 1 && hit && groups[0] !== 'Center') return { kind: 'group', group: groups[0], hit, before: decision };
  }
  return decision;
}

/** The batch rows and the review list. */
export function buildBatch({ evidence, state, wikidata, articles, batch, observedOn }) {
  const wikidataOf = new Map(wikidata.people.filter(person => person.chosen).map(person => [person.key, person]));
  const articlesOf = new Map(articles.map(item => [item.key, item]));
  const rows = [], review = [], addedChanges = new Map(), counts = {};
  const count = (league, key) => { (counts[league] ??= { guessed: 0, official: 0, reported: 0, group: 0, still: 0 })[key] += 1; };
  for (const item of evidence) {
    count(item.league, 'guessed');
    const community = [];
    const person = wikidataOf.get(item.id);
    if (person) { const options = wikidataOptions(person.positions, wikidata.positionLabels); if (options?.length) community.push({ source: 'wikidata.org', url: `https://www.wikidata.org/wiki/${person.chosen}`, label: person.positions.map(id => wikidata.positionLabels[id]).join(' / '), options, match: person.why }); }
    for (const found of articlesOf.get(item.id)?.found ?? []) { const options = articleOptions(found.label); if (options?.length) community.push({ source: `${found.lang}.wikipedia.org`, url: found.url, label: found.label, options, match: `${person?.why ?? 'wikidata'} (article linked from Wikidata)` }); }
    for (const hit of item.hits.filter(entry => !entry.official && entry.options.length)) community.push({ source: hit.sourceName, url: hit.sources[0], label: hit.label, options: hit.options, match: hit.match });
    const decision = decide(item, community);
    const entry = { id: item.id, name: item.name, club: item.club, league: item.league, minutes: item.minutes, from: item.position, storedGroup: item.group0, decision: decision?.kind ?? 'none' };
    review.push(entry);
    if (!decision || decision.kind === 'conflict') {
      count(item.league, 'still');
      entry.why = decision ? `sources disagree: ${decision.sources.map(source => `${source.source} "${source.label}"`).join('; ')}`
        : item.hits.length ? `sources give no single exact position: ${[...new Set(item.hits.map(hit => `${hit.sourceName} "${hit.label ?? 'no position'}"`))].join(', ')}${person ? `; Wikidata ${person.chosen} has ${person.positions?.length ? 'no single position' : 'no position'}` : ''}`
          : person ? `no roster lists him; Wikidata ${person.chosen} has ${person.positions?.length ? 'no single position' : 'no position'}` : 'no roster or Wikidata entry found';
      continue;
    }
    if (decision.kind === 'group') {
      count(item.league, 'group');
      const hit = decision.hit;
      entry.to = decision.group; entry.via = `${hit.sourceName} "${hit.label}"`;
      rows.push({ entity_type: 'player', entity_id: item.uuid, field: 'position', value: { value: null, group: decision.group, method: 'official-group-statistics', sources: hit.sources, rosterLabel: String(hit.label), rosterMatch: hit.match, batch, observedOn }, reason: `Broad position from the official roster (${hit.sourceName}); matched by ${hit.match}.` });
      continue;
    }
    const position = decision.position, group = groupOf(position), official = decision.kind === 'official';
    count(item.league, official ? 'official' : 'reported');
    const kept = item.dbRow?.sources ?? [];
    const sources = official ? [...new Set([...decision.hit.sources, ...kept.filter(url => !/wikipedia/.test(url))])] : [...new Set([...decision.sources.map(source => source.url), ...kept])];
    entry.to = position; entry.via = official ? `${decision.hit.sourceName} "${decision.hit.label}"` : decision.sources.map(source => `${source.source} "${source.label}"`).join('; ');
    if (official && decision.conflict) entry.note = `official exact label outside the stored ${item.group0} role (the exact label wins)`;
    if (!item.uuid) { addedChanges.set(item.id, { position, positionSource: official ? 'official' : 'provider', source: official ? decision.hit.sources[0] : decision.sources[0].url, via: entry.via }); continue; }
    const code = item.dbRow?.officialPersonCode ? { officialPersonCode: item.dbRow.officialPersonCode, matchMethod: item.dbRow.matchMethod } : {};
    const value = official
      ? { value: position, group, method: decision.method, sources, rosterLabel: String(decision.hit.label), rosterMatch: decision.hit.match, ...code, batch, observedOn }
      : { value: position, group, method: 'reported-exact', community: true, sources, reportedLabels: decision.sources.map(source => `${source.source}: ${source.label}`), reportedMatch: [...new Set(decision.sources.map(source => source.match))].join(', '), ...(item.group0 ? { officialGroup: item.group0 } : {}), ...code, batch, observedOn };
    const reason = official ? `Exact position from the official roster (${decision.hit.sourceName}); matched by ${decision.hit.match}.`
      : `Exact position reported by ${[...new Set(decision.sources.map(source => source.source))].join(' and ')} (shown as reported)${item.group0 ? `, inside the stored ${item.group0} role` : ''}; matched by ${[...new Set(decision.sources.map(source => source.match))].join(', ')}.`;
    rows.push({ entity_type: 'player', entity_id: item.uuid, field: 'position', value, reason: reason.slice(0, 500) });
  }
  for (const [club, row] of Object.entries(state.added_players)) {
    const changed = row.value.value.filter(player => addedChanges.has(player.id));
    if (!changed.length) continue;
    const value = row.value.value.map(player => { const change = addedChanges.get(player.id); return change ? { ...player, position: change.position, positionSource: change.positionSource, estimated: player.estimated.filter(field => field !== 'game_position') } : player; });
    rows.push({ entity_type: 'club', entity_id: club, field: 'added_players', value: { ...row.value, value, sources: [...new Set([...row.value.sources, ...changed.map(player => addedChanges.get(player.id).source)])], observedOn, batch, positionsUpdated: changed.map(player => ({ id: player.id, name: player.name, from: player.position, position: addedChanges.get(player.id).position, via: addedChanges.get(player.id).via })) },
      reason: `${row.reason ?? 'Current players missing from the pack.'} Positions updated for ${changed.map(player => player.name).join(', ')} (${batch}).`.slice(0, 500) });
  }
  const keys = new Set();
  for (const row of rows) { const key = `${row.entity_type}/${row.entity_id}/${row.field}`; if (keys.has(key)) throw new Error(`Two rows for ${key}.`); keys.add(key); }
  return { batch: { model: 'profile-overrides-1', batch, observedOn, rows }, review: { counts, players: review } };
}

// ------------------------------------------------------------------------------------------------------------- CLI
async function main() {
  const [command] = process.argv.slice(2);
  const argument = name => { const index = process.argv.indexOf(name); return index > 0 ? process.argv[index + 1] : null; };
  const list = name => (argument(name) ?? '').split(',').map(item => item.trim()).filter(Boolean);
  const write = (file, data) => { writeFileSync(file, JSON.stringify(data, null, 1)); return file; };
  const pack = () => { const file = readJson(argument('--pack')); return file.pack ?? file; };
  const observedOn = argument('--observed-on') ?? new Date().toISOString().slice(0, 10);
  if (command === 'state') {
    const result = storedState(list('--uploads').map(readJson), pack());
    write(argument('--out'), result);
    console.log(`${Object.keys(result.position).length} position rows, ${Object.keys(result.added_players).length} club rows; clubs whose added players differ from the pack: ${result.mismatched.length}`);
    if (result.mismatched.length) process.exitCode = 1;
  } else if (command === 'lnb') await readLnb(argument('--out'));
  else if (command === 'lnb-rosters') {
    const dir = argument('--in'), { readdirSync } = await import('node:fs');
    const result = lnbRosters(pack(), readdirSync(dir).filter(file => /^roster-\d+\.json$/.test(file)).sort().map(file => readJson(path.join(dir, file))), observedOn);
    write(argument('--out'), result); console.log(`lnb.fr: ${result.clubs.length} clubs, unmatched ${result.unmatched.length}`);
  } else if (command === 'fiba-europe-cup') {
    const result = await readFibaEuropeCup(pack(), argument('--cache'), observedOn);
    write(argument('--out'), result); console.log(`FIBA Europe Cup: ${result.clubs.map(club => club.club).join(', ')}`);
  } else if (command === 'evidence') {
    const { evidence, people } = gatherEvidence({ pack: pack(), state: readJson(argument('--state')), rosterFiles: list('--rosters').map(file => ({ name: path.basename(file), file: readJson(file) })), close: argument('--close') ? readJson(argument('--close')) : [] });
    write(argument('--out'), evidence); write(argument('--wikidata-in'), people);
    console.log(`${evidence.length} guessed players; ${people.length} to look up (${people.filter(person => person.names.length).length} with a full name)`);
  } else if (command === 'wikidata') {
    const result = await readWikidata(readJson(argument('--in')), argument('--cache'), process.argv.includes('--initials'));
    write(argument('--out'), result); console.log(`Wikidata: ${result.people.filter(row => row.chosen).length} of ${result.people.length} found, ${result.people.filter(row => row.positions?.length).length} with positions`);
  } else if (command === 'articles') {
    const result = await readArticles(readJson(argument('--wikidata')), argument('--cache'));
    write(argument('--out'), result); console.log(`Wikipedia: ${result.filter(item => item.found.length).length} of ${result.length} with an infobox position`);
  } else if (command === 'build') {
    const wikidata = (argument('--wikidata') ?? '').split(',').filter(Boolean).map(readJson).reduce((all, item) => ({ positionLabels: { ...all.positionLabels, ...item.positionLabels }, people: [...all.people, ...item.people] }), { positionLabels: {}, people: [] });
    const articles = (argument('--articles') ?? '').split(',').filter(Boolean).flatMap(readJson);
    const { batch, review } = buildBatch({ evidence: readJson(argument('--evidence')), state: readJson(argument('--state')), wikidata, articles, batch: argument('--batch'), observedOn });
    const text = JSON.stringify(batch, null, 1);
    writeFileSync(argument('--out'), text); write(argument('--review'), review);
    console.log(JSON.stringify(review.counts));
    console.log(`${batch.rows.length} rows; SHA-256 ${createHash('sha256').update(text).digest('hex')}`);
  } else throw new Error('Commands: state, lnb, lnb-rosters, fiba-europe-cup, evidence, wikidata, articles, build (see the header).');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
