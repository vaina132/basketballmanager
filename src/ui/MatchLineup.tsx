import { useEffect, useId, useRef, useState } from 'react'
import type { DragEvent, RefObject } from 'react'
import type { MatchState, Player, Side } from '../domain/types'
import type { PlayerKnowledge } from '../domain/scouting'
import { cancelSubstitution, isPlayerEligible, substitutePlayer } from '../engine/match'
import { Avatar } from './Avatar'
import { Icon } from './Icon'
import { StaminaMeter } from './StaminaMeter'
import { PlayerRating, MatchRating } from './PlayerRating'
import './match-lineup.css'

type Apply = (action: (state: MatchState) => MatchState) => void
const PLAYER_DRAG_TYPE = 'application/x-courtside-player'

interface MatchLineupProps {
  match: MatchState
  displayMatch?: MatchState
  managedSide?: Side
  disabled?: boolean
  apply: Apply
  onInteractionStart: () => void
  knowledgeForPlayer?: (id: string) => PlayerKnowledge
}

interface LineupPlayerProps {
  player: Player
  match: MatchState
  side: Side
  active: boolean
  selectable: boolean
  selected: boolean
  target: boolean
  dragOver: boolean
  pending: string | null
  onSelect: (keyboard: boolean) => void
  onDragStart?: (event: DragEvent<HTMLElement>) => void
  onDragEnd?: () => void
  onDragOver?: (event: DragEvent<HTMLElement>) => void
  onDragLeave?: (event: DragEvent<HTMLElement>) => void
  onDrop?: (event: DragEvent<HTMLElement>) => void
  incomingName?: string
  knowledge?: PlayerKnowledge
}

function LineupPlayer({ player, match, side, active, selectable, selected, target, dragOver, pending, onSelect, onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop, incomingName, knowledge }: LineupPlayerProps) {
  const stats = match.stats[player.id]
  const unavailable = match.injuries[player.id] ? 'Injured' : stats.fouls >= 5 ? 'Fouled out' : null
  const identity = <><span aria-hidden="true"><Avatar player={player} color={match[side].color} size={34} /></span><span className="lineup-player-identity"><strong>{player.name}</strong><span>#{player.number} <i /> {player.position}<span className={stats.fouls >= 4 ? 'lineup-foul-trouble' : ''}> {stats.fouls} {stats.fouls === 1 ? 'foul' : 'fouls'}</span></span></span></>

  return <article className={`lineup-player${unavailable ? ' lineup-player-unavailable' : ''}${selected ? ' lineup-player-selected' : ''}${target ? ' lineup-player-target' : ''}${dragOver ? ' lineup-player-drop' : ''}`} data-player-id={player.id} data-roster-status={unavailable ?? (active ? 'active' : 'bench')} tabIndex={-1} aria-label={`${player.name}, ${unavailable ?? (active ? 'on court' : 'bench')}`} draggable={!active && selectable} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
    {selectable || target ? <button className="lineup-player-heading lineup-player-pick" type="button" data-sub-in={!active ? player.id : undefined} data-sub-out={active ? player.id : undefined} aria-pressed={!active ? selected : undefined} aria-label={active ? `Replace ${player.name} with ${incomingName}` : `${selected ? 'Deselect' : 'Select'} ${player.name} for substitution, ${Math.round(stats.condition)}% stamina`} onClick={event => onSelect(event.detail === 0)}>{identity}</button> : <div className="lineup-player-heading">{identity}</div>}
    <div className="lineup-player-ratings"><div><span>Ability</span><PlayerRating attributes={player.attributes} position={player.position} knowledge={knowledge} compact label={`${player.name} ability`} /></div><div className="lineup-match-rating"><span>Match</span><MatchRating stats={stats} compact /></div></div>
    <StaminaMeter value={stats.condition} label={`${player.name} stamina`} />
    {unavailable && <span className="lineup-unavailable-label">{unavailable}</span>}
    {pending && <span className="lineup-pending-label">{pending}</span>}
    {selected && <span className="lineup-selection-label">Selected · choose who comes off</span>}
    {target && <span className="lineup-drop-label">Drop or select to replace</span>}
  </article>
}

/** Selection is presentation state; the shared engine owns every queued or legal substitution. */
export function MatchLineup({ match, displayMatch = match, managedSide = 'home', disabled = false, apply, onInteractionStart, knowledgeForPlayer }: MatchLineupProps) {
  const [showOpponent, setShowOpponent] = useState(false)
  const [benchOpen, setBenchOpen] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dropId, setDropId] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [focusTargets, setFocusTargets] = useState(false)
  const status = useRef<HTMLParagraphElement>(null)
  const container = useRef<HTMLElement>(null)
  const benchId = useId(), helpId = useId()
  const side: Side = showOpponent ? managedSide === 'home' ? 'away' : 'home' : managedSide
  const own = side === managedSide
  const complete = match.status === 'finished'
  const currentTeam = match[managedSide]
  const usableBench = currentTeam.players.filter(player => !match.lineups[managedSide].includes(player.id) && isPlayerEligible(match, player.id) && !match.pendingSubstitutions[managedSide].some(request => request.inId === player.id))
  const selected = !disabled && !complete && own ? usableBench.find(player => player.id === selectedId) ?? null : null
  const shownMatch = selected || draggedId ? match : displayMatch
  const team = shownMatch[side]
  const active = shownMatch.lineups[side].flatMap(id => team.players.filter(player => player.id === id))
  const bench = team.players.filter(player => !shownMatch.lineups[side].includes(player.id))
  const identity = `${match.seed}:${match.home.id}:${match.away.id}`
  const playerName = (id: string) => currentTeam.players.find(player => player.id === id)?.name ?? id

  useEffect(() => {
    setSelectedId(null); setDraggedId(null); setDropId(null); setAnnouncement('')
  }, [identity])

  useEffect(() => {
    if (selectedId && !selected) { setSelectedId(null); setDraggedId(null); setDropId(null) }
  }, [selectedId, selected])

  useEffect(() => {
    if (!focusTargets || !selected) return
    const required = match.requiredSubstitutions.find(request => request.side === managedSide)
    const targets = container.current?.querySelectorAll<HTMLButtonElement>('[data-sub-out]')
    const target = Array.from(targets ?? []).find(button => button.dataset.subOut === required?.playerId) ?? targets?.[0]
    target?.focus({ preventScroll: true })
    setFocusTargets(false)
  }, [focusTargets, selected, managedSide, match.requiredSubstitutions])

  function chooseIncoming(playerId: string, keyboard = false) {
    if (disabled || complete || !own) return
    onInteractionStart()
    if (!usableBench.some(player => player.id === playerId)) { setAnnouncement('The lineup changed. Choose an eligible player from the current bench.'); return }
    setSelectedId(previous => previous === playerId ? null : playerId)
    setFocusTargets(keyboard)
    setAnnouncement('')
  }

  function makeChange(outId: string, inId: string) {
    if (disabled || complete || !own) return
    onInteractionStart()
    const applied: { state: MatchState | null } = { state: null }
    apply(current => {
      const next = substitutePlayer(current, managedSide, outId, inId)
      applied.state = next
      return next
    })
    setDraggedId(null); setDropId(null)
    if (!applied.state) return
    const queued = applied.state.pendingSubstitutions[managedSide].some(request => request.inId === inId && request.outId === outId)
    setSelectedId(null)
    setAnnouncement(queued ? `${playerName(inId)} is queued for ${playerName(outId)} at the next legal stoppage.` : `${playerName(inId)} replaces ${playerName(outId)}.`)
    requestAnimationFrame(() => status.current?.focus({ preventScroll: true }))
  }

  function beginDrag(event: DragEvent<HTMLElement>, playerId: string) {
    if (disabled || complete || !own || !usableBench.some(player => player.id === playerId)) { event.preventDefault(); return }
    onInteractionStart()
    setSelectedId(playerId); setDraggedId(playerId); setAnnouncement('')
    event.dataTransfer.setData(PLAYER_DRAG_TYPE, JSON.stringify({ playerId, identity, side: managedSide }))
    event.dataTransfer.effectAllowed = 'move'
  }

  function dropPlayer(event: DragEvent<HTMLElement>, outId: string) {
    if (disabled || complete || !own) return
    event.preventDefault()
    try {
      const data: unknown = JSON.parse(event.dataTransfer.getData(PLAYER_DRAG_TYPE))
      if (!data || typeof data !== 'object' || !('playerId' in data) || !('identity' in data) || !('side' in data) || typeof data.playerId !== 'string' || data.identity !== identity || data.side !== managedSide || !usableBench.some(player => player.id === data.playerId)) return
      makeChange(outId, data.playerId)
    } catch { setAnnouncement('Choose a bench player from this match to make a substitution.') }
    finally { setDraggedId(null); setDropId(null) }
  }

  function cancelChange(outId: string) {
    if (disabled || complete) return
    onInteractionStart()
    let applied = false
    apply(current => {
      const next = cancelSubstitution(current, managedSide, outId)
      applied = true
      return next
    })
    if (!applied) return
    setAnnouncement(`Substitution for ${playerName(outId)} cancelled.`)
    requestAnimationFrame(() => status.current?.focus({ preventScroll: true }))
  }

  function clearSelection() {
    setSelectedId(null); setDraggedId(null); setDropId(null); setFocusTargets(false)
    setAnnouncement('Substitution selection cleared.')
    requestAnimationFrame(() => status.current?.focus({ preventScroll: true }))
  }

  return <section ref={container} id="match-rotation" className="match-lineup" tabIndex={-1} aria-label="Players, ratings and substitutions" onKeyDown={event => { if (event.key === 'Escape' && selectedId) { event.preventDefault(); clearSelection() } }}>
    <div className="lineup-toolbar">
      <div className="lineup-title"><span className="lineup-live-dot" /><h3>On the floor</h3><span>Ratings &amp; stamina</span></div>
      <div className="lineup-team-switch" role="group" aria-label="Lineup team">{(['home', 'away'] as const).map(value => <button key={value} type="button" onClick={() => { setShowOpponent(value !== managedSide); setSelectedId(null); setDraggedId(null); setDropId(null) }} aria-pressed={side === value} className={side === value ? 'selected' : ''}><span style={{ backgroundColor: match[value].color }} />{match[value].shortName}<small>{value === managedSide ? 'Your team' : 'Opponent'}</small></button>)}</div>
      <button className="lineup-bench-toggle" type="button" aria-expanded={benchOpen} aria-controls={benchId} onClick={() => setBenchOpen(value => !value)}>{benchOpen ? 'Hide bench' : 'Show bench'} <span>{bench.length}</span><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
    </div>
    {own && <MatchRotationControls match={match} side={managedSide} selected={selected} helpId={helpId} statusRef={status} announcement={announcement} disabled={disabled} onClear={clearSelection} onCancel={cancelChange} />}
    <div className="lineup-grid" aria-label={`${team.name} on court`} aria-describedby={own ? helpId : undefined}>{active.map(player => {
      const pending = match.pendingSubstitutions[side].find(request => request.outId === player.id)
      const target = !!selected && match.lineups[managedSide].includes(player.id)
      return <LineupPlayer key={player.id} player={player} knowledge={knowledgeForPlayer?.(player.id)} match={shownMatch} side={side} active selectable={false} selected={false} target={target} dragOver={dropId === player.id} pending={pending ? `Queued off · ${match[side].players.find(member => member.id === pending.inId)!.name} coming on` : null} incomingName={selected?.name} onSelect={() => { if (selected) makeChange(player.id, selected.id) }} onDragOver={event => { if (own && !disabled && !complete && draggedId && match.lineups[managedSide].includes(player.id)) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropId(player.id) } }} onDragLeave={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDropId(null) }} onDrop={event => dropPlayer(event, player.id)} />
    })}</div>
    {active.length === 0 && <p className="lineup-empty">No players on court.</p>}
    <div id={benchId} className="lineup-bench" hidden={!benchOpen}>
      <div className="lineup-bench-heading"><h3>On the bench</h3><span>Stamina recovers while resting</span></div>
      {bench.length ? <div className="lineup-grid" aria-label={`${team.name} bench`}>{bench.map(player => {
        const pending = match.pendingSubstitutions[side].find(request => request.inId === player.id)
        const selectable = own && !disabled && !complete && usableBench.some(member => member.id === player.id)
        return <LineupPlayer key={player.id} player={player} knowledge={knowledgeForPlayer?.(player.id)} match={shownMatch} side={side} active={false} selectable={selectable} selected={selected?.id === player.id} target={false} dragOver={false} pending={pending ? `Queued on · replacing ${match[side].players.find(member => member.id === pending.outId)!.name}` : null} onSelect={keyboard => chooseIncoming(player.id, keyboard)} onDragStart={event => beginDrag(event, player.id)} onDragEnd={() => { setDraggedId(null); setDropId(null) }} />
      })}</div> : <p className="lineup-empty">No reserves available.</p>}
    </div>
  </section>
}

function MatchRotationControls({ match, side, selected, helpId, statusRef, announcement, disabled, onClear, onCancel }: { match: MatchState; side: Side; selected: Player | null; helpId: string; statusRef: RefObject<HTMLParagraphElement | null>; announcement: string; disabled: boolean; onClear: () => void; onCancel: (outId: string) => void }) {
  const finished = match.status === 'finished'
  const playerName = (id: string) => match[side].players.find(player => player.id === id)?.name ?? id
  return <div className="lineup-rotation-controls">
    <div className="lineup-rotation-help"><p id={helpId}>{finished ? 'Match finished · substitutions closed.' : selected ? `${selected.name} selected. Choose an on-court player to replace.` : 'Drag a reserve onto an active player, or select both. Changes wait for a legal stoppage.'}</p>{selected && <button type="button" className="text-button" onClick={onClear} disabled={disabled}><Icon name="close" size={13} />Clear selection</button>}</div>
    <p ref={statusRef} className={`lineup-rotation-status${announcement ? '' : ' visually-hidden'}`} tabIndex={-1} role="status" aria-live="polite">{announcement}</p>
    {match.pendingSubstitutions[side].length > 0 && <ul className="lineup-queued-changes" aria-label="Pending substitutions">{match.pendingSubstitutions[side].map(request => <li key={request.outId}><span><strong>Queued</strong> {playerName(request.inId)} for {playerName(request.outId)}</span><button type="button" className="text-button" data-cancel-lineup-sub={request.outId} aria-label={`Cancel substitution of ${playerName(request.inId)} for ${playerName(request.outId)}`} onClick={() => onCancel(request.outId)} disabled={disabled || finished}>Cancel</button></li>)}</ul>}
  </div>
}
