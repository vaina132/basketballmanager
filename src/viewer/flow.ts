import type { CourtBallPoint, CourtPoint, MatchEvent, Position, Side } from '../domain/types'
import { buildAnimation, hoopFor, pathAt, turnoverLabel } from './choreography'
import type { Animation, BallSegment, Mark, PlayKind, PlayerTrack, Pose, Role, Roster } from './choreography'

/**
 * The continuous broadcast (owner feedback, 22 November 2026 evening: "it is like a tennis match ... I need a more
 * realistic flow, with more details, as if you are watching a real match happening").
 *
 * Presentation only: it reads the recorded events (and their saved court scenes) in order and never the simulation.
 * Each event becomes one or more beats, and every beat starts exactly where the previous one ended, players and ball,
 * so the floor never jumps: after a basket the ball drops through the net and is thrown in from the end line, a
 * defensive rebound is outletted and brought up, dead balls are thrown in from the line where they went out, the time
 * each action took on the game clock is shown as play (the ball handler probing, cuts, screens away, help defence),
 * and every stoppage the engine records gets its moment: the whistle and the call, free-throw line-ups in the lane
 * spaces, timeouts at the benches, substitutions at the scorer's table, the jump ball, the horn.
 *
 * The game clock and the shot clock shown with each beat are worked out from the events (FIBA 2024 rules as the engine
 * applies them), so they run while the ball is live and stop on whistles.
 */

/** Presentation time per second of game clock at 1x (a full game lasts about half an hour at 1x). */
export const PACE_MS = 520
/** Fastest running speed shown, metres per second at 1x (a sprint); passes and shots fly at most `BALL_SPEED`. */
export const SPRINT = 7.2
const JOG = 3.6, WALK = 2.2, BALL_SPEED = 17

export interface Beat {
  key: string
  event: MatchEvent
  animation: Animation
  durationMs: number
  /** The game clock shown, running from `from` to `to` through the beat. */
  clock: { period: number; from: number; to: number }
  /** The shot clock shown (null when it is off: the game clock is below it). */
  shotClock: { from: number; to: number } | null
  /** The score before this beat's event counts. */
  scoreBefore: Record<Side, number>
  caption?: string
  chip?: string
  whistle?: boolean
  /** Further events this beat shows (substitutions at the same stoppage). */
  covers?: MatchEvent[]
}

type P = CourtPoint
interface Waypoint { t: number; x: number; y: number }
interface Live {
  pos: Map<string, P>
  ball: CourtBallPoint
  holder?: string
  period: number
  clock: number
  shot: number
  offense: Side
  frontcourt: boolean
  score: Record<Side, number>
  downed?: string
  started: boolean
  /** The ball is dead (a whistle, out of bounds, a timeout): the next live play starts with a throw-in. */
  dead: boolean
  /** Where the three referees are. */
  refs?: P[]
}

const other = (side: Side): Side => side === 'home' ? 'away' : 'home'
const metres = (a: P, b: P) => Math.hypot((a.x - b.x) * 28, (a.y - b.y) * 15)
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
const lerp = (a: P, b: P, u: number): P => ({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u })
const isBig = (position?: Position) => position === 'PF' || position === 'C'
const surname = (name?: string) => name?.split(' ').at(-1) ?? 'A player'
/** A point `m` metres from `from` toward `to` (never past it); off-court points allowed. */
function toward(from: P, to: P, m: number): P {
  const d = metres(from, to)
  if (d < 1e-6) return { ...from }
  const u = Math.min(1, m / d)
  return lerp(from, to, u)
}
/** `from` moved by metres along the court (dx) and across it (dy). */
const shift = (from: P, dx: number, dy: number): P => ({ x: from.x + dx / 28, y: from.y + dy / 15 })
const onCourt = (p: P): P => ({ x: clamp(p.x, .03, .97), y: clamp(p.y, .04, .96) })
/** A small deterministic number in [0, 1) from an event id and a salt: variety without randomness. */
function vary(id: number, salt: number): number { const x = Math.sin(id * 12.9898 + salt * 78.233) * 43758.5453; return x - Math.floor(x) }

/** Bench and table spots beside the near sideline (FIBA: the home bench left of the scorer's table). */
const TABLE: P = { x: .5, y: -.075 }
const benchSpot = (side: Side, slot: number): P => ({ x: (side === 'home' ? .3 : .7) + (slot - 2) * .035, y: -.085 - (slot % 2) * .02 })

const sideOf = (roster: Roster, id: string, fallback: Side): Side => roster.get(id)?.side ?? fallback

const W = (t: number, p: P): Waypoint => ({ t, x: p.x, y: p.y })
function line(from: P, to: P, t0 = 0, t1 = 1): Waypoint[] {
  return [W(0, from), ...(t0 > 0 ? [W(t0, from)] : []), W(t1, to), ...(t1 < 1 ? [W(1, to)] : [])]
}
function pathLength(path: readonly Waypoint[]): number { let total = 0; for (let i = 1; i < path.length; i += 1) total += metres(path[i - 1]!, path[i]!); return total }
/** The fastest leg of a path in metres per unit of t. */
function pathPace(path: readonly Waypoint[]): number {
  let fastest = 0
  for (let i = 1; i < path.length; i += 1) {
    const span = path[i]!.t - path[i - 1]!.t
    if (span > 1e-6) fastest = Math.max(fastest, metres(path[i - 1]!, path[i]!) / span)
    else if (metres(path[i - 1]!, path[i]!) > 1e-6) fastest = Math.max(fastest, 1e6)
  }
  // Eased legs (a fifth to speed up, a fifth to slow down) peak at 1.25 times their average speed.
  return fastest * 1.25
}

interface Draft {
  kind: PlayKind
  offense: Side
  tracks: PlayerTrack[]
  ball: BallSegment[]
  actors: Animation['actors']
  marks: Mark[]
  minMs: number
  caption?: string
  chip?: string
  whistle?: boolean
  result?: Animation['result']
}

/** The shortest duration that keeps every player under the sprint speed and the ball under its flight speed. */
function minimumDuration(draft: Pick<Draft, 'tracks' | 'ball' | 'minMs'>, positionsAt: (t: number) => Map<string, P>): number {
  let ms = draft.minMs
  for (const track of draft.tracks) ms = Math.max(ms, pathPace(track.path) / SPRINT * 1000)
  for (const segment of draft.ball) {
    if (segment.kind !== 'pass' && segment.kind !== 'shot' && segment.kind !== 'deflect' && segment.kind !== 'roll' && segment.kind !== 'bounce') continue
    const span = segment.end - segment.start
    if (span <= 0) continue
    const a = anchorPoint(segment.from, positionsAt(segment.start)), b = anchorPoint(segment.to, positionsAt(segment.end))
    ms = Math.max(ms, metres(a, b) / span / BALL_SPEED * 1000)
  }
  return Math.round(ms)
}
function anchorPoint(anchor: BallSegment['from'], positions: Map<string, P>): P {
  return 'point' in anchor ? anchor.point : positions.get(anchor.playerId) ?? { x: .5, y: .5 }
}

function finish(event: MatchEvent, period: number, draft: Draft): Animation {
  const positionsAt = (t: number) => new Map(draft.tracks.map(track => [track.playerId, pathAt(track.path, t)]))
  const durationMs = minimumDuration(draft, positionsAt)
  return { eventId: event.id, kind: draft.kind, offense: draft.offense, durationMs, hoop: hoopFor(period, draft.offense), tracks: draft.tracks, ball: restingHeights(draft.ball), actors: draft.actors, marks: draft.marks, ...(draft.result ? { result: draft.result } : {}) }
}
/** A ball resting at a point (not in a player's hands) keeps that point's height. */
function restingHeights(ball: BallSegment[]): BallSegment[] {
  return ball.map(segment => (segment.kind === 'hold' || segment.kind === 'dribble') && 'point' in segment.from && !segment.heights ? { ...segment, heights: [segment.from.point.height, 'point' in segment.to ? segment.to.point.height : segment.from.point.height] as [number, number] } : segment)
}
/** Engine scenes keep their timing unless a player would have to outrun a sprint, or the ball fly too fast. */
function believable(animation: Animation): Animation {
  const positionsAt = (t: number) => new Map(animation.tracks.map(item => [item.playerId, pathAt(item.path, t)]))
  const durationMs = Math.max(animation.durationMs, minimumDuration({ tracks: animation.tracks, ball: animation.ball, minMs: 0 }, positionsAt))
  return { ...animation, ball: restingHeights(animation.ball), durationMs }
}
function track(id: string, side: Side, base: Pose, path: Waypoint[], poses: PlayerTrack['poses'] = [], lifts: PlayerTrack['lifts'] = []): PlayerTrack {
  return { playerId: id, side, base, path, poses, lifts }
}
function standing(live: Live, roster: Roster, offense: Side, except: ReadonlySet<string> = new Set()): PlayerTrack[] {
  return [...live.pos].filter(([id]) => !except.has(id)).map(([id, at]) => {
    const side = sideOf(roster, id, offense)
    return track(id, side, id === live.downed ? 'down' : side === offense ? 'stand' : 'defend', line(at, at))
  })
}
const held = (live: Live): BallSegment['from'] => live.holder && live.pos.has(live.holder) ? { playerId: live.holder } : { point: live.ball }
function ballEnd(animation: Animation): { ball: CourtBallPoint; holder?: string } {
  const last = animation.ball.at(-1)
  if (!last) return { ball: { x: .5, y: .5, height: 1.25 } }
  const end = new Map(animation.tracks.map(item => [item.playerId, pathAt(item.path, 1)]))
  if ('playerId' in last.to) {
    const at = end.get(last.to.playerId) ?? { x: .5, y: .5 }
    return { ball: { x: at.x, y: at.y, height: last.heights?.[1] ?? 1.25 }, holder: last.to.playerId }
  }
  return { ball: { ...last.to.point } }
}

/** Where a team attacks and where its defenders wait. */
const attackHoop = (period: number, side: Side) => hoopFor(period, side)

/** FIBA lane spaces for a free throw: defenders nearest the basket, attackers in the second spaces, the rest outside the arc. */
function laneSpots(period: number, shooting: Side, shooterId: string, players: readonly string[], roster: Roster): Map<string, P> {
  const hoop = attackHoop(period, shooting), dir = hoop.x > .5 ? 1 : -1, end = dir === 1 ? 1 : 0
  const spot = (metresFromEnd: number, top: boolean): P => ({ x: end - dir * metresFromEnd / 28, y: top ? .675 : .325 })
  const result = new Map<string, P>()
  result.set(shooterId, { x: end - dir * 5.8 / 28, y: .5 })
  const attackers = players.filter(id => id !== shooterId && sideOf(roster, id, shooting) === shooting)
  const defenders = players.filter(id => sideOf(roster, id, shooting) !== shooting)
  // Bigs take the lane spaces; guards wait outside the arc.
  const byBig = (ids: string[]) => [...ids].sort((a, b) => Number(isBig(roster.get(b)?.position)) - Number(isBig(roster.get(a)?.position)) || a.localeCompare(b))
  const d = byBig(defenders), a = byBig(attackers)
  const defenceSpots = [spot(2.1, true), spot(2.1, false), spot(4.2, true)]
  const attackSpots = [spot(3.15, true), spot(3.15, false)]
  d.forEach((id, index) => result.set(id, defenceSpots[index] ?? { x: end - dir * 8.6 / 28, y: .38 }))
  a.forEach((id, index) => result.set(id, attackSpots[index] ?? { x: end - dir * (8.4 + index * .3) / 28, y: index % 2 ? .78 : .22 }))
  return result
}

/** The throw-in point for a dead ball at `spot`: the end line near the baseline, otherwise the nearest sideline. */
function throwInPoint(spot: P, line?: 'baseline' | 'sideline'): { point: P; line: 'baseline' | 'sideline' } {
  const nearEnd = Math.min(spot.x, 1 - spot.x) * 28 < 2.2 && Math.abs(spot.y - .5) * 15 < 6
  const chosen = line ?? (nearEnd ? 'baseline' : 'sideline')
  if (chosen === 'baseline') return { line: 'baseline', point: { x: spot.x < .5 ? -.028 : 1.028, y: spot.y < .5 ? clamp(spot.y, .2, .38) : clamp(spot.y, .62, .8) } }
  return { line: 'sideline', point: { x: clamp(spot.x, .07, .93), y: spot.y < .5 ? -.035 : 1.035 } }
}

/** The team foul count of `side` in the event's period (or overtime group) up to and including `index`. */
function teamFoulsAt(events: readonly MatchEvent[], index: number, side: Side): number {
  const period = events[index]!.period
  let count = 0
  for (let i = index; i >= 0; i -= 1) {
    const event = events[i]!
    if (period <= 4 ? event.period !== period : event.period < 4) break
    if (event.type === 'foul' && event.side === side) count += 1
  }
  return count
}

/** Classifies an event for the broadcast. */
type Role2 = 'live' | 'after' | 'stop' | 'skip'
function classify(event: MatchEvent): Role2 {
  switch (event.type) {
    case 'pass': case 'drive': case 'shot': return 'live'
    case 'turnover': case 'shot-clock': return event.scene ? 'live' : 'stop'
    case 'rebound': return 'after'
    case 'command':
      if (event.scene) return /free-throw line/.test(event.text) ? 'stop' : 'live'
      return /out of bounds|Kicked ball|keep the ball after the unsportsmanlike/.test(event.text) ? 'stop' : 'skip'
    case 'tactics': return 'skip'
    default: return 'stop'
  }
}

/** One broadcast for a match's events, built incrementally (cached per match by `broadcastOf`). */
export interface Broadcast { events: readonly MatchEvent[]; beats: Beat[]; live: Live; key: string; checkpoint: { index: number; beats: number; live: Live } }

export function buildBroadcast(events: readonly MatchEvent[], roster: Roster, previous?: Broadcast): Broadcast {
  const reuse = previous && previous.events.length <= events.length && previous.events.every((event, index) => events[index] === event)
  // Extending: the last unit (a group or a stoppage) is built again, since new events may belong to it.
  const beats: Beat[] = reuse ? previous!.beats.slice(0, previous!.checkpoint.beats) : []
  let live: Live = reuse ? cloneLive(previous!.checkpoint.live) : initialLive(events)
  let index = reuse ? previous!.checkpoint.index : 0
  let checkpoint = reuse ? previous!.checkpoint : { index: 0, beats: 0, live: cloneLive(live) }
  while (index < events.length) {
    const event = events[index]!
    const kind = classify(event)
    if (kind === 'skip') { index += 1; continue }
    checkpoint = { index, beats: beats.length, live: cloneLive(live) }
    if (kind === 'live' || kind === 'after') {
      // A group: one live step's actions (all at the same game clock), then the rebound that ends it.
      let end = index + 1
      while (end < events.length && (classify(events[end]!) === 'live' || classify(events[end]!) === 'after') && events[end]!.clockSeconds === event.clockSeconds && events[end]!.period === event.period && !startsStep(events, end)) end += 1
      live = group(events, index, end, roster, live, beats)
      index = end
      continue
    }
    live = stoppage(events, index, roster, live, beats)
    // Substitutions at one stoppage share a beat.
    const covered = beats.at(-1)?.covers?.length ?? 0
    for (let skip = 0; skip < covered; skip += 1) { index += 1; applyAfter(events, index, live); live.score = { ...events[index]!.score } }
    index += 1
  }
  return { events, beats, live, key: '', checkpoint }
}
function startsStep(events: readonly MatchEvent[], index: number): boolean {
  const event = events[index]!, before = events[index - 1]
  return !!before && (before.period !== event.period || before.clockSeconds !== event.clockSeconds)
}
function initialLive(events: readonly MatchEvent[]): Live {
  const tip = events[0]
  const pos = new Map((tip?.scene?.start ?? []).map(point => [point.playerId, { x: point.x, y: point.y }]))
  return { pos, ball: { x: .5, y: .5, height: 1.25 }, period: 1, clock: 600, shot: 24, offense: tip?.side ?? 'home', frontcourt: false, score: { home: 0, away: 0 }, started: false, dead: false }
}
function cloneLive(live: Live): Live {
  return { ...live, pos: new Map([...live.pos].map(([id, at]) => [id, { ...at }])), ball: { ...live.ball }, score: { ...live.score }, ...(live.refs ? { refs: live.refs.map(point => ({ ...point })) } : {}) }
}
/**
 * The three officials (FIBA three-person mechanics, simplified): the lead on the end line under the attacking basket,
 * the centre on the near sideline at the free-throw line extended, the trail on the far sideline behind the ball. At
 * timeouts and period breaks they meet by the scorer's table; at a jump ball one tosses at centre court.
 */
function refSpots(kind: PlayKind, offense: Side, hoop: P, ball: P, from?: readonly P[]): P[] {
  const dir = hoop.x > .5 ? 1 : -1, end = dir === 1 ? 1.018 : -.018
  if (kind === 'timeout' || kind === 'period-end' || kind === 'final') return [{ x: .45, y: .04 }, { x: .5, y: .1 }, { x: .55, y: .04 }]
  if (kind === 'substitution' && from) return from.map(point => ({ ...point }))
  if (kind === 'jump-ball' || kind === 'period-start') return [{ x: .5, y: .43 }, { x: .3, y: -.025 }, { x: .7, y: 1.025 }]
  const freeThrowLine = hoop.x - dir * 5.8 / 28
  if (kind === 'free-throw-setup' || kind === 'free-throw') return [{ x: end, y: .3 }, { x: freeThrowLine, y: -.025 }, { x: freeThrowLine - dir * .02, y: 1.025 }]
  // In the backcourt the officials are still on their way: the trail stays with the ball, the others keep ahead of it.
  const ballX = clamp(ball.x, .03, .97)
  const ahead = (metres: number) => clamp(ballX + dir * metres / 28, .03, .97)
  const deep = Math.abs(ballX - hoop.x) * 28 < 14
  const lead: P = deep ? { x: end, y: ball.y < .5 ? .26 : .36 } : { x: ahead(9), y: -.025 }
  const centre: P = deep ? { x: freeThrowLine, y: -.025 } : { x: ahead(3), y: -.025 }
  const trail: P = { x: clamp(ballX - dir * 2.5 / 28, .05, .95), y: 1.025 }
  return [lead, centre, trail]
}
function nearestRef(refs: readonly P[], ball: P): number {
  let best = 0
  refs.forEach((point, index) => { if (metres(point, ball) < metres(refs[best]!, ball)) best = index })
  return best
}
function push(beats: Beat[], event: MatchEvent, animation: Animation, live: Live, extra: Partial<Beat> = {}): void {
  const n = beats.filter(beat => beat.event === event).length
  beats.push({ key: `${event.id}:${n}`, event, animation, durationMs: animation.durationMs, clock: { period: live.period, from: live.clock, to: live.clock }, shotClock: shotShown(live.clock, live.shot), scoreBefore: { ...live.score }, ...extra })
}
const shotShown = (clock: number, shot: number) => shot > clock + .01 && clock < 24 ? null : { from: shot, to: shot }
/** Ends a beat: players, ball and holder become the live state. */
function adopt(live: Live, animation: Animation): void {
  // The referees move with the play: each beat takes them from where they were to their spots for its end.
  if (!animation.refs) {
    const from = live.refs ?? refSpots('jump-ball', animation.offense, animation.hoop, live.ball)
    const end = ballEnd(animation).ball
    const to = refSpots(animation.kind, animation.offense, animation.hoop, end, from)
    animation.refs = to.map((point, index) => ({ path: line(from[index]!, point, .08, 1) }))
    if (['foul', 'violation', 'out-of-bounds', 'kicked-ball', 'held-ball', 'timeout', 'turnover', 'injury', 'whistle'].includes(animation.kind)) animation.signal = nearestRef(to, end)
    live.refs = to
  } else live.refs = animation.refs.map(item => pathAt(item.path, 1))
  const pos = new Map<string, P>()
  // Players leaving the floor (substitutions) end at their bench, beyond the near sideline.
  for (const item of animation.tracks) { const at = pathAt(item.path, 1); if (at.y > -.06) pos.set(item.playerId, at) }
  live.pos = pos
  const end = ballEnd(animation)
  live.ball = end.ball
  live.holder = end.holder && pos.has(end.holder) ? end.holder : undefined
}

// ---------------------------------------------------------------------------------------------------------------------
// Live play: a step's actions, the time they took on the clock and the off-ball play around them.

function group(events: readonly MatchEvent[], from: number, to: number, roster: Roster, live: Live, beats: Beat[]): Live {
  const first = events[from]!
  const samePeriod = first.period === live.period
  const startClock = samePeriod ? live.clock : first.clockSeconds
  const elapsed = Math.max(0, startClock - first.clockSeconds)
  const startShot = live.shot, wasFrontcourt = live.frontcourt
  interface Item { event: MatchEvent; animation: Animation; extra: Partial<Beat>; running: boolean; before: Live; shotAfter: number }
  const snapshot = cloneLive(live)
  let drafts = buildGroup(events, from, to, roster, live, startShot - elapsed)
  // Time: the clock ran `elapsed` seconds through this step; the beats show it at about PACE_MS a second.
  let running = drafts.filter(item => item.running)
  let natural = running.reduce((sum, item) => sum + item.animation.durationMs, 0)
  const target = elapsed * PACE_MS
  let probes: Item[] = []
  if (target > natural + 450 && running.length) {
    const lead = running[0]!.animation.kind
    const halfCourt = !['bring-up', 'press', 'fast-break', 'transition', 'inbound', 'hold', 'set', 'pass'].includes(lead) && wasFrontcourt || lead === 'pass' && wasFrontcourt && running.length > 1
    if (halfCourt && drafts[0] === running[0]) {
      // The time before the action: the handler probes, the others cut, screen away and relocate; defenders shadow and
      // help; trailers arrive and the set forms where the engine starts the action. Then the action is built from there.
      const core = events[from]!.scene!
      const goal = new Map(core.start.map(point => [point.playerId, { x: point.x, y: point.y }]))
      const restart = cloneLive(snapshot)
      let remaining = Math.min(target - natural, 11_000)
      let salt = 0
      while (remaining > 450) {
        const length = remaining > 6500 ? remaining / 2 : remaining
        salt += 1
        const before = cloneLive(restart)
        const animation = probe(events[from]!, roster, restart, length, salt, remaining - length > 450 ? undefined : goal)
        probes.push({ event: events[from]!, animation, extra: { chip: 'HALF COURT', caption: probeCaption(events[from]!, roster, before, salt) }, running: true, before, shotAfter: startShot - elapsed })
        adopt(restart, animation)
        remaining -= length
      }
      Object.assign(live, restart)
      drafts = buildGroup(events, from, to, roster, live, startShot - elapsed)
      running = drafts.filter(item => item.running)
      natural = running.reduce((sum, item) => sum + item.animation.durationMs, 0)
    } else {
      // Transition and holds: the same movement, shown at a believable speed for the time it took.
      const stretch = Math.min(2.6, target / Math.max(1, natural))
      for (const item of running) item.animation = { ...item.animation, durationMs: Math.round(item.animation.durationMs * stretch) }
    }
  }
  const out: Item[] = [...probes, ...drafts]
  void natural
  // Clocks: both clocks run through the running beats (not through a throw-in before the ball is touched on court).
  const counted = new Set(out.filter(item => item.running && item.animation.kind !== 'inbound'))
  const total = [...counted].reduce((sum, item) => sum + item.animation.durationMs, 0) || 1
  let done = 0
  const scoreBefore = { ...snapshot.score }
  let clock = startClock, shot = startShot
  for (const item of out) {
    let clockFrom = clock, clockTo = clock, shotFrom = shot, shotTo = shot
    if (counted.has(item)) {
      const a = done / total, b = (done + item.animation.durationMs) / total
      clockFrom = startClock - elapsed * a; clockTo = startClock - elapsed * b
      shotFrom = startShot - elapsed * a; shotTo = startShot - elapsed * b
      done += item.animation.durationMs
      clock = clockTo; shot = shotTo
    } else if (item.animation.kind !== 'inbound') { shotFrom = shotTo = item.shotAfter; shot = item.shotAfter }
    const n = beats.filter(beat => beat.event === item.event).length
    beats.push({ key: `${item.event.id}:${n}`, event: item.event, animation: item.animation, durationMs: item.animation.durationMs, clock: { period: first.period, from: clockFrom, to: clockTo },
      shotClock: shotFrom > clockFrom + .01 && clockFrom < 24 ? null : { from: Math.max(0, shotFrom), to: Math.max(0, shotTo) }, scoreBefore: { ...scoreBefore }, ...item.extra })
    if (item.event.score.home !== scoreBefore.home || item.event.score.away !== scoreBefore.away) Object.assign(scoreBefore, item.event.score)
  }
  live.clock = first.clockSeconds
  live.period = first.period
  live.score = { ...events[to - 1]!.score }
  const last = events[to - 1]!
  if (last.type === 'turnover' && !/ steals /.test(last.text) || last.type === 'shot-clock') live.dead = true
  return live
}
type GroupItem = { event: MatchEvent; animation: Animation; extra: Partial<Beat>; running: boolean; before: Live; shotAfter: number }
/** The beats of a group's events, each from where the one before ended (`live` is advanced). */
function buildGroup(events: readonly MatchEvent[], from: number, to: number, roster: Roster, live: Live, shotAtStart: number): GroupItem[] {
  type Item = GroupItem
  const drafts: Item[] = []
  // The clock ran first; the events' own resets of the shot clock follow.
  live.shot = shotAtStart
  for (let index = from; index < to; index += 1) {
    const event = events[index]!
    const made: Item[] = []
    if (index === from && live.dead && !(event.type === 'command' && /half-court offense|takes the throw-in in the frontcourt/.test(event.text)) && event.scene) {
      // After a dead ball the engine may go straight on with the play (a substitution sets the five again): throw it in first.
      const animation = throwIn(event, roster, live)
      if (animation) { made.push({ event, animation: animation.animation, extra: { chip: 'THROW-IN', caption: animation.caption }, running: true, before: cloneLive(live), shotAfter: 0 }); adopt(live, animation.animation) }
    }
    live.dead = false
    for (const item of liveBeats(events, index, roster, live, (animation, extra, running) => { made.push({ event, animation, extra, running, before: cloneLive(live), shotAfter: 0 }); adopt(live, animation) })) void item
    applyAfter(events, index, live)
    for (const item of made) item.shotAfter = live.shot
    drafts.push(...made)
  }
  return drafts
}

type Emit = (animation: Animation, extra: Partial<Beat>, running: boolean) => void
/** Beats for one live event, in order; `emit` adopts each one, so the next starts where it ends. */
function liveBeats(events: readonly MatchEvent[], index: number, roster: Roster, live: Live, emit: Emit): [] {
  const event = events[index]!
  if (!event.scene) return []
  // The bring-up: from a made basket or a dead ball, a throw-in first; from a rebound or steal, the outlet.
  if (event.type === 'command' && /half-court offense|takes the throw-in in the frontcourt/.test(event.text)) { advanceBeats(events, index, roster, live, emit); return [] }
  emit(engineBeat(event, roster, live), event.type === 'command' && /holds the ball for the last shot|runs down the clock/.test(event.text) ? { chip: 'LAST SHOT' } : {}, event.type !== 'rebound')
  return []
}

/** An engine scene, started from where everyone really is, with the off-ball play the scene leaves still. */
function engineBeat(event: MatchEvent, roster: Roster, live: Live): Animation {
  const scene = event.scene!
  const start = scene.end.map(point => ({ playerId: point.playerId, ...(live.pos.get(point.playerId) ?? scene.start.find(item => item.playerId === point.playerId) ?? point) }))
  const fromBall = live.holder && live.pos.has(live.holder) ? { ...live.ball, ...live.pos.get(live.holder)! } : live.ball
  const adjusted: MatchEvent = { ...event, scene: { ...scene, start, ball: { ...scene.ball, from: fromBall } } }
  const animation = buildAnimation(adjusted, roster)!
  const offense = animation.offense, hoop = animation.hoop
  const actors = new Set(animation.actors.map(item => item.playerId))
  const startOf = (id: string) => start.find(item => item.playerId === id)!
  const free = animation.tracks.filter(item => !actors.has(item.playerId))
  if (animation.kind === 'rebound') {
    // Nobody walks back to a set spot while the ball is loose: the others hold their box-outs and crash points.
    for (const item of free) { const at = item.path[0]!; item.path = line(at, toward(at, hoop, .5)) }
  } else if (animation.kind === 'shot' || animation.kind === 'dunk' || animation.kind === 'block') {
    if (animation.result !== 'make') {
      // As the shot goes up: defenders seal their man, attackers crash the glass; they stay there for the rebound.
      for (const item of free) {
        const at = item.path[0]!
        if (metres(at, hoop) > 8) continue
        const toRim = item.side === offense ? 1.4 : .9
        item.path = line(at, toward(at, hoop, Math.min(toRim, Math.max(0, metres(at, hoop) - 1.1))), .35, 1)
        item.poses.push({ start: .45, end: 1, value: item.side === offense ? 'reach' : 'box-out' })
      }
    }
  } else if (animation.kind === 'drive' || animation.kind === 'pick-and-roll' || animation.kind === 'fast-break' || animation.kind === 'post-up') {
    // Off the ball: shooters drift to open spots, the help defender steps in and recovers.
    const driver = animation.actors.find(item => item.role === 'handler')?.playerId
    const driverEnd = driver ? pathAt(animation.tracks.find(item => item.playerId === driver)!.path, 1) : hoop
    for (const item of free) {
      const at = item.path[0]!
      if (metres(at, item.path.at(-1)!) > .3) continue
      if (item.side === offense) {
        const away = toward(at, driverEnd, -1.1)
        item.path = [W(0, at), W(.25, at), W(.75, onCourt(away)), W(1, onCourt(away))]
      } else if (metres(at, driverEnd) < 7.5) {
        const help = toward(at, driverEnd, 1.3)
        item.path = [W(0, at), W(.2, at), W(.55, help), W(1, at)]
      }
    }
  } else if (animation.kind === 'pass') {
    // Off the ball on a pass: a cutter or relocating shooter and the defence turning with the ball.
    const receiver = animation.actors.find(item => item.role === 'receiver')?.playerId
    const catchAt = receiver ? pathAt(animation.tracks.find(item => item.playerId === receiver)!.path, 1) : hoop
    for (const item of free) {
      const at = item.path[0]!
      if (metres(at, item.path.at(-1)!) > .3) continue
      if (item.side !== offense) item.path = [W(0, at), W(.3, at), W(1, toward(at, catchAt, .45))]
    }
  }
  void startOf
  return believable(bridgeBall(animation, live))
}
/** A throw-in from where the ball went dead, to the player the engine's next action starts with. */
function throwIn(event: MatchEvent, roster: Roster, live: Live): { animation: Animation; caption: string } | null {
  const scene = event.scene!, offense = scene.offense
  const receiver = event.playerId && scene.end.some(point => point.playerId === event.playerId) && sideOf(roster, event.playerId, offense) === offense ? event.playerId : scene.start.find(point => sideOf(roster, point.playerId, offense) === offense)?.playerId
  if (!receiver) return null
  return throwInTo(event, roster, live, offense, receiver, scene.start.find(point => point.playerId === receiver) ?? live.pos.get(receiver)!)
}
/** The ball handler of a side on the floor: its point guard, else its best-placed player. */
function ballHandler(roster: Roster, live: Live, offense: Side): string | undefined {
  const attackers = [...live.pos.keys()].filter(id => sideOf(roster, id, offense) === offense)
  return attackers.find(id => roster.get(id)?.position === 'PG') ?? attackers.find(id => roster.get(id)?.position === 'SG') ?? attackers[0]
}
function throwInTo(event: MatchEvent, roster: Roster, live: Live, offense: Side, receiver: string, receiverTarget: P): { animation: Animation; caption: string } | null {
  const spot = { x: live.ball.x, y: live.ball.y }
  const { point: outPoint, line: lineName } = throwInPoint(spot)
  const attackers = [...live.pos.keys()].filter(id => sideOf(roster, id, offense) === offense && id !== receiver)
  const inbounder = attackers.sort((a, b) => metres(live.pos.get(a)!, outPoint) - metres(live.pos.get(b)!, outPoint) || a.localeCompare(b))[0]
  if (!inbounder) return null
  const receiverStart = receiverTarget
  const tracks: PlayerTrack[] = []
  for (const [id, at] of live.pos) {
    const side = sideOf(roster, id, offense)
    if (id === inbounder) tracks.push(track(id, side, 'stand', [W(0, at), W(.5, outPoint), W(1, live.pos.get(inbounder)!)], [{ start: .5, end: .7, value: 'catch' }]))
    else if (id === receiver) tracks.push(track(id, side, 'stand', [W(0, at), W(.45, onCourt(toward(outPoint, receiverStart, 3))), W(.7, onCourt(toward(outPoint, receiverStart, 3))), W(1, receiverStart)], [{ start: .6, end: .75, value: 'catch' }]))
    else tracks.push(track(id, side, side === offense ? 'stand' : 'defend', line(at, at)))
  }
  const ball: BallSegment[] = [
    { kind: 'pass', from: held(live), to: { playerId: inbounder }, start: 0, end: .45, arc: .2, ...(!live.holder ? { heights: [live.ball.height, 1.25] as [number, number] } : {}) },
    { kind: 'hold', from: { playerId: inbounder }, to: { playerId: inbounder }, start: .45, end: .56, arc: 0 },
    { kind: 'pass', from: { playerId: inbounder }, to: { playerId: receiver }, start: .56, end: .72, arc: .25 },
    { kind: 'hold', from: { playerId: receiver }, to: { playerId: receiver }, start: .72, end: 1, arc: 0 },
  ]
  const animation = finish(event, event.period, { kind: 'inbound', offense, tracks, ball, actors: [{ playerId: inbounder, role: 'passer' }, { playerId: receiver, role: 'receiver' }], marks: [], minMs: 2200 })
  return { animation, caption: `${surname(roster.get(inbounder)?.name)} inbounds from the ${lineName} to ${surname(roster.get(receiver)?.name)}.` }
}
/** If the ball is not where an engine scene starts it, a quick pass or pick-up brings it there first. */
function bridgeBall(animation: Animation, live: Live): Animation {
  const first = animation.ball[0]
  if (!first) return animation
  const startPositions = new Map(animation.tracks.map(item => [item.playerId, pathAt(item.path, 0)]))
  const at = anchorPoint(first.from, startPositions)
  const height = 'point' in first.from ? first.from.point.height : first.heights?.[0] ?? 1.25
  const holderMatches = live.holder && 'playerId' in first.from && first.from.playerId === live.holder
  if (holderMatches || metres(at, live.ball) < .35 && Math.abs(height - live.ball.height) < .6) return animation
  const squeeze = (t: number) => .2 + t * .8
  const ball = animation.ball.map(segment => ({ ...segment, start: squeeze(segment.start), end: squeeze(segment.end) }))
  ball.unshift({ kind: 'pass', from: held(live), to: first.from, start: 0, end: .2, arc: .25, ...(!live.holder ? { heights: [live.ball.height, height] as [number, number] } : {}) })
  return { ...animation, ball }
}

/** A step that brings the ball up: throw-in or outlet, then the run up the floor into the half-court set. */
function advanceBeats(events: readonly MatchEvent[], index: number, roster: Roster, live: Live, emit: Emit): void {
  const event = events[index]!, scene = event.scene!, offense = scene.offense, defense = other(offense)
  const carrier = event.playerId!
  const ends = new Map(scene.end.map(point => [point.playerId, { x: point.x, y: point.y }]))
  const ids = [...ends.keys()]
  const at = (id: string): P => live.pos.get(id) ?? ends.get(id)!
  const frontcourt = /takes the throw-in in the frontcourt/.test(event.text)
  const cause = restartCause(events, index, offense)
  const out = { push: (item: { animation: Animation; extra: Partial<Beat>; running: boolean }) => emit(item.animation, item.extra, item.running) }
  const hoop = attackHoop(event.period, offense)
  const dir = hoop.x > .5 ? 1 : -1
  // A full-court press: late in a game the trailing team picks up the ball handler after its own basket.
  const press = cause.kind === 'score' && event.period >= 4 && event.clockSeconds <= 150 && event.score[defense] < event.score[offense] && event.score[offense] - event.score[defense] <= 8
  let state = live
  if (cause.kind === 'score' || cause.kind === 'dead') {
    // The throw-in: the inbounder (a big under his own basket after a score) steps out; the ball handler comes to it.
    const spot = cause.kind === 'score' ? { x: hoop.x > .5 ? 0.06 : .94, y: .5 } : { x: live.ball.x, y: live.ball.y }
    const { point: outPoint, line: lineName } = throwInPoint(spot, cause.kind === 'score' ? 'baseline' : cause.line)
    const offenseIds = ids.filter(id => sideOf(roster, id, offense) === offense)
    const candidates = offenseIds.filter(id => id !== carrier)
    const inbounder = [...candidates].sort((a, b) => (metres(at(a), outPoint) - (cause.kind === 'score' && isBig(roster.get(a)?.position) ? 4 : 0)) - (metres(at(b), outPoint) - (cause.kind === 'score' && isBig(roster.get(b)?.position) ? 4 : 0)) || a.localeCompare(b))[0] ?? carrier
    const receiver = inbounder === carrier ? candidates[0] ?? carrier : carrier
    const inward = lineName === 'baseline' ? shift(outPoint, dir * 4.2, (outPoint.y < .5 ? 1 : -1) * 1.2) : frontcourt ? shift(outPoint, 0, (outPoint.y < .5 ? 1 : -1) * 3.4) : shift(outPoint, dir * 1.5, (outPoint.y < .5 ? 1 : -1) * 3.2)
    const catchAt = onCourt(inward)
    const tracks: PlayerTrack[] = []
    const ballSegs: BallSegment[] = []
    const marks: Mark[] = []
    let pressDefender: string | undefined
    for (const id of ids) {
      const side = sideOf(roster, id, offense), from = at(id), target = ends.get(id)!
      if (id === inbounder) {
        tracks.push(track(id, side, 'stand', [W(0, from), W(.55, outPoint), W(1, outPoint)], [{ start: .55, end: .8, value: 'catch' }]))
      } else if (id === receiver) {
        tracks.push(track(id, side, 'stand', [W(0, from), W(.35, lerp(from, catchAt, .5)), W(.78, catchAt), W(1, catchAt)], [{ start: .7, end: .9, value: 'catch' }]))
      } else if (side === offense) {
        tracks.push(track(id, side, 'stand', line(from, lerp(from, target, frontcourt ? .75 : .32), .15, 1)))
      } else {
        // The defence retreats and finds its men; under a press the ball handler's man picks him up at once.
        const man = defenderTarget(id, ends, scene.end, roster, offense)
        if (press && man === receiver) { pressDefender = id; tracks.push(track(id, side, 'defend', line(from, toward(catchAt, hoop, 1.3), .1, .85))) }
        else tracks.push(track(id, side, 'defend', line(from, lerp(from, target, frontcourt ? .8 : .5), .1, 1)))
      }
    }
    const ballAtStart = live.ball
    if (ballAtStart.height >= 2.6) {
      // Through the net, onto the floor, into the inbounder's hands.
      const floor: CourtBallPoint = { x: ballAtStart.x, y: ballAtStart.y, height: .2 }
      ballSegs.push({ kind: 'drop', from: { point: ballAtStart }, to: { point: floor }, start: 0, end: .14, arc: 0 })
      ballSegs.push({ kind: 'bounce', from: { point: floor }, to: { playerId: inbounder }, start: .14, end: .4, arc: .35 })
    } else if (state.holder === inbounder) ballSegs.push({ kind: 'hold', from: { playerId: inbounder }, to: { playerId: inbounder }, start: 0, end: .4, arc: 0 })
    else ballSegs.push({ kind: 'pass', from: held(state), to: { playerId: inbounder }, start: 0, end: .4, arc: .25 })
    ballSegs.push({ kind: 'hold', from: { playerId: inbounder }, to: { playerId: inbounder }, start: .4, end: .62, arc: 0 })
    ballSegs.push({ kind: 'pass', from: { playerId: inbounder }, to: { playerId: receiver }, start: .62, end: .8, arc: .3 })
    ballSegs.push({ kind: 'hold', from: { playerId: receiver }, to: { playerId: receiver }, start: .8, end: 1, arc: 0 })
    if (press && pressDefender) marks.push({ kind: 'info', label: 'PRESS', at: { playerId: pressDefender }, start: .6, end: 1 })
    const animation = finish(event, event.period, { kind: 'inbound', offense, tracks, ball: ballSegs, actors: [{ playerId: inbounder, role: 'passer' }, { playerId: receiver, role: 'receiver' }], marks, minMs: 1700 })
    const words = lineName === 'baseline' ? 'from the baseline' : frontcourt ? 'from the sideline in the frontcourt' : 'from the sideline'
    out.push({ animation, extra: { chip: 'THROW-IN', caption: `${surname(roster.get(inbounder)?.name)} inbounds ${words} to ${surname(roster.get(receiver)?.name)}.` }, running: true })
    if (receiver !== carrier) {
      // The ball handler comes to get it.
      const handoff = passBeat(event, roster, state, offense, receiver, carrier, state.pos.get(carrier) ?? ends.get(carrier)!)
      out.push({ animation: handoff, extra: { chip: 'THROW-IN' }, running: true })
    }
  } else if (cause.kind === 'live' && state.holder && state.holder !== carrier && state.pos.has(state.holder)) {
    // The outlet: the rebounder (or the player who stole it) finds the ball handler on the wing.
    const holder = state.holder
    const wing = onCourt(shift(at(holder), dir * 5, (at(holder).y < .5 ? 1 : -1) * 3.5))
    const outlet = passBeat(event, roster, state, offense, holder, carrier, wing)
    out.push({ animation: outlet, extra: { chip: 'OUTLET', caption: `${surname(roster.get(holder)?.name)} outlets to ${surname(roster.get(carrier)?.name)}.` }, running: true })
  }
  // Up the floor: the ball handler dribbles, wings run wide lanes, bigs trail; the defence gets back and matches up.
  const tracks: PlayerTrack[] = []
  for (const id of ids) {
    const side = sideOf(roster, id, offense), from = state.pos.get(id) ?? ends.get(id)!, target = ends.get(id)!
    if (id === carrier) {
      const mid = lerp(from, target, .5)
      tracks.push(track(id, side, 'dribble', [W(0, from), { t: .5, x: mid.x, y: mid.y + (vary(event.id, 3) - .5) * .06 }, W(1, target)], [{ start: 0, end: 1, value: 'dribble' }]))
    } else if (side === offense) {
      // Trailers (the inbounder above all) may still be on their way when the ball crosses; they arrive as the set forms.
      const arrive = lerp(from, target, metres(from, target) > 17 ? .62 : metres(from, target) > 12 ? .8 : 1)
      // Wings run wide lanes; the others come up the middle.
      const lane = Math.abs(target.y - .5) > .2 ? { x: (from.x + arrive.x) / 2, y: target.y < .5 ? .12 : .88 } : lerp(from, arrive, .5)
      tracks.push(track(id, side, 'stand', frontcourt ? line(from, target) : [W(0, from), W(.5, onCourt(lane)), W(1, arrive)]))
    } else {
      const man = defenderTarget(id, ends, scene.end, roster, offense)
      if (man === carrier && !frontcourt) {
        // The ball handler's man picks him up near halfcourt (or at once under a press) and backpedals in front of him.
        const pickUp = press ? .2 : .35
        const carrierMid = lerp(from, target, .5)
        tracks.push(track(id, side, 'defend', [W(0, from), W(pickUp, toward(from, carrierMid, metres(from, carrierMid) * .6)), W(1, target)]))
      } else tracks.push(track(id, side, 'defend', line(from, lerp(from, target, metres(from, target) > 14 ? .82 : 1), .05, 1)))
    }
  }
  const marks: Mark[] = []
  const bringUp = finish(event, event.period, { kind: frontcourt ? 'set' : press ? 'press' : 'bring-up', offense, tracks, ball: [{ kind: 'dribble', from: { playerId: carrier }, to: { playerId: carrier }, start: 0, end: 1, arc: 0 }], actors: [{ playerId: carrier, role: 'handler' }], marks, minMs: frontcourt ? 900 : 1500 })
  out.push({ animation: bringUp, extra: frontcourt ? { chip: 'SET PLAY', caption: `${surname(roster.get(carrier)?.name)} gets the ball and the attack sets up.` } : press ? { chip: 'FULL-COURT PRESS', caption: `${surname(roster.get(carrier)?.name)} brings it up against the press.` } : {}, running: true })
}
function defenderTarget(defender: string, ends: Map<string, P>, end: readonly { playerId: string; x: number; y: number }[], roster: Roster, offense: Side): string | undefined {
  const at = ends.get(defender)!
  let best: string | undefined, distance = Infinity
  for (const point of end) {
    if (sideOf(roster, point.playerId, offense) !== offense) continue
    const d = metres(point, at)
    if (d < distance) { distance = d; best = point.playerId }
  }
  return best
}
function passBeat(event: MatchEvent, roster: Roster, live: Live, offense: Side, passer: string, receiver: string, catchAt: P): Animation {
  const tracks: PlayerTrack[] = []
  for (const [id, at] of live.pos) {
    const side = sideOf(roster, id, offense)
    if (id === receiver) tracks.push(track(id, side, 'stand', line(at, catchAt), [{ start: .6, end: .9, value: 'catch' }]))
    else tracks.push(track(id, side, side === offense ? 'stand' : 'defend', line(at, side === offense ? at : lerp(at, catchAt, .08))))
  }
  return finish(event, event.period, { kind: 'pass', offense, tracks, ball: [{ kind: 'hold', from: { playerId: passer }, to: { playerId: passer }, start: 0, end: .15, arc: 0 }, { kind: 'pass', from: { playerId: passer }, to: { playerId: receiver }, start: .15, end: .7, arc: .3 }, { kind: 'hold', from: { playerId: receiver }, to: { playerId: receiver }, start: .7, end: 1, arc: 0 }], actors: [{ playerId: passer, role: 'passer' }, { playerId: receiver, role: 'receiver' }], marks: [], minMs: 800 })
}

/** Why this possession starts: after a score (end-line throw-in), a dead ball (throw-in at the spot) or a live ball. */
function restartCause(events: readonly MatchEvent[], index: number, offense: Side): { kind: 'score' | 'dead' | 'live' | 'start'; line?: 'baseline' | 'sideline' } {
  for (let i = index - 1; i >= 0; i -= 1) {
    const event = events[i]!
    if (event.type === 'tipoff') return { kind: 'live' }
    // Timeouts and substitutions happen at a dead ball: the reason it went dead decides the throw-in.
    if (event.type === 'timeout' || event.type === 'substitution' || event.type === 'foul-out' || event.type === 'tactics') continue
    if (event.type === 'period-start' || event.type === 'held-ball' || event.type === 'foul' || event.type === 'injury') return { kind: 'dead' }
    if (event.type === 'command' && !event.scene && /out of bounds|Kicked ball|keep the ball after/.test(event.text)) return { kind: 'dead', ...(/baseline throw-in/.test(event.text) ? { line: 'baseline' as const } : /sideline throw-in/.test(event.text) ? { line: 'sideline' as const } : {}) }
    if (event.type === 'shot') return event.shot?.made && event.side !== offense ? { kind: 'score' } : { kind: 'live' }
    if (event.type === 'free-throw') return /\bmakes\b/.test(event.text) && event.side !== offense ? { kind: 'score' } : { kind: 'live' }
    if (event.type === 'rebound') return { kind: 'live' }
    if (event.type === 'turnover' || event.type === 'shot-clock') return / steals /.test(event.text) ? { kind: 'live' } : { kind: 'dead' }
  }
  return { kind: 'start' }
}

/** The lead-in of a half-court action: the handler probes; cuts, screens away and relocations; defenders shadow and help. */
function probe(event: MatchEvent, roster: Roster, live: Live, durationMs: number, salt: number, target?: ReadonlyMap<string, P>): Animation {
  const offense = event.scene?.offense ?? live.offense
  const hoop = attackHoop(event.period, offense)
  const ids = [...live.pos.keys()]
  const attackers = ids.filter(id => sideOf(roster, id, offense) === offense)
  const defenders = ids.filter(id => sideOf(roster, id, offense) !== offense)
  const handler = live.holder && attackers.includes(live.holder) ? live.holder : attackers[0]!
  const paths = new Map<string, Waypoint[]>()
  const poses = new Map<string, PlayerTrack['poses']>()
  const base = (id: string) => live.pos.get(id)!
  // The handler: a hesitation and a crossover along the arc, then back to his spot.
  const h = base(handler), across = (vary(event.id, salt) - .5) * 4.2
  const probeAt = onCourt(shift(h, 0, across))
  paths.set(handler, [W(0, h), W(.32, probeAt), W(.5, probeAt), W(.85, h), W(1, h)])
  poses.set(handler, [{ start: 0, end: 1, value: 'dribble' }])
  // Off the ball: one cut through the lane, one screen away (the screened player curls to the top), one relocation.
  const offBall = attackers.filter(id => id !== handler).sort((a, b) => vary(event.id + a.length, salt + 1) - vary(event.id + b.length, salt + 1))
  const [cutter, screener, curler, relocator] = offBall
  if (cutter) {
    const at = base(cutter), lane = toward(hoop, at, 1.6)
    paths.set(cutter, [W(0, at), W(.12, at), W(.42, lane), W(.52, lane), W(.85, at), W(1, at)])
  }
  if (screener && curler) {
    const s = base(screener), c = base(curler)
    const screenAt = toward(s, c, Math.max(0, metres(s, c) - 1.1))
    const curlTo = onCourt(toward(c, hoop, -2.2))
    paths.set(screener, [W(0, s), W(.3, screenAt), W(.62, screenAt), W(.92, s), W(1, s)])
    poses.set(screener, [{ start: .3, end: .62, value: 'screen' }])
    paths.set(curler, [W(0, c), W(.38, c), W(.62, curlTo), W(.74, curlTo), W(1, c)])
  } else if (screener) paths.set(screener, line(base(screener), base(screener)))
  if (relocator) {
    const r = base(relocator), slide = onCourt(shift(r, (vary(event.id, salt + 3) - .5) * 2.4, (r.y < .5 ? -1 : 1) * 1.2))
    paths.set(relocator, [W(0, r), W(.5, r), W(.75, slide), W(1, r)])
  }
  // Defenders shadow their men a beat later, between man and basket; away from the ball they sag into the lane.
  const ballSide = h.y < .5
  for (const id of defenders) {
    const at = base(id)
    const man = attackers.slice().sort((a, b) => metres(base(a), at) - metres(base(b), at))[0]
    const manPath = man ? paths.get(man) ?? line(base(man), base(man)) : line(at, at)
    const gap = man ? clamp(metres(base(man), at), .6, 2.2) : 1
    const weak = man ? (base(man).y < .5) !== ballSide && man !== handler : false
    const shadow: Waypoint[] = manPath.map(point => {
      const guard = toward(point, hoop, gap)
      const sag = weak ? toward(guard, hoop, 1.4) : guard
      return { t: point.t, x: sag.x, y: sag.y }
    })
    shadow[0] = W(0, at)
    shadow[shadow.length - 1] = W(1, at)
    paths.set(id, shadow)
  }
  // The floor drifts from where everyone is to where the action starts (the trailers arrive, the set forms).
  const drifted = (id: string, path: Waypoint[]): Waypoint[] => {
    const goal = target?.get(id)
    if (!goal) return path
    const from = base(id), dx = goal.x - from.x, dy = goal.y - from.y
    return path.map(point => ({ t: point.t, x: point.x + dx * point.t, y: point.y + dy * point.t }))
  }
  const tracks = ids.map(id => track(id, sideOf(roster, id, offense), sideOf(roster, id, offense) === offense ? 'stand' : 'defend', drifted(id, paths.get(id) ?? line(base(id), base(id))), poses.get(id) ?? []))
  const marks: Mark[] = []
  if (screener && curler && vary(event.id, salt + 5) < .45) marks.push({ kind: 'screen', label: 'SCREEN', at: { playerId: screener }, start: .32, end: .6 })
  const animation = finish(event, event.period, { kind: 'half-court', offense, tracks, ball: [{ kind: 'dribble', from: { playerId: handler }, to: { playerId: handler }, start: 0, end: 1, arc: 0 }], actors: [{ playerId: handler, role: 'handler' }], marks, minMs: 600 })
  return { ...animation, durationMs: Math.max(animation.durationMs, Math.round(durationMs)) }
}
/** The ball on its way up the floor: the handler dribbles toward halfcourt, everyone runs toward the attacking basket. */
function upcourt(event: MatchEvent, roster: Roster, live: Live, durationMs: number): Animation {
  const offense = live.offense, hoop = attackHoop(event.period, offense), dir = hoop.x > .5 ? 1 : -1
  const handler = live.holder && live.pos.has(live.holder) ? live.holder : ballHandler(roster, live, offense)
  const tracks = [...live.pos].map(([id, at]) => {
    const side = sideOf(roster, id, offense)
    // Nobody runs past the attacking free-throw line on the way up.
    const limit = hoop.x - dir * 6.5 / 28
    const run = side === offense ? 7 : 6
    const x = dir === 1 ? Math.min(limit, at.x + run / 28) : Math.max(limit, at.x - run / 28)
    const target = onCourt({ x, y: at.y + (.5 - at.y) * .15 })
    return track(id, side, id === handler ? 'dribble' : side === offense ? 'stand' : 'defend', line(at, target, side === offense ? 0 : .08, 1), id === handler ? [{ start: 0, end: 1, value: 'dribble' }] : [])
  })
  const ball: BallSegment[] = handler ? [{ kind: 'dribble', from: { playerId: handler }, to: { playerId: handler }, start: 0, end: 1, arc: 0 }] : [{ kind: 'hold', from: held(live), to: held(live), start: 0, end: 1, arc: 0 }]
  const animation = bridgeBall(finish(event, event.period, { kind: 'bring-up', offense, tracks, ball, actors: handler ? [{ playerId: handler, role: 'handler' }] : [], marks: [], minMs: 900 }), live)
  return { ...animation, durationMs: Math.max(animation.durationMs, Math.round(durationMs)) }
}
function probeCaption(event: MatchEvent, roster: Roster, live: Live, salt: number): string {
  const offense = event.scene?.offense ?? live.offense
  const handler = live.holder ? surname(roster.get(live.holder)?.name) : 'The guard'
  const lines = [`${handler} sizes up the defence.`, `${handler} runs the offence.`, `${handler} calls the set.`, `${handler} probes; the others cut and screen.`]
  void offense
  return lines[Math.floor(vary(event.id, salt + 9) * lines.length)]!
}

// ---------------------------------------------------------------------------------------------------------------------
// Stoppages: whistles, free throws, timeouts, substitutions, period breaks.

function stoppage(events: readonly MatchEvent[], index: number, roster: Roster, live: Live, beats: Beat[]): Live {
  const event = events[index]!
  // Clock: stoppages happen at the event's clock (a new period resets it).
  if (event.type === 'period-start') { live.period = event.period; live.clock = event.clockSeconds; live.shot = 24 }
  else if (event.period === live.period && event.clockSeconds < live.clock) {
    // The whistle came during play the engine did not show (a foul or a ball knocked out on the way up): play it first.
    const elapsed = live.clock - event.clockSeconds
    if (live.pos.size && !live.dead) {
      if (!live.holder) {
        // After a basket the ball is thrown in first.
        const handler = ballHandler(roster, live, live.offense)
        const inbound = handler ? throwInTo(event, roster, live, live.offense, handler, onCourt(toward(live.pos.get(handler)!, { x: .5, y: .5 }, 3))) : null
        if (inbound) {
          beats.push({ key: `${event.id}:${beats.filter(beat => beat.event === event).length}`, event, animation: inbound.animation, durationMs: inbound.animation.durationMs, clock: { period: live.period, from: live.clock, to: live.clock }, shotClock: shotShown(live.clock, live.shot), scoreBefore: { ...live.score }, chip: 'THROW-IN', caption: inbound.caption })
          adopt(live, inbound.animation)
        }
      }
      // In the backcourt the ball is on its way up; in the frontcourt the attack runs its offence.
      const play = live.frontcourt ? probe(event, roster, live, Math.min(6500, elapsed * PACE_MS), 7) : upcourt(event, roster, live, Math.min(6500, elapsed * PACE_MS))
      const handler = live.holder ? surname(roster.get(live.holder)?.name) : 'The guard'
      beats.push({ key: `${event.id}:${beats.filter(beat => beat.event === event).length}`, event, animation: play, durationMs: play.durationMs, clock: { period: live.period, from: live.clock, to: event.clockSeconds },
        shotClock: live.shot > live.clock + .01 && live.clock < 24 ? null : { from: live.shot, to: Math.max(0, live.shot - elapsed) }, scoreBefore: { ...live.score }, chip: live.frontcourt ? 'HALF COURT' : 'BRING UP', caption: live.frontcourt ? `${handler} runs the offence.` : `${handler} brings it up.` })
      adopt(live, play)
    }
    live.shot = Math.max(0, live.shot - elapsed)
    live.clock = event.clockSeconds
  }
  const offense = live.offense
  const add = (animation: Animation, extra: Partial<Beat> = {}) => { push(beats, event, animation, live, extra); adopt(live, animation) }
  switch (event.type) {
    case 'tipoff': add(jumpBall(event, roster, live), { chip: 'JUMP BALL', caption: /^(.+?) win the opening tip/.test(event.text) ? `Jump ball: ${/^(.+?) win the opening tip/.exec(event.text)![1]} win the tip.` : 'Jump ball.' }); live.started = true; break
    case 'period-start': add(periodStart(events, index, roster, live), { chip: event.period <= 4 ? `QUARTER ${event.period}` : 'OVERTIME', caption: event.text }); break
    case 'period-end': case 'final': add(periodEnd(event, roster, live), { chip: event.type === 'final' ? 'FINAL' : 'END OF PERIOD', whistle: true }); break
    case 'foul': add(whistleBeat(event, roster, live, foulLabel(events, index), 'foul'), { chip: 'FOUL', whistle: true }); break
    case 'foul-out': add(whistleBeat(event, roster, live, '5 FOULS', 'whistle', 900), { chip: 'FOULED OUT' }); break
    case 'held-ball': add(heldBall(event, roster, live), { chip: 'HELD BALL', whistle: true }); break
    case 'timeout': add(timeoutBeat(event, roster, live), { chip: 'TIMEOUT', whistle: true }); break
    case 'substitution': {
      const changes = [event]
      for (let next = index + 1; events[next]?.type === 'substitution' && events[next]!.clockSeconds === event.clockSeconds && events[next]!.period === event.period; next += 1) changes.push(events[next]!)
      add(substitutions(changes, roster, live), { chip: 'SUBSTITUTION', caption: substitutionCaption(changes, roster), covers: changes.slice(1) })
      break
    }
    case 'injury': add(injury(event, roster, live), { chip: 'INJURY', whistle: true }); live.downed = event.playerId; break
    case 'free-throw': add(freeThrow(event, roster, live), { chip: 'FREE THROW' }); break
    case 'turnover': case 'shot-clock': add(whistleBeat(event, roster, live, turnoverLabel(event), 'violation', 1500), { chip: 'VIOLATION', whistle: true }); break
    case 'command':
      if (event.scene) add(freeThrowSetup(event, roster, live), { chip: 'FREE THROWS' })
      else if (/Kicked ball/.test(event.text)) add(outOfBounds(event, roster, live, 'KICKED BALL'), { chip: 'KICKED BALL', whistle: true })
      else if (/out of bounds/.test(event.text)) add(outOfBounds(event, roster, live, 'OUT OF BOUNDS'), { chip: 'OUT OF BOUNDS', whistle: true })
      else add(whistleBeat(event, roster, live, 'BALL', 'whistle', 900), { chip: 'POSSESSION' })
      break
    default: break
  }
  applyAfter(events, index, live)
  live.score = { ...event.score }
  // The ball stays dead until a throw-in (a free throw restarts play itself; a substitution keeps whatever was).
  if (['foul', 'held-ball', 'timeout', 'injury', 'turnover', 'shot-clock', 'period-start', 'period-end'].includes(event.type) || event.type === 'command' && !event.scene) live.dead = true
  if (event.type === 'free-throw' || event.type === 'command' && event.scene) live.dead = false
  void offense
  return live
}
/** Shot clock and possession after an event, as the engine's rules set them. */
function applyAfter(events: readonly MatchEvent[], index: number, live: Live): void {
  const event = events[index]!
  const told = /[Ss]hot clock (\d+)/.exec(event.text)
  switch (event.type) {
    case 'rebound':
      if (event.side) { const offensive = /offensive/.test(event.text); live.shot = offensive ? (/after the block/.test(event.text) ? live.shot : 14) : 24; live.offense = event.side; live.frontcourt = offensive }
      break
    case 'turnover': case 'shot-clock':
      if (event.side) { live.offense = other(event.side); live.shot = 24; live.frontcourt = false }
      break
    case 'shot':
      if (event.shot?.made && event.side) { live.offense = other(event.side); live.shot = 24; live.frontcourt = false }
      break
    case 'free-throw':
      if (/\bmakes\b/.test(event.text) && event.side && /free throw (\d) of \1/.test(event.text)) { live.offense = other(event.side); live.shot = 24; live.frontcourt = false }
      break
    case 'foul':
      if (event.side && /offensive foul|charge|Illegal screen|pushes off/.test(event.text)) { live.offense = other(event.side); live.shot = 24; live.frontcourt = false }
      else if (event.side) live.shot = live.frontcourt ? Math.max(14, live.shot) : 24
      break
    case 'held-ball':
      if (event.side && event.side !== live.offense) { live.offense = event.side; live.shot = 24; live.frontcourt = false }
      break
    case 'command':
      if (told) live.shot = Number(told[1])
      if (/team rebound/.test(event.text) && event.side) { const keep = /keep possession/.test(event.text); live.offense = event.side; live.shot = keep ? Math.max(14, live.shot) : 24; live.frontcourt = keep }
      if (/half-court offense|takes the throw-in/.test(event.text)) live.frontcourt = true
      if (/keep the ball after the unsportsmanlike/.test(event.text) && event.side) { live.offense = event.side; live.frontcourt = true }
      break
    case 'period-start': live.shot = 24; live.frontcourt = false; break
    case 'drive': if (/fast break|races up the floor/.test(event.text)) live.frontcourt = true; break
    default: break
  }
  if (event.scene && event.type !== 'rebound' && event.type !== 'turnover' && event.type !== 'shot-clock' && !(event.type === 'shot' && event.shot?.made)) live.offense = event.scene.offense
}

function foulLabel(events: readonly MatchEvent[], index: number): string {
  const event = events[index]!, text = event.text
  if (/technical foul/.test(text)) return 'TECHNICAL FOUL'
  if (/unsportsmanlike/.test(text)) return 'UNSPORTSMANLIKE'
  if (/charge/.test(text)) return 'CHARGE'
  if (/Illegal screen/.test(text)) return 'ILLEGAL SCREEN'
  if (/offensive foul|pushes off/.test(text)) return 'OFFENSIVE FOUL'
  if (/on the shot|three-point attempt|and one/.test(text)) return 'SHOOTING FOUL'
  if (/intentionally/.test(text)) return 'FOUL · CLOCK STOPS'
  return event.side && teamFoulsAt(events, index, event.side) >= 5 ? 'FOUL · BONUS' : 'FOUL'
}

/** A whistle: play stops; the player called raises his hand (or the ball handler stops); the call shows above him. */
function whistleBeat(event: MatchEvent, roster: Roster, live: Live, label: string, kind: PlayKind, minMs = 1450): Animation {
  const offense = live.offense
  const id = event.playerId && live.pos.has(event.playerId) ? event.playerId : live.holder
  const tracks = standing(live, roster, offense)
  // Everybody eases to a stop and turns toward the call.
  for (const item of tracks) {
    const at = item.path[0]!
    const settle = id && item.playerId !== id ? toward(at, live.pos.get(id)!, .35) : at
    item.path = [W(0, at), W(.4, settle), W(1, settle)]
  }
  const called = tracks.find(item => item.playerId === id)
  if (called && kind !== 'violation') called.poses.push({ start: .12, end: 1, value: 'hand-up' })
  const marks: Mark[] = [{ kind: 'call', label, at: id ? { playerId: id } : { point: live.ball }, start: .08, end: 1 }]
  const ball: BallSegment[] = [{ kind: 'hold', from: held(live), to: held(live), start: 0, end: 1, arc: 0, ...(!live.holder ? { heights: [live.ball.height, live.ball.height] as [number, number] } : {}) }]
  return finish(event, event.period, { kind, offense, tracks, ball, actors: id ? [{ playerId: id, role: 'handler' as Role }] : [], marks, minMs })
}
/** A ball knocked out (or kicked): it flies past the nearest line; the defender who touched it last reaches after it. */
function outOfBounds(event: MatchEvent, roster: Roster, live: Live, label: string): Animation {
  const offense = live.offense
  const from = live.holder ? live.pos.get(live.holder)! : live.ball
  const wantBaseline = /baseline throw-in/.test(event.text)
  const target: P = wantBaseline ? { x: from.x < .5 ? -.03 : 1.03, y: clamp(from.y, .15, .85) } : { x: clamp(from.x + (vary(event.id, 1) - .5) * .06, .03, .97), y: from.y < .5 ? -.05 : 1.05 }
  const kicked = label === 'KICKED BALL'
  const tracks = standing(live, roster, offense)
  const defender = event.playerId && live.pos.has(event.playerId) ? event.playerId : undefined
  for (const item of tracks) {
    const at = item.path[0]!
    if (item.playerId === defender) { const reach = toward(at, from, Math.min(1.5, Math.max(0, metres(at, from) - .6))); item.path = [W(0, at), W(.3, reach), W(1, reach)]; item.poses.push({ start: .1, end: .4, value: 'reach' }) }
    else item.path = [W(0, at), W(.5, toward(at, target, .6)), W(1, toward(at, target, .6))]
  }
  const ball: BallSegment[] = [
    { kind: 'hold', from: held(live), to: held(live), start: 0, end: .18, arc: 0 },
    { kind: kicked ? 'roll' : 'deflect', from: held(live), to: { point: { ...target, height: kicked ? .15 : .4 } }, start: .18, end: .62, arc: kicked ? 0 : .5 },
    { kind: 'hold', from: { point: { ...target, height: kicked ? .15 : .4 } }, to: { point: { ...target, height: .15 } }, start: .62, end: 1, arc: 0 },
  ]
  const marks: Mark[] = [{ kind: 'call', label, at: defender ? { playerId: defender } : { point: target }, start: .3, end: 1 }]
  return finish(event, event.period, { kind: kicked ? 'kicked-ball' : 'out-of-bounds', offense, tracks, ball, actors: defender ? [{ playerId: defender, role: 'stealer' }] : [], marks, minMs: 1450, result: 'out' })
}
function heldBall(event: MatchEvent, roster: Roster, live: Live): Animation {
  const offense = live.offense
  const holder = live.holder ?? [...live.pos.keys()].find(id => sideOf(roster, id, offense) === offense)!
  const at = live.pos.get(holder)!
  const rival = [...live.pos.keys()].filter(id => sideOf(roster, id, offense) !== sideOf(roster, holder, offense)).sort((a, b) => metres(live.pos.get(a)!, at) - metres(live.pos.get(b)!, at))[0]
  const tracks = standing(live, roster, offense)
  for (const item of tracks) {
    const p = item.path[0]!
    if (item.playerId === rival) { item.path = line(p, toward(p, at, Math.max(0, metres(p, at) - .55)), 0, .3); item.poses.push({ start: .2, end: .8, value: 'reach' }) }
    else if (item.playerId === holder) item.poses.push({ start: .2, end: .8, value: 'reach' })
    else item.path = line(p, toward(p, at, .5), .2, 1)
  }
  const arrow = event.side === 'home' ? 'HOME' : 'AWAY'
  const marks: Mark[] = [{ kind: 'call', label: 'HELD BALL', at: { playerId: holder }, start: .2, end: 1 }, { kind: 'info', label: `ARROW ${arrow}`, at: { point: { x: .5, y: .52 } }, start: .5, end: 1 }]
  return finish(event, event.period, { kind: 'held-ball', offense, tracks, ball: [{ kind: 'hold', from: { playerId: holder }, to: { playerId: holder }, start: 0, end: 1, arc: 0, heights: [1.25, 1.25] }], actors: [{ playerId: holder, role: 'handler' }, ...(rival ? [{ playerId: rival, role: 'stealer' as Role }] : [])], marks, minMs: 1700 })
}
/** Timeout: both teams walk to their benches and huddle; the ball is left with the referee at the spot. */
function timeoutBeat(event: MatchEvent, roster: Roster, live: Live): Animation {
  const offense = live.offense
  const tracks: PlayerTrack[] = []
  const slots: Record<Side, number> = { home: 0, away: 0 }
  for (const [id, at] of live.pos) {
    const side = sideOf(roster, id, offense)
    const huddle = benchSpot(side, slots[side]++)
    const near = { x: huddle.x, y: .03 + (slots[side] % 2) * .03 }
    tracks.push(track(id, side, 'walk', [W(0, at), W(.72, near), W(1, near)], [{ start: .72, end: 1, value: 'stand' }]))
  }
  const point: CourtBallPoint = live.holder ? { ...live.pos.get(live.holder)!, height: .15 } : { ...live.ball, height: .15 }
  const marks: Mark[] = [{ kind: 'call', label: `TIMEOUT ${event.side === 'home' ? 'HOME' : 'AWAY'}`, at: { point: { x: .5, y: .45 } }, start: .05, end: 1 }]
  return finish(event, event.period, { kind: 'timeout', offense, tracks, ball: [{ kind: 'drop', from: held(live), to: { point }, start: 0, end: .2, arc: 0 }, { kind: 'hold', from: { point }, to: { point }, start: .2, end: 1, arc: 0, heights: [.15, .15] }], actors: [], marks, minMs: 3400 })
}
/** Substitution at the scorer's table: the new player checks in and jogs to his man; the other walks to the bench. */
/** Substitutions at one stoppage, together: the new players check in at the table and jog to their men; the others walk off. */
function substitutions(changes: readonly MatchEvent[], roster: Roster, live: Live): Animation {
  const event = changes[0]!, offense = live.offense
  const outIds = new Set(changes.flatMap(change => change.outgoingPlayerId ? [change.outgoingPlayerId] : []))
  const inIds = new Set(changes.flatMap(change => change.playerId ? [change.playerId] : []))
  const tracks = standing(live, roster, offense, new Set([...outIds, ...inIds]))
  let injured = false
  const benchSlots: Record<Side, number> = { home: 0, away: 0 }
  changes.forEach((change, order) => {
    const side = change.side ?? offense, outId = change.outgoingPlayerId, inId = change.playerId
    const outAt = outId ? live.pos.get(outId) : undefined
    const spot = outAt ?? change.scene?.end.find(point => point.playerId === inId) ?? { x: .5, y: .3 }
    const hurt = outId !== undefined && outId === live.downed
    injured ||= hurt
    if (outId && outAt) tracks.push(track(outId, side, 'walk', line(outAt, benchSpot(side, benchSlots[side]++), hurt ? .15 : .05, 1), hurt ? [{ start: 0, end: .15, value: 'down' }] : []))
    if (inId && !live.pos.has(inId)) {
      const table = { x: TABLE.x + (side === 'home' ? -.025 : .025) * (1 + order * .6), y: -.045 }
      tracks.push(track(inId, side, 'stand', [W(0, table), W(.18 + order * .04, table), W(1, spot)]))
    }
  })
  const keeps = live.holder && !outIds.has(live.holder)
  const floor: CourtBallPoint = { ...live.ball, height: .15 }
  const ball: BallSegment[] = keeps ? [{ kind: 'hold', from: { playerId: live.holder! }, to: { playerId: live.holder! }, start: 0, end: 1, arc: 0 }]
    : [{ kind: 'drop', from: { point: live.ball }, to: { point: floor }, start: 0, end: .2, arc: 0 }, { kind: 'hold', from: { point: floor }, to: { point: floor }, start: .2, end: 1, arc: 0 }]
  const marks: Mark[] = [{ kind: 'info', label: changes.length > 1 ? `${changes.length} SUBS` : 'SUB', at: { point: TABLE }, start: 0, end: .8 }]
  const animation = finish(event, event.period, { kind: 'substitution', offense, tracks, ball, actors: [...inIds].map(id => ({ playerId: id, role: 'receiver' as Role })), marks, minMs: injured ? 2600 : 1500 })
  if (injured) live.downed = undefined
  return animation
}
function substitutionCaption(changes: readonly MatchEvent[], roster: Roster): string {
  const name = (id?: string) => surname(id ? roster.get(id)?.name : undefined)
  if (changes.length === 1) return `${name(changes[0]!.playerId)} checks in for ${name(changes[0]!.outgoingPlayerId)}.`
  return `${changes.length} substitutions: ${changes.map(change => `${name(change.playerId)} for ${name(change.outgoingPlayerId)}`).join(', ')}.`
}
function injury(event: MatchEvent, roster: Roster, live: Live): Animation {
  const offense = live.offense
  const id = event.playerId!
  const tracks = standing(live, roster, offense)
  const hurt = tracks.find(item => item.playerId === id)
  if (hurt) { hurt.poses.push({ start: .15, end: 1, value: 'down' }); hurt.base = 'down' }
  for (const item of tracks) if (item.playerId !== id && hurt) { const at = item.path[0]!; item.path = line(at, toward(at, hurt.path[0]!, Math.min(1.2, metres(at, hurt.path[0]!) * .25)), .3, 1) }
  const marks: Mark[] = [{ kind: 'call', label: 'INJURY', at: hurt ? { playerId: id } : { point: live.ball }, start: .15, end: 1 }]
  return finish(event, event.period, { kind: 'injury', offense, tracks, ball: [{ kind: 'hold', from: held(live), to: held(live), start: 0, end: 1, arc: 0, ...(!live.holder ? { heights: [live.ball.height, live.ball.height] as [number, number] } : {}) }], actors: hurt ? [{ playerId: id, role: 'handler' }] : [], marks, minMs: 2200 })
}
/** Players walk to the free-throw lane spaces; the referee bounces the ball to the shooter. */
function freeThrowSetup(event: MatchEvent, roster: Roster, live: Live): Animation {
  const scene = event.scene!, shooting = scene.offense, shooter = event.playerId!
  const ids = scene.end.map(point => point.playerId)
  const spots = laneSpots(event.period, shooting, shooter, ids, roster)
  const tracks = ids.map(id => {
    const side = sideOf(roster, id, shooting), from = live.pos.get(id) ?? scene.start.find(point => point.playerId === id) ?? scene.end.find(point => point.playerId === id)!
    return track(id, side, 'stand', line(from, spots.get(id)!, 0, .85))
  })
  const ball: BallSegment[] = live.holder === shooter ? [{ kind: 'hold', from: { playerId: shooter }, to: { playerId: shooter }, start: 0, end: 1, arc: 0 }]
    : [{ kind: 'bounce', from: held(live), to: { playerId: shooter }, start: .45, end: .85, arc: .2 }, { kind: 'hold', from: { playerId: shooter }, to: { playerId: shooter }, start: .85, end: 1, arc: 0 }]
  if (ball[0]!.kind === 'bounce') ball.unshift({ kind: 'hold', from: held(live), to: held(live), start: 0, end: .45, arc: 0, ...(!live.holder ? { heights: [live.ball.height, live.ball.height] as [number, number] } : {}) })
  return finish(event, event.period, { kind: 'free-throw-setup', offense: shooting, tracks, ball, actors: [{ playerId: shooter, role: 'shooter' }], marks: [], minMs: live.holder === shooter ? 650 : 1100 })
}
/** A free throw from the lane line-up (the line-up stays; misses bring the lane in). */
function freeThrow(event: MatchEvent, roster: Roster, live: Live): Animation {
  const scene = event.scene
  if (!scene) return whistleBeat(event, roster, live, 'FREE THROW', 'whistle', 900)
  const start = scene.end.map(point => ({ playerId: point.playerId, ...(live.pos.get(point.playerId) ?? point) }))
  const adjusted: MatchEvent = { ...event, scene: { ...scene, start, end: start } }
  const animation = buildAnimation(adjusted, roster)!
  const made = animation.result === 'make'
  const last = /free throw (\d) of \1/.test(event.text)
  if (!made && last) {
    const hoop = animation.hoop
    for (const item of animation.tracks) {
      if (item.playerId === event.playerId) continue
      const at = item.path[0]!
      if (metres(at, hoop) < 6) item.path = line(at, toward(at, hoop, .8), .55, 1)
    }
  }
  return { ...animation, durationMs: Math.max(animation.durationMs, 1300) }
}
function jumpBall(event: MatchEvent, roster: Roster, live: Live): Animation {
  const scene = event.scene
  const ids = scene ? scene.start.map(point => point.playerId) : [...live.pos.keys()]
  const centre: P = { x: .5, y: .5 }
  const bySide: Record<Side, string[]> = { home: [], away: [] }
  for (const id of ids) bySide[sideOf(roster, id, 'home')].push(id)
  const height = (id: string) => (isBig(roster.get(id)?.position) ? 10 : 0) + (roster.get(id)?.position === 'C' ? 5 : 0)
  const jumper = (side: Side) => [...bySide[side]].sort((a, b) => height(b) - height(a) || a.localeCompare(b))[0]
  const homeJumper = jumper('home'), awayJumper = jumper('away')
  const ring = new Map<string, P>()
  // Period one: home defends the left basket (FIBA: its bench side), so its jumper faces right.
  if (homeJumper) ring.set(homeJumper, { x: .5 - .4 / 28, y: .5 })
  if (awayJumper) ring.set(awayJumper, { x: .5 + .4 / 28, y: .5 })
  const angles = [150, 210, 110, 250].map(degrees => degrees * Math.PI / 180)
  const placeAround = (side: Side, flip: number) => bySide[side].filter(id => id !== homeJumper && id !== awayJumper).forEach((id, index) => {
    const angle = angles[index % angles.length]! + (flip ? Math.PI : 0)
    ring.set(id, { x: centre.x + Math.cos(angle) * 3.1 / 28, y: centre.y + Math.sin(angle) * 3.1 / 15 })
  })
  placeAround('home', 0); placeAround('away', 1)
  const winner = event.side ?? 'home'
  const receiver = scene && scene.end.length ? (scene.end.find(point => Math.abs(point.x - scene.ball.to.x) < .002 && Math.abs(point.y - scene.ball.to.y) < .002)?.playerId ?? bySide[winner][0]) : bySide[winner][0]
  const tracks: PlayerTrack[] = ids.map(id => {
    const side = sideOf(roster, id, 'home'), from = ring.get(id) ?? live.pos.get(id) ?? centre
    const towards = scene?.end.find(point => point.playerId === id) ?? from
    const after = id === receiver ? lerp(from, towards, .25) : lerp(from, towards, .3)
    const jump = id === homeJumper || id === awayJumper
    return track(id, side, side === winner ? 'stand' : 'defend', [W(0, from), W(.5, from), W(1, after)], jump ? [{ start: .22, end: .5, value: 'reach' }] : [], jump ? [{ start: .22, end: .5, value: .9 }] : [])
  })
  const toss: CourtBallPoint = { x: .5, y: .5, height: 4.1 }
  const tipper = winner === 'home' ? homeJumper : awayJumper
  const ball: BallSegment[] = [
    { kind: 'hold', from: { point: { x: .5, y: .5, height: 1.4 } }, to: { point: { x: .5, y: .5, height: 1.4 } }, start: 0, end: .15, arc: 0, heights: [1.4, 1.4] },
    { kind: 'pass', from: { point: { x: .5, y: .5, height: 1.4 } }, to: { point: toss }, start: .15, end: .34, arc: 0, heights: [1.4, 4.1] },
    ...(receiver ? [{ kind: 'deflect' as const, from: { point: { x: .5, y: .5, height: 3.6 } }, to: { playerId: receiver }, start: .38, end: .62, arc: .25, heights: [3.6, 1.25] as [number, number] }, { kind: 'hold' as const, from: { playerId: receiver }, to: { playerId: receiver }, start: .62, end: 1, arc: 0 }] : []),
  ]
  const marks: Mark[] = tipper ? [{ kind: 'info', label: 'JUMP BALL', at: { point: { x: .5, y: .5 } }, start: 0, end: .5 }] : []
  return finish(event, 1, { kind: 'jump-ball', offense: winner, tracks, ball, actors: [...(homeJumper ? [{ playerId: homeJumper, role: 'handler' as Role }] : []), ...(awayJumper ? [{ playerId: awayJumper, role: 'handler' as Role }] : [])], marks, minMs: 2600 })
}
/** Quarters 2-4 and overtimes start with a throw-in at the centre line, opposite the scorer's table. */
function periodStart(events: readonly MatchEvent[], index: number, roster: Roster, live: Live): Animation {
  const event = events[index]!
  const next = events.slice(index + 1).find(item => item.scene)
  const offense = next?.scene?.offense ?? live.offense
  const hoop = attackHoop(event.period, offense), dir = hoop.x > .5 ? 1 : -1
  const ids = next?.scene ? next.scene.start.map(point => point.playerId) : [...live.pos.keys()]
  const attackers = ids.filter(id => sideOf(roster, id, offense) === offense)
  const defenders = ids.filter(id => sideOf(roster, id, offense) !== offense)
  const inbounder = [...attackers].sort((a, b) => Number(roster.get(a)?.position === 'PG') - Number(roster.get(b)?.position === 'PG') || a.localeCompare(b))[0]
  const spots = new Map<string, P>()
  const lanes = [{ dx: 2, y: .82 }, { dx: 6, y: .25 }, { dx: 7.5, y: .6 }, { dx: 4.5, y: .45 }]
  let lane = 0
  for (const id of attackers) {
    if (id === inbounder) spots.set(id, { x: .5, y: 1.035 })
    else { const l = lanes[lane++ % lanes.length]!; spots.set(id, { x: .5 + dir * l.dx / 28, y: l.y }) }
  }
  defenders.forEach((id, i) => { const man = attackers[i] ?? attackers[0]!; const p = spots.get(man)!; spots.set(id, onCourt(toward(man === inbounder ? { x: p.x, y: .93 } : p, hoop, 1.3))) })
  const tracks = ids.map(id => {
    const side = sideOf(roster, id, offense)
    const from = live.pos.get(id) ?? benchSpot(side, ids.indexOf(id) % 5)
    return track(id, side, 'walk', line(from, spots.get(id)!, 0, .85))
  })
  const marks: Mark[] = [{ kind: 'info', label: event.period <= 4 ? `QUARTER ${event.period}` : 'OVERTIME', at: { point: { x: .5, y: .5 } }, start: 0, end: .7 }]
  const ball: BallSegment[] = inbounder ? [{ kind: 'pass', from: { point: { ...live.ball, height: Math.max(.3, live.ball.height) } }, to: { playerId: inbounder }, start: .3, end: .85, arc: .3 }, { kind: 'hold', from: { playerId: inbounder }, to: { playerId: inbounder }, start: .85, end: 1, arc: 0 }] : []
  if (inbounder) ball.unshift({ kind: 'hold', from: { point: live.ball }, to: { point: live.ball }, start: 0, end: .3, arc: 0, heights: [live.ball.height, live.ball.height] })
  live.offense = offense
  return finish(event, event.period, { kind: 'period-start', offense, tracks, ball, actors: inbounder ? [{ playerId: inbounder, role: 'passer' }] : [], marks, minMs: 2600 })
}
/** The horn: players stop and walk toward their benches (or meet at centre court at the end). */
function periodEnd(event: MatchEvent, roster: Roster, live: Live): Animation {
  const offense = live.offense
  const final = event.type === 'final'
  const slots: Record<Side, number> = { home: 0, away: 0 }
  const tracks = [...live.pos].map(([id, at]) => {
    const side = sideOf(roster, id, offense)
    const target = final ? { x: .5 + (side === 'home' ? -.03 : .03) + (slots[side] - 2) * .012, y: .35 + slots[side] * .07 } : lerp(at, { ...benchSpot(side, slots[side]), y: .04 }, .6)
    slots[side] += 1
    return track(id, side, 'walk', line(at, target, .25, 1))
  })
  const ballPoint: CourtBallPoint = live.holder ? { ...live.pos.get(live.holder)!, height: 1.25 } : live.ball
  const marks: Mark[] = [{ kind: 'info', label: final ? 'FINAL' : event.period <= 4 ? `END OF Q${event.period}` : `END OF OT${event.period - 4}`, at: { point: { x: .5, y: .5 } }, start: .05, end: 1 }]
  return finish(event, event.period, { kind: final ? 'final' : 'period-end', offense, tracks, ball: [{ kind: 'drop', from: { point: ballPoint }, to: { point: { ...ballPoint, height: .15 } }, start: 0, end: .3, arc: 0 }, { kind: 'hold', from: { point: { ...ballPoint, height: .15 } }, to: { point: { ...ballPoint, height: .15 } }, start: .3, end: 1, arc: 0, heights: [.15, .15] }], actors: [], marks, minMs: final ? 3200 : 2800 })
}

// ---------------------------------------------------------------------------------------------------------------------
// Cache: one broadcast per match, extended as events arrive.

let cached: { roster: Roster; broadcast: Broadcast } | null = null
/** The broadcast of a match's events so far (incremental; presentation only). */
export function broadcastOf(events: readonly MatchEvent[], roster: Roster): Broadcast {
  // Rosters are rebuilt by each screen; the events (shared by every state of a match) identify the match.
  const previous = cached?.broadcast
  if (previous && previous.events === events) return previous
  const broadcast = buildBroadcast(events, roster, previous)
  cached = { roster, broadcast }
  return broadcast
}
/** The beats that show events from `fromEventIndex` on (the tip-off is included before the first live step). */
export function beatsFrom(broadcast: Broadcast, fromEventIndex: number): Beat[] {
  const firstId = broadcast.events[fromEventIndex]?.id ?? Infinity
  return broadcast.beats.filter(beat => beat.event.id >= firstId)
}
/** The game clock at a moment of a beat, shown as the scoreboard shows it (tenths in the last minute). */
export function clockAt(beat: Beat, progress: number): number {
  const u = clamp(Number.isFinite(progress) ? progress : 1, 0, 1)
  return beat.clock.from + (beat.clock.to - beat.clock.from) * u
}
export function shotClockAt(beat: Beat, progress: number): number | null {
  if (!beat.shotClock) return null
  const u = clamp(Number.isFinite(progress) ? progress : 1, 0, 1)
  return beat.shotClock.from + (beat.shotClock.to - beat.shotClock.from) * u
}
