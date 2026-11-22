import { useEffect, useRef, useState } from 'react'
import { clubRosterLimit } from '../world/club-roster-policy'
import type { SeasonState } from '../domain/season'
import { injuryLabel } from '../domain/injuries'
import type { AcademyWeekFullPlayer } from '../domain/academy'
import type { TrainingFocus } from '../domain/training'
import type { PlayerAttributes } from '../domain/types'
import { DEVELOPMENT_YOUTH_COACHES } from '../data/development-youth'
import { academyPointCap, getAcademyCapacity, getClubAcademy, quoteAcademyPromotion, type AcademyPlayerView } from '../world/academy-policy'
import { getYouthPlayerPerformance, getYouthPlayerStatus } from '../world/youth-competition'
import { isAcademyOutcome } from '../world/academy-history'
import { getClubYouthCoach, youthCoachEffects } from '../world/youth-policy'
import { maxContractWage, MIN_CONTRACT_WAGE, WAGE_STEP } from '../world/employment-policy'
import { requiredNegotiationWage } from '../world/negotiations-policy'
import { TRAINING_ATTRIBUTES, TRAINING_FOCUSES, TRAINING_FOCUS_LABELS } from '../world/training'
import { Avatar } from './Avatar'
import { PlayerRating } from './PlayerRating'
import { GrowthMarker } from './GrowthMarker'
import { youthGrowth } from '../world/player-growth'
import { YouthCoachPortrait } from './YouthCoachPortrait'
import { Icon } from './Icon'
import { AcademyCompetition } from './AcademyCompetition'
import { StaminaMeter } from './StaminaMeter'
import { FacilityPracticeContribution, FacilityPracticeEffect } from './FacilityPractice'
import { scoutingDate } from './ScoutingKnowledge'
import './academy-workspace.css'
import { seasonRounds } from '../world/career-world'
import { YOUTH_COACH_DIRECTORY } from '../data/staff-directory'
import { formatEuros } from './money-format'

export interface AcademyWorkspaceProps {
  season: SeasonState
  busy?: boolean
  onEnableAcademy: () => void
  onEnableYouthCompetition: () => void
  onAcademyFocus: (playerId: string, focus: TrainingFocus) => void
  onPromoteAcademy: (playerId: string, wage: number) => void
  onWithdrawPromotion: (offerId: string) => void
  onOpenYouthCoach: () => void
  onOpenPlayer: (playerId: string) => void
}

const money = (amount: number) => formatEuros(amount)
const total = (points: PlayerAttributes) => TRAINING_ATTRIBUTES.reduce((sum, key) => sum + points[key], 0)
const gains = (row: AcademyPlayerView) => TRAINING_ATTRIBUTES.reduce((sum, key) => sum + Math.floor(row.points[key] / 100), 0)
const coachName = (id: string) => YOUTH_COACH_DIRECTORY.find(coach => coach.id === id)?.name ?? 'Youth coach'

function AcademyProgress({ row }: { row: AcademyPlayerView }) {
  const eligible = TRAINING_ATTRIBUTES.filter(key => row.points[key] < academyPointCap(row.prospect.player.attributes[key]))
  const target = row.focus !== 'balanced' && eligible.includes(row.focus) ? row.focus : [...eligible].sort((a, b) => row.points[b] % 100 - row.points[a] % 100)[0]
  return <div className="academy-progress"><strong>{gains(row)} skill {gains(row) === 1 ? 'gain' : 'gains'}</strong>{target ? <><small>{TRAINING_FOCUS_LABELS[target]} &middot; {row.points[target] % 100}% to next gain</small><progress max={100} value={row.points[target] % 100} aria-label={`${row.player.name}: ${TRAINING_FOCUS_LABELS[target]} progress to next skill gain`} /></> : <small>Academy development completed</small>}</div>
}

function AcademyReadiness({ season, row }: { season: SeasonState; row: AcademyPlayerView }) {
  const status = getYouthPlayerStatus(season, row.player.id)
  return <div className="academy-readiness" data-youth-health={row.player.id}><StaminaMeter value={status.condition} label={`${row.player.name} current condition`} compact />{status.injury && !status.available && <span className="academy-injury-label"><Icon name="medical" size={12} /> {injuryLabel(status.injury.kind)}{status.returnOn && <><br />Back {scoutingDate(status.returnOn)}</>}</span>}</div>
}

function PromotionReview({ season, row, busy, onOffer, onWithdraw, onClose }: { season: SeasonState; row: AcademyPlayerView; busy: boolean; onOffer: AcademyWorkspaceProps['onPromoteAcademy']; onWithdraw: AcademyWorkspaceProps['onWithdrawPromotion']; onClose: () => void }) {
  const [wage, setWage] = useState(String(row.pendingOffer?.seasonWage ?? requiredNegotiationWage(row.player.id, 1, undefined, season)))
  const region = useRef<HTMLElement>(null)
  const amount = Number(wage)
  const quote = quoteAcademyPromotion(season, row.player.id, amount)
  const unchanged = row.pendingOffer?.seasonWage === amount
  const latest = [...season.recruitment.offers].reverse().find(offer => offer.academyProspectId === row.player.id && offer.clubId === season.managedClubId)
  const validWage = wage !== '' && Number.isInteger(amount) && amount >= MIN_CONTRACT_WAGE && amount <= maxContractWage(season) && amount % WAGE_STEP === 0
  const reason = !validWage ? (season.world?.economy ? `Choose an annual salary from €5,000 to ${money(maxContractWage(season))}, in €500 steps.` : 'Choose an annual salary from €5,000 to €50,000, in €500 steps.') : quote.reason
  const academyAfter = getClubAcademy(season).filter(item => item.player.id !== row.player.id)
  const availableAfter = academyAfter.filter(item => getYouthPlayerStatus(season, item.player.id).available).length
  const otherPending = academyAfter.filter(item => item.pendingOffer).length
  const academyAfterAll = academyAfter.filter(item => !item.pendingOffer)
  const availableAfterAll = academyAfterAll.filter(item => getYouthPlayerStatus(season, item.player.id).available).length
  useEffect(() => { region.current?.focus({ preventScroll: true }); region.current?.scrollIntoView({ block: 'nearest' }) }, [])
  return <section className="academy-promotion panel" ref={region} tabIndex={-1} aria-labelledby="academy-promotion-title" onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.preventDefault(); onClose() } }}>
    <header className="academy-heading"><div><h2 id="academy-promotion-title">Offer a senior contract</h2><span>{row.player.name} &middot; remainder of this season</span></div><button className="text-button" onClick={onClose} disabled={busy}><Icon name="close" size={14} />Close</button></header>
    <div className="academy-promotion-body"><div className="academy-promotion-terms"><label htmlFor="academy-promotion-wage">Annual salary <strong>{validWage ? money(amount) : 'Enter salary'}</strong></label><input id="academy-promotion-wage" type="range" min={MIN_CONTRACT_WAGE} max={maxContractWage(season)} step={WAGE_STEP} value={validWage ? amount : MIN_CONTRACT_WAGE} onChange={event => setWage(event.target.value)} disabled={busy} /><label className="academy-wage-input">Exact annual salary (€)<input id="academy-promotion-wage-number" type="number" min={MIN_CONTRACT_WAGE / 100} max={maxContractWage(season) / 100} step={WAGE_STEP / 100} value={wage === '' ? '' : amount / 100} onChange={event => setWage(event.target.value === '' ? '' : String(Number(event.target.value) * 100))} disabled={busy} /></label><small>Opening demand: {money(requiredNegotiationWage(row.player.id, 1, undefined, season))} / year</small></div>
      <div className="academy-promotion-facts"><div><span>Reply &amp; joining date</span><strong>{season.status === 'active' && season.round < seasonRounds(season) ? scoutingDate(quote.responseOn) : 'Window closed'}</strong></div><div><span>Salary cost for remaining season</span><strong data-promotion-cost={quote.remainingWages}>{validWage ? money(quote.remainingWages) : '—'}</strong></div><div><span>Senior squad after signing</span><strong>{quote.rosterSize} / {clubRosterLimit(season)}</strong></div><details><summary>Budget after this offer</summary><dl><div><dt>Spending left</dt><dd>{validWage ? money(quote.remainingBudgetAfter) : '—'}</dd></div><div><dt>Wages left this season / year</dt><dd>{validWage ? money(quote.annualBudgetRemaining) : '—'}</dd></div></dl><p>Remaining salary costs and a senior squad place are held until the reply. The current match stays unchanged. No transfer fee.</p></details></div>
    </div>
    {row.pendingOffer ? <div className="academy-promotion-status" role="status"><Icon name="clock" size={17} /><span>Awaiting reply on {scoutingDate(row.pendingOffer.responseOn)}. The player remains in the academy until he signs.</span><button id="academy-withdraw-promotion" className="text-button" onClick={() => onWithdraw(row.pendingOffer!.id)} disabled={busy}>Withdraw offer</button></div> : latest && latest.status !== 'accepted' && <p className="academy-promotion-status" role="status">{latest.status === 'countered' ? 'Player counteroffer' : latest.status === 'withdrawn' ? 'Offer withdrawn' : latest.status === 'cancelled' ? 'Offer cancelled' : 'Previous offer closed'}{latest.reason ? ` · ${latest.reason}` : ''}. Still in the academy.</p>}
    {season.youthCompetition.enabledSince && <div className="academy-promotion-youth"><strong>Academy after this promotion: {academyAfter.length} players</strong><span data-promotion-youth-available={availableAfter}>Currently available: {availableAfter} · excludes this player</span>{otherPending > 0 && <span data-promotion-youth-combined={academyAfterAll.length} data-promotion-youth-combined-available={availableAfterAll}>If this and the {otherPending} other pending {otherPending === 1 ? 'promotion are' : 'promotions are'} accepted: <strong>{academyAfterAll.length} players · {availableAfterAll} currently available</strong></span>}{availableAfterAll < 5 && <span className="youth-shortage" role="status"><Icon name="medical" size={15} />Fewer than five available. Your youth team may lose by default until enough players return or arrive.</span>}</div>}
    <footer className="academy-promotion-footer"><span id="academy-promotion-reason" role="status">{reason ?? (unchanged ? 'Awaiting reply. Change the salary to revise your offer.' : 'The player decides when you Continue to the next matchday.')}</span><button id="academy-confirm-promotion" className="button primary" onClick={() => onOffer(row.player.id, amount)} disabled={busy || !validWage || !quote.canOffer || unchanged} aria-describedby="academy-promotion-reason"><Icon name="people" size={16} />{row.pendingOffer ? 'Revise offer' : 'Offer senior contract'}</button></footer>
  </section>
}

export function AcademyWorkspace({ season, busy = false, onEnableAcademy, onEnableYouthCompetition, onAcademyFocus, onPromoteAcademy, onWithdrawPromotion, onOpenYouthCoach, onOpenPlayer }: AcademyWorkspaceProps) {
  const rows = getClubAcademy(season)
  const [selectedId, setSelectedId] = useState<string | null>(rows[0]?.player.id ?? null)
  const [promotionId, setPromotionId] = useState<string | null>(null)
  const club = season.clubs.find(team => team.id === season.managedClubId)!
  const enabled = season.academy.enabledSince !== null
  const competitionEnabled = season.youthCompetition.enabledSince !== null
  const closed = season.status !== 'active' || season.round === seasonRounds(season)
  const selected = rows.find(row => row.player.id === selectedId) ?? rows[0] ?? null
  const promotion = rows.find(row => row.player.id === promotionId) ?? null
  const coachContract = getClubYouthCoach(season)
  const coach = coachContract ? YOUTH_COACH_DIRECTORY.find(item => item.id === coachContract.coachId) : null
  const enableReason = !season.recruitment.enabledSince || !season.finance.enabledSince || !season.employment.enabledSince || !season.payroll.enabledSince || !season.negotiations.enabledSince ? 'Enable club finances, player contracts, payroll and in-season recruitment first.' : closed ? 'Start next season to enable the academy.' : null
  const latestWeek = [...season.academy.weeks].reverse().find(week => Object.values(week.players).some(player => player.clubId === club.id))
  const latestWeekPlayers = latestWeek ? Object.entries(latestWeek.players).filter((entry): entry is [string, AcademyWeekFullPlayer] => entry[1].clubId === club.id && !isAcademyOutcome(entry[1])) : []
  const graduates = [...season.academy.graduates].reverse().filter(entry => entry.clubId === club.id)
  const performance = selected && competitionEnabled ? getYouthPlayerPerformance(season, selected.player.id) : null
  function closePromotion() { const id = promotionId; setPromotionId(null); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-promote-prospect="${id}"]`)?.focus({ preventScroll: true })) }

  return <div className="academy-workspace">
    <section className="academy-overview panel" aria-labelledby="academy-title"><header className="academy-heading"><div><h2 id="academy-title">Youth academy</h2><span>{club.name} &middot; {rows.length} / {getAcademyCapacity(season)} prospects</span></div><button id="academy-manage-coach" className="button small" onClick={onOpenYouthCoach} disabled={busy}><Icon name="staff" size={15} />Youth coach</button></header>
      {!enabled ? <div className="academy-enable"><Icon name="people" size={28} /><div><strong>Open your prospect roster</strong><p>Set individual training and offer senior contracts when you want to promote a player.</p>{enableReason && <p id="academy-enable-reason">{enableReason}</p>}</div><button id="enable-academy" className="button primary" onClick={onEnableAcademy} disabled={busy || !!enableReason} aria-describedby={enableReason ? 'academy-enable-reason' : undefined}>Enable academy</button></div> : <div className="academy-status-strip"><div>{coach ? <YouthCoachPortrait coach={coach} size={40} color={club.color} /> : <Icon name="training" size={25} />}<span><strong>{coach?.name ?? 'Club development'}</strong><small>{coach ? `+${youthCoachEffects(coach).bonusPercent}% academy practice` : 'Weekly development without a youth coach'}</small></span></div><span><Icon name="calendar" size={17} />{closed ? 'Development resumes next season' : 'Development after each matchday'}</span></div>}
      {enabled && <FacilityPracticeEffect season={season} type="youth" />}
    </section>
    {enabled && <AcademyCompetition season={season} busy={busy} onEnable={onEnableYouthCompetition}>
      <section className="academy-roster panel" aria-labelledby="academy-roster-title"><header className="academy-heading"><h2 id="academy-roster-title">Prospects</h2><span>Own players &middot; exact ability</span></header><div className="academy-table-scroll" role="region" aria-label="Academy prospect roster" tabIndex={0}><table className={`academy-table${competitionEnabled ? ' academy-table-with-health' : ''}`}><thead><tr><th>Player</th>{competitionEnabled && <th>Condition</th>}<th>Ability</th><th>Training focus</th><th>Development</th><th>Senior contract</th></tr></thead><tbody>{rows.map(row => <tr key={row.player.id} data-academy-prospect={row.player.id} className={selected?.player.id === row.player.id ? 'selected' : ''}><th scope="row"><button className="academy-player" onClick={() => setSelectedId(row.player.id)} aria-pressed={selected?.player.id === row.player.id} disabled={busy}><Avatar player={row.player} color={club.color} size={40} /><span><strong>{row.player.name}</strong><small>{row.age} years &middot; {row.player.position} &middot; {row.player.heightCm} cm</small></span></button></th>{competitionEnabled && <td><AcademyReadiness season={season} row={row} /></td>}<td><PlayerRating attributes={row.player.attributes} position={row.player.position} compact />{(growth => <GrowthMarker change={growth?.overall} label="Overall" since={growth?.since ?? 'last week'} />)(youthGrowth(season, row.player.id))}</td><td><select data-academy-focus={row.player.id} aria-label={`${row.player.name} training focus`} value={row.focus} onChange={event => onAcademyFocus(row.player.id, event.target.value as TrainingFocus)} disabled={busy || closed}>{TRAINING_FOCUSES.map(focus => <option key={focus} value={focus}>{TRAINING_FOCUS_LABELS[focus]}</option>)}</select></td><td><AcademyProgress row={row} /></td><td><button className="button small" data-promote-prospect={row.player.id} onClick={() => { setSelectedId(row.player.id); setPromotionId(row.player.id) }} disabled={busy}>{row.pendingOffer ? 'Review offer' : 'Review promotion'}<Icon name="chevron" size={13} /></button>{row.pendingOffer && <small className="academy-awaiting">Reply {scoutingDate(row.pendingOffer.responseOn)}</small>}</td></tr>)}{!rows.length && <tr><td colSpan={competitionEnabled ? 6 : 5} className="academy-empty">No current prospects. The next intake arrives on the new season's opening day.</td></tr>}</tbody></table></div></section>
      {promotion && <PromotionReview key={promotion.player.id} season={season} row={promotion} busy={busy} onOffer={onPromoteAcademy} onWithdraw={onWithdrawPromotion} onClose={closePromotion} />}
      {selected && <section className="academy-profile panel" aria-labelledby="academy-profile-title"><header className="academy-heading"><div><h2 id="academy-profile-title">{selected.player.name}</h2><span>Skill development</span></div><span>{gains(selected)} skill {gains(selected) === 1 ? 'gain' : 'gains'} earned</span></header>{performance && <div className="academy-match-record" aria-label="Current youth season performance"><span><strong>{performance.appearances}</strong> {performance.appearances === 1 ? 'appearance' : 'appearances'}</span><span><strong>{Math.floor(performance.secondsPlayed / 60)}</strong> {Math.floor(performance.secondsPlayed / 60) === 1 ? 'minute' : 'minutes'}</span><span><strong>{performance.points}</strong> {performance.points === 1 ? 'point' : 'points'}</span><span><strong>{performance.rebounds}</strong> {performance.rebounds === 1 ? 'rebound' : 'rebounds'}</span><span><strong>{performance.assists}</strong> {performance.assists === 1 ? 'assist' : 'assists'}</span></div>}<div className="academy-skills">{TRAINING_ATTRIBUTES.map(key => { const growth = youthGrowth(season, selected.player.id); const capped = selected.points[key] >= academyPointCap(selected.prospect.player.attributes[key]); return <div key={key} className="academy-skill"><div><span>{TRAINING_FOCUS_LABELS[key]}</span><strong><GrowthMarker change={growth?.attributes[key]} label={TRAINING_FOCUS_LABELS[key]} since={growth?.since ?? 'last week'} />{selected.player.attributes[key]} <small>/ 20</small></strong></div><span className="academy-skill-bar" aria-hidden="true"><span style={{ width: `${selected.player.attributes[key] * 5}%` }} /></span><small>{capped ? 'Academy limit reached' : `${selected.points[key] % 100}% to next gain`}{selected.lastWeek && selected.lastWeek.player.gains[key] > 0 ? ` · +${selected.lastWeek.player.gains[key]} points last week` : ''}</small></div> })}</div></section>}
      {latestWeek && latestWeekPlayers.length > 0 && <details className="academy-week panel" data-academy-week={latestWeek.id}><summary><Icon name="training" size={16} /><strong>Latest development report</strong><span>{scoutingDate(latestWeek.fromDate)}–{scoutingDate(latestWeek.toDate)}</span></summary><div className="academy-week-body"><div className="academy-report-author"><Icon name="staff" size={18} /><span>{latestWeek.coaches[club.id] ? coachName(latestWeek.coaches[club.id]!.coachId) : 'Club development'}<small>Recorded staff and gains for this week</small></span></div><div className="academy-table-scroll"><table className="academy-table"><thead><tr><th>Prospect</th><th>Focus</th><th>Practice earned</th><th>From youth coach</th><th>Skill gains</th></tr></thead><tbody>{latestWeekPlayers.map(([id, report]) => { const prospect = season.academy.prospects.find(item => item.player.id === id)!; return <tr key={id}><th>{prospect.player.name}</th><td>{TRAINING_FOCUS_LABELS[report.focus]}</td><td>{total(report.gains)} points<FacilityPracticeContribution report={report.facility} youth />{report.availability && <small className="academy-practice-days">{report.availability.availableDays} medically available {report.availability.availableDays === 1 ? 'day' : 'days'}</small>}</td><td data-academy-coaching-gain={id}>+{total(report.coachingGains)} points</td><td>{TRAINING_ATTRIBUTES.reduce((sum, key) => sum + Math.floor(report.pointsAfter[key] / 100) - Math.floor(report.pointsBefore[key] / 100), 0)}</td></tr> })}</tbody></table></div></div></details>}
      {graduates.length > 0 && <details className="academy-history panel"><summary><Icon name="people" size={16} />Academy departures <span>{graduates.length}</span></summary><div>{graduates.map(entry => <div className="academy-history-row" key={entry.id} data-academy-graduate={entry.player.id}><Avatar player={entry.player} size={34} color={club.color} /><span><strong>{entry.player.name}</strong><small>{entry.kind === 'promotion' ? 'Promoted to senior squad' : 'Left academy for free agency'} &middot; {scoutingDate(entry.graduatedOn)}</small></span><button className="button small" onClick={() => onOpenPlayer(entry.player.id)} disabled={busy}>View player<Icon name="chevron" size={13} /></button></div>)}</div></details>}
      <details className="academy-rules panel"><summary>Development, intake &amp; promotion</summary><p>{competitionEnabled ? 'Prospects earn practice on medically available days between matchdays, up to 28 points per academy week, plus any youth-coach or facility contribution. Youth matches do not add extra practice points.' : 'Prospects receive 28 practice points each completed academy week, plus any youth-coach or facility contribution.'} Focus directs those points; 100 points improves a skill by one. Each skill can rise by up to three points in the academy, to a maximum of 20. Balanced focus shares practice across all seven skills.</p><p>{competitionEnabled ? 'The academy has eight places. New prospects fill available places when youth matches are enabled and at each season opening. There are no midseason replacements.' : 'Two new prospects arrive at each season opening, with six academy places in total.'} Players aged 21 or older leave for the free-agent pool on opening day. A promotion offer reserves a senior squad place and remaining salary costs. The player must accept; a declined or withdrawn offer leaves him in the academy.</p></details>
    </AcademyCompetition>}
  </div>
}
