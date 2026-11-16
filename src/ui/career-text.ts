import type { CareerMove } from '../domain/career'
import type { SeasonState } from '../domain/season'
import { CAREER_RULES, CAREER_RULES_TEXT, careerPointKey, coachProtected, isUnemployed, NO_CLUB, usesCareerRules } from '../world/career-rules'
import { careerMovesGovern, currentUnemployment } from '../world/career'
import { seasonEndOutlook } from '../world/career-policy'
import { getBoardSummary } from '../world/board'
import { seasonRounds } from '../world/career-world'
import { seasonLabel } from '../world/season'

/**
 * Leagues of countries not chosen at career start (owner feedback, 16 November 2026: "Estimated table" meant nothing).
 * They play no games; a final table is simulated from squad strength only to decide next season's European places.
 */
export const NOT_PLAYED_LEAGUE = {
  tag: 'Not played · table simulated',
  note: 'Countries you did not choose are not played game by game; their final tables are simulated from squad strength to decide who plays in Europe.',
  table: 'its final table is simulated from squad strength to decide who plays in Europe next season.',
} as const

/** Plain wording for a recorded club change, shared by the manager's desk, Club > Board and the Inbox. */
export function careerMoveText(season: Pick<SeasonState, 'clubs'>, move: CareerMove): { title: string; detail: string } {
  const name = (id: string) => season.clubs.find(club => club.id === id)?.name ?? id
  const from = name(move.fromClubId), to = name(move.toClubId)
  // Format 69 (career-3): leaving without a new job, and an unemployed manager's appointment.
  if (move.reason === 'appointed') return { title: `New job · ${to}`, detail: `After a spell without a club you took over ${to} ${move.phase === 'season' ? `during ${seasonLabel(move.seasonNumber)}, from matchday ${move.round}` : `in the offseason after ${seasonLabel(move.seasonNumber)}`}. Its board starts afresh at ${CAREER_RULES.freshConfidence}, and your first season there is protected.` }
  if (move.toClubId === NO_CLUB && move.reason === 'resigned') return { title: `Resigned from ${from} · without a club`, detail: `You resigned from ${from} ${move.phase === 'season' ? `during ${seasonLabel(move.seasonNumber)}, before matchday ${move.round}` : `after ${seasonLabel(move.seasonNumber)}`} without taking another job. The resignation costs ${CAREER_RULES.resignationReputationCost} reputation points for three seasons; ${from} continues under a new coach.` }
  if (move.toClubId === NO_CLUB) return { title: `Dismissed by ${from} · without a club`, detail: move.phase === 'season'
    ? `${from}'s board ended your job during ${seasonLabel(move.seasonNumber)}, after its confidence fell below ${CAREER_RULES.midSeasonDismissalBelow} at a review. You did not take another job, so you are without a club for now; ${from} continues under an interim coach.`
    : `${from}'s board ended your job after ${seasonLabel(move.seasonNumber)} finished Under pressure. You did not take another job, so you are without a club for now; ${from} continues under automatic control.` }
  // Format 63 (career-2): dismissals after an in-season review and resignations.
  if (move.reason === 'dismissed' && move.phase === 'season') return { title: `Dismissed by ${from} · now managing ${to}`, detail: `${from}'s board ended your job during ${seasonLabel(move.seasonNumber)}, after its confidence fell below ${CAREER_RULES.midSeasonDismissalBelow} at a review. ${to} offered you its job and you took over at once, from matchday ${move.round}; ${from} continues under an interim coach.` }
  if (move.reason === 'resigned') return { title: `Resigned from ${from} · now managing ${to}`, detail: `You resigned from ${from} ${move.phase === 'season' ? `during ${seasonLabel(move.seasonNumber)} and took over ${to} at once, from matchday ${move.round}` : `after ${seasonLabel(move.seasonNumber)} and run ${to} from this offseason`}. The resignation costs ${CAREER_RULES.resignationReputationCost} reputation points for three seasons; ${from} continues under a new coach.` }
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
    if (!usesCareerRules(career)) notices.push({ key: 'career-risk', title: 'Job at risk', detail: `Board confidence is ${board.confidence}/100. If the season ends Under pressure (below 30), the board will dismiss you; clubs that need a coach will then offer you a job.`, urgent: true })
    else if (coachProtected(season.board.restarts ?? [], season.managedClubId, season.seasonNumber)) notices.push({ key: 'career-risk', title: 'Protected first season', detail: `Board confidence is ${board.confidence}/100. The board will not dismiss you this season; if it ends Under pressure (below ${CAREER_RULES.seasonDismissalBelow}), you get a final warning and next season counts.`, urgent: false })
    else notices.push({ key: 'career-risk', title: 'Job at risk', detail: `Board confidence is ${board.confidence}/100. A review below ${CAREER_RULES.midSeasonDismissalBelow} after a third of the season, or a season ending below ${CAREER_RULES.seasonDismissalBelow}, ends your job; clubs that need a coach will then offer you one.`, urgent: true })
  }
  const move = recentCareerMove(season)
  if (move) notices.push({ key: 'career', ...careerMoveText(season, move), urgent: move.reason === 'dismissed' })
  const warning = standingFinalWarning(season)
  if (warning) notices.push({ key: 'career-warning', title: 'Final warning from the board', detail: `${seasonLabel(warning.seasonNumber)} ended Under pressure (confidence ${warning.confidence}/100) in your protected first season. ${seasonLabel(warning.seasonNumber + 1)} counts: a review below ${CAREER_RULES.midSeasonDismissalBelow} after a third of the season, or a final confidence below ${CAREER_RULES.seasonDismissalBelow}, ends your job.`, urgent: true })
  return notices
}

/**
 * The notice after a week is recorded (`round`): the club change it brought, a dismissal into a period without a club
 * (career-3), or the plain outcome of the week.
 */
export function roundNotice(before: SeasonState, after: SeasonState): string {
  const name = (id: string) => after.clubs.find(club => club.id === id)?.name ?? id
  const move = after.career.moves.length > before.career.moves.length ? after.career.moves.at(-1) : undefined
  const week = after.round - 1
  if (move && move.toClubId === NO_CLUB) return after.status === 'complete' ? `Season complete. ${name(move.fromClubId)}'s board dismissed you, and you are now without a club. Jobs that open appear on your desk.` : `Week ${week} recorded. ${name(move.fromClubId)}'s board dismissed you, and you are now without a club. Jobs that open appear on your desk.`
  if (move) return after.status === 'complete' ? `Season complete. You now manage ${name(move.toClubId)}, including its offseason.` : `Week ${week} recorded. The board dismissed you; you now manage ${name(move.toClubId)}.`
  if (isUnemployed(after)) return after.status === 'complete' ? 'Season complete. Every club\'s offseason runs automatically; open jobs are on your desk.' : `Week ${week} recorded across every competition.`
  return after.status === 'complete' ? 'Season complete. Final standings and all results are available.' : after.activeMatch ? `Week ${week} recorded. Your next fixture is ready.` : `Week ${week} recorded. Your club has a rest week.`
}
