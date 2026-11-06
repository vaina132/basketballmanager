import { describe, expect, it } from 'vitest'
import type { CourtScene, MatchEvent } from '../src/domain/types'
import { advancePlayback, createPlayback, interpolateScene, playbackScore, settlePlayback } from '../src/viewer/playback'

const scene: CourtScene = {
  kind: 'shot', durationMs: 1000, offense: 'home',
  start: [{ playerId: 'one', x: .2, y: .4 }, { playerId: 'two', x: .7, y: .6 }],
  end: [{ playerId: 'two', x: .8, y: .5 }, { playerId: 'one', x: .4, y: .5 }],
  ball: { from: { x: .2, y: .4, height: 2 }, to: { x: .94, y: .5, height: 3 }, arcHeight: 2 },
}
const event = (id: number, durationMs = 1000): MatchEvent => ({ id, period: 1, clockSeconds: 580, type: 'shot', side: 'home', text: 'A shot.', score: { home: id * 2, away: 0 }, scene: { ...scene, durationMs } })

describe('court presentation timeline', () => {
  it('plays recorded events in order and reveals scoring after the corresponding scene', () => {
    const initial = createPlayback([event(1), event(2, 500)], { home: 0, away: 0 }, true)!
    const flight = advancePlayback(initial, 700)
    expect(flight.index).toBe(0); expect(playbackScore(flight).home).toBe(0)
    const next = advancePlayback(flight, 400)
    expect(next.index).toBe(1); expect(next.elapsedMs).toBe(100); expect(playbackScore(next).home).toBe(2)
    const finished = advancePlayback(next, 400)
    expect(finished.done).toBe(true); expect(playbackScore(finished).home).toBe(4)
    expect(initial.elapsedMs).toBe(0)
  })
  it('supports pause and different frame rates without changing sequence or recorded events', () => {
    const events = [event(1), event(2, 500)]
    const before = JSON.stringify(events)
    const initial = createPlayback(events, { home: 0, away: 0 }, true)!
    expect(advancePlayback(initial, 0)).toBe(initial)
    let smallFrames = initial
    for (let i = 0; i < 75; i++) smallFrames = advancePlayback(smallFrames, 20)
    expect(smallFrames).toEqual(advancePlayback(initial, 1500))
    expect(JSON.stringify(events)).toBe(before)
  })
  it('settles skipped playback at the last recorded scene without fabricating another event', () => {
    const initial = createPlayback([event(1), event(2)], { home: 0, away: 0 }, true)!
    const settled = settlePlayback(initial)!
    expect(settled.done).toBe(true); expect(settled.events[settled.index].id).toBe(2)
    expect(createPlayback([event(1), event(2)], { home: 0, away: 0 }, false)?.events).toHaveLength(1)
    expect(createPlayback([], { home: 0, away: 0 }, true)).toBeNull()
    expect(() => advancePlayback(initial, Infinity)).toThrow()
  })
  it('interpolates actors by identity rather than array order and uses the authored ball arc', () => {
    const middle = interpolateScene(scene, .5)
    expect(middle.players.find(p => p.playerId === 'one')?.x).toBeCloseTo(.3)
    expect(middle.players.find(p => p.playerId === 'two')?.x).toBeCloseTo(.75)
    expect(middle.ball.height).toBeCloseTo(4.5)
    expect(interpolateScene(scene, 0).ball).toEqual(scene.ball.from)
    expect(interpolateScene(scene, 1).ball).toEqual(scene.ball.to)
    expect(interpolateScene(scene, -10)).toEqual(interpolateScene(scene, 0))
    expect(interpolateScene(scene, 10)).toEqual(interpolateScene(scene, 1))
  })
})
