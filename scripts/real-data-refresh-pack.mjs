#!/usr/bin/env node
/** Build a new private revision from complete retained observations. Never rewrites an old pack or the database. */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditProfiles } from './real-data-profile-audit.mjs';
import { createServer } from 'vite';

async function main() {
  const arg = name => { const at = process.argv.indexOf(name); return at < 0 ? null : process.argv[at + 1]; };
  const basePath = arg('--base'), snapshotPath = arg('--snapshot'), officialPaths = arg('--official'), version = arg('--version'), out = arg('--out');
  if (!basePath || !snapshotPath || !officialPaths || !version || !out) throw new Error('Use --base FILE --snapshot FILE --official FILE,FILE --version NEW_VERSION --out NEW_FILE.');
  const read = async file => JSON.parse(await readFile(file, 'utf8'));
  const envelope = await read(basePath);
  const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  if (hash(envelope.pack) !== envelope.checksum) throw new Error('Base pack checksum mismatch.');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const { pack, report } = auditProfiles({ base: envelope.pack, snapshot: await read(snapshotPath), officialDocuments: await Promise.all(officialPaths.split(',').map(read)), clubLinks: (await read(path.join(root, 'real-data/official-club-links.json'))).clubs, precisePositions: (await read(path.join(root, 'real-data/player-position-evidence.json'))).positions, version });
  // The public parser enforces the same contract a player uses to load the resulting file.
  const text = JSON.stringify({ checksum: hash(pack), writtenAt: new Date().toISOString(), pack }, null, 2);
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  try { const { parseDataPack } = await server.ssrLoadModule('/src/world/data-pack.ts'); await parseDataPack(text); }
  finally { await server.close(); }
  await writeFile(`${out}.audit.json`, JSON.stringify(report, null, 2), { flag: 'wx' });
  await writeFile(out, text, { flag: 'wx' });
  console.log(JSON.stringify({ file: out, version, ...report.scope, profilesMatched: report.officialMatched, profilesChanged: report.changes.length, estimatedPositions: report.estimates, membershipConflicts: report.membershipConflicts.length, unmatchedOfficial: report.unmatchedOfficial.length, missingMembership: report.missingMembership.length, newProviderIds: report.newProviderIds.length }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
