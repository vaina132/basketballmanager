import { useEffect, useRef, useState } from 'react'
import { ReplaceStaffButton, StaffContractEnd, replacementTarget, revealCandidates, ShowCandidatesButton, SpendingAfterHire, StaffReplacementOffer, type StaffCandidateControls } from './StaffReplacement'
import { sackingTerms } from '../world/staff-roster'
import { usesStaffContracts } from '../world/staff-contracts'
import type { SeasonState } from '../domain/season'
import type { Physio } from '../domain/physio'
import { DEVELOPMENT_PHYSIOS } from '../data/development-physios'
import { availablePhysios, physioEffects, physioRating, getClubPhysio, quotePhysioHire } from '../world/physio-policy'
import { staffCommitted } from '../world/staff-policy'
import { PhysioBenefits, PhysioPortrait } from './PhysioBenefits'
import { StaffStars } from './StaffRating'
import { Icon } from './Icon'
import { seasonRounds } from '../world/career-world'
import { PHYSIO_DIRECTORY } from '../data/staff-directory'
import { formatEuros } from './money-format'
import { staffFee } from '../world/economy'
import { StaffNationality } from './Nationality'

export interface PhysioStaffProps extends StaffCandidateControls {
  season: SeasonState
  busy?: boolean
  onEnablePhysio: () => void
  onHirePhysio: (physioId: string) => void
  onReleasePhysio: (contractId: string) => void
  onPhysioRenewal: (contractId: string, renew: boolean) => void
  onOpenMedical: () => void
}

const money = (cents: number) => formatEuros(cents)
const coachById = (id: string) => PHYSIO_DIRECTORY.find(coach => coach.id === id)!
function PhysioSkills({ coach }: { coach: Physio }) {
  return <dl className="staff-skill-list compact"><div><dt>Rehabilitation</dt><dd><span className="staff-skill-bar" aria-hidden="true"><span style={{ width: `${coach.rehabilitation * 10}%` }} /></span><span className="staff-skill-value" aria-label={`${coach.rehabilitation / 2} out of 5 stars`}>{(coach.rehabilitation / 2).toFixed(1)}</span></dd></div></dl>
}

export function PhysioStaff({ season, busy = false, onEnablePhysio, onHirePhysio, onReleasePhysio, onPhysioRenewal, onOpenMedical , showCandidates = true, onShowCandidates, replaceContractId, onReplaceStaff, onReplace }: PhysioStaffProps) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('rating-desc')
  const [page, setPage] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [confirmRelease, setConfirmRelease] = useState(false)
  const reviewRegion = useRef<HTMLElement>(null)
  const reviewTrigger = useRef<HTMLButtonElement | null>(null)
  const releaseRegion = useRef<HTMLDivElement>(null)
  const releaseTrigger = useRef<HTMLButtonElement>(null)
  const club = season.clubs.find(item => item.id === season.managedClubId)!
  /** Catalog fees at the club's money level (format 62). */
  const feeOf = (amount: number) => staffFee(season, season.managedClubId, amount)
  const enabled = season.physio.enabledSince !== null
  const enableReason = !season.finance.enabledSince ? 'Enable club finances before recruiting a physio.' : season.status === 'complete' || season.round === seasonRounds(season) ? 'No rehabilitation weeks left; recruit next season.' : null
  const contract = getClubPhysio(season)
  const appointed = contract ? coachById(contract.physioId) : null
  const available = availablePhysios(season)
  const candidates = available.filter(coach => coach.name.toLowerCase().includes(query.trim().toLowerCase())).sort((left, right) => {
    const value = sort.startsWith('rating') ? physioRating(left) - physioRating(right) : left.fee - right.fee
    return (sort.endsWith('desc') ? -value : value) || left.name.localeCompare(right.name, 'en')
  })
  const pages = Math.max(1, Math.ceil(candidates.length / 6)), visiblePage = Math.min(page, pages - 1)
  const selected = available.find(coach => coach.id === selectedId) ?? null
  /** Hiring for a filled role, or after Replace on the overview, replaces someone (format 74). */
  const replacement = selected && enabled ? replacementTarget(season, 'physio', 1, replaceContractId) : null
  const quote = selected ? quotePhysioHire(season, selected.id) : null
  const released = season.physio.contracts.filter(item => item.clubId === club.id && item.seasonNumber === season.seasonNumber && item.releasedRound !== null)

  useEffect(() => {
    if (!selectedId) return
    if (!selected) { setSelectedId(null); document.getElementById('physio-current-title')?.focus({ preventScroll: true }); return }
    reviewRegion.current?.focus({ preventScroll: true }); reviewRegion.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedId, selected?.id])
  useEffect(() => {
    if (!confirmRelease) return
    if (!contract) { setConfirmRelease(false); document.getElementById('physio-current-title')?.focus({ preventScroll: true }); return }
    releaseRegion.current?.focus({ preventScroll: true }); releaseRegion.current?.scrollIntoView({ block: 'nearest' })
  }, [confirmRelease, contract?.id])
  function closeReview() { setSelectedId(null); reviewTrigger.current?.focus({ preventScroll: true }) }
  function cancelRelease() { setConfirmRelease(false); releaseTrigger.current?.focus({ preventScroll: true }) }
  function review(coach: Physio, trigger: HTMLButtonElement) {
    reviewTrigger.current = trigger
    if (selectedId === coach.id) { reviewRegion.current?.focus({ preventScroll: true }); reviewRegion.current?.scrollIntoView({ block: 'nearest' }) }
    else setSelectedId(coach.id)
  }

  return <div className="staff-workspace physio-staff-workspace">
    <section className="staff-current panel" aria-labelledby="physio-current-title"><header className="staff-heading"><div><h2 id="physio-current-title" tabIndex={-1}>Physio</h2><span>{club.name} &middot; one position</span></div><div className="scout-header-actions"><span className="staff-slot-count"><span aria-hidden="true"><i className={contract ? 'filled' : ''} /></span>{contract ? 1 : 0} / 1</span><button className="button small" onClick={onOpenMedical} disabled={busy}>Open medical<Icon name="medical" size={14} /></button></div></header>
      {!enabled ? <div className="scout-enable"><Icon name="medical" size={28} /><div><strong>Recruit a physio</strong><p>Support injured players through rehabilitation.</p></div><button id="enable-physio" className="button primary" onClick={onEnablePhysio} disabled={busy || !!enableReason} aria-describedby={enableReason ? 'physio-enable-reason' : undefined}>Enable physio staff</button>{enableReason && <p id="physio-enable-reason">{enableReason}</p>}</div> : appointed && contract ? <div className="fitness-roster"><article className="staff-owned-card fitness-owned-card" data-physio-contract={contract.id}><div className="fitness-owned-profile"><div className="staff-owned-identity"><PhysioPortrait coach={appointed} color={club.color} size={72} /><div><span className="staff-role">Physio</span><h3>{appointed.name}<StaffNationality personId={appointed.id} /></h3><StaffStars rating={physioRating(appointed)} /><span className="staff-card-fee">{money(feeOf(appointed.fee))} <small>/ season</small></span><StaffContractEnd season={season} personId={appointed.id} /></div></div><PhysioSkills coach={appointed} /></div><div className="fitness-owned-terms"><PhysioBenefits effects={physioEffects(appointed)} /><p className="physio-eligibility">Automatic care between matchdays. Current match availability stays unchanged.</p><div className="staff-contract-controls"><label className="staff-renew"><input type="checkbox" data-physio-renewal={contract.id} checked={contract.renew} onChange={event => onPhysioRenewal(contract.id, event.target.checked)} disabled={busy} aria-label={`Renew ${appointed.name} next season`} />Renew next season</label><ReplaceStaffButton season={season} name={appointed.name} contractId={contract.id} onReplace={onReplace} busy={busy} /><button ref={releaseTrigger} className="text-button" id="release-physio" onClick={() => setConfirmRelease(true)} disabled={busy}>Release</button></div></div></article></div> : <div className="fitness-roster"><button className="staff-vacancy fitness-vacancy" onClick={() => revealCandidates(onShowCandidates, 'physio-search', 'physio-recruitment-title')} disabled={busy}><span className="staff-vacancy-image" aria-hidden="true"><Icon name="medical" size={34} /><span>+</span></span><span><strong>Vacant physio position</strong><small>Injury recovery support</small><span className="staff-vacancy-action">Find a physio<Icon name="chevron" size={13} /></span></span></button></div>}
      {confirmRelease && contract && appointed && <div ref={releaseRegion} id="physio-release-confirmation" className="staff-release-confirmation" tabIndex={-1} role="group" aria-label={`Release ${appointed.name}`} onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.preventDefault(); cancelRelease() } }}><PhysioPortrait coach={appointed} size={42} /><div className="staff-release-copy"><strong>Release {appointed.name}?</strong><p>{sackingTerms(season, { name: appointed.name, fee: feeOf(appointed.fee), role: 'physio', contractId: contract.id }, money)} Future rehabilitation loses this support. Recovery already earned and treatment records are kept.</p></div><div className="staff-release-actions"><button id="confirm-release-physio" className="button" onClick={() => onReleasePhysio(contract.id)} disabled={busy}>Confirm release</button><button className="text-button" onClick={cancelRelease} disabled={busy}>Cancel</button></div></div>}
      <details className="staff-explainer"><summary>Physio support &amp; appointment terms</summary><p>The appointed physio supports all injured squad players automatically after Continue, between matchdays. Recovery gains are bounded and never change the current match. The full season fee is paid when hired and shares the staff budget. Released fees are retained; renewals depend on next season's budget and available cash.</p></details>
    </section>
    {enabled && <>
      {!showCandidates && <ShowCandidatesButton label="available physios" count={available.length} onShow={onShowCandidates} busy={busy} />}
      {showCandidates && <>{selected && quote && <section ref={reviewRegion} id="physio-candidate-detail" className="staff-candidate-detail panel" tabIndex={-1} aria-labelledby="physio-candidate-title" data-selected-physio={selected.id} onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.preventDefault(); closeReview() } }}><header className="staff-heading"><div><h2 id="physio-candidate-title">Recruit {selected.name}</h2><span>Physio</span></div><button className="text-button" onClick={closeReview} disabled={busy} aria-label="Close physio details"><Icon name="close" size={14} />Close</button></header><div className="staff-candidate-body"><div className="fitness-candidate-profile"><div className="staff-candidate-profile"><div className="staff-profile-portrait"><PhysioPortrait coach={selected} color={club.color} size={100} /><StaffStars rating={physioRating(selected)} /></div><PhysioSkills coach={selected} /></div><PhysioBenefits effects={physioEffects(selected)} /><p className="physio-eligibility">Care starts after Continue. Original injury records remain unchanged.</p></div><div className="staff-hire-controls"><div className="staff-offer-fee"><span>Season fee</span><strong>{money(quote.fee)}</strong></div><div className="staff-after-hire"><span>{quote.remainingBudget >= quote.fee ? 'Wages left after hire' : 'Wages left shortfall'}</span><strong data-physio-budget-after={quote.remainingBudget - quote.fee}>{money(Math.abs(quote.remainingBudget - quote.fee))}</strong></div>{!replacement && <SpendingAfterHire season={season} fee={quote.fee} />}<span className="staff-renewal-note"><Icon name="check" size={14} />Renewal selected for next season</span>{replacement && selected ? <StaffReplacementOffer key={selected.id} season={season} role="physio" personId={selected.id} personName={selected.name} fee={quote.fee} target={replacement} busy={busy} onReplaceStaff={onReplaceStaff} /> : <>{quote.reason && <p id="physio-hire-reason" className="staff-hire-reason">{season.round === seasonRounds(season) ? 'No rehabilitation weeks left; recruit next season.' : quote.reason}</p>}<button id="hire-physio" className="button primary" onClick={() => onHirePhysio(selected.id)} disabled={busy || !quote.canHire} aria-describedby={quote.reason ? 'physio-hire-reason' : undefined}><Icon name="staff" size={16} />Hire for {money(quote.fee)}</button></>}<details className="staff-payment-details"><summary>Payment details</summary><dl><div><dt>Staff fees committed</dt><dd>{money(staffCommitted(season, club.id))}</dd></div><div><dt>Wages left for staff</dt><dd>{money(quote.remainingAllocation)}</dd></div><div><dt>Wages left</dt><dd data-physio-staff-budget={quote.remainingBudget}>{money(quote.remainingBudget)}</dd></div></dl><p>{usesStaffContracts(season) ? 'The salary is paid weekly from Wages left, like player wages. Sacking before the contract ends costs compensation.' : 'The full season fee is paid now. All staff appointments share the same season allocation.'}</p></details></div></div></section>}
      <section className="staff-recruitment panel" aria-labelledby="physio-recruitment-title"><header className="staff-heading"><h2 id="physio-recruitment-title">Available physios</h2><span>{candidates.length} {candidates.length === 1 ? 'physio' : 'physios'}</span></header><div className="staff-recruitment-filters"><label htmlFor="physio-search"><Icon name="search" size={16} /><span className="sr-only">Find physio</span><input id="physio-search" type="search" value={query} onChange={event => { setQuery(event.target.value); setPage(0) }} placeholder="Find a physio" disabled={busy} /></label><label htmlFor="physio-sort"><span>Sort</span><select id="physio-sort" value={sort} onChange={event => { setSort(event.target.value); setPage(0) }} disabled={busy}><option value="rating-desc">Best overall</option><option value="fee-asc">Lowest fee</option><option value="fee-desc">Highest fee</option></select></label></div><div className="staff-candidate-grid">{candidates.slice(visiblePage * 6, visiblePage * 6 + 6).map(coach => {
        const candidateQuote = quotePhysioHire(season, coach.id)
        return <article className={`staff-candidate-card${selectedId === coach.id ? ' staff-selected-candidate' : ''}`} key={coach.id}><button className="staff-candidate-identity" data-candidate-physio={coach.id} aria-label={`Review ${coach.name}`} aria-expanded={selectedId === coach.id} aria-controls="physio-candidate-detail" onClick={event => review(coach, event.currentTarget)} disabled={busy}><PhysioPortrait coach={coach} size={64} /><span><strong>{coach.name}<StaffNationality personId={coach.id} /></strong><StaffStars rating={physioRating(coach)} /><small>Physio</small></span><Icon name="chevron" size={15} /></button><PhysioSkills coach={coach} /><div className="staff-candidate-footer"><span className="staff-card-fee">{money(feeOf(coach.fee))} <small>/ season</small></span><button className={`button small${candidateQuote.canHire ? ' primary' : ''}`} onClick={event => review(coach, event.currentTarget)} disabled={busy} aria-label={`${candidateQuote.canHire ? 'Recruit' : 'Review'} ${coach.name}`}>{candidateQuote.canHire ? 'Recruit' : 'View physio'}<Icon name="chevron" size={13} /></button></div>{!candidateQuote.canHire && <span className="staff-card-status">{contract ? 'Replaces your physio' : season.round === seasonRounds(season) || season.status === 'complete' ? 'Recruit next season' : 'Review availability'}</span>}</article>
      })}{!candidates.length && <p className="staff-empty">No available physios match this search.</p>}</div>{candidates.length > 0 && <nav className="staff-candidate-pages" aria-label="Available physios pages"><span aria-live="polite">{visiblePage * 6 + 1}&ndash;{Math.min(visiblePage * 6 + 6, candidates.length)} of {candidates.length}</span><div><button className="button small" disabled={busy || visiblePage === 0} onClick={() => setPage(visiblePage - 1)} aria-label="Previous physios"><Icon name="chevron" size={13} />Previous</button><span>{visiblePage + 1} / {pages}</span><button className="button small" disabled={busy || visiblePage >= pages - 1} onClick={() => setPage(visiblePage + 1)} aria-label="Next physios">Next<Icon name="chevron" size={13} /></button></div></nav>}</section></>}
      {released.length > 0 && <details className="staff-released panel"><summary>Released physios this season <span>{released.length}</span></summary><div className="staff-released-list">{released.map(item => <div key={item.id}><PhysioPortrait coach={coachById(item.physioId)} size={36} /><strong>{coachById(item.physioId).name}</strong><span>Matchday {item.releasedRound}</span><span>{money(feeOf(coachById(item.physioId).fee))} retained</span></div>)}</div></details>}
    </>}
  </div>
}
