/** Reconcile dated official registrations with stable provider identities. Never infer a transfer from a name alone. */
import { createHash } from 'node:crypto';
import { nameKey, officialPeople } from './real-data-profile-audit.mjs';
import { checkedProviderRows, rosterRequests } from './real-data-roster-snapshot.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const unique = values => [...new Set(values)];

export function reconcileMemberships({ base, observationBase, snapshot, officialDocuments, clubLinks, version }) {
  if (!version || version === base.version) throw new Error('Use a new immutable membership revision.');
  if (snapshot.model !== 'roster-observations-1' || snapshot.status !== 'complete' || snapshot.baseChecksum !== hash(observationBase) || snapshot.baseVersion !== observationBase.version || snapshot.season !== base.season || observationBase.season !== base.season) throw new Error('The complete observation snapshot must belong to the supplied parent.');
  if (base.version !== observationBase.version && base.source.parentVersion !== observationBase.version) throw new Error('The pack must be the observed parent or its profile revision.');
  if (base.version === observationBase.version && hash(base) !== hash(observationBase)) throw new Error('The observed parent must be unchanged.');
  const expected = rosterRequests(observationBase, snapshot.clubLinks), seen = new Set();
  for (const [links, canonical] of [[snapshot.playerLinks, 'player_id'], [snapshot.clubLinks, 'club_id']]) {
    // Reviewed aliases may map several provider IDs to one person; one provider ID cannot map to two people.
    if (!Array.isArray(links) || links.some(row => row.provider_id == null || !row[canonical]) || new Set(links.map(row => String(row.provider_id))).size !== links.length) throw new Error('Provider identities must be complete and unique.');
  }
  const providerToPlayer = new Map(snapshot.playerLinks.map(row => [String(row.provider_id), `player-${row.player_id}`]));
  const providerToClub = new Map(snapshot.clubLinks.map(row => [String(row.provider_id), `club-${row.club_id}`]));
  const clubToOfficial = new Map(), officialToClub = new Map();
  for (const link of clubLinks) {
    const id = providerToClub.get(String(link.apiSportsId));
    if (!id || !base.clubs.some(club => club.id === id) || officialToClub.has(link.officialCode) || clubToOfficial.has(id)) throw new Error('Official club identities must be unique and present in the pack.');
    clubToOfficial.set(id, link.officialCode); officialToClub.set(link.officialCode, id);
  }
  const observed = new Map();
  for (const entry of snapshot.observations) {
    const key = `${entry.team}/${entry.season}`, request = expected.find(row => row.team === entry.team && row.season === entry.season);
    if (!request || request.clubId !== entry.clubId || seen.has(key) || JSON.stringify([...request.competitionIds].sort()) !== JSON.stringify([...entry.competitionIds].sort())) throw new Error('Invalid or repeated observation scope.');
    seen.add(key); checkedProviderRows(entry.body);
    for (const row of entry.body.response) {
      const id = providerToPlayer.get(String(row.id));
      if (id) observed.set(id, [...(observed.get(id) ?? []), { clubId: entry.clubId, name: row.name, source: entry.url }]);
    }
  }
  if (seen.size !== expected.length) throw new Error('Incomplete observation scope.');
  const asOf = snapshot.finishedAt?.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf ?? '') || !Number.isFinite(Date.parse(asOf)) || new Date(asOf).toISOString().slice(0, 10) !== asOf) throw new Error('A dated observation is required.');
  const official = officialPeople(officialDocuments, asOf, base.season.slice(0, 4));
  const byCode = new Map();
  for (const row of official) byCode.set(row.person.code, [...(byCode.get(row.person.code) ?? []), row]);
  const report = { model: 'membership-audit-1', observedAt: snapshot.finishedAt, parentChecksum: hash(base), confirmed: [], changed: [], unresolved: [], extraOfficial: [], competitionFields: [] };
  const claimed = new Map(), proposed = new Map();
  for (const player of base.players) {
    const evidenceCode = player.profileEvidence?.officialPersonCode;
    const candidates = evidenceCode ? byCode.get(evidenceCode) ?? [] : official.filter(row => nameKey(row.person.name.replace(',', ' ')) === nameKey(player.name));
    const codes = unique(candidates.map(row => row.person.code)), clubs = unique(candidates.map(row => row.club.code));
    const rows = observed.get(player.id) ?? [];
    const target = clubs.length === 1 ? officialToClub.get(clubs[0]) : undefined;
    const knownBirthDate = player.birthDate;
    const identityConflict = knownBirthDate && candidates.some(row => row.person.birthDate?.slice(0, 10) !== knownBirthDate);
    // The same stable provider ID must actually have been observed at the official destination.
    // Exact full names or an earlier reviewed person code identify the official person, not the destination alone.
    if (codes.length === 1 && target && !identityConflict && rows.some(row => row.clubId === target)) {
      proposed.set(player.id, { target, code: codes[0], rows: candidates });
      claimed.set(codes[0], [...(claimed.get(codes[0]) ?? []), player.id]);
    }
  }
  const players = base.players.map(player => {
    const proposal = proposed.get(player.id), providerClubs = unique((observed.get(player.id) ?? []).map(row => row.clubId));
    if (!proposal || claimed.get(proposal.code).length !== 1) {
      if (providerClubs.length !== 1 || player.profileEvidence?.membership === 'needs-review' || clubToOfficial.has(player.clubId)) {
        report.unresolved.push({ playerId: player.id, name: player.name, retainedClubId: player.clubId, providerClubIds: providerClubs, reason: proposal ? 'ambiguous-canonical-identity' : 'no-correlated-active-registration' });
        return { ...structuredClone(player), estimated: unique([...player.estimated, 'club-membership-unverified']), ...(player.profileEvidence ? { profileEvidence: { ...structuredClone(player.profileEvidence), membership: 'needs-review' } } : {}) };
      }
      return structuredClone(player);
    }
    const sources = unique([...(player.profileEvidence?.sources ?? []), ...proposal.rows.map(row => row.sourceUrl), ...(observed.get(player.id) ?? []).filter(row => row.clubId === proposal.target).map(row => row.source)]);
    const evidence = { playerId: player.id, officialPersonCode: proposal.code, fromClubId: player.clubId, toClubId: proposal.target, observedOn: asOf, sources, registrations: proposal.rows.map(row => ({ competition: row.season.code, startsOn: row.startDate.slice(0, 10), endsOn: row.endDate?.slice(0, 10) ?? null })) };
    report[player.clubId === proposal.target ? 'confirmed' : 'changed'].push(evidence);
    return { ...player, clubId: proposal.target, estimated: player.estimated.filter(flag => flag !== 'club-membership-unverified'), profileEvidence: { ...player.profileEvidence, observedAt: snapshot.finishedAt, positionSource: player.profileEvidence?.positionSource ?? 'estimated', membership: 'official-registration-observed', officialPersonCode: proposal.code, membershipMethod: 'official-registration-and-stable-provider-observation', membershipRegistrations: evidence.registrations, sources } };
  });
  const clubs = base.clubs.map(club => ({ ...club, playerIds: unique([...club.playerIds.filter(id => players.some(player => player.id === id && player.clubId === club.id)), ...players.filter(player => player.clubId === club.id).map(player => player.id)]) }));
  const accounted = new Set([...report.confirmed, ...report.changed].map(row => row.officialPersonCode));
  report.extraOfficial = [...byCode].filter(([code, rows]) => !accounted.has(code) && rows.some(row => officialToClub.has(row.club.code))).map(([code, rows]) => ({ officialPersonCode: code, name: rows[0].person.name, clubCodes: unique(rows.map(row => row.club.code)) }));
  const competitions = base.competitions.map(competition => {
    const code = competition.name === 'EuroLeague' ? 'E' : competition.name === 'EuroCup' ? 'U' : null;
    if (!code) return structuredClone(competition);
    const registrations = official.filter(row => row.season.code === `${code}${base.season.slice(0, 4)}`);
    const codes = unique(registrations.map(row => row.club.code));
    if (codes.length !== (code === 'E' ? 20 : 32) || codes.some(code => !officialToClub.has(code))) throw new Error('The official European field needs complete reviewed club identities.');
    const confirmedIds = codes.map(code => officialToClub.get(code));
    const clubIds = unique([...competition.clubIds.filter(id => confirmedIds.includes(id)), ...confirmedIds]);
    report.competitionFields.push({ competitionId: competition.id, clubIds, removed: competition.clubIds.filter(id => !clubIds.includes(id)), added: clubIds.filter(id => !competition.clubIds.includes(id)), sources: unique(registrations.map(row => row.sourceUrl)) });
    return { ...competition, clubIds };
  });
  return { pack: { ...base, version, clubs, players, competitions, source: { ...base.source, parentVersion: base.version, membershipAudit: { model: report.model, observedAt: report.observedAt, confirmed: report.confirmed.length, changed: report.changed.length, unresolved: report.unresolved.length, extraOfficial: report.extraOfficial.length, competitionFields: report.competitionFields, note: 'Dated official registrations correlated with stable provider observations. Unresolved memberships retained and flagged; observation date is not proof of opening-day membership. Ability ratings are unchanged.' } } }, report };
}
