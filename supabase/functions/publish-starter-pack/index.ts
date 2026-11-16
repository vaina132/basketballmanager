// Publishes a playable real-club data pack built from the database into the public `game-data` bucket, so the game
// can start real-club careers on any device (owner decision, 15 November 2026). It mirrors `buildPack` in
// scripts/real-data-pack.mjs for the ratings of dataset version 2026.11-world-1 and applies the reviewed profile
// corrections in `manual_overrides` (owner permission, 16 November 2026: exact positions from official sources;
// broad official roles choose within the group from the player's statistics, as the ratings do).
//
// It acts only on an authorised request: a pending, unexpired `publish-pack` row in `data_change_requests` (written
// only by the service role or the owner's dashboard), which names the new version. `preview` returns the built pack
// for checking with the game's own parser; `publish` uploads it only if its checksum equals the request's
// `expected_sha256`, after copying the current file to `backups/real-pack-<its version>.json`.
//
//   POST /functions/v1/publish-starter-pack   body: { "request": <id>, "mode": "preview" | "publish" }
import { createClient } from 'npm:@supabase/supabase-js@2';

const VERSION = '2026.11-world-1', SEASON = '2026-27', OBJECT = 'real-pack.json';
const ABILITIES = ['two_point', 'three_point', 'free_throw', 'passing', 'defense', 'rebounding', 'stamina'];
const GAME_KEYS: Record<string, string> = { two_point: 'twoPoint', three_point: 'threePoint', free_throw: 'freeThrow', passing: 'passing', defense: 'defense', rebounding: 'rebounding', stamina: 'stamina' };
const UNRATED = { ability: 9, position: { Guard: 'SG', Forward: 'SF', Center: 'C' } as Record<string, string>, build: { PG: [188, 84], SG: [194, 89], SF: [200, 97], PF: [206, 106], C: [211, 113] } as Record<string, [number, number]> };
/** The ratings' build by position (scripts/real-data-ratings.mjs, RATING_RULES.build); estimated builds follow a corrected position. */
const BUILD = UNRATED.build;
const ENTITIES: Record<string, string> = { amp: '&', apos: "'", quot: '"', lt: '<', gt: '>' };
const decode = (text: string) => text.replace(/&(#\d+|[a-z]+);/gi, (all, code) => code[0] === '#' ? String.fromCodePoint(Number(code.slice(1))) : ENTITIES[code.toLowerCase()] ?? all);

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

Deno.serve(async request => {
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  let body: any = null;
  try { body = request.method === 'POST' ? await request.json() : null; } catch { body = null; }
  const mode = body?.mode, id = Number(body?.request);
  if (!['preview', 'publish'].includes(mode) || !Number.isSafeInteger(id)) return json({ status: 'refused', error: 'POST { request, mode: "preview" | "publish" }.' }, 403);
  const { data: ask } = await client.from('data_change_requests').select('*').eq('id', id).maybeSingle();
  if (!ask || ask.kind !== 'publish-pack' || ask.status !== 'pending' || Date.parse(ask.expires_at) < Date.now()) return json({ status: 'refused', error: 'No pending publish request.' }, 403);
  const finish = async (status: 'done' | 'failed', result: Record<string, unknown>, code = 200) => {
    await client.from('data_change_requests').update({ status, result, completed_at: new Date().toISOString() }).eq('id', id).eq('status', 'pending');
    return json({ status, ...result }, code);
  };
  const { data: existing } = await client.storage.from('game-data').download(OBJECT);
  const existingText = existing ? await existing.text() : null;
  const existingVersion = existingText ? (() => { try { return String(JSON.parse(existingText)?.pack?.version ?? ''); } catch { return ''; } })() : null;
  if (existingVersion === ask.version) return json({ status: 'refused', error: `Version ${ask.version} is already published; name a new version.` }, 409);
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
    const overrideRows = await all('manual_overrides', 'entity_id,field,value', query => query.eq('entity_type', 'player').order('id'));
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
    // Within a broad role, the ratings' own rule (scripts/real-data-ratings.mjs): guards above the guards' median
    // assists are point guards; forwards above the forwards' median rebounds who shoot no more threes than their
    // median are power forwards. Medians over players with 300+ weighted minutes whose main competition is a top level.
    const topLevel = new Set(competitions.filter(item => item.tier === 1).map(item => item.name));
    const qualified = ratings.filter(rating => Number(rating.method?.weightedMinutes) >= 300 && topLevel.has(rating.method?.mainCompetition));
    const median = (group: string, key: string) => { const values = qualified.filter(rating => rating.method?.positionGroup === group).map(rating => Number(rating.method?.per40?.[key])).sort((a, b) => a - b); return values[Math.floor(values.length / 2)] ?? 0; };
    const cut = { guardAssists: median('Guard', 'assists'), forwardRebounds: median('Forward', 'rebounds'), forwardThrees: median('Forward', 'threeAttempts') };
    const withinGroup = (group: string, rating: any) => {
      const per40 = rating?.method?.per40;
      if (group === 'Center') return 'C';
      if (!per40) return UNRATED.position[group];
      if (group === 'Guard') return Number(per40.assists) >= cut.guardAssists ? 'PG' : 'SG';
      return Number(per40.rebounds) >= cut.forwardRebounds && Number(per40.threeAttempts) <= cut.forwardThrees ? 'PF' : 'SF';
    };
    const overridesOf = new Map<string, Record<string, any>>();
    for (const row of overrideRows) overridesOf.set(row.entity_id, { ...(overridesOf.get(row.entity_id) ?? {}), [row.field]: row.value });
    const opening = `${SEASON.slice(0, 4)}-09-05`;

    const buildPlayers = (useOverrides: boolean) => [...latest.values()].map(row => {
      const player = playerById.get(row.player_id), rating = ratingById.get(row.player_id);
      const fix = useOverrides ? overridesOf.get(row.player_id) : undefined;
      const official = fix?.position;
      const resolution = official?.value ? { position: official.value as string, estimated: false } : official?.group ? { position: withinGroup(official.group, rating), estimated: true } : resolvePosition(player.position, rating?.game_position ?? UNRATED.position[player.position] ?? 'SF');
      const position = resolution.position;
      const estimatedBuild = !rating || rating.estimated.includes('height_cm');
      let [height, weight] = rating ? [rating.height_cm, rating.weight_kg] : UNRATED.build[position];
      if (fix && estimatedBuild) [height, weight] = BUILD[position];
      if (fix?.height_cm) height = fix.height_cm.value;
      if (fix?.weight_kg) weight = fix.weight_kg.value;
      const attributes = Object.fromEntries(ABILITIES.map(key => [GAME_KEYS[key], rating ? rating[key] : UNRATED.ability]));
      const born = fix?.birth_date?.value as string | undefined;
      const age = born ? Number(opening.slice(0, 4)) - Number(born.slice(0, 4)) - Number(opening.slice(5) < born.slice(5)) : player.age_observed ?? null;
      const cleared = new Set([...(fix?.height_cm ? ['height_cm'] : []), ...(fix?.weight_kg ? ['weight_kg'] : []), ...(born ? ['age-unverified', 'age'] : [])]);
      const estimated = [...new Set([...(rating ? rating.estimated.filter((field: string) => field !== 'game_position') : ['all-abilities', 'height_cm', 'weight_kg']), 'age-unverified', ...(resolution.estimated ? ['game_position'] : [])])].filter(field => !cleared.has(field));
      const name = fix?.full_name?.value ?? player.full_name;
      const sources = fix ? [...new Set(Object.values(fix).flatMap((value: any) => value.sources ?? []))].sort() : [];
      const observedAt = fix ? Object.values(fix).map((value: any) => String(value.observedOn)).sort().at(-1) : null;
      const registered = fix && Object.values(fix).some((value: any) => value.officialPersonCode || value.rosterMatch);
      return {
        id: `player-${row.player_id}`, name: useOverrides ? decode(name) : name, clubId: `club-${row.club_id}`, number: fix?.shirt_number?.value ?? row.shirt_number ?? null, position,
        nationality: fix?.nationality?.value ?? player.nationality ?? null, age, heightCm: height, weightKg: weight, attributes,
        // Sprint 4 rating fairness: the minutes behind the ratings.
        ...(rating && Number.isFinite(rating.method?.weightedMinutes) ? { ratingMinutes: Math.round(rating.method.weightedMinutes) } : {}),
        estimated,
        ...(born ? { birthDate: born } : {}),
        ...(fix ? { profileEvidence: { observedAt, positionSource: resolution.estimated ? 'estimated' : official?.value ? 'official' : 'provider', membership: registered ? 'official-registration-observed' : 'provider-observed', sources } } : {}),
      };
    }).sort((a, b) => a.clubId.localeCompare(b.clubId) || a.name.localeCompare(b.name));
    const assemble = (packPlayers: any[]) => {
      const squads = new Map<string, string[]>();
      for (const player of packPlayers) squads.set(player.clubId, [...(squads.get(player.clubId) ?? []), player.id]);
      const clubIds = [...new Set(competitions.flatMap(competition => competition.clubIds))];
      const packClubs = clubIds.map(id => clubById.get(id)).filter(Boolean).map(club => ({
        id: `club-${club.id}`, name: club.name, shortName: club.short_name ?? club.name.slice(0, 3).toUpperCase(), country: club.country ?? null, city: club.city ?? null, arena: club.venue ?? null,
        color: club.color_primary ?? null, secondaryColor: club.color_secondary ?? null, identitySource: club.identity_source ?? null, playerIds: squads.get(`club-${club.id}`) ?? [],
      })).sort((a, b) => a.name.localeCompare(b.name));
      const packCompetitions = competitions.map(competition => ({ id: `competition-${competition.id}`, name: competition.name, country: competition.country ?? null, tier: competition.tier, kind: competition.kind, season: SEASON, clubIds: competition.clubIds.map((id: string) => `club-${id}`).sort() }));
      return { packCompetitions, packClubs };
    };
    // The same contents as the recorded pack, for checking that the database still rebuilds it exactly.
    const plain = buildPlayers(false), plainParts = assemble(plain);
    const recorded = await sha256(JSON.stringify({ format: 'basketball-manager-data-pack', formatVersion: 1, version: VERSION, season: SEASON, source, notice: 'Private evaluation data from API-SPORTS. Rights for publication or distribution are not cleared; do not upload or share.', competitions: plainParts.packCompetitions, clubs: plainParts.packClubs, players: plain }));
    const packPlayers = buildPlayers(true), { packCompetitions, packClubs } = assemble(packPlayers);
    const corrected = packPlayers.filter(player => player.profileEvidence);
    const profileCorrections = { model: 'profile-overrides-1', players: corrected.length, exactPositions: corrected.filter(player => player.profileEvidence?.positionSource === 'official').length, estimatedPositions: packPlayers.filter(player => player.estimated.includes('game_position')).length, note: 'Official EuroLeague/EuroCup registrations and official roster pages; a broad official role (Guard, Forward) keeps the exact position an estimate.' };
    const pack = { format: 'basketball-manager-data-pack', formatVersion: 1, version: ask.version, season: SEASON, source: { ...source, profileCorrections }, notice: 'Real club data from API-SPORTS, published with the game by its owner (15 November 2026). Player positions, heights, birth dates and names corrected from official competition and club sources where available (16 November 2026).', competitions: packCompetitions, clubs: packClubs, players: packPlayers };
    const checksum = await sha256(JSON.stringify(pack));
    const summary = { version: pack.version, checksum, competitions: packCompetitions.length, clubs: packClubs.length, players: packPlayers.length, profileCorrections, cut, matchesRecordedChecksum: recorded === versionRow.checksum, replaces: existingVersion };
    const text = JSON.stringify({ checksum, writtenAt: new Date().toISOString(), pack });
    if (mode === 'preview') return new Response(JSON.stringify({ status: 'preview', ...summary, envelope: JSON.parse(text) }), { headers: { 'Content-Type': 'application/json' } });
    if (checksum !== ask.expected_sha256) return json({ status: 'refused', error: 'The built pack does not match the requested checksum; preview and check it again.', ...summary }, 409);
    // Keep the current file before replacing it; an existing backup is never overwritten.
    let backup: string | null = null;
    if (existingText) {
      backup = `backups/real-pack-${existingVersion?.replace(/[^a-z0-9.-]/gi, '-') || 'unversioned'}.json`;
      const { error: backupError } = await client.storage.from('game-data').upload(backup, new Blob([existingText], { type: 'application/json' }), { upsert: false, contentType: 'application/json', cacheControl: '300' });
      if (backupError) {
        const { data: kept } = await client.storage.from('game-data').download(backup);
        if (!kept || await kept.text() !== existingText) return finish('failed', { error: `Backup ${backup} failed: ${backupError.message}`, ...summary }, 500);
      }
    }
    const { error } = await client.storage.from('game-data').upload(OBJECT, new Blob([text], { type: 'application/json' }), { upsert: true, contentType: 'application/json', cacheControl: '300' });
    if (error) return finish('failed', { error: error.message, backup, ...summary }, 500);
    return finish('done', { backup, bytes: text.length, ...summary });
  } catch (error) {
    return json({ status: 'failed', error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
