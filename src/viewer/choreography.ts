import type { CourtBallPoint, CourtPoint, CourtPosition, MatchEvent, Position, Side } from '../domain/types'

/**
 * Turns one recorded match event into a short animation: player paths, poses and the ball's flight.
 * Presentation only: it reads the event and its saved court scene, never the simulation, and never changes either.
 * Every animation starts at the scene's start positions and ends exactly at its end positions and ball point,
 * so consecutive animations join without jumps.
 */

export interface RosterEntry { side: Side; position: Position; name: string }
export type Roster = ReadonlyMap<string, RosterEntry>

export type PlayKind = 'setup' | 'transition' | 'free-throw-setup' | 'pass' | 'drive' | 'pick-and-roll' | 'screen' | 'post-up' | 'fast-break' | 'shot' | 'dunk' | 'block' | 'free-throw' | 'rebound' | 'steal' | 'turnover'
  // The continuous broadcast (src/viewer/flow.ts) adds the moments between and around the recorded actions.
  | 'jump-ball' | 'inbound' | 'bring-up' | 'press' | 'half-court' | 'hold' | 'set' | 'foul' | 'violation' | 'out-of-bounds' | 'kicked-ball' | 'held-ball'
  | 'timeout' | 'substitution' | 'injury' | 'period-end' | 'period-start' | 'final' | 'whistle'
export type Pose = 'stand' | 'run' | 'dribble' | 'shoot' | 'block' | 'reach' | 'box-out' | 'screen' | 'defend' | 'catch' | 'hand-up' | 'down' | 'walk'
export type Role = 'handler' | 'passer' | 'receiver' | 'shooter' | 'screener' | 'blocker' | 'rebounder' | 'stealer' | 'contest'

export type Anchor = { playerId: string } | { point: CourtBallPoint }
export interface BallSegment {
  kind: 'hold' | 'dribble' | 'pass' | 'shot' | 'deflect' | 'bounce' | 'roll' | 'drop'
  from: Anchor
  to: Anchor
  start: number
  end: number
  arc: number
  /** Ball height while held (from and to of the segment); defaults to hand height. */
  heights?: [number, number]
}
interface Waypoint { t: number; x: number; y: number }
interface Timed<T> { start: number; end: number; value: T }
export interface PlayerTrack {
  playerId: string
  side: Side
  path: Waypoint[]
  poses: Timed<Pose>[]
  lifts: Timed<number>[]
  base: Pose
}
export interface Mark { kind: 'score' | 'miss' | 'block' | 'steal' | 'screen' | 'turnover' | 'call' | 'info'; label: string; at: { playerId: string } | { point: CourtPoint }; start: number; end: number }
export interface Animation {
  eventId: number
  kind: PlayKind
  offense: Side
  durationMs: number
  hoop: CourtPoint
  tracks: PlayerTrack[]
  ball: BallSegment[]
  actors: { playerId: string; role: Role }[]
  marks: Mark[]
  result?: 'make' | 'miss' | 'block' | 'steal' | 'out'
  /** The three referees' paths (the continuous broadcast, src/viewer/flow.ts); `signal` is the one making the call. */
  refs?: { path: Waypoint[] }[]
  signal?: number
}
export interface PlayerFrame { playerId: string; side: Side; x: number; y: number; pose: Pose; lift: number; stride: number }
export interface Frame {
  players: PlayerFrame[]
  ball: CourtBallPoint & { holderId?: string }
  /** The ball's current flight, for a faint arc; absent while the ball is held or in reduced motion. */
  flight?: { from: CourtBallPoint; to: CourtBallPoint; arc: number; kind: BallSegment['kind'] }
  marks: { kind: Mark['kind']; label: string; x: number; y: number; alpha: number }[]
}

export const HAND_HEIGHT = 1.25
const RIM_HEIGHT = 3.05
const metres = (a: CourtPoint, b: CourtPoint) => Math.hypot((a.x - b.x) * 28, (a.y - b.y) * 15)
const clamp01 = (n: number) => Math.max(0, Math.min(1, n))
const bound = (n: number) => Math.max(.02, Math.min(.98, n))
/** Players accelerate over the first fifth of a move, run at an even speed, then slow over the last fifth. */
const EASE_RAMP = .2
const ease = (u: number) => u < EASE_RAMP ? u * u / (2 * EASE_RAMP * (1 - EASE_RAMP)) : u <= 1 - EASE_RAMP ? (u - EASE_RAMP / 2) / (1 - EASE_RAMP) : 1 - (1 - u) ** 2 / (2 * EASE_RAMP * (1 - EASE_RAMP))
const other = (side: Side): Side => side === 'home' ? 'away' : 'home'
const isBig = (position?: Position) => position === 'PF' || position === 'C'
const surname = (name: string) => name.split(' ').at(-1) ?? name

export function hoopFor(period: number, offense: Side): CourtPoint {
  return { x: (offense === 'home') === (period <= 2) ? 26.425 / 28 : 1.575 / 28, y: .5 }
}

/** Finds the named player of one side from an event sentence ("Brown blocks Larkin."). */
function named(roster: Roster, side: Side, name: string | undefined, candidates: readonly string[]): string | undefined {
  if (!name) return undefined
  return candidates.find(id => roster.get(id)?.side === side && roster.get(id)?.name === name.trim())
}
function nearest(points: readonly CourtPosition[], target: CourtPoint, filter: (id: string) => boolean): string | undefined {
  let best: string | undefined, distance = Infinity
  for (const point of points) {
    if (!filter(point.playerId)) continue
    const d = metres(point, target)
    if (d < distance) { distance = d; best = point.playerId }
  }
  return best
}
/** A point `m` metres from `from` toward `to` (court metres, not normalized units). */
function toward(from: CourtPoint, to: CourtPoint, m: number): CourtPoint {
  const dx = (to.x - from.x) * 28, dy = (to.y - from.y) * 15, length = Math.hypot(dx, dy) || 1
  return { x: bound(from.x + dx / length * m / 28), y: bound(from.y + dy / length * m / 15) }
}

/** A short-lived deviation from the base path that returns to it, so the animation still ends on the scene. */
function detour(track: PlayerTrack, point: CourtPoint, out: number, holdUntil: number, back = 1): void {
  const base = (t: number) => pathAt(track.path, t)
  const from = base(out * .2), to = base(back)
  track.path = [
    { t: 0, x: track.path[0]!.x, y: track.path[0]!.y },
    ...(out > .05 ? [{ t: out * .2, ...from }] : []),
    { t: out, ...point },
    { t: Math.max(out, holdUntil), ...point },
    { t: back, ...to },
    ...(back < 1 ? [{ t: 1, ...base(1) }] : []),
  ]
}
function delay(track: PlayerTrack, start: number, end = 1): void {
  const first = track.path[0]!, last = track.path.at(-1)!
  track.path = [{ t: 0, x: first.x, y: first.y }, { t: start, x: first.x, y: first.y }, { t: end, x: last.x, y: last.y }, ...(end < 1 ? [{ t: 1, x: last.x, y: last.y }] : [])]
}
const still = (a: Waypoint | undefined, b: Waypoint | undefined) => !a || !b || Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6
/**
 * Where a player is at time t of his path. A player speeds up only when starting from a standstill and slows only
 * before stopping; through a waypoint in the middle of a run he keeps moving (a cut, a curl, a lane run).
 */
export function pathAt(path: readonly Waypoint[], t: number): CourtPoint {
  if (t <= path[0]!.t) return { x: path[0]!.x, y: path[0]!.y }
  for (let index = 1; index < path.length; index += 1) {
    const a = path[index - 1]!, b = path[index]!
    if (t <= b.t) {
      if (b.t <= a.t) return { x: b.x, y: b.y }
      const local = (t - a.t) / (b.t - a.t)
      const fromRest = index === 1 || still(path[index - 2], a), toRest = index === path.length - 1 || still(b, path[index + 1])
      const u = fromRest && toRest ? ease(local) : ramp(local, fromRest ? EASE_RAMP : 0, toRest ? EASE_RAMP : 0)
      return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u }
    }
  }
  const last = path.at(-1)!
  return { x: last.x, y: last.y }
}
/** A trapezoid speed profile: `up` of the leg speeding up, `down` of it slowing down (either may be zero). */
function ramp(u: number, up: number, down: number): number {
  const v = 1 / (1 - up / 2 - down / 2)
  if (up > 0 && u < up) return v * u * u / (2 * up)
  if (down > 0 && u > 1 - down) return 1 - v * (1 - u) ** 2 / (2 * down)
  return v * (u - up / 2)
}

function setPose(track: PlayerTrack | undefined, pose: Pose, start: number, end: number, lift = 0): void {
  if (!track) return
  track.poses.push({ start, end, value: pose })
  if (lift) track.lifts.push({ start, end, value: lift })
}

/** Scene kinds that come from a sporting action. Setup scenes after a substitution or period start use the same mapping. */
export function buildAnimation(event: MatchEvent, roster: Roster): Animation | null {
  const scene = event.scene
  if (!scene) return null
  const offense = scene.offense, defense = other(offense)
  const hoop = hoopFor(event.period, offense)
  const ends = new Map(scene.end.map(point => [point.playerId, point]))
  const tracks: PlayerTrack[] = scene.end.map(end => {
    const start = scene.start.find(point => point.playerId === end.playerId) ?? end
    const side = roster.get(end.playerId)?.side ?? offense
    return { playerId: end.playerId, side, path: [{ t: 0, x: start.x, y: start.y }, { t: 1, x: end.x, y: end.y }], poses: [], lifts: [], base: side === offense ? 'stand' : 'defend' }
  })
  const track = (id?: string) => id ? tracks.find(item => item.playerId === id) : undefined
  const ids = tracks.map(item => item.playerId)
  const onSide = (side: Side) => (id: string) => (roster.get(id)?.side ?? offense) === side
  const actors: Animation['actors'] = []
  const marks: Mark[] = []
  const ball: BallSegment[] = []
  const target = (point: CourtBallPoint): Anchor => ({ point })
  const startOf = (id: string) => scene.start.find(point => point.playerId === id) ?? ends.get(id)!
  const maxRun = Math.max(0, ...tracks.map(item => metres(item.path[0]!, item.path.at(-1)!)))
  let kind: PlayKind
  let durationMs: number
  let result: Animation['result']

  // Defenders react a beat after the attack moves.
  const defendersLag = (start = .12) => tracks.filter(item => item.side === defense).forEach(item => delay(item, start))

  if (scene.kind === 'pass' && event.playerId && event.receiverId && track(event.playerId) && track(event.receiverId)) {
    kind = 'pass'; durationMs = 700
    actors.push({ playerId: event.playerId, role: 'passer' }, { playerId: event.receiverId, role: 'receiver' })
    delay(track(event.receiverId)!, 0, .72)
    defendersLag()
    ball.push({ kind: 'hold', from: { playerId: event.playerId }, to: { playerId: event.playerId }, start: 0, end: .2, arc: 0 })
    ball.push({ kind: 'pass', from: { playerId: event.playerId }, to: { playerId: event.receiverId }, start: .2, end: .74, arc: Math.max(.35, scene.ball.arcHeight) })
    ball.push({ kind: 'hold', from: { playerId: event.receiverId }, to: { playerId: event.receiverId }, start: .74, end: 1, arc: 0 })
    setPose(track(event.playerId), 'catch', 0, .3)
    // A lob (alley-oop) is caught in the air.
    setPose(track(event.receiverId), 'catch', .6, 1, /throws the lob/.test(event.text) ? .55 : 0)
  } else if (scene.kind === 'drive' && event.playerId && track(event.playerId)) {
    const handler = event.playerId, handlerStart = startOf(handler)
    actors.push({ playerId: handler, role: 'handler' })
    // The earlier engine names every drive alike, so its screens are inferred; the richer play model (format 79) names
    // the action: a screen of its own, coming off it, a post-up or a fast break.
    const legacy = /drives toward the basket\.$/.test(event.text)
    const offScreen = /off the screen|turns the corner/.test(event.text)
    const post = /backs down|drop step|faces up|into a hook/.test(event.text)
    const transition = /fast break|races up the floor|pushes for a quick shot/.test(event.text)
    const screener = legacy && metres(handlerStart, hoop) > 5.5 && !isBig(roster.get(handler)?.position)
      ? nearest(scene.start, handlerStart, id => id !== handler && onSide(offense)(id) && isBig(roster.get(id)?.position)) : undefined
    const handlerDefender = nearest(scene.start, handlerStart, onSide(defense))
    const setScreener = offScreen ? nearest(scene.start, handlerStart, id => id !== handler && onSide(offense)(id)) : undefined
    if (setScreener && track(setScreener)) {
      // Coming off a screen already set: the screener holds, the handler's defender is caught on it.
      kind = 'pick-and-roll'; durationMs = 1100
      actors.push({ playerId: setScreener, role: 'screener' })
      setPose(track(setScreener), 'screen', 0, .35)
      delay(track(setScreener)!, .3)
      if (handlerDefender) delay(track(handlerDefender)!, .4)
      tracks.filter(item => item.side === defense && item.playerId !== handlerDefender).forEach(item => delay(item, .15))
    } else if (post) {
      // Backing down: slow, shoulder to chest with the defender, who gives ground.
      kind = 'post-up'; durationMs = 1250
      if (handlerDefender) { delay(track(handlerDefender)!, .1); setPose(track(handlerDefender), 'box-out', 0, 1) }
      tracks.filter(item => item.side === defense && item.playerId !== handlerDefender).forEach(item => delay(item, .2))
    } else if (transition) {
      kind = 'fast-break'; durationMs = maxRun > 10 ? 1300 : 1000
      tracks.filter(item => item.side === defense).forEach(item => delay(item, .22))
    } else if (screener) {
      kind = 'pick-and-roll'; durationMs = 1350
      actors.push({ playerId: screener, role: 'screener' })
      // The big steps up beside the ball handler's defender, holds the screen, then rolls back toward the rim.
      const defenderPoint = handlerDefender ? startOf(handlerDefender) : toward(handlerStart, hoop, 1.2)
      const screenSpot = toward(defenderPoint, { x: defenderPoint.x, y: startOf(screener).y }, .8)
      detour(track(screener)!, screenSpot, .3, .48)
      setPose(track(screener), 'screen', .28, .5)
      delay(track(handler)!, .3)
      if (handlerDefender) delay(track(handlerDefender)!, .5)
      tracks.filter(item => item.side === defense && item.playerId !== handlerDefender).forEach(item => delay(item, .35))
      marks.push({ kind: 'screen', label: 'SCREEN', at: { playerId: screener }, start: .25, end: .55 })
    } else {
      kind = 'drive'; durationMs = 1000
      if (handlerDefender) delay(track(handlerDefender)!, .1)
      tracks.filter(item => item.side === defense && item.playerId !== handlerDefender).forEach(item => delay(item, .15))
    }
    ball.push({ kind: 'dribble', from: { playerId: handler }, to: { playerId: handler }, start: 0, end: 1, arc: 0 })
    setPose(track(handler), 'dribble', 0, 1)
  } else if ((scene.kind === 'shot' || scene.kind === 'free-throw') && event.playerId && track(event.playerId)) {
    const shooter = event.playerId, freeThrow = scene.kind === 'free-throw'
    const made = event.shot?.made ?? (freeThrow ? /\bmakes\b/.test(event.text) : metres(scene.ball.to, hoop) < .3 && scene.ball.to.height >= 2.9)
    const blockMatch = /^(.+?) blocks /.exec(event.text)
    actors.push({ playerId: shooter, role: 'shooter' })
    if (blockMatch && !freeThrow) {
      kind = 'block'; durationMs = 1150; result = 'block'
      const shooterAt = startOf(shooter)
      const blocker = named(roster, defense, blockMatch[1], ids) ?? event.shot?.defenderId ?? nearest(scene.start, shooterAt, onSide(defense))
      const contact: CourtBallPoint = { ...toward(shooterAt, hoop, .45), height: 2.75 }
      ball.push({ kind: 'hold', from: { playerId: shooter }, to: { playerId: shooter }, start: 0, end: .2, arc: 0 })
      ball.push({ kind: 'shot', from: { playerId: shooter }, to: target(contact), start: .2, end: .4, arc: .15, heights: [2.1, 2.75] })
      ball.push({ kind: 'deflect', from: target(contact), to: target(scene.ball.to), start: .4, end: 1, arc: .55 })
      setPose(track(shooter), 'shoot', .1, .45, .45)
      if (blocker && track(blocker)) {
        actors.push({ playerId: blocker, role: 'blocker' })
        detour(track(blocker)!, toward(shooterAt, hoop, .55), .32, .55)
        setPose(track(blocker), 'block', .22, .62, .6)
        marks.push({ kind: 'block', label: 'BLOCK', at: { playerId: blocker }, start: .38, end: 1 })
      }
    } else {
      const three = event.shot?.value === 3
      const dunk = !freeThrow && /the dunk|'s dunk|alley-oop/.test(event.text), heave = !freeThrow && /heaves? from long range|banks in a heave/.test(event.text), tip = !freeThrow && /the putback|'s putback|tips it in|tip it in|'s tip-in/.test(event.text)
      kind = freeThrow ? 'free-throw' : dunk ? 'dunk' : 'shot'; durationMs = freeThrow ? 1150 : heave ? 1800 : dunk ? 1000 : tip ? 950 : three ? 1450 : 1300; result = made ? 'make' : 'miss'
      const release = freeThrow ? .3 : dunk || tip ? .28 : .22, rim = made ? dunk ? .5 : .82 : .72
      const rimPoint: CourtBallPoint = { ...hoop, height: RIM_HEIGHT }
      ball.push({ kind: 'hold', from: { playerId: shooter }, to: { playerId: shooter }, start: 0, end: release, arc: 0 })
      if (made) {
        ball.push({ kind: 'shot', from: { playerId: shooter }, to: target(scene.ball.to), start: release, end: rim, arc: scene.ball.arcHeight, heights: [2.1, scene.ball.to.height] })
        ball.push({ kind: 'drop', from: target(scene.ball.to), to: target(scene.ball.to), start: rim, end: 1, arc: 0 })
        const value = freeThrow ? 1 : event.shot?.value ?? 2
        marks.push({ kind: 'score', label: `+${value}${!freeThrow && /through the contact/.test(event.text) ? ' AND 1' : ''}`, at: { point: hoop }, start: rim, end: 1 })
        // Format 81: goaltending: the defender swats the ball on its way down; the basket counts.
        const goaltender = /^(.+?) is called for goaltending/.exec(event.text)
        const swatter = goaltender ? named(roster, defense, goaltender[1], ids) ?? event.shot?.defenderId : undefined
        if (swatter && track(swatter)) {
          detour(track(swatter)!, toward(startOf(swatter), hoop, Math.max(0, metres(startOf(swatter), hoop) - .7)), .45, .7)
          setPose(track(swatter), 'block', .45, .8, .7)
          marks.push({ kind: 'call', label: 'GOALTENDING', at: { playerId: swatter }, start: .62, end: 1 })
        }
      } else {
        // Misses hit the rim, then carom to where the ball comes down.
        ball.push({ kind: 'shot', from: { playerId: shooter }, to: target(rimPoint), start: release, end: rim, arc: scene.ball.arcHeight, heights: [2.1, RIM_HEIGHT] })
        ball.push({ kind: 'bounce', from: target(rimPoint), to: target(scene.ball.to), start: rim, end: 1, arc: .55 })
        marks.push({ kind: 'miss', label: 'MISS', at: { point: hoop }, start: rim, end: 1 })
      }
      setPose(track(shooter), 'shoot', freeThrow ? .15 : .08, release + .2, freeThrow ? .08 : dunk ? .85 : event.shot && (event.shot.distanceM ?? 9) < 2 ? .6 : .4)
      const contestId = !freeThrow ? event.shot?.defenderId ?? nearest(scene.start, startOf(shooter), onSide(defense)) : undefined
      if (contestId && track(contestId) && event.shot?.contest !== 'open') {
        actors.push({ playerId: contestId, role: 'contest' })
        detour(track(contestId)!, toward(startOf(contestId), startOf(shooter), Math.max(0, metres(startOf(contestId), startOf(shooter)) - .7)), .25, .45, .9)
        setPose(track(contestId), 'block', .15, .5, .3)
      }
      // Bigs and the shooter's opponents turn to box out as the shot comes down.
      if (!made) tracks.filter(item => item.playerId !== shooter && item.playerId !== contestId && metres(item.path[0]!, hoop) < 6.5).forEach(item => setPose(item, item.side === defense ? 'box-out' : 'reach', rim - .1, 1))
    }
  } else if (scene.kind === 'rebound' && event.playerId && track(event.playerId)) {
    kind = 'rebound'; durationMs = 950
    const rebounder = event.playerId, landing = scene.ball.to
    actors.push({ playerId: rebounder, role: 'rebounder' })
    delay(track(rebounder)!, 0, .5)
    // Players near the rim box out (defenders seal toward the basket) or crash toward the ball, then settle.
    for (const item of tracks) {
      if (item.playerId === rebounder) continue
      const at = item.path[0]!
      if (metres(at, hoop) > 7) continue
      const defending = item.side !== offense
      detour(item, defending ? toward(at, hoop, .7) : toward(at, landing, .8), .3, .55)
      setPose(item, defending ? 'box-out' : 'reach', 0, .6, defending ? 0 : .25)
    }
    ball.push({ kind: 'bounce', from: target(scene.ball.from), to: target({ x: landing.x, y: landing.y, height: 2.35 }), start: 0, end: .5, arc: .5 })
    ball.push({ kind: 'hold', from: { playerId: rebounder }, to: { playerId: rebounder }, start: .5, end: 1, arc: 0, heights: [2.35, landing.height] })
    setPose(track(rebounder), 'reach', .3, .68, .55)
  } else if (scene.kind === 'turnover' && event.playerId && track(event.playerId)) {
    const handler = event.playerId
    const stealMatch = /^(.+?) steals /.exec(event.text)
    const stealer = stealMatch ? named(roster, defense, stealMatch[1], ids) ?? nearest(scene.end, scene.ball.to, onSide(defense)) : undefined
    actors.push({ playerId: handler, role: 'handler' })
    ball.push({ kind: 'dribble', from: { playerId: handler }, to: { playerId: handler }, start: 0, end: .35, arc: 0 })
    if (stealer && track(stealer)) {
      kind = 'steal'; durationMs = 950; result = 'steal'
      actors.push({ playerId: stealer, role: 'stealer' })
      detour(track(stealer)!, toward(startOf(stealer), startOf(handler), Math.max(0, metres(startOf(stealer), startOf(handler)) - .5)), .3, .4)
      setPose(track(stealer), 'reach', .2, .45)
      ball.push({ kind: 'deflect', from: { playerId: handler }, to: { playerId: stealer }, start: .35, end: .6, arc: .12 })
      ball.push({ kind: 'dribble', from: { playerId: stealer }, to: { playerId: stealer }, start: .6, end: 1, arc: 0 })
      marks.push({ kind: 'steal', label: 'STEAL', at: { playerId: stealer }, start: .4, end: 1 })
    } else {
      kind = 'turnover'; durationMs = 950; result = 'out'
      ball.push({ kind: 'roll', from: { playerId: handler }, to: target(scene.ball.to), start: .35, end: 1, arc: .15 })
      const label = turnoverLabel(event)
      marks.push({ kind: 'turnover', label, at: { playerId: handler }, start: .35, end: 1 })
    }
    setPose(track(handler), 'dribble', 0, .35)
  } else if (scene.kind === 'setup' && /^(.+?) sets a ball screen for /.test(event.text)) {
    // A ball screen (format 79): the screener steps up beside the handler's defender and plants; the handler waits.
    kind = 'screen'; durationMs = 900
    const screenerName = /^(.+?) sets a ball screen for /.exec(event.text)![1]
    const screener = named(roster, offense, screenerName, ids)
    const handler = event.playerId && track(event.playerId) ? event.playerId : nearest(scene.end, scene.ball.to, onSide(offense))
    if (handler) { actors.push({ playerId: handler, role: 'handler' }); ball.push({ kind: 'dribble', from: { playerId: handler }, to: { playerId: handler }, start: 0, end: 1, arc: 0 }); setPose(track(handler), 'dribble', 0, 1) }
    else ball.push({ kind: 'hold', from: target(scene.ball.from), to: target(scene.ball.to), start: 0, end: 1, arc: 0 })
    if (screener && track(screener)) {
      actors.push({ playerId: screener, role: 'screener' })
      setPose(track(screener), 'screen', .55, 1)
      marks.push({ kind: 'screen', label: 'SCREEN', at: { playerId: screener }, start: .45, end: 1 })
    }
    tracks.filter(item => item.side === defense).forEach(item => delay(item, .2))
  } else {
    // Setup scenes: bringing the ball up, transitions after a change of possession, inbounds and free-throw line-ups.
    // The ball ends with the handler (a substitution event names the incoming player instead).
    const holds = (id?: string) => !!id && !!ends.get(id) && metres(ends.get(id)!, scene.ball.to) < .05
    const handler = holds(event.playerId) ? event.playerId : nearest(scene.end, scene.ball.to, id => holds(id)) ?? (event.playerId && track(event.playerId) ? event.playerId : undefined)
    const handlerEnd = handler ? ends.get(handler)! : scene.ball.to
    const freeThrowSet = !!handler && Math.abs(handlerEnd.y - .5) < .01 && Math.abs(Math.abs(handlerEnd.x - .5) - (22.2 / 28 - .5)) < .012 && maxRun < 30 && /free-throw line/.test(event.text)
    kind = freeThrowSet ? 'free-throw-setup' : maxRun > 6 ? 'transition' : 'setup'
    durationMs = freeThrowSet ? 750 : Math.round(Math.min(1700, Math.max(scene.durationMs, 700 + maxRun * 45)))
    if (handler) actors.push({ playerId: handler, role: 'handler' })
    if (kind === 'transition') tracks.filter(item => item.side === defense).forEach(item => delay(item, .06))
    const handlerStart = handler ? startOf(handler) : scene.ball.from
    const loose = metres(scene.ball.from, handlerStart) > .3 || scene.ball.from.height > 2
    let at = 0
    if (handler && scene.ball.from.height >= 2.8) {
      // After a basket the ball drops through the net before it is put back in play.
      const floor: CourtBallPoint = { x: scene.ball.from.x, y: scene.ball.from.y, height: .25 }
      ball.push({ kind: 'drop', from: target(scene.ball.from), to: target(floor), start: 0, end: .15, arc: 0 })
      ball.push({ kind: 'pass', from: target({ ...floor, height: 1.2 }), to: { playerId: handler }, start: .15, end: .5, arc: .4 })
      at = .5
    } else if (handler && loose) {
      ball.push({ kind: 'pass', from: target(scene.ball.from), to: { playerId: handler }, start: 0, end: .4, arc: .35 })
      at = .4
    }
    if (handler) ball.push({ kind: freeThrowSet || maxRun < .3 ? 'hold' : 'dribble', from: { playerId: handler }, to: { playerId: handler }, start: at, end: 1, arc: 0 })
    else ball.push({ kind: 'pass', from: target(scene.ball.from), to: target(scene.ball.to), start: 0, end: 1, arc: scene.ball.arcHeight })
    if (handler && !freeThrowSet && maxRun >= .3) setPose(track(handler), 'dribble', at, 1)
  }
  return { eventId: event.id, kind, offense, durationMs, hoop, tracks, ball, actors, marks, ...(result ? { result } : {}) }
}

/** The referee's call on a turnover, as the court shows it. */
export function turnoverLabel(event: MatchEvent): string {
  const text = event.text
  return event.type === 'shot-clock' ? 'SHOT CLOCK' : /travels/.test(text) ? 'TRAVEL' : /three seconds/.test(text) ? '3 SECONDS' : /8-second/.test(text) ? '8 SECONDS'
    : /5-second/.test(text) ? '5 SECONDS' : /double dribble/.test(text) ? 'DOUBLE DRIBBLE' : /carrying/.test(text) ? 'CARRYING' : /Basket interference/.test(text) ? 'BASKET INTERFERENCE'
      : /backcourt/.test(text) ? 'BACKCOURT' : /out of bounds|steps on the sideline/.test(text) ? 'OUT OF BOUNDS' : 'TURNOVER'
}

function timed<T>(items: readonly Timed<T>[], t: number): T | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) if (t >= items[index]!.start && t <= items[index]!.end) return items[index]!.value
  return undefined
}
function anchorAt(anchor: Anchor, positions: ReadonlyMap<string, CourtPoint>, height: number): CourtBallPoint {
  if ('point' in anchor) return anchor.point
  const point = positions.get(anchor.playerId)
  return point ? { x: point.x, y: point.y, height } : { x: .5, y: .5, height }
}
const flightHeight = (from: number, to: number, arc: number, u: number) => from + (to - from) * u + 4 * arc * u * (1 - u)

/** The positions, poses and ball at a moment of the animation (t from 0 to 1). */
export function frameAt(animation: Animation, progress: number, reduced = false): Frame {
  const t = reduced ? 1 : clamp01(Number.isFinite(progress) ? progress : 1)
  const seconds = animation.durationMs / 1000
  const positions = new Map<string, CourtPoint>()
  const players: PlayerFrame[] = animation.tracks.map(track => {
    const point = pathAt(track.path, t)
    const before = pathAt(track.path, Math.max(0, t - .03)), after = pathAt(track.path, Math.min(1, t + .03))
    const speed = metres(before, after) / Math.max(.001, (Math.min(1, t + .03) - Math.max(0, t - .03)) * seconds)
    const moving = speed > .8
    const pose = timed(track.poses, t) ?? (moving ? 'run' : track.base)
    const lift = (() => {
      for (const item of track.lifts) if (t >= item.start && t <= item.end) return item.value * Math.sin(Math.PI * (t - item.start) / (item.end - item.start))
      return 0
    })()
    // Steps follow the time spent running; defenders in stance shuffle a little.
    const stride = reduced ? 0 : moving ? Math.sin(t * seconds * Math.PI * 2 * 2.6) * Math.min(1, speed / 4) : 0
    const shuffle = !reduced && pose === 'defend' ? Math.sin(t * Math.PI * 4) * .004 : 0
    positions.set(track.playerId, point)
    return { playerId: track.playerId, side: track.side, x: point.x, y: point.y + shuffle, pose, lift, stride }
  })
  // The active ball segment; between segments the ball rests where the last one ended.
  const segments = animation.ball
  let segment = segments[0]
  for (const item of segments) if (t >= item.start) segment = item
  let ballPoint: Frame['ball'] = { x: .5, y: .5, height: HAND_HEIGHT }
  let flight: Frame['flight']
  if (segment) {
    const u = segment.end > segment.start ? clamp01((t - segment.start) / (segment.end - segment.start)) : 1
    const [h0, h1] = segment.heights ?? [HAND_HEIGHT, HAND_HEIGHT]
    if (segment.kind === 'hold' || segment.kind === 'dribble') {
      const holder = 'playerId' in segment.from ? segment.from.playerId : undefined
      const at = anchorAt(segment.from, positions, h0)
      const held = h0 + (h1 - h0) * u
      // Two bounces a second, back in the hand at both ends of the segment.
      const bounces = Math.max(1, Math.round((segment.end - segment.start) * seconds * 2.2))
      const height = segment.kind === 'dribble' && !reduced ? held - (held - .15) * Math.abs(Math.sin(Math.PI * bounces * u)) : held
      ballPoint = { x: at.x, y: at.y, height, ...(holder ? { holderId: holder } : {}) }
    } else if (segment.kind === 'drop') {
      const from = anchorAt(segment.from, positions, h0), to = anchorAt(segment.to, positions, h1)
      ballPoint = { x: from.x + (to.x - from.x) * u, y: from.y + (to.y - from.y) * u, height: from.height + (to.height - from.height) * u * u }
    } else {
      // Flights leave from where the ball was released and meet a moving receiver at the catch.
      const from = anchorAt(segment.from, new Map(animation.tracks.map(track => [track.playerId, pathAt(track.path, segment!.start)])), h0)
      const to = anchorAt(segment.to, positions, h1)
      const finalTo = anchorAt(segment.to, new Map(animation.tracks.map(track => [track.playerId, pathAt(track.path, segment!.end)])), h1)
      const arc = segment.kind === 'roll' ? 0 : segment.arc
      let height = flightHeight(from.height, to.height, arc, u)
      if (segment.kind === 'roll') height = Math.max(.12, to.height + (from.height - to.height) * (1 - u) * Math.abs(Math.cos(Math.PI * 2.5 * u)))
      ballPoint = { x: from.x + (to.x - from.x) * u, y: from.y + (to.y - from.y) * u, height }
      if (!reduced && u < 1) flight = { from, to: finalTo, arc, kind: segment.kind }
    }
  }
  const marks: Frame['marks'] = []
  for (const mark of animation.marks) {
    if (t < mark.start || t > mark.end) continue
    const at = 'point' in mark.at ? mark.at.point : positions.get(mark.at.playerId)
    if (!at) continue
    const age = (t - mark.start) / Math.max(.001, mark.end - mark.start)
    marks.push({ kind: mark.kind, label: mark.label, x: at.x, y: at.y, alpha: reduced ? 1 : Math.min(1, age * 6, (1 - age) * 4 + .25) })
  }
  return { players, ball: ballPoint, ...(flight ? { flight } : {}), marks }
}

/** Roster lookup for every player of both teams. */
export function rosterOf(match: { home: { players: readonly { id: string; position: Position; name: string }[] }; away: { players: readonly { id: string; position: Position; name: string }[] } }): Roster {
  const roster = new Map<string, RosterEntry>()
  for (const side of ['home', 'away'] as const) for (const player of match[side].players) roster.set(player.id, { side, position: player.position, name: player.name })
  return roster
}

/** Presentation length of an event's animation; the simulation clock is unrelated. */
export function presentationDuration(event: MatchEvent, roster: Roster): number {
  return buildAnimation(event, roster)?.durationMs ?? event.scene?.durationMs ?? 0
}

export { surname }
