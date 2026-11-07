import { useState } from 'react'
import type { SeasonState } from '../domain/season'
import { daysUntilReturn, getPlayerHealth, getSeasonInjuries, isRecovering } from '../world/health'
import { Icon } from './Icon'
import './season-medical.css'

const dateFormatter = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
export const medicalDate = (date: string) => dateFormatter.format(new Date(`${date}T00:00:00Z`))
const injuryName = (kind: 'ankle' | 'muscle') => kind === 'ankle' ? 'Ankle injury' : 'Muscle injury'

export function PlayerHealthSummary({ season, playerId }: { season: SeasonState; playerId: string }) {
  const injury = getPlayerHealth(season, playerId)
  if (!injury) return null
  const days = daysUntilReturn(season.date, injury.returnOn)
  return <section className="profile-health" aria-label="Player recovery">
    <strong>{injuryName(injury.kind)}</strong>
    <span>Unavailable / {days} {days === 1 ? 'day' : 'days'} remaining</span>
    <dl><div><dt>Injured</dt><dd>{medicalDate(injury.occurredOn)}</dd></div><div><dt>Expected return</dt><dd>{medicalDate(injury.returnOn)}</dd></div></dl>
  </section>
}

export function SeasonMedicalReport({ season, onSelectPlayer }: { season: SeasonState; onSelectPlayer: (id: string) => void }) {
  const [history, setHistory] = useState(false)
  const club = season.clubs.find(team => team.id === season.managedClubId)!
  const episodes = getSeasonInjuries(season).filter(injury => injury.clubId === club.id)
  const recovering = episodes.filter(injury => isRecovering(injury, season.date))
  const rows = (history ? episodes : recovering).slice().sort((a, b) => b.occurredOn.localeCompare(a.occurredOn) || a.playerId.localeCompare(b.playerId))
  const mode = { standard: 'Standard injuries', reduced: 'Reduced injuries', off: 'Injuries off' }[season.injuryMode]
  return <section className="medical-report panel" aria-labelledby="medical-heading">
    <header className="medical-heading"><div><h2 id="medical-heading">Medical report</h2><span>{recovering.length} recovering / {club.players.length - recovering.length} medically available</span></div>
      <div className="segmented" aria-label="Medical report filter"><button aria-pressed={!history} className={!history ? 'selected' : ''} onClick={() => setHistory(false)}>Recovering</button><button aria-pressed={history} className={history ? 'selected' : ''} onClick={() => setHistory(true)}>History</button></div>
    </header>
    {rows.length ? <div className="table-scroll"><table className="medical-table"><thead><tr><th scope="col">Player</th><th scope="col">Injury</th><th scope="col">Injured</th><th scope="col">Availability</th><th scope="col">Expected return</th></tr></thead><tbody>{rows.map(injury => {
      const player = club.players.find(player => player.id === injury.playerId)!
      const active = isRecovering(injury, season.date)
      const days = daysUntilReturn(season.date, injury.returnOn)
      return <tr key={injury.id} data-injury-id={injury.id} data-player-id={player.id}>
        <td><button className="text-button medical-player" onClick={() => onSelectPlayer(player.id)} aria-label={`View ${player.name} recovery`}><strong>{player.name}</strong><Icon name="chevron" size={13} /></button></td>
        <td>{injuryName(injury.kind)}</td><td><time dateTime={injury.occurredOn}>{medicalDate(injury.occurredOn)}</time></td>
        <td><span className={active ? 'medical-unavailable' : 'medical-cleared'}>{active ? `Unavailable / ${days}d` : 'Cleared'}</span></td>
        <td><time dateTime={injury.returnOn}>{medicalDate(injury.returnOn)}</time></td>
      </tr>
    })}</tbody></table></div> : <p className="medical-empty">{history ? 'No injuries recorded for this squad.' : 'No players are currently recovering from injury.'}</p>}
    <footer className="medical-note"><span>{mode} / all clubs</span><p>Recovery follows the season calendar. Players are unavailable until their return date; foul exclusions apply only to the current match.</p></footer>
  </section>
}
