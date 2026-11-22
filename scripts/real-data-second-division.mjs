#!/usr/bin/env node
/**
 * Current 2026-27 rosters for the clubs that kept their old squads in world-8 (22 November 2026): the Türkiye
 * Basketbol Ligi and Élite 2 clubs, Bursaspor, Çayırova, AS Monaco and six BCL clubs. Free public pages only, read
 * politely (one request a second, a generic User-Agent) and cached, so a rerun reads the cache and fetches nothing:
 *
 * - the FIBA Europe Cup team pages for the six BCL clubs (all six play there this season; players still on the
 *   final roster only; FIBA's footer reserves its content, kept like the BCL positions, decisions.md 21 November 2026);
 * - the clubs' own roster pages (Élite 2; the league's lnb.fr data API needs a login and is not used);
 * - for four Élite 2 clubs without a readable club roster (world-10, 22 November 2026), the public lnb.fr team page's
 *   "Effectif" tab, rendered in Chromium (Playwright; PLAYWRIGHT_MODULE=<path to an installed playwright package>);
 * - Wikipedia roster sections that name the 2026-27 season or carry a 2026 access date (CC BY-SA 4.0, facts only).
 *
 * tbf.org.tr refuses automated access; the Turkish clubs without a current page stay uncovered (listed in the output).
 *
 *   node scripts/real-data-second-division.mjs --pack PACK.json --cache DIR --out DIR [--clubs "A,B"] \
 *     [--batch-prefix NAME] [--offline]
 *
 * --clubs limits the run to those CLUB_SOURCES clubs (a follow-up batch over a newer pack); --batch-prefix names the
 * batch (default second-division, giving second-division-<date>).
 *
 * Writes DIR/clubs/<club>.json (players, labels, source links), DIR/rosters-second-division.json (the input shape of
 * scripts/real-data-current-squads.mjs), DIR/coverage.json (clubs covered and not covered, with the reason),
 * DIR/corrections-second-division-<date>.json (rows for import-profile-overrides: moves, leavers, added players with
 * estimated abilities, positions; not imported here) and DIR/review.json (the same as lists, for the owner).
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentSquads } from './real-data-current-squads.mjs';
import { profileOverrides, rosterPosition, GROUP_POSITIONS, COMMUNITY_SOURCES, nameTokens } from './real-data-official-profiles.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const fold = text => String(text ?? '').normalize('NFKD').replace(/\p{M}/gu, '').replace(/ı/g, 'i').toLowerCase().trim();
const ENTITIES = { amp: '&', apos: "'", quot: '"', lt: '<', gt: '>', nbsp: ' ', rsquo: '’', ndash: '–', eacute: 'é', egrave: 'è', ccedil: 'ç' };

/** HTML as trimmed text lines (one block element per line). */
export function htmlLines(html) {
  return html.replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h\d|td|th|span|a|dt|dd|figcaption|section|article|option)>/gi, '$&\n').replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code))).replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (all, name) => ENTITIES[name.toLowerCase()] ?? all)
    .split('\n').map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/** "MOSENGO-MASA" -> "Mosengo-Masa"; mixed-case words stay as written. */
export const titleCase = name => name.split(' ').map(word => /^(II|III|IV|JR\.?)$/i.test(word) ? (/^j/i.test(word) ? 'Jr' : word.toUpperCase()) : word.length > 1 && word === word.toUpperCase() && /\p{Lu}/u.test(word) ? word.toLowerCase().replace(/(^|[-'’])\p{L}/gu, letter => letter.toUpperCase()) : word).join(' ');

const WORDS = [
  [/^(point guard|meneurs?|oyun kurucu|pg|1)$/, 'PG'], [/^(shooting guard|arrieres?|sutor|sg|2)$/, 'SG'], [/^(small forward|ailier|ailiers|kisa forvet|sf|3)$/, 'SF'],
  [/^(power forward|ailier[ -]fort|ailiers[ -]forts|uzun forvet|pf|4)$/, 'PF'], [/^(center|centre|pivot|pivots|c|5)$/, 'C'],
  [/^(interieur|interieurs)$/, 'PF/C'], [/^(guard|g)$/, 'G'], [/^(forward|f)$/, 'F'], [/^(fc)$/, 'PF/C'], [/^(gf)$/, 'SG/SF'],
];
/**
 * A roster label as position codes: one exact code (PG/SG/SF/PF/C), a broad G or F, or several codes joined with "/"
 * ("Poste 2/3" -> "SG/SF", "Arrière / Meneur (2-1)" -> "SG/PG"). Unknown or placeholder labels give null.
 */
export function positionCode(label) {
  let text = fold(label).replace(/^poste\s*:?\s*/, '');
  if (!text || text === 'x' || text === 'null') return null;
  const digits = /\(([\d\s/-]+)\)\s*$/.exec(text)?.[1] ?? /^([\d\s/-]+)(\s+-\s+.*)?$/.exec(text)?.[1];
  const parts = digits ? digits.split(/[\s/-]+/).filter(Boolean) : text.replace(/\s*\(.*\)\s*$/, '').split(/\s*\/\s*|\s+-\s+/).filter(Boolean);
  const codes = [];
  for (const part of parts) {
    const found = WORDS.find(([pattern]) => pattern.test(part.trim()))?.[1];
    if (!found) return null;
    for (const code of found.split('/')) if (!codes.includes(code)) codes.push(code);
  }
  return codes.length ? codes.join('/') : null;
}

/** FIBA three-letter codes and country names in the pack's spelling. */
const COUNTRIES = { USA: 'USA', FRA: 'France', TUR: 'Turkey', GBR: 'United Kingdom', ENG: 'England', LAT: 'Latvia', GEO: 'Georgia', AUT: 'Austria', SUI: 'Switzerland', SWI: 'Switzerland', BUL: 'Bulgaria', SRB: 'Serbia', SER: 'Serbia', CRO: 'Croatia', SLO: 'Slovenia', SWE: 'Sweden', GER: 'Germany', CAN: 'Canada', NGR: 'Nigeria', GRE: 'Greece', PAN: 'Panama', CIV: 'Ivory Coast', CMR: 'Cameroon', SEN: 'Senegal', MLI: 'Mali', COD: 'DR Congo', JAM: 'Jamaica', BRB: 'Barbados', LTU: 'Lithuania', LIT: 'Lithuania', EST: 'Estonia', ITA: 'Italy', ESP: 'Spain', SPA: 'Spain', BEL: 'Belgium', NED: 'Netherlands', POR: 'Portugal', MNE: 'Montenegro', BIH: 'Bosnia and Herzegovina', MKD: 'North Macedonia', FIN: 'Finland', DEN: 'Denmark', ISR: 'Israel', AUS: 'Australia', HAI: 'Haiti', GUI: 'Guinea', DOM: 'Dominican Republic', BRA: 'Brazil', ARG: 'Argentina', CPV: 'Cape Verde', ANG: 'Angola', CAF: 'Central African Republic', MAR: 'Morocco', TUN: 'Tunisia', ALG: 'Algeria', RUS: 'Russia', UKR: 'Ukraine', POL: 'Poland', CZE: 'Czech Republic', SVK: 'Slovakia', HUN: 'Hungary', ROU: 'Romania', MEX: 'Mexico', PUR: 'Puerto Rico', BAH: 'Bahamas', NZL: 'New Zealand', Croatie: 'Croatia', Jamaïque: 'Jamaica', 'États-Unis': 'USA', Sénégal: 'Senegal' };
const country = value => value ? COUNTRIES[value] ?? COUNTRIES[String(value).toUpperCase()] ?? (/^[A-Z][a-z]/.test(value) && value.length > 3 ? value : null) : null;

// ----- Parsers: each returns [{ name, number, label, nationality?, birthDate?, heightCm? }] from the fetched pages.

/** FIBA team page: the players' records embedded in the page data; only those still on the final roster. */
function fibaEuropeCup(pages) {
  const text = pages[0].text.replace(/\\"/g, '"'), rows = [], seen = new Set(), dropped = [];
  const starts = [...text.matchAll(/"firstName":"([^"]*)","lastName":"([^"]*)"/g)];
  starts.forEach((match, index) => {
    const window = text.slice(match.index, Math.min(starts[index + 1]?.index ?? text.length, match.index + 2500));
    const value = key => { const found = new RegExp(`"${key}":("([^"]*)"|true|false|null|-?\\d+)`).exec(window); return found ? found[2] ?? JSON.parse(found[1]) : undefined; };
    const name = `${match[1]} ${match[2]}`.trim();
    if (value('clubName') === undefined || seen.has(name)) return; // coaches and repeated cards
    seen.add(name);
    if (value('isOnFinalRoster') !== true) { dropped.push(name); return; }
    const height = value('heightInCm'), born = value('dateOfBirth');
    rows.push({ name, number: /^\d{1,2}$/.test(String(value('uniformNumber'))) ? Number(value('uniformNumber')) : null, label: value('position') ?? null, nationality: value('nationality') ?? null, ...(typeof born === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(born) ? { birthDate: born } : {}), ...(height >= 150 && height <= 240 ? { heightCm: height } : {}) });
  });
  return { players: rows, note: dropped.length ? `not on the final roster (left out): ${dropped.join(', ')}` : undefined };
}

const stripWiki = text => String(text ?? '').replace(/<ref[\s\S]*?(<\/ref>|\/>)/g, '').replace(/\{\{(Cap|Blessure|Capitaine)\}\}/gi, '').replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1').replace(/\{\{Lien\|(?:[^{}]*\|)?fr=([^|}]*)[^{}]*\}\}/gi, '$1').replace(/\{\{[^{}]*\}\}/g, '').replace(/'''?/g, '').replace(/<[^>]+>/g, '').replace(/\(c\)|\(E\)/gi, '').replace(/\s+/g, ' ').trim();

/** English Wikipedia {{player3 …}} templates in the page's current-roster section. */
function wikipediaPlayer3(pages) {
  const source = JSON.parse(pages[0].text).source ?? '';
  const rows = [];
  for (const match of source.matchAll(/\{\{\s*player\d?\s*\|((?:[^{}]|\{\{[^{}]*\}\})*)\}\}/gi)) {
    const params = {};
    for (const part of match[1].split('|')) { const at = part.indexOf('='); if (at > 0) params[part.slice(0, at).trim().toLowerCase()] = part.slice(at + 1).trim(); }
    const name = params.first || params.last ? `${stripWiki(params.first)} ${stripWiki(params.last)}`.trim() : stripWiki(params.name);
    if (!name) continue;
    const height = Number(String(params.m ?? '').replace(',', '.')), [year, month, day] = [params.year, params.month, params.date ?? params.day];
    rows.push({ name, number: /^\d{1,2}$/.test(params.num ?? '') ? Number(params.num) : null, label: stripWiki(params.pos) || null, nationality: params.nat ?? null, ...(height >= 1.5 && height <= 2.4 ? { heightCm: Math.round(height * 100) } : {}), ...(/^\d{4}$/.test(year ?? '') && /^\d{1,2}$/.test(month ?? '') && /^\d{1,2}$/.test(day ?? '') ? { birthDate: `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}` } : {}) });
  }
  return { players: rows };
}

/** French Wikipedia roster table under the given heading: rows of Poste | Numéro | Nationalité | Nom | Taille | Âge. */
function wikipediaFrTable(pages, { heading }) {
  const source = JSON.parse(pages[0].text).source ?? '';
  const at = source.indexOf(heading);
  if (at < 0) return { players: [] };
  const table = source.slice(at, source.indexOf('\n|}', source.indexOf('{| class="wikitable sortable"', at)) + 3);
  const rows = [];
  for (const block of table.split(/\n\|-[^\n]*/).slice(1)) {
    const cells = block.split(/\n\||\|\|/).map(cell => cell.replace(/^[^|]*align="center"\s*\|/, '').trim()).filter(cell => cell !== '');
    if (cells.length < 4) continue;
    const [label, number, nat, name, height] = cells;
    const flag = /\{\{([A-Z]{3})-d/.exec(nat)?.[1];
    rows.push({ name: stripWiki(name), number: /^\d{1,2}$/.test(number) ? Number(number) : null, label, nationality: flag ?? null, ...(/^[12][.,]\d{2}/.test(height ?? '') ? { heightCm: Math.round(Number(height.replace(',', '.').replace(/\s*m$/, '')) * 100) } : {}) });
  }
  return { players: rows.filter(row => row.name) };
}

/**
 * lnb.fr team page, "Effectif" tab, as text rendered in a browser (the page draws the roster with scripts): blocks of
 * number | NAME | "4/5 - Ailier fort/Pivot" | "Taille - 201" | "Âge - 27" | PPM | value | RPM | value | PdPM | value |
 * EFF | value | "VOIR LE PROFIL". The list is the league's registration list for the season, young players registered
 * as cover included; `played` is false for a player without a single point, rebound, assist or rating this season.
 */
function lnbRoster(pages) {
  const lines = pages[0].text.split('\n').map(line => line.trim()).filter(Boolean);
  const from = lines.indexOf('STATISTIQUES'), to = lines.indexOf('STAFF TECHNIQUE');
  const part = lines.slice(from + 1, to > from ? to : undefined), rows = [];
  part.forEach((line, index) => {
    const label = part[index + 2] ?? '';
    if (!/^\d{1,2}$/.test(line) || !/^\d[\d/]*\s+-\s+/.test(label) || !/^Taille\b/.test(part[index + 3] ?? '')) return;
    const stats = [];
    for (let at = index + 5; at < part.length && part[at] !== 'VOIR LE PROFIL'; at += 1) if (/^-?\d+(\.\d+)?$/.test(part[at])) stats.push(Number(part[at]));
    const height = Number(/(\d{3})/.exec(part[index + 3])?.[1]);
    rows.push({ name: titleCase(part[index + 1]), number: Number(line), label, played: stats.some(value => value !== 0), ...(height >= 160 && height <= 240 ? { heightCm: height } : {}) });
  });
  return { players: rows };
}

/** Lines between a start and an end marker. */
const between = (lines, start, end) => { const from = lines.findIndex(line => start.test(line)); if (from < 0) return []; const rest = lines.slice(from + 1); const to = rest.findIndex(line => end.test(line)); return to < 0 ? rest : rest.slice(0, to); };

const SITE_PARSERS = {
  /** Poitiers: the 26/27 tab of the roster, then each player's page ("#0 | Keaston | WILLIS | Meneur"). */
  pb86(pages) {
    const html = pages[0].text, at = html.indexOf('data-saison="26/27"'), end = html.indexOf('data-saison=', at + 20);
    const part = html.slice(at, end > 0 ? end : undefined);
    const slugs = [...new Set([...part.matchAll(/href="\/joueur\/([a-z0-9-]+)"[^>]*title="Voir le profil de ([^"]+)"/g)].map(match => `${match[1]}|${match[2]}`))];
    return { players: slugs.map(item => {
      const [slug, name] = item.split('|'), page = pages.find(entry => entry.url.endsWith(`/joueur/${slug}`));
      const lines = page ? htmlLines(page.text) : [], index = lines.findIndex(line => /^#\d{1,2}$/.test(line));
      const flag = new RegExp(`alt="${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}">\\s*<div class="info">\\s*<h2>[^<]*</h2>\\s*<img[^>]*alt="([^"]+)"`).exec(part)?.[1];
      return { name: titleCase(name.replace(/&#0?39;/g, "'")), number: index >= 0 ? Number(lines[index].slice(1)) : null, label: index >= 0 ? lines[index + 3] : null, nationality: flag ?? null };
    }) };
  },
  /** Nantes: "3 Marcus Gomis" lines after "Effectif 2026 - 2027". */
  nantes(pages) {
    return { players: between(htmlLines(pages[0].text), /^Effectif 2026\s*-\s*2027$/, /^Coach\b/).map(line => /^(\d{1,2})\s+(.+)$/.exec(line)).filter(Boolean).map(match => ({ name: match[2], number: Number(match[1]), label: null })) };
  },
  /** Blois: First | LAST | #N | height | Poste N. */
  ada(pages) {
    const lines = between(htmlLines(pages[0].text), /^Joueurs$/, /^Staff$/), rows = [];
    lines.forEach((line, index) => { if (/^Poste [\d/]+$/.test(line)) rows.push({ name: titleCase(`${lines[index - 4]} ${lines[index - 3]}`), number: Number(lines[index - 2].replace('#', '')) || null, label: line, heightCm: Math.round(Number(lines[index - 1].toLowerCase().replace('m', '.')) * 100) || undefined }); });
    return { players: rows };
  },
  /** Quimper: #N | #LAST | First | position. */
  quimper(pages) {
    const lines = htmlLines(pages[0].text), rows = [];
    lines.forEach((line, index) => { if (/^#\d{1,2}$/.test(line) && /^#\p{L}/u.test(lines[index + 1] ?? '') && positionCode(lines[index + 3])) rows.push({ name: titleCase(`${lines[index + 2]} ${lines[index + 1].slice(1)}`), number: Number(line.slice(1)), label: lines[index + 3] }); });
    return { players: rows };
  },
  /** Évreux: #N | Name | label (digits) | Informations. */
  evreux(pages) {
    const lines = htmlLines(pages[0].text), rows = [];
    lines.forEach((line, index) => { if (/^#\d{1,2}$/.test(line) && lines[index + 3] === 'Informations') rows.push({ name: titleCase(lines[index + 1]), number: Number(line.slice(1)), label: lines[index + 2] }); });
    return { players: rows };
  },
  /** Champagne Basket: label | LAST | First | N | Moyenne par match. */
  champagne(pages) {
    const lines = htmlLines(pages[0].text), rows = [];
    lines.forEach((line, index) => { if (/^\d{1,2}$/.test(line) && lines[index + 1] === 'Moyenne par match') rows.push({ name: titleCase(`${lines[index - 1]} ${lines[index - 2]}`), number: Number(line), label: lines[index - 3] }); });
    return { players: rows };
  },
  /** Stade Rochelais: the whole roster, then one page per position (poste-1 … poste-5). */
  rochelais(pages) {
    const names = page => between(htmlLines(page.text), /^Poste 5$/, /^#$/).filter(line => !/^(Tous|Poste \d)$/.test(line));
    const all = names(pages[0]), label = new Map();
    for (const page of pages.slice(1)) for (const name of names(page)) label.set(name, `Poste ${page.url.slice(-1)}`);
    return { players: all.map(name => ({ name: titleCase(name), number: null, label: label.get(name) ?? null })) };
  },
  /** Rouen: Name | Poste : | N | Numéro : | N | Taille : | 1.80m. */
  rouen(pages) {
    const lines = htmlLines(pages[0].text), rows = [];
    lines.forEach((line, index) => { if (line === 'Poste :' && lines[index + 2] === 'Numéro :') rows.push({ name: lines[index - 1], number: /^\d{1,2}$/.test(lines[index + 3]) ? Number(lines[index + 3]) : null, label: lines[index + 1], heightCm: Math.round(Number(lines[index + 5]?.replace('m', '')) * 100) || undefined }); });
    return { players: rows };
  },
  /** Alliance Sport Alsace: N | Poste X | N | Name. */
  asa(pages) {
    const lines = between(htmlLines(pages[0].text), /^Les joueurs$/, /^Staff$/), rows = [];
    lines.forEach((line, index) => { if (/^Poste [\d/]+$/.test(line) && lines[index + 1] === lines[index - 1]) rows.push({ name: lines[index + 2], number: /^\d{1,2}$/.test(lines[index - 1]) && lines[index - 1] !== '00' ? Number(lines[index - 1]) : lines[index - 1] === '00' ? 0 : null, label: line }); });
    return { players: rows };
  },
  /** Denain: Name | Poste X (no position given). */
  denain(pages) {
    const lines = htmlLines(pages[0].text), rows = [];
    lines.forEach((line, index) => { if (line === 'Poste X' && lines[index - 1] !== 'Fiche du joueur' && !/^Poste/.test(lines[index - 1])) rows.push({ name: titleCase(lines[index - 1]), number: null, label: null }); });
    return { players: rows };
  },
  /** Hyères-Toulon: N | N | First | LAST | Country (no position given). */
  htv(pages) {
    const lines = between(htmlLines(pages[0].text), /^Equipe première Élite 2$/, /^équipe première$/), rows = [];
    lines.forEach((line, index) => { if (/^\d{1,2}$/.test(line) && lines[index + 1] === line && /^\p{L}/u.test(lines[index + 2] ?? '')) rows.push({ name: titleCase(`${lines[index + 2]} ${lines[index + 3]}`), number: Number(line), label: null, nationality: lines[index + 4] }); });
    return { players: rows };
  },
  /** Vichy: grouped list ("MENEURS - ARRIÈRES", "AILIERS", "INTÉRIEURS"), "#3 – Elian BENITEZ". */
  vichy(pages) {
    const lines = between(htmlLines(pages[0].text), /^MENEURS - ARRIÈRES$/, /^STAFF$/), rows = [];
    let group = 'Meneurs - Arrières';
    for (const line of [lines.length ? 'MENEURS - ARRIÈRES' : '', ...lines]) {
      if (/^(MENEURS - ARRIÈRES|AILIERS|INTÉRIEURS)$/.test(line)) { group = line; continue; }
      const match = /^#\s*(\d{1,2})\s*[–-]\s*(.+?)(\s*\(\s*C\s*\))?$/.exec(line);
      if (match) rows.push({ name: titleCase(match[2]), number: Number(match[1]), label: group });
    }
    return { players: rows };
  },
};

/**
 * An Élite 2 club's lnb.fr registration list (added 22 November 2026, world-10, for the four clubs whose own sites had
 * no readable current roster). Rendered in a browser (`render`); young players registered as cover who have not
 * played this season, are not in the pack and are not on the club's own roster (`alsoListed`) are left out
 * (`newcomersMustHavePlayed`), so a squad does not fill up with juniors who never take the court.
 */
const lnbSource = tid => ({ sourceName: 'lnb.fr', parser: 'lnbRoster', render: true, newcomersMustHavePlayed: true, pages: [`https://lnb.fr/fr/teams/details?tid=${tid}&did=2&ca=PROB&yid=2026&cid=318&clid=31&tab=roster`] });

/**
 * Clubs and their current-roster pages. `pages` are fetched in order; `parser` reads them. Clubs with no usable page
 * carry `none` (the reason).
 */
export const CLUB_SOURCES = [
  // Six BCL clubs, all in the FIBA Europe Cup 2026-27.
  ...[['Rilski Sportist', 'rilski-sportist'], ['Batumi', 'bc-batumi-2010'], ['VEF Riga', 'vef-riga'], ['BC Vienna', 'bc-vienna'], ['Geneva Lions', 'lions-de-geneve'], ['Manchester Basketball', 'manchester-basketball']]
    .map(([club, slug]) => ({ club, sourceName: 'fiba.basketball', parser: 'fibaEuropeCup', pages: [`https://www.fiba.basketball/en/events/fiba-europe-cup-26-27/teams/${slug}`] })),
  { club: 'AS Monaco', none: 'No team this season: the federation refused AS Monaco a place in Betclic Élite on 1 August 2026 and the club is not in the EuroCup 2026-27 club list (EuroLeague site); French Wikipedia still shows 2025-26.' },
  { club: 'Bursaspor', sourceName: 'en.wikipedia.org', parser: 'wikipediaPlayer3', pages: ['https://en.wikipedia.org/w/rest.php/v1/page/Bursaspor_Basketbol'], note: 'Roster template access date 21 November 2026.' },
  { club: 'Çayırova Belediyesi', none: 'No current roster page (no club site; Wikipedia lists no 2026-27 players; tbf.org.tr refuses automated access; RealGM and Proballers ask AI agents not to read them). The squad already matches the club\'s 2026-27 box scores (beinsports.com.tr summaries of 23 October and 2 November 2026; English Wikipedia season page): kept as it is.' },
  // Élite 2.
  { club: 'Poitiers Basket 86', sourceName: 'pb86.fr', parser: 'pb86', pages: ['https://www.pb86.fr/effectif-elite-2-2/', ...['keaston-willis', 'matthys-mahop', 'imanol-prot', 'kevin-harley', 'jordan-ratton', 'keny-vado', 'christopher-dauby', 'isaac-guedegbe', 'noel-brown', 'ivan-ramljak'].map(slug => `https://www.pb86.fr/joueur/${slug}`)] },
  { club: 'ASA', sourceName: 'asa-basket.fr', parser: 'asa', pages: ['https://www.asa-basket.fr/pages/lequipe-elite-2'] },
  { club: 'Denain Voltaire', sourceName: 'denain-voltaire.fr', parser: 'denain', pages: ['https://www.denain-voltaire.fr/equipe/'], note: 'Names only: the page shows "Poste X" for every player.' },
  { club: 'Hermine Nantes', sourceName: 'nantes-basket.com', parser: 'nantes', pages: ['https://www.nantes-basket.com/equipe/effectif/'], note: 'Names and numbers only.' },
  { club: 'Hyères-Toulon', sourceName: 'htv-basket.fr', parser: 'htv', pages: ['https://www.htv-basket.fr/fr/equipe-premiere/effectif'], note: 'Names, numbers and nationalities only.' },
  { club: 'ADA Blois', sourceName: 'ada-basket.com', parser: 'ada', pages: ['https://ada-basket.com/equipe-pro/effectif/'] },
  { club: 'Fos Provence', ...lnbSource(1930), note: 'League registration list read in a browser (the club site\'s roster page still shows 2025-26; its news names the same signings).' },
  { club: 'Aix Maurienne', ...lnbSource(1874), alsoListed: ['Romain Hoeltzel'], note: 'League registration list read in a browser; the club\'s 2026-27 roster picture (amsb.pro/lequipe-pro) shows ten of them, Romain Hoeltzel included.' },
  { club: 'Caen Basket Calvados', sourceName: 'fr.wikipedia.org', parser: 'wikipediaFrTable', options: { heading: 'Effectif 2026-2027' }, pages: ['https://fr.wikipedia.org/w/rest.php/v1/page/Caen_Basket_Calvados'], note: 'Section "Effectif 2026-2027" (the club domain no longer belongs to the club).' },
  { club: 'UJAP Quimper', sourceName: 'beliersdekemper.bzh', parser: 'quimper', pages: ['https://www.beliersdekemper.bzh/effectif-elite2-2026-2027-2/'] },
  { club: 'STB Le Havre', ...lnbSource(1884), note: 'League registration list read in a browser; the same ten senior players as the club\'s 2026-27 poster (stblehavre.com/effectif-nm1).' },
  { club: 'ALM Évreux', sourceName: 'alm-evreux-basket.com', parser: 'evreux', pages: ['https://alm-evreux-basket.com/effectif-pro-elite/'] },
  { club: 'Rouen Métropole', sourceName: 'rouenmetrobasket.com', parser: 'rouen', pages: ['https://www.rouenmetrobasket.com/le-groupe-professionnel/'] },
  { club: 'Saint-Chamond', ...lnbSource(1891), note: 'League registration list read in a browser (the club plays as SCABB Saint-Étienne Métropole; its site has no roster page).' },
  { club: 'JA Vichy', sourceName: 'jav-basket.pro', parser: 'vichy', pages: ['https://www.jav-basket.pro/effectif/'], note: 'Grouped positions only: guards, wings (ailiers), inside players (intérieurs).' },
  { club: 'Champagne Basket', sourceName: 'champagne-basket.fr', parser: 'champagne', pages: ['https://champagne-basket.fr/saison/equipe-pro-2026-2027/effectif'] },
  { club: 'Stade Rochelais', sourceName: 'basket.staderochelais.com', parser: 'rochelais', pages: ['https://basket.staderochelais.com/les-equipes/elite-2/effectif', ...[1, 2, 3, 4, 5].map(post => `https://basket.staderochelais.com/les-equipes/elite-2/effectif/poste-${post}`)] },
  // Türkiye Basketbol Ligi: no free current source for these clubs.
  ...['Kahramanmaraş', 'iLab Basketbol', 'Keçiören Bağlum', 'TED Ankara Kolejliler', 'Balıkesir', 'Göztepe', 'Konya BBSK', 'Final Spor', 'Fenerbahçe II', 'CO Basket', 'OGM Ormanspor', 'Mersin SK', 'Harem Spor', 'MKE Ankaragücü'].map(club => ({ club, none: {
    Göztepe: 'English Wikipedia roster dated January 2026 (2025-26; one player is on Büyükçekmece\'s current roster); the club roster page does not answer.',
    'Fenerbahçe II': 'English Wikipedia roster links the 2025-26 league page (access date December 2024).',
    'Mersin SK': 'English Wikipedia roster dated June 2024 (two players are on other clubs\' current rosters).',
    'TED Ankara Kolejliler': 'Turkish Wikipedia roster template last edited in 2022; the club site does not answer.',
    'OGM Ormanspor': 'Turkish Wikipedia roster template last edited in January 2024.',
  }[club] ?? 'No current roster page found (no club site or Wikipedia roster; tbf.org.tr refuses automated access).' })),
];

/**
 * A page drawn by scripts, rendered in Chromium through Playwright (not a dependency of the game: set PLAYWRIGHT_MODULE
 * to an installed playwright package, for example the global one). Keeps the page's visible text, cached under
 * `render:` + the URL, so an offline rerun reads the cache.
 */
async function renderedText(url) {
  const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
  const browser = await chromium.launch(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY } } : {});
  try {
    const page = await (await browser.newContext({ userAgent: 'Mozilla/5.0 (compatible; CourtsideRosterCheck/1.0)' })).newPage();
    const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
    await page.waitForTimeout(4000);
    return { status: response?.status() ?? 0, finalUrl: page.url(), text: await page.evaluate(() => document.body.innerText) };
  } finally { await browser.close(); }
}

async function cachedFetch(url, cache, offline, render = false) {
  const file = path.join(cache, createHash('sha1').update(render ? `render:${url}` : url).digest('hex'));
  if (existsSync(file) && existsSync(`${file}.meta`)) return { url, ...JSON.parse(await readFile(`${file}.meta`, 'utf8')), text: await readFile(file, 'utf8') };
  if (offline) throw new Error(`${url} is not in the cache (offline run).`);
  if (render) {
    await pause(1100);
    const { status, finalUrl, text } = await renderedText(url);
    const meta = { url, finalUrl, status, fetchedAt: new Date().toISOString(), rendered: true };
    if (status === 200) { await writeFile(file, text); await writeFile(`${file}.meta`, JSON.stringify(meta)); }
    return { ...meta, text };
  }
  for (let attempt = 1; ; attempt += 1) {
    await pause(/wikipedia\.org/.test(url) ? 2500 : 1100);
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CourtsideRosterCheck/1.0)', 'Accept-Language': 'en,fr;q=0.8,tr;q=0.6' }, signal: AbortSignal.timeout(30_000) });
    const text = await response.text();
    if (response.status === 429 && attempt < 4) { await pause(20_000 * attempt); continue; }
    const meta = { url, finalUrl: response.url, status: response.status, fetchedAt: new Date().toISOString() };
    if (response.ok) { await writeFile(file, text); await writeFile(`${file}.meta`, JSON.stringify(meta)); }
    return { ...meta, text };
  }
}

const viewUrl = url => url.replace(/\/w\/rest\.php\/v1\/page\//, '/wiki/');

async function main() {
  const argument = name => { const index = process.argv.indexOf(name); return index > 0 ? process.argv[index + 1] : null; };
  const out = argument('--out'), cache = argument('--cache'), offline = process.argv.includes('--offline');
  const only = argument('--clubs')?.split(',').map(name => name.trim()).filter(Boolean), prefix = argument('--batch-prefix') ?? 'second-division';
  if (!argument('--pack') || !out || !cache) throw new Error('Usage: --pack PACK.json --cache DIR --out DIR [--clubs "A,B"] [--batch-prefix NAME] [--offline]');
  if (only) for (const name of only) if (!CLUB_SOURCES.some(entry => entry.club === name)) throw new Error(`${name} is not in CLUB_SOURCES.`);
  const envelope = JSON.parse(await readFile(argument('--pack'), 'utf8')), pack = envelope.pack ?? envelope;
  await mkdir(path.join(out, 'clubs'), { recursive: true });
  await mkdir(cache, { recursive: true });
  const parsers = { fibaEuropeCup, wikipediaPlayer3, wikipediaFrTable, lnbRoster, ...SITE_PARSERS };
  const combined = { source: 'scripts/real-data-second-division.mjs', sourceName: 'second-division-2026-27', observedOn: null, clubs: [] }, coverage = [];
  for (const entry of CLUB_SOURCES.filter(item => !only || only.includes(item.club))) {
    const club = pack.clubs.find(item => item.name === entry.club);
    if (!club) throw new Error(`${entry.club} is not a pack club.`);
    const competitions = pack.competitions.filter(item => item.clubIds.includes(club.id)).map(item => item.name);
    if (entry.none) { coverage.push({ club: club.name, clubId: club.id, competitions, covered: false, reason: entry.none }); continue; }
    const pages = [];
    for (const url of entry.pages) pages.push(await cachedFetch(url, cache, offline, entry.render));
    const failed = pages.filter(page => page.status !== 200);
    const { players: parsed, note } = failed.length && failed[0] === pages[0] ? { players: [] } : parsers[entry.parser](pages, entry.options ?? {});
    // Registered cover players who have not played, are not in the pack at this club and not on the club's own roster.
    const squad = pack.players.filter(player => player.clubId === club.id);
    const skipped = entry.newcomersMustHavePlayed ? parsed.filter(row => row.played === false && !squad.some(player => sameAs(player.name, row.name) || sameAs(row.name, player.name)) && !(entry.alsoListed ?? []).includes(row.name)) : [];
    const raw = parsed.filter(row => !skipped.includes(row)).map(({ played, ...row }) => row);
    const players = raw.map(row => ({ ...row, name: row.name.replace(/\s+/g, ' ').replace(/\bMc (\p{Lu})/gu, 'Mc$1').trim(), position: positionCode(row.label), nationality: country(row.nationality) ?? undefined })).map(row => Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined)));
    if (skipped.length) console.log(`${club.name}: left out (registered, not played, not in the pack): ${skipped.map(row => row.name).join(', ')}`);
    const fetchedOn = pages.map(page => page.fetchedAt?.slice(0, 10)).filter(Boolean).sort().at(-1);
    combined.observedOn = [combined.observedOn, fetchedOn].filter(Boolean).sort().at(-1);
    const sources = [viewUrl(entry.pages[0])];
    const record = { club: club.name, clubId: club.id, competitions, sourceName: entry.sourceName, sources, pagesRead: entry.pages.map(viewUrl), fetchedOn, note: [entry.note, note, skipped.length ? `Registered but left out (not played this season, not in the pack): ${skipped.map(row => row.name).join(', ')}.` : ''].filter(Boolean).join(' ') || undefined, players };
    await writeFile(path.join(out, 'clubs', `${fold(club.name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.json`), JSON.stringify(record, null, 1));
    const exact = players.filter(row => /^(PG|SG|SF|PF|C)$/.test(row.position ?? '')).length;
    coverage.push({ club: club.name, clubId: club.id, competitions, covered: players.length >= 9, players: players.length, exactPositions: exact, source: sources[0], ...(players.length < 9 ? { reason: `Only ${players.length} players read from ${sources[0]}.` } : {}) });
    if (players.length >= 9) combined.clubs.push({ clubId: club.id, club: club.name, sourceName: entry.sourceName, sources, players });
  }
  await writeFile(path.join(out, 'rosters-second-division.json'), JSON.stringify(combined, null, 1));
  await writeFile(path.join(out, 'coverage.json'), JSON.stringify(coverage, null, 1));
  for (const item of coverage) console.log(`${item.covered ? 'covered    ' : 'not covered'} ${item.club} (${item.competitions.join(', ')}): ${item.covered ? `${item.players} players, ${item.exactPositions} exact positions` : item.reason}`);
  const { batch, review } = correctionBatch({ pack, rosters: combined, coverage, prefix });
  await writeFile(path.join(out, `corrections-${batch.batch}.json`), JSON.stringify(batch, null, 1));
  await writeFile(path.join(out, 'review.json'), JSON.stringify(review, null, 1));
  console.log(`Batch ${batch.batch}: ${batch.rows.length} rows; moved ${review.counts.moved}, left ${review.counts.left}, added ${review.counts.added}, same player with another spelling ${review.sameAfterSpellingCheck.length}; guessed positions fixed: ${review.counts.guessedFixedExact} exact, ${review.counts.guessedNarrowedToGroup} to a group.`);
}

const levenshtein = (a, b) => { const row = Array.from({ length: b.length + 1 }, (_, index) => index); for (let i = 1; i <= a.length; i += 1) { let previous = row[0]; row[0] = i; for (let j = 1; j <= b.length; j += 1) { const kept = row[j]; row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1)); previous = kept; } } return row[b.length]; };

/**
 * A pack player who would leave and a roster player who would be added at the same club, with the same first initial
 * and a surname spelt nearly the same ("I. Mintongo" / "Igor Mintogo", "D. Grigoriani" / "Dianisi Grigorian"), are
 * one person: he stays, the roster's spelling becomes his full name, and he takes the roster's position, height and
 * birth date. Pairs must be unique both ways.
 */
function pairSpellings({ rosters, rows, players, name, observedOn }) {
  const words = text => nameTokens(text).filter(token => !['jr', 'jr.', 'sr', 'ii', 'iii'].includes(token));
  const initial = text => words(text)[0]?.[0] ?? '';
  const surname = text => words(text).slice(1).join('').replace(/\./g, '');
  const close = (a, b) => initial(a) === initial(b) && surname(a).length >= 4 && (surname(a) === surname(b) || levenshtein(surname(a), surname(b)) <= (Math.min(surname(a).length, surname(b).length) >= 6 ? 2 : 1));
  const pairs = [], drop = new Set(), extra = [];
  for (const clubRow of rows.filter(row => row.field === 'added_players')) {
    const clubId = `club-${clubRow.entity_id}`;
    const leaving = rows.filter(row => row.field === 'squad_status' && players.get(row.entity_id)?.clubId === clubId);
    const roster = rosters.clubs.find(club => club.clubId === clubId);
    for (const left of leaving) {
      const player = players.get(left.entity_id);
      const options = clubRow.value.value.filter(item => close(player.name, item.name));
      if (options.length !== 1 || leaving.filter(other => close(players.get(other.entity_id).name, options[0].name)).length !== 1) continue;
      const added = options[0], source = roster.players.find(item => item.name === added.name);
      pairs.push({ club: roster.club, packName: player.name, rosterName: added.name });
      drop.add(left); clubRow.value.value = clubRow.value.value.filter(item => item !== added);
      clubRow.reason = clubRow.reason.replace(/^\d+/, String(clubRow.value.value.length));
      const value = (field, fact, extraFields = {}) => extra.push({ entity_type: 'player', entity_id: left.entity_id, field, value: { value: fact, sources: roster.sources, observedOn, method: 'same-player-spelling-differs', rosterName: added.name, ...extraFields, batch: name }, reason: `Same player as "${added.name}" in ${roster.club}'s current roster (${roster.sourceName}, ${observedOn}); the spelling differs.` });
      if (player.name !== added.name) value('full_name', added.name);
      const parsed = rosterPosition(source?.position), exact = parsed.options.length === 1 ? parsed.options[0] : null;
      const group = parsed.group ?? (exact ? Object.keys(GROUP_POSITIONS).find(key => GROUP_POSITIONS[key].includes(exact)) : null);
      if (exact || group) value('position', exact, { group, rosterLabel: String(source?.label ?? source?.position), ...(exact && COMMUNITY_SOURCES.has(roster.sourceName) ? { community: true } : {}) });
      if (Number.isInteger(source?.heightCm)) value('height_cm', source.heightCm);
      if (source?.birthDate) value('birth_date', source.birthDate);
    }
  }
  const taken = new Set(extra.map(row => `${row.entity_id}/${row.field}`));
  return { pairs, rows: [...rows.filter(row => !drop.has(row) && !taken.has(`${row.entity_id}/${row.field}`)), ...extra] };
}

/** True when a pack name can be the roster name: its full words are in it and its initials fit ("V. Vitale" / "Valentin Vitale-Boiteux"), or it holds all the roster's words in another order ("Shamar Moore Jalen" / "Jalen Moore"). */
function sameAs(packName, rosterName) {
  const tokens = text => nameTokens(text).filter(token => !['jr', 'jr.', 'sr', 'ii', 'iii'].includes(token));
  const own = tokens(packName), full = own.filter(token => !token.endsWith('.')), initials = own.filter(token => token.endsWith('.')).map(token => token[0]), other = tokens(rosterName);
  if (full.length && full.every(token => other.includes(token))) { const rest = other.filter(token => !full.includes(token)); return initials.length <= 1 && initials.every(letter => rest.some(token => token.startsWith(letter))); }
  return other.length >= 2 && other.every(token => full.includes(token)) && full.length <= other.length + 1;
}

/**
 * The pack sometimes holds one person twice at a club ("V. Vitale" and "V. Boiteux" for Valentin Vitale-Boiteux). The
 * squads step keeps the first that matches the roster; when the other would leave but fits the same roster name and
 * has more rated minutes, he stays instead (with the roster's spelling as full name) and the first one leaves.
 */
function keepBetterTwin({ pack, rosters, rows, players, name, observedOn }) {
  const duplicates = [];
  const leftRows = rows.filter(row => row.field === 'squad_status');
  const leaving = new Set(leftRows.map(row => row.entity_id));
  for (const left of leftRows) {
    const player = players.get(left.entity_id), roster = rosters.clubs.find(club => club.clubId === player.clubId);
    if (!roster) continue;
    const kept = pack.players.filter(other => other.clubId === player.clubId && other.id !== player.id && !leaving.has(other.id.replace(/^player-/, '')));
    for (const row of roster.players.filter(item => sameAs(player.name, item.name))) {
      const twins = kept.filter(other => sameAs(other.name, row.name));
      if (twins.length !== 1) continue;
      const twin = twins[0], twinId = twin.id.replace(/^player-/, '');
      const better = (player.ratingMinutes ?? 0) > (twin.ratingMinutes ?? 0);
      duplicates.push({ club: roster.club, rosterName: row.name, kept: better ? player.name : twin.name, leaves: better ? twin.name : player.name, minutes: { [player.name]: player.ratingMinutes ?? 0, [twin.name]: twin.ratingMinutes ?? 0 } });
      if (!better) break;
      // Swap: the twin leaves, this player stays and takes the twin's facts from the roster.
      left.entity_id = twinId;
      left.reason = `Duplicate of ${player.name} (${row.name} in ${roster.club}'s current roster, ${roster.sourceName}, ${observedOn}); the entry with more rated minutes stays.`;
      for (const fact of rows.filter(item => item.entity_type === 'player' && item.entity_id === twinId && item !== left)) fact.entity_id = left.entity_id === twinId ? player.id.replace(/^player-/, '') : fact.entity_id;
      if (player.name !== row.name && !rows.some(item => item.entity_id === player.id.replace(/^player-/, '') && item.field === 'full_name')) rows.push({ entity_type: 'player', entity_id: player.id.replace(/^player-/, ''), field: 'full_name', value: { value: row.name, sources: roster.sources, observedOn, method: 'duplicate-kept-roster-spelling', batch: name }, reason: `${row.name} in ${roster.club}'s current roster (${roster.sourceName}, ${observedOn}); the pack held him twice.` });
      leaving.delete(player.id.replace(/^player-/, '')); leaving.add(twinId);
      break;
    }
  }
  return { duplicates, rows };
}

/**
 * A staying pack player known only by an initial ("A. Freeman") takes the full name of the one roster row he fits
 * ("Ahren Freeman") when no other player at his club fits that row (added 22 November 2026, world-10; the photo
 * matching and the squad list need full names). Players who already have a full_name row keep it.
 */
function fullNamesFromRoster({ pack, rosters, rows, name, observedOn }) {
  const leaving = new Set(rows.filter(row => row.field === 'squad_status').map(row => row.entity_id));
  const named = new Set(rows.filter(row => row.field === 'full_name').map(row => row.entity_id));
  const extra = [], names = [];
  for (const roster of rosters.clubs) {
    const squad = pack.players.filter(player => player.clubId === roster.clubId && !leaving.has(player.id.replace(/^player-/, '')));
    for (const player of squad) {
      const id = player.id.replace(/^player-/, '');
      if (named.has(id) || !nameTokens(player.name).some(token => token.endsWith('.'))) continue;
      const fits = roster.players.filter(row => sameAs(player.name, row.name));
      if (fits.length !== 1 || squad.filter(other => sameAs(other.name, fits[0].name)).length !== 1 || nameTokens(fits[0].name).some(token => token.endsWith('.'))) continue;
      names.push({ club: roster.club, packName: player.name, rosterName: fits[0].name });
      extra.push({ entity_type: 'player', entity_id: id, field: 'full_name', value: { value: fits[0].name, sources: roster.sources, observedOn, method: 'official-roster-full-name', rosterName: fits[0].name, batch: name }, reason: `${fits[0].name} in ${roster.club}'s current roster (${roster.sourceName}, ${observedOn}); the pack had only his initial.` });
    }
  }
  return { rows: extra, names };
}

/**
 * The correction rows for import-profile-overrides, in one file: the squads (moves, leavers, added players; as
 * world-8, scripts/real-data-current-squads.mjs, with players confirmed elsewhere by an earlier current roster kept
 * there) and the positions, heights and birth dates of the players who stay (scripts/real-data-official-profiles.mjs,
 * limited to the covered clubs). One row per player and field: a move's position wins.
 */
export function correctionBatch({ pack, rosters, coverage, prefix = 'second-division' }) {
  const observedOn = rosters.observedOn, name = `${prefix}-${observedOn}`;
  const covered = new Set(rosters.clubs.map(club => club.clubId));
  const squads = currentSquads({ pack: structuredClone(pack), rosters: [structuredClone(rosters)], observedOn, batch: name, keepConfirmed: true });
  const profiles = profileOverrides({ pack, rosters: [rosters], observedOn, batch: name });
  const players = new Map(pack.players.map(player => [player.id.replace(/^player-/, ''), player]));
  const keyOf = row => `${row.entity_type}/${row.entity_id}/${row.field}`;
  const leaving = new Set(squads.rows.filter(row => row.field === 'squad_status').map(row => row.entity_id));
  const rows = [...squads.rows], taken = new Set(rows.map(keyOf));
  for (const row of profiles.rows) {
    const player = players.get(row.entity_id);
    if (!player || !covered.has(player.clubId) || leaving.has(row.entity_id) || taken.has(keyOf(row)) || !['position', 'height_cm', 'birth_date'].includes(row.field)) continue;
    taken.add(keyOf(row)); rows.push(row);
  }
  const clubs = new Map(pack.clubs.map(club => [club.id.replace(/^club-/, ''), club.name]));
  const paired = pairSpellings({ pack, rosters, rows, squads, players, name, observedOn });
  rows.splice(0, rows.length, ...paired.rows);
  const twins = keepBetterTwin({ pack, rosters, rows, players, name, observedOn });
  rows.splice(0, rows.length, ...twins.rows);
  const fullNames = fullNamesFromRoster({ pack, rosters, rows, name, observedOn });
  rows.push(...fullNames.rows);
  const guessed = player =>!['official', 'provider'].includes(player.profileEvidence?.positionSource);
  const positionRows = rows.filter(row => row.field === 'position');
  const fixed = positionRows.filter(row => guessed(players.get(row.entity_id))).map(row => { const player = players.get(row.entity_id); return { player: player.name, club: clubs.get(player.clubId.replace(/^club-/, '')), was: player.position, now: row.value.value ?? null, group: row.value.group ?? null, label: row.value.rosterLabel ?? null, source: row.value.sources[0] }; });
  const added = rows.filter(row => row.field === 'added_players').flatMap(row => row.value.value.map(item => ({ club: clubs.get(row.entity_id), name: item.name, number: item.number, position: item.position, positionSource: item.positionSource, nationality: item.nationality, birthDate: item.birthDate ?? null, heightCm: item.heightCm, estimated: item.estimated })));
  const review = {
    batch: name, observedOn,
    counts: { rows: rows.length, moved: squads.report.moved, left: squads.report.left - paired.pairs.length, added: squads.report.added - paired.pairs.length, kept: squads.report.kept, guessedFixedExact: fixed.filter(item => item.now).length, guessedNarrowedToGroup: fixed.filter(item => !item.now).length, exactPositionRows: positionRows.filter(row => row.value.value).length },
    moved: squads.rows.filter(row => row.field === 'club_id' && row.value.method === 'found-on-another-club-roster').map(row => ({ player: players.get(row.entity_id)?.name, from: clubs.get(row.value.from), to: clubs.get(row.value.value) })),
    left: rows.filter(row => row.field === 'squad_status').map(row => ({ player: players.get(row.entity_id)?.name, club: clubs.get(players.get(row.entity_id)?.clubId.replace(/^club-/, '')) })),
    added, guessedPositionsFixed: fixed,
    fullNames: fullNames.names, sameAfterSpellingCheck: paired.pairs, packDuplicates: twins.duplicates, listedByTwoClubs: squads.report.listedByTwoClubs, blockedMoves: squads.report.blockedMoves,
    byClub: squads.report.byClub, notCovered: coverage.filter(item => !item.covered).map(item => ({ club: item.club, competitions: item.competitions, reason: item.reason })),
  };
  return { batch: { model: 'profile-overrides-1', batch: name, observedOn, rows }, review };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
