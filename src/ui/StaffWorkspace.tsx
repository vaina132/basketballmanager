import { YouthCoachStaff, type YouthCoachStaffProps } from './YouthCoachStaff'
import { getClubYouthCoach } from '../world/youth-policy'
import { useEffect, useRef, useState } from 'react'
import type { SeasonState } from '../domain/season'
import type { Coach } from '../domain/coaching'
import type { TrainingFocus } from '../domain/training'
import { COACHES } from '../data/development-coaches'
import { availableCoaches, coachRating, getClubCoaching, MAX_COACHES } from '../world/coaching'
import { getFinanceBalance } from '../world/finance'
import { getPayrollReserve, getSpendableCash } from '../world/payroll'
import { getTransferPaymentSummary } from '../world/transfer-payments'
import { TRAINING_ATTRIBUTES, TRAINING_FOCUSES, TRAINING_FOCUS_LABELS } from '../world/training'
import { ScoutStaff, type ScoutStaffProps } from './ScoutStaff'
import { FitnessStaff, type FitnessStaffProps } from './FitnessStaff'
import { PhysioStaff, type PhysioStaffProps } from './PhysioStaff'
import { AssistantStaff, type AssistantStaffProps } from './AssistantStaff'
import { getClubAssistant } from '../world/assistant-policy'
import { getClubPhysio } from '../world/physio-policy'
import { getClubFitnessCoach } from '../world/fitness-policy'
import { getClubScouts } from '../world/scout-policy'
import { STAFF_BUDGET, staffCommitted, remainingStaffBudget } from '../world/staff-policy'
import { StaffStars } from './StaffRating'
import { CoachPortrait } from './CoachPortrait'
import { Icon } from './Icon'
import './staff-workspace.css'

interface StaffWorkspaceProps extends ScoutStaffProps, FitnessStaffProps, PhysioStaffProps, AssistantStaffProps, YouthCoachStaffProps {
  role: 'coaches' | 'scouts' | 'fitness' | 'physio' | 'assistant' | 'youth'
  onRoleChange: (role: 'coaches' | 'scouts' | 'fitness' | 'physio' | 'assistant' | 'youth') => void
  season: SeasonState
  onEnable: () => void
  onHire: (coachId: string, focus: TrainingFocus) => void
  onRelease: (contractId: string) => void
  onAssignment: (contractId: string, focus: TrainingFocus) => void
  onRenewal: (contractId: string, renew: boolean) => void
  onOpenTraining: () => void
  busy?: boolean
}

const moneyFormatter = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const money = (cents: number) => moneyFormatter.format(cents / 100)
const coachById = (id: string) => COACHES.find(coach => coach.id === id)!
const compareNames = (left: Coach, right: Coach) => left.name.localeCompare(right.name, 'en') || left.id.localeCompare(right.id, 'en')
type CoachSort = 'rating-desc' | 'rating-asc' | 'fee-asc' | 'fee-desc'
const strongestSkills = (coach: Coach) => [...TRAINING_ATTRIBUTES].sort((left, right) => coach.skills[right] - coach.skills[left])

function CoachSkills({ coach, compact = false }: { coach: Coach; compact?: boolean }) {
  const skills = compact ? strongestSkills(coach).slice(0, 2) : TRAINING_ATTRIBUTES
  return <dl className={`staff-skill-list${compact ? ' compact' : ''}`}>{skills.map(attribute => <div key={attribute}>
    <dt>{TRAINING_FOCUS_LABELS[attribute]}</dt>
    <dd><span className="staff-skill-bar" aria-hidden="true"><span style={{ width: `${coach.skills[attribute] * 10}%` }} /></span>{compact ? <span className="staff-skill-value" aria-label={`${coach.skills[attribute] / 2} out of 5 stars`}>{(coach.skills[attribute] / 2).toFixed(1)}</span> : <StaffStars rating={coach.skills[attribute]} />}</dd>
  </div>)}</dl>
}


function FocusOptions() {
  return <>{TRAINING_FOCUSES.map(focus => <option key={focus} value={focus}>{TRAINING_FOCUS_LABELS[focus]}</option>)}</>
}

export function StaffWorkspace(props: StaffWorkspaceProps) {
  return <div className="staff-workspace"><section className="staff-role-selector panel" aria-label="Staff roles"><div className="segmented" role="group" aria-label="Choose staff role"><button id="staff-role-coaches" aria-pressed={props.role === 'coaches'} className={props.role === 'coaches' ? 'selected' : ''} onClick={() => props.onRoleChange('coaches')} disabled={props.busy}><Icon name="training" size={15} />Training coaches <span>{getClubCoaching(props.season.coaching, props.season.managedClubId).length}/3</span></button><button id="staff-role-scouts" aria-pressed={props.role === 'scouts'} className={props.role === 'scouts' ? 'selected' : ''} onClick={() => props.onRoleChange('scouts')} disabled={props.busy}><Icon name="search" size={15} />Scouts <span>{getClubScouts(props.season).length}/3</span></button><button id="staff-role-fitness" aria-pressed={props.role === 'fitness'} className={props.role === 'fitness' ? 'selected' : ''} onClick={() => props.onRoleChange('fitness')} disabled={props.busy}><Icon name="shield" size={15} />Fitness coach <span>{getClubFitnessCoach(props.season) ? 1 : 0}/1</span></button><button id="staff-role-physio" aria-pressed={props.role === 'physio'} className={props.role === 'physio' ? 'selected' : ''} onClick={() => props.onRoleChange('physio')} disabled={props.busy}><Icon name="medical" size={15} />Physio <span>{getClubPhysio(props.season) ? 1 : 0}/1</span></button><button id="staff-role-assistant" aria-pressed={props.role === 'assistant'} className={props.role === 'assistant' ? 'selected' : ''} onClick={() => props.onRoleChange('assistant')} disabled={props.busy}><Icon name="court" size={15} />Assistant coach <span>{getClubAssistant(props.season) ? 1 : 0}/1</span></button><button id="staff-role-youth" aria-pressed={props.role === 'youth'} className={props.role === 'youth' ? 'selected' : ''} onClick={() => props.onRoleChange('youth')} disabled={props.busy}><Icon name="people" size={15} />Youth coach <span>{getClubYouthCoach(props.season) ? 1 : 0}/1</span></button></div><span>Remaining staff budget <strong data-staff-role-budget={remainingStaffBudget(props.season, props.season.managedClubId)}>{money(remainingStaffBudget(props.season, props.season.managedClubId))}</strong></span></section>{props.role === 'scouts' ? <ScoutStaff {...props} /> : props.role === 'fitness' ? <FitnessStaff {...props} /> : props.role === 'physio' ? <PhysioStaff {...props} /> : props.role === 'assistant' ? <AssistantStaff {...props} /> : props.role === 'youth' ? <YouthCoachStaff {...props} /> : <TrainingStaff {...props} />}</div>
}

function TrainingStaff({ season, onEnable, onHire, onRelease, onAssignment, onRenewal, onOpenTraining, busy = false }: StaffWorkspaceProps) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<CoachSort>('rating-desc')
  const [candidatePage, setCandidatePage] = useState(0)
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
  const committed = staffCommitted(season, club.id)
  const allocation = STAFF_BUDGET - committed
  const finances = season.finance.enabledSince === null ? null : getFinanceBalance(season.finance, club.id)
  const payrollEnabled = season.payroll.enabledSince !== null
  const wageReserve = getPayrollReserve(season, club.id)
  const spendable = getSpendableCash(season, club.id)
  const overdueTransfers = getTransferPaymentSummary(season, club.id).overdue
  const staffBudget = remainingStaffBudget(season, club.id)
  const available = availableCoaches(season.coaching)
  const candidates = available.filter(coach => coach.name.toLowerCase().includes(query.trim().toLowerCase())).sort((left, right) => {
    const value = sort.startsWith('rating') ? coachRating(left) - coachRating(right) : left.fee - right.fee
    return (sort.endsWith('desc') ? -value : value) || compareNames(left, right)
  })
  const selected = available.find(coach => coach.id === selectedId) ?? null
  const candidatePages = Math.max(1, Math.ceil(candidates.length / 6))
  const visiblePage = Math.min(candidatePage, candidatePages - 1)
  const visibleCandidates = candidates.slice(visiblePage * 6, visiblePage * 6 + 6)
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
    if (season.status === 'complete') return 'Recruitment opens next season.'
    if (contracts.length >= MAX_COACHES) return 'Release a coach to open a position.'
    if (coach.fee > allocation) return `${money(coach.fee - allocation)} above the staff hiring limit.`
    if (finances && finances.unpaid > 0) return `Settle ${money(finances.unpaid)} of unpaid costs before recruiting.`
    if (overdueTransfers > 0) return `${money(overdueTransfers)} in transfer payments is overdue. Payments are collected automatically as funds become available.`
    if (finances && coach.fee > spendable) return `${money(coach.fee - spendable)} more available cash is needed.`
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

  function openCandidate(coach: Coach, trigger: HTMLButtonElement) {
    candidateTrigger.current = trigger
    if (selectedId === coach.id) { candidateRegion.current?.focus({ preventScroll: true }); candidateRegion.current?.scrollIntoView({ block: 'nearest' }) }
    else { setHireFocus('balanced'); setSelectedId(coach.id) }
  }

  return <div className="staff-workspace">
    {season.training.enabledSince === null && <section className="staff-training-alert panel" aria-label="Training status"><Icon name="training" size={20} /><span>Enable training for coaches to develop your players.</span><button className="button small" onClick={onOpenTraining} disabled={busy}>Open training<Icon name="chevron" size={14} /></button></section>}

    {!enabled ? <section className="staff-enable panel" aria-labelledby="staff-enable-title">
      <div className="staff-enable-main"><CoachPortrait coach={COACHES[0]} color={club.color} size={92} /><div><span className="staff-role">Training staff</span><h2 id="staff-enable-title">Build your coaching staff</h2><p>Three training positions. Assign specialists or balance their coverage.</p><button id="enable-coaching" className="button primary" onClick={onEnable} disabled={busy || season.status === 'complete'} aria-describedby={season.status === 'complete' ? 'coaching-enable-reason' : undefined}><Icon name="staff" size={16} />Enable coaching</button>{season.status === 'complete' && <p id="coaching-enable-reason">Start next season to enable coaching.</p>}</div></div>
      <details className="staff-explainer"><summary>Appointment terms</summary><p>{finances ? 'Enables coaching for every club. Starter appointments require enough staff budget and available cash, with no unpaid costs. Unaffordable positions stay vacant.' : 'Enables coaching for every club. Each starter coach uses part of the club staff allocation.'} Assignments affect future training weeks.</p></details>
    </section> : <>
      <section className="staff-current panel" aria-labelledby="staff-current-title">
        <header className="staff-heading"><div><h2 id="staff-current-title" ref={staffHeading} tabIndex={-1}>Coaching staff</h2><span>{club.name} · Season {season.seasonNumber}</span></div><span className="staff-slot-count"><span aria-hidden="true">{Array.from({ length: MAX_COACHES }, (_, index) => <i className={index < contracts.length ? 'filled' : ''} key={index} />)}</span>{contracts.length} / {MAX_COACHES}</span></header>
        <div className="staff-roster">{contracts.map(contract => {
          const coach = coachById(contract.coachId)
          return <article className="staff-owned-card" key={contract.id} data-contract-id={contract.id}>
            <div className="staff-owned-identity"><CoachPortrait coach={coach} color={club.color} size={80} /><div><span className="staff-role">Training coach</span><h3>{coach.name}</h3><StaffStars rating={coachRating(coach)} /><span className="staff-card-fee">{money(coach.fee)} <small>/ season</small></span></div></div>
            <CoachSkills coach={coach} compact />
            <label className="staff-assignment-control">Assignment<select data-coach-assignment={contract.id} aria-label={coach.name + ' assignment'} value={contract.focus} onChange={event => onAssignment(contract.id, event.target.value as TrainingFocus)} disabled={busy}><FocusOptions /></select></label>
            <div className="staff-contract-controls"><label className="staff-renew"><input type="checkbox" data-coach-renewal={contract.id} checked={contract.renew} onChange={event => onRenewal(contract.id, event.target.checked)} disabled={busy} aria-label={'Renew ' + coach.name + ' next season'} />Renew next season</label><button className="text-button" data-release-coach={contract.id} onClick={event => { releaseTrigger.current = event.currentTarget; setReleaseId(contract.id) }} aria-label={'Release ' + coach.name} disabled={busy}>Release</button></div>
            <details className="staff-owned-skills" data-coach-skills={contract.id}><summary aria-label={coach.name + ' coaching skills'}>Full skill profile</summary><CoachSkills coach={coach} /><small>Signed on Matchday {contract.startedRound}</small></details>
          </article>
        })}{Array.from({ length: Math.max(0, MAX_COACHES - contracts.length) }, (_, index) => <button className="staff-vacancy" key={'vacancy-' + index} onClick={() => { document.getElementById('coach-search')?.focus(); document.getElementById('staff-recruitment-title')?.scrollIntoView({ block: 'nearest' }) }} disabled={busy}><span className="staff-vacancy-image" aria-hidden="true"><Icon name="staff" size={46} /><span>+</span></span><span><strong>Vacant position</strong><small>Training coach</small><span className="staff-vacancy-action">Find a coach<Icon name="chevron" size={14} /></span></span></button>)}</div>
        {releaseContract && releaseCoach && <div ref={releaseRegion} className="staff-release-confirmation" id="coach-release-confirmation" tabIndex={-1} role="group" aria-label={'Release ' + releaseCoach.name} onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented && !busy) { event.preventDefault(); event.stopPropagation(); cancelRelease() } }}>
          <CoachPortrait coach={releaseCoach} size={42} /><div className="staff-release-copy"><strong>Release {releaseCoach.name}?</strong><p>{money(releaseCoach.fee)} remains committed.{finances && ' No refund.'}</p></div><div className="staff-release-actions"><button className="button" onClick={() => onRelease(releaseContract.id)} aria-label={'Confirm release ' + releaseCoach.name} disabled={busy}>Confirm release</button><button className="text-button" onClick={cancelRelease} disabled={busy}>Cancel</button></div>
        </div>}
        <details className="staff-explainer"><summary>How assignments work</summary><p>Focused assignments use full skill strength. Balanced uses half strength across all skills. Only the strongest applicable coach counts, adding up to 25% extra practice. Season fees are charged in full; releasing a coach does not restore the budget. Renewals are checked against the new season's staff budget{finances ? ', available cash and unpaid costs' : ''} on opening day.</p></details>
      </section>

      {released.length > 0 && <details className="staff-released panel"><summary>Released this season <span>{released.length} · {money(released.reduce((total, contract) => total + coachById(contract.coachId).fee, 0))} retained</span></summary><div className="staff-released-list">{released.map(contract => <div key={contract.id}><CoachPortrait coach={coachById(contract.coachId)} size={36} /><strong>{coachById(contract.coachId).name}</strong><span>Matchday {contract.releasedRound}</span><span>{money(coachById(contract.coachId).fee)}</span></div>)}</div></details>}

      {selected && <section ref={candidateRegion} id="coach-candidate-detail" className="staff-candidate-detail panel" tabIndex={-1} aria-labelledby="coach-candidate-title" data-selected-coach={selected.id} onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented && !busy) { event.preventDefault(); event.stopPropagation(); closeCandidate() } }}>
        <header className="staff-heading"><div><h2 id="coach-candidate-title">Recruit {selected.name}</h2><span>Training coach</span></div><button className="text-button" aria-label="Close coach details" onClick={closeCandidate} disabled={busy}><Icon name="close" size={14} />Close</button></header>
        <div className="staff-candidate-body"><div className="staff-candidate-profile"><div className="staff-profile-portrait"><CoachPortrait coach={selected} color={club.color} size={104} /><StaffStars rating={coachRating(selected)} /></div><CoachSkills coach={selected} /></div><div className="staff-hire-controls">
          <div className="staff-offer-fee"><span>Season fee</span><strong>{money(selected.fee)}</strong></div><div className="staff-after-hire"><span>{staffBudget >= selected.fee ? 'Staff budget after hire' : 'Staff budget shortfall'}</span><strong>{money(Math.abs(staffBudget - selected.fee))}</strong></div>
          <label htmlFor="coach-hire-focus">Initial assignment</label><select id="coach-hire-focus" value={hireFocus} onChange={event => setHireFocus(event.target.value as TrainingFocus)} disabled={busy}><FocusOptions /></select>
          <span className="staff-renewal-note"><Icon name="check" size={14} />Renewal selected for next season</span>
          {hiringReason(selected) && <p id="coach-hire-reason" className="staff-hire-reason">{hiringReason(selected)}</p>}
          <button className="button primary" id="hire-coach" aria-label={'Hire ' + selected.name + ' for ' + money(selected.fee)} aria-describedby={hiringReason(selected) ? 'coach-hire-reason' : undefined} onClick={() => onHire(selected.id, hireFocus)} disabled={busy || !!hiringReason(selected)}><Icon name="staff" size={16} />Hire for {money(selected.fee)}</button>
          <details className="staff-payment-details"><summary>Payment details</summary><dl><div><dt>Staff fees committed</dt><dd data-coaching-committed={committed}>{money(committed)}</dd></div><div><dt>Staff allocation remaining</dt><dd data-coaching-available={allocation}>{money(allocation)}</dd></div>{finances && <><div><dt>Club cash</dt><dd data-staff-cash={finances.cash}>{money(finances.cash)}</dd></div><div><dt>Unpaid costs</dt><dd data-staff-unpaid={finances.unpaid}>{money(finances.unpaid)}</dd></div>{payrollEnabled && <><div><dt>Wages reserved</dt><dd data-staff-reserve={wageReserve}>{money(wageReserve)}</dd></div><div><dt>Remaining budget</dt><dd data-staff-spendable={spendable}>{money(spendable)}</dd></div></>}</>}</dl><p>Full season fee, {finances ? 'paid' : 'committed'} when hired. Overall is the average of seven coaching skills.</p></details>
        </div></div>
      </section>}

      <section className="staff-recruitment panel" aria-labelledby="staff-recruitment-title">
        <header className="staff-heading"><h2 id="staff-recruitment-title">Available coaches</h2><span>{candidates.length} coaches</span></header>
        <div className="staff-recruitment-filters"><label htmlFor="coach-search"><Icon name="search" size={16} /><span className="sr-only">Find coach</span><input type="search" id="coach-search" value={query} onChange={event => { setQuery(event.target.value); setCandidatePage(0) }} disabled={busy} placeholder="Find a coach" /></label><label htmlFor="coach-sort"><span>Sort</span><select id="coach-sort" value={sort} onChange={event => { setSort(event.target.value as CoachSort); setCandidatePage(0) }} disabled={busy}><option value="rating-desc">Best overall</option><option value="rating-asc">Overall: low to high</option><option value="fee-asc">Lowest fee</option><option value="fee-desc">Highest fee</option></select></label></div>
        <div className="staff-candidate-grid">{visibleCandidates.map(coach => {
          const reason = hiringReason(coach)
          return <article className={'staff-candidate-card' + (selectedId === coach.id ? ' staff-selected-candidate' : '')} key={coach.id}>
            <button className="staff-candidate-identity" data-candidate-coach={coach.id} aria-label={'Review ' + coach.name} aria-expanded={selectedId === coach.id} aria-controls="coach-candidate-detail" onClick={event => openCandidate(coach, event.currentTarget)} disabled={busy}><CoachPortrait coach={coach} size={64} /><span><strong>{coach.name}</strong><StaffStars rating={coachRating(coach)} /><small>{TRAINING_FOCUS_LABELS[strongestSkills(coach)[0]]} specialist</small></span><Icon name="chevron" size={15} /></button>
            <CoachSkills coach={coach} compact /><div className="staff-candidate-footer"><span className="staff-card-fee">{money(coach.fee)} <small>/ season</small></span><button className={'button small' + (reason ? '' : ' primary')} onClick={event => openCandidate(coach, event.currentTarget)} aria-label={(reason ? 'Review' : 'Recruit') + ' ' + coach.name} disabled={busy}>{reason ? 'View coach' : 'Recruit'}<Icon name="chevron" size={13} /></button></div>
            {reason && <span className="staff-card-status">{contracts.length >= MAX_COACHES ? 'No vacant position' : season.status === 'complete' ? 'Recruit next season' : 'Outside current budget'}</span>}
          </article>
        })}{!candidates.length && <p className="staff-empty">No available coaches match this search.</p>}</div>
        {candidates.length > 0 && <nav className="staff-candidate-pages" aria-label="Available coaches pages"><span aria-live="polite">{visiblePage * 6 + 1}–{Math.min(visiblePage * 6 + 6, candidates.length)} of {candidates.length}</span><div><button className="button small" aria-label="Previous coaches" disabled={busy || visiblePage === 0} onClick={() => setCandidatePage(visiblePage - 1)}><Icon name="chevron" size={13} />Previous</button><span>{visiblePage + 1} / {candidatePages}</span><button className="button small" aria-label="Next coaches" disabled={busy || visiblePage === candidatePages - 1} onClick={() => setCandidatePage(visiblePage + 1)}>Next<Icon name="chevron" size={13} /></button></div></nav>}
      </section>
      <p className="staff-save-note"><Icon name="save" size={14} />Save season to keep staff changes.</p>
    </>}
  </div>
}
