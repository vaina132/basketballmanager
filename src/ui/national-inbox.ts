import type { SeasonState } from '../domain/season'
import type { InboxItem } from './inbox-items'
import { clubWindowCallUps, isNationalFixtureId, nationalPlayerInfo, nationalTeam, upcomingNationalWindow } from '../world/national'
import { injuryLabel } from '../domain/injuries'
import { NATIONAL_RULES, nationalTournamentName, nationalWindowDays } from '../world/national-calendar'
import { isUnemployed } from '../world/career-rules'
import { addCalendarDays } from '../world/competition-calendar'
import { formatMoney } from './money-format'
import { medicalDate } from './SeasonMedicalReport'

const WINDOW_NAMES: Record<number, string> = { 1: 'November window', 2: 'February window', 3: 'summer tournament' }
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`
/** The federation's mood in words, from its confidence. */
export function federationMood(confidence: number): string {
  return confidence >= 70 ? 'Delighted' : confidence >= 55 ? 'Pleased' : confidence >= 40 ? 'Satisfied' : confidence >= NATIONAL_RULES.dismissBelow ? 'Concerned' : 'Unhappy'
}

/**
 * Format 80 (owner feedback item 13, 22 November 2026): the Inbox's national messages, built only from recorded national
 * events: job offers (answered in the reading pane), appointments and their end, the federation's verdicts, and for
 * the club: players called up (as the coaches would pick them now) and players back from national duty.
 */
export function nationalInboxItems(season: SeasonState): InboxItem[] {
  const national = season.national
  if (!national) return []
  const items: InboxItem[] = [], name = (teamId: string) => nationalTeam(national, teamId).name
  for (const offer of national.offers) {
    const team = nationalTeam(national, offer.teamId), open = offer.status === 'open' && offer.expiresOn >= season.date
    const contract = `The contract runs to the end of the ${nationalTournamentName(season.seasonNumber + NATIONAL_RULES.contractSeasons - 1).replace(/ \(.*\)$/u, '')} summer; salary ${formatMoney(NATIONAL_RULES.salary[team.level])} a season, paid monthly by the federation into your career earnings (it does not enter club budgets).`
    items.push({
      id: offer.id, date: offer.date, category: 'board', target: 'national', offerId: offer.id, needsAction: open,
      title: open ? `Job offer · ${team.name} national team` : offer.status === 'accepted' ? `You accepted ${team.name}'s offer` : `${team.name}'s offer ${offer.status === 'declined' ? 'declined' : 'expired'}`,
      detail: open ? `The ${team.name} federation needs a head coach and offers you the job. You keep your club job: national games are in the FIBA windows, when club leagues pause. ${contract} Answer by ${medicalDate(offer.expiresOn)}.` : `The ${team.name} federation's offer of its head coach job is ${offer.status === 'open' ? 'expired' : offer.status}.`,
    })
  }
  for (const event of national.events) {
    const text = event.kind === 'appointed' ? [`Head coach of ${name(event.teamId)}`, `You are the new head coach of ${name(event.teamId)}. Pick your squad on the National team page before each window; your club job continues as before.`]
      : event.kind === 'resigned' ? [`You left ${name(event.teamId)}`, `You resigned as head coach of ${name(event.teamId)}. The federation has named a new head coach.`]
      : event.kind === 'dismissed' ? [`${name(event.teamId)} dismissed you`, `The ${name(event.teamId)} federation lost confidence after the results and named a new head coach. Your club job is not affected.`]
      : [`${name(event.teamId)} contract ended`, `Your contract with ${name(event.teamId)} ended after the summer tournament and the federation did not renew it.`]
    items.push({ id: event.id, date: event.date, category: 'board', title: text[0]!, detail: text[1]!, needsAction: false, target: 'national' })
  }
  for (const verdict of national.verdicts) {
    const key = /-w(\d)$/u.exec(verdict.id)?.[1], after = key ? `after the ${WINDOW_NAMES[Number(key)]}` : 'at the end of the contract'
    const outcome = verdict.outcome === 'dismissed' ? ' The federation has dismissed you.' : verdict.outcome === 'renewed' ? ' The federation renews your contract for two more seasons.' : verdict.outcome === 'left' ? ' The federation does not renew your contract.' : ''
    items.push({ id: verdict.id, date: verdict.date, category: 'board', title: `${name(verdict.teamId)} federation · ${federationMood(verdict.confidence)}`, detail: `Confidence ${verdict.confidence}/100${verdict.change ? ` (${verdict.change > 0 ? '+' : '−'}${Math.abs(verdict.change)})` : ''} ${after}. Wins against stronger teams raise it; losses against weaker teams lower it.${outcome}`, needsAction: false, target: 'national' })
  }
  if (isUnemployed(season)) return items
  // Owner (22 November 2026): the club's players injured with their national teams.
  const own = new Set(season.clubs.find(club => club.id === season.managedClubId)?.players.map(player => player.id) ?? [])
  const fixtures = new Map(national.competitions.flatMap(competition => competition.fixtures).map(fixture => [fixture.id, fixture]))
  for (const injury of season.injuries) {
    if (!isNationalFixtureId(injury.fixtureId) || injury.clubId !== season.managedClubId || !own.has(injury.playerId)) continue
    const fixture = fixtures.get(injury.fixtureId), side = fixture?.result?.squads.home.includes(injury.playerId) ? 'home' : 'away'
    const team = fixture ? name(side === 'home' ? fixture.homeTeamId : fixture.awayTeamId) : 'his national team'
    items.push({ id: `national-injury-${injury.id}`, date: injury.occurredOn, category: 'players', title: `${nationalPlayerInfo(season, injury.playerId).name} was injured with ${team}`, detail: `${injuryLabel(injury.kind)} on ${medicalDate(injury.occurredOn)}. He is back with the club injured and expected to return on ${medicalDate(injury.returnOn)}. See Squad > Medical.`, needsAction: false, target: 'squad', playerId: injury.playerId })
  }
  if (season.status !== 'active') return items
  // The club: players back from this season's windows, and those the coaches would call up for the next one.
  for (const window of [1, 2] as const) {
    const callUps = clubWindowCallUps(season, season.managedClubId, season.seasonNumber, window)
    if (!callUps?.played || !callUps.players.length) continue
    const list = callUps.players.map(item => `${nationalPlayerInfo(season, item.playerId).name} (${name(item.teamId)}, ${item.minutes} min)`).join(', ')
    items.push({ id: `national-back-s${season.seasonNumber}-w${window}`, date: callUps.saturday, category: 'players', title: `Back from national duty · ${plural(callUps.players.length, 'player', 'players')}`, detail: `${list}. They missed club training from Wednesday to Saturday and come back tired; check their condition before the next game.`, needsAction: false, target: 'squad' })
  }
  const upcoming = upcomingNationalWindow(season)
  if (upcoming) {
    const callUps = clubWindowCallUps(season, season.managedClubId, upcoming.seasonNumber, upcoming.window)
    if (callUps && !callUps.played && callUps.players.length) {
      const days = nationalWindowDays(upcoming.seasonNumber, upcoming.window)
      items.push({ id: `national-callups-s${upcoming.seasonNumber}-w${upcoming.window}`, date: addCalendarDays(upcoming.saturday, -13) > season.date ? season.date : addCalendarDays(upcoming.saturday, -13), category: 'players', title: `${plural(callUps.players.length, 'player', 'players')} called up for the ${WINDOW_NAMES[upcoming.window]}`, detail: `${callUps.players.map(item => `${nationalPlayerInfo(season, item.playerId).name} (${name(item.teamId)})`).join(', ')}. National games on ${medicalDate(days[0])} and ${medicalDate(days[1])}; they are away from Wednesday to Saturday. Your league does not play that weekend. The list can still change until the window.`, needsAction: false, target: 'squad' })
    }
  }
  return items
}
