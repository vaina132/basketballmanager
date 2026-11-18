import { useEffect, useRef, useState } from 'react'
import { replacementTarget, revealCandidates, ShowCandidatesButton, StaffReplacementOffer, type StaffCandidateControls } from './StaffReplacement'
import { sackingTerms } from '../world/staff-roster'
import type { SeasonState } from '../domain/season'
import type { YouthCoach } from '../domain/youth'
import { DEVELOPMENT_YOUTH_COACHES } from '../data/development-youth'
import { youthCoachEffects, youthCoachRating, availableYouthCoaches, getClubYouthCoach, quoteYouthCoachHire } from '../world/youth-policy'
import { staffCommitted } from '../world/staff-policy'
import { YouthCoachPortrait } from './YouthCoachPortrait'
import { StaffStars } from './StaffRating'
import { Icon } from './Icon'
import './youth-staff.css'
import { seasonRounds } from '../world/career-world'
import { YOUTH_COACH_DIRECTORY } from '../data/staff-directory'
import { formatEuros } from './money-format'
import { staffFee } from '../world/economy'

export interface YouthCoachStaffProps extends StaffCandidateControls {
  season: SeasonState
  busy?: boolean
  onEnableYouth: () => void
  onHireYouthCoach: (coachId: string) => void
  onReleaseYouthCoach: (contractId: string) => void
  onYouthCoachRenewal: (contractId: string, renew: boolean) => void
  onOpenAcademy: () => void
}

const money = (cents: number) => formatEuros(cents)
const coachById = (id: string) => YOUTH_COACH_DIRECTORY.find(coach => coach.id === id)!

function YouthSkills({ coach }: { coach: YouthCoach }) {
  return <dl className="staff-skill-list compact"><div><dt>Youth development</dt><dd><span className="staff-skill-bar" aria-hidden="true"><span style={{ width: `${coach.development * 10}%` }} /></span><span className="staff-skill-value" aria-label={`${coach.development / 2} out of 5 stars`}>{(coach.development / 2).toFixed(1)}</span></dd></div></dl>
}

function DevelopmentDetails({ coach }: { coach: YouthCoach }) {
  const { bonusPercent } = youthCoachEffects(coach)
  return <div className="youth-development-benefits"><strong>+{bonusPercent}% academy practice</strong><details className="youth-assessment-details"><summary>How development works</summary><p>Every prospect receives extra practice in completed academy weeks. Focus directs the practice; 100 points improves a skill by one, up to three improvements per skill in the academy. No match or senior training bonus.</p></details></div>
}

export function YouthCoachStaff({ season, busy = false, onEnableYouth, onHireYouthCoach, onReleaseYouthCoach, onYouthCoachRenewal, onOpenAcademy , showCandidates = true, onShowCandidates, replaceContractId, onReplaceStaff }: YouthCoachStaffProps) {
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
  const enabled = season.youth.enabledSince !== null
  const seasonFinished = season.status === 'complete' || season.round === seasonRounds(season)
  const enableReason = !season.academy.enabledSince ? 'Enable the academy before recruiting a youth coach.' : !season.finance.enabledSince ? 'Enable club finances before recruiting a youth coach.' : seasonFinished ? 'No development weeks left; recruit next season.' : null
  const contract = getClubYouthCoach(season)
  const appointed = contract ? coachById(contract.coachId) : null
  const available = availableYouthCoaches(season)
  const candidates = available.filter(coach => coach.name.toLowerCase().includes(query.trim().toLowerCase())).sort((left, right) => {
    const value = sort.startsWith('rating') ? youthCoachRating(left) - youthCoachRating(right) : left.fee - right.fee
    return (sort.endsWith('desc') ? -value : value) || left.name.localeCompare(right.name, 'en')
  })
  const pages = Math.max(1, Math.ceil(candidates.length / 6)), visiblePage = Math.min(page, pages - 1)
  const selected = available.find(coach => coach.id === selectedId) ?? null
  /** Hiring for a filled role, or after Replace on the overview, replaces someone (format 74). */
  const replacement = selected && enabled ? replacementTarget(season, 'youth', 1, replaceContractId) : null
  const quote = selected ? quoteYouthCoachHire(season, selected.id) : null
  const released = season.youth.contracts.filter(item => item.clubId === club.id && item.seasonNumber === season.seasonNumber && item.releasedRound !== null)

  useEffect(() => {
    if (!selectedId) return
    if (!selected) { setSelectedId(null); document.getElementById('youth-current-title')?.focus({ preventScroll: true }); return }
    reviewRegion.current?.focus({ preventScroll: true }); reviewRegion.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedId, selected?.id])
  useEffect(() => {
    if (!confirmRelease) return
    if (!contract) { setConfirmRelease(false); document.getElementById('youth-current-title')?.focus({ preventScroll: true }); return }
    releaseRegion.current?.focus({ preventScroll: true }); releaseRegion.current?.scrollIntoView({ block: 'nearest' })
  }, [confirmRelease, contract?.id])

  function closeReview() { setSelectedId(null); reviewTrigger.current?.focus({ preventScroll: true }) }
  function cancelRelease() { setConfirmRelease(false); releaseTrigger.current?.focus({ preventScroll: true }) }
  function review(coach: YouthCoach, trigger: HTMLButtonElement) {
    reviewTrigger.current = trigger
    if (selectedId === coach.id) { reviewRegion.current?.focus({ preventScroll: true }); reviewRegion.current?.scrollIntoView({ block: 'nearest' }) }
    else setSelectedId(coach.id)
  }

  return <div className="staff-workspace youth-staff-workspace">
    <section className="staff-current panel" aria-labelledby="youth-current-title">
      <header className="staff-heading"><div><h2 id="youth-current-title" tabIndex={-1}>Youth coach</h2><span>{club.name} &middot; one position</span></div><div className="scout-header-actions"><span className="staff-slot-count"><span aria-hidden="true"><i className={contract ? 'filled' : ''} /></span>{contract ? 1 : 0} / 1</span>{contract && <button className="button small" onClick={onOpenAcademy} disabled={busy}>Open academy<Icon name="training" size={14} /></button>}</div></header>
      {!enabled ? <div className="scout-enable"><Icon name="staff" size={28} /><div><strong>Recruit a youth coach</strong><p>Support the development of your academy prospects.</p></div><button id="enable-youth" className="button primary" onClick={onEnableYouth} disabled={busy || !!enableReason} aria-describedby={enableReason ? 'youth-enable-reason' : undefined}>Enable youth staff</button>{enableReason && <p id="youth-enable-reason">{enableReason}</p>}</div> : appointed && contract ? <div className="youth-roster">
        <article className="staff-owned-card youth-owned-card" data-youth-contract={contract.id}>
          <div className="youth-owned-profile"><div className="staff-owned-identity"><YouthCoachPortrait coach={appointed} color={club.color} size={72} /><div><span className="staff-role">Youth coach</span><h3>{appointed.name}</h3><StaffStars rating={youthCoachRating(appointed)} /><span className="staff-card-fee">{money(feeOf(appointed.fee))} <small>/ season</small></span></div></div><YouthSkills coach={appointed} /></div>
          <div className="youth-owned-terms"><div className="youth-role-benefits"><Icon name="training" size={22} /><div><strong>Extra practice for every prospect</strong><span>Individual training focus stays under your control.</span></div></div><DevelopmentDetails coach={appointed} /><div className="staff-contract-controls"><label className="staff-renew"><input type="checkbox" data-youth-renewal={contract.id} checked={contract.renew} onChange={event => onYouthCoachRenewal(contract.id, event.target.checked)} disabled={busy} aria-label={`Renew ${appointed.name} next season`} />Renew next season</label><button ref={releaseTrigger} className="text-button" id="release-youth" onClick={() => setConfirmRelease(true)} disabled={busy}>Release</button></div></div>
        </article>
      </div> : <div className="youth-roster"><button className="staff-vacancy youth-vacancy" onClick={() => revealCandidates(onShowCandidates, 'youth-search', 'youth-recruitment-title')} disabled={busy}><span className="staff-vacancy-image" aria-hidden="true"><Icon name="staff" size={34} /><span>+</span></span><span><strong>Vacant youth coach position</strong><small>Academy development support</small><span className="staff-vacancy-action">Find a youth coach<Icon name="chevron" size={13} /></span></span></button></div>}
      {confirmRelease && contract && appointed && <div ref={releaseRegion} id="youth-release-confirmation" className="staff-release-confirmation" tabIndex={-1} role="group" aria-label={`Release ${appointed.name}`} onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.preventDefault(); cancelRelease() } }}><YouthCoachPortrait coach={appointed} size={42} /><div className="staff-release-copy"><strong>Release {appointed.name}?</strong><p>{sackingTerms(season, { name: appointed.name, fee: feeOf(appointed.fee) }, money)} Development already earned is kept. Future academy weeks lose this support.</p></div><div className="staff-release-actions"><button id="confirm-release-youth" className="button" onClick={() => onReleaseYouthCoach(contract.id)} disabled={busy}>Confirm release</button><button className="text-button" onClick={cancelRelease} disabled={busy}>Cancel</button></div></div>}
      <details className="staff-explainer"><summary>Youth coaching &amp; appointment terms</summary><p>The youth coach supports all academy prospects between matchdays. Development follows each prospect's selected focus and is capped per skill. Academy practice continues without an appointment. The full season fee is paid when hired and shares the staff budget. Released fees are retained; renewals depend on next season's budget and available cash.</p></details>
    </section>
    {enabled && <>
      {!showCandidates && <ShowCandidatesButton label="available youth coaches" count={available.length} onShow={onShowCandidates} busy={busy} />}
      {showCandidates && <>{selected && quote && <section ref={reviewRegion} id="youth-candidate-detail" className="staff-candidate-detail panel" tabIndex={-1} aria-labelledby="youth-candidate-title" data-selected-youth={selected.id} onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.preventDefault(); closeReview() } }}>
        <header className="staff-heading"><div><h2 id="youth-candidate-title">Recruit {selected.name}</h2><span>Youth coach</span></div><button className="text-button" onClick={closeReview} disabled={busy} aria-label="Close youth coach details"><Icon name="close" size={14} />Close</button></header>
        <div className="staff-candidate-body"><div className="youth-candidate-profile"><div className="staff-candidate-profile"><div className="staff-profile-portrait"><YouthCoachPortrait coach={selected} color={club.color} size={100} /><StaffStars rating={youthCoachRating(selected)} /></div><YouthSkills coach={selected} /></div><DevelopmentDetails coach={selected} /></div><div className="staff-hire-controls"><div className="staff-offer-fee"><span>Season fee</span><strong>{money(quote.fee)}</strong></div><div className="staff-after-hire"><span>{quote.remainingBudget >= quote.fee ? 'Wages left after hire' : 'Wages left shortfall'}</span><strong data-youth-budget-after={quote.remainingBudget - quote.fee}>{money(Math.abs(quote.remainingBudget - quote.fee))}</strong></div><span className="staff-renewal-note"><Icon name="check" size={14} />Renewal selected for next season</span>{replacement && selected ? <StaffReplacementOffer key={selected.id} season={season} role="youth" personId={selected.id} personName={selected.name} fee={quote.fee} target={replacement} busy={busy} onReplaceStaff={onReplaceStaff} /> : <>{quote.reason && <p id="youth-hire-reason" className="staff-hire-reason">{quote.reason}</p>}<button id="hire-youth" className="button primary" onClick={() => onHireYouthCoach(selected.id)} disabled={busy || !quote.canHire} aria-describedby={quote.reason ? 'youth-hire-reason' : undefined}><Icon name="staff" size={16} />Hire for {money(quote.fee)}</button></>}<details className="staff-payment-details"><summary>Payment details</summary><dl><div><dt>Staff fees committed</dt><dd>{money(staffCommitted(season, club.id))}</dd></div><div><dt>Wages left for staff</dt><dd>{money(quote.remainingAllocation)}</dd></div><div><dt>Wages left</dt><dd data-youth-staff-budget={quote.remainingBudget}>{money(quote.remainingBudget)}</dd></div></dl><p>The full season fee is paid now. All staff appointments share the same season allocation.</p></details></div></div>
      </section>}
      <section className="staff-recruitment panel" aria-labelledby="youth-recruitment-title"><header className="staff-heading"><h2 id="youth-recruitment-title">Available youth coaches</h2><span>{candidates.length} {candidates.length === 1 ? 'coach' : 'coaches'}</span></header><div className="staff-recruitment-filters"><label htmlFor="youth-search"><Icon name="search" size={16} /><span className="sr-only">Find youth coach</span><input id="youth-search" type="search" value={query} onChange={event => { setQuery(event.target.value); setPage(0) }} placeholder="Find a youth coach" disabled={busy} /></label><label htmlFor="youth-sort"><span>Sort</span><select id="youth-sort" value={sort} onChange={event => { setSort(event.target.value); setPage(0) }} disabled={busy}><option value="rating-desc">Best development</option><option value="fee-asc">Lowest fee</option><option value="fee-desc">Highest fee</option></select></label></div><div className="staff-candidate-grid">{candidates.slice(visiblePage * 6, visiblePage * 6 + 6).map(coach => {
        const candidateQuote = quoteYouthCoachHire(season, coach.id)
        return <article className={`staff-candidate-card${selectedId === coach.id ? ' staff-selected-candidate' : ''}`} key={coach.id}><button className="staff-candidate-identity" data-candidate-youth={coach.id} aria-label={`Review ${coach.name}`} aria-expanded={selectedId === coach.id} aria-controls="youth-candidate-detail" onClick={event => review(coach, event.currentTarget)} disabled={busy}><YouthCoachPortrait coach={coach} size={64} /><span><strong>{coach.name}</strong><StaffStars rating={youthCoachRating(coach)} /><small>Youth coach</small></span><Icon name="chevron" size={13} /></button><YouthSkills coach={coach} /><div className="staff-candidate-footer"><span className="staff-card-fee">{money(feeOf(coach.fee))} <small>/ season</small></span><button className={`button small${candidateQuote.canHire ? ' primary' : ''}`} onClick={event => review(coach, event.currentTarget)} disabled={busy} aria-label={`${candidateQuote.canHire ? 'Recruit' : 'Review'} ${coach.name}`}>{candidateQuote.canHire ? 'Recruit' : 'View coach'}<Icon name="chevron" size={13} /></button></div>{!candidateQuote.canHire && <span className="staff-card-status">{contract ? 'Replaces your youth coach' : seasonFinished ? 'Recruit next season' : 'Review availability'}</span>}</article>
      })}{!candidates.length && <p className="staff-empty">No available youth coaches match this search.</p>}</div>{candidates.length > 0 && <nav className="staff-candidate-pages" aria-label="Available youth coaches pages"><span aria-live="polite">{visiblePage * 6 + 1}&ndash;{Math.min(visiblePage * 6 + 6, candidates.length)} of {candidates.length}</span><div><button className="button small" disabled={busy || visiblePage === 0} onClick={() => setPage(visiblePage - 1)} aria-label="Previous youth coaches"><Icon name="chevron" size={13} />Previous</button><span>{visiblePage + 1} / {pages}</span><button className="button small" disabled={busy || visiblePage >= pages - 1} onClick={() => setPage(visiblePage + 1)} aria-label="Next youth coaches">Next<Icon name="chevron" size={13} /></button></div></nav>}</section></>}
      {released.length > 0 && <details className="staff-released panel"><summary>Released youth coaches this season <span>{released.length}</span></summary><div className="staff-released-list">{released.map(item => <div key={item.id}><YouthCoachPortrait coach={coachById(item.coachId)} size={36} /><strong>{coachById(item.coachId).name}</strong><span>Matchday {item.releasedRound}</span><span>{money(feeOf(coachById(item.coachId).fee))} retained</span></div>)}</div></details>}
    </>}
  </div>
}
