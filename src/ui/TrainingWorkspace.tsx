import type { SeasonState } from '../domain/season'
import type { TrainingFocus, TrainingPlan, TrainingWeekReport } from '../domain/training'
import type { Team } from '../domain/types'
import { COACHES } from '../data/development-coaches'
import { getClubCoaching } from '../world/coaching'
import { getSeasonInjuries, isRecovering } from '../world/health'
import { dateForRound } from '../world/season'
import { developClub, resolveTrainingPlan, trainingAvailableDays, trainingPointCap, TRAINING_ATTRIBUTES, TRAINING_FOCUSES, TRAINING_FOCUS_LABELS, TRAINING_INTENSITIES, TRAINING_INTENSITY_LABELS } from '../world/training'
import { Avatar } from './Avatar'
import { Icon } from './Icon'
import { StaminaMeter } from './StaminaMeter'
import './training-workspace.css'

interface TrainingWorkspaceProps {
  season: SeasonState
  onEnable: () => void
  onPlanChange: (plan: TrainingPlan) => void
  onSelectPlayer: (id: string) => void
  busy?: boolean
}

const dateFormatter = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const formatDate = (date: string) => dateFormatter.format(new Date(`${date}T00:00:00Z`))
const workloadDescriptions = {
  recovery: 'Rest and recovery. No skill practice; the greatest improvement in freshness.',
  light: 'Slower skill development with more time to recover.',
  standard: 'Steady skill development with limited recovery between matches.',
  heavy: 'More practice when fresh, at the cost of freshness between matches.',
}

function FocusOptions({ individual = false }: { individual?: boolean }) {
  return <>{individual && <option value="team">Team focus</option>}{TRAINING_FOCUSES.map(focus => <option key={focus} value={focus}>{TRAINING_FOCUS_LABELS[focus]}</option>)}</>
}

export function TrainingWorkspace({ season, onEnable, onPlanChange, onSelectPlayer, busy = false }: TrainingWorkspaceProps) {
  const baseClub = season.clubs.find(club => club.id === season.managedClubId)!
  const club = developClub(baseClub, season.training)
  const enabled = season.training.enabledSince !== null
  const plan = season.training.plans[club.id]!
  const conditions = Object.fromEntries(club.players.map(player => [player.id, season.activeMatch.stats[player.id]?.condition ?? season.conditions[player.id]!]))
  const appliedPlan = resolveTrainingPlan(plan, club, conditions)
  const injuries = getSeasonInjuries(season)
  const nextDate = season.round < 10 ? dateForRound(season.round + 1, season.seasonNumber) : null
  const week = season.training.lastWeek
  const coaches = season.coaching.enabledSince === null ? [] : getClubCoaching(season.coaching, club.id)

  return <div className="training-workspace">
    <section className="training-context panel" aria-label="Training schedule">
      <div><strong>{club.name}</strong><span>{season.round === 10 ? 'Resumes next season' : `Plan applies after Matchday ${season.round}`}</span></div>
      <time dateTime={season.date}>{formatDate(season.date)}</time>
    </section>

    {!enabled ? <section className="training-enable panel" aria-labelledby="training-enable-title">
      <header className="training-heading"><h2 id="training-enable-title">Weekly training</h2><span>Not enabled</span></header>
      <div><p>Enable workload and focus planning for recovery and skill development. Starts with the next training week and applies to every club.</p><button id="enable-training" className="button primary" onClick={onEnable} disabled={busy}>Enable training<Icon name="training" size={16} /></button></div>
    </section> : <>
      <section className="training-plan panel" aria-labelledby="training-plan-title">
        <header className="training-heading"><h2 id="training-plan-title">Weekly plan</h2><span>{plan.delegated ? 'Assistant control' : 'Manual control'}</span></header>
        <div className="training-plan-controls">
          <div className="training-control">
            <div className="training-control-label"><label htmlFor="training-control">Training control</label><output htmlFor="training-control">{plan.delegated ? 'Assistant' : 'Manual'}</output></div>
            <input id="training-control" type="range" min={0} max={1} step={1} value={plan.delegated ? 1 : 0} aria-valuetext={plan.delegated ? 'Assistant' : 'Manual'} onChange={event => onPlanChange({ ...plan, delegated: event.target.value === '1' })} disabled={busy} />
            <div className="training-range-labels"><span>Manual</span><span>Assistant</span></div>
          </div>
          <div className="training-control">
            <div className="training-control-label"><label htmlFor="training-workload">Workload</label><output htmlFor="training-workload">{TRAINING_INTENSITY_LABELS[appliedPlan.intensity]}</output></div>
            <input id="training-workload" type="range" min={0} max={3} step={1} value={TRAINING_INTENSITIES.indexOf(appliedPlan.intensity)} aria-valuetext={TRAINING_INTENSITY_LABELS[appliedPlan.intensity]} aria-describedby="training-workload-help" onChange={event => onPlanChange({ ...plan, intensity: TRAINING_INTENSITIES[Number(event.target.value)]! })} disabled={busy || plan.delegated} />
            <div className="training-range-labels training-workload-labels">{TRAINING_INTENSITIES.map(intensity => <span key={intensity}>{TRAINING_INTENSITY_LABELS[intensity]}</span>)}</div>
          </div>
          <div className="training-control training-focus-control">
            <label htmlFor="training-focus">Team focus</label>
            <select id="training-focus" value={appliedPlan.focus} onChange={event => onPlanChange({ ...plan, focus: event.target.value as TrainingFocus })} disabled={busy || plan.delegated}><FocusOptions /></select>
          </div>
        </div>
        <div className="training-plan-note"><p id="training-workload-help">{workloadDescriptions[appliedPlan.intensity]}</p>{plan.delegated && <p>Assistant workload is a forecast; the final choice follows the squad’s condition after the matchday. Individual focus still applies.</p>}{coaches.length > 0 && <p className="training-coaching-plan">Coaching for the next training week: {coaches.map(contract => `${COACHES.find(coach => coach.id === contract.coachId)!.name} (${TRAINING_FOCUS_LABELS[contract.focus]})`).join(' · ')}. The best applicable coach counts; assignments do not stack.</p>}</div>
      </section>

      <section className="training-roster panel" aria-labelledby="training-roster-title">
        <header className="training-heading"><h2 id="training-roster-title">Individual training</h2><span>{nextDate ? 'Next week · availability forecast' : 'Plan for next season'}</span></header>
        <div className="training-table-scroll" role="region" aria-label="Squad training plans" tabIndex={0}>
          <table className="training-roster-table"><thead><tr><th scope="col">Player</th><th scope="col">Condition</th><th scope="col">Individual focus</th><th scope="col">Target skill / progress</th><th scope="col">Eligible days</th></tr></thead><tbody>{club.players.map(player => {
            const individual = plan.individual[player.id] ?? 'team'
            const focus = individual === 'team' ? appliedPlan.focus : individual
            const injury = [...injuries].reverse().find(episode => episode.playerId === player.id && isRecovering(episode, season.date))
            const availableDays = nextDate ? trainingAvailableDays(injuries, player.id, season.date, nextDate) : null
            const basePlayer = baseClub.players.find(base => base.id === player.id)!
            const points = focus === 'balanced' ? null : season.training.points[player.id]![focus]
            const cap = focus === 'balanced' ? null : trainingPointCap(basePlayer.attributes[focus])
            const capped = points !== null && cap !== null && points >= cap
            return <tr key={player.id} data-player-id={player.id}>
              <th scope="row"><button className="training-player" onClick={() => onSelectPlayer(player.id)} disabled={busy} aria-label={`View ${player.name}`}><Avatar player={player} color={club.color} size={28} /><span><strong>{player.name}</strong><small>{player.position} · #{player.number}</small></span><Icon name="chevron" size={13} /></button></th>
              <td><StaminaMeter value={conditions[player.id]!} label={`${player.name} current condition`} compact /></td>
              <td><select data-player-focus={player.id} value={individual} aria-label={`${player.name} training focus`} onChange={event => onPlanChange({ ...plan, individual: { ...plan.individual, [player.id]: event.target.value as TrainingFocus | 'team' } })} disabled={busy}><FocusOptions individual /></select></td>
              <td>{focus === 'balanced' ? <div className="training-skill"><span>Balanced practice</span><small>Shared across all skills</small></div> : <div className="training-skill"><div><span>{TRAINING_FOCUS_LABELS[focus]}</span><strong>{player.attributes[focus]} / 20</strong></div>{capped ? <small>{player.attributes[focus] === 20 ? 'Maximum rating reached' : 'Training cap reached'}</small> : <><progress value={points! % 100} max={100} aria-label={`${player.name} ${TRAINING_FOCUS_LABELS[focus]} progress to next rating`} /><small>{points! % 100} / 100 practice points</small></>}</div>}</td>
              <td><span className={injury ? 'training-injured' : ''}>{availableDays === null ? 'Next season' : `${availableDays} / 7 days`}</span><small>{injury ? `Injured · return ${formatDate(injury.returnOn)}` : 'Available now'}</small></td>
            </tr>
          })}</tbody></table>
        </div>
        <p className="training-note">Training runs when you continue to the next matchday. Players gain practice only on medically available days; match injuries can change this forecast. Low condition reduces training gains.</p>
      </section>

      <section className="training-report panel" aria-labelledby="training-report-title">
        <header className="training-heading"><h2 id="training-report-title">Last training week</h2>{week && <span><time dateTime={week.fromDate}>{formatDate(week.fromDate)}</time> – <time dateTime={week.toDate}>{formatDate(week.toDate)}</time> · After Matchday {week.afterRound}</span>}</header>
        {week ? <TrainingReport season={season} club={club} baseClub={baseClub} week={week} onSelectPlayer={onSelectPlayer} busy={busy} /> : <p className="training-empty">No training completed this season yet.</p>}
      </section>
    </>}
  </div>
}

function TrainingReport({ season, club, baseClub, week, onSelectPlayer, busy }: { season: SeasonState; club: Team; baseClub: Team; week: TrainingWeekReport; onSelectPlayer: (id: string) => void; busy: boolean }) {
  const previousPoints = Object.fromEntries(Object.entries(season.training.points).map(([id, points]) => [id, Object.fromEntries(TRAINING_ATTRIBUTES.map(attribute => [attribute, points[attribute] - (week.players[id]?.gains[attribute] ?? 0)]))])) as typeof season.training.points
  const previousClub = developClub(baseClub, { ...season.training, points: previousPoints })
  const appliedCoaches = week.coaching?.[club.id] ?? null
  return <>
    {appliedCoaches !== null && <p className="training-coaching-report"><strong>Staff that week</strong> {appliedCoaches.length > 0 ? appliedCoaches.map(assignment => `${COACHES.find(coach => coach.id === assignment.coachId)!.name} (${TRAINING_FOCUS_LABELS[assignment.focus]})`).join(' · ') : 'No coaches assigned.'}</p>}
    <div className="training-table-scroll" role="region" aria-label="Completed weekly training" tabIndex={0}>
    <table className="training-report-table"><thead><tr><th scope="col">Player</th><th scope="col">Applied plan</th><th scope="col">Eligible days</th><th scope="col">Skill progress</th><th scope="col">Condition</th></tr></thead><tbody>{club.players.map(player => {
      const report = week.players[player.id]
      if (!report) return null
      const before = previousClub.players.find(previous => previous.id === player.id)!
      const gains = TRAINING_ATTRIBUTES.filter(attribute => report.gains[attribute] > 0)
      const totalGains = gains.reduce((total, attribute) => total + report.gains[attribute], 0)
      const coachingGains = TRAINING_ATTRIBUTES.reduce((total, attribute) => total + report.coachingGains[attribute], 0)
      const ratingGains = gains.filter(attribute => player.attributes[attribute] > before.attributes[attribute])
      const breakdown = <ul className="training-gains">{gains.map(attribute => <li key={attribute}><span>{TRAINING_FOCUS_LABELS[attribute]}</span><strong>+{report.gains[attribute]} practice</strong>{report.coachingGains[attribute] > 0 && <small className="training-coaching-skill">({report.coachingGains[attribute]} from coaching)</small>}</li>)}</ul>
      return <tr key={player.id} data-player-id={player.id}>
        <th scope="row"><button className="text-button" onClick={() => onSelectPlayer(player.id)} disabled={busy}>{player.name}<Icon name="chevron" size={13} /></button></th>
        <td>{TRAINING_FOCUS_LABELS[report.focus]}<small>{TRAINING_INTENSITY_LABELS[report.intensity]}</small></td>
        <td>{report.availableDays} days</td>
        <td>{gains.length > 1 ? <details className="training-gain-details"><summary aria-label={`${player.name}: ${totalGains} practice points across ${gains.length} skills. Skill breakdown.`}>+{totalGains} practice across {gains.length} skills</summary>{breakdown}</details> : gains.length === 1 ? breakdown : <span className="training-no-gain">No practice gained</span>}{coachingGains > 0 && <p className="training-coaching-gain">Includes +{coachingGains} from coaching</p>}{ratingGains.map(attribute => <p className="training-rating-gain" key={attribute}>{TRAINING_FOCUS_LABELS[attribute]} {before.attributes[attribute]} → {player.attributes[attribute]} rating</p>)}</td>
        <td><span aria-label={`${player.name} condition before ${Math.round(report.conditionBefore)} percent, after ${Math.round(report.conditionAfter)} percent`}>{Math.round(report.conditionBefore)}% → {Math.round(report.conditionAfter)}%</span></td>
      </tr>
    })}</tbody></table>
    </div>
  </>
}
