import type { SeasonState } from '../domain/season'
import { isNbaClub, seasonRounds, worldOf } from '../world/career-world'
import { seasonLeagues } from '../world/divisions'
import { isMarketActive } from '../world/market-policy'
import { getStandings, isRegularFixture, nbaStandings } from '../world/season'
import { careerToday, gameDate } from './career-text'
import { Icon } from './Icon'
import type { Page } from './navigation'
import './season-progress.css'

/** Owner feedback (22 November 2026): the season strip shows only on the Desk; the top bar carries the key facts on every page. */
export function showsSeasonStrip(page: Page): boolean { return page === 'home' }

/** The season in a few words for the top bar (owner feedback, 22 November 2026): "Matchday 1/43 · 0-0", the place once games are played. */
export function seasonFacts(season: SeasonState): string {
  if (season.status === 'complete') return isMarketActive(season) ? 'Offseason' : `Season ${season.seasonNumber} complete`
  const nba = nbaFacts(season)
  if (nba) return nba
  const fixture = season.fixtures.find(item => item.id === season.activeFixtureId)
  const standing = getStandings(season).find(row => row.clubId === season.managedClubId)
  const record = standing ? ` · ${standing.wins}-${standing.losses}` : ''
  const place = standing?.played ? ` · ${ordinal(standing.position)}` : ''
  return `Matchday ${fixture?.round ?? season.round}/${seasonRounds(season)}${record}${place}`
}
/**
 * NBA step 5: an NBA club's season counts games, not weeks: "Game 23/82 · 14-8 · 3rd East" (the next game; the
 * conference place once games are played), then "Playoffs" once the regular season is over.
 */
export function nbaFacts(season: SeasonState): string | null {
  const world = worldOf(season), clubId = season.managedClubId
  if (!world.nba || !isNbaClub(world, clubId)) return null
  const regular = season.fixtures.filter(fixture => isRegularFixture(fixture) && (fixture.homeClubId === clubId || fixture.awayClubId === clubId))
  const played = regular.filter(fixture => fixture.result)
  const wins = played.filter(fixture => fixture.result!.winnerClubId === clubId).length
  const tables = nbaStandings(world, season.fixtures)
  const conference = world.nba.conferences.find(item => item.divisions.some(division => division.clubIds.includes(clubId)))!
  const row = tables?.conferences[conference.id]?.find(item => item.clubId === clubId)
  const place = played.length && row ? ` · ${ordinal(row.position)} ${conference.name.replace(/\s*Conference$/i, '')}` : ''
  const stage = played.length === regular.length ? 'Playoffs' : `Game ${played.length + 1}/${regular.length}`
  return `${stage} · ${wins}-${played.length - wins}${place}`
}
const ordinal = (value: number) => `${value}${value % 100 >= 11 && value % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][value % 10] ?? 'th'}`

/** Where the season stands; the one Continue on the top bar moves it on (owner request, 16 November 2026). */
export function SeasonProgress({ season, onCompetition }: { season: SeasonState; onCompetition: () => void }) {
  const fixture = season.fixtures.find(item => item.id === season.activeFixtureId)
  const standing = getStandings(season).find(row => row.clubId === season.managedClubId)!
  // The day the career stands on (a midweek game day included), in the same words as the desk panel and the notices.
  const today = careerToday(season), date = gameDate(today, true)
  return <section className="season-progress panel" aria-label="Season progress">
    <div><time dateTime={today}>{date}</time><span>{season.status === 'complete' ? isMarketActive(season) ? 'Offseason recruitment' : `Season ${season.seasonNumber} complete` : nbaFacts(season) ? `Season ${season.seasonNumber} / ${nbaFacts(season)!.split(' · ')[0]}` : `Season ${season.seasonNumber} / Matchday ${fixture?.round ?? season.round} / ${seasonRounds(season)}`}</span></div>
    <div className="season-record"><strong>{standing.played ? `${standing.position} / ${(season.world ? seasonLeagues(season.world, season.divisions) : []).find(league => league.clubIds.includes(season.managedClubId))?.clubIds.length ?? season.clubs.length}` : 'Unplayed'}</strong><span>{standing.wins} W / {standing.losses} L</span></div>
    <button className="text-button" onClick={onCompetition}>League table<Icon name="chevron" size={14} /></button>
  </section>
}
