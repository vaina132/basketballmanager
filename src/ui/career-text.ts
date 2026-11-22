import type { CareerMove } from '../domain/career'
import type { SeasonFixture, SeasonState } from '../domain/season'
import { CAREER_RULES, CAREER_RULES_TEXT, careerPointKey, coachProtected, isUnemployed, NO_CLUB, usesCareerRules } from '../world/career-rules'
import { careerMovesGovern, currentUnemployment } from '../world/career'
import { seasonEndOutlook } from '../world/career-policy'
import { getBoardSummary } from '../world/board'
import { regularWorldRounds, seasonRounds, worldOf } from '../world/career-world'
import { currentGameDay, seasonLabel } from '../world/season'
import { isMarketActive } from '../world/market-policy'
import { continueAction } from '../world/continue-step'
import { nationalStepDay } from '../world/national'

/**
 * Leagues of countries not chosen at career start (owner feedback, 16 November 2026: "Estimated table" meant nothing).
 * They play no games; a final table is simulated from squad strength only to decide next season's European places.
 */
export const NOT_PLAYED_LEAGUE = {
  tag: 'Not played · table simulated',
  note: 'Countries you did not choose are not played game by game; their final tables are simulated from squad strength to decide who plays in Europe.',
  table: 'its final table is simulated from squad strength to decide who plays in Europe next season.',
} as const

/** Plain wording for a recorded club change, shared by the manager's desk, the Board page and the Inbox. */
export function careerMoveText(season: Pick<SeasonState, 'clubs'>, move: CareerMove): { title: string; detail: string } {
  const name = (id: string) => season.clubs.find(club => club.id === id)?.name ?? id
  const from = name(move.fromClubId), to = name(move.toClubId)
  // Format 69 (career-3): leaving without a new job, and an unemployed manager's appointment.
  if (move.reason === 'appointed') return { title: `New job · ${to}`, detail: `After a spell without a club you took over ${to} ${move.phase === 'season' ? `during ${seasonLabel(move.seasonNumber)}, from matchday ${move.round}` : `in the offseason after ${seasonLabel(move.seasonNumber)}`}. Its board starts afresh at ${CAREER_RULES.freshConfidence}, and your first season there is protected.` }
  if (move.toClubId === NO_CLUB && move.reason === 'resigned') return { title: `Resigned from ${from} · without a club`, detail: `You resigned from ${from} ${move.phase === 'season' ? `during ${seasonLabel(move.seasonNumber)}, before matchday ${move.round}` : `after ${seasonLabel(move.seasonNumber)}`} without taking another job. The resignation costs ${CAREER_RULES.resignationReputationCost} reputation points for three seasons; ${from} continues under a new head coach.` }
  if (move.toClubId === NO_CLUB) return { title: `Dismissed by ${from} · without a club`, detail: move.phase === 'season'
    ? `${from}'s board ended your job during ${seasonLabel(move.seasonNumber)}, after its confidence fell below ${CAREER_RULES.midSeasonDismissalBelow} at a review. You did not take another job, so you are without a club for now; ${from} continues under an interim coach.`
    : `${from}'s board ended your job after ${seasonLabel(move.seasonNumber)} finished Under pressure. You did not take another job, so you are without a club for now; ${from} continues under automatic control.` }
  // Format 63 (career-2): dismissals after an in-season review and resignations.
  if (move.reason === 'dismissed' && move.phase === 'season') return { title: `Dismissed by ${from} · now managing ${to}`, detail: `${from}'s board ended your job during ${seasonLabel(move.seasonNumber)}, after its confidence fell below ${CAREER_RULES.midSeasonDismissalBelow} at a review. ${to} offered you its job and you took over at once, from matchday ${move.round}; ${from} continues under an interim coach.` }
  if (move.reason === 'resigned') return { title: `Resigned from ${from} · now managing ${to}`, detail: `You resigned from ${from} ${move.phase === 'season' ? `during ${seasonLabel(move.seasonNumber)} and took over ${to} at once, from matchday ${move.round}` : `after ${seasonLabel(move.seasonNumber)} and run ${to} from this offseason`}. The resignation costs ${CAREER_RULES.resignationReputationCost} reputation points for three seasons; ${from} continues under a new head coach.` }
  return move.reason === 'dismissed'
    ? { title: `Dismissed by ${from} · now managing ${to}`, detail: `${from}'s board ended your job after ${seasonLabel(move.seasonNumber)} finished Under pressure. ${to} offered you its job, and you run it from this offseason; ${from} continues under automatic control.` }
    : { title: `New job · ${to}`, detail: `You left ${from} for ${to} at the end of ${seasonLabel(move.seasonNumber)} and run ${to} from this offseason; ${from} continues under automatic control.` }
}

/** The short outcome of a move for tables: "Dismissed · joined X", "Resigned · joined X" or "Moved to X". */
export function careerMoveOutcome(season: Pick<SeasonState, 'clubs'>, move: CareerMove): string {
  const to = season.clubs.find(club => club.id === move.toClubId)?.name ?? move.toClubId
  const when = move.phase === 'season' ? ` (matchday ${move.round})` : ''
  // Format 69 (career-3): periods without a club.
  if (move.reason === 'appointed') return `Appointed${when || ' (offseason)'} · ${to}`
  if (move.toClubId === NO_CLUB) return `${move.reason === 'dismissed' ? 'Dismissed' : 'Resigned'}${when} · no new club`
  return move.reason === 'dismissed' ? `Dismissed${when} · joined ${to}` : move.reason === 'resigned' ? `Resigned${when} · joined ${to}` : `Moved to ${to}`
}

export interface CareerNotice { key: string; title: string; detail: string; urgent: boolean }

/** The latest move to announce: this season's end or offseason move (career-1: its only move), or one made before this week's games. */
export function recentCareerMove(season: SeasonState): CareerMove | undefined {
  const moves = season.career?.moves ?? []
  if (!usesCareerRules(season.career)) return season.status === 'complete' ? moves.find(item => item.seasonNumber === season.seasonNumber) : undefined
  const last = moves.at(-1)
  if (!last || last.seasonNumber !== season.seasonNumber) return undefined
  return season.status === 'complete' ? last.phase !== 'season' ? last : undefined : last.phase === 'season' && last.round === season.round ? last : undefined
}

/**
 * Career-2: a final warning stands after a protected first season ended Under pressure and the manager stayed; it
 * lasts through that offseason and the next season. Null otherwise.
 */
export function standingFinalWarning(season: SeasonState): { seasonNumber: number; confidence: number } | null {
  if (!usesCareerRules(season.career)) return null
  const lastEnded = season.status === 'complete' ? season.seasonNumber : season.seasonNumber - 1
  if (lastEnded < 1) return null
  const outlook = seasonEndOutlook(season, lastEnded)
  if (!outlook?.warning || outlook.clubId !== season.managedClubId) return null
  const since = careerPointKey(lastEnded, seasonRounds(season), 'end')
  if (season.career.moves.some(move => careerPointKey(move.seasonNumber, move.round ?? 0, move.phase ?? 'end') >= since)) return null
  return { seasonNumber: lastEnded, confidence: outlook.verdict.confidence }
}

/** The manager's job notices for the desk: a recent club change, a final warning and the current risk. */
export function careerNotices(season: SeasonState): CareerNotice[] {
  const notices: CareerNotice[] = []
  const career = season.career
  if (!career?.enabledSince) return notices
  // Format 69 (career-3): without a club there is no board to report on; the unemployed desk shows the job market.
  const unemployment = currentUnemployment(season)
  if (isUnemployed(season)) return unemployment ? [{ key: 'career', ...careerMoveText(season, unemployment), urgent: false }, { key: 'career-unemployed', title: 'Without a club', detail: CAREER_RULES_TEXT.unemployed, urgent: false }] : notices
  const board = season.status === 'active' && careerMovesGovern(career, season.seasonNumber) && season.board.enabledSince ? getBoardSummary(season) : null
  if (board?.latest && board.confidence < CAREER_RULES.seasonDismissalBelow) {
    if (!usesCareerRules(career)) notices.push({ key: 'career-risk', title: 'Job at risk', detail: `Board confidence is ${board.confidence}/100. If the season ends Under pressure (below 30), the board will dismiss you; clubs that need a head coach will then offer you a job.`, urgent: true })
    else if (coachProtected(season.board.restarts ?? [], season.managedClubId, season.seasonNumber)) notices.push({ key: 'career-risk', title: 'Protected first season', detail: `Board confidence is ${board.confidence}/100. The board will not dismiss you this season; if it ends Under pressure (below ${CAREER_RULES.seasonDismissalBelow}), you get a final warning and next season counts.`, urgent: false })
    else notices.push({ key: 'career-risk', title: 'Job at risk', detail: `Board confidence is ${board.confidence}/100. A review below ${CAREER_RULES.midSeasonDismissalBelow} after a third of the season, or a season ending below ${CAREER_RULES.seasonDismissalBelow}, ends your job; clubs that need a head coach will then offer you one.`, urgent: true })
  }
  const move = recentCareerMove(season)
  if (move) notices.push({ key: 'career', ...careerMoveText(season, move), urgent: move.reason === 'dismissed' })
  const warning = standingFinalWarning(season)
  if (warning) notices.push({ key: 'career-warning', title: 'Final warning from the board', detail: `${seasonLabel(warning.seasonNumber)} ended Under pressure (confidence ${warning.confidence}/100) in your protected first season. ${seasonLabel(warning.seasonNumber + 1)} counts: a review below ${CAREER_RULES.midSeasonDismissalBelow} after a third of the season, or a final confidence below ${CAREER_RULES.seasonDismissalBelow}, ends your job.`, urgent: true })
  return notices
}

const dayFormatter = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
/**
 * A game day as the player reads it everywhere: "Tue 8 Sept", or "Tue 8 Sept 2026" with the year. Built from the parts so
 * that every browser writes it alike (Chromium adds a comma after the weekday when the year is shown).
 */
export function gameDate(date: string, withYear = false): string {
  const parts = Object.fromEntries(dayFormatter.formatToParts(new Date(`${date}T00:00:00Z`)).map(part => [part.type, part.value]))
  return `${parts.weekday} ${parts.day} ${parts.month}${withYear ? ` ${parts.year}` : ''}`
}

/** The day the career stands on: the week's next game day during a season (a midweek day included), else its date. */
export function careerToday(season: Pick<SeasonState, 'status' | 'fixtures' | 'round' | 'date'>): string {
  return season.status === 'active' ? currentGameDay(season) ?? season.date : season.date
}

/**
 * The day the top bar's Continue shows: the national game's day while the manager's national game is open or is the next
 * step (format 80: window games fall between the week's Saturdays, summer tournament days after the offseason date),
 * otherwise `careerToday`.
 */
export function continueDay(season: SeasonState): string {
  const national = season.national?.activeMatch || season.national?.job && continueAction(season).kind === 'national' ? nationalStepDay(season) : null
  return national ?? careerToday(season)
}

/** The point of the career a save holds, as the top bar names it: "Matchday 14", "Matchday 1, Tue 8 Sept", "Offseason, Sat 3 July". */
export function careerPointLabel(season: SeasonState): string {
  if (season.status === 'complete') return isMarketActive(season) ? `Offseason, ${gameDate(season.date)}` : `Season ${season.seasonNumber} end`
  const today = careerToday(season)
  return today === season.date ? `Matchday ${season.round}` : `Matchday ${season.round}, ${gameDate(today)}`
}

/**
 * The world's name for the season being played: a name ending in the opening season ("European domestic leagues
 * 2026-27") reads the current one ("... 2027-28") from the second season on.
 */
export function worldSeasonName(season: SeasonState): string {
  const current = seasonLabel(season.seasonNumber)
  return worldOf(season).name.replace(/\d{4}([-/])\d{2}$/u, (_, separator: string) => `${current.slice(0, 4)}${separator}${current.slice(5)}`)
}

/** One label for a career day without the manager's match, shared by the top bar, the page heading and the desk panel. */
export type CareerDayLabel = 'Offseason recruitment' | 'Season complete' | 'No game today' | 'Rest week'

/** What today means for the manager's club when it has no match prepared, or in the offseason. */
export interface CareerDay {
  label: CareerDayLabel
  /** The day shown: the week's next game day (or the week's Saturday when it has none). */
  day: string
  /** Games still to play on `day`. */
  gamesToday: number
  /** What those games are: European (midweek) games, playoff games, or other games. */
  kind: 'European' | 'playoff' | 'other'
  /** The club's game already played this week, if any. */
  playedThisWeek: SeasonFixture | undefined
  /** The club's next game, this week or later. */
  next: SeasonFixture | undefined
}

const kindOf = (games: readonly SeasonFixture[]): CareerDay['kind'] => games.length && games.every(fixture => fixture.competition) ? 'European' : games.length && games.every(fixture => fixture.stage) ? 'playoff' : 'other'

/** What today means for the manager's club when it has no match prepared (no active match), or in the offseason. */
export function careerDay(season: SeasonState): CareerDay {
  const clubId = season.managedClubId, day = careerToday(season)
  const today = season.status === 'active' ? season.fixtures.filter(fixture => fixture.round === season.round && fixture.date === day && !fixture.result) : []
  const own = season.fixtures.filter(fixture => fixture.homeClubId === clubId || fixture.awayClubId === clubId)
  const playedThisWeek = own.filter(fixture => fixture.round === season.round && fixture.result).at(-1)
  const next = season.status === 'active' ? own.find(fixture => fixture.round >= season.round && !fixture.result) : undefined
  // A day without the club's game in a week it plays (a midweek day, or a day before its own later game) or a playoff
  // week is not a rest week: other clubs play today.
  const playsThisWeek = !!playedThisWeek || next?.round === season.round
  const label: CareerDayLabel = season.status === 'complete' ? isMarketActive(season) ? 'Offseason recruitment' : 'Season complete'
    : playsThisWeek || season.round > regularWorldRounds(worldOf(season)) ? 'No game today' : 'Rest week'
  return { label, day, gamesToday: today.length, kind: kindOf(today), playedThisWeek, next }
}

/** "Sat 12 Sept vs MoraBanc Andorra (away)" for one of the club's games; a European game names its competition. */
export function nextGameText(season: SeasonState, fixture: SeasonFixture): string {
  const clubId = season.managedClubId, opponentId = fixture.homeClubId === clubId ? fixture.awayClubId : fixture.homeClubId
  // A European opponent may be a club outside the full world (step 3.5b): its identity is in the world.
  const opponent = season.clubs.find(club => club.id === opponentId) ?? worldOf(season).clubs.find(club => club.id === opponentId)
  const competition = fixture.competition ? worldOf(season).europeanCompetitions?.find(item => item.id === fixture.competition)?.name : undefined
  return `${gameDate(fixture.date)} vs ${opponent?.name ?? opponentId} (${fixture.homeClubId === clubId ? 'home' : 'away'}${competition ? `, ${competition}` : ''})`
}

/** "12 European games", "1 game". */
export const gamesText = (count: number, kind: CareerDay['kind']) => `${count} ${kind === 'European' ? 'European ' : kind === 'playoff' ? 'playoff ' : ''}${count === 1 ? 'game' : 'games'}`

/**
 * What a committed week changed for the manager: a club change or a dismissal into a period without a club (career-3),
 * or the season's end. Shared by the notice after one game day and the notice when a Continue run stops.
 */
export function seasonChangeText(before: SeasonState, after: SeasonState): string {
  const name = (id: string) => after.clubs.find(club => club.id === id)?.name ?? id
  const move = after.career.moves.length > before.career.moves.length ? after.career.moves.at(-1) : undefined
  if (move && move.toClubId === NO_CLUB) return `${name(move.fromClubId)}'s board dismissed you, and you are now without a club. Jobs that open appear on your desk.`
  if (move) return after.status === 'complete' ? `You now manage ${name(move.toClubId)}, including its offseason.` : `The board dismissed you; you now manage ${name(move.toClubId)}.`
  return isUnemployed(after) ? 'Every club\'s offseason runs automatically; open jobs are on your desk.' : 'Final standings and all results are available.'
}

/**
 * The notice after one game day: what was just recorded (the club's game day, another game day of the week, or the whole
 * week) and what comes next. A week with midweek game days takes one Continue per game day, so "Matchday N recorded"
 * appears only once the week is complete. Also the club change a week brought, or a dismissal into a period without a
 * club (career-3).
 */
export function roundNotice(before: SeasonState, after: SeasonState): string {
  const move = after.career.moves.length > before.career.moves.length ? after.career.moves.at(-1) : undefined
  const week = before.round
  if (move || after.status === 'complete') return `${after.status === 'complete' ? 'Season complete.' : `Matchday ${week} recorded.`} ${seasonChangeText(before, after)}`
  if (isUnemployed(after)) return `Matchday ${week} recorded across every competition.`
  // What was recorded: the whole week, or one game day of a week that has more game days to come.
  const played = currentGameDay(before) ?? before.date
  const playedGames = before.fixtures.filter(fixture => fixture.round === before.round && fixture.date === played && !fixture.result)
  const playedKind = kindOf(playedGames)
  const recorded = after.round !== before.round ? `Matchday ${week} recorded.`
    : before.activeMatch ? `${gameDate(played)} recorded: your game${playedGames.length > 1 ? ` and ${playedGames.length - 1} other ${playedGames.length === 2 ? 'game' : 'games'}` : ''}.`
      : `${playedKind === 'European' ? 'Midweek European games' : playedKind === 'playoff' ? 'Playoff games' : 'Games'} played (${gameDate(played)}).`
  // What comes next: the club's prepared game, or the other clubs' next game day and the club's next game.
  if (after.activeMatch) {
    const fixture = after.fixtures.find(item => item.id === after.activeFixtureId)
    return `${recorded} Your next game is ready${fixture ? `: ${nextGameText(after, fixture)}` : ''}.`
  }
  const day = careerDay(after)
  const others = day.gamesToday ? ` Next: ${gamesText(day.gamesToday, day.kind)} on ${gameDate(day.day)}, without your club.` : ''
  return `${recorded}${others}${day.next ? ` Your next game: ${nextGameText(after, day.next)}.` : ''}`
}
