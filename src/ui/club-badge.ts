import { shade } from './player-drawing.ts'

/**
 * Drawn club badges (owner decision, 27 November 2026): real logos are not used. Every club gets a badge in one style,
 * drawn from its colour and short name; the shape and stripe follow the club id, so a club always looks the same.
 */
const hash = (text: string): number => {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}
const rgb = (hex: string): [number, number, number] | null => /^#[0-9a-f]{6}$/i.test(hex) ? [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number] : null
const light = (hex: string): boolean => { const c = rgb(hex); return c ? c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114 > 170 : false }
const escapeText = (text: string): string => text.replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`)

const SHAPES = [
  'M50 4 L90 16 V50 C90 74 72 89 50 96 C28 89 10 74 10 50 V16 Z',
  'M50 4 A46 46 0 1 1 49.9 4 Z',
  'M14 6 H86 Q94 6 94 14 V62 Q94 84 50 96 Q6 84 6 62 V14 Q6 6 14 6 Z',
  'M50 3 L95 50 L50 97 L5 50 Z',
] as const

/** The badge's inner SVG markup on a 100 x 100 canvas. */
export function badgeMarkup(clubId: string, label: string, color: string | null | undefined): string {
  const fill = color && rgb(color) ? color : '#687385'
  const ink = light(fill) ? '#1c2521' : '#ffffff'
  const edge = shade(fill, -0.35)
  const h = hash(clubId)
  const shape = SHAPES[h % SHAPES.length]!
  const stripe = (h >>> 3) % 3
  const band = stripe === 0 ? '<rect x="0" y="40" width="100" height="16"/>' : stripe === 1 ? '<path d="M0 72 L72 0 H100 L0 100 Z"/>' : '<rect x="38" y="0" width="24" height="100"/>'
  const text = escapeText(label.slice(0, 3).toUpperCase())
  const id = `b${h.toString(36)}`
  return `<defs><clipPath id="${id}"><path d="${shape}"/></clipPath></defs>`
    + `<path d="${shape}" fill="${fill}"/>`
    + `<g clip-path="url(#${id})" fill="${ink}" opacity=".18">${band}</g>`
    + `<path d="${shape}" fill="none" stroke="${edge}" stroke-width="5"/>`
    + `<path d="${shape}" fill="none" stroke="${ink}" stroke-opacity=".55" stroke-width="1.6" transform="translate(50 50) scale(.86) translate(-50 -50)"/>`
    + `<text x="50" y="${shape === SHAPES[3] ? 59 : 61}" text-anchor="middle" font-family="Arial Black,Arial,sans-serif" font-weight="900" font-size="${text.length > 2 ? 27 : 33}" fill="${ink}" stroke="${edge}" stroke-width="1.2" paint-order="stroke">${text}</text>`
}

/** A small emblem for a competition: a ring with its initials. */
export function competitionMarkup(name: string): string {
  const initials = escapeText(name.split(/[\s-]+/).filter(word => /^[\p{L}\d]/u.test(word)).map(word => word[0]!.toUpperCase()).join('').slice(0, 3) || '?')
  return `<circle cx="50" cy="50" r="45" fill="#24302b"/><circle cx="50" cy="50" r="37" fill="none" stroke="#e6c35a" stroke-width="5"/>`
    + `<text x="50" y="60" text-anchor="middle" font-family="Arial Black,Arial,sans-serif" font-weight="900" font-size="${initials.length > 2 ? 26 : 32}" fill="#f4ead0">${initials}</text>`
}
