import { describe, expect, it } from 'vitest'
import { CLUB_NAMES, COMPETITION_NAMES, LOWER_CLUB_NAMES, PEOPLE_NAMES } from '../src/data/game-names'
import { badgeMarkup, competitionMarkup } from '../src/ui/club-badge'
import { gameClub, gameCompetitionName, gameLowerClub, gamePersonName } from '../src/world/game-names'
import { europeanKind } from '../src/world/real-world'
import { legacyQualifierName, qualifierCompetition } from '../src/world/national'

/** Game names for real clubs, arenas, leagues and people, and drawn badges (owner decision, 27 November 2026). */
describe('game names', () => {
  it('gives every real club a distinct name and a three-letter short name, never its real name', () => {
    const names = Object.values(CLUB_NAMES).map(([name]) => name)
    expect(names.length).toBeGreaterThanOrEqual(250)
    expect(new Set(names).size).toBe(names.length)
    for (const [name, shortName, arena] of Object.values(CLUB_NAMES)) {
      expect(name.length).toBeLessThanOrEqual(32)
      expect(shortName).toMatch(/^\p{Lu}{3}$/u)
      if (arena !== null) expect(arena.length).toBeLessThanOrEqual(48)
    }
    expect(Object.keys(LOWER_CLUB_NAMES).length).toBeGreaterThanOrEqual(80)
  })

  it('renames a club, keeps a club without an arena arena-less, and leaves unknown clubs alone', () => {
    const [id, [name, shortName, arena]] = Object.entries(CLUB_NAMES).find(([, value]) => value[2] !== null)!
    expect(gameClub({ id, name: 'Real', shortName: 'REA', arena: 'Real Arena' })).toMatchObject({ name, shortName, arena })
    expect(gameClub({ id, name: 'Real', shortName: 'REA', arena: null }).arena).toBeNull()
    expect(gameClub({ id: 'club-test', name: 'Alpha', shortName: 'ALP', arena: null }).name).toBe('Alpha')
    const [key, [lowerName]] = Object.entries(LOWER_CLUB_NAMES)[0]!
    const [country, real] = key.split('|') as [string, string]
    expect(gameLowerClub(country, { name: real, shortName: 'X' }).name).toBe(lowerName)
  })

  it('renames competitions and still recognises the European ones by their game names', () => {
    for (const [id, name] of Object.entries(COMPETITION_NAMES)) expect(gameCompetitionName(id, 'Real name')).toBe(name)
    expect(europeanKind('Euro Elite League')).toBe('euroleague')
    expect(europeanKind('Euro Challenge Cup')).toBe('eurocup')
    expect(europeanKind('Continental Basketball Cup')).toBe('bcl')
    expect(europeanKind('Hellenic Basket League')).toBeNull()
  })

  it('renames every real person, each part of the name', () => {
    const entries = Object.entries(PEOPLE_NAMES)
    expect(entries.length).toBeGreaterThanOrEqual(470)
    expect(new Set(Object.values(PEOPLE_NAMES)).size).toBe(entries.length)
    for (const [real, name] of entries) {
      expect(name).not.toBe(real)
      expect(gamePersonName(real)).toBe(name)
    }
    expect(gamePersonName('Nobody Known')).toBe('Nobody Known')
  })

  it('names national tournaments without trademarks and accepts the older names in saved careers', () => {
    expect(qualifierCompetition(1, []).name).toBe('World Championship 2027 European Qualifiers · Second round')
    expect(legacyQualifierName(1)).toBe('World Cup 2027 European Qualifiers · Second round')
  })

  it('draws a badge in the club colour with its short name, the same every time', () => {
    const badge = badgeMarkup('club-x', 'ABC', '#002f6c')
    expect(badge).toContain('#002f6c')
    expect(badge).toContain('>ABC<')
    expect(badgeMarkup('club-x', 'ABC', '#002f6c')).toBe(badge)
    expect(badgeMarkup('club-y', '<b>', '#ffffff')).not.toContain('<b>')
    expect(competitionMarkup('Euro Elite League')).toContain('>EEL<')
  })
})
