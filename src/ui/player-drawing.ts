import { HAIR_COLORS, SKIN_TONES } from './player-look.ts'
import type { PlayerLook } from './player-look.ts'

/**
 * The drawn portrait: head and shoulders in a club-coloured vest, on a 128 x 128 canvas. One function, one style,
 * for every player. Returns SVG markup built only from the look's fixed palettes and the club colours.
 */
type Pt = readonly [number, number]
const hex = (h: string): number[] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const toHex = (c: number[]): string => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
/** Darker (f < 0) or lighter (f > 0). */
export const shade = (h: string, f: number): string => /^#[0-9a-f]{6}$/i.test(h) ? toHex(hex(h).map((v) => (f < 0 ? v * (1 + f) : v + (255 - v) * f))) : h
const n = (v: number): string => (Math.round(v * 10) / 10).toString()
const bumps = (pts: readonly Pt[], r: number): string => pts.map(([x, y]) => `<circle cx="${n(x)}" cy="${n(y)}" r="${r}"/>`).join('')
const arc = (cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, count: number): Pt[] => Array.from({ length: count }, (_, i) => {
  const a = (a0 + ((a1 - a0) * i) / (count - 1)) * Math.PI / 180
  return [cx + rx * Math.cos(a), cy - ry * Math.sin(a)] as const
})

/** [half width, jaw half width, top of head, chin]. */
const FACE_SHAPES: Record<PlayerLook['face'], readonly [number, number, number, number]> = { oval: [21, 15, 24, 77], round: [22.5, 17, 25, 75], long: [20, 13.5, 23, 79], square: [22, 18, 25, 76] }
const CAP_LIFT: Record<PlayerLook['hair'], number> = { bald: 0, shaved: 0, buzz: 1.5, short: 4, receding: 3, 'side-part': 7, messy: 8, wavy: 8, 'curly-top': 6, afro: 6, 'locs-bun': 2, locs: 3, long: 5, bun: 3, cornrows: 1.5 }
const HAIRLINE: Partial<Record<PlayerLook['hair'], number>> = { buzz: 32, shaved: 32, cornrows: 32, receding: 34, 'side-part': 32 }

export interface DrawingColors { primary: string; secondary: string }

/** The inner markup of the portrait (everything inside the 0 0 128 128 svg). */
export function drawingMarkup(look: PlayerLook, { primary, secondary }: DrawingColors): string {
  const skin = SKIN_TONES[look.skin - 1] ?? SKIN_TONES[4]
  const hair = HAIR_COLORS[look.hairColor]
  const beardC = HAIR_COLORS[look.beardColor ?? look.hairColor]
  const [w, jw, top, chin] = FACE_SHAPES[look.face]
  const mid = 50, L = 64 - w, R = 64 + w
  const facePath = `M64 ${top}C${n(64 + w * 0.95)} ${top} ${R} ${top + 13} ${R} ${mid}C${R} ${mid + 13} ${64 + jw} ${chin - 5} 64 ${chin}C${64 - jw} ${chin - 5} ${L} ${mid + 13} ${L} ${mid}C${L} ${top + 13} ${n(64 - w * 0.95)} ${top} 64 ${top}Z`
  const dark = shade(skin, -0.22), deep = shade(skin, -0.4), lip = shade(skin, -0.3), sheen = shade(hair, 0.2)
  const o: string[] = []
  o.push(`<rect width="128" height="128" fill="${shade(primary, 0.86)}"/><circle cx="64" cy="58" r="50" fill="${shade(primary, 0.75)}"/>`)
  o.push(`<g transform="translate(64 69) scale(1.14) translate(-64 -62)">`)

  // Hair behind the head
  if (look.hair === 'afro') o.push(`<g fill="${hair}">${bumps(arc(64, 46, 27, 27, -20, 200, 14), 9)}<ellipse cx="64" cy="42" rx="28" ry="24"/></g>`)
  if (look.hair === 'locs-bun') {
    const locs = ([[-15, 20], [-11, 14], [11, 14], [15, 20]] as const).map(([dx, dy]) => `<path d="M${n(64 + dx * 0.3)} ${top - 6}Q${n(64 + dx * 1.2)} ${top - 10} ${n(64 + dx * 1.15)} ${top + dy}"/>`).join('')
    o.push(`<g stroke="${hair}" stroke-width="4.2" fill="none" stroke-linecap="round">${locs}</g><g fill="${hair}"><ellipse cx="64" cy="${top - 9}" rx="10" ry="8.5"/>${bumps(arc(64, top - 9, 8, 7.5, 0, 180, 6), 3.4)}</g><path d="M58 ${top - 12}V${top - 4}M62 ${top - 15}V${top - 4}M66 ${top - 15}V${top - 4}M70 ${top - 12}V${top - 4}" stroke="${sheen}" stroke-width=".9"/>`)
  }
  if (look.hair === 'locs') {
    const strands = [-26, -22, -18, 18, 22, 26].map((dx, i) => `<path d="M${64 + dx * 0.75} ${top + 4}C${64 + dx * 1.05} ${top + 20} ${64 + dx} ${top + 40} ${64 + dx * 0.95} ${top + 62 - (i % 3) * 4}"/>`).join('')
    o.push(`<g stroke="${hair}" stroke-width="5" fill="none" stroke-linecap="round">${strands}</g>`)
  }
  if (look.hair === 'long') o.push(`<path d="M${L - 4} ${mid}C${L - 7} ${top - 6} ${R + 7} ${top - 6} ${R + 4} ${mid}C${R + 6} ${mid + 18} ${R + 3} ${mid + 30} ${R - 2} ${mid + 36}H${L + 2}C${L - 3} ${mid + 30} ${L - 6} ${mid + 18} ${L - 4} ${mid}Z" fill="${hair}"/>`)
  if (look.hair === 'bun') o.push(`<circle cx="64" cy="${top - 5}" r="7" fill="${hair}"/><path d="M59 ${top - 7}Q64 ${top - 11} 69 ${top - 7}" stroke="${sheen}" stroke-width=".9" fill="none"/>`)

  // Shoulders, neck and vest
  o.push(`<path d="M8 128C9 106 28 97 50 94H78C100 97 119 106 120 128Z" fill="${skin}"/><path d="M8 128C9 106 28 97 50 94H52C40 100 26 108 22 128Z" fill="${dark}" opacity=".35"/>`)
  o.push(`<path d="M51 64H77V98C71 103 57 103 51 98Z" fill="${skin}"/><path d="M51 70C58 ${chin + 4} 70 ${chin + 4} 77 70V82C70 86 58 86 51 82Z" fill="${deep}" opacity=".45"/>`)
  o.push(`<path d="M28 128L33 104C38 99 44 96 48 95L64 112L80 95C84 96 90 99 95 104L100 128Z" fill="${primary}"/>`)
  o.push(`<path d="M48 95L64 112L80 95" fill="none" stroke="${secondary}" stroke-width="3.2" stroke-linejoin="round"/><path d="M33 104C38 99 44 96 48 95M80 95C84 96 90 99 95 104" fill="none" stroke="${secondary}" stroke-width="2.4"/>`)

  // Ears and face
  o.push(`<g fill="${skin}"><ellipse cx="${L + 1}" cy="54" rx="4.6" ry="7"/><ellipse cx="${R - 1}" cy="54" rx="4.6" ry="7"/></g><g fill="${dark}" opacity=".5"><ellipse cx="${L + 1.5}" cy="54" rx="2" ry="4"/><ellipse cx="${R - 1.5}" cy="54" rx="2" ry="4"/></g>`)
  o.push(`<path d="${facePath}" fill="${skin}"/>`)
  o.push(`<path d="M${R} ${mid}C${R} ${mid + 13} ${64 + jw} ${chin - 5} 64 ${chin}C${n(64 + jw * 0.8)} ${chin - 9} ${R - 4} ${mid + 10} ${R - 3} ${mid - 6}C${R - 3} ${top + 14} ${n(64 + w * 0.6)} ${top + 3} 64 ${top}C${n(64 + w * 0.95)} ${top} ${R} ${top + 13} ${R} ${mid}Z" fill="${dark}" opacity=".28"/>`)

  // Beard, before the eyes and mouth
  if (look.beard !== 'none') {
    const moustache = `<path d="M56 66C58 63 62 63 64 64C66 63 70 63 72 66C69 66 66 66.5 64 66C62 66.5 59 66 56 66Z" fill="${beardC}"/>`
    if (look.beard === 'moustache') o.push(moustache)
    else {
      const drop = { stubble: 0, goatee: 3, short: 1.5, full: 4.5, thick: 8 }[look.beard]
      const op = { stubble: 0.32, goatee: 1, short: 0.92, full: 1, thick: 1 }[look.beard]
      const c = chin + drop
      const region = look.beard === 'goatee'
        ? `M56 66C56 62 72 62 72 66C73 70 72 ${c - 3} 64 ${c}C56 ${c - 3} 55 70 56 66Z`
        : `M${n(L + 0.5)} ${mid + 2}C${L} ${mid + 14} ${64 - jw - 1} ${c - 4} 64 ${c}C${64 + jw + 1} ${c - 4} ${R} ${mid + 14} ${n(R - 0.5)} ${mid + 2}C${R - 4} ${mid + 6} ${R - 6} ${mid + 13} 74 64C70 62 58 62 54 64C${L + 6} ${mid + 13} ${L + 4} ${mid + 6} ${n(L + 0.5)} ${mid + 2}Z`
      o.push(`<path d="${region}" fill="${beardC}" opacity="${op}"/>`)
      if (look.beard !== 'stubble') o.push(moustache)
    }
  }

  // Eyes and brows
  const by = 45.5
  const bw = { thin: 1.6, normal: 2.3, thick: 3.1 }[look.brows]
  const browC = look.hairColor === 'black' ? hair : shade(hair, look.hairColor === 'platinum' || look.hairColor === 'blond' ? -0.35 : -0.15)
  o.push(`<g fill="#fff"><ellipse cx="55.5" cy="52" rx="3.8" ry="2.3"/><ellipse cx="72.5" cy="52" rx="3.8" ry="2.3"/></g><g fill="#2a1c15"><circle cx="56" cy="52" r="2.1"/><circle cx="73" cy="52" r="2.1"/></g>`)
  o.push(`<path d="M51.5 51.2Q55.5 48.6 59.5 51.2M68.5 51.2Q72.5 48.6 76.5 51.2" fill="none" stroke="${deep}" stroke-width="1.2" stroke-linecap="round"/>`)
  o.push(`<path d="M50.5 ${by + 1}Q55 ${by - 1.6} 60 ${by}M68 ${by}Q73 ${by - 1.6} 77.5 ${by + 1}" fill="none" stroke="${browC}" stroke-width="${bw}" stroke-linecap="round"/>`)

  // Nose and mouth
  const nw = look.nose === 'wide' ? 4.6 : 3.4
  o.push(`<path d="M63 54L61.5 61.5" fill="none" stroke="${dark}" stroke-width="1.1" stroke-linecap="round" opacity=".7"/><path d="M${64 - nw} 61.5Q64 64.5 ${64 + nw} 61.5" fill="none" stroke="${deep}" stroke-width="1.4" stroke-linecap="round"/>`)
  const covered = look.beard !== 'none' && look.beard !== 'stubble'
  o.push(`<path d="M58.5 69Q64 70.6 69.5 69" fill="none" stroke="${covered ? shade(skin, -0.05) : lip}" stroke-width="1.6" stroke-linecap="round"/>`)

  // Hair on top
  const capTop = top - CAP_LIFT[look.hair]
  const hl = HAIRLINE[look.hair] ?? 33
  const cap = (t: number, h: number, op = 1, temples = 0): string => `<path d="M${n(L - 0.5)} ${h + 13}C${L - 1} ${t + 4} ${n(64 - w * 0.6)} ${t} 64 ${t}C${n(64 + w * 0.6)} ${t} ${R + 1} ${t + 4} ${n(R + 0.5)} ${h + 13}C${n(R - 1.5)} ${h + 5} ${R - 3} ${h + temples} 73 ${n(h - temples * 0.3)}C68 ${h + 1} 60 ${h + 1} 55 ${n(h - temples * 0.3)}C${L + 3} ${h + temples} ${n(L + 1.5)} ${h + 5} ${n(L - 0.5)} ${h + 13}Z" fill="${hair}"${op < 1 ? ` opacity="${op}"` : ''}/>`
  switch (look.hair) {
    case 'bald': o.push(`<ellipse cx="57" cy="${top + 6}" rx="7" ry="3" fill="#fff" opacity=".18"/>`); break
    case 'shaved': o.push(cap(capTop, hl - 1, 0.4)); break
    case 'buzz': o.push(cap(capTop, hl, 0.9)); break
    case 'short': case 'afro': case 'bun': o.push(cap(capTop, hl)); break
    case 'receding': o.push(cap(capTop, hl, 1, 4)); break
    case 'side-part':
      o.push(cap(capTop, hl - 1))
      o.push(`<path d="M${L} ${hl + 6}C${L + 2} ${capTop - 2} ${R + 4} ${capTop - 4} ${R + 1} ${hl + 10}C${R - 4} ${hl - 2} 70 ${hl - 1} 60 ${hl + 3}C55 ${hl + 5} ${L + 3} ${hl + 6} ${L} ${hl + 6}Z" fill="${hair}"/>`)
      break
    case 'messy':
      o.push(cap(capTop, hl - 1))
      o.push(`<g fill="${hair}"><path d="M${L - 1} ${hl + 8}C${L - 3} ${top + 4} ${L} ${capTop + 4} ${L + 6} ${capTop + 1}L${L + 10} ${capTop + 3}L${L + 14} ${capTop - 1}L${64 - 2} ${capTop + 2}L${64 + 3} ${capTop - 2}L${R - 12} ${capTop + 2}L${R - 7} ${capTop}C${R + 1} ${capTop + 5} ${R + 3} ${top + 4} ${R + 1} ${hl + 8}Z"/><path d="M${L + 2} ${hl + 2}L${L + 6} ${hl + 9}L${L + 9} ${hl + 2}L56 ${hl + 7}L60 ${hl + 1}L66 ${hl + 6}L70 ${hl}L76 ${hl + 5}L${R - 2} ${hl + 2}L${R - 2} ${hl - 4}H${L + 2}Z"/></g>`)
      break
    case 'wavy':
      o.push(cap(capTop, hl - 1))
      o.push(`<g fill="${hair}">${bumps(arc(64, top + 8, w + 2, 15, 0, 180, 10), 5)}${bumps([[L + 4, hl + 2], [54, hl + 3], [61, hl + 1], [68, hl + 2], [75, hl + 1], [R - 4, hl + 2]], 3.6)}</g>`)
      break
    case 'curly-top':
      o.push(cap(top - 1, hl, 0.95))
      o.push(`<g fill="${hair}">${bumps(arc(64, top - 1, w - 2, 9, 15, 165, 9), 5.6)}${bumps(arc(64, top + 2, w - 6, 3, 0, 180, 6), 5)}</g>`)
      break
    case 'locs-bun':
      o.push(cap(top - 1, hl))
      o.push(`<path d="M${L + 2} ${hl + 4}Q64 ${top - 6} ${R - 2} ${hl + 4}" fill="none" stroke="${sheen}" stroke-width="1" opacity=".7"/>`)
      break
    case 'locs':
      o.push(cap(capTop, hl))
      o.push(`<path d="M54 ${capTop + 3}V${hl + 1}M60 ${capTop + 1}V${hl}M66 ${capTop + 1}V${hl}M72 ${capTop + 2}V${hl + 1}M78 ${capTop + 5}V${hl + 3}M50 ${capTop + 6}V${hl + 3}" stroke="${sheen}" stroke-width="1" opacity=".75"/>`)
      break
    case 'long':
      o.push(`<path d="M${L - 1} ${mid + 6}C${L - 3} ${capTop - 9} ${R + 3} ${capTop - 9} ${R + 1} ${mid + 6}C${R - 2} ${hl + 8} ${R - 5} ${hl} 66 ${hl}C62 ${hl + 4} ${L + 4} ${hl + 6} ${L + 1} ${mid + 6}Z" fill="${hair}"/>`)
      break
    case 'cornrows':
      o.push(cap(capTop, hl))
      o.push(`<path d="M52 ${hl + 2}Q50 ${top + 6} 56 ${capTop + 2}M58 ${hl + 1}Q57 ${top + 5} 61 ${capTop}M64 ${hl}V${capTop}M70 ${hl + 1}Q71 ${top + 5} 67 ${capTop}M76 ${hl + 2}Q78 ${top + 6} 72 ${capTop + 2}" stroke="${shade(skin, -0.1)}" stroke-width="1" fill="none" opacity=".8"/>`)
      break
  }
  o.push('</g>')
  return o.join('')
}

/** A whole standalone SVG document (for scripts and checks). */
export const drawingSvg = (look: PlayerLook, colors: DrawingColors): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">${drawingMarkup(look, colors)}</svg>`
