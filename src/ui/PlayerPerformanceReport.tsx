import { useEffect, useRef } from 'react'
import type { SeasonState } from '../domain/season'
import type { SeasonPlayerPerformance } from '../world/performance'
import { performanceValue } from '../world/performance'
import { playerPIR } from '../world/performance-rating'
import { MatchRating } from './PlayerRating'
import { PIR_HELP } from './MatchBoxScore'
import { seasonLabel } from '../world/season'
import { Avatar } from './Avatar'
import { Icon } from './Icon'
import { formatPerformanceValue } from './PerformanceTable'
import './player-performance.css'

interface PlayerPerformanceReportProps {
  season: SeasonState
  record: SeasonPlayerPerformance
  onClose?: () => void
  onReviewFixture?: (fixtureId: string) => void
}

const dates = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const minutes = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

/** Public match performances only: this report never reveals an opponent's skill ratings. */
export function PlayerPerformanceReport({ season, record, onClose, onReviewFixture }: PlayerPerformanceReportProps) {
  const region = useRef<HTMLElement>(null)
  useEffect(() => {
    region.current?.focus({ preventScroll: true })
    region.current?.scrollIntoView({ block: 'start' })
  }, [record.key])
  const { player, club } = record
  return <section ref={region} id="player-performance-report" className="player-performance-report panel" data-player-id={player.id} data-record-key={record.key} tabIndex={-1} aria-labelledby="player-performance-title" onKeyDown={event => { if (event.key === 'Escape' && onClose) { event.preventDefault(); event.stopPropagation(); onClose() } }}>
    <header className="player-performance-heading">
      <div className="player-performance-identity"><Avatar player={player} color={club.color} size={38} /><div><h2 id="player-performance-title">{player.name}</h2><p>{club.name} · #{player.number} · {player.position}</p></div></div>
      {onClose && <button className="text-button" onClick={onClose} aria-label="Close player performance"><Icon name="close" size={15} />Close</button>}
    </header>
    <div className="player-performance-overview">
      <div><strong>{seasonLabel(record.seasonNumber)}</strong><span>{record.games} {record.games === 1 ? 'appearance' : 'appearances'} / {record.clubGames} club games</span></div>
      <dl>{([{ metric: 'minutes', label: 'MIN / G' }, { metric: 'points', label: 'PTS / G' }, { metric: 'rebounds', label: 'REB / G' }, { metric: 'assists', label: 'AST / G' }] as const).map(({ metric, label }) => <div key={metric}><dt>{label}</dt><dd>{formatPerformanceValue(performanceValue(record, metric, 'per-game'), metric, 'per-game')}</dd></div>)}</dl>
    </div>
    <div className="player-performance-log-heading"><h3>Match history</h3><span>Latest first · committed results</span></div>
    {!!record.summaryGames && <p className="player-performance-note">Season totals also include {record.summaryGames} matches without detailed box scores.</p>}
    {record.log.length ? <div className="player-performance-scroll" role="region" aria-label={`${player.name} match history`} tabIndex={0}>
      <table className="player-performance-log"><thead><tr><th scope="col">Date</th><th scope="col">Opponent</th><th scope="col">Result</th><th scope="col">Participation</th><th scope="col">Rating</th><th scope="col" title={PIR_HELP}>PIR</th><th scope="col" title="Minutes and seconds played">Min</th><th scope="col" title="Points">Pts</th><th scope="col" title="Rebounds">Reb</th><th scope="col" title="Assists">Ast</th><th scope="col" title="Steals">Stl</th><th scope="col" title="Blocks">Blk</th><th scope="col" title="Turnovers">TO</th><th scope="col" title="Field goals made / attempted">FG</th><th scope="col" title="Three-pointers made / attempted">3PT</th><th scope="col" title="Free throws made / attempted">FT</th><th scope="col" title="Personal fouls">PF</th></tr></thead><tbody>{record.log.map(game => {
        const opponent = season.clubs.find(team => team.id === game.opponentClubId)!
        const played = game.participation === 'played'
        const stat = game.stats
        return <tr key={game.fixtureId} data-fixture-id={game.fixtureId}>
          <td><time dateTime={game.date}>{dates.format(new Date(`${game.date}T00:00:00Z`))}</time>{onReviewFixture ? <button className="text-button player-performance-review" onClick={() => onReviewFixture(game.fixtureId)} aria-label={`Review matchday ${game.round} against ${opponent.name}`}>Matchday {game.round}<Icon name="chevron" size={12} /></button> : <small>Matchday {game.round}</small>}</td>
          <th scope="row"><span title={opponent.name}>{opponent.shortName}</span><small>{game.home ? 'Home' : 'Away'}</small></th>
          <td><span className={`performance-result ${game.result === 'W' ? 'performance-win' : ''}`}><b>{game.result}</b> {game.teamScore}–{game.opponentScore}</span>{game.kind === 'default' ? <small>Awarded by default</small> : game.periods > 4 ? <small>{game.periods - 4} OT</small> : null}</td>
          <td>{played ? 'Played' : game.participation === 'injured' ? 'Injured · did not play' : 'Did not play'}</td>
          <td><MatchRating stats={stat} compact /></td><td>{played ? playerPIR(stat) : '—'}</td><td>{played ? minutes(stat.secondsPlayed) : '—'}</td><td>{played ? stat.points : '—'}</td><td>{played ? stat.rebounds : '—'}</td><td>{played ? stat.assists : '—'}</td><td>{played ? stat.steals : '—'}</td><td>{played ? stat.blocks : '—'}</td><td>{played ? stat.turnovers : '—'}</td><td>{played ? `${stat.fieldGoalsMade}/${stat.fieldGoalsAttempted}` : '—'}</td><td>{played ? `${stat.threePointersMade}/${stat.threePointersAttempted}` : '—'}</td><td>{played ? `${stat.freeThrowsMade}/${stat.freeThrowsAttempted}` : '—'}</td><td>{played ? stat.fouls : '—'}</td>
        </tr>
      })}</tbody></table>
    </div> : <p className="player-performance-empty">{record.summaryGames ? 'Season totals are available above. Individual box scores were not retained for these matches.' : 'No committed games this season. Finish a matchday and Continue to record its results.'}</p>}
    <p className="player-performance-note">Averages use appearances; games without participation are excluded. Results show your selected player’s club first. Awarded scores do not add player points.</p>
  </section>
}
