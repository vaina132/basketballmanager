import { worldOf } from '../world/career-world'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { SeasonState } from '../domain/season'
import { injuryLabel } from '../domain/injuries'
import type { Side, Team } from '../domain/types'
import type { YouthFixture } from '../domain/youth-competition'
import { getClubAcademy } from '../world/academy-policy'
import { getYouthFixtures, getYouthFixtureTeams, getYouthPlayerStatus, getYouthStandings } from '../world/youth-competition'
import { hasPlayerParticipated, playerPIR, selectMatchMvp, GAME_PIR_DESCRIPTION } from '../world/performance-rating'
import { seasonLabel } from '../world/season'
import { Avatar } from './Avatar'
import { Icon } from './Icon'
import { MatchMvpCard } from './MatchMvpCard'
import { MatchRating } from './PlayerRating'
import { scoutingDate } from './ScoutingKnowledge'
import './academy-competition.css'

type AcademyView = 'prospects' | 'matches' | 'table'
const minutes = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
const resultLabel = (fixture: YouthFixture) => !fixture.result ? 'Scheduled' : fixture.result.kind === 'no-contest' ? 'No contest' : fixture.result.kind === 'default' ? 'Awarded result' : fixture.result.periods > 4 ? `Full time · ${fixture.result.periods - 4} OT` : 'Full time'

function YouthClub({ club, own = false }: { club: Team; own?: boolean }) {
  return <span className="youth-club"><b style={{ color: club.color }}>{club.shortName}</b><span>{club.name}{own && <small>Your youth team</small>}</span></span>
}

export function YouthResultReview({ fixture, season, onClose }: { fixture: YouthFixture; season: SeasonState; onClose: () => void }) {
  const [side, setSide] = useState<Side>('home')
  const region = useRef<HTMLElement>(null)
  useEffect(() => { region.current?.focus({ preventScroll: true }); region.current?.scrollIntoView({ block: 'start' }) }, [])
  const teams = getYouthFixtureTeams(fixture, season)
  const result = fixture.result
  if (!teams || !result) return null
  const team = teams[side]
  const mvp = result.played ? selectMatchMvp([teams.home, teams.away], result.stats, result.winnerClubId) : null
  return <section id="youth-result-review" className="youth-result-review panel" ref={region} tabIndex={-1} aria-labelledby="youth-result-title" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); onClose() } }}>
    <header className="academy-heading"><div><h2 id="youth-result-title">{teams.home.shortName} {result.officialScore.home} : {result.officialScore.away} {teams.away.shortName}</h2><span>{scoutingDate(fixture.date)} · Youth matchday {fixture.round} · {resultLabel(fixture)}</span></div><button className="text-button" onClick={onClose}><Icon name="close" size={15} />Close review</button></header>
    {result.reason && <p className="youth-result-reason" role="status">{result.reason}</p>}
    {result.played ? <><MatchMvpCard mvp={mvp} /><div className="youth-result-tools"><strong>{team.name}</strong><div className="segmented" aria-label="Youth box score team">{(['home', 'away'] as const).map(value => <button key={value} className={side === value ? 'selected' : ''} aria-pressed={side === value} onClick={() => setSide(value)}>{teams[value].shortName}</button>)}</div></div>
      <div className="youth-table-scroll" role="region" aria-label="Youth match box score" tabIndex={0}><table className="youth-boxscore"><thead><tr><th>Player</th><th>Rating</th><th title={GAME_PIR_DESCRIPTION}>PIR</th><th>Min</th><th>Pts</th><th>Reb</th><th>Ast</th><th>FG</th><th>3PT</th><th>FT</th><th>Fouls</th></tr></thead><tbody>{team.players.map(player => { const stats = result.stats[player.id]; const appeared = hasPlayerParticipated(stats); return <tr key={player.id} data-youth-box-player={player.id}><th scope="row"><span className="youth-result-player"><Avatar player={player} size={30} color={team.color} /><span>{player.name}<small>#{player.number} · {player.position}</small></span></span></th><td><MatchRating stats={stats} compact /></td><td data-youth-pir={appeared ? playerPIR(stats) : undefined}>{appeared ? playerPIR(stats) : '—'}</td><td>{stats ? minutes(stats.secondsPlayed) : '—'}</td><td className="youth-points">{stats?.points ?? '—'}</td><td>{stats?.rebounds ?? '—'}</td><td>{stats?.assists ?? '—'}</td><td>{stats ? `${stats.fieldGoalsMade}/${stats.fieldGoalsAttempted}` : '—'}</td><td>{stats ? `${stats.threePointersMade}/${stats.threePointersAttempted}` : '—'}</td><td>{stats ? `${stats.freeThrowsMade}/${stats.freeThrowsAttempted}` : '—'}</td><td>{stats?.fouls ?? '—'}</td></tr> })}</tbody></table></div><details className="youth-result-details"><summary>Match records</summary><p>Player names, squads and statistics are retained from this match. Ratings describe this performance, not player ability.</p><p>{GAME_PIR_DESCRIPTION}</p>{result.injuries.length > 0 && <ul>{result.injuries.map(injury => <li key={injury.id}>{[...teams.home.players, ...teams.away.players].find(player => player.id === injury.playerId)?.name ?? 'Player'}: {injuryLabel(injury.kind)} · expected back {scoutingDate(injury.returnOn)}</li>)}</ul>}</details></> : <p className="youth-result-reason">No play took place. There are no player statistics or match MVP.</p>}
  </section>
}

export function AcademyCompetition({ season, busy, onEnable, children }: { season: SeasonState; busy: boolean; onEnable: () => void; children: ReactNode }) {
  const [view, setView] = useState<AcademyView>('prospects')
  const [selectedSeason, setSelectedSeason] = useState(season.seasonNumber)
  const [ownOnly, setOwnOnly] = useState(true)
  const [reviewId, setReviewId] = useState<string | null>(null)
  const reviewTrigger = useRef<HTMLButtonElement | null>(null)
  const enabled = season.youthCompetition.enabledSince !== null
  const currentFixtures = getYouthFixtures(season)
  const ownFixtures = currentFixtures.filter(fixture => fixture.homeClubId === season.managedClubId || fixture.awayClubId === season.managedClubId)
  const next = ownFixtures.find(fixture => !fixture.result)
  const latest = [...ownFixtures].reverse().find(fixture => fixture.result)
  const currentRows = getClubAcademy(season)
  const available = currentRows.filter(row => getYouthPlayerStatus(season, row.player.id).available).length
  const year = season.youthCompetition.seasons.some(entry => entry.seasonNumber === selectedSeason) ? selectedSeason : season.seasonNumber
  const fixtures = getYouthFixtures(season, year)
  const shownFixtures = fixtures.filter(fixture => !ownOnly || fixture.homeClubId === season.managedClubId || fixture.awayClubId === season.managedClubId)
  const standings = getYouthStandings(season, year)
  const review = fixtures.find(fixture => fixture.id === reviewId && fixture.result)
  // A club of an archived season may have left the full world since (step 3.4d-2): its identity is in the world.
  const club = (id: string) => season.clubs.find(team => team.id === id) ?? worldOf(season).clubs.find(team => team.id === id)!
  const enableReason = !season.academy.enabledSince ? 'Enable the academy first.' : season.status !== 'active' ? 'Start next season to enable youth matches.' : null
  function openReview(fixture: YouthFixture, trigger: HTMLButtonElement) { setSelectedSeason(fixture.seasonNumber); setView('matches'); setReviewId(fixture.id); reviewTrigger.current = trigger }
  function closeReview() { setReviewId(null); requestAnimationFrame(() => { if (reviewTrigger.current?.isConnected) reviewTrigger.current.focus({ preventScroll: true }); else document.querySelector<HTMLButtonElement>('#academy-view-matches')?.focus() }) }
  return <>
    {!enabled ? <section className="youth-enable panel" aria-labelledby="youth-enable-title"><Icon name="court" size={25} /><div><strong id="youth-enable-title">Youth team matches</strong><p>Build an eight-player academy squad and play the remaining youth fixtures when you Continue.</p>{enableReason && <p id="youth-enable-reason">{enableReason}</p>}</div><button id="enable-youth-competition" className="button" onClick={onEnable} disabled={busy || !!enableReason} aria-describedby={enableReason ? 'youth-enable-reason' : undefined}>Enable youth matches</button></section> : <>
      <section className="youth-fixture-strip panel" aria-label="Youth team matchday"><div className="youth-next-match"><span className="youth-match-label"><Icon name="calendar" size={16} />{next ? 'Next youth match' : 'Youth season complete'}</span>{next ? <><strong>{club(next.homeClubId).shortName} <span>vs</span> {club(next.awayClubId).shortName}</strong><small><time dateTime={next.date}>{scoutingDate(next.date)}</time> · {next.homeClubId === season.managedClubId ? 'Home' : 'Away'} · Completed on Continue</small></> : <strong>{ownFixtures.filter(fixture => fixture.result).length} matches completed</strong>}<span className={available < 5 ? 'youth-shortage' : 'youth-availability'} data-youth-available={available}><Icon name={available < 5 ? 'medical' : 'people'} size={15} />{available} / {currentRows.length} available{next && available < 5 ? ' · Fewer than five can play' : ''}</span></div>
        <div className="youth-last-match"><span className="youth-match-label"><Icon name="ball" size={16} />Latest result</span>{latest ? <><strong>{club(latest.homeClubId).shortName} <b>{latest.result!.officialScore.home} : {latest.result!.officialScore.away}</b> {club(latest.awayClubId).shortName}</strong><small>{scoutingDate(latest.date)} · {resultLabel(latest)}</small><button className="text-button" id="youth-latest-review" disabled={busy} onClick={event => openReview(latest, event.currentTarget)}>Review match<Icon name="chevron" size={13} /></button></> : <span className="youth-no-result">No youth matches played yet</span>}</div>
      </section>
      {next && available < 5 && <p className="youth-shortage-note" role="status">Five available players are needed to start. A team that cannot field five loses by default; if neither can, the match is not played.</p>}
      <div className="youth-navigation"><div className="segmented" aria-label="Academy view">{(['prospects', 'matches', 'table'] as const).map(value => <button id={`academy-view-${value}`} key={value} aria-pressed={view === value} className={view === value ? 'selected' : ''} onClick={() => { setView(value); setReviewId(null) }}><Icon name={value === 'prospects' ? 'people' : value === 'matches' ? 'calendar' : 'shield'} size={15} />{value === 'prospects' ? 'Prospects' : value === 'matches' ? 'Matches' : 'Table'}</button>)}</div>{view !== 'prospects' && <label htmlFor="youth-season">Season<select id="youth-season" value={year} onChange={event => { setSelectedSeason(Number(event.target.value)); setReviewId(null) }}>{[...season.youthCompetition.seasons].reverse().map(entry => <option key={entry.seasonNumber} value={entry.seasonNumber}>{seasonLabel(entry.seasonNumber)}{entry.seasonNumber === season.seasonNumber ? ' · Current' : ''}</option>)}</select></label>}</div>
    </>}
    {(!enabled || view === 'prospects') && children}
    {enabled && view === 'matches' && <><section className="youth-fixtures panel" aria-labelledby="youth-fixtures-title"><header className="academy-heading"><div><h2 id="youth-fixtures-title">Youth fixtures &amp; results</h2><span>{seasonLabel(year)} · {fixtures.filter(fixture => fixture.result).length} / {fixtures.length} complete</span></div><div className="segmented" aria-label="Youth fixture clubs"><button aria-pressed={ownOnly} className={ownOnly ? 'selected' : ''} onClick={() => setOwnOnly(true)}>Your club</button><button aria-pressed={!ownOnly} className={!ownOnly ? 'selected' : ''} onClick={() => setOwnOnly(false)}>All clubs</button></div></header><div className="youth-table-scroll" role="region" aria-label="Youth fixtures" tabIndex={0}><table className="youth-fixtures-table"><thead><tr><th>Date</th><th>Home</th><th>Score</th><th>Away</th><th>Match</th></tr></thead><tbody>{shownFixtures.map(fixture => <tr key={fixture.id} data-youth-fixture={fixture.id} className={fixture.homeClubId === season.managedClubId || fixture.awayClubId === season.managedClubId ? 'youth-managed-row' : ''}><td><time dateTime={fixture.date}>{scoutingDate(fixture.date)}</time><small>Matchday {fixture.round}</small></td><td><YouthClub club={club(fixture.homeClubId)} /></td><td className="youth-score">{fixture.result ? `${fixture.result.officialScore.home} : ${fixture.result.officialScore.away}` : '—'}</td><td><YouthClub club={club(fixture.awayClubId)} /></td><td>{fixture.result ? <button className="text-button" data-youth-review={fixture.id} onClick={event => openReview(fixture, event.currentTarget)} aria-expanded={reviewId === fixture.id} aria-controls="youth-result-review" disabled={busy}>Review<Icon name="chevron" size={13} /></button> : <span>Scheduled</span>}<small>{fixture.result ? resultLabel(fixture) : 'On Continue'}</small></td></tr>)}</tbody></table></div></section>{review && <YouthResultReview key={review.id} fixture={review} season={season} onClose={closeReview} />}</>}
    {enabled && view === 'table' && <section className="youth-standings panel" aria-labelledby="youth-table-title"><header className="academy-heading"><div><h2 id="youth-table-title">Youth league table</h2><span>{seasonLabel(year)}</span></div><span>{fixtures.filter(fixture => fixture.result).length} / {fixtures.length} complete</span></header><div className="youth-table-scroll" role="region" aria-label="Youth league table" tabIndex={0}><table className="youth-standings-table"><thead><tr><th>#</th><th>Club</th><th title="Played">P</th><th title="Wins">W</th><th title="Losses">L</th><th title="Points for">PF</th><th title="Points against">PA</th><th title="Point difference">Diff</th></tr></thead><tbody>{standings.map(row => <tr key={row.clubId} data-youth-standing={row.clubId} className={row.clubId === season.managedClubId ? 'youth-managed-row' : ''}><td>{row.position}</td><th scope="row"><YouthClub club={club(row.clubId)} own={row.clubId === season.managedClubId} /></th><td>{row.played}</td><td className="youth-points">{row.wins}</td><td>{row.losses}</td><td>{row.pointsFor}</td><td>{row.pointsAgainst}</td><td>{row.difference > 0 ? '+' : ''}{row.difference}</td></tr>)}</tbody></table></div><details className="youth-result-details"><summary>Competition rules</summary><p>Ranked by wins, point difference, points scored, then club ID. Matches with no contest do not count as played, won or lost. Youth matches use automatic lineups and rotations.</p><p>Matches do not add extra practice points. Eight academy places are filled when youth matches are enabled and at each season opening; promotions can leave fewer players until the next intake.</p></details></section>}
  </>
}
