import { useEffect, useRef, useState } from 'react'
import type { ArenaExpansionQuote, ClubFacilities, FacilityProject, FacilityType } from '../domain/facilities'
import type { SeasonState } from '../domain/season'
import { FACILITY_BANK_REASON, FACILITY_RULES_3, facilityLevelName, getClubFacilities } from '../world/facilities-policy'
import { facilityProjectSchedule } from '../world/facility-schedule'
import { focusWhenReady } from './focus-when-ready'
import { Icon, type IconName } from './Icon'
import { scoutingDate } from './ScoutingKnowledge'
import { facilityFinishDate, facilityWeeksLeft } from './FacilitiesPanel'
import { formatEuros } from './money-format'
import './facilities-panel.css'
import './simple-facilities.css'

/** Format 74 (`facilities-3`): the actions of the simple facilities panel. */
export interface SimpleFacilitiesActions {
  onEnableFacilities: () => void
  onFacilityUpgrade: (type: FacilityType) => void
  onCancelFacilityUpgrade: (projectId: string) => void
  onFacilityDelegation: (delegated: boolean) => void
  onArenaExpansion?: (seats: number) => void
  /** A project the budget cannot pay for: open the bank with the missing amount. */
  onBorrowFor?: (amount: number) => void
}

const LABELS: Record<FacilityType, string> = { arena: 'Arena', training: 'Training facilities', youth: 'Youth infrastructure', medical: 'Medical centre', scouting: 'Scouting office' }
const icons: Record<FacilityType, IconName> = { arena: 'building', training: 'training', youth: 'people', medical: 'medical', scouting: 'search' }
const money = (amount: number) => formatEuros(amount)
const count = (value: number) => value.toLocaleString('en-GB')
const weeks = (value: number) => `${value} ${value === 1 ? 'week' : 'weeks'}`
const signed = (percent: number) => `${percent > 0 ? '+' : '−'}${Math.abs(percent)}%`

/** What a facility does at a level, in plain words (negative below Average). */
export function sixLevelEffect(type: FacilityType, percent: number): string {
  if (type === 'medical') return percent === 0 ? 'Standard injury recovery' : `${Math.abs(percent)}% ${percent > 0 ? 'shorter' : 'longer'} injury recovery`
  if (type === 'scouting') return percent === 0 ? 'Standard scouting reports' : `${signed(percent)} scouting evidence`
  const who = type === 'training' ? 'senior' : 'academy'
  return percent === 0 ? `Standard ${who} practice` : `${signed(percent)} ${who} practice`
}

const projectTitle = (project: FacilityProject) => project.kind === 'expansion' ? `Arena · +${count(project.seats ?? 0)} seats` : `${LABELS[project.type]} · ${facilityLevelName(project.toLevel)}`

function SixLevelBar({ level, name }: { level: number; name: string }) {
  const maximum = FACILITY_RULES_3.levelNames.length
  return <span className="facility-level six-level" role="img" aria-label={`${name}: ${facilityLevelName(level)}, level ${level} of ${maximum}`}><span aria-hidden="true">{Array.from({ length: maximum }, (_, index) => <i key={index} className={index < level ? 'filled' : ''} />)}</span><b aria-hidden="true">{facilityLevelName(level)}</b></span>
}

function useRevealed() {
  const region = useRef<HTMLElement>(null)
  useEffect(() => { region.current?.focus({ preventScroll: true }); region.current?.scrollIntoView({ block: 'nearest' }) }, [])
  return region
}

function Completion({ season, dueOn }: { season: SeasonState; dueOn: string }) {
  const schedule = facilityProjectSchedule(season, { startedOn: season.date, dueOn })
  return <div><dt>Ready</dt><dd><time dateTime={schedule.completesOn}>{facilityFinishDate(schedule.completesOn)}</time><small>{weeks(schedule.weeksLeft)}{schedule.inSeason ? '' : ', after the season'}</small></dd></div>
}

/** The footer of a review: why it cannot start, with the bank's help when only money is missing. */
function ReviewFooter({ id, reason, short, ready, label, busy, onConfirm, onBorrowFor }: { id: string; reason: string | null; short: number; ready: string; label: string; busy: boolean; onConfirm: () => void; onBorrowFor?: (amount: number) => void }) {
  const bank = reason === FACILITY_BANK_REASON
  return <footer><span id={`${id}-reason`} role="status">{bank ? `Not enough Remaining budget: ${money(short)} short. A bank loan adds money to your budget at once.` : reason ?? ready}</span>{bank && onBorrowFor && <button className="button" onClick={() => onBorrowFor(short)} disabled={busy}><Icon name="wallet" size={15} />Borrow {money(short)}</button>}<button id={`${id}-confirm`} className="button primary" disabled={busy || reason !== null} onClick={onConfirm} aria-describedby={`${id}-reason`}><Icon name="building" size={15} />{label}</button></footer>
}

function UpgradeReview({ season, row, remainingBudget, busy, onConfirm, onClose, onBorrowFor }: { season: SeasonState; row: ClubFacilities['rows'][number]; remainingBudget: number; busy: boolean; onConfirm: () => void; onClose: () => void; onBorrowFor?: (amount: number) => void }) {
  const region = useRevealed(), quote = row.quote
  return <section ref={region} id="facility-upgrade-review" className="facility-review" tabIndex={-1} aria-labelledby="facility-upgrade-title" onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.preventDefault(); onClose() } }}>
    <header><div><h3 id="facility-upgrade-title">Upgrade {LABELS[row.type].toLowerCase()}</h3><span>{facilityLevelName(quote.fromLevel)} → {facilityLevelName(quote.toLevel)}</span></div><button className="text-button" onClick={onClose} disabled={busy}><Icon name="close" size={14} />Close</button></header>
    <dl className="facility-review-facts"><div><dt>Cost, from Remaining budget</dt><dd data-facility-cost={quote.cost}>{money(quote.cost)}</dd></div><div><dt>Remaining budget after</dt><dd data-facility-budget-after={quote.remainingBudgetAfter}>{money(quote.remainingBudgetAfter)}</dd></div><Completion season={season} dueOn={quote.dueOn} /><div><dt>When ready</dt><dd>{sixLevelEffect(row.type, quote.bonusAfter)}</dd></div><div><dt>Upkeep / week</dt><dd>{money(row.upkeepPerRound)} → {money(quote.upkeepAfter)}</dd></div></dl>
    <ReviewFooter id="facility-upgrade" reason={quote.reason} short={Math.max(0, quote.cost - remainingBudget)} ready="Paid in full now. One project runs at a time." label="Start upgrade" busy={busy} onConfirm={onConfirm} onBorrowFor={onBorrowFor} />
  </section>
}

function ExpansionReview({ season, facilities, busy, onConfirm, onClose, onBorrowFor }: { season: SeasonState; facilities: ClubFacilities; busy: boolean; onConfirm: (seats: number) => void; onClose: () => void; onBorrowFor?: (amount: number) => void }) {
  const region = useRevealed()
  const options = facilities.expansions
  const [seats, setSeats] = useState(options[0]?.seats ?? 0)
  const quote: ArenaExpansionQuote | undefined = options.find(item => item.seats === seats) ?? options[0]
  return <section ref={region} id="facility-expansion-review" className="facility-review" tabIndex={-1} aria-labelledby="facility-expansion-title" onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.preventDefault(); onClose() } }}>
    <header><div><h3 id="facility-expansion-title">Expand the arena</h3><span>{count(facilities.arenaFullCapacity)} seats today</span></div><button className="text-button" onClick={onClose} disabled={busy}><Icon name="close" size={14} />Close</button></header>
    {!quote ? <p className="facility-cancel-copy">The arena has reached its largest size ({count(FACILITY_RULES_3.maxArenaSeats)} seats).</p> : <>
      <fieldset className="arena-sizes"><legend>Seats to add</legend>{options.map(option => <label key={option.seats} className={option.seats === quote.seats ? 'selected' : ''} data-arena-size={option.seats}><input type="radio" name="arena-size" value={option.seats} checked={option.seats === quote.seats} onChange={() => setSeats(option.seats)} disabled={busy} /><strong>+{count(option.seats)}</strong><small>{money(option.cost)} · {weeks(option.durationDays / 7)}</small></label>)}</fieldset>
      <dl className="facility-review-facts"><div><dt>Seats</dt><dd data-arena-after={quote.capacityAfter}>{count(quote.capacityBefore)} → {count(quote.capacityAfter)}</dd></div><div><dt>Cost, from Remaining budget</dt><dd data-arena-cost={quote.cost}>{money(quote.cost)}</dd></div><div><dt>Remaining budget after</dt><dd>{money(quote.remainingBudgetAfter)}</dd></div><Completion season={season} dueOn={quote.dueOn} /><div><dt>Arena upkeep / week</dt><dd>{money(facilities.rows.find(row => row.type === 'arena')?.upkeepPerRound ?? 0)} → {money(quote.upkeepAfter)}</dd></div></dl>
      <p className="facility-automatic-note">Bigger expansions take longer. All seats stay open while the work goes on; the new seats count from the week it is ready. One expansion can add at most half the arena's seats.</p>
      <ReviewFooter id="facility-expansion" reason={quote.reason} short={Math.max(0, quote.cost - facilities.remainingBudget)} ready="Paid in full now. One project runs at a time." label="Start expansion" busy={busy} onConfirm={() => onConfirm(quote.seats)} onBorrowFor={onBorrowFor} />
    </>}
  </section>
}

/** Format 74 (`facilities-3`): each facility's level with one Upgrade button, the arena's seats with Expand, and one switch. */
export function SimpleFacilitiesPanel({ season, busy = false, onEnableFacilities, onFacilityUpgrade, onCancelFacilityUpgrade, onFacilityDelegation, onArenaExpansion, onBorrowFor }: SimpleFacilitiesActions & { season: SeasonState; busy?: boolean }) {
  const facilities = getClubFacilities(season)
  const [open, setOpen] = useState<FacilityType | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const project = facilities.rows.find(row => row.project)?.project ?? null
  const schedule = project ? facilityProjectSchedule(season, project) : null
  const weeksDone = schedule ? Math.max(0, schedule.weeksTotal - schedule.weeksLeft) : 0
  const history = [...season.facilities.projects].reverse().filter(item => item.clubId === season.managedClubId && (item.completedOn || item.cancelledOn))
  const review = open && open !== 'arena' ? facilities.rows.find(row => row.type === open) : undefined
  const arena = facilities.rows.find(row => row.type === 'arena')!
  const close = () => { const type = open; setOpen(null); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-facility-upgrade="${type}"]`)?.focus({ preventScroll: true })) }
  const borrow = onBorrowFor && ((amount: number) => { setOpen(null); onBorrowFor(amount) })
  const rules = FACILITY_RULES_3
  if (!facilities.enabled) return <section className="facilities-panel panel" aria-labelledby="facilities-title"><header className="club-heading"><h2 id="facilities-title"><Icon name="building" size={18} />Facilities</h2></header><div className="facility-enable"><Icon name="building" size={26} /><div><strong>Manage your club facilities</strong><p>Upgrade your arena, training, youth, medical and scouting facilities.</p>{!season.finance.enabledSince && <p id="facility-enable-reason">Enable club finances first.</p>}</div><button id="enable-facilities" className="button" onClick={onEnableFacilities} disabled={busy || !season.finance.enabledSince}>Enable facilities</button></div></section>
  return <section className="facilities-panel simple-facilities panel" aria-labelledby="facilities-title" data-facilities-model="facilities-3">
    <header className="club-heading"><h2 id="facilities-title"><Icon name="building" size={18} />Facilities</h2><label className="board-handles" htmlFor="facility-board-handles"><input id="facility-board-handles" type="checkbox" role="switch" checked={facilities.delegated} onChange={event => onFacilityDelegation(event.target.checked)} disabled={busy} aria-describedby="facility-board-help" /><span>Let the board handle facilities</span></label></header>
    <p className="facility-automatic-note" id="facility-board-help">{facilities.delegated ? 'The board upgrades a facility when the budget allows and expands a sold-out arena, keeping a cash reserve; it may borrow from the bank for an expansion. You can still start a project yourself.' : 'You choose upgrades. Projects are paid from Remaining budget; the bank below can add to it.'}</p>
    <div className="facility-rows">
      <div className="facility-row" data-facility="arena"><span className="facility-icon" aria-hidden="true"><Icon name="building" size={23} /></span><div className="facility-identity"><h3>Arena</h3><span data-arena-seats={facilities.arenaFullCapacity}>{count(facilities.arenaFullCapacity)} seats</span>{facilities.arenaCapacity !== facilities.arenaFullCapacity && <small>{count(facilities.arenaCapacity)} seats this week</small>}</div><div className="facility-level-wrap"><small title="Upkeep of the seats added to the opening arena; the opening arena is covered by operating costs.">{money(arena.upkeepPerRound)} / week upkeep</small></div>{arena.project ? <span className="facility-building"><Icon name="clock" size={15} /><span>Expanding{schedule && <small data-facility-row-weeks-left={schedule.weeksLeft}>{facilityWeeksLeft(schedule)}</small>}</span></span> : onArenaExpansion && <button className="button small" data-facility-upgrade="arena" onClick={() => { setCancelling(false); setOpen(open === 'arena' ? null : 'arena') }} disabled={busy} aria-expanded={open === 'arena'} aria-controls="facility-expansion-review">Expand<Icon name="chevron" size={13} /></button>}</div>
      {facilities.rows.filter(row => row.type !== 'arena').map(row => <div className="facility-row" key={row.type} data-facility={row.type} data-facility-level={row.level}><span className="facility-icon" aria-hidden="true"><Icon name={icons[row.type]} size={23} /></span><div className="facility-identity"><h3>{LABELS[row.type]}</h3><span>{sixLevelEffect(row.type, row.bonusPercent)}</span></div><div className="facility-level-wrap"><SixLevelBar level={row.level} name={LABELS[row.type]} /><small title="Extra upkeep above the club's starting facilities, which operating costs already cover.">{money(row.upkeepPerRound)} / week upkeep</small></div>{row.project ? <span className="facility-building"><Icon name="clock" size={15} /><span>Upgrading{schedule && <small data-facility-row-weeks-left={schedule.weeksLeft}>{facilityWeeksLeft(schedule)}</small>}</span></span> : row.level === row.maxLevel ? <span className="facility-building"><Icon name="check" size={15} />Excellent</span> : <button className="button small" data-facility-upgrade={row.type} onClick={() => { setCancelling(false); setOpen(open === row.type ? null : row.type) }} disabled={busy} aria-expanded={open === row.type} aria-controls="facility-upgrade-review">Upgrade<Icon name="chevron" size={13} /></button>}</div>)}
    </div>
    {project && schedule && <div className="facility-project" data-facility-project={project.id} tabIndex={-1}><div><strong>{projectTitle(project)}</strong><span className="facility-project-finish"><b data-facility-weeks-left={schedule.weeksLeft}>{facilityWeeksLeft(schedule)}</b> · {schedule.inSeason ? 'ready' : 'earliest finish'} <time dateTime={schedule.completesOn} data-facility-finish={schedule.completesOn}>{facilityFinishDate(schedule.completesOn)}</time></span></div><div className="facility-project-progress"><progress value={weeksDone} max={schedule.weeksTotal} aria-label={`${projectTitle(project)}: ${weeks(weeksDone)} of ${weeks(schedule.weeksTotal)} done`} /><small>{weeksDone} / {weeks(schedule.weeksTotal)} done · {money(project.cost)} paid</small></div><button id="facility-cancel-open" className="text-button" onClick={() => { setOpen(null); setCancelling(true) }} disabled={busy}>Cancel</button></div>}
    {project && cancelling && <section className="facility-review facility-cancel-review" aria-labelledby="facility-cancel-title"><header><div><h3 id="facility-cancel-title">Cancel {projectTitle(project)}?</h3></div></header><p className="facility-cancel-copy">Work stops and the {money(project.cost)} already paid is not refunded.{facilities.delegated ? ' The board still handles facilities and may start another project later.' : ''}</p><footer><button className="button" onClick={() => setCancelling(false)} disabled={busy}>Keep building</button><button id="facility-cancel-confirm" className="button" onClick={() => { setCancelling(false); onCancelFacilityUpgrade(project.id) }} disabled={busy}>Cancel project</button></footer></section>}
    {review && <UpgradeReview key={review.type} season={season} row={review} remainingBudget={facilities.remainingBudget} busy={busy} onClose={close} onBorrowFor={borrow} onConfirm={() => { onFacilityUpgrade(review.type); setOpen(null); focusWhenReady('[data-facility-project]') }} />}
    {open === 'arena' && onArenaExpansion && <ExpansionReview season={season} facilities={facilities} busy={busy} onClose={close} onBorrowFor={borrow} onConfirm={seats => { onArenaExpansion(seats); setOpen(null); focusWhenReady('[data-facility-project]') }} />}
    <details className="facility-rules"><summary><Icon name="settings" size={14} />How facilities work{history.length ? ' · Project history' : ''}</summary>
      <p>Every facility has six levels, from Very Poor to Excellent; an upgrade raises one level, is paid in full from Remaining budget and takes a few weeks. Upkeep is charged each week for levels above the club's starting facilities and for seats added to the arena. Facilities do not wear out.</p>
      <div className="six-level-effects" role="region" aria-label="Facility effects by level" tabIndex={0}><table><thead><tr><th scope="col">Level</th><th scope="col">Training and youth practice</th><th scope="col">Injury recovery</th><th scope="col">Scouting evidence</th></tr></thead><tbody>{rules.levelNames.map((name, index) => <tr key={name}><th scope="row">{name}</th><td>{index === 2 ? 'Standard' : signed(rules.practicePercent[index]!)}</td><td>{index === 2 ? 'Standard' : `${Math.abs(rules.medicalRecoveryPercent[index]!)}% ${rules.medicalRecoveryPercent[index]! > 0 ? 'shorter' : 'longer'}`}</td><td>{index === 2 ? 'Standard' : signed(rules.scoutingEvidencePercent[index]!)}</td></tr>)}</tbody></table></div>
      <p>The medical centre also changes the risk of a repeat injury and how fast your physio works; the scouting office also changes how many players your scouts can browse. Arena expansions add {rules.expansionSeats.map(count).join(', ')} seats in {rules.expansionWeeks.map(String).join(', ')} weeks; more seats can bring more ticket income when demand fills them.</p>
      {history.length > 0 && <ul className="facility-history">{history.map(item => <li key={item.id} data-facility-history={item.id}><span><strong>{projectTitle(item)}</strong><small>{item.completedOn ? `Completed ${scoutingDate(item.completedOn)}` : `Cancelled ${scoutingDate(item.cancelledOn!)}`}</small></span><span>{money(item.cost)}{item.cancelledOn && <small>No refund</small>}</span></li>)}</ul>}
    </details>
  </section>
}
