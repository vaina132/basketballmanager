import type { Scout } from '../domain/scouts'
import { CoachPortrait } from './CoachPortrait'

/** Cosmetic identity only; scout appearance has no effect on reports. */
export function ScoutPortrait({ scout, size = 64, color }: { scout: Pick<Scout, 'id' | 'name'>; size?: number; color?: string }) {
  const identity = [...scout.id].reduce((hash, letter) => (hash * 31 + letter.charCodeAt(0)) >>> 0, 17)
  return <CoachPortrait coach={{ id: String(identity), name: scout.name }} size={size} color={color} />
}
