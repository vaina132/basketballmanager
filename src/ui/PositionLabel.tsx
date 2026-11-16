import type { Position } from '../domain/types'
import type { DevelopmentPlayerProfile } from '../data/development-player-profiles'

/**
 * Compact evidence cue; estimates must not look like researched five-position facts. `estimateMark={false}` leaves out
 * the visible "est." (owner decision, 16 November 2026: not needed on the career start's club step); the tooltip stays.
 */
export function PositionLabel({ position, profile, estimateMark = true }: { position: Position; profile?: DevelopmentPlayerProfile; estimateMark?: boolean }) {
  const source = profile?.positionSource ?? (profile?.source === 'estimated-from-age' ? 'unverified' : undefined)
  const uncertain = estimateMark && (source === 'estimated' || source === 'unverified')
  const explanation = source === 'estimated' ? 'Estimated role: the source does not establish this exact position.' : source === 'unverified' ? 'This position has not been checked against a precise source.' : source === 'official' ? 'Position checked against an official club or competition source.' : 'Reported position.'
  return <span title={explanation} aria-label={`${position}${uncertain ? ', estimated position' : ''}`}>{position}{uncertain && <small> · est.</small>}</span>
}
