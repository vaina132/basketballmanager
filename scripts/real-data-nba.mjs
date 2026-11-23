#!/usr/bin/env node
/**
 * NBA data (docs/nba-plan.md step 1, 23 November 2026). Builds one reviewed file with the 30 NBA clubs (conference,
 * division, arena, capacity, colours, head coach) and their 2026-27 standard-contract rosters (number, exact position,
 * height, weight, birth date, nationality, API-Sports player id), plus the NBA season totals behind the ratings.
 *
 * Sources: API-Sports league 12 (teams, 2026-27 team lists, every finished 2025-26 and 2026-27 game's player box
 * scores; downloaded once by the main session, read here from --raw, no API calls); English Wikipedia (CC BY-SA 4.0,
 * facts only, each with its page link): each team's roster template (players, numbers, heights, weights, birth dates,
 * two-way marks, head coach), the team article (arena, colours), the arena article (basketball capacity) and each
 * player's article (exact position: the first one listed in the infobox); Wikidata (CC0) for citizenship when the
 * roster gives no country. Two-way players ("note = TW") are left out (two-way contracts are not in the first version).
 *
 *   node scripts/real-data-nba.mjs --raw <api-sports downloads> --cache <wiki cache dir> --out <nba-data.json>
 *
 * Every Wikipedia/Wikidata response is cached, so a rerun repeats no request. Requests are spaced 2 s apart and back off when Wikimedia asks.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { birthDateOf, coachHighlights, coachingCareer, nationalityOf, statedNationality } from './real-data-coaches.mjs';

const USER_AGENT = 'CourtsideGameBot/1.0 (open-source basketball game; NBA roster facts lookup)';
const sleep = ms => new Promise(done => setTimeout(done, ms));

/** Conferences and divisions, 2026-27 (https://en.wikipedia.org/wiki/National_Basketball_Association#Teams). */
export const NBA_DIVISIONS = Object.freeze({
  Eastern: Object.freeze({
    Atlantic: ['Boston Celtics', 'Brooklyn Nets', 'New York Knicks', 'Philadelphia 76ers', 'Toronto Raptors'],
    Central: ['Chicago Bulls', 'Cleveland Cavaliers', 'Detroit Pistons', 'Indiana Pacers', 'Milwaukee Bucks'],
    Southeast: ['Atlanta Hawks', 'Charlotte Hornets', 'Miami Heat', 'Orlando Magic', 'Washington Wizards'],
  }),
  Western: Object.freeze({
    Northwest: ['Denver Nuggets', 'Minnesota Timberwolves', 'Oklahoma City Thunder', 'Portland Trail Blazers', 'Utah Jazz'],
    Pacific: ['Golden State Warriors', 'Los Angeles Clippers', 'Los Angeles Lakers', 'Phoenix Suns', 'Sacramento Kings'],
    Southwest: ['Dallas Mavericks', 'Houston Rockets', 'Memphis Grizzlies', 'New Orleans Pelicans', 'San Antonio Spurs'],
  }),
});
/** Three-letter short names (the league's own team abbreviations). */
export const NBA_SHORT = Object.freeze({
  'Atlanta Hawks': 'ATL', 'Boston Celtics': 'BOS', 'Brooklyn Nets': 'BKN', 'Charlotte Hornets': 'CHA', 'Chicago Bulls': 'CHI', 'Cleveland Cavaliers': 'CLE',
  'Dallas Mavericks': 'DAL', 'Denver Nuggets': 'DEN', 'Detroit Pistons': 'DET', 'Golden State Warriors': 'GSW', 'Houston Rockets': 'HOU', 'Indiana Pacers': 'IND',
  'Los Angeles Clippers': 'LAC', 'Los Angeles Lakers': 'LAL', 'Memphis Grizzlies': 'MEM', 'Miami Heat': 'MIA', 'Milwaukee Bucks': 'MIL', 'Minnesota Timberwolves': 'MIN',
  'New Orleans Pelicans': 'NOP', 'New York Knicks': 'NYK', 'Oklahoma City Thunder': 'OKC', 'Orlando Magic': 'ORL', 'Philadelphia 76ers': 'PHI', 'Phoenix Suns': 'PHX',
  'Portland Trail Blazers': 'POR', 'Sacramento Kings': 'SAC', 'San Antonio Spurs': 'SAS', 'Toronto Raptors': 'TOR', 'Utah Jazz': 'UTA', 'Washington Wizards': 'WAS',
});
/** Home city as the game shows it (the team article's location). */
export const NBA_CITY = Object.freeze({
  'Atlanta Hawks': 'Atlanta', 'Boston Celtics': 'Boston', 'Brooklyn Nets': 'New York City', 'Charlotte Hornets': 'Charlotte', 'Chicago Bulls': 'Chicago', 'Cleveland Cavaliers': 'Cleveland',
  'Dallas Mavericks': 'Dallas', 'Denver Nuggets': 'Denver', 'Detroit Pistons': 'Detroit', 'Golden State Warriors': 'San Francisco', 'Houston Rockets': 'Houston', 'Indiana Pacers': 'Indianapolis',
  'Los Angeles Clippers': 'Inglewood', 'Los Angeles Lakers': 'Los Angeles', 'Memphis Grizzlies': 'Memphis', 'Miami Heat': 'Miami', 'Milwaukee Bucks': 'Milwaukee', 'Minnesota Timberwolves': 'Minneapolis',
  'New Orleans Pelicans': 'New Orleans', 'New York Knicks': 'New York City', 'Oklahoma City Thunder': 'Oklahoma City', 'Orlando Magic': 'Orlando', 'Philadelphia 76ers': 'Philadelphia', 'Phoenix Suns': 'Phoenix',
  'Portland Trail Blazers': 'Portland', 'Sacramento Kings': 'Sacramento', 'San Antonio Spurs': 'San Antonio', 'Toronto Raptors': 'Toronto', 'Utah Jazz': 'Salt Lake City', 'Washington Wizards': 'Washington, D.C.',
});
/** Stable database id of an NBA club, from its API-Sports team id (a name-based UUID, version 5 layout). */
export function nbaClubUuid(teamId) {
  const hex = createHash('sha256').update(`api-sports-basketball-team:${teamId}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${(8 + (parseInt(hex[16], 16) & 3)).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export const NBA_COMPETITION_UUID = nbaClubUuid('league-12');
const fold = text => String(text).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
/** The id the pack gives a player added from a roster (scripts/real-data-current-squads.mjs). */
export const addedPlayerId = (name, birthDate) => `player-n${createHash('sha256').update(`${fold(name)}|${birthDate ?? ''}`).digest('hex').slice(0, 24)}`;

/** API-Sports minutes ("25:14" or "25") in seconds, as scripts/real-data-import.mjs stores them. */
export const seconds = minutes => {
  const text = String(minutes ?? '').trim(), match = /^(\d+):(\d{1,2})$/.exec(text);
  const value = match && Number(match[2]) < 60 ? Number(match[1]) * 60 + Number(match[2]) : /^\d+$/.test(text) ? Number(text) * 60 : null;
  return Number.isSafeInteger(value) ? value : null;
};

/** The first day of each regular season (UTC dates of the API-Sports schedule); earlier games are preseason. */
export const NBA_SEASON_OPENERS = Object.freeze({ '2025-26': '2025-10-21', '2026-27': '2026-10-20' });

/**
 * NBA season totals in the shape of the database view `player_season_totals` (one row per player, club and season),
 * from the cached box scores, with the import's own mapping (field_goals are two-pointers for this provider) and the
 * view's checks. Games of clubs outside the 30 (All-Star games) are skipped, as the import skips unknown clubs.
 */
export function nbaSeasonTotals(rawDir) {
  const teams = new Set(JSON.parse(readFileSync(join(rawDir, 'teams-2026-2027.json'), 'utf8')).response.map(team => team.id));
  const rows = new Map();
  for (const season of ['2025-2026', '2026-2027']) {
    const label = `${season.slice(0, 4)}-${season.slice(7, 9)}`;
    // Preseason games (stars rest, minutes are spread) are left out: only games from the regular season's opening day.
    const games = JSON.parse(readFileSync(join(rawDir, 'games', `${season}.json`), 'utf8')).response.filter(game => ['FT', 'AOT'].includes(game.status.short) && teams.has(game.teams.home.id) && teams.has(game.teams.away.id) && game.date.slice(0, 10) >= NBA_SEASON_OPENERS[label]);
    const clubGames = new Map();
    const lines = [];
    for (const game of games) {
      const file = join(rawDir, 'box', `${game.id}.json`);
      if (!existsSync(file)) continue;
      const box = JSON.parse(readFileSync(file, 'utf8')).response;
      if (!box.length) continue;
      for (const id of [game.teams.home.id, game.teams.away.id]) clubGames.set(id, (clubGames.get(id) ?? 0) + 1);
      const seen = new Set();
      for (const line of box) {
        const team = teams.has(line.team.id) ? line.team.id : null;
        if (!team || seen.has(line.player.id)) continue;
        seen.add(line.player.id); lines.push({ line, team });
      }
    }
    for (const { line, team } of lines) {
      const key = `${line.player.id}/${team}/${label}`;
      const row = rows.get(key) ?? { player_id: String(line.player.id), provider_name: line.player.name, team_id: team, season_label: label, competition: 'NBA', kind: 'domestic', games_played: 0, seconds_played: 0, two_made: 0, two_attempted: 0, three_made: 0, three_attempted: 0, free_made: 0, free_attempted: 0, rebounds: 0, assists: 0, points: 0, starts: 0, club_games: clubGames.get(team) ?? 0, free_made_checked: 0, free_attempted_checked: 0, lines: 0, lines_consistent: 0, two_made_valid: 0, two_attempted_valid: 0, three_made_valid: 0, three_attempted_valid: 0 };
      const s = seconds(line.minutes) ?? 0, v = value => Number(value ?? 0);
      const two = v(line.field_goals?.total), twoA = v(line.field_goals?.attempts), three = v(line.threepoint_goals?.total), threeA = v(line.threepoint_goals?.attempts), free = v(line.freethrows_goals?.total), freeA = v(line.freethrows_goals?.attempts), points = v(line.points);
      if (s > 0) row.games_played += 1;
      if (s > 0 && line.type === 'starters') row.starts += 1;
      row.seconds_played += s; row.two_made += two; row.two_attempted += twoA; row.three_made += three; row.three_attempted += threeA; row.free_made += free; row.free_attempted += freeA;
      row.rebounds += v(line.rebounds?.total); row.assists += v(line.assists); row.points += points; row.lines += 1;
      const consistent = line.points != null && line.field_goals?.total != null && points === 2 * two + 3 * three + free && free <= freeA;
      if (consistent) { row.free_made_checked += free; row.free_attempted_checked += freeA; row.lines_consistent += 1; }
      if (two <= twoA) { row.two_made_valid += two; row.two_attempted_valid += twoA; }
      if (three <= threeA) { row.three_made_valid += three; row.three_attempted_valid += threeA; }
      rows.set(key, row);
    }
  }
  return [...rows.values()];
}

// ---- Wikipedia and Wikidata ------------------------------------------------------------------------------------
let cacheDir = null, lastRequest = 0, requests = 0;
async function cached(url) {
  const file = join(cacheDir, `${createHash('sha1').update(url).digest('hex')}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const wait = lastRequest + 2000 - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequest = Date.now(); requests += 1;
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(60_000) }).catch(error => ({ ok: false, status: error.message }));
    if (response.ok) { const body = await response.json(); writeFileSync(file, JSON.stringify(body)); return body; }
    const retryAfter = Number(response.headers?.get?.('retry-after')) || 0;
    console.warn(`  ${response.status}; waiting`);
    await sleep(Math.max(retryAfter * 1000, 15000 * (attempt + 1)));
  }
  throw new Error(`failed ${url}`);
}
const api = params => cached(`https://en.wikipedia.org/w/api.php?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`);
/** Wikitext of up to 50 pages per request, following redirects: title asked -> { title, text, item }. */
async function pages(titles) {
  const out = new Map();
  for (let start = 0; start < titles.length; start += 20) {
    const chunk = titles.slice(start, start + 20);
    const body = await api({ action: 'query', prop: 'revisions|pageprops', rvprop: 'content', rvslots: 'main', ppprop: 'wikibase_item', redirects: '1', titles: chunk.join('|') });
    const map = new Map(chunk.map(title => [title, title]));
    for (const item of body.query?.normalized ?? []) for (const [asked, now] of map) if (now === item.from) map.set(asked, item.to);
    for (const item of body.query?.redirects ?? []) for (const [asked, now] of map) if (now === item.from) map.set(asked, item.to);
    const byTitle = new Map((body.query?.pages ?? []).filter(page => !page.missing).map(page => [page.title, { title: page.title, text: page.revisions?.[0]?.slots?.main?.content ?? '', item: page.pageprops?.wikibase_item ?? null }]));
    for (const [asked, now] of map) if (byTitle.has(now)) out.set(asked, byTitle.get(now));
  }
  return out;
}
const strip = text => String(text ?? '').replace(/<ref[\s\S]*?(<\/ref>|\/>)/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1').replace(/'''?/g, '').replace(/<[^>]+>/g, '').trim();
/** Top-level parameters of the first template whose name matches (nested templates and links kept whole). */
export function templateParams(text, namePattern) {
  const start = text.search(new RegExp(`\\{\\{\\s*${namePattern}`, 'i'));
  if (start < 0) return null;
  let depth = 0, end = start;
  for (let i = start; i < text.length - 1; i += 1) {
    if (text[i] === '{' && text[i + 1] === '{') { depth += 1; i += 1; } else if (text[i] === '}' && text[i + 1] === '}') { depth -= 1; i += 1; if (!depth) { end = i + 1; break; } }
  }
  const body = text.slice(start + 2, end - 2), params = {}, parts = [];
  let level = 0, current = '';
  for (let i = 0; i < body.length; i += 1) {
    const two = body.slice(i, i + 2);
    if (two === '{{' || two === '[[') { level += 1; current += two; i += 1; continue; }
    if (two === '}}' || two === ']]') { level -= 1; current += two; i += 1; continue; }
    if (body[i] === '|' && level === 0) { parts.push(current); current = ''; continue; }
    current += body[i];
  }
  parts.push(current);
  for (const part of parts.slice(1)) { const at = part.indexOf('='); if (at > 0) params[part.slice(0, at).trim().toLowerCase()] = part.slice(at + 1).trim(); }
  return params;
}
/**
 * The NBA capacity in an arena infobox's capacity text (lines split at breaks and bullets): each line belongs to the
 * last sport it or an earlier line names ("Basketball:" headers, "(NBA)", "(hockey)"; college basketball is not the
 * NBA); among the basketball figures the one marked "present", else the first.
 */
export function basketballCapacity(text) {
  let sport = null;
  const figures = [];
  for (const line of String(text).split(/\n|\*|<br\s*\/?>/i)) {
    if (/ncaa|college/i.test(line)) sport = 'other';
    else if (/basketball|\bnba\b/i.test(line)) sport = 'basketball';
    else if (/hockey|concert|football|lacrosse|boxing|wrestling|stage|tennis|soccer/i.test(line)) sport = 'other';
    const figure = /(\d{1,3}(?:,\d{3})+|\d{5})/.exec(line)?.[1];
    if (figure && sport !== 'other') figures.push({ value: Number(figure.replace(/,/g, '')), present: /present/i.test(line), basketball: sport === 'basketball' });
  }
  // A plain figure with no sport named (a basketball arena's single capacity) counts when no basketball figure is given.
  const pool = figures.some(item => item.basketball) ? figures.filter(item => item.basketball) : figures;
  return (pool.find(item => item.present) ?? pool[0])?.value ?? null;
}
/** Players of an NBA roster template ({{player2 | num = | first = | last = | pos = | ft = | in = | lbs = | DOB = | note = TW}}). */
export function nbaRosterPlayers(text) {
  const players = [];
  for (const match of text.matchAll(/\{\{\s*player2\s*\|((?:[^{}]|\{\{[^{}]*\}\})*)\}\}/gi)) {
    const params = {};
    for (const part of match[1].split('|')) { const at = part.indexOf('='); if (at > 0) params[part.slice(0, at).trim().toLowerCase()] = part.slice(at + 1).trim(); }
    const first = strip(params.first), last = strip(params.last);
    const feet = Number(params.ft), inches = Number(params.in), pounds = Number(params.lbs);
    players.push({
      first, last, name: `${first} ${last}`.trim(), number: /^\d{1,2}$/.test(params.num ?? '') ? Number(params.num) : null, group: strip(params.pos).toUpperCase(),
      heightCm: feet ? Math.round((feet * 12 + (inches || 0)) * 2.54) : null, weightKg: pounds ? Math.round(pounds * 0.45359237) : null,
      birthDate: /^\d{4}-\d{2}-\d{2}$/.test(params.dob ?? '') ? params.dob : null, from: strip(params.from) || null, college: strip(params.college) || null,
      twoWay: /\bTW\b/.test(params.note ?? ''), injured: /yes/i.test(params.inj ?? ''), link: params.link ? strip(params.link) : null,
    });
  }
  const footer = templateParams(text, 'NBA roster footer') ?? {};
  const coach = [...String(footer.head_coach ?? '').matchAll(/\[\[([^|\]]+)(?:\|([^\]]+))?\]\]|^\*\s*([^\n[]+)$/gm)].map(match => ({ title: match[1]?.trim() ?? null, name: (match[2] ?? match[1] ?? match[3] ?? '').trim() }))[0] ?? null;
  return { players, coach };
}
const POSITION_WORDS = [[/point guard/i, 'PG'], [/shooting guard/i, 'SG'], [/small forward/i, 'SF'], [/power forward/i, 'PF'], [/\bcent(er|re)\b/i, 'C']];
/** The first exact position listed in a player infobox ("Point guard / shooting guard" -> PG); null for "Guard". */
export function infoboxPosition(text) {
  const params = templateParams(text, 'Infobox basketball biography') ?? {};
  const raw = strip(params.position ?? '');
  const listed = POSITION_WORDS.map(([pattern, position]) => [raw.search(pattern), position]).filter(([at]) => at >= 0).sort((a, b) => a[0] - b[0]).map(([, position]) => position);
  return { position: listed[0] ?? null, listed, text: raw };
}
/**
 * The exact position: the first one the player's article lists (his main position; the roster's G/F/C groups are
 * broader and sometimes older), marked when it lies outside the roster's group; a single-position group (C) without
 * an article gives C.
 */
export function exactPosition(group, info) {
  const fits = GROUP_FIT[group] ?? [];
  if (info.listed?.length) return { position: info.listed[0], how: fits.includes(info.listed[0]) ? 'article' : 'article-outside-group' };
  if (fits.length === 1) return { position: fits[0], how: 'roster' };
  return { position: null, how: 'none' };
}
const GROUP_FIT = { G: ['PG', 'SG'], F: ['SF', 'PF'], C: ['C'], GF: ['SG', 'SF'], FG: ['SG', 'SF'], FC: ['PF', 'C'], CF: ['PF', 'C'] };
/** Roster names the provider writes another way (its own first name), checked by hand against its box scores. */
const NAME_ALIASES = {
  'Nic Claxton': { first: 'Nicolas' }, 'T. J. McConnell': { first: 'Timothy John' }, 'OG Anunoby': { first: 'Ogugua' }, 'Scottie Barnes': { first: 'Scott' },
  'Jakob Pöltl': { last: 'Poeltl' }, 'Mo Bamba': { first: 'Mohamed' }, 'Bub Carrington': { first: 'Carlton' }, 'Dominick Barlow': { first: 'Dominic' }, 'GG Jackson': { first: 'Gregory' },
};
const decodeEntities = text => String(text).replace(/&apos;|&#0?39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"');
const COUNTRY_NAMES = { 'United States of America': 'USA', 'United States': 'USA', 'Kingdom of the Netherlands': 'Netherlands', 'People\'s Republic of China': 'China', 'Democratic Republic of the Congo': 'DR Congo', 'Republic of the Congo': 'Republic of the Congo', 'Türkiye': 'Turkey', 'Czechia': 'Czech Republic', 'Ivory Coast': 'Ivory Coast', 'Côte d\'Ivoire': 'Ivory Coast', 'Georgia': 'Georgia', 'State of Palestine': 'Palestine', 'Bahamas': 'Bahamas', 'The Bahamas': 'Bahamas' };
const countryName = label => COUNTRY_NAMES[label] ?? label;

async function main() {
  const args = process.argv.slice(2), option = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
  const rawDir = option('--raw'), out = option('--out');
  cacheDir = option('--cache');
  if (!rawDir || !out || !cacheDir) throw new Error('Usage: node scripts/real-data-nba.mjs --raw DIR --cache DIR --out FILE');
  mkdirSync(cacheDir, { recursive: true });
  const teams = JSON.parse(readFileSync(join(rawDir, 'teams-2026-2027.json'), 'utf8')).response;
  const division = new Map(Object.entries(NBA_DIVISIONS).flatMap(([conference, divisions]) => Object.entries(divisions).flatMap(([name, list]) => list.map(team => [team, { conference, division: name }]))));
  const totals = nbaSeasonTotals(rawDir);
  // API-Sports players seen at each team: 2026-27 team list, then box-score lines (for matching by name).
  const apiPlayers = new Map();
  const remember = (teamId, id, name, source) => { const list = apiPlayers.get(teamId) ?? new Map(); if (!list.has(String(id))) list.set(String(id), { id: String(id), name, source }); apiPlayers.set(teamId, list); };
  for (const file of readdirSync(join(rawDir, 'rosters'))) { const teamId = Number(file.replace('.json', '')); for (const player of JSON.parse(readFileSync(join(rawDir, 'rosters', file), 'utf8')).response) remember(teamId, player.id, player.name, 'team-list'); }
  const lastTeam = new Map();
  for (const row of [...totals].sort((a, b) => a.season_label.localeCompare(b.season_label))) { remember(row.team_id, row.player_id, row.provider_name, 'box-score'); lastTeam.set(row.player_id, row.team_id); }
  const allApi = new Map();
  for (const list of apiPlayers.values()) for (const player of list.values()) allApi.set(player.id, player);

  const clubs = [], players = [], gaps = [];
  const templateTitle = team => `Template:${team.name} roster`;
  const templates = await pages(teams.map(templateTitle));
  const teamPages = await pages(teams.map(team => team.name));
  // Links in each template (rendered): the players' article titles, with disambiguation.
  const links = new Map();
  for (const team of teams) {
    const body = await api({ action: 'parse', page: templateTitle(team), prop: 'links' });
    links.set(team.id, (body.parse?.links ?? []).filter(link => link.ns === 0 && link.exists).map(link => link.title));
  }
  const arenaTitles = new Map();
  for (const team of teams) {
    const params = templateParams(teamPages.get(team.name)?.text ?? '', 'Infobox basketball club') ?? {};
    const arena = /\[\[([^|\]]+)(?:\|([^\]]+))?\]\]/.exec(params.arena ?? '');
    arenaTitles.set(team.id, arena ? { title: arena[1].trim(), name: (arena[2] ?? arena[1]).trim() } : null);
  }
  const arenaPages = await pages([...new Set([...arenaTitles.values()].filter(Boolean).map(item => item.title))]);
  const rosterOf = new Map(teams.map(team => [team.id, nbaRosterPlayers(templates.get(templateTitle(team))?.text ?? '')]));
  // Player article for each roster entry: a template link whose title starts with the name.
  const plainName = text => fold(text).replace(/\(.*?\)/g, '').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  const articleOf = new Map();
  for (const team of teams) for (const player of rosterOf.get(team.id).players) {
    const want = plainName(player.name), wantSet = want.split(' ').sort().join(' ');
    // Exact, then without a disambiguation, then the same words in another order ("Yang Hansen").
    const title = links.get(team.id).find(link => plainName(link) === want) ?? links.get(team.id).find(link => plainName(link.replace(/\s*\(.*\)$/, '')) === want)
      ?? links.get(team.id).find(link => plainName(link).split(' ').sort().join(' ') === wantSet) ?? null;
    articleOf.set(`${team.id}/${player.name}`, title);
  }
  const playerPages = await pages([...new Set([...articleOf.values()].filter(Boolean))]);
  // Wikidata: citizenship (P27) for players whose roster line names no country.
  const items = [...new Set([...playerPages.values()].map(page => page.item).filter(Boolean))];
  const claims = new Map();
  for (let start = 0; start < items.length; start += 50) {
    const body = await cached(`https://www.wikidata.org/w/api.php?${new URLSearchParams({ action: 'wbgetentities', ids: items.slice(start, start + 50).join('|'), props: 'claims', format: 'json' })}`);
    for (const [id, entity] of Object.entries(body.entities ?? {})) claims.set(id, (entity.claims?.P27 ?? []).filter(claim => claim.rank !== 'deprecated').map(claim => claim.mainsnak?.datavalue?.value?.id).filter(Boolean));
  }
  const countryItems = [...new Set([...claims.values()].flat())];
  const countryLabel = new Map();
  for (let start = 0; start < countryItems.length; start += 50) {
    const body = await cached(`https://www.wikidata.org/w/api.php?${new URLSearchParams({ action: 'wbgetentities', ids: countryItems.slice(start, start + 50).join('|'), props: 'labels', languages: 'en', format: 'json' })}`);
    for (const [id, entity] of Object.entries(body.entities ?? {})) countryLabel.set(id, entity.labels?.en?.value ?? null);
  }

  // Name matching to API-Sports ids: provider names are "Last First" in box scores and "F. Last" in team lists.
  const tokens = text => plainName(decodeEntities(text)).split(' ').filter(word => word && !['jr', 'sr', 'ii', 'iii', 'iv'].includes(word));
  const matchApi = (player, teamId) => {
    const alias = NAME_ALIASES[player.name];
    const first = alias?.first ?? player.first, last = alias?.last ?? player.last;
    const want = tokens(`${first} ${last}`), wantSet = [...want].sort().join(' ');
    const lastWords = tokens(last), initial = tokens(first)[0]?.[0];
    const candidates = (pool) => {
      const full = pool.filter(item => [...tokens(item.name)].sort().join(' ') === wantSet);
      if (full.length) return full;
      return pool.filter(item => { const words = tokens(item.name.replace(/\./g, '. ')); return lastWords.every(word => words.includes(word)) && words.some(word => word[0] === initial && (word.length === 1 || want.includes(word))); });
    };
    const own = candidates([...(apiPlayers.get(teamId)?.values() ?? [])]);
    const boxed = own.filter(item => totals.some(row => row.player_id === item.id));
    if (boxed.length === 1) return { id: boxed[0].id, how: 'team' };
    if (own.length === 1) return { id: own[0].id, how: 'team' };
    const anywhere = candidates([...allApi.values()]).filter(item => totals.some(row => row.player_id === item.id));
    if (anywhere.length === 1) return { id: anywhere[0].id, how: 'league' };
    return { id: null, how: own.length + anywhere.length ? 'ambiguous' : 'none' };
  };

  for (const team of teams) {
    const place = division.get(team.name);
    if (!place) throw new Error(`No division for ${team.name}`);
    const clubUuid = nbaClubUuid(team.id), roster = rosterOf.get(team.id), templateUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(templateTitle(team).replace(/ /g, '_'))}`;
    const teamPage = teamPages.get(team.name), params = templateParams(teamPage?.text ?? '', 'Infobox basketball club') ?? {};
    const colors = [...String(params.colors ?? params.colours ?? '').matchAll(/#([0-9a-f]{6})\b/gi)].map(match => `#${match[1].toLowerCase()}`);
    const arena = arenaTitles.get(team.id), arenaPage = arena ? arenaPages.get(arena.title) : null;
    const arenaParams = arenaPage ? templateParams(arenaPage.text, 'Infobox (?:venue|stadium|building)') ?? {} : {};
    const capacityText = strip(String(arenaParams.capacity ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/\{\{(?:nowrap|small)\|([^{}]*)\}\}/gi, '$1'));
    const capacity = basketballCapacity(capacityText);
    if (!capacity) gaps.push(`${team.name}: no arena capacity read (${arena?.title ?? 'no arena'})`);
    const standard = roster.players.filter(player => !player.twoWay);
    for (const player of roster.players) {
      const title = articleOf.get(`${team.id}/${player.name}`), page = title ? playerPages.get(title) : null;
      const info = page ? infoboxPosition(page.text) : { position: null, listed: [], text: '' };
      const exact = exactPosition(player.group, info), position = exact.position;
      const citizenship = page?.item ? (claims.get(page.item) ?? []).map(id => countryName(countryLabel.get(id))).filter(Boolean) : [];
      const fromCountry = player.from ? countryName(player.from) : null;
      const nationality = fromCountry && (citizenship.includes(fromCountry) || !citizenship.length) ? fromCountry : citizenship.length === 1 ? citizenship[0] : citizenship.includes('USA') && player.college ? 'USA' : citizenship[0] ?? (player.college ? 'USA' : fromCountry);
      const match = matchApi(player, team.id);
      if (!player.twoWay && !match.id) gaps.push(`${team.name}: ${player.name} not found in API-Sports data (${match.how}); rated from his position`);
      if (!player.twoWay && !position) gaps.push(`${team.name}: ${player.name} exact position not read (roster ${player.group}, infobox "${info.text}")`);
      players.push({
        id: addedPlayerId(player.name, player.birthDate), name: player.name, clubId: `club-${clubUuid}`, teamId: team.id, apiPlayerId: match.id, apiMatch: match.how, number: player.number,
        group: player.group, position, positionHow: exact.how, positionText: info.text, heightCm: player.heightCm, weightKg: player.weightKg, birthDate: player.birthDate, nationality, citizenship, twoWay: player.twoWay, injured: player.injured,
        sources: [templateUrl, ...(page ? [`https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`] : []), ...(page?.item && !fromCountry ? [`https://www.wikidata.org/wiki/${page.item}`] : [])],
      });
    }
    clubs.push({
      id: `club-${clubUuid}`, uuid: clubUuid, apiTeamId: team.id, name: team.name, shortName: NBA_SHORT[team.name], country: team.country?.name === 'USA' && team.name !== 'Toronto Raptors' ? 'USA' : 'Canada', city: NBA_CITY[team.name], conference: place.conference, division: place.division,
      arena: arena?.name ?? null, capacity, color: colors[0] ?? null, secondaryColor: colors[1] ?? null, headCoach: roster.coach, standardPlayers: standard.length, twoWayPlayers: roster.players.length - standard.length,
      sources: [templateUrl, `https://en.wikipedia.org/wiki/${encodeURIComponent((teamPage?.title ?? team.name).replace(/ /g, '_'))}`, ...(arenaPage ? [`https://en.wikipedia.org/wiki/${encodeURIComponent(arenaPage.title.replace(/ /g, '_'))}`] : [])],
    });
  }
  // Head coaches: each coach's own article (the same reading as scripts/real-data-coaches.mjs: birth date, nationality,
  // first head-coach season, titles and awards as a head coach).
  const coachPages = await pages([...new Set(clubs.map(club => club.headCoach?.title).filter(Boolean))]);
  for (const club of clubs) {
    const page = club.headCoach?.title ? coachPages.get(club.headCoach.title) : null;
    if (!club.headCoach) { gaps.push(`${club.name}: no head coach in the roster template`); continue; }
    if (!page) { gaps.push(`${club.name}: no article for head coach ${club.headCoach.name}`); continue; }
    const params = templateParams(page.text, 'Infobox basketball biography') ?? {};
    const career = coachingCareer(params), highlights = coachHighlights(params);
    Object.assign(club.headCoach, { article: `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`, born: birthDateOf(params), nationality: statedNationality(params) ?? nationalityOf(params), since: career.firstHeadCoachYear, currentTeam: career.currentTeam, titles: highlights.titles, highlights: highlights.items });
    if (career.currentTeam && !career.currentTeam.includes(club.name.split(' ').at(-1))) gaps.push(`${club.name}: ${club.headCoach.name}'s article names ${career.currentTeam} as his current team`);
  }
  const file = { model: 'nba-data-1', observedOn: new Date().toISOString().slice(0, 10), competition: { id: `competition-${NBA_COMPETITION_UUID}`, uuid: NBA_COMPETITION_UUID, name: 'NBA', country: 'USA', tier: 1, kind: 'domestic', apiLeagueId: 12 }, divisions: NBA_DIVISIONS, clubs, players, totals, gaps };
  writeFileSync(out, `${JSON.stringify(file, null, 1)}\n`);
  console.log(`${clubs.length} clubs, ${players.filter(player => !player.twoWay).length} standard players (${players.filter(player => player.twoWay).length} two-way left out), ${totals.length} season-total rows; ${requests} Wikipedia/Wikidata requests; ${gaps.length} gaps`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error); process.exitCode = 1; });
