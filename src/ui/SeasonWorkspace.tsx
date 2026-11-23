import { useEffect, useRef, useState } from 'react'
import type { ArchivedFixture, SeasonFixture, SeasonState } from '../domain/season'
import type { Side, Team } from '../domain/types'
import { currentGameDay, getPostseasons, getStandings, isDomesticFixture, seasonLabel } from '../world/season'
import { classificationPoints } from '../world/fiba-ranking'
import { PostseasonPanel } from './PostseasonPanel'
import { getFixtureTeams } from '../world/rosters'
import { arenaNameFor } from '../world/commercial'
import { managedClubFor } from '../world/career'
import { Icon } from './Icon'
import { SeasonLeaders } from './SeasonLeaders'
import { getFixtureMvp, hasPlayerParticipated, playerPIR, selectMatchMvp } from '../world/performance-rating'
import { MatchMvpCard } from './MatchMvpCard'
import { MatchRating } from './PlayerRating'
import { PIR_HELP } from './MatchBoxScore'
import './season-workspace.css'
import { regularWorldRounds, seasonRounds, worldOf } from '../world/career-world'
import { seasonLeagues } from '../world/divisions'
import { ClubBadge, InlineLogo } from './ClubLogo'
import { NbaStandings } from './NbaStandings'

interface SeasonWorkspaceProps {
  season: SeasonState | null
  onNewCareer: () => void
  onOpenMatch: () => void
  onLoad: () => void
  busy?: boolean
  /**
   * Competitions > European Leagues (owner, 22 November 2026, evening): another played domestic league, shown with the
   * same table, playoffs, statistics and games. Without it the screen is League: the manager's own league.
   */
  leagueId?: string
}

const dateFormatter = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const formatDate = (date: string) => dateFormatter.format(new Date(`${date}T00:00:00Z`))
/** NBA step 5: the NBA's names for its postseason rounds. */
export const NBA_STAGE_NAMES: Partial<Record<NonNullable<SeasonFixture['stage']>, string>> = { 'play-in': 'Play-in', 'round-of-16': 'First round', 'quarter-final': 'Conference semi-finals', 'semi-final': 'Conference finals', final: 'NBA Finals' }
const STAGE_NAMES: Record<NonNullable<SeasonFixture['stage']>, string> = { qualifying: 'Qualifying', 'play-in': 'Play-in', 'round-of-16': 'Round of 16', 'quarter-final': 'Quarter-final', 'semi-final': 'Semi-final', 'third-place': 'Third place', final: 'Final', 'play-out': 'Play-out' }
const difference = (value: number) => value > 0 ? `+${value}` : String(value)
const minutes = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

function ClubName({ club, yours = false }: { club: Team; yours?: boolean }) {
  return <span className="season-club-name"><ClubBadge club={club} className="season-club-code" /><span>{club.name}{yours && <small>Your club</small>}</span></span>
}

export function SeasonWorkspace(props: SeasonWorkspaceProps) {
  if (!props.season) return <section className="panel season-intro" aria-label="Career required">
    <div><h2>No active career</h2><p>Start a career to manage a real club from your data pack.</p></div>
    <div className="season-setup-actions"><button className="button" onClick={props.onLoad} disabled={props.busy}>Load saved career</button><button className="button primary" onClick={props.onNewCareer} disabled={props.busy}>New career<Icon name="arrow" size={16} /></button></div>
  </section>
  const season = props.season
  return <ActiveSeason key={`${season.seed}:${season.managedClubId}:${season.seasonNumber}:${season.round}:${season.status}:${props.leagueId ?? ''}`} {...props} season={season} onNewGame={props.onNewCareer} />
}

/** Verified league rules (step 3.4e-2): the table label, an optional points column and a short explanation. */
const LEAGUE_RULES = {
  'acb-art7-2026': {
    label: 'ACB · Wins', points: null, pointsTitle: '',
    text: [
      'ACB Normas Internas 2026/2027, articles 6.2 and 7. Most wins, or win percentage while clubs have played different numbers of games; level clubs that have played fewer games come first.',
      'Level clubs that have met home and away are ranked by their games against each other (wins, points difference and, for three or more clubs, points scored), then overall points difference, points scored and the sum of per-game scoring quotients; otherwise only the overall criteria count. A tie the rules settle by last season\'s final position uses a reproducible draw; “=” marks an unresolved tie during the season.',
    ],
  },
  'bbl-art20-2026': {
    label: 'BBL · Wertungspunkte', points: (row: { wins: number; losses: number }) => `${2 * row.wins}:${2 * row.losses}`, pointsTitle: 'Wertungspunkte: 2:0 for a win, 0:2 for a loss',
    text: [
      'easyCredit BBL Spielordnung 2026/2027, §§ 16 and 20. A win scores 2:0 points and a loss 0:2.',
      'Level clubs are ranked by the points in their games against each other, then points difference in those games, overall points difference and the scoring quotient. The procedure restarts for clubs still level; lots decide a final tie (a reproducible draw here), and “=” marks an unresolved tie during the season.',
    ],
  },
  'fip-art62-2026': {
    label: 'FIP · Points', points: (row: { wins: number }) => String(2 * row.wins), pointsTitle: 'Points: 2 for a win, none for a loss',
    text: [
      'FIP Regolamento Esecutivo Gare, articles 60 and 62. Two points for a win, none for a loss.',
      'Level clubs are ranked by their games against each other (wins, then the quotient of points scored and conceded), then the quotient over all games, restarting for clubs still level; then fewer fouls in those games and in all games. A tie the rules leave open uses a reproducible draw; “=” marks an unresolved tie during the season.',
    ],
  },
} as const

/**
 * The matchday Fixtures & results opens on: the current one when the shown competition plays in it, else the last one
 * with results (a finished season, or a league whose season ended before the others'), else the next one with games
 * (browser play-through, 16 November 2026: a finished season opened on an empty matchday 44).
 */
export function defaultFixtureRound(fixtures: readonly { round: number; result: unknown }[], current: number): string {
  if (fixtures.some(fixture => fixture.round === current)) return String(current)
  const played = fixtures.filter(fixture => fixture.round <= current && fixture.result).map(fixture => fixture.round)
  if (played.length) return String(Math.max(...played))
  const upcoming = fixtures.filter(fixture => fixture.round > current).map(fixture => fixture.round)
  return upcoming.length ? String(Math.min(...upcoming)) : 'all'
}

function ActiveSeason({ season, onOpenMatch, onNewGame, busy = false, leagueId: otherLeagueId }: SeasonWorkspaceProps & { season: SeasonState; onNewGame: () => void }) {
  const [selectedSeason, setSelectedSeason] = useState(season.seasonNumber)
  // Step 3.4c: the selected season's own divisions (clubs move between divisions from season to season).
  const shownDivisions = selectedSeason === season.seasonNumber ? season.divisions : season.history.find(entry => entry.seasonNumber === selectedSeason)?.divisions
  const leagues = worldOf(season).domesticLeagues ? seasonLeagues(worldOf(season), shownDivisions) : undefined
  // League shows the league the manager's club played in the season shown (it may have been promoted or relegated
  // since); European Leagues shows the league chosen there.
  const shownClubId = managedClubFor(season, selectedSeason, false)
  const leagueId = otherLeagueId ?? leagues?.find(league => league.clubIds.includes(shownClubId))?.id ?? leagues?.find(league => league.clubIds.includes(season.managedClubId))?.id ?? ''
  const other = otherLeagueId !== undefined
  const league = leagues?.find(league => league.id === leagueId)
  const leagueName = league?.name ?? (worldOf(season).source === 'fictional-development' ? 'the development league' : worldOf(season).name)
  // The player's matchday choice; until one is made (or after another season or competition is chosen), a matchday
  // with games is shown (`defaultFixtureRound`).
  const [roundChoice, setRound] = useState<string | null>(null)
  const [ownFixtures, setOwnFixtures] = useState(false)
  const [reviewId, setReviewId] = useState<string | null>(null)
  const reviewTrigger = useRef<HTMLButtonElement | null>(null)
  const seasonSelector = useRef<HTMLSelectElement | null>(null)
  const archive = season.history.find(entry => entry.seasonNumber === selectedSeason)
  const archived = !!archive
  // European games (step 3.5b) are not part of a domestic league's calendar.
  const selectedFixtures = (archive?.fixtures ?? season.fixtures).filter(fixture => isDomesticFixture(fixture) && (!league || league.clubIds.includes(fixture.homeClubId)))
  const selectedNumber = archive?.seasonNumber ?? season.seasonNumber
  const round = roundChoice ?? defaultFixtureRound(selectedFixtures, archived ? Infinity : season.round)
  // Step 3.4a: during a week with several game days, show the current game day.
  const selectedDate = archived ? selectedFixtures.at(-1)!.date : currentGameDay(season) ?? season.date
  const standings = getStandings({ ...season, fixtures: archive?.fixtures ?? season.fixtures, divisions: shownDivisions }).filter(row => !league || league.clubIds.includes(row.clubId))
  const lnbRanking = league?.standingsRule === 'lnb-2026-1'
  const fibaRanking = league?.standingsRule === 'fiba-2026-d'
  const leagueRule = league?.standingsRule && Object.hasOwn(LEAGUE_RULES, league.standingsRule) ? LEAGUE_RULES[league.standingsRule as keyof typeof LEAGUE_RULES] : null
  // A club of an archived season may have left the full world since (step 3.4d-2): its identity is in the world.
  const club = (id: string) => season.clubs.find(team => team.id === id) ?? worldOf(season).clubs.find(team => team.id === id)!
  const active = season.fixtures.find(fixture => fixture.id === season.activeFixtureId)
  // The club the manager ran in the season shown; after a move, the new club appears from the next season.
  const managedId = managedClubFor(season, selectedNumber, false)
  // Format 69: a season the manager spent without a club (career-3) names no club of theirs.
  const managed = managedId ? club(managedId) : null
  const complete = archived || season.status === 'complete'
  const matchFinished = !season.activeMatch || season.activeMatch.status === 'finished'
  // With playoffs (step 3.4b) the champion is the postseason's; the regular season's first place is shown separately.
  const postseason = league?.postseason ? getPostseasons({ ...season, fixtures: archive?.fixtures ?? season.fixtures, divisions: shownDivisions }, selectedNumber).find(entry => entry.league.id === league.id) : undefined
  const playoffChampion = complete && postseason?.outcome.champion ? club(postseason.outcome.champion) : null
  const champion = complete ? club(standings[0]!.clubId) : null
  const fixtures = selectedFixtures.filter(fixture => (round === 'all' || fixture.round === Number(round)) && (!ownFixtures || fixture.homeClubId === managedId || fixture.awayClubId === managedId))
  const review = selectedFixtures.find(fixture => fixture.id === reviewId && fixture.result?.stats)
  const reviewTeams = review ? getFixtureTeams(season, review, selectedNumber) : null
  const totalRounds = archived ? Math.max(...selectedFixtures.map(fixture => fixture.round)) : seasonRounds(season)
  const regularRounds = regularWorldRounds(worldOf(season))
  // NBA step 5: the NBA shows conference standings and names its playoff rounds.
  const nbaLeague = !!league && worldOf(season).nba?.leagueId === league.id
  const stageLabel = (fixture: SeasonFixture | ArchivedFixture) => fixture.stage ? `${(nbaLeague ? NBA_STAGE_NAMES[fixture.stage] : undefined) ?? STAGE_NAMES[fixture.stage]}${fixture.game && postseason?.series.find(series => series.id === fixture.seriesId)?.bestOf !== 1 ? ` · Game ${fixture.game}` : ''}` : `Matchday ${fixture.round}`

  // Format 64: the home arena's name in the season shown (a naming partner's name while its agreement ran); one-venue series stay unnamed.
  const venueOf = (fixture: SeasonFixture | ArchivedFixture) => postseason?.series.find(series => series.id === fixture.seriesId)?.neutral ? null : arenaNameFor(season, fixture.homeClubId, selectedNumber)

  function selectSeason(number: number) {
    setSelectedSeason(number)
    setRound(null)
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
    <section className="season-matchday panel" aria-label={other ? `${leagueName} season` : 'Season progress'} data-season-league={league?.id}>
      <div className="season-matchday-identity">
        {other ? <span className="season-club-name season-league-name"><InlineLogo kind="competition" id={league?.id} name={leagueName} size={26} decorative /><span>{leagueName}{league?.country && <small>{league.country}</small>}</span></span> : managed ? <ClubName club={managed} /> : <span className="season-club-name"><span>Without a club</span></span>}
        <div className="season-year-filter"><label htmlFor="season-year">Season</label><select ref={seasonSelector} id="season-year" value={selectedNumber} onChange={event => selectSeason(Number(event.target.value))} disabled={busy}>
          <option value={season.seasonNumber}>{seasonLabel(season.seasonNumber)} · Current</option>
          {[...season.history].reverse().map(entry => <option key={entry.seasonNumber} value={entry.seasonNumber}>{seasonLabel(entry.seasonNumber)} · Archived</option>)}
        </select></div>
        <span>{archived ? 'Archived season' : complete ? 'Season complete' : season.round > regularRounds ? `Playoffs · week ${season.round - regularRounds} of ${totalRounds - regularRounds}` : `Matchday ${season.round} of ${totalRounds}`}<time dateTime={selectedDate}>{formatDate(selectedDate)}</time></span>
      </div>
      <div className="season-matchday-action">
        <p>{complete ? playoffChampion ? <><strong>{playoffChampion.name}</strong> win the {leagueName} playoffs; {champion!.name} finished first in the regular season.</> : <><strong>{champion!.name}</strong> finish first in {leagueName}.</> : other ? `${selectedFixtures.filter(fixture => fixture.result).length} of ${selectedFixtures.length} games played.` : !active ? !managed ? 'You are without a club. Press Continue to play this week.' : season.round > regularRounds ? 'No game for your club today. Press Continue.' : 'Rest week. Press Continue.' : matchFinished ? 'Match over. Press Continue to update the table.' : <>{club(active.homeClubId).name} <span>vs</span> {club(active.awayClubId).name}</>}</p>
        <div className="season-result-actions">{archived ? <button className="button" onClick={() => { selectSeason(season.seasonNumber); seasonSelector.current?.focus() }} disabled={busy}>Current season<Icon name="chevron" size={16} /></button> : other ? null : complete ? <>
          <button className="button" onClick={onOpenMatch} disabled={busy || !active}>View last match<Icon name="court" size={16} /></button>
          <button className="text-button" onClick={onNewGame} disabled={busy}>New career</button>
        </> : active && matchFinished ? <button className="button" onClick={onOpenMatch} disabled={busy}>View last match<Icon name="court" size={16} /></button> : null}</div>
      </div>
    </section>

    {nbaLeague ? <NbaStandings season={season} fixtures={archive?.fixtures ?? season.fixtures} managedId={managedId} seasonLabel={seasonLabel(selectedNumber)} /> : <section className="season-standings panel" aria-labelledby="season-table-title">
      <header className="season-panel-heading"><div><h2 id="season-table-title">{leagues ? 'Regular-season table' : 'League table'}</h2><p><InlineLogo kind="competition" id={league?.id} name={leagueName} />{leagueName} · {seasonLabel(selectedNumber)}{archived ? ' · Final standings' : ''}</p></div><span>{selectedFixtures.filter(fixture => fixture.result).length} / {selectedFixtures.length} fixtures complete</span></header>
      <div className="season-table-scroll"><table className="season-standings-table"><thead><tr><th scope="col">#</th><th scope="col">Club</th><th scope="col" title="Played">P</th><th scope="col" title="Wins">W</th><th scope="col" title="Losses">L</th>{lnbRanking && <th scope="col" title="Wins divided by games played">Win %</th>}{fibaRanking && <th scope="col" title="Classification points: 2 for a win, 1 for a loss">Pts</th>}{leagueRule?.points && <th scope="col" title={leagueRule.pointsTitle}>Pts</th>}<th scope="col" title="Points for">PF</th><th scope="col" title="Points against">PA</th><th scope="col" title="Point difference">Diff</th></tr></thead><tbody>{standings.map(row => <tr key={row.clubId} data-club-id={row.clubId} className={row.clubId === season.managedClubId ? 'season-managed-row' : ''}>
        <td>{row.position}{row.rankingTie === 'unresolved' && <span className="season-tie-mark" title="Still tied on sporting criteria; display order only" aria-label="Still tied">=</span>}</td><th scope="row"><ClubName club={club(row.clubId)} yours={row.clubId === managedId} />{row.rankingTie === 'draw' && <span className="season-draw-label" title="Equal after all sporting tie-breaks; position decided by a reproducible draw">Draw</span>}</th><td>{row.played}</td><td className="season-wins">{row.wins}</td><td>{row.losses}</td>{lnbRanking && <td>{row.played ? `${(row.wins / row.played * 100).toFixed(1)}%` : '—'}</td>}{fibaRanking && <td className="season-wins">{classificationPoints(row)}</td>}{leagueRule?.points && <td className="season-wins">{leagueRule.points(row)}</td>}<td>{row.pointsFor}</td><td>{row.pointsAgainst}</td><td>{difference(row.difference)}</td>
      </tr>)}</tbody></table></div>
      <details className="season-table-rules"><summary>Table rules <span>{lnbRanking ? 'LNB · Win percentage' : fibaRanking ? 'FIBA default · Classification points' : leagueRule ? leagueRule.label : 'Prototype ranking'}</span></summary>{lnbRanking ? <>
        <p>Win percentage comes first. Tied clubs are ranked by their results against each other, then points difference and points scored. Clubs without a direct meeting keep their overall points-difference position.</p>
        <p>Remaining ties use overall points difference, then points scored. The process restarts for any clubs still tied. A fully tied final table uses a reproducible draw; “=” marks an unresolved tie during the season.</p>
      </> : leagueRule ? <>{leagueRule.text.map(paragraph => <p key={paragraph}>{paragraph}</p>)}</> : fibaRanking ? <>
        <p>This league's own tie-break rules have not been verified yet, so the game uses the FIBA Official Basketball Rules 2026, Appendix D. Classification points come first: 2 for a win, 1 for a loss.</p>
        <p>Clubs level on points are ranked by the games between them: points, then points difference and points scored in those games, then overall points difference and points scored. The process restarts for any clubs still tied. A fully tied final table uses a reproducible draw; “=” marks an unresolved tie during the season.</p>
      </> : <p>Ranked by wins, overall point difference, points scored, then club ID. This career retains its original ranking rules.</p>}</details>
    </section>}

    {league?.postseason && <PostseasonPanel key={`postseason:${selectedNumber}:${leagueId}`} season={season} seasonNumber={selectedNumber} leagueId={league.id} managedId={managedId} />}

    <SeasonLeaders key={`leaders:${selectedNumber}:${leagueId}`} season={season} seasonNumber={selectedNumber} clubIds={league?.clubIds} phases={!!league?.postseason} busy={busy} onReviewFixture={openFixtureReview} />

    <section className="season-fixtures panel" aria-labelledby="season-fixtures-title">
      <header className="season-panel-heading season-fixtures-heading"><h2 id="season-fixtures-title">Fixtures &amp; results</h2><div className="season-fixture-filters"><label htmlFor="season-matchday">Matchday</label><select id="season-matchday" value={round} onChange={event => setRound(event.target.value)}><option value="all">All matchdays</option>{Array.from({ length: totalRounds }, (_, index) => <option key={index + 1} value={index + 1}>Matchday {index + 1}</option>)}</select>{!other && <div className="segmented" aria-label="Fixture clubs"><button aria-pressed={!ownFixtures} className={!ownFixtures ? 'selected' : ''} onClick={() => setOwnFixtures(false)}>All clubs</button><button aria-pressed={ownFixtures} className={ownFixtures ? 'selected' : ''} onClick={() => setOwnFixtures(true)}>Your club</button></div>}</div></header>
      <div className="season-table-scroll"><table className="season-fixtures-table"><thead><tr><th scope="col">Date</th><th scope="col">Home</th><th scope="col">Score</th><th scope="col">Away</th><th scope="col">Match</th></tr></thead><tbody>{fixtures.map(fixture => {
        const mvp = fixture.result ? getFixtureMvp(season, fixture, selectedNumber) : null
        const isActive = !archived && fixture.id === season.activeFixtureId
        const score = fixture.result?.officialScore ?? (isActive && season.activeMatch?.status !== 'ready' ? season.activeMatch?.result?.officialScore ?? season.activeMatch?.score : null)
        return <tr key={fixture.id} data-fixture-id={fixture.id} className={fixture.homeClubId === managedId || fixture.awayClubId === managedId ? 'season-managed-row' : ''}>
          <td><time dateTime={fixture.date}>{formatDate(fixture.date)}</time><small>{stageLabel(fixture)}</small>{venueOf(fixture) && <small className="season-fixture-venue" data-arena-name={venueOf(fixture)!}>{venueOf(fixture)}</small>}</td><td><ClubName club={club(fixture.homeClubId)} /></td><td className="season-fixture-score">{score ? `${score.home} : ${score.away}` : '—'}</td><td><ClubName club={club(fixture.awayClubId)} /></td>
          <td>{fixture.result ? fixture.result.stats ? <button className="text-button" aria-label={`Review ${club(fixture.homeClubId).shortName} vs ${club(fixture.awayClubId).shortName}`} onClick={event => openFixtureReview(fixture.id, event.currentTarget)} aria-expanded={reviewId === fixture.id} aria-controls="season-result-review" disabled={busy}>Review<Icon name="chevron" size={14} /></button> : <span className="season-scheduled">{fixture.result.kind === 'default' ? 'Awarded by default' : fixture.result.periods > 4 ? `Full time · ${fixture.result.periods - 4} OT` : 'Full time'} · {'appearances' in fixture.result || 'fouls' in fixture.result ? 'Season totals retained' : 'Box score unavailable'}</span> : isActive ? <button className="text-button" onClick={onOpenMatch} disabled={busy}>{matchFinished ? 'Played · pending' : season.activeMatch?.status === 'ready' ? 'Pre-match' : 'In progress'}<Icon name="chevron" size={14} /></button> : <span className="season-scheduled">Scheduled</span>}{mvp && <small className="season-fixture-mvp" data-fixture-mvp={mvp.playerId}>MVP {mvp.player.name} &middot; {mvp.pir} PIR</small>}</td>
        </tr>
      })}</tbody></table></div>
      {!fixtures.length && <p className="season-table-note">No fixtures match this filter.</p>}
      {archived && <p className="season-table-note">Archived results use the squads recorded for each match. Older saves may contain team results without player box scores.</p>}
    </section>

    {review && reviewTeams && <FixtureReview key={review.id} fixture={review} home={reviewTeams.home} away={reviewTeams.away} venue={venueOf(review)} onClose={() => { setReviewId(null); if (reviewTrigger.current?.isConnected) reviewTrigger.current.focus(); else seasonSelector.current?.focus() }} />}
  </div>
}

function FixtureReview({ fixture, home, away, venue, onClose }: { fixture: SeasonFixture | ArchivedFixture; home: Team; away: Team; venue?: string | null; onClose: () => void }) {
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
    <header className="season-panel-heading"><div><h2 id="season-result-title">{home.shortName} {result.officialScore.home} : {result.officialScore.away} {away.shortName}</h2><p>{formatDate(fixture.date)} · Matchday {fixture.round}{venue ? ` · ${venue}` : ''} · {result.kind === 'default' ? 'Awarded by default' : result.periods > 4 ? `${result.periods - 4} overtime ${result.periods - 4 === 1 ? 'period' : 'periods'}` : 'Full time'}</p></div><button className="text-button" onClick={onClose} aria-label="Close result review"><Icon name="close" size={16} />Close</button></header>
    <MatchMvpCard mvp={selectMatchMvp([home, away], statistics, result.winnerClubId)} />
    <div className="season-result-tools"><span>{team.name}</span><div className="segmented" aria-label="Result box score team">{(['home', 'away'] as const).map(value => <button key={value} onClick={() => setSide(value)} aria-pressed={side === value} className={side === value ? 'selected' : ''}>{value === 'home' ? home.shortName : away.shortName}</button>)}</div></div>
    <div className="season-table-scroll"><table className="season-result-table"><thead><tr><th scope="col">Player</th><th scope="col">Rating</th><th scope="col" title={PIR_HELP}>PIR</th><th scope="col">Min</th><th scope="col">Pts</th><th scope="col">Reb</th><th scope="col">Ast</th><th scope="col">FG</th><th scope="col">3PT</th><th scope="col">FT</th><th scope="col">Fouls</th></tr></thead><tbody>{team.players.map(player => {
      const stats = statistics[player.id]!
      return <tr key={player.id}><th scope="row"><span className="season-player-name"><span className="season-jersey">#{player.number}</span>{player.name}</span></th><td><MatchRating stats={stats} compact /></td><td data-result-pir={hasPlayerParticipated(stats) ? playerPIR(stats) : undefined}>{hasPlayerParticipated(stats) ? playerPIR(stats) : '—'}</td><td>{minutes(stats.secondsPlayed)}</td><td className="season-points">{stats.points}</td><td>{stats.rebounds}</td><td>{stats.assists}</td><td>{stats.fieldGoalsMade}/{stats.fieldGoalsAttempted}</td><td>{stats.threePointersMade}/{stats.threePointersAttempted}</td><td>{stats.freeThrowsMade}/{stats.freeThrowsAttempted}</td><td>{stats.fouls}</td></tr>
    })}</tbody></table></div>
    {result.kind === 'default' && <p className="season-table-note">The table shows the awarded result. Player statistics retain points earned on court.</p>}
  </section>
}
