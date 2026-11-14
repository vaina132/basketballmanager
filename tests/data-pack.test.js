import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { matchdayTeam, NEUTRAL_APPEARANCE, NEUTRAL_CLUB_COLOR, parseDataPack } from '../src/world/data-pack.ts';
import { createFixtureMatch } from '../src/engine/match.ts';
import { validateMatchState } from '../src/storage/validate-match.ts';
import { parseMatch, serializeMatch } from '../src/storage/match-storage.ts';

const positions = ['PG', 'SG', 'SF', 'PF', 'C'];
function player(club, index, overrides = {}) {
  return { id: `player-${club}-${index}`, name: `${club} Player ${index}`, clubId: `club-${club}`, number: index % 7, position: positions[index % 5], nationality: 'X', age: 25, heightCm: 200, weightKg: 97,
    attributes: { twoPoint: 8 + (index % 9), threePoint: 10, freeThrow: 12, passing: 9, defense: 11, rebounding: 10, stamina: 14 }, estimated: ['defense', 'height_cm', 'weight_kg'], ...overrides };
}
const players = [...Array.from({ length: 16 }, (_, index) => player('a', index)), ...Array.from({ length: 14 }, (_, index) => player('b', index, index === 0 ? { attributes: { twoPoint: 20, threePoint: 20, freeThrow: 20, passing: 20, defense: 20, rebounding: 20, stamina: 20 }, estimated: ['all-abilities'] } : {}))];
const pack = {
  format: 'basketball-manager-data-pack', formatVersion: 1, version: 'test-1', season: '2026-27', source: { provider: 'test' }, notice: 'Private test data.',
  competitions: [{ id: 'competition-x', name: 'League', country: 'X', tier: 1, kind: 'domestic', season: '2026-27', clubIds: ['club-a', 'club-b'] }],
  clubs: [
    { id: 'club-a', name: 'Alpha', shortName: 'ALP', country: 'X', city: null, arena: null, color: '#ff0000', secondaryColor: null, identitySource: null, playerIds: players.filter(item => item.clubId === 'club-a').map(item => item.id) },
    { id: 'club-b', name: 'Beta', shortName: 'BET', country: 'X', city: null, arena: null, color: null, secondaryColor: null, identitySource: null, playerIds: players.filter(item => item.clubId === 'club-b').map(item => item.id) },
  ],
  players,
};
const file = (contents, checksum = createHash('sha256').update(JSON.stringify(contents)).digest('hex')) => JSON.stringify({ checksum, writtenAt: '2026-11-13T00:00:00Z', pack: contents });

describe('real-data packs in the game', () => {
  it('rejects invalid dates and contradictory position evidence even with a recomputed fingerprint', async () => {
    const invalid = structuredClone(pack);
    invalid.players[0].birthDate = '2000-02-31';
    await expect(parseDataPack(file(invalid))).rejects.toThrow(/birth date/);
    invalid.players[0].birthDate = '2001-01-19';
    invalid.players[0].profileEvidence = { observedAt: '2026-11-14T12:00:00Z', positionSource: 'estimated', membership: 'provider-observed', sources: ['https://provider.example/player'] };
    await expect(parseDataPack(file(invalid))).rejects.toThrow(/inconsistent position/);
    invalid.players[0].estimated.push('game_position');
    expect((await parseDataPack(file(invalid))).players[0].birthDate).toBe('2001-01-19');
  });
  it('accepts a pack whose fingerprint matches and refuses a changed one', async () => {
    expect((await parseDataPack(file(pack))).version).toBe('test-1');
    const changed = JSON.parse(file(pack));
    changed.pack.players[0].attributes.twoPoint = 20;
    await expect(parseDataPack(JSON.stringify(changed))).rejects.toThrow(/do not match its fingerprint/);
    await expect(parseDataPack('not json')).rejects.toThrow(/not a data pack file/);
    const broken = structuredClone(pack); broken.players[0].attributes.passing = 25;
    await expect(parseDataPack(file(broken))).rejects.toThrow(/abilities outside 1-20/);
  });

  it('fields twelve players with a starting five across positions, unique numbers and neutral figures', () => {
    const team = matchdayTeam(pack, 'club-a');
    expect(team.players).toHaveLength(12);
    expect(team.players.slice(0, 5).map(item => item.position).sort()).toEqual([...positions].sort());
    expect(new Set(team.players.map(item => item.number)).size).toBe(12);
    expect(team.players.every(item => item.skinTone === NEUTRAL_APPEARANCE.skinTone && item.hairColor === NEUTRAL_APPEARANCE.hairColor)).toBe(true);
  });

  it('puts players without statistics last, uses a neutral colour when none is verified, and plays a valid match', () => {
    const team = matchdayTeam(pack, 'club-b');
    expect(team.color).toBe(NEUTRAL_CLUB_COLOR);
    expect(team.players.some(item => item.id === 'player-b-0')).toBe(false);
    const match = createFixtureMatch(42, matchdayTeam(pack, 'club-a'), team);
    expect(() => validateMatchState(match)).not.toThrow();
  });

  it('keeps a saved friendly exactly as it was when a newer pack changes the same players', async () => {
    const saved = serializeMatch(createFixtureMatch(7, matchdayTeam(pack, 'club-a'), matchdayTeam(pack, 'club-b')));
    const newer = structuredClone(pack);
    newer.version = 'test-2';
    for (const item of newer.players) item.attributes = { ...item.attributes, twoPoint: 20, rebounding: 1 };
    const loaded = await parseDataPack(file(newer));
    expect(loaded.version).toBe('test-2');
    expect(matchdayTeam(loaded, 'club-a').players[0].attributes.twoPoint).toBe(20);
    // The save holds its own copy of both squads; it never looks at a pack again.
    const reopened = parseMatch(saved);
    expect(reopened).toEqual(parseMatch(saved));
    expect(reopened.home.players.map(item => item.attributes)).toEqual(matchdayTeam(pack, 'club-a').players.map(item => item.attributes));
    expect(reopened.home.players.some(item => item.attributes.twoPoint === 20 && item.attributes.rebounding === 1)).toBe(false);
    expect((await parseDataPack(file(pack))).version).toBe('test-1');
  });
});
