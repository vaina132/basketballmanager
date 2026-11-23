#!/usr/bin/env node
/**
 * NBA into the real pack (docs/nba-plan.md steps 1-2, 23 November 2026). From the reviewed NBA data
 * (scripts/real-data-nba.mjs) and its ratings (scripts/real-data-nba-ratings.mjs) it writes:
 *
 * --sql FILE        the database rows the publishing function reads: the NBA competition (API-Sports league 12, with
 *                   its conferences and divisions in `groups`), its 2026-27 season, the 30 clubs (identity, arena,
 *                   `capacity`, API-Sports team ids) and their participations. Idempotent (on conflict do nothing /
 *                   update). Needs migration 20261123120000_nba_groups_capacity.sql.
 * --overrides FILE  a profile-overrides-1 batch for import-profile-overrides: one `added_players` row per NBA club
 *                   (the club's standard-contract roster with positions, heights, birth dates, nationalities and the
 *                   rating-4 abilities, `ratingMinutes` and `ratingGames`).
 * --coaches FILE    src/data/real-coaches.ts: rewrites its NBA head coaches block (REAL_NBA_COACHES, REAL_NBA_COACH_POSTS).
 * --out FILE        an offline preview: the live pack (--live) with the NBA added exactly as publish-starter-pack v8
 *                   adds it, the NBA balanced on its own; every European entry is copied unchanged.
 *
 *   node scripts/real-data-nba-pack.mjs --data nba-data.json --ratings nba-ratings.json --live real-pack.json \
 *     --version 2026.11-world-14-online --sql nba.sql --overrides nba-overrides.json --out preview.json
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { balanceRatings } from '../supabase/functions/publish-starter-pack/rating-balance.ts';

const SEASON = '2026-27';
const sql = value => value === null || value === undefined ? 'null' : typeof value === 'number' ? String(value) : `'${String(value).replace(/'/g, "''")}'`;
const groupId = name => `nba-${name.toLowerCase()}`;

/** The NBA's groups as the database stores them (club uuids): conferences first, then divisions with `parentId`. */
export function nbaGroups(data) {
  const uuidOf = new Map(data.clubs.map(club => [club.name, club.uuid]));
  const conferences = Object.entries(data.divisions).map(([conference, divisions]) => ({ id: groupId(conference), name: `${conference} Conference`, clubIds: Object.values(divisions).flat().map(name => uuidOf.get(name)).sort() }));
  const divisions = Object.entries(data.divisions).flatMap(([conference, list]) => Object.entries(list).map(([division, names]) => ({ id: groupId(division), name: `${division} Division`, parentId: groupId(conference), clubIds: names.map(name => uuidOf.get(name)).sort() })));
  return [...conferences, ...divisions];
}

/** One club's added players as import-profile-overrides stores them (and publish-starter-pack reads them). */
export function addedPlayers(club, players) {
  return players.filter(player => player.clubId === club.id).map(player => ({
    id: player.id, name: player.name, number: player.number, position: player.position, positionSource: player.positionSource, nationality: player.nationality ?? null, age: player.age,
    ...(player.birthDate ? { birthDate: player.birthDate } : {}), heightCm: player.heightCm, weightKg: player.weightKg, attributes: player.attributes,
    ...(Number.isFinite(player.ratingMinutes) ? { ratingMinutes: player.ratingMinutes, ratingGames: player.ratingGames } : {}), estimated: player.estimated,
  })).sort((a, b) => a.name.localeCompare(b.name));
}

export function nbaSql(data) {
  const competition = data.competition, groups = nbaGroups(data);
  const lines = ['begin;',
    `insert into competitions (id, name, country, tier, kind, groups) values (${sql(competition.uuid)}, 'NBA', 'USA', 1, 'domestic', ${sql(JSON.stringify(groups))}::jsonb) on conflict (id) do update set groups = excluded.groups;`,
    `insert into competition_provider_ids (provider, provider_id, competition_id) values ('api-sports', '12', ${sql(competition.uuid)}) on conflict do nothing;`,
    `insert into seasons (competition_id, label, provider_season, starts_on, ends_on) values (${sql(competition.uuid)}, '${SEASON}', '2026-2027', '2026-10-20', '2027-06-20') on conflict (competition_id, label) do nothing;`,
  ];
  for (const club of data.clubs) {
    lines.push(`insert into clubs (id, name, short_name, country, city, venue, color_primary, color_secondary, identity_source, capacity) values (${[club.uuid, club.name, club.shortName, club.country, club.city, club.arena, club.color, club.secondaryColor, 'Wikipedia team, roster and arena articles (CC BY-SA 4.0), 23 November 2026', club.capacity].map(sql).join(', ')}) on conflict (id) do update set name = excluded.name, short_name = excluded.short_name, country = excluded.country, city = excluded.city, venue = excluded.venue, color_primary = excluded.color_primary, color_secondary = excluded.color_secondary, identity_source = excluded.identity_source, capacity = excluded.capacity, updated_at = now();`);
    lines.push(`insert into club_provider_ids (provider, provider_id, club_id) values ('api-sports', ${sql(String(club.apiTeamId))}, ${sql(club.uuid)}) on conflict do nothing;`);
  }
  lines.push(`insert into participations (season_id, club_id) select s.id, c.id from seasons s, clubs c where s.competition_id = ${sql(competition.uuid)} and s.label = '${SEASON}' and c.id in (${data.clubs.map(club => sql(club.uuid)).join(', ')}) on conflict do nothing;`, 'commit;');
  return `${lines.join('\n')}\n`;
}

export function nbaOverrides(data, rated, batch) {
  return {
    model: 'profile-overrides-1', batch, observedOn: data.observedOn,
    rows: data.clubs.map(club => {
      const players = addedPlayers(club, rated.players);
      const sources = [...new Set([...club.sources.slice(0, 1), ...rated.players.filter(player => player.clubId === club.id).flatMap(player => player.sources.slice(1)), `https://v1.basketball.api-sports.io/players?team=${club.apiTeamId}&season=2026-2027`])];
      return { entity_type: 'club', entity_id: club.uuid, field: 'added_players', reason: `NBA 2026-27 standard-contract roster of the ${club.name} (Wikipedia roster template, two-way players left out), rated from API-Sports box scores with rating-4 and its NBA impact score with adjusted plus-minus (scripts/real-data-nba-ratings.mjs). Owner permission 23 November 2026.`, value: { value: players, sources, observedOn: data.observedOn } };
    }),
  };
}

/** The NBA's pack entries as publish-starter-pack v8 writes them (before the balance). */
export function nbaPackEntries(data, overrides) {
  const competition = data.competition;
  const players = overrides.rows.flatMap(row => row.value.value.map(added => ({
    id: added.id, name: added.name, clubId: `club-${row.entity_id}`, number: added.number ?? null, position: added.position, nationality: added.nationality ?? null, age: added.age ?? null,
    heightCm: added.heightCm, weightKg: added.weightKg, attributes: added.attributes,
    ...(Number.isFinite(added.ratingMinutes) ? { ratingMinutes: added.ratingMinutes } : {}), ...(Number.isFinite(added.ratingGames) ? { ratingGames: added.ratingGames } : {}),
    estimated: added.estimated, ...(added.birthDate ? { birthDate: added.birthDate } : {}),
    profileEvidence: { observedAt: String(row.value.observedOn), positionSource: added.positionSource, membership: 'official-registration-observed', sources: row.value.sources },
  })));
  const clubs = data.clubs.map(club => ({
    id: club.id, name: club.name, shortName: club.shortName, country: club.country, city: club.city, arena: club.arena, color: club.color, secondaryColor: club.secondaryColor,
    identitySource: 'Wikipedia team, roster and arena articles (CC BY-SA 4.0), 23 November 2026', playerIds: players.filter(player => player.clubId === club.id).sort((a, b) => a.name.localeCompare(b.name)).map(player => player.id), ...(Number.isInteger(club.capacity) ? { capacity: club.capacity } : {}),
  }));
  const packCompetition = { id: competition.id, name: 'NBA', country: 'USA', tier: 1, kind: 'domestic', season: SEASON, clubIds: data.clubs.map(club => club.id).sort(), groups: nbaGroups(data).map(group => ({ id: group.id, name: group.name, ...(group.parentId ? { parentId: group.parentId } : {}), clubIds: group.clubIds.map(id => `club-${id}`).sort() })) };
  return { competition: packCompetition, clubs, players };
}

export function previewPack(live, entries, version) {
  const pack = live.pack ?? live;
  const { players: balanced, summary } = balanceRatings(entries.players, [entries.competition]);
  const players = [...pack.players, ...balanced].sort((a, b) => a.clubId.localeCompare(b.clubId) || a.name.localeCompare(b.name));
  const clubs = [...pack.clubs, ...entries.clubs].sort((a, b) => a.name.localeCompare(b.name));
  const source = { ...pack.source, ratingBalanceUsa: summary, nbaRatings: 'rating-4: NBA box scores (API-SPORTS league 12, 2025-26 and 2026-27) on the European scale of rating-3, the NBA level fitted with the European levels fixed (scripts/real-data-nba-ratings.mjs); NBA facts from Wikipedia (CC BY-SA 4.0) and Wikidata.' };
  const next = { ...pack, version, source, competitions: [...pack.competitions, entries.competition], clubs, players };
  const checksum = createHash('sha256').update(JSON.stringify(next)).digest('hex');
  return { checksum, writtenAt: new Date().toISOString(), pack: next };
}

const slug = name => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').replace(/ł/gi, 'l').replace(/ı/g, 'i').replace(/ß/g, 'ss').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
/** Nationalities checked by hand where the coach's infobox states none (both American per their articles). */
const COACH_NATIONALITY = { 'Steve Kerr': 'USA', 'Mitch Johnson': 'USA' };
const MARK = ['// NBA head coaches: generated by scripts/real-data-nba-pack.mjs --coaches. Do not edit by hand.', '// End of NBA head coaches.'];
/**
 * The NBA head coaches block of src/data/real-coaches.ts: the coach of each NBA club from its roster template, with the
 * facts of his own article read as for Europe (scripts/real-data-coaches.mjs). Job level 4 (the formula's highest,
 * a EuroLeague club's) until the career step gives NBA jobs their own level (docs/nba-plan.md step 10). Kept apart
 * from REAL_COACHES/REAL_COACH_POSTS, which the game reads, so European careers stay as they are until the world
 * builder adds the NBA (step 4).
 */
export function nbaCoachesBlock(data) {
  const coaches = data.clubs.filter(club => club.headCoach?.name).map(club => { const coach = club.headCoach; return { id: `coach-${slug(coach.name)}`, name: coach.name, born: coach.born ?? null, nationality: coach.nationality ?? COACH_NATIONALITY[coach.name] ?? null, since: coach.since ?? null, titles: coach.titles ?? { euroleague: 0, europe: 0, league: 0, cup: 0, national: 0, awards: 0 }, level: 4, source: coach.article ?? club.sources[0], club }; });
  const titles = t => `{euroleague: ${t.euroleague},europe: ${t.europe},league: ${t.league},cup: ${t.cup},national: ${t.national},awards: ${t.awards}}`;
  return [MARK[0], `export const REAL_NBA_COACHES_FETCHED_ON = ${JSON.stringify(data.observedOn)};`, '',
    '/** NBA head coaches (docs/nba-plan.md step 1): facts from each coach\'s English Wikipedia article (CC BY-SA 4.0), job level 4; not read by the game yet. */',
    'export const REAL_NBA_COACHES: readonly RealCoach[] = Object.freeze(([',
    ...coaches.map(c => `  { id: ${JSON.stringify(c.id)}, name: ${JSON.stringify(c.name)}, born: ${JSON.stringify(c.born)}, nationality: ${JSON.stringify(c.nationality)}, since: ${JSON.stringify(c.since)}, titles: ${titles(c.titles)}, level: ${c.level}, source: ${JSON.stringify(c.source)} },`),
    '] as RealCoach[]).map(coach => Object.freeze(coach)));', '',
    '/** Each NBA club\'s head coach, from the club\'s Wikipedia roster template. */',
    'export const REAL_NBA_COACH_POSTS: readonly RealCoachPost[] = Object.freeze([',
    ...coaches.map(c => `  { teamId: ${JSON.stringify(c.club.id)}, team: ${JSON.stringify(c.club.name)}, coachId: ${JSON.stringify(c.id)}, source: ${JSON.stringify(c.club.sources[0])} },`),
    ']);', MARK[1]].join('\n');
}
export function withNbaCoaches(text, block) {
  const start = text.indexOf(MARK[0]), end = text.indexOf(MARK[1]);
  return start >= 0 && end > start ? `${text.slice(0, start)}${block}${text.slice(end + MARK[1].length)}` : `${text.trimEnd()}\n\n${block}\n`;
}

function main() {
  const args = process.argv.slice(2), option = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
  const data = JSON.parse(readFileSync(option('--data'), 'utf8')), rated = JSON.parse(readFileSync(option('--ratings'), 'utf8'));
  const overrides = nbaOverrides(data, rated, option('--batch') ?? `nba-1-${data.observedOn}`);
  if (option('--sql')) writeFileSync(option('--sql'), nbaSql(data));
  if (option('--coaches')) writeFileSync(option('--coaches'), withNbaCoaches(readFileSync(option('--coaches'), 'utf8'), nbaCoachesBlock(data)));
  if (option('--overrides')) writeFileSync(option('--overrides'), JSON.stringify(overrides));
  if (option('--out')) {
    const preview = previewPack(JSON.parse(readFileSync(option('--live'), 'utf8')), nbaPackEntries(data, overrides), option('--version'));
    writeFileSync(option('--out'), JSON.stringify(preview));
    console.log(`preview ${preview.pack.version} ${preview.checksum}: ${preview.pack.clubs.length} clubs, ${preview.pack.players.length} players`);
  }
  if (option('--overrides')) console.log(`overrides: ${overrides.rows.length} rows, sha256 ${createHash('sha256').update(readFileSync(option('--overrides'))).digest('hex')}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
