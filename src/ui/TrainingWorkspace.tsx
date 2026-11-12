import type { SeasonState } from '../domain/season'
import type { TrainingFocus, TrainingPlan, TrainingWeekReport } from '../domain/training'
import type { Team } from '../domain/types'
import { COACHES } from '../data/development-coaches'
import { DEVELOPMENT_FITNESS_COACHES } from '../data/development-fitness'
import { getClubFitnessEffects } from '../world/fitness-policy'
import { FitnessBenefits, FitnessPortrait, fitnessNumber } from './FitnessBenefits'
import { getClubCoaching } from '../world/coaching'
import { getSeasonInjuries, getPlayerMedicalSummary } from '../world/health'
import { dateForRound } from '../world/season'
import { developClub, resolveTrainingPlan, trainingAvailableDays, trainingPointCap, TRAINING_ATTRIBUTES, TRAINING_FOCUSES, TRAINING_FOCUS_LABELS, TRAINING_INTENSITIES, TRAINING_INTENSITY_LABELS } from '../world/training'
import { Avatar } from './Avatar'
import { Icon } from './Icon'
import { StaminaMeter } from './StaminaMeter'
import { LifecycleTrainingControl, PlayerCareerStatus, practiceAgeLabel } from './PlayerLifecycle'
import { getPlayerAging } from '../world/lifecycle-policy'
import { FacilityPracticeContribution, FacilityPracticeEffect } from './FacilityPractice'
import './training-workspace.css'

interface TrainingWorkspaceProps {
  season: SeasonState
  onEnable: () => void
  onEnableLifecycle: () => void
  onOpenFitness: () => void
  onOpenMedical: () => void
  onPlanChange: (plan: TrainingPlan) => void
  onSelectPlayer: (id: string) => void
  busy?: boolean
}

const dateFormatter = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const formatDate = (date: string) => dateFormatter.format(new Date(`${date}T00:00:00Z`))
const workloadDescriptions = {
  recovery: 'Rest up. No skill practice.',
  light: 'Recover while building skills slowly.',
  standard: 'Balance practice and recovery.',
  heavy: 'More practice. More fatigue.',
}

function FocusOptions({ individual = false }: { individual?: boolean }) {
  return <>{individual && <option value="team">Team focus</option>}{TRAINING_FOCUSES.map(focus => <option key={focus} value={focus}>{TRAINING_FOCUS_LABELS[focus]}</option>)}</>
}

export function TrainingWorkspace({ season, onEnable, onEnableLifecycle, onOpenFitness, onOpenMedical, onPlanChange, onSelectPlayer, busy = false }: TrainingWorkspaceProps) {
  const baseClub = season.clubs.find(club => club.id === season.managedClubId)!
  const club = developClub(baseClub, season.training, season)
  const enabled = season.training.enabledSince !== null
  const plan = season.training.plans[club.id]!
  const conditions = Object.fromEntries(club.players.map(player => [player.id, season.activeMatch.stats[player.id]?.condition ?? season.conditions[player.id]!]))
  const appliedPlan = resolveTrainingPlan(plan, club, conditions)
  const injuries = getSeasonInjuries(season)
  const nextDate = season.round < 10 ? dateForRound(season.round + 1, season.seasonNumber) : null
  const fitness = getClubFitnessEffects(season)
  const fitnessCoach = fitness ? DEVELOPMENT_FITNESS_COACHES.find(coach => coach.id === fitness.coachId)! : null
  const week = season.training.lastWeek
  const coaches = season.coaching.enabledSince === null ? [] : getClubCoaching(season.coaching, club.id)

  return <div className="training-workspace">
    <section className="training-context panel" aria-label="Training schedule">
      <div><strong>{club.name}</strong><span>{season.round === 10 ? 'Resumes next season' : `Plan applies after Matchday ${season.round}`}</span></div>
      <time dateTime={season.date}>{formatDate(season.date)}</time>
    </section>

    <LifecycleTrainingControl season={season} busy={busy} onEnable={onEnableLifecycle} />
    {!enabled ? <section className="training-enable panel" aria-labelledby="training-enable-title">
      <header className="training-heading"><h2 id="training-enable-title">Weekly training</h2><span>Not enabled</span></header>
      <div><p>Enable workload and focus planning for recovery and skill development. Starts with the next training week and applies to every club.</p><button id="enable-training" className="button primary" onClick={onEnable} disabled={busy}>Enable training<Icon name="training" size={16} /></button></div>
    </section> : <>
      <section className="training-plan panel" aria-labelledby="training-plan-title">
        <header className="training-heading"><h2 id="training-plan-title"><Icon name="training" size={18} />Weekly plan</h2><span>{plan.delegated ? 'Assistant control' : 'Manual control'}</span></header>
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
        <div className="training-plan-note training-plan-preview"><Icon name={appliedPlan.intensity === 'recovery' ? 'shield' : 'training'} size={25} /><div><strong>{TRAINING_INTENSITY_LABELS[appliedPlan.intensity]} · {TRAINING_FOCUS_LABELS[appliedPlan.focus]}</strong><p id="training-workload-help">{workloadDescriptions[appliedPlan.intensity]}</p></div><span>{coaches.length} {coaches.length === 1 ? 'training coach' : 'training coaches'}</span></div>
        <FacilityPracticeEffect season={season} type="training" />
        <details className="game-disclosure"><summary><Icon name="staff" size={15} />Plan details</summary><div className="training-plan-note">{plan.delegated && <p>The assistant chooses workload after the matchday. Individual focus still applies.</p>}{coaches.length > 0 && <p className="training-coaching-plan">{coaches.map(contract => `${COACHES.find(coach => coach.id === contract.coachId)!.name} (${TRAINING_FOCUS_LABELS[contract.focus]})`).join(' · ')}. The best applicable coach counts.</p>}<p>Training runs after Continue. Injuries and low condition reduce practice.</p></div></details>
      </section>

      <section className="training-fitness panel" aria-labelledby="training-fitness-title" data-training-fitness={fitness?.coachId ?? 'none'}>
        <div className="training-fitness-main">{fitnessCoach ? <FitnessPortrait coach={fitnessCoach} color={club.color} size={52} /> : <span className="training-fitness-vacant" aria-hidden="true"><Icon name="shield" size={28} /></span>}<div><h2 id="training-fitness-title">Fitness coach</h2><strong>{fitnessCoach?.name ?? 'No coach appointed'}</strong>{!fitnessCoach && <small>Recovery and workload support</small>}{fitness && !nextDate && <small>No training weeks left this season</small>}</div></div>
        {fitness && <FitnessBenefits effects={fitness} />}
        <button className="button small" id="training-open-fitness" onClick={onOpenFitness} disabled={busy}>{fitnessCoach ? 'Manage coach' : 'Recruit coach'}<Icon name="chevron" size={14} /></button>
        {fitness && <details className="training-fitness-details"><summary>How fitness support works</summary><p>These are the coach's daily benefits on medically available training days. Recovery is capped at full condition. Injury return dates stay unchanged. The weekly report records the condition actually gained from this support.</p></details>}
      </section>

      <section className="training-roster panel" aria-labelledby="training-roster-title">
        <header className="training-heading"><h2 id="training-roster-title"><Icon name="target" size={18} />Player development</h2><button className="text-button" onClick={onOpenMedical} disabled={busy}>Medical<Icon name="medical" size={14} /></button><span>{nextDate ? 'Next week' : 'Next season'}</span></header>
        <div className="training-table-scroll" role="region" aria-label="Squad training plans" tabIndex={0}>
          <table className="training-roster-table"><thead><tr><th scope="col">Player</th><th scope="col">Condition</th><th scope="col">Individual focus</th><th scope="col">Target skill / progress</th><th scope="col">Eligible days</th></tr></thead><tbody>{club.players.map(player => {
            const individual = plan.individual[player.id] ?? 'team'
            const focus = individual === 'team' ? appliedPlan.focus : individual
            const health = getPlayerMedicalSummary(season, player.id)
            const injury = health && health.daysRemaining > 0 ? health : null
            const availableDays = nextDate ? trainingAvailableDays(injuries, player.id, season.date, nextDate, season.physio) : null
            const basePlayer = baseClub.players.find(base => base.id === player.id)!
            const points = focus === 'balanced' ? null : season.training.points[player.id]![focus]
            const cap = focus === 'balanced' ? null : trainingPointCap(basePlayer.attributes[focus])
            const capped = points !== null && cap !== null && points >= cap
            const aging = getPlayerAging(season, player.id)
            return <tr key={player.id} data-player-id={player.id}>
              <th scope="row"><button className="training-player" onClick={() => onSelectPlayer(player.id)} disabled={busy} aria-label={`View ${player.name}`}><Avatar player={player} color={club.color} size={28} /><span><strong>{player.name}</strong><small>{player.position} · #{player.number}{aging.age !== null && <> · {aging.age} years</>}</small></span><Icon name="chevron" size={13} /></button><PlayerCareerStatus season={season} playerId={player.id} compact /></th>
              <td><StaminaMeter value={conditions[player.id]!} label={`${player.name} current condition`} compact /></td>
              <td><select data-player-focus={player.id} value={individual} aria-label={`${player.name} training focus`} onChange={event => onPlanChange({ ...plan, individual: { ...plan.individual, [player.id]: event.target.value as TrainingFocus | 'team' } })} disabled={busy}><FocusOptions individual /></select></td>
              <td>{focus === 'balanced' ? <div className="training-skill"><span>Balanced practice</span><small>Shared across all skills</small></div> : <div className="training-skill"><div><span>{TRAINING_FOCUS_LABELS[focus]}</span><strong>{player.attributes[focus]} / 20</strong></div>{capped ? <small>{player.attributes[focus] === 20 ? 'Maximum rating reached' : 'Training cap reached'}</small> : <><progress value={points! % 100} max={100} aria-label={`${player.name} ${TRAINING_FOCUS_LABELS[focus]} progress to next rating`} /><small>{points! % 100} / 100 practice points</small></>}</div>}{aging.active && <span className="training-age-line" data-training-age-rate={player.id}>{practiceAgeLabel(aging.trainingPercent)}</span>}</td>
              <td><span className={injury ? 'training-injured' : ''}>{availableDays === null ? 'Next season' : `${availableDays} / 7 days`}</span><small>{injury ? `Injured · return ${formatDate(injury.effectiveReturnOn)}` : 'Available now'}</small></td>
            </tr>
          })}</tbody></table>
        </div>
        <p className="training-note"><Icon name="calendar" size={14} />Practice begins after you Continue.</p>
      </section>

      <details className="training-report panel game-disclosure">
        <summary><Icon name="training" size={17} />Last training week{week ? ` · Matchday ${week.afterRound}` : ' · No report yet'}</summary>
        <header className="training-heading"><h2 id="training-report-title">Last training week</h2>{week && <span><time dateTime={week.fromDate}>{formatDate(week.fromDate)}</time> – <time dateTime={week.toDate}>{formatDate(week.toDate)}</time> · After Matchday {week.afterRound}</span>}</header>
        {week ? <TrainingReport season={season} club={club} week={week} onSelectPlayer={onSelectPlayer} busy={busy} /> : <p className="training-empty">No training completed this season yet.</p>}
      </details>
    </>}
  </div>
}

function TrainingReport({ season, club, week, onSelectPlayer, busy }: { season: SeasonState; club: Team; week: TrainingWeekReport; onSelectPlayer: (id: string) => void; busy: boolean }) {
  const roster = season.rosters.find(snapshot => snapshot.id === week.rosterIds[club.id] && snapshot.clubId === club.id)
  if (!roster) return <p className="training-empty">The recorded squad for this training week is unavailable.</p>
  const recordedBase = { ...club, players: roster.players }
  const recordedClub = developClub(recordedBase, season.training, { ...season, date: week.toDate })
  const previousPoints = Object.fromEntries(Object.entries(season.training.points).map(([id, points]) => [id, Object.fromEntries(TRAINING_ATTRIBUTES.map(attribute => [attribute, points[attribute] - (week.players[id]?.gains[attribute] ?? 0)]))])) as typeof season.training.points
  const previousClub = developClub(recordedBase, { ...season.training, points: previousPoints }, { ...season, date: week.fromDate })
  const appliedCoaches = week.coaching?.[club.id] ?? null
  const appliedFitness = week.fitness?.[club.id] ?? null
  const reportCoach = appliedFitness ? DEVELOPMENT_FITNESS_COACHES.find(coach => coach.id === appliedFitness.coachId)! : null
  return <>
    {appliedCoaches !== null && <p className="training-coaching-report"><strong>Staff that week</strong> {appliedCoaches.length > 0 ? appliedCoaches.map(assignment => `${COACHES.find(coach => coach.id === assignment.coachId)!.name} (${TRAINING_FOCUS_LABELS[assignment.focus]})`).join(' · ') : 'No coaches assigned.'}</p>}
    {reportCoach && <div className="training-fitness-report" data-report-fitness={reportCoach.id}><FitnessPortrait coach={reportCoach} size={38} /><div><strong>Fitness support: {reportCoach.name}</strong><p>Each player's condition includes the benefit shown below. It can be zero when fully rested or medically unavailable.</p></div></div>}
    <div className="training-table-scroll" role="region" aria-label="Completed weekly training" tabIndex={0}>
    <table className="training-report-table"><thead><tr><th scope="col">Player</th><th scope="col">Applied plan</th><th scope="col">Eligible days</th><th scope="col">Condition</th><th scope="col">Skill progress</th></tr></thead><tbody>{recordedClub.players.map(player => {
      const report = week.players[player.id]
      if (!report) return null
      const before = previousClub.players.find(previous => previous.id === player.id)!
      const gains = TRAINING_ATTRIBUTES.filter(attribute => report.gains[attribute] > 0)
      const totalGains = gains.reduce((total, attribute) => total + report.gains[attribute], 0)
      const coachingGains = TRAINING_ATTRIBUTES.reduce((total, attribute) => total + report.coachingGains[attribute], 0)
      const ratingChanges = TRAINING_ATTRIBUTES.filter(attribute => player.attributes[attribute] !== before.attributes[attribute])
      const breakdown = <ul className="training-gains">{gains.map(attribute => <li key={attribute}><span>{TRAINING_FOCUS_LABELS[attribute]}</span><strong>+{report.gains[attribute]} practice</strong>{report.coachingGains[attribute] > 0 && <small className="training-coaching-skill">({report.coachingGains[attribute]} from coaching)</small>}</li>)}</ul>
      return <tr key={player.id} data-player-id={player.id}>
        <th scope="row">{club.players.some(current => current.id === player.id) ? <button className="text-button" onClick={() => onSelectPlayer(player.id)} disabled={busy}>{player.name}<Icon name="chevron" size={13} /></button> : <span>{player.name}</span>}</th>
        <td>{TRAINING_FOCUS_LABELS[report.focus]}<small>{TRAINING_INTENSITY_LABELS[report.intensity]}</small></td>
        <td>{report.availableDays} days</td>
        <td><span aria-label={`${player.name} condition before ${Math.round(report.conditionBefore)} percent, after ${Math.round(report.conditionAfter)} percent`}>{Math.round(report.conditionBefore)}% → {Math.round(report.conditionAfter)}%</span>{appliedFitness && report.fitness && <small className="training-fitness-gain" data-fitness-benefit={report.fitness.conditionBenefit} title={`Condition without fitness support: ${fitnessNumber(report.fitness.conditionWithoutCoach)}%`}>Fitness +{fitnessNumber(report.fitness.conditionBenefit)} condition</small>}</td>
        <td>{gains.length > 1 ? <details className="training-gain-details"><summary aria-label={`${player.name}: ${totalGains} practice points across ${gains.length} skills. Skill breakdown.`}>+{totalGains} practice across {gains.length} skills</summary>{breakdown}</details> : gains.length === 1 ? breakdown : <span className="training-no-gain">No practice gained</span>}{coachingGains > 0 && <p className="training-coaching-gain">Includes +{coachingGains} from coaching</p>}<FacilityPracticeContribution report={report.facility} />{report.aging && <details className="training-aging-details" data-weekly-aging={player.id}><summary>Practice allowance: {report.aging.adjustedPracticePoints} points</summary><dl><div><dt>Ordinary practice allowance</dt><dd>{report.aging.ordinaryPracticePoints} points</dd></div><div><dt>Age practice rate</dt><dd>{Math.round(report.aging.rateBasisPoints / 100)}%</dd></div><div><dt>Age-adjusted allowance</dt><dd>{report.aging.adjustedPracticePoints} points</dd></div></dl><p>100% is standard practice. This is the practice allowance for eligible days. Coaching and facility support are added separately, then training limits determine the skill progress retained above.</p></details>}{ratingChanges.map(attribute => <p className={player.attributes[attribute] > before.attributes[attribute] ? 'training-rating-gain' : 'training-rating-decline'} key={attribute}>{TRAINING_FOCUS_LABELS[attribute]} {before.attributes[attribute]} → {player.attributes[attribute]} rating</p>)}</td>
      </tr>
    })}</tbody></table>
    </div>
  </>
}
