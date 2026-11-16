import type { SeasonState } from '../domain/season'
import { getDevelopmentSponsor } from '../data/development-sponsors'
import { getBoardSummary } from '../world/board'
import { BOARD_VERDICT_EFFECTS, seasonVerdict, verdictBudgets } from '../world/board-consequences'
import { boardFundingRefusal } from '../world/board-funding-policy'
import { getClubNamingRights, getClubSponsorship } from '../world/commercial'
import { exitExplanation } from './sponsor-exit-text'
import { getCareerPlayer } from '../world/player-catalog'
import { getPressQuestion, PRESS_ANSWER_TEXT, pressAnswerLabel, pressQuote } from '../world/press-policy'
import { PRESS_TOPIC_TITLES } from '../world/media'
import { awaitsContractReply, getClubContractRequests, getSquadRelationships } from '../world/relationships'
import { CONTRACT_REQUEST_TEXT as TEXT } from '../world/relationship-rules'
import { seasonLabel } from '../world/season'
import { governingDerby } from '../world/rivalries'
import { rivalClubName, rivalryInboxItems } from './rivalry-text'
import { facilityTypes, FACILITY_RULES_2, getFacilityCondition, hasFacilityCondition, maintenancePlanOn, usesFacilityRepairs } from '../world/facilities-policy'
import { clubRetirementsThisSeason } from './PlayerLifecycle'
import { careerMoveText } from './career-text'
import { careerMovesGovern, managedClubFor } from '../world/career'
import { seasonEndOutlook } from '../world/career-policy'
import { medicalDate } from './SeasonMedicalReport'
import { seasonRounds, worldOf } from '../world/career-world'
import { formatEuros } from './money-format'

export type InboxCategory = 'press' | 'board' | 'club' | 'players'
export type InboxTarget = 'press' | 'board' | 'club' | 'dynamics' | 'squad' | 'contract'
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

const money = (cents: number) => formatEuros(cents)
const FACILITIES: Record<string, string> = { arena: 'Arena', training: 'Training facilities', youth: 'Youth infrastructure', medical: 'Medical centre', scouting: 'Scouting office' }
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0

/** Dated messages built only from recorded events at the managed club; nothing is generated for display. */
export function getInboxItems(season: SeasonState): InboxItem[] {
  const clubId = season.managedClubId, items: InboxItem[] = []

  const question = getPressQuestion(season)
  // Format 67 (careers with media) names the topic; older careers keep the two run topics.
  if (question && !question.answered) items.push({ id: question.id, date: question.date, category: 'press', title: question.subjectIds ? `Press conference · ${PRESS_TOPIC_TITLES[question.topic]}` : question.topic === 'losing-run' ? 'Press conference · three defeats' : 'Press conference · three wins', detail: `${question.question} Answer before the next match, or your assistant ${question.subjectIds ? 'gives no comment' : 'keeps it routine'}.`, needsAction: true, target: 'press' })
  for (const event of season.relationships.events) if (event.type === 'press' && event.clubId === clubId) items.push({ id: event.id, date: event.date, category: 'press', title: 'Press conference answered', detail: event.subjectIds ? `${pressAnswerLabel(event)}: “${pressQuote(event.topic, event.answer)}”` : `${PRESS_ANSWER_TEXT[event.answer].label}: “${PRESS_ANSWER_TEXT[event.answer].quote}”`, needsAction: false, target: 'dynamics' })

  if (season.board.enabledSince) {
    for (const mandate of season.board.mandates) {
      // Objectives belong to the club managed in that season.
      const objective = mandate.clubs[managedClubFor(season, mandate.seasonNumber, false)]
      if (objective && objective.games > 0) items.push({ id: mandate.id, date: mandate.date, category: 'board', title: `Board objectives · ${seasonLabel(mandate.seasonNumber)}`, detail: `Win ${objective.targetWins} of ${objective.games} counted games${objective.startingUnpaid !== null ? ` and keep unpaid costs at or below ${money(objective.startingUnpaid)}` : ''}.`, needsAction: false, target: 'board' })
    }
    const summary = getBoardSummary(season)
    if (summary.latest) items.push({ id: summary.latest.id, date: summary.latest.date, category: 'board', title: `Board review · ${summary.confidenceLabel}`, detail: `Confidence ${summary.latest.club.confidence}/100 after matchday ${summary.latest.round}.`, needsAction: false, target: 'board' })
    const since = season.board.consequencesSince
    if (since) for (let year = since.seasonNumber; year <= season.seasonNumber; year += 1) {
      const judged = managedClubFor(season, year, false), verdict = seasonVerdict(season.board, judged, year, seasonRounds(season))
      if (!verdict) continue
      if (judged !== clubId) { items.push({ id: `verdict-${year}`, date: verdict.date, category: 'board', title: `Season verdict · ${BOARD_VERDICT_EFFECTS[verdict.verdict].label}`, detail: `${season.clubs.find(club => club.id === judged)!.name}'s board after ${seasonLabel(year)}.`, needsAction: false, target: 'board' }); continue }
      const budgets = verdictBudgets(clubId, verdict.verdict, worldOf(season))
      items.push({ id: `verdict-${year}`, date: verdict.date, category: 'board', title: `Season verdict · ${BOARD_VERDICT_EFFECTS[verdict.verdict].label}`, detail: `${seasonLabel(year + 1)}: ${money(budgets.staff)} staff budget and ${money(budgets.capital)} owner capital.`, needsAction: false, target: 'board' })
    }
  }
  for (const [index, event] of season.facilities.events.entries()) {
    if (event.type !== 'funding' || event.clubId !== clubId) continue
    items.push({ id: `funding-${index}`, date: event.date, category: 'club', title: event.approved ? 'Board capital approved' : 'Board capital refused', detail: `${FACILITIES[event.facilityType]}${event.project === 'repair' ? ' repair' : ''} · ${money(event.amount)}${event.approved ? '' : `. ${boardFundingRefusal(event)}`}`, needsAction: false, target: 'board' })
  }

  if (season.commercial.enabledSince) {
    const sponsorship = getClubSponsorship(season)
    if (sponsorship.open.length) items.push({ id: `sponsor-offers-${sponsorship.open[0]!.id}`, date: sponsorship.open[0]!.madeAt.date, category: 'club', title: 'Sponsor offers waiting', detail: `${sponsorship.open.length} ${sponsorship.open.length === 1 ? 'offer' : 'offers'} for ${seasonLabel(sponsorship.open[0]!.forSeason)}, open until ${medicalDate(sponsorship.open[0]!.expiresOn)}.`, needsAction: true, target: 'club' })
    for (const agreement of season.commercial.agreements) if (agreement.clubId === clubId && agreement.source === 'offer') items.push({ id: agreement.id, date: agreement.signedOn, category: 'club', title: `${getDevelopmentSponsor(agreement.sponsorId).name} signed`, detail: `Main sponsor from ${seasonLabel(agreement.startsSeason)}: ${money(agreement.annualFee)} a season${agreement.automatic ? ', chosen by automatic control' : ''}.`, needsAction: false, target: 'club' })
    // Format 64: early ends explained in plain language, and arena naming rights.
    for (const agreement of season.commercial.agreements) if (agreement.clubId === clubId && agreement.exit) items.push({ id: `exit-${agreement.id}`, date: agreement.exit.date, category: 'club', ...exitExplanation(agreement.sponsorId, 'main', agreement.exit, agreement.startsSeason), needsAction: false, target: 'club' })
    const naming = getClubNamingRights(season)
    if (naming?.open.length) items.push({ id: `naming-offers-${naming.open[0]!.id}`, date: naming.open[0]!.madeAt.date, category: 'club', title: 'Naming-rights offers waiting', detail: `${naming.open.length} ${naming.open.length === 1 ? 'offer' : 'offers'} to name your arena from ${seasonLabel(naming.open[0]!.forSeason)}, open until ${medicalDate(naming.open[0]!.expiresOn)}.`, needsAction: true, target: 'club' })
    for (const agreement of season.commercial.naming?.agreements ?? []) {
      if (agreement.clubId !== clubId) continue
      items.push({ id: agreement.id, date: agreement.signedOn, category: 'club', title: `Arena naming rights: ${agreement.arenaName}`, detail: `${getDevelopmentSponsor(agreement.sponsorId).name} names the arena from ${seasonLabel(agreement.startsSeason)}: ${money(agreement.annualFee)} a season${agreement.automatic ? ', chosen by automatic control' : ''}.`, needsAction: false, target: 'club' })
      if (agreement.exit) items.push({ id: `exit-${agreement.id}`, date: agreement.exit.date, category: 'club', ...exitExplanation(agreement.sponsorId, 'naming', agreement.exit, agreement.startsSeason), needsAction: false, target: 'club' })
    }
  }

  if (season.relationships.enabledSince) for (const row of getSquadRelationships(season)) {
    if (row.concern) items.push({ id: `concern-${row.player.id}`, date: season.date, category: 'players', title: `${row.player.name}: playing-time concern`, detail: `${row.concern}. Averaging ${row.averageMinutes} minutes against an agreed minimum of ${row.minMinutes}.`, needsAction: row.canTalk, target: 'dynamics', playerId: row.player.id })
    for (const promise of row.promises) if (promise.outcomeDate && (promise.status === 'kept' || promise.status === 'broken')) items.push({ id: `${promise.id}-outcome`, date: promise.outcomeDate, category: 'players', title: `Promise ${promise.status} · ${row.player.name}`, detail: `${promise.averageMinutes} minutes per eligible game against ${promise.targetMinutes} promised.`, needsAction: false, target: 'dynamics', playerId: row.player.id })
  }
  // Format 66: contract requests at the managed club and what became of them.
  for (const request of getClubContractRequests(season, clubId)) {
    const name = getCareerPlayer(season, request.playerId).name, waiting = awaitsContractReply(season, request)
    items.push({ id: request.id, date: request.date, category: 'players', title: `${name} asks about a new contract`, detail: waiting ? `His contract ends after ${seasonLabel(request.seasonNumber)}${request.trigger === 'interest' ? ' and another club has made an offer' : ''}. Answer by ${medicalDate(request.replyBy)}: open renewal talks, promise talks at season end, or decline.` : request.status === 'open' ? 'He has left the club; the request can no longer be answered.' : `His contract ends after ${seasonLabel(request.seasonNumber)}.`, needsAction: waiting, target: 'dynamics', playerId: request.playerId })
    if (request.repliedOn && request.reply) items.push({ id: `${request.id}-reply`, date: request.repliedOn, category: 'players', title: request.reply === 'talks' ? `Renewal talks opened · ${name}` : request.reply === 'promise' ? `Talks promised at season end · ${name}` : `Contract request declined · ${name}`, detail: request.status === 'talks' ? `Make him an offer by ${medicalDate(request.deadlineDate!)}.` : request.status === 'promised' ? `Make him an offer before ${medicalDate(request.deadlineDate!)}, when next season starts.` : request.reply === 'decline' ? `This ${TEXT.cost('declined')}, fading over time; ${TEXT.premium('declined')}.` : 'See the outcome below.', needsAction: request.status === 'talks' || request.status === 'promised', target: request.status === 'talks' || request.status === 'promised' ? 'contract' : 'dynamics', playerId: request.playerId })
    const outcome = request.status === 'ignored' ? ['Contract request ignored', `No answer within ${TEXT.replyWindow}: this ${TEXT.cost('ignored')}; ${TEXT.premium('ignored')}.`]
      : request.status === 'lapsed' ? ['Renewal talks lapsed', `No offer followed within ${TEXT.talksWindow}: this ${TEXT.cost('lapsed')}; ${TEXT.premium('lapsed')}.`]
      : request.status === 'broken' ? ['Promised contract talks never happened', `No offer before the new season: this ${TEXT.cost('broken')}; ${TEXT.premium('broken')}.`]
      : request.status === 'kept' ? ['Contract talks held', 'Your offer answered his request.']
      : request.status === 'renewed' ? ['New contract agreed', 'The renewal settled his request and restored morale and trust.'] : null
    if (outcome && request.outcomeDate) items.push({ id: `${request.id}-outcome`, date: request.outcomeDate, category: 'players', title: `${outcome[0]} · ${name}`, detail: outcome[1]!, needsAction: false, target: 'dynamics', playerId: request.playerId })
  }
  for (const fixture of season.fixtures) {
    const derby = fixture.result && [fixture.homeClubId, fixture.awayClubId].includes(clubId) ? governingDerby(season.rivalries, fixture.homeClubId, fixture.awayClubId, season.seasonNumber, fixture.round, worldOf(season)) : null
    if (!derby || !fixture.result) continue
    const home = fixture.homeClubId === clubId, won = fixture.result.winnerClubId === clubId
    items.push({ id: `derby-${fixture.id}`, date: fixture.date, category: 'board', title: derby.origin === 'results' ? `Rivalry game ${won ? 'won' : 'lost'} · ${rivalClubName(season, home ? fixture.awayClubId : fixture.homeClubId)}` : `${derby.name} ${won ? 'won' : 'lost'}`, detail: `${fixture.result.score[home ? 'home' : 'away']}–${fixture.result.score[home ? 'away' : 'home']} ${home ? 'at home' : 'away'}. The board and the squad weigh this result more than usual.`, needsAction: false, target: 'board' })
  }
  items.push(...rivalryInboxItems(season))
  if (usesFacilityRepairs(season.facilities) && season.facilities.enabledSince) for (const type of facilityTypes(season.facilities)) {
    // Format 65: wear shrinks the benefit until a repair restores it.
    if (!hasFacilityCondition(season, type, clubId)) continue
    const condition = getFacilityCondition(season, type, clubId)
    if (condition < FACILITY_RULES_2.automaticRepairBelow) items.push({ id: `worn-${type}`, date: season.date, category: 'club', title: `${FACILITIES[type]} wearing`, detail: `Condition ${condition}/100; its benefit shrinks until a repair restores it.`, needsAction: !season.facilities.delegated[clubId], target: 'club' })
  } else if (season.facilities.maintenanceSince) for (const type of facilityTypes(season.facilities)) {
    if (!hasFacilityCondition(season, type, clubId)) continue
    const condition = getFacilityCondition(season, type, clubId)
    if (condition < 60) items.push({ id: `worn-${type}`, date: season.date, category: 'club', title: `${FACILITIES[type]} wearing`, detail: `Condition ${condition}/100 under ${maintenancePlanOn(season.facilities, clubId, season.date)} upkeep; its benefit shrinks until full upkeep restores it.`, needsAction: maintenancePlanOn(season.facilities, clubId) === 'reduced', target: 'club' })
  }
  // Offers turned down: rebuilt from each governed season end at which the manager stayed.
  const lastEnded = season.status === 'complete' ? season.seasonNumber : season.seasonNumber - 1
  if (season.career?.enabledSince) for (let year = season.career.enabledSince.effectiveFrom; year <= lastEnded && careerMovesGovern(season.career, year); year += 1) {
    const outlook = seasonEndOutlook(season, year)
    // Career-2 (format 63): a protected first season that ended Under pressure brings a final warning.
    if (outlook?.warning) items.push({ id: `final-warning-${year}`, date: outlook.verdict.date, category: 'board', title: 'Final warning from the board', detail: `${seasonLabel(year)} ended Under pressure (confidence ${outlook.verdict.confidence}/100) in your protected first season at ${season.clubs.find(club => club.id === outlook.clubId)!.name}. The board kept you, but the next season counts.`, needsAction: false, target: 'board' })
    // Only a season-end move answers that season's offers (career-2 seasons can also hold mid-season moves).
    if (season.career.moves.some(move => move.seasonNumber === year && (move.phase ?? 'end') === 'end')) continue
    if (outlook?.offers.length && !outlook.dismissed) items.push({ id: `offers-declined-${year}`, date: outlook.verdict.date, category: 'board', title: outlook.offers.length === 1 ? 'Job offer declined' : 'Job offers declined', detail: `You stayed at ${season.clubs.find(club => club.id === outlook.clubId)!.name} after ${seasonLabel(year)}; ${outlook.offers.map(offer => season.clubs.find(club => club.id === offer.clubId)!.name).join(' and ')} had offered you ${outlook.offers.length === 1 ? 'its job' : 'their jobs'}.`, needsAction: false, target: 'board' })
  }
  const moves = season.career?.moves ?? []
  for (const move of moves) {
    // Career-2 seasons can hold several moves; each keeps its own message.
    const text = careerMoveText(season, move), sameSeason = moves.filter(item => item.seasonNumber === move.seasonNumber)
    items.push({ id: sameSeason.length > 1 ? `career-move-${move.seasonNumber}-${sameSeason.indexOf(move) + 1}` : `career-move-${move.seasonNumber}`, date: move.date, category: 'board', title: text.title, detail: text.detail, needsAction: false, target: 'board' })
  }
  for (const notice of clubRetirementsThisSeason(season)) items.push({ id: `retirement-${notice.playerId}`, date: notice.retiredOn, category: 'players', title: `${getCareerPlayer(season, notice.playerId).name} retires`, detail: 'The retirement takes effect for this season.', needsAction: false, target: 'squad', playerId: notice.playerId })

  return items.sort((a, b) => Number(b.needsAction) - Number(a.needsAction) || compare(b.date, a.date) || compare(a.id, b.id))
}
