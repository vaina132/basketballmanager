#!/usr/bin/env node
/**
 * Real head coaches (owner, 22 November 2026, item E): the head coach of every club in the real pack and of the 24
 * national teams of the World Cup 2027 European Qualifiers' second round, with the facts the game's coach ratings are
 * estimated from (`src/world/coach-ratings.ts`). Source: English Wikipedia (CC BY-SA 4.0); only facts are kept (who
 * coaches which team, birth date, nationality, first season as a head coach, titles won as a head coach), each with
 * its page link. API-Sports has no coach data and is not called. One request at a time, at most one a second, cached.
 *
 *   node scripts/real-data-coaches.mjs --pack PACK.json --people src/data/real-club-people.ts --cache DIR --out COACHES.json
 *
 * 1. Clubs without a head coach in `real-club-people.ts` (clubs playing only in Europe were never searched, some
 *    second-division clubs had no agreeing pages): the club's Wikipedia article (found by a search for the club's
 *    name) gives the infobox head coach, when the article's infobox names the club.
 * 2. National teams: "<Country> men's national basketball team", infobox head coach.
 * 3. Each coach's own article ("Infobox basketball biography"): birth date, nationality, the coaching career
 *    (first head-coach season, the team marked "present") and the career highlights listed under "As head coach".
 *    A coach whose article names another current team is kept with a note; the review decides.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { plain, templateParams } from './real-data-wikipedia-people.mjs';

const WIKI = 'https://en.wikipedia.org';
const AGENT = 'CourtsideGameData/1.0 (basketball game research; one request a second)';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let cacheDir = null, last = 0;

async function get(url, key) {
  const file = path.join(cacheDir, `${key.replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 150)}.txt`);
  if (existsSync(file)) return readFile(file, 'utf8');
  for (let attempt = 1; ; attempt += 1) {
    const wait = 1100 - (Date.now() - last);
    if (wait > 0) await pause(wait);
    last = Date.now();
    const response = await fetch(url, { headers: { 'User-Agent': AGENT }, signal: AbortSignal.timeout(45_000) }).catch(error => ({ ok: false, status: error.message }));
    if (response.ok) { const text = await response.text(); await writeFile(file, text); return text; }
    if (response.status === 404) { await writeFile(file, ''); return ''; }
    if (attempt >= 4) throw new Error(`${url}: ${response.status}`);
    await pause(10_000 * attempt);
  }
}
const raw = async title => {
  for (let seen = 0, current = title; seen < 4; seen += 1) {
    const text = await get(`${WIKI}/w/index.php?title=${encodeURIComponent(current.replace(/ /g, '_'))}&action=raw`, `raw-${current}`);
    const redirect = /^#REDIRECT\s*\[\[([^\]#|]+)/i.exec(text);
    if (!redirect) return text ? { title: current, text } : null;
    current = redirect[1].trim();
  }
  return null;
};
const search = async query => JSON.parse(await get(`${WIKI}/w/api.php?action=query&list=search&format=json&srlimit=6&srsearch=${encodeURIComponent(query)}`, `search-${query}`)).query?.search ?? [];
const fold = text => String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đ]/g, 'd').replace(/[ł]/g, 'l').replace(/ı/g, 'i').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const link = title => `${WIKI}/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;

/** A person's name from an infobox value (one person only). */
function onePerson(value) {
  const name = plain(value).replace(/^\*\s*/, '').replace(/\s*\((?:interim|caretaker|acting)\)\s*$/i, '').trim();
  if (!name || /vacant|n\/a|^-$|\/|,| and | & /i.test(name) || name.split(' ').length > 5) return null;
  return name;
}

const NATIONALITY = {
  spanish: 'Spain', turkish: 'Turkey', greek: 'Greece', italian: 'Italy', french: 'France', german: 'Germany', serbian: 'Serbia', lithuanian: 'Lithuania', croatian: 'Croatia',
  slovenian: 'Slovenia', israeli: 'Israel', american: 'USA', latvian: 'Latvia', montenegrin: 'Montenegro', bosnian: 'Bosnia and Herzegovina', 'bosnian and herzegovinian': 'Bosnia and Herzegovina',
  polish: 'Poland', belgian: 'Belgium', georgian: 'Georgia', portuguese: 'Portugal', ukrainian: 'Ukraine', icelandic: 'Iceland', dutch: 'Netherlands', finnish: 'Finland', hungarian: 'Hungary',
  estonian: 'Estonia', swedish: 'Sweden', czech: 'Czech Republic', slovak: 'Slovakia', bulgarian: 'Bulgaria', romanian: 'Romania', austrian: 'Austria', swiss: 'Switzerland', danish: 'Denmark',
  british: 'United Kingdom', english: 'United Kingdom', argentine: 'Argentina', argentinian: 'Argentina', canadian: 'Canada', australian: 'Australia', macedonian: 'North Macedonia', russian: 'Russia',
  cypriot: 'Cyprus', azerbaijani: 'Azerbaijan', mexican: 'Mexico', brazilian: 'Brazil', puerto: 'Puerto Rico', venezuelan: 'Venezuela', uruguayan: 'Uruguay', norwegian: 'Norway', irish: 'Ireland',
};
/** The nationality the infobox states (its first one), or null. */
function statedNationality(params) {
  const value = fold(plain(params.nationality ?? ''));
  for (const [word, country] of Object.entries(NATIONALITY)) if (value.split(' / ')[0].includes(word)) return country;
  return null;
}
/** The country of the birthplace (a last resort: people born abroad keep another nationality). */
function nationalityOf(params) {
  const parts = plain(params.birth_place ?? '').split(',').map(part => part.trim());
  const countries = new Set(Object.values(NATIONALITY));
  // Former states: the republic named in the birthplace (SR Croatia, PR Serbia, Lithuanian SSR, ...).
  const former = { croatia: 'Croatia', serbia: 'Serbia', slovenia: 'Slovenia', montenegro: 'Montenegro', 'bosnia and herzegovina': 'Bosnia and Herzegovina', macedonia: 'North Macedonia', lithuania: 'Lithuania', lithuanian: 'Lithuania', latvia: 'Latvia', latvian: 'Latvia', estonia: 'Estonia', estonian: 'Estonia', georgia: 'Georgia', georgian: 'Georgia', ukraine: 'Ukraine', ukrainian: 'Ukraine', slovakia: 'Slovakia', czech: 'Czech Republic', 'west germany': 'Germany', 'east germany': 'Germany', 'united states': 'USA', 'u.s.': 'USA' };
  for (const part of [...parts].reverse()) {
    if (countries.has(part)) return part;
    const lower = part.toLowerCase().replace(/^(?:sr|pr|sap|socialist republic of|people's republic of)\s+/, '').replace(/\s+ssr$/, '');
    if (Object.hasOwn(former, lower)) return former[lower];
  }
  return null;
}
function birthDateOf(params) {
  const value = String(params.birth_date ?? '');
  const parts = /\{\{\s*birth[ _]date(?:[ _]and[ _]age)?\s*\|(?:\s*(?:mf|df)\s*=\s*\w+\s*\|)?\s*(\d{4})\s*\|\s*(\d{1,2})\s*\|\s*(\d{1,2})/i.exec(value);
  if (parts) return `${parts[1]}-${parts[2].padStart(2, '0')}-${parts[3].padStart(2, '0')}`;
  const year = /\{\{\s*birth[ _]year(?:[ _]and[ _]age)?\s*\|\s*(\d{4})/i.exec(value) ?? /\b(19[3-9]\d|200\d)\b/.exec(plain(value));
  return year ? year[1] : null;
}

const EUROLEAGUE = /\b(euroleague|euroleague|fiba european champions cup)\b/i;
const OTHER_EUROPE = /\b(eurocup|uleb cup|champions league|fiba europe cup|saporta|korac|korać|eurochallenge|fiba europe league|europe cup)\b/i;
const NATIONAL_TOURNAMENT = /\b(eurobasket|world cup|olympic|fiba world championship|mediterranean games)\b/i;
/**
 * Titles as a head coach: the highlights listed under an "As head coach" (or "As coach") heading, in either the bold
 * or the definition-list (;As coach) form. A list without headings counts only when the person had no playing career
 * in the infobox (else it may be his playing record); coach-of-the-year awards always count.
 */
function coachHighlights(params) {
  const value = String(params.highlights ?? '');
  const lines = value.split('\n').map(line => line.trim());
  const heading = line => /^(?:'{3}|;)\s*(?:\[\[[^\]|]*\|)?\s*as (?:an? )?(head coach|coach|manager|assistant|player)/i.exec(line)?.[1]?.toLowerCase() ?? null;
  const headed = lines.some(line => heading(line));
  const played = !!(params.team1 || params.career_start);
  let section = headed ? 'none' : played ? 'player' : 'coach';
  const titles = { euroleague: 0, europe: 0, league: 0, cup: 0, national: 0, awards: 0 };
  const items = [];
  for (const line of lines) {
    const found = heading(line);
    if (found) { section = found === 'player' ? 'player' : found === 'assistant' ? 'assistant' : 'coach'; continue; }
    if (!line.startsWith('*')) continue;
    const text = plain(line.replace(/^\*+/, ''));
    const count = Number(/^(\d+)\s*[×x]/.exec(text)?.[1] ?? 1);
    const lower = text.toLowerCase();
    if (/coach of the (year|season)|coach award|best coach/.test(lower) && section !== 'assistant') { titles.awards += count; items.push(text); continue; }
    if (section !== 'coach' || /assistant/.test(lower)) continue;
    if (/super ?cup|supercopa|supercoppa|all-star|intercontinental|youth|junior|\bu\d\d\b|under-\d\d|runner-up|finalist|second division|lega ?due|pro ?b\b|leb oro|serie a2|\btbl\b|1\. liga|a2 league|promotion/.test(lower)) continue;
    const won = /champion|winner|\bgold\b|silver|bronze|medal/.test(lower);
    if (!won) continue;
    if (NATIONAL_TOURNAMENT.test(text)) titles.national += /gold/.test(lower) ? count * 1.5 : count;
    else if (EUROLEAGUE.test(text) && !/eurocup|youth|adriatic/i.test(text)) titles.euroleague += count;
    else if (OTHER_EUROPE.test(text)) titles.europe += count;
    else if (/cup|copa|coppa|coupe|pokal|kupa|kupas|trophy/.test(lower)) titles.cup += count;
    else titles.league += count;
    items.push(text);
  }
  return { titles, items };
}
function coachingCareer(params) {
  const teams = [];
  for (let index = 1; index <= 40; index += 1) {
    const years = plain(params[`coach_years${index}`] ?? ''), team = plain(params[`coach_team${index}`] ?? '');
    if (!years && !team) continue;
    teams.push({ years, team });
  }
  const head = teams.filter(item => !/assistant|\(asst|\(youth|\(u\d|\(women|interim\)\s*$/i.test(item.team));
  const firstYear = Number(/(\d{4})/.exec(head[0]?.years ?? plain(params.coach_start ?? ''))?.[1] ?? 0) || null;
  const current = [...teams].reverse().find(item => /present|–\s*$/.test(item.years))?.team ?? null;
  return { teams: teams.map(item => `${item.years} ${item.team}`), firstHeadCoachYear: firstYear, currentTeam: current };
}


/** Wikidata items of the countries coaches come from (citizenship, P27). Former states (Yugoslavia, USSR) are skipped. */
const WIKIDATA_COUNTRIES = {
  Q29: 'Spain', Q43: 'Turkey', Q41: 'Greece', Q38: 'Italy', Q142: 'France', Q183: 'Germany', Q403: 'Serbia', Q37: 'Lithuania', Q224: 'Croatia', Q215: 'Slovenia', Q801: 'Israel',
  Q30: 'USA', Q211: 'Latvia', Q236: 'Montenegro', Q225: 'Bosnia and Herzegovina', Q36: 'Poland', Q31: 'Belgium', Q230: 'Georgia', Q45: 'Portugal', Q212: 'Ukraine', Q189: 'Iceland',
  Q55: 'Netherlands', Q33: 'Finland', Q28: 'Hungary', Q191: 'Estonia', Q34: 'Sweden', Q213: 'Czech Republic', Q214: 'Slovakia', Q219: 'Bulgaria', Q218: 'Romania', Q40: 'Austria',
  Q39: 'Switzerland', Q35: 'Denmark', Q145: 'United Kingdom', Q414: 'Argentina', Q16: 'Canada', Q408: 'Australia', Q221: 'North Macedonia', Q159: 'Russia', Q229: 'Cyprus',
  Q227: 'Azerbaijan', Q96: 'Mexico', Q155: 'Brazil', Q20: 'Norway', Q27: 'Ireland', Q77: 'Uruguay', Q717: 'Venezuela', Q1183: 'Puerto Rico', Q298: 'Chile',
};
/**
 * Wikidata (CC0) for a coach without a usable English article: the first item named like him whose description mentions
 * basketball gives his birth date (P569), citizenship (P27) and the earliest start of a "coach of sports team" (P6087).
 */
async function wikidataFacts(name) {
  const found = JSON.parse(await get(`https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&type=item&limit=8&search=${encodeURIComponent(name)}`, `wd-search-${name}`)).search ?? [];
  const item = found.find(entry => /basketball/i.test(entry.description ?? '') && fold(entry.label ?? '') === fold(name)) ?? found.find(entry => /basketball/i.test(entry.description ?? ''));
  if (!item) return null;
  const data = JSON.parse(await get(`https://www.wikidata.org/wiki/Special:EntityData/${item.id}.json`, `wd-entity-${item.id}`)).entities?.[item.id];
  const claims = data?.claims ?? {};
  const time = claims.P569?.[0]?.mainsnak?.datavalue?.value;
  const born = time ? (time.precision >= 11 ? time.time.slice(1, 11) : time.time.slice(1, 5)) : null;
  const nationality = (claims.P27 ?? []).map(claim => WIKIDATA_COUNTRIES[claim.mainsnak?.datavalue?.value?.id]).find(Boolean) ?? null;
  const starts = (claims.P6087 ?? []).map(claim => Number(claim.qualifiers?.P580?.[0]?.datavalue?.value?.time?.slice(1, 5))).filter(year => year > 1950);
  return { source: `https://www.wikidata.org/wiki/${item.id}`, born, nationality, since: starts.length ? Math.min(...starts) : null };
}


/** The club's country's Wikipedia, for clubs whose English pages name no head coach (Italian, French, Turkish, Czech, Slovak). */
const LOCAL_WIKIS = { Italy: ['it', 'pallacanestro'], France: ['fr', 'basket-ball'], Turkey: ['tr', 'basketbol'], 'Czech Republic': ['cs', 'basketbal'], Slovakia: ['sk', 'basketbal'] };
const COACH_KEYS = /^[ \t]*\|[ \t]*(allenatore|entra[iî]neur|antren[oö]r|ba[sş] antren[oö]r|ko[cç]|tren[eé]r|head_coach|coach)[ \t]*=[ \t]*([^\n]*)$/im;
async function localCoach(club) {
  const local = LOCAL_WIKIS[club.country];
  if (!local) return null;
  const [lang, word] = local, wiki = `https://${lang}.wikipedia.org`;
  const results = JSON.parse(await get(`${wiki}/w/api.php?action=query&list=search&format=json&srlimit=5&srsearch=${encodeURIComponent(`${club.name} ${word}`)}`, `${lang}-search-${club.name}`)).query?.search ?? [];
  const words = fold(club.name).split(' ').filter(item => item.length >= 3);
  for (const result of results.slice(0, 3)) {
    if (!words.some(item => fold(result.title).includes(item))) continue;
    let text = await get(`${wiki}/w/index.php?title=${encodeURIComponent(result.title.replace(/ /g, '_'))}&action=raw`, `${lang}-raw-${result.title}`);
    const redirect = /^#(?:REDIRECT|RINVIA|REDIRECTION|YÖNLENDİRME|PŘESMĚRUJ)\s*\[\[([^\]#|]+)/i.exec(text);
    if (redirect) text = await get(`${wiki}/w/index.php?title=${encodeURIComponent(redirect[1].trim().replace(/ /g, '_'))}&action=raw`, `${lang}-raw-${redirect[1].trim()}`);
    const head = text.split('\n').slice(0, 120).join('\n');
    const match = COACH_KEYS.exec(head);
    const coach = match && !match[2].trim().startsWith('|') && onePerson(match[2]);
    if (coach) return { coach, source: `${wiki}/wiki/${encodeURIComponent(result.title.replace(/ /g, '_'))}` };
  }
  return null;
}

async function coachArticle(name, hint) {
  const exact = await raw(name);
  if (exact && /\{\{\s*infobox basketball biography/i.test(exact.text)) return exact;
  for (const query of [`${name} basketball coach`, `${name} basketball`]) {
    for (const result of await search(query)) {
      if (fold(result.title.replace(/\s*\(.*\)$/, '')) !== fold(name) && !(fold(name).split(' ').every(word => fold(result.title).includes(word)))) continue;
      const page = await raw(result.title);
      if (page && /\{\{\s*infobox basketball biography/i.test(page.text)) return page;
    }
  }
  void hint;
  return null;
}

async function main() {
  const argument = name => { const index = process.argv.indexOf(name); return index > 0 ? process.argv[index + 1] : null; };
  cacheDir = argument('--cache');
  const out = argument('--out');
  if (!argument('--pack') || !argument('--people') || !cacheDir || !out) throw new Error('Usage: --pack PACK.json --people real-club-people.ts --cache DIR --out COACHES.json');
  await mkdir(cacheDir, { recursive: true });
  const envelope = JSON.parse(await readFile(argument('--pack'), 'utf8')), pack = envelope.pack ?? envelope;
  const peopleText = await readFile(argument('--people'), 'utf8');
  const known = new Map([...peopleText.matchAll(/clubId: "([^"]+)"[^}]*role: "head-coach", name: "([^"]+)"[^}]*source: "([^"]+)"/g)].map(match => [match[1], { name: match[2], source: match[3] }]));
  const competitionsOf = new Map();
  for (const competition of pack.competitions) for (const id of competition.clubIds) competitionsOf.set(id, [...(competitionsOf.get(id) ?? []), competition.name]);
  const result = { source: WIKI, license: 'CC BY-SA 4.0 (facts only, with page links)', fetchedOn: new Date().toISOString().slice(0, 10), teams: [], coaches: [] };

  for (const club of pack.clubs) {
    const entry = { kind: 'club', id: club.id, name: club.name, country: club.country, competitions: competitionsOf.get(club.id) ?? [], coach: null, source: null, notes: [] };
    const listed = known.get(club.id);
    if (listed) { entry.coach = listed.name; entry.source = listed.source; result.teams.push(entry); continue; }
    try {
      const candidates = await search(`${club.name} ${club.country} basketball club`);
      for (const candidate of candidates.slice(0, 4)) {
        if (!/basket|bc |b\.c\.|k\.k\.|kk |bk |club/i.test(`${candidate.title} ${candidate.snippet}`)) continue;
        const page = await raw(candidate.title);
        const info = page && templateParams(page.text, 'Infobox basketball club');
        if (!info) continue;
        const words = fold(club.name).split(' ').filter(word => word.length >= 3);
        const named = fold(`${plain(info.name ?? '')} ${page.title} ${plain(info.nickname ?? '')}`);
        if (!words.some(word => named.includes(word))) continue;
        const coach = onePerson(info.coach ?? info.head_coach ?? '');
        if (coach) { entry.coach = coach; entry.source = link(page.title); entry.notes.push(`club article ${page.title}`); }
        else entry.notes.push(`club article ${page.title} names no single head coach`);
        break;
      }
      // The club's own country's Wikipedia when the English pages name no head coach.
      if (!entry.coach && !/\s(?:II|III|B|2)$/u.test(club.name)) {
        const local = await localCoach(club);
        if (local) { entry.coach = local.coach; entry.source = local.source; entry.notes.push('local Wikipedia'); }
      }
    } catch (error) { entry.notes.push(String(error.message ?? error)); }
    result.teams.push(entry);
    console.log(`${club.name}: ${entry.coach ?? '-'} ${entry.notes.join('; ')}`);
  }

  const nationsText = await readFile(path.join(path.dirname(argument('--people')), 'national-teams.ts'), 'utf8');
  for (const match of nationsText.matchAll(/team\('([^']+)', '([^']+)', '([A-Z]{3})'/g)) {
    const [, country, , short] = match;
    const entry = { kind: 'national', id: `nation-${short.toLowerCase()}`, name: country, country, competitions: [], coach: null, source: null, notes: [] };
    const page = await raw(`${country} men's national basketball team`);
    const info = page && (templateParams(page.text, 'Infobox national basketball team') ?? templateParams(page.text, 'Infobox basketball team'));
    const coach = info && onePerson(info.coach ?? info.head_coach ?? '');
    if (coach) { entry.coach = coach; entry.source = link(page.title); } else entry.notes.push('no single head coach in the infobox');
    result.teams.push(entry);
    console.log(`${country}: ${entry.coach ?? '-'}`);
  }

  const names = [...new Set(result.teams.map(team => team.coach).filter(Boolean))];
  for (const name of names) {
    const coach = { name, article: null, birthDate: null, nationality: null, firstHeadCoachYear: null, currentTeam: null, titles: null, highlights: [], career: [], notes: [] };
    try {
      const page = await coachArticle(name);
      if (page) {
        const params = templateParams(page.text, 'Infobox basketball biography');
        const career = coachingCareer(params), highlights = coachHighlights(params);
        Object.assign(coach, { article: link(page.title), birthDate: birthDateOf(params), nationality: statedNationality(params), birthplaceNationality: nationalityOf(params), firstHeadCoachYear: career.firstHeadCoachYear, currentTeam: career.currentTeam, titles: highlights.titles, highlights: highlights.items, career: career.teams });
      } else coach.notes.push('no article with a basketball biography found');
      // Wikidata fills a missing birth date, nationality or first coaching season.
      if (!coach.birthDate || !coach.nationality || !coach.firstHeadCoachYear) {
        const data = await wikidataFacts(name);
        if (data) {
          coach.birthDate ??= data.born; coach.nationality ??= data.nationality; coach.firstHeadCoachYear ??= data.since;
          coach.wikidata = data.source;
        }
      }
      // Nationality: the infobox's stated one, then Wikidata's citizenship, then the birthplace.
      coach.nationality ??= coach.birthplaceNationality ?? null;
      delete coach.birthplaceNationality;
    } catch (error) { coach.notes.push(String(error.message ?? error)); }
    result.coaches.push(coach);
    console.log(`${name}: ${coach.birthDate ?? '?'} ${coach.nationality ?? '?'} since ${coach.firstHeadCoachYear ?? '?'} now ${coach.currentTeam ?? '?'} ${JSON.stringify(coach.titles)}`);
  }
  await writeFile(out, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`teams ${result.teams.length}, with a coach ${result.teams.filter(team => team.coach).length}; coaches ${result.coaches.length}, with an article ${result.coaches.filter(coach => coach.article).length}`);
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main().catch(error => { console.error(error.message); process.exitCode = 1; });
