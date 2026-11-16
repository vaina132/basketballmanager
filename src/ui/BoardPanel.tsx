import { useState } from 'react'
import type { BoardSummary } from '../domain/board'
import type { FacilityEvent } from '../domain/facilities'
import type { SeasonState } from '../domain/season'
import type { DevelopmentPresident } from '../data/development-presidents'
import { clubPresident, seasonRounds, worldOf } from '../world/career-world'
import { getBoardSummary } from '../world/board'
import { BOARD_FUNDING_REFUSAL_COOLDOWN, boardCapitalGranted, boardConfidenceNow, boardFundingRefusal, requiredBoardConfidence } from '../world/board-funding-policy'
import { BOARD_VERDICT_EFFECTS, governingVerdict, ownerCapital, seasonVerdict, staffAllocation, verdictBudgets, verdictForConfidence, type BoardVerdict } from '../world/board-consequences'
import { MAX_SEASON_NUMBER, seasonLabel } from '../world/season'
import { governingDerby, RIVALRY_BOARD_CAP, RIVALRY_BOARD_POINTS, RIVALRY_CROWD_PERCENT, rivalryFor } from '../world/rivalries'
import { careerMovesGovern, managedClubFor } from '../world/career'
import { managerReputation, resignationOutlook, resignationRefusal, seasonEndOutlook, VACANCY_BASE_REQUIREMENT, VACANCY_STEP } from '../world/career-policy'
import { allowsUnemployment, CAREER_RULES, CAREER_RULES_TEXT, careerPointKey, coachProtected, midSeasonMinimumGames, NO_CLUB, startingConfidence, usesCareerRules } from '../world/career-rules'
import { SeasonEndChoice } from './SeasonEndChoice'
import { careerMoveOutcome } from './career-text'
import { FACILITY_LABELS } from './FacilitiesPanel'
import { GrownRivalrySection } from './GrownRivalrySection'
import { Icon, type IconName } from './Icon'
import { medicalDate } from './SeasonMedicalReport'
import './board-panel.css'
import { formatEuros } from './money-format'

interface BoardPanelProps {
  season: SeasonState
  busy?: boolean
  onEnable: () => void
  onEnableFunding: () => void
  onEnableConsequences: () => void
  onEnableRivalries: () => void
  onEnableCareerMoves: () => void
  /** Career-2: resign and join the chosen club (one of the jobs offered at once). */
  onResign?: (clubId: string) => void
}

const money = (cents: number) => formatEuros(cents, true)
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
  // Format 63: a new coach's fresh start sits between the reviews it follows and precedes (latest first).
  const position = (id: string) => season.board.reviews.findIndex(review => review.id === id)
  const rows: ({ kind: 'review'; key: number; review: BoardSummary['history'][number] } | { kind: 'restart'; key: number; restart: BoardSummary['restarts'][number] })[] = [
    ...reviews.map(review => ({ kind: 'review' as const, key: position(review.id) * 2 + 1, review })),
    ...summary.restarts.filter(restart => restart.seasonNumber === year).map(restart => ({ kind: 'restart' as const, key: restart.reviewCount * 2, restart })),
  ].sort((a, b) => b.key - a.key)
  const clubName = season.clubs.find(club => club.id === season.managedClubId)?.name ?? season.managedClubId
  return <details className="board-history" id="board-review-history">
    <summary><Icon name="calendar" size={15} />Review history · {summary.history.length}</summary>
    {!reviews.length ? <p className="board-empty">The first review will appear after a counted matchday.</p> : <>
      <div className="board-history-filter"><label htmlFor="board-history-season">Season<select id="board-history-season" value={year} onChange={event => setSelectedSeason(Number(event.target.value))}>{years.map(value => <option key={value} value={value}>{seasonLabel(value)}</option>)}</select></label><span>{reviews.length} recorded {reviews.length === 1 ? 'review' : 'reviews'}</span></div>
      <div className="board-history-scroll" tabIndex={0} role="region" aria-label="Dated board reviews"><table><thead><tr><th scope="col">Review</th><th scope="col">Results</th><th scope="col">Unpaid costs</th><th scope="col">Confidence</th></tr></thead><tbody>{rows.map(row => row.kind === 'restart' ? <tr key={`restart-${row.restart.seasonNumber}-${row.restart.round}-${row.restart.phase}-${row.restart.date}`} className="board-history-restart" data-board-restart={row.restart.coach}><th scope="row"><time dateTime={row.restart.date}>{medicalDate(row.restart.date)}</time><small>{row.restart.phase === 'season' ? `Before matchday ${row.restart.round}` : row.restart.phase === 'end' ? 'Season end' : 'Offseason'}</small></th><td colSpan={2}>{row.restart.coach === 'manager' ? 'You took over' : `${clubName} appointed a new coach`}<small>A new coach starts afresh; the previous confidence no longer counts</small></td><td><strong>{row.restart.confidence} / 100</strong><small>Fresh start</small></td></tr> : (review => <tr key={review.id} data-board-review={review.id}><th scope="row"><time dateTime={review.date}>{medicalDate(review.date)}</time><small>Matchday {review.round}</small></th><td>{review.club.wins} {review.club.wins === 1 ? 'win' : 'wins'} / {review.club.played} games<small>{review.club.carriedAbsences ? `${review.club.carriedAbsences} recorded injury absences` : 'No carried injury absences'}</small></td><td>{review.club.unpaid === null ? 'Not assessed' : money(review.club.unpaid)}</td><td><strong>{review.club.confidence} / 100</strong><small>{signed(review.club.confidence - review.club.previousConfidence)} this review</small><details className="board-review-reasons"><summary>Reasons</summary><p>Results {signed(review.club.resultsImpact)} · Injury allowance {signed(review.club.injuryRelief)} · Finances {review.club.unpaid === null ? 'not assessed' : signed(review.club.financeImpact)}{review.club.rivalryImpact !== undefined ? ` · Derbies ${signed(review.club.rivalryImpact)}` : ''}{review.club.mediaImpact !== undefined ? ` · Press and media ${signed(review.club.mediaImpact)}` : ''}. Assessment: {review.club.assessment} / 100.</p><p>Season target: {season.board.mandates.find(mandate => mandate.id === review.mandateId)?.clubs[season.managedClubId]?.targetWins} wins.</p></details></td></tr>)(row.review))}</tbody></table></div>
    </>}
  </details>
}

function PresidentSection({ season, busy, onEnableFunding }: { season: SeasonState; busy: boolean; onEnableFunding: () => void }) {
  const clubId = season.managedClubId
  const president = clubPresident(worldOf(season), clubId)
  const required = requiredBoardConfidence(president), confidence = boardConfidenceNow(season, clubId)
  const capital = ownerCapital(season, clubId)
  const left = Math.max(0, capital - boardCapitalGranted(season.facilities, clubId, season.seasonNumber))
  const requests = season.facilities.events.flatMap((event, index) => event.type === 'funding' && event.clubId === clubId ? [{ event: event as FundingRequest, index }] : []).reverse()
  const enableReason = !season.facilities.enabledSince ? 'Enable club facilities first, under Club › Operations.' : null
  return <>
    <h3 className="board-section-heading"><Icon name="people" size={16} />President &amp; owner capital</h3>
    <div className="board-president" data-board-president={president.clubId}>
      <div className="board-president-identity"><strong>{president.name}</strong><span>{worldOf(season).source === 'real-data-pack' ? 'Fictional club president' : 'Club president'} · {generosityLabels[president.generosity]}</span></div>
      <dl className="board-president-facts"><div><dt>Owner capital left · {seasonLabel(season.seasonNumber)}</dt><dd data-board-capital-left={left}>{money(left)}<small>of {money(capital)} for facility upgrades</small></dd></div><div><dt>Confidence needed for capital</dt><dd data-board-required={required}>{required} / 100<small>{confidence >= required ? 'Met' : 'Not met'} · current confidence {confidence}</small></dd></div></dl>
    </div>
    {!season.facilities.fundingSince ? <div className="board-enable board-funding-enable"><Icon name="wallet" size={24} /><div><strong>Ask the board for capital</strong><p>When a facility upgrade costs more than the club can spend, ask {president.name} to fund the difference. Rival clubs can ask their boards under the same rules once this is on.</p>{enableReason && <p id="board-funding-enable-reason">{enableReason}</p>}</div><button id="enable-board-funding" className="button" onClick={onEnableFunding} disabled={busy || !!enableReason} aria-describedby={enableReason ? 'board-funding-enable-reason' : undefined}>Enable funding requests</button></div>
      : !requests.length ? <p className="board-empty board-funding-empty">No capital requests yet. When an upgrade costs more than the club can spend, its review under Club › Facilities lets you ask the board.</p>
      : <ul className="board-funding-history" aria-label="Board capital requests">{requests.map(({ event, index }) => <li key={index} data-board-funding-request={event.approved ? 'approved' : 'refused'}><span><strong>{FACILITY_LABELS[event.facilityType]}{event.project === 'repair' ? ' repair' : ''} · {money(event.amount)}</strong><small><time dateTime={event.date}>{medicalDate(event.date)}</time> · Matchday {event.round}, {seasonLabel(event.seasonNumber)}{event.mode === 'automatic' ? ' · Automatic control' : ''}</small></span><span className="board-funding-outcome"><ObjectiveStatus label={event.approved ? 'Approved' : 'Refused'} state={event.approved ? 'good' : 'concern'} />{!event.approved && <small>{boardFundingRefusal(event)}</small>}</span></li>)}</ul>}
  </>
}

const verdictState = (verdict: BoardVerdict): 'good' | 'concern' | 'waiting' => verdict === 'confident' ? 'good' : verdict === 'steady' ? 'waiting' : 'concern'
const effectText = (verdict: BoardVerdict) => {
  const effect = BOARD_VERDICT_EFFECTS[verdict]
  return effect.staffPercent === 100 ? 'Standard budgets' : `Staff budget ${effect.staffPercent > 100 ? '+' : '−'}${Math.abs(effect.staffPercent - 100)}% · owner capital ${effect.capitalPercent === 0 ? 'withheld' : effect.capitalPercent < 100 ? 'halved' : `+${effect.capitalPercent - 100}%`}`
}

const INTENSITY_LABELS = { 1: 'Mild', 2: 'Strong', 3: 'Fierce' } as const

function RivalrySection({ season, busy, onEnableRivalries }: { season: SeasonState; busy: boolean; onEnableRivalries: () => void }) {
  if (season.rivalries?.model === 'rivalries-2') return <GrownRivalrySection season={season} busy={busy} onEnableRivalries={onEnableRivalries} />
  const clubId = season.managedClubId, entry = rivalryFor(clubId, worldOf(season))
  if (!entry) return null
  const rival = season.clubs.find(club => club.id === entry.rivalId)!
  const crowd = RIVALRY_CROWD_PERCENT * entry.rivalry.intensity
  const effects = `Home derbies draw ${crowd}% more crowd demand. Each derby win adds ${RIVALRY_BOARD_POINTS} to the board's assessment and each loss takes ${RIVALRY_BOARD_POINTS} away (at most ${RIVALRY_BOARD_CAP} either way), and a derby result counts double in the recent-results part of squad morale.`
  const derbies = season.fixtures.filter(fixture => [fixture.homeClubId, fixture.awayClubId].includes(clubId) && [fixture.homeClubId, fixture.awayClubId].includes(rival.id)).sort((a, b) => a.round - b.round)
  return <>
    <h3 className="board-section-heading"><Icon name="target" size={16} />Rivalry · {entry.rivalry.name}</h3>
    {!season.rivalries?.enabledSince ? <div className="board-enable board-rivalry-enable"><Icon name="target" size={24} /><div><strong>Play the {entry.rivalry.name.toLowerCase()} against {rival.name}</strong><p>{effects} This starts with the next matchday.</p></div><button id="enable-rivalries" className="button" onClick={onEnableRivalries} disabled={busy}>Enable rivalries</button></div>
      : <div className="board-rivalry" data-board-rival={rival.id}>
        <div className="board-president-identity"><strong>{rival.name}</strong><span>{INTENSITY_LABELS[entry.rivalry.intensity]} rivalry · fictional league rivals</span></div>
        <ul className="board-derbies" aria-label={`${entry.rivalry.name} fixtures ${seasonLabel(season.seasonNumber)}`}>{derbies.map(fixture => {
          const home = fixture.homeClubId === clubId, counted = !!governingDerby(season.rivalries, fixture.homeClubId, fixture.awayClubId, season.seasonNumber, fixture.round, worldOf(season))
          const result = fixture.result, won = result?.winnerClubId === clubId
          return <li key={fixture.id} data-derby-fixture={fixture.id} data-derby-result={result ? (won ? 'won' : 'lost') : 'upcoming'}><span><strong>Matchday {fixture.round} · {home ? 'Home' : 'Away'}</strong><small><time dateTime={fixture.date}>{medicalDate(fixture.date)}</time>{!counted ? ' · before rivalries began' : ''}</small></span>{result ? <ObjectiveStatus label={`${won ? 'Won' : 'Lost'} ${result.score[home ? 'home' : 'away']}–${result.score[home ? 'away' : 'home']}`} state={won ? 'good' : 'concern'} /> : <ObjectiveStatus label="Upcoming" state="waiting" />}</li>
        })}</ul>
        <p className="board-rivalry-effects">{effects}</p>
      </div>}
  </>
}

export const CAREER_RULE = `A season that ends Under pressure (final board confidence below 30) ends your job. Clubs whose own season ends Under pressure offer you their job when your reputation reaches what they look for: ${VACANCY_BASE_REQUIREMENT} for last place and ${VACANCY_STEP} more for each place higher. Your reputation is your last three final board ratings, the most recent counting most. After a dismissal you always receive at least one offer.`
/** Career-2 careers (format 63): the same offers and reputation, with the new protections, mid-season reviews and resignations. */
export const CAREER_RULE_2 = `${CAREER_RULES_TEXT.protectedSeason} ${CAREER_RULES_TEXT.midSeason} ${CAREER_RULES_TEXT.freshStart} Clubs that replace their coach offer you their job when your reputation reaches what they look for: ${VACANCY_BASE_REQUIREMENT} for last place and ${VACANCY_STEP} more for each place higher. Your reputation is your last three final board ratings, the most recent counting most. After a dismissal you always receive at least one offer.`
/** Career-3 careers (format 69): the same rules, with offers no longer guaranteed and seasons without a club. */
export const CAREER_RULE_3 = `${CAREER_RULES_TEXT.protectedSeason} ${CAREER_RULES_TEXT.midSeason} ${CAREER_RULES_TEXT.freshStart} Clubs that replace their coach offer you their job when your reputation reaches what they look for: ${VACANCY_BASE_REQUIREMENT} for last place and ${VACANCY_STEP} more for each place higher. Your reputation is your last three final board ratings, the most recent counting most. ${CAREER_RULES_TEXT.dismissal3} ${CAREER_RULES_TEXT.unemployed} ${CAREER_RULES_TEXT.fade}`

/** The manager's employment: reputation, the dismissal rules, today's outlook, resigning and the clubs managed so far. */
function CareerSection({ season, busy, onEnableCareerMoves, onResign }: { season: SeasonState; busy: boolean; onEnableCareerMoves: () => void; onResign?: (clubId: string) => void }) {
  const [resigning, setResigning] = useState(false)
  const career = season.career
  const heading = <h3 className="board-section-heading"><Icon name="shield" size={16} />Your job</h3>
  // Format 69: a season the manager finished without a club names no club.
  const name = (id: string) => id === NO_CLUB ? 'No club' : season.clubs.find(club => club.id === id)?.name ?? id
  if (!career?.enabledSince) return <>
    {heading}
    <div className="board-enable board-career-enable"><Icon name="shield" size={24} /><div><strong>Play with dismissal and job offers</strong><p>{CAREER_RULE} The current season is never judged: this applies from the end of {seasonLabel(season.seasonNumber + 1)}.</p></div><button id="enable-career-moves" className="button" onClick={onEnableCareerMoves} disabled={busy || !season.board.enabledSince}>Enable dismissal and job offers</button></div>
  </>
  const rules = usesCareerRules(career)
  const lastEnded = season.status === 'complete' ? season.seasonNumber : season.seasonNumber - 1
  const reputation = managerReputation(season, Math.max(lastEnded, 0), rules ? { seasonNumber: season.seasonNumber, before: Infinity } : undefined)
  const governs = careerMovesGovern(career, season.seasonNumber)
  const confidence = rules ? startingConfidence(season.board, season.managedClubId) : boardConfidenceNow(season, season.managedClubId), outlook = verdictForConfidence(confidence)
  // Career-1 moves once a season; career-2 shows the move made at this season's end or in its offseason.
  const move = rules ? [...career.moves].reverse().find(item => item.seasonNumber === season.seasonNumber && item.phase !== 'season') : career.moves.find(item => item.seasonNumber === season.seasonNumber)
  const judged = season.status === 'complete' ? season.seasonNumber + 1 : season.seasonNumber
  const protectedNow = rules && coachProtected(season.board.restarts ?? [], season.managedClubId, judged)
  // A final warning: the last season ended Under pressure in a protected first season, and the manager stayed.
  const lastOutlook = rules && lastEnded >= 1 ? seasonEndOutlook(season, lastEnded) : null
  const warned = !!lastOutlook?.warning && lastOutlook.clubId === season.managedClubId && !career.moves.some(item => careerPointKey(item.seasonNumber, item.round ?? 0, item.phase ?? 'end') >= careerPointKey(lastEnded, seasonRounds(season), 'end'))
  const objectiveGames = season.board.mandates.find(mandate => mandate.seasonNumber === season.seasonNumber)?.clubs[season.managedClubId]?.games ?? 0
  const status = !governs ? 'not-yet' : season.status === 'complete' ? 'decided' : protectedNow ? 'protected' : outlook === 'pressure' ? 'at-risk' : 'safe'
  const midSeasonText = rules && objectiveGames ? ` During the season, a review below ${CAREER_RULES.midSeasonDismissalBelow} after ${midSeasonMinimumGames(objectiveGames)} of your ${objectiveGames} league games ends your job at once.` : ''
  const statusText = status === 'not-yet' ? `Dismissal and job offers start at the end of ${seasonLabel(career.enabledSince.effectiveFrom)}.`
    : status === 'decided' ? (move ? `You ${move.reason === 'resigned' ? 'resigned and joined' : 'joined'} ${name(move.toClubId)} ${move.phase === 'offseason' ? 'this offseason' : 'at the end of this season'}.` : protectedNow ? `The board has decided: you stay. ${seasonLabel(judged)} is your protected first season here.` : warned ? `Final warning: you stay, but ${seasonLabel(judged)} counts. The board can dismiss you during it or at its end.` : 'The board has decided: you stay for next season.')
    : status === 'protected' ? `Protected first season: the board will not dismiss you in ${seasonLabel(season.seasonNumber)}. If it ends Under pressure (below ${CAREER_RULES.seasonDismissalBelow}), you get a final warning instead. Today: ${BOARD_VERDICT_EFFECTS[outlook].label} (${confidence}/100).`
    : `If the season ended today: ${BOARD_VERDICT_EFFECTS[outlook].label} (${confidence}/100) — ${status === 'at-risk' ? 'the board would dismiss you' : 'your job is safe'}.${warned ? ' You are on a final warning from last season.' : ''}${midSeasonText}`
  const seasons = Array.from({ length: season.seasonNumber }, (_, index) => index + 1).map(year => {
    const clubId = managedClubFor(season, year, false), final = seasonVerdict(season.board, clubId, year, seasonRounds(season))
    const moves = career.moves.filter(item => item.seasonNumber === year)
    const warning = rules && final ? seasonEndOutlook(season, year)?.warning : undefined
    return { year, clubId, final, moves, warning }
  }).filter(row => row.final || row.moves.length || row.year === season.seasonNumber).reverse()
  const refusal = rules && onResign ? resignationRefusal(season) : null
  const offers = resigning && !refusal ? resignationOutlook(season) : null
  return <>
    {heading}
    <div className="board-verdict board-career" data-career-status={status}>
      <div className="board-verdict-season" data-career-reputation={reputation.value}><span>Reputation</span><strong>{reputation.value} / 100</strong><small>{reputation.seasons.length ? reputation.seasons.map(item => `${seasonLabel(item.seasonNumber)}: ${item.confidence}`).join(' · ') : 'No final board review yet'}{reputation.resignations ? ` · −${reputation.resignations * CAREER_RULES.resignationReputationCost} for ${reputation.resignations === 1 ? 'a resignation' : `${reputation.resignations} resignations`}` : ''}</small></div>
      <div className="board-verdict-season"><span>{seasonLabel(season.seasonNumber)} · {name(season.managedClubId)}</span><strong>{status === 'at-risk' ? 'Job at risk' : status === 'safe' ? (warned ? 'Final warning' : 'Job safe') : status === 'protected' ? 'Protected first season' : status === 'decided' ? 'Season decided' : 'Not judged yet'}</strong><small>{statusText}</small></div>
    </div>
    <div className="board-history-scroll board-career-history" tabIndex={0} role="region" aria-label="Clubs managed"><table><thead><tr><th scope="col">Season</th><th scope="col">Club</th><th scope="col">Final confidence</th><th scope="col">Outcome</th></tr></thead><tbody>{seasons.map(row => <tr key={row.year} data-career-season={row.year}>
      <td>{seasonLabel(row.year)}</td><td>{name(row.clubId)}</td><td>{row.final ? `${row.final.confidence} · ${BOARD_VERDICT_EFFECTS[row.final.verdict].label}` : 'In progress'}</td>
      <td>{row.moves.length ? row.moves.map(item => careerMoveOutcome(season, item)).join(' · ') : row.warning ? 'Final warning · stayed' : row.final ? 'Stayed' : '—'}</td>
    </tr>)}</tbody></table></div>
    {rules && onResign && <details className="board-resign" id="board-resign"><summary><Icon name="shield" size={15} />Resign</summary>
      <p>{allowsUnemployment(career) ? CAREER_RULES_TEXT.resignation3 : CAREER_RULES_TEXT.resignation} {season.status === 'complete' ? 'A new club runs the rest of this offseason.' : 'A new club\'s games are yours from this week.'}</p>
      {refusal ? <p className="board-resign-refusal" role="status">{refusal}</p> : <button id="board-resign-button" className="button" onClick={() => setResigning(true)} disabled={busy}>See the jobs on offer</button>}
    </details>}
    {offers && <SeasonEndChoice season={season} outlook={offers} busy={busy} onChoose={clubId => { setResigning(false); if (clubId !== null) onResign!(clubId) }} onClose={() => setResigning(false)} />}
    <p className="board-empty board-career-rule">{allowsUnemployment(career) ? CAREER_RULE_3 : rules ? CAREER_RULE_2 : CAREER_RULE}</p>
  </>
}

function VerdictSection({ season, busy, onEnableConsequences }: { season: SeasonState; busy: boolean; onEnableConsequences: () => void }) {
  const clubId = season.managedClubId, next = season.seasonNumber + 1
  const current = governingVerdict(season, clubId, season.seasonNumber)
  const final = seasonVerdict(season.board, clubId, season.seasonNumber, seasonRounds(season))
  const confidence = final?.confidence ?? boardConfidenceNow(season, clubId)
  const outlook = final?.verdict ?? verdictForConfidence(confidence)
  const budgets = verdictBudgets(clubId, outlook, worldOf(season))
  if (!season.board.consequencesSince) return <>
    <h3 className="board-section-heading"><Icon name="target" size={16} />Season verdict &amp; budgets</h3>
    <div className="board-enable board-verdict-enable"><Icon name="target" size={24} /><div><strong>Let the season verdict set budgets</strong><p>At the end of each season, the board's final confidence sets next season's staff budget and the owner's capital for facility upgrades: Confident adds 10% to staff and 50% to capital, Steady changes nothing, Concerned cuts staff 10% and halves capital, Under pressure cuts staff 20% and withholds capital. Signed staff contracts are never cut. This starts with {seasonLabel(next)}.</p></div><button id="enable-board-consequences" className="button" onClick={onEnableConsequences} disabled={busy}>Enable season verdicts</button></div>
  </>
  return <>
    <h3 className="board-section-heading"><Icon name="target" size={16} />Season verdict &amp; budgets</h3>
    <div className="board-verdict" data-board-verdict={final?.verdict ?? 'pending'}>
      <div className="board-verdict-season" data-board-verdict-current={current?.verdict ?? 'standard'}><span>This season · {seasonLabel(season.seasonNumber)}</span><strong>{money(staffAllocation(season, clubId))} staff budget</strong><small>{money(ownerCapital(season, clubId))} owner capital</small><small>{current ? `Set by the ${seasonLabel(current.seasonNumber)} verdict: ${BOARD_VERDICT_EFFECTS[current.verdict].label} (confidence ${current.confidence})` : 'Standard budgets'}</small></div>
      {next <= MAX_SEASON_NUMBER && <div className="board-verdict-season" data-board-next-staff={budgets.staff} data-board-next-capital={budgets.capital}><span>{final ? `Verdict for ${seasonLabel(next)}` : `If the season ended today · ${seasonLabel(next)}`}</span><strong>{money(budgets.staff)} staff budget</strong><small>{money(budgets.capital)} owner capital</small><span className="board-verdict-outcome"><ObjectiveStatus label={`${BOARD_VERDICT_EFFECTS[outlook].label} · confidence ${confidence}`} state={final ? verdictState(outlook) : 'waiting'} /><small>{effectText(outlook)}</small></span></div>}
    </div>
    <p className="board-empty board-verdict-note">{final ? 'The verdict is final. ' : 'The verdict is given by the final review after the last matchday. '}Signed staff contracts are never cut; renewals on the opening day of the next season must fit its staff budget.</p>
  </>
}

export function BoardPanel({ season, busy = false, onEnable, onEnableFunding, onEnableConsequences, onEnableRivalries, onEnableCareerMoves, onResign }: BoardPanelProps) {
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
    {!summary.enabled ? <div className="board-enable"><Icon name="shield" size={28} /><div><strong>Set your board objectives</strong><p>Record a results target and financial expectations. {season.status === 'complete' || season.round === seasonRounds(season) ? 'Objectives start next season.' : 'Reviews begin after the current matchday.'}</p></div><button id="enable-board" className="button" onClick={onEnable} disabled={busy}>Enable board reviews</button></div> : <>
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
          <dl className="board-evidence-facts"><div><dt>Unpaid costs at the start</dt><dd>{financeAssessed ? money(objective.startingUnpaid!) : 'Not assessed'}<small>Starting unpaid costs are the baseline</small></dd></div><div><dt>Results assessment</dt><dd>{review ? signed(review.resultsImpact) : 'Awaiting review'}<small>{objective.games < 3 ? 'Too few counted games for a results assessment' : 'Results assessed from the third counted game'}</small></dd></div>{review && <><div><dt>Expected wins by this review</dt><dd>{review.targetPace}<small>{review.wins} actual {review.wins === 1 ? 'win' : 'wins'} in {review.played} counted games</small></dd></div><div><dt>Recorded injury absences</dt><dd>{review.carriedAbsences} / {review.rosterPlaces}<small>Registered player places across counted games</small></dd></div><div><dt>Injury allowance</dt><dd>{signed(review.injuryRelief)}<small>Can soften a negative results assessment</small></dd></div><div><dt>Financial assessment</dt><dd>{review.unpaid === null ? 'Not assessed' : signed(review.financeImpact)}</dd></div>{review.rivalryImpact !== undefined && <div><dt>Derby results</dt><dd>{signed(review.rivalryImpact)}<small>{RIVALRY_BOARD_POINTS} per derby win or loss, at most {RIVALRY_BOARD_CAP}</small></dd></div>}<div><dt>Review assessment</dt><dd>{review.assessment} / 100</dd></div><div><dt>Confidence change</dt><dd>{signed(review.confidence - review.previousConfidence)}<small>{review.previousConfidence} → {review.confidence}</small></dd></div></>}</dl>
          <p>The review assessment starts at 50, then adds the results, injury and financial contributions above. Confidence moves towards it by no more than 8 points per review. {season.facilities.fundingSince ? 'It records the board\'s view and decides capital requests; it does not change match performance, budget limits or your job.' : 'It records the board\'s view; it does not change match performance, budget limits or your job.'}</p>
        </details>
      </> : <p className="board-empty">Objectives start next season. The completed season will not be reviewed retroactively.</p>}
      <CareerSection season={season} busy={busy} onEnableCareerMoves={onEnableCareerMoves} onResign={onResign} />
      <VerdictSection season={season} busy={busy} onEnableConsequences={onEnableConsequences} />
      <RivalrySection season={season} busy={busy} onEnableRivalries={onEnableRivalries} />
      <PresidentSection season={season} busy={busy} onEnableFunding={onEnableFunding} />
      <ReviewHistory summary={summary} season={season} />
      <details className="board-rules"><summary><Icon name="settings" size={15} />Review rules</summary><p>Reviews use recorded results and registered squads. A half-win tolerance applies to the expected pace. Beyond that tolerance, each win above or below pace contributes 10 assessment points, capped at 30 points in either direction. Fewer than three counted games produce no results contribution. Pre-existing injury absences can soften a negative contribution by up to 6 points. A result still on the match screen is included only after you continue the matchday.</p><p>Unpaid club costs and overdue transfer payments are compared with the balance when objectives were set. Only an increase above that starting balance lowers the financial assessment. Each €2,000 change contributes one assessment point, rounded to a whole point, with a maximum penalty of 25 or improvement of 10. If finances were disabled when objectives were set, this objective stays unassessed for the season.</p><p>Capital requests: the board funds only the part of a facility upgrade the club cannot pay, from the owner's capital for the season. It approves when the latest reviewed confidence reaches 65 minus 5 for each point of the president's generosity (60 to 40) and the owner's capital covers the amount. It never funds construction while committed wages and fees exceed cash or costs are unpaid. After a refusal, the club waits {BOARD_FUNDING_REFUSAL_COOLDOWN} matchdays before asking again. Automatic facilities control and rival clubs ask only when these rules approve.</p><p>Season verdicts: when switched on, the final review of each season gives a verdict from the board's confidence (Confident 65 and above, Steady 45-64, Concerned 30-44, Under pressure below 30). It sets the next season's shared staff budget (110%, 100%, 90% or 80% of the standard budget) and the owner's capital (150%, 100%, 50% or none). Rival clubs follow the same rules.</p></details>
    </>}
  </section>
}
