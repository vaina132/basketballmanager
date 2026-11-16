import type { SeasonEndDecision } from '../domain/career'
import type { SeasonState } from '../domain/season'
import type { SeasonEndOutlook } from '../world/career-policy'
import { isUnemployed } from '../world/career-rules'
import { regularWorldRounds, seasonRounds, worldOf } from '../world/career-world'
import { continueAction, runContinueStep } from '../world/continue-step'
import { getMarketWindow, isLiveMarketOffer } from '../world/market-policy'
import { currentGameDay, seasonLabel } from '../world/season'
import { careerDay, careerToday, gameDate, gamesText, nextGameText, seasonChangeText } from './career-text'
import { getInboxItems } from './inbox-items'

/**
 * The one Continue control (owner request, 16 November 2026: "like in Football Manager", passing day by day with the
 * other simulations in the background). A run repeats the game's existing steps (`runContinueStep`) and stops where the
 * manager is needed: the manager's match day, a decision to answer, new important Inbox items, a season boundary.
 */
export type ContinuePage = 'match' | 'home' | 'inbox' | 'transfers' | 'season'
export interface ContinueStop {
  kind: 'match' | 'season-end' | 'season-start' | 'career' | 'inbox' | 'offers' | 'board' | 'start-ready' | 'blocked' | 'decision' | 'stopped' | 'error'
  /** What the manager needs to know, in one or two sentences. */
  message: string
  /** Where the stop takes the manager; none keeps the current page. */
  page?: ContinuePage
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

/** New items that need the manager, by id: what was not waiting before the step. */
function newActionItems(before: SeasonState, after: SeasonState) {
  const waiting = new Set(getInboxItems(before).filter(item => item.needsAction).map(item => item.id))
  return getInboxItems(after).filter(item => item.needsAction && !waiting.has(item.id))
}

type AnyOffer = { id: string; clubId: string; status: string; transfer: { sellerClubId: string; clubStatus: string } | null }
const offerKey = (offer: AnyOffer) => `${offer.status}:${offer.transfer?.clubStatus ?? ''}`
const offersOf = (state: SeasonState): AnyOffer[] => [...(state.recruitment?.offers ?? []).filter(offer => offer.seasonNumber === state.seasonNumber), ...(getMarketWindow(state)?.offers ?? [])]

/** Replies to the manager's own offers (players and selling clubs), and new offers from other clubs for the manager's players. */
function offerNews(before: SeasonState, after: SeasonState): { replies: number; incoming: number } {
  const clubId = after.managedClubId, prior = new Map(offersOf(before).map(offer => [offer.id, offerKey(offer)]))
  let replies = 0, incoming = 0
  for (const offer of offersOf(after)) {
    const changed = prior.get(offer.id) !== offerKey(offer)
    if (!changed) continue
    if (offer.clubId === clubId && prior.has(offer.id)) replies += 1
    else if (offer.transfer?.sellerClubId === clubId && offer.status === 'club-review') incoming += 1
  }
  return { replies, incoming }
}

/** Format 70: a new open request from the president of the manager's club. */
function newPresidentRequest(before: SeasonState, after: SeasonState): boolean {
  const open = (state: SeasonState) => (state.board?.requests ?? []).filter(request => request.outcome === 'open' && request.clubId === state.managedClubId).map(request => request.id)
  const known = new Set(open(before))
  return open(after).some(id => !known.has(id))
}

/** Whether a run stops after the step from `before` to `after`, and why. Null: the run goes on. */
export function continueStop(before: SeasonState, after: SeasonState): ContinueStop | null {
  const unemployed = isUnemployed(after)
  const to = (page: ContinuePage): ContinuePage => unemployed ? 'home' : page
  if (after.seasonNumber !== before.seasonNumber) {
    const first = unemployed ? undefined : careerDay(after).next
    return { kind: 'season-start', message: `${seasonLabel(after.seasonNumber)} is ready. Your previous results are in Competitions.${first ? ` Your first game: ${nextGameText(after, first)}.` : ''}`, page: 'home' }
  }
  const moved = (after.career?.moves.length ?? 0) > (before.career?.moves.length ?? 0)
  if (moved || after.status === 'complete' && before.status === 'active') {
    const text = seasonChangeText(before, after)
    return { kind: moved ? 'career' : 'season-end', message: after.status === 'complete' ? `Season complete. ${text}` : text, page: moved ? 'home' : to('season') }
  }
  if (after.status === 'active' && after.activeMatch && (after.activeMatch.status !== 'finished' || after.activeMatch.result?.kind === 'default')) {
    const fixture = after.fixtures.find(item => item.id === after.activeFixtureId)
    return { kind: 'match', message: `Your next game is ready${fixture ? `: ${nextGameText(after, fixture)}` : ''}.`, page: 'match' }
  }
  const items = newActionItems(before, after)
  if (items.length) return { kind: 'inbox', message: `New in your inbox: ${items[0]!.title}${items.length > 1 ? ` and ${plural(items.length - 1, 'more message', 'more messages')}` : ''}.`, page: to('inbox') }
  const offers = unemployed ? { replies: 0, incoming: 0 } : offerNews(before, after)
  if (offers.replies || offers.incoming) {
    const said = [offers.replies ? `${plural(offers.replies, 'reply', 'replies')} to your offers` : '', offers.incoming ? `${plural(offers.incoming, 'new offer', 'new offers')} for your players` : ''].filter(Boolean).join(' and ')
    return { kind: 'offers', message: `${said[0]!.toUpperCase()}${said.slice(1)}. Review ${offers.replies + offers.incoming === 1 ? 'it' : 'them'} in Transfers.`, page: 'transfers' }
  }
  if (!unemployed && newPresidentRequest(before, after)) return { kind: 'board', message: 'The president has a new request. Its deadline and reward are on the board.', page: 'home' }
  if (after.status === 'complete') {
    const next = continueAction(after)
    if (next.kind === 'rollover' && before.status === 'complete') return { kind: 'start-ready', message: `Recruitment is complete: ${seasonLabel(after.seasonNumber + 1)} can start. Continue starts it.`, page: to('transfers') }
    if (next.kind === 'blocked') return { kind: 'blocked', message: next.reason, page: to('transfers') }
  }
  return null
}

/** What the next step processes, for the progress display: the day and "8 European games" or "Weekly club business". */
export interface ContinueStepView { day: string; label: string }
export function continueStepView(state: SeasonState): ContinueStepView {
  const action = continueAction(state)
  if (action.kind === 'market') return { day: action.date, label: 'Recruitment day: player replies and signings' }
  if (action.kind === 'rollover') return { day: state.date, label: `Preparing the ${seasonLabel(state.seasonNumber + 1)} season` }
  if (action.kind !== 'round') return { day: careerToday(state), label: '' }
  // Without a club, a step plays the whole week (no managed match to stop for).
  if (isUnemployed(state)) {
    const games = state.fixtures.filter(fixture => fixture.round === state.round && !fixture.result).length
    return { day: state.date, label: `Matchday ${state.round}: ${games ? `${plural(games, 'game', 'games')} and ` : ''}weekly club business` }
  }
  const day = currentGameDay(state)
  if (!day) return { day: state.date, label: 'Weekly club business' }
  const today = careerDay(state)
  const what = state.activeMatch ? `Your game${today.gamesToday > 1 ? ` and ${plural(today.gamesToday - 1, 'other game', 'other games')}` : ''}` : gamesText(today.gamesToday, today.kind)
  // The week's business follows its last game day; postseason results can still add games later in a week.
  const last = !state.fixtures.some(fixture => fixture.round === state.round && !fixture.result && fixture.date > day)
  const business = last && state.round <= regularWorldRounds(worldOf(state)) ? state.round === seasonRounds(state) ? ' · season end' : ' · weekly club business' : ''
  return { day, label: `${what}${business}` }
}

/**
 * Steps still expected before the run's natural stop: the manager's next game day (or the season's end), the
 * recruitment days left in the offseason, or the rollover. An estimate: postseason games and offers add steps.
 */
export function remainingSteps(state: SeasonState): number {
  const action = continueAction(state)
  if (action.kind === 'rollover') return 1
  if (action.kind === 'market') {
    const window = getMarketWindow(state)!, dates = new Set<string>([window.closesOn])
    for (let day = new Date(`${window.date}T00:00:00Z`); ; ) { day.setUTCDate(day.getUTCDate() + 7); const iso = day.toISOString().slice(0, 10); if (iso >= window.closesOn) break; dates.add(iso) }
    for (const offer of window.offers) if (isLiveMarketOffer(offer)) { const date = offer.status === 'pending' ? offer.responseOn : offer.expiresOn; if (date > window.date && date <= window.closesOn) dates.add(date) }
    return Math.max(1, dates.size)
  }
  if (action.kind !== 'round') return 0
  const rounds = seasonRounds(state)
  if (isUnemployed(state)) return rounds - state.round + 1
  const clubId = state.managedClubId
  const target = state.fixtures.find(fixture => !fixture.result && fixture.id !== state.activeFixtureId && fixture.round >= state.round && (fixture.homeClubId === clubId || fixture.awayClubId === clubId))
  let steps = 0
  for (let round = state.round; round <= (target?.round ?? rounds); round += 1) {
    const days = new Set(state.fixtures.filter(fixture => fixture.round === round && !fixture.result && (round !== target?.round || fixture.date < target.date)).map(fixture => fixture.date))
    // A week's first game day is prepared at the end of the week before; a week without games is one step.
    steps += round === target?.round ? days.size : Math.max(1, days.size)
  }
  return Math.max(1, steps)
}

/** The run's share done, 0-1, after `steps` steps from its start. */
export function continueProgress(state: SeasonState, steps: number): number {
  return steps / (steps + remainingSteps(state))
}

/** The one notice of a stop: what was played or recorded during the run, then why it stopped. */
export function continueNotice(start: SeasonState, end: SeasonState, stop: ContinueStop): string {
  const parts: string[] = []
  if (start.seasonNumber === end.seasonNumber && start.status === 'active') {
    const before = new Map(start.fixtures.map(fixture => [fixture.id, !!fixture.result]))
    const days = end.fixtures.filter(fixture => fixture.result && !before.get(fixture.id)).map(fixture => fixture.date).sort()
    if (days.length) parts.push(`${plural(days.length, 'game', 'games')} played (${gameDate(days[0]!)}${days.at(-1) !== days[0] ? ` – ${gameDate(days.at(-1)!)}` : ''}).`)
    const last = end.status === 'complete' ? end.round : end.round - 1
    if (last >= start.round && stop.kind !== 'season-end' && stop.kind !== 'career') parts.push(last === start.round ? `Matchday ${start.round} recorded.` : `Matchdays ${start.round}–${last} recorded.`)
  } else if (start.seasonNumber === end.seasonNumber && end.date !== start.date) parts.push(`Offseason recruitment up to ${gameDate(end.date)}.`)
  parts.push(stop.message)
  return parts.join(' ')
}

/** A stop at the manager's request: where the career stands and what Continue does next. */
export function stoppedRun(state: SeasonState): ContinueStop {
  const next = continueStepView(state)
  return { kind: 'stopped', message: next.label ? `Stopped. Next: ${next.label.charAt(0).toLowerCase()}${next.label.slice(1)} on ${gameDate(next.day)}.` : 'Stopped.' }
}

export interface ContinueRun { state: SeasonState; steps: number; stop: ContinueStop | null; outlook?: SeasonEndOutlook }

/**
 * A whole run without a worker (tests, and the page's rules in one place): steps until a stop, or `maxSteps`. The page
 * runs the same steps in the season worker and applies `continueStop` after each one.
 */
export function continueUntilStop(state: SeasonState, options: { decided?: boolean; decision?: SeasonEndDecision; maxSteps?: number } = {}): ContinueRun {
  const action = continueAction(state)
  if (action.kind === 'match') return { state, steps: 0, stop: { kind: 'match', message: 'Your game is ready.', page: 'match' } }
  if (action.kind === 'blocked') return { state, steps: 0, stop: { kind: 'blocked', message: action.reason } }
  let current = state, steps = 0, choice: { decided?: boolean; decision?: SeasonEndDecision } = { decided: options.decided, decision: options.decision }
  for (;;) {
    const result = runContinueStep(current, choice)
    choice = {}
    if ('outlook' in result) return { state: current, steps, stop: { kind: 'decision', message: 'The board has decided about your job.' }, outlook: result.outlook }
    steps += 1
    const stop = continueStop(current, result.state)
    current = result.state
    if (stop) return { state: current, steps, stop }
    if (options.maxSteps !== undefined && steps >= options.maxSteps) return { state: current, steps, stop: null }
  }
}

/** The idle control: the day, what today is, and whether Continue can be pressed (with the reason when it cannot). */
export interface ContinueControlInfo { day: string; status: string; disabled: boolean; reason: string | null; opensMatch: boolean }
export function continueControlInfo(state: SeasonState, matchStatus: string, onMatchPage: boolean): ContinueControlInfo {
  const action = continueAction(state), day = careerToday(state)
  if (action.kind === 'match') return onMatchPage
    ? { day, status: matchStatus, disabled: true, reason: 'Play or simulate your match, then Continue.', opensMatch: false }
    : { day, status: matchStatus, disabled: false, reason: null, opensMatch: true }
  if (action.kind === 'blocked') return { day, status: 'Action needed', disabled: true, reason: action.reason, opensMatch: false }
  const status = action.kind === 'market' ? 'Offseason recruitment' : action.kind === 'rollover' ? `Ready for ${seasonLabel(state.seasonNumber + 1)}`
    : state.activeMatch ? matchStatus : isUnemployed(state) ? 'Between jobs' : careerDay(state).label
  return { day, status, disabled: false, reason: null, opensMatch: false }
}
