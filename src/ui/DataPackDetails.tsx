import type { DataPack } from '../world/data-pack'

export function DataPackDetails({ pack }: { pack: DataPack }) {
  const value = pack.source?.profileAudit
  const audit = value && typeof value === 'object' ? value as Record<string, unknown> : null
  const membershipValue = pack.source?.membershipAudit
  const membership = membershipValue && typeof membershipValue === 'object' ? membershipValue as Record<string, unknown> : null
  const checkedAt = membership?.observedAt ?? audit?.observedAt
  const observed = typeof checkedAt === 'string' ? checkedAt.slice(0, 10) : null
  return <details className="career-start-subnote"><summary>Data: {pack.season}{observed ? ` · checked ${observed}` : ' · profiles not audited'}</summary>
    <p>Observed season rosters; opening-day membership is not verified. Many exact positions are estimates, marked “est.” on the squad screens. Ability ratings remain provisional.</p>
    {membership ? <p>{(Number(membership.confirmed) || 0) + (Number(membership.changed) || 0)} club assignments checked against official registrations and provider identities; {Number(membership.changed) || 0} corrected. {Number(membership.unresolved) || 0} assignments still need review. Other memberships come from the provider.</p> : audit && <p>{Number(audit.officialProfiles) || 0} profiles matched to official sources. {Number(audit.membershipConflicts) || 0} players appear at multiple clubs in the feed; club assignments still need review.</p>}
    <p>Loading a newer file applies to new careers and friendlies. Saved careers keep their original data.</p>
  </details>
}
