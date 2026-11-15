import { useMemo, useState } from 'react'
import type { SeasonState } from '../domain/season'
import { postseasonWorldWeeks, regularWorldRounds, seasonRounds, worldOf } from '../world/career-world'
import { seasonLeagues } from '../world/divisions'
import { reservedEuropeanDays } from '../world/europe'
import { dateForRound, postseasonSlotDay } from '../world/season'
import { POSTSEASON_SLOT_OFFSETS } from '../world/postseason'
import './season-workspace.css'

const dateFormatter = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
const formatDate = (date: string) => dateFormatter.format(new Date(`${date}T00:00:00Z`))

/**
 * The season's calendar (owner feedback point 8, step 3.5g): every week from the first Saturday, its game days and
 * competitions, the manager's own games, and the days still reserved for playoffs and knockout rounds.
 */
export function SeasonCalendar({ season }: { season: SeasonState }) {
  const world = worldOf(season)
  const [ownOnly, setOwnOnly] = useState(false)
  const leagues = seasonLeagues(world, season.divisions)
  const competitionName = (fixture: SeasonState['fixtures'][number]) => fixture.competition ? world.europeanCompetitions?.find(item => item.id === fixture.competition)?.name ?? fixture.competition : leagues.find(league => league.clubIds.includes(fixture.homeClubId))?.name ?? 'League'
  const club = (id: string) => season.clubs.find(team => team.id === id) ?? world.clubs.find(team => team.id === id)
  const managedId = season.managedClubId
  const weeks = useMemo(() => {
    const reserved = [
      ...reservedEuropeanDays(world, season.seasonNumber).map(entry => ({ date: entry.date, round: entry.round, competitionId: entry.competitionId as string | null, name: `${world.europeanCompetitions?.find(item => item.id === entry.competitionId)?.name ?? entry.competitionId} · ${entry.label}` })),
      ...(world.domesticLeagues?.some(league => league.postseason) ? Array.from({ length: postseasonWorldWeeks(world) * POSTSEASON_SLOT_OFFSETS.length }, (_, index) => ({ ...postseasonSlotDay(world, season.seasonNumber, index + 1), competitionId: null as string | null, name: 'Domestic playoffs' })) : []),
    ]
    return Array.from({ length: seasonRounds(season) }, (_, index) => {
      const round = index + 1, games = season.fixtures.filter(fixture => fixture.round === round)
      const dates = [...new Set([...games.map(fixture => fixture.date), ...reserved.filter(entry => entry.round === round).map(entry => entry.date)])].sort()
      return { round, saturday: dateForRound(round, season.seasonNumber), days: dates.map(date => {
        const today = games.filter(fixture => fixture.date === date)
        const byCompetition = new Map<string, number>()
        for (const fixture of today) byCompetition.set(competitionName(fixture), (byCompetition.get(competitionName(fixture)) ?? 0) + 1)
        // A reserved day already holding that competition's games is shown by its games.
        const open = reserved.filter(entry => entry.date === date && !today.some(fixture => entry.competitionId ? fixture.competition === entry.competitionId : !fixture.competition && fixture.stage))
        return { date, competitions: [...byCompetition], own: today.find(fixture => fixture.homeClubId === managedId || fixture.awayClubId === managedId), reserved: [...new Set(open.map(entry => entry.name))] }
      }) }
    })
  }, [season, world, managedId])
  const regular = regularWorldRounds(world)
  const shown = ownOnly ? weeks.filter(week => week.days.some(day => day.own)) : weeks
  return <div className="season-workspace season-calendar">
    <section className="season-fixtures panel" aria-labelledby="calendar-title">
      <header className="season-panel-heading season-fixtures-heading"><h2 id="calendar-title">Season calendar</h2><label className="season-own-filter"><input type="checkbox" checked={ownOnly} onChange={event => setOwnOnly(event.target.checked)} /> Weeks with your games only</label></header>
      <p className="muted">Domestic games are on Saturdays; European games are midweek. Days still reserved for playoffs or knockout rounds are used only if those games are needed.</p>
      <div className="season-table-scroll"><table className="season-fixtures-table calendar-table"><thead><tr><th scope="col">Week</th><th scope="col">Day</th><th scope="col">Competitions</th><th scope="col">Your game</th></tr></thead>
        <tbody>{shown.flatMap(week => (week.days.length ? week.days : [{ date: week.saturday, competitions: [], own: undefined, reserved: [] }]).map((day, index) => {
          const own = day.own, opponent = own ? club(own.homeClubId === managedId ? own.awayClubId : own.homeClubId) : undefined
          return <tr key={`${week.round}:${day.date}`} className={week.round === season.round && season.status === 'active' ? 'season-managed-row' : ''} aria-current={week.round === season.round && season.status === 'active' && index === 0 ? 'date' : undefined}>
            <td>{index === 0 ? week.round > regular ? `Playoffs ${week.round - regular}` : `Week ${week.round}` : ''}</td>
            <td><time dateTime={day.date}>{formatDate(day.date)}</time></td>
            <td>{day.competitions.length ? day.competitions.map(([name, count]) => `${name} (${count})`).join(' · ') : day.reserved.length ? '' : 'No games'}{day.reserved.length > 0 && <small>{day.competitions.length ? ' · ' : ''}Reserved: {day.reserved.join(', ')}</small>}</td>
            <td>{own && opponent ? <>{own.homeClubId === managedId ? 'vs' : 'at'} <strong>{opponent.name}</strong> · {competitionName(own)}{own.result ? ` · ${own.result.officialScore[own.homeClubId === managedId ? 'home' : 'away']}–${own.result.officialScore[own.homeClubId === managedId ? 'away' : 'home']} ${own.result.winnerClubId === managedId ? 'W' : 'L'}` : ''}</> : ''}</td>
          </tr>
        }))}</tbody></table></div>
    </section>
  </div>
}
