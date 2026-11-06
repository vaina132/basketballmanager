import { useId, useState } from 'react'
import type { MatchState, Player, Side } from '../domain/types'
import { Avatar } from './Avatar'
import { StaminaMeter } from './StaminaMeter'
import './match-lineup.css'

function LineupPlayer({ player, match, side, active }: { player: Player; match: MatchState; side: Side; active: boolean }) {
  const stats = match.stats[player.id]
  const unavailable = match.injuries[player.id] ? 'Injured' : stats.fouls >= 5 ? 'Fouled out' : null

  return <article className={`lineup-player${unavailable ? ' lineup-player-unavailable' : ''}`} data-player-id={player.id} data-roster-status={unavailable ?? (active ? 'active' : 'bench')} aria-label={`${player.name}, ${unavailable ?? (active ? 'on court' : 'bench')}`}>
    <div className="lineup-player-heading">
      <Avatar player={player} color={match[side].color} size={34} />
      <div className="lineup-player-identity"><strong title={player.name}>{player.name}</strong><span>#{player.number} <i /> {player.position}<span className={stats.fouls >= 4 ? 'lineup-foul-trouble' : ''}> {stats.fouls} {stats.fouls === 1 ? 'foul' : 'fouls'}</span></span></div>
    </div>
    <StaminaMeter value={stats.condition} label={`${player.name} stamina`} />
    {unavailable && <span className="lineup-unavailable-label">{unavailable}</span>}
  </article>
}

export function MatchLineup({ match, managedSide = 'home' }: { match: MatchState; managedSide?: Side }) {
  const [showOpponent, setShowOpponent] = useState(false)
  const side: Side = showOpponent ? managedSide === 'home' ? 'away' : 'home' : managedSide
  const [benchOpen, setBenchOpen] = useState(false)
  const benchId = useId()
  const team = match[side]
  const active = match.lineups[side].flatMap(id => {
    const player = team.players.find(player => player.id === id)
    return player ? [player] : []
  })
  const bench = team.players.filter(player => !match.lineups[side].includes(player.id))

  return <section className="match-lineup" aria-label="Player stamina">
    <div className="lineup-toolbar">
      <div className="lineup-title"><span className="lineup-live-dot" /><h3>On the floor</h3><span>Stamina</span></div>
      <div className="lineup-team-switch" aria-label="Lineup team">{(['home', 'away'] as const).map(value => <button key={value} type="button" onClick={() => setShowOpponent(value !== managedSide)} aria-pressed={side === value} className={side === value ? 'selected' : ''}><span style={{ backgroundColor: match[value].color }} />{match[value].shortName}<small>{value === managedSide ? 'Your team' : 'Opponent'}</small></button>)}</div>
      <button className="lineup-bench-toggle" type="button" aria-expanded={benchOpen} aria-controls={benchId} onClick={() => setBenchOpen(value => !value)}>{benchOpen ? 'Hide bench' : 'Show bench'} <span>{bench.length}</span><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
    </div>
    <div className="lineup-grid" aria-label={`${team.name} on court`}>{active.map(player => <LineupPlayer key={player.id} player={player} match={match} side={side} active />)}</div>
    {active.length === 0 && <p className="lineup-empty">No players on court.</p>}
    <div id={benchId} className="lineup-bench" hidden={!benchOpen}>
      <div className="lineup-bench-heading"><h3>On the bench</h3><span>Stamina recovers while resting</span></div>
      {bench.length ? <div className="lineup-grid" aria-label={`${team.name} bench`}>{bench.map(player => <LineupPlayer key={player.id} player={player} match={match} side={side} active={false} />)}</div> : <p className="lineup-empty">No reserves available.</p>}
    </div>
  </section>
}
