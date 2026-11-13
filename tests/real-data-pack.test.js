import { describe, expect, it } from 'vitest';
import { buildPack, packChecksum, packProblems, PACK_FORMAT } from '../scripts/real-data-pack.mjs';

// Synthetic database rows: one competition with two clubs of ten players; one player moved during the season.
const clubs = [
  { id: 'a', name: 'Alpha', short_name: 'ALP', country: 'X', city: 'A-town', venue: 'A Hall', color_primary: '#ff0000', color_secondary: '#ffffff', identity_source: 'test (sure)' },
  { id: 'b', name: 'Beta', short_name: 'BET', country: 'X', city: 'B-town', venue: 'B Hall', color_primary: null, color_secondary: null, identity_source: 'test (unknown)' },
];
const players = Array.from({ length: 21 }, (_, index) => ({ id: `p${index}`, full_name: `Player ${index}`, nationality: 'X', position: ['Guard', 'Forward', 'Center'][index % 3], age_observed: 25, merged_into: index === 20 ? 'p0' : null }));
const memberships = players.map((player, index) => ({ player_id: player.id, club_id: index < 10 ? 'a' : 'b', shirt_number: index, first_seen_on: '2026-09-01', last_seen_on: '2026-10-01' }));
// p0 was seen later at Beta: he counts for his most recent squad.
memberships.push({ player_id: 'p0', club_id: 'b', shirt_number: 7, first_seen_on: '2026-10-15', last_seen_on: '2026-11-13' });
memberships.push({ player_id: 'p10', club_id: 'a', shirt_number: 30, first_seen_on: '2026-09-01', last_seen_on: '2026-09-02' });
const ratings = players.slice(0, 19).map(player => ({ player_id: player.id, two_point: 12, three_point: 11, free_throw: 13, passing: 10, defense: 14, rebounding: 9, stamina: 15, game_position: 'SF', height_cm: 200, weight_kg: 97, estimated: ['weight_kg', 'defense', 'height_cm'] }));
const input = { version: 'test-1', season: '2026-27', competitions: [{ id: 'c', name: 'League', country: 'X', tier: 1, kind: 'domestic', clubIds: ['a', 'b'] }], clubs, memberships, players, ratings, source: { provider: 'test' } };

describe('real-data pack', () => {
  it('assembles current squads from the latest membership, skips merged records and estimates unrated players', () => {
    const { pack, problems, warnings, summary } = buildPack(input);
    expect([pack.format, pack.version, pack.season]).toEqual([PACK_FORMAT, 'test-1', '2026-27']);
    expect(summary).toEqual({ competitions: 1, clubs: 2, players: 20, unrated: 1 });
    expect(pack.players.find(player => player.id === 'player-p0').clubId).toBe('club-b');
    expect(pack.players.some(player => player.id === 'player-p20')).toBe(false);
    expect(pack.players.find(player => player.id === 'player-p19')).toMatchObject({ attributes: { twoPoint: 9, stamina: 9 }, estimated: expect.arrayContaining(['all-abilities']) });
    expect(pack.clubs.find(club => club.id === 'club-b')).toMatchObject({ color: null, city: 'B-town', arena: 'B Hall' });
    // Alpha lost p0 to Beta and has nine players left, below the ten a squad needs.
    expect(problems).toEqual(['Alpha has only 9 players in 2026-27']);
    expect(warnings.join(' ')).toMatch(/No verified colours yet for 1 clubs: Beta/);
  });

  it('gives the same contents the same fingerprint and different contents a different one', () => {
    const first = buildPack(input).pack, again = buildPack(input).pack;
    expect(packChecksum(again)).toBe(packChecksum(first));
    expect(packChecksum({ ...first, version: 'test-2' })).not.toBe(packChecksum(first));
  });

  it('finds an earlier published pack that went missing or no longer matches its recorded checksum', () => {
    const pack = buildPack(input).pack, checksum = packChecksum(pack);
    const versions = [{ id: 'test-1', checksum, storage_path: 'local:packs/real-test-1.json' }];
    expect(packProblems(versions, new Map([['test-1', { checksum, pack }]]))).toEqual([]);
    const edited = structuredClone(pack); edited.players[0].attributes.twoPoint = 20;
    expect(packProblems(versions, new Map([['test-1', { checksum, pack: edited }]]))).toEqual(['test-1: pack file no longer matches its recorded checksum']);
    expect(packProblems(versions, new Map())).toEqual(['test-1: pack file local:packs/real-test-1.json is missing']);
  });
});
