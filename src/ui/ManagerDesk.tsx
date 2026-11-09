import type { SeasonState } from '../domain/season'
import { getPlayerHealth } from '../world/health'
import { getFinanceBalance } from '../world/finance'
import { getPayrollReserve } from '../world/payroll'
import { contractForSeason, getClubContractSummary, MIN_ROSTER_SIZE } from '../world/employment-policy'
import { medicalDate } from './SeasonMedicalReport'
import type { MatchState, Side } from '../domain/types'
import { isPlayerEligible } from '../engine/match'
import { Avatar } from './Avatar'
import { Icon } from './Icon'
import { StaminaMeter } from './StaminaMeter'
import { TeamInstructions } from './TeamInstructions'
import './manager-desk.css'

interface ManagerDeskProps {
  match: MatchState
  season?: SeasonState | null
  managedSide?: Side
  fixtureLabel?: string
  apply: (action: (state: MatchState) => MatchState) => void
  onOpenMatch: () => void
  onOpenSquad: () => void
  onSelectPlayer: (id: string) => void
  onOpenCoaching: () => void
  onOpenClub: () => void
  onOpenPayroll: () => void
  onOpenTransfers: () => void
  onOpenScouting: () => void
}

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
const period = (value: number) => value <= 4 ? `Q${value}` : `OT${value - 4}`
const money = (cents: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(cents / 100)

export function ManagerDesk({ match, season, managedSide = 'home', fixtureLabel = 'EXHIBITION', apply, onOpenMatch, onOpenSquad, onSelectPlayer, onOpenCoaching, onOpenClub, onOpenPayroll, onOpenTransfers, onOpenScouting }: ManagerDeskProps) {
  const team = match[managedSide]
  const complete = match.status === 'finished'
  const ready = match.status === 'ready'
  const needsReplacement = !complete && match.requiredSubstitutions.length > 0
  const score = match.result?.officialScore ?? match.score
  const active = match.lineups[managedSide].flatMap(id => team.players.filter(player => player.id === id))
  const eligible = team.players.filter(player => isPlayerEligible(match, player.id))
  const availableBench = eligible.filter(player => !match.lineups[managedSide].includes(player.id))
  const injured = team.players.filter(player => match.injuries[player.id])
  const foulTrouble = active.filter(player => match.stats[player.id].fouls === 4)
  const tired = active.filter(player => match.stats[player.id].condition < 75 && isPlayerEligible(match, player.id))
  const lineupEnergy = active.length ? Math.round(active.reduce((sum, player) => sum + match.stats[player.id].condition, 0) / active.length) : null
  const playerName = (id: string, side: Side = managedSide) => match[side].players.find(player => player.id === id)?.name ?? id
  const status = complete ? 'FULL TIME' : needsReplacement ? 'REPLACEMENT REQUIRED' : ready ? 'PRE-MATCH' : 'MATCH PAUSED'
  const notices: { key: string; title: string; detail: string; urgent?: boolean; action: string; open: () => void }[] = []
  const finances = season?.finance.enabledSince ? getFinanceBalance(season.finance, season.managedClubId) : null
  const wageReserve = season?.payroll.enabledSince ? getPayrollReserve(season, season.managedClubId) : null

  if (season?.employment.enabledSince) {
    const nextSquad = getClubContractSummary(season, season.managedClubId)
    const expiring = team.players.filter(player => !contractForSeason(season.employment, player.id, season.seasonNumber + 1)).length
    if (season.status === 'complete') notices.push({ key: 'offseason', title: 'Prepare next season’s squad', detail: `${nextSquad.rosterSize} players signed for next season. ${Math.max(0, MIN_ROSTER_SIZE - nextSquad.rosterSize)} more needed to reach the minimum squad.`, urgent: nextSquad.rosterSize < MIN_ROSTER_SIZE, action: 'Review offseason', open: onOpenTransfers })
    else if (expiring) notices.push({ key: 'contracts', title: `${expiring} contracts awaiting renewal`, detail: 'Unrenewed players leave at the end of this season. Renewals take effect next season.', action: 'Review contracts', open: onOpenTransfers })
  }
  if (season?.scouting.enabledSince) {
    const latestRound = season.status === 'complete' ? season.round : season.round - 1
    const reports = season.scouting.clubs[season.managedClubId]!.reviews.filter(report => report.seasonNumber === season.seasonNumber && report.round === latestRound)
    if (reports.length) notices.push({ key: 'scouting', title: 'Scouting reviews available', detail: `${reports.filter(report => report.outcome === 'observed').length} skill reports from matchday ${latestRound}.${reports.some(report => report.outcome === 'no-minutes') ? ' Some targets did not play.' : ''}`, action: 'Review scouting', open: onOpenScouting })
  }

  if (needsReplacement) notices.push({ key: 'replacement', title: 'Replace an unavailable player', detail: match.requiredSubstitutions.map(item => `${playerName(item.playerId, item.side)}: ${item.reason === 'injured' ? 'injured' : 'five fouls'}`).join('; '), urgent: true, action: 'Choose replacement', open: onOpenCoaching })
  if (finances?.unpaid) notices.push({ key: 'unpaid', title: 'Outstanding club costs', detail: `${money(finances.unpaid)} unpaid. New coaching appointments are blocked until these costs are covered.`, urgent: true, action: 'Review finances', open: onOpenClub })
  if (finances && wageReserve !== null && wageReserve > finances.cash) notices.push({ key: 'wage-commitments', title: 'Wage commitments exceed cash', detail: `${money(wageReserve - finances.cash)} more is needed to cover remaining scheduled wages. Future income may reduce this shortfall.`, urgent: true, action: 'Review wages', open: onOpenPayroll })
  if (injured.length) notices.push({ key: 'injuries', title: `${injured.length} injured ${injured.length === 1 ? 'player' : 'players'}`, detail: injured.map(player => { const health = season ? getPlayerHealth(season, player.id) : null; return health ? `${player.name}: expected ${medicalDate(health.returnOn)}` : player.name }).join('; '), action: 'Review squad', open: onOpenSquad })
  if (!complete && foulTrouble.length) notices.push({ key: 'fouls', title: 'Foul trouble', detail: foulTrouble.map(player => `${player.name} · 4 fouls`).join('; '), action: 'Manage rotation', open: onOpenCoaching })
  if (tired.length) notices.push({ key: 'fatigue', title: complete ? 'Post-match fatigue' : 'Players tiring', detail: tired.map(player => `${player.name} · ${Math.round(match.stats[player.id].condition)}%`).join('; '), action: complete ? 'Review squad' : 'Manage rotation', open: complete ? onOpenSquad : onOpenCoaching })
  if (!complete && match.pendingSubstitutions[managedSide].length) notices.push({ key: 'queued', title: 'Substitutions queued', detail: match.pendingSubstitutions[managedSide].map(change => `${playerName(change.outId)} → ${playerName(change.inId)}`).join('; '), action: 'Review changes', open: onOpenCoaching })
  if (!complete && match.timeoutRequested[managedSide]) notices.push({ key: 'timeout', title: 'Timeout requested', detail: 'Waiting for the next permitted stoppage.', action: 'Review request', open: onOpenCoaching })

  const activity = match.events.filter(event => event.type !== 'tipoff' && !(event.type === 'command' && event.scene?.kind === 'setup')).slice(-5).reverse()
  const displayName = complete ? 'Final lineup' : ready ? 'Starting five' : 'On the floor'

  return <div className="manager-desk">
    <section className="desk-fixture panel" aria-label="Current fixture">
      <div className="desk-fixture-label"><span>{fixtureLabel}</span><strong className={needsReplacement ? 'desk-status-urgent' : ''}>{status}</strong></div>
      <div className="desk-fixture-content">
        <div className="desk-fixture-team"><span className="desk-club-code" style={{ color: match.home.color }}>{match.home.shortName}</span><div><strong>{match.home.name}</strong><span>{managedSide === 'home' ? 'Home · Your team' : 'Home'}</span></div></div>
        <div className="desk-fixture-score"><strong aria-label={`Score: ${score.home} to ${score.away}`}>{score.home}<span>:</span>{score.away}</strong><span>{ready ? 'Awaiting tipoff' : complete ? match.result?.kind === 'default' ? 'Awarded by default' : `${period(match.period)} · Final` : `${period(match.period)} · ${clock(match.clockSeconds)}`}</span></div>
        <div className="desk-fixture-team desk-fixture-away"><span className="desk-club-code" style={{ color: match.away.color }}>{match.away.shortName}</span><div><strong>{match.away.name}</strong><span>{managedSide === 'away' ? 'Away · Your team' : 'Away'}</span></div></div>
        <button className="button primary desk-match-action" onClick={needsReplacement ? onOpenCoaching : onOpenMatch}>{complete ? 'View result' : needsReplacement ? 'Resolve replacement' : 'Go to match'}<Icon name="arrow" size={16} /></button>
      </div>
    </section>

    <dl className="desk-squad-status" aria-label="Squad status">
      <div><dt>Eligible players</dt><dd>{eligible.length}<small> / {team.players.length}</small></dd></div>
      <div><dt>Available reserves</dt><dd>{availableBench.length}</dd></div>
      <div><dt>Lineup stamina</dt><dd>{lineupEnergy === null ? '—' : `${lineupEnergy}%`}</dd></div>
      <div><dt>Substitutions</dt><dd className="desk-policy-value">{match.autoSubstitutions[managedSide] ? 'Assistant' : 'Manual'}</dd></div>
    </dl>

    <div className="desk-columns">
      <div className="desk-main-column">
        <section className="desk-lineup panel" aria-labelledby="desk-lineup-heading">
          <div className="desk-panel-heading"><h2 id="desk-lineup-heading">{displayName}</h2><button className="text-button" onClick={onOpenSquad}>Full squad<Icon name="chevron" size={15} /></button></div>
          <div className="desk-table-scroll"><table className="desk-lineup-table"><thead><tr><th>Player</th><th>Position</th><th>Stamina</th><th>Fouls</th></tr></thead><tbody>{active.map(player => {
            const unavailable = match.injuries[player.id] ? 'Injured' : match.stats[player.id].fouls >= 5 ? 'Fouled out' : null
            return <tr key={player.id} data-player-id={player.id}><td><button className="desk-player" onClick={() => onSelectPlayer(player.id)} aria-label={`View ${player.name}`}><Avatar player={player} color={team.color} size={31} /><span><strong>{player.name}</strong><small>#{player.number}{unavailable && <em>{unavailable}</em>}</small></span></button></td><td>{player.position}</td><td><StaminaMeter value={match.stats[player.id].condition} label={`${player.name} stamina`} compact /></td><td className={match.stats[player.id].fouls >= 4 ? 'desk-warning-value' : ''}>{match.stats[player.id].fouls}</td></tr>
          })}</tbody></table></div>
          {!active.length && <p className="desk-empty">No players on court.</p>}
          <div className="desk-reserves"><span>Available bench</span><div>{availableBench.map(player => <button key={player.id} onClick={() => onSelectPlayer(player.id)} title={`${player.name} · ${player.position} · ${Math.round(match.stats[player.id].condition)}% stamina`}>{player.name.split(' ').at(-1)}<small>{Math.round(match.stats[player.id].condition)}%</small></button>)}{!availableBench.length && <span>No eligible reserves</span>}</div></div>
        </section>

        <section className="desk-activity panel" aria-labelledby="desk-activity-heading">
          <div className="desk-panel-heading"><h2 id="desk-activity-heading">Recent activity</h2><span className="desk-section-note">Current match</span></div>
          {activity.length ? <ol>{activity.map(event => <li key={event.id}><time>{period(event.period)}<span>{clock(event.clockSeconds)}</span></time><p>{event.text}</p><span className="desk-activity-score">{event.score.home}–{event.score.away}</span></li>)}</ol> : <p className="desk-empty">No match actions yet. Review your lineup and instructions before tipoff.</p>}
        </section>
      </div>

      <div className="desk-side-column">
        {finances && <section className="desk-finances panel" aria-labelledby="desk-finances-heading">
          <div className="desk-panel-heading"><h2 id="desk-finances-heading">Club finances</h2><button className="text-button" onClick={onOpenClub}>Ledger & tickets<Icon name="chevron" size={15} /></button></div>
          <dl className="desk-finance-values"><div><dt>Cash</dt><dd>{money(finances.cash)}</dd></div><div><dt>Unpaid costs</dt><dd className={finances.unpaid ? 'desk-warning-value' : ''}>{money(finances.unpaid)}</dd></div>{wageReserve !== null && <><div><dt>Future wages</dt><dd><button className="text-button" onClick={onOpenPayroll}>{money(wageReserve)}<Icon name="chevron" size={14} /></button></dd></div><div><dt>Cash after wage reserve</dt><dd>{money(Math.max(0, finances.cash - wageReserve))}</dd></div></>}</dl>
        </section>}
        <section className="desk-attention panel" aria-labelledby="desk-attention-heading">
          <div className="desk-panel-heading"><h2 id="desk-attention-heading">{complete ? 'Match review' : 'Attention'}</h2><span className="desk-count">{notices.length}</span></div>
          {notices.length ? <ul className="desk-notices">{notices.map(notice => <li key={notice.key} className={notice.urgent ? 'desk-notice-urgent' : ''}><div><strong>{notice.title}</strong><p>{notice.detail}</p></div><button className="text-button" onClick={notice.open}>{notice.action}<Icon name="chevron" size={14} /></button></li>)}</ul> : <div className="desk-clear"><Icon name="check" size={18} /><div><strong>{complete ? 'Match complete' : 'No urgent decisions'}</strong><p>{complete ? 'The result and player statistics are ready to review.' : `${eligible.length} eligible players. Your current lineup is available.`}</p></div></div>}
        </section>

        <section className="desk-instructions panel" aria-labelledby="desk-instructions-heading">
          <div className="desk-panel-heading"><h2 id="desk-instructions-heading">Team instructions</h2><button className="text-button" onClick={onOpenCoaching}>Match coaching<Icon name="chevron" size={15} /></button></div>
          <TeamInstructions match={match} managedSide={managedSide} apply={apply} idPrefix="desk-" includeRotation />
        </section>
      </div>
    </div>
  </div>
}
