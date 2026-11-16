import { useEffect, useRef, useState } from 'react'
import type { ClubFacilities, FacilityProject, FacilityType, MaintenancePlan } from '../domain/facilities'
import type { SeasonState } from '../domain/season'
import { conditionEffectPercent, facilityAutomationBuffer, FACILITY_CONSTRUCTION_CAPACITY_PERCENT, FACILITY_FUNDS_REASON, FACILITY_RECOVERY_PER_MATCHDAY, FACILITY_REDUCED_UPKEEP_PERCENT, FACILITY_REPAIR_FUNDS_REASON, FACILITY_RULES_2, FACILITY_WEAR_PER_MATCHDAY, getClubFacilities } from '../world/facilities-policy'
import { quoteBoardFunding, type BoardFundingQuote } from '../world/board-funding-policy'
import { usesFacilityFinancing } from '../world/facility-debt'
import { facilityProjectSchedule, type FacilityProjectSchedule } from '../world/facility-schedule'
import { FacilityFinancing } from './FacilityFinancing'
import { focusWhenReady } from './focus-when-ready'
import { Icon, type IconName } from './Icon'
import { scoutingDate } from './ScoutingKnowledge'
import './facilities-panel.css'
import { formatEuros } from './money-format'

export interface FacilitiesActions {
  onEnableFacilities: () => void
  onFacilityUpgrade: (type: FacilityType) => void
  onCancelFacilityUpgrade: (projectId: string) => void
  onFacilityDelegation: (delegated: boolean) => void
  onRequestBoardFunding: (type: FacilityType, project?: 'upgrade' | 'repair') => void
  onEnableMaintenance: () => void
  onMaintenancePlan: (plan: MaintenancePlan) => void
  /** Format 65 (`facilities-2`): commission a repair. */
  onFacilityRepair?: (type: FacilityType) => void
  /** Format 71 (`loans-1`): pay for an upgrade or repair with a bank loan, or lease the next arena or training level. */
  onFacilityLoan?: (type: FacilityType, project: 'upgrade' | 'repair', seasons: number, principal: number) => void
  onFacilityLease?: (type: FacilityType, seasons: number) => void
  /** Format 71: repay a loan early, or end a lease early (Club page). */
  onRepayLoan?: (debtId: string) => void
  onEndLease?: (debtId: string) => void
}

export const conditionLabel = (condition: number) => condition >= 80 ? 'Good' : condition >= 50 ? 'Worn' : 'Poor'

export const FACILITY_LABELS: Record<FacilityType, string> = { arena: 'Arena', training: 'Training facilities', youth: 'Youth infrastructure', medical: 'Medical centre', scouting: 'Scouting office' }
const icons: Record<FacilityType, IconName> = { arena: 'building', training: 'training', youth: 'people', medical: 'medical', scouting: 'search' }
const money = (amount: number) => formatEuros(amount)
const seats = (amount: number) => `${amount.toLocaleString('en-GB')} seats`
const weekdays = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' })
/** Completion days carry the weekday ("Sat 26 Sept 2026"): during a season they are always a week's Saturday. */
export const facilityFinishDate = (date: string) => `${weekdays.format(new Date(`${date}T00:00:00Z`))} ${scoutingDate(date)}`
const weeks = (count: number) => `${count} ${count === 1 ? 'week' : 'weeks'}`
/** Owner feedback (11): the time a project in progress still needs, in the calendar's weeks. */
export function facilityWeeksLeft(schedule: FacilityProjectSchedule): string {
  if (schedule.inSeason) return schedule.weeksLeft === 0 ? 'Finishing now' : `${weeks(schedule.weeksLeft)} left`
  return schedule.weeksLeft === 0 ? 'Due at the next calendar step' : `At least ${weeks(schedule.weeksLeft)} left`
}
/** The planned finish of a quoted upgrade or repair that would start today. */
function PlannedCompletion({ season, dueOn }: { season: SeasonState; dueOn: string }) {
  const schedule = facilityProjectSchedule(season, { startedOn: season.date, dueOn })
  return <div><dt>{schedule.inSeason ? 'Planned completion' : 'Earliest completion'}</dt><dd><time dateTime={schedule.completesOn}>{facilityFinishDate(schedule.completesOn)}</time><small>{weeks(schedule.weeksLeft)}{schedule.inSeason ? '' : ', after the season'}</small></dd></div>
}
function benefit(type: FacilityType, bonus: number, capacity: number): string {
  if (type === 'arena') return seats(capacity)
  if (type === 'medical') return bonus > 0 ? `${bonus}% shorter injury recovery` : 'Standard medical care'
  if (type === 'scouting') return bonus > 0 ? `+${bonus}% scouting evidence` : 'Standard scouting office'
  return bonus > 0 ? `+${bonus}% ${type === 'training' ? 'senior' : 'academy'} practice` : `Standard ${type === 'training' ? 'senior' : 'academy'} practice`
}
/** Whether a row shows a condition: upgraded facilities with upkeep choices (older careers), or every upgraded facility and the arena. */
const showsCondition = (facilities: ClubFacilities, row: ClubFacilities['rows'][number]) => facilities.model === 'facilities-2' ? row.type === 'arena' || row.level > 1 : facilities.maintenance.enabled && row.level > 1
const projectLabel = (project: FacilityProject) => project.kind === 'repair' ? `${FACILITY_LABELS[project.type]} · Repair` : project.kind === 'lease' ? `${FACILITY_LABELS[project.type]} · Leased level ${project.toLevel}` : `${FACILITY_LABELS[project.type]} · Level ${project.toLevel}`

function LevelBar({ level, maximum, name }: { level: number; maximum: number; name: string }) {
  return <span className="facility-level" role="img" aria-label={`${name}: level ${level} of ${maximum}`}><span aria-hidden="true">{Array.from({ length: maximum }, (_, index) => <i key={index} className={index < level ? 'filled' : ''} />)}</span><b aria-hidden="true">{level} / {maximum}</b></span>
}

export function FacilityBoardFunding({ quote, enabled, busy, onRequest }: { quote: BoardFundingQuote; enabled: boolean; busy: boolean; onRequest: () => void }) {
  if (!enabled) return <section className="facility-board" data-board-funding="off" aria-labelledby="facility-board-title"><h4 id="facility-board-title"><Icon name="shield" size={15} />Ask the board</h4><p>Board funding requests are off in this career. You can turn them on under Club › Board.</p></section>
  const work = quote.project === 'repair' ? 'the repair' : 'construction'
  const outlook = !quote.eligible ? quote.reason : quote.approved ? `On these figures the board approves. Its capital is recorded and ${work} starts at once.` : `${quote.refusal} If the board refuses, you can ask again after ${quote.cooldown} ${quote.cooldown === 1 ? 'matchday' : 'matchdays'}.`
  return <section className="facility-board" data-board-funding={!quote.eligible ? 'unavailable' : quote.approved ? 'approve' : 'refuse'} aria-labelledby="facility-board-title">
    <h4 id="facility-board-title"><Icon name="shield" size={15} />Ask the board</h4>
    <dl className="facility-review-facts"><div><dt>Capital requested</dt><dd data-board-amount={quote.amount}>{money(quote.amount)}<small>{money(quote.cost)} cost − {money(quote.available)} available</small></dd></div><div><dt>Board confidence</dt><dd data-board-confidence-now={quote.confidence}>{quote.confidence} / 100<small>{quote.president.name} needs {quote.requiredConfidence}</small></dd></div><div><dt>Owner capital left this season</dt><dd data-board-capital-left={quote.capitalRemaining}>{money(quote.capitalRemaining)}<small>of {money(quote.seasonCapital)}</small></dd></div></dl>
    <footer><span id="facility-board-reason" role="status">{outlook}</span><button id="facility-board-request" className="button" disabled={busy || !quote.eligible} onClick={onRequest} aria-describedby="facility-board-reason"><Icon name="shield" size={15} />Ask for {money(quote.amount)}</button></footer>
  </section>
}

function UpgradeReview({ season, row, board, fundingEnabled, busy, onConfirm, onRequestBoard, onClose, onLoan, onLease }: { season: SeasonState; row: ClubFacilities['rows'][number]; board: BoardFundingQuote | null; fundingEnabled: boolean; busy: boolean; onConfirm: () => void; onRequestBoard: () => void; onClose: () => void; onLoan?: (seasons: number, principal: number) => void; onLease?: (seasons: number) => void }) {
  const region = useRef<HTMLElement>(null)
  const quote = row.quote
  // Format 71: careers with facility financing choose how to pay; older careers pay upfront.
  const financed = usesFacilityFinancing(season.facilities) && !!onLoan
  const footer = <footer><span id="facility-upgrade-reason" role="status">{quote.reason ?? 'Approve this fully funded upgrade.'}</span><button id="facility-upgrade-confirm" className="button primary" disabled={busy || !quote.canStart} onClick={onConfirm} aria-describedby="facility-upgrade-reason"><Icon name="building" size={15} />Start upgrade</button></footer>
  const boardBlock = board && <FacilityBoardFunding quote={board} enabled={fundingEnabled} busy={busy} onRequest={onRequestBoard} />
  useEffect(() => { region.current?.focus({ preventScroll: true }); region.current?.scrollIntoView({ block: 'nearest' }) }, [])
  return <section ref={region} id="facility-upgrade-review" className="facility-review" tabIndex={-1} aria-labelledby="facility-upgrade-title" onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.preventDefault(); onClose() } }}>
    <header><div><h3 id="facility-upgrade-title">Upgrade {FACILITY_LABELS[row.type].toLowerCase()}</h3><span>Level {quote.fromLevel} → {quote.toLevel}</span></div><button className="text-button" onClick={onClose} disabled={busy}><Icon name="close" size={14} />Close</button></header>
    <dl className="facility-review-facts"><div><dt>{financed ? 'Cost' : 'Cost paid now'}</dt><dd data-facility-cost={quote.cost}>{money(quote.cost)}</dd></div><div><dt>{financed ? 'Remaining budget after paying now' : 'Remaining budget after approval'}</dt><dd data-facility-budget-after={quote.remainingBudgetAfter}>{money(quote.remainingBudgetAfter)}</dd></div><PlannedCompletion season={season} dueOn={quote.dueOn} /><div><dt>After completion</dt><dd>{benefit(row.type, quote.bonusAfter, quote.capacityAfter)}</dd></div><div><dt>Facility upkeep / matchday</dt><dd>{money(row.upkeepPerRound)} → {money(quote.upkeepAfter)}</dd></div><div><dt>Total facilities upkeep / matchday</dt><dd>{money(quote.totalUpkeepAfter)}</dd></div></dl>
    {row.type === 'arena' && <p className="facility-disruption"><Icon name="building" size={16} />Construction closes {100 - FACILITY_CONSTRUCTION_CAPACITY_PERCENT}% of seats for future matchdays. The current prepared matchday stays unchanged.</p>}
    <details className="facility-review-details"><summary>Funding &amp; timing</summary><p>The full cost is paid from Remaining budget when approved. When the board funds the shortfall, its capital is added first and the full cost is then paid. Cancelling does not return money already spent. {row.repair ? 'One project (upgrade or repair) can run at a time.' : 'One upgrade can run at a time.'}</p><p>During the season, work finishes on the Saturday shown, when the calendar reaches that week. Work still running after the season's last week finishes at the first offseason calendar step from its planned day, or on next season's opening day. Upkeep is charged with senior matchday operations after completion.{row.repair ? ' A completed upgrade starts in full condition.' : ''}</p>{row.type === 'arena' && <p>Extra seats increase capacity. Attendance still depends on demand and ticket price.</p>}{financed && <p>Instead of paying now, a bank loan can pay for it and arena or training levels can be leased; How to pay shows each option's full cost.</p>}</details>
    {financed ? <FacilityFinancing season={season} type={row.type} project="upgrade" cashAvailable={quote.canStart} cashFooter={footer} board={board} boardBlock={boardBlock} busy={busy} onLoan={onLoan!} onLease={onLease} /> : <>{boardBlock}{footer}</>}
  </section>
}

/** Format 65: the terms of restoring one facility's condition, with board capital when money is the only obstacle. */
function RepairReview({ season, row, board, fundingEnabled, busy, onConfirm, onRequestBoard, onClose, onLoan }: { season: SeasonState; row: ClubFacilities['rows'][number]; board: BoardFundingQuote | null; fundingEnabled: boolean; busy: boolean; onConfirm: () => void; onRequestBoard: () => void; onClose: () => void; onLoan?: (seasons: number, principal: number) => void }) {
  const region = useRef<HTMLElement>(null)
  const quote = row.repair!
  const financed = usesFacilityFinancing(season.facilities) && !!onLoan
  const footer = <footer><span id="facility-repair-reason" role="status">{quote.reason ?? 'Approve this fully funded repair.'}</span><button id="facility-repair-confirm" className="button primary" disabled={busy || !quote.canStart} onClick={onConfirm} aria-describedby="facility-repair-reason"><Icon name="settings" size={15} />Start repair</button></footer>
  const boardBlock = board && <FacilityBoardFunding quote={board} enabled={fundingEnabled} busy={busy} onRequest={onRequestBoard} />
  useEffect(() => { region.current?.focus({ preventScroll: true }); region.current?.scrollIntoView({ block: 'nearest' }) }, [])
  return <section ref={region} id="facility-repair-review" className="facility-review" tabIndex={-1} aria-labelledby="facility-repair-title" onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.preventDefault(); onClose() } }}>
    <header><div><h3 id="facility-repair-title">Repair {FACILITY_LABELS[row.type].toLowerCase()}</h3><span>Condition {quote.conditionBefore} → 100</span></div><button className="text-button" onClick={onClose} disabled={busy}><Icon name="close" size={14} />Close</button></header>
    <dl className="facility-review-facts"><div><dt>{financed ? 'Cost' : 'Cost paid now'}</dt><dd data-facility-repair-cost={quote.cost}>{money(quote.cost)}</dd></div><div><dt>Remaining budget after approval</dt><dd data-facility-repair-budget-after={quote.remainingBudgetAfter}>{money(quote.remainingBudgetAfter)}</dd></div><PlannedCompletion season={season} dueOn={quote.dueOn} /><div><dt>Effect</dt><dd>{row.effectPercent}% → 100%<small>of the level {quote.level} benefit</small></dd></div></dl>
    {row.type === 'arena' && <p className="facility-disruption"><Icon name="building" size={16} />Repairs close {100 - FACILITY_CONSTRUCTION_CAPACITY_PERCENT}% of seats for future matchdays. The current prepared matchday stays unchanged.</p>}
    <details className="facility-review-details"><summary>Funding &amp; timing</summary><p>The full cost is paid from Remaining budget when approved; the board can fund a shortfall. Cancelling does not return money already spent, and the facility keeps wearing until the repair is complete. One project (upgrade or repair) can run at a time.</p><p>Repairs take {FACILITY_RULES_2.repairDaysPerQuarter} days for every 25 condition points restored, and the cost grows with the points restored and the facility's level.</p>{financed && <p>Instead of paying now, a bank loan can pay for the repair; How to pay shows its full cost.</p>}</details>
    {financed ? <FacilityFinancing season={season} type={row.type} project="repair" cashAvailable={quote.canStart} cashFooter={footer} board={board} boardBlock={boardBlock} busy={busy} onLoan={onLoan!} /> : <>{boardBlock}{footer}</>}
  </section>
}

function CancellationReview({ project, automatic, busy, onConfirm, onClose }: { project: FacilityProject; automatic: boolean; busy: boolean; onConfirm: () => void; onClose: () => void }) {
  const region = useRef<HTMLElement>(null)
  const repair = project.kind === 'repair'
  useEffect(() => { region.current?.focus({ preventScroll: true }); region.current?.scrollIntoView({ block: 'nearest' }) }, [])
  return <section ref={region} id="facility-cancel-review" className="facility-review facility-cancel-review" tabIndex={-1} aria-labelledby="facility-cancel-title" onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.preventDefault(); onClose() } }}><header><div><h3 id="facility-cancel-title">Cancel {FACILITY_LABELS[project.type].toLowerCase()} {repair ? 'repair' : 'upgrade'}?</h3><span>{repair ? `Condition ${project.conditionBefore} → 100` : `Level ${project.fromLevel} → ${project.toLevel}`}</span></div><button className="text-button" onClick={onClose} disabled={busy}><Icon name="close" size={14} />Close</button></header><p className="facility-cancel-copy">{repair ? 'Work stops.' : 'Construction stops.'} The {money(project.cost)} already paid is not refunded, and {repair ? 'the facility keeps its current condition.' : `the facility stays at level ${project.fromLevel}.`}{automatic && <> Automatic control is still on and may fund another project when the calendar advances. Select Manual to stop future automatic {repair ? 'projects' : 'upgrades'}.</>}</p><footer><button className="button" onClick={onClose} disabled={busy}>{repair ? 'Keep repairing' : 'Keep building'}</button><button id="facility-cancel-confirm" className="button" onClick={onConfirm} disabled={busy}>{repair ? 'Cancel repair' : 'Cancel upgrade'}</button></footer></section>
}

export function FacilitiesPanel({ season, busy = false, onEnableFacilities, onFacilityUpgrade, onCancelFacilityUpgrade, onFacilityDelegation, onRequestBoardFunding, onEnableMaintenance, onMaintenancePlan, onFacilityRepair, onFacilityLoan, onFacilityLease }: FacilitiesActions & { season: SeasonState; busy?: boolean }) {
  const facilities = getClubFacilities(season)
  const repairs = facilities.model === 'facilities-2'
  const [reviewType, setReviewType] = useState<FacilityType | null>(null)
  const [repairType, setRepairType] = useState<FacilityType | null>(null)
  const [cancelId, setCancelId] = useState<string | null>(null)
  const review = facilities.rows.find(row => row.type === reviewType)
  const repairReview = facilities.rows.find(row => row.type === repairType && row.repair)
  // Board capital is offered only when money is the one thing stopping the upgrade or repair.
  const board = review?.quote.reason === FACILITY_FUNDS_REASON ? quoteBoardFunding(season, review.type) : null
  const repairBoard = repairReview?.repair?.reason === FACILITY_REPAIR_FUNDS_REASON ? quoteBoardFunding(season, repairReview.type, season.managedClubId, 'manager', 'repair') : null
  const project = facilities.rows.find(row => row.project)?.project ?? null
  const cancelling = project?.id === cancelId ? project : null
  const history = [...season.facilities.projects].reverse().filter(item => item.clubId === season.managedClubId && (item.completedOn || item.cancelledOn))
  const enableReason = !season.finance.enabledSince ? 'Enable club finances first.' : null
  // Leases are installed for the next matchday; upgrades and repairs show the weeks left and the finish day.
  const schedule = project && project.kind !== 'lease' ? facilityProjectSchedule(season, project) : null
  const weeksDone = schedule ? Math.max(0, schedule.weeksTotal - schedule.weeksLeft) : 0
  function closeReview() { const type = reviewType; setReviewType(null); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-facility-upgrade="${type}"]`)?.focus({ preventScroll: true })) }
  function closeRepair() { const type = repairType; setRepairType(null); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-facility-repair="${type}"]`)?.focus({ preventScroll: true })) }
  function closeCancel() { setCancelId(null); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('#facility-cancel-open')?.focus({ preventScroll: true })) }
  const upkeepHelp = repairs
    ? `${facilities.delegated ? 'Automatic control also sets upkeep: reduced only while commitments exceed cash or costs are unpaid. ' : ''}Reduced upkeep costs ${FACILITY_REDUCED_UPKEEP_PERCENT}% and upgraded facilities wear ${FACILITY_RULES_2.reducedUpkeepWear} times as fast. Only a repair restores condition.${facilities.maintenance.chosen !== facilities.maintenance.current ? ` ${facilities.maintenance.chosen === 'reduced' ? 'Reduced' : 'Full'} upkeep starts with the next matchday.` : ''}`
    : `${facilities.delegated ? 'Automatic control also sets upkeep: reduced only while commitments exceed cash or costs are unpaid. ' : ''}Reduced upkeep costs ${FACILITY_REDUCED_UPKEEP_PERCENT}% and upgraded facilities lose ${FACILITY_WEAR_PER_MATCHDAY} condition per matchday, shrinking their benefit; full upkeep restores ${FACILITY_RECOVERY_PER_MATCHDAY} per matchday.${facilities.maintenance.chosen !== facilities.maintenance.current ? ` ${facilities.maintenance.chosen === 'reduced' ? 'Reduced' : 'Full'} upkeep starts with the next matchday.` : ''}`
  return <section className="facilities-panel panel" aria-labelledby="facilities-title">
    <header className="club-heading"><h2 id="facilities-title"><Icon name="building" size={18} />Facilities</h2>{facilities.enabled && <div className="facility-delegation"><label htmlFor="facility-control">Control</label><input id="facility-control" type="range" min={0} max={1} step={1} value={facilities.delegated ? 1 : 0} aria-valuetext={facilities.delegated ? 'Automatic' : 'Manual'} aria-describedby="facility-automatic-help" onChange={event => onFacilityDelegation(event.target.value === '1')} disabled={busy} /><output htmlFor="facility-control">{facilities.delegated ? 'Automatic' : 'Manual'}</output></div>}{facilities.enabled && facilities.maintenance.enabled && <div className="facility-delegation" data-maintenance-plan={facilities.maintenance.chosen}><label htmlFor="facility-upkeep">Upkeep</label><input id="facility-upkeep" type="range" min={0} max={1} step={1} value={facilities.maintenance.chosen === 'reduced' ? 1 : 0} aria-valuetext={facilities.maintenance.chosen === 'reduced' ? 'Reduced' : 'Full'} aria-describedby="facility-upkeep-help" onChange={event => onMaintenancePlan(event.target.value === '1' ? 'reduced' : 'full')} disabled={busy || facilities.delegated} /><output htmlFor="facility-upkeep">{facilities.maintenance.chosen === 'reduced' ? 'Reduced' : 'Full'}</output></div>}</header>
    {!facilities.enabled ? <div className="facility-enable"><Icon name="building" size={26} /><div><strong>Manage your club facilities</strong><p>Fund {repairs ? 'arena, training, youth, medical and scouting' : 'arena, training and youth infrastructure'} upgrades. Choose manual or automatic control.</p>{enableReason && <p id="facility-enable-reason">{enableReason}</p>}</div><button id="enable-facilities" className="button" onClick={onEnableFacilities} disabled={busy || !!enableReason} aria-describedby={enableReason ? 'facility-enable-reason' : undefined}>Enable facilities</button></div> : <>
      <p className="facility-automatic-note" id="facility-automatic-help">Automatic can start an upgrade now, keeping at least {money(facilityAutomationBuffer(season, season.managedClubId))} available.{repairs ? ` It repairs the most worn facility below condition ${FACILITY_RULES_2.automaticRepairBelow} first, keeping half that amount.` : ''}</p>
      {facilities.maintenance.enabled ? <p className="facility-automatic-note" id="facility-upkeep-help">{upkeepHelp}</p>
        : <div className="facility-maintenance-enable"><div><strong>Facility upkeep choices</strong><p>{repairs ? 'Save money by reducing upkeep while upgraded facilities wear faster, or keep full upkeep. Condition changes from the next matchday.' : 'Save money by reducing upkeep while upgraded facilities wear and lose part of their benefit, or keep them in full condition. Condition changes from the next matchday.'}</p></div><button id="enable-facility-maintenance" className="button small" onClick={onEnableMaintenance} disabled={busy}>Enable upkeep choices</button></div>}<div className="facility-rows">{facilities.rows.map(row => <div className="facility-row" key={row.type} data-facility={row.type}><span className="facility-icon" aria-hidden="true"><Icon name={icons[row.type]} size={23} /></span><div className="facility-identity"><h3>{FACILITY_LABELS[row.type]}</h3><span>{benefit(row.type, row.bonusPercent, row.capacity)}</span>{row.type === 'arena' && facilities.arenaCapacity !== row.capacity && <small>{seats(facilities.arenaCapacity)} available this matchday</small>}</div><div className="facility-level-wrap"><LevelBar level={row.level} maximum={row.maxLevel} name={FACILITY_LABELS[row.type]} /><small title="Extra upkeep from completed upgrades. Standard facilities are covered by club operating costs.">{money(row.upkeepPerRound)} / matchday upkeep</small>{showsCondition(facilities, row) && <span className="facility-condition" data-facility-condition={row.condition} data-state={conditionLabel(row.condition).toLowerCase()}><meter min={0} max={100} low={50} high={80} optimum={100} value={row.condition} aria-label={`${FACILITY_LABELS[row.type]} condition: ${row.condition} out of 100`} /><small>Condition {row.condition}/100 · {conditionLabel(row.condition)}{repairs && row.effectPercent < 100 ? ` · ${row.effectPercent}% effect` : ''}</small>{repairs && onFacilityRepair && !row.project && row.condition <= 100 - FACILITY_RULES_2.repairMinimumMissing && <button className="text-button" data-facility-repair={row.type} onClick={() => { setCancelId(null); setReviewType(null); setRepairType(row.type) }} disabled={busy} aria-expanded={repairType === row.type} aria-controls="facility-repair-review">Repair<Icon name="chevron" size={12} /></button>}</span>}</div>{row.project ? <span className="facility-building"><Icon name="clock" size={15} /><span>{row.project.kind === 'repair' ? 'Repairing' : row.project.kind === 'lease' ? 'Installing' : 'Upgrading'}{schedule && <small data-facility-row-weeks-left={schedule.weeksLeft}>{facilityWeeksLeft(schedule)}</small>}</span></span> : row.level === row.maxLevel ? <span className="facility-building"><Icon name="check" size={15} />Fully upgraded</span> : <button className="button small" data-facility-upgrade={row.type} onClick={() => { setCancelId(null); setRepairType(null); setReviewType(row.type) }} disabled={busy} aria-expanded={reviewType === row.type} aria-controls="facility-upgrade-review">Upgrade<Icon name="chevron" size={13} /></button>}</div>)}</div>
      {project?.kind === 'lease' && <div className="facility-project" data-facility-project={project.id} tabIndex={-1}><div><strong>{projectLabel(project)}</strong><span>Installed for the next matchday · nothing paid upfront</span></div></div>}
      {project && schedule && <div className="facility-project" data-facility-project={project.id} tabIndex={-1}><div><strong>{projectLabel(project)}</strong><span className="facility-project-finish"><b data-facility-weeks-left={schedule.weeksLeft}>{facilityWeeksLeft(schedule)}</b> · {schedule.inSeason ? 'ready' : 'earliest finish'} <time dateTime={schedule.completesOn} data-facility-finish={schedule.completesOn}>{facilityFinishDate(schedule.completesOn)}</time></span>{!schedule.inSeason && <small>It finishes after the season's last week: at the first offseason calendar step from that day, or on next season's opening day.</small>}</div><div className="facility-project-progress"><progress value={weeksDone} max={schedule.weeksTotal} aria-label={`${FACILITY_LABELS[project.type]} ${project.kind === 'repair' ? 'repair' : 'construction'}: ${weeks(weeksDone)} of ${weeks(schedule.weeksTotal)} done, ${facilityWeeksLeft(schedule).toLowerCase()}`} /><small>{weeksDone} / {weeks(schedule.weeksTotal)} done · {money(project.cost)} paid</small></div><button id="facility-cancel-open" className="text-button" onClick={() => { setReviewType(null); setRepairType(null); setCancelId(project.id) }} disabled={busy}>{project.kind === 'repair' ? 'Cancel repair' : 'Cancel upgrade'}</button></div>}
      {review && <UpgradeReview key={review.type} season={season} row={review} board={board} fundingEnabled={!!season.facilities.fundingSince} busy={busy} onClose={closeReview} onConfirm={() => { onFacilityUpgrade(review.type); setReviewType(null); focusWhenReady('[data-facility-project]') }} onLoan={onFacilityLoan && ((seasons, principal) => { onFacilityLoan(review.type, 'upgrade', seasons, principal); setReviewType(null); focusWhenReady('[data-facility-project]') })} onLease={onFacilityLease && (seasons => { onFacilityLease(review.type, seasons); setReviewType(null); focusWhenReady('[data-facility-project]') })} onRequestBoard={() => {
        // An approval starts construction and closes the review; a refusal keeps it open with the board's answer.
        const approved = board?.approved
        onRequestBoardFunding(review.type)
        if (approved) { setReviewType(null); focusWhenReady('[data-facility-project]') } else focusWhenReady('#facility-upgrade-review')
      }} />}
      {repairReview && onFacilityRepair && <RepairReview key={repairReview.type} season={season} row={repairReview} board={repairBoard} fundingEnabled={!!season.facilities.fundingSince} busy={busy} onClose={closeRepair} onConfirm={() => { onFacilityRepair(repairReview.type); setRepairType(null); focusWhenReady('[data-facility-project]') }} onLoan={onFacilityLoan && ((seasons, principal) => { onFacilityLoan(repairReview.type, 'repair', seasons, principal); setRepairType(null); focusWhenReady('[data-facility-project]') })} onRequestBoard={() => {
        const approved = repairBoard?.approved
        onRequestBoardFunding(repairReview.type, 'repair')
        if (approved) { setRepairType(null); focusWhenReady('[data-facility-project]') } else focusWhenReady('#facility-repair-review')
      }} />}
      {cancelling && <CancellationReview key={cancelling.id} project={cancelling} automatic={facilities.delegated} busy={busy} onClose={closeCancel} onConfirm={() => { onCancelFacilityUpgrade(cancelling.id); setCancelId(null); focusWhenReady(cancelling.kind === 'repair' ? `[data-facility-repair="${cancelling.type}"]` : `[data-facility-upgrade="${cancelling.type}"]`) }} />}
      <details className="facility-rules"><summary><Icon name="settings" size={14} />Control &amp; effects{history.length > 0 ? repairs ? ' · Project history' : ' · Upgrade history' : ''}</summary><p>Automatic control starts with the cheapest eligible upgrade, checks again as the calendar advances, and keeps at least {money(facilityAutomationBuffer(season, season.managedClubId))} available after approval. Existing salary and transfer reservations still apply. Manual control lets you choose when to invest.</p><p>Training and youth infrastructure improve medically eligible practice; the weekly reports retain the effect used. Arena work affects future prepared crowds. Upkeep shown here is the extra cost of completed upgrades; standard facilities are covered by club operating costs.</p>{repairs && <><p>The medical centre shortens new injuries' recovery (up to {FACILITY_RULES_2.medicalRecoveryPercent[3]}% at level 4), lowers the extra risk of a repeat injury (up to {FACILITY_RULES_2.medicalRecurrencePercent[3]}%) and helps your physio work faster (up to {FACILITY_RULES_2.medicalPhysioPercent[3]}% more credit per day). The scouting office adds evidence to every observation (up to {FACILITY_RULES_2.scoutingEvidencePercent[3]}%) and widens the pool of players you can browse (up to {FACILITY_RULES_2.scoutingDiscoveryPercent[3]}%).</p><p>Condition: the arena and every upgraded facility wear each season, faster at higher levels and with heavy use (arena and training most, scouting least): about {FACILITY_RULES_2.seasonWear[0]} to {FACILITY_RULES_2.seasonWear[3]} points a season before use. A facility gives its full effect down to condition {FACILITY_RULES_2.fullEffectCondition}; at 0 it gives {conditionEffectPercent(0)}%, and a worn arena also draws up to {FACILITY_RULES_2.arenaComfortLossPercent}% fewer spectators. A repair or a new upgrade restores condition to 100.</p></>}{!repairs && facilities.maintenance.enabled && <p>Upkeep: an upgraded facility's condition starts at 100 when built. Each matchday under reduced upkeep costs half and lowers it by {FACILITY_WEAR_PER_MATCHDAY}; under full upkeep it recovers {FACILITY_RECOVERY_PER_MATCHDAY}. Condition scales the practice bonus and the extra arena seats; a new upgrade restores it to 100. A change applies from the next matchday.</p>}{history.length > 0 && <ul className="facility-history">{history.map(item => <li key={item.id} data-facility-history={item.id}><span><strong>{projectLabel(item)}</strong><small>{item.returnedOn ? `Installed ${scoutingDate(item.completedOn!)} · handed back ${scoutingDate(item.returnedOn)}` : item.completedOn ? `${item.kind === 'lease' ? 'Installed' : 'Completed'} ${scoutingDate(item.completedOn)}` : `Cancelled ${scoutingDate(item.cancelledOn!)}`}</small></span><span>{item.kind === 'lease' ? 'Leased' : money(item.cost)}{item.cancelledOn && <small>No refund</small>}</span></li>)}</ul>}</details>
    </>}
  </section>
}
