import type { SeasonState } from '../domain/season'
import { managedSide } from '../world/season'
import { canSelectMatchday } from '../world/matchday-selection'
import { Icon } from './Icon'
import { automaticChoiceLabels } from './automatic-choice'
import './matchday-squad.css'

/** `assistantName`: the hired assistant coach; without one, the automatic squad is the manager's own automatic pick. */
export function MatchdaySquad({ season, busy, onAutomatic, assistantName }: { season: SeasonState; busy: boolean; onAutomatic: () => void; assistantName?: string }) {
  const club = season.clubs.find(club => club.id === season.managedClubId)!
  const selected = season.activeMatch ? season.activeMatch[managedSide(season)].players.length : 0
  const editable = canSelectMatchday(season)
  return <section className="panel matchday-squad" aria-label="Matchday selection">
    <div><Icon name="court" size={20} /><strong>{selected} / 12</strong><span>Matchday squad</span><small>{club.players.length} at club</small></div>
    <div><span>{editable ? 'Select players in the list below' : 'Selection locked for this match'}</span><button className="button small" disabled={busy || !editable} onClick={onAutomatic}><Icon name={assistantName ? 'staff' : 'people'} size={15} />{automaticChoiceLabels(assistantName).selection}</button></div>
  </section>
}
