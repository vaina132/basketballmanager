import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PLAYER_LOOK_CODES } from '../src/data/player-looks'
import { Avatar } from '../src/ui/Avatar'
import { CreditsDialog } from '../src/ui/CreditsDialog'
import { lookOf } from '../src/ui/look-of'
import { drawingMarkup } from '../src/ui/player-drawing'
import { BEARDS, decodeLook, encodeLook, generatedLook, HAIR_STYLES, packLook, unpackLook } from '../src/ui/player-look'
import type { PlayerLook } from '../src/ui/player-look'

/** Drawn portraits replace real photos (owner decision, 25 November 2026). */
const player = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: 'Sam Harbour', number: 7, position: 'PG', heightCm: 190, weightKg: 85, skinTone: '#a06a4b', hairColor: '#222222', attributes: {}, ...extra }) as never

describe('player drawings', () => {
  it('stores a valid look for every recorded player', () => {
    const codes = Object.entries(PLAYER_LOOK_CODES)
    expect(codes.length).toBeGreaterThanOrEqual(3500)
    for (const [id, code] of codes) {
      expect(id, id).toMatch(/^[0-9a-z-]+$/)
      const look = unpackLook(code)
      expect(look, `${id} ${code}`).not.toBeNull()
      expect(packLook(look!)).toBe(code)
    }
  })

  it('round-trips both text forms and refuses unknown values', () => {
    const look: PlayerLook = { skin: 9, face: 'round', hair: 'locs-bun', hairColor: 'black', beard: 'goatee', brows: 'thick', nose: 'wide', beardColor: 'grey' }
    expect(decodeLook(encodeLook(look))).toEqual(look)
    expect(unpackLook(packLook(look))).toEqual(look)
    expect(decodeLook('11.round.buzz.black.none.thin.wide')).toBeNull()
    expect(decodeLook('3.round.mullet.black.none.thin.wide')).toBeNull()
    expect(unpackLook('3zzzzzz')).toBeNull()
  })

  it('draws every hairstyle and beard without breaking the markup', () => {
    for (const hair of HAIR_STYLES) for (const beard of BEARDS) {
      const markup = drawingMarkup({ skin: 5, face: 'oval', hair, hairColor: 'brown', beard, brows: 'normal', nose: 'normal' }, { primary: '#002f6c', secondary: '#ffffff' })
      expect(markup.startsWith('<rect'), `${hair} ${beard}`).toBe(true)
      expect(markup, `${hair} ${beard}`).not.toMatch(/NaN|undefined/)
    }
  })

  it('uses the recorded look for a real player and a stable worked-out look for anyone else', () => {
    const [id, code] = Object.entries(PLAYER_LOOK_CODES)[0]!
    expect(lookOf(player(`player-${id}`))).toEqual(unpackLook(code))
    const generated = player('generated-prospect-12', { skinTone: '#774d35', hairColor: '#191919' })
    expect(lookOf(generated)).toEqual(generatedLook(generated))
    expect(generatedLook(generated)).toEqual(generatedLook(generated))
    expect(generatedLook(generated).skin).toBeGreaterThanOrEqual(7)
  })

  it('shows a drawing, never a photo, and no photo credits remain', () => {
    const html = renderToStaticMarkup(<Avatar player={player('player-unknown')} color="#123456" size={34} />)
    expect(html).toContain('<svg')
    expect(html).toContain('width="34"')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('/photos/')
    const credits = renderToStaticMarkup(<CreditsDialog onClose={() => {}} />)
    expect(credits).not.toMatch(/Wikimedia|Player photos/)
    expect(credits).toContain('data-credits="flags"')
    expect(credits).not.toContain('data-credits="logos"')
  })
})
