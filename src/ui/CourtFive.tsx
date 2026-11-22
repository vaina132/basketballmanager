import { useEffect, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import type { MatchState, Player, Position, Side } from '../domain/types'
import type { PlayerKnowledge } from '../domain/scouting'
import { arrangeBestFive, cancelSubstitution, isPlayerEligible, placeInCircle } from '../engine/match'
import { arrangeCircles, courtCircles, COURT_POSITIONS } from '../engine/positions'
import { COURT_PICTURE_SPOTS, occupantOf, outOfPositionWarning, resolveCourtPick, sortBench, type BenchSort, type CourtMove, type CourtPick } from './court-five-moves'
import { Avatar } from './Avatar'
import { Icon } from './Icon'
import { MatchRating, PlayerRating } from './PlayerRating'
import { playerMatchRating } from '../world/performance-rating'
import { StaminaMeter } from './StaminaMeter'
import { Nationality } from './Nationality'
import type { SquadSpot } from '../world/squad-board'
import './court-five.css'

const DRAG_TYPE = 'application/x-courtside-court-pick'
const POSITION_NAMES: Readonly<Record<Position, string>> = { PG: 'point guard', SG: 'shooting guard', SF: 'small forward', PF: 'power forward', C: 'centre' }
/** Squad page: a first-team player outside the matchday squad can be picked too (owner feedback, 22 November 2026). */
type Pick = CourtPick | { kind: 'reserve'; playerId: string }
/** Where a pick can go: a circle, a player (to swap with), or the bench or reserves list as a whole. */
type Target = Pick | { kind: 'bench-area' } | { kind: 'reserves-area' }
type Resolved = { kind: 'court'; move: CourtMove } | { kind: 'squad'; playerId: string; spot: SquadSpot }
const pickKey = (pick: Target) => pick.kind === 'circle' ? `circle:${pick.position}` : pick.kind === 'bench-area' || pick.kind === 'reserves-area' ? pick.kind : `${pick.kind}:${pick.playerId}`
const isPick = (value: unknown): value is Pick => !!value && typeof value === 'object' && 'kind' in value && (value.kind === 'circle' || value.kind === 'bench' || value.kind === 'reserve')
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
  /** Squad page (owner request, 18 November 2026): the five for the next game is planned; the help text says so. */
  planning?: boolean
  /** Squad page bench and reserves (owner feedback, 22 November 2026): every move goes through `moveSquadPlayer`. */
  squad?: SquadControls
  /** A player's country for the small flag on the bench and reserve rows (owner request, 22 November 2026); none hides it. */
  nationalityOf?: (id: string) => string | null
}

export interface SquadControls {
  /** First-team players outside the matchday squad; shown only when the career has matchday squads. */
  reserves: readonly Player[]
  reservesOpen: boolean
  /** The most players the matchday squad may hold. */
  limit: number
  /** Injured for the next game: cannot go on court or on the bench. */
  unavailable: (id: string) => boolean
  condition: (id: string) => number
  /** Applies the move; returns the reason when it is refused. */
  move: (playerId: string, spot: SquadSpot) => string | null
  autoPick: () => string | null
}

/**
 * The court picture (owner request, 16 November 2026): five circles PG, SG, SF, PF and C on a half court with the bench
 * beside it. Drag a player onto a circle, drag between circles, or tap a player and then a circle (or a circle and
 * then a player); keyboard users press Enter or Space on the same buttons. Every change goes through the engine
 * (`placeInCircle`, `arrangeBestFive`): before tip-off it applies at once, during play a reserve waits for a legal
 * stoppage and players on court swap circles at once.
 */
export function CourtFive({ match, displayMatch, side, disabled, benchOpen, benchId, apply, onInteractionStart, knowledgeForPlayer, planning = false, squad, nationalityOf }: CourtFiveProps) {
  const [pick, setPick] = useState<Pick | null>(null)
  const [dragging, setDragging] = useState<Pick | null>(null)
  const [dropKey, setDropKey] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [focusCircles, setFocusCircles] = useState(false)
  const [benchSort, setBenchSort] = useState<BenchSort>('position')
  const status = useRef<HTMLParagraphElement>(null)
  const court = useRef<HTMLDivElement>(null)
  const complete = match.status === 'finished'
  const editable = !disabled && !complete
  const pregame = match.stepCount === 0
  const team = match[side]
  // Where each player on court is shown, and the circles the manager chose (only those change the position played).
  const circles = courtCircles(match, side), chosen = match.slots?.[side] ?? {}
  const identity = `${match.seed}:${match.home.id}:${match.away.id}:${side}`
  const playerById = (id: string) => team.players.find(player => player.id === id) ?? squad?.reserves.find(player => player.id === id)
  const name = (id: string | undefined) => (id && playerById(id)?.name) ?? 'nobody'
  // While the manager picks, the authoritative match is shown; otherwise the playback snapshot (no later boundary).
  // A snapshot taken mid-substitution can list six players for a moment; the circles then show the match itself.
  const snapshot = pick || dragging ? match : displayMatch
  const shown = new Set(snapshot.lineups[side]).size === snapshot.lineups[side].length && snapshot.lineups[side].length <= COURT_POSITIONS.length ? snapshot : match
  const shownPlayers = shown.lineups[side].flatMap(id => team.players.filter(player => player.id === id))
  const shownChosen = shown.slots?.[side] ?? chosen
  const shownCircles = shown === match ? circles : arrangeCircles(shownPlayers, [shownChosen])
  // Live match ratings (owner request, 18 November 2026) appear once the game is under way; never on the Squad page.
  const showRatings = !pregame && !planning
  const bench = sortBench(team.players.filter(player => !shown.lineups[side].includes(player.id)), shown.stats, showRatings ? benchSort : 'position')
  const usable = (id: string) => editable && !match.lineups[side].includes(id) && isPlayerEligible(match, id)
  const pending = match.pendingSubstitutions[side]
  const selectable = (target: Pick) => editable && (target.kind === 'circle' ? !!occupantOf(circles, target.position)
    : target.kind === 'reserve' ? !!squad && squad.reserves.some(player => player.id === target.playerId) && !squad.unavailable(target.playerId)
    // On the Squad page an injured bench player can still be picked, to move him to Reserves.
    : squad ? team.players.some(player => player.id === target.playerId) && !match.lineups[side].includes(target.playerId) : usable(target.playerId))
  /**
   * The one rule behind dragging and tapping. On the Match screen: `resolveCourtPick`. On the Squad page every move
   * becomes a `SquadSpot`; a player who would go on court or on the bench must be fit for the next game.
   */
  function resolve(from: Pick, to: Target): Resolved | null {
    if (pickKey(from) === pickKey(to)) return null
    if (!squad) {
      if (from.kind === 'reserve' || to.kind === 'reserve' || to.kind === 'bench-area' || to.kind === 'reserves-area') return null
      const move = resolveCourtPick(circles, from, to)
      return move ? { kind: 'court', move } : null
    }
    const occupant = from.kind === 'circle' ? occupantOf(circles, from.position) : undefined
    const result = ((): { playerId: string; spot: SquadSpot } | null => {
      if (from.kind === 'circle') {
        if (to.kind === 'circle') { const move = resolveCourtPick(circles, from, to); return move ? { playerId: move.playerId, spot: { kind: 'court', position: move.position } } : null }
        if (!occupant) return null
        if (to.kind === 'bench') return { playerId: to.playerId, spot: { kind: 'court', position: from.position } }
        if (to.kind === 'reserve') return { playerId: to.playerId, spot: { kind: 'court', position: from.position, sendOff: 'reserves' } }
        return { playerId: occupant, spot: { kind: to.kind === 'bench-area' ? 'bench' : 'reserves' } }
      }
      if (to.kind === 'circle') return occupantOf(circles, to.position) ? { playerId: from.playerId, spot: { kind: 'court', position: to.position } } : null
      if (from.kind === 'bench') return to.kind === 'reserve' ? { playerId: from.playerId, spot: { kind: 'reserves', swapWith: to.playerId } } : to.kind === 'reserves-area' ? { playerId: from.playerId, spot: { kind: 'reserves' } } : null
      return to.kind === 'bench' ? { playerId: from.playerId, spot: { kind: 'bench', swapWith: to.playerId } } : to.kind === 'bench-area' ? { playerId: from.playerId, spot: { kind: 'bench' } } : null
    })()
    if (!result) return null
    const { playerId, spot } = result
    if (spot.kind !== 'reserves' && !match.lineups[side].includes(playerId) && squad.unavailable(playerId)) return null
    if (spot.kind === 'reserves' && spot.swapWith && squad.unavailable(spot.swapWith)) return null
    return { kind: 'squad', playerId, spot }
  }
  const spotName = (spot: SquadSpot) => spot.kind === 'court' ? spot.position : spot.kind === 'bench' ? 'the bench' : 'Reserves'
  /** The move in words: "Name to SF; Other goes to the bench". */
  const describeSquadMove = (playerId: string, spot: SquadSpot) => {
    const swap = spot.kind === 'court' ? occupantOf(circles, spot.position) : spot.swapWith
    if (!swap || swap === playerId) return `${name(playerId)} to ${spotName(spot)}`
    const inSquad = team.players.some(player => player.id === playerId)
    const goes = spot.kind !== 'court' ? spot.kind === 'bench' ? 'Reserves' : 'the bench'
      : match.lineups[side].includes(playerId) ? circles[playerId]
      : spot.sendOff === 'reserves' || !inSquad && team.players.length >= (squad?.limit ?? 12) ? 'Reserves' : 'the bench'
    return `${name(playerId)} to ${spotName(spot)}; ${name(swap)} goes to ${goes}`
  }

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

  function perform(resolved: Resolved) {
    if (resolved.kind === 'court') { place(resolved.move); return }
    const { playerId, spot } = resolved, message = describeSquadMove(playerId, spot)
    const refused = squad!.move(playerId, spot)
    setPick(null); setDragging(null); setDropKey(null)
    announce(refused ?? `${message}.`)
  }

  function choose(target: Target, keyboard: boolean) {
    if (!editable) return
    onInteractionStart()
    if (pick && pickKey(pick) === pickKey(target)) { setPick(null); announce('Selection cleared.', false); return }
    const resolved = pick && resolve(pick, target)
    if (resolved) { perform(resolved); return }
    if (target.kind === 'bench-area' || target.kind === 'reserves-area') { announce('Choose a player first.', false); return }
    if (!selectable(target)) { announce(target.kind === 'circle' ? 'Choose a circle with a player first.' : target.kind === 'reserve' && squad?.unavailable(target.playerId) ? `${name(target.playerId)} is injured and cannot be placed.` : 'Choose an available reserve or a circle.', false); return }
    setPick(target)
    if (target.kind !== 'circle') { announce(squad ? `${name(target.playerId)} selected. Choose a circle, a player or a list.` : `${name(target.playerId)} selected. Choose a circle.`, false); setFocusCircles(keyboard) }
    else announce(squad ? `${target.position} selected: ${name(occupantOf(circles, target.position))}. Choose a circle, a player or a list.` : `${target.position} selected: ${name(occupantOf(circles, target.position))}. Choose another circle to swap, or a reserve to bring on.`, false)
  }

  function autoPick() {
    if (!editable || !squad) return
    onInteractionStart()
    setPick(null); setDragging(null); setDropKey(null)
    announce(squad.autoPick() ?? 'Automatic choice: the matchday squad and the best five are picked for you again.')
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

  /** Withdraws a change still waiting for a stoppage (owner feedback, 22 November 2026): one tap, a key or a drag back to the bench. */
  function cancel(outId: string) {
    if (disabled || complete) return
    onInteractionStart()
    const request = match.pendingSubstitutions[side].find(item => item.outId === outId)
    let applied = false
    apply(current => { const next = cancelSubstitution(current, side, outId); applied = true; return next })
    setPick(null); setDragging(null); setDropKey(null)
    if (applied) announce(`Change cancelled: ${name(outId)} stays on${request ? `, ${name(request.inId)} stays on the bench` : ''}.`)
  }
  const cancelLabel = (request: { outId: string; inId: string }) => `Cancel substitution: ${name(request.outId)} stays on, ${name(request.inId)} stays on the bench`
  /** A queued reserve dragged back onto the bench withdraws his change. */
  const queuedDrag = dragging?.kind === 'bench' ? pending.find(request => request.inId === dragging.playerId) : undefined
  const benchDropHandlers = {
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!editable || !queuedDrag) return
      event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropKey('bench')
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => { if (dropKey === 'bench' && (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget))) setDropKey(null) },
    onDrop: (event: DragEvent<HTMLElement>) => {
      if (!editable) return
      try {
        const data: unknown = JSON.parse(event.dataTransfer.getData(DRAG_TYPE))
        if (!data || typeof data !== 'object' || !('identity' in data) || !('source' in data) || data.identity !== identity) return
        const source = data.source as CourtPick
        const request = source && typeof source === 'object' && source.kind === 'bench' ? pending.find(item => item.inId === source.playerId) : undefined
        if (request) { event.preventDefault(); cancel(request.outId) }
      } catch { /* not a drag from this court picture */ }
      finally { setDragging(null); setDropKey(null) }
    },
  }

  function clearSelection() {
    setPick(null); setDragging(null); setDropKey(null)
    announce('Selection cleared.')
  }

  function beginDrag(event: DragEvent<HTMLElement>, source: Pick) {
    if (!selectable(source)) { event.preventDefault(); return }
    onInteractionStart()
    // Nothing above the court may change height while a drag starts: a moving drag source cancels the drag.
    setPick(null); setDragging(source)
    event.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ identity, source }))
    event.dataTransfer.effectAllowed = 'move'
  }
  const dropHandlers = (target: Target) => ({
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!editable || !dragging || !resolve(dragging, target)) return
      // A player in a list is a drop target inside the list's own: the nearer target wins.
      event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'; setDropKey(pickKey(target))
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDropKey(null) },
    onDrop: (event: DragEvent<HTMLElement>) => {
      if (!editable) return
      event.preventDefault(); event.stopPropagation()
      try {
        const data: unknown = JSON.parse(event.dataTransfer.getData(DRAG_TYPE))
        if (!data || typeof data !== 'object' || !('identity' in data) || !('source' in data) || data.identity !== identity) return
        const resolved = isPick(data.source) ? resolve(data.source, target) : null
        if (resolved) perform(resolved)
      } catch { announce('Drag a player from this match onto a circle.', false) }
      finally { setDragging(null); setDropKey(null) }
    },
  })
  const dragEnd = () => { setDragging(null); setDropKey(null) }

  // The picked or dragged item: it is highlighted and the places it can go are marked.
  const active = dragging ?? pick
  const required = match.requiredSubstitutions.find(request => request.side === side)
  const help = complete ? 'Match finished · substitutions closed.'
    : required ? `Replacement needed: tap a reserve, then the circle of ${name(required.playerId)} (${required.reason === 'injured' ? 'injured' : 'fouled out'}).`
    : squad ? `Your five and bench for the next game. Drag a player between the court, the bench${squad.reservesOpen ? ' and Reserves' : ''}, or tap a player and then a place.`
    : planning ? 'Your five for the next game. Drag a player onto a circle, or tap a player and then a circle.'
    : pregame ? 'Drag a player onto a circle, or tap a player and then a circle. Changes before tip-off apply at once.'
      : pending.length ? 'A change waits for the next stoppage. Tap Cancel, or drag the reserve back to the bench, to withdraw it.'
      : 'Drag or tap a reserve onto a circle: he comes on at the next legal stoppage. Players on court swap circles at once.'

  /** One player row of the bench or the reserves: tap or drag him, or drop a picked player on him to swap. */
  const playerRow = (player: Player, target: Pick & { playerId: string }) => {
    const key = pickKey(target), stats = target.kind === 'bench' ? shown.stats[player.id] : undefined
    const unavailable = target.kind === 'reserve' ? squad?.unavailable(player.id) ? 'Injured' : null : match.injuries[player.id] ? 'Injured' : stats && stats.fouls >= 5 ? 'Fouled out' : null
    const queued = target.kind === 'bench' ? pending.find(request => request.inId === player.id) : undefined
    const isSelected = !!active && pickKey(active) === key
    const resolved = active && !isSelected ? resolve(active, target) : null
    const move = resolved?.kind === 'court' ? resolved.move : null
    const live = squad ? selectable(target) : usable(player.id)
    const condition = stats ? stats.condition : squad?.condition(player.id) ?? 100
    const action = resolved?.kind === 'squad' ? describeSquadMove(resolved.playerId, resolved.spot)
      : move ? `Bring on ${player.name} at ${move.position} for ${name(occupantOf(circles, move.position))}`
      : live ? `${isSelected ? 'Deselect' : 'Select'} ${player.name}, ${player.position}, ${Math.round(condition)}% stamina, then choose ${squad ? 'a place' : 'a circle'}` : null
    const identityMarkup = <><span aria-hidden="true"><Avatar player={player} color={team.color} size={30} /></span><span className="court-five-reserve-identity"><strong>{player.name}</strong><span>#{player.number} · {player.position}<Nationality country={nationalityOf?.(player.id) ?? null} compact />{stats && stats.fouls > 0 ? <span className={stats.fouls >= 4 ? 'lineup-foul-trouble' : ''}> · {stats.fouls} {stats.fouls === 1 ? 'foul' : 'fouls'}</span> : null}</span></span></>
    return <li key={player.id} className={`court-five-reserve${isSelected ? ' is-selected' : ''}${resolved ? ' is-target' : ''}${dropKey === key ? ' is-drop' : ''}${unavailable ? ' is-unavailable' : ''}`} data-player-id={player.id} {...(editable && (live || resolved) ? dropHandlers(target) : {})}>
      {live || resolved ? <button type="button" className="court-five-reserve-pick" {...(target.kind === 'bench' ? { 'data-court-reserve': player.id } : { 'data-squad-reserve': player.id })} aria-pressed={resolved ? undefined : isSelected} aria-label={action!} draggable={live} onClick={event => choose(target, event.detail === 0)} onDragStart={event => beginDrag(event, target)} onDragEnd={dragEnd}>{identityMarkup}</button> : <div className="court-five-reserve-pick">{identityMarkup}</div>}
      <span className="court-five-reserve-ratings"><PlayerRating attributes={player.attributes} position={player.position} knowledge={knowledgeForPlayer?.(player.id)} compact label={`${player.name} ability`} />{showRatings && stats && <MatchRating stats={stats} live compact label={player.name} />}</span>
      <StaminaMeter value={condition} label={`${player.name} stamina`} compact />
      {unavailable ? <span className="court-five-unavailable">{unavailable}</span> : queued && <span className="court-five-queued-label court-five-reserve-queued">Queued on for {shortName(name(queued.outId))}{editable && <button type="button" className="button small lineup-cancel-sub" data-cancel-bench-sub={queued.outId} aria-label={cancelLabel(queued)} onClick={() => cancel(queued.outId)}><Icon name="close" size={12} />Cancel</button>}</span>}
    </li>
  }
  /** Squad page: a list heading takes a picked player by tap or key, and the whole list takes a drop. */
  const areaButton = (area: 'bench-area' | 'reserves-area') => {
    // Only for a tap or key pick: a button appearing while a drag starts would move the lists under the pointer.
    const resolved = pick && !dragging ? resolve(pick, { kind: area }) : null
    return resolved?.kind === 'squad' ? <button type="button" className="button small court-five-move-here" data-squad-area={area === 'bench-area' ? 'bench' : 'reserves'} aria-label={describeSquadMove(resolved.playerId, resolved.spot)} onClick={event => choose({ kind: area }, event.detail === 0)}>Move here</button> : null
  }
  const matchdayCount = team.players.length
  const benchList = <div id={benchId} className={`court-five-bench${dropKey === 'bench' || dropKey === 'bench-area' ? ' is-drop' : ''}`} hidden={!benchOpen} {...(editable ? squad ? dropHandlers({ kind: 'bench-area' }) : benchDropHandlers : {})}>
    <div className="court-five-bench-heading"><h4>Bench</h4><span>{queuedDrag ? 'Drop here to cancel his change' : squad?.reservesOpen ? `${bench.length} ${bench.length === 1 ? 'player' : 'players'} · ${matchdayCount}/${squad.limit} in the matchday squad` : `${bench.length} ${bench.length === 1 ? 'player' : 'players'} · stamina recovers while resting`}</span>{squad && areaButton('bench-area')}</div>
    {showRatings && bench.length > 1 && <div className="court-five-sort" role="group" aria-label="Sort the bench"><span aria-hidden="true">Sort:</span>{([['position', 'Position'], ['rating', 'Match rating']] as const).map(([value, text]) => <button key={value} type="button" className={benchSort === value ? 'selected' : ''} aria-pressed={benchSort === value} data-bench-sort={value} onClick={() => setBenchSort(value)}>{text}</button>)}</div>}
    {bench.length ? <ul aria-label={`${team.name} bench`}>{bench.map(player => playerRow(player, { kind: 'bench', playerId: player.id }))}</ul> : <p className="lineup-empty">No reserves in the matchday squad.</p>}
  </div>
  const reserves = squad ? sortBench(squad.reserves, {}, 'position') : []
  const reservesList = <div className={`court-five-bench court-five-reserves${dropKey === 'reserves-area' ? ' is-drop' : ''}`} data-squad-reserves {...(editable ? dropHandlers({ kind: 'reserves-area' }) : {})}>
    <div className="court-five-bench-heading"><h4>Reserves</h4><span>{reserves.length} {reserves.length === 1 ? 'player' : 'players'} · not in the matchday squad</span>{areaButton('reserves-area')}</div>
    {reserves.length ? <ul aria-label={`${team.name} reserves`}>{reserves.map(player => playerRow(player, { kind: 'reserve', playerId: player.id }))}</ul> : <p className="lineup-empty">Every first-team player is in the matchday squad. Drag a player here to leave him out.</p>}
  </div>

  return <div className="court-five" onKeyDown={event => { if (event.key === 'Escape' && pick) { event.preventDefault(); clearSelection() } }}>
    <div className="court-five-controls">
      <p className="court-five-help">{help}</p>
      <div className="court-five-actions">
        <button type="button" className="text-button court-five-clear" onClick={clearSelection} disabled={disabled || !pick}><Icon name="close" size={13} />Clear</button>
        <button type="button" className="button small court-five-best" data-best-five onClick={bestFive} disabled={!editable} title="Fill the five circles with your best healthy players, each in a fitting position">Best five</button>
        {squad && <button type="button" className="button small court-five-best" data-auto-pick onClick={autoPick} disabled={!editable} title="Back to the automatic choice: the matchday squad and the best five are picked for you">Auto-pick</button>}
      </div>
    </div>
    <p ref={status} className="court-five-status" tabIndex={-1} role="status" aria-live="polite">{announcement}</p>
    {pending.length > 0 && <ul className="lineup-queued-changes court-five-queued" aria-label="Pending substitutions">{pending.map(request => <li key={request.outId}><span><strong>Waiting for a stoppage</strong> {name(request.inId)} on for {name(request.outId)}{circles[request.outId] ? ` at ${circles[request.outId]}` : ''}</span><button type="button" className="button small lineup-cancel-sub" data-cancel-lineup-sub={request.outId} aria-label={cancelLabel(request)} onClick={() => cancel(request.outId)} disabled={disabled || complete}><Icon name="close" size={13} />Cancel</button></li>)}</ul>}
    <div className="court-five-layout" onPointerDownCapture={editable ? onInteractionStart : undefined}>
      <div ref={court} className="court-five-court" role="group" aria-label={`${team.name} ${pregame ? 'starting five' : 'on court'}: five positions`}>
        <svg className="court-five-lines" viewBox="0 0 150 150" aria-hidden="true" focusable="false" preserveAspectRatio="none">
          <rect x="1" y="1" width="148" height="148" rx="2" />
          {/* Drawn with the basket at the bottom and turned upside down: the basket is at the top of the picture. */}
          <g transform="matrix(1 0 0 -1 0 150)">
            <rect className="court-five-paint" x="50.5" y="92" width="49" height="57" />
            <path d="M57 92a18 18 0 0 0 36 0" />
            <path d="M57 92a18 18 0 0 1 36 0" strokeDasharray="3 3" />
            <path d="M9 149V118A67.5 67.5 0 0 1 141 118V149" />
            <path d="M57 1a18 18 0 0 0 36 0" />
            <circle cx="75" cy="135" r="2.6" />
            <path d="M68 140h14" />
          </g>
        </svg>
        {COURT_PICTURE_SPOTS.map(({ position, left, top }) => {
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
          const resolved = active && !isSelected ? resolve(active, target) : null
          const move = resolved?.kind === 'court' ? resolved.move : null
          const live = editable && (!!resolved || !!occupantOf(circles, position))
          const condition = stats ? Math.round(stats.condition) : 0
          const rating = showRatings && stats ? playerMatchRating(stats) : null
          const ratingNote = showRatings && stats ? `, match rating ${rating === null ? 'not yet' : rating.toFixed(1)}` : ''
          const description = player ? `${position}, ${POSITION_NAMES[position]}: ${player.name}, number ${player.number}, listed ${player.position}${warning ? `, ${warning.toLowerCase()}` : listedNote ? ', plays his listed position until you place him' : ''}, ${condition}% stamina${ratingNote}${unavailable ? `, ${unavailable.toLowerCase()}` : ''}` : `${position}, ${POSITION_NAMES[position]}: empty`
          const action = !editable ? null : resolved?.kind === 'squad' ? describeSquadMove(resolved.playerId, resolved.spot) : move ? move.playerId === occupantId ? `Move ${name(occupantId)} to ${position}` : occupantId && active?.kind === 'circle' ? `Swap: ${name(move.playerId)} to ${position}, ${name(occupantId)} to ${active.position}` : `Put ${name(move.playerId)} in ${position}${occupantId ? ` for ${name(occupantId)}` : ''}` : isSelected ? 'Deselect' : occupantId ? 'Select' : null
          return <div key={position} className={`court-five-spot court-five-spot-${position.toLowerCase()}${isSelected ? ' is-selected' : ''}${resolved ? ' is-target' : ''}${dropKey === key ? ' is-drop' : ''}${warning ? ' is-out-of-position' : ''}${unavailable ? ' is-unavailable' : ''}`} data-court-spot={position} style={{ left: `${left}%`, top: `${top}%` }} {...(editable ? dropHandlers(target) : {})}>
            <button type="button" className="court-five-circle" data-court-circle={position} data-player-id={player?.id} aria-pressed={live && !resolved ? isSelected : undefined} aria-label={action ? `${action}. ${description}` : description} title={player?.name} disabled={!live} draggable={editable && !!occupantOf(circles, position)} onClick={event => choose(target, event.detail === 0)} onDragStart={event => beginDrag(event, target)} onDragEnd={dragEnd}>
              <span className="court-five-ring"><span className="court-five-position">{position}</span><span className="court-five-number">{player ? player.number : '—'}</span>{player && stats && showRatings && <MatchRating stats={stats} live compact className="court-five-rating" label={player.name} />}</span>
              <strong className="court-five-name">{player ? shortName(player.name) : 'Empty'}</strong>
            </button>
            {player && stats && <StaminaMeter value={stats.condition} label={`${player.name} stamina`} compact />}
            {player && stats && !pregame && stats.fouls > 0 && <span className={`court-five-fouls${stats.fouls >= 4 ? ' is-trouble' : ''}`}>{stats.fouls} {stats.fouls === 1 ? 'foul' : 'fouls'}</span>}
            {warning && <span className="court-five-warning" data-out-of-position={position}>{warning}</span>}
            {listedNote && <span className="court-five-listed" title="The automatic choice: he plays his listed position without a penalty. Put him in a circle yourself to change the position he plays.">{listedNote}</span>}
            {unavailable && <span className="court-five-unavailable">{unavailable}</span>}
            {queued && (editable ? <button type="button" className="court-five-queued-label court-five-undo" data-cancel-court-sub={queued.outId} aria-label={cancelLabel(queued)} title="Cancel this change" onClick={() => cancel(queued.outId)}><Icon name="close" size={12} />Sub: {shortName(name(queued.inId))}</button> : <span className="court-five-queued-label">Sub queued: {shortName(name(queued.inId))}</span>)}
          </div>
        })}
      </div>
      {squad ? <div className="court-five-side">{benchList}{squad.reservesOpen && reservesList}</div> : benchList}
    </div>
  </div>
}
