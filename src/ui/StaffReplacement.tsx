import { useState } from 'react'
import type { SeasonState } from '../domain/season'
import { quoteStaffReplacement, replacementWarning, roleStaff, STAFF_ROLE_LABELS, staffReplacementSpending, type StaffMemberSummary, type StaffRole } from '../world/staff-roster'
import { staffHireSpending, type StaffSpendingCheck } from '../world/staff-policy'
import { Icon } from './Icon'
import { contractUntil, usesStaffContracts } from '../world/staff-contracts'
import { formatEuros } from './money-format'

/** Candidate lists open only when the player asks; a replacement names the person who leaves (format 74 staff page). */
export interface StaffCandidateControls {
  /** Whether this role's candidates are listed (default: listed, for older callers). */
  showCandidates?: boolean
  onShowCandidates?: () => void
  /** The contract the player chose to replace from the staff overview, if any. */
  replaceContractId?: string | null
  onReplaceStaff?: (role: StaffRole, contractId: string, personId: string) => void
  /** Replace this person: opens the role's candidates with him as the one who leaves (the staff list's Replace). */
  onReplace?: (contractId: string) => void
}

/**
 * One staff list (owner decision, 22 November 2026): the role cards are the only list of current staff, so each card
 * carries what the old "Current staff" table had: the contract's last season and a Replace action.
 */
export function StaffContractEnd({ season, personId }: { season: SeasonState; personId: string }) {
  if (!usesStaffContracts(season)) return null
  const until = contractUntil(season, personId, season.managedClubId)
  return <small className="staff-contract-end" data-contract-until={until}>Until season {until}</small>
}
export function ReplaceStaffButton({ season, name, contractId, onReplace, busy = false }: { season: SeasonState; name: string; contractId: string; onReplace?: (contractId: string) => void; busy?: boolean }) {
  if (!onReplace) return null
  return <button className="text-button" onClick={() => onReplace(contractId)} disabled={busy || season.status === 'complete'} aria-label={`Replace ${name}`} data-replace-staff={contractId}>Replace</button>
}

/** Opens a role's candidates, then focuses its search field once the list is shown. */
export function revealCandidates(show: (() => void) | undefined, inputId: string, titleId: string): void {
  show?.()
  window.setTimeout(() => { document.getElementById(inputId)?.focus({ preventScroll: true }); document.getElementById(titleId)?.scrollIntoView({ block: 'nearest' }) }, 0)
}

/** The button that lists a role's candidates on request. */
export function ShowCandidatesButton({ label, count, onShow, busy }: { label: string; count: number; onShow?: () => void; busy?: boolean }) {
  if (!onShow) return null
  return <section className="staff-show-candidates panel"><button className="button small" onClick={onShow} disabled={busy} data-show-candidates={label}><Icon name="search" size={14} />Show {label} ({count})</button></section>
}

/**
 * The person a hire would replace: the one chosen on the overview, or for a full role the lowest-rated (one-person
 * roles have just one). Null when the hire fills a vacancy instead.
 */
export function replacementTarget(season: SeasonState, role: StaffRole, positions: number, chosen?: string | null): { outgoing: StaffMemberSummary[]; contractId: string } | null {
  const outgoing = roleStaff(season, role)
  const picked = chosen ? outgoing.find(member => member.contractId === chosen) : undefined
  if (picked) return { outgoing, contractId: picked.contractId }
  if (outgoing.length < positions || !outgoing.length) return null
  return { outgoing, contractId: [...outgoing].sort((left, right) => left.rating - right.rating || left.fee - right.fee)[0]!.contractId }
}

/** Format 76: Spending left after a hire (or a replacement), from the same check the hire uses. */
function SpendingAfter({ check, label }: { check: StaffSpendingCheck | null; label: string }) {
  if (!check) return null
  return <div className="staff-after-hire"><span>{check.after >= 0 ? `Spending left after ${label}` : 'Spending left shortfall'}</span><strong data-spending-after={check.after}>{formatEuros(Math.abs(check.after))}</strong></div>
}
export function SpendingAfterHire({ season, fee }: { season: SeasonState; fee: number }) {
  return <SpendingAfter check={staffHireSpending(season, season.managedClubId, fee)} label="hire" />
}

/** Hiring for a filled role: a clear warning naming who leaves, accepted in one step. */
export function StaffReplacementOffer({ season, role, personId, personName, fee, target, busy = false, onReplaceStaff }: {
  season: SeasonState; role: StaffRole; personId: string; personName: string; fee: number
  target: { outgoing: StaffMemberSummary[]; contractId: string }; busy?: boolean
  onReplaceStaff?: (role: StaffRole, contractId: string, personId: string) => void
}) {
  const [contractId, setContractId] = useState(target.contractId)
  const outgoing = target.outgoing.find(member => member.contractId === contractId) ?? target.outgoing.find(member => member.contractId === target.contractId)!
  const quote = quoteStaffReplacement(season, role, outgoing.contractId, personId)
  return <div className="staff-replacement-offer" role="group" aria-label={`Replace ${outgoing.name}`} data-replacement-for={outgoing.contractId}>
    {target.outgoing.length > 1 && <label className="staff-replacement-choice">Replace<select value={outgoing.contractId} onChange={event => setContractId(event.target.value)} disabled={busy}>{target.outgoing.map(member => <option key={member.contractId} value={member.contractId}>{member.name}</option>)}</select></label>}
    <p className="staff-replacement-warning" id={`replacement-warning-${role}`}><Icon name="swap" size={15} /><span>{replacementWarning(outgoing, season)}</span></p>
    <p className="staff-replacement-fee">{personName} becomes your {STAFF_ROLE_LABELS[role].toLowerCase()}; {usesStaffContracts(season) ? <>{formatEuros(fee)} a season, paid weekly from Wages left.</> : <>the {formatEuros(fee)} season fee is paid now.</>}</p>
    {quote.remainingAfter !== null && <div className="staff-after-replacement"><span>Wages left after the change</span><strong data-replacement-budget-after={quote.remainingAfter}>{formatEuros(quote.remainingAfter)}</strong></div>}
    <SpendingAfter check={staffReplacementSpending(season, role, outgoing.contractId, personId)} label="the change" />
    {quote.reason && <p className="staff-hire-reason" id={`replacement-reason-${role}`}>{quote.reason}</p>}
    <button className="button primary" data-accept-replacement={role} onClick={() => onReplaceStaff?.(role, outgoing.contractId, personId)} disabled={busy || !quote.canReplace || !onReplaceStaff} aria-describedby={`replacement-warning-${role}${quote.reason ? ` replacement-reason-${role}` : ''}`}><Icon name="swap" size={16} />Accept replacement</button>
  </div>
}
