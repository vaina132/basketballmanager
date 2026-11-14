import { useEffect, useRef, useState } from 'react'
import type { SeasonState } from '../domain/season'
import type { AssistantCoach } from '../domain/assistant'
import { DEVELOPMENT_ASSISTANTS } from '../data/development-assistants'
import { assistantEffects, assistantRating, availableAssistants, getClubAssistant, quoteAssistantHire } from '../world/assistant-policy'
import { staffCommitted } from '../world/staff-policy'
import { AssistantPortrait } from './AssistantPortrait'
import { StaffStars } from './StaffRating'
import { Icon } from './Icon'
import './assistant-staff.css'
import { seasonRounds } from '../world/career-world'
import { ASSISTANT_DIRECTORY } from '../data/staff-directory'

export interface AssistantStaffProps {
  season: SeasonState
  busy?: boolean
  onEnableAssistant: () => void
  onHireAssistant: (assistantId: string) => void
  onReleaseAssistant: (contractId: string) => void
  onAssistantRenewal: (contractId: string, renew: boolean) => void
  onOpenAssistantAdvice: () => void
}

const money = (cents: number) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(cents / 100)
const assistantById = (id: string) => ASSISTANT_DIRECTORY.find(coach => coach.id === id)!

function AssistantSkills({ coach }: { coach: AssistantCoach }) {
  return <dl className="staff-skill-list compact"><div><dt>Match assessment</dt><dd><span className="staff-skill-bar" aria-hidden="true"><span style={{ width: `${coach.assessment * 10}%` }} /></span><span className="staff-skill-value" aria-label={`${coach.assessment / 2} out of 5 stars`}>{(coach.assessment / 2).toFixed(1)}</span></dd></div></dl>
}

function AssessmentDetails({ coach }: { coach: AssistantCoach }) {
  const { skillStep } = assistantEffects(coach)
  return <details className="assistant-assessment-details"><summary>How assessment works</summary><p>{skillStep === 1 ? 'This assistant compares your players using their full skill detail.' : `This assistant compares your players' skills in ${skillStep}-point steps on the 1–20 scale. Stronger assessment uses finer detail.`} Condition, fouls and player availability are always read directly.</p></details>
}

export function AssistantStaff({ season, busy = false, onEnableAssistant, onHireAssistant, onReleaseAssistant, onAssistantRenewal, onOpenAssistantAdvice }: AssistantStaffProps) {
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
  const enabled = season.assistant.enabledSince !== null
  const seasonFinished = season.status === 'complete' || season.round === seasonRounds(season) && season.activeMatch.status === 'finished'
  const enableReason = !season.finance.enabledSince ? 'Enable club finances before recruiting an assistant coach.' : seasonFinished ? 'No matches left for advice; recruit next season.' : null
  const contract = getClubAssistant(season)
  const appointed = contract ? assistantById(contract.assistantId) : null
  const available = availableAssistants(season)
  const candidates = available.filter(coach => coach.name.toLowerCase().includes(query.trim().toLowerCase())).sort((left, right) => {
    const value = sort.startsWith('rating') ? assistantRating(left) - assistantRating(right) : left.fee - right.fee
    return (sort.endsWith('desc') ? -value : value) || left.name.localeCompare(right.name, 'en')
  })
  const pages = Math.max(1, Math.ceil(candidates.length / 6)), visiblePage = Math.min(page, pages - 1)
  const selected = available.find(coach => coach.id === selectedId) ?? null
  const quote = selected ? quoteAssistantHire(season, selected.id) : null
  const released = season.assistant.contracts.filter(item => item.clubId === club.id && item.seasonNumber === season.seasonNumber && item.releasedRound !== null)

  useEffect(() => {
    if (!selectedId) return
    if (!selected) { setSelectedId(null); document.getElementById('assistant-current-title')?.focus({ preventScroll: true }); return }
    reviewRegion.current?.focus({ preventScroll: true }); reviewRegion.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedId, selected?.id])
  useEffect(() => {
    if (!confirmRelease) return
    if (!contract) { setConfirmRelease(false); document.getElementById('assistant-current-title')?.focus({ preventScroll: true }); return }
    releaseRegion.current?.focus({ preventScroll: true }); releaseRegion.current?.scrollIntoView({ block: 'nearest' })
  }, [confirmRelease, contract?.id])

  function closeReview() { setSelectedId(null); reviewTrigger.current?.focus({ preventScroll: true }) }
  function cancelRelease() { setConfirmRelease(false); releaseTrigger.current?.focus({ preventScroll: true }) }
  function review(coach: AssistantCoach, trigger: HTMLButtonElement) {
    reviewTrigger.current = trigger
    if (selectedId === coach.id) { reviewRegion.current?.focus({ preventScroll: true }); reviewRegion.current?.scrollIntoView({ block: 'nearest' }) }
    else setSelectedId(coach.id)
  }

  return <div className="staff-workspace assistant-staff-workspace">
    <section className="staff-current panel" aria-labelledby="assistant-current-title">
      <header className="staff-heading"><div><h2 id="assistant-current-title" tabIndex={-1}>Assistant coach</h2><span>{club.name} &middot; one position</span></div><div className="scout-header-actions"><span className="staff-slot-count"><span aria-hidden="true"><i className={contract ? 'filled' : ''} /></span>{contract ? 1 : 0} / 1</span>{contract && <button className="button small" onClick={onOpenAssistantAdvice} disabled={busy || season.activeMatch.status === 'finished'} title={season.activeMatch.status === 'finished' ? 'Advice resumes with the next fixture.' : undefined}>Review advice<Icon name="court" size={14} /></button>}</div></header>
      {!enabled ? <div className="scout-enable"><Icon name="staff" size={28} /><div><strong>Recruit an assistant coach</strong><p>Get suggestions for team instructions and substitutions.</p></div><button id="enable-assistant" className="button primary" onClick={onEnableAssistant} disabled={busy || !!enableReason} aria-describedby={enableReason ? 'assistant-enable-reason' : undefined}>Enable assistant staff</button>{enableReason && <p id="assistant-enable-reason">{enableReason}</p>}</div> : appointed && contract ? <div className="assistant-roster">
        <article className="staff-owned-card assistant-owned-card" data-assistant-contract={contract.id}>
          <div className="assistant-owned-profile"><div className="staff-owned-identity"><AssistantPortrait coach={appointed} color={club.color} size={72} /><div><span className="staff-role">Assistant coach</span><h3>{appointed.name}</h3><StaffStars rating={assistantRating(appointed)} /><span className="staff-card-fee">{money(appointed.fee)} <small>/ season</small></span></div></div><AssistantSkills coach={appointed} /></div>
          <div className="assistant-owned-terms"><div className="assistant-role-benefits"><Icon name="court" size={22} /><div><strong>Tactical advice &amp; rotation recommendations</strong><span>You choose which suggestions to apply.</span></div></div><AssessmentDetails coach={appointed} /><div className="staff-contract-controls"><label className="staff-renew"><input type="checkbox" data-assistant-renewal={contract.id} checked={contract.renew} onChange={event => onAssistantRenewal(contract.id, event.target.checked)} disabled={busy} aria-label={`Renew ${appointed.name} next season`} />Renew next season</label><button ref={releaseTrigger} className="text-button" id="release-assistant" onClick={() => setConfirmRelease(true)} disabled={busy}>Release</button></div></div>
        </article>
      </div> : <div className="assistant-roster"><button className="staff-vacancy assistant-vacancy" onClick={() => { document.getElementById('assistant-search')?.focus(); document.getElementById('assistant-recruitment-title')?.scrollIntoView({ block: 'nearest' }) }} disabled={busy}><span className="staff-vacancy-image" aria-hidden="true"><Icon name="staff" size={34} /><span>+</span></span><span><strong>Vacant assistant position</strong><small>Tactics &amp; rotation recommendations</small><span className="staff-vacancy-action">Find an assistant coach<Icon name="chevron" size={13} /></span></span></button></div>}
      {confirmRelease && contract && appointed && <div ref={releaseRegion} id="assistant-release-confirmation" className="staff-release-confirmation" tabIndex={-1} role="group" aria-label={`Release ${appointed.name}`} onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.preventDefault(); cancelRelease() } }}><AssistantPortrait coach={appointed} size={42} /><div className="staff-release-copy"><strong>Release {appointed.name}?</strong><p>{money(appointed.fee)} remains committed. No refund. Match settings and substitutions you already requested stay in place.</p></div><div className="staff-release-actions"><button id="confirm-release-assistant" className="button" onClick={() => onReleaseAssistant(contract.id)} disabled={busy}>Confirm release</button><button className="text-button" onClick={cancelRelease} disabled={busy}>Cancel</button></div></div>}
      <details className="staff-explainer"><summary>Assistant role &amp; appointment terms</summary><p>Stronger match assessment makes finer distinctions between your players when suggesting instructions and substitutions. Advice uses your squad and the current match. You choose what to apply; automatic rotation remains available without an appointment. The full season fee is paid when hired and shares the staff allocation. Released fees are retained; renewals depend on next season's budget and available cash.</p></details>
    </section>
    {enabled && <>
      {selected && quote && <section ref={reviewRegion} id="assistant-candidate-detail" className="staff-candidate-detail panel" tabIndex={-1} aria-labelledby="assistant-candidate-title" data-selected-assistant={selected.id} onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.preventDefault(); closeReview() } }}>
        <header className="staff-heading"><div><h2 id="assistant-candidate-title">Recruit {selected.name}</h2><span>Assistant coach</span></div><button className="text-button" onClick={closeReview} disabled={busy} aria-label="Close assistant coach details"><Icon name="close" size={14} />Close</button></header>
        <div className="staff-candidate-body"><div className="assistant-candidate-profile"><div className="staff-candidate-profile"><div className="staff-profile-portrait"><AssistantPortrait coach={selected} color={club.color} size={100} /><StaffStars rating={assistantRating(selected)} /></div><AssistantSkills coach={selected} /></div><AssessmentDetails coach={selected} /></div><div className="staff-hire-controls"><div className="staff-offer-fee"><span>Season fee</span><strong>{money(quote.fee)}</strong></div><div className="staff-after-hire"><span>{quote.remainingBudget >= quote.fee ? 'Remaining staff budget after hire' : 'Staff budget shortfall'}</span><strong data-assistant-budget-after={quote.remainingBudget - quote.fee}>{money(Math.abs(quote.remainingBudget - quote.fee))}</strong></div><span className="staff-renewal-note"><Icon name="check" size={14} />Renewal selected for next season</span>{quote.reason && <p id="assistant-hire-reason" className="staff-hire-reason">{quote.reason}</p>}<button id="hire-assistant" className="button primary" onClick={() => onHireAssistant(selected.id)} disabled={busy || !quote.canHire} aria-describedby={quote.reason ? 'assistant-hire-reason' : undefined}><Icon name="staff" size={16} />Hire for {money(quote.fee)}</button><details className="staff-payment-details"><summary>Payment details</summary><dl><div><dt>Staff fees committed</dt><dd>{money(staffCommitted(season, club.id))}</dd></div><div><dt>Staff allocation remaining</dt><dd>{money(quote.remainingAllocation)}</dd></div><div><dt>Remaining staff budget</dt><dd data-assistant-staff-budget={quote.remainingBudget}>{money(quote.remainingBudget)}</dd></div></dl><p>The full season fee is paid now. All staff appointments share the same season allocation.</p></details></div></div>
      </section>}
      <section className="staff-recruitment panel" aria-labelledby="assistant-recruitment-title"><header className="staff-heading"><h2 id="assistant-recruitment-title">Available assistant coaches</h2><span>{candidates.length} {candidates.length === 1 ? 'coach' : 'coaches'}</span></header><div className="staff-recruitment-filters"><label htmlFor="assistant-search"><Icon name="search" size={16} /><span className="sr-only">Find assistant coach</span><input id="assistant-search" type="search" value={query} onChange={event => { setQuery(event.target.value); setPage(0) }} placeholder="Find an assistant coach" disabled={busy} /></label><label htmlFor="assistant-sort"><span>Sort</span><select id="assistant-sort" value={sort} onChange={event => { setSort(event.target.value); setPage(0) }} disabled={busy}><option value="rating-desc">Best assessment</option><option value="fee-asc">Lowest fee</option><option value="fee-desc">Highest fee</option></select></label></div><div className="staff-candidate-grid">{candidates.slice(visiblePage * 6, visiblePage * 6 + 6).map(coach => {
        const candidateQuote = quoteAssistantHire(season, coach.id)
        return <article className={`staff-candidate-card${selectedId === coach.id ? ' staff-selected-candidate' : ''}`} key={coach.id}><button className="staff-candidate-identity" data-candidate-assistant={coach.id} aria-label={`Review ${coach.name}`} aria-expanded={selectedId === coach.id} aria-controls="assistant-candidate-detail" onClick={event => review(coach, event.currentTarget)} disabled={busy}><AssistantPortrait coach={coach} size={64} /><span><strong>{coach.name}</strong><StaffStars rating={assistantRating(coach)} /><small>Assistant coach</small></span><Icon name="chevron" size={13} /></button><AssistantSkills coach={coach} /><div className="staff-candidate-footer"><span className="staff-card-fee">{money(coach.fee)} <small>/ season</small></span><button className={`button small${candidateQuote.canHire ? ' primary' : ''}`} onClick={event => review(coach, event.currentTarget)} disabled={busy} aria-label={`${candidateQuote.canHire ? 'Recruit' : 'Review'} ${coach.name}`}>{candidateQuote.canHire ? 'Recruit' : 'View assistant'}<Icon name="chevron" size={13} /></button></div>{!candidateQuote.canHire && <span className="staff-card-status">{contract ? 'Position filled' : seasonFinished ? 'Recruit next season' : 'Review availability'}</span>}</article>
      })}{!candidates.length && <p className="staff-empty">No available assistant coaches match this search.</p>}</div>{candidates.length > 0 && <nav className="staff-candidate-pages" aria-label="Available assistant coaches pages"><span aria-live="polite">{visiblePage * 6 + 1}&ndash;{Math.min(visiblePage * 6 + 6, candidates.length)} of {candidates.length}</span><div><button className="button small" disabled={busy || visiblePage === 0} onClick={() => setPage(visiblePage - 1)} aria-label="Previous assistant coaches"><Icon name="chevron" size={13} />Previous</button><span>{visiblePage + 1} / {pages}</span><button className="button small" disabled={busy || visiblePage >= pages - 1} onClick={() => setPage(visiblePage + 1)} aria-label="Next assistant coaches">Next<Icon name="chevron" size={13} /></button></div></nav>}</section>
      {released.length > 0 && <details className="staff-released panel"><summary>Released assistant coaches this season <span>{released.length}</span></summary><div className="staff-released-list">{released.map(item => <div key={item.id}><AssistantPortrait coach={assistantById(item.assistantId)} size={36} /><strong>{assistantById(item.assistantId).name}</strong><span>Matchday {item.releasedRound}</span><span>{money(assistantById(item.assistantId).fee)} retained</span></div>)}</div></details>}
    </>}
  </div>
}
