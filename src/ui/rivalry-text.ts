import type { CompetitionStage } from '../domain/competition'
import type { GrownRivalry, RivalryReason } from '../domain/rivalries'
import type { SeasonState } from '../domain/season'
import type { InboxItem } from './inbox-items'
import { managedClubFor } from '../world/career'
import { worldOf } from '../world/career-world'
import { governingDerby } from '../world/rivalries'
import { grownRivalryBetween, RIVALRY_LEVEL_LABELS, rivalryChanges, rivalryLevel } from '../world/rivalry-growth'
import { dateForRound, seasonLabel } from '../world/season'
import { medicalDate } from './SeasonMedicalReport'

const STAGES: Record<Exclude<CompetitionStage, 'regular'>, string> = { final: 'final', 'semi-final': 'semi-final', 'quarter-final': 'quarter-final', 'play-out': 'play-out', 'third-place': 'third-place game', 'round-of-16': 'round of 16', 'play-in': 'play-in', qualifying: 'qualifying round' }
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

/** A club's name from the career's world (European opponents included). */
export function rivalClubName(season: SeasonState, clubId: string): string {
  return season.clubs.find(club => club.id === clubId)?.name ?? worldOf(season).clubs.find(club => club.id === clubId)?.name ?? clubId
}

/** One recorded reason, for example "2026/27 final, 3-2 series". */
export function rivalryReasonText(season: SeasonState, reason: RivalryReason): string {
  if (reason.kind === 'base') return 'Fictional league rivals'
  const year = seasonLabel(reason.seasonNumber)
  switch (reason.kind) {
    case 'series': {
      const competition = reason.competition ? `${worldOf(season).europeanCompetitions?.find(item => item.id === reason.competition)?.name ?? 'European'} ` : ''
      const result = reason.score ? `${Math.max(...reason.score)}-${Math.min(...reason.score)} in one game` : `${Math.max(...reason.wins)}-${Math.min(...reason.wins)} series`
      return `${year} ${competition}${STAGES[reason.stage]}, ${result}`
    }
    case 'title-race': case 'promotion-race': case 'relegation-race': {
      const race = reason.kind === 'title-race' ? 'title race' : reason.kind === 'promotion-race' ? 'promotion race' : 'relegation race'
      return `${year} ${race}, ${reason.gap === 0 ? 'level on wins' : `${plural(reason.gap, 'win')} apart`}`
    }
    case 'close-games': return `${year}: ${plural(reason.games, 'close game')}${reason.overtime ? `, ${reason.overtime} in overtime` : ''}`
    case 'meetings': return `${year}: met ${reason.games} times`
    case 'europe': return `${year}: ${plural(reason.games, 'European game')} between clubs of the same country`
    case 'manager-move': return `${year}: you moved from ${rivalClubName(season, reason.fromClubId)} to ${rivalClubName(season, reason.toClubId)}`
    case 'star-move': return `${year}: ${reason.name} moved from ${rivalClubName(season, reason.fromClubId)} to ${rivalClubName(season, reason.toClubId)}`
  }
}

/** "Fierce rivalry · 72/100" */
export function rivalryLevelText(entry: GrownRivalry): string {
  return `${RIVALRY_LEVEL_LABELS[rivalryLevel(entry.intensity) ?? 'rivalry']} · ${entry.intensity}/100`
}

/** The reasons after the lasting base, joined for a short note. */
export function rivalryWhy(season: SeasonState, entry: GrownRivalry): string {
  const reasons = entry.reasons.filter(reason => reason.kind !== 'base')
  return reasons.length ? reasons.map(reason => rivalryReasonText(season, reason)).join('; ') : rivalryReasonText(season, entry.reasons[0]!)
}

/**
 * Format 68 inbox notes: rivalries of the managed club that formed or intensified at a season start (dated that
 * season's first matchday), and the next game when it is a rivalry game. Built from the recorded tables and calendar.
 */
export function rivalryInboxItems(season: SeasonState): InboxItem[] {
  if (season.rivalries?.model !== 'rivalries-2') return []
  const items: InboxItem[] = []
  for (const change of rivalryChanges(season.rivalries, year => managedClubFor(season, year, false))) {
    const name = rivalClubName(season, change.rivalId)
    items.push({ id: `rivalry-${change.change}-${change.seasonNumber}-${change.rivalId}`, date: dateForRound(1, change.seasonNumber), category: 'board', title: `${change.change === 'formed' ? 'Rivalry formed' : 'Rivalry intensified'} · ${name}`, detail: `${rivalryLevelText(change.entry)} from ${seasonLabel(change.seasonNumber)}. Why: ${rivalryWhy(season, change.entry)}.`, needsAction: false, target: 'board' })
  }
  if (season.status === 'active' && season.rivalries.enabledSince) {
    const clubId = season.managedClubId, world = worldOf(season)
    const next = season.fixtures.filter(fixture => !fixture.result && [fixture.homeClubId, fixture.awayClubId].includes(clubId)).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1)[0]
    const rivalId = next ? (next.homeClubId === clubId ? next.awayClubId : next.homeClubId) : null
    const grown = next && rivalId && governingDerby(season.rivalries, next.homeClubId, next.awayClubId, season.seasonNumber, next.round, world) ? grownRivalryBetween(season.rivalries, clubId, rivalId, season.seasonNumber, world) : null
    if (next && rivalId && grown) items.push({ id: `rivalry-next-${next.id}`, date: season.date, category: 'board', title: `Rivalry game next · ${rivalClubName(season, rivalId)}`, detail: `${medicalDate(next.date)}, ${next.homeClubId === clubId ? 'at home' : 'away'}. ${rivalryLevelText(grown.entry)}. Why: ${rivalryWhy(season, grown.entry)}.`, needsAction: false, target: 'board' })
  }
  return items
}

/** For a match preview: " Fierce rivalry · 72/100. Why: …" for grown rivalries, nothing for fixed ones. */
export function rivalryNote(season: SeasonState, rivalId: string): string {
  const grown = grownRivalryBetween(season.rivalries, season.managedClubId, rivalId, season.seasonNumber, worldOf(season))
  return grown ? ` ${rivalryLevelText(grown.entry)}. Why: ${rivalryWhy(season, grown.entry)}.` : ''
}
