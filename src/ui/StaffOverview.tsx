import { useState } from 'react'
import type { SeasonState } from '../domain/season'
import { roleStaff, sackingTerms, STAFF_ROLE_LABELS, STAFF_ROLES, staffRoleEnabled, type StaffRole } from '../world/staff-roster'
import { remainingStaffBudget } from '../world/staff-policy'
import { StaffStars } from './StaffRating'
import { Icon, type IconName } from './Icon'
import { formatEuros } from './money-format'
import { contractUntil, usesStaffContracts } from '../world/staff-contracts'

const ROLE_ICONS: Readonly<Record<StaffRole, IconName>> = { coaches: 'training', scouts: 'search', fitness: 'shield', physio: 'medical', assistant: 'court', youth: 'people' }

/** Current staff per role first (owner request, 16 November 2026): rating, fee, Replace and Sack; candidates on request. */
export function StaffOverview({ season, busy = false, onReplace, onHire, onSack }: {
  season: SeasonState; busy?: boolean
  onReplace: (role: StaffRole, contractId: string) => void
  onHire: (role: StaffRole) => void
  onSack?: (role: StaffRole, contractId: string) => void
}) {
  const [sacking, setSacking] = useState<string | null>(null)
  const club = season.clubs.find(team => team.id === season.managedClubId)!
  const roles = STAFF_ROLES.filter(role => staffRoleEnabled(season, role))
  if (!roles.length) return null
  const open = season.status !== 'complete'
  return <section className="staff-overview panel" aria-labelledby="staff-overview-title">
    <header className="staff-heading"><div><h2 id="staff-overview-title">Current staff</h2><span>{club.name} · Season {season.seasonNumber}</span></div><span className="staff-overview-budget">Wages left <strong data-staff-overview-budget={remainingStaffBudget(season, season.managedClubId)}>{formatEuros(remainingStaffBudget(season, season.managedClubId))}</strong></span></header>
    <ul className="staff-overview-list">{roles.flatMap(role => {
      const members = roleStaff(season, role)
      if (!members.length) return [<li className="staff-overview-row vacant" key={role} data-staff-role={role}>
        <span className="staff-overview-role"><Icon name={ROLE_ICONS[role]} size={15} />{STAFF_ROLE_LABELS[role]}</span>
        <span className="staff-overview-name"><strong>Vacant</strong></span>
        <span className="staff-overview-actions"><button className="button small primary" onClick={() => onHire(role)} disabled={busy || !open} data-hire-role={role}>Find a {STAFF_ROLE_LABELS[role].toLowerCase()}</button></span>
      </li>]
      return members.map(member => <li className="staff-overview-row" key={member.contractId} data-staff-role={role} data-staff-contract={member.contractId}>
        <span className="staff-overview-role"><Icon name={ROLE_ICONS[role]} size={15} />{STAFF_ROLE_LABELS[role]}</span>
        <span className="staff-overview-name"><strong>{member.name}</strong><StaffStars rating={member.rating} /></span>
        <span className="staff-overview-fee">{formatEuros(member.fee)} <small>a season</small>{usesStaffContracts(season) && <small className="staff-contract-end" data-contract-until={contractUntil(season, member.personId, season.managedClubId)}> · until season {contractUntil(season, member.personId, season.managedClubId)}</small>}</span>
        <span className="staff-overview-actions">
          <button className="button small" onClick={() => onReplace(role, member.contractId)} disabled={busy || !open} aria-label={`Replace ${member.name}`} data-replace-staff={member.contractId}>Replace</button>
          {onSack && <button className="text-button" onClick={() => setSacking(member.contractId)} disabled={busy || !open} aria-label={`Sack ${member.name}`} data-sack-staff={member.contractId}>Sack</button>}
        </span>
        {sacking === member.contractId && onSack && <div className="staff-overview-confirm" role="group" aria-label={`Sack ${member.name}`} onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.preventDefault(); setSacking(null) } }}>
          <p><strong>Sack {member.name}?</strong> {sackingTerms(season, member, formatEuros)}</p>
          <span className="staff-release-actions"><button className="button" onClick={() => { setSacking(null); onSack(role, member.contractId) }} disabled={busy} data-confirm-sack={member.contractId}>Confirm sack</button><button className="text-button" onClick={() => setSacking(null)} disabled={busy}>Cancel</button></span>
        </div>}
      </li>)
    })}</ul>
  </section>
}
