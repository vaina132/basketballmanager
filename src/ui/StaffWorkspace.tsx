import { useEffect, useRef, useState } from 'react'
import type { SeasonState } from '../domain/season'
import type { Coach } from '../domain/coaching'
import type { TrainingFocus } from '../domain/training'
import { COACHES } from '../data/development-coaches'
import { availableCoaches, coachRating, coachingCommitted, COACHING_BUDGET, getClubCoaching, MAX_COACHES } from '../world/coaching'
import { getFinanceBalance } from '../world/finance'
import { getPayrollReserve, getSpendableCash } from '../world/payroll'
import { TRAINING_ATTRIBUTES, TRAINING_FOCUSES, TRAINING_FOCUS_LABELS } from '../world/training'
import { Icon } from './Icon'
import './staff-workspace.css'

interface StaffWorkspaceProps {
  season: SeasonState
  onEnable: () => void
  onHire: (coachId: string, focus: TrainingFocus) => void
  onRelease: (contractId: string) => void
  onAssignment: (contractId: string, focus: TrainingFocus) => void
  onRenewal: (contractId: string, renew: boolean) => void
  onOpenTraining: () => void
  busy?: boolean
}

const moneyFormatter = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2 })
const money = (cents: number) => moneyFormatter.format(cents / 100)
const coachById = (id: string) => COACHES.find(coach => coach.id === id)!
const compareNames = (left: Coach, right: Coach) => left.name.localeCompare(right.name, 'en') || left.id.localeCompare(right.id, 'en')
type CoachSort = 'rating-desc' | 'rating-asc' | 'fee-asc' | 'fee-desc'

function CoachStars({ rating }: { rating: number }) {
  return <span className="coach-rating" role="img" aria-label={`${rating / 2} out of 5 stars`}>
    <span className="coach-stars" aria-hidden="true">{Array.from({ length: 5 }, (_, index) => <span className="coach-star" key={index}><span>☆</span><span className="coach-star-fill" style={{ width: `${Math.max(0, Math.min(2, rating - index * 2)) * 50}%` }}>★</span></span>)}</span>
    <span className="coach-rating-number" aria-hidden="true">{(rating / 2).toFixed(1)}</span>
  </span>
}

function FocusOptions() {
  return <>{TRAINING_FOCUSES.map(focus => <option key={focus} value={focus}>{TRAINING_FOCUS_LABELS[focus]}</option>)}</>
}

export function StaffWorkspace({ season, onEnable, onHire, onRelease, onAssignment, onRenewal, onOpenTraining, busy = false }: StaffWorkspaceProps) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<CoachSort>('rating-desc')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hireFocus, setHireFocus] = useState<TrainingFocus>('balanced')
  const [releaseId, setReleaseId] = useState<string | null>(null)
  const candidateRegion = useRef<HTMLElement>(null)
  const candidateTrigger = useRef<HTMLButtonElement | null>(null)
  const releaseRegion = useRef<HTMLDivElement>(null)
  const releaseTrigger = useRef<HTMLButtonElement | null>(null)
  const staffHeading = useRef<HTMLHeadingElement>(null)
  const club = season.clubs.find(team => team.id === season.managedClubId)!
  const enabled = season.coaching.enabledSince !== null
  const contracts = getClubCoaching(season.coaching, club.id)
  const released = season.coaching.contracts.filter(contract => contract.clubId === club.id && contract.releasedRound !== null)
  const committed = coachingCommitted(season.coaching, club.id)
  const allocation = COACHING_BUDGET - committed
  const finances = season.finance.enabledSince === null ? null : getFinanceBalance(season.finance, club.id)
  const payrollEnabled = season.payroll.enabledSince !== null
  const wageReserve = getPayrollReserve(season, club.id)
  const spendable = getSpendableCash(season, club.id)
  const available = availableCoaches(season.coaching)
  const candidates = available.filter(coach => coach.name.toLowerCase().includes(query.trim().toLowerCase())).sort((left, right) => {
    const value = sort.startsWith('rating') ? coachRating(left) - coachRating(right) : left.fee - right.fee
    return (sort.endsWith('desc') ? -value : value) || compareNames(left, right)
  })
  const selected = available.find(coach => coach.id === selectedId) ?? null
  const releaseContract = contracts.find(contract => contract.id === releaseId) ?? null
  const releaseCoach = releaseContract ? coachById(releaseContract.coachId) : null

  useEffect(() => {
    if (!selectedId) return
    if (!selected) { setSelectedId(null); staffHeading.current?.focus({ preventScroll: true }); return }
    candidateRegion.current?.focus({ preventScroll: true })
    candidateRegion.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedId, selected?.id])

  useEffect(() => {
    if (!releaseId) return
    if (!releaseContract) { setReleaseId(null); staffHeading.current?.focus({ preventScroll: true }); return }
    releaseRegion.current?.focus({ preventScroll: true })
    releaseRegion.current?.scrollIntoView({ block: 'nearest' })
  }, [releaseId, releaseContract?.id])

  function hiringReason(coach: Coach): string | null {
    if (season.status === 'complete') return 'Start next season before recruiting.'
    if (contracts.length >= MAX_COACHES) return `All ${MAX_COACHES} coaching roles are filled.`
    if (coach.fee > allocation) return `${money(coach.fee - allocation)} above the available allocation.`
    if (finances && finances.unpaid > 0) return `Clear ${money(finances.unpaid)} of unpaid costs before recruiting.`
    if (finances && coach.fee > spendable) return payrollEnabled ? `${money(coach.fee - spendable)} more spendable cash is needed after reserving future wages.` : `${money(coach.fee - finances.cash)} more cash is needed for this season fee.`
    return null
  }

  function closeCandidate() {
    setSelectedId(null)
    if (candidateTrigger.current?.isConnected) candidateTrigger.current.focus()
    else document.getElementById('coach-search')?.focus()
  }

  function cancelRelease() {
    setReleaseId(null)
    releaseTrigger.current?.focus()
  }

  return <div className="staff-workspace">
    <section className="staff-context panel" aria-label="Coaching allocation">
      <div><strong>{club.name}</strong><span>Training coaches · Season {season.seasonNumber}</span></div>
      {enabled && <dl className="staff-allocation"><div><dt>Coaching budget</dt><dd>{money(COACHING_BUDGET)}</dd></div><div><dt>Committed</dt><dd data-coaching-committed={committed}>{money(committed)}</dd></div><div><dt>Available allocation</dt><dd data-coaching-available={allocation}>{money(allocation)}</dd></div></dl>}
    </section>

    {finances && <section className="staff-training-note panel" aria-label="Club cash"><p><strong>Cash: <span data-staff-cash={finances.cash}>{money(finances.cash)}</span></strong> · Unpaid costs: <span data-staff-unpaid={finances.unpaid}>{money(finances.unpaid)}</span>{payrollEnabled && <> · Future wages reserved: <span data-staff-reserve={wageReserve}>{money(wageReserve)}</span> · Spendable: <span data-staff-spendable={spendable}>{money(spendable)}</span></>}. Hiring requires coaching allocation and {payrollEnabled ? 'cash after future wage reserves' : 'cash'}; the full season fee is charged immediately.</p></section>}

    {season.training.enabledSince === null && <section className="staff-training-note panel" aria-label="Training status"><p>Training is disabled. Enable it in Training for coaches to affect development.</p><button className="button small" onClick={onOpenTraining} disabled={busy}>Open training<Icon name="chevron" size={14} /></button></section>}

    {!enabled ? <section className="staff-enable panel" aria-labelledby="staff-enable-title">
      <header className="staff-heading"><h2 id="staff-enable-title">Training coaches</h2><span>Not enabled</span></header>
      <div><p>{finances ? 'Enable coaching for every club. Each club receives a coaching allocation; starter coaches require enough cash after future wage reserves and no unpaid costs. Unaffordable positions stay vacant. Assignments affect future training weeks.' : 'Enable coaching for every club. Each club receives one starter coach, whose full season fee uses part of its coaching allocation. Assignments affect future training weeks.'}{season.status === 'complete' && <span id="coaching-enable-reason" className="staff-assignment-note">Start next season before enabling coaching.</span>}</p><button id="enable-coaching" className="button primary" onClick={onEnable} disabled={busy || season.status === 'complete'} aria-describedby={season.status === 'complete' ? 'coaching-enable-reason' : undefined}>Enable coaching<Icon name="people" size={16} /></button></div>
    </section> : <>
      <section className="staff-current panel" aria-labelledby="staff-current-title">
        <header className="staff-heading"><h2 id="staff-current-title" ref={staffHeading} tabIndex={-1}>Current coaching staff</h2><span>{contracts.length} / {MAX_COACHES} roles filled</span></header>
        {contracts.length ? <div className="staff-table-scroll" tabIndex={0} role="region" aria-label="Current coaching staff"><table className="staff-current-table"><thead><tr><th scope="col">Coach</th><th scope="col">Overall</th><th scope="col">Assignment</th><th scope="col">Season fee</th><th scope="col">Next season</th><th scope="col">Contract</th></tr></thead><tbody>{contracts.map(contract => {
          const coach = coachById(contract.coachId)
          return <tr key={contract.id} data-contract-id={contract.id}>
            <th scope="row">{coach.name}<small>Signed on Matchday {contract.startedRound}</small><details className="staff-owned-skills" data-coach-skills={contract.id}><summary aria-label={`${coach.name} coaching skills`}>Coaching skills</summary><dl className="staff-coach-skills">{TRAINING_ATTRIBUTES.map(attribute => <div key={attribute}><dt>{TRAINING_FOCUS_LABELS[attribute]}</dt><dd><CoachStars rating={coach.skills[attribute]} /></dd></div>)}</dl></details></th>
            <td><CoachStars rating={coachRating(coach)} /></td>
            <td><select data-coach-assignment={contract.id} aria-label={`${coach.name} assignment`} value={contract.focus} onChange={event => onAssignment(contract.id, event.target.value as TrainingFocus)} disabled={busy}><FocusOptions /></select></td>
            <td className="staff-fee">{money(coach.fee)}</td>
            <td><label className="staff-renew"><input type="checkbox" data-coach-renewal={contract.id} checked={contract.renew} onChange={event => onRenewal(contract.id, event.target.checked)} disabled={busy} aria-label={`Renew ${coach.name} next season`} />Renew</label></td>
            <td><button className="text-button" data-release-coach={contract.id} onClick={event => { releaseTrigger.current = event.currentTarget; setReleaseId(contract.id) }} aria-label={`Release ${coach.name}`} disabled={busy}>Release</button></td>
          </tr>
        })}</tbody></table></div> : <p className="staff-empty">No training coaches signed.</p>}
        {releaseContract && releaseCoach && <div ref={releaseRegion} className="staff-release-confirmation" id="coach-release-confirmation" tabIndex={-1} role="group" aria-label={`Release ${releaseCoach.name}`} onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented && !busy) { event.preventDefault(); event.stopPropagation(); cancelRelease() } }}>
          <p>Release <strong>{releaseCoach.name}</strong>? The {money(releaseCoach.fee)} season fee stays committed. Available allocation remains {money(allocation)}.{finances && ' No cash is refunded.'}</p>
          <div><button className="button" onClick={() => onRelease(releaseContract.id)} aria-label={`Confirm release ${releaseCoach.name}`} disabled={busy}>Confirm release</button><button className="text-button" onClick={cancelRelease} disabled={busy}>Cancel</button></div>
        </div>}
        <p className="staff-note">Season fees are reserved in full, including midseason hires and released contracts. {finances ? 'Renewals require available allocation and cash after future wage reserves, with no unpaid costs, when the next season begins.' : 'Renewal reserves a new season fee when the next season begins.'}<span className="staff-assignment-note">Focused assignments use full skill strength; Balanced uses half strength for every skill. Only the best applicable coach counts.</span></p>
      </section>

      {released.length > 0 && <details className="staff-released panel"><summary>Released this season <span>{released.length} contracts · {money(released.reduce((total, contract) => total + coachById(contract.coachId).fee, 0))} retained</span></summary><div className="staff-table-scroll" tabIndex={0} role="region" aria-label="Released coaching contracts"><table><thead><tr><th scope="col">Coach</th><th scope="col">Released</th><th scope="col">Committed season fee</th></tr></thead><tbody>{released.map(contract => <tr key={contract.id}><th scope="row">{coachById(contract.coachId).name}</th><td>Matchday {contract.releasedRound}</td><td>{money(coachById(contract.coachId).fee)}</td></tr>)}</tbody></table></div></details>}

      <section className="staff-recruitment panel" aria-labelledby="staff-recruitment-title">
        <header className="staff-heading"><h2 id="staff-recruitment-title">Available coaches</h2><span>{candidates.length} matching coaches</span></header>
        <div className="staff-recruitment-filters"><label htmlFor="coach-search">Find coach<input type="search" id="coach-search" value={query} onChange={event => setQuery(event.target.value)} disabled={busy} placeholder="Search by name" /></label><label htmlFor="coach-sort">Sort<select id="coach-sort" value={sort} onChange={event => setSort(event.target.value as CoachSort)} disabled={busy}><option value="rating-desc">Overall: highest first</option><option value="rating-asc">Overall: lowest first</option><option value="fee-asc">Fee: lowest first</option><option value="fee-desc">Fee: highest first</option></select></label></div>
        <div className="staff-table-scroll staff-candidate-scroll" tabIndex={0} role="region" aria-label="Available training coaches"><table className="staff-candidates-table"><thead><tr><th scope="col">Coach</th><th scope="col">Overall</th><th scope="col">Strongest skill</th><th scope="col">Season fee</th><th scope="col">Recruitment</th></tr></thead><tbody>{candidates.map(coach => {
          const strongest = TRAINING_ATTRIBUTES.reduce((best, attribute) => coach.skills[attribute] > coach.skills[best] ? attribute : best, TRAINING_ATTRIBUTES[0])
          const reason = hiringReason(coach)
          return <tr key={coach.id} className={selectedId === coach.id ? 'staff-selected-candidate' : ''}>
            <th scope="row"><button className="text-button staff-candidate-name" data-candidate-coach={coach.id} aria-label={`Review ${coach.name}`} aria-expanded={selectedId === coach.id} aria-controls="coach-candidate-detail" onClick={event => { candidateTrigger.current = event.currentTarget; if (selectedId === coach.id) { candidateRegion.current?.focus({ preventScroll: true }); candidateRegion.current?.scrollIntoView({ block: 'nearest' }) } else { setHireFocus('balanced'); setSelectedId(coach.id) } }} disabled={busy}>{coach.name}<Icon name="chevron" size={13} /></button></th>
            <td><CoachStars rating={coachRating(coach)} /></td><td>{TRAINING_FOCUS_LABELS[strongest]}<small>{(coach.skills[strongest] / 2).toFixed(1)} / 5 stars</small></td><td className="staff-fee">{money(coach.fee)}</td><td className={reason ? 'staff-hiring-unavailable' : ''}>{reason ?? 'Available to hire'}</td>
          </tr>
        })}{!candidates.length && <tr><td colSpan={5} className="staff-empty">No available coaches match this search.</td></tr>}</tbody></table></div>
      </section>

      {selected && <section ref={candidateRegion} id="coach-candidate-detail" className="staff-candidate-detail panel" tabIndex={-1} aria-labelledby="coach-candidate-title" data-selected-coach={selected.id} onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented && !busy) { event.preventDefault(); event.stopPropagation(); closeCandidate() } }}>
        <header className="staff-heading"><div><h2 id="coach-candidate-title">{selected.name}</h2><span>Training coach · Season fee {money(selected.fee)}</span></div><button className="text-button" aria-label="Close coach details" onClick={closeCandidate} disabled={busy}><Icon name="close" size={14} />Close</button></header>
        <div className="staff-candidate-body"><dl className="staff-coach-skills">{TRAINING_ATTRIBUTES.map(attribute => <div key={attribute}><dt>{TRAINING_FOCUS_LABELS[attribute]}</dt><dd><CoachStars rating={selected.skills[attribute]} /></dd></div>)}</dl><div className="staff-hire-controls">
          <label htmlFor="coach-hire-focus">Initial assignment</label><select id="coach-hire-focus" value={hireFocus} onChange={event => setHireFocus(event.target.value as TrainingFocus)} disabled={busy}><FocusOptions /></select>
          <dl className="staff-hire-budget"><div><dt>Allocation now</dt><dd>{money(allocation)}</dd></div><div><dt>{allocation >= selected.fee ? 'Allocation after hiring' : 'Allocation shortfall'}</dt><dd>{money(Math.abs(allocation - selected.fee))}</dd></div>{finances && <><div><dt>Cash now</dt><dd>{money(finances.cash)}</dd></div><div><dt>{finances.cash >= selected.fee ? 'Cash after hiring' : 'Cash shortfall'}</dt><dd>{money(Math.abs(finances.cash - selected.fee))}</dd></div>{payrollEnabled && <><div><dt>Future wages reserved</dt><dd>{money(wageReserve)}</dd></div><div><dt>Spendable cash</dt><dd>{money(spendable)}</dd></div></>}</>}</dl>
          <p>Contract through this season. Renewal is selected for next season.</p>
          {hiringReason(selected) && <p id="coach-hire-reason" className="staff-hire-reason">{hiringReason(selected)}</p>}
          <button className="button primary" id="hire-coach" aria-label={`Hire ${selected.name} for ${money(selected.fee)}`} aria-describedby={hiringReason(selected) ? 'coach-hire-reason' : undefined} onClick={() => onHire(selected.id, hireFocus)} disabled={busy || !!hiringReason(selected)}>Hire for {money(selected.fee)}<Icon name="people" size={15} /></button>
        </div></div>
        <p className="staff-note">Overall averages the seven coaching skills. Focused assignments use full skill strength; Balanced uses half strength across every skill. The best applicable coach contributes up to 25% extra practice; coaches do not stack.</p>
      </section>}
      <p className="staff-save-note">Save season keeps staff changes before the next automatic checkpoint.</p>
    </>}
  </div>
}
