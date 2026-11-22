import { describe, expect, it } from 'vitest';
import { apiSquads, combineBatches, samePerson, withdrawClub } from '../scripts/real-data-api-squads.mjs';

const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const attributes = { twoPoint: 10, threePoint: 10, freeThrow: 10, passing: 10, defense: 10, rebounding: 10, stamina: 10 };
const player = (n, name, club, extra = {}) => ({ id: `player-${uuid(n)}`, name, clubId: `club-${uuid(club)}`, number: null, position: 'SF', nationality: null, age: 25, heightCm: 200, weightKg: 97, attributes, estimated: [], ratingMinutes: 400, ...extra });
function world() {
  const players = [
    player(1, 'Ali Stays', 100), player(2, 'Bora Mover', 100), player(3, 'Can Listed Twice', 101),
    player(4, 'Omer Al', 102), player(5, 'Deniz Elsewhere', 103, { profileEvidence: { membership: 'official-registration-observed' } }),
    { ...player(6, 'Ömer Utku Al', 101), id: 'player-n000000000000000000000001', birthDate: '1998-02-03' },
    player(7, 'Kept One', 104), player(8, 'Free One', 104),
  ];
  const clubs = [100, 101, 102, 103, 104, 105].map(n => ({ id: `club-${uuid(n)}`, name: `Club ${n}`, playerIds: players.filter(item => item.clubId === `club-${uuid(n)}`).map(item => item.id) }));
  return { season: '2026-27', competitions: [{ id: 'competition-tbl', name: 'Türkiye Basketbol Ligi', clubIds: [clubs[0].id, clubs[1].id] }, { id: 'competition-x', name: 'Other', clubIds: clubs.slice(2).map(club => club.id) }], clubs, players };
}
const lists = [
  { clubId: `club-${uuid(100)}`, team: 1, players: [{ id: 11, name: 'Stays Ali' }, { id: 13, name: 'Listed Twice Can' }, { id: 15, name: 'Elsewhere Deniz' }, { id: 99, name: 'N. Newcomer', position: 'Guard', number: '7', age: 20 }] },
  { clubId: `club-${uuid(101)}`, team: 2, players: [{ id: 12, name: 'Mover Bora' }, { id: 13, name: 'Listed Twice Can' }, { id: 14, name: 'Al Omer' }, { id: 16, name: 'Left Earlier', position: 'Center' }] },
];
const providerToPlayer = { 11: uuid(1), 12: uuid(2), 13: uuid(3), 14: uuid(4), 15: uuid(5), 16: uuid(9) };
const games = [
  { p: uuid(2), c: uuid(100), n: 5, d: '2026-10-20', m: 100 }, { p: uuid(2), c: uuid(101), n: 2, d: '2026-11-08', m: 40 },
  { p: uuid(4), c: uuid(102), n: 2, d: '2026-10-16', m: 16 }, { p: uuid(4), c: uuid(101), n: 3, d: '2026-11-13', m: 72 },
  { p: uuid(9), c: uuid(101), n: 1, d: '2026-10-11', m: 4 },
];
const clubRows = [{ entity_id: uuid(101), value: { value: [{ id: 'player-n000000000000000000000001', name: 'Ömer Utku Al', number: 3, position: 'PG', birthDate: '1998-02-03' }], sources: ['https://en.wikipedia.org/wiki/Example'], observedOn: '2026-11-18' } }];
const known = [{ id: uuid(9), name: 'Lefty Earlier', nationality: 'Turkey', age: 22, rating: { game_position: 'C' }, overrides: { squad_status: { value: 'left' } } }];

describe('current squads from API-Sports lists and box scores', () => {
  it('moves by the latest game, adds listed players missing from the pack and drops a twin entry', () => {
    const pack = world();
    const { rows, review } = apiSquads({ pack, lists, providerToPlayer, games, known, clubRows, observedOn: '2026-11-22', batch: 'test' });
    const moves = Object.fromEntries(rows.filter(row => row.field === 'club_id').map(row => [row.entity_id, row.value.value]));
    expect(moves).toEqual({ [uuid(2)]: uuid(101), [uuid(4)]: uuid(101) });
    // Listed by both clubs without games, and confirmed elsewhere by an official roster: both stay.
    expect(moves[uuid(3)]).toBeUndefined();
    expect(moves[uuid(5)]).toBeUndefined();
    expect(review.droppedDuplicates).toEqual([{ club: 'Club 101', dropped: 'Ömer Utku Al', keeps: 'Omer Al' }]);
    expect(rows.find(row => row.entity_id === uuid(4) && row.field === 'full_name').value.value).toBe('Ömer Utku Al');
    expect(rows.find(row => row.entity_id === uuid(4) && row.field === 'birth_date').value.value).toBe('1998-02-03');
    const added = Object.fromEntries(rows.filter(row => row.field === 'added_players').map(row => [row.entity_id, row.value.value]));
    expect(added[uuid(100)].map(item => [item.name, item.position, item.number, item.age])).toEqual([['N. Newcomer', 'SG', 7, 20]]);
    expect(added[uuid(101)].map(item => [item.name, item.position])).toEqual([['Lefty Earlier', 'C']]);
    for (const list of Object.values(added)) for (const item of list) {
      expect(item.id).toMatch(/^player-n[0-9a-f]{24}$/);
      expect(item.estimated).toContain('all-abilities');
      expect(Object.keys(item.attributes).sort()).toEqual(Object.keys(attributes).sort());
    }
    expect(rows.every(row => row.value.sources.every(url => url.startsWith('https://')))).toBe(true);
  });

  it('withdraws a club: earlier blocked moves go ahead, the rest leave', () => {
    const pack = world();
    const blocked = [{ entity_id: uuid(7), value: { method: 'kept-for-minimum-squad', listedAt: uuid(105), sources: ['https://official.example/roster'], observedOn: '2026-11-18' } }];
    const { rows, review } = withdrawClub({ pack, clubId: `club-${uuid(104)}`, blocked, source: 'https://news.example/withdrawn', observedOn: '2026-11-22', batch: 'test' });
    expect(rows.map(row => [row.entity_id, row.field, row.value.value])).toEqual([[uuid(7), 'club_id', uuid(105)], [uuid(8), 'squad_status', 'left']]);
    expect(review).toEqual({ club: 'Club 104', moved: [{ player: 'Kept One', to: 'Club 105' }], left: ['Free One'] });
  });

  it('refuses a combined batch with a repeated key or an unknown id, and lets a game-based move win over a later leave', () => {
    const pack = world();
    const move = { entity_type: 'player', entity_id: uuid(2), field: 'club_id', value: { value: uuid(101), sources: ['https://a.example'], observedOn: '2026-11-22' }, reason: 'x' };
    const leave = { entity_type: 'player', entity_id: uuid(2), field: 'squad_status', value: { value: 'left', sources: ['https://b.example'], observedOn: '2026-11-22', batch: 'other' }, reason: 'y' };
    const ok = combineBatches({ pack, batches: [{ batch: 'a', rows: [move] }, { batch: 'b', rows: [leave] }], batch: 'all', observedOn: '2026-11-22' });
    expect(ok.problems).toEqual([]);
    expect(ok.file.rows).toEqual([move]);
    expect(ok.dropped).toHaveLength(1);
    const bad = combineBatches({ pack, batches: [{ batch: 'a', rows: [move, { ...move, entity_id: uuid(77) }] }, { batch: 'b', rows: [move] }], batch: 'all', observedOn: '2026-11-22' });
    expect(bad.problems).toEqual([`unknown player ${uuid(77)}`, `player/${uuid(2)}/club_id in a and b`]);
  });

  it('treats the same initial and last name as one person', () => {
    expect(samePerson('Omer Al', 'Ömer Utku Al')).toBe(true);
    expect(samePerson('O. Al', 'Ömer Al')).toBe(true);
    expect(samePerson('Ali Stays', 'Bora Stays')).toBe(false);
  });
});
