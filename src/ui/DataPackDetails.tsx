import type { DataPack } from '../world/data-pack'

export function DataPackDetails({ pack }: { pack: DataPack }) {
  const value = pack.source?.profileAudit
  const audit = value && typeof value === 'object' ? value as Record<string, unknown> : null
  const observed = typeof audit?.observedAt === 'string' ? audit.observedAt.slice(0, 10) : null
  return <details className="career-start-subnote"><summary>Data: {pack.season}{observed ? ` · checked ${observed}` : ' · profiles not audited'}</summary>
    <p>Observed season rosters; opening-day membership is not verified. Positions marked “est.” are estimates. Ability ratings remain provisional.</p>
    {audit && <p>{Number(audit.officialProfiles) || 0} profiles matched to official sources. {Number(audit.membershipConflicts) || 0} players appear at multiple clubs in the feed; club assignments still need review.</p>}
    <p>Loading a newer file applies to new careers and friendlies. Saved careers keep their original data.</p>
  </details>
}
