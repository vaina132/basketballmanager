import type { SeasonState } from '../domain/season'
import { getDevelopmentSponsor } from '../data/development-sponsors'
import { getBoardSummary } from '../world/board'
import { BOARD_VERDICT_EFFECTS, seasonVerdict, verdictBudgets } from '../world/board-consequences'
import { boardFundingRefusal } from '../world/board-funding-policy'
import { getClubSponsorship } from '../world/commercial'
import { getCareerPlayer } from '../world/player-catalog'
import { getPressQuestion, PRESS_ANSWER_TEXT } from '../world/press-policy'
import { getSquadRelationships } from '../world/relationships'
import { seasonLabel } from '../world/season'
import { clubRetirementsThisSeason } from './PlayerLifecycle'
import { medicalDate } from './SeasonMedicalReport'

export type InboxCategory = 'press' | 'board' | 'club' | 'players'
export type InboxTarget = 'press' | 'board' | 'club' | 'dynamics' | 'squad'
export interface InboxItem {
  id: string
  date: string
  category: InboxCategory
  title: string
  detail: string
  /** A decision is waiting; these items also lead the list. */
  needsAction: boolean
  target: InboxTarget
  playerId?: string
}

const money = (cents: number) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(cents / 100)
const FACILITIES: Record<string, string> = { arena: 'Arena', training: 'Training facilities', youth: 'Youth infrastructure' }
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0

/** Dated messages built only from recorded events at the managed club; nothing is generated for display. */
export function getInboxItems(season: SeasonState): InboxItem[] {
  const clubId = season.managedClubId, items: InboxItem[] = []

  const question = getPressQuestion(season)
  if (question && !question.answered) items.push({ id: question.id, date: question.date, category: 'press', title: question.topic === 'losing-run' ? 'Press conference · three defeats' : 'Press conference · three wins', detail: `${question.question} Answer before the next match, or your assistant keeps it routine.`, needsAction: true, target: 'press' })
  for (const event of season.relationships.events) if (event.type === 'press' && event.clubId === clubId) items.push({ id: event.id, date: event.date, category: 'press', title: 'Press conference answered', detail: `${PRESS_ANSWER_TEXT[event.answer].label}: “${PRESS_ANSWER_TEXT[event.answer].quote}”`, needsAction: false, target: 'dynamics' })

  if (season.board.enabledSince) {
    for (const mandate of season.board.mandates) {
      const objective = mandate.clubs[clubId]
      if (objective && objective.games > 0) items.push({ id: mandate.id, date: mandate.date, category: 'board', title: `Board objectives · ${seasonLabel(mandate.seasonNumber)}`, detail: `Win ${objective.targetWins} of ${objective.games} counted games${objective.startingUnpaid !== null ? ` and keep unpaid costs at or below ${money(objective.startingUnpaid)}` : ''}.`, needsAction: false, target: 'board' })
    }
    const summary = getBoardSummary(season)
    if (summary.latest) items.push({ id: summary.latest.id, date: summary.latest.date, category: 'board', title: `Board review · ${summary.confidenceLabel}`, detail: `Confidence ${summary.latest.club.confidence}/100 after matchday ${summary.latest.round}.`, needsAction: false, target: 'board' })
    const since = season.board.consequencesSince
    if (since) for (let year = since.seasonNumber; year <= season.seasonNumber; year += 1) {
      const verdict = seasonVerdict(season.board, clubId, year)
      if (!verdict) continue
      const budgets = verdictBudgets(clubId, verdict.verdict)
      items.push({ id: `verdict-${year}`, date: verdict.date, category: 'board', title: `Season verdict · ${BOARD_VERDICT_EFFECTS[verdict.verdict].label}`, detail: `${seasonLabel(year + 1)}: ${money(budgets.staff)} staff budget and ${money(budgets.capital)} owner capital.`, needsAction: false, target: 'board' })
    }
  }
  for (const [index, event] of season.facilities.events.entries()) {
    if (event.type !== 'funding' || event.clubId !== clubId) continue
    items.push({ id: `funding-${index}`, date: event.date, category: 'club', title: event.approved ? 'Board capital approved' : 'Board capital refused', detail: `${FACILITIES[event.facilityType]} · ${money(event.amount)}${event.approved ? '' : `. ${boardFundingRefusal(event)}`}`, needsAction: false, target: 'board' })
  }

  if (season.commercial.enabledSince) {
    const sponsorship = getClubSponsorship(season)
    if (sponsorship.open.length) items.push({ id: `sponsor-offers-${sponsorship.open[0]!.id}`, date: sponsorship.open[0]!.madeAt.date, category: 'club', title: 'Sponsor offers waiting', detail: `${sponsorship.open.length} ${sponsorship.open.length === 1 ? 'offer' : 'offers'} for ${seasonLabel(sponsorship.open[0]!.forSeason)}, open until ${medicalDate(sponsorship.open[0]!.expiresOn)}.`, needsAction: true, target: 'club' })
    for (const agreement of season.commercial.agreements) if (agreement.clubId === clubId && agreement.source === 'offer') items.push({ id: agreement.id, date: agreement.signedOn, category: 'club', title: `${getDevelopmentSponsor(agreement.sponsorId).name} signed`, detail: `Main sponsor from ${seasonLabel(agreement.startsSeason)}: ${money(agreement.annualFee)} a season${agreement.automatic ? ', chosen by automatic control' : ''}.`, needsAction: false, target: 'club' })
  }

  if (season.relationships.enabledSince) for (const row of getSquadRelationships(season)) {
    if (row.concern) items.push({ id: `concern-${row.player.id}`, date: season.date, category: 'players', title: `${row.player.name}: playing-time concern`, detail: `${row.concern}. Averaging ${row.averageMinutes} minutes against an agreed minimum of ${row.minMinutes}.`, needsAction: row.canTalk, target: 'dynamics', playerId: row.player.id })
    for (const promise of row.promises) if (promise.outcomeDate && (promise.status === 'kept' || promise.status === 'broken')) items.push({ id: `${promise.id}-outcome`, date: promise.outcomeDate, category: 'players', title: `Promise ${promise.status} · ${row.player.name}`, detail: `${promise.averageMinutes} minutes per eligible game against ${promise.targetMinutes} promised.`, needsAction: false, target: 'dynamics', playerId: row.player.id })
  }
  for (const notice of clubRetirementsThisSeason(season)) items.push({ id: `retirement-${notice.playerId}`, date: notice.retiredOn, category: 'players', title: `${getCareerPlayer(season, notice.playerId).name} retires`, detail: 'The retirement takes effect for this season.', needsAction: false, target: 'squad', playerId: notice.playerId })

  return items.sort((a, b) => Number(b.needsAction) - Number(a.needsAction) || compare(b.date, a.date) || compare(a.id, b.id))
}
