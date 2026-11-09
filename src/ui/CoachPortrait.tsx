import type { Coach } from '../domain/coaching'

/** Cosmetic portraits for the fictional coaching pool; appearance never affects coaching. */
export function CoachPortrait({ coach, color = '#e5aa55', size = 82 }: { coach: Pick<Coach, 'id' | 'name'>; color?: string; size?: number }) {
  const identity = Number(coach.id.replace(/\D/g, '')) || 1
  const skin = ['#e3b38d', '#c99068', '#a66f4c', '#754b36', '#efc7a4'][identity % 5]
  const hair = ['#302923', '#655140', '#a09b91', '#4d382d', '#c2b4a2', '#25272b'][Math.floor(identity / 5) % 6]
  const style = identity % 4
  return <svg className="coach-portrait" viewBox="0 0 96 110" width={size} height={size * 110 / 96} aria-hidden="true" focusable="false">
    <rect width="96" height="110" rx="3" fill="#28313b" />
    <path d="M67 0h29v110H12z" fill={color} opacity=".12" />
    <path d="M4 110v-13c0-15 18-25 44-25s44 10 44 25v13" fill="#3d4857" />
    <path d="m30 80 18 25 18-25-11-8H41z" fill="#d4d8db" />
    <path d="m43 83 5 4 5-4-2 10 4 17H41l4-17z" fill={color} />
    <path d="M38 60h20v20L48 86 38 80z" fill={skin} />
    <path d="m29 79 12 31H25l7-16-11-9zM67 79l-12 31h16l-7-16 11-9z" fill="#29323f" />
    <ellipse cx="26" cy="45" rx="5" ry="8" fill={skin} /><ellipse cx="70" cy="45" rx="5" ry="8" fill={skin} />
    <path d="M26 30c0-17 44-17 44 0v23c0 16-13 24-22 24s-22-8-22-24z" fill={skin} />
    {style === 0 && <path d="M25 42V28C24 7 69 6 72 26l-3 15-5-15-11 1-6-9-12 11-6 13z" fill={hair} />}
    {style === 1 && <path d="M25 40V26C27 9 68 8 71 28v13l-5-17c-11 10-21 8-35 7l-2 11z" fill={hair} />}
    {style === 2 && <path d="M25 41V27c4-7 6-8 9-8l-4 22zM71 41V27c-4-7-6-8-9-8l4 22z" fill={hair} />}
    {style === 3 && <path d="M25 41V27C25 9 71 9 71 27v14l-5-13H32l-3 13z" fill={hair} />}
    <path d="M33 40h9M54 40h9" stroke={hair} strokeWidth="2.5" strokeLinecap="round" />
    <circle cx="38" cy="46" r="1.7" fill="#272522" /><circle cx="58" cy="46" r="1.7" fill="#272522" />
    <path d="m48 46-3 10h6" fill="none" stroke="#79513a" strokeWidth="1.3" opacity=".6" />
    {identity % 3 === 0 && <path d="M29 53c6 7 9 6 13 4h12c4 2 7 3 13-4-1 15-13 21-19 21s-18-6-19-21" fill={hair} opacity=".8" />}
    <path d="M41 63q7 4 14 0" fill="none" stroke="#694638" strokeWidth="1.7" strokeLinecap="round" />
    {identity % 5 === 0 && <g fill="none" stroke="#353b42" strokeWidth="2"><rect x="29" y="41" width="17" height="12" rx="3" /><rect x="50" y="41" width="17" height="12" rx="3" /><path d="M46 45h4M25 43h4M67 43h4" /></g>}
  </svg>
}
