#!/usr/bin/env node
import { readFile, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reconcileMemberships } from './real-data-membership-audit.mjs';

async function main() {
  const arg = name => { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1]; };
  const basePath = arg('--base'), parentPath = arg('--observation-base'), snapshotPath = arg('--snapshot'), officialPaths = arg('--official'), version = arg('--version'), out = arg('--out');
  if (![basePath, parentPath, snapshotPath, officialPaths, version, out].every(Boolean)) throw new Error('Use --base FILE --observation-base FILE --snapshot FILE --official FILE,FILE --version NEW --out NEW_FILE.');
  for (const file of [out, `${out}.audit.json`]) { try { await access(file); } catch (error) { if (error.code === 'ENOENT') continue; throw error; } throw new Error('Output already exists; choose a new immutable revision.'); }
  const read = async file => JSON.parse(await readFile(file, 'utf8'));
  const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const base = await read(basePath), parent = await read(parentPath);
  if (hash(base.pack) !== base.checksum || hash(parent.pack) !== parent.checksum) throw new Error('Input pack checksum mismatch.');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const { pack, report } = reconcileMemberships({ base: base.pack, observationBase: parent.pack, snapshot: await read(snapshotPath), officialDocuments: await Promise.all(officialPaths.split(',').map(read)), clubLinks: (await read(path.join(root, 'real-data/official-club-links.json'))).clubs, version });
  const text = JSON.stringify({ checksum: hash(pack), writtenAt: new Date().toISOString(), pack }, null, 2);
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  try {
    const { parseDataPack } = await server.ssrLoadModule('/src/world/data-pack.ts');
    await parseDataPack(JSON.stringify(base)); await parseDataPack(JSON.stringify(parent)); await parseDataPack(text);
  }
  finally { await server.close(); }
  await writeFile(`${out}.audit.json`, JSON.stringify(report, null, 2), { flag: 'wx' });
  await writeFile(out, text, { flag: 'wx' });
  console.log(JSON.stringify({ file: out, confirmed: report.confirmed.length, changed: report.changed.length, unresolved: report.unresolved.length, extraOfficial: report.extraOfficial.length, competitionFields: report.competitionFields.map(row => ({ competitionId: row.competitionId, clubs: row.clubIds.length, removed: row.removed.length, added: row.added.length })) }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
