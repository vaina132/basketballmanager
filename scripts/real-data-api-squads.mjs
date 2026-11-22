#!/usr/bin/env node
/**
 * Current squads from API-Sports team lists and box scores (22 November 2026, owner permission for the Türkiye
 * Basketbol Ligi: tbf.org.tr refuses automated access and the clubs' Wikipedia rosters are old). API-Sports lists every
 * player a club has used or registered this season, so a list alone does not prove where a player is now; the box
 * scores already in the database do. For each club of the run:
 *
 * - a pack player listed by the club stays;
 * - a pack player listed by the club but kept elsewhere moves here when his latest 2026-27 game was for this club, or,
 *   without games, when his pack club is in the run and no longer lists him; a player confirmed at a club outside the
 *   run by an earlier current roster stays there;
 * - a pack player whose latest 2026-27 game was for another pack club moves there (a later transfer);
 * - a listed player missing from the pack (a new provider id, or a database player who left earlier) is added with an
 *   estimated profile (as world-8: the position's typical abilities, lifted by the game to the club's level), his
 *   number, nationality and age, and the position from the provider's group (Guard/Forward/Center) or from earlier
 *   corrections; he is added only where his latest game was, or, without games, where exactly one club of the run
 *   lists him;
 * - nobody leaves only because a list misses him (lists lag behind); an entry the pack holds twice at a club after a
 *   move (an earlier addition with the same initial and surname) is dropped from the club's added list.
 *
 * It also withdraws a club with no team this season (AS Monaco, 22 November 2026): players an earlier current roster
 * listed at another club ('kept-for-minimum-squad') move there, the others leave.
 *
 * Writes one profile-overrides-1 file (with the given other batches merged in and checked: one row per entity and
 * field, every id known) and a review file. No network and no database access: the inputs are files.
 *
 *   node scripts/real-data-api-squads.mjs --pack PACK.json --api-dir DIR --club-map MATCHES.json --provider-map MAP.json \
 *     --games GAMES.json --known KNOWN.json --club-rows ROWS.json --competition "Türkiye Basketbol Ligi" \
 *     [--withdraw CLUB_ID --withdraw-source URL --blocked BLOCKED.json] [--merge A.json,B.json] --out OUT.json \
 *     [--observed-on YYYY-MM-DD] [--batch NAME]
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nameTokens, rosterPosition, GROUP_POSITIONS } from './real-data-official-profiles.mjs';

const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];
const ATTRIBUTES = ['twoPoint', 'threePoint', 'freeThrow', 'passing', 'defense', 'rebounding', 'stamina'];
const BUILD = { PG: [188, 84], SG: [194, 89], SF: [200, 97], PF: [206, 106], C: [211, 113] };
const GROUP_DEFAULT = { Guard: 'SG', Forward: 'SF', Center: 'C' };
const fold = text => String(text ?? '').normalize('NFKD').replace(/\p{M}/gu, '').replace(/ı/g, 'i').toLowerCase().trim();
const bare = id => id.replace(/^(player|club)-/, '');
const apiUrl = team => `https://v1.basketball.api-sports.io/players?team=${team}&season=2026-2027`;

/** Same person by name: same first initial and the same last word ("Omer Al" / "Ömer Utku Al"). */
export function samePerson(a, b) {
  const words = text => nameTokens(text).filter(token => !['jr', 'jr.', 'sr', 'ii', 'iii'].includes(token)).map(token => token.replace(/\.$/, ''));
  const x = words(a), y = words(b);
  return x.length >= 2 && y.length >= 2 && x[0][0] === y[0][0] && x.at(-1) === y.at(-1);
}

/** The position's typical abilities among players with 300+ rated minutes (as scripts/real-data-current-squads.mjs). */
export function typicalProfiles(pack) {
  return Object.fromEntries(POSITIONS.map(position => {
    const rated = pack.players.filter(player => player.position === position && (player.ratingMinutes ?? 0) >= 300);
    return [position, Object.fromEntries(ATTRIBUTES.map(key => { const values = rated.map(player => player.attributes[key]).sort((a, b) => a - b); return [key, values[Math.floor(values.length / 2)] ?? 9]; }))];
  }));
}

export function apiSquads({ pack, lists, providerToPlayer, games, known = [], clubRows = [], observedOn, batch }) {
  const clubs = new Map(pack.clubs.map(club => [club.id, club]));
  const players = new Map(pack.players.map(player => [player.id, player]));
  const inRun = new Set(lists.map(list => list.clubId));
  const knownById = new Map(known.map(item => [item.id, item]));
  const listedBy = new Map(); // player key -> [clubId]
  const keyOf = row => providerToPlayer[String(row.id)] ? `player-${providerToPlayer[String(row.id)]}` : `api-${row.id}`;
  for (const list of lists) for (const row of list.players) listedBy.set(keyOf(row), [...(listedBy.get(keyOf(row)) ?? []), list.clubId]);
  // Latest 2026-27 game per player (club and date).
  const latest = new Map();
  for (const item of games) { const id = `player-${item.p}`, old = latest.get(id); if (!old || item.d > old.date || item.d === old.date && item.m > old.minutes) latest.set(id, { clubId: `club-${item.c}`, date: item.d, minutes: item.m }); }
  const confirmed = player => !inRun.has(player.clubId) && player.profileEvidence?.membership === 'official-registration-observed';
  const profile = typicalProfiles(pack);
  const moves = new Map(), additions = new Map(), notes = [];
  const sourcesOf = clubId => { const list = lists.find(item => item.clubId === clubId); return list ? [apiUrl(list.team)] : []; };
  const move = (player, to, why, sources) => { if (to === player.clubId || moves.has(player.id)) return; moves.set(player.id, { player, to, why, sources }); };

  for (const list of lists) for (const row of list.players) {
    const id = keyOf(row), player = players.get(id), last = latest.get(id);
    if (player) {
      if (player.clubId === list.clubId) continue;
      if (last) { if (last.clubId === list.clubId) move(player, list.clubId, `latest 2026-27 game for ${clubs.get(list.clubId).name} (${last.date})`, sourcesOf(list.clubId)); continue; }
      if (confirmed(player)) { notes.push({ player: player.name, listedBy: clubs.get(list.clubId).name, keptAt: clubs.get(player.clubId)?.name, reason: 'confirmed at his club by an earlier current roster; no 2026-27 game' }); continue; }
      if (inRun.has(player.clubId) && !(listedBy.get(id) ?? []).includes(player.clubId)) move(player, list.clubId, `listed by ${clubs.get(list.clubId).name}, no longer by ${clubs.get(player.clubId).name}`, sourcesOf(list.clubId));
      else notes.push({ player: player.name, listedBy: clubs.get(list.clubId).name, keptAt: clubs.get(player.clubId)?.name, reason: 'listed by both clubs; no 2026-27 game' });
      continue;
    }
    // Not in the pack: added where his latest game was, or where the only listing club is.
    const where = last ? last.clubId : (listedBy.get(id) ?? []).length === 1 ? list.clubId : null;
    if (where !== list.clubId) { if (!where) notes.push({ player: row.name, listedBy: (listedBy.get(id) ?? []).map(clubId => clubs.get(clubId).name), reason: 'listed by several clubs without a 2026-27 game; not added' }); continue; }
    if (additions.has(id)) continue;
    additions.set(id, { row, clubId: list.clubId, known: knownById.get(bare(id)), team: list.team, last });
  }
  // Later transfers seen in the box scores, for every pack player of the run's clubs or listed by them.
  for (const [id, last] of latest) {
    const player = players.get(id);
    if (!player || !clubs.has(last.clubId) || last.clubId === player.clubId || moves.has(id)) continue;
    if (!inRun.has(player.clubId) && !inRun.has(last.clubId)) continue;
    if (confirmed(player) && !(listedBy.get(id) ?? []).includes(last.clubId)) continue;
    move(player, last.clubId, `latest 2026-27 game for ${clubs.get(last.clubId).name} (${last.date})`, sourcesOf(last.clubId).length ? sourcesOf(last.clubId) : sourcesOf(player.clubId));
  }

  const rows = [], review = { batch, observedOn, moved: [], added: [], droppedDuplicates: [], notes };
  for (const { player, to, why, sources } of moves.values()) {
    rows.push({ entity_type: 'player', entity_id: bare(player.id), field: 'club_id', value: { value: bare(to), sources, observedOn, method: 'api-sports-list-and-box-scores', from: bare(player.clubId), batch }, reason: `Moved to ${clubs.get(to).name}: ${why} (API-Sports, ${observedOn}).` });
    review.moved.push({ player: player.name, from: clubs.get(player.clubId)?.name, to: clubs.get(to).name, why });
  }
  // Additions per club, keeping the club's earlier added players (the stored list is replaced as a whole) except an
  // earlier entry that is the same person as a player now at the club.
  const atClub = clubId => [...pack.players.filter(player => (moves.get(player.id)?.to ?? player.clubId) === clubId && !player.id.startsWith('player-n')), ...[...moves.values()].filter(item => item.to === clubId).map(item => item.player)];
  const usedIds = new Set(pack.players.map(player => player.id));
  const byClub = new Map();
  for (const item of additions.values()) byClub.set(item.clubId, [...(byClub.get(item.clubId) ?? []), item]);
  const touched = new Set([...byClub.keys(), ...[...moves.values()].map(item => item.to)]);
  for (const clubId of touched) {
    const stored = clubRows.find(row => `club-${row.entity_id}` === clubId);
    const present = atClub(clubId);
    const earlier = (stored?.value.value ?? []).filter(item => {
      const twin = present.find(player => samePerson(player.name, item.name));
      if (twin) review.droppedDuplicates.push({ club: clubs.get(clubId).name, dropped: item.name, keeps: twin.name });
      return !twin;
    });
    const twins = (stored?.value.value ?? []).filter(item => !earlier.includes(item));
    // The kept player takes the dropped entry's facts (full name, birth date) from its source.
    for (const item of twins) {
      const twin = present.find(player => samePerson(player.name, item.name));
      const facts = { sources: stored.value.sources, observedOn: stored.value.observedOn, method: 'same-player-earlier-addition', batch };
      if (item.name !== twin.name) rows.push({ entity_type: 'player', entity_id: bare(twin.id), field: 'full_name', value: { value: item.name, ...facts }, reason: `${item.name} in ${clubs.get(clubId).name}'s earlier current roster is the same player.` });
      if (item.birthDate) rows.push({ entity_type: 'player', entity_id: bare(twin.id), field: 'birth_date', value: { value: item.birthDate, ...facts }, reason: `${item.name} in ${clubs.get(clubId).name}'s earlier current roster is the same player.` });
    }
    const fresh = (byClub.get(clubId) ?? []).map(({ row, known: data, last }) => {
      const fix = data?.overrides ?? {};
      const name = data?.name ?? row.name;
      const parsed = rosterPosition(row.position ?? data?.position);
      const exact = fix.position?.value ?? null;
      const group = parsed.group ?? (exact ? Object.keys(GROUP_POSITIONS).find(key => GROUP_POSITIONS[key].includes(exact)) : null);
      // Within a broad group, the position his statistics gave (the ratings' rule), else the group's usual one.
      const rated = data?.rating?.game_position;
      const position = exact ?? (group ? (GROUP_POSITIONS[group].includes(rated) ? rated : GROUP_DEFAULT[group]) : rated ?? 'SF');
      const born = fix.birth_date?.value ?? null;
      const opening = `${pack.season.slice(0, 4)}-09-05`;
      const age = born ? Number(opening.slice(0, 4)) - Number(born.slice(0, 4)) - Number(opening.slice(5) < born.slice(5)) : Number.isInteger(row.age) ? row.age : data?.age ?? null;
      const height = fix.height_cm?.value ?? null;
      let id = `player-n${createHash('sha256').update(`${fold(name)}|${born ?? ''}`).digest('hex').slice(0, 24)}`;
      if (usedIds.has(id)) id = `player-n${createHash('sha256').update(`${fold(name)}|${born ?? ''}|${clubId}`).digest('hex').slice(0, 24)}`;
      usedIds.add(id);
      const okAge = age !== null && age >= 14 && age <= 60;
      const positionSource = exact ? (fix.position.community ? 'provider' : 'official') : 'estimated';
      review.added.push({ club: clubs.get(clubId).name, name, position, positionSource, latestGame: last?.date ?? null, provider: data ? 'database player (left or new this season)' : 'new API-Sports player' });
      return { id, name, number: /^\d{1,2}$/.test(String(row.number ?? '')) ? Number(row.number) : null, position, positionSource, nationality: row.country ?? data?.nationality ?? null,
        age: okAge ? age : null, ...(okAge && born ? { birthDate: born } : {}), heightCm: height ?? BUILD[position][0], weightKg: BUILD[position][1], attributes: profile[position],
        estimated: ['all-abilities', ...(height ? [] : ['height_cm']), 'weight_kg', ...(okAge && born ? [] : ['age-unverified']), ...(exact ? [] : ['game_position'])] };
    });
    if (!fresh.length && earlier.length === (stored?.value.value ?? []).length) continue;
    const list = [...earlier, ...fresh];
    const team = lists.find(item => item.clubId === clubId)?.team;
    const sources = [...new Set([...(stored?.value.sources ?? []), ...(team ? [apiUrl(team)] : [])])];
    rows.push({ entity_type: 'club', entity_id: bare(clubId), field: 'added_players', value: { value: list, sources, observedOn, method: 'in-current-roster-not-in-pack', batch }, reason: `${list.length} current players missing from the pack (API-Sports team list and box scores, ${observedOn}${stored ? `; earlier: ${stored.value.sources.map(url => new URL(url).hostname).join(', ')}` : ''}).` });
  }
  return { rows, review };
}

/** A club with no team this season: earlier blocked moves go ahead, everyone else leaves. */
export function withdrawClub({ pack, clubId, blocked = [], source, observedOn, batch }) {
  const clubs = new Map(pack.clubs.map(club => [club.id, club]));
  const rows = [], review = { club: clubs.get(clubId)?.name, moved: [], left: [] };
  for (const player of pack.players.filter(item => item.clubId === clubId)) {
    const hold = blocked.find(item => item.entity_id === bare(player.id) && item.value.method === 'kept-for-minimum-squad');
    if (hold && clubs.has(`club-${hold.value.listedAt}`)) {
      rows.push({ entity_type: 'player', entity_id: bare(player.id), field: 'club_id', value: { value: hold.value.listedAt, sources: [...new Set([...hold.value.sources, source])], observedOn, method: 'club-withdrawn-earlier-roster-move', from: bare(clubId), batch }, reason: `Moved to ${clubs.get(`club-${hold.value.listedAt}`).name}: listed in its current roster (${hold.value.observedOn}); ${clubs.get(clubId).name} has no team in 2026-27.` });
      review.moved.push({ player: player.name, to: clubs.get(`club-${hold.value.listedAt}`).name });
    } else {
      rows.push({ entity_type: 'player', entity_id: bare(player.id), field: 'squad_status', value: { value: 'left', sources: [source], observedOn, method: 'club-withdrawn', batch }, reason: `${clubs.get(clubId).name} has no team in 2026-27 and no current roster lists him elsewhere.` });
      review.left.push(player.name);
    }
  }
  return { rows, review };
}

/**
 * One file from several batches: one row per entity and field (later batches may not repeat a key). A player the
 * first batch moves by his latest game is not also removed by a later batch whose roster page no longer lists him:
 * that leave is dropped and reported.
 */
export function combineBatches({ pack, batches, batch, observedOn }) {
  const rows = [], seen = new Map(), problems = [], dropped = [];
  const players = new Map(pack.players.map(player => [bare(player.id), player])), clubs = new Set(pack.clubs.map(club => bare(club.id)));
  const movedByGames = new Set(batches[0]?.rows.filter(row => row.field === 'club_id').map(row => row.entity_id) ?? []);
  const addedIds = new Map();
  for (const [index, file] of batches.entries()) for (const row of file.rows) {
    const key = `${row.entity_type}/${row.entity_id}/${row.field}`;
    if (index > 0 && row.field === 'squad_status' && movedByGames.has(row.entity_id)) { dropped.push({ row, reason: 'moved by his latest game in the first batch' }); continue; }
    if (seen.has(key)) { problems.push(`${key} in ${seen.get(key)} and ${file.batch}`); continue; }
    seen.set(key, file.batch);
    if (row.entity_type === 'player' && !players.has(row.entity_id)) problems.push(`unknown player ${row.entity_id}`);
    if (row.entity_type === 'club' && !clubs.has(row.entity_id)) problems.push(`unknown club ${row.entity_id}`);
    if (row.field === 'club_id' && !clubs.has(row.value.value)) problems.push(`unknown destination club ${row.value.value}`);
    // An added id is new, or an earlier addition listed again by the same club.
    if (row.field === 'added_players') for (const item of row.value.value) { const earlier = players.get(bare(item.id)); if (addedIds.has(item.id) || earlier && earlier.clubId !== `club-${row.entity_id}`) problems.push(`added player id ${item.id} twice`); addedIds.set(item.id, row.entity_id); }
    rows.push(row);
  }
  // A player may not both leave and move.
  const leaving = new Set(rows.filter(row => row.field === 'squad_status').map(row => row.entity_id));
  for (const row of rows) if (row.field === 'club_id' && leaving.has(row.entity_id)) problems.push(`player ${row.entity_id} both leaves and moves`);
  return { file: { model: 'profile-overrides-1', batch, observedOn, rows }, problems, dropped };
}

async function main() {
  const argument = name => { const index = process.argv.indexOf(name); return index > 0 ? process.argv[index + 1] : null; };
  const read = async file => JSON.parse(await readFile(file, 'utf8'));
  const out = argument('--out'), observedOn = argument('--observed-on') ?? new Date().toISOString().slice(0, 10), batch = argument('--batch') ?? `api-squads-${observedOn}`;
  if (!argument('--pack') || !out) throw new Error('Usage: see the header of scripts/real-data-api-squads.mjs');
  if (existsSync(out)) throw new Error(`${out} exists; choose a new output file.`);
  const envelope = await read(argument('--pack')), pack = envelope.pack ?? envelope;
  const competition = pack.competitions.find(item => item.name === argument('--competition'));
  if (!competition) throw new Error(`No competition ${argument('--competition')} in the pack.`);
  const matches = new Map((await read(argument('--club-map'))).clubs.map(item => [item.clubId, item.apiSportsTeamId]));
  const lists = [];
  for (const clubId of competition.clubIds) {
    const team = matches.get(clubId);
    if (!team) throw new Error(`${clubId} has no API-Sports team.`);
    const body = await read(path.join(argument('--api-dir'), `players-${team}.json`));
    if (body.errors && Object.keys(body.errors).length || !Array.isArray(body.response)) throw new Error(`players-${team}.json is not a valid API-Sports answer.`);
    lists.push({ clubId, team, players: body.response });
  }
  const squads = apiSquads({ pack, lists, providerToPlayer: await read(argument('--provider-map')), games: await read(argument('--games')), known: argument('--known') ? await read(argument('--known')) : [], clubRows: argument('--club-rows') ? await read(argument('--club-rows')) : [], observedOn, batch });
  const parts = [{ batch, rows: squads.rows }];
  let withdrawn = null;
  if (argument('--withdraw')) {
    withdrawn = withdrawClub({ pack, clubId: argument('--withdraw'), blocked: argument('--blocked') ? await read(argument('--blocked')) : [], source: argument('--withdraw-source'), observedOn, batch });
    parts.push({ batch, rows: withdrawn.rows });
  }
  const merged = (argument('--merge') ?? '').split(',').filter(Boolean);
  for (const file of merged) parts.push(await read(file));
  const { file, problems, dropped } = combineBatches({ pack, batches: parts, batch, observedOn });
  if (problems.length) throw new Error(`Batch refused:\n${problems.join('\n')}`);
  await writeFile(out, JSON.stringify(file, null, 1));
  const name = id => pack.players.find(player => player.id === `player-${id}`)?.name ?? id;
  await writeFile(out.replace(/\.json$/, '-review.json'), JSON.stringify({ ...squads.review, withdrawn: withdrawn?.review ?? null, merged, droppedFromMerged: dropped.map(item => ({ player: name(item.row.entity_id), field: item.row.field, batch: item.row.value.batch, reason: item.reason })) }, null, 1));
  const added = squads.review.added.length;
  console.log(`${competition.name}: ${squads.review.moved.length} moved, ${added} added, ${squads.review.droppedDuplicates.length} duplicate entries dropped${withdrawn ? `; ${withdrawn.review.club}: ${withdrawn.review.moved.length} moved, ${withdrawn.review.left.length} left` : ''}; ${file.rows.length} rows in all.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
