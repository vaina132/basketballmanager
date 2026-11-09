import { useState } from 'react'
import type { InjuryMode, MatchState, Side } from '../domain/types'
import {
  canSubstituteNow, cancelSubstitution, cancelTimeoutRequest, isPlayerEligible,
  remainingTimeouts, requestTimeout, setAutoSubstitutions, setInjuryMode,
  substitutePlayer,
} from '../engine/match'
import { Icon } from './Icon'
import { ShotCreation } from './ShotCreation'
import { TeamInstructions } from './TeamInstructions'
import './match-coaching.css'

type Apply = (action: (state: MatchState) => MatchState) => void

export function RequiredDecision({ match, managedSide = 'home', apply }: { match: MatchState; managedSide?: Side; apply: Apply }) {
  if (!match.requiredSubstitutions.length || match.status === 'finished') return null
  const names = match.requiredSubstitutions.map(item => {
    const player = match[item.side].players.find(p => p.id === item.playerId)
    return `${player?.name ?? item.playerId} (${item.reason === 'fouled-out' ? 'five fouls' : 'injury'})`
  })
  return <section className="decision-banner" role="alert">
    <Icon name="swap" size={24} />
    <div><strong>Replacement needed</strong><p>{names.join('; ')}. Select a reserve below.</p></div>
    <div className="decision-actions">
      {match.requiredSubstitutions.some(item => item.side === managedSide) && <a href="#match-rotation">Choose replacement</a>}
      <button className="button" onClick={() => apply(state => [...new Set(state.requiredSubstitutions.map(item => item.side))].reduce((next, side) => setAutoSubstitutions(next, side, true), state))}><Icon name="staff" size={16} />Ask assistant</button>
    </div>
  </section>
}

export function MatchCoaching({ match, analysisMatch = match, managedSide = 'home', lockInjuries = false, apply }: { match: MatchState; analysisMatch?: MatchState; managedSide?: Side; lockInjuries?: boolean; apply: Apply }) {
  const [outgoing, setOutgoing] = useState('')
  const [incoming, setIncoming] = useState('')
  const complete = match.status === 'finished'
  const active = match[managedSide].players.filter(player => match.lineups[managedSide].includes(player.id))
  const bench = match[managedSide].players.filter(player => !match.lineups[managedSide].includes(player.id) && isPlayerEligible(match, player.id) && !match.substitutionLocks.includes(player.id))
  const required = match.requiredSubstitutions.find(item => item.side === managedSide)
  const outId = required?.playerId ?? (active.some(player => player.id === outgoing) ? outgoing : active[0]?.id ?? '')
  const inId = bench.some(player => player.id === incoming) ? incoming : bench[0]?.id ?? ''
  const immediate = canSubstituteNow(match, managedSide, outId)
  const timeouts = remainingTimeouts(match, managedSide)
  const playerName = (id: string) => match[managedSide].players.find(player => player.id === id)?.name ?? id

  return <section className="coaching-panel coaching-workbench panel" aria-labelledby="coaching-title" tabIndex={-1}>
    <header className="coaching-workbench-heading">
      <h2 id="coaching-title">Match coaching</h2>
      <span className="coaching-club"><Icon name="settings" size={16} />{match[managedSide].name}</span>
    </header>
    <div className="coaching-columns">
      <div className="coach-tactics coaching-column">
        <div className="section-heading"><h3><Icon name="court" size={16} />Game plan</h3></div>
        <TeamInstructions match={match} managedSide={managedSide} apply={apply} includeRotation />
      </div>
      <details className="coach-rotation coaching-column coaching-manual-pickers">
        <summary><Icon name="swap" size={16} />Choose players by name</summary>
        <div className="coaching-picker-body">
        <label className="field-label" htmlFor="player-out">COMING OFF</label>
        <select id="player-out" value={outId} onChange={event => setOutgoing(event.target.value)} disabled={complete || !!required}>
          {active.map(player => <option key={player.id} value={player.id}>#{player.number} {player.name} · {match.stats[player.id].fouls} fouls · {Math.round(match.stats[player.id].condition)}% stamina</option>)}
        </select>
        <label className="field-label" htmlFor="player-in">COMING ON</label>
        <select id="player-in" value={inId} onChange={event => setIncoming(event.target.value)} disabled={complete || !bench.length}>
          {!bench.length && <option value="">No eligible replacement</option>}
          {bench.map(player => <option key={player.id} value={player.id}>#{player.number} {player.name} · {player.position} · {Math.round(match.stats[player.id].condition)}% stamina</option>)}
        </select>
        <button className="button full-width" disabled={complete || !outId || !inId} onClick={() => apply(state => substitutePlayer(state, managedSide, outId, inId))}><Icon name="swap" size={16} />{immediate ? 'Make substitution' : 'Queue substitution'}</button>
        <p className="coach-help">{immediate ? 'A substitution opportunity is open.' : 'Your change will happen at the next legal stoppage.'}</p>
        {match.pendingSubstitutions[managedSide].length > 0 && <div className="queued-changes" aria-live="polite"><strong>Queued changes</strong>{match.pendingSubstitutions[managedSide].map(request => <div key={request.outId}><span>{playerName(request.outId)} → {playerName(request.inId)}</span><button className="text-button" aria-label={`Cancel substitution for ${playerName(request.outId)}`} onClick={() => apply(state => cancelSubstitution(state, managedSide, request.outId))}>Cancel</button></div>)}</div>}
        </div>
      </details>
      <div className="coach-timeout coaching-column">
        <div className="section-heading"><h3><Icon name="clock" size={16} />Timeout</h3></div>
        <div className="timeout-allowance"><Icon name="clock" size={25} /><div><strong>{timeouts}</strong><span>remaining this {match.period > 4 ? 'overtime' : 'half'}</span></div></div>
        <button className="button full-width" disabled={complete || match.status === 'ready' || (!match.timeoutRequested[managedSide] && timeouts === 0)} onClick={() => apply(state => state.timeoutRequested[managedSide] ? cancelTimeoutRequest(state, managedSide) : requestTimeout(state, managedSide))}><Icon name={match.timeoutRequested[managedSide] ? 'close' : 'clock'} size={17} />{match.timeoutRequested[managedSide] ? 'Cancel request' : 'Call timeout'}</button>
        <p className="coach-help" aria-live="polite">{match.timeoutRequested[managedSide] ? 'Queued for the next opportunity.' : match.status === 'ready' ? 'Available after tipoff.' : 'Stops play at the next legal opportunity.'}</p>
      </div>
    </div>
    <details className="coaching-extra"><summary><Icon name="target" size={16} />Match analysis & settings</summary><ShotCreation match={analysisMatch} managedSide={managedSide} /><MatchPolicies match={match} lockInjuries={lockInjuries} apply={apply} /></details>
  </section>
}

function MatchPolicies({ match, lockInjuries, apply }: { match: MatchState; lockInjuries: boolean; apply: Apply }) {
  return <div className="match-policies coaching-settings" aria-label="Match injury settings">
    <div><label className="field-label" htmlFor="injury-setting">INJURIES</label><select id="injury-setting" value={match.injuryMode} disabled={lockInjuries || match.status !== 'ready'} onChange={event => apply(state => setInjuryMode(state, event.target.value as InjuryMode))}><option value="standard">Standard</option><option value="reduced">Reduced</option><option value="off">Off</option></select><p className="coach-help">{lockInjuries ? 'Season setting. Applies to every club.' : 'Applies to both teams. Choose before tipoff.'}</p></div>
  </div>
}
