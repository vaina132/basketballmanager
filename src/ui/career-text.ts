import type { CareerMove } from '../domain/career'
import type { SeasonState } from '../domain/season'
import { CAREER_RULES, careerPointKey, coachProtected, usesCareerRules } from '../world/career-rules'
import { careerMovesGovern } from '../world/career'
import { seasonEndOutlook } from '../world/career-policy'
import { getBoardSummary } from '../world/board'
import { seasonRounds } from '../world/career-world'
import { seasonLabel } from '../world/season'

/** Plain wording for a recorded club change, shared by the manager's desk, Club > Board and the Inbox. */
export function careerMoveText(season: Pick<SeasonState, 'clubs'>, move: CareerMove): { title: string; detail: string } {
  const name = (id: string) => season.clubs.find(club => club.id === id)?.name ?? id
  const from = name(move.fromClubId), to = name(move.toClubId)
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
