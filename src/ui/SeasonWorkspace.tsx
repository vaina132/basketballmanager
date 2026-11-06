import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { SeasonFixture, SeasonState } from '../domain/season'
import type { Side, Team } from '../domain/types'
import { DEVELOPMENT_CLUBS } from '../data/development-league'
import { getActiveFixture, getStandings } from '../world/season'
import { Avatar } from './Avatar'
import { Icon } from './Icon'
import './season-workspace.css'

interface SeasonWorkspaceProps {
  season: SeasonState | null
  onStart: (seed: number, clubId: string) => void
  onOpenMatch: () => void
  onAdvance: () => void
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
  const [setupFor, setSetupFor] = useState<SeasonState | null>(null)
  const season = props.season
  if (!season || season.status === 'complete' && setupFor === season) return <SeasonSetup
    onStart={(seed, clubId) => { props.onStart(seed, clubId); setSetupFor(null) }}
    onLoad={() => { props.onLoad(); setSetupFor(null) }}
    onCancel={season ? () => setSetupFor(null) : undefined}
    busy={props.busy ?? false}
  />
  return <ActiveSeason key={`${season.seed}:${season.managedClubId}:${season.round}:${season.status}`} {...props} season={season} onNewSeason={() => setSetupFor(season)} />
}

function SeasonSetup({ onStart, onLoad, onCancel, busy }: Pick<SeasonWorkspaceProps, 'onStart' | 'onLoad'> & { onCancel?: () => void; busy: boolean }) {
  const [clubId, setClubId] = useState(DEVELOPMENT_CLUBS[0]!.id)
  const [seedInput, setSeedInput] = useState('42')
  const [error, setError] = useState('')
  const club = DEVELOPMENT_CLUBS.find(team => team.id === clubId)!
  function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const seed = Number(seedInput)
    if (!seedInput.trim() || !Number.isSafeInteger(seed) || seed < 0 || seed > 4294967295) {
      setError('Choose a whole-number seed between 0 and 4,294,967,295.')
      return
    }
    setError('')
    onStart(seed, clubId)
  }

  return <div className="season-workspace season-setup">
    <section className="season-intro panel" aria-label="Season setup">
      <div><h2>Development league</h2><p>Fictional development league · 6 clubs · 10 matchdays</p></div>
      <div className="season-setup-actions">{onCancel && <button className="text-button" onClick={onCancel} disabled={busy}>Back to season</button>}<button className="button" onClick={onLoad} disabled={busy}><Icon name="save" size={16} />Load saved season</button></div>
    </section>
    <div className="season-setup-columns">
      <form className="season-club-picker panel" onSubmit={start}>
        <fieldset disabled={busy}>
          <legend>Choose your club</legend>
          <div className="season-club-options">
            {DEVELOPMENT_CLUBS.map(team => <label className={`season-club-option${clubId === team.id ? ' selected' : ''}`} key={team.id}>
              <input type="radio" name="season-club" value={team.id} checked={clubId === team.id} onChange={() => setClubId(team.id)} />
              <ClubName club={team} />
              <span className="season-roster-count">{team.players.length} players</span>
            </label>)}
          </div>
          <div className="season-start-controls">
            <div><label htmlFor="season-seed">Season seed</label><input id="season-seed" inputMode="numeric" value={seedInput} onChange={event => setSeedInput(event.target.value)} aria-describedby={error ? 'season-start-error' : undefined} aria-invalid={!!error} /></div>
            <span className="season-setting">Injuries off</span>
            <button className="button primary" type="submit">Start season<Icon name="arrow" size={16} /></button>
          </div>
          {error && <p id="season-start-error" className="season-error" role="alert">{error}</p>}
        </fieldset>
      </form>
      <section className="season-preview-roster panel" aria-labelledby="season-roster-title">
        <header className="season-panel-heading"><div><h2 id="season-roster-title">{club.name}</h2><p>First-team roster</p></div><span className="season-club-code" style={{ color: club.color }}>{club.shortName}</span></header>
        <div className="season-table-scroll"><table><thead><tr><th scope="col">Player</th><th scope="col">Pos</th><th scope="col">Height</th></tr></thead><tbody>{club.players.map(player => <tr key={player.id}>
          <td><span className="season-player-name"><Avatar player={player} color={club.color} size={28} /><span>{player.name}<small>#{player.number}</small></span></span></td><td>{player.position}</td><td>{player.heightCm} cm</td>
        </tr>)}</tbody></table></div>
      </section>
    </div>
  </div>
}

function ActiveSeason({ season, onOpenMatch, onAdvance, onNewSeason, busy = false }: SeasonWorkspaceProps & { season: SeasonState; onNewSeason: () => void }) {
  const [round, setRound] = useState(String(season.round))
  const [ownFixtures, setOwnFixtures] = useState(false)
  const [reviewId, setReviewId] = useState<string | null>(null)
  const reviewTrigger = useRef<HTMLButtonElement | null>(null)
  const standings = getStandings(season)
  const club = (id: string) => season.clubs.find(team => team.id === id)!
  const active = getActiveFixture(season)
  const managed = club(season.managedClubId)
  const complete = season.status === 'complete'
  const matchFinished = season.activeMatch.status === 'finished'
  const champion = complete ? club(standings[0]!.clubId) : null
  const fixtures = season.fixtures.filter(fixture => (round === 'all' || fixture.round === Number(round)) && (!ownFixtures || fixture.homeClubId === season.managedClubId || fixture.awayClubId === season.managedClubId))
  const review = season.fixtures.find(fixture => fixture.id === reviewId && fixture.result)
  const totalRounds = Math.max(...season.fixtures.map(fixture => fixture.round))

  return <div className="season-workspace">
    <section className="season-matchday panel" aria-label="Season progress">
      <div className="season-matchday-identity"><ClubName club={managed} /><span>{complete ? 'Season complete' : `Matchday ${season.round} of ${totalRounds}`}<time dateTime={season.date}>{formatDate(season.date)}</time></span></div>
      <div className="season-matchday-action">
        <p>{complete ? <><strong>{champion!.name}</strong> win the development league.</> : matchFinished ? 'Match finished. Continue to complete this matchday and update the table.' : <>{club(active.homeClubId).name} <span>vs</span> {club(active.awayClubId).name}</>}</p>
        <div className="season-result-actions"><button className="button primary" onClick={!complete && matchFinished ? onAdvance : onOpenMatch} disabled={busy}>{busy ? 'Completing matchday…' : complete ? 'View last match' : matchFinished ? season.round === totalRounds ? 'Finalize season' : 'Continue' : 'Go to match'}<Icon name={!complete && matchFinished ? 'next' : 'court'} size={16} /></button>{complete && <button className="button" onClick={onNewSeason} disabled={busy}>New season</button>}</div>
      </div>
    </section>

    <section className="season-standings panel" aria-labelledby="season-table-title">
      <header className="season-panel-heading"><div><h2 id="season-table-title">League table</h2><p>Fictional development league</p></div><span>{season.fixtures.filter(fixture => fixture.result).length} / {season.fixtures.length} fixtures complete</span></header>
      <div className="season-table-scroll"><table className="season-standings-table"><thead><tr><th scope="col">#</th><th scope="col">Club</th><th scope="col" title="Played">P</th><th scope="col" title="Wins">W</th><th scope="col" title="Losses">L</th><th scope="col" title="Points for">PF</th><th scope="col" title="Points against">PA</th><th scope="col" title="Point difference">Diff</th></tr></thead><tbody>{standings.map(row => <tr key={row.clubId} data-club-id={row.clubId} className={row.clubId === season.managedClubId ? 'season-managed-row' : ''}>
        <td>{row.position}</td><th scope="row"><ClubName club={club(row.clubId)} yours={row.clubId === season.managedClubId} /></th><td>{row.played}</td><td className="season-wins">{row.wins}</td><td>{row.losses}</td><td>{row.pointsFor}</td><td>{row.pointsAgainst}</td><td>{difference(row.difference)}</td>
      </tr>)}</tbody></table></div>
      <p className="season-table-note">Ranked by wins, overall point difference, points scored, then club ID.</p>
    </section>

    <section className="season-fixtures panel" aria-labelledby="season-fixtures-title">
      <header className="season-panel-heading season-fixtures-heading"><h2 id="season-fixtures-title">Fixtures &amp; results</h2><div className="season-fixture-filters"><label htmlFor="season-matchday">Matchday</label><select id="season-matchday" value={round} onChange={event => setRound(event.target.value)}><option value="all">All matchdays</option>{Array.from({ length: totalRounds }, (_, index) => <option key={index + 1} value={index + 1}>Matchday {index + 1}</option>)}</select><div className="segmented" aria-label="Fixture clubs"><button aria-pressed={!ownFixtures} className={!ownFixtures ? 'selected' : ''} onClick={() => setOwnFixtures(false)}>All clubs</button><button aria-pressed={ownFixtures} className={ownFixtures ? 'selected' : ''} onClick={() => setOwnFixtures(true)}>Your club</button></div></div></header>
      <div className="season-table-scroll"><table className="season-fixtures-table"><thead><tr><th scope="col">Date</th><th scope="col">Home</th><th scope="col">Score</th><th scope="col">Away</th><th scope="col">Match</th></tr></thead><tbody>{fixtures.map(fixture => {
        const isActive = fixture.id === season.activeFixtureId
        const score = fixture.result?.officialScore ?? (isActive && season.activeMatch.status !== 'ready' ? season.activeMatch.result?.officialScore ?? season.activeMatch.score : null)
        return <tr key={fixture.id} data-fixture-id={fixture.id} className={fixture.homeClubId === season.managedClubId || fixture.awayClubId === season.managedClubId ? 'season-managed-row' : ''}>
          <td><time dateTime={fixture.date}>{formatDate(fixture.date)}</time><small>Matchday {fixture.round}</small></td><td><ClubName club={club(fixture.homeClubId)} /></td><td className="season-fixture-score">{score ? `${score.home} : ${score.away}` : '—'}</td><td><ClubName club={club(fixture.awayClubId)} /></td>
          <td>{fixture.result ? <button className="text-button" aria-label={`Review ${club(fixture.homeClubId).shortName} vs ${club(fixture.awayClubId).shortName}`} onClick={event => { reviewTrigger.current = event.currentTarget; setReviewId(fixture.id) }} aria-expanded={reviewId === fixture.id} aria-controls="season-result-review">Review<Icon name="chevron" size={14} /></button> : isActive ? <button className="text-button" onClick={onOpenMatch} disabled={busy}>{matchFinished ? 'Played · pending' : season.activeMatch.status === 'ready' ? 'Pre-match' : 'In progress'}<Icon name="chevron" size={14} /></button> : <span className="season-scheduled">Scheduled</span>}</td>
        </tr>
      })}</tbody></table></div>
      {!fixtures.length && <p className="season-table-note">No fixtures match this filter.</p>}
    </section>

    {review && <FixtureReview key={review.id} fixture={review} home={club(review.homeClubId)} away={club(review.awayClubId)} onClose={() => { setReviewId(null); reviewTrigger.current?.focus() }} />}
  </div>
}

function FixtureReview({ fixture, home, away, onClose }: { fixture: SeasonFixture; home: Team; away: Team; onClose: () => void }) {
  const [side, setSide] = useState<Side>('home')
  const region = useRef<HTMLElement>(null)
  useEffect(() => {
    region.current?.focus({ preventScroll: true })
    region.current?.scrollIntoView({ block: 'start' })
  }, [])
  const result = fixture.result!
  const team = side === 'home' ? home : away
  return <section ref={region} id="season-result-review" className="season-result-review panel" aria-labelledby="season-result-title" tabIndex={-1}>
    <header className="season-panel-heading"><div><h2 id="season-result-title">{home.shortName} {result.officialScore.home} : {result.officialScore.away} {away.shortName}</h2><p>{formatDate(fixture.date)} · Matchday {fixture.round} · {result.kind === 'default' ? 'Awarded by default' : result.periods > 4 ? `${result.periods - 4} overtime ${result.periods - 4 === 1 ? 'period' : 'periods'}` : 'Full time'}</p></div><button className="text-button" onClick={onClose} aria-label="Close result review"><Icon name="close" size={16} />Close</button></header>
    <div className="season-result-tools"><span>{team.name}</span><div className="segmented" aria-label="Result box score team">{(['home', 'away'] as const).map(value => <button key={value} onClick={() => setSide(value)} aria-pressed={side === value} className={side === value ? 'selected' : ''}>{value === 'home' ? home.shortName : away.shortName}</button>)}</div></div>
    <div className="season-table-scroll"><table className="season-result-table"><thead><tr><th scope="col">Player</th><th scope="col">Min</th><th scope="col">Pts</th><th scope="col">Reb</th><th scope="col">Ast</th><th scope="col">FG</th><th scope="col">3PT</th><th scope="col">FT</th><th scope="col">Fouls</th></tr></thead><tbody>{team.players.map(player => {
      const stats = result.stats[player.id]!
      return <tr key={player.id}><th scope="row"><span className="season-player-name"><span className="season-jersey">#{player.number}</span>{player.name}</span></th><td>{minutes(stats.secondsPlayed)}</td><td className="season-points">{stats.points}</td><td>{stats.rebounds}</td><td>{stats.assists}</td><td>{stats.fieldGoalsMade}/{stats.fieldGoalsAttempted}</td><td>{stats.threePointersMade}/{stats.threePointersAttempted}</td><td>{stats.freeThrowsMade}/{stats.freeThrowsAttempted}</td><td>{stats.fouls}</td></tr>
    })}</tbody></table></div>
    {result.kind === 'default' && <p className="season-table-note">The table shows the awarded result. Player statistics retain points earned on court.</p>}
  </section>
}
