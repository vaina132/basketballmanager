/**
 * A player's drawn look (owner decision, 25 November 2026: drawings replace real photos). Real-pack players have a
 * look read from a photo or a picture found online (`src/data/player-looks.ts`); everyone else gets one worked out
 * from the player's id, skin tone and hair colour, so the same player always looks the same.
 */

/** Skin tones, light to dark. One fixed palette keeps every drawing in the same style. */
export const SKIN_TONES = ['#f3d2bc', '#ebc0a0', '#e0ad88', '#d39b74', '#c08560', '#a8704c', '#8f5b3c', '#774a30', '#5f3a25', '#46291b'] as const
export const HAIR_COLORS = {
  black: '#1c1512', darkbrown: '#3a281e', brown: '#5b3d2a', lightbrown: '#8a6542', blond: '#c9a465', platinum: '#e3d8bf', ginger: '#9c5733', grey: '#8f8c88',
} as const
export const FACES = ['oval', 'round', 'long', 'square'] as const
export const HAIR_STYLES = ['bald', 'shaved', 'buzz', 'short', 'receding', 'side-part', 'messy', 'wavy', 'curly-top', 'afro', 'locs-bun', 'locs', 'long', 'bun', 'cornrows'] as const
export const BEARDS = ['none', 'stubble', 'moustache', 'goatee', 'short', 'full', 'thick'] as const
export const BROWS = ['thin', 'normal', 'thick'] as const
export const NOSES = ['normal', 'wide'] as const

export type HairColor = keyof typeof HAIR_COLORS
export interface PlayerLook {
  /** 1 (lightest) to 10 (darkest), an index into SKIN_TONES plus one. */
  skin: number
  face: (typeof FACES)[number]
  hair: (typeof HAIR_STYLES)[number]
  hairColor: HairColor
  beard: (typeof BEARDS)[number]
  brows: (typeof BROWS)[number]
  nose: (typeof NOSES)[number]
  /** Only when the beard differs from the hair (for example grey or ginger). */
  beardColor?: HairColor
}

const HAIR_COLOR_KEYS = Object.keys(HAIR_COLORS) as HairColor[]

/** Compact text form, used in the data file: "9.round.buzz.black.thick.normal.wide" (+ ".grey" beard colour). */
export function encodeLook(look: PlayerLook): string {
  return [look.skin, look.face, look.hair, look.hairColor, look.beard, look.brows, look.nose, ...(look.beardColor && look.beardColor !== look.hairColor ? [look.beardColor] : [])].join('.')
}

export function decodeLook(text: string): PlayerLook | null {
  const [skin, face, hair, hairColor, beard, brows, nose, beardColor, ...rest] = text.split('.')
  const n = Number(skin)
  if (rest.length || !Number.isInteger(n) || n < 1 || n > SKIN_TONES.length) return null
  if (!FACES.includes(face as never) || !HAIR_STYLES.includes(hair as never) || !HAIR_COLOR_KEYS.includes(hairColor as HairColor)) return null
  if (!BEARDS.includes(beard as never) || !BROWS.includes(brows as never) || !NOSES.includes(nose as never)) return null
  if (beardColor !== undefined && !HAIR_COLOR_KEYS.includes(beardColor as HairColor)) return null
  return { skin: n, face, hair, hairColor, beard, brows, nose, ...(beardColor ? { beardColor } : {}) } as PlayerLook
}

/** Tight form for the data file: 7-8 characters ("8acbgba"). */
const idx = (list: readonly string[], value: string): string => String.fromCharCode(97 + list.indexOf(value))
export function packLook(look: PlayerLook): string {
  return `${look.skin - 1}${idx(FACES, look.face)}${idx(HAIR_STYLES, look.hair)}${idx(HAIR_COLOR_KEYS, look.hairColor)}${idx(BEARDS, look.beard)}${idx(BROWS, look.brows)}${idx(NOSES, look.nose)}${look.beardColor && look.beardColor !== look.hairColor ? idx(HAIR_COLOR_KEYS, look.beardColor) : ''}`
}
export function unpackLook(code: string): PlayerLook | null {
  if (!/^[0-9][a-z]{6,7}$/.test(code)) return null
  const at = <T extends string>(list: readonly T[], i: number): T | undefined => list[code.charCodeAt(i) - 97]
  const look = { skin: Number(code[0]) + 1, face: at(FACES, 1), hair: at(HAIR_STYLES, 2), hairColor: at(HAIR_COLOR_KEYS, 3), beard: at(BEARDS, 4), brows: at(BROWS, 5), nose: at(NOSES, 6) }
  const beardColor = code.length > 7 ? at(HAIR_COLOR_KEYS, 7) : undefined
  if (Object.values(look).some((v) => v === undefined) || (code.length > 7 && !beardColor)) return null
  return { ...look, ...(beardColor ? { beardColor } : {}) } as PlayerLook
}

const hash = (text: string): number => {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}
const rgbOf = (hex: string): [number, number, number] | null => /^#[0-9a-f]{6}$/i.test(hex) ? [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number] : null
const nearest = <T>(hex: string, options: readonly (readonly [T, string])[], fallback: T): T => {
  const c = rgbOf(hex)
  if (!c) return fallback
  let best = fallback, d = Infinity
  for (const [key, value] of options) {
    const o = rgbOf(value)!
    const e = (c[0] - o[0]) ** 2 + (c[1] - o[1]) ** 2 + (c[2] - o[2]) ** 2
    if (e < d) { d = e; best = key }
  }
  return best
}

/** A look for a player without a recorded one (generated and fictional players), stable for the player's id. */
export function generatedLook(player: { id: string; skinTone: string; hairColor: string }): PlayerLook {
  const pick = <T>(salt: string, list: readonly T[]): T => list[hash(`${player.id}:${salt}`) % list.length]!
  const skin = nearest(player.skinTone, SKIN_TONES.map((tone, i) => [i + 1, tone] as const), 1 + (hash(`${player.id}:skin`) % 6))
  const dark = skin >= 6
  let hairColor = nearest<HairColor>(player.hairColor, HAIR_COLOR_KEYS.filter((k) => k !== 'grey' && k !== 'platinum').map((k) => [k, HAIR_COLORS[k]] as const), 'black')
  if (dark && hairColor !== 'black' && hairColor !== 'darkbrown') hairColor = 'black'
  const hair = dark
    ? pick('hair', ['buzz', 'buzz', 'buzz', 'shaved', 'shaved', 'bald', 'short', 'curly-top', 'curly-top', 'afro', 'locs-bun', 'locs', 'cornrows'] as const)
    : pick('hair', ['short', 'short', 'short', 'buzz', 'buzz', 'side-part', 'side-part', 'messy', 'wavy', 'receding', 'shaved', 'bun', 'long'] as const)
  return {
    skin, hairColor, hair,
    face: pick('face', FACES),
    beard: pick('beard', ['none', 'none', 'none', 'stubble', 'stubble', 'short', 'short', 'full', 'goatee', 'moustache'] as const),
    brows: pick('brows', ['thin', 'normal', 'normal', 'normal', 'thick'] as const),
    nose: dark ? pick('nose', ['normal', 'wide', 'wide'] as const) : pick('nose', ['normal', 'normal', 'normal', 'wide'] as const),
  }
}
