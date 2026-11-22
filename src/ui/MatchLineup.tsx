import { useEffect, useId, useRef, useState } from 'react'
import type { DragEvent, RefObject } from 'react'
import type { MatchState, Player, Side } from '../domain/types'
import type { PlayerKnowledge } from '../domain/scouting'
import { cancelSubstitution, isPlayerEligible, substitutePlayer, swapActivePlayers } from '../engine/match'
import { Avatar } from './Avatar'
import { Icon } from './Icon'
import { StaminaMeter } from './StaminaMeter'
import { PlayerRating, MatchRating } from './PlayerRating'
import { CourtFive } from './CourtFive'
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
  /** Career matches: the manager's side is shown on the court picture with PG, SG, SF, PF and C circles. */
  courtPicture?: boolean
}

interface LineupPlayerProps {
  player: Player
  match: MatchState
  side: Side
  active: boolean
  /** The accessible name of the card's action; without one the card is not interactive. */
  pickLabel: string | null
  /** Pressed state for a player who can be selected (not for a target). */
  pressed?: boolean
  selected: boolean
  selectedHint: string | null
  /** Shown on a card that completes the selected change. */
  targetHint: string | null
  draggable: boolean
  dragOver: boolean
  pending: string | null
  onSelect: (keyboard: boolean) => void
  onDragStart?: (event: DragEvent<HTMLElement>) => void
  onDragEnd?: () => void
  onDragOver?: (event: DragEvent<HTMLElement>) => void
  onDragLeave?: (event: DragEvent<HTMLElement>) => void
  onDrop?: (event: DragEvent<HTMLElement>) => void
  knowledge?: PlayerKnowledge
}

function LineupPlayer({ player, match, side, active, pickLabel, pressed, selected, selectedHint, targetHint, draggable, dragOver, pending, onSelect, onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop, knowledge }: LineupPlayerProps) {
  const stats = match.stats[player.id]
  const unavailable = match.injuries[player.id] ? 'Injured' : stats.fouls >= 5 ? 'Fouled out' : null
  const identity = <><span aria-hidden="true"><Avatar player={player} color={match[side].color} size={34} /></span><span className="lineup-player-identity"><strong>{player.name}</strong><span>#{player.number} <i /> {player.position}<span className={stats.fouls >= 4 ? 'lineup-foul-trouble' : ''}> {stats.fouls} {stats.fouls === 1 ? 'foul' : 'fouls'}</span></span></span></>

  return <article className={`lineup-player${unavailable ? ' lineup-player-unavailable' : ''}${selected ? ' lineup-player-selected' : ''}${targetHint ? ' lineup-player-target' : ''}${dragOver ? ' lineup-player-drop' : ''}`} data-player-id={player.id} data-roster-status={unavailable ?? (active ? 'active' : 'bench')} tabIndex={-1} aria-label={`${player.name}, ${unavailable ?? (active ? 'on court' : 'bench')}`} draggable={draggable} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
    {pickLabel ? <button className="lineup-player-heading lineup-player-pick" type="button" data-sub-in={!active ? player.id : undefined} data-sub-out={active ? player.id : undefined} data-lineup-target={targetHint ? player.id : undefined} aria-pressed={pressed} aria-label={pickLabel} onClick={event => onSelect(event.detail === 0)}>{identity}</button> : <div className="lineup-player-heading">{identity}</div>}
    <div className="lineup-player-ratings"><div><span>Ability</span><PlayerRating attributes={player.attributes} position={player.position} knowledge={knowledge} compact label={`${player.name} ability`} /></div><div className="lineup-match-rating"><span>Match</span><MatchRating stats={stats} live={match.stepCount > 0} compact label={player.name} /></div></div>
    <StaminaMeter value={stats.condition} label={`${player.name} stamina`} />
    {unavailable && <span className="lineup-unavailable-label">{unavailable}</span>}
    {pending && <span className="lineup-pending-label">{pending}</span>}
    {selected && selectedHint && <span className="lineup-selection-label">{selectedHint}</span>}
    {targetHint && <span className="lineup-drop-label">{targetHint}</span>}
  </article>
}

/**
 * Selection is presentation state; the shared engine owns every queued or legal substitution and every swap.
 * Pairs: a reserve and an on-court player make a substitution (it waits for a legal stoppage); two on-court players
 * swap places at once (owner feedback, 16 November 2026: nobody enters or leaves, so no stoppage is needed).
 */
export function MatchLineup({ match, displayMatch = match, managedSide = 'home', disabled = false, apply, onInteractionStart, knowledgeForPlayer, courtPicture: useCourtPicture = false }: MatchLineupProps) {
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
  const editable = !disabled && !complete && own
  const currentTeam = match[managedSide]
  const onCourt = match.lineups[managedSide]
  const usableBench = currentTeam.players.filter(player => !onCourt.includes(player.id) && isPlayerEligible(match, player.id) && !match.pendingSubstitutions[managedSide].some(request => request.inId === player.id))
  const isUsableBench = (id: string) => usableBench.some(player => player.id === id)
  // A selected reserve waits for an on-court player to replace; a selected on-court player waits for a teammate to swap with or a reserve.
  const selected = editable ? usableBench.find(player => player.id === selectedId) ?? null : null
  const selectedActive = editable && selectedId && onCourt.includes(selectedId) ? currentTeam.players.find(player => player.id === selectedId) ?? null : null
  const shownMatch = selected || selectedActive || draggedId ? match : displayMatch
  // Format 74: the manager's side is arranged on the court picture (career matches).
  const courtPicture = own && useCourtPicture && match.engineVersion === 'possession-3'
  const team = shownMatch[side]
  const active = shownMatch.lineups[side].flatMap(id => team.players.filter(player => player.id === id))
  const bench = team.players.filter(player => !shownMatch.lineups[side].includes(player.id))
  const identity = `${match.seed}:${match.home.id}:${match.away.id}`
  const playerName = (id: string) => currentTeam.players.find(player => player.id === id)?.name ?? id

  useEffect(() => {
    setSelectedId(null); setDraggedId(null); setDropId(null); setAnnouncement('')
  }, [identity])

  useEffect(() => {
    if (selectedId && !selected && !selectedActive) { setSelectedId(null); setDraggedId(null); setDropId(null) }
  }, [selectedId, selected, selectedActive])

  useEffect(() => {
    if (!focusTargets || !selected && !selectedActive) return
    const required = match.requiredSubstitutions.find(request => request.side === managedSide)
    const targets = container.current?.querySelectorAll<HTMLButtonElement>('[data-lineup-target]')
    const target = Array.from(targets ?? []).find(button => !!selected && !!required && button.dataset.subOut === required.playerId) ?? targets?.[0]
    target?.focus({ preventScroll: true })
    setFocusTargets(false)
  }, [focusTargets, selected, selectedActive, managedSide, match.requiredSubstitutions])

  function choose(playerId: string, keyboard = false) {
    if (!editable) return
    onInteractionStart()
    if (!isUsableBench(playerId) && !onCourt.includes(playerId)) { setAnnouncement('The lineup changed. Choose an eligible player from the current bench or the court.'); return }
    setSelectedId(previous => previous === playerId ? null : playerId)
    setFocusTargets(keyboard)
    setAnnouncement('')
  }

  function settle(message: string) {
    setDraggedId(null); setDropId(null); setSelectedId(null)
    setAnnouncement(message)
    requestAnimationFrame(() => status.current?.focus({ preventScroll: true }))
  }

  function makeChange(outId: string, inId: string) {
    if (!editable) return
    onInteractionStart()
    const applied: { state: MatchState | null } = { state: null }
    apply(current => {
      const next = substitutePlayer(current, managedSide, outId, inId)
      applied.state = next
      return next
    })
    if (!applied.state) { setDraggedId(null); setDropId(null); return }
    const queued = applied.state.pendingSubstitutions[managedSide].some(request => request.inId === inId && request.outId === outId)
    settle(queued ? `${playerName(inId)} is queued for ${playerName(outId)} at the next legal stoppage.` : `${playerName(inId)} replaces ${playerName(outId)}.`)
  }

  function makeSwap(firstId: string, secondId: string) {
    if (!editable || firstId === secondId) return
    onInteractionStart()
    let applied = false
    apply(current => {
      const next = swapActivePlayers(current, managedSide, firstId, secondId)
      applied = true
      return next
    })
    if (!applied) { setDraggedId(null); setDropId(null); return }
    settle(`${playerName(firstId)} and ${playerName(secondId)} swapped places on the floor.`)
  }

  /** Completes the selected pair: on-court with on-court swaps; a reserve with an on-court player substitutes. */
  function pair(firstId: string, secondId: string) {
    const firstOnCourt = onCourt.includes(firstId), secondOnCourt = onCourt.includes(secondId)
    if (firstOnCourt && secondOnCourt) makeSwap(firstId, secondId)
    else if (firstOnCourt && isUsableBench(secondId)) makeChange(firstId, secondId)
    else if (secondOnCourt && isUsableBench(firstId)) makeChange(secondId, firstId)
  }

  function beginDrag(event: DragEvent<HTMLElement>, playerId: string) {
    if (!editable || !isUsableBench(playerId) && !onCourt.includes(playerId)) { event.preventDefault(); return }
    onInteractionStart()
    setSelectedId(playerId); setDraggedId(playerId); setAnnouncement('')
    event.dataTransfer.setData(PLAYER_DRAG_TYPE, JSON.stringify({ playerId, identity, side: managedSide }))
    event.dataTransfer.effectAllowed = 'move'
  }

  /** A drop completes a pair with the dragged player: onto an on-court player, or (from the court) onto a reserve. */
  const canDrop = (targetId: string) => editable && !!draggedId && draggedId !== targetId && (onCourt.includes(targetId) ? onCourt.includes(draggedId) || isUsableBench(draggedId) : onCourt.includes(draggedId) && isUsableBench(targetId))

  function dragOver(event: DragEvent<HTMLElement>, targetId: string) {
    if (!canDrop(targetId)) return
    event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropId(targetId)
  }

  function dropPlayer(event: DragEvent<HTMLElement>, targetId: string) {
    if (!editable) return
    event.preventDefault()
    try {
      const data: unknown = JSON.parse(event.dataTransfer.getData(PLAYER_DRAG_TYPE))
      if (!data || typeof data !== 'object' || !('playerId' in data) || !('identity' in data) || !('side' in data) || typeof data.playerId !== 'string' || data.identity !== identity || data.side !== managedSide || data.playerId === targetId) return
      pair(data.playerId, targetId)
    } catch { setAnnouncement('Drag a player from this match onto another one to make a change.') }
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
    setAnnouncement(`Change cancelled: ${playerName(outId)} stays on.`)
    requestAnimationFrame(() => status.current?.focus({ preventScroll: true }))
  }

  function clearSelection() {
    setSelectedId(null); setDraggedId(null); setDropId(null); setFocusTargets(false)
    setAnnouncement('Selection cleared.')
    requestAnimationFrame(() => status.current?.focus({ preventScroll: true }))
  }

  const stamina = (player: Player) => `${Math.round(match.stats[player.id]?.condition ?? 0)}% stamina`
  const dragHandlers = (targetId: string) => ({
    onDragOver: (event: DragEvent<HTMLElement>) => dragOver(event, targetId),
    onDragLeave: (event: DragEvent<HTMLElement>) => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDropId(null) },
    onDrop: (event: DragEvent<HTMLElement>) => dropPlayer(event, targetId),
    onDragEnd: () => { setDraggedId(null); setDropId(null) },
  })

  return <section ref={container} id="match-rotation" className="match-lineup" tabIndex={-1} aria-label="Players, ratings and substitutions" onKeyDown={event => { if (event.key === 'Escape' && selectedId) { event.preventDefault(); clearSelection() } }}>
    <div className="lineup-toolbar">
      <div className="lineup-title"><span className="lineup-live-dot" /><h3>{courtPicture && match.stepCount === 0 ? 'Starting five' : 'On the floor'}</h3><span>{courtPicture ? 'Positions & stamina' : 'Ratings & stamina'}</span></div>
      <div className="lineup-team-switch" role="group" aria-label="Lineup team">{(['home', 'away'] as const).map(value => <button key={value} type="button" onClick={() => { setShowOpponent(value !== managedSide); setSelectedId(null); setDraggedId(null); setDropId(null) }} aria-pressed={side === value} className={side === value ? 'selected' : ''}><span style={{ backgroundColor: match[value].color }} />{match[value].shortName}<small>{value === managedSide ? 'Your team' : 'Opponent'}</small></button>)}</div>
      <button className="lineup-bench-toggle" type="button" aria-expanded={benchOpen} aria-controls={benchId} onClick={() => setBenchOpen(value => !value)}>{benchOpen ? 'Hide bench' : 'Show bench'} <span>{bench.length}</span><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
    </div>
    {courtPicture ? <CourtFive match={match} displayMatch={displayMatch} side={managedSide} disabled={disabled} benchOpen={benchOpen} benchId={benchId} apply={apply} onInteractionStart={onInteractionStart} knowledgeForPlayer={knowledgeForPlayer} /> : <>
    {own && <MatchRotationControls match={match} side={managedSide} selected={selected} selectedActive={selectedActive} helpId={helpId} statusRef={status} announcement={announcement} disabled={disabled} onClear={clearSelection} onCancel={cancelChange} />}
    <div className="lineup-grid" aria-label={`${team.name} on court`} aria-describedby={own ? helpId : undefined}>{active.map(player => {
      const pending = match.pendingSubstitutions[side].find(request => request.outId === player.id)
      const live = editable && onCourt.includes(player.id)
      const isSelected = selectedActive?.id === player.id
      const target = live && !isSelected && (!!selected || !!selectedActive)
      const pickLabel = !live ? null : selected ? `Replace ${player.name} with ${selected.name}` : selectedActive && !isSelected ? `Swap places: ${player.name} and ${selectedActive.name}` : `${isSelected ? 'Deselect' : 'Select'} ${player.name} on court, ${stamina(player)}`
      return <LineupPlayer key={player.id} player={player} knowledge={knowledgeForPlayer?.(player.id)} match={shownMatch} side={side} active pickLabel={pickLabel} pressed={live && !target ? isSelected : undefined} selected={isSelected} selectedHint="Selected · choose a teammate to swap with or a reserve to bring on" targetHint={target ? selected ? 'Drop or select to replace' : 'Drop or select to swap places' : null} draggable={live} dragOver={dropId === player.id} pending={pending ? `Queued off · ${match[side].players.find(member => member.id === pending.inId)!.name} coming on` : null} onSelect={keyboard => { if (selected || selectedActive && !isSelected) pair(selectedId!, player.id); else choose(player.id, keyboard) }} onDragStart={event => beginDrag(event, player.id)} {...(live ? dragHandlers(player.id) : {})} />
    })}</div>
    {active.length === 0 && <p className="lineup-empty">No players on court.</p>}
    <div id={benchId} className="lineup-bench" hidden={!benchOpen}>
      <div className="lineup-bench-heading"><h3>On the bench</h3><span>Stamina recovers while resting</span></div>
      {bench.length ? <div className="lineup-grid" aria-label={`${team.name} bench`}>{bench.map(player => {
        const pending = match.pendingSubstitutions[side].find(request => request.inId === player.id)
        const selectable = editable && isUsableBench(player.id)
        const target = selectable && !!selectedActive
        const pickLabel = !selectable ? null : selectedActive ? `Bring on ${player.name} for ${selectedActive.name}` : `${selected?.id === player.id ? 'Deselect' : 'Select'} ${player.name} for substitution, ${stamina(player)}`
        return <LineupPlayer key={player.id} player={player} knowledge={knowledgeForPlayer?.(player.id)} match={shownMatch} side={side} active={false} pickLabel={pickLabel} pressed={selectable && !target ? selected?.id === player.id : undefined} selected={selected?.id === player.id} selectedHint="Selected · choose who comes off" targetHint={target ? 'Drop or select to bring on' : null} draggable={selectable} dragOver={dropId === player.id} pending={pending ? `Queued on · replacing ${match[side].players.find(member => member.id === pending.outId)!.name}` : null} onSelect={keyboard => { if (selectedActive) pair(selectedActive.id, player.id); else choose(player.id, keyboard) }} onDragStart={event => beginDrag(event, player.id)} {...(selectable ? dragHandlers(player.id) : {})} />
      })}</div> : <p className="lineup-empty">No reserves available.</p>}
    </div>
    </>}
  </section>
}

function MatchRotationControls({ match, side, selected, selectedActive, helpId, statusRef, announcement, disabled, onClear, onCancel }: { match: MatchState; side: Side; selected: Player | null; selectedActive: Player | null; helpId: string; statusRef: RefObject<HTMLParagraphElement | null>; announcement: string; disabled: boolean; onClear: () => void; onCancel: (outId: string) => void }) {
  const finished = match.status === 'finished'
  const playerName = (id: string) => match[side].players.find(player => player.id === id)?.name ?? id
  return <div className="lineup-rotation-controls">
    <div className="lineup-rotation-help"><p id={helpId}>{finished ? 'Match finished · substitutions closed.' : selected ? `${selected.name} selected. Choose an on-court player to replace.` : selectedActive ? `${selectedActive.name} selected. Choose another on-court player to swap places, or a reserve to bring on.` : 'Drag a reserve onto an on-court player, or select both: substitutions wait for a legal stoppage. Drag or select two on-court players to swap their places at once.'}</p>{(selected || selectedActive) && <button type="button" className="text-button" onClick={onClear} disabled={disabled}><Icon name="close" size={13} />Clear selection</button>}</div>
    <p ref={statusRef} className={`lineup-rotation-status${announcement ? '' : ' visually-hidden'}`} tabIndex={-1} role="status" aria-live="polite">{announcement}</p>
    {match.pendingSubstitutions[side].length > 0 && <ul className="lineup-queued-changes" aria-label="Pending substitutions">{match.pendingSubstitutions[side].map(request => <li key={request.outId}><span><strong>Waiting for a stoppage</strong> {playerName(request.inId)} on for {playerName(request.outId)}</span><button type="button" className="button small lineup-cancel-sub" data-cancel-lineup-sub={request.outId} aria-label={`Cancel substitution: ${playerName(request.outId)} stays on, ${playerName(request.inId)} stays on the bench`} onClick={() => onCancel(request.outId)} disabled={disabled || finished}><Icon name="close" size={13} />Cancel</button></li>)}</ul>}
  </div>
}
