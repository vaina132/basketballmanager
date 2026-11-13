import { useEffect, useRef, useState } from 'react'
import type { ArchivedFixture, SeasonFixture, SeasonState } from '../domain/season'
import type { Side, Team } from '../domain/types'
import { getActiveFixture, getStandings, seasonLabel } from '../world/season'
import { getFixtureTeams } from '../world/rosters'
import { managedClubFor } from '../world/career'
import { Icon } from './Icon'
import { SeasonLeaders } from './SeasonLeaders'
import { getFixtureMvp, hasPlayerParticipated, playerPIR, selectMatchMvp } from '../world/performance-rating'
import { MatchMvpCard } from './MatchMvpCard'
import { MatchRating } from './PlayerRating'
import { PIR_HELP } from './MatchBoxScore'
import './season-workspace.css'

interface SeasonWorkspaceProps {
  season: SeasonState | null
  onNewCareer: () => void
  onOpenMatch: () => void
  onAdvance: () => void
  onRollover: () => void
  onLoad: () => void
  busy?: boolean
}

const dateFormatter = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const formatDate = (date: string) => dateFormatter.format(new Date(`${date}T00:00:00Z`))
const difference = (value: number) => value > 0 ? `+${value}` : String(value)
const minutes = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

function ClubName({ club, yours = false }: { club: Team; yours?: boolean }) {
  return <span className="season-club-name"><span className="season-club-code" style={{ color: club.color }}>{club.shortName}</span><span>{club.name}{yours && <small>Your club</small>}</span></span>
}

export function SeasonWorkspace(props: SeasonWorkspaceProps) {
  if (!props.season) return <section className="panel season-intro" aria-label="Career required">
    <div><h2>No active career</h2><p>Start a career to manage a club through the development league.</p></div>
    <div className="season-setup-actions"><button className="button" onClick={props.onLoad} disabled={props.busy}>Load saved career</button><button className="button primary" onClick={props.onNewCareer} disabled={props.busy}>New career<Icon name="arrow" size={16} /></button></div>
  </section>
  const season = props.season
  return <ActiveSeason key={`${season.seed}:${season.managedClubId}:${season.seasonNumber}:${season.round}:${season.status}`} {...props} season={season} onNewGame={props.onNewCareer} />
}

function ActiveSeason({ season, onOpenMatch, onAdvance, onRollover, onNewGame, busy = false }: SeasonWorkspaceProps & { season: SeasonState; onNewGame: () => void }) {
  const [selectedSeason, setSelectedSeason] = useState(season.seasonNumber)
  const [round, setRound] = useState(String(season.round))
  const [ownFixtures, setOwnFixtures] = useState(false)
  const [reviewId, setReviewId] = useState<string | null>(null)
  const reviewTrigger = useRef<HTMLButtonElement | null>(null)
  const seasonSelector = useRef<HTMLSelectElement | null>(null)
  const archive = season.history.find(entry => entry.seasonNumber === selectedSeason)
  const archived = !!archive
  const selectedFixtures = archive?.fixtures ?? season.fixtures
  const selectedNumber = archive?.seasonNumber ?? season.seasonNumber
  const selectedDate = archived ? selectedFixtures.at(-1)!.date : season.date
  const standings = getStandings({ clubs: season.clubs, fixtures: selectedFixtures })
  const club = (id: string) => season.clubs.find(team => team.id === id)!
  const active = getActiveFixture(season)
  // The club the manager ran in the season shown; after a move, the new club appears from the next season.
  const managedId = managedClubFor(season, selectedNumber, false)
  const managed = club(managedId)
  const complete = archived || season.status === 'complete'
  const matchFinished = season.activeMatch.status === 'finished'
  const champion = complete ? club(standings[0]!.clubId) : null
  const fixtures = selectedFixtures.filter(fixture => (round === 'all' || fixture.round === Number(round)) && (!ownFixtures || fixture.homeClubId === managedId || fixture.awayClubId === managedId))
  const review = selectedFixtures.find(fixture => fixture.id === reviewId && fixture.result?.stats)
  const reviewTeams = review ? getFixtureTeams(season, review, selectedNumber) : null
  const totalRounds = Math.max(...selectedFixtures.map(fixture => fixture.round))

  function selectSeason(number: number) {
    setSelectedSeason(number)
    setReviewId(null)
    reviewTrigger.current = null
  }

  function openFixtureReview(fixtureId: string, trigger?: HTMLButtonElement) {
    if (busy || !selectedFixtures.some(fixture => fixture.id === fixtureId && fixture.result?.stats)) return
    reviewTrigger.current = trigger ?? (document.activeElement instanceof HTMLButtonElement ? document.activeElement : null)
    setReviewId(fixtureId)
    if (reviewId === fixtureId) {
      const region = document.getElementById('season-result-review')
      region?.focus({ preventScroll: true })
      region?.scrollIntoView({ block: 'start' })
    }
  }

  return <div className="season-workspace">
    <section className="season-matchday panel" aria-label="Season progress">
      <div className="season-matchday-identity">
        <ClubName club={managed} />
        <div className="season-year-filter"><label htmlFor="season-year">Season</label><select ref={seasonSelector} id="season-year" value={selectedNumber} onChange={event => selectSeason(Number(event.target.value))} disabled={busy}>
          <option value={season.seasonNumber}>{seasonLabel(season.seasonNumber)} · Current</option>
          {[...season.history].reverse().map(entry => <option key={entry.seasonNumber} value={entry.seasonNumber}>{seasonLabel(entry.seasonNumber)} · Archived</option>)}
        </select></div>
        <span>{archived ? 'Archived season' : complete ? 'Season complete' : `Matchday ${season.round} of ${totalRounds}`}<time dateTime={selectedDate}>{formatDate(selectedDate)}</time></span>
      </div>
      <div className="season-matchday-action">
        <p>{complete ? <><strong>{champion!.name}</strong> win the development league.</> : matchFinished ? 'Match finished. Continue to complete this matchday and update the table.' : <>{club(active.homeClubId).name} <span>vs</span> {club(active.awayClubId).name}</>}</p>
        <div className="season-result-actions">{archived ? <button className="button" onClick={() => { selectSeason(season.seasonNumber); seasonSelector.current?.focus() }} disabled={busy}>Current season<Icon name="chevron" size={16} /></button> : complete ? <>
          <button className="button primary" onClick={onRollover} disabled={busy}>{busy ? 'Preparing next season…' : season.employment.enabledSince ? 'Review offseason' : 'Next season'}<Icon name="next" size={16} /></button>
          <button className="button" onClick={onOpenMatch} disabled={busy}>View last match<Icon name="court" size={16} /></button>
          <button className="text-button" onClick={onNewGame} disabled={busy}>New career</button>
        </> : <button className="button primary" onClick={matchFinished ? onAdvance : onOpenMatch} disabled={busy}>{busy ? 'Completing matchday…' : matchFinished ? season.round === totalRounds ? 'Finalize season' : 'Continue' : 'Go to match'}<Icon name={matchFinished ? 'next' : 'court'} size={16} /></button>}</div>
      </div>
    </section>

    <section className="season-standings panel" aria-labelledby="season-table-title">
      <header className="season-panel-heading"><div><h2 id="season-table-title">League table</h2><p>Fictional development league · {seasonLabel(selectedNumber)}{archived ? ' · Final standings' : ''}</p></div><span>{selectedFixtures.filter(fixture => fixture.result).length} / {selectedFixtures.length} fixtures complete</span></header>
      <div className="season-table-scroll"><table className="season-standings-table"><thead><tr><th scope="col">#</th><th scope="col">Club</th><th scope="col" title="Played">P</th><th scope="col" title="Wins">W</th><th scope="col" title="Losses">L</th><th scope="col" title="Points for">PF</th><th scope="col" title="Points against">PA</th><th scope="col" title="Point difference">Diff</th></tr></thead><tbody>{standings.map(row => <tr key={row.clubId} data-club-id={row.clubId} className={row.clubId === season.managedClubId ? 'season-managed-row' : ''}>
        <td>{row.position}</td><th scope="row"><ClubName club={club(row.clubId)} yours={row.clubId === managedId} /></th><td>{row.played}</td><td className="season-wins">{row.wins}</td><td>{row.losses}</td><td>{row.pointsFor}</td><td>{row.pointsAgainst}</td><td>{difference(row.difference)}</td>
      </tr>)}</tbody></table></div>
      <p className="season-table-note">Ranked by wins, overall point difference, points scored, then club ID.</p>
    </section>

    <SeasonLeaders key={selectedNumber} season={season} seasonNumber={selectedNumber} busy={busy} onReviewFixture={openFixtureReview} />

    <section className="season-fixtures panel" aria-labelledby="season-fixtures-title">
      <header className="season-panel-heading season-fixtures-heading"><h2 id="season-fixtures-title">Fixtures &amp; results</h2><div className="season-fixture-filters"><label htmlFor="season-matchday">Matchday</label><select id="season-matchday" value={round} onChange={event => setRound(event.target.value)}><option value="all">All matchdays</option>{Array.from({ length: totalRounds }, (_, index) => <option key={index + 1} value={index + 1}>Matchday {index + 1}</option>)}</select><div className="segmented" aria-label="Fixture clubs"><button aria-pressed={!ownFixtures} className={!ownFixtures ? 'selected' : ''} onClick={() => setOwnFixtures(false)}>All clubs</button><button aria-pressed={ownFixtures} className={ownFixtures ? 'selected' : ''} onClick={() => setOwnFixtures(true)}>Your club</button></div></div></header>
      <div className="season-table-scroll"><table className="season-fixtures-table"><thead><tr><th scope="col">Date</th><th scope="col">Home</th><th scope="col">Score</th><th scope="col">Away</th><th scope="col">Match</th></tr></thead><tbody>{fixtures.map(fixture => {
        const mvp = fixture.result ? getFixtureMvp(season, fixture, selectedNumber) : null
        const isActive = !archived && fixture.id === season.activeFixtureId
        const score = fixture.result?.officialScore ?? (isActive && season.activeMatch.status !== 'ready' ? season.activeMatch.result?.officialScore ?? season.activeMatch.score : null)
        return <tr key={fixture.id} data-fixture-id={fixture.id} className={fixture.homeClubId === managedId || fixture.awayClubId === managedId ? 'season-managed-row' : ''}>
          <td><time dateTime={fixture.date}>{formatDate(fixture.date)}</time><small>Matchday {fixture.round}</small></td><td><ClubName club={club(fixture.homeClubId)} /></td><td className="season-fixture-score">{score ? `${score.home} : ${score.away}` : '—'}</td><td><ClubName club={club(fixture.awayClubId)} /></td>
          <td>{fixture.result ? fixture.result.stats ? <button className="text-button" aria-label={`Review ${club(fixture.homeClubId).shortName} vs ${club(fixture.awayClubId).shortName}`} onClick={event => openFixtureReview(fixture.id, event.currentTarget)} aria-expanded={reviewId === fixture.id} aria-controls="season-result-review" disabled={busy}>Review<Icon name="chevron" size={14} /></button> : <span className="season-scheduled">{fixture.result.kind === 'default' ? 'Awarded by default' : fixture.result.periods > 4 ? `Full time · ${fixture.result.periods - 4} OT` : 'Full time'} · Box score unavailable</span> : isActive ? <button className="text-button" onClick={onOpenMatch} disabled={busy}>{matchFinished ? 'Played · pending' : season.activeMatch.status === 'ready' ? 'Pre-match' : 'In progress'}<Icon name="chevron" size={14} /></button> : <span className="season-scheduled">Scheduled</span>}{mvp && <small className="season-fixture-mvp" data-fixture-mvp={mvp.playerId}>MVP {mvp.player.name} &middot; {mvp.pir} PIR</small>}</td>
        </tr>
      })}</tbody></table></div>
      {!fixtures.length && <p className="season-table-note">No fixtures match this filter.</p>}
      {archived && <p className="season-table-note">Archived results use the squads recorded for each match. Older saves may contain team results without player box scores.</p>}
    </section>

    {review && reviewTeams && <FixtureReview key={review.id} fixture={review} home={reviewTeams.home} away={reviewTeams.away} onClose={() => { setReviewId(null); if (reviewTrigger.current?.isConnected) reviewTrigger.current.focus(); else seasonSelector.current?.focus() }} />}
  </div>
}

function FixtureReview({ fixture, home, away, onClose }: { fixture: SeasonFixture | ArchivedFixture; home: Team; away: Team; onClose: () => void }) {
  const [side, setSide] = useState<Side>('home')
  const region = useRef<HTMLElement>(null)
  useEffect(() => {
    region.current?.focus({ preventScroll: true })
    region.current?.scrollIntoView({ block: 'start' })
  }, [])
  const result = fixture.result!
  const statistics = result.stats
  if (!statistics) return null
  const team = side === 'home' ? home : away
  return <section ref={region} id="season-result-review" className="season-result-review panel" aria-labelledby="season-result-title" tabIndex={-1} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() } }}>
    <header className="season-panel-heading"><div><h2 id="season-result-title">{home.shortName} {result.officialScore.home} : {result.officialScore.away} {away.shortName}</h2><p>{formatDate(fixture.date)} · Matchday {fixture.round} · {result.kind === 'default' ? 'Awarded by default' : result.periods > 4 ? `${result.periods - 4} overtime ${result.periods - 4 === 1 ? 'period' : 'periods'}` : 'Full time'}</p></div><button className="text-button" onClick={onClose} aria-label="Close result review"><Icon name="close" size={16} />Close</button></header>
    <MatchMvpCard mvp={selectMatchMvp([home, away], statistics, result.winnerClubId)} />
    <div className="season-result-tools"><span>{team.name}</span><div className="segmented" aria-label="Result box score team">{(['home', 'away'] as const).map(value => <button key={value} onClick={() => setSide(value)} aria-pressed={side === value} className={side === value ? 'selected' : ''}>{value === 'home' ? home.shortName : away.shortName}</button>)}</div></div>
    <div className="season-table-scroll"><table className="season-result-table"><thead><tr><th scope="col">Player</th><th scope="col">Rating</th><th scope="col" title={PIR_HELP}>PIR</th><th scope="col">Min</th><th scope="col">Pts</th><th scope="col">Reb</th><th scope="col">Ast</th><th scope="col">FG</th><th scope="col">3PT</th><th scope="col">FT</th><th scope="col">Fouls</th></tr></thead><tbody>{team.players.map(player => {
      const stats = statistics[player.id]!
      return <tr key={player.id}><th scope="row"><span className="season-player-name"><span className="season-jersey">#{player.number}</span>{player.name}</span></th><td><MatchRating stats={stats} compact /></td><td data-result-pir={hasPlayerParticipated(stats) ? playerPIR(stats) : undefined}>{hasPlayerParticipated(stats) ? playerPIR(stats) : '—'}</td><td>{minutes(stats.secondsPlayed)}</td><td className="season-points">{stats.points}</td><td>{stats.rebounds}</td><td>{stats.assists}</td><td>{stats.fieldGoalsMade}/{stats.fieldGoalsAttempted}</td><td>{stats.threePointersMade}/{stats.threePointersAttempted}</td><td>{stats.freeThrowsMade}/{stats.freeThrowsAttempted}</td><td>{stats.fouls}</td></tr>
    })}</tbody></table></div>
    {result.kind === 'default' && <p className="season-table-note">The table shows the awarded result. Player statistics retain points earned on court.</p>}
  </section>
}
