import { useEffect, useRef, useState } from 'react'
import type { SeasonState } from '../domain/season'
import type { FitnessCoach } from '../domain/fitness'
import { DEVELOPMENT_FITNESS_COACHES } from '../data/development-fitness'
import { availableFitnessCoaches, fitnessEffects, fitnessRating, getClubFitnessCoach, quoteFitnessHire } from '../world/fitness-policy'
import { staffCommitted } from '../world/staff-policy'
import { FitnessBenefits, FitnessPortrait } from './FitnessBenefits'
import { StaffStars } from './StaffRating'
import { Icon } from './Icon'
import { seasonRounds } from '../world/career-world'
import { FITNESS_DIRECTORY } from '../data/staff-directory'

export interface FitnessStaffProps {
  season: SeasonState
  busy?: boolean
  onEnableFitness: () => void
  onHireFitness: (coachId: string) => void
  onReleaseFitness: (contractId: string) => void
  onFitnessRenewal: (contractId: string, renew: boolean) => void
  onOpenTraining: () => void
}

const money = (cents: number) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(cents / 100)
const coachById = (id: string) => FITNESS_DIRECTORY.find(coach => coach.id === id)!
function FitnessSkills({ coach }: { coach: FitnessCoach }) {
  return <dl className="staff-skill-list compact">{(['recovery', 'workload'] as const).map(skill => <div key={skill}><dt>{skill === 'recovery' ? 'Recovery' : 'Workload management'}</dt><dd><span className="staff-skill-bar" aria-hidden="true"><span style={{ width: `${coach.skills[skill] * 10}%` }} /></span><span className="staff-skill-value" aria-label={`${coach.skills[skill] / 2} out of 5 stars`}>{(coach.skills[skill] / 2).toFixed(1)}</span></dd></div>)}</dl>
}

export function FitnessStaff({ season, busy = false, onEnableFitness, onHireFitness, onReleaseFitness, onFitnessRenewal, onOpenTraining }: FitnessStaffProps) {
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
  const enabled = season.fitness.enabledSince !== null
  const enableReason = !season.finance.enabledSince || !season.training.enabledSince ? 'Enable club finances and training before recruiting a fitness coach.' : season.status === 'complete' || season.round === seasonRounds(season) ? 'No training weeks left; recruit next season.' : null
  const contract = getClubFitnessCoach(season)
  const appointed = contract ? coachById(contract.coachId) : null
  const available = availableFitnessCoaches(season)
  const candidates = available.filter(coach => coach.name.toLowerCase().includes(query.trim().toLowerCase())).sort((left, right) => {
    const value = sort.startsWith('rating') ? fitnessRating(left) - fitnessRating(right) : left.fee - right.fee
    return (sort.endsWith('desc') ? -value : value) || left.name.localeCompare(right.name, 'en')
  })
  const pages = Math.max(1, Math.ceil(candidates.length / 6)), visiblePage = Math.min(page, pages - 1)
  const selected = available.find(coach => coach.id === selectedId) ?? null
  const quote = selected ? quoteFitnessHire(season, selected.id) : null
  const released = season.fitness.contracts.filter(item => item.clubId === club.id && item.seasonNumber === season.seasonNumber && item.releasedRound !== null)

  useEffect(() => {
    if (!selectedId) return
    if (!selected) { setSelectedId(null); document.getElementById('fitness-current-title')?.focus({ preventScroll: true }); return }
    reviewRegion.current?.focus({ preventScroll: true }); reviewRegion.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedId, selected?.id])
  useEffect(() => {
    if (!confirmRelease) return
    if (!contract) { setConfirmRelease(false); document.getElementById('fitness-current-title')?.focus({ preventScroll: true }); return }
    releaseRegion.current?.focus({ preventScroll: true }); releaseRegion.current?.scrollIntoView({ block: 'nearest' })
  }, [confirmRelease, contract?.id])
  function closeReview() { setSelectedId(null); reviewTrigger.current?.focus({ preventScroll: true }) }
  function cancelRelease() { setConfirmRelease(false); releaseTrigger.current?.focus({ preventScroll: true }) }
  function review(coach: FitnessCoach, trigger: HTMLButtonElement) {
    reviewTrigger.current = trigger
    if (selectedId === coach.id) { reviewRegion.current?.focus({ preventScroll: true }); reviewRegion.current?.scrollIntoView({ block: 'nearest' }) }
    else setSelectedId(coach.id)
  }

  return <div className="staff-workspace fitness-staff-workspace">
    <section className="staff-current panel" aria-labelledby="fitness-current-title"><header className="staff-heading"><div><h2 id="fitness-current-title" tabIndex={-1}>Fitness coach</h2><span>{club.name} &middot; one position</span></div><div className="scout-header-actions"><span className="staff-slot-count"><span aria-hidden="true"><i className={contract ? 'filled' : ''} /></span>{contract ? 1 : 0} / 1</span><button className="button small" onClick={onOpenTraining} disabled={busy}>Open training<Icon name="training" size={14} /></button></div></header>
      {!enabled ? <div className="scout-enable"><Icon name="shield" size={28} /><div><strong>Recruit a fitness coach</strong><p>Support recovery and reduce fatigue from practice.</p></div><button id="enable-fitness" className="button primary" onClick={onEnableFitness} disabled={busy || !!enableReason} aria-describedby={enableReason ? 'fitness-enable-reason' : undefined}>Enable fitness staff</button>{enableReason && <p id="fitness-enable-reason">{enableReason}</p>}</div> : appointed && contract ? <div className="fitness-roster"><article className="staff-owned-card fitness-owned-card" data-fitness-contract={contract.id}><div className="fitness-owned-profile"><div className="staff-owned-identity"><FitnessPortrait coach={appointed} color={club.color} size={72} /><div><span className="staff-role">Fitness coach</span><h3>{appointed.name}</h3><StaffStars rating={fitnessRating(appointed)} /><span className="staff-card-fee">{money(appointed.fee)} <small>/ season</small></span></div></div><FitnessSkills coach={appointed} /></div><div className="fitness-owned-terms"><FitnessBenefits effects={fitnessEffects(appointed)} /><p className="fitness-eligibility">On medically available training days. Injury return dates stay unchanged.</p><div className="staff-contract-controls"><label className="staff-renew"><input type="checkbox" data-fitness-renewal={contract.id} checked={contract.renew} onChange={event => onFitnessRenewal(contract.id, event.target.checked)} disabled={busy} aria-label={`Renew ${appointed.name} next season`} />Renew next season</label><button ref={releaseTrigger} className="text-button" id="release-fitness" onClick={() => setConfirmRelease(true)} disabled={busy}>Release</button></div></div></article></div> : <div className="fitness-roster"><button className="staff-vacancy fitness-vacancy" onClick={() => { document.getElementById('fitness-search')?.focus(); document.getElementById('fitness-recruitment-title')?.scrollIntoView({ block: 'nearest' }) }} disabled={busy}><span className="staff-vacancy-image" aria-hidden="true"><Icon name="shield" size={34} /><span>+</span></span><span><strong>Vacant fitness position</strong><small>Recovery &amp; workload support</small><span className="staff-vacancy-action">Find a fitness coach<Icon name="chevron" size={13} /></span></span></button></div>}
      {confirmRelease && contract && appointed && <div ref={releaseRegion} id="fitness-release-confirmation" className="staff-release-confirmation" tabIndex={-1} role="group" aria-label={`Release ${appointed.name}`} onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.preventDefault(); cancelRelease() } }}><FitnessPortrait coach={appointed} size={42} /><div className="staff-release-copy"><strong>Release {appointed.name}?</strong><p>{money(appointed.fee)} remains committed. No refund. Future training loses this coach's support; completed weekly reports are kept.</p></div><div className="staff-release-actions"><button id="confirm-release-fitness" className="button" onClick={() => onReleaseFitness(contract.id)} disabled={busy}>Confirm release</button><button className="text-button" onClick={cancelRelease} disabled={busy}>Cancel</button></div></div>}
      <details className="staff-explainer"><summary>Fitness support &amp; appointment terms</summary><p>The appointed coach supports future weekly training. Extra recovery is capped at full condition and applies only on medically available days. The coach reduces practice fatigue and does not change injury return dates. The full season fee is paid when hired and shares the budget with training coaches, scouts, physios, assistant coaches and youth coaches. Released fees are retained; renewals depend on next season's budget and available cash.</p></details>
    </section>
    {enabled && <>
      {selected && quote && <section ref={reviewRegion} id="fitness-candidate-detail" className="staff-candidate-detail panel" tabIndex={-1} aria-labelledby="fitness-candidate-title" data-selected-fitness={selected.id} onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.preventDefault(); closeReview() } }}><header className="staff-heading"><div><h2 id="fitness-candidate-title">Recruit {selected.name}</h2><span>Fitness coach</span></div><button className="text-button" onClick={closeReview} disabled={busy} aria-label="Close fitness coach details"><Icon name="close" size={14} />Close</button></header><div className="staff-candidate-body"><div className="fitness-candidate-profile"><div className="staff-candidate-profile"><div className="staff-profile-portrait"><FitnessPortrait coach={selected} color={club.color} size={100} /><StaffStars rating={fitnessRating(selected)} /></div><FitnessSkills coach={selected} /></div><FitnessBenefits effects={fitnessEffects(selected)} /><p className="fitness-eligibility">Applies on medically available training days, up to full condition.</p></div><div className="staff-hire-controls"><div className="staff-offer-fee"><span>Season fee</span><strong>{money(quote.fee)}</strong></div><div className="staff-after-hire"><span>{quote.remainingBudget >= quote.fee ? 'Remaining staff budget after hire' : 'Staff budget shortfall'}</span><strong data-fitness-budget-after={quote.remainingBudget - quote.fee}>{money(Math.abs(quote.remainingBudget - quote.fee))}</strong></div><span className="staff-renewal-note"><Icon name="check" size={14} />Renewal selected for next season</span>{quote.reason && <p id="fitness-hire-reason" className="staff-hire-reason">{season.round === seasonRounds(season) ? 'No training weeks left; recruit next season.' : quote.reason}</p>}<button id="hire-fitness" className="button primary" onClick={() => onHireFitness(selected.id)} disabled={busy || !quote.canHire} aria-describedby={quote.reason ? 'fitness-hire-reason' : undefined}><Icon name="staff" size={16} />Hire for {money(quote.fee)}</button><details className="staff-payment-details"><summary>Payment details</summary><dl><div><dt>Staff fees committed</dt><dd>{money(staffCommitted(season, club.id))}</dd></div><div><dt>Staff allocation remaining</dt><dd>{money(quote.remainingAllocation)}</dd></div><div><dt>Remaining staff budget</dt><dd data-fitness-staff-budget={quote.remainingBudget}>{money(quote.remainingBudget)}</dd></div></dl><p>The full season fee is paid now. All staff appointments share the same season allocation.</p></details></div></div></section>}
      <section className="staff-recruitment panel" aria-labelledby="fitness-recruitment-title"><header className="staff-heading"><h2 id="fitness-recruitment-title">Available fitness coaches</h2><span>{candidates.length} {candidates.length === 1 ? 'coach' : 'coaches'}</span></header><div className="staff-recruitment-filters"><label htmlFor="fitness-search"><Icon name="search" size={16} /><span className="sr-only">Find fitness coach</span><input id="fitness-search" type="search" value={query} onChange={event => { setQuery(event.target.value); setPage(0) }} placeholder="Find a fitness coach" disabled={busy} /></label><label htmlFor="fitness-sort"><span>Sort</span><select id="fitness-sort" value={sort} onChange={event => { setSort(event.target.value); setPage(0) }} disabled={busy}><option value="rating-desc">Best overall</option><option value="fee-asc">Lowest fee</option><option value="fee-desc">Highest fee</option></select></label></div><div className="staff-candidate-grid">{candidates.slice(visiblePage * 6, visiblePage * 6 + 6).map(coach => {
        const candidateQuote = quoteFitnessHire(season, coach.id)
        return <article className={`staff-candidate-card${selectedId === coach.id ? ' staff-selected-candidate' : ''}`} key={coach.id}><button className="staff-candidate-identity" data-candidate-fitness={coach.id} aria-label={`Review ${coach.name}`} aria-expanded={selectedId === coach.id} aria-controls="fitness-candidate-detail" onClick={event => review(coach, event.currentTarget)} disabled={busy}><FitnessPortrait coach={coach} size={64} /><span><strong>{coach.name}</strong><StaffStars rating={fitnessRating(coach)} /><small>Fitness coach</small></span><Icon name="chevron" size={15} /></button><FitnessSkills coach={coach} /><div className="staff-candidate-footer"><span className="staff-card-fee">{money(coach.fee)} <small>/ season</small></span><button className={`button small${candidateQuote.canHire ? ' primary' : ''}`} onClick={event => review(coach, event.currentTarget)} disabled={busy} aria-label={`${candidateQuote.canHire ? 'Recruit' : 'Review'} ${coach.name}`}>{candidateQuote.canHire ? 'Recruit' : 'View coach'}<Icon name="chevron" size={13} /></button></div>{!candidateQuote.canHire && <span className="staff-card-status">{contract ? 'Position filled' : season.round === seasonRounds(season) || season.status === 'complete' ? 'Recruit next season' : 'Review availability'}</span>}</article>
      })}{!candidates.length && <p className="staff-empty">No available fitness coaches match this search.</p>}</div>{candidates.length > 0 && <nav className="staff-candidate-pages" aria-label="Available fitness coaches pages"><span aria-live="polite">{visiblePage * 6 + 1}&ndash;{Math.min(visiblePage * 6 + 6, candidates.length)} of {candidates.length}</span><div><button className="button small" disabled={busy || visiblePage === 0} onClick={() => setPage(visiblePage - 1)} aria-label="Previous fitness coaches"><Icon name="chevron" size={13} />Previous</button><span>{visiblePage + 1} / {pages}</span><button className="button small" disabled={busy || visiblePage >= pages - 1} onClick={() => setPage(visiblePage + 1)} aria-label="Next fitness coaches">Next<Icon name="chevron" size={13} /></button></div></nav>}</section>
      {released.length > 0 && <details className="staff-released panel"><summary>Released fitness coaches this season <span>{released.length}</span></summary><div className="staff-released-list">{released.map(item => <div key={item.id}><FitnessPortrait coach={coachById(item.coachId)} size={36} /><strong>{coachById(item.coachId).name}</strong><span>Matchday {item.releasedRound}</span><span>{money(coachById(item.coachId).fee)} retained</span></div>)}</div></details>}
    </>}
  </div>
}
