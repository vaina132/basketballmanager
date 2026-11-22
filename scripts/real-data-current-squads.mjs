#!/usr/bin/env node
/**
 * Current squads from the rosters already read (18 November 2026, owner option A). For each club, one current roster
 * defines its squad: the official league site first, then the EuroLeague/EuroCup registrations, the BCL page,
 * Wikipedia and the club's own site (a roster counts only with at least nine players). Then:
 *
 * - a pack player on his club's roster stays;
 * - a pack player on another club's roster moves there (same full name found once, or initial and surname with the
 *   same shirt number), with that roster's position;
 * - a pack player on no roster leaves the pack when his club's roster is known (players of clubs without a roster
 *   stay as they are);
 * - a roster player missing from the pack is added with a stable id, the roster's position, number, height and birth
 *   date, and estimated abilities (the position's typical profile; the game lifts players without statistics to their
 *   club's level, src/world/rating-fairness.ts), marked internally as 'all-abilities'.
 *
 * The result is a file of `manual_overrides` rows for import-profile-overrides: player `club_id` and `squad_status`,
 * player `position` for moved players, and club `added_players`.
 *
 *   node scripts/real-data-current-squads.mjs --pack PACK.json --rosters A.json,B.json --official E.json,U.json \
 *     --club-map MAP.json --out SQUADS.json [--observed-on YYYY-MM-DD] [--batch NAME] [--keep-confirmed]
 *
 * --keep-confirmed is for a run over a few clubs' rosters only (the second divisions, 22 November 2026): players
 * confirmed at a club outside the run by an earlier current roster are never moved or added a second time.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchName, nameTokens, rosterPosition, GROUP_POSITIONS, COMMUNITY_SOURCES } from './real-data-official-profiles.mjs';
import { officialPeople } from './real-data-profile-audit.mjs';

const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];
const ATTRIBUTES = ['twoPoint', 'threePoint', 'freeThrow', 'passing', 'defense', 'rebounding', 'stamina'];
const BUILD = { PG: [188, 84], SG: [194, 89], SF: [200, 97], PF: [206, 106], C: [211, 113] };
const OFFICIAL_LEAGUE = new Set(['acb.com', 'baloncestoenvivo.feb.es', 'easycredit-bbl.de', 'esake.gr', 'legabasket.it', 'legapallacanestro.com', 'anadoluefessk.org']);
const rank = name => OFFICIAL_LEAGUE.has(name) ? 1 : name === 'euroleague-eurocup' ? 2 : name === 'championsleague.basketball' ? 3 : COMMUNITY_SOURCES.has(name) ? 4 : 5;
const MINIMUM_ROSTER = 9, MINIMUM_SQUAD = 8;
const fold = text => String(text).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
const fullKey = name => { const words = nameTokens(name).filter(word => !['jr', 'jr.', 'sr', 'ii', 'iii', 'iv'].includes(word)); return words.length >= 2 && words.every(word => !word.endsWith('.')) ? [...words].sort().join(' ') : null; };
const titled = name => name === name.toUpperCase() ? name.toLowerCase().replace(/(^|[\s'’-])\p{L}/gu, letter => letter.toUpperCase()) : name;
/** Display order: "Surname Given" rosters (Serie A2) become "Given Surname". */
const display = row => { const name = titled(row.name.replace(/\s+/g, ' ').trim()); if (!row.surnameFirst) return name; const words = name.split(' '); return [words.at(-1), ...words.slice(0, -1)].join(' '); };

export function currentSquads({ pack, rosters, officialRows = [], codeToClub = new Map(), observedOn, batch, keepConfirmed = false }) {
  // One defining roster per club, the best-ranked with enough players.
  const candidates = new Map();
  // Rows repeated on a page count once; pages with more than 24 players mix teams (a women's or youth roster too).
  const offer = (clubId, sourceName, sources, listed) => { const seen = new Set(), players = listed.filter(row => { const key = fold(row.name).replace(/\s+/g, ' '); return !seen.has(key) && seen.add(key); }); if (players.length < MINIMUM_ROSTER || players.length > 24) return; const list = candidates.get(clubId) ?? []; list.push({ sourceName, sources, players, rank: rank(sourceName) }); candidates.set(clubId, list); };
  for (const file of rosters) for (const club of file.clubs ?? []) offer(club.clubId, club.sourceName ?? file.sourceName, club.sources ?? [file.source], club.players);
  const registrations = new Map();
  for (const row of officialRows) { const clubId = codeToClub.get(row.club.code); if (!clubId) continue; const [surname, given] = row.person.name.split(','); registrations.set(clubId, [...(registrations.get(clubId) ?? []), { name: `${(given ?? '').trim()} ${surname.trim()}`, number: /^\d{1,2}$/.test(row.dorsal ?? '') ? Number(row.dorsal) : null, position: row.positionName, birthDate: row.person.birthDate?.slice(0, 10), heightCm: row.person.height >= 150 && row.person.height <= 240 ? row.person.height : undefined, sourceUrl: row.sourceUrl }]); }
  for (const [clubId, players] of registrations) offer(clubId, 'euroleague-eurocup', [players[0].sourceUrl], players);
  const squads = new Map([...candidates].map(([clubId, list]) => [clubId, list.sort((a, b) => a.rank - b.rank)[0]]));
  const clubs = new Map(pack.clubs.map(club => [club.id, club]));
  const assigned = new Map(); // pack player id -> { clubId, row, method }
  const ordered = [...squads].sort((a, b) => a[1].rank - b[1].rank);
  // First every club's own players, then players found at other clubs.
  for (const [clubId, squad] of ordered) {
    for (const player of pack.players.filter(item => item.clubId === clubId && !assigned.has(item.id))) {
      const found = matchName(player.name, player.number, squad.players.filter(row => !row.taken));
      if (found) { assigned.set(player.id, { clubId, row: found.row, squad, method: found.method, own: true }); found.row.taken = true; }
    }
  }
  // Then, within each club, the players and roster names still unpaired that share one name word no other unpaired
  // player or roster name there has (nicknames and full legal names: "Alejandro Reyes" / "Álex Reyes", "T. Ngom" /
  // "Abdoulaye Tanor Ngom"). Shirt numbers in the provider's data are often old, so they are not required.
  const words = name => [...new Set(nameTokens(name).filter(word => !word.endsWith('.') && word.length >= 3 && !['jr', 'iii'].includes(word)))];
  for (const [clubId, squad] of ordered) {
    const players = pack.players.filter(player => player.clubId === clubId && !assigned.has(player.id)), open = squad.players.filter(row => !row.taken);
    const count = (list, word, of) => list.filter(item => of(item).includes(word)).length;
    for (const player of players) {
      const shared = words(player.name).filter(word => count(players, word, item => words(item.name)) === 1 && count(open, word, row => words(display(row))) === 1);
      const row = shared.length ? open.find(item => !item.taken && words(display(item)).includes(shared.at(-1))) : null;
      if (row) { assigned.set(player.id, { clubId, row, squad, method: 'unique-name-word-within-club', own: true }); row.taken = true; }
    }
  }
  const packKeys = new Map();
  for (const player of pack.players) { const key = fullKey(player.name); if (key) packKeys.set(key, [...(packKeys.get(key) ?? []), player]); }
  const rowKeys = new Map();
  for (const [, squad] of ordered) for (const row of squad.players) { const key = fullKey(display(row)); if (key) rowKeys.set(key, (rowKeys.get(key) ?? 0) + 1); }
  const moves = [], blocked = [], doubles = [];
  // With keepConfirmed (a run over a few clubs only), a player whose own club is not in this run but whose membership
  // there was confirmed by an earlier current roster stays there: the other roster's row is reported, never added.
  const confirmed = player => keepConfirmed && !squads.has(player.clubId) && player.profileEvidence?.membership === 'official-registration-observed';
  for (const [clubId, squad] of ordered) for (const row of squad.players) {
    if (row.taken) continue;
    const key = fullKey(display(row));
    let mover = key && rowKeys.get(key) === 1 && packKeys.get(key)?.length === 1 ? packKeys.get(key)[0] : null;
    if (!mover && Number.isInteger(row.number)) {
      // Initial and surname with the same shirt number, unique in the pack.
      const options = pack.players.filter(player => !assigned.has(player.id) && player.clubId !== clubId && player.number === row.number && matchName(player.name, player.number, [{ name: display(row), number: row.number }])?.method === 'unique-initial-surname-and-club');
      if (options.length === 1) mover = options[0];
    }
    if (!mover || assigned.has(mover.id) || mover.clubId === clubId) continue;
    if (confirmed(mover)) { row.taken = true; doubles.push({ player: mover.name, listedBy: clubs.get(clubId)?.name, keptAt: clubs.get(mover.clubId)?.name, reason: 'confirmed at his club by an earlier current roster' }); continue; }
    // A club without a current roster keeps at least the minimum squad: the player stays there instead (and is not
    // added again at the other club).
    if (!squads.has(mover.clubId)) {
      const remaining = pack.players.filter(player => player.clubId === mover.clubId).length - moves.filter(move => move.from === mover.clubId).length;
      if (remaining - 1 < MINIMUM_SQUAD) { row.taken = true; blocked.push({ player: mover, from: mover.clubId, to: clubId, squad }); continue; }
    }
    // A player whose own club's roster lists him stays there.
    assigned.set(mover.id, { clubId, row, squad, method: 'found-on-another-club-roster', own: false });
    row.taken = true;
    moves.push({ player: mover, from: mover.clubId, to: clubId, row, squad });
  }
  // A roster name still unpaired that names exactly one pack player: never a second copy of him. If he is still
  // unplaced he moves (as above); if another club's roster already holds him, he stays there.
  for (const [clubId, squad] of ordered) for (const row of squad.players) {
    if (row.taken) continue;
    const key = fullKey(display(row)), same = key ? packKeys.get(key) ?? [] : [];
    if (same.length !== 1) continue;
    const player = same[0];
    row.taken = true;
    if (assigned.has(player.id) || player.clubId === clubId || confirmed(player)) { doubles.push({ player: player.name, listedBy: clubs.get(clubId)?.name, keptAt: clubs.get(assigned.get(player.id)?.clubId ?? player.clubId)?.name }); continue; }
    if (!squads.has(player.clubId) && pack.players.filter(item => item.clubId === player.clubId).length - moves.filter(move => move.from === player.clubId).length - 1 < MINIMUM_SQUAD) { blocked.push({ player, from: player.clubId, to: clubId, squad }); continue; }
    assigned.set(player.id, { clubId, row, squad, method: 'found-on-another-club-roster', own: false });
    moves.push({ player, from: player.clubId, to: clubId, row, squad });
  }
  // Typical profile per position (players with 300+ minutes), for added players.
  const profile = Object.fromEntries(POSITIONS.map(position => {
    const rated = pack.players.filter(player => player.position === position && (player.ratingMinutes ?? 0) >= 300);
    return [position, Object.fromEntries(ATTRIBUTES.map(key => { const values = rated.map(player => player.attributes[key]).sort((a, b) => a - b); return [key, values[Math.floor(values.length / 2)] ?? 9]; }))];
  }));
  const rows = [], report = { observedOn, batch, clubsWithRoster: squads.size, moved: 0, left: 0, added: 0, kept: 0, byClub: {} };
  const tally = (clubId, field) => { const name = clubs.get(clubId)?.name ?? clubId; report.byClub[name] ??= { source: squads.get(clubId)?.sourceName ?? null, kept: 0, movedIn: 0, movedOut: 0, left: 0, added: 0 }; report.byClub[name][field] += 1; };
  const reason = (squad, text) => `${text} (current roster: ${squad.sourceName}, ${observedOn}).`;
  const usedIds = new Set(pack.players.map(player => player.id));
  for (const [id, item] of assigned) if (item.own) { report.kept += 1; tally(item.clubId, 'kept'); }
  for (const move of moves) {
    report.moved += 1; tally(move.to, 'movedIn'); tally(move.from, 'movedOut');
    const base = { sources: move.squad.sources, observedOn, method: 'found-on-another-club-roster', from: move.from.replace(/^club-/, '') };
    rows.push({ entity_type: 'player', entity_id: move.player.id.replace(/^player-/, ''), field: 'club_id', value: { value: move.to.replace(/^club-/, ''), ...base, batch }, reason: reason(move.squad, `Moved: listed in ${clubs.get(move.to).name}'s current roster, not in ${clubs.get(move.from)?.name ?? 'his club'}'s`) });
    const parsed = rosterPosition(move.row.position), exact = parsed.options.length === 1 ? parsed.options[0] : null;
    if (exact || parsed.group) rows.push({ entity_type: 'player', entity_id: move.player.id.replace(/^player-/, ''), field: 'position', value: { value: exact, group: parsed.group ?? (exact ? Object.keys(GROUP_POSITIONS).find(group => GROUP_POSITIONS[group].includes(exact)) : null), method: exact ? 'official-roster-exact' : 'official-group-statistics', sources: move.squad.sources, rosterLabel: String(move.row.label ?? move.row.position), rosterMatch: 'found-on-another-club-roster', ...(exact && COMMUNITY_SOURCES.has(move.squad.sourceName) ? { community: true } : {}), observedOn, batch }, reason: reason(move.squad, 'Position from the new club\'s roster') });
  }
  // Players left out of a known current squad leave the pack, unless the club would fall below the minimum.
  for (const [clubId, squad] of squads) {
    const leaving = pack.players.filter(player => player.clubId === clubId && !assigned.has(player.id));
    const stays = pack.players.filter(player => player.clubId === clubId && assigned.get(player.id)?.clubId === clubId).length;
    const incoming = moves.filter(move => move.to === clubId).length, additions = squad.players.filter(row => !row.taken).length;
    if (stays + incoming + additions < MINIMUM_SQUAD) continue;
    for (const player of leaving) {
      report.left += 1; tally(clubId, 'left');
      rows.push({ entity_type: 'player', entity_id: player.id.replace(/^player-/, ''), field: 'squad_status', value: { value: 'left', sources: squad.sources, observedOn, method: 'not-in-current-roster', batch }, reason: reason(squad, `Not in ${clubs.get(clubId).name}'s current roster`) });
    }
    const added = squad.players.filter(row => !row.taken).map(row => {
      const name = display(row), parsed = rosterPosition(row.position);
      const exact = parsed.options.length === 1 ? parsed.options[0] : null;
      const position = exact ?? (parsed.group ? { Guard: 'SG', Forward: 'SF', Center: 'C' }[parsed.group] : parsed.options[0] ?? 'SF');
      let id = `player-n${createHash('sha256').update(`${fold(name)}|${row.birthDate ?? ''}`).digest('hex').slice(0, 24)}`;
      if (usedIds.has(id)) id = `player-n${createHash('sha256').update(`${fold(name)}|${row.birthDate ?? ''}|${clubId}`).digest('hex').slice(0, 24)}`;
      usedIds.add(id);
      const opening = `${pack.season.slice(0, 4)}-09-05`, born = row.birthDate && /^\d{4}-\d{2}-\d{2}$/.test(row.birthDate) ? row.birthDate : null;
      const age = born ? Number(opening.slice(0, 4)) - Number(born.slice(0, 4)) - Number(opening.slice(5) < born.slice(5)) : null;
      const [height, weight] = BUILD[position];
      report.added += 1; tally(clubId, 'added');
      return { id, name, number: row.number ?? null, position, positionSource: exact ? (COMMUNITY_SOURCES.has(squad.sourceName) ? 'provider' : 'official') : 'estimated', nationality: row.nationality ?? null,
        age: age !== null && age >= 14 && age <= 60 ? age : null, ...(age !== null && age >= 14 && age <= 60 ? { birthDate: born } : {}),
        heightCm: row.heightCm ?? height, weightKg: weight, attributes: profile[position],
        estimated: ['all-abilities', ...(row.heightCm ? [] : ['height_cm']), 'weight_kg', ...(age !== null && age >= 14 && age <= 60 ? [] : ['age-unverified']), ...(exact ? [] : ['game_position'])] };
    });
    // Written even when empty, so an earlier stored list for the club is replaced, never left behind.
    rows.push({ entity_type: 'club', entity_id: clubId.replace(/^club-/, ''), field: 'added_players', value: { value: added, sources: squad.sources, observedOn, method: 'in-current-roster-not-in-pack', batch }, reason: reason(squad, `${added.length} current players missing from the pack`) });
  }
  // A blocked move is written as a stay, so an earlier stored move of the same player is replaced (never deleted).
  for (const item of blocked) rows.push({ entity_type: 'player', entity_id: item.player.id.replace(/^player-/, ''), field: 'club_id', value: { value: item.from.replace(/^club-/, ''), sources: item.squad.sources, observedOn, method: 'kept-for-minimum-squad', listedAt: item.to.replace(/^club-/, ''), batch }, reason: reason(item.squad, `Kept at ${clubs.get(item.from)?.name}: listed by ${clubs.get(item.to)?.name}, but his club has no current roster and needs its minimum squad`) });
  report.rows = rows.length;
  report.listedByTwoClubs = doubles;
  report.blockedMoves = blocked.map(item => ({ player: item.player.name, from: clubs.get(item.from)?.name, to: clubs.get(item.to)?.name }));
  return { model: 'profile-overrides-1', batch, observedOn, rows, report };
}

async function main() {
  const argument = name => { const index = process.argv.indexOf(name); return index > 0 ? process.argv[index + 1] : null; };
  const list = name => (argument(name) ?? '').split(',').map(item => item.trim()).filter(Boolean);
  const read = async file => JSON.parse(await readFile(file, 'utf8'));
  const out = argument('--out'), observedOn = argument('--observed-on') ?? new Date().toISOString().slice(0, 10);
  if (!argument('--pack') || !out) throw new Error('Usage: --pack PACK.json --rosters A.json,B.json --official E.json,U.json --club-map MAP.json --out SQUADS.json');
  if (existsSync(out)) throw new Error(`${out} exists; choose a new output file.`);
  const pack = (await read(argument('--pack'))).pack;
  const rosters = (await Promise.all(list('--rosters').map(read))).filter(file => !/wiki-players/.test(file.source ?? '') && file.clubs?.length);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const links = (await read(path.join(root, 'real-data', 'official-club-links.json'))).clubs, map = argument('--club-map') ? await read(argument('--club-map')) : {};
  const codeToClub = new Map(links.filter(link => map[link.apiSportsId]).map(link => [link.officialCode, `club-${map[link.apiSportsId]}`]));
  const official = list('--official').length ? officialPeople(await Promise.all(list('--official').map(read)), observedOn, pack.season.slice(0, 4)) : [];
  const result = currentSquads({ pack, rosters, officialRows: official, codeToClub, observedOn, batch: argument('--batch') ?? `current-squads-${observedOn}`, keepConfirmed: process.argv.includes('--keep-confirmed') });
  await writeFile(out, JSON.stringify(result, null, 1));
  const { report } = result;
  console.log(`Current squads from ${report.clubsWithRoster} club rosters: ${report.kept} kept, ${report.moved} moved, ${report.left} leave, ${report.added} added; ${report.rows} rows.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
