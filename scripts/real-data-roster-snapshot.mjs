#!/usr/bin/env node
/** Read-only provider refresh. Retains exact responses; never edits database rows or published packs. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMPETITIONS, databaseHelpers } from './real-data-import.mjs';

export function rosterRequests(pack, clubLinks) {
  const ids = new Map(clubLinks.map(row => [`club-${row.club_id}`, row.provider_id]));
  const requests = new Map();
  for (const competition of pack.competitions) {
    const scope = COMPETITIONS.find(item => item.name === competition.name);
    const season = scope?.seasons.find(([label]) => label === pack.season)?.[1];
    if (!scope || !season) throw new Error(`No provider scope for ${competition.name} ${pack.season}.`);
    for (const clubId of competition.clubIds) {
      const team = ids.get(clubId);
      if (!team) throw new Error(`No stable provider identity for ${clubId}.`);
      const key = `${team}/${season}`;
      const request = requests.get(key) ?? { team, season, clubId, competitionIds: [] };
      if (!request.competitionIds.includes(competition.id)) request.competitionIds.push(competition.id);
      requests.set(key, request);
    }
  }
  return [...requests.values()].sort((a, b) => `${a.team}/${a.season}`.localeCompare(`${b.team}/${b.season}`));
}

export function checkedProviderRows(body, expected = 'players') {
  const errors = Array.isArray(body?.errors) ? body.errors : Object.values(body?.errors ?? {});
  if (errors.length || !Array.isArray(body?.response) || !body.response.length || body.results !== body.response.length) throw new Error(`Incomplete ${expected} response; nothing may be reconciled from it.`);
  const ids = body.response.map(row => row.id);
  if (ids.some(id => !Number.isSafeInteger(id) || id < 1) || new Set(ids).size !== ids.length) throw new Error(`Invalid or duplicated ${expected} provider identity.`);
  if (body.paging?.total > 1) throw new Error(`Paginated ${expected} response requires every page before reconciliation.`);
  return body.response;
}

async function main() {
  const arg = name => { const at = process.argv.indexOf(name); return at < 0 ? null : process.argv[at + 1]; };
  const packPath = arg('--pack'), output = arg('--output'), budget = Number(arg('--budget') ?? 350);
  if (!packPath || !output || !Number.isInteger(budget) || budget < 1) throw new Error('Use --pack FILE --output NEW_DIRECTORY [--budget 350].');
  const envelope = JSON.parse(await readFile(packPath, 'utf8'));
  const checksum = createHash('sha256').update(JSON.stringify(envelope.pack)).digest('hex');
  if (checksum !== envelope.checksum) throw new Error('Base pack checksum mismatch.');
  const { selectAll } = await databaseHelpers();
  const [clubs, players] = await Promise.all([
    selectAll('club_provider_ids?provider=eq.api-sports&select=provider_id,club_id'),
    selectAll('player_provider_ids?provider=eq.api-sports&select=provider_id,player_id'),
  ]);
  const requests = rosterRequests(envelope.pack, clubs);
  if (requests.length > budget) throw new Error(`This scope requires ${requests.length} requests; budget is ${budget}.`);
  const directory = path.resolve(output);
  await mkdir(directory); // Existing snapshots are immutable; choose another directory to refresh.
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const key = (await readFile(path.join(root, 'api-sports-key.local'), 'utf8')).trim();
  const result = { model: 'roster-observations-1', status: 'in-progress', baseVersion: envelope.pack.version, baseChecksum: checksum, season: envelope.pack.season, startedAt: new Date().toISOString(), playerLinks: players, clubLinks: clubs, observations: [] };
  try {
    for (const [index, request] of requests.entries()) {
      const url = `https://v1.basketball.api-sports.io/players?${new URLSearchParams({ team: request.team, season: request.season })}`;
      const response = await fetch(url, { headers: { 'x-apisports-key': key }, signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`Provider HTTP ${response.status} at request ${index + 1}.`);
      const body = await response.json();
      checkedProviderRows(body);
      result.observations.push({ ...request, url, observedAt: new Date().toISOString(), body });
      await writeFile(path.join(directory, 'snapshot.json'), JSON.stringify(result, null, 2));
      if ((index + 1) % 25 === 0) console.log(`Checked ${index + 1}/${requests.length} roster endpoints.`);
      await new Promise(resolve => setTimeout(resolve, 350));
    }
    result.status = 'complete'; result.finishedAt = new Date().toISOString();
    await writeFile(path.join(directory, 'snapshot.json'), JSON.stringify(result, null, 2));
    console.log(`Complete: ${requests.length} roster endpoints. Snapshot: ${path.join(directory, 'snapshot.json')}`);
  } catch (error) {
    result.status = 'failed'; result.failure = error.message;
    await writeFile(path.join(directory, 'snapshot.json'), JSON.stringify(result, null, 2));
    throw error;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
