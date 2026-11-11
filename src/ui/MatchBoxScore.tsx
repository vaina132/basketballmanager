import type { MatchState, Side } from '../domain/types'
import type { PlayerKnowledge } from '../domain/scouting'
import { GAME_PIR_DESCRIPTION, hasPlayerParticipated, playerPIR } from '../world/performance-rating'
import { MatchRating, PlayerRating } from './PlayerRating'
import { StaminaMeter } from './StaminaMeter'

export const PIR_HELP = GAME_PIR_DESCRIPTION

export function MatchBoxScore({ match, side, onSideChange, knowledgeForPlayer }: { match: MatchState; side: Side; onSideChange: (side: Side) => void; knowledgeForPlayer?: (id: string) => PlayerKnowledge }) {
  return <section className="panel boxscore-panel" aria-labelledby="match-boxscore-title">
    <div className="section-heading"><h2 id="match-boxscore-title">Box score</h2><div className="segmented" aria-label="Box score team">{(['home', 'away'] as const).map(value => <button key={value} aria-pressed={side === value} className={side === value ? 'selected' : ''} onClick={() => onSideChange(value)}>{match[value].shortName}</button>)}</div></div>
    <div className="table-scroll" tabIndex={0} role="region" aria-label="Match player statistics"><table className="boxscore"><thead><tr><th scope="col">Player</th><th scope="col">Rating</th><th scope="col"><abbr title={PIR_HELP}>PIR</abbr></th><th scope="col">Stamina</th><th scope="col">Min</th><th scope="col">Pts</th><th scope="col">Reb</th><th scope="col">Ast</th><th scope="col">FG</th><th scope="col">PF</th></tr></thead><tbody>{match[side].players.map(player => {
      const stats = match.stats[player.id], onCourt = match.lineups[side].includes(player.id)
      return <tr key={player.id} data-boxscore-player={player.id}><th scope="row"><div className="boxscore-player"><span className={`lineup-dot ${onCourt ? 'on' : ''}`} /><span className="jersey-number">{player.number}</span><span className="player-name">{player.name}</span><span className="position-label">{match.injuries[player.id] ? 'INJ' : stats.fouls >= 5 ? 'OUT' : player.position}</span></div><PlayerRating attributes={player.attributes} knowledge={knowledgeForPlayer?.(player.id)} compact label={`${player.name} overall ability`} /></th><td><MatchRating stats={stats} compact /></td><td className="pir-cell" data-player-pir={hasPlayerParticipated(stats) ? playerPIR(stats) : undefined}>{hasPlayerParticipated(stats) ? playerPIR(stats) : '—'}</td><td className="stamina-cell"><StaminaMeter value={stats.condition} label={`${player.name} stamina`} compact /></td><td>{Math.floor(stats.secondsPlayed / 60)}:{String(stats.secondsPlayed % 60).padStart(2, '0')}</td><td className="points-cell">{stats.points}</td><td>{stats.rebounds}</td><td>{stats.assists}</td><td>{stats.fieldGoalsMade}/{stats.fieldGoalsAttempted}</td><td>{stats.fouls}</td></tr>
    })}</tbody></table></div>
    <div className="table-legend"><span className="lineup-dot on" />On the court<span>Rating / 10</span><abbr title={PIR_HELP}>PIR</abbr></div>
  </section>
}
