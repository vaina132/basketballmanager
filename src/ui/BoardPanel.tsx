import { useState } from 'react'
import type { BoardSummary } from '../domain/board'
import type { FacilityEvent } from '../domain/facilities'
import type { SeasonState } from '../domain/season'
import { getDevelopmentPresident, type DevelopmentPresident } from '../data/development-presidents'
import { getBoardSummary } from '../world/board'
import { BOARD_FUNDING_REFUSAL_COOLDOWN, boardCapitalGranted, boardConfidenceNow, boardFundingRefusal, requiredBoardConfidence } from '../world/board-funding-policy'
import { ownerCapital } from '../world/board-consequences'
import { seasonLabel } from '../world/season'
import { FACILITY_LABELS } from './FacilitiesPanel'
import { Icon, type IconName } from './Icon'
import { medicalDate } from './SeasonMedicalReport'
import './board-panel.css'

interface BoardPanelProps {
  season: SeasonState
  busy?: boolean
  onEnable: () => void
  onEnableFunding: () => void
}

const money = (cents: number) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(cents / 100)
const signed = (value: number) => `${value > 0 ? '+' : ''}${value}`
const sportingLabels: Record<BoardSummary['sportingStatus'], string> = { waiting: 'Awaiting review', building: 'Early games', 'on-track': 'On track', behind: 'Behind target', met: 'Target met', missed: 'Target missed' }
const financeLabels: Record<BoardSummary['financeStatus'], string> = { unassessed: 'Not assessed', waiting: 'Awaiting review', 'on-track': 'Within target', behind: 'Above target' }
const generosityLabels: Record<DevelopmentPresident['generosity'], string> = { 1: 'Reluctant investor', 2: 'Cautious investor', 3: 'Measured investor', 4: 'Supportive investor', 5: 'Generous investor' }
type FundingRequest = Extract<FacilityEvent, { type: 'funding' }>

function ObjectiveStatus({ label, state }: { label: string; state: 'waiting' | 'concern' | 'good' }) {
  const icon: IconName = state === 'good' ? 'check' : state === 'concern' ? 'target' : 'clock'
  return <span className="board-objective-status" data-state={state}><Icon name={icon} size={15} />{label}</span>
}

function ReviewHistory({ summary, season }: { summary: BoardSummary; season: SeasonState }) {
  const [selectedSeason, setSelectedSeason] = useState(season.seasonNumber)
  const years = [...new Set(summary.history.map(review => review.seasonNumber))].sort((a, b) => b - a)
  const year = years.includes(selectedSeason) ? selectedSeason : years[0]
  const reviews = summary.history.filter(review => review.seasonNumber === year)
  return <details className="board-history" id="board-review-history">
    <summary><Icon name="calendar" size={15} />Review history · {summary.history.length}</summary>
    {!reviews.length ? <p className="board-empty">The first review will appear after a counted matchday.</p> : <>
      <div className="board-history-filter"><label htmlFor="board-history-season">Season<select id="board-history-season" value={year} onChange={event => setSelectedSeason(Number(event.target.value))}>{years.map(value => <option key={value} value={value}>{seasonLabel(value)}</option>)}</select></label><span>{reviews.length} recorded {reviews.length === 1 ? 'review' : 'reviews'}</span></div>
      <div className="board-history-scroll" tabIndex={0} role="region" aria-label="Dated board reviews"><table><thead><tr><th scope="col">Review</th><th scope="col">Results</th><th scope="col">Unpaid costs</th><th scope="col">Confidence</th></tr></thead><tbody>{reviews.map(review => <tr key={review.id} data-board-review={review.id}><th scope="row"><time dateTime={review.date}>{medicalDate(review.date)}</time><small>Matchday {review.round}</small></th><td>{review.club.wins} {review.club.wins === 1 ? 'win' : 'wins'} / {review.club.played} games<small>{review.club.carriedAbsences ? `${review.club.carriedAbsences} recorded injury absences` : 'No carried injury absences'}</small></td><td>{review.club.unpaid === null ? 'Not assessed' : money(review.club.unpaid)}</td><td><strong>{review.club.confidence} / 100</strong><small>{signed(review.club.confidence - review.club.previousConfidence)} this review</small><details className="board-review-reasons"><summary>Reasons</summary><p>Results {signed(review.club.resultsImpact)} · Injury allowance {signed(review.club.injuryRelief)} · Finances {review.club.unpaid === null ? 'not assessed' : signed(review.club.financeImpact)}. Assessment: {review.club.assessment} / 100.</p><p>Season target: {season.board.mandates.find(mandate => mandate.id === review.mandateId)?.clubs[season.managedClubId]?.targetWins} wins.</p></details></td></tr>)}</tbody></table></div>
    </>}
  </details>
}

function PresidentSection({ season, busy, onEnableFunding }: { season: SeasonState; busy: boolean; onEnableFunding: () => void }) {
  const clubId = season.managedClubId
  const president = getDevelopmentPresident(clubId)
  const required = requiredBoardConfidence(president), confidence = boardConfidenceNow(season, clubId)
  const capital = ownerCapital(season, clubId)
  const left = Math.max(0, capital - boardCapitalGranted(season.facilities, clubId, season.seasonNumber))
  const requests = season.facilities.events.flatMap((event, index) => event.type === 'funding' && event.clubId === clubId ? [{ event: event as FundingRequest, index }] : []).reverse()
  const enableReason = !season.facilities.enabledSince ? 'Enable club facilities first, under Club › Operations.' : null
  return <>
    <h3 className="board-section-heading"><Icon name="people" size={16} />President &amp; owner capital</h3>
    <div className="board-president" data-board-president={president.clubId}>
      <div className="board-president-identity"><strong>{president.name}</strong><span>Club president · {generosityLabels[president.generosity]}</span></div>
      <dl className="board-president-facts"><div><dt>Owner capital left · {seasonLabel(season.seasonNumber)}</dt><dd data-board-capital-left={left}>{money(left)}<small>of {money(capital)} for facility upgrades</small></dd></div><div><dt>Confidence needed for capital</dt><dd data-board-required={required}>{required} / 100<small>{confidence >= required ? 'Met' : 'Not met'} · current confidence {confidence}</small></dd></div></dl>
    </div>
    {!season.facilities.fundingSince ? <div className="board-enable board-funding-enable"><Icon name="wallet" size={24} /><div><strong>Ask the board for capital</strong><p>When a facility upgrade costs more than the club can spend, ask {president.name} to fund the difference. Rival clubs can ask their boards under the same rules once this is on.</p>{enableReason && <p id="board-funding-enable-reason">{enableReason}</p>}</div><button id="enable-board-funding" className="button" onClick={onEnableFunding} disabled={busy || !!enableReason} aria-describedby={enableReason ? 'board-funding-enable-reason' : undefined}>Enable funding requests</button></div>
      : !requests.length ? <p className="board-empty board-funding-empty">No capital requests yet. When an upgrade costs more than the club can spend, its review under Club › Facilities lets you ask the board.</p>
      : <ul className="board-funding-history" aria-label="Board capital requests">{requests.map(({ event, index }) => <li key={index} data-board-funding-request={event.approved ? 'approved' : 'refused'}><span><strong>{FACILITY_LABELS[event.facilityType]} · {money(event.amount)}</strong><small><time dateTime={event.date}>{medicalDate(event.date)}</time> · Matchday {event.round}, {seasonLabel(event.seasonNumber)}{event.mode === 'automatic' ? ' · Automatic control' : ''}</small></span><span className="board-funding-outcome"><ObjectiveStatus label={event.approved ? 'Approved' : 'Refused'} state={event.approved ? 'good' : 'concern'} />{!event.approved && <small>{boardFundingRefusal(event)}</small>}</span></li>)}</ul>}
  </>
}

export function BoardPanel({ season, busy = false, onEnable, onEnableFunding }: BoardPanelProps) {
  const summary = getBoardSummary(season)
  const { mandate, objective, latest } = summary
  const review = latest?.club
  const played = review?.played ?? 0
  const wins = review?.wins ?? 0
  const financeAssessed = objective?.startingUnpaid !== null && objective?.startingUnpaid !== undefined
  const sportingConcern = summary.sportingStatus === 'behind' || summary.sportingStatus === 'missed'
  const sportingGood = summary.sportingStatus === 'on-track' || summary.sportingStatus === 'met'
  return <section className="board-panel panel" aria-labelledby="board-title">
    <header className="board-heading"><h2 id="board-title"><Icon name="shield" size={18} />Board</h2><span>{seasonLabel(season.seasonNumber)}</span></header>
    {!summary.enabled ? <div className="board-enable"><Icon name="shield" size={28} /><div><strong>Set your board objectives</strong><p>Record a results target and financial expectations. {season.status === 'complete' || season.round === 10 ? 'Objectives start next season.' : 'Reviews begin after the current matchday.'}</p></div><button id="enable-board" className="button" onClick={onEnable} disabled={busy}>Enable board reviews</button></div> : <>
      <div className="board-summary">
        <div className="board-confidence" data-board-confidence={summary.confidence}><div><strong>{summary.confidenceLabel}</strong><span>{summary.confidence}<small> / 100</small></span></div><meter min={0} max={100} value={summary.confidence} aria-label={`Board confidence: ${summary.confidence} out of 100, ${summary.confidenceLabel}`} /><small>Board confidence</small></div>
        <div className="board-summary-fact"><Icon name="calendar" size={19} /><div><span>Latest review</span><strong>{latest ? <time dateTime={latest.date}>{medicalDate(latest.date)}</time> : 'Awaiting first review'}</strong>{latest && <span>Matchday {latest.round} · {signed(latest.club.confidence - latest.club.previousConfidence)} confidence</span>}</div></div>
        <div className="board-summary-fact"><Icon name="clock" size={19} /><div><span>Next review</span><strong>{summary.nextReviewDate ? <time dateTime={summary.nextReviewDate}>{medicalDate(summary.nextReviewDate)}</time> : !mandate || objective?.games === 0 ? 'Objectives start next season' : 'Season reviews complete'}</strong>{summary.nextReviewDate && <span>After the matchday is completed</span>}</div></div>
      </div>
      {mandate && objective && objective.games > 0 ? <>
        <h3 className="board-section-heading"><Icon name="target" size={16} />Objectives · by {medicalDate(mandate.deadlineDate)}</h3>
        <div className="board-objective" data-board-objective="results"><Icon name="court" size={23} /><div className="board-objective-name"><strong>Win {objective.targetWins} of {objective.games} games</strong><span>Counted from matchday {mandate.startsRound}</span></div><div className="board-objective-progress"><strong data-board-wins={wins}>{wins} {wins === 1 ? 'win' : 'wins'} · {played} / {objective.games} games</strong><progress value={Math.min(wins, objective.targetWins)} max={Math.max(1, objective.targetWins)} aria-label={`${wins} {wins === 1 ? 'win' : 'wins'} towards a target of ${objective.targetWins}`} /></div><ObjectiveStatus label={sportingLabels[summary.sportingStatus]} state={sportingConcern ? 'concern' : sportingGood ? 'good' : 'waiting'} /></div>
        <div className="board-objective" data-board-objective="finance"><Icon name="wallet" size={23} /><div className="board-objective-name"><strong>Keep unpaid costs under control</strong><span>{financeAssessed ? `Target: no more than ${money(objective.startingUnpaid!)}` : 'Finances were not active when objectives were set'}</span></div><div className="board-objective-progress"><strong data-board-unpaid={review?.unpaid ?? undefined}>{review?.unpaid === null || review?.unpaid === undefined ? 'No reviewed balance' : `${money(review.unpaid)} unpaid`}</strong><span>{review?.unpaid !== null && review?.unpaid !== undefined ? 'At the latest review' : 'Includes overdue transfer payments'}</span></div><ObjectiveStatus label={financeLabels[summary.financeStatus]} state={summary.financeStatus === 'behind' ? 'concern' : summary.financeStatus === 'on-track' ? 'good' : 'waiting'} /></div>
        <details className="board-evidence" id="board-evidence"><summary><Icon name="search" size={15} />Why these targets &amp; this assessment</summary>
          <p>The squad was assessed {objective.resourceRank} of {season.clubs.length} when these objectives were set on {medicalDate(mandate.date)}. The eight strongest registered players determine that assessment. The upper, middle and lower thirds target 60%, 50% and 40% of counted games respectively, rounded up to whole wins. This starting assessment and the wins target stay fixed for the season.</p>
          <dl className="board-evidence-facts"><div><dt>Unpaid costs at the start</dt><dd>{financeAssessed ? money(objective.startingUnpaid!) : 'Not assessed'}<small>Starting unpaid costs are the baseline</small></dd></div><div><dt>Results assessment</dt><dd>{review ? signed(review.resultsImpact) : 'Awaiting review'}<small>{objective.games < 3 ? 'Too few counted games for a results assessment' : 'Results assessed from the third counted game'}</small></dd></div>{review && <><div><dt>Expected wins by this review</dt><dd>{review.targetPace}<small>{review.wins} actual {review.wins === 1 ? 'win' : 'wins'} in {review.played} counted games</small></dd></div><div><dt>Recorded injury absences</dt><dd>{review.carriedAbsences} / {review.rosterPlaces}<small>Registered player places across counted games</small></dd></div><div><dt>Injury allowance</dt><dd>{signed(review.injuryRelief)}<small>Can soften a negative results assessment</small></dd></div><div><dt>Financial assessment</dt><dd>{review.unpaid === null ? 'Not assessed' : signed(review.financeImpact)}</dd></div><div><dt>Review assessment</dt><dd>{review.assessment} / 100</dd></div><div><dt>Confidence change</dt><dd>{signed(review.confidence - review.previousConfidence)}<small>{review.previousConfidence} → {review.confidence}</small></dd></div></>}</dl>
          <p>The review assessment starts at 50, then adds the results, injury and financial contributions above. Confidence moves towards it by no more than 8 points per review. {season.facilities.fundingSince ? 'It records the board\'s view and decides capital requests; it does not change match performance, budget limits or your job.' : 'It records the board\'s view; it does not change match performance, budget limits or your job.'}</p>
        </details>
      </> : <p className="board-empty">Objectives start next season. The completed season will not be reviewed retroactively.</p>}
      <PresidentSection season={season} busy={busy} onEnableFunding={onEnableFunding} />
      <ReviewHistory summary={summary} season={season} />
      <details className="board-rules"><summary><Icon name="settings" size={15} />Review rules</summary><p>Reviews use recorded results and registered squads. A half-win tolerance applies to the expected pace. Beyond that tolerance, each win above or below pace contributes 10 assessment points, capped at 30 points in either direction. Fewer than three counted games produce no results contribution. Pre-existing injury absences can soften a negative contribution by up to 6 points. A result still on the match screen is included only after you continue the matchday.</p><p>Unpaid club costs and overdue transfer payments are compared with the balance when objectives were set. Only an increase above that starting balance lowers the financial assessment. Each €2,000 change contributes one assessment point, rounded to a whole point, with a maximum penalty of 25 or improvement of 10. If finances were disabled when objectives were set, this objective stays unassessed for the season.</p><p>Capital requests: the board funds only the part of a facility upgrade the club cannot pay, from the owner's capital for the season. It approves when the latest reviewed confidence reaches 65 minus 5 for each point of the president's generosity (60 to 40) and the owner's capital covers the amount. It never funds construction while committed wages and fees exceed cash or costs are unpaid. After a refusal, the club waits {BOARD_FUNDING_REFUSAL_COOLDOWN} matchdays before asking again. Automatic facilities control and rival clubs ask only when these rules approve.</p></details>
    </>}
  </section>
}
