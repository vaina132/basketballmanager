// Stores reviewed player profile corrections (scripts/real-data-official-profiles.mjs) in `manual_overrides`, the
// table of hand-maintained facts that imports never overwrite and `publish-starter-pack` applies (owner permission,
// 16 November 2026). Only an authorised upload is accepted: the request names a pending, unexpired row in
// `data_change_requests` (written only by the service role or the owner's dashboard) whose SHA-256 equals the
// uploaded file. No secret is involved, so nothing secret is stored anywhere. Replaced values are kept in
// `manual_override_history`, so every change can be undone; nothing is deleted.
//
//   POST /functions/v1/import-profile-overrides?request=<id>   body: the overrides file, byte for byte
import { createClient } from 'npm:@supabase/supabase-js@2';

const FIELDS = new Set(['position', 'full_name', 'height_cm', 'weight_kg', 'birth_date', 'shirt_number', 'nationality']);
const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'], GROUPS = ['Guard', 'Forward', 'Center'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function sha256(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** A row's value must be a plain fact with https sources; anything else is refused before any write. */
function invalid(row: any): string | null {
  if (row?.entity_type !== 'player' || !UUID.test(String(row.entity_id)) || !FIELDS.has(row.field)) return 'unknown entity or field';
  if (typeof row.reason !== 'string' || !row.reason.trim() || row.reason.length > 500) return 'missing reason';
  const value = row.value;
  if (!value || typeof value !== 'object' || Array.isArray(value) || JSON.stringify(value).length > 4000) return 'invalid value';
  if (!Array.isArray(value.sources) || !value.sources.length || value.sources.some((url: unknown) => typeof url !== 'string' || !url.startsWith('https://'))) return 'sources must be https links';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value.observedOn))) return 'missing observation date';
  const v = value.value;
  switch (row.field) {
    case 'position': return (v === null || POSITIONS.includes(v)) && (value.group === null || value.group === undefined || GROUPS.includes(value.group)) && (v !== null || GROUPS.includes(value.group)) ? null : 'invalid position';
    case 'height_cm': return Number.isInteger(v) && v >= 150 && v <= 240 ? null : 'invalid height';
    case 'weight_kg': return Number.isInteger(v) && v >= 50 && v <= 180 ? null : 'invalid weight';
    case 'shirt_number': return Number.isInteger(v) && v >= 0 && v <= 99 ? null : 'invalid shirt number';
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
      const key = `${row.entity_id}/${row.field}`;
      if (keys.has(key)) return finish('failed', { error: `${key} appears twice` }, 400);
      keys.add(key);
    }
    // Every corrected player must exist and must not be a merged duplicate.
    const ids = [...new Set(file.rows.map((row: any) => row.entity_id as string))];
    const known = new Set<string>(), existing = new Map<string, any>();
    for (let from = 0; from < ids.length; from += 200) {
      const chunk = ids.slice(from, from + 200);
      const { data: players, error } = await client.from('players').select('id').in('id', chunk).is('merged_into', null);
      if (error) throw new Error(`players: ${error.message}`);
      for (const player of players) known.add(player.id);
      const { data: rows, error: overridesError } = await client.from('manual_overrides').select('*').eq('entity_type', 'player').in('entity_id', chunk);
      if (overridesError) throw new Error(`manual_overrides: ${overridesError.message}`);
      for (const row of rows) existing.set(`${row.entity_id}/${row.field}`, row);
    }
    const missing = ids.filter(id => !known.has(id));
    if (missing.length) return finish('failed', { error: `${missing.length} players are unknown or merged`, sample: missing.slice(0, 5) }, 400);
    const changed = file.rows.filter((row: any) => { const old = existing.get(`${row.entity_id}/${row.field}`); return !old || JSON.stringify(old.value) !== JSON.stringify(row.value) || old.reason !== row.reason; });
    const replaced = changed.map((row: any) => existing.get(`${row.entity_id}/${row.field}`)).filter(Boolean);
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
