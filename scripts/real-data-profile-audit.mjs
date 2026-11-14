/** Source-aware profile corrections. Raw provider observations and earlier packs remain unchanged. */
import { createHash } from 'node:crypto';
import { checkedProviderRows, rosterRequests } from './real-data-roster-snapshot.mjs';
import { resolvePosition } from './real-data-position.mjs';
export { resolvePosition } from './real-data-position.mjs';

const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];
export const nameKey = name => name.normalize('NFKD').replace(/\p{M}/gu, '').replace(/ı/g, 'i').replace(/ł/g, 'l').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim().split(/\s+/).sort().join(' ');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const displayName = row => { const [surname, given] = row.person.name.split(','); return `${given?.trim() ?? ''} ${surname.trim()}`.trim().toLowerCase().replace(/(^|[\s-])\p{L}/gu, letter => letter.toUpperCase()); };

/** Each document must contain every page; future registrations cannot describe the current observed roster. */
export function officialPeople(documents, asOf, seasonYear = asOf.slice(0, 4)) {
  const result = [];
  for (const document of documents) {
    const pages = [document, ...(document.pages ?? [])];
    const rows = pages.flatMap(page => page.body?.data ?? []);
    if (document.status !== 200 || !Number.isSafeInteger(document.body?.total) || rows.length !== document.body.total || pages.some(page => page.status !== undefined && page.status !== 200 || page.body?.total !== document.body.total)) throw new Error('Incomplete official profile snapshot.');
    const seen = new Set();
    for (const row of rows) {
      if (!new RegExp(`^[EU]${seasonYear}$`).test(row.season?.code)) throw new Error('Official profile snapshot belongs to another season.');
      if (row.type !== 'J' || !row.active || !row.person?.code || !row.club?.code || typeof row.person.name !== 'string') continue;
      if (!row.startDate || row.startDate.slice(0, 10) > asOf || row.endDate && row.endDate.slice(0, 10) < asOf) continue;
      const key = `${row.season?.code}/${row.club.code}/${row.person.code}`;
      if (seen.has(key)) throw new Error('Duplicate official profile registration.');
      seen.add(key);
      result.push({ ...row, sourceUrl: document.url, observedAt: document.fetchedAt });
    }
  }
  return result;
}

/** Match within a reviewed club identity. Ambiguous names/initials are deliberately left unresolved. */
export function matchOfficialProfile(name, rows) {
  const exact = rows.filter(row => nameKey(row.person.name.replace(',', ' ')) === nameKey(name));
  if (exact.length === 1) return { row: exact[0], method: 'exact-name-and-club' };
  if (exact.length > 1) return null;
  const initial = /^([A-Z])\.\s+(.+)$/.exec(name);
  if (!initial) return null;
  const candidates = rows.filter(row => {
    const [surname, given] = row.person.name.split(',');
    return given?.trim().startsWith(initial[1]) && nameKey(surname) === nameKey(initial[2]);
  });
  return candidates.length === 1 ? { row: candidates[0], method: 'unique-initial-surname-and-club' } : null;
}

export function auditProfiles({ base, snapshot, officialDocuments, clubLinks, precisePositions = [], version }) {
  if (!version || version === base.version) throw new Error('Profile corrections require a new pack version.');
  if (snapshot.model !== 'roster-observations-1' || snapshot.status !== 'complete' || snapshot.baseChecksum !== hash(base) || snapshot.baseVersion !== base.version || snapshot.season !== base.season) throw new Error('Use a complete snapshot of this exact base pack.');
  const expected = rosterRequests(base, snapshot.clubLinks);
  const seen = new Set();
  for (const observation of snapshot.observations) {
    const key = `${observation.team}/${observation.season}`;
    const target = expected.find(row => row.team === observation.team && row.season === observation.season);
    if (!target || target.clubId !== observation.clubId || seen.has(key)) throw new Error('Unexpected or repeated roster snapshot scope.');
    if (JSON.stringify([...target.competitionIds].sort()) !== JSON.stringify([...observation.competitionIds].sort())) throw new Error('Roster observation competition scope mismatch.');
    seen.add(key); checkedProviderRows(observation.body);
  }
  if (seen.size !== expected.length) throw new Error('Incomplete roster snapshot scope.');
  const asOf = snapshot.finishedAt?.slice(0, 10);
  if (!date(asOf)) throw new Error('Snapshot needs its completed observation date.');
  const official = officialPeople(officialDocuments, asOf, base.season.slice(0, 4));
  const apiToPlayer = new Map(snapshot.playerLinks.map(row => [String(row.provider_id), `player-${row.player_id}`]));
  const apiToClub = new Map(snapshot.clubLinks.map(row => [String(row.provider_id), `club-${row.club_id}`]));
  const officialClub = new Map(clubLinks.map(row => [apiToClub.get(String(row.apiSportsId)), row.officialCode]));
  const observations = new Map(), providerIds = new Map();
  for (const observation of snapshot.observations) for (const row of observation.body.response) {
    const id = apiToPlayer.get(String(row.id));
    if (!id) continue;
    providerIds.set(id, String(row.id));
    observations.set(id, [...(observations.get(id) ?? []), { ...row, clubId: observation.clubId, sourceUrl: observation.url, observedAt: observation.observedAt }]);
  }
  const overrides = new Map();
  for (const entry of precisePositions) {
    if (overrides.has(String(entry.apiSportsId)) || entry.season !== base.season || !POSITIONS.includes(entry.position) || !date(entry.observedOn) || entry.observedOn > asOf || !entry.sources?.length || entry.sources.some(url => !/^https:\/\//.test(url))) throw new Error('Invalid or duplicated precise position evidence.');
    overrides.set(String(entry.apiSportsId), entry);
  }
  const report = { observedAt: snapshot.finishedAt, scope: { competitions: base.competitions.length, clubs: base.clubs.length, endpoints: seen.size }, officialMatched: 0, changes: [], membershipConflicts: [], unmatchedOfficial: [], missingMembership: [], newProviderIds: [], estimates: 0 };
  const players = base.players.map(player => {
    const rows = observations.get(player.id) ?? [];
    const clubs = [...new Set(rows.map(row => row.clubId))].sort();
    const ownRows = rows.filter(row => row.clubId === player.clubId);
    if (!ownRows.length) report.missingMembership.push({ playerId: player.id, name: player.name, retainedClubId: player.clubId });
    if (clubs.length > 1) report.membershipConflicts.push({ playerId: player.id, name: player.name, retainedClubId: player.clubId, observedClubIds: clubs });
    const clubCode = officialClub.get(player.clubId), candidates = official.filter(row => row.club.code === clubCode);
    const match = matchOfficialProfile(player.name, candidates);
    if (clubCode && !match) report.unmatchedOfficial.push({ playerId: player.id, name: player.name, retainedClubId: player.clubId });
    const rawGroups = [...new Set(ownRows.map(row => row.position).filter(Boolean))];
    const raw = match?.row.positionName ?? (rawGroups.length === 1 ? rawGroups[0] : null);
    const override = overrides.get(providerIds.get(player.id));
    if (override && (!match || match.row.person.code !== override.officialPersonCode)) throw new Error(`Precise evidence identity does not reconcile for ${player.name}.`);
    const resolution = resolvePosition(raw, player.position, override);
    const next = { ...player, position: resolution.position, estimated: [...new Set([...player.estimated.filter(field => field !== 'game_position'), 'age-unverified', ...(resolution.estimated ? ['game_position'] : []), ...(clubs.length > 1 || !ownRows.length || clubCode && !match ? ['club-membership-unverified'] : [])])].sort() };
    const sources = [...new Set([...(match ? [match.row.sourceUrl] : ownRows.map(row => row.sourceUrl)), ...(override?.sources ?? [])])];
    next.profileEvidence = { observedAt: snapshot.finishedAt, positionGroup: raw, positionSource: resolution.estimated ? 'estimated' : match ? 'official' : 'provider', positionMethod: resolution.basis, sources, membership: clubs.length > 1 || !ownRows.length || clubCode && !match ? 'needs-review' : match ? 'official-registration-observed' : 'provider-observed', ...(match ? { officialPersonCode: match.row.person.code, matchMethod: match.method } : {}) };
    if (match) {
      report.officialMatched += 1;
      const person = match.row.person;
      if (/^[A-Z]\.\s/.test(player.name)) next.name = displayName(match.row);
      for (const [source, target, flag, min, max] of [['height', 'heightCm', 'height_cm', 150, 240], ['weight', 'weightKg', 'weight_kg', 50, 180]]) {
        if (Number.isInteger(person[source]) && person[source] >= min && person[source] <= max) { next[target] = person[source]; next.estimated = next.estimated.filter(field => field !== flag); }
      }
      const born = person.birthDate?.slice(0, 10), opening = `${base.season.slice(0, 4)}-09-05`;
      const age = date(born) ? Number(opening.slice(0, 4)) - Number(born.slice(0, 4)) - Number(opening.slice(5) < born.slice(5)) : null;
      if (age !== null && age >= 12 && age <= 60) {
        next.birthDate = born;
        next.age = age;
        next.estimated = next.estimated.filter(field => field !== 'age-unverified');
      }
      if (/^\d{1,2}$/.test(match.row.dorsal ?? '')) next.number = Number(match.row.dorsal);
      if (person.country?.name) next.nationality = person.country.name;
    }
    if (resolution.estimated) report.estimates += 1;
    const fields = ['name', 'position', 'age', 'heightCm', 'weightKg', 'number', 'nationality'].filter(key => player[key] !== next[key]);
    if (fields.length) report.changes.push({ playerId: player.id, fields: Object.fromEntries(fields.map(key => [key, { before: player[key], after: next[key] }])) });
    return next;
  });
  const ids = new Set(base.players.map(player => player.id));
  report.newProviderIds = [...new Set(snapshot.observations.flatMap(row => row.body.response).filter(row => !ids.has(apiToPlayer.get(String(row.id)))).map(row => String(row.id)))].sort();
  const pack = { ...base, version, source: { ...base.source, parentVersion: base.version, profileAudit: { model: 'profile-audit-1', observedAt: snapshot.finishedAt, season: base.season, rosterEndpoints: seen.size, officialProfiles: report.officialMatched, estimatedPositions: report.estimates, membershipConflicts: report.membershipConflicts.length, unmatchedOfficial: report.unmatchedOfficial.length, newProviderIds: report.newProviderIds.length, note: 'Profiles refreshed; existing club assignments retained pending membership reconciliation. Provider season rosters are not proof of current or opening-day membership. Ability ratings use the parent statistics snapshot.' } }, players };
  return { pack, report };
}
