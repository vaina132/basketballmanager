import type { ArchivedFixture, SeasonFixture, SeasonState } from '../domain/season'
import { emptySeniorTotals, SENIOR_TOTAL_KEYS } from '../world/senior-history'
import { getSeasonRosterData } from '../world/rosters'
import type { SeasonPlayerPerformance } from '../world/performance'

/**
 * Regular season and playoff player statistics shown apart on Competitions (owner suggestion, HANDOVER), and League
 * statistics without European games (owner, 22 November 2026: those belong to International's statistics). Presentation
 * only: the rows are rebuilt from each player's retained per-game records (`SeasonPlayerPerformance.log`); nothing is
 * saved and no rule changes.
 */
export type StatPhase = 'regular' | 'playoffs'

export const STAT_PHASES: readonly { id: StatPhase; label: string }[] = [
  { id: 'regular', label: 'Regular season' },
  { id: 'playoffs', label: 'Playoffs' },
]

/** Which games a statistics table covers: a domestic league's games, or one European competition's. */
export interface StatScope {
  /** A European competition's id; without it, domestic games only. */
  competitionId?: string
}

type AnyFixture = SeasonFixture | ArchivedFixture

/** A game of the scope: the European competition's own games, or domestic games (which name no competition). */
export function inStatScope(fixture: Pick<AnyFixture, 'competition'>, scope: StatScope): boolean {
  return scope.competitionId ? fixture.competition === scope.competitionId : !fixture.competition
}

/**
 * Regular season: games without a stage (a league's rounds, a European competition's regular season or groups).
 * Playoffs: every postseason or knockout game (play-in, playoffs, play-outs, final stages). European qualifying rounds
 * belong to neither.
 */
export function inStatPhase(fixture: Pick<AnyFixture, 'stage'>, phase: StatPhase | null): boolean {
  if (phase === null) return true
  return phase === 'regular' ? !fixture.stage : !!fixture.stage && fixture.stage !== 'qualifying'
}

/**
 * Whether the season's records allow the split: a season kept partly as season totals (older archived seasons) has no
 * per-game record to divide, so its figures stay combined.
 */
export function canSplitPhases(season: SeasonState, seasonNumber: number, clubIds?: readonly string[]): boolean {
  const data = getSeasonRosterData(season, seasonNumber)
  if (data.summary?.players.some(row => row.games > 0 && (!clubIds || clubIds.includes(row.clubId)))) return false
  return !data.fixtures.some(fixture => fixture.result && fixture.result.stats === null && (!clubIds || clubIds.includes(fixture.homeClubId) || clubIds.includes(fixture.awayClubId)))
}

/** Whether the season shown has any game of the phase in the scope, played or scheduled. */
export function hasPhaseGames(season: SeasonState, seasonNumber: number, scope: StatScope, phase: StatPhase, clubIds?: readonly string[]): boolean {
  return getSeasonRosterData(season, seasonNumber).fixtures.some(fixture => inStatScope(fixture, scope) && inStatPhase(fixture, phase) && (!clubIds || clubIds.includes(fixture.homeClubId) || clubIds.includes(fixture.awayClubId)))
}

/** Whether the season shown has any European game of the clubs (played or scheduled). */
export function hasEuropeanGames(season: SeasonState, seasonNumber: number, clubIds?: readonly string[]): boolean {
  return getSeasonRosterData(season, seasonNumber).fixtures.some(fixture => !!fixture.competition && (!clubIds || clubIds.includes(fixture.homeClubId) || clubIds.includes(fixture.awayClubId)))
}

/**
 * The rows rebuilt from the games of one scope and phase (`null`: every game of the scope): appearances, totals and the game log count only those games,
 * and a club's games (for the qualification rule) are its finished games of that phase. Players without such a game
 * are left out.
 */
export function phaseRows(season: SeasonState, seasonNumber: number, rows: readonly SeasonPlayerPerformance[], scope: StatScope, phase: StatPhase | null): SeasonPlayerPerformance[] {
  const fixtures = getSeasonRosterData(season, seasonNumber).fixtures.filter(fixture => fixture.result && inStatScope(fixture, scope) && inStatPhase(fixture, phase))
  const ids = new Set(fixtures.map(fixture => fixture.id))
  const clubGames = new Map<string, number>()
  for (const fixture of fixtures) for (const clubId of [fixture.homeClubId, fixture.awayClubId]) clubGames.set(clubId, (clubGames.get(clubId) ?? 0) + 1)
  return rows.flatMap(row => {
    const log = row.log.filter(game => ids.has(game.fixtureId))
    if (!log.length) return []
    const totals = emptySeniorTotals()
    for (const game of log) for (const key of SENIOR_TOTAL_KEYS) totals[key] += game.stats[key]
    const { summaryGames: _summary, ...rest } = row
    return [{ ...rest, clubGames: clubGames.get(row.club.id) ?? 0, games: log.filter(game => game.participation === 'played').length, totals, log }]
  })
}
