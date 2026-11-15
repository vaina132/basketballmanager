import type { SeasonState } from '../domain/season'
import { getPlayerAging, getPlayerRetirement } from '../world/lifecycle-policy'
import { seasonLabel } from '../world/season'
import { developClub, TRAINING_ATTRIBUTES, TRAINING_FOCUS_LABELS } from '../world/training'
import { Icon } from './Icon'
import { scoutingDate } from './ScoutingKnowledge'
import './player-lifecycle.css'

export function practiceAgeLabel(percent: number): string {
  const difference = Math.round(percent) - 100
  return difference === 0 ? 'Standard practice' : `Age effect: ${difference > 0 ? '+' : '−'}${Math.abs(difference)}% practice`
}

/** Opening-day departures are attributed to the last registered club, not an older announcement. */
export function clubRetirementsThisSeason(season: SeasonState) {
  const previous = season.history.find(archive => archive.seasonNumber === season.seasonNumber - 1)
  const roster = previous?.rosters.filter(snapshot => snapshot.clubId === season.managedClubId).sort((a, b) => b.fromRound - a.fromRound)[0]
  return season.lifecycle.enabledSince && roster ? season.lifecycle.notices.filter(notice => notice.retirementSeason === season.seasonNumber && notice.retiredOn <= season.date && roster.players.some(player => player.id === notice.playerId)) : []
}

export const recentClubRetirements = (season: SeasonState) => clubRetirementsThisSeason(season).filter(notice => notice.retiredOn === season.date)

/** A confirmed retirement date is public; this component never reads hidden ability. */
export function PlayerCareerStatus({ season, playerId, compact = false }: { season: SeasonState; playerId: string; compact?: boolean }) {
  const { status, notice } = getPlayerRetirement(season, playerId)
  if (!notice || status === 'active') return null
  const date = scoutingDate(notice.retiredOn)
  return <span className={`player-career-status${compact ? ' compact' : ''}${status === 'retired' ? ' retired' : ''}`} data-player-career-status={status} data-retirement-player={playerId} title={status === 'retired' ? `Retired on ${date}` : `Final playing season: ${seasonLabel(notice.lastSeason)}. Retires on ${date}.`}><Icon name="calendar" size={14} /><span>{status === 'retired' ? 'Retired' : compact ? 'Retirement announced' : `Final season: ${seasonLabel(notice.lastSeason)}`}{!compact && <small>{status === 'retired' ? 'Retired' : 'Retires'} <time dateTime={notice.retiredOn}>{date}</time></small>}</span></span>
}

/** Current owned-player effects only; scouting continues to use its frozen, uncertain reports. */
export function PlayerAgeDevelopment({ season, playerId }: { season: SeasonState; playerId: string }) {
  const club = season.clubs.find(club => club.id === season.managedClubId)!
  if (!club.players.some(player => player.id === playerId)) return null
  const aging = getPlayerAging(season, playerId)
  if (!aging.active) return null
  const unaged = developClub(club, season.training, { ...season, lifecycle: undefined }).players.find(player => player.id === playerId)!
  const current = developClub(club, season.training, season).players.find(player => player.id === playerId)!
  const changed = TRAINING_ATTRIBUTES.filter(key => current.attributes[key] < unaged.attributes[key])
  return <details className="player-age-development" data-player-age-development={playerId}><summary><Icon name="training" size={15} /><span>Age &amp; development</span><strong>{aging.age === null ? 'Age unknown' : `${aging.age} years`}</strong></summary><div className="player-age-development-body"><div className="player-age-practice"><span>Practice rate</span><strong data-player-practice-percent={aging.trainingPercent}>{Math.round(aging.trainingPercent)}%</strong></div><p>100% is standard practice. The age effect applies on eligible training days. Workload, availability and coaching are recorded in the weekly report.</p><div className="player-age-losses"><strong>Age-related skill changes</strong>{changed.length ? <ul>{changed.map(key => <li key={key}><span>{TRAINING_FOCUS_LABELS[key]}</span><b data-age-skill-loss={key}>−{unaged.attributes[key] - current.attributes[key]}</b></li>)}</ul> : <span>No skill loss recorded.</span>}{aging.startedOn && <small>Since <time dateTime={aging.startedOn}>{scoutingDate(aging.startedOn)}</time> &middot; updated <time dateTime={aging.asOf}>{scoutingDate(aging.asOf)}</time></small>}</div><p>Age effects build gradually with the calendar. Practice can still improve skills within training limits.</p></div></details>
}

export function LifecycleTrainingControl({ season, busy = false, onEnable }: { season: SeasonState; busy?: boolean; onEnable: () => void }) {
  if (season.lifecycle.enabledSince) return null
  const reason = !season.academy.enabledSince || !season.employment.enabledSince || !season.negotiations.enabledSince || !season.payroll.enabledSince ? 'Enable the academy, player contracts, negotiations and payroll first.' : season.status !== 'active' ? 'Start next season to enable player aging and retirement.' : null
  return <section className="lifecycle-enable panel" aria-labelledby="lifecycle-enable-title"><Icon name="calendar" size={23} /><div><h2 id="lifecycle-enable-title">Player aging &amp; retirement</h2><p>Age affects future practice and gradual skill decline. Confirmed retirement dates appear in contract planning.</p>{reason && <p id="lifecycle-enable-reason">{reason}</p>}</div><button id="enable-lifecycle" className="button small" onClick={onEnable} disabled={busy || !!reason} aria-describedby={reason ? 'lifecycle-enable-reason' : undefined}>Enable aging &amp; retirement</button></section>
}
