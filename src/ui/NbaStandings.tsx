import type { ArchivedFixture, SeasonFixture, SeasonState } from '../domain/season'
import type { Team } from '../domain/types'
import { worldOf } from '../world/career-world'
import { nbaStandings } from '../world/season'
import { ClubBadge } from './ClubLogo'

/**
 * NBA step 5: the NBA's regular season on the League tab, one table per conference. Places 1-6 go straight to the
 * playoffs and 7-10 to the play-in (shown as words, not colour only); "GB" is games behind the conference leader.
 */
export function NbaStandings({ season, fixtures, managedId, seasonLabel }: { season: SeasonState; fixtures: readonly (SeasonFixture | ArchivedFixture)[]; managedId: string | null; seasonLabel: string }) {
  const world = worldOf(season), nba = world.nba
  const tables = nba ? nbaStandings(world, fixtures) : null
  if (!nba || !tables) return null
  const club = (id: string): Team => season.clubs.find(team => team.id === id) ?? world.clubs.find(team => team.id === id)!
  const played = fixtures.filter(fixture => !fixture.stage && !fixture.competition && fixture.result && nba.conferences.some(conference => conference.divisions.some(division => division.clubIds.includes(fixture.homeClubId)))).length
  const divisionOf = (id: string) => nba.conferences.flatMap(conference => conference.divisions).find(division => division.clubIds.includes(id))!
  return <section className="season-standings panel nba-standings" aria-labelledby="nba-standings-title" data-nba-standings>
    <header className="season-panel-heading"><div><h2 id="nba-standings-title">Conference standings</h2><p>NAL · {seasonLabel}</p></div><span>{played} of {tables.league.length * 41} games played</span></header>
    {nba.conferences.map(conference => {
      const rows = tables.conferences[conference.id] ?? []
      const leader = rows[0]
      return <div key={conference.id} className="season-table-scroll" data-nba-conference={conference.id}>
        <table className="season-standings-table" aria-label={conference.name}>
          <caption>{conference.name}</caption>
          <thead><tr><th scope="col">#</th><th scope="col">Club</th><th scope="col" title="Wins">W</th><th scope="col" title="Losses">L</th><th scope="col" title="Winning percentage">Pct</th><th scope="col" title="Games behind the conference leader">GB</th><th scope="col">Division</th><th scope="col">Seed</th></tr></thead>
          <tbody>{rows.map(row => {
            const behind = leader ? ((leader.wins - row.wins) + (row.losses - leader.losses)) / 2 : 0
            const seed = row.position <= 6 ? 'Playoffs' : row.position <= 10 ? 'Play-in' : ''
            return <tr key={row.clubId} className={row.clubId === managedId ? 'season-managed-row' : undefined} data-nba-seed={seed || undefined}>
              <td>{row.position}{row.rankingTie === 'unresolved' && <span className="season-tie-mark" title="Still tied on the tie-breaks; display order only" aria-label="Still tied">=</span>}</td>
              <th scope="row"><span className="season-club-name"><ClubBadge club={club(row.clubId)} className="season-club-code" /><span>{club(row.clubId).name}{row.clubId === managedId && <small>Your club</small>}</span></span></th>
              <td>{row.wins}</td><td>{row.losses}</td><td>{row.played ? (row.wins / row.played).toFixed(3).replace(/^0/, '') : '.000'}</td><td>{behind === 0 ? '–' : behind.toFixed(1)}</td>
              <td>{divisionOf(row.clubId).name}</td><td>{seed && <small className="nba-seed-mark">{seed}</small>}</td>
            </tr>
          })}</tbody>
        </table>
      </div>
    })}
    <details className="season-table-rules"><summary>Table rules <span>NAL · Winning percentage</span></summary>
      <p>Clubs are ranked by winning percentage. Places 1-6 of each conference reach the playoffs; places 7-10 play the play-in for the seventh and eighth seeds.</p>
      <p>Ties: games between the clubs, then a division winner first, division record, conference record and records against playoff clubs, then point difference. A tie left after every step uses a reproducible draw; “=” marks an unresolved tie during the season.</p>
    </details>
  </section>
}
