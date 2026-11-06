import type { CourtPosition, CourtScene, MatchEvent, Side } from '../domain/types'

export interface PlaybackCursor {
  events: MatchEvent[]
  index: number
  elapsedMs: number
  done: boolean
  initialScore: Record<Side, number>
}

/** Presentation time only. These functions never advance the sporting engine. */
export function createPlayback(events: readonly MatchEvent[], initialScore: Record<Side, number>, animate: boolean): PlaybackCursor | null {
  const scenes = events.filter(event => event.scene)
  if (!scenes.length) return null
  if (!animate) {
    const last = scenes.at(-1)!
    return { events: [last], index: 0, elapsedMs: last.scene!.durationMs, done: true, initialScore: { ...initialScore } }
  }
  return { events: scenes, index: 0, elapsedMs: 0, done: false, initialScore: { ...initialScore } }
}

export function advancePlayback(cursor: PlaybackCursor, elapsedMs: number): PlaybackCursor {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) throw new Error('Presentation time must be finite and nonnegative.')
  if (cursor.done || elapsedMs === 0) return cursor
  let index = cursor.index
  let time = cursor.elapsedMs + elapsedMs
  while (index < cursor.events.length - 1 && time >= cursor.events[index].scene!.durationMs) {
    time -= cursor.events[index].scene!.durationMs
    index += 1
  }
  const duration = cursor.events[index].scene!.durationMs
  return { ...cursor, index, elapsedMs: Math.min(time, duration), done: time >= duration && index === cursor.events.length - 1 }
}

export function settlePlayback(cursor: PlaybackCursor | null): PlaybackCursor | null {
  if (!cursor || cursor.done) return cursor
  const last = cursor.events.at(-1)!
  return { ...cursor, index: cursor.events.length - 1, elapsedMs: last.scene!.durationMs, done: true }
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
