import { useState } from 'react'
import type { InjuryMode, MatchState, Tactics } from '../domain/types'
import {
  canSubstituteNow, cancelSubstitution, cancelTimeoutRequest, isPlayerEligible,
  remainingTimeouts, requestTimeout, setAutoSubstitutions, setInjuryMode,
  setTactics, substitutePlayer,
} from '../engine/match'
import { Icon } from './Icon'
import { ShotCreation } from './ShotCreation'
import './match-coaching.css'

type Apply = (action: (state: MatchState) => MatchState) => void

export function RequiredDecision({ match, apply }: { match: MatchState; apply: Apply }) {
  if (!match.requiredSubstitutions.length || match.status === 'finished') return null
  const names = match.requiredSubstitutions.map(item => {
    const player = match[item.side].players.find(p => p.id === item.playerId)
    return `${player?.name ?? item.playerId} (${item.reason === 'fouled-out' ? 'five fouls' : 'injury'})`
  })
  return <section className="decision-banner" role="alert">
    <Icon name="swap" size={24} />
    <div><strong>Replacement needed — match paused</strong><p>{names.join('; ')}. Choose a replacement below, or let your assistant make the change.</p></div>
    <div className="decision-actions">
      {match.requiredSubstitutions.some(item => item.side === 'home') && <a href="#player-in">Choose replacement</a>}
      <button className="button" onClick={() => apply(state => [...new Set(state.requiredSubstitutions.map(item => item.side))].reduce((next, side) => setAutoSubstitutions(next, side, true), state))}>Enable assistant substitutions</button>
    </div>
  </section>
}

export function MatchCoaching({ match, analysisMatch = match, apply }: { match: MatchState; analysisMatch?: MatchState; apply: Apply }) {
  const [outgoing, setOutgoing] = useState('')
  const [incoming, setIncoming] = useState('')
  const complete = match.status === 'finished'
  const active = match.home.players.filter(player => match.lineups.home.includes(player.id))
  const bench = match.home.players.filter(player => !match.lineups.home.includes(player.id) && isPlayerEligible(match, player.id) && !match.substitutionLocks.includes(player.id))
  const required = match.requiredSubstitutions.find(item => item.side === 'home')
  const outId = required?.playerId ?? (active.some(player => player.id === outgoing) ? outgoing : active[0]?.id ?? '')
  const inId = bench.some(player => player.id === incoming) ? incoming : bench[0]?.id ?? ''
  const immediate = canSubstituteNow(match, 'home', outId)
  const timeouts = remainingTimeouts(match, 'home')
  const playerName = (id: string) => match.home.players.find(player => player.id === id)?.name ?? id
  function change(key: keyof Tactics, value: number) { apply(state => setTactics(state, 'home', { [key]: value })) }

  return <section className="coaching-panel coaching-workbench panel" aria-labelledby="coaching-title" tabIndex={-1}>
    <header className="coaching-workbench-heading">
      <h2 id="coaching-title">Match coaching</h2>
      <span className="coaching-club"><Icon name="settings" size={16} />{match.home.name}</span>
    </header>
    <div className="coaching-columns">
      <div className="coach-tactics coaching-column">
        <div className="section-heading"><h3>Game plan</h3><span className="coaching-section-number">01</span></div>
        <Tactic label="Tempo" value={match.tactics.home.tempo} onChange={value => change('tempo', value)} low="Patient" high="Fast" disabled={complete} />
        <Tactic label="Outside emphasis" value={match.tactics.home.outsideShare} onChange={value => change('outsideShare', value)} low="Inside" high="Perimeter" disabled={complete} percentage />
        <Tactic label="Defensive pressure" value={match.tactics.home.pressure} onChange={value => change('pressure', value)} low="Contain" high="Aggressive" disabled={complete} />
        <p className="coach-help">Your instructions apply to the next play.</p>
      </div>
      <div className="coach-rotation coaching-column">
        <div className="section-heading"><h3>{required ? 'Required replacement' : 'Substitutions'}</h3><span className="coaching-section-number">02</span></div>
        <label className="field-label" htmlFor="player-out">COMING OFF</label>
        <select id="player-out" value={outId} onChange={event => setOutgoing(event.target.value)} disabled={complete || !!required}>
          {active.map(player => <option key={player.id} value={player.id}>#{player.number} {player.name} · {match.stats[player.id].fouls} fouls · {Math.round(match.stats[player.id].condition)}% stamina</option>)}
        </select>
        <label className="field-label" htmlFor="player-in">COMING ON</label>
        <select id="player-in" value={inId} onChange={event => setIncoming(event.target.value)} disabled={complete || !bench.length}>
          {!bench.length && <option value="">No eligible replacement</option>}
          {bench.map(player => <option key={player.id} value={player.id}>#{player.number} {player.name} · {player.position} · {Math.round(match.stats[player.id].condition)}% stamina</option>)}
        </select>
        <button className="button full-width" disabled={complete || !outId || !inId} onClick={() => apply(state => substitutePlayer(state, 'home', outId, inId))}><Icon name="swap" size={16} />{immediate ? 'Make substitution' : 'Queue substitution'}</button>
        <p className="coach-help">{immediate ? 'A substitution opportunity is open.' : 'Your change will happen at the next legal stoppage.'}</p>
        {match.pendingSubstitutions.home.length > 0 && <div className="queued-changes" aria-live="polite"><strong>Queued changes</strong>{match.pendingSubstitutions.home.map(request => <div key={request.outId}><span>{playerName(request.outId)} → {playerName(request.inId)}</span><button className="text-button" aria-label={`Cancel substitution for ${playerName(request.outId)}`} onClick={() => apply(state => cancelSubstitution(state, 'home', request.outId))}>Cancel</button></div>)}</div>}
      </div>
      <div className="coach-timeout coaching-column">
        <div className="section-heading"><h3>Timeout</h3><span className="coaching-section-number">03</span></div>
        <div className="timeout-allowance"><Icon name="clock" size={25} /><div><strong>{timeouts}</strong><span>remaining this {match.period > 4 ? 'overtime' : 'half'}</span></div></div>
        <button className="button full-width" disabled={complete || match.status === 'ready' || (!match.timeoutRequested.home && timeouts === 0)} onClick={() => apply(state => state.timeoutRequested.home ? cancelTimeoutRequest(state, 'home') : requestTimeout(state, 'home'))}>{match.timeoutRequested.home ? 'Cancel timeout request' : 'Request timeout'}</button>
        <p className="coach-help" aria-live="polite">{match.timeoutRequested.home ? 'Requested. Waiting for the next timeout opportunity.' : match.status === 'ready' ? 'Available after tipoff.' : 'Call the team together at the next timeout opportunity.'}</p>
      </div>
    </div>
    <ShotCreation match={analysisMatch} />
    <MatchPolicies match={match} apply={apply} />
  </section>
}

function MatchPolicies({ match, apply }: { match: MatchState; apply: Apply }) {
  return <div className="match-policies coach-assistant coaching-settings" aria-label="Match assistance and injury settings">
    <div><label className="check-label"><input type="checkbox" checked={match.autoSubstitutions.home} onChange={event => apply(state => setAutoSubstitutions(state, 'home', event.target.checked))} disabled={match.status === 'finished'} /><span>Assistant substitutions</span></label><p className="coach-help">Let your assistant manage tired players and required replacements.</p></div>
    <div><label className="field-label" htmlFor="injury-setting">INJURIES</label><select id="injury-setting" value={match.injuryMode} disabled={match.status !== 'ready'} onChange={event => apply(state => setInjuryMode(state, event.target.value as InjuryMode))}><option value="standard">Standard</option><option value="reduced">Reduced</option><option value="off">Off</option></select><p className="coach-help">Applies to both teams. Choose before tipoff.</p></div>
  </div>
}

function Tactic({ label, value, onChange, low, high, disabled, percentage }: { label: string; value: number; onChange: (value: number) => void; low: string; high: string; disabled: boolean; percentage?: boolean }) {
  const id = label.toLowerCase().replaceAll(' ', '-')
  return <div className="tactic"><div className="tactic-heading"><label htmlFor={id}>{label}</label><span>{percentage ? `${Math.round(value * 100)}%` : value < .34 ? low : value > .66 ? high : 'Balanced'}</span></div><input id={id} type="range" min="0" max="100" step="5" value={Math.round(value * 100)} onChange={event => onChange(Number(event.target.value) / 100)} disabled={disabled} /><div className="range-labels"><span>{low}</span><span>{high}</span></div></div>
}
