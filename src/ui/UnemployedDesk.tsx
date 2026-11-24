import type { SeasonFixture, SeasonState } from '../domain/season'
import type { CareerMove } from '../domain/career'
import type { Team } from '../domain/types'
import { currentUnemployment } from '../world/career'
import { jobMarket, jobRefusal, VACANCY_BASE_REQUIREMENT, VACANCY_STEP, type JobVacancy } from '../world/career-policy'
import { CAREER_RULES, CAREER_RULES_TEXT, NO_CLUB } from '../world/career-rules'
import { seasonRounds, worldOf } from '../world/career-world'
import { seasonLeagues } from '../world/divisions'
import { getMarketStartReason, getNextMarketDate, isMarketActive } from '../world/market-policy'
import { currentGameDay, seasonLabel, seasonStartDate } from '../world/season'
import { careerMoveOutcome } from './career-text'
import { Icon } from './Icon'
import { medicalDate } from './SeasonMedicalReport'
import './unemployed-desk.css'
import { careerBalanceNote } from '../world/career-balance'
import { euroleagueJobsNote } from '../world/euroleague-jobs'
import { ClubBadge } from './ClubLogo'

interface UnemployedDeskProps {
  season: SeasonState
  busy: boolean
  onAccept: (clubId: string) => void
  onOpenCompetitions: () => void
  onOpenCalendar: () => void
}

const ordinal = (position: number) => `${position}${position % 10 === 1 && position !== 11 ? 'st' : position % 10 === 2 && position !== 12 ? 'nd' : position % 10 === 3 && position !== 13 ? 'rd' : 'th'}`
const NEXT_GAMES_SHOWN = 8

/** The periods of a career: each club managed and each spell without a club, oldest first. */
export function careerPeriods(season: Pick<SeasonState, 'managedClubId' | 'career' | 'date'>, start: string): { clubId: string; from: string; until: string | null; ended?: CareerMove }[] {
  const moves = season.career?.moves ?? []
  const periods: { clubId: string; from: string; until: string | null; ended?: CareerMove }[] = []
  let clubId = moves[0]?.fromClubId ?? season.managedClubId, from = start
  for (const move of moves) {
    periods.push({ clubId, from, until: move.date, ended: move })
    clubId = move.toClubId; from = move.date
  }
  periods.push({ clubId, from, until: null })
  return periods
}

/**
 * Career-3 (format 69): the desk of a manager without a club. It shows only recorded game state: the date, the next
 * games in the world, the jobs open now with what each board looks for, the faded reputation and the career so far.
 */
export function UnemployedDesk({ season, busy, onAccept, onOpenCompetitions, onOpenCalendar }: UnemployedDeskProps) {
  const world = worldOf(season)
  const market = jobMarket(season)
  const left = currentUnemployment(season)
  const club = (id: string): Team | undefined => season.clubs.find(team => team.id === id) ?? world.clubs.find(team => team.id === id)
  const name = (id: string) => id === NO_CLUB ? 'Without a club' : club(id)?.name ?? id
  const leagues = world.domesticLeagues ? seasonLeagues(world, season.divisions) : []
  const leagueOf = (clubId: string) => leagues.find(league => league.clubIds.includes(clubId))?.name ?? world.name
  const competitionOf = (fixture: SeasonFixture) => fixture.competition ? world.europeanCompetitions?.find(item => item.id === fixture.competition)?.name ?? fixture.competition : leagueOf(fixture.homeClubId)
  const offseason = season.status === 'complete'
  const rounds = seasonRounds(season)
  const day = currentGameDay(season)
  const upcoming = offseason ? [] : season.fixtures.filter(fixture => fixture.round === season.round && !fixture.result).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1)
  const startReason = offseason && season.market.enabledSince ? getMarketStartReason(season) : null
  const reputation = market?.reputation
  const careerStart = season.career.enabledSince?.date ?? season.date
  const periods = careerPeriods(season, careerStart).reverse()
  const daysOut = reputation?.days ?? 0
  // Only the best fits offer the job (CAREER_RULES.maxJobOffers); another club within reach chose other candidates.
  const status = (vacancy: JobVacancy) => vacancy.offered ? 'Offers you the job' : market && vacancy.requirement <= market.reputation.value ? 'Chose other candidates' : `Looks for ${vacancy.requirement}`
  const placeText = (vacancy: JobVacancy) => vacancy.opened === 'season' ? `${ordinal(vacancy.position)} after matchday ${vacancy.round}` : `Finished ${ordinal(vacancy.position)}`

  return <div className="unemployed-desk" data-unemployed-desk>
    <section className="panel unemployed-status" aria-labelledby="unemployed-title">
      <header className="unemployed-heading"><h2 id="unemployed-title"><Icon name="shield" size={16} />Without a club</h2><time dateTime={season.date}>{medicalDate(season.date)}</time></header>
      <div className="unemployed-status-body">
        <p className="unemployed-lead">{left ? <>{left.reason === 'resigned' ? `You resigned from ${name(left.fromClubId)}` : `${name(left.fromClubId)}'s board dismissed you`} on <time dateTime={left.date}>{medicalDate(left.date)}</time>. You have been without a club for {daysOut === 1 ? 'one day' : `${daysOut} days`}.</> : 'You are without a club.'} Every club, including your last one, is run automatically and every competition keeps playing.</p>
        <dl className="unemployed-facts">
          <div><dt>Season</dt><dd>{seasonLabel(season.seasonNumber)}</dd></div>
          <div><dt>{offseason ? 'Calendar' : 'Week'}</dt><dd>{offseason ? isMarketActive(season) ? 'Offseason recruitment' : 'Season complete' : `${season.round} of ${rounds}`}</dd></div>
          <div><dt>Reputation</dt><dd data-unemployed-reputation={reputation?.value}>{reputation?.value ?? '—'}<small>/100</small></dd></div>
        </dl>
        {/* The one Continue on the top bar plays each week, each recruitment day and starts the next season (16 November 2026). */}
        <p className="unemployed-note" data-unemployed-next>{offseason ? startReason ?? `Recruitment is complete: Continue starts ${seasonLabel(season.seasonNumber + 1)}.` : season.round === rounds ? 'Continue plays the final week and finishes the season.' : 'Continue plays every club\'s games this week.'}</p>
      </div>
    </section>

    <div className="unemployed-columns">
      <section className="panel unemployed-market" aria-labelledby="unemployed-market-title">
        <header className="unemployed-heading"><h2 id="unemployed-market-title"><Icon name="mail" size={16} />Job market</h2><span>{market?.vacancies.length ? `${market.vacancies.length} open ${market.vacancies.length === 1 ? 'job' : 'jobs'}` : 'No open jobs'}</span></header>
        {market?.vacancies.length ? <ul className="unemployed-jobs" aria-label="Open jobs">{market.vacancies.map(vacancy => {
          const team = club(vacancy.clubId), refusal = jobRefusal(season, vacancy.clubId)
          return <li key={vacancy.clubId} data-job-club={vacancy.clubId} data-job-offered={vacancy.offered}>
            <div className="unemployed-job-club"><ClubBadge club={team} className="unemployed-club-code" fallback={team?.shortName ?? vacancy.clubId.slice(0, 3).toUpperCase()} /><div><strong>{name(vacancy.clubId)}</strong><span>{leagueOf(vacancy.clubId)} · {placeText(vacancy)} · board confidence {vacancy.confidence}</span></div></div>
            <p>{vacancy.opened === 'season' ? 'The board replaced its head coach; an interim head coach has the team.' : 'Its season ended Under pressure, so the board is replacing its head coach.'} It looks for a reputation of {vacancy.requirement}. {vacancy.openUntil ? <>Open until <time dateTime={vacancy.openUntil}>{medicalDate(vacancy.openUntil)}</time>.</> : 'Open through this offseason.'}</p>
            <div className="unemployed-job-action"><span className="unemployed-job-status" data-state={vacancy.offered ? 'offered' : 'closed'}><Icon name={vacancy.offered ? 'check' : 'target'} size={14} />{status(vacancy)}</span>
              {vacancy.offered && <button className="button" data-accept-job={vacancy.clubId} onClick={() => onAccept(vacancy.clubId)} disabled={busy || !!refusal} aria-describedby={refusal ? `job-refusal-${vacancy.clubId}` : undefined}>Accept job</button>}
              {vacancy.offered && refusal && <small id={`job-refusal-${vacancy.clubId}`}>{refusal}</small>}
            </div>
          </li>
        })}</ul> : <p className="unemployed-empty">No club is looking for a head coach right now. Boards replace their head coach after a review below {CAREER_RULES.midSeasonDismissalBelow} once a third of the season is played, and when a season ends Under pressure; those jobs appear here.</p>}
        <p className="unemployed-note">Clubs look for a reputation of {VACANCY_BASE_REQUIREMENT} for last place and {VACANCY_STEP} more for each place higher. {CAREER_RULES_TEXT.offers}{euroleagueJobsNote(season.world)} {CAREER_RULES_TEXT.unemployed}</p>
      </section>

      <div className="unemployed-side">
        <section className="panel unemployed-reputation" aria-labelledby="unemployed-reputation-title">
          <header className="unemployed-heading"><h2 id="unemployed-reputation-title"><Icon name="target" size={16} />Reputation</h2><span>{reputation ? `${reputation.value} / 100` : '—'}</span></header>
          {reputation && <dl className="unemployed-facts unemployed-facts-list">
            <div><dt>When you left</dt><dd>{reputation.base}</dd></div>
            <div><dt>Based on</dt><dd>{reputation.seasons.map(item => `${seasonLabel(item.seasonNumber)}: ${item.confidence}`).join(' · ') || 'No final board review'}{reputation.resignations ? ` · −${reputation.resignations * CAREER_RULES.resignationReputationCost} for ${reputation.resignations === 1 ? 'a resignation' : `${reputation.resignations} resignations`}` : ''}</dd></div>
            <div><dt>Now</dt><dd>{reputation.value}<small>{reputation.value === reputation.base ? ' · unchanged so far' : ` · ${reputation.value < reputation.base ? 'faded' : 'recovered'} by ${Math.abs(reputation.base - reputation.value)}`}</small></dd></div>
          </dl>}
          <p className="unemployed-note">{CAREER_RULES_TEXT.fade}{careerBalanceNote(season)}</p>
        </section>

        <section className="panel unemployed-fixtures" aria-labelledby="unemployed-fixtures-title">
          <header className="unemployed-heading"><h2 id="unemployed-fixtures-title"><Icon name="calendar" size={16} />{offseason ? 'Next season' : 'This week\'s games'}</h2>{!offseason && day && <time dateTime={day}>{medicalDate(day)}</time>}</header>
          {offseason ? <p className="unemployed-empty">{seasonLabel(season.seasonNumber + 1)} starts on <time dateTime={seasonStartDate(season.seasonNumber + 1)}>{medicalDate(seasonStartDate(season.seasonNumber + 1))}</time>. The fixtures are drawn when it starts.</p>
            : upcoming.length ? <ul className="unemployed-games" aria-label="Next games in the world">{upcoming.slice(0, NEXT_GAMES_SHOWN).map(fixture => <li key={fixture.id}><time dateTime={fixture.date}>{medicalDate(fixture.date)}</time><span><strong>{name(fixture.homeClubId)}</strong> vs <strong>{name(fixture.awayClubId)}</strong></span><small>{competitionOf(fixture)}</small></li>)}</ul>
              : <p className="unemployed-empty">No games are left this week.</p>}
          <div className="unemployed-links">{upcoming.length > NEXT_GAMES_SHOWN && <span>{upcoming.length - NEXT_GAMES_SHOWN} more this week.</span>}<button className="text-button" onClick={onOpenCompetitions}>Tables and results<Icon name="chevron" size={14} /></button><button className="text-button" onClick={onOpenCalendar}>Season calendar<Icon name="chevron" size={14} /></button></div>
        </section>
      </div>
    </div>

    <section className="panel unemployed-career" aria-labelledby="unemployed-career-title">
      <header className="unemployed-heading"><h2 id="unemployed-career-title"><Icon name="people" size={16} />Your career</h2><span>{periods.length} {periods.length === 1 ? 'period' : 'periods'}</span></header>
      <div className="unemployed-career-scroll" tabIndex={0} role="region" aria-label="Career periods"><table><thead><tr><th scope="col">Club</th><th scope="col">From</th><th scope="col">Until</th><th scope="col">How it ended</th></tr></thead><tbody>{periods.map((period, index) => <tr key={`${period.from}-${index}`} data-career-period={period.clubId || 'unemployed'}>
        <th scope="row">{name(period.clubId)}</th><td><time dateTime={period.from}>{medicalDate(period.from)}</time></td><td>{period.until ? <time dateTime={period.until}>{medicalDate(period.until)}</time> : 'Now'}</td><td>{period.ended ? careerMoveOutcome(season, period.ended) : '—'}</td>
      </tr>)}</tbody></table></div>
    </section>
  </div>
}
