// Publishes a playable real-club data pack built from the database into the public `game-data` bucket, so the game
// can start real-club careers on any device (owner decision, 15 November 2026). It mirrors `buildPack` in
// scripts/real-data-pack.mjs for the ratings of dataset version 2026.11-world-1 and applies the reviewed profile
// corrections in `manual_overrides` (owner permission, 16 November 2026: exact positions from official sources;
// broad official roles choose within the group from the player's statistics, as the ratings do). Positions marked
// `community` (Wikipedia, 17 November 2026) are shown as reported, not as official. Current squads (18 November
// 2026): `club_id` moves a player, `squad_status` 'left' removes him, and club `added_players` adds current players
// with estimated abilities ('all-abilities'; the game lifts them to their club's level).
//
// Rating balance (owner decision, 22 November 2026; ./rating-balance.ts): abilities are lined up by position (a good
// small forward and a good centre reach similar overall ratings, while each skill keeps its position's real profile for
// the match engine) and blended with the average player of the same position and league when they rest on fewer than
// 900 minutes. It applies to every pack this function builds from now on; `source.ratingBalance` records it.
// position-balance-2 (owner approved, 22 November 2026) also lowers a bench role: minutes per game well below the
// club's five most-used players, compared within the position. Each player's games behind the ratings (the rating
// row's `method.weightedGames`, recency-weighted like the minutes) go into the pack as `ratingGames` next to
// `ratingMinutes`; the game ignores the field. scripts/real-data-rating-balance.mjs applies the same calculation
// offline to a pack built without the balance, for a preview.
//
// v8 (NBA, 23 November 2026, docs/nba-plan.md step 2): a competition's `groups` (the NBA's conferences, then its
// divisions with `parentId`) and a club's `capacity` (arena seats) go into the pack when the database has them; the
// NBA's players are club `added_players` rated offline from their box scores (rating-4, with `ratingMinutes` and
// `ratingGames`); and the USA is position-balanced on its own (balanceBySeparateCountry), so every European player,
// club and competition comes out exactly as in v7. The game offers leagues of 4-20 clubs (careerCompetitions) and,
// from 23 November 2026, only such leagues become unchosen top divisions of a European world; older game builds would
// add the 30-club NBA to European worlds that way, so a pack with the NBA is published only once that build is live.
//
// rating-5 (v9, owner decision 24 November 2026; ./rating-model.mjs, STRENGTH_RULES): statistics produced against
// weaker opposition, or as the focal point of a weak team, count a little less. The function reads the box scores
// (games, player_game_stats), rates every European player with rating-3 as published (checked against the stored
// rating rows) and again on season lines put in a neutral team and opposition setting, on the same scale, and adds
// the difference of each unrounded ability to the stored one, before the rating balance. Squads, positions, builds,
// estimates, minutes and games come from the stored rows exactly as before; the NBA (added players, rating-4) is not
// touched. To undo, redeploy v8 (index.ts and rating-balance.ts without rating-model.mjs, git history).
//
// It acts only on an authorised request: a pending, unexpired `publish-pack` row in `data_change_requests` (written
// only by the service role or the owner's dashboard), which names the new version. `preview` returns the built pack
// for checking with the game's own parser; `publish` uploads it only if its checksum equals the request's
// `expected_sha256`, after copying the current file to `backups/real-pack-<its version>.json`.
//
//   POST /functions/v1/publish-starter-pack   body: { "request": <id>, "mode": "preview" | "publish" }
import { createClient } from 'npm:@supabase/supabase-js@2';
import { balanceBySeparateCountry } from './rating-balance.ts';
// @ts-ignore plain JavaScript module shared with scripts/real-data-ratings.mjs
import { ABILITY_KEYS, STRENGTH_RULES, describeLevels, seasonLines, strengthRatings, teamStrengths } from './rating-model.mjs';

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
    const seasons = await all('seasons', 'id,competition_id,competitions(id,name,country,tier,kind,groups)', query => query.eq('label', SEASON));
    const seasonIds = seasons.map(row => row.id);
    const participations = await all('participations', 'season_id,club_id', query => query.in('season_id', seasonIds));
    const competitions = seasons.map(row => ({ ...row.competitions, clubIds: participations.filter(item => item.season_id === row.id).map(item => item.club_id) }));
    const memberships = await all('roster_memberships', 'player_id,club_id,shirt_number,first_seen_on,last_seen_on', query => query.in('season_id', seasonIds));
    const clubs = await all('clubs', 'id,name,short_name,country,city,venue,color_primary,color_secondary,identity_source,capacity');
    const players = await all('players', 'id,full_name,nationality,position,age_observed,merged_into');
    const ratings = await all('player_ratings', '*', query => query.eq('dataset_version_id', VERSION));
    const overrideRows = await all('manual_overrides', 'entity_id,field,value', query => query.eq('entity_type', 'player').order('id'));
    // Current squads (18 November 2026): players on a club's current roster who are not in the provider's data.
    const clubRows = await all('manual_overrides', 'entity_id,field,value', query => query.eq('entity_type', 'club').eq('field', 'added_players').order('id'));
    const rules = [...new Set(ratings.map(rating => rating.method?.rules).filter(Boolean))].sort().join(', ');

    // rating-5: every season line from the box scores (as the view player_season_totals sums them, with the club kept),
    // each club's strength per competition season, then rating-3 and rating-5 side by side.
    const allSeasons = await all('seasons', 'id,label,competitions(name,kind,tier)');
    const seasonById = new Map(allSeasons.map(row => [row.id, { label: row.label, competition: row.competitions.name, kind: row.competitions.kind }]));
    const games = await all('games', 'id,season_id,home_club_id,away_club_id,home_score,away_score,stats_rows', query => query.order('id'));
    const { count: statCount, error: countError } = await client.from('player_game_stats').select('game_id', { count: 'exact', head: true });
    if (countError || !Number.isSafeInteger(statCount)) throw new Error(`player_game_stats: ${countError?.message ?? 'no count'}`);
    const stats: any[] = [];
    const page = async (from: number) => {
      const { data, error } = await client.from('player_game_stats').select('g:game_id,p:player_id,c:club_id,s:seconds_played,tm:two_made,ta:two_attempted,hm:three_made,ha:three_attempted,fm:free_made,fa:free_attempted,r:rebounds,a:assists,pt:points').order('game_id').order('player_id').range(from, from + 999);
      if (error) throw new Error(`player_game_stats: ${error.message}`);
      return data;
    };
    for (let from = 0; from < statCount!; from += 8000) {
      const pages = await Promise.all(Array.from({ length: 8 }, (_, index) => from + index * 1000).filter(start => start < statCount!).map(page));
      for (const rows of pages) for (const x of rows) stats.push({ game_id: x.g, player_id: x.p, club_id: x.c, seconds_played: x.s, two_made: x.tm, two_attempted: x.ta, three_made: x.hm, three_attempted: x.ha, free_made: x.fm, free_attempted: x.fa, rebounds: x.r, assists: x.a, points: x.pt });
    }
    if (stats.length !== statCount) throw new Error(`player_game_stats: read ${stats.length} of ${statCount} rows`);
    const ratingCompetitions = await all('competitions', 'name,kind,tier');
    // A preview may try other weights (body.strength: teamWeight, opponentWeight, priorGames); a publish always uses STRENGTH_RULES.
    const tuning = mode === 'preview' && body?.strength && typeof body.strength === 'object' ? body.strength : {};
    const tuned = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 3 ? value : fallback;
    const strengthRules = { ...STRENGTH_RULES, teamWeight: tuned(tuning.teamWeight, STRENGTH_RULES.teamWeight), opponentWeight: tuned(tuning.opponentWeight, STRENGTH_RULES.opponentWeight), priorGames: tuned(tuning.priorGames / 10, STRENGTH_RULES.priorGames / 10) * 10 };
    const strengthModel = strengthRatings(seasonLines(stats, games, seasonById), players.filter(player => !player.merged_into), ratingCompetitions, teamStrengths(games, strengthRules), strengthRules);
    const deltaOf: Map<string, Record<string, number>> = strengthModel.deltas;
    // The check: rating-3 recomputed from the box scores against the stored rating rows of dataset version VERSION.
    const recomputed = new Map(strengthModel.base.map((rating: any) => [rating.player_id, rating]));
    let identical = 0, differing = 0, missing = 0, largest = 0;
    for (const rating of ratings) {
      const again: any = recomputed.get(rating.player_id);
      if (!again) { missing += 1; continue; }
      const gap = Math.max(...ABILITY_KEYS.map((key: string) => Math.abs(Number(again[key]) - Number(rating[key]))));
      if (gap === 0) identical += 1; else differing += 1;
      largest = Math.max(largest, gap);
    }
    const strengthCheck = { storedRows: ratings.length, identical, differing, missing, largestDifference: largest };
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

    // A player missing from his club's current roster leaves; one listed by another club's roster moves there.
    const buildPlayers = (useOverrides: boolean) => [...[...latest.values()].filter(row => !useOverrides || overridesOf.get(row.player_id)?.squad_status?.value !== 'left').map(row => {
      const player = playerById.get(row.player_id), rating = ratingById.get(row.player_id);
      const fix = useOverrides ? overridesOf.get(row.player_id) : undefined;
      if (fix?.club_id?.value && clubById.has(fix.club_id.value)) row = { ...row, club_id: fix.club_id.value };
      const official = fix?.position;
      const resolution = official?.value ? { position: official.value as string, estimated: false } : official?.group ? { position: withinGroup(official.group, rating), estimated: true } : resolvePosition(player.position, rating?.game_position ?? UNRATED.position[player.position] ?? 'SF');
      const position = resolution.position;
      const estimatedBuild = !rating || rating.estimated.includes('height_cm');
      let [height, weight] = rating ? [rating.height_cm, rating.weight_kg] : UNRATED.build[position];
      if (fix && estimatedBuild) [height, weight] = BUILD[position];
      if (fix?.height_cm) height = fix.height_cm.value;
      if (fix?.weight_kg) weight = fix.weight_kg.value;
      // rating-5 (v9): the change of each unrounded ability from team and opposition strength, added to the stored ability.
      const delta = useOverrides && rating ? deltaOf.get(row.player_id) : undefined;
      const attributes = Object.fromEntries(ABILITIES.map(key => [GAME_KEYS[key], rating ? Number(rating[key]) + (delta?.[key] ?? 0) : UNRATED.ability]));
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
        // Rating balance position-balance-2: the games behind the ratings, for minutes per game (one decimal).
        ...(useOverrides && rating && Number.isFinite(rating.method?.weightedMinutes) && Number.isFinite(rating.method?.weightedGames) ? { ratingGames: Math.round(rating.method.weightedGames * 10) / 10 } : {}),
        estimated,
        ...(born ? { birthDate: born } : {}),
        ...(fix ? { profileEvidence: { observedAt, positionSource: resolution.estimated ? 'estimated' : official?.value && !official.community ? 'official' : 'provider', membership: registered ? 'official-registration-observed' : 'provider-observed', sources } } : {}),
      };
    }), ...(useOverrides ? clubRows.filter(row => clubById.has(row.entity_id)).flatMap(row => row.value.value.map((added: any) => ({
      id: added.id, name: decode(added.name), clubId: `club-${row.entity_id}`, number: added.number ?? null, position: added.position, nationality: added.nationality ?? null, age: added.age ?? null,
      heightCm: added.heightCm, weightKg: added.weightKg, attributes: added.attributes,
      // NBA players (v8): rated from their box scores offline (rating-4), so they carry the minutes and games behind the ratings.
      ...(Number.isFinite(added.ratingMinutes) ? { ratingMinutes: added.ratingMinutes } : {}), ...(Number.isFinite(added.ratingGames) ? { ratingGames: added.ratingGames } : {}),
      estimated: added.estimated, ...(added.birthDate ? { birthDate: added.birthDate } : {}),
      profileEvidence: { observedAt: String(row.value.observedOn), positionSource: added.positionSource, membership: 'official-registration-observed', sources: row.value.sources },
    }))) : [])].sort((a, b) => a.clubId.localeCompare(b.clubId) || a.name.localeCompare(b.name));
    const assemble = (packPlayers: any[]) => {
      const squads = new Map<string, string[]>();
      for (const player of packPlayers) squads.set(player.clubId, [...(squads.get(player.clubId) ?? []), player.id]);
      const clubIds = [...new Set(competitions.flatMap(competition => competition.clubIds))];
      const packClubs = clubIds.map(id => clubById.get(id)).filter(Boolean).map(club => ({
        id: `club-${club.id}`, name: club.name, shortName: club.short_name ?? club.name.slice(0, 3).toUpperCase(), country: club.country ?? null, city: club.city ?? null, arena: club.venue ?? null,
        color: club.color_primary ?? null, secondaryColor: club.color_secondary ?? null, identitySource: club.identity_source ?? null, playerIds: squads.get(`club-${club.id}`) ?? [],
        // v8: the arena's seats where known (NBA clubs); absent otherwise, so European clubs are unchanged.
        ...(Number.isInteger(club.capacity) ? { capacity: club.capacity } : {}),
      })).sort((a, b) => a.name.localeCompare(b.name));
      const packCompetitions = competitions.map(competition => ({
        id: `competition-${competition.id}`, name: competition.name, country: competition.country ?? null, tier: competition.tier, kind: competition.kind, season: SEASON, clubIds: competition.clubIds.map((id: string) => `club-${id}`).sort(),
        // v8: conferences, then divisions with `parentId` (the NBA); absent for every other competition.
        ...(Array.isArray(competition.groups) && competition.groups.length ? { groups: competition.groups.map((group: any) => ({ id: group.id, name: group.name, ...(group.parentId ? { parentId: group.parentId } : {}), clubIds: group.clubIds.map((id: string) => `club-${id}`).sort() })) } : {}),
      }));
      return { packCompetitions, packClubs };
    };
    // The same contents as the recorded pack, for checking that the database still rebuilds it exactly.
    const plain = buildPlayers(false), plainParts = assemble(plain);
    const recorded = await sha256(JSON.stringify({ format: 'basketball-manager-data-pack', formatVersion: 1, version: VERSION, season: SEASON, source, notice: 'Private evaluation data from API-SPORTS. Rights for publication or distribution are not cleared; do not upload or share.', competitions: plainParts.packCompetitions, clubs: plainParts.packClubs, players: plain }));
    const correctedPlayers = buildPlayers(true), { packCompetitions, packClubs } = assemble(correctedPlayers);
    // Rating balance by position and minutes, on the finished squads and positions (squads do not depend on abilities).
    // v8: the USA (the NBA) is balanced on its own, so every European player gets exactly the ratings he had before.
    const { players: packPlayers, summary: ratingBalance, usa: ratingBalanceUsa } = balanceBySeparateCountry(correctedPlayers as any[], packCompetitions as any[], 'USA');
    // Every ability is a whole number after the balance (it rounds every rated profile); refuse anything else.
    const unrounded = packPlayers.filter(player => Object.values(player.attributes).some(value => !Number.isInteger(value)));
    if (unrounded.length) throw new Error(`${unrounded.length} players with unrounded abilities, for example ${unrounded[0].id}`);
    const corrected = packPlayers.filter(player => player.profileEvidence);
    const strengthPlayers = correctedPlayers.filter(player => player.ratingMinutes !== undefined && !player.estimated.includes('all-abilities') && deltaOf.has(player.id.replace(/^player-/, '')));
    const ratingStrength = {
      model: STRENGTH_RULES.id, players: strengthPlayers.length, check: strengthCheck,
      rules: { priorGames: strengthRules.priorGames, limit: strengthRules.limit, team: strengthRules.team, opponent: strengthRules.opponent, teamWeight: strengthRules.teamWeight, opponentWeight: strengthRules.opponentWeight },
      conversion: describeLevels(strengthModel.neutralLevels),
      note: 'rating-5: before rating-3 runs, each season line is put in a neutral setting (an average team of its competition against average opposition): per point of team strength (margin per game, opponent- and home-adjusted, pulled to the average over six games) two-point attempts -1.0%, minutes per game -1.8%, threes and assists a little, counted at half weight; per point of opposition strength rebounds -0.8%, assists -1.2%, shooting -0.3 to -0.45 points, as measured in the box scores (club changes within a competition, and game lines against season averages). The change of each unrounded ability is added to the stored rating-3 ability, before the rating balance (owner decision, 24 November 2026).',
    };
    const profileCorrections = { model: 'profile-overrides-1', players: corrected.length, currentSquads: { moved: overrideRows.filter(row => row.field === 'club_id').length, left: overrideRows.filter(row => row.field === 'squad_status').length, added: clubRows.reduce((sum, row) => sum + row.value.value.length, 0) }, exactPositions: corrected.filter(player => player.profileEvidence?.positionSource === 'official').length, reportedPositions: corrected.filter(player => player.profileEvidence?.positionSource === 'provider').length, estimatedPositions: packPlayers.filter(player => player.estimated.includes('game_position')).length, note: 'Official EuroLeague/EuroCup registrations and official league and club roster pages; Wikipedia rosters and player articles (CC BY-SA 4.0) where no official page gives an exact position, shown as reported; a broad role (Guard, Forward) keeps the exact position an estimate.' };
    const pack = { format: 'basketball-manager-data-pack', formatVersion: 1, version: ask.version, season: SEASON, source: { ...source, profileCorrections, ratingStrength, ratingBalance, ...(ratingBalanceUsa ? { ratingBalanceUsa, nbaRatings: 'rating-4: NBA box scores (API-SPORTS league 12, 2025-26 and 2026-27) on the European scale of rating-3, the NBA level fitted with the European levels fixed (scripts/real-data-nba-ratings.mjs); NBA facts from Wikipedia (CC BY-SA 4.0) and Wikidata.' } : {}) }, notice: 'Real club data from API-SPORTS, published with the game by its owner (15 November 2026). Player positions, heights, birth dates and names corrected from official competition and club sources where available (16 November 2026).', competitions: packCompetitions, clubs: packClubs, players: packPlayers };
    const checksum = await sha256(JSON.stringify(pack));
    const summary = { version: pack.version, checksum, competitions: packCompetitions.length, clubs: packClubs.length, players: packPlayers.length, profileCorrections, ratingStrength: { model: ratingStrength.model, players: ratingStrength.players, check: strengthCheck, rules: ratingStrength.rules }, ratingBalance: { model: ratingBalance.model, changedPlayers: ratingBalance.changedPlayers, playersWithGames: ratingBalance.role.playersWithGames, clubsWithStarters: ratingBalance.role.clubsWithStarters }, ...(ratingBalanceUsa ? { ratingBalanceUsa: { poolPlayers: ratingBalanceUsa.poolPlayers, changedPlayers: ratingBalanceUsa.changedPlayers, playersWithGames: ratingBalanceUsa.role.playersWithGames, clubsWithStarters: ratingBalanceUsa.role.clubsWithStarters } } : {}), cut, matchesRecordedChecksum: recorded === versionRow.checksum, replaces: existingVersion };
    const text = JSON.stringify({ checksum, writtenAt: new Date().toISOString(), pack });
    // Preview only: each rated player's strength context (team, opposition) and his ability changes before the balance, for the review.
    const strengthReport = Object.fromEntries(strengthPlayers.map(player => { const id = player.id.replace(/^player-/, ''), context = strengthModel.contexts.get(id); return [player.id, { team: context?.team ?? 0, schedule: context?.schedule ?? 0, delta: deltaOf.get(id) }]; }));
    if (mode === 'preview') return new Response(JSON.stringify({ status: 'preview', ...summary, strengthReport, envelope: JSON.parse(text) }), { headers: { 'Content-Type': 'application/json' } });
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
