import type { BoardClubMandate, BoardClubReview, BoardRequest } from '../domain/board'
import type { SeasonState } from '../domain/season'
import type { PresidentNegotiationStyle, PresidentTraitLevel } from '../data/development-presidents'
import { clubPresident, lastCommittedWeek, worldOf } from '../world/career-world'
import { ambitionWinRate, PRESIDENT_RULES, presidentPressureLine, presidentReviewStep, presidentTraits, salaryVerdictPercent } from '../world/presidents'
import { boardFundingTerms } from '../world/board-funding-policy'
import { requestSeconds } from '../world/board-requests'
import { getCareerPlayer } from '../world/player-catalog'
import { dateForRound, seasonLabel } from '../world/season'
import { Icon, type IconName } from './Icon'
import { medicalDate } from './SeasonMedicalReport'
import { formatEuros } from './money-format'

/** Format 70 (board-2 careers): the president's profile, youth and culture objectives and requests on Club > Board. */
const money = (cents: number) => formatEuros(cents, true)
const signedPercent = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value)}%`
const PATIENCE: Record<PresidentTraitLevel, string> = { 1: 'Impatient', 2: 'Demanding', 3: 'Measured', 4: 'Patient', 5: 'Very patient' }
const AMBITION: Record<PresidentTraitLevel, string> = { 1: 'Modest', 2: 'Realistic', 3: 'Steady', 4: 'Ambitious', 5: 'Very ambitious' }
const INTERFERENCE: Record<PresidentTraitLevel, string> = { 1: 'Hands-off', 2: 'Rarely involved', 3: 'Involved', 4: 'Often involved', 5: 'Meddling' }
const NEGOTIATION: Record<PresidentNegotiationStyle, string> = { flexible: 'Flexible', fair: 'Fair', hard: 'Hard bargainer' }
const POSITION_NAMES: Record<string, string> = { PG: 'point guard', SG: 'shooting guard', SF: 'small forward', PF: 'power forward', C: 'centre' }

function Status({ label, state }: { label: string; state: 'waiting' | 'concern' | 'good' }) {
  const icon: IconName = state === 'good' ? 'check' : state === 'concern' ? 'target' : 'clock'
  return <span className="board-objective-status" data-state={state}><Icon name={icon} size={15} />{label}</span>
}

/** The president's fictional personality and what each trait does, from the documented rules. */
export function PresidentProfile({ season }: { season: SeasonState }) {
  const clubId = season.managedClubId, world = worldOf(season), president = clubPresident(world, clubId), traits = presidentTraits(world, clubId)
  const terms = boardFundingTerms(season, clubId)
  const ambition = Math.round((ambitionWinRate(0.5, traits) - 0.5) * 100)
  const chance = Math.round(PRESIDENT_RULES.requests.weeklyChance[traits.interference - 1]! * 100)
  const salary = (['confident', 'concerned', 'pressure'] as const).map(verdict => salaryVerdictPercent(president.generosity, verdict))
  return <div className="board-president board-president-profile" data-board-president-profile={clubId}>
    <div className="board-president-identity"><strong>President profile</strong><span>{world.source === 'real-data-pack' ? 'Fictional game traits, not claims about the real club or any real person.' : 'Fictional game traits.'}</span></div>
    <dl className="board-president-facts">
      <div data-president-trait="patience"><dt>Patience · {PATIENCE[traits.patience]}</dt><dd>Confidence moves up to {presidentReviewStep(traits)} a review<small>Under pressure below {presidentPressureLine(traits)} (standard 30)</small></dd></div>
      <div data-president-trait="ambition"><dt>Ambition · {AMBITION[traits.ambition]}</dt><dd>Results targets {ambition === 0 ? 'standard' : `${ambition > 0 ? '+' : '−'}${Math.abs(ambition)} points`}<small>Also shapes the youth and culture objectives</small></dd></div>
      <div data-president-trait="negotiation"><dt>Negotiation · {NEGOTIATION[traits.negotiation]}</dt><dd>Capital needs confidence {terms.requiredConfidence}<small>Asks again {terms.cooldown} {terms.cooldown === 1 ? 'matchday' : 'matchdays'} after a refusal</small></dd></div>
      <div data-president-trait="interference"><dt>Interference · {INTERFERENCE[traits.interference]}</dt><dd>{chance ? `${chance}% chance of a request each review week` : 'Makes no requests'}<small>One open request at a time, at most {PRESIDENT_RULES.requests.maxPerSeason} a season</small></dd></div>
      <div data-president-trait="generosity"><dt>Generosity · {president.generosity} / 5</dt><dd>Salary budget after a verdict: {signedPercent(salary[0]!)} / 0% / {signedPercent(salary[1]!)} / {signedPercent(salary[2]!)}<small>Confident, Steady, Concerned, Under pressure</small></dd></div>
    </dl>
  </div>
}

type ObjectiveState = 'waiting' | 'concern' | 'good'
function youthRow(objective: NonNullable<BoardClubMandate['youth']>, games: number, review: BoardClubReview | undefined) {
  const progress = review?.youthProgress ?? 0, played = review?.played ?? 0
  if (objective.kind === 'academy-promotion') {
    const late = played >= Math.ceil(games * PRESIDENT_RULES.objectives.promotionLateShare)
    const state: ObjectiveState = progress >= objective.target ? 'good' : late ? 'concern' : 'waiting'
    return { title: 'Promote a player from your academy', detail: 'A promotion offer accepted this season, under Academy', progress: `${progress} promoted`, value: progress, max: objective.target, status: state === 'good' ? 'Target met' : state === 'concern' ? 'Overdue' : 'Open', state }
  }
  const pace = games ? objective.targetMinutes * played / games : 0
  const state: ObjectiveState = progress >= objective.targetMinutes ? 'good' : played < PRESIDENT_RULES.objectives.graceGames ? 'waiting' : progress >= pace ? 'good' : 'concern'
  return { title: `Give ${objective.targetMinutes} minutes to young players`, detail: `Under-23 players (${objective.maxAge} or younger at the season opening) and your academy graduates, in counted games`, progress: `${progress} / ${objective.targetMinutes} minutes`, value: progress, max: objective.targetMinutes, status: progress >= objective.targetMinutes ? 'Target met' : state === 'waiting' ? 'Early games' : state === 'good' ? 'On track' : 'Behind target', state }
}
function cultureRow(objective: NonNullable<BoardClubMandate['culture']>, review: BoardClubReview | undefined) {
  const progress = review?.cultureProgress ?? 0, played = review?.played ?? 0
  const state: ObjectiveState = played < PRESIDENT_RULES.objectives.graceGames ? 'waiting' : progress >= objective.target ? 'good' : 'concern'
  const title = objective.kind === 'established-core' ? `Keep ${objective.target} of the club's own players in the rotation` : `Play ${objective.target} young ${objective.target === 1 ? 'player' : 'players'} in the rotation`
  const detail = objective.kind === 'established-core' ? `${objective.playerIds.length} players were with the club last season or came from its academy` : `Under-23 players (${objective.maxAge} or younger) and your academy graduates`
  return { title, detail: `${detail}. A rotation player plays at least 10 minutes in half of the counted games.`, progress: `${progress} / ${objective.target} in the rotation`, value: progress, max: objective.target, status: state === 'waiting' ? 'Early games' : state === 'good' ? 'Meeting it' : 'Short of it', state }
}

/** Youth and culture objective rows, beside the results and finance objectives. */
export function PresidentObjectives({ objective, review }: { objective: BoardClubMandate; review: BoardClubReview | undefined }) {
  const rows = [objective.youth ? { key: 'youth', icon: 'people' as IconName, ...youthRow(objective.youth, objective.games, review) } : null, objective.culture ? { key: 'culture', icon: 'shield' as IconName, ...cultureRow(objective.culture, review) } : null].filter(row => row !== null)
  return <>{rows.map(row => <div key={row.key} className="board-objective" data-board-objective={row.key}><Icon name={row.icon} size={23} /><div className="board-objective-name"><strong>{row.title}</strong><span>{row.detail}</span></div><div className="board-objective-progress"><strong data-board-objective-progress={row.value}>{row.progress}</strong><progress value={Math.min(row.value, row.max)} max={Math.max(1, row.max)} aria-label={`${row.title}: ${row.progress}`} /></div><Status label={row.status} state={row.state} /></div>)}</>
}

function playerName(season: SeasonState, playerId: string): string {
  try { return getCareerPlayer(season, playerId).name } catch { return 'a former player' }
}
export function requestText(season: SeasonState, request: BoardRequest): string {
  if (request.kind === 'raise-ticket-price') return `Raise the home ticket price to at least ${money(request.ticketPrice!)}, set manually`
  if (request.kind === 'sign-player') return `Sign a ${POSITION_NAMES[request.position!] ?? request.position} (${request.position})`
  return `Give ${playerName(season, request.playerId!)} at least ${request.minutes} minutes in league games`
}
function requestProgress(season: SeasonState, request: BoardRequest): string {
  if (request.kind === 'raise-ticket-price') { const plan = season.finance.plans[request.clubId]; return plan ? `Ticket price now ${money(plan.price)}${plan.delegated ? ' · set automatically' : ''}` : 'No ticket plan' }
  if (request.kind === 'sign-player') return 'Met when a new player in that position joins the squad'
  const through = lastCommittedWeek(season)
  return `${Math.floor(requestSeconds(season, request.clubId, request.playerId!, request.round + 1, through) / 60)} minutes since the request`
}
const OUTCOMES: Record<BoardRequest['outcome'], { label: string; state: ObjectiveState }> = { open: { label: 'Open', state: 'waiting' }, met: { label: `Met · +${PRESIDENT_RULES.requests.met} confidence`, state: 'good' }, ignored: { label: `Ignored · ${PRESIDENT_RULES.requests.ignored} confidence`, state: 'concern' }, withdrawn: { label: 'Withdrawn', state: 'waiting' } }

/** The president's open request with its deadline and the requests already settled. */
export function PresidentRequests({ season }: { season: SeasonState }) {
  const requests = (season.board.requests ?? []).filter(request => request.clubId === season.managedClubId || request.outcome !== 'open').slice().reverse()
  const open = requests.find(request => request.outcome === 'open')
  const name = clubPresident(worldOf(season), season.managedClubId).name
  return <>
    <h3 className="board-section-heading"><Icon name="mail" size={16} />President's requests</h3>
    {open && <div className="board-objective board-request-open" data-board-request={open.kind}><Icon name="mail" size={23} /><div className="board-objective-name"><strong>{requestText(season, open)}</strong><span>{name} asked on {medicalDate(open.date)}. Deadline: the review after matchday {open.deadlineRound}, <time dateTime={dateForRound(open.deadlineRound, open.seasonNumber)}>{medicalDate(dateForRound(open.deadlineRound, open.seasonNumber))}</time>.</span></div><div className="board-objective-progress"><strong>{requestProgress(season, open)}</strong><span>Met: +{PRESIDENT_RULES.requests.met} confidence · ignored: {PRESIDENT_RULES.requests.ignored}</span></div><Status label="Open" state="waiting" /></div>}
    {!requests.length ? <p className="board-empty board-funding-empty">No requests yet. The more involved the president, the more often requests come, from the third week of a season.</p>
      : requests.some(request => request.outcome !== 'open') && <ul className="board-funding-history" aria-label="Earlier president requests">{requests.filter(request => request.outcome !== 'open').map(request => <li key={request.id} data-board-request-outcome={request.outcome}><span><strong>{requestText(season, request)}</strong><small><time dateTime={request.date}>{medicalDate(request.date)}</time> · {seasonLabel(request.seasonNumber)} · settled after matchday {request.resolvedRound}</small></span><span className="board-funding-outcome"><Status label={OUTCOMES[request.outcome].label} state={OUTCOMES[request.outcome].state} /></span></li>)}</ul>}
  </>
}
