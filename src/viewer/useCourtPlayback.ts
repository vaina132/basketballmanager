import { useCallback, useEffect, useRef, useState } from 'react'
import type { MatchEvent, Side } from '../domain/types'
import { advancePlayback, createPlayback, playbackProgress, playbackScore, settlePlayback } from './playback'
import type { PlaybackCursor } from './playback'

/** Frame-by-frame playback position. Only the court subscribes to it, so the rest of the screen does not redraw each frame. */
export interface PlaybackClock {
  subscribe(listener: () => void): () => void
  getSnapshot(): PlaybackCursor | null
}
function createClock(): PlaybackClock & { set(next: PlaybackCursor | null): void } {
  let current: PlaybackCursor | null = null
  const listeners = new Set<() => void>()
  return {
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    getSnapshot: () => current,
    set(next) { current = next; listeners.forEach(listener => listener()) },
  }
}
/** The screen outside the court changes only when the shown event changes or finishes. */
const sameStep = (a: PlaybackCursor | null, b: PlaybackCursor | null) => a === b || !!a && !!b && a.events === b.events && a.index === b.index && a.done === b.done && (playbackProgress(a) >= 1) === (playbackProgress(b) >= 1)

export function useCourtPlayback(playing: boolean, speed: number, reducedMotion: boolean, duration?: (event: MatchEvent) => number) {
  const [clock] = useState(createClock)
  const [cursor, setCursor] = useState<PlaybackCursor | null>(null)
  const durationRef = useRef(duration)
  durationRef.current = duration
  const events = cursor?.events
  const done = cursor?.done ?? true

  const publish = useCallback((next: PlaybackCursor | null) => {
    clock.set(next)
    setCursor(previous => sameStep(previous, next) ? previous : next)
  }, [clock])

  useEffect(() => {
    if (!playing || done || !events) return
    let request = 0
    let previous = performance.now()
    const tick = (now: number) => {
      const elapsed = Math.min(100, Math.max(0, now - previous))
      previous = now
      const current = clock.getSnapshot()
      if (!document.hidden && current) publish(advancePlayback(current, elapsed * speed))
      request = requestAnimationFrame(tick)
    }
    request = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(request)
  }, [playing, speed, events, done, clock, publish])

  const present = useCallback((newEvents: readonly MatchEvent[], initialScore: Record<Side, number>, animate: boolean) => {
    const next = createPlayback(newEvents, initialScore, animate, durationRef.current)
    if (next) publish(next)
  }, [publish])
  const reset = useCallback(() => publish(null), [publish])
  const settle = useCallback(() => publish(settlePlayback(clock.getSnapshot())), [clock, publish])
  const event = cursor?.events[cursor.index]
  const finished = cursor ? reducedMotion || playbackProgress(cursor) >= 1 : true
  return {
    present, reset, settle, event, clock, finished,
    progress: finished ? 1 : 0,
    visibleScore: cursor ? reducedMotion ? cursor.events[cursor.index].score : playbackScore(cursor) : null,
    busy: !done,
  }
}
