import type { SeasonState } from '../domain/season'
import { injuryLabel } from '../domain/injuries'
import { getClubMedicalCases, getPlayerMedicalSummary } from '../world/health'
import { Avatar } from './Avatar'
import { Icon } from './Icon'
import './season-medical.css'

const dateFormatter = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
export const medicalDate = (date: string) => dateFormatter.format(new Date(`${date}T00:00:00Z`))

export function PlayerHealthSummary({ season, playerId, onOpenMedical }: { season: SeasonState; playerId: string; onOpenMedical?: () => void }) {
  const summary = getPlayerMedicalSummary(season, playerId)
  if (!summary || summary.daysRemaining === 0) return null
  return <section className="profile-health" aria-label="Player recovery">
    <strong>{injuryLabel(summary.injury.kind)}</strong>
    <span>Unavailable / {summary.daysRemaining} {summary.daysRemaining === 1 ? 'day' : 'days'} remaining</span>
    <dl><div><dt>Expected return</dt><dd data-profile-medical-return={summary.effectiveReturnOn}>{medicalDate(summary.effectiveReturnOn)}</dd></div>{summary.daysSaved > 0 && <div><dt>Recovery shortened</dt><dd>{summary.daysSaved} {summary.daysSaved === 1 ? 'day' : 'days'}</dd></div>}</dl>
    <details><summary>Injury record</summary><dl><div><dt>Injured</dt><dd>{medicalDate(summary.injury.occurredOn)}</dd></div><div><dt>Original expected return</dt><dd>{medicalDate(summary.originalReturnOn)}</dd></div></dl></details>
    {onOpenMedical && <button className="text-button" onClick={onOpenMedical}>Open medical<Icon name="medical" size={14} /></button>}
  </section>
}

export function SeasonMedicalReport({ season, onSelectPlayer, onOpenMedical }: { season: SeasonState; onSelectPlayer: (id: string) => void; onOpenMedical: () => void }) {
  const club = season.clubs.find(team => team.id === season.managedClubId)!
  const cases = getClubMedicalCases(season)
  return <section className="medical-report panel" aria-labelledby="medical-heading"><header className="medical-heading"><div><h2 id="medical-heading">Medical report</h2><span>{cases.length} recovering / {club.players.length - cases.length} medically available</span></div><button className="button small" onClick={onOpenMedical}>Open medical<Icon name="medical" size={14} /></button></header>{cases.length ? <div className="squad-medical-summary">{cases.slice(0, 3).map(summary => {
    const player = club.players.find(item => item.id === summary.injury.playerId)!
    return <button key={summary.injury.id} className="squad-medical-player" onClick={() => onSelectPlayer(player.id)}><Avatar player={player} color={club.color} size={32} /><span><strong>{player.name}</strong><small>Expected {medicalDate(summary.effectiveReturnOn)}</small></span><Icon name="chevron" size={13} /></button>
  })}{cases.length > 3 && <button className="text-button" onClick={onOpenMedical}>View all {cases.length} recovering players<Icon name="chevron" size={13} /></button>}</div> : <p className="medical-empty">No players are currently recovering from injury.</p>}</section>
}
