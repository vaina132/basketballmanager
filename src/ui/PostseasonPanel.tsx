import type { SeasonState } from '../domain/season'
import type { PostseasonSeriesState } from '../world/postseason'
import { getPostseasons, postseasonSlotDay } from '../world/season'
import { worldOf } from '../world/career-world'
import './postseason-panel.css'

const STAGES: Record<PostseasonSeriesState['stage'], string> = { qualifying: 'Qualifying', 'play-in': 'Play-in', 'round-of-16': 'Round of 16', 'quarter-final': 'Quarter-finals', 'semi-final': 'Semi-finals', 'third-place': 'Third place', final: 'Final', 'play-out': 'Play-outs' }
const NBA_STAGES: Partial<Record<PostseasonSeriesState['stage'], string>> = { 'play-in': 'Play-in', 'round-of-16': 'First round', 'quarter-final': 'Conference semi-finals', 'semi-final': 'Conference finals', final: 'NBA Finals' }
const dateFormatter = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
const formatDate = (date: string) => dateFormatter.format(new Date(`${date}T00:00:00Z`))

/** One league's playoffs on the Competition screen (step 3.4b): every series, its score, next game and the outcome. */
export function PostseasonPanel({ season, seasonNumber, leagueId, managedId }: { season: SeasonState; seasonNumber: number; leagueId: string; managedId: string }) {
  const archive = season.history.find(entry => entry.seasonNumber === seasonNumber)
  const fixtures = seasonNumber === season.seasonNumber ? season.fixtures : archive?.fixtures
  if (!fixtures) return null
  const entry = getPostseasons({ ...season, fixtures, divisions: seasonNumber === season.seasonNumber ? season.divisions : archive?.divisions }, seasonNumber).find(item => item.league.id === leagueId)
  if (!entry) return null
  const name = (id: string) => season.clubs.find(club => club.id === id)?.name ?? worldOf(season).clubs.find(club => club.id === id)?.name ?? id
  const stages = [...new Set(entry.series.map(series => series.stage))]
  // NBA step 5: the NBA names its rounds and each series' conference.
  const nba = worldOf(season).nba?.leagueId === leagueId
  const stageName = (stage: PostseasonSeriesState['stage']) => nba ? NBA_STAGES[stage] ?? STAGES[stage] : STAGES[stage]
  const conferenceOf = (series: PostseasonSeriesState) => !nba ? null : series.id.startsWith('east-') ? 'East' : series.id.startsWith('west-') ? 'West' : null
  const nextGame = (series: PostseasonSeriesState) => fixtures.find(fixture => series.fixtureIds.includes(fixture.id) && !fixture.result)
  const start = postseasonSlotDay(worldOf(season), seasonNumber, 1, leagueId).date
  const { champion, promoted, relegated } = entry.outcome
  const decided = (ids: (string | null)[]) => ids.filter((id): id is string => !!id)
  // A division with another division of the game below sends its relegated clubs there. Without one, its relegated clubs
  // leave the game's leagues when the world lists the real next division (step 3.4d-2), and otherwise stay.
  const world = worldOf(season)
  const lowerInGame = !!world.domesticLeagues?.some(league => league.country === entry.league.country && league.tier === entry.league.tier + 1)
  const nextDivision = (world.lowerDivisions ?? []).find(item => item.country === entry.league.country && item.tier === entry.league.tier + 1)
  const exchange = (season.background?.exchanges ?? []).find(item => item.seasonNumber === seasonNumber && item.leagueId === leagueId)
  const returning = (id: string) => (season.background?.clubs ?? []).some(club => club.id === id && club.since <= seasonNumber)
  return <section className="postseason panel" aria-labelledby="postseason-title">
    <header className="season-panel-heading"><div><h2 id="postseason-title">Playoffs</h2><p>{entry.format.label}{entry.format.verified ? '' : ' · default format (official 2026-27 rules not found)'}</p></div></header>
    {!entry.order ? <p className="season-table-note">The playoffs start after the regular season, from {formatDate(start)}. Seeds come from the final regular-season table.</p> : <>
      {(champion && entry.series.every(series => series.winner)) || decided(promoted).length || decided(relegated.map(item => item.clubId)).length ? <ul className="postseason-outcome">
        {champion && ('series' in entry.format.champion ? entry.series.find(series => series.id === 'final')?.winner : true) && <li><strong>Champion</strong>{name(champion)}</li>}
        {decided(promoted).length > 0 && <li><strong>Promoted</strong>{decided(promoted).map(name).join(', ')}</li>}
        {decided(relegated.map(item => item.clubId)).length > 0 && <li><strong>Relegated</strong>{relegated.filter(item => item.clubId).map(item => `${name(item.clubId!)}${item.unlessWinsLowerFinal ? ' (unless it wins the lower division\'s promotion final)' : ''}`).join(', ')}{!lowerInGame && (nextDivision ? !exchange && <small className="postseason-note"> · they leave for {nextDivision.name} when the season ends</small> : <small className="postseason-note"> · they stay: the division below is not in this game</small>)}</li>}
        {exchange && <li><strong>Leaving</strong>{exchange.leaving.map(name).join(', ')}<small className="postseason-note"> · to {nextDivision?.name ?? 'the division below'}, outside the game's leagues</small></li>}
        {exchange && <li><strong>Joining</strong>{exchange.joining.map(id => `${name(id)} (${returning(id) ? 'returning' : 'generated squad'})`).join(', ')}<small className="postseason-note"> · from {nextDivision?.name ?? 'the division below'}</small></li>}
      </ul> : null}
      {stages.map(stage => <div key={stage} className="postseason-stage">
        <h3>{stageName(stage)}</h3>
        <ul>{entry.series.filter(series => series.stage === stage).map(series => {
          const upcoming = nextGame(series)
          const sides = series.higher && series.lower ? [series.higher, series.lower] : null
          return <li key={series.id} className={sides?.some(side => side.clubId === managedId) ? 'postseason-series postseason-managed' : 'postseason-series'} data-series-id={series.id}>
            {conferenceOf(series) && <small className="postseason-conference">{conferenceOf(series)}</small>}
            {sides ? <span className="postseason-teams">{sides.map(side => <span key={side.clubId} className={series.winner === side.clubId ? 'postseason-winner' : series.loser === side.clubId ? 'postseason-loser' : undefined}><small>{side.rank}</small>{name(side.clubId)}<b>{series.wins[side.clubId] ?? 0}</b></span>)}</span> : <span className="postseason-waiting">To be decided</span>}
            <span className="postseason-status">{series.bestOf === 1 ? 'Single game' : `Best of ${series.bestOf}`}{series.neutral ? ' · one venue' : ''}{series.winner ? ` · ${name(series.winner)} advance` : upcoming ? ` · next ${formatDate(upcoming.date)}` : ''}</span>
          </li>
        })}</ul>
      </div>)}
    </>}
  </section>
}
