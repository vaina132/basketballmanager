#!/usr/bin/env node
/**
 * Official roster pages with exact positions, for scripts/real-data-official-profiles.mjs (16 November 2026). API-Sports
 * gives only broad roles, so exact positions come from free league sites. Each source is read once per club, slowly
 * (one page at a time with a pause), and written as a roster evidence file with its source links and date:
 *
 *   node scripts/real-data-official-rosters.mjs --pack PACK.json --source acb --out ROSTERS-acb.json [--raw DIR]
 *
 * Sources (league, page, what it gives):
 *   acb   Liga ACB        acb.com team "plantilla" pages: Base/Escolta/Alero/Ala-pívot/Pívot (exact)
 *   feb   Primera FEB     baloncestoenvivo.feb.es team pages: Base/Escolta/Alero/A-Pivot/Pívot (exact), height, birth date
 *   bbl   Bundesliga      easycredit-bbl.de team pages: PG/SG/SF/PF/C (exact), height, birth date
 *   esake Greek League    esake.gr team pages: PG/SG/SF/PF/C (exact), height, birth date
 *   lba   Serie A         legabasket.it public site data: Playmaker/Guardia/Centro (exact), Ala (broad), height, birth date
 *   lnp   Serie A2        legapallacanestro.com team pages: Play/Guardia/Centro (exact), Ala (broad), height, birth date
 *   bcl   Champions League championsleague.basketball team pages: PG/SG/SF/PF/C (exact) or G/F (broad), birth date
 * Every source also gives the nationality as printed (a code or a country name in the site's language), kept raw
 * for scripts/real-data-profile-gaps.mjs (23 November 2026).
 * The league's terms of use are summarised in the owner's report; facts are kept with their source link.
 *
 * Clubs are matched to the pack's clubs of that competition by name words (sponsor names ignored); ambiguous or
 * unmatched teams are listed and left out.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchName } from './real-data-official-profiles.mjs';

const ENTITIES = { amp: '&', apos: "'", quot: '"', lt: '<', gt: '>', nbsp: ' ' };
const decode = text => text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (all, code) => code[0] === '#' ? String.fromCodePoint(code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1))) : ENTITIES[code.toLowerCase()] ?? all);
/** Page text as "|"-separated cells, the shape the parsers read. */
export const cells = html => decode(html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, '|')).replace(/\s*\|[|\s]*/g, '|');
const fold = text => String(text).normalize('NFKD').replace(/\p{M}/gu, '').replace(/ı/g, 'i').toLowerCase();
const title = text => text.toLowerCase().replace(/(^|[\s'-])\p{L}/gu, letter => letter.toUpperCase());
const dmy = (day, month, year) => { const value = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`; return Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value ? value : undefined; };
const cm = text => { const value = Math.round(Number(String(text).replace(',', '.')) * (String(text).includes(',') || String(text).includes('.') ? 100 : 1)); return value >= 150 && value <= 240 ? value : undefined; };
const number = text => /^\d{1,2}$/.test(String(text ?? '').trim()) ? Number(String(text).trim()) : null;

/** Each source: competition name in the pack, how to list its teams, and how to read one team page. */
export const SOURCES = {
  acb: {
    competition: 'Liga ACB', name: 'acb.com', list: 'https://acb.com/es/liga/equipos/barca-2/plantilla',
    teams: html => [...new Set([...html.matchAll(/href="\/es\/liga\/equipos\/([a-z0-9-]+-\d+)"/g)].map(match => match[1]))].map(slug => ({ name: slug.replace(/-\d+$/, '').replace(/-/g, ' '), url: `https://acb.com/es/liga/equipos/${slug}/plantilla` })),
    players: html => {
      const text = cells(html), start = text.indexOf('|Plantilla|#|'), roster = start < 0 ? '' : text.slice(start, text.indexOf('|Cuerpo técnico|', start) >>> 0);
      return [...roster.matchAll(/\|#\|(\d{1,2})\|([^|]+)\|(\d,\d\d) m\|[^|]*\|([^|]+)\|(Base|Escolta|Alero|Ala-pívot|Pívot|[^|]{0,12})\|(\d+)\|años\|/g)].map(match => ({ name: `${match[2].trim()} ${match[4].trim()}`, number: number(match[1]), position: match[5], heightCm: cm(match[3]) }));
    },
  },
  feb: {
    competition: 'Primera FEB', name: 'baloncestoenvivo.feb.es', list: 'https://baloncestoenvivo.feb.es/calendario.aspx?g=1&t=2026&nm=primerafeb',
    teams: html => [...new Set([...html.matchAll(/href="(https:\/\/baloncestoenvivo\.feb\.es\/Equipo\.aspx\?i=\d+)"/g)].map(match => match[1]))].map(url => ({ name: null, url })),
    teamName: html => cells(html).match(/\|([^|]+)\|Datos del Club\|/)?.[1] ?? '',
    players: html => {
      const text = cells(html), roster = text.slice(text.indexOf('|Nombre|Puesto|Dorsal|'), text.indexOf('|Datos del Club|'));
      return [...roster.matchAll(/\|([^|]+)\|([^|]{1,12})\|(?:(\d{1,2}|-)\|)?(\d\d)\/(\d\d)\/(\d{4})[^|]*\|([^|]+)\|(?:SI|NO)\|(\d{3}|-)\|/g)].map(match => ({ name: title(match[1].replace(/\s+/g, ' ').trim()), number: number(match[3]), position: match[2] === '-' ? null : match[2], birthDate: dmy(match[4], match[5], match[6]), heightCm: cm(match[8]), nationality: match[7].trim() }));
    },
  },
  bbl: {
    competition: 'Basketball Bundesliga', name: 'easycredit-bbl.de', list: 'https://www.easycredit-bbl.de/',
    teams: html => [...new Set([...html.matchAll(/href="\/teams\/(\d+)\/2026"/g)].map(match => match[1]))].map(id => ({ name: null, url: `https://www.easycredit-bbl.de/teams/${id}/2026` })),
    teamName: html => cells(html).match(/\|Unsere Teams\|\/\|([^|]+)\|/)?.[1] ?? '',
    players: html => {
      const text = cells(html), roster = text.slice(text.indexOf('|Nr|Spieler|Geboren|'), text.indexOf('|Trainerstab|'));
      return [...roster.matchAll(/\|(\d{1,2})\|[^|]+\|([^|]+)\|,\|([^|]+)\|(\d\d)\.(\d\d)\.(\d{4})\|\d+\|(\d\.\d\d) m\|[^|]*\|(PG|SG|SF|PF|C|G|F|[A-Z/]{0,5})\|(?=([A-Z]{2}(?:\s*\/\s*[A-Z]{2})*)\||)/g)].map(match => ({ name: `${match[3].trim()} ${match[2].trim()}`, number: number(match[1]), position: match[8], birthDate: dmy(match[4], match[5], match[6]), heightCm: cm(match[7]), nationality: match[9] }));
    },
  },
  esake: {
    competition: 'Greek Basket League', name: 'esake.gr', list: 'https://www.esake.gr/',
    teams: html => [...new Set([...html.matchAll(/href="\/el\/action\/EsaketeamView\?idteam=([0-9A-F]+)&(?:amp;)?mode=1"/g)].map(match => match[1]))].map(id => ({ name: null, url: `https://www.esake.gr/el/action/EsaketeamView?idteam=${id}&mode=1` })),
    teamName: html => cells(html).match(/\|ΟΜΑΔΑ\|([^|]+)\|/)?.[1] ?? '',
    players: html => [...cells(html).matchAll(/\|#\|(\d{1,2})\|([^|]+)\|([^|]+)\|[A-Z/-]*\|ΟΜΑΔΑ\|[^|]+\|ΥΨΟΣ\|([\d,]+)\|ΘΕΣΗ\|([^|]+)\|ΗΜ\. ΓΕΝΝΗΣΗΣ\|(\d\d)-(\d\d)-(\d{4})\|(?:ΧΩΡΑ\|([^|]+)\|)?/g)].map(match => ({ name: title(`${match[3].trim()} ${match[2].trim()}`), number: number(match[1]), position: match[5].trim(), birthDate: dmy(match[6], match[7], match[8]), heightCm: cm(match[4]), nationality: match[9]?.trim() })),
  },
  lba: {
    competition: 'Lega Basket Serie A', name: 'legabasket.it', list: 'https://www.legabasket.it/api/teams/get-teams?year=2026', json: true,
    teams: data => data.teams.map(team => ({ name: team.name, url: `https://www.legabasket.it/api/teams/get-team-roster?id=${team.id}` })),
    players: data => data.players.map(player => ({ name: `${player.name} ${player.surname}`, number: number(player.player_number), position: player.player_role === '-' ? null : player.player_role, birthDate: /^\d{4}-\d{2}-\d{2}$/.test(player.birth_date ?? '') ? player.birth_date : undefined, heightCm: cm(player.height), nationality: player.country ?? undefined })),
  },
  lnp: {
    competition: 'Serie A2', name: 'legapallacanestro.com', list: 'https://www.legapallacanestro.com/serie/1/squadre',
    teams: html => [...new Set([...html.matchAll(/href="\/serie-a2\/([a-z0-9-]+)"/g)].map(match => match[1]))].filter(slug => !['calendario-dirette'].includes(slug) && !slug.startsWith('supercoppa')).map(slug => ({ name: slug.replace(/-/g, ' '), url: `https://www.legapallacanestro.com/serie-a2/${slug}` })),
    players: html => {
      const text = cells(html), roster = text.slice(text.indexOf('|N°|Atleta|Ruolo|'));
      return [...roster.matchAll(/\|(\d{1,2})\|([^|]+)\|(Play|Play\/Guardia|Guardia|Guardia\/Ala|Ala|Ala\/Centro|Centro|Pivot)\|(\d\d?)\/(\d\d?)\/(\d{4})\|(\d{3})\|(?=(?:\d{2,3}\|)?([A-Z]{3})\||)/g)].map(match => ({ name: match[2].replace(/\s+/g, ' ').trim(), surnameFirst: true, number: number(match[1]), position: match[3], birthDate: dmy(match[4], match[5], match[6]), heightCm: cm(match[7]), nationality: match[8] }));
    },
  },
  bcl: {
    competition: 'Basketball Champions League', name: 'championsleague.basketball', list: 'https://www.championsleague.basketball/en',
    teams: html => [...new Set([...html.matchAll(/href="\/en\/teams\/([a-z0-9-]+)"/g)].map(match => match[1]))].map(slug => ({ name: slug.replace(/-/g, ' '), url: `https://www.championsleague.basketball/en/teams/${slug}` })),
    players: html => {
      const seen = new Map();
      for (const match of html.replace(/\\"/g, '"').matchAll(/\{"playerId":(\d+),"firstName":"([^"]*)","lastName":"([^"]*)","uniformNumber":"([^"]*)","positionCode":"([A-Z]*)"(?:,"nationality":"([A-Z]{3})")?[^{}]*?"dateOfBirth":"(\d{4}-\d{2}-\d{2})?"?/g)) {
        if (!seen.has(match[1])) seen.set(match[1], { name: `${match[2].trim()} ${match[3].trim()}`, number: number(match[4]), position: match[5] || null, birthDate: match[7] || undefined, nationality: match[6] || undefined });
      }
      return [...seen.values()];
    },
  },
};

/** Words that name sponsors or club forms, not the club. */
const NOISE = new Set(['basket', 'basketball', 'baloncesto', 'basquet', 'bàsquet', 'club', 'cb', 'bc', 'bk', 'kk', 'sad', 'sk', 'ab', 'pallacanestro', 'the', 'de', 'di', 'del', 'la', 'le', 'el', 'and', 'baskets', 'basketbol', 'fc', 'gs', 'ae', 'as', 'aek', 'ksk']);
const words = text => fold(text).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(word => word.length >= 3 && !NOISE.has(word));
/** Hand-checked names the word rule cannot settle (source team name words → pack club name). */
const ALIASES = { 'olimpia milano': 'Olimpia Milano', 'virtus bologna': 'Virtus Bologna', 'fortitudo bologna': 'Fortitudo Bologna', 'gipuzkoa': 'Gipuzkoa Basket', 'donosti': 'Gipuzkoa Basket', 'baskets bonn': 'Telekom Baskets Bonn', 'alba berlin': 'Alba Berlin' };

/** The pack club a source team names, among the competition's clubs; null when none or several fit. */
export function matchClub(teamName, clubs) {
  const name = fold(teamName);
  for (const [key, target] of Object.entries(ALIASES)) if (name.includes(key)) { const found = clubs.filter(club => club.name === target); if (found.length === 1) return found[0]; }
  const own = words(teamName);
  const score = club => { const other = [...new Set([...words(club.name), ...words(club.city ?? '')])]; return own.filter(word => other.some(item => item === word || item.length >= 5 && word.length >= 5 && (item.startsWith(word) || word.startsWith(item)))).length; };
  const ranked = clubs.map(club => [club, score(club)]).filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]);
  if (!ranked.length || ranked.length > 1 && ranked[0][1] === ranked[1][1]) return null;
  return ranked[0][0];
}

/**
 * The pack club whose squad shares the most players with a source roster (names matched as the profile corrections
 * match them): at least three shared players and twice as many as any other club. Names of teams can be sponsor
 * names or another alphabet; their players are not.
 */
export function matchClubByPlayers(players, clubs, pack) {
  const squads = new Map(clubs.map(club => [club.id, pack.players.filter(player => player.clubId === club.id)]));
  const ranked = clubs.map(club => [club, players.filter(player => matchName(player.name, player.number, squads.get(club.id).map(item => ({ name: item.name, number: item.number })))).length]).sort((a, b) => b[1] - a[1]);
  return ranked[0]?.[1] >= 3 && ranked[0][1] >= 2 * (ranked[1]?.[1] ?? 0) ? ranked[0][0] : null;
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function get(url, json = false) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; roster-check)', Accept: json ? 'application/json' : 'text/html' }, signal: AbortSignal.timeout(45_000) });
      if (!response.ok) throw new Error(`${response.status}`);
      return json ? response.json() : response.text();
    } catch (error) {
      if (attempt >= 3) throw new Error(`${url}: ${error.message}`);
      await pause(3000 * attempt);
    }
  }
}

async function main() {
  const argument = name => { const index = process.argv.indexOf(name); return index > 0 ? process.argv[index + 1] : null; };
  const source = SOURCES[argument('--source')], out = argument('--out'), raw = argument('--raw');
  if (!source || !out || !argument('--pack')) throw new Error(`Usage: --pack PACK.json --source ${Object.keys(SOURCES).join('|')} --out ROSTERS.json [--raw DIR]`);
  if (existsSync(out)) throw new Error(`${out} exists; choose a new output file.`);
  const envelope = JSON.parse(await readFile(argument('--pack'), 'utf8')), pack = envelope.pack ?? envelope;
  const competition = pack.competitions.find(item => item.name === source.competition);
  const clubs = competition.clubIds.map(id => pack.clubs.find(club => club.id === id));
  if (raw) await mkdir(raw, { recursive: true });
  const observedOn = new Date().toISOString().slice(0, 10);
  const listing = await get(source.list, source.json);
  const teams = source.teams(listing), result = { source: source.list, sourceName: source.name, observedOn, competition: source.competition, clubs: [], unmatched: [], empty: [] };
  const used = new Map();
  for (const [index, team] of teams.entries()) {
    await pause(1200);
    const page = await get(team.url, source.json).catch(error => { result.empty.push({ url: team.url, error: error.message }); return null; });
    if (!page) continue;
    if (raw) await writeFile(path.join(raw, `${String(index).padStart(2, '0')}.${source.json ? 'json' : 'html'}`), source.json ? JSON.stringify(page) : page);
    const name = team.name ?? source.teamName(page);
    const players = source.players(page), byPlayers = matchClubByPlayers(players, clubs, pack), byName = matchClub(name, clubs);
    const club = byPlayers ?? byName;
    if (!club) { result.unmatched.push({ name, url: team.url, players: players.length }); continue; }
    if (byPlayers && byName && byPlayers.id !== byName.id) result.unmatched.push({ name, url: team.url, note: `name suggests ${byName.name}; players match ${byPlayers.name} (used)` });
    if (!players.length) { result.empty.push({ name, url: team.url }); continue; }
    if (used.has(club.id)) { result.unmatched.push({ name, url: team.url, duplicateOf: used.get(club.id) }); continue; }
    used.set(club.id, name);
    result.clubs.push({ clubId: club.id, club: club.name, sourceTeam: name, sources: [team.url], players });
  }
  await writeFile(out, JSON.stringify(result, null, 1));
  console.log(`${source.name}: ${result.clubs.length}/${clubs.length} clubs, ${result.clubs.reduce((sum, club) => sum + club.players.length, 0)} players with a position; unmatched teams: ${result.unmatched.map(item => item.name).join(', ') || 'none'}; missing clubs: ${clubs.filter(club => !used.has(club.id)).map(club => club.name).join(', ') || 'none'}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
