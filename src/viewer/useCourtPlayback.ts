import { useCallback, useEffect, useState } from 'react'
import type { MatchEvent, Side } from '../domain/types'
import { advancePlayback, createPlayback, playbackScore, settlePlayback } from './playback'
import type { PlaybackCursor } from './playback'

export function useCourtPlayback(playing: boolean, speed: number, reducedMotion: boolean) {
  const [cursor, setCursor] = useState<PlaybackCursor | null>(null)
  const events = cursor?.events
  const done = cursor?.done ?? true

  useEffect(() => {
    if (!playing || done || !events) return
    let request = 0
    let previous = performance.now()
    const tick = (now: number) => {
      const elapsed = Math.min(100, Math.max(0, now - previous))
      previous = now
      if (!document.hidden) setCursor(current => current ? advancePlayback(current, elapsed * speed) : current)
      request = requestAnimationFrame(tick)
    }
    request = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(request)
  }, [playing, speed, events, done])

  const present = useCallback((newEvents: readonly MatchEvent[], initialScore: Record<Side, number>, animate: boolean) => {
    const next = createPlayback(newEvents, initialScore, animate)
    if (next) setCursor(next)
  }, [])
  const reset = useCallback(() => setCursor(null), [])
  const settle = useCallback(() => setCursor(current => settlePlayback(current)), [])
  const event = cursor?.events[cursor.index]
  const progress = event?.scene && cursor ? cursor.elapsedMs / event.scene.durationMs : 1
  return {
    present, reset, settle, event,
    progress: reducedMotion ? 1 : progress,
    visibleScore: cursor ? reducedMotion ? cursor.events[cursor.index].score : playbackScore(cursor) : null,
    busy: !done,
  }
}
