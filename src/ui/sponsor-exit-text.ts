import type { CommercialExit, SponsorClause } from '../domain/commercial'
import type { SeasonState } from '../domain/season'
import { getDevelopmentSponsor } from '../data/development-sponsors'
import { worldOf } from '../world/career-world'
import { objectiveBadMiss } from '../world/commercial-policy'
import { seasonLabel } from '../world/season'
import { formatEuros } from './money-format'

const money = (cents: number) => formatEuros(cents)

export function ordinal(position: number): string {
  const tens = position % 100, ones = position % 10
  return `${position}${tens >= 11 && tens <= 13 ? 'th' : ones === 1 ? 'st' : ones === 2 ? 'nd' : ones === 3 ? 'rd' : 'th'}`
}

function leagueName(season: SeasonState, leagueId: string): string {
  return worldOf(season).domesticLeagues?.find(league => league.id === leagueId)?.name ?? 'the league'
}

/** The clause in plain language, for offers and current agreements (format 64). */
export function clauseSummary(season: SeasonState, clause: SponsorClause): string {
  const triggers = ['the club is relegated']
  if (clause.objective) triggers.push(`it finishes ${ordinal(clause.objective.position + objectiveBadMiss(clause.objective.leagueSize))} or lower in ${leagueName(season, clause.objective.leagueId)} (the sponsor's objective: top ${clause.objective.position})`)
  triggers.push('results and crowds fall sharply')
  const list = `${triggers.slice(0, -1).join(', ')} or ${triggers.at(-1)}`
  return `The sponsor may end the agreement after a season in which ${list}. It then pays an exit payment of ${money(clause.exitPayment)} and the later seasons are cancelled. Your club can end it early during a season for ${money(clause.terminationFee)} per cancelled season.`
}

const REASONS: Record<CommercialExit['reason'], string> = {
  relegation: 'the relegation',
  objective: 'the club missing its objective badly',
  decline: 'the sharp fall in results and crowds',
  club: 'your decision',
}

/** One sentence explaining an early end, for the inbox and Sponsorship. */
export function exitExplanation(sponsorId: string, contract: 'main' | 'naming', exit: CommercialExit, startsSeason: number): { title: string; detail: string } {
  const sponsor = getDevelopmentSponsor(sponsorId).name, deal = contract === 'naming' ? 'arena naming rights' : 'main sponsorship'
  const ends = exit.lastSeason < startsSeason ? 'It is cancelled before it starts' : `It ends after ${seasonLabel(exit.lastSeason)}`
  if (exit.by === 'club') return { title: `${sponsor} agreement ended early`, detail: `You ended the ${deal} agreement with ${sponsor} and paid a ${money(exit.amount)} termination fee. ${ends}; new offers arrive at the next sponsorship window.` }
  return { title: `${sponsor} ends its ${deal}`, detail: `${sponsor} used its exit clause after ${REASONS[exit.reason]}. ${ends}, and ${sponsor} paid an agreed exit payment of ${money(exit.amount)}. Other sponsors can now make offers.` }
}
