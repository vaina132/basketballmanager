import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { reconcileMemberships } from '../scripts/real-data-membership-audit.mjs';
import { rosterRequests } from '../scripts/real-data-roster-snapshot.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const at = '2026-11-14T12:00:00Z';
function input() {
  const base = { version: 'one', season: '2026-27', source: {}, competitions: [{ id: 'league', name: 'Basketball Bundesliga', clubIds: ['club-a', 'club-b'] }], clubs: [{ id: 'club-a', playerIds: ['player-a'] }, { id: 'club-b', playerIds: [] }], players: [{ id: 'player-a', name: 'Kai Example', clubId: 'club-a', birthDate: '2001-01-01', estimated: ['club-membership-unverified', 'defense'], attributes: { twoPoint: 13 }, profileEvidence: { observedAt: at, positionSource: 'provider', membership: 'needs-review', sources: ['https://provider.example/old'] } }] };
  const clubLinks = [{ provider_id: '11', club_id: 'a' }, { provider_id: '22', club_id: 'b' }];
  const snapshot = { model: 'roster-observations-1', status: 'complete', season: base.season, baseVersion: base.version, baseChecksum: hash(base), finishedAt: at, clubLinks, playerLinks: [{ provider_id: '99', player_id: 'a' }], observations: rosterRequests(base, clubLinks).map(request => ({ ...request, url: `https://provider.example/${request.team}`, observedAt: at, body: { errors: [], results: 1, response: [{ id: 99, name: 'Example Kai' }] } })) };
  const row = { type: 'J', active: true, season: { code: 'E2026' }, startDate: '2026-09-01', endDate: null, club: { code: 'BBB' }, person: { code: '0099', name: 'EXAMPLE, KAI', birthDate: '2001-01-01' } };
  const officialDocuments = [{ status: 200, url: 'https://official.example/2026/people', fetchedAt: at, body: { total: 1, data: [row] } }];
  const observationBase = structuredClone(base);
  base.version = 'two'; base.source.parentVersion = observationBase.version;
  return { base, observationBase, snapshot, officialDocuments, clubLinks: [{ apiSportsId: '11', officialCode: 'AAA' }, { apiSportsId: '22', officialCode: 'BBB' }], version: 'three' };
}
describe('source-correlated membership revisions', () => {
  it('moves a uniquely identified player only when official and stable provider evidence agree', () => {
    const value = input(), before = JSON.stringify(value);
    const { pack, report } = reconcileMemberships(value);
    expect(pack.players[0].clubId).toBe('club-b');
    expect(pack.clubs.map(club => club.playerIds)).toEqual([[], ['player-a']]);
    expect(pack.players[0].attributes).toEqual(value.base.players[0].attributes);
    expect(pack.players[0].estimated).toEqual(['defense']);
    expect(report.changed[0]).toMatchObject({ officialPersonCode: '0099', fromClubId: 'club-a', toClubId: 'club-b', observedOn: '2026-11-14' });
    expect(JSON.stringify(value)).toBe(before);
  });
  it('does not infer a transfer from a matching name without a provider observation at the destination', () => {
    const value = input(), destination = value.snapshot.observations.find(row => row.clubId === 'club-b');
    destination.body = { errors: [], results: 1, response: [{ id: 1234, name: 'Another Player' }] };
    const { pack, report } = reconcileMemberships(value);
    expect(pack.players[0].clubId).toBe('club-a');
    expect(report.changed).toEqual([]);
    expect(report.unresolved).toHaveLength(1);
  });
  it('rejects birth-date conflicts, initials without a reviewed identity and inactive registrations', () => {
    for (const change of [value => { value.officialDocuments[0].body.data[0].person.birthDate = '2002-01-01'; }, value => { value.base.players[0].name = 'K. Example'; }, value => { value.officialDocuments[0].body.data[0].active = false; }]) {
      const value = input(); change(value);
      expect(reconcileMemberships(value).report.changed).toEqual([]);
    }
  });
  it('refuses partial scopes, wrong parents and incomplete official snapshots', () => {
    for (const change of [value => { value.snapshot.observations.pop(); }, value => { value.snapshot.baseChecksum = 'wrong'; }, value => { value.officialDocuments[0].body.total = 2; }, value => { value.version = value.base.version; }, value => { value.base.version = value.observationBase.version; }, value => { value.snapshot.playerLinks.push(value.snapshot.playerLinks[0]); }]) {
      const value = input(); change(value); expect(() => reconcileMemberships(value)).toThrow();
    }
  });
  it('leaves conflicting canonical identities unresolved rather than merging or duplicating a person', () => {
    const value = input();
    value.base.players.push({ ...structuredClone(value.base.players[0]), id: 'player-b' });
    value.snapshot.playerLinks.push({ provider_id: '98', player_id: 'b' });
    value.snapshot.observations.forEach(row => { row.body.response.push({ id: 98, name: 'Kai Example' }); row.body.results++; });
    const { report } = reconcileMemberships(value);
    expect(report.changed).toEqual([]);
    expect(report.unresolved.every(row => row.reason === 'ambiguous-canonical-identity')).toBe(true);
  });
  it('reconciles the EuroCup field only when all 32 official clubs have reviewed identities', () => {
    const value = input();
    const clubs = Array.from({ length: 33 }, (_, index) => ({ id: `club-u${index}`, playerIds: [] }));
    value.base.clubs.push(...clubs);
    value.base.competitions.push({ id: 'eurocup', name: 'EuroCup', clubIds: clubs.map(club => club.id) });
    const links = clubs.map((club, i) => ({ provider_id: String(1000 + i), club_id: `u${i}` }));
    value.observationBase = { ...structuredClone(value.base), version: 'one', source: {} };
    value.snapshot.clubLinks.push(...links);
    value.snapshot.baseChecksum = hash(value.observationBase);
    const expected = rosterRequests(value.observationBase, value.snapshot.clubLinks);
    const old = new Map(value.snapshot.observations.map(row => [`${row.team}/${row.season}`, row]));
    value.snapshot.observations = expected.map(request => ({ ...request, url: `https://provider.example/${request.team}`, observedAt: at, body: old.get(`${request.team}/${request.season}`)?.body ?? { errors: [], results: 1, response: [{ id: Number(request.team) * 10, name: 'Unmapped Player' }] } }));
    value.clubLinks.push(...clubs.slice(0, 32).map((club, i) => ({ apiSportsId: String(1000 + i), officialCode: `U${i}` })));
    value.officialDocuments.push({ status: 200, url: 'https://official.example/U2026/people', fetchedAt: at, body: { total: 32, data: clubs.slice(0, 32).map((club, i) => ({ type: 'J', active: true, season: { code: 'U2026' }, startDate: '2026-09-01', endDate: null, club: { code: `U${i}` }, person: { code: `PERSON${i}`, name: `OFFICIAL, PERSON ${i}` } })) } });
    const { pack, report } = reconcileMemberships(value);
    expect(pack.competitions.find(row => row.id === 'eurocup').clubIds).toHaveLength(32);
    expect(report.competitionFields[0].removed).toEqual(['club-u32']);
    expect(pack.clubs.some(club => club.id === 'club-u32')).toBe(true);
    value.clubLinks.pop();
    expect(() => reconcileMemberships(value)).toThrow(/complete reviewed/);
  });
});
