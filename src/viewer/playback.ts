import type { CourtPosition, CourtScene, MatchEvent, Side } from '../domain/types'

export interface PlaybackCursor {
  events: MatchEvent[]
  index: number
  elapsedMs: number
  done: boolean
  initialScore: Record<Side, number>
  /** Presentation length of each event, in event order; defaults to the scene's own duration. */
  durations?: number[]
}

const durationAt = (cursor: PlaybackCursor, index: number): number => cursor.durations?.[index] ?? cursor.events[index].scene!.durationMs

/** Presentation time only. These functions never advance the sporting engine. */
export function createPlayback(events: readonly MatchEvent[], initialScore: Record<Side, number>, animate: boolean, duration?: (event: MatchEvent) => number): PlaybackCursor | null {
  const scenes = events.filter(event => event.scene)
  if (!scenes.length) return null
  const measure = (event: MatchEvent) => Math.max(1, duration?.(event) ?? event.scene!.durationMs)
  if (!animate) {
    const last = scenes.at(-1)!, length = measure(last)
    return { events: [last], index: 0, elapsedMs: length, done: true, initialScore: { ...initialScore }, ...(duration ? { durations: [length] } : {}) }
  }
  return { events: scenes, index: 0, elapsedMs: 0, done: false, initialScore: { ...initialScore }, ...(duration ? { durations: scenes.map(measure) } : {}) }
}

/** Progress (0 to 1) through the event on screen. */
export function playbackProgress(cursor: PlaybackCursor): number {
  return Math.min(1, cursor.elapsedMs / durationAt(cursor, cursor.index))
}

export function advancePlayback(cursor: PlaybackCursor, elapsedMs: number): PlaybackCursor {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) throw new Error('Presentation time must be finite and nonnegative.')
  if (cursor.done || elapsedMs === 0) return cursor
  let index = cursor.index
  let time = cursor.elapsedMs + elapsedMs
  while (index < cursor.events.length - 1 && time >= durationAt(cursor, index)) {
    time -= durationAt(cursor, index)
    index += 1
  }
  const duration = durationAt(cursor, index)
  return { ...cursor, index, elapsedMs: Math.min(time, duration), done: time >= duration && index === cursor.events.length - 1 }
}

export function settlePlayback(cursor: PlaybackCursor | null): PlaybackCursor | null {
  if (!cursor || cursor.done) return cursor
  return { ...cursor, index: cursor.events.length - 1, elapsedMs: durationAt(cursor, cursor.events.length - 1), done: true }
}

export function playbackScore(cursor: PlaybackCursor): Record<Side, number> {
  return cursor.done ? cursor.events.at(-1)!.score : cursor.index > 0 ? cursor.events[cursor.index - 1].score : cursor.initialScore
}

export function interpolateScene(scene: CourtScene, progress: number): { players: CourtPosition[]; ball: { x: number; y: number; height: number } } {
  const t = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0))
  const start = new Map(scene.start.map(pose => [pose.playerId, pose]))
  const players = scene.end.map(pose => {
    const from = start.get(pose.playerId) ?? pose
    return { playerId: pose.playerId, x: from.x + (pose.x - from.x) * t, y: from.y + (pose.y - from.y) * t }
  })
  const { from, to, arcHeight } = scene.ball
  return {
    players,
    ball: {
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
      height: from.height + (to.height - from.height) * t + 4 * arcHeight * t * (1 - t),
    },
  }
}
