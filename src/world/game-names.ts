import { CLUB_NAMES, COMPETITION_NAMES, LOWER_CLUB_NAMES, LOWER_LEAGUE_NAMES, PEOPLE_NAMES } from '../data/game-names'

/**
 * The game's own names for real clubs, arenas, leagues and people (owner decision, 27 November 2026): close to the real
 * ones so fans recognise them, never the brand. Applied where new careers and friendlies are built; the real data keep
 * their names underneath, so saved careers and every rule keyed on ids work unchanged.
 */
export const gameCompetitionName = (id: string, name: string): string => Object.hasOwn(COMPETITION_NAMES, id) ? COMPETITION_NAMES[id]! : name

/** A pack club's game name, short name and arena (the arena only when the club has one). */
export function gameClub<T extends { id: string; name: string; shortName: string; arena: string | null }>(club: T): T {
  if (!Object.hasOwn(CLUB_NAMES, club.id)) return club
  const [name, shortName, arena] = CLUB_NAMES[club.id]!
  return { ...club, name, shortName, arena: club.arena === null ? null : arena ?? club.arena }
}

export const gameLowerLeagueName = (name: string): string => Object.hasOwn(LOWER_LEAGUE_NAMES, name) ? LOWER_LEAGUE_NAMES[name]! : name

/** A next-division club's game name and short name. */
export function gameLowerClub(country: string, club: { name: string; shortName: string }): { name: string; shortName: string } {
  const key = `${country}|${club.name}`
  return Object.hasOwn(LOWER_CLUB_NAMES, key) ? { name: LOWER_CLUB_NAMES[key]![0], shortName: LOWER_CLUB_NAMES[key]![1] } : club
}

/** A real coach's, president's or assistant coach's game name. */
export const gamePersonName = (name: string): string => Object.hasOwn(PEOPLE_NAMES, name) ? PEOPLE_NAMES[name]! : name
