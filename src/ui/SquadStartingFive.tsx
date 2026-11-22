import { useId, useMemo } from 'react'
import type { SeasonState } from '../domain/season'
import type { MatchState, Side } from '../domain/types'
import { setPlannedFive, startingFivePlanBlock, startingFivePlanMatch } from '../world/season'
import { autoPickSquad, getSquadBoard, isSquadPlayerUnavailable, moveSquadPlayer, type SquadSpot } from '../world/squad-board'
import { isUnemployed } from '../world/career-rules'
import { getMatchPlayerKnowledge } from '../world/scouting-policy'
import { CourtFive, type SquadControls } from './CourtFive'
import { Icon } from './Icon'
import { playerNationality } from './Nationality'
import './squad-starting-five.css'

interface SquadStartingFiveProps {
  season: SeasonState
  busy: boolean
  /** Runs a career change (the page's normal update; saving is manual). */
  onUpdate: (action: (state: SeasonState) => SeasonState) => void
  onOpenMatch: () => void
}

const sideOf = (match: MatchState, clubId: string): Side => match.home.id === clubId ? 'home' : 'away'
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error)

/**
 * The starting five for the next game on the Squad page (owner request, 18 November 2026): the court picture of the
 * Match center on the club's plan. Before tip-off it is the prepared match's five, so a change here shows in the Match
 * center and the other way round; between games it is the plan the next game starts from (`setPlannedFive`).
 * Owner feedback (22 November 2026): the bench and the reserves sit beside the court, and players move between all
 * three (`moveSquadPlayer`): the five and the matchday squad are what the next match uses. Auto-pick resets both.
 */
export function SquadStartingFive({ season, busy, onUpdate, onOpenMatch }: SquadStartingFiveProps) {
  const benchId = useId()
  const block = startingFivePlanBlock(season)
  const open = season.status === 'active' && !isUnemployed(season)
  const board = useMemo(() => block || !open ? null : getSquadBoard(season), [season, block, open])
  if (!open) return null
  const match = board?.match ?? null
  const side = match ? sideOf(match, season.managedClubId) : null
  const opponent = match && side ? match[side === 'home' ? 'away' : 'home'] : null
  const apply = (action: (state: MatchState) => MatchState) => onUpdate(state => {
    const base = startingFivePlanMatch(state), own = sideOf(base, state.managedClubId), edited = action(base)
    return edited === base ? state : setPlannedFive(state, edited.lineups[own], edited.slots?.[own] ?? {})
  })
  /** Runs a squad change on the current career; a refusal leaves it unchanged and is told on the court picture. */
  const run = (change: (state: SeasonState) => SeasonState): string | null => {
    let refused: string | null = null
    onUpdate(state => { try { return change(state) } catch (error) { refused = messageOf(error); return state } })
    return refused
  }
  const club = season.clubs.find(item => item.id === season.managedClubId)
  const squad: SquadControls | undefined = board && club ? {
    reserves: club.players.filter(player => board.reserves.includes(player.id)),
    reservesOpen: board.reservesOpen,
    limit: board.limit,
    unavailable: id => isSquadPlayerUnavailable(season, board, id),
    condition: id => season.conditions[id] ?? 100,
    move: (playerId: string, spot: SquadSpot) => run(state => moveSquadPlayer(state, playerId, spot)),
    autoPick: () => run(autoPickSquad),
  } : undefined
  return <section className="panel squad-starting-five" aria-labelledby={`${benchId}-title`}>
    <div className="section-heading">
      <h2 id={`${benchId}-title`}>Starting five, bench and reserves</h2>
      {opponent && side && <span className="squad-starting-five-next">Next game: {side === 'home' ? 'vs' : 'at'} {opponent.name}</span>}
    </div>
    {match && side ? <CourtFive match={match} displayMatch={match} side={side} disabled={busy} benchOpen benchId={benchId} apply={apply} onInteractionStart={() => {}} knowledgeForPlayer={id => getMatchPlayerKnowledge(season, id)} planning squad={squad} nationalityOf={id => playerNationality(season, id)} />
      : <div className="squad-starting-five-locked"><p>{block}</p>{season.activeMatch && season.activeMatch.status !== 'finished' && <button type="button" className="button small" onClick={onOpenMatch}><Icon name="court" size={15} />Open Match center</button>}</div>}
  </section>
}
