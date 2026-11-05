#!/usr/bin/env node
/** Local research import. Source data and image rights are not cleared for distribution. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderDataBrowser } from './render-data-browser.mjs';

const API = 'https://api-live.euroleague.net';
const TERMS = 'https://inform.euroleague.net/terms';
const COMPETITIONS = [['E', 'EuroLeague'], ['U', 'EuroCup']];
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const nonempty = (value) => typeof value === 'string' && value.trim() ? value.trim() : null;
const positive = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
const numeric = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const country = (value) => value && nonempty(value.code) ? { code: value.code, name: nonempty(value.name) } : null;
const byId = (a, b) => a.id.localeCompare(b.id, 'en');
const personId = (code) => `euroleague:person:${code}`;
const clubId = (code) => `euroleague:club:${code}`;
const clone = (value) => structuredClone(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export const LIMITATIONS = [
  'Local evaluation data only. Permission for game reuse, publication, redistribution, or a regularly updated database has not been established. Review the source terms before those uses.',
  'Coverage is EuroLeague and EuroCup only; domestic leagues, second divisions, and Basketball Champions League are not included.',
  'Registration dates and active flags are source observations of season history, not verified opening-day rosters or contract dates.',
  'Historical-season endpoints may expose current club or player profile details. Conflicting observations are retained in the quality report.',
  'Season statistics are totals per player and competition, including all listed clubs. They must not be copied as separate totals for each club.',
  'A missing statistics record means unknown or absent from this feed, never zero games or zero ability.',
  'No salaries, contracts, club budgets, personality, potential, or game-ready skill ratings are supplied or invented.',
  'Portrait URLs are references only. No photos or logos were downloaded; their reuse rights are not established.',
  'These are completed-season observations, unsuitable as opening-day scouting knowledge without controlling future information.',
];

export function validateYear(value) {
  const text = String(value);
  if (!/^\d{4}$/.test(text) || Number(text) < 2000 || Number(text) > 2100) {
    throw new Error('Year must be the four-digit season start year between 2000 and 2100.');
  }
  return Number(text);
}

function envelope(value, key, label) {
  if (!value || !Array.isArray(value[key]) || !Number.isSafeInteger(value.total) || value.total < 0) {
    throw new Error(`${label}: expected { ${key}: [], total: nonnegative integer }.`);
  }
  if (value[key].length > value.total) throw new Error(`${label}: more rows than the declared total.`);
  return value;
}

export function requireComplete(value, key = 'data', label = 'response') {
  envelope(value, key, label);
  if (value[key].length !== value.total) {
    throw new Error(`${label}: incomplete response (${value[key].length}/${value.total}); pagination is required.`);
  }
  return value[key];
}

/** Fetch until declared total is met, even when the server caps the requested page size. */
export async function collectPages(getPage, key = 'data', label = 'response') {
  const rows = [];
  const seenPages = new Set();
  let total;
  for (let page = 0; page < 100; page += 1) {
    const value = envelope(await getPage(rows.length), key, label);
    if (total !== undefined && total !== value.total) throw new Error(`${label}: total changed during pagination; retry a consistent snapshot.`);
    total = value.total;
    const fingerprint = sha256(JSON.stringify(value[key]));
    if (seenPages.has(fingerprint)) throw new Error(`${label}: repeated page; server did not advance the offset.`);
    seenPages.add(fingerprint);
    rows.push(...value[key]);
    if (rows.length === total) return { [key]: rows, total };
    if (!value[key].length || rows.length > total) throw new Error(`${label}: pagination ended before the declared total or exceeded it.`);
  }
  throw new Error(`${label}: exceeded the pagination safety limit.`);
}

function mergeObservation(target, incoming, refs, conflicts) {
  for (const [field, value] of Object.entries(incoming)) {
    if (value === null) continue;
    if (target[field] === null || target[field] === undefined) target[field] = clone(value);
    else if (!same(target[field], value)) {
      let conflict = conflicts.find((item) => item.entityId === target.id && item.field === field);
      if (!conflict) {
        conflict = { entityId: target.id, field, selected: clone(target[field]), observations: [{ value: clone(target[field]), sourceRefs: [...target.sourceRefs] }] };
        conflicts.push(conflict);
      }
      let observation = conflict.observations.find((item) => same(item.value, value));
      if (!observation) {
        observation = { value: clone(value), sourceRefs: [] };
        conflict.observations.push(observation);
      }
      observation.sourceRefs = [...new Set([...observation.sourceRefs, ...refs])].sort();
    }
  }
  target.sourceRefs = [...new Set([...target.sourceRefs, ...refs])].sort();
}

function requiredCode(value, label) {
  if (!nonempty(value) || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error(`${label}: missing or invalid source code.`);
  return value;
}

function birthDate(value) {
  if (!nonempty(value) || !/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)) return null;
  const day = value.slice(0, 10);
  const parsed = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(day) ? day : null;
}

/** Pure normalization; input documents must contain complete list envelopes. */
export function normalizeEuroleagueData(documents, options = {}) {
  const year = validateYear(options.year ?? 2025);
  const sources = clone(options.sources ?? []);
  const retrievedAt = options.retrievedAt ?? sources.map((source) => source.retrievedAt).sort().at(-1) ?? null;
  const clubs = new Map();
  const players = new Map();
  const registrations = [];
  const statistics = [];
  const competitions = [];
  const conflicts = [];
  const seenCompetitions = new Set();
  const seenRegistrations = new Set();
  const seenStatistics = new Set();
  for (const document of [...documents].sort((a, b) => a.code.localeCompare(b.code, 'en'))) {
    const competition = COMPETITIONS.find(([code]) => code === document.code);
    if (!competition) throw new Error('Unsupported competition code. Only E and U are accepted.');
    const competitionId = `${document.code}${year}`;
    if (seenCompetitions.has(competitionId)) throw new Error(`Duplicate competition ${competitionId}.`);
    seenCompetitions.add(competitionId);
    if (document.season?.code !== competitionId || document.season?.year !== year) throw new Error(`${competitionId}: season metadata does not match the requested season.`);
    const refs = (kind) => [...(document.sourceRefs?.[kind] ?? [])];
    const clubRows = requireComplete(document.clubs, 'data', `${competitionId} clubs`);
    const peopleRows = requireComplete(document.people, 'data', `${competitionId} people`);
    const statisticsRows = requireComplete(document.statistics, 'players', `${competitionId} statistics`);
    const competitionClubIds = new Set();
    for (const row of clubRows) {
      const code = requiredCode(row.code, 'Club');
      const id = clubId(code);
      if (competitionClubIds.has(id)) throw new Error(`${competitionId}: duplicate club ${code}.`);
      competitionClubIds.add(id);
      const observation = { code, name: nonempty(row.name), country: country(row.country), city: nonempty(row.city) };
      if (!observation.name) throw new Error(`${id}: missing name.`);
      if (!clubs.has(id)) clubs.set(id, { id, ...observation, competitionIds: [], sourceRefs: [] });
      const club = clubs.get(id);
      mergeObservation(club, observation, refs('clubs'), conflicts);
      club.competitionIds.push(competitionId);
    }
    let registrationCount = 0;
    for (const row of peopleRows) {
      if (row.type !== 'J') continue;
      const code = requiredCode(row.person?.code, 'Player');
      const id = personId(code);
      const registrationClubId = clubId(requiredCode(row.club?.code, 'Player club'));
      if (!competitionClubIds.has(registrationClubId)) throw new Error(`${competitionId}: registration references unknown club ${registrationClubId}.`);
      if (row.season?.code && row.season.code !== competitionId) throw new Error(`${id}: registration belongs to another season.`);
      const observation = { code, name: nonempty(row.person.name), birthDate: birthDate(row.person.birthDate), country: country(row.person.country), heightCm: positive(row.person.height), weightKg: positive(row.person.weight) };
      if (!observation.name) throw new Error(`${id}: missing name.`);
      if (!players.has(id)) players.set(id, { id, ...observation, missingFields: [], sourceRefs: [] });
      mergeObservation(players.get(id), observation, refs('people'), conflicts);
      const registrationId = `euroleague:registration:${competitionId}:${code}:${row.club.code}:${sha256(JSON.stringify(row)).slice(0, 16)}`;
      if (seenRegistrations.has(registrationId)) throw new Error(`${competitionId}: duplicate registration in the source.`);
      seenRegistrations.add(registrationId);
      registrations.push({ id: registrationId, playerId: id, clubId: registrationClubId, competitionId,
        startDate: nonempty(row.startDate), endDate: nonempty(row.endDate), jerseyNumber: nonempty(row.dorsal), position: nonempty(row.positionName),
        activeInSource: typeof row.active === 'boolean' ? row.active : null, portraitUrl: nonempty(row.images?.headshot), sourceRefs: refs('people') });
      registrationCount += 1;
    }
    for (const row of statisticsRows) {
      const player = personId(requiredCode(row.player?.code, 'Statistics player'));
      const id = `euroleague:statistics:${competitionId}:${row.player.code}`;
      if (seenStatistics.has(id)) throw new Error(`${id}: duplicate player statistics would double count totals.`);
      seenStatistics.add(id);
      const sourceTeamCode = nonempty(row.player.team?.code);
      const clubIds = [...new Set((sourceTeamCode ?? '').split(';').map((code) => code.trim()).filter(Boolean).map(clubId))];
      for (const team of clubIds) if (!competitionClubIds.has(team)) throw new Error(`${id}: statistics reference unknown club ${team}.`);
      const record = { id, playerId: player, competitionId, sourceTeamCode, clubIds,
        gamesPlayed: numeric(row.gamesPlayed), minutesPlayed: numeric(row.minutesPlayed), points: numeric(row.pointsScored),
        twoPointMade: numeric(row.twoPointersMade), twoPointAttempted: numeric(row.twoPointersAttempted),
        threePointMade: numeric(row.threePointersMade), threePointAttempted: numeric(row.threePointersAttempted),
        freeThrowMade: numeric(row.freeThrowsMade), freeThrowAttempted: numeric(row.freeThrowsAttempted),
        rebounds: numeric(row.totalRebounds), assists: numeric(row.assists), steals: numeric(row.steals), blocks: numeric(row.blocks), turnovers: numeric(row.turnovers), fouls: numeric(row.foulsCommited), sourceRefs: refs('statistics') };
      for (const shot of ['twoPoint', 'threePoint', 'freeThrow']) {
        if (record[`${shot}Made`] !== null && record[`${shot}Attempted`] !== null && record[`${shot}Made`] > record[`${shot}Attempted`]) throw new Error(`${id}: ${shot} makes exceed attempts.`);
      }
      if ([record.points, record.twoPointMade, record.threePointMade, record.freeThrowMade].every((value) => value !== null) && record.points !== 2 * record.twoPointMade + 3 * record.threePointMade + record.freeThrowMade) throw new Error(`${id}: points do not reconcile with made shots.`);
      statistics.push(record);
    }
    competitions.push({ id: competitionId, name: competition[1], clubCount: clubRows.length, registrationCount, statisticsCount: statisticsRows.length, sourceRefs: refs('season') });
  }
  const registeredKeys = new Set(registrations.map((row) => `${row.competitionId}:${row.playerId}`));
  for (const row of statistics) if (!registeredKeys.has(`${row.competitionId}:${row.playerId}`)) throw new Error(`${row.id}: statistics player is not registered in that competition.`);
  const statsKeys = new Set(statistics.map((row) => `${row.competitionId}:${row.playerId}`));
  const playerList = [...players.values()].sort(byId);
  for (const player of playerList) player.missingFields = ['birthDate', 'country', 'heightCm', 'weightKg'].filter((field) => player[field] === null);
  const pack = { schemaVersion: 1, season: `${year}-${String(year + 1).slice(-2)}`, retrievedAt,
    attribution: 'EuroLeague / EuroCup official public data service', termsUrl: TERMS, rightsStatus: 'Not cleared for game reuse or redistribution',
    sources, competitions, clubs: [...clubs.values()].sort(byId), players: playerList, registrations: registrations.sort(byId), statistics: statistics.sort(byId),
    quality: { counts: { clubs: clubs.size, players: players.size, registrations: registrations.length, statistics: statistics.length },
      missing: { heightCm: playerList.filter((row) => row.heightCm === null).length, weightKg: playerList.filter((row) => row.weightKg === null).length,
        birthDate: playerList.filter((row) => row.birthDate === null).length, registrationsWithoutPortrait: registrations.filter((row) => !row.portraitUrl).length,
        registrationsWithoutStatistics: registrations.filter((row) => !statsKeys.has(`${row.competitionId}:${row.playerId}`)).length },
      conflicts: conflicts.sort((a, b) => `${a.entityId}:${a.field}`.localeCompare(`${b.entityId}:${b.field}`, 'en')), limitations: [...LIMITATIONS] } };
  return pack;
}

/** Quote every cell and neutralize spreadsheet formulas, including after leading whitespace. */
export function csvCell(value) {
  let text = value === null || value === undefined ? '' : Array.isArray(value) ? value.join(';') : typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/^[\s\u0000-\u001f\u007f]*[=+@-]/u.test(text) || /^[\t\r\n]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function toCsv(rows, columns) {
  return '\uFEFF' + [columns.map(csvCell).join(','), ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(','))].join('\r\n') + '\r\n';
}

async function atomicWrite(destination, content) {
  const temporary = `${destination}.${process.pid}.tmp`;
  await writeFile(temporary, content);
  await rename(temporary, destination);
}

async function getJsonBytes(url) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(25000), redirect: 'error' });
    if (response.status === 429 && attempt < 2) {
      const seconds = Number(response.headers.get('retry-after'));
      await response.body?.cancel();
      await new Promise((resolve) => setTimeout(resolve, Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 5000) : 1000 * (attempt + 1)));
      continue;
    }
    if (!response.ok) throw new Error(`Source returned HTTP ${response.status}: ${url}. No authentication or access controls will be bypassed.`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 20_000_000) throw new Error('Source response exceeds the import size limit.');
    JSON.parse(bytes.toString('utf8'));
    return { bytes, retrievedAt: new Date().toISOString(), timestampBasis: 'completed-http-response' };
  }
  throw new Error('Source request failed after bounded retries.');
}

const researchFiles = {
  E: { season: 'euroleague-sample-0.json', clubs: 'euroleague-sample-1.json', people: 'euroleague-records-0.json', statistics: 'E2025-player-totals.json' },
  U: { season: 'U2025-season.json', clubs: 'euroleague-sample-3.json', people: 'euroleague-records-1.json', statistics: 'U2025-player-totals.json' },
};

async function acquire({ url, code, year, kind, offset, rawDirectory, fromResearch, refresh }) {
  const sourceFiles = (await readdir(rawDirectory)).filter((name) => name.endsWith('.source.json')).sort();
  if (!refresh && !fromResearch) {
    const matching = [];
    for (const name of sourceFiles) {
      const source = JSON.parse(await readFile(path.join(rawDirectory, name), 'utf8'));
      if (source.url === url) matching.push(source);
    }
    matching.sort((a, b) => b.retrievedAt.localeCompare(a.retrievedAt));
    if (matching.length) {
      const source = matching[0];
      if (path.basename(source.rawFile) !== source.rawFile.replace(/^raw\//, '')) throw new Error('Unsafe cached raw filename.');
      const bytes = await readFile(path.join(rawDirectory, path.basename(source.rawFile)));
      if (sha256(bytes) !== source.sha256 || bytes.length !== source.bytes) throw new Error(`Cached source hash mismatch: ${source.rawFile}`);
      return { source, document: JSON.parse(bytes.toString('utf8')) };
    }
  }
  let observed;
  if (fromResearch) {
    if (year !== 2025 || offset !== 0) throw new Error('Research snapshots only contain the complete 2025–26 first pages; cannot fill missing pagination from research files.');
    const filename = path.join(fromResearch, researchFiles[code][kind]);
    observed = { bytes: await readFile(filename), retrievedAt: (await stat(filename)).mtime.toISOString(), timestampBasis: 'research-file-modification-time' };
  } else observed = await getJsonBytes(url);
  const document = JSON.parse(observed.bytes.toString('utf8'));
  const hash = sha256(observed.bytes);
  const stem = `${code}${year}-${kind}-${offset}-${hash.slice(0, 16)}`;
  const rawFile = `raw/${stem}.json`;
  const source = { id: stem, url, retrievedAt: observed.retrievedAt, retrievalDate: observed.retrievedAt.slice(0, 10), timestampBasis: observed.timestampBasis,
    sha256: hash, bytes: observed.bytes.length, rawFile, attribution: 'EuroLeague / EuroCup', termsUrl: TERMS };
  const destination = path.join(rawDirectory, `${stem}.json`);
  try { await writeFile(destination, observed.bytes, { flag: 'wx' }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (sha256(await readFile(destination)) !== hash) throw new Error(`Immutable source file has changed: ${destination}`);
  }
  const metadataFile = path.join(rawDirectory, `${stem}.source.json`);
  try { await writeFile(metadataFile, JSON.stringify(source, null, 2) + '\n', { flag: 'wx' }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const originalSource = JSON.parse(await readFile(metadataFile, 'utf8'));
    if (originalSource.sha256 !== hash || originalSource.url !== url) throw new Error('Immutable source metadata does not match.');
    return { source: originalSource, document };
  }
  return { source, document };
}

export async function importEuroleagueData({ year = 2025, outputDirectory, fromResearch = null, refresh = false } = {}) {
  year = validateYear(year);
  const directory = path.resolve(outputDirectory ?? `.local-data/europe-${year}-${String(year + 1).slice(-2)}`);
  const rawDirectory = path.join(directory, 'raw');
  await mkdir(rawDirectory, { recursive: true });
  const documents = [];
  const sources = [];
  for (const [code] of COMPETITIONS) {
    const sourceRefs = { season: [], clubs: [], people: [], statistics: [] };
    const base = `${API}/v2/competitions/${code}/seasons/${code}${year}`;
    const get = async (kind, offset = 0) => {
      const url = kind === 'season' ? base : kind === 'statistics' ? `${API}/v3/competitions/${code}/statistics/players/traditional?seasonMode=Single&seasonCode=${code}${year}&statisticMode=Accumulated&limit=1000&offset=${offset}` : kind === 'clubs' && offset === 0 ? `${base}/clubs` : `${base}/${kind}?limit=1200&offset=${offset}`;
      const result = await acquire({ url, code, year, kind, offset, rawDirectory, fromResearch, refresh });
      sources.push(result.source);
      sourceRefs[kind].push(result.source.id);
      return result.document;
    };
    const season = await get('season');
    const clubs = await collectPages((offset) => get('clubs', offset), 'data', `${code}${year} clubs`);
    const people = await collectPages((offset) => get('people', offset), 'data', `${code}${year} people`);
    const statistics = await collectPages((offset) => get('statistics', offset), 'players', `${code}${year} statistics`);
    documents.push({ code, season, clubs, people, statistics, sourceRefs });
  }
  const pack = normalizeEuroleagueData(documents, { year, sources });
  const clubRows = pack.clubs.map((row) => ({ ...row, countryCode: row.country?.code, countryName: row.country?.name }));
  const playerRows = pack.players.map((row) => ({ ...row, countryCode: row.country?.code, countryName: row.country?.name }));
  const exports = [
    ['clubs.csv', clubRows, ['id', 'code', 'name', 'countryCode', 'countryName', 'city', 'competitionIds', 'sourceRefs']],
    ['players.csv', playerRows, ['id', 'code', 'name', 'birthDate', 'countryCode', 'countryName', 'heightCm', 'weightKg', 'missingFields', 'sourceRefs']],
    ['registrations.csv', pack.registrations, ['id', 'playerId', 'clubId', 'competitionId', 'startDate', 'endDate', 'jerseyNumber', 'position', 'activeInSource', 'portraitUrl', 'sourceRefs']],
    ['statistics.csv', pack.statistics, ['id', 'playerId', 'competitionId', 'sourceTeamCode', 'clubIds', 'gamesPlayed', 'minutesPlayed', 'points', 'twoPointMade', 'twoPointAttempted', 'threePointMade', 'threePointAttempted', 'freeThrowMade', 'freeThrowAttempted', 'rebounds', 'assists', 'steals', 'blocks', 'turnovers', 'fouls', 'sourceRefs']],
  ];
  for (const [filename, rows, columns] of exports) await atomicWrite(path.join(directory, filename), toCsv(rows, columns));
  await atomicWrite(path.join(directory, 'euroleague-data.json'), JSON.stringify(pack, null, 2) + '\n');
  await atomicWrite(path.join(directory, 'browse.html'), renderDataBrowser(pack));
  const summary = [
    `EuroLeague / EuroCup ${pack.season} — local research data`, `Retrieved: ${pack.retrievedAt}`,
    ...pack.competitions.map((item) => `${item.name}: ${item.clubCount} clubs, ${item.registrationCount} player registrations, ${item.statisticsCount} player season totals.`),
    `Combined: ${pack.players.length} unique players, ${pack.clubs.length} clubs.`,
    `Missing player height: ${pack.quality.missing.heightCm}; missing weight: ${pack.quality.missing.weightKg}; profile conflicts: ${pack.quality.conflicts.length}.`,
    '', 'Files: browse.html (open to browse offline), euroleague-data.json, clubs.csv, players.csv, registrations.csv, statistics.csv, raw/ (unchanged source snapshots and SHA-256 provenance).',
    'CSV cells are quoted, UTF-8 encoded with a BOM, and spreadsheet formula prefixes are neutralized. Empty values mean unknown.',
    '', 'SOURCE AND LIMITATIONS', `Attribution: ${pack.attribution}`, `Terms: ${TERMS}`, ...LIMITATIONS.map((item) => `- ${item}`), '',
  ].join('\r\n');
  await atomicWrite(path.join(directory, 'SUMMARY.txt'), summary);
  return { pack, directory };
}

export function parseArguments(argv) {
  const options = { year: 2025 };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--refresh') options.refresh = true;
    else if (argument === '--from-research') {
      options.fromResearch = argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[++index] : '.artifacts/data-research';
    } else if (argument === '--year') options.year = validateYear(argv[++index]);
    else if (argument === '--help' || argument === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) console.log('Usage: node scripts/euroleague-data.mjs [--year 2025] [--from-research [directory]] [--refresh]\nUses cached immutable snapshots unless --refresh is given. Output: .local-data/europe-YYYY-YY/. No account, key, image downloads, or game integration.');
    else {
      const { pack, directory } = await importEuroleagueData(options);
      console.log(`Saved ${pack.clubs.length} real clubs, ${pack.players.length} unique players, ${pack.registrations.length} registrations and ${pack.statistics.length} season statistics records.\n${directory}\nRead SUMMARY.txt for coverage and reuse limitations.`);
    }
  } catch (error) {
    console.error(`Data import failed: ${error.message}`);
    process.exitCode = 1;
  }
}
