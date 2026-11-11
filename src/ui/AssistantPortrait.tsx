import { CoachPortrait } from './CoachPortrait'

/** Stable cosmetic portraits for fictional assistant coaches. */
export function AssistantPortrait({ coach, size = 64, color }: { coach: { id: string; name: string }; size?: number; color?: string }) {
  const identity = [...coach.id].reduce((hash, letter) => (hash * 31 + letter.charCodeAt(0)) >>> 0, 43)
  return <CoachPortrait coach={{ id: String(identity), name: coach.name }} size={size} color={color} />
}
