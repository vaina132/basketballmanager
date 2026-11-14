import type { SeasonState } from '../domain/season'
import { managedSide } from '../world/season'
import { canSelectMatchday } from '../world/matchday-selection'
import { Icon } from './Icon'
import './matchday-squad.css'

export function MatchdaySquad({ season, busy, onAutomatic }: { season: SeasonState; busy: boolean; onAutomatic: () => void }) {
  const club = season.clubs.find(club => club.id === season.managedClubId)!
  const selected = season.activeMatch[managedSide(season)].players.length
  const editable = canSelectMatchday(season)
  return <section className="panel matchday-squad" aria-label="Matchday selection">
    <div><Icon name="court" size={20} /><strong>{selected} / 12</strong><span>Matchday squad</span><small>{club.players.length} at club</small></div>
    <div><span>{editable ? 'Select players in the list below' : 'Selection locked for this match'}</span><button className="button small" disabled={busy || !editable} onClick={onAutomatic}><Icon name="staff" size={15} />Assistant selection</button></div>
  </section>
}
