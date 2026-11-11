import type { MatchState, Side } from '../domain/types'
import { cancelTimeoutRequest, remainingTimeouts, requestTimeout, setAutoSubstitutions } from '../engine/match'
import { Icon } from './Icon'
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

export function MatchCoaching({ match, managedSide = 'home', apply }: { match: MatchState; managedSide?: Side; apply: Apply }) {
  const complete = match.status === 'finished'
  const timeouts = remainingTimeouts(match, managedSide)
  return <section className="coaching-panel coaching-workbench panel" aria-labelledby="coaching-title" tabIndex={-1}>
    <header className="coaching-workbench-heading"><h2 id="coaching-title">Match coaching</h2><span className="coaching-club">{match[managedSide].name}</span></header>
    <div className="coaching-columns">
      <div className="coach-tactics coaching-column"><TeamInstructions match={match} managedSide={managedSide} apply={apply} includeRotation /></div>
      <div className="coach-timeout coaching-column">
        <div className="timeout-allowance"><Icon name="clock" size={23} /><div><strong>{timeouts}</strong><span>timeouts left this {match.period > 4 ? 'overtime' : 'half'}</span></div></div>
        <button className="button full-width" id="match-timeout" disabled={complete || match.status === 'ready' || (!match.timeoutRequested[managedSide] && timeouts === 0)} onClick={() => apply(state => state.timeoutRequested[managedSide] ? cancelTimeoutRequest(state, managedSide) : requestTimeout(state, managedSide))}><Icon name={match.timeoutRequested[managedSide] ? 'close' : 'clock'} size={16} />{match.timeoutRequested[managedSide] ? 'Cancel request' : 'Call timeout'}</button>
        <p className="coach-help" aria-live="polite">{complete ? 'Match finished.' : match.timeoutRequested[managedSide] ? 'Queued for the next opportunity.' : match.status === 'ready' ? 'Available after tipoff.' : 'Next legal stoppage.'}</p>
      </div>
    </div>
  </section>
}
