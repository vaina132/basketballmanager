import type { SeasonState } from '../domain/season'
import type { MatchEvent, Side } from '../domain/types'
import { forecastGate } from '../world/finance'
import { financeLedgerTicket } from '../world/finance-ledger'
import type { Animation } from './choreography'
import { project, rgb } from './projection'

/**
 * Supporters in the stands around the live court (presentation only). The crowd reads the match's gate (attendance and
 * arena capacity) and the plays already on screen; it never touches match randomness or results.
 */

export interface Gate { attendance: number; capacity: number }

/** Seats filled when the attendance is unknown (friendlies, visiting background clubs). */
export const UNKNOWN_DENSITY = .6

export function crowdDensity(gate: Gate | null | undefined): number | null {
  if (!gate || !Number.isFinite(gate.attendance) || !Number.isFinite(gate.capacity) || gate.capacity <= 0) return null
  return Math.max(0, Math.min(1, gate.attendance / gate.capacity))
}

/**
 * The gate of the career's current match: the booked ticket once the week's gates are posted, otherwise the same
 * forecast the week will book (the home club's locked price for this week). Null when there is no gate to read.
 */
export function matchGate(season: SeasonState): Gate | null {
  if (!season.activeMatch || !season.finance?.enabledSince) return null
  const fixture = season.fixtures.find(item => item.id === season.activeFixtureId)
  if (!fixture) return null
  try {
    const ticket = financeLedgerTicket(season.finance, fixture.id)
    if (ticket) return { attendance: ticket.attendance, capacity: ticket.capacity ?? forecastGate(season, fixture, ticket.price).capacity }
    const price = season.finance.roundPrices[fixture.homeClubId]
    if (price === undefined) return null
    const gate = forecastGate(season, fixture, price)
    return { attendance: gate.attendance, capacity: gate.capacity }
  } catch {
    return null
  }
}

export interface Fan {
  /** Picture position of the fan's feet. */
  x: number
  y: number
  side: Side
  color: string
  skin: number
  /** Home fans join the wave in three groups, left to right. */
  wave: 0 | 1 | 2
  /** Only some fans stand up and cheer, so only a few shapes move. */
  cheers: boolean
}

export interface Crowd {
  /** Share of seats filled (0-1). */
  density: number
  known: boolean
  seats: number
  awaySeats: number
  fans: Fan[]
  stands: string[]
}

export const SKIN_TONES = ['#f0c8a0', '#c98d62', '#8a5a3c']
const NEUTRAL = ['#d9d5c9', '#8e938c', '#5d6561', '#ece8dd']
const WEIGHTS = [.45, .2, .15, .2]

function mix(color: [number, number, number], target: number, amount: number): string {
  return `#${color.map(value => Math.round(value + (target - value) * amount).toString(16).padStart(2, '0')).join('')}`
}
/** Club colour, a lighter and a darker shade, and some fans in plain shirts. Without a valid colour, plain shirts only. */
export function fanPalette(color: string): string[] {
  const base = rgb(color)
  if (!base) return NEUTRAL
  return [mix(base, 0, 0), mix(base, 255, .35), mix(base, 0, .3), '#dcd8cc']
}

function hash(text: string): number {
  let value = 2166136261
  for (let index = 0; index < text.length; index += 1) value = Math.imul(value ^ text.charCodeAt(index), 16777619) >>> 0
  return value
}
/** A small local generator seeded from the two clubs: the same match always shows the same crowd. */
function generator(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Seat { x: number; y: number; away: boolean; priority: number }
/** Stand outlines in court coordinates: behind the far sideline and behind both baselines. */
const STANDS: [number, number, number, number][] = [[-.09, 1.06, 1.11, 1.31], [-.175, -.05, -.055, 1.06], [1.055, -.05, 1.175, 1.06]]

function seatPlan(random: () => number): Seat[] {
  const seats: Seat[] = []
  const add = (x: number, y: number, row: number, rows: number, away: boolean) => {
    const p = project(x, y)
    // Central, lower seats sell first.
    seats.push({ x: p.x, y: p.y, away, priority: random() * .6 + row / rows * .25 + Math.abs(x - .5) * .25 })
  }
  for (let row = 0; row < 4; row += 1) for (let x = -.05; x <= 1.075; x += .022) add(x, 1.085 + row * .062, row, 4, x >= .87)
  for (let row = 0; row < 3; row += 1) for (let y = 0; y <= 1.065; y += .04) { add(-.075 - row * .035, y, row, 3, false); add(1.075 + row * .035, y, row, 3, false) }
  return seats
}

export function buildCrowd(input: { homeId: string; awayId: string; homeColor: string; awayColor: string; gate?: Gate | null }): Crowd {
  const random = generator(hash(`${input.homeId}|${input.awayId}`))
  const seats = seatPlan(random)
  const measured = crowdDensity(input.gate)
  const density = measured ?? UNKNOWN_DENSITY
  const palettes: Record<Side, string[]> = { home: fanPalette(input.homeColor), away: fanPalette(input.awayColor) }
  const fans: Fan[] = []
  // Each section fills in its own order, so a bigger attendance always adds fans to a smaller one.
  for (const away of [false, true]) {
    const section = seats.filter(seat => seat.away === away).sort((a, b) => a.priority - b.priority)
    const filled = section.slice(0, Math.round(section.length * density))
    filled.forEach((seat, index) => {
      const side: Side = away ? 'away' : 'home'
      let pick = random(), shade = 0
      while (shade < WEIGHTS.length - 1 && pick > WEIGHTS[shade]!) { pick -= WEIGHTS[shade]!; shade += 1 }
      fans.push({ x: seat.x, y: seat.y, side, color: palettes[side][shade]!, skin: Math.floor(random() * SKIN_TONES.length), wave: seat.x < 330 ? 0 : seat.x < 600 ? 1 : 2, cheers: away ? index % 2 === 0 : index % 3 === 0 })
    })
  }
  // Back rows first, so nearer fans are drawn over farther ones.
  fans.sort((a, b) => a.y - b.y || a.x - b.x)
  const stands = STANDS.map(([x0, y0, x1, y1]) => [project(x0, y0), project(x1, y0), project(x1, y1), project(x0, y1)].map((p, index) => `${index ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('') + 'Z')
  return { density, known: measured !== null, seats: seats.length, awaySeats: seats.filter(seat => seat.away).length, fans, stands }
}

export interface Cheer { key: string; side: Side; strength: 'small' | 'normal' | 'big'; flash: boolean }

/**
 * How the crowd answers the play on screen: a basket (from the moment the ball drops), a block or a steal, and the
 * final buzzer for the winners. Home baskets bring a wave and a flash; away baskets only stir the small away section.
 */
export function crowdCheer(input: { event?: MatchEvent; animation: Animation | null; progress: number; sideOf: (playerId: string) => Side | undefined; finished: boolean; winner?: Side }): Cheer | null {
  if (input.finished) return input.winner ? { key: 'final', side: input.winner, strength: 'big', flash: input.winner === 'home' } : null
  const { event, animation } = input
  if (!event || !animation) return null
  const mark = animation.marks.find(item => (item.kind === 'score' || item.kind === 'block' || item.kind === 'steal') && input.progress >= item.start)
  if (!mark) return null
  if (mark.kind === 'score') {
    const shot = event.shot
    const strength = animation.kind === 'free-throw' ? 'small' : shot?.value === 3 || (shot?.distanceM !== undefined && shot.distanceM < 1.2) ? 'big' : 'normal'
    return { key: `${event.id}-score`, side: animation.offense, strength, flash: animation.offense === 'home' && strength !== 'small' }
  }
  const side = 'playerId' in mark.at ? input.sideOf(mark.at.playerId) : undefined
  return side ? { key: `${event.id}-${mark.kind}`, side, strength: 'normal', flash: false } : null
}
