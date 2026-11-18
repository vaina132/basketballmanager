import { describe, expect, it } from 'vitest'
import type { MatchEvent, MatchState } from '../src/domain/types'
import { createMatch, setAutoSubstitutions, simulateToEnd } from '../src/engine/match'
import { buildAnimation, frameAt, presentationDuration, rosterOf } from '../src/viewer/choreography'
import { advancePlayback, createPlayback } from '../src/viewer/playback'
import { describePlay } from '../src/viewer/play-text'

function play(seed: number): MatchState {
  let state = createMatch(seed)
  for (const side of ['home', 'away'] as const) state = setAutoSubstitutions(state, side, true)
  return simulateToEnd(state)
}
async function digest(match: MatchState): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ score: match.score, result: match.result, events: match.events, stats: match.stats })))
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}
const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y)

describe('live court animation (presentation only)', () => {
  it('leaves the match result and every play-by-play event exactly as before for fixed seeds', async () => {
    // Captured on main before the animated court was added (18 November 2026).
    const seed42 = play(42), seed2026 = play(2026)
    expect(seed42.score).toEqual({ home: 92, away: 76 }); expect(seed42.events).toHaveLength(810)
    expect(await digest(seed42)).toBe('f4a359466e9be7e67508f0ae51062b3a34d56ae08e0bb5f85ef0b6bf4e172a3b')
    expect(seed2026.score).toEqual({ home: 71, away: 101 }); expect(seed2026.events).toHaveLength(806)
    expect(await digest(seed2026)).toBe('64c4589226af9058c32e83ffb6bad62538390e692f9e052697c7f9f33fafe9f3')
    // Animating every play reads the frozen events and changes nothing.
    const roster = rosterOf(seed42)
    freeze(seed42.events)
    for (const event of seed42.events) {
      const animation = buildAnimation(event, roster)
      if (event.scene) expect(animation).not.toBeNull()
      if (animation) for (const t of [0, .25, .5, .75, 1]) frameAt(animation, t)
    }
    expect(await digest(seed42)).toBe('f4a359466e9be7e67508f0ae51062b3a34d56ae08e0bb5f85ef0b6bf4e172a3b')
  })

  it('starts each play at the scene start and ends exactly on its end positions and ball', () => {
    const match = play(7), roster = rosterOf(match)
    let count = 0
    for (const event of match.events) {
      const animation = buildAnimation(event, roster)
      if (!animation || !event.scene) continue
      count += 1
      const first = frameAt(animation, 0), last = frameAt(animation, 1)
      for (const pose of event.scene.start) expect(near(first.players.find(p => p.playerId === pose.playerId)!, pose)).toBeLessThan(1e-9)
      for (const pose of event.scene.end) expect(near(last.players.find(p => p.playerId === pose.playerId)!, pose)).toBeLessThan(1e-9)
      expect(near(last.ball, event.scene.ball.to)).toBeLessThan(1e-9)
      expect(last.ball.height).toBeCloseTo(event.scene.ball.to.height, 6)
      for (const t of [.1, .3, .5, .7, .9]) {
        const frame = frameAt(animation, t)
        expect(frame.ball.height).toBeGreaterThanOrEqual(0); expect(frame.ball.height).toBeLessThan(9)
        for (const pose of frame.players) { expect(pose.x).toBeGreaterThanOrEqual(0); expect(pose.x).toBeLessThanOrEqual(1) }
      }
    }
    expect(count).toBeGreaterThan(300)
  })

  it('maps a pass to a ball path from the passer to the receiver', () => {
    const match = play(42), roster = rosterOf(match)
    const pass = match.events.find(event => event.type === 'pass' && event.scene)!
    const animation = buildAnimation(pass, roster)!
    expect(animation.kind).toBe('pass')
    const flight = animation.ball.find(segment => segment.kind === 'pass')!
    expect(flight.from).toEqual({ playerId: pass.playerId }); expect(flight.to).toEqual({ playerId: pass.receiverId })
    const passerAt = (t: number) => frameAt(animation, t).players.find(p => p.playerId === pass.playerId)!
    const receiverAt = (t: number) => frameAt(animation, t).players.find(p => p.playerId === pass.receiverId)!
    expect(near(frameAt(animation, flight.start).ball, passerAt(flight.start))).toBeLessThan(1e-9)
    expect(near(frameAt(animation, flight.end).ball, receiverAt(flight.end))).toBeLessThan(1e-9)
    const middle = frameAt(animation, (flight.start + flight.end) / 2)
    expect(middle.flight?.kind).toBe('pass'); expect(middle.ball.height).toBeGreaterThan(1.25)
    expect(frameAt(animation, .9).ball.holderId).toBe(pass.receiverId)
  })

  it('maps a block to the named blocker rising, his block mark and the ball knocked away', () => {
    let block: MatchEvent | undefined, match: MatchState | undefined
    for (let seed = 1; !block && seed < 40; seed += 1) { match = play(seed); block = match.events.find(event => event.type === 'shot' && /blocks/.test(event.text)) }
    const roster = rosterOf(match!)
    const animation = buildAnimation(block!, roster)!
    expect(animation.kind).toBe('block'); expect(animation.result).toBe('block')
    const blockerName = /^(.+?) blocks /.exec(block!.text)![1]
    const blocker = animation.actors.find(actor => actor.role === 'blocker')!
    expect(roster.get(blocker.playerId)!.name).toBe(blockerName)
    const contact = frameAt(animation, .42)
    const pose = contact.players.find(p => p.playerId === blocker.playerId)!
    expect(pose.pose).toBe('block'); expect(pose.lift).toBeGreaterThan(0)
    expect(contact.marks.map(mark => mark.label)).toContain('BLOCK')
    const deflect = animation.ball.find(segment => segment.kind === 'deflect')!
    expect(deflect.to).toEqual({ point: block!.scene!.ball.to })
    expect(frameAt(animation, .7).flight?.kind).toBe('deflect')
  })

  it('shows shots, rebounds, steals and pick and rolls from the events', () => {
    const match = play(42), roster = rosterOf(match)
    const kinds = new Set(match.events.map(event => buildAnimation(event, roster)?.kind).filter(Boolean))
    for (const kind of ['setup', 'transition', 'pass', 'drive', 'pick-and-roll', 'shot', 'free-throw', 'free-throw-setup', 'rebound', 'steal']) expect(kinds).toContain(kind)
    const made = match.events.find(event => event.type === 'shot' && event.shot?.made && event.shot.value === 3)!
    const shot = buildAnimation(made, roster)!
    const arc = shot.ball.find(segment => segment.kind === 'shot')!
    expect(frameAt(shot, (arc.start + arc.end) / 2).ball.height).toBeGreaterThan(3.05)
    expect(frameAt(shot, .95).marks.map(mark => mark.label)).toContain('+3')
    const rebound = buildAnimation(match.events.find(event => event.type === 'rebound' && event.scene)!, roster)!
    expect(frameAt(rebound, .3).players.some(p => p.pose === 'box-out')).toBe(true)
    const steal = buildAnimation(match.events.find(event => event.type === 'turnover' && /steals/.test(event.text))!, roster)!
    expect(steal.actors.map(actor => actor.role)).toEqual(['handler', 'stealer'])
    const pnr = buildAnimation(match.events.find(event => buildAnimation(event, roster)?.kind === 'pick-and-roll')!, roster)!
    const screener = pnr.actors.find(actor => actor.role === 'screener')!
    expect(frameAt(pnr, .4).players.find(p => p.playerId === screener.playerId)!.pose).toBe('screen')
  })

  it('jumps straight to the end of each play with reduced motion', () => {
    const match = play(42), roster = rosterOf(match)
    const event = match.events.find(item => item.type === 'shot' && item.scene)!
    const animation = buildAnimation(event, roster)!
    const reduced = frameAt(animation, .3, true)
    expect(reduced.flight).toBeUndefined()
    expect(reduced.players).toEqual(frameAt(animation, 1).players.map(p => ({ ...p, stride: 0 })))
    expect(reduced.ball).toEqual(frameAt(animation, 1).ball)
  })

  it('times playback by each play animation and writes a short running line', () => {
    const match = play(42), roster = rosterOf(match)
    const scenes = match.events.filter(event => event.scene).slice(0, 6)
    const cursor = createPlayback(scenes, { home: 0, away: 0 }, true, event => presentationDuration(event, roster))!
    expect(cursor.durations).toEqual(scenes.map(event => buildAnimation(event, roster)!.durationMs))
    const total = cursor.durations!.reduce((sum, value) => sum + value, 0)
    expect(advancePlayback(cursor, total).done).toBe(true)
    expect(advancePlayback(cursor, total - 1).done).toBe(false)
    const index = match.events.findIndex((event, i) => event.type === 'shot' && event.shot?.made && event.shot.value === 2 && match.events[i - 1]?.type === 'drive' && match.events[i - 1]!.playerId === event.playerId)
    const shot = match.events[index]!
    const line = describePlay(shot, roster, match.events[index - 1])
    expect(line).toContain(`${roster.get(shot.playerId!)!.name.split(' ').at(-1)} drives, `)
    expect(line.endsWith(`${shot.score.home}-${shot.score.away}`)).toBe(true)
  })
})
