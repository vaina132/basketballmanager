import type { BoardEuropeanAim } from '../domain/board'
import type { EuropeanPlace, EuropeanPlacesDecision, LostEuropeanPlace, SeasonEurope, SeasonState, WildCardScore } from '../domain/season'
import type { InboxItem } from './inbox-items'
import { worldOf } from '../world/career-world'
import { clubPlace, EUROPEAN_ENTRY_RULES, licenceFailure, usesEuropeanEntry, wildCardScore } from '../world/european-entry'
import { placesDayInput } from '../world/european-entry-day'
import { europeanPlacesAfter, MAX_SEASON_NUMBER, seasonLabel } from '../world/season'
import { isUnemployed } from '../world/career-rules'
import { formatMoney } from './money-format'
import { clubEconomy } from '../world/economy'

/**
 * Format 83: words for the European entry rules (`places-2`): place types, reasons, the Inbox messages of the places day
 * and the "Your club" card's facts. Everything shown is built from the career's places and the places day's facts.
 */
export const usesEntryRules = (season: SeasonState) => usesEuropeanEntry(season.europe)

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
export const competitionName = (season: SeasonState, competitionId: string) => worldOf(season).europeanCompetitions?.find(item => item.id === competitionId)?.name ?? competitionId
export const clubName = (season: SeasonState, clubId: string) => season.clubs.find(club => club.id === clubId)?.name ?? worldOf(season).clubs.find(club => club.id === clubId)?.name ?? clubId
const points = (tenths: number) => (tenths / 10).toFixed(tenths % 10 ? 1 : 0)
export const scoreText = (score: WildCardScore | number) => points(typeof score === 'number' ? score : score.total)

/** "Licence (permanent)", "Multi-year place until 2029/30", "EuroCup route · season 2 of 3"… */
export function placeLabel(place: EuropeanPlace): string {
  switch (place.type) {
    case 'licence': return 'Licence (permanent)'
    case 'multi-year': return `Multi-year place until ${seasonLabel(place.until!)}`
    case 'route': return `EuroCup route · season ${place.route ?? 1} of ${EUROPEAN_ENTRY_RULES.routeMaxSeasons}`
    case 'wild-card': return 'Wild card · one season'
    case 'one-year': return 'One-year place'
    case 'drop-down': return 'One-year place after the EuroLeague'
    case 'league': return 'League place · one season'
    case 'title-holder': return 'Title holder · one season'
    case 'invitation': return 'Invitation · one season'
  }
}

/** Why the club holds its place, in a few words. */
export function placeReason(place: EuropeanPlace): string {
  switch (place.reason) {
    case 'opening': return 'Real 2026/27 place'
    case 'licence': case 'multi-year': return 'Place kept'
    case 'licence-back': return 'Back in a top division: place restored'
    case 'renewed': return 'Renewed after the review (score 60 or more)'
    case 'route-kept': return 'Kept by reaching the EuroLeague playoffs'
    case 'route-champion': return 'EuroCup champion'
    case 'route-runner-up': return 'EuroCup runner-up (both route places were open)'
    case 'wild-card': return 'Wild card by score'
    case 'licence-renewed': return 'Licence renewed for five seasons'
    case 'drop-down': return 'Left the EuroLeague'
    case 'country-quota': return place.rank ? `${ordinal(place.rank)} in the final league ranking` : 'Country place'
    case 'country-kept': return 'Country place kept'
    case 'quota-score': return 'Open country place, by score'
    case 'title-holder': return 'BCL champion'
    case 'invitation-drop': return 'Invitation after leaving the EuroCup'
    case 'invitation-score': return 'Invitation by score'
    case 'size-fill': return 'Place filled to keep the competition full'
    case 'declined-higher': return 'Kept after declining a higher place'
  }
}

const LOST: Record<LostEuropeanPlace['reason'], string> = {
  relegated: 'Relegated: no European place next season. A licence waits until the club is back in a top division.',
  unpaid: `Unpaid costs above ${EUROPEAN_ENTRY_RULES.unpaidShare * 100}% of the budget. Pay them off to be eligible again.`,
  ended: 'The place ended and was not renewed.',
  'route-limit': `Three seasons on the EuroCup route is the most.`,
  'route-playoffs': 'The EuroCup route place needs the EuroLeague playoffs to be kept.',
}
export const lostText = (reason: LostEuropeanPlace['reason']) => LOST[reason]

const AIMS: Record<BoardEuropeanAim['kind'], string> = {
  'euroleague-playoffs': 'Reach the EuroLeague playoffs', 'euroleague-play-in': 'Reach the EuroLeague Play-In', 'eurocup-quarter-finals': 'Reach the EuroCup quarter-finals',
  'eurocup-eighth-finals': 'Reach the EuroCup eighth-finals', 'bcl-quarter-finals': 'Reach the BCL quarter-finals', 'bcl-round-of-16': 'Reach the BCL Round of 16', 'european-place': 'Earn a European place for next season',
}
export const aimText = (aim: BoardEuropeanAim) => `${AIMS[aim.kind]}${aim.keep ? ' (to keep our place)' : ''}`

const caches = new WeakMap<SeasonState, { decided: SeasonEurope | null; facts: ReturnType<typeof placesDayInput> | null }>()
/** The places day's result once the season is complete (null before), with the manager's answers so far. */
export function decidedPlaces(season: SeasonState): SeasonEurope | null {
  return entryView(season).decided
}
function entryView(season: SeasonState) {
  let view = caches.get(season)
  if (!view) {
    const decided = usesEntryRules(season) && season.status === 'complete' && season.seasonNumber < MAX_SEASON_NUMBER ? europeanPlacesAfter(season) : null
    view = { decided, facts: null }
    caches.set(season, view)
  }
  return view
}
/** This season's facts as the places day would read them (the table so far while the season is played). */
export function entryFacts(season: SeasonState) {
  const view = entryView(season)
  view.facts ??= usesEntryRules(season) ? placesDayInput(season, season.status === 'complete' ? { withoutAnswers: true } : { provisional: true }) : null
  return view.facts
}

export interface YourClubCard {
  clubId: string
  now: { competitionId: string; place: EuropeanPlace } | null
  next: { competitionId: string; place: EuropeanPlace } | null
  decided: boolean
  checks: { label: string; ok: boolean; value: string }[]
  score: WildCardScore | null
  lastWildCard: number | null
  seatsNeeded: number
  fixes: string[]
}

/** The "Your club" card: next season's status, the wild-card checklist and the score against last year's lowest wild card. */
export function yourClubCard(season: SeasonState): YourClubCard | null {
  if (!usesEntryRules(season) || isUnemployed(season)) return null
  const clubId = season.managedClubId, input = entryFacts(season), facts = input?.facts.get(clubId)
  if (!input || !facts) return null
  const decided = decidedPlaces(season)
  const now = clubPlace(season.europe, clubId), next = decided ? clubPlace(decided, clubId) : null
  const inEuroleague = now ? worldOf(season).europeanCompetitions?.find(item => item.id === now.competitionId)?.kind === 'euroleague' : false
  const seatsNeeded = inEuroleague ? EUROPEAN_ENTRY_RULES.seats.wildCardFormer : EUROPEAN_ENTRY_RULES.seats.wildCard
  const euroleague = worldOf(season).europeanCompetitions?.find(item => item.kind === 'euroleague')
  const count = (country: string | null) => country === null || !euroleague ? 0 : (season.europe!.entrants.find(entry => entry.competitionId === euroleague.id)?.clubIds ?? []).filter(id => id !== clubId && input.facts.get(id)?.country === country).length
  const score = wildCardScore(facts, season.seasonNumber, count)
  const limit = facts.budget === null ? null : Math.round(facts.budget * EUROPEAN_ENTRY_RULES.unpaidShare)
  const top = season.status === 'complete' ? facts.topNext : facts.topNow
  const checks = [
    { label: season.status === 'complete' ? 'Top division next season' : 'Top division', ok: top, value: top ? 'Yes' : 'No' },
    { label: 'Unpaid costs', ok: licenceFailure({ ...facts, topNext: true }) === null, value: `${formatMoney(facts.unpaid ?? 0)}${limit !== null ? ` / ${formatMoney(limit)} limit` : ''}` },
    { label: 'Arena seats for a wild card', ok: facts.seats >= seatsNeeded, value: `${facts.seats.toLocaleString('en-GB')} / ${seatsNeeded.toLocaleString('en-GB')}` },
  ]
  const fixes: string[] = []
  // A licence or a multi-year place running beyond next season only needs the licence check.
  const held = next ?? now, secure = !!held && (held.place.type === 'licence' || held.place.type === 'multi-year' && (held.place.until ?? 0) > season.seasonNumber + 1)
  if (!checks[0]!.ok) fixes.push('Win promotion back to the top division.')
  if (!checks[1]!.ok) fixes.push('Clear unpaid costs (Club > Facilities & money).')
  if (!secure && !checks[2]!.ok) fixes.push('Expand the arena (Club > Facilities & money).')
  if (!secure && score.europe < 140) fixes.push('Go far in Europe: winning the EuroCup is the direct route.')
  if (!secure && score.domestic < 150) fixes.push('Finish higher in the league (the ranking after the playoffs counts).')
  const lastWildCard = lowestWildCard(season.europe?.decision)
  return { clubId, now, next, decided: !!decided, checks, score, lastWildCard, seatsNeeded, fixes }
}

/** The lowest score that won a wild card on a places day, or null when none was awarded by score. */
export function lowestWildCard(decision: EuropeanPlacesDecision | undefined): number | null {
  const chosen = decision?.chosen ?? []
  const scores = decision?.wildCards.filter(item => chosen.includes(item.clubId)).map(item => item.total) ?? []
  return scores.length ? Math.min(...scores) : null
}

const TYPE_WORDS: Record<EuropeanPlace['type'], string> = { licence: 'licence', 'multi-year': 'multi-year place', route: 'EuroCup route place', 'wild-card': 'wild card', 'one-year': 'one-year place', 'drop-down': 'one-year place', league: 'league place', 'title-holder': 'title holder place', invitation: 'invitation' }

/** Format 83: the Inbox's European messages: the places day's news, the manager's invitations and the money warning. */
export function europeanInboxItems(season: SeasonState): InboxItem[] {
  if (!usesEntryRules(season) || isUnemployed(season)) return []
  const items: InboxItem[] = [], clubId = season.managedClubId
  const report = (decision: EuropeanPlacesDecision, places: SeasonEurope, live: boolean) => {
    const year = decision.seasonNumber + 1, held = clubPlace(places, clubId)
    items.push({ id: `europe-places-s${year}`, date: decision.date, category: 'club', target: 'europe', needsAction: false,
      title: `European places for ${seasonLabel(year)}`,
      detail: held ? `${clubName(season, clubId)}: ${competitionName(season, held.competitionId)} · ${placeLabel(held.place)}. ${placeReason(held.place)}.${live ? ' Places are final when the new season starts.' : ''}`
        : `${clubName(season, clubId)} has no European place for ${seasonLabel(year)}.${(places.held ?? []).some(item => item.clubId === clubId) ? ' Its licence waits until the club can take it again.' : ''}` })
    for (const offer of decision.offers.filter(item => item.clubId === clubId)) {
      const open = live && !offer.answered && offer.outcome === 'accepted'
      const name = competitionName(season, offer.competitionId), kind = TYPE_WORDS[offer.type]
      items.push({ id: `europe-offer-s${year}-${offer.competitionId}`, date: decision.date, category: 'club', target: 'europe', offerId: offer.competitionId, needsAction: open,
        title: open ? `Invitation: ${name} ${kind}` : offer.outcome === 'declined' ? `You declined the ${name} ${kind}` : `${name} ${kind} accepted`,
        detail: open ? `${clubName(season, clubId)} is offered a ${name} ${kind} for ${seasonLabel(year)}. Accept or decline before the new season starts; without an answer your assistant accepts. Declining keeps any lower place the club has; otherwise it is offered the best competition below.`
          : offer.outcome === 'declined' ? `${name} will give the place to the next club.` : offer.answered ? `You accepted the ${name} place.` : `Your assistant accepted the ${name} place.` })
    }
    if (decision.chosen.length) items.push({ id: `europe-wildcards-s${year}`, date: decision.date, category: 'club', target: 'europe', needsAction: false,
      title: 'EuroLeague wild cards awarded',
      detail: decision.chosen.map(id => { const score = decision.wildCards.find(item => item.clubId === id); return `${clubName(season, id)} (score ${score ? scoreText(score) : '?'}${score ? ` · ${topReasons(score)}` : ''})` }).join('; ') + '.' })
    for (const lost of decision.lost.filter(item => item.clubId === clubId)) items.push({ id: `europe-lost-s${year}-${lost.competitionId}`, date: decision.date, category: 'club', target: 'europe', needsAction: false,
      title: `European place lost · ${competitionName(season, lost.competitionId)}`, detail: lostText(lost.reason) })
  }
  if (season.europe?.decision) report(season.europe.decision, season.europe, false)
  const decided = decidedPlaces(season)
  if (decided?.decision) report(decided.decision, decided, true)
  // During the season: one warning when unpaid costs pass 5% of the budget.
  const review = season.board.reviews.filter(item => item.seasonNumber === season.seasonNumber).at(-1), unpaid = review?.clubs[clubId]?.unpaid ?? null
  const budget = clubEconomy(season, clubId)?.budget ?? null
  if (season.status === 'active' && review && unpaid !== null && budget !== null && unpaid > budget * EUROPEAN_ENTRY_RULES.warnShare) items.push({ id: `europe-unpaid-s${season.seasonNumber}`, date: review.date, category: 'club', target: 'club', needsAction: false,
    title: 'European places at risk: unpaid costs',
    detail: `Unpaid costs are ${formatMoney(unpaid)}, above ${EUROPEAN_ENTRY_RULES.warnShare * 100}% of the ${formatMoney(budget)} budget. Above ${EUROPEAN_ENTRY_RULES.unpaidShare * 100}% at the season end, the club cannot take a European place.` })
  return items
}

/** A score's two biggest parts in words: "EuroCup final, 15,000 seats". */
export function topReasons(score: WildCardScore): string {
  const parts: [number, string][] = [[score.europe, 'European results'], [score.domestic, 'league finish'], [score.arena, 'arena'], [score.budget, 'budget'], [score.market, 'new market'], [score.history, 'past EuroLeague seasons']]
  return parts.filter(([value]) => value > 0).sort((a, b) => b[0] - a[0]).slice(0, 2).map(([, label]) => label).join(', ')
}
