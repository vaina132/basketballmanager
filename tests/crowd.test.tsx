import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { MatchState } from '../src/domain/types'
import { DEVELOPMENT_CLUBS } from '../src/data/development-league'
import { createMatch, setAutoSubstitutions, simulateToEnd } from '../src/engine/match'
import { financeLedgerTicket } from '../src/world/finance-ledger'
import { advanceSeason, createSeason, getActiveFixture, managedSide } from '../src/world/season'
import { buildAnimation, rosterOf } from '../src/viewer/choreography'
import { Court } from '../src/viewer/Court'
import { buildCrowd, crowdCheer, fanPalette, matchGate, UNKNOWN_DENSITY } from '../src/viewer/crowd'

const clubs = { homeId: 'home-club', awayId: 'away-club', homeColor: '#1d4ed8', awayColor: '#c2410c' }
const bug = { home: { name: 'Home', color: '#1d4ed8', score: 0, fouls: 0, timeouts: 5 }, away: { name: 'Away', color: '#c2410c', score: 0, fouls: 0, timeouts: 5 }, period: 'Q1', clock: '10:00' }

function play(seed: number): MatchState {
  let state = createMatch(seed)
  for (const side of ['home', 'away'] as const) state = setAutoSubstitutions(state, side, true)
  return simulateToEnd(state)
}
const digest = (match: MatchState) => JSON.stringify({ score: match.score, result: match.result, events: match.events, stats: match.stats })
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}

describe('supporters in the stands (presentation only)', () => {
  it('fills the stands in line with the attendance against the arena capacity', () => {
    const full = buildCrowd({ ...clubs, gate: { attendance: 9840, capacity: 10_000 } })
    const fifth = buildCrowd({ ...clubs, gate: { attendance: 2000, capacity: 10_000 } })
    const unknown = buildCrowd({ ...clubs, gate: null })
    expect(full.known).toBe(true)
    expect(full.fans.length / full.seats).toBeCloseTo(.984, 1)
    expect(fifth.fans.length / fifth.seats).toBeCloseTo(.2, 1)
    // A bigger crowd keeps every fan of a smaller one in the same seat.
    const seats = new Set(full.fans.map(fan => `${fan.x},${fan.y}`))
    expect(fifth.fans.every(fan => seats.has(`${fan.x},${fan.y}`))).toBe(true)
    expect(unknown.known).toBe(false)
    expect(unknown.density).toBe(UNKNOWN_DENSITY)
    expect(buildCrowd({ ...clubs, gate: { attendance: 0, capacity: 10_000 } }).fans).toHaveLength(0)
    // The same match always shows the same crowd.
    expect(buildCrowd({ ...clubs, gate: { attendance: 2000, capacity: 10_000 } })).toEqual(fifth)
  })

  it('dresses home fans in the home colours and a small away section in the away colours', () => {
    const crowd = buildCrowd({ ...clubs, gate: { attendance: 10_000, capacity: 10_000 } })
    const home = crowd.fans.filter(fan => fan.side === 'home'), away = crowd.fans.filter(fan => fan.side === 'away')
    expect(home.every(fan => fanPalette(clubs.homeColor).includes(fan.color))).toBe(true)
    expect(away.every(fan => fanPalette(clubs.awayColor).includes(fan.color))).toBe(true)
    expect(home.filter(fan => fan.color === clubs.homeColor).length).toBeGreaterThan(home.length / 3)
    expect(away.length).toBeGreaterThan(0)
    expect(away.length / crowd.fans.length).toBeLessThan(.15)
    // Without a verified colour, plain shirts only.
    const plain = buildCrowd({ ...clubs, homeColor: 'unknown', gate: null })
    expect(plain.fans.filter(fan => fan.side === 'home').every(fan => fanPalette('unknown').includes(fan.color))).toBe(true)
  })

  it('cheers for home baskets with a flash, stays quieter for away baskets and greets the winners at the buzzer', () => {
    const match = play(42), roster = rosterOf(match)
    const sideOf = (id: string) => match.home.players.some(player => player.id === id) ? 'home' as const : 'away' as const
    const cheerFor = (side: 'home' | 'away') => {
      const event = match.events.find(item => item.scene?.kind === 'shot' && item.shot?.made && item.side === side)!
      return crowdCheer({ event, animation: buildAnimation(event, roster), progress: 1, sideOf, finished: false })
    }
    expect(cheerFor('home')).toMatchObject({ side: 'home', flash: true })
    expect(cheerFor('away')).toMatchObject({ side: 'away', flash: false })
    const event = match.events.find(item => item.scene?.kind === 'shot' && item.shot?.made)!
    expect(crowdCheer({ event, animation: buildAnimation(event, roster), progress: 0, sideOf, finished: false })).toBeNull()
    expect(crowdCheer({ animation: null, progress: 1, sideOf, finished: true, winner: match.result!.winner })).toMatchObject({ key: 'final', side: match.result!.winner, strength: 'big' })
  })

  it('animates the crowd only without reduced motion and shows the attendance by the score', () => {
    const match = play(42)
    const event = match.events.find(item => item.scene?.kind === 'shot' && item.shot?.made && item.side === 'home')!
    const gate = { attendance: 9840, capacity: 10_000 }
    const moving = renderToStaticMarkup(<Court match={match} event={event} progress={1} bug={bug} gate={gate} />)
    expect(moving).toContain('data-crowd-motion="on"')
    expect(moving).toContain('crowd-cheer')
    expect(moving).toContain('crowd-flash')
    expect(moving).toContain('Attendance 9,840 / 10,000')
    const still = renderToStaticMarkup(<Court match={match} event={event} progress={1} reducedMotion bug={bug} gate={gate} />)
    expect(still).toContain('data-crowd-motion="off"')
    expect(still).toContain('crowd-stands')
    expect(still).not.toContain('crowd-cheer')
    expect(still).not.toContain('crowd-flash')
    expect(renderToStaticMarkup(<Court match={match} event={event} progress={1} bug={bug} />)).not.toContain('Attendance')
  })

  it('leaves match results unchanged', () => {
    const first = play(2026), before = digest(first)
    freeze(first)
    const gate = { attendance: 5000, capacity: 8000 }
    for (const event of first.events.filter(item => item.scene).slice(0, 120)) for (const progress of [0, .7, 1]) renderToStaticMarkup(<Court match={first} event={event} progress={progress} gate={gate} bug={bug} />)
    expect(digest(first)).toBe(before)
    expect(digest(play(2026))).toBe(before)
  })

  it('reads the career match gate: the forecast for the week, then the booked ticket', () => {
    const season = createSeason(11, DEVELOPMENT_CLUBS[0]!.id, 'off', true, true, true, false)
    const fixture = getActiveFixture(season)
    const gate = matchGate(season)!
    expect(gate.capacity).toBeGreaterThan(0)
    expect(gate.attendance).toBeGreaterThan(0)
    expect(gate.attendance).toBeLessThanOrEqual(gate.capacity)
    const finished = { ...season, activeMatch: simulateToEnd(setAutoSubstitutions(season.activeMatch!, managedSide(season), true)) }
    expect(matchGate(finished)).toEqual(gate)
    const next = advanceSeason(finished)
    expect(financeLedgerTicket(next.finance, fixture.id)?.attendance).toBe(gate.attendance)
    expect(matchGate({ ...season, activeMatch: null })).toBeNull()
  })
})
