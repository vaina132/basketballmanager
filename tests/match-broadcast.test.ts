import { describe, expect, it } from 'vitest'
import type { MatchEvent, MatchState, Side } from '../src/domain/types'
import { createFixtureMatch, createMatch, setAutoSubstitutions, simulateToEnd, stepMatch } from '../src/engine/match'
import { frameAt, rosterOf } from '../src/viewer/choreography'
import { buildBroadcast, PACE_MS, SPRINT, type Beat } from '../src/viewer/flow'
import { describePlay } from '../src/viewer/play-text'
import { calibrationTeam } from './helpers/match-calibration'

/**
 * The continuous broadcast (owner feedback, 22 November 2026 evening: "like a tennis match ... I need a more realistic
 * flow"): every beat starts where the previous one ended, players and ball move at believable speeds, every stoppage
 * the engine records has its moment, and the clocks shown follow the game.
 */
const teams = [calibrationTeam(3, 0), calibrationTeam(8, .5)]
function plays3(seed: number, injuries: 'standard' | 'off' = 'standard'): MatchState {
  return simulateToEnd(createFixtureMatch(seed, teams[0]!, teams[1]!, { autoSubstitutions: { home: true, away: true }, injuryMode: injuries, playModel: 'plays-3', computerCoach: ['home', 'away'] }))
}
function oldEngine(seed: number): MatchState {
  let state = createMatch(seed)
  for (const side of ['home', 'away'] as const) state = setAutoSubstitutions(state, side, true)
  return simulateToEnd(state)
}
const metres = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot((a.x - b.x) * 28, (a.y - b.y) * 15)

function checkContinuity(beats: Beat[]): { worstPlayer: number; worstBall: number; jumps: number } {
  let worstPlayer = 0, worstBall = 0, jumps = 0
  for (let index = 1; index < beats.length; index += 1) {
    const end = frameAt(beats[index - 1]!.animation, 1), start = frameAt(beats[index]!.animation, 0)
    const before = new Map(end.players.map(pose => [pose.playerId, pose]))
    for (const pose of start.players) {
      const was = before.get(pose.playerId)
      if (!was) continue
      const gap = metres(was, pose)
      worstPlayer = Math.max(worstPlayer, gap)
      if (gap > .05) jumps += 1
    }
    const ballGap = metres(end.ball, start.ball) + Math.abs(end.ball.height - start.ball.height)
    worstBall = Math.max(worstBall, ballGap)
    if (ballGap > .05) jumps += 1
  }
  return { worstPlayer, worstBall, jumps }
}
function speeds(beats: Beat[]): { player: number; ball: number } {
  let player = 0, ball = 0
  for (const beat of beats) {
    const steps = 40, dt = beat.durationMs / 1000 / steps
    let previous = frameAt(beat.animation, 0)
    for (let step = 1; step <= steps; step += 1) {
      const frame = frameAt(beat.animation, step / steps)
      const was = new Map(previous.players.map(pose => [pose.playerId, pose]))
      for (const pose of frame.players) { const p = was.get(pose.playerId); if (p) player = Math.max(player, metres(p, pose) / dt) }
      ball = Math.max(ball, metres(previous.ball, frame.ball) / dt)
      previous = frame
    }
  }
  return { player, ball }
}

describe('the continuous broadcast (presentation only)', () => {
  const matches: [string, MatchState][] = [['plays-3', plays3(5)], ['plays-3 b', plays3(17)], ['earlier engine', oldEngine(42)]]

  it('joins every beat to the next one: no player or ball jumps', () => {
    for (const [label, match] of matches) {
      const { beats } = buildBroadcast(match.events, rosterOf(match))
      const result = checkContinuity(beats)
      expect(result.jumps, label).toBe(0)
      expect(result.worstPlayer, label).toBeLessThan(.05)
      expect(result.worstBall, label).toBeLessThan(.05)
    }
  })

  it('keeps players under a sprint and the ball under a believable flight speed at 1x', () => {
    for (const [label, match] of matches) {
      const { beats } = buildBroadcast(match.events, rosterOf(match))
      const result = speeds(beats)
      expect(result.player, label).toBeLessThan(SPRINT * 1.25)
      expect(result.ball, label).toBeLessThan(26)
    }
  })

  it('gives every stoppage the engine records its own moment with a call or a line', () => {
    for (const [label, match] of matches) {
      const roster = rosterOf(match)
      const { beats } = buildBroadcast(match.events, roster)
      const shown = new Set(beats.flatMap(beat => [beat.event, ...(beat.covers ?? [])]))
      const stoppage = (event: MatchEvent) => ['foul', 'timeout', 'substitution', 'held-ball', 'injury', 'period-end', 'period-start', 'free-throw', 'turnover', 'shot-clock', 'final', 'foul-out'].includes(event.type)
        || event.type === 'command' && /out of bounds|Kicked ball|half-court offense|throw-in in the frontcourt|free-throw line|last shot/.test(event.text)
      for (const event of match.events) if (stoppage(event)) expect(shown.has(event), `${label}: ${event.text}`).toBe(true)
      for (const beat of beats) if (beat.whistle) expect(beat.animation.marks.some(mark => mark.kind === 'call' || mark.kind === 'info'), `${label}: ${beat.event.text}`).toBe(true)
      for (const [index, event] of match.events.entries()) expect(describePlay(event, roster, match.events[index - 1])).not.toMatch(/undefined|A player/)
    }
  })

  it('runs the game clock and the shot clock with the play', () => {
    const match = matches[0]![1]
    const { beats } = buildBroadcast(match.events, rosterOf(match))
    for (const beat of beats) {
      expect(beat.clock.to).toBeLessThanOrEqual(beat.clock.from + 1e-9)
      if (beat.shotClock) { expect(beat.shotClock.to).toBeGreaterThanOrEqual(0); expect(beat.shotClock.from).toBeLessThanOrEqual(24) }
    }
    // A full game lasts about half an hour at 1x: live play at PACE_MS per second plus the stoppages.
    const minutes = beats.reduce((sum, beat) => sum + beat.durationMs, 0) / 60_000
    expect(minutes).toBeGreaterThan(2400 * PACE_MS / 60_000 * .8)
    expect(minutes).toBeLessThan(48)
  })

  it('shows the engine\'s own clocks at the end of each step', () => {
    let state = createFixtureMatch(23, teams[0]!, teams[1]!, { autoSubstitutions: { home: true, away: true }, injuryMode: 'standard', playModel: 'plays-3', computerCoach: ['home', 'away'] })
    let previous: ReturnType<typeof buildBroadcast> | undefined
    let compared = 0, off = 0
    for (let step = 0; state.status !== 'finished' && step < 4000; step += 1) {
      state = stepMatch(state)
      previous = buildBroadcast(state.events, rosterOf(state), previous)
      const last = previous.beats.at(-1)!
      expect(last.clock.to, state.events.at(-1)!.text).toBeCloseTo(state.clockSeconds, 6)
      if (state.status === 'finished' || state.phase === 'period-end' || state.phase === 'free-throws') continue
      compared += 1
      if (Math.abs(previous.live.shot - state.shotClockSeconds) > 1.01) off += 1
    }
    expect(compared).toBeGreaterThan(200)
    // The team rebound out of bounds keeps the larger of the shot clock and 14; everything else is exact.
    expect(off / compared).toBeLessThan(.03)
  }, 120_000)

  it('shows the moments of a real broadcast', () => {
    const match = matches[0]![1], roster = rosterOf(match)
    const { beats } = buildBroadcast(match.events, roster)
    // The jump ball opens the game, the two jumpers in the centre circle.
    expect(beats[0]!.animation.kind).toBe('jump-ball')
    const tip = frameAt(beats[0]!.animation, 0)
    expect(tip.players.filter(pose => metres(pose, { x: .5, y: .5 }) < .6)).toHaveLength(2)
    // After a basket the ball is thrown in from beyond the end line.
    const scored = beats.findIndex(beat => beat.event.type === 'shot' && beat.event.shot?.made)
    const inbound = beats.slice(scored + 1).find(beat => beat.animation.kind === 'inbound')!
    const passer = inbound.animation.actors.find(actor => actor.role === 'passer')!.playerId
    const outside = frameAt(inbound.animation, .6).players.find(pose => pose.playerId === passer)!
    expect(outside.x < 0 || outside.x > 1).toBe(true)
    // Free throws: the shooter at the line, the others in the lane spaces or beyond the arc.
    const lineUp = beats.find(beat => beat.animation.kind === 'free-throw-setup')!
    const set = frameAt(lineUp.animation, 1)
    const shooter = set.players.find(pose => pose.playerId === lineUp.event.playerId)!
    expect(Math.abs(shooter.y - .5)).toBeLessThan(.01)
    expect(set.players.filter(pose => pose.playerId !== shooter.playerId && Math.abs(Math.abs(pose.y - .5) - .175) < .01)).toHaveLength(5)
    // Timeouts: both teams at the near sideline; substitutions: the new player starts at the scorer's table.
    const timeout = beats.find(beat => beat.animation.kind === 'timeout')
    if (timeout) expect(frameAt(timeout.animation, 1).players.every(pose => pose.y < .1)).toBe(true)
    const sub = beats.find(beat => beat.animation.kind === 'substitution')!
    const incoming = sub.animation.actors[0]!.playerId
    expect(frameAt(sub.animation, 0).players.find(pose => pose.playerId === incoming)!.y).toBeLessThan(0)
    // Three referees move with the play; the one making a call signals.
    expect(beats.every(beat => beat.animation.refs?.length === 3)).toBe(true)
    expect(beats.filter(beat => beat.animation.kind === 'foul').every(beat => beat.animation.signal !== undefined)).toBe(true)
  })

  it('builds step by step exactly as from scratch', () => {
    let state = createFixtureMatch(31, teams[0]!, teams[1]!, { autoSubstitutions: { home: true, away: true }, injuryMode: 'standard', playModel: 'plays-3', computerCoach: ['home', 'away'] })
    const roster = rosterOf(state)
    let partial: ReturnType<typeof buildBroadcast> | undefined
    for (let step = 0; state.status !== 'finished' && step < 4000; step += 1) { state = stepMatch(state); partial = buildBroadcast(state.events, roster, partial) }
    const whole = buildBroadcast(state.events, roster)
    expect(partial!.beats.map(beat => [beat.key, beat.durationMs])).toEqual(whole.beats.map(beat => [beat.key, beat.durationMs]))
  }, 120_000)
})

/** Counted moments of one plays-3 match, for the report. */
export function momentCounts(match: MatchState): Record<string, number> {
  const { beats } = buildBroadcast(match.events, rosterOf(match))
  const counts: Record<string, number> = {}
  for (const beat of beats) counts[beat.animation.kind] = (counts[beat.animation.kind] ?? 0) + 1
  return counts
}
export type { Side }
