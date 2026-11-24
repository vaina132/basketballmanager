import type { SeasonFixture, SeasonState } from '../domain/season'

/**
 * The free part of the game (owner decision, 24 November 2026): the first half of the career's first season.
 *
 * Every career starts in season 1. The halfway point is counted in games, not dates, so it fits every calendar (an
 * 82-game NBA season, a 34-game European league, worlds with several leagues of different lengths):
 * - a manager with a club: half of his club's domestic regular-season games (rounded up) have a result;
 * - a manager without a club: half of all domestic regular-season games in the world (rounded up) have a result.
 * Postseason (play-in, playoffs) and European games are not counted. Once the first season is over (its end, the
 * offseason or any later season) the limit is past.
 */
export interface FreePlayLimit {
  /** Always the career's first season. */
  seasonNumber: 1
  /** Whose games are counted: the manager's club's, or the whole world's while he has no club. */
  basis: 'club' | 'world'
  /** The manager's club, when `basis` is 'club'. */
  clubId?: string
  /** Domestic regular-season games counted. */
  total: number
  /** Games with a result that reach the halfway point: half of `total`, rounded up. */
  needed: number
  /** Games with a result so far. */
  played: number
}

/** The parts of a career the rule reads. */
export type FreeLimitState = Pick<SeasonState, 'seasonNumber' | 'status' | 'managedClubId' | 'fixtures'>

const regular = (fixture: SeasonFixture) => !fixture.stage && !fixture.competition

/** The halfway point of the first season, as games counted, played and needed. Null once the first season is over. */
export function freePlayLimit(state: FreeLimitState): FreePlayLimit | null {
  if (state.seasonNumber > 1 || state.status === 'complete') return null
  const clubId = state.managedClubId
  const counted = state.fixtures.filter(fixture => regular(fixture) && (!clubId || fixture.homeClubId === clubId || fixture.awayClubId === clubId))
  const total = counted.length
  return { seasonNumber: 1, basis: clubId ? 'club' : 'world', ...(clubId ? { clubId } : {}), total, needed: Math.ceil(total / 2), played: counted.filter(fixture => fixture.result).length }
}

/** Whether the career has reached the end of the free part: half of the first season's games played, or later. */
export function isPastFreeLimit(state: FreeLimitState): boolean {
  const limit = freePlayLimit(state)
  if (!limit) return true
  // A calendar without regular-season games (never expected) is never blocked by mistake.
  return limit.total > 0 && limit.played >= limit.needed
}
