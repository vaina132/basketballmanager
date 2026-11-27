import { useState } from 'react'
import type { SeasonState } from '../domain/season'
import type { Position } from '../domain/types'
import { draftClassOf, heldDraftRights, isDraftComplete } from '../world/draft-index'
import { draftDayOf, europeanProspects, managerOnTheClock, prospectKnowledge, seasonLottery, seasonProspects } from '../world/nba-draft-policy'
import { NBA_DRAFT_RULES } from '../world/nba-draft'
import { getCareerPlayer, getCareerPlayerAge } from '../world/player-catalog'
import { getPlayerKnowledge, getPotentialKnowledge } from '../world/scouting-policy'
import { contractForSeason } from '../world/employment-policy'
import { isMarketActive } from '../world/market-policy'
import { playerAgeOnDate } from '../data/development-player-profiles'
import { PlayerRating } from './PlayerRating'
import { Nationality, playerNationality } from './Nationality'
import { medicalDate } from './SeasonMedicalReport'
import './nba-draft.css'

interface NbaDraftProps {
  season: SeasonState
  disabled: boolean
  onPick: (playerId: string) => void
  onDelegate: () => void
  onBringOver: (playerId: string) => void
}

interface BoardRow { id: string; name: string; position: Position; age: number | null; nationality: string | null; club: string | null; generated: boolean; ability: ReturnType<typeof getPlayerKnowledge>; potential: ReturnType<typeof getPlayerKnowledge> }

/**
 * NBA step 8 (format 95): Transfers > Draft. From February the season's prospects with the manager's scouting
 * estimates; once the play-in has decided the field, the lottery and the order; on draft day the picks, with "Make
 * pick" while his club is on the clock. An NBA club's draft rights for players left at European clubs, with "Bring
 * over" in the offseason. Every value comes from the career's draft rules and journal.
 */
export function NbaDraft({ season, disabled, onPick, onDelegate, onBringOver }: NbaDraftProps) {
  const [filter, setFilter] = useState<'available' | 'all'>('available')
  const name = (clubId: string) => season.clubs.find(club => club.id === clubId)?.name ?? clubId
  const recorded = draftClassOf(season, season.seasonNumber)
  const lottery = seasonLottery(season)
  const onClock = managerOnTheClock(season)
  const day = draftDayOf(season)
  const picks = recorded?.picks ?? []
  const taken = new Map(picks.map(pick => [pick.playerId, pick]))
  const rows: BoardRow[] = [
    ...seasonProspects(season).map(prospect => {
      const knowledge = prospectKnowledge(season, prospect)
      return { id: prospect.player.id, name: prospect.player.name, position: prospect.player.position, age: playerAgeOnDate(prospect.dateOfBirth, day), nationality: prospect.nationality, club: null, generated: true, ability: knowledge.ability, potential: knowledge.potential }
    }),
    ...(recorded ? recorded.europeans ?? [] : europeanProspects(season)).map(id => {
      const player = getCareerPlayer(season, id), contract = contractForSeason(season.employment, id, season.seasonNumber)
      return { id, name: player.name, position: player.position, age: getCareerPlayerAge(season, id, day), nationality: playerNationality(season, id), club: contract ? name(contract.clubId) : null, generated: false, ability: getPlayerKnowledge(season, id), potential: getPotentialKnowledge(season, id) }
    }),
  ]
  const shown = rows.filter(row => filter === 'all' || !taken.has(row.id))
  const ownPicks = (lottery?.order ?? []).flatMap((clubId, index) => clubId === season.managedClubId ? [index + 1] : [])
  const rights = heldDraftRights(season).filter(right => right.clubId === season.managedClubId)
  const canBringOver = isMarketActive(season) && (!recorded || isDraftComplete(recorded))
  const status = !recorded ? `Draft day: ${medicalDate(day)}${lottery ? '' : ' · the lottery follows the play-in'}` : isDraftComplete(recorded) ? 'The draft is over' : onClock ? `You are on the clock · pick ${picks.length + 1}` : `Pick ${picks.length + 1} of ${recorded.order.length}`

  return <section className="nba-draft" aria-labelledby="nba-draft-heading" data-nba-draft>
    <header className="nba-draft-bar panel"><h3 id="nba-draft-heading">NAL draft</h3><span>{status}</span>
      {onClock && <button className="text-button" onClick={onDelegate} disabled={disabled}>Let your assistant pick</button>}</header>
    {lottery && <div className="nba-draft-top">
      <section className="panel nba-draft-lottery" aria-labelledby="nba-lottery-heading">
        <h4 id="nba-lottery-heading">Lottery</h4>
        <ol>{lottery.lottery.drawn.map((clubId, index) => <li key={clubId}><strong>Pick {index + 1}</strong> {name(clubId)} <small>{(NBA_DRAFT_RULES.lotteryOdds[lottery.lottery.clubs.indexOf(clubId)]! / 10).toFixed(1)}% odds</small></li>)}</ol>
        <p className="muted">The 14 clubs outside the playoffs, worst record first: {lottery.lottery.clubs.map(name).join(', ')}.</p>
        {ownPicks.length > 0 && <p>Your picks: {ownPicks.join(', ')}.</p>}
      </section>
      <section className="panel nba-draft-order" aria-labelledby="nba-order-heading">
        <h4 id="nba-order-heading">Order</h4>
        <div className="nba-draft-scroll" tabIndex={0} role="region" aria-label="Draft order"><table><thead><tr><th scope="col">Pick</th><th scope="col">Club</th><th scope="col">Selection</th></tr></thead><tbody>
          {lottery.order.map((clubId, index) => { const pick = picks[index]; return <tr key={index} className={clubId === season.managedClubId ? 'nba-draft-own' : undefined}><td>{index + 1}{index === 29 ? ' ·' : ''}</td><td>{name(clubId)}</td><td>{pick ? <>{getCareerPlayer(season, pick.playerId).name}{pick.by === 'manager' ? ' (your pick)' : ''}{pick.contractId ? '' : rights.some(right => right.playerId === pick.playerId) || (season.draft?.rights ?? []).some(right => right.playerId === pick.playerId) ? ' · stays in Europe' : ' · unsigned'}</> : '—'}</td></tr> })}
        </tbody></table></div>
      </section>
    </div>}
    <section className="panel nba-draft-board" aria-labelledby="nba-board-heading">
      <header><h4 id="nba-board-heading">Prospects</h4>
        <div className="segmented" role="group" aria-label="Prospects shown"><button aria-pressed={filter === 'available'} className={filter === 'available' ? 'selected' : ''} onClick={() => setFilter('available')}>Available</button><button aria-pressed={filter === 'all'} className={filter === 'all' ? 'selected' : ''} onClick={() => setFilter('all')}>All</button></div></header>
      <p className="muted">Estimates from your scouting network: stars show the likely range. Generated prospects are fictional players the game created for the draft.</p>
      <div className="nba-draft-scroll" tabIndex={0} role="region" aria-label="Draft prospects"><table><thead><tr><th scope="col">Player</th><th scope="col">Pos</th><th scope="col">Age</th><th scope="col">Ability</th><th scope="col">Potential</th><th scope="col"><span className="sr-only">Action</span></th></tr></thead><tbody>
        {shown.map(row => { const pick = taken.get(row.id); return <tr key={row.id}>
          <th scope="row"><span className="nba-draft-player">{row.name}{row.generated && <small className="generated-tag" title="Generated player: a fictional prospect the game created for the draft">Generated</small>}<small><Nationality country={row.nationality} compact />{row.club ? ` ${row.club}` : ''}</small></span></th>
          <td>{row.position}</td><td>{row.age ?? '—'}</td>
          <td><PlayerRating knowledge={row.ability} position={row.position} compact /></td>
          <td><PlayerRating knowledge={row.potential} position={row.position} compact label="Potential" /></td>
          <td>{pick ? <small>Pick {pick.pick} · {name(pick.clubId)}</small> : onClock ? <button className="primary-button" onClick={() => onPick(row.id)} disabled={disabled}>Make pick</button> : null}</td>
        </tr> })}
      </tbody></table></div>
    </section>
    {rights.length > 0 && <section className="panel nba-draft-rights" aria-labelledby="nba-rights-heading">
      <h4 id="nba-rights-heading">Draft rights</h4>
      <p className="muted">Players your club drafted who stay at their European clubs. Bringing one over pays his club its asking fee; he then decides on your offer.</p>
      <table><thead><tr><th scope="col">Player</th><th scope="col">Club</th><th scope="col">Drafted</th><th scope="col"><span className="sr-only">Action</span></th></tr></thead><tbody>
        {rights.map(right => { const contract = contractForSeason(season.employment, right.playerId, season.seasonNumber + (season.status === 'complete' ? 1 : 0)); return <tr key={right.playerId}><th scope="row">{getCareerPlayer(season, right.playerId).name}</th><td>{contract ? name(contract.clubId) : 'No contract'}</td><td>Pick {right.pick}</td><td>{canBringOver ? <button className="text-button" onClick={() => onBringOver(right.playerId)} disabled={disabled}>Bring over</button> : <small>In the offseason</small>}</td></tr> })}
      </tbody></table>
    </section>}
  </section>
}
