import { useEffect, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import type { MatchState, Position, Side } from '../domain/types'
import type { PlayerKnowledge } from '../domain/scouting'
import { arrangeBestFive, cancelSubstitution, isPlayerEligible, placeInCircle } from '../engine/match'
import { arrangeCircles, courtCircles, COURT_POSITIONS } from '../engine/positions'
import { occupantOf, outOfPositionWarning, resolveCourtPick, samePick, type CourtMove, type CourtPick } from './court-five-moves'
import { Avatar } from './Avatar'
import { Icon } from './Icon'
import { PlayerRating } from './PlayerRating'
import { StaminaMeter } from './StaminaMeter'
import './court-five.css'

const DRAG_TYPE = 'application/x-courtside-court-pick'
const POSITION_NAMES: Readonly<Record<Position, string>> = { PG: 'point guard', SG: 'shooting guard', SF: 'small forward', PF: 'power forward', C: 'centre' }
const pickKey = (pick: CourtPick) => pick.kind === 'circle' ? `circle:${pick.position}` : `bench:${pick.playerId}`
/** The name under a circle: the family name (the full name is in the label and tooltip). */
const shortName = (name: string) => name.trim().split(/\s+/).slice(1).join(' ') || name

interface CourtFiveProps {
  match: MatchState
  /** The playback snapshot shown while a play is animated; the authoritative match once the manager interacts. */
  displayMatch: MatchState
  side: Side
  disabled: boolean
  benchOpen: boolean
  benchId: string
  apply: (action: (state: MatchState) => MatchState) => void
  onInteractionStart: () => void
  knowledgeForPlayer?: (id: string) => PlayerKnowledge
}

/**
 * The court picture (owner request, 16 November 2026): five circles PG, SG, SF, PF and C on a half court with the bench
 * beside it. Drag a player onto a circle, drag between circles, or tap a player and then a circle (or a circle and
 * then a player); keyboard users press Enter or Space on the same buttons. Every change goes through the engine
 * (`placeInCircle`, `arrangeBestFive`): before tip-off it applies at once, during play a reserve waits for a legal
 * stoppage and players on court swap circles at once.
 */
export function CourtFive({ match, displayMatch, side, disabled, benchOpen, benchId, apply, onInteractionStart, knowledgeForPlayer }: CourtFiveProps) {
  const [pick, setPick] = useState<CourtPick | null>(null)
  const [dragging, setDragging] = useState<CourtPick | null>(null)
  const [dropKey, setDropKey] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [focusCircles, setFocusCircles] = useState(false)
  const status = useRef<HTMLParagraphElement>(null)
  const court = useRef<HTMLDivElement>(null)
  const complete = match.status === 'finished'
  const editable = !disabled && !complete
  const pregame = match.stepCount === 0
  const team = match[side]
  // Where each player on court is shown, and the circles the manager chose (only those change the position played).
  const circles = courtCircles(match, side), chosen = match.slots?.[side] ?? {}
  const identity = `${match.seed}:${match.home.id}:${match.away.id}:${side}`
  const playerById = (id: string) => team.players.find(player => player.id === id)
  const name = (id: string | undefined) => (id && playerById(id)?.name) ?? 'nobody'
  // While the manager picks, the authoritative match is shown; otherwise the playback snapshot (no later boundary).
  // A snapshot taken mid-substitution can list six players for a moment; the circles then show the match itself.
  const snapshot = pick || dragging ? match : displayMatch
  const shown = new Set(snapshot.lineups[side]).size === snapshot.lineups[side].length && snapshot.lineups[side].length <= COURT_POSITIONS.length ? snapshot : match
  const shownPlayers = shown.lineups[side].flatMap(id => team.players.filter(player => player.id === id))
  const shownChosen = shown.slots?.[side] ?? chosen
  const shownCircles = shown === match ? circles : arrangeCircles(shownPlayers, [shownChosen])
  const bench = team.players.filter(player => !shown.lineups[side].includes(player.id))
  const usable = (id: string) => editable && !match.lineups[side].includes(id) && isPlayerEligible(match, id)
  const pending = match.pendingSubstitutions[side]
  const selectable = (target: CourtPick) => editable && (target.kind === 'bench' ? usable(target.playerId) : !!occupantOf(circles, target.position))

  useEffect(() => { setPick(null); setDragging(null); setDropKey(null); setAnnouncement('') }, [identity])
  // A pick that no longer exists (a substitution was applied, the match finished) is dropped.
  useEffect(() => { if (pick && !selectable(pick)) { setPick(null); setDragging(null); setDropKey(null) } })
  useEffect(() => {
    if (!focusCircles) return
    court.current?.querySelector<HTMLButtonElement>('[data-court-circle]:not([disabled])')?.focus({ preventScroll: true })
    setFocusCircles(false)
  }, [focusCircles])

  function announce(message: string, focus = true) {
    setAnnouncement(message)
    if (focus) requestAnimationFrame(() => status.current?.focus({ preventScroll: true }))
  }

  function place({ playerId, position }: CourtMove) {
    const before = match, beforeCircles = circles, occupant = occupantOf(beforeCircles, position)
    const result: { state: MatchState | null } = { state: null }
    apply(current => { const next = placeInCircle(current, side, playerId, position); result.state = next; return next })
    setPick(null); setDragging(null); setDropKey(null)
    if (!result.state) return
    const player = playerById(playerId), warning = player ? outOfPositionWarning(player.position, position) : null
    let message: string
    if (before.lineups[side].includes(playerId)) message = occupant && occupant !== playerId ? `${name(playerId)} moves to ${position}; ${name(occupant)} takes ${beforeCircles[playerId]}.` : `${name(playerId)} moves to ${position}.`
    else if (result.state.lineups[side].includes(playerId)) message = `${name(playerId)} comes in at ${position} for ${name(occupant)}.`
    else message = `${name(playerId)} is queued for ${name(occupant)} at ${position}: the change waits for the next legal stoppage.`
    announce(warning ? `${message} ${warning}.` : message)
  }

  function choose(target: CourtPick, keyboard: boolean) {
    if (!editable) return
    onInteractionStart()
    if (pick && samePick(pick, target)) { setPick(null); announce('Selection cleared.', false); return }
    const move = pick && resolveCourtPick(circles, pick, target)
    if (move) { place(move); return }
    if (!selectable(target)) { announce(target.kind === 'bench' ? 'Choose an available reserve or a circle.' : 'Choose a circle with a player first.', false); return }
    setPick(target)
    if (target.kind === 'bench') { announce(`${name(target.playerId)} selected. Choose a circle.`, false); setFocusCircles(keyboard) }
    else announce(`${target.position} selected: ${name(occupantOf(circles, target.position))}. Choose another circle to swap, or a reserve to bring on.`, false)
  }

  function bestFive() {
    if (!editable) return
    onInteractionStart()
    const result: { state: MatchState | null } = { state: null }, before = match
    apply(current => { const next = arrangeBestFive(current, side); result.state = next; return next })
    setPick(null); setDragging(null); setDropKey(null)
    if (!result.state) return
    const queued = result.state.pendingSubstitutions[side].length
    announce(result.state === before ? 'Your five is already the best five.' : pregame ? 'Best five set: your best healthy players, each in his circle.' : queued ? `Best five: ${queued} ${queued === 1 ? 'change waits' : 'changes wait'} for the next legal stoppage; players on court moved circles at once.` : 'Best five set: players on court moved circles.')
  }

  function cancel(outId: string) {
    if (disabled || complete) return
    onInteractionStart()
    let applied = false
    apply(current => { const next = cancelSubstitution(current, side, outId); applied = true; return next })
    if (applied) announce(`Substitution for ${name(outId)} cancelled.`)
  }

  function clearSelection() {
    setPick(null); setDragging(null); setDropKey(null)
    announce('Selection cleared.')
  }

  function beginDrag(event: DragEvent<HTMLElement>, source: CourtPick) {
    if (!selectable(source)) { event.preventDefault(); return }
    onInteractionStart()
    // Nothing above the court may change height while a drag starts: a moving drag source cancels the drag.
    setPick(null); setDragging(source)
    event.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ identity, source }))
    event.dataTransfer.effectAllowed = 'move'
  }
  const dropHandlers = (target: CourtPick) => ({
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!editable || !dragging || !resolveCourtPick(circles, dragging, target)) return
      event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropKey(pickKey(target))
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDropKey(null) },
    onDrop: (event: DragEvent<HTMLElement>) => {
      if (!editable) return
      event.preventDefault()
      try {
        const data: unknown = JSON.parse(event.dataTransfer.getData(DRAG_TYPE))
        if (!data || typeof data !== 'object' || !('identity' in data) || !('source' in data) || data.identity !== identity) return
        const source = data.source as CourtPick
        const move = source && typeof source === 'object' && (source.kind === 'circle' || source.kind === 'bench') ? resolveCourtPick(circles, source, target) : null
        if (move) place(move)
      } catch { announce('Drag a player from this match onto a circle.', false) }
      finally { setDragging(null); setDropKey(null) }
    },
  })
  const dragEnd = () => { setDragging(null); setDropKey(null) }

  // The picked or dragged item: it is highlighted and the places it can go are marked.
  const active = dragging ?? pick
  const help = complete ? 'Match finished · substitutions closed.'
    : pregame ? 'Drag a player onto a circle, or tap a player and then a circle. Changes before tip-off apply at once.'
      : 'Drag or tap a reserve onto a circle: he comes on at the next legal stoppage. Players on court swap circles at once.'

  return <div className="court-five" onKeyDown={event => { if (event.key === 'Escape' && pick) { event.preventDefault(); clearSelection() } }}>
    <div className="court-five-controls">
      <p className="court-five-help">{help}</p>
      <div className="court-five-actions">
        <button type="button" className="text-button court-five-clear" onClick={clearSelection} disabled={disabled || !pick}><Icon name="close" size={13} />Clear</button>
        <button type="button" className="button small court-five-best" data-best-five onClick={bestFive} disabled={!editable} title="Fill the five circles with your best healthy players, each in a fitting position">Best five</button>
      </div>
    </div>
    <p ref={status} className="court-five-status" tabIndex={-1} role="status" aria-live="polite">{announcement}</p>
    {pending.length > 0 && <ul className="lineup-queued-changes court-five-queued" aria-label="Pending substitutions">{pending.map(request => <li key={request.outId}><span><strong>Queued</strong> {name(request.inId)} for {name(request.outId)}{circles[request.outId] ? ` at ${circles[request.outId]}` : ''}</span><button type="button" className="text-button" data-cancel-lineup-sub={request.outId} aria-label={`Cancel substitution of ${name(request.inId)} for ${name(request.outId)}`} onClick={() => cancel(request.outId)} disabled={disabled || complete}>Cancel</button></li>)}</ul>}
    <div className="court-five-layout" onPointerDownCapture={editable ? onInteractionStart : undefined}>
      <div ref={court} className="court-five-court" role="group" aria-label={`${team.name} ${pregame ? 'starting five' : 'on court'}: five positions`}>
        <svg className="court-five-lines" viewBox="0 0 150 150" aria-hidden="true" focusable="false" preserveAspectRatio="none">
          <rect x="1" y="1" width="148" height="148" rx="2" />
          <rect className="court-five-paint" x="50.5" y="92" width="49" height="57" />
          <path d="M57 92a18 18 0 0 0 36 0" />
          <path d="M57 92a18 18 0 0 1 36 0" strokeDasharray="3 3" />
          <path d="M9 149V118A67.5 67.5 0 0 1 141 118V149" />
          <path d="M57 1a18 18 0 0 0 36 0" />
          <circle cx="75" cy="135" r="2.6" />
          <path d="M68 140h14" />
        </svg>
        {COURT_POSITIONS.map(position => {
          const occupantId = occupantOf(shownCircles, position), player = occupantId ? playerById(occupantId) : undefined
          const target: CourtPick = { kind: 'circle', position }, key = pickKey(target)
          const stats = player ? shown.stats[player.id] : undefined
          // Only a player the manager placed plays the circle's position; anyone else plays his listed position.
          const placed = !!player && shownChosen[player.id] === position
          const warning = player && placed ? outOfPositionWarning(player.position, position) : null
          const listedNote = player && !placed && player.position !== position ? `Plays ${player.position}` : null
          const unavailable = player && stats ? match.injuries[player.id] ? 'Injured' : stats.fouls >= 5 ? 'Fouled out' : null : null
          const queued = player ? pending.find(request => request.outId === player.id) : undefined
          const isSelected = active?.kind === 'circle' && active.position === position
          const move = active && !isSelected ? resolveCourtPick(circles, active, target) : null
          const live = editable && (!!move || !!occupantOf(circles, position))
          const condition = stats ? Math.round(stats.condition) : 0
          const description = player ? `${position}, ${POSITION_NAMES[position]}: ${player.name}, number ${player.number}, listed ${player.position}${warning ? `, ${warning.toLowerCase()}` : listedNote ? ', plays his listed position until you place him' : ''}, ${condition}% stamina${unavailable ? `, ${unavailable.toLowerCase()}` : ''}` : `${position}, ${POSITION_NAMES[position]}: empty`
          const action = !editable ? null : move ? move.playerId === occupantId ? `Move ${name(occupantId)} to ${position}` : occupantId && active?.kind === 'circle' ? `Swap: ${name(move.playerId)} to ${position}, ${name(occupantId)} to ${active.position}` : `Put ${name(move.playerId)} in ${position}${occupantId ? ` for ${name(occupantId)}` : ''}` : isSelected ? 'Deselect' : occupantId ? 'Select' : null
          return <div key={position} className={`court-five-spot court-five-spot-${position.toLowerCase()}${isSelected ? ' is-selected' : ''}${move ? ' is-target' : ''}${dropKey === key ? ' is-drop' : ''}${warning ? ' is-out-of-position' : ''}${unavailable ? ' is-unavailable' : ''}`} data-court-spot={position} {...(editable ? dropHandlers(target) : {})}>
            <button type="button" className="court-five-circle" data-court-circle={position} data-player-id={player?.id} aria-pressed={live && !move ? isSelected : undefined} aria-label={action ? `${action}. ${description}` : description} title={player?.name} disabled={!live} draggable={editable && !!occupantOf(circles, position)} onClick={event => choose(target, event.detail === 0)} onDragStart={event => beginDrag(event, target)} onDragEnd={dragEnd}>
              <span className="court-five-ring"><span className="court-five-position">{position}</span><span className="court-five-number">{player ? player.number : '—'}</span></span>
              <strong className="court-five-name">{player ? shortName(player.name) : 'Empty'}</strong>
            </button>
            {player && stats && <StaminaMeter value={stats.condition} label={`${player.name} stamina`} compact />}
            {player && stats && !pregame && stats.fouls > 0 && <span className={`court-five-fouls${stats.fouls >= 4 ? ' is-trouble' : ''}`}>{stats.fouls} {stats.fouls === 1 ? 'foul' : 'fouls'}</span>}
            {warning && <span className="court-five-warning" data-out-of-position={position}>{warning}</span>}
            {listedNote && <span className="court-five-listed" title="The automatic choice: he plays his listed position without a penalty. Put him in a circle yourself to change the position he plays.">{listedNote}</span>}
            {unavailable && <span className="court-five-unavailable">{unavailable}</span>}
            {queued && <span className="court-five-queued-label">Sub queued: {shortName(name(queued.inId))}</span>}
          </div>
        })}
      </div>
      <div id={benchId} className="court-five-bench" hidden={!benchOpen}>
        <div className="court-five-bench-heading"><h4>Bench</h4><span>{bench.length} {bench.length === 1 ? 'player' : 'players'} · stamina recovers while resting</span></div>
        {bench.length ? <ul aria-label={`${team.name} bench`}>{bench.map(player => {
          const target: CourtPick = { kind: 'bench', playerId: player.id }, key = pickKey(target), stats = shown.stats[player.id]
          const unavailable = match.injuries[player.id] ? 'Injured' : stats && stats.fouls >= 5 ? 'Fouled out' : null
          const queued = pending.find(request => request.inId === player.id)
          const isSelected = active?.kind === 'bench' && active.playerId === player.id
          const move = active && !isSelected ? resolveCourtPick(circles, active, target) : null
          const live = usable(player.id)
          const condition = stats ? Math.round(stats.condition) : 0
          const action = !live ? null : move ? `Bring on ${player.name} at ${move.position} for ${name(occupantOf(circles, move.position))}` : `${isSelected ? 'Deselect' : 'Select'} ${player.name}, ${player.position}, ${condition}% stamina, then choose a circle`
          const identityMarkup = <><span aria-hidden="true"><Avatar player={player} color={team.color} size={30} /></span><span className="court-five-reserve-identity"><strong>{player.name}</strong><span>#{player.number} · {player.position}{stats && stats.fouls > 0 ? <span className={stats.fouls >= 4 ? 'lineup-foul-trouble' : ''}> · {stats.fouls} {stats.fouls === 1 ? 'foul' : 'fouls'}</span> : null}</span></span></>
          return <li key={player.id} className={`court-five-reserve${isSelected ? ' is-selected' : ''}${move ? ' is-target' : ''}${dropKey === key ? ' is-drop' : ''}${unavailable ? ' is-unavailable' : ''}`} data-player-id={player.id} {...(live ? dropHandlers(target) : {})}>
            {live ? <button type="button" className="court-five-reserve-pick" data-court-reserve={player.id} aria-pressed={move ? undefined : isSelected} aria-label={action!} draggable onClick={event => choose(target, event.detail === 0)} onDragStart={event => beginDrag(event, target)} onDragEnd={dragEnd}>{identityMarkup}</button> : <div className="court-five-reserve-pick">{identityMarkup}</div>}
            <PlayerRating attributes={player.attributes} position={player.position} knowledge={knowledgeForPlayer?.(player.id)} compact label={`${player.name} ability`} />
            {stats && <StaminaMeter value={stats.condition} label={`${player.name} stamina`} compact />}
            {(unavailable || queued) && <span className={unavailable ? 'court-five-unavailable' : 'court-five-queued-label'}>{unavailable ?? `Queued on for ${shortName(name(queued!.outId))}`}</span>}
          </li>
        })}</ul> : <p className="lineup-empty">No reserves in the matchday squad.</p>}
      </div>
    </div>
  </div>
}
