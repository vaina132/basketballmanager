import { getCareerPlayer } from '../world/player-catalog'
import { useState } from 'react'
import type { SeasonState } from '../domain/season'
import { injuryLabel } from '../domain/injuries'
import { DEVELOPMENT_PHYSIOS } from '../data/development-physios'
import { daysUntilReturn, getClubMedicalCases, getInjuryMedicalSummary, getPlayerMedicalSummary, getSeasonInjuries } from '../world/health'
import { getClubPhysio } from '../world/physio-policy'
import { Avatar } from './Avatar'
import { Icon } from './Icon'
import { StaminaMeter } from './StaminaMeter'
import { PhysioPortrait } from './PhysioBenefits'
import { medicalDate } from './SeasonMedicalReport'
import './medical-workspace.css'
import { seasonRounds } from '../world/career-world'
import { PHYSIO_DIRECTORY } from '../data/staff-directory'

type MedicalCase = NonNullable<ReturnType<typeof getPlayerMedicalSummary>>
type MedicalView = 'recovering' | 'cleared' | 'history'
interface MedicalWorkspaceProps { season: SeasonState; busy?: boolean; onSelectPlayer: (id: string) => void; onOpenPhysio: () => void; onOpenTraining: () => void }

export function MedicalWorkspace({ season, busy = false, onSelectPlayer, onOpenPhysio, onOpenTraining }: MedicalWorkspaceProps) {
  const [view, setView] = useState<MedicalView>('recovering')
  const club = season.clubs.find(item => item.id === season.managedClubId)!
  const roster = new Set(club.players.map(player => player.id))
  const active = getClubMedicalCases(season)
  const injured = new Set(active.map(summary => summary.injury.playerId))
  const history = getSeasonInjuries(season).filter(injury => injury.clubId === club.id || roster.has(injury.playerId)).map(injury => getInjuryMedicalSummary(season, injury))
  const cleared = history.filter(summary => roster.has(summary.injury.playerId) && !injured.has(summary.injury.playerId) && summary.effectiveReturnOn <= season.date && daysUntilReturn(summary.effectiveReturnOn, season.date) <= 7)
  const rows = [...(view === 'recovering' ? active : view === 'cleared' ? cleared : history)].sort((left, right) => view === 'recovering' ? left.effectiveReturnOn.localeCompare(right.effectiveReturnOn) || left.injury.playerId.localeCompare(right.injury.playerId) : right.injury.occurredOn.localeCompare(left.injury.occurredOn) || right.injury.id.localeCompare(left.injury.id))
  const contract = getClubPhysio(season)
  const physio = contract ? PHYSIO_DIRECTORY.find(item => item.id === contract.physioId)! : null
  const mode = { standard: 'Standard injuries', reduced: 'Reduced injuries', off: 'Injuries off' }[season.injuryMode]
  return <div className="medical-workspace">
    <section className="medical-command panel" aria-label="Club medical status"><div className="medical-counts"><div><Icon name="medical" size={19} /><strong data-medical-injured={injured.size}>{injured.size}</strong><span>Recovering</span></div><div><Icon name="check" size={19} /><strong>{club.players.length - injured.size}</strong><span>Medically available</span></div></div><button className="button small" onClick={onOpenTraining} disabled={busy}>Training<Icon name="training" size={14} /></button></section>
    <section className="medical-physio panel" aria-label="Appointed physio">{physio ? <PhysioPortrait coach={physio} color={club.color} size={48} /> : <span className="medical-physio-vacancy" aria-hidden="true"><Icon name="staff" size={26} /></span>}<div><span>Club physio</span><strong data-medical-physio={physio?.id ?? 'none'}>{physio?.name ?? 'No physio appointed'}</strong><small>{physio ? season.status === 'complete' || season.round === seasonRounds(season) ? 'No rehabilitation weeks left this season' : 'Automatic care after Continue' : 'Players recover on their existing schedule'}</small></div><button id="medical-manage-physio" className="button small" onClick={onOpenPhysio} disabled={busy}>{physio ? 'Manage physio' : 'Recruit physio'}<Icon name="chevron" size={14} /></button></section>
    <section className="medical-cases panel" aria-labelledby="medical-cases-title"><header className="medical-cases-header"><h2 id="medical-cases-title">Player recovery</h2><div className="segmented" role="group" aria-label="Medical view">{([{ id: 'recovering', label: 'Recovering', count: active.length }, { id: 'cleared', label: 'Recently cleared', count: cleared.length }, { id: 'history', label: 'History', count: history.length }] as const).map(item => <button key={item.id} id={`medical-view-${item.id}`} className={view === item.id ? 'selected' : ''} aria-pressed={view === item.id} onClick={() => setView(item.id)} disabled={busy}>{item.label}<span>{item.count}</span></button>)}</div></header>
      {view === 'cleared' && <p className="medical-filter-note">Cleared in the last seven days. Current condition remains separate from injury clearance.</p>}
      <div className="medical-case-list">{rows.map(summary => <MedicalCaseRow key={summary.injury.id} season={season} summary={summary} busy={busy} onSelectPlayer={onSelectPlayer} />)}{!rows.length && <div className="medical-clear-state"><Icon name={view === 'recovering' ? 'check' : 'calendar'} size={25} /><div><strong>{view === 'recovering' ? 'No players recovering from injury' : view === 'cleared' ? 'No recent returns' : 'No recorded injuries'}</strong><p>{view === 'recovering' ? `${club.players.length} squad players are medically available.` : view === 'cleared' ? 'Players cleared in the last seven days appear here.' : 'Injury records appear here as the season progresses.'}</p></div></div>}</div>
    </section>
    <details className="medical-rules panel game-disclosure"><summary><Icon name="medical" size={15} />Recovery information <span>{mode}</span></summary><div><p>Injury availability follows the simulated date and is separate from stamina or foul exclusions. A physio supports recovery between matchdays after Continue; treatment never changes the match already prepared. The original injury and all completed treatment reviews remain in the records.</p><p>{mode} applies equally to every club. No rehabilitation treatment runs during the offseason.</p></div></details>
  </div>
}

function MedicalCaseRow({ season, summary, busy, onSelectPlayer }: { season: SeasonState; summary: MedicalCase; busy: boolean; onSelectPlayer: (id: string) => void }) {
  const { injury } = summary
  const currentClub = season.clubs.find(club => club.players.some(player => player.id === injury.playerId))
  const inSquad = currentClub?.id === season.managedClubId
  const player = currentClub?.players.find(item => item.id === injury.playerId) ?? getCareerPlayer(season, injury.playerId)
  const originalClub = season.clubs.find(club => club.id === injury.clubId)!
  const recovering = summary.daysRemaining > 0
  const condition = inSquad ? season.status === 'complete' ? season.conditions[player.id] : season.activeMatch?.stats[player.id]?.condition ?? season.conditions[player.id] : null
  const physio = summary.lastReview ? PHYSIO_DIRECTORY.find(item => item.id === summary.lastReview?.physioId) : null
  const reviews = season.physio.rehabilitation.filter(record => record.injuryId === injury.id && record.toDate <= season.date).slice().sort((left, right) => right.toDate.localeCompare(left.toDate))
  return <article className={`medical-case${recovering ? ' is-recovering' : ''}`} data-medical-injury={injury.id} data-medical-player={player.id}>
    <div className="medical-case-main"><div className="medical-case-identity"><Avatar player={player} color={currentClub?.color ?? originalClub.color} size={48} /><div>{inSquad ? <button className="text-button" onClick={() => onSelectPlayer(player.id)} disabled={busy}><strong>{player.name}</strong><Icon name="chevron" size={13} /></button> : <strong>{player.name}</strong>}<span>{player.position} &middot; {injuryLabel(injury.kind)}</span><small className={recovering ? 'medical-unavailable' : 'medical-cleared'}>{recovering ? 'Unavailable' : 'Cleared'}{!inSquad && ` / ${currentClub?.name ?? 'Free agent'}`}</small></div></div>
      <div className="medical-case-recovery"><div><span>{recovering ? 'Expected return' : 'Cleared on'}</span><strong data-medical-return={summary.effectiveReturnOn}><time dateTime={summary.effectiveReturnOn}>{medicalDate(summary.effectiveReturnOn)}</time></strong></div><progress value={summary.progress} max={100} aria-label={`${player.name} recovery period ${Math.round(summary.progress)} percent elapsed`} /><div><small>Recovery period</small><span>{recovering ? `${summary.daysRemaining} ${summary.daysRemaining === 1 ? 'day' : 'days'} left` : 'Complete'}</span></div></div>
      <div className="medical-case-condition"><span>Current condition</span>{condition === null || condition === undefined ? <small>No longer in squad</small> : <StaminaMeter value={condition} label={`${player.name} current condition`} compact />}</div>
    </div>
    <div className="medical-case-status">{summary.pending ? <span><Icon name="clock" size={14} />New injury &middot; medical review after Continue</span> : summary.daysSaved > 0 ? <span className="medical-treatment-benefit" data-medical-days-saved={summary.daysSaved}><Icon name="medical" size={14} />Recovery shortened by {summary.daysSaved} {summary.daysSaved === 1 ? 'day' : 'days'}</span> : <span><Icon name="calendar" size={14} />Recovery follows the current return date</span>}</div>
    <details className="medical-case-details"><summary>Injury &amp; treatment details</summary><div className="medical-case-record"><dl><div><dt>Injured</dt><dd>{medicalDate(injury.occurredOn)}</dd></div><div><dt>Original expected return</dt><dd>{medicalDate(summary.originalReturnOn)}</dd></div><div><dt>Current expected return</dt><dd>{medicalDate(summary.effectiveReturnOn)}</dd></div><div><dt>Recorded at</dt><dd>{originalClub.name}</dd></div>{physio && <div><dt>Last treatment by</dt><dd>{physio.name}</dd></div>}</dl><p>{summary.pending ? 'This match incident has not been committed yet. Recovery reviews begin after Continue.' : summary.lastReview ? 'Completed care is retained after staff or club changes. The current return date includes only treatment already recorded.' : 'No physio treatment has been recorded for this injury.'}</p></div>{reviews.length > 0 && <ol className="medical-treatment-history" aria-label={`${player.name} treatment history`}>{reviews.map(review => <li key={review.id} data-treatment-record={review.id}><div><strong>{PHYSIO_DIRECTORY.find(item => item.id === review.physioId)!.name}</strong><span>{season.clubs.find(item => item.id === review.clubId)!.name}</span></div><div><span>{medicalDate(review.fromDate)} &ndash; {medicalDate(review.toDate)}</span><small>{review.eligibleDays} injured {review.eligibleDays === 1 ? 'day' : 'days'} treated</small></div><div><span>Expected return</span><strong>{medicalDate(review.returnAfter)}</strong>{review.returnBefore !== review.returnAfter && <small>Previously {medicalDate(review.returnBefore)}</small>}</div></li>)}</ol>}</details>
  </article>
}
