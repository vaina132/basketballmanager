import type { SeasonState } from '../domain/season'
import { seasonRounds } from '../world/career-world'
import { seasonLeagues } from '../world/divisions'
import { isMarketActive } from '../world/market-policy'
import { getStandings } from '../world/season'
import { careerToday, gameDate } from './career-text'
import { Icon } from './Icon'
import type { Page } from './navigation'
import './season-progress.css'

/** Owner feedback (22 November 2026): the season strip shows only on the Desk; the top bar carries the key facts on every page. */
export function showsSeasonStrip(page: Page): boolean { return page === 'home' }

/** The season in a few words for the top bar (owner feedback, 22 November 2026): "Matchday 1/43 · 0-0", the place once games are played. */
export function seasonFacts(season: SeasonState): string {
  if (season.status === 'complete') return isMarketActive(season) ? 'Offseason' : `Season ${season.seasonNumber} complete`
  const fixture = season.fixtures.find(item => item.id === season.activeFixtureId)
  const standing = getStandings(season).find(row => row.clubId === season.managedClubId)
  const record = standing ? ` · ${standing.wins}-${standing.losses}` : ''
  const place = standing?.played ? ` · ${ordinal(standing.position)}` : ''
  return `Matchday ${fixture?.round ?? season.round}/${seasonRounds(season)}${record}${place}`
}
const ordinal = (value: number) => `${value}${value % 100 >= 11 && value % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][value % 10] ?? 'th'}`

/** Where the season stands; the one Continue on the top bar moves it on (owner request, 16 November 2026). */
export function SeasonProgress({ season, onCompetition }: { season: SeasonState; onCompetition: () => void }) {
  const fixture = season.fixtures.find(item => item.id === season.activeFixtureId)
  const standing = getStandings(season).find(row => row.clubId === season.managedClubId)!
  // The day the career stands on (a midweek game day included), in the same words as the desk panel and the notices.
  const today = careerToday(season), date = gameDate(today, true)
  return <section className="season-progress panel" aria-label="Season progress">
    <div><time dateTime={today}>{date}</time><span>{season.status === 'complete' ? isMarketActive(season) ? 'Offseason recruitment' : `Season ${season.seasonNumber} complete` : `Season ${season.seasonNumber} / Matchday ${fixture?.round ?? season.round} / ${seasonRounds(season)}`}</span></div>
    <div className="season-record"><strong>{standing.played ? `${standing.position} / ${(season.world ? seasonLeagues(season.world, season.divisions) : []).find(league => league.clubIds.includes(season.managedClubId))?.clubIds.length ?? season.clubs.length}` : 'Unplayed'}</strong><span>{standing.wins} W / {standing.losses} L</span></div>
    <button className="text-button" onClick={onCompetition}>League table<Icon name="chevron" size={14} /></button>
  </section>
}
