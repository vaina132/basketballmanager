// Publishes a playable real-club data pack built from the database into the public `game-data` bucket, so the game
// can start real-club careers on any device (owner decision, 15 November 2026). It mirrors `buildPack` in
// scripts/real-data-pack.mjs for dataset version 2026.11-world-1. It never replaces a pack already in the bucket:
// the owner's newer, corrected pack (uploaded with `npm run data:publish`) always wins.
import { createClient } from 'npm:@supabase/supabase-js@2';

const VERSION = '2026.11-world-1', SEASON = '2026-27', OBJECT = 'real-pack.json';
const ABILITIES = ['two_point', 'three_point', 'free_throw', 'passing', 'defense', 'rebounding', 'stamina'];
const GAME_KEYS: Record<string, string> = { two_point: 'twoPoint', three_point: 'threePoint', free_throw: 'freeThrow', passing: 'passing', defense: 'defense', rebounding: 'rebounding', stamina: 'stamina' };
const UNRATED = { ability: 9, position: { Guard: 'SG', Forward: 'SF', Center: 'C' } as Record<string, string>, build: { PG: [188, 84], SG: [194, 89], SF: [200, 97], PF: [206, 106], C: [211, 113] } as Record<string, [number, number]> };

function resolvePosition(raw: unknown, previous: string) {
  const normalized = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  const exact = ({ pg: 'PG', sg: 'SG', sf: 'SF', pf: 'PF', c: 'C', 'point guard': 'PG', 'shooting guard': 'SG', 'small forward': 'SF', 'power forward': 'PF', center: 'C', centre: 'C' } as Record<string, string>)[normalized];
  if (exact) return { position: exact, estimated: false };
  const choices = ({ guard: ['PG', 'SG'], forward: ['SF', 'PF'] } as Record<string, string[]>)[normalized];
  return { position: choices ? choices.includes(previous) ? previous : choices[1] === 'SG' ? 'SG' : 'SF' : previous, estimated: true };
}

async function sha256(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async () => {
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  // A pack the owner published is never replaced from here; an earlier starter build of this function is.
  const { data: existing } = await client.storage.from('game-data').download(OBJECT);
  if (existing) {
    const version = String(JSON.parse(await existing.text())?.pack?.version ?? '');
    if (!version.startsWith(`${VERSION}-online`)) return json({ status: 'exists', version, note: 'The owner\'s pack is published; it is never replaced from here.' });
  }
  const all = async (table: string, columns: string, apply: (query: any) => any = query => query) => {
    const rows: any[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await apply(client.from(table).select(columns)).range(from, from + 999);
      if (error) throw new Error(`${table}: ${error.message}`);
      rows.push(...data);
      if (data.length < 1000) return rows;
    }
  };
  try {
    const [versionRow] = await all('dataset_versions', '*', query => query.eq('id', VERSION));
    if (!versionRow) return json({ status: 'failed', error: `No dataset version ${VERSION}` }, 500);
    const seasons = await all('seasons', 'id,competition_id,competitions(id,name,country,tier,kind)', query => query.eq('label', SEASON));
    const seasonIds = seasons.map(row => row.id);
    const participations = await all('participations', 'season_id,club_id', query => query.in('season_id', seasonIds));
    const competitions = seasons.map(row => ({ ...row.competitions, clubIds: participations.filter(item => item.season_id === row.id).map(item => item.club_id) }));
    const memberships = await all('roster_memberships', 'player_id,club_id,shirt_number,first_seen_on,last_seen_on', query => query.in('season_id', seasonIds));
    const clubs = await all('clubs', 'id,name,short_name,country,city,venue,color_primary,color_secondary,identity_source');
    const players = await all('players', 'id,full_name,nationality,position,age_observed,merged_into');
    const ratings = await all('player_ratings', '*', query => query.eq('dataset_version_id', VERSION));
    const rules = [...new Set(ratings.map(rating => rating.method?.rules).filter(Boolean))].sort().join(', ');
    const source = { provider: 'API-SPORTS (API-BASKETBALL)', importRun: versionRow.source_run_id, ratings: rules || 'unknown', ratingsNote: versionRow.notes };

    const clubById = new Map(clubs.map(club => [club.id, club]));
    const playerById = new Map(players.filter(player => !player.merged_into).map(player => [player.id, player]));
    const ratingById = new Map(ratings.map(rating => [rating.player_id, rating]));
    const latest = new Map<string, any>();
    for (const row of memberships) {
      if (!playerById.has(row.player_id)) continue;
      const previous = latest.get(row.player_id);
      if (!previous || row.last_seen_on > previous.last_seen_on || row.last_seen_on === previous.last_seen_on && row.first_seen_on > previous.first_seen_on) latest.set(row.player_id, row);
    }
    const packPlayers = [...latest.values()].map(row => {
      const player = playerById.get(row.player_id), rating = ratingById.get(row.player_id);
      const resolution = resolvePosition(player.position, rating?.game_position ?? UNRATED.position[player.position] ?? 'SF');
      const position = resolution.position;
      const [height, weight] = rating ? [rating.height_cm, rating.weight_kg] : UNRATED.build[position];
      const attributes = Object.fromEntries(ABILITIES.map(key => [GAME_KEYS[key], rating ? rating[key] : UNRATED.ability]));
      return {
        id: `player-${row.player_id}`, name: player.full_name, clubId: `club-${row.club_id}`, number: row.shirt_number ?? null, position,
        nationality: player.nationality ?? null, age: player.age_observed ?? null, heightCm: height, weightKg: weight, attributes,
        // Sprint 4 rating fairness: the minutes behind the ratings.
        ...(rating && Number.isFinite(rating.method?.weightedMinutes) ? { ratingMinutes: Math.round(rating.method.weightedMinutes) } : {}),
        estimated: [...new Set([...(rating ? rating.estimated.filter((field: string) => field !== 'game_position') : ['all-abilities', 'height_cm', 'weight_kg']), 'age-unverified', ...(resolution.estimated ? ['game_position'] : [])])],
      };
    }).sort((a, b) => a.clubId.localeCompare(b.clubId) || a.name.localeCompare(b.name));
    const squads = new Map<string, string[]>();
    for (const player of packPlayers) squads.set(player.clubId, [...(squads.get(player.clubId) ?? []), player.id]);
    const clubIds = [...new Set(competitions.flatMap(competition => competition.clubIds))];
    const packClubs = clubIds.map(id => clubById.get(id)).filter(Boolean).map(club => ({
      id: `club-${club.id}`, name: club.name, shortName: club.short_name ?? club.name.slice(0, 3).toUpperCase(), country: club.country ?? null, city: club.city ?? null, arena: club.venue ?? null,
      color: club.color_primary ?? null, secondaryColor: club.color_secondary ?? null, identitySource: club.identity_source ?? null, playerIds: squads.get(`club-${club.id}`) ?? [],
    })).sort((a, b) => a.name.localeCompare(b.name));
    const packCompetitions = competitions.map(competition => ({ id: `competition-${competition.id}`, name: competition.name, country: competition.country ?? null, tier: competition.tier, kind: competition.kind, season: SEASON, clubIds: competition.clubIds.map((id: string) => `club-${id}`).sort() }));
    const base = { format: 'basketball-manager-data-pack', formatVersion: 1, season: SEASON, source, competitions: packCompetitions, clubs: packClubs, players: packPlayers };
    // The same contents as the recorded pack, for checking the rebuild against its checksum.
    const recorded = await sha256(JSON.stringify({ format: base.format, formatVersion: 1, version: VERSION, season: SEASON, source, notice: 'Private evaluation data from API-SPORTS. Rights for publication or distribution are not cleared; do not upload or share.', competitions: packCompetitions, clubs: packClubs, players: packPlayers }));
    const pack = { format: base.format, formatVersion: 1, version: `${VERSION}-online-2`, season: SEASON, source, notice: 'Real club data from API-SPORTS, published with the game by its owner (15 November 2026).', competitions: packCompetitions, clubs: packClubs, players: packPlayers };
    const checksum = await sha256(JSON.stringify(pack));
    const text = JSON.stringify({ checksum, writtenAt: new Date().toISOString(), pack });
    const { error } = await client.storage.from('game-data').upload(OBJECT, new Blob([text], { type: 'application/json' }), { upsert: true, contentType: 'application/json', cacheControl: '300' });
    if (error) return json({ status: 'failed', error: error.message }, 500);
    return json({ status: 'published', version: pack.version, competitions: packCompetitions.length, clubs: packClubs.length, players: packPlayers.length, bytes: text.length, matchesRecordedChecksum: recorded === versionRow.checksum });
  } catch (error) {
    return json({ status: 'failed', error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
