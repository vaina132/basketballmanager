import { useMemo, useState } from 'react'
import type { SeasonState } from '../domain/season'
import { seasonRounds, worldOf } from '../world/career-world'
import { EUROPEAN_ENTRY_RULES } from '../world/european-entry'
import { dateForRound, seasonLabel } from '../world/season'
import { MoreInfo } from './MoreInfo'
import { clubName, competitionName, decidedPlaces, placeLabel, placeReason, scoreText, topReasons, usesEntryRules, yourClubCard } from './european-places'
import { medicalDate } from './SeasonMedicalReport'
import './european-places.css'

const RULES = EUROPEAN_ENTRY_RULES
const seats = (value: number) => value.toLocaleString('en-GB')

/**
 * Format 83 (owner's item C, 22 November 2026): how European places work, the manager's club's status and wild-card
 * checklist, every competition's places (this season, and next season once the places day has decided them) and the
 * wild-card ranking. Self-contained, so it can sit on any Competitions tab.
 */
export function EuropeanPlacesPanel({ season }: { season: SeasonState }) {
  const enabled = usesEntryRules(season)
  const card = useMemo(() => enabled ? yourClubCard(season) : null, [season, enabled])
  const decided = useMemo(() => enabled ? decidedPlaces(season) : null, [season, enabled])
  const [view, setView] = useState<'now' | 'next'>('now')
  const world = worldOf(season)
  const competitions = world.europeanCompetitions?.filter(item => item.format) ?? []
  const own = card?.next?.competitionId ?? card?.now?.competitionId
  const [competitionId, setCompetitionId] = useState(own ?? competitions[0]?.id ?? '')
  if (!enabled || !season.europe) return null
  const showNext = view === 'next' && !!decided
  const places = showNext ? decided! : season.europe
  const decision = showNext ? decided!.decision : season.europe.decision
  const entry = places.entrants.find(item => item.competitionId === competitionId) ?? places.entrants[0]
  const placesDay = dateForRound(seasonRounds(season), season.seasonNumber)
  const year = (offset: number) => seasonLabel(season.seasonNumber + offset)

  return <section className="panel european-places" aria-labelledby="european-places-title" data-european-places>
    <header className="season-panel-heading"><h2 id="european-places-title">European places</h2></header>
    <MoreInfo label="How European places work" className="european-places-help">
      <p><strong>EuroLeague ({competitions.find(item => item.kind === 'euroleague')?.clubIds.length ?? 20} clubs).</strong> Licence clubs always play. Multi-year places run to their end season, then a review renews strong clubs (score {RULES.renewalBar / 10}+). The EuroCup champion goes up (the runner-up too when both route places are open); a route club stays by reaching the playoffs, three seasons at most. The places left are wild cards for the best scores.</p>
      <p><strong>EuroCup.</strong> Five-year licence clubs, clubs leaving the EuroLeague, then each country's one-year places for its best clubs in the final league ranking (after the playoffs).</p>
      <p><strong>BCL.</strong> The champion returns, each country's places go down its final ranking, and up to {RULES.bclInvitations} invitations fill the gaps.</p>
      <p><strong>How to keep a place.</strong> Stay in a top division (a relegated licence club sits out until it is back) and keep unpaid costs at or below {RULES.unpaidShare * 100}% of the budget. A new place also needs arena seats: {seats(RULES.seats.wildCard)} for a EuroLeague wild card ({seats(RULES.seats.wildCardFormer)} for a EuroLeague club), {seats(RULES.seats.route)} via the EuroCup, {seats(RULES.seats.eurocup)} for the EuroCup, {seats(RULES.seats.bcl)} for the BCL.</p>
      <p><strong>How to win a wild card.</strong> The score (0-100) adds European results (30), the final league ranking (20), arena seats (15), budget (15), a country with few EuroLeague clubs (10) and recent EuroLeague seasons (10). Places are decided once on the last day of the season; you answer offers in the Inbox (no answer means accept).</p>
    </MoreInfo>

    {card && <div className="european-your-club" data-european-your-club>
      <h3>Your club · {clubName(season, card.clubId)}</h3>
      <dl className="european-status">
        <div><dt>{year(0)}</dt><dd data-european-now>{card.now ? <>{competitionName(season, card.now.competitionId)} · {placeLabel(card.now.place)}</> : 'No European place'}</dd></div>
        <div><dt>{year(1)}</dt><dd data-european-next>{card.decided ? card.next ? <>{competitionName(season, card.next.competitionId)} · {placeLabel(card.next.place)} <small>({placeReason(card.next.place)})</small></> : 'No European place' : `Decided on the places day, ${medicalDate(placesDay)}`}</dd></div>
      </dl>
      <h4>Wild-card checklist</h4>
      <ul className="european-checks">{card.checks.map(check => <li key={check.label} data-check-ok={check.ok ? 'true' : 'false'}><span className="european-check-mark" aria-hidden="true">{check.ok ? '✓' : '✗'}</span><span>{check.label}</span><strong>{check.value}</strong><span className="sr-only">{check.ok ? 'Met' : 'Not met'}</span></li>)}</ul>
      {card.score && <p className="european-score" data-european-score={card.score.total}>Wild-card score {season.status === 'complete' ? '' : 'so far '}<strong>{scoreText(card.score)}</strong> / 100 · {card.lastWildCard !== null ? <>lowest wild card last places day: <strong>{scoreText(card.lastWildCard)}</strong></> : 'no wild card awarded by score yet in this career'}</p>}
      {card.score && <MoreInfo label="Score parts"><p>European results {scoreText(card.score.europe)}/30 · League finish {scoreText(card.score.domestic)}/20 · Arena {scoreText(card.score.arena)}/15 · Budget {scoreText(card.score.budget)}/15 · Market {scoreText(card.score.market)}/10 · Past seasons {scoreText(card.score.history)}/10</p></MoreInfo>}
      {card.fixes.length > 0 && <ul className="european-fixes">{card.fixes.map(fix => <li key={fix}>{fix}</li>)}</ul>}
    </div>}

    <MoreInfo label={decided ? `Every club's place · ${year(1)} decided` : "Every club's place"} className="european-places-list">
    <div className="european-places-controls">
      {decided && <div className="european-places-toggle" role="group" aria-label="Season of places">
        <button className={view === 'now' ? 'selected' : ''} aria-pressed={view === 'now'} onClick={() => setView('now')}>{year(0)}</button>
        <button className={view === 'next' ? 'selected' : ''} aria-pressed={view === 'next'} onClick={() => setView('next')}>{year(1)} · decided</button>
      </div>}
      <label className="season-year-filter"><span>Competition</span><select aria-label="Competition places" value={entry?.competitionId} onChange={event => setCompetitionId(event.target.value)}>
        {places.entrants.map(item => <option key={item.competitionId} value={item.competitionId}>{competitionName(season, item.competitionId)}</option>)}
      </select></label>
    </div>
    {entry && <div className="season-table-scroll"><table className="european-table european-places-table" data-european-list={entry.competitionId}><caption className="sr-only">{competitionName(season, entry.competitionId)} places {showNext ? year(1) : year(0)}</caption>
      <thead><tr><th scope="col">Club</th><th scope="col">Place</th><th scope="col">Why</th></tr></thead>
      <tbody>{entry.clubIds.map((clubId, index) => <tr key={clubId} className={clubId === season.managedClubId ? 'season-managed-row' : ''}><th scope="row">{clubName(season, clubId)}</th><td>{entry.places ? placeLabel(entry.places[index]!) : '–'}</td><td>{entry.places ? placeReason(entry.places[index]!) : '–'}</td></tr>)}</tbody>
    </table></div>}
    </MoreInfo>
    {(places.held ?? []).length > 0 && <p className="muted european-held">Waiting: {(places.held ?? []).map(item => `${clubName(season, item.clubId)} (${competitionName(season, item.competitionId)}, ${item.reason === 'higher' ? 'playing higher' : item.reason === 'declined' ? 'declined' : item.reason === 'unpaid' ? 'unpaid costs' : 'relegated'})`).join(', ')}.</p>}

    {decision && decision.wildCards.length > 0 && <div className="european-wildcards" data-european-wildcards>
      <h3>EuroLeague wild-card ranking · places day {medicalDate(decision.date)}</h3>
      <div className="season-table-scroll"><table className="european-table"><thead><tr><th scope="col">Club</th><th scope="col">Score</th><th scope="col">Main reasons</th><th scope="col">Result</th></tr></thead>
        <tbody>{decision.wildCards.map(score => <tr key={score.clubId} className={score.clubId === season.managedClubId ? 'season-managed-row' : ''}><th scope="row">{clubName(season, score.clubId)}</th><td>{scoreText(score)}</td><td>{topReasons(score)}</td><td>{decision.chosen.includes(score.clubId) ? 'Wild card' : places.entrants.some(item => item.clubIds.includes(score.clubId) && item.places?.[item.clubIds.indexOf(score.clubId)]?.reason === 'renewed') ? 'Renewed' : '–'}</td></tr>)}</tbody></table></div>
    </div>}
  </section>
}
