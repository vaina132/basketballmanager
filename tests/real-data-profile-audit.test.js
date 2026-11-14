import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { auditProfiles, matchOfficialProfile, officialPeople, resolvePosition } from '../scripts/real-data-profile-audit.mjs';
import { checkedProviderRows, rosterRequests } from '../scripts/real-data-roster-snapshot.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const observedAt = '2026-11-14T12:00:00Z';
const person = (code = '001', name = 'DOE, KAI', extra = {}) => ({ type: 'J', active: true, season: { code: 'E2026' }, startDate: '2026-07-01T00:00:00', endDate: null, club: { code: 'AAA' }, positionName: 'Center', dorsal: '88', person: { code, name, height: 211, weight: 105, birthDate: '2001-01-19T00:00:00', country: { name: 'X' } }, ...extra });
const document = rows => ({ status: 200, url: 'https://official.example/people', fetchedAt: observedAt, body: { total: rows.length, data: rows } });
const body = rows => ({ errors: [], results: rows.length, response: rows });
function fixture() {
  const players = [
    { id: 'player-a', name: 'K. Doe', clubId: 'club-a', position: 'PF', age: 22, number: 1, heightCm: 206, weightKg: 106, attributes: { twoPoint: 12 }, estimated: ['game_position', 'height_cm', 'weight_kg', 'defense'] },
    { id: 'player-b', name: 'Colin Test', clubId: 'club-b', position: 'SG', age: 26, number: 2, heightCm: 194, weightKg: 89, attributes: { twoPoint: 11 }, estimated: ['defense'] },
  ];
  const base = { version: 'base', season: '2026-27', source: {}, players, clubs: [{ id: 'club-a' }, { id: 'club-b' }], competitions: [{ id: 'league', name: 'Basketball Bundesliga', clubIds: ['club-a', 'club-b'] }] };
  const clubLinks = [{ club_id: 'a', provider_id: '11' }, { club_id: 'b', provider_id: '22' }];
  const requests = rosterRequests(base, clubLinks);
  const snapshot = { model: 'roster-observations-1', status: 'complete', baseVersion: base.version, baseChecksum: hash(base), season: base.season, finishedAt: observedAt, clubLinks, playerLinks: [{ player_id: 'a', provider_id: '1' }, { player_id: 'b', provider_id: '2' }], observations: requests.map((request, index) => ({ ...request, url: `https://provider.example/${request.team}`, observedAt, body: body([{ id: index + 1, position: index ? 'Guard' : null }]) })) };
  return { base, snapshot, officialDocuments: [document([person()])], clubLinks: [{ apiSportsId: '11', officialCode: 'AAA' }], version: 'new' };
}

describe('profile evidence and scoped roster observations', () => {
  it('uses exact roles but labels broad and missing roles as estimates', () => {
    expect(resolvePosition('Center', 'PF')).toMatchObject({ position: 'C', estimated: false });
    expect(resolvePosition(' small forward ', 'SG')).toMatchObject({ position: 'SF', estimated: false });
    expect(resolvePosition('Guard', 'PG')).toMatchObject({ position: 'PG', estimated: true });
    expect(resolvePosition('Forward', 'SG')).toMatchObject({ position: 'SF', estimated: true });
    expect(resolvePosition(null, 'PF')).toMatchObject({ position: 'PF', estimated: true });
  });
  it('refuses ambiguous initials and matches names only inside the supplied club scope', () => {
    expect(matchOfficialProfile('K. Doe', [person()]).row.person.code).toBe('001');
    expect(matchOfficialProfile('K. Doe', [person(), person('002', 'DOE, KEVIN')])).toBeNull();
    expect(matchOfficialProfile('Someone Else', [person()])).toBeNull();
    expect(matchOfficialProfile('Kai Doe', [person(), person()])).toBeNull();
  });
  it('rejects partial, duplicate or wrong-season official pages and excludes future/inactive registrations', () => {
    expect(() => officialPeople([{ ...document([person()]), body: { total: 2, data: [person()] } }], '2026-11-14')).toThrow(/Incomplete/);
    expect(() => officialPeople([document([person(), person()])], '2026-11-14')).toThrow(/Duplicate/);
    expect(() => officialPeople([document([person('001', 'DOE, KAI', { season: { code: 'E2025' } })])], '2026-11-14')).toThrow(/another season/);
    expect(officialPeople([document([person('a', 'DOE, KAI', { active: false }), person('b', 'DOE, KAI', { startDate: '2026-12-01' }), person('c', 'DOE, KAI', { endDate: '2026-10-01' })])], '2026-11-14')).toEqual([]);
  });
  it.each([
    { errors: { quota: 'exceeded' }, results: 1, response: [{ id: 1 }] },
    { errors: [], results: 2, response: [{ id: 1 }] },
    { errors: [], results: 0, response: [] },
    body([{ id: 1 }, { id: 1 }]),
    { ...body([{ id: 1 }]), paging: { total: 2 } },
  ])('refuses unsafe provider responses %#', value => expect(() => checkedProviderRows(value)).toThrow());
  it('deduplicates the same team/season while retaining competition scope', () => {
    const { base, snapshot } = fixture();
    base.competitions.push({ ...base.competitions[0], id: 'other' });
    const requests = rosterRequests(base, snapshot.clubLinks);
    expect(requests).toHaveLength(2);
    expect(requests[0].competitionIds).toEqual(['league', 'other']);
    expect(() => rosterRequests(base, [])).toThrow(/stable provider identity/);
  });
  it('corrects official profile facts, preserves ratings and flags unverified provider ages', () => {
    const input = fixture(), frozen = JSON.stringify(input.base);
    const { pack, report } = auditProfiles(input);
    expect(report.officialMatched).toBe(1);
    expect(pack.players[0]).toMatchObject({ name: 'Kai Doe', position: 'C', birthDate: '2001-01-19', age: 25, number: 88, heightCm: 211, weightKg: 105, attributes: input.base.players[0].attributes, estimated: ['defense'] });
    expect(pack.players[1].estimated).toEqual(['age-unverified', 'defense', 'game_position']);
    expect(JSON.stringify(input.base)).toBe(frozen);
    expect(pack.clubs).toEqual(input.base.clubs);
  });
  it('records conflicting memberships and new identities without choosing a transfer or inventing a player', () => {
    const input = fixture();
    input.snapshot.observations[1].body = body([{ id: 2, position: 'Guard' }, { id: 1 }, { id: 99 }]);
    const { pack, report } = auditProfiles(input);
    expect(pack.players).toHaveLength(2);
    expect(pack.players[0].clubId).toBe('club-a');
    expect(pack.players[0].profileEvidence.membership).toBe('needs-review');
    expect(report.membershipConflicts).toHaveLength(1);
    expect(report.newProviderIds).toEqual(['99']);
  });
  it('requires precise override identity, season and evidence to reconcile', () => {
    const input = fixture();
    input.precisePositions = [{ apiSportsId: '1', officialPersonCode: '001', season: '2026-27', position: 'C', observedOn: '2026-11-14', sources: ['https://club.example/roster'] }];
    expect(auditProfiles(input).pack.players[0].profileEvidence.positionSource).toBe('official');
    input.precisePositions[0].officialPersonCode = 'someone-else';
    expect(() => auditProfiles(input)).toThrow(/identity does not reconcile/);
  });
  it('refuses incomplete scope, stale base and overwriting a version', () => {
    const incomplete = fixture(); incomplete.snapshot.observations.pop();
    expect(() => auditProfiles(incomplete)).toThrow(/Incomplete roster/);
    const modified = fixture(); modified.base.players[0].age = 99;
    expect(() => auditProfiles(modified)).toThrow(/exact base/);
    expect(() => auditProfiles({ ...fixture(), version: 'base' })).toThrow(/new pack version/);
  });
});
