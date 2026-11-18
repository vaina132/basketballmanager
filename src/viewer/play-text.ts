import type { MatchEvent } from '../domain/types'
import type { Roster } from './choreography'

/**
 * A short running line for the court view ("Larkin drives, lays it in. 54-48").
 * Built only from the recorded event and the one before it; the full engine text stays in the play-by-play.
 */
export function describePlay(event: MatchEvent, roster: Roster, previous?: MatchEvent): string {
  const name = (id?: string) => id ? roster.get(id)?.name.split(' ').at(-1) ?? 'A player' : 'A player'
  const score = `${event.score.home}-${event.score.away}`
  const who = name(event.playerId)
  switch (event.type) {
    case 'pass': return `${who} passes to ${name(event.receiverId)}.`
    case 'drive': return `${who} drives to the basket.`
    case 'shot': {
      const shot = event.shot
      const blocked = /^(.+?) blocks /.exec(event.text)
      if (blocked) return `${who} goes up, ${blocked[1]!.split(' ').at(-1)} blocks it!`
      const close = (shot?.distanceM ?? 9) < 2.2
      const drove = previous?.type === 'drive' && previous.playerId === event.playerId
      const assisted = event.assistPlayerId ? ` (${name(event.assistPlayerId)} assist)` : ''
      if (shot?.value === 3) return shot.made ? `${who} hits the three${assisted}. ${score}` : `${who} misses the three.`
      const action = shot?.made ? close ? 'lays it in' : 'scores the jumper' : close ? 'misses at the rim' : 'misses the jumper'
      return `${drove ? `${who} drives, ${action}` : `${who} ${action}`}${shot?.made ? `${assisted}. ${score}` : '.'}`
    }
    case 'free-throw': {
      const made = /\bmakes\b/.test(event.text)
      const which = /free throw (\d) of (\d)/.exec(event.text)
      return `${who} ${made ? 'makes' : 'misses'} the free throw${which ? ` (${which[1]} of ${which[2]})` : ''}.${made ? ` ${score}` : ''}`
    }
    case 'rebound': return /offensive/.test(event.text) ? `Offensive rebound, ${who}.` : `${who} grabs the rebound.`
    case 'turnover': {
      const stolen = /^(.+?) steals /.exec(event.text)
      return stolen ? `${stolen[1]!.split(' ').at(-1)} steals it from ${who}!` : `${who} loses it out of bounds.`
    }
    case 'shot-clock': return 'Shot clock violation. Turnover.'
    case 'command':
      if (/free-throw line/.test(event.text)) return `${who} steps to the free-throw line.`
      if (/half-court offense|brings the ball forward|frontcourt/.test(event.text)) return `${who} brings it up.`
      if (/organizes the attack/.test(event.text)) return `${who} sets up the offense.`
      return event.text
    case 'final': return `${event.text} ${score}`
    case 'period-end': return `${event.text} ${score}`
    default: return event.text
  }
}
