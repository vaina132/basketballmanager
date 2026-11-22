import type { Player, PlayerStats, Position } from '../domain/types'
import { COURT_POSITIONS, outOfPositionPercent } from '../engine/positions'
import { playerMatchRating } from '../world/performance-rating'

export type BenchSort = 'position' | 'rating'
/**
 * The bench order (owner request, 18 November 2026): by position (PG to C) or by match rating so far, best first and
 * players who have not played last. Ties keep the position order, then the squad order.
 */
export function sortBench(players: readonly Player[], stats: Readonly<Record<string, PlayerStats | undefined>>, sort: BenchSort): Player[] {
  const rating = (id: string) => playerMatchRating(stats[id]) ?? -1
  return players.map((player, index) => ({ player, index }))
    .sort((a, b) => (sort === 'rating' ? rating(b.player.id) - rating(a.player.id) : 0) || COURT_POSITIONS.indexOf(a.player.position) - COURT_POSITIONS.indexOf(b.player.position) || a.index - b.index)
    .map(entry => entry.player)
}

/** What the manager has picked on the court picture: a circle (with or without a player) or a reserve on the bench. */
export type CourtPick = { kind: 'circle'; position: Position } | { kind: 'bench'; playerId: string }
/** A completed pick: this player goes to this circle (`placeInCircle`). */
export interface CourtMove { playerId: string; position: Position }

/**
 * The court picture with the basket at the top (owner request, 18 November 2026): the centre and power forward by the
 * basket, the forwards' and guards' wings below them, the point guard at the bottom. Circles are listed top to bottom
 * and left to right, the order they are read and reached with the keyboard. `left` and `top` are the circle's centre in
 * percent of the court.
 */
export const COURT_PICTURE_SPOTS: readonly { position: Position; left: number; top: number }[] = [
  { position: 'C', left: 33, top: 19 },
  { position: 'PF', left: 67, top: 24 },
  { position: 'SF', left: 16, top: 54 },
  { position: 'SG', left: 84, top: 54 },
  { position: 'PG', left: 50, top: 75 },
]

export const occupantOf = (circles: Readonly<Record<string, Position>>, position: Position): string | undefined => Object.keys(circles).find(id => circles[id] === position)
export const samePick = (a: CourtPick | null, b: CourtPick | null): boolean => !!a && !!b && (a.kind === 'circle' && b.kind === 'circle' ? a.position === b.position : a.kind === 'bench' && b.kind === 'bench' && a.playerId === b.playerId)

/**
 * The one rule behind dragging and tapping (a drag's source and drop target are the two picks of a tap pair):
 * a reserve and a circle put the reserve in that circle; two circles move the first circle's player to the second (its
 * player, if any, takes the first circle). Two reserves, the same pick twice or a reserve with an empty circle make
 * no change.
 */
export function resolveCourtPick(circles: Readonly<Record<string, Position>>, from: CourtPick, to: CourtPick): CourtMove | null {
  if (samePick(from, to)) return null
  if (from.kind === 'bench' && to.kind === 'bench') return null
  if (from.kind === 'bench') return to.kind === 'circle' && occupantOf(circles, to.position) ? { playerId: from.playerId, position: to.position } : null
  if (to.kind === 'bench') return occupantOf(circles, from.position) ? { playerId: to.playerId, position: from.position } : null
  const mover = occupantOf(circles, from.position)
  if (mover) return { playerId: mover, position: to.position }
  const other = occupantOf(circles, to.position)
  return other ? { playerId: other, position: from.position } : null
}

/** The circle's warning text for a player listed at `listed`: null in his own position. */
export function outOfPositionWarning(listed: Position, played: Position): string | null {
  const percent = outOfPositionPercent(listed, played)
  return percent ? `Out of position: −${percent}%` : null
}
