import type { Player } from '../domain/types'

export function Avatar({ player, color, size = 42 }: { player: Player; color: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={`${player.name}, number ${player.number}`} className="avatar">
    <rect width="64" height="64" rx="18" fill="var(--surface-3)" />
    <path d="M8 64v-8c0-12 11-19 24-19s24 7 24 19v8" fill={color} />
    <path d="M25 34v9c3 5 11 5 14 0v-9" fill={player.skinTone} />
    <ellipse cx="32" cy="25" rx="13" ry="16" fill={player.skinTone} />
    <path d="M19 23V17c1-16 25-16 26 0v6l-4-9c-4 3-12 4-19 2Z" fill={player.hairColor} />
    <path d="M26 25h1m10 0h1" stroke="#292320" strokeWidth="2" strokeLinecap="round" />
    <path d="M29 33q3 2 6 0" fill="none" stroke="#533d32" strokeWidth="1.3" strokeLinecap="round" />
    <path d="m20 42 6 6m18-6-6 6" fill="none" stroke="#fff" strokeOpacity=".5" strokeWidth="2" />
    <text x="32" y="61" textAnchor="middle" fontSize="12" fontWeight="700" fill="#fff">{player.number}</text>
  </svg>
}
