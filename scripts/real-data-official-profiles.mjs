#!/usr/bin/env node
/**
 * Official profile corrections for the published pack (16 November 2026). API-Sports gives only broad roles (Guard,
 * Forward, Center) or none, so most exact positions are guesses. This matches the pack's players with free official
 * sources and writes the facts as rows for the database's `manual_overrides` table ("hand-maintained facts and
 * corrections, never overwritten by an import"), which the publishing Edge Function applies:
 *
 * - official competition registrations (EuroLeague and EuroCup season `people`): broad role, height, weight, birth
 *   date, shirt number, nationality and, for abbreviated names, the full name, as the profile audit does;
 * - official roster pages (league or club sites) with exact positions, converted to rows by a source parser.
 *
 * Matching is within one club only: exact name, or a unique initial and surname, or a unique surname with the same
 * shirt number. Ambiguous names are left unchanged. An exact position wins; a broad role only constrains the guess
 * (the Edge Function chooses within the group from the player's statistics, as the ratings do).
 *
 *   node scripts/real-data-official-profiles.mjs --pack PACK.json --official E.json,U.json --club-map MAP.json \
 *     [--rosters ROSTERS.json,...] [--observed-on 2026-11-16] --out OVERRIDES.json
 *
 * MAP.json maps API-Sports club IDs to database club IDs ({ "1263": "<uuid>" }). Official documents keep
 * { url, fetchedAt, status, body, pages } as `officialPeople` requires. Roster files hold
 * { source, observedOn, clubs: [{ clubId, sources?, players: [{ name, position, number? }] }] }.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { officialPeople, matchOfficialProfile } from './real-data-profile-audit.mjs';

export const OVERRIDE_MODEL = 'profile-overrides-1';
const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];
export const GROUP_POSITIONS = Object.freeze({ Guard: ['PG', 'SG'], Forward: ['SF', 'PF'], Center: ['C'] });
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value).toISOString().slice(0, 10) === value;
const displayName = row => { const [surname, given] = row.person.name.split(','); return `${given?.trim() ?? ''} ${surname.trim()}`.trim().toLowerCase().replace(/(^|[\s-])\p{L}/gu, letter => letter.toUpperCase()); };

/**
 * Exact position labels in the languages of the pack's leagues. Broad labels map to a group only. A label listing
 * several positions ("PF/C", "Ala/Centro") gives several options.
 */
const LABELS = Object.freeze({
  PG: ['pg', 'point guard', 'base', 'meneur', 'playmaker', 'play', 'aufbau', 'aufbauspieler', 'point', 'oyun kurucu', 'πλέι μέικερ', 'πλεϊμέικερ', '1'],
  SG: ['sg', 'shooting guard', 'escolta', 'arriere', 'arrière', 'guardia', 'shooting', 'sutor', 'şutör', 'σούτινγκ γκαρντ', '2'],
  SF: ['sf', 'small forward', 'alero', 'ailier', 'ala piccola', 'small', 'kanat', 'σμολ φόργουορντ', '3'],
  PF: ['pf', 'power forward', 'ala-pivot', 'ala-pívot', 'ala pivot', 'ala pívot', 'ailier fort', 'ala grande', 'power', 'uzun forvet', 'πάουερ φόργουορντ', '4'],
  C: ['c', 'center', 'centre', 'pivot', 'pívot', 'centro', 'pivot', 'pivô', 'σέντερ', '5'],
});
const GROUP_LABELS = Object.freeze({
  Guard: ['g', 'guard', 'guardia/playmaker', 'guard/forward-guard', 'γκαρντ', 'oyun kurucu/şutör'],
  Forward: ['f', 'forward', 'ala', 'forvet', 'flügel', 'flugel', 'φόργουορντ'],
  Center: [],
});
const fold = text => text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().trim();

/** A roster label as exact options and/or a broad group; unknown labels give nothing. */
export function rosterPosition(label) {
  const text = fold(String(label ?? ''));
  if (!text) return { options: [], group: null };
  for (const [group, labels] of Object.entries(GROUP_LABELS)) if (labels.map(fold).includes(text)) return { options: [], group };
  const parts = text.split(/\s*[/,|]\s*|\s+-\s+|\s+o\s+|\s+e\s+/u).filter(Boolean);
  const options = [];
  for (const part of parts) {
    const position = POSITIONS.find(key => LABELS[key].map(fold).includes(part));
    if (position) { if (!options.includes(position)) options.push(position); continue; }
    const group = Object.entries(GROUP_LABELS).find(([, labels]) => labels.map(fold).includes(part))?.[0];
    if (!group) return { options: [], group: null };
    for (const position of GROUP_POSITIONS[group]) if (!options.includes(position)) options.push(position);
  }
  const groups = [...new Set(options.map(position => Object.keys(GROUP_POSITIONS).find(group => GROUP_POSITIONS[group].includes(position))))];
  return { options, group: groups.length === 1 ? groups[0] : null };
}

/**
 * Combines an official broad role with roster options: one exact option wins; several options are narrowed by the
 * role ("PF/C" with Center gives C); otherwise only a group remains, or nothing.
 */
export function combinePosition(group, options) {
  const allowed = group ? options.filter(position => GROUP_POSITIONS[group].includes(position)) : options;
  if (options.length === 1) return { position: options[0], conflict: !!group && !GROUP_POSITIONS[group].includes(options[0]) };
  if (allowed.length === 1) return { position: allowed[0], conflict: false };
  return { position: group === 'Center' ? 'C' : null, conflict: false };
}

const ENTITIES = { amp: '&', apos: "'", quot: '"', lt: '<', gt: '>', nbsp: ' ' };
/** Names as words: HTML entities decoded, accents folded, hyphens and apostrophes split. */
export const nameTokens = value => fold(String(value ?? '').replace(/&(#\d+|[a-z]+);/gi, (all, code) => code[0] === '#' ? String.fromCodePoint(Number(code.slice(1))) : ENTITIES[code.toLowerCase()] ?? all))
  .replace(/ı/g, 'i').replace(/ł/g, 'l').replace(/['’`\-]/g, ' ').replace(/[^a-z0-9\s.]/g, '').split(/\s+/).map(token => token.replace(/\.+$/, '.')).filter(token => token && token !== '.');
const SUFFIXES = new Set(['jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv']);

/**
 * Match a pack name within one club's rows ({ name, number, surname? }); ambiguity gives null. In order: the same
 * words; a unique initial and surname; a unique row whose words contain all of the other name's words (at least two);
 * a unique surname with the same shirt number.
 */
export function matchName(name, number, rows) {
  const words = value => nameTokens(value).filter(token => !SUFFIXES.has(token));
  const key = value => words(value).map(token => token.replace(/\.$/, '')).sort().join(' ');
  const exact = rows.filter(row => key(row.name) === key(name));
  if (exact.length) return exact.length === 1 ? { row: exact[0], method: 'exact-name-and-club' } : null;
  const own = words(name);
  const initialOf = list => /^([a-z])\.$/.exec(list[0] ?? '')?.[1] ?? null;
  const surnameOf = row => row.surname ? words(row.surname).join(' ') : words(row.name).slice(1).join(' ');
  if (own.length >= 2) {
    const initial = initialOf(own), last = own.slice(1).join(' ');
    const candidates = rows.filter(row => {
      const other = words(row.name), otherInitial = initialOf(other);
      if (other.length < 2 || !!initial === !!otherInitial) return false;
      return initial ? other[0].startsWith(initial) && surnameOf(row) === last : own[0].startsWith(otherInitial) && other.slice(1).join(' ') === own.slice(1).join(' ');
    });
    if (candidates.length === 1) return { row: candidates[0], method: 'unique-initial-surname-and-club' };
    if (candidates.length > 1) return null;
    const full = list => list.filter(token => !token.endsWith('.'));
    const subset = rows.filter(row => {
      const a = full(own), b = full(words(row.name)), [small, large] = a.length <= b.length ? [a, b] : [b, a];
      return small.length >= 2 && small.every(token => large.includes(token));
    });
    if (subset.length === 1) return { row: subset[0], method: 'name-words-contained-and-club' };
    if (subset.length > 1) return null;
  }
  if (Number.isInteger(number)) {
    const last = own.at(-1) ?? '';
    const candidates = rows.filter(row => words(row.surname ?? row.name).includes(last) || words(row.name).at(-1) === last);
    if (candidates.length === 1 && candidates[0].number === number) return { row: candidates[0], method: 'unique-surname-number-and-club' };
  }
  return null;
}

/**
 * Builds the override rows. `clubCodeOf` maps pack club IDs to official competition club codes; `clubUuidOf` strips
 * the pack prefix. Returns { rows, report }.
 */
/** The audit's matcher first; then the extra rules of `matchName` over the club's registrations. */
function officialFallback(player, candidates) {
  const rows = candidates.map(row => ({ name: displayName(row), surname: row.person.name.split(',')[0], number: /^\d{1,2}$/.test(row.dorsal ?? '') ? Number(row.dorsal) : null, row }));
  const found = matchName(player.name, player.number, rows);
  return found ? { row: found.row.row, method: found.method } : null;
}

export function profileOverrides({ pack, officialDocuments = [], clubLinks = [], clubMap = {}, rosters = [], observedOn, batch }) {
  if (!date(observedOn)) throw new Error('Name the observation date (YYYY-MM-DD).');
  const official = officialDocuments.length ? officialPeople(officialDocuments, observedOn, pack.season.slice(0, 4)) : [];
  const codeOf = new Map(clubLinks.map(link => [clubMap[String(link.apiSportsId)] ? `club-${clubMap[String(link.apiSportsId)]}` : null, link.officialCode]).filter(([id]) => id));
  const rosterOf = new Map();
  for (const file of rosters) for (const club of file.clubs ?? []) {
    if (!date(file.observedOn) || file.observedOn > observedOn) throw new Error('Roster evidence needs an observation date on or before the override date.');
    const sources = club.sources ?? [file.source];
    if (!sources.length || sources.some(url => !/^https:\/\//.test(url ?? ''))) throw new Error(`Roster evidence for ${club.clubId} needs https sources.`);
    const rows = club.players.map(player => ({ ...player, sources, observedOn: file.observedOn, sourceName: file.sourceName ?? null }));
    rosterOf.set(club.clubId, [...(rosterOf.get(club.clubId) ?? []), ...rows]);
  }
  const report = { observedOn, batch, players: pack.players.length, officialClubs: codeOf.size, officialMatched: 0, rosterMatched: 0, exactPositions: 0, groupPositions: 0, conflicts: [], ambiguousOrMissing: [], byMethod: {}, bySource: {} };
  const rows = [];
  const uuid = id => id.replace(/^player-/, '');
  const add = (player, field, value, reason) => rows.push({ entity_type: 'player', entity_id: uuid(player.id), field, value: { ...value, batch, observedOn: value.observedOn ?? observedOn }, reason });
  for (const player of pack.players) {
    const code = codeOf.get(player.clubId);
    const candidates = code ? official.filter(row => row.club.code === code) : [];
    const match = code ? matchOfficialProfile(player.name, candidates) ?? officialFallback(player, candidates) : null;
    const rosterRows = rosterOf.get(player.clubId) ?? [];
    const roster = rosterRows.length ? matchName(player.name, player.number, rosterRows) ?? (match ? matchName(displayName(match.row), Number(match.row.dorsal), rosterRows) : null) : null;
    if (code && !match) report.ambiguousOrMissing.push({ playerId: player.id, name: player.name, clubId: player.clubId, source: 'official-competition' });
    if (rosterRows.length && !roster) report.ambiguousOrMissing.push({ playerId: player.id, name: player.name, clubId: player.clubId, source: 'roster' });
    if (!match && !roster) continue;
    const group = match && GROUP_POSITIONS[match.row.positionName] ? match.row.positionName : null;
    const parsed = roster ? rosterPosition(roster.row.position) : { options: [], group: null };
    const combined = combinePosition(group ?? parsed.group, parsed.options);
    if (combined.conflict || group && parsed.group && group !== parsed.group && !parsed.options.length) report.conflicts.push({ playerId: player.id, name: player.name, officialGroup: group, roster: roster.row.position, chosen: combined.position ?? group });
    const sources = [...new Set([...(match ? [match.row.sourceUrl] : []), ...(roster ? roster.row.sources : [])])];
    const finalGroup = group ?? parsed.group;
    if (combined.position || finalGroup) {
      const exact = !!combined.position;
      const method = exact ? (roster && parsed.options.length ? (parsed.options.length === 1 ? 'official-roster-exact' : 'official-roster-narrowed-by-role') : 'official-competition-center') : 'official-group-statistics';
      report.byMethod[method] = (report.byMethod[method] ?? 0) + 1;
      const source = exact ? (roster && parsed.options.length ? roster.row.sourceName ?? 'roster' : 'euroleague-eurocup') : (group ? 'euroleague-eurocup' : roster.row.sourceName ?? 'roster');
      report.bySource[source] = (report.bySource[source] ?? 0) + 1;
      if (exact) report.exactPositions += 1; else report.groupPositions += 1;
      add(player, 'position', { value: combined.position, group: finalGroup, method, sources, ...(match ? { officialPersonCode: match.row.person.code, matchMethod: match.method } : {}), ...(roster ? { rosterLabel: String(roster.row.position), rosterMatch: roster.method } : {}) },
        `${exact ? 'Exact' : 'Broad'} position from ${source === 'euroleague-eurocup' ? 'the official EuroLeague/EuroCup registration' : `the official roster (${source})`}; matched by ${(match ?? roster).method}.`);
    }
    if (roster) report.rosterMatched += 1;
    if (!match) continue;
    report.officialMatched += 1;
    const person = match.row.person, sourced = { sources: [match.row.sourceUrl], officialPersonCode: person.code, matchMethod: match.method };
    const why = `Official ${match.row.season.code} registration (person ${person.code}); matched by ${match.method}.`;
    if (/^[A-Z]\.\s/.test(player.name)) add(player, 'full_name', { value: displayName(match.row), ...sourced }, why);
    if (Number.isInteger(person.height) && person.height >= 150 && person.height <= 240) add(player, 'height_cm', { value: person.height, ...sourced }, why);
    if (Number.isInteger(person.weight) && person.weight >= 50 && person.weight <= 180) add(player, 'weight_kg', { value: person.weight, ...sourced }, why);
    const born = person.birthDate?.slice(0, 10), opening = `${pack.season.slice(0, 4)}-09-05`;
    const age = date(born) ? Number(opening.slice(0, 4)) - Number(born.slice(0, 4)) - Number(opening.slice(5) < born.slice(5)) : null;
    if (age !== null && age >= 14 && age <= 60) add(player, 'birth_date', { value: born, ...sourced }, why);
    if (/^\d{1,2}$/.test(match.row.dorsal ?? '')) add(player, 'shirt_number', { value: Number(match.row.dorsal), ...sourced }, why);
    if (person.country?.name) add(player, 'nationality', { value: person.country.name, ...sourced }, why);
  }
  const keys = new Set();
  for (const row of rows) { const key = `${row.entity_id}/${row.field}`; if (keys.has(key)) throw new Error(`Two overrides for ${key}.`); keys.add(key); }
  report.rows = rows.length;
  return { model: OVERRIDE_MODEL, batch, observedOn, rows, report };
}

async function main() {
  const argument = name => { const index = process.argv.indexOf(name); return index > 0 ? process.argv[index + 1] : null; };
  const list = name => (argument(name) ?? '').split(',').map(item => item.trim()).filter(Boolean);
  const read = async file => JSON.parse(await readFile(file, 'utf8'));
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const packFile = argument('--pack'), out = argument('--out');
  if (!packFile || !out) throw new Error('Usage: --pack PACK.json --official E.json,U.json --club-map MAP.json [--rosters R.json,...] --out OVERRIDES.json');
  if (existsSync(out)) throw new Error(`${out} exists; choose a new output file.`);
  const envelope = await read(packFile), pack = envelope.pack ?? envelope;
  const observedOn = argument('--observed-on') ?? new Date().toISOString().slice(0, 10);
  const result = profileOverrides({
    pack, observedOn, batch: argument('--batch') ?? `official-${observedOn}`,
    officialDocuments: await Promise.all(list('--official').map(read)),
    clubLinks: (await read(argument('--club-links') ?? path.join(root, 'real-data', 'official-club-links.json'))).clubs,
    clubMap: argument('--club-map') ? await read(argument('--club-map')) : {},
    rosters: await Promise.all(list('--rosters').map(read)),
  });
  await writeFile(out, JSON.stringify(result, null, 1));
  const { report } = result;
  console.log(`${report.rows} override rows for ${report.officialMatched} official matches and ${report.rosterMatched} roster matches: ${report.exactPositions} exact and ${report.groupPositions} broad positions; ${report.conflicts.length} conflicts; ${report.ambiguousOrMissing.length} unmatched. Methods: ${JSON.stringify(report.byMethod)}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
