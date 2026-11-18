import type { Position } from '../domain/types'
import type { DevelopmentPlayerProfile } from '../data/development-player-profiles'

/**
 * A player's position. The owner removed the visible "est." marking (18 November 2026); where the exact position is
 * not sourced, the hover text still says so. `estimateMark` brings the marking back where a screen needs it.
 */
export function PositionLabel({ position, profile, estimateMark = false }: { position: Position; profile?: DevelopmentPlayerProfile; estimateMark?: boolean }) {
  const source = profile?.positionSource ?? (profile?.source === 'estimated-from-age' ? 'unverified' : undefined)
  const uncertain = estimateMark && (source === 'estimated' || source === 'unverified')
  const explanation = source === 'estimated' ? 'Estimated role: the source does not establish this exact position.' : source === 'unverified' ? 'This position has not been checked against a precise source.' : source === 'official' ? 'Position checked against an official club or competition source.' : 'Reported position.'
  return <span title={explanation} aria-label={`${position}${uncertain ? ', estimated position' : ''}`}>{position}{uncertain && <small> · est.</small>}</span>
}
