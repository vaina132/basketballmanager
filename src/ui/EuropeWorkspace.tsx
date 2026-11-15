import { useMemo, useState } from 'react'
import type { ArchivedFixture, SeasonFixture, SeasonState, Standing } from '../domain/season'
import type { Team } from '../domain/types'
import { worldOf } from '../world/career-world'
import { managedClubFor } from '../world/career'
import { getEuropeanCompetitions } from '../world/europe'
import { estimatedTable } from '../world/european-places'
import { seasonLabel } from '../world/season'
import './season-workspace.css'

const dateFormatter = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const formatDate = (date: string) => dateFormatter.format(new Date(`${date}T00:00:00Z`))
const STAGES: Record<string, string> = { qualifying: 'Qualification', 'play-in': 'Play-in', 'round-of-16': 'Round of 16', 'quarter-final': 'Quarter-finals', 'semi-final': 'Semi-finals', 'third-place': 'Third place', final: 'Final' }
const signed = (value: number) => value > 0 ? `+${value}` : String(value)

function ClubName({ club, yours = false }: { club: Team; yours?: boolean }) {
  return <span className="season-club-name"><span className="season-club-code" style={{ color: club.color }}>{club.shortName}</span><span>{club.name}{yours && <small>Your club</small>}</span></span>
}

/**
 * European competitions (step 3.5g): each competition's tables, knockout series and games for a season, and the
 * estimated tables of the top divisions not chosen. Everything shown comes from the career's games and records.
 */
export function EuropeWorkspace({ season, initialCompetition }: { season: SeasonState; initialCompetition?: string }) {
  const world = worldOf(season)
  const [selectedSeason, setSelectedSeason] = useState(season.seasonNumber)
  const archive = season.history.find(entry => entry.seasonNumber === selectedSeason)
  const fixtures: readonly (SeasonFixture | ArchivedFixture)[] = archive?.fixtures ?? season.fixtures
  const europe = archive ? archive.europe : season.europe
  const competitions = useMemo(() => getEuropeanCompetitions({ world, seed: season.seed, fixtures, ...(europe ? { europe } : {}) }, selectedSeason), [world, season.seed, fixtures, europe, selectedSeason])
  const backgroundLeagues = world.backgroundLeagues ?? []
  const managedId = managedClubFor(season, selectedSeason, false)
  const own = competitions.find(entry => entry.table.some(row => row.clubId === managedId) || entry.fixtures.some(fixture => fixture.homeClubId === managedId || fixture.awayClubId === managedId))
  const [selected, setSelected] = useState(() => initialCompetition ?? own?.competition.id ?? competitions[0]?.competition.id ?? backgroundLeagues[0]?.id ?? '')
  const [ownOnly, setOwnOnly] = useState(false)
  const club = (id: string) => season.clubs.find(team => team.id === id) ?? world.clubs.find(team => team.id === id)!
  const entry = competitions.find(item => item.competition.id === selected)
  const league = backgroundLeagues.find(item => item.id === selected)

  const table = (rows: readonly Standing[], caption: string) => <div className="season-table-scroll"><table className="season-standings-table"><caption className="sr-only">{caption}</caption><thead><tr><th scope="col">#</th><th scope="col">Club</th><th scope="col" title="Played">P</th><th scope="col" title="Wins">W</th><th scope="col" title="Losses">L</th><th scope="col" title="Points scored">PF</th><th scope="col" title="Points conceded">PA</th><th scope="col" title="Point difference">+/-</th></tr></thead>
    <tbody>{rows.map(row => <tr key={row.clubId} className={row.clubId === managedId ? 'season-managed-row' : ''}><td>{row.position}</td><th scope="row"><ClubName club={club(row.clubId)} yours={row.clubId === managedId} /></th><td>{row.played}</td><td>{row.wins}</td><td>{row.losses}</td><td>{row.pointsFor}</td><td>{row.pointsAgainst}</td><td>{signed(row.difference)}</td></tr>)}</tbody></table></div>

  const games = entry ? fixtures.filter(fixture => fixture.competition === entry.competition.id && (!ownOnly || fixture.homeClubId === managedId || fixture.awayClubId === managedId)) : []
  const label = (fixture: SeasonFixture | ArchivedFixture) => fixture.stage ? `${STAGES[fixture.stage] ?? fixture.stage}${fixture.stage === 'round-of-16' ? ` · Group ${fixture.seriesId?.replace('r16-', '')}` : fixture.game && entry?.series.find(series => series.id === fixture.seriesId)?.bestOf !== 1 ? ` · Game ${fixture.game}` : ''}` : 'Regular season'
  const champion = entry?.outcome.champion ? club(entry.outcome.champion) : null

  return <div className="season-workspace europe-workspace">
    <section className="season-matchday panel" aria-label="European competition">
      <div className="season-matchday-identity">
        <div className="season-year-filter"><label htmlFor="europe-competition">Competition</label><select id="europe-competition" aria-label="European competition" value={selected} onChange={event => setSelected(event.target.value)}>
          {competitions.map(item => <option key={item.competition.id} value={item.competition.id}>{item.competition.name}</option>)}
          {backgroundLeagues.map(item => <option key={item.id} value={item.id}>{item.name} · estimated</option>)}
        </select></div>
        <div className="season-year-filter"><label htmlFor="europe-season">Season</label><select id="europe-season" aria-label="Season" value={selectedSeason} onChange={event => setSelectedSeason(Number(event.target.value))}>
          <option value={season.seasonNumber}>{seasonLabel(season.seasonNumber)} · Current</option>
          {[...season.history].reverse().map(item => <option key={item.seasonNumber} value={item.seasonNumber}>{seasonLabel(item.seasonNumber)} · Archived</option>)}
        </select></div>
      </div>
      <div className="season-matchday-action"><p>{entry ? champion ? <><strong>{champion.name}</strong> win the {entry.competition.name}.</> : `${entry.format.label}: ${entry.table.length || entry.competition.clubIds.length} clubs.` : league ? `${league.name} plays no games in this career. Its final table is estimated from squad strength with a seeded random element, and it decides only European places.` : 'No European competition is played in this career.'}</p></div>
    </section>

    {entry && <>
      {entry.tables.filter(group => group.rows.length).length > 0 && <section className="season-standings panel" aria-labelledby="europe-tables-title">
        <header className="season-panel-heading"><h2 id="europe-tables-title">{entry.tables.length > 1 ? 'Groups' : 'Regular-season table'}</h2></header>
        {entry.tables.filter(group => group.rows.length).map(group => <div key={group.id ?? 'table'}>{group.id && <h3 className="europe-group-title">Group {group.id}</h3>}{table(group.rows, group.id ? `Group ${group.id}` : entry.competition.name)}</div>)}
        <details className="season-table-rules"><summary>Table rules <span>FIBA default · Classification points</span></summary><p>The competition's own tie-break text has not been checked, so the game uses the FIBA Official Basketball Rules 2026, Appendix D: 2 points for a win, 1 for a loss, then the games between tied clubs.</p></details>
      </section>}
      {entry.roundOf16.some(group => group.rows.length) && <section className="season-standings panel" aria-labelledby="europe-r16-title">
        <header className="season-panel-heading"><h2 id="europe-r16-title">Round of 16</h2></header>
        {entry.roundOf16.filter(group => group.rows.length).map(group => <div key={group.id ?? 'r16'}><h3 className="europe-group-title">Group {group.id}</h3>{table(group.rows, `Round of 16 group ${group.id}`)}</div>)}
      </section>}
      {entry.series.some(series => series.higher) && <section className="season-standings panel" aria-labelledby="europe-series-title">
        <header className="season-panel-heading"><h2 id="europe-series-title">Knockout rounds</h2></header>
        <div className="season-table-scroll"><table className="season-fixtures-table"><thead><tr><th scope="col">Round</th><th scope="col">Better seed</th><th scope="col">Wins</th><th scope="col">Opponent</th><th scope="col">Format</th></tr></thead>
          <tbody>{entry.series.filter(series => series.higher && series.lower).map(series => <tr key={series.id} className={[series.higher!.clubId, series.lower!.clubId].includes(managedId) ? 'season-managed-row' : ''}>
            <td>{STAGES[series.stage] ?? series.stage}</td><td><ClubName club={club(series.higher!.clubId)} yours={series.higher!.clubId === managedId} />{series.winner === series.higher!.clubId && <small> · through</small>}</td>
            <td>{series.wins[series.higher!.clubId]}–{series.wins[series.lower!.clubId]}</td><td><ClubName club={club(series.lower!.clubId)} yours={series.lower!.clubId === managedId} />{series.winner === series.lower!.clubId && <small> · through</small>}</td>
            <td>{series.bestOf === 1 ? 'Single game' : `Best of ${series.bestOf}`}{series.neutral ? ' · one venue' : ''}</td></tr>)}</tbody></table></div>
      </section>}
      <section className="season-fixtures panel" aria-labelledby="europe-fixtures-title">
        <header className="season-panel-heading season-fixtures-heading"><h2 id="europe-fixtures-title">Games &amp; results</h2><label className="season-own-filter"><input type="checkbox" checked={ownOnly} onChange={event => setOwnOnly(event.target.checked)} /> Your club only</label></header>
        <div className="season-table-scroll"><table className="season-fixtures-table"><thead><tr><th scope="col">Date</th><th scope="col">Home</th><th scope="col">Score</th><th scope="col">Away</th><th scope="col">Stage</th></tr></thead>
          <tbody>{games.map(fixture => <tr key={fixture.id} className={fixture.homeClubId === managedId || fixture.awayClubId === managedId ? 'season-managed-row' : ''}>
            <td><time dateTime={fixture.date}>{formatDate(fixture.date)}</time></td><td><ClubName club={club(fixture.homeClubId)} /></td>
            <td className="season-fixture-score">{fixture.result ? `${fixture.result.officialScore.home}–${fixture.result.officialScore.away}` : '–'}</td><td><ClubName club={club(fixture.awayClubId)} /></td><td>{label(fixture)}</td></tr>)}</tbody></table></div>
        {!games.length && <p className="muted">No games yet.</p>}
      </section>
    </>}

    {league && <section className="season-standings panel" aria-labelledby="europe-estimated-title">
      <header className="season-panel-heading"><h2 id="europe-estimated-title">{league.name} · Estimated table</h2></header>
      <div className="season-table-scroll"><table className="season-standings-table"><thead><tr><th scope="col">#</th><th scope="col">Club</th><th scope="col" title="Squad strength with the season's random element">Estimate</th></tr></thead>
        <tbody>{estimatedTable(season, league, selectedSeason).map((row, index) => <tr key={row.clubId}><td>{index + 1}</td><th scope="row"><ClubName club={club(row.clubId)} /></th><td>{row.estimate.toFixed(1)}</td></tr>)}</tbody></table></div>
      <p className="muted">Estimated, not played: clubs are ranked by the strength of their best eight players with a seeded random element. The order decides only next season's European places.</p>
    </section>}
  </div>
}
