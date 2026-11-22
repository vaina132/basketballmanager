// Stores reviewed player profile corrections (scripts/real-data-official-profiles.mjs) and current squads
// (scripts/real-data-current-squads.mjs: player moves and departures, club additions) in `manual_overrides`, the
// table of hand-maintained facts that imports never overwrite and `publish-starter-pack` applies (owner permission,
// 16 November 2026). Only an authorised upload is accepted: the request names a pending, unexpired row in
// `data_change_requests` (written only by the service role or the owner's dashboard) whose SHA-256 equals the
// uploaded file. No secret is involved, so nothing secret is stored anywhere. Replaced values are kept in
// `manual_override_history`, so every change can be undone; nothing is deleted.
//
//   POST /functions/v1/import-profile-overrides?request=<id>   body: the overrides file, byte for byte
import { createClient } from 'npm:@supabase/supabase-js@2';

const FIELDS = new Set(['position', 'full_name', 'height_cm', 'weight_kg', 'birth_date', 'shirt_number', 'nationality', 'club_id', 'squad_status']);
/** Club rows (current squads, 18 November 2026): players on the club's current roster who are not in the pack. */
const CLUB_FIELDS = new Set(['added_players']);
const ABILITIES = ['twoPoint', 'threePoint', 'freeThrow', 'passing', 'defense', 'rebounding', 'stamina'];
const addedPlayer = (player: any) => player && typeof player === 'object' && /^player-n[0-9a-f]{24}$/.test(player.id) && typeof player.name === 'string' && player.name.trim() && player.name.length <= 120
  && (player.number === null || Number.isInteger(player.number) && player.number >= 0 && player.number <= 99) && POSITIONS.includes(player.position) && ['official', 'provider', 'estimated'].includes(player.positionSource)
  && (player.age === null || Number.isInteger(player.age) && player.age >= 14 && player.age <= 60) && (player.birthDate === undefined || /^\d{4}-\d{2}-\d{2}$/.test(player.birthDate))
  && Number.isInteger(player.heightCm) && player.heightCm >= 150 && player.heightCm <= 240 && Number.isInteger(player.weightKg) && player.weightKg >= 50 && player.weightKg <= 180
  && ABILITIES.every(key => Number.isInteger(player.attributes?.[key]) && player.attributes[key] >= 1 && player.attributes[key] <= 20)
  && Array.isArray(player.estimated) && player.estimated.every((field: unknown) => typeof field === 'string') && (player.positionSource === 'estimated') === player.estimated.includes('game_position');
const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'], GROUPS = ['Guard', 'Forward', 'Center'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function sha256(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** A row's value must be a plain fact with https sources; anything else is refused before any write. */
function invalid(row: any): string | null {
  if (!UUID.test(String(row?.entity_id)) || !(row.entity_type === 'player' && FIELDS.has(row.field) || row.entity_type === 'club' && CLUB_FIELDS.has(row.field))) return 'unknown entity or field';
  if (typeof row.reason !== 'string' || !row.reason.trim() || row.reason.length > 500) return 'missing reason';
  const value = row.value;
  if (!value || typeof value !== 'object' || Array.isArray(value) || JSON.stringify(value).length > (row.field === 'added_players' ? 60000 : 4000)) return 'invalid value';
  if (!Array.isArray(value.sources) || !value.sources.length || value.sources.some((url: unknown) => typeof url !== 'string' || !url.startsWith('https://'))) return 'sources must be https links';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value.observedOn))) return 'missing observation date';
  const v = value.value;
  switch (row.field) {
    case 'position': return (v === null || POSITIONS.includes(v)) && (value.group === null || value.group === undefined || GROUPS.includes(value.group)) && (v !== null || GROUPS.includes(value.group)) ? null : 'invalid position';
    case 'height_cm': return Number.isInteger(v) && v >= 150 && v <= 240 ? null : 'invalid height';
    case 'weight_kg': return Number.isInteger(v) && v >= 50 && v <= 180 ? null : 'invalid weight';
    case 'shirt_number': return Number.isInteger(v) && v >= 0 && v <= 99 ? null : 'invalid shirt number';
    case 'club_id': return UUID.test(String(v)) ? null : 'invalid club';
    case 'squad_status': return v === 'left' ? null : 'invalid squad status';
    case 'added_players': return Array.isArray(v) && v.length <= 30 && v.every(addedPlayer) && new Set(v.map((player: any) => player.id)).size === v.length ? null : 'invalid added players';
    case 'birth_date': return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v).toISOString().slice(0, 10) === v ? null : 'invalid birth date';
    default: return typeof v === 'string' && v.trim() && v.length <= 120 ? null : 'invalid text';
  }
}

Deno.serve(async request => {
  if (request.method !== 'POST') return json({ status: 'refused', error: 'POST the overrides file.' }, 405);
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const id = Number(new URL(request.url).searchParams.get('request'));
  if (!Number.isSafeInteger(id)) return json({ status: 'refused', error: 'Name the request.' }, 403);
  const { data: ask } = await client.from('data_change_requests').select('*').eq('id', id).maybeSingle();
  if (!ask || ask.kind !== 'profile-overrides' || ask.status !== 'pending' || Date.parse(ask.expires_at) < Date.now()) return json({ status: 'refused', error: 'No pending request for profile corrections.' }, 403);
  const text = await request.text();
  if (await sha256(text) !== ask.expected_sha256) return json({ status: 'refused', error: 'The file does not match the requested corrections.' }, 403);
  const finish = async (status: 'done' | 'failed', result: Record<string, unknown>, code = 200) => {
    await client.from('data_change_requests').update({ status, result, completed_at: new Date().toISOString() }).eq('id', id).eq('status', 'pending');
    return json({ status, ...result }, code);
  };
  try {
    const file = JSON.parse(text);
    if (file?.model !== 'profile-overrides-1' || !Array.isArray(file.rows) || !file.rows.length) return finish('failed', { error: 'Not a profile-overrides-1 file.' }, 400);
    const keys = new Set<string>();
    for (const row of file.rows) {
      const problem = invalid(row);
      if (problem) return finish('failed', { error: `${row?.entity_id}/${row?.field}: ${problem}` }, 400);
      const key = `${row.entity_type}/${row.entity_id}/${row.field}`;
      if (keys.has(key)) return finish('failed', { error: `${key} appears twice` }, 400);
      keys.add(key);
    }
    // Every corrected player must exist and must not be a merged duplicate; every club and moved-to club must exist.
    const known = new Set<string>(), existing = new Map<string, any>(), missing: string[] = [];
    for (const [type, table, ids] of [
      ['player', 'players', [...new Set(file.rows.filter((row: any) => row.entity_type === 'player').map((row: any) => row.entity_id as string))]],
      ['club', 'clubs', [...new Set([...file.rows.filter((row: any) => row.entity_type === 'club').map((row: any) => row.entity_id as string), ...file.rows.filter((row: any) => row.field === 'club_id').map((row: any) => row.value.value as string)])]],
    ] as [string, string, string[]][]) {
      for (let from = 0; from < ids.length; from += 200) {
        const chunk = ids.slice(from, from + 200);
        const query = client.from(table).select('id').in('id', chunk);
        const { data: found, error } = await (table === 'players' ? query.is('merged_into', null) : query);
        if (error) throw new Error(`${table}: ${error.message}`);
        for (const item of found) known.add(`${type}/${item.id}`);
        const { data: rows, error: overridesError } = await client.from('manual_overrides').select('*').eq('entity_type', type).in('entity_id', chunk);
        if (overridesError) throw new Error(`manual_overrides: ${overridesError.message}`);
        for (const row of rows) existing.set(`${row.entity_type}/${row.entity_id}/${row.field}`, row);
      }
      missing.push(...ids.filter(id => !known.has(`${type}/${id}`)).map(id => `${type} ${id}`));
    }
    if (missing.length) return finish('failed', { error: `${missing.length} players or clubs are unknown or merged`, sample: missing.slice(0, 5) }, 400);
    const keyOf = (row: any) => `${row.entity_type}/${row.entity_id}/${row.field}`;
    const changed = file.rows.filter((row: any) => { const old = existing.get(keyOf(row)); return !old || JSON.stringify(old.value) !== JSON.stringify(row.value) || old.reason !== row.reason; });
    const replaced = changed.map((row: any) => existing.get(keyOf(row))).filter(Boolean);
    for (let from = 0; from < replaced.length; from += 500) {
      const { error } = await client.from('manual_override_history').insert(replaced.slice(from, from + 500).map((old: any) => ({ override_id: old.id, entity_type: old.entity_type, entity_id: old.entity_id, field: old.field, value: old.value, reason: old.reason, created_at: old.created_at, request_id: id })));
      if (error) throw new Error(`history: ${error.message}`);
    }
    for (let from = 0; from < changed.length; from += 500) {
      const { error } = await client.from('manual_overrides').upsert(changed.slice(from, from + 500).map((row: any) => ({ entity_type: row.entity_type, entity_id: row.entity_id, field: row.field, value: row.value, reason: row.reason })), { onConflict: 'entity_type,entity_id,field' });
      if (error) throw new Error(`manual_overrides: ${error.message}`);
    }
    return finish('done', { batch: file.batch ?? null, rows: file.rows.length, inserted: changed.length - replaced.length, replaced: replaced.length, unchanged: file.rows.length - changed.length });
  } catch (error) {
    return finish('failed', { error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
