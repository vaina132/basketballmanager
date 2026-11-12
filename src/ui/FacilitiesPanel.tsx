import { useEffect, useRef, useState } from 'react'
import type { ClubFacilities, FacilityProject, FacilityType } from '../domain/facilities'
import type { SeasonState } from '../domain/season'
import { FACILITY_AUTOMATION_BUFFER, FACILITY_CONSTRUCTION_CAPACITY_PERCENT, FACILITY_FUNDS_REASON, getClubFacilities } from '../world/facilities-policy'
import { BOARD_FUNDING_REFUSAL_COOLDOWN, quoteBoardFunding, type BoardFundingQuote } from '../world/board-funding-policy'
import { focusWhenReady } from './focus-when-ready'
import { Icon, type IconName } from './Icon'
import { scoutingDate } from './ScoutingKnowledge'
import './facilities-panel.css'

export interface FacilitiesActions {
  onEnableFacilities: () => void
  onFacilityUpgrade: (type: FacilityType) => void
  onCancelFacilityUpgrade: (projectId: string) => void
  onFacilityDelegation: (delegated: boolean) => void
  onRequestBoardFunding: (type: FacilityType) => void
}

export const FACILITY_LABELS: Record<FacilityType, string> = { arena: 'Arena', training: 'Training facilities', youth: 'Youth infrastructure' }
const icons: Record<FacilityType, IconName> = { arena: 'building', training: 'training', youth: 'people' }
const money = (amount: number) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(amount / 100)
const seats = (amount: number) => `${amount.toLocaleString('en-GB')} seats`
const daysBetween = (from: string, to: string) => Math.max(0, Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000))
const benefit = (type: FacilityType, bonus: number, capacity: number) => type === 'arena' ? seats(capacity) : bonus > 0 ? `+${bonus}% ${type === 'training' ? 'senior' : 'academy'} practice` : `Standard ${type === 'training' ? 'senior' : 'academy'} practice`

function LevelBar({ level, maximum, name }: { level: number; maximum: number; name: string }) {
  return <span className="facility-level" role="img" aria-label={`${name}: level ${level} of ${maximum}`}><span aria-hidden="true">{Array.from({ length: maximum }, (_, index) => <i key={index} className={index < level ? 'filled' : ''} />)}</span><b aria-hidden="true">{level} / {maximum}</b></span>
}

export function FacilityBoardFunding({ quote, enabled, busy, onRequest }: { quote: BoardFundingQuote; enabled: boolean; busy: boolean; onRequest: () => void }) {
  if (!enabled) return <section className="facility-board" data-board-funding="off" aria-labelledby="facility-board-title"><h4 id="facility-board-title"><Icon name="shield" size={15} />Ask the board</h4><p>Board funding requests are off in this career. You can turn them on under Club › Board.</p></section>
  const outlook = !quote.eligible ? quote.reason : quote.approved ? 'On these figures the board approves. Its capital is recorded and construction starts at once.' : `${quote.refusal} If the board refuses, you can ask again after ${BOARD_FUNDING_REFUSAL_COOLDOWN} matchdays.`
  return <section className="facility-board" data-board-funding={!quote.eligible ? 'unavailable' : quote.approved ? 'approve' : 'refuse'} aria-labelledby="facility-board-title">
    <h4 id="facility-board-title"><Icon name="shield" size={15} />Ask the board</h4>
    <dl className="facility-review-facts"><div><dt>Capital requested</dt><dd data-board-amount={quote.amount}>{money(quote.amount)}<small>{money(quote.cost)} cost − {money(quote.available)} available</small></dd></div><div><dt>Board confidence</dt><dd data-board-confidence-now={quote.confidence}>{quote.confidence} / 100<small>{quote.president.name} needs {quote.requiredConfidence}</small></dd></div><div><dt>Owner capital left this season</dt><dd data-board-capital-left={quote.capitalRemaining}>{money(quote.capitalRemaining)}<small>of {money(quote.seasonCapital)}</small></dd></div></dl>
    <footer><span id="facility-board-reason" role="status">{outlook}</span><button id="facility-board-request" className="button" disabled={busy || !quote.eligible} onClick={onRequest} aria-describedby="facility-board-reason"><Icon name="shield" size={15} />Ask for {money(quote.amount)}</button></footer>
  </section>
}

function UpgradeReview({ row, board, fundingEnabled, busy, onConfirm, onRequestBoard, onClose }: { row: ClubFacilities['rows'][number]; board: BoardFundingQuote | null; fundingEnabled: boolean; busy: boolean; onConfirm: () => void; onRequestBoard: () => void; onClose: () => void }) {
  const region = useRef<HTMLElement>(null)
  const quote = row.quote
  useEffect(() => { region.current?.focus({ preventScroll: true }); region.current?.scrollIntoView({ block: 'nearest' }) }, [])
  return <section ref={region} id="facility-upgrade-review" className="facility-review" tabIndex={-1} aria-labelledby="facility-upgrade-title" onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.preventDefault(); onClose() } }}>
    <header><div><h3 id="facility-upgrade-title">Upgrade {FACILITY_LABELS[row.type].toLowerCase()}</h3><span>Level {quote.fromLevel} → {quote.toLevel}</span></div><button className="text-button" onClick={onClose} disabled={busy}><Icon name="close" size={14} />Close</button></header>
    <dl className="facility-review-facts"><div><dt>Cost paid now</dt><dd data-facility-cost={quote.cost}>{money(quote.cost)}</dd></div><div><dt>Remaining budget after approval</dt><dd data-facility-budget-after={quote.remainingBudgetAfter}>{money(quote.remainingBudgetAfter)}</dd></div><div><dt>Planned completion</dt><dd><time dateTime={quote.dueOn}>{scoutingDate(quote.dueOn)}</time><small>{quote.durationDays} days</small></dd></div><div><dt>After completion</dt><dd>{benefit(row.type, quote.bonusAfter, quote.capacityAfter)}</dd></div><div><dt>Facility upkeep / matchday</dt><dd>{money(row.upkeepPerRound)} → {money(quote.upkeepAfter)}</dd></div><div><dt>Total facilities upkeep / matchday</dt><dd>{money(quote.totalUpkeepAfter)}</dd></div></dl>
    {row.type === 'arena' && <p className="facility-disruption"><Icon name="building" size={16} />Construction closes {100 - FACILITY_CONSTRUCTION_CAPACITY_PERCENT}% of seats for future matchdays. The current prepared matchday stays unchanged.</p>}
    <details className="facility-review-details"><summary>Funding &amp; timing</summary><p>The full cost is paid from Remaining budget when approved. When the board funds the shortfall, its capital is added first and the full cost is then paid. Cancelling does not return money already spent. One upgrade can run at a time.</p><p>Completion is applied when the game date advances. The displayed date is the earliest planned finish; the next calendar step may fall later. Upkeep is charged with senior matchday operations after completion.</p>{row.type === 'arena' && <p>Extra seats increase capacity. Attendance still depends on demand and ticket price.</p>}</details>
    {board && <FacilityBoardFunding quote={board} enabled={fundingEnabled} busy={busy} onRequest={onRequestBoard} />}
    <footer><span id="facility-upgrade-reason" role="status">{quote.reason ?? 'Approve this fully funded upgrade.'}</span><button id="facility-upgrade-confirm" className="button primary" disabled={busy || !quote.canStart} onClick={onConfirm} aria-describedby="facility-upgrade-reason"><Icon name="building" size={15} />Start upgrade</button></footer>
  </section>
}

function CancellationReview({ project, automatic, busy, onConfirm, onClose }: { project: FacilityProject; automatic: boolean; busy: boolean; onConfirm: () => void; onClose: () => void }) {
  const region = useRef<HTMLElement>(null)
  useEffect(() => { region.current?.focus({ preventScroll: true }); region.current?.scrollIntoView({ block: 'nearest' }) }, [])
  return <section ref={region} id="facility-cancel-review" className="facility-review facility-cancel-review" tabIndex={-1} aria-labelledby="facility-cancel-title" onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.preventDefault(); onClose() } }}><header><div><h3 id="facility-cancel-title">Cancel {FACILITY_LABELS[project.type].toLowerCase()} upgrade?</h3><span>Level {project.fromLevel} → {project.toLevel}</span></div><button className="text-button" onClick={onClose} disabled={busy}><Icon name="close" size={14} />Close</button></header><p className="facility-cancel-copy">Construction stops. The {money(project.cost)} already paid is not refunded, and the facility stays at level {project.fromLevel}.{automatic && <> Automatic control is still on and may fund another project when the calendar advances. Select Manual to stop future automatic upgrades.</>}</p><footer><button className="button" onClick={onClose} disabled={busy}>Keep building</button><button id="facility-cancel-confirm" className="button" onClick={onConfirm} disabled={busy}>Cancel upgrade</button></footer></section>
}

export function FacilitiesPanel({ season, busy = false, onEnableFacilities, onFacilityUpgrade, onCancelFacilityUpgrade, onFacilityDelegation, onRequestBoardFunding }: FacilitiesActions & { season: SeasonState; busy?: boolean }) {
  const facilities = getClubFacilities(season)
  const [reviewType, setReviewType] = useState<FacilityType | null>(null)
  const [cancelId, setCancelId] = useState<string | null>(null)
  const review = facilities.rows.find(row => row.type === reviewType)
  // Board capital is offered only when money is the one thing stopping the upgrade.
  const board = review?.quote.reason === FACILITY_FUNDS_REASON ? quoteBoardFunding(season, review.type) : null
  const project = facilities.rows.find(row => row.project)?.project ?? null
  const cancelling = project?.id === cancelId ? project : null
  const history = [...season.facilities.projects].reverse().filter(item => item.clubId === season.managedClubId && (item.completedOn || item.cancelledOn))
  const enableReason = !season.finance.enabledSince ? 'Enable club finances first.' : null
  const elapsed = project ? Math.min(daysBetween(project.startedOn, season.date), daysBetween(project.startedOn, project.dueOn)) : 0
  const duration = project ? Math.max(1, daysBetween(project.startedOn, project.dueOn)) : 1
  function closeReview() { const type = reviewType; setReviewType(null); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-facility-upgrade="${type}"]`)?.focus({ preventScroll: true })) }
  function closeCancel() { setCancelId(null); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('#facility-cancel-open')?.focus({ preventScroll: true })) }
  return <section className="facilities-panel panel" aria-labelledby="facilities-title">
    <header className="club-heading"><h2 id="facilities-title"><Icon name="building" size={18} />Facilities</h2>{facilities.enabled && <div className="facility-delegation"><label htmlFor="facility-control">Control</label><input id="facility-control" type="range" min={0} max={1} step={1} value={facilities.delegated ? 1 : 0} aria-valuetext={facilities.delegated ? 'Automatic' : 'Manual'} aria-describedby="facility-automatic-help" onChange={event => onFacilityDelegation(event.target.value === '1')} disabled={busy} /><output htmlFor="facility-control">{facilities.delegated ? 'Automatic' : 'Manual'}</output></div>}</header>
    {!facilities.enabled ? <div className="facility-enable"><Icon name="building" size={26} /><div><strong>Manage your club facilities</strong><p>Fund arena, training and youth infrastructure upgrades. Choose manual or automatic control.</p>{enableReason && <p id="facility-enable-reason">{enableReason}</p>}</div><button id="enable-facilities" className="button" onClick={onEnableFacilities} disabled={busy || !!enableReason} aria-describedby={enableReason ? 'facility-enable-reason' : undefined}>Enable facilities</button></div> : <>
      <p className="facility-automatic-note" id="facility-automatic-help">Automatic can start an upgrade now, keeping at least {money(FACILITY_AUTOMATION_BUFFER)} available.</p><div className="facility-rows">{facilities.rows.map(row => <div className="facility-row" key={row.type} data-facility={row.type}><span className="facility-icon" aria-hidden="true"><Icon name={icons[row.type]} size={23} /></span><div className="facility-identity"><h3>{FACILITY_LABELS[row.type]}</h3><span>{benefit(row.type, row.bonusPercent, row.capacity)}</span>{row.type === 'arena' && facilities.arenaCapacity !== row.capacity && <small>{seats(facilities.arenaCapacity)} available this matchday</small>}</div><div className="facility-level-wrap"><LevelBar level={row.level} maximum={row.maxLevel} name={FACILITY_LABELS[row.type]} /><small title="Extra upkeep from completed upgrades. Standard facilities are covered by club operating costs.">{money(row.upkeepPerRound)} / matchday upkeep</small></div>{row.project ? <span className="facility-building"><Icon name="clock" size={15} />Upgrading</span> : row.level === row.maxLevel ? <span className="facility-building"><Icon name="check" size={15} />Fully upgraded</span> : <button className="button small" data-facility-upgrade={row.type} onClick={() => { setCancelId(null); setReviewType(row.type) }} disabled={busy} aria-expanded={reviewType === row.type} aria-controls="facility-upgrade-review">Upgrade<Icon name="chevron" size={13} /></button>}</div>)}</div>
      {project && <div className="facility-project" data-facility-project={project.id} tabIndex={-1}><div><strong>{FACILITY_LABELS[project.type]} · Level {project.toLevel}</strong><span>Planned completion <time dateTime={project.dueOn}>{scoutingDate(project.dueOn)}</time></span></div><div className="facility-project-progress"><progress value={elapsed} max={duration} aria-label={`${FACILITY_LABELS[project.type]} construction: ${elapsed} of ${duration} planned days elapsed`} /><small>{elapsed} / {duration} days · {money(project.cost)} paid</small></div><button id="facility-cancel-open" className="text-button" onClick={() => { setReviewType(null); setCancelId(project.id) }} disabled={busy}>Cancel upgrade</button></div>}
      {review && <UpgradeReview key={review.type} row={review} board={board} fundingEnabled={!!season.facilities.fundingSince} busy={busy} onClose={closeReview} onConfirm={() => { onFacilityUpgrade(review.type); setReviewType(null); focusWhenReady('[data-facility-project]') }} onRequestBoard={() => {
        // An approval starts construction and closes the review; a refusal keeps it open with the board's answer.
        const approved = board?.approved
        onRequestBoardFunding(review.type)
        if (approved) { setReviewType(null); focusWhenReady('[data-facility-project]') } else focusWhenReady('#facility-upgrade-review')
      }} />}
      {cancelling && <CancellationReview key={cancelling.id} project={cancelling} automatic={facilities.delegated} busy={busy} onClose={closeCancel} onConfirm={() => { onCancelFacilityUpgrade(cancelling.id); setCancelId(null); focusWhenReady(`[data-facility-upgrade="${cancelling.type}"]`) }} />}
      <details className="facility-rules"><summary><Icon name="settings" size={14} />Control &amp; effects{history.length > 0 ? ' · Upgrade history' : ''}</summary><p>Automatic control starts with the cheapest eligible upgrade, checks again as the calendar advances, and keeps at least {money(FACILITY_AUTOMATION_BUFFER)} available after approval. Existing salary and transfer reservations still apply. Manual control lets you choose when to invest.</p><p>Training and youth infrastructure improve medically eligible practice; the weekly reports retain the effect used. Arena work affects future prepared crowds. Upkeep shown here is the extra cost of completed upgrades; standard facilities are covered by club operating costs.</p>{history.length > 0 && <ul className="facility-history">{history.map(item => <li key={item.id} data-facility-history={item.id}><span><strong>{FACILITY_LABELS[item.type]} · Level {item.toLevel}</strong><small>{item.completedOn ? `Completed ${scoutingDate(item.completedOn)}` : `Cancelled ${scoutingDate(item.cancelledOn!)}`}</small></span><span>{money(item.cost)}{item.cancelledOn && <small>No refund</small>}</span></li>)}</ul>}</details>
    </>}
  </section>
}
