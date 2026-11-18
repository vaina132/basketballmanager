import { useId, useMemo } from 'react'
import type { SeasonState } from '../domain/season'
import type { MatchState, Side } from '../domain/types'
import { setPlannedFive, startingFivePlanBlock, startingFivePlanMatch } from '../world/season'
import { isUnemployed } from '../world/career-rules'
import { getMatchPlayerKnowledge } from '../world/scouting-policy'
import { CourtFive } from './CourtFive'
import { Icon } from './Icon'
import './squad-starting-five.css'

interface SquadStartingFiveProps {
  season: SeasonState
  busy: boolean
  /** Runs a career change (the page's normal update; saving is manual). */
  onUpdate: (action: (state: SeasonState) => SeasonState) => void
  onOpenMatch: () => void
}

const sideOf = (match: MatchState, clubId: string): Side => match.home.id === clubId ? 'home' : 'away'

/**
 * The starting five for the next game on the Squad page (owner request, 18 November 2026): the court picture of the
 * Match center on the club's plan. Before tip-off it is the prepared match's five, so a change here shows in the Match
 * center and the other way round; between games it is the plan the next game starts from (`setPlannedFive`).
 */
export function SquadStartingFive({ season, busy, onUpdate, onOpenMatch }: SquadStartingFiveProps) {
  const benchId = useId()
  const block = startingFivePlanBlock(season)
  const match = useMemo(() => block ? null : startingFivePlanMatch(season), [season, block])
  if (season.status !== 'active' || isUnemployed(season)) return null
  const side = match ? sideOf(match, season.managedClubId) : null
  const opponent = match && side ? match[side === 'home' ? 'away' : 'home'] : null
  const apply = (action: (state: MatchState) => MatchState) => onUpdate(state => {
    const base = startingFivePlanMatch(state), own = sideOf(base, state.managedClubId), edited = action(base)
    return edited === base ? state : setPlannedFive(state, edited.lineups[own], edited.slots?.[own] ?? {})
  })
  return <section className="panel squad-starting-five" aria-labelledby={`${benchId}-title`}>
    <div className="section-heading">
      <h2 id={`${benchId}-title`}>Starting five</h2>
      {opponent && side && <span className="squad-starting-five-next">Next game: {side === 'home' ? 'vs' : 'at'} {opponent.name}</span>}
    </div>
    {match && side ? <CourtFive match={match} displayMatch={match} side={side} disabled={busy} benchOpen benchId={benchId} apply={apply} onInteractionStart={() => {}} knowledgeForPlayer={id => getMatchPlayerKnowledge(season, id)} planning />
      : <div className="squad-starting-five-locked"><p>{block}</p>{season.activeMatch && season.activeMatch.status !== 'finished' && <button type="button" className="button small" onClick={onOpenMatch}><Icon name="court" size={15} />Open Match center</button>}</div>}
  </section>
}
