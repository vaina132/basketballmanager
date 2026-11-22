import { Fragment, useEffect, useRef, useState } from 'react'
import type { ContractRequestReply, PlayerRelationship, PlayingTimePromise, RelationshipTalk, SquadRole } from '../domain/relationships'
import type { SeasonState } from '../domain/season'
import { getPlayerRelationship, getSquadRelationships, quoteRelationshipTalk, quoteSquadRole, squadRoleDefinitions, squadRoles } from '../world/relationships'
import { PLAYING_TIME_RULES, SQUAD_ROLE_RULES } from '../world/relationship-rules'
import { Avatar } from './Avatar'
import { Icon } from './Icon'
import { medicalDate } from './SeasonMedicalReport'
import { ContractRequestCard } from './ContractRequestCard'
import './relationships-panel.css'

interface RelationshipsPanelProps {
  season: SeasonState
  busy?: boolean
  selectedPlayerId: string | null
  onSelectPlayer: (id: string | null) => void
  onEnable: () => void
  onRole: (playerId: string, role: SquadRole) => void
  onTalk: (playerId: string, choice: RelationshipTalk) => void
  /** Format 66: answer a player's contract request. */
  onContractReply?: (playerId: string, reply: ContractRequestReply) => void
}

const minutes = (value: number | null, belowTarget?: number) => value === null ? 'No reviewed games' : belowTarget !== undefined && value >= belowTarget ? `<${belowTarget.toFixed(1)} min / game` : `${value.toFixed(1)} min / game`
const promiseMinutes = (promise: PlayingTimePromise) => minutes(promise.averageMinutes, promise.status === 'broken' ? promise.targetMinutes : undefined)
function historyDetail(row: PlayerRelationship, event: PlayerRelationship['history'][number]) {
  const promise = row.promises.find(promise => `${promise.id}-outcome` === event.id && promise.status === 'broken' && promise.averageMinutes !== null && promise.averageMinutes >= promise.targetMinutes)
  return promise ? `${promiseMinutes(promise)} across ${promise.eligibleGames} eligible games; ${promise.targetMinutes} minutes promised.` : event.detail
}
const signed = (value: number) => `${value > 0 ? '+' : ''}${value}`
const promiseLabels = { active: 'Promise in progress', kept: 'Promise kept', broken: 'Promise broken', unresolved: 'Not enough eligible games', departed: 'Player left the club' }

function MoraleMeter({ row }: { row: PlayerRelationship }) {
  return <div className="relationship-morale" data-morale={row.morale}><div><strong>{row.moraleLabel}</strong><span>{row.morale}<small> / 100</small></span></div><meter min={0} max={100} value={row.morale} aria-label={`${row.player.name} morale: ${row.morale} out of 100, ${row.moraleLabel}`} /></div>
}

function PromiseProgress({ row }: { row: PlayerRelationship }) {
  const promise = row.promise
  if (!promise) return null
  return <div className="relationship-promise" data-relationship-promise={promise.id}>
    <div><Icon name="target" size={18} /><strong>{promiseLabels[promise.status]}</strong></div>
    <span>{promise.targetMinutes} min / game over 3 eligible games</span>
    <progress max={3} value={Math.min(3, promise.eligibleGames)} aria-label={`${promise.eligibleGames} of 3 eligible games reviewed`} />
    <span>{promise.eligibleGames} / 3 eligible games · {promiseMinutes(promise)}</span>
    <small>{promise.remainingClubGames} club games remaining · Deadline {medicalDate(promise.deadlineDate)}</small>
  </div>
}

/** The next smaller role offered by the one-click answer to a calm concern. */
const ONE_STEP_DOWN: Readonly<Record<SquadRole, SquadRole>> = { star: 'starter', starter: 'rotation', rotation: 'development', development: 'development', prospect: 'prospect' }

/**
 * `relationships-4`: a player's calm concern ("would like more minutes") with one-click answers: promise minutes,
 * explain his role, or give him the next smaller role. Each button follows the same rules as the full conversation.
 */
function CalmConcern({ season, row, busy, onRole, onTalk }: Pick<RelationshipsPanelProps, 'season' | 'onRole' | 'onTalk'> & { row: PlayerRelationship; busy: boolean }) {
  const request = row.roleRequest
  if (season.relationships.model !== 'relationships-4' || !request || request.stage === 'leave' || request.answered) return null
  const promise = quoteRelationshipTalk(season, row.player.id, 'minutes-promise'), explain = quoteRelationshipTalk(season, row.player.id, 'explain')
  const lower = ONE_STEP_DOWN[row.role], lowerQuote = lower !== row.role ? quoteSquadRole(season, row.player.id, lower) : null
  const label = squadRoleDefinitions(season.relationships.model)[lower].label
  return <div className="relationship-calm-concern" data-relationship-calm-concern={request.stage} role="group" aria-label={`Answer ${row.player.name}`}>
    <p><Icon name="mail" size={16} /><span><strong>{row.player.name} would like more minutes.</strong> {request.stage === 'talks' ? 'He has asked for talks: his contract role has gone clearly unmet for a long time.' : 'He has played less than his role suggests in recent games.'}</span></p>
    <div className="relationship-talk-actions">
      <button className="button" disabled={busy || !promise.canTalk} title={promise.reason ?? promise.detail} onClick={() => onTalk(row.player.id, 'minutes-promise')} data-relationship-quick="minutes-promise"><Icon name="target" size={16} />Promise minutes</button>
      <button className="button" disabled={busy || !explain.canTalk} title={explain.reason ?? explain.detail} onClick={() => onTalk(row.player.id, 'explain')} data-relationship-quick="explain"><Icon name="people" size={16} />Explain his role</button>
      {lowerQuote && <button className="button" disabled={busy || !lowerQuote.canAgree} title={lowerQuote.reason ?? `${label}: ${lowerQuote.minMinutes}–${lowerQuote.maxMinutes} minutes a game.`} onClick={() => onRole(row.player.id, lower)} data-relationship-quick="role"><Icon name="swap" size={16} />Make him {label}</button>}
    </div>
  </div>
}

function PlayerTalk({ season, row, busy, onClose, onRole, onTalk, onContractReply }: Pick<RelationshipsPanelProps, 'season' | 'onRole' | 'onTalk' | 'onContractReply'> & { row: PlayerRelationship; busy: boolean; onClose: () => void }) {
  const region = useRef<HTMLElement>(null)
  const [choice, setChoice] = useState<RelationshipTalk | 'role' | null>(null)
  const [role, setRole] = useState<SquadRole>(row.role)
  const roleQuote = quoteSquadRole(season, row.player.id, role)
  const talkQuote = choice && choice !== 'role' ? quoteRelationshipTalk(season, row.player.id, choice) : null
  const reasons = row.reasons.filter(reason => reason.impact !== 0)
  useEffect(() => { region.current?.focus({ preventScroll: true }); region.current?.scrollIntoView({ block: 'nearest' }) }, [])
  return <section ref={region} id={`relationship-talk-${row.player.id}`} className="relationship-talk" tabIndex={-1} aria-labelledby={`relationship-talk-title-${row.player.id}`} onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.preventDefault(); onClose() } }}>
    <header><div><Icon name="people" size={18} /><h3 id={`relationship-talk-title-${row.player.id}`}>Talk to {row.player.name}</h3></div><button className="text-button" onClick={onClose} disabled={busy}><Icon name="close" size={15} />Close</button></header>
    <div className="relationship-talk-context"><div><strong>Trust in manager</strong><span data-relationship-trust={row.trust}>{row.trust} / 100</span></div>{reasons.slice(0, 2).map((reason, index) => <span key={`${index}:${reason.label}`}>{reason.label} <b>{signed(reason.impact)}</b></span>)}</div>
    {row.concern && <p className="relationship-concern"><Icon name="people" size={16} />{row.concern}</p>}
    <CalmConcern season={season} row={row} busy={busy} onRole={onRole} onTalk={onTalk} />
    {row.roleRequest && row.roleRequest.stage !== 'concern' && <p className="relationship-concern" data-relationship-role-request={row.roleRequest.stage}><Icon name="mail" size={16} />{row.roleRequest.stage === 'leave' ? `${row.player.name} has asked to leave: morale ${SQUAD_ROLE_RULES.escalation.leaveMorale} until his minutes meet his role again or he is sold.` : `${row.player.name} has asked for talks about his role. Promise minutes, explain the competition or agree a different role.`}</p>}
    {row.contractRequest && row.contractRequest.seasonNumber === season.seasonNumber && onContractReply && <ContractRequestCard season={season} request={row.contractRequest} busy={busy} onReply={onContractReply} headingLevel={4} />}
    <PromiseProgress row={row} />
    <div className="relationship-talk-actions" role="group" aria-label={`Conversation choices for ${row.player.name}`}>
      <button className={`button ${choice === 'explain' ? 'selected' : ''}`} aria-pressed={choice === 'explain'} onClick={() => setChoice('explain')} disabled={busy} data-relationship-choice="explain"><Icon name="people" size={16} />Explain rotation</button>
      <button className={`button ${choice === 'minutes-promise' ? 'selected' : ''}`} aria-pressed={choice === 'minutes-promise'} onClick={() => setChoice('minutes-promise')} disabled={busy} data-relationship-choice="minutes-promise"><Icon name="target" size={16} />Promise more minutes</button>
      <button className={`button ${choice === 'role' ? 'selected' : ''}`} aria-pressed={choice === 'role'} onClick={() => { setRole(row.role); setChoice('role') }} disabled={busy} data-relationship-choice="role"><Icon name="swap" size={16} />Discuss role</button>
    </div>
    {!choice && row.talkReason && <p className="relationship-reason">{row.talkReason}</p>}
    {choice === 'role' && <section className="relationship-review" aria-labelledby="relationship-role-title">
      <header><h4 id="relationship-role-title">Agree a playing-time role</h4><label htmlFor="relationship-role">Role<select id="relationship-role" value={role} onChange={event => setRole(event.target.value as SquadRole)} disabled={busy}>{squadRoles(season.relationships.model).map(value => <option key={value} value={value}>{squadRoleDefinitions(season.relationships.model)[value].label}</option>)}</select></label></header>
      <dl><div><dt>Expected playing time</dt><dd data-relationship-role-range>{roleQuote.minMinutes}–{roleQuote.maxMinutes} min / game</dd></div><div><dt>Applies from</dt><dd>{medicalDate(roleQuote.effectiveFrom)}</dd></div><div><dt>Squad minimum minutes</dt><dd>{roleQuote.totalMinimum} / 200</dd></div><div><dt>Trust change</dt><dd>{signed(roleQuote.trustChange)}</dd></div></dl>
      <p>{season.relationships.model === 'relationships-4' ? `Reviewed over his latest ${PLAYING_TIME_RULES.window.games} games in the matchday squad, once ${PLAYING_TIME_RULES.window.minGames} count. He is unhappy only below about two thirds of the minimum. Injuries, illness and games outside the matchday squad are exempt.` : 'Reviewed over the latest 4 eligible games. A missed minimum can become a concern after 3 games. Injuries and exclusions are exempt.'}</p>
      <footer><span id="relationship-role-reason" role="status">{roleQuote.reason ?? 'Confirm this role with the player.'}</span><button id="relationship-role-confirm" className="button primary" disabled={busy || !roleQuote.canAgree} aria-describedby="relationship-role-reason" onClick={() => { onRole(row.player.id, role); setChoice(null) }}>Agree role<Icon name="check" size={15} /></button></footer>
    </section>}
    {talkQuote && <section className="relationship-review" aria-labelledby="relationship-talk-review-title">
      <header><h4 id="relationship-talk-review-title">{talkQuote.title}</h4></header><p>{talkQuote.detail}</p>
      <dl>{choice === 'minutes-promise' && <><div><dt>Promised playing time</dt><dd data-relationship-promise-target>{talkQuote.targetMinutes} min / game</dd></div><div><dt>Review period</dt><dd>3 eligible games within 6 club games</dd></div><div><dt>Deadline</dt><dd>{medicalDate(talkQuote.deadlineDate)}</dd></div></>}<div><dt>Trust change now</dt><dd>{signed(talkQuote.trustChange)}</dd></div></dl>
      <footer><span id="relationship-talk-reason" role="status">{talkQuote.reason ?? (choice === 'minutes-promise' ? 'Confirm only if you intend to give these minutes.' : 'Explain your current rotation to the player.')}</span><button id="relationship-talk-confirm" className="button primary" disabled={busy || !talkQuote.canTalk} aria-describedby="relationship-talk-reason" onClick={() => { onTalk(row.player.id, talkQuote.choice); setChoice(null) }}>{choice === 'minutes-promise' ? 'Make promise' : 'Explain rotation'}<Icon name="check" size={15} /></button></footer>
    </section>}
    <details className="relationship-history"><summary><Icon name="clock" size={15} />Reasons &amp; conversation history</summary><p>Higher morale slightly reduces ball-handling mistakes in future matches. Your current prepared match keeps its original focus.</p>{reasons.length > 0 && <ul className="relationship-reasons">{reasons.map((reason, index) => <li key={`${index}:${reason.label}`}><span>{reason.label}</span><strong>{signed(reason.impact)}</strong></li>)}</ul>}{row.history.length > 0 ? <ol>{row.history.map(event => <li key={event.id}><time dateTime={event.date}>{medicalDate(event.date)}</time><div><strong>{event.label}</strong><p>{historyDetail(row, event)}</p></div></li>)}</ol> : <p>No conversations recorded yet.</p>}{[...row.promises].reverse().filter(promise => promise.status !== 'active').map(promise => <div className="relationship-past-promise" key={promise.id}><strong>{promiseLabels[promise.status]}</strong><span>{promise.targetMinutes} min target · {minutes(promise.averageMinutes)} · {promise.eligibleGames} eligible games</span>{promise.outcomeDate && <time dateTime={promise.outcomeDate}>{medicalDate(promise.outcomeDate)}</time>}</div>)}</details>
  </section>
}

export function RelationshipsPanel({ season, busy = false, selectedPlayerId, onSelectPlayer, onEnable, onRole, onTalk, onContractReply }: RelationshipsPanelProps) {
  const enabled = season.relationships.enabledSince !== null
  const rows = enabled ? getSquadRelationships(season) : []
  const club = season.clubs.find(club => club.id === season.managedClubId)!
  const concerns = rows.filter(row => row.concern).length
  const committedMinutes = rows.reduce((sum, row) => sum + row.minMinutes, 0)
  const average = rows.length ? Math.round(rows.reduce((sum, row) => sum + row.morale, 0) / rows.length) : null
  function close(id: string) { onSelectPlayer(null); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-relationship-talk="${CSS.escape(id)}"]`)?.focus({ preventScroll: true })) }
  return <section className="relationships-panel panel" aria-labelledby="relationships-title">
    <header className="relationships-heading"><h2 id="relationships-title"><Icon name="people" size={18} />Squad dynamics</h2>{enabled && <div><span>Morale <strong>{average} / 100</strong></span><span title="Minimum playing time agreed across this squad. A regulation game has 200 player minutes.">Role commitments <strong data-relationship-minutes={committedMinutes}>{committedMinutes} / 200 min</strong></span><span>{concerns} playing-time {concerns === 1 ? 'concern' : 'concerns'}</span></div>}</header>
    {!enabled ? <div className="relationships-enable"><Icon name="people" size={26} /><div><strong>Manage roles and player conversations</strong><p>Agree playing-time expectations and review morale from actual matches and promises.</p></div><button id="enable-relationships" className="button" onClick={onEnable} disabled={busy}>Enable squad dynamics</button></div> : <>
      {committedMinutes > 200 && <p className="relationship-overcommitted" role="status"><Icon name="people" size={17} />Your squad roles require {committedMinutes - 200} more minutes than a regulation game allows. Discuss a lower role with a player.</p>}
      <div className="relationship-columns" aria-hidden="true"><span>Player</span><span>Agreed role</span><span>Morale</span><span>Playing time &amp; concerns</span><span /></div>
      <div className="relationship-rows">{rows.map(row => <Fragment key={row.player.id}><div className={`relationship-row ${selectedPlayerId === row.player.id ? 'selected' : ''}`} data-relationship-player={row.player.id}>
        <div className="relationship-player"><Avatar player={row.player} color={club.color} size={38} /><div><strong>{row.player.name}</strong><span>#{row.player.number} · {row.player.position}</span></div></div>
        <div className="relationship-role"><strong data-relationship-role={row.role}>{row.roleLabel}</strong><span>{row.minMinutes}–{row.maxMinutes} min / game</span>{row.squadRank != null && <small data-relationship-rank={row.squadRank} title={row.roleSource ? 'No role agreed: the default follows his rank in the registered squad by overall rating (two Stars, three Starters, Rotation to ninth, then Reserve; under-21s outside the top eight are Prospects).' : 'No role agreed: the default follows his rank in the registered squad by overall rating (top nine Rotation, the rest Reserve).'}>Default · squad rank {row.squadRank}</small>}{row.roleSource === 'contract' && <small data-relationship-role-source="contract">Contract term</small>}{row.roleSource === 'adjusted' && <small data-relationship-role-source="adjusted" title="He accepted this role quietly because it fits his recent minutes.">Adjusted to his minutes</small>}{row.contractRole && row.roleSource !== 'contract' && row.contractRole !== row.role && <small data-relationship-contract-role={row.contractRole}>Contract: {squadRoleDefinitions(season.relationships.model)[row.contractRole].label}</small>}</div>
        <MoraleMeter row={row} />
        <div className="relationship-situation"><strong data-relationship-average>{minutes(row.averageMinutes, row.concern ? row.minMinutes : undefined)}</strong><span>{row.eligibleGames} eligible {row.eligibleGames === 1 ? 'game' : 'games'} reviewed</span>{row.promise ? <small><Icon name="target" size={13} />{promiseLabels[row.promise.status]}</small> : row.concern ? <small><Icon name="people" size={13} />Playing-time concern</small> : null}{row.contractRequest?.status === 'open' && <small data-relationship-contract-request><Icon name="mail" size={13} />Asks about a new contract</small>}{row.roleRequest && <small data-relationship-role-request={row.roleRequest.stage}><Icon name="mail" size={13} />{row.roleRequest.stage === 'leave' ? 'Asked to leave' : row.roleRequest.stage === 'concern' ? 'Would like more minutes' : 'Asks for talks about his role'}</small>}</div>
        <button className="button small relationship-talk-button" data-relationship-talk={row.player.id} onClick={() => selectedPlayerId === row.player.id ? close(row.player.id) : onSelectPlayer(row.player.id)} disabled={busy} aria-expanded={selectedPlayerId === row.player.id} aria-controls={`relationship-talk-${row.player.id}`} aria-label={`Talk to ${row.player.name}`}>Talk<Icon name="chevron" size={14} /></button>
      </div>{selectedPlayerId === row.player.id && <PlayerTalk key={`talk-${row.player.id}`} season={season} row={row} busy={busy} onClose={() => close(row.player.id)} onRole={onRole} onTalk={onTalk} onContractReply={onContractReply} />}</Fragment>)}</div>
      <details className="relationship-rules"><summary>How playing time is reviewed</summary><p>Roles are assessed from committed match results. Injured, excluded and unregistered games do not count toward eligible playing time. Conversations and role changes apply prospectively; repeating them cannot continually raise morale.</p>{season.relationships.model === 'relationships-2' && <p>Without an agreed role, a player's expectation follows his rank in the registered squad by overall rating, recorded at each registration: the top nine expect Rotation minutes, the rest Reserve. From the middle of the season, valued players in the final year of their contract ask about a new one.</p>}{season.relationships.model === 'relationships-3' && <p>Without an agreed role, a player's expectation follows his rank in the registered squad by overall rating: the best two are Stars, the next three Starters, the rest of the top nine Rotation and the others Reserve; players under 21 outside the top eight are Prospects. A role agreed in a contract applies from its first day. A player who stays below his role for {SQUAD_ROLE_RULES.escalation.talksAfterGames} eligible games asks for talks; {SQUAD_ROLE_RULES.escalation.leaveAfterRounds} club games later, without a running promise, he asks to leave. From the middle of the season, valued players in the final year of their contract ask about a new one.</p>}{season.relationships.model === 'relationships-4' && <p>Without an agreed role, a player's expectation starts from his rank in the registered squad by overall rating: the best two are Stars, the next three Starters, the rest of the top nine Rotation and the others Reserve; players under 21 outside the top eight are Prospects. Minutes are judged over his last {PLAYING_TIME_RULES.window.games} games in the matchday squad this season, once {PLAYING_TIME_RULES.window.minGames} count; he is short only below about two thirds of his role's minimum. A player whose role is a default, or a contract role below Starter, quietly accepts the role his minutes fit. Others say once that they would like more minutes. Only a Star or Starter by contract, clearly short for a long time, asks for talks and later to leave. Reserves and Prospects never complain. From the middle of the season, valued players in the final year of their contract ask about a new one.</p>}<p>Morale affects focus in future matches. Condition, ability and match performance remain separate.</p></details>
    </>}
  </section>
}

export function PlayerRelationshipSummary({ season, playerId, onOpen }: { season: SeasonState; playerId: string; onOpen: () => void }) {
  if (!season.relationships.enabledSince || !season.clubs.find(club => club.id === season.managedClubId)?.players.some(player => player.id === playerId)) return null
  const row = getPlayerRelationship(season, playerId)
  return <div className="player-relationship-summary"><span><strong>{row.roleLabel}</strong><small>{row.moraleLabel} · Morale {row.morale} / 100</small></span><button className="text-button" onClick={onOpen}>Talk<Icon name="chevron" size={14} /></button></div>
}
