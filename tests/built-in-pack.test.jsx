import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BUILT_IN_PACK_URL, fetchBuiltInPack } from '../src/world/built-in-pack';

const positions = ['PG', 'SG', 'SF', 'PF', 'C'];
const player = (club, index) => ({ id: `player-${club}-${index}`, name: `${club} Player ${index}`, clubId: `club-${club}`, number: index + 4, position: positions[index % 5], nationality: 'X', age: 25, heightCm: 200, weightKg: 97,
  attributes: { twoPoint: 10, threePoint: 10, freeThrow: 12, passing: 9, defense: 11, rebounding: 10, stamina: 14 }, estimated: [] });
const players = ['a', 'b', 'c', 'd'].flatMap(club => Array.from({ length: 10 }, (_, index) => player(club, index)));
const pack = {
  format: 'basketball-manager-data-pack', formatVersion: 1, version: 'built-in-1', season: '2026-27', source: { provider: 'test' }, notice: 'Test data.',
  competitions: [{ id: 'league', name: 'League', country: 'X', tier: 1, kind: 'domestic', season: '2026-27', clubIds: ['club-a', 'club-b', 'club-c', 'club-d'] }],
  clubs: ['a', 'b', 'c', 'd'].map(id => ({ id: `club-${id}`, name: `Club ${id}`, shortName: `CL${id.toUpperCase()}`, country: 'X', city: null, arena: null, color: '#336699', secondaryColor: null, identitySource: null, playerIds: players.filter(item => item.clubId === `club-${id}`).map(item => item.id) })),
  players,
};
const text = (contents, checksum = createHash('sha256').update(JSON.stringify(contents)).digest('hex')) => JSON.stringify({ checksum, pack: contents });
const response = (status, body, type = 'application/json') => async url => ({ ok: status >= 200 && status < 300, status, text: async () => body, headers: new Headers({ 'content-type': type }), url });

describe('real-club data shipped with the game (owner decision, 15 November 2026)', () => {
  it('reads and checks the shipped pack from the site', async () => {
    let asked = null;
    const result = await fetchBuiltInPack(async url => { asked = url; return response(200, text(pack))(url); });
    expect(asked).toBe(BUILT_IN_PACK_URL);
    expect(result.status).toBe('loaded');
    expect(result.pack.version).toBe('built-in-1');
    expect(result.pack.clubs).toHaveLength(4);
  });

  it('treats a missing file, or the game page served in its place, as no shipped data', async () => {
    expect(await fetchBuiltInPack(response(404, 'Not found', 'text/plain'))).toEqual({ status: 'missing' });
    expect(await fetchBuiltInPack(response(200, '<!doctype html><html></html>', 'text/html; charset=utf-8'))).toEqual({ status: 'missing' });
  });

  it('reports a damaged file, a server error or no connection without loading anything', async () => {
    const damaged = await fetchBuiltInPack(response(200, text(pack, 'f'.repeat(64))));
    expect(damaged.status).toBe('failed');
    expect(damaged.message).toMatch(/fingerprint/);
    expect((await fetchBuiltInPack(response(503, 'down', 'text/plain'))).status).toBe('failed');
    const offline = await fetchBuiltInPack(async () => { throw new Error('offline'); });
    expect(offline).toEqual({ status: 'failed', message: expect.stringMatching(/connection/) });
  });
});
