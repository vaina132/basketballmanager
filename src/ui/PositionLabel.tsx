import type { Position } from '../domain/types'
import type { DevelopmentPlayerProfile } from '../data/development-player-profiles'

/** Compact evidence cue; estimates must not look like researched five-position facts. */
export function PositionLabel({ position, profile }: { position: Position; profile?: DevelopmentPlayerProfile }) {
  const source = profile?.positionSource ?? (profile?.source === 'estimated-from-age' ? 'unverified' : undefined)
  const uncertain = source === 'estimated' || source === 'unverified'
  const explanation = source === 'estimated' ? 'Estimated role: the source does not establish this exact position.' : source === 'unverified' ? 'This position has not been checked against a precise source.' : source === 'official' ? 'Position checked against an official club or competition source.' : 'Reported position.'
  return <span title={explanation} aria-label={`${position}${uncertain ? ', estimated position' : ''}`}>{position}{uncertain && <small> · est.</small>}</span>
}
