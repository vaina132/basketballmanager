import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PLAYER_NAMES } from '../src/data/player-names.ts';
import { parseDataPack } from '../src/world/data-pack.ts';
import { packPlayerName } from '../src/world/player-names.ts';

/** Real players carry close-sounding game names (owner decision, 27 November 2026). */
const key = name => name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const positions = ['PG', 'SG', 'SF', 'PF', 'C'];
const [realId, newName] = Object.entries(PLAYER_NAMES)[0].map((value, index) => index === 0 ? `player-${value}` : value);
const player = (id, index) => ({ id, name: `Real Name ${index}`, clubId: 'club-a', number: index, position: positions[index % 5], nationality: 'X', age: 25, heightCm: 200, weightKg: 95,
  attributes: { twoPoint: 10, threePoint: 10, freeThrow: 12, passing: 9, defense: 11, rebounding: 10, stamina: 14 }, estimated: [] });
const players = [player(realId, 0), ...Array.from({ length: 9 }, (_, index) => player(`player-test-${index + 1}`, index + 1))];
const pack = {
  format: 'basketball-manager-data-pack', formatVersion: 1, version: 'test-1', season: '2026-27', source: { provider: 'test' }, notice: 'Private test data.',
  competitions: [{ id: 'competition-x', name: 'League', country: 'X', tier: 1, kind: 'domestic', season: '2026-27', clubIds: ['club-a'] }],
  clubs: [{ id: 'club-a', name: 'Alpha', shortName: 'ALP', country: 'X', city: null, arena: null, color: '#ff0000', secondaryColor: null, identitySource: null, playerIds: players.map(item => item.id) }],
  players,
};
const file = contents => JSON.stringify({ checksum: createHash('sha256').update(JSON.stringify(contents)).digest('hex'), writtenAt: '2026-11-27T00:00:00Z', pack: contents });

describe('player game names', () => {
  it('gives every recorded player a distinct, usable name', () => {
    const names = Object.values(PLAYER_NAMES);
    expect(names.length).toBeGreaterThanOrEqual(3500);
    expect(new Set(names.map(key)).size).toBe(names.length);
    for (const [id, name] of Object.entries(PLAYER_NAMES)) {
      expect(id).toMatch(/^[0-9a-z-]+$/);
      expect(name.trim()).toBe(name);
      expect(name.length).toBeLessThanOrEqual(40);
    }
  });

  it('replaces a real player\'s name when a pack is read and leaves other players alone', async () => {
    expect(packPlayerName(realId, 'Real Name 0')).toBe(newName);
    expect(packPlayerName('player-test-1', 'Real Name 1')).toBe('Real Name 1');
    const parsed = await parseDataPack(file(pack));
    expect(parsed.players.find(item => item.id === realId).name).toBe(newName);
    expect(parsed.players.find(item => item.id === 'player-test-1').name).toBe('Real Name 1');
  });
});
