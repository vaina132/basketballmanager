import { useCallback, useEffect, useState } from 'react'
import type { Side } from '../domain/types'
import { advanceBeatPlayback, beatProgress, beatScore, createBeatPlayback, settleBeatPlayback } from './playback'
import type { BeatCursor } from './playback'
import type { Beat } from './flow'

/** Frame-by-frame playback position. Only the court subscribes to it, so the rest of the screen does not redraw each frame. */
export interface PlaybackClock {
  subscribe(listener: () => void): () => void
  getSnapshot(): BeatCursor | null
}
function createClock(): PlaybackClock & { set(next: BeatCursor | null): void } {
  let current: BeatCursor | null = null
  const listeners = new Set<() => void>()
  return {
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    getSnapshot: () => current,
    set(next) { current = next; listeners.forEach(listener => listener()) },
  }
}
/** The screen outside the court changes only when the shown beat changes or finishes. */
const sameStep = (a: BeatCursor | null, b: BeatCursor | null) => a === b || !!a && !!b && a.beats === b.beats && a.index === b.index && a.done === b.done && (beatProgress(a) >= 1) === (beatProgress(b) >= 1)

/** Plays the continuous broadcast's beats (src/viewer/flow.ts) at the chosen speed. */
export function useCourtPlayback(playing: boolean, speed: number, reducedMotion: boolean) {
  const [clock] = useState(createClock)
  const [cursor, setCursor] = useState<BeatCursor | null>(null)
  const beats = cursor?.beats
  const done = cursor?.done ?? true

  const publish = useCallback((next: BeatCursor | null) => {
    clock.set(next)
    setCursor(previous => sameStep(previous, next) ? previous : next)
  }, [clock])

  useEffect(() => {
    if (!playing || done || !beats) return
    let request = 0
    let previous = performance.now()
    const tick = (now: number) => {
      const elapsed = Math.min(100, Math.max(0, now - previous))
      previous = now
      const current = clock.getSnapshot()
      if (!document.hidden && current) publish(advanceBeatPlayback(current, elapsed * speed))
      request = requestAnimationFrame(tick)
    }
    request = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(request)
  }, [playing, speed, beats, done, clock, publish])

  const present = useCallback((newBeats: readonly Beat[], initialScore: Record<Side, number>, animate: boolean) => {
    const next = createBeatPlayback(newBeats, initialScore, animate)
    if (next) publish(next)
  }, [publish])
  const reset = useCallback(() => publish(null), [publish])
  const settle = useCallback(() => publish(settleBeatPlayback(clock.getSnapshot())), [clock, publish])
  const beat = cursor?.beats[cursor.index]
  const finished = cursor ? reducedMotion || beatProgress(cursor) >= 1 : true
  return {
    present, reset, settle, beat, event: beat?.event, clock, finished,
    progress: finished ? 1 : 0,
    visibleScore: cursor ? reducedMotion ? cursor.beats[cursor.index]!.event.score : beatScore(cursor) : null,
    busy: !done,
  }
}
