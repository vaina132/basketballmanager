import type { MatchEvent } from '../domain/types'
import type { Roster } from './choreography'

/**
 * A short running line for the court view ("Larkin drives, lays it in. 54-48").
 * Built only from the recorded event and the one before it; the full engine text stays in the play-by-play.
 * The richer play model (format 79) names its actions in the event text; the earlier engine's lines read as before.
 */
export function describePlay(event: MatchEvent, roster: Roster, previous?: MatchEvent): string {
  const name = (id?: string) => id ? roster.get(id)?.name.split(' ').at(-1) ?? 'A player' : 'A player'
  const last = (full?: string) => full?.split(' ').at(-1) ?? 'A player'
  const score = `${event.score.home}-${event.score.away}`
  const who = name(event.playerId)
  const text = event.text
  switch (event.type) {
    case 'pass': {
      const to = name(event.receiverId)
      if (/throws the lob/.test(text)) return `${who} throws the lob to ${to}...`
      if (/kicks it out/.test(text)) return `${who} kicks it out to ${to}.`
      if (/hits the rolling/.test(text)) return `${who} hits ${to} on the roll.`
      if (/popping out/.test(text)) return `${who} finds ${to} popping out.`
      if (/in the post/.test(text)) return `${who} feeds ${to} in the post.`
      if (/extra pass/.test(text)) return `${who} makes the extra pass to ${to}.`
      if (/cuts backdoor/.test(text)) return `${to} cuts backdoor, ${who} finds him.`
      if (/dumps it off/.test(text)) return `${who} dumps it off to ${to}.`
      if (/outlet/.test(text)) return `Outlet pass to ${to}.`
      if (/fast break/.test(text)) return `${who} hits ${to} on the break.`
      if (/coming off a screen/.test(text)) return `${who} finds ${to} off a screen.`
      if (/early offense/.test(text)) return `${who} hits ${to} early.`
      if (/swings it to/.test(text)) return `${who} swings it to ${to}.`
      return `${who} passes to ${to}.`
    }
    case 'drive':
      if (/backs down/.test(text)) return `${who} backs down in the post.`
      if (/drop step/.test(text)) return `${who} spins baseline.`
      if (/faces up/.test(text)) return `${who} faces up.`
      if (/into a hook/.test(text)) return `${who} turns for the hook.`
      if (/defense gets back/.test(text)) return `${who} pushes, the defense is back.`
      if (/fast break/.test(text)) return `${who} on the fast break!`
      if (/against the clock|before the horn/.test(text)) return `${who} races the clock.`
      if (/off the screen for a pull-up/.test(text)) return `${who} comes off the screen.`
      if (/turns the corner/.test(text)) return `${who} turns the corner.`
      if (/steps back/.test(text)) return `${who} steps back.`
      if (/floater/.test(text)) return `${who} stops in the lane.`
      if (/isolates|tying three/.test(text)) return `${who} goes one-on-one.`
      if (/closeout/.test(text)) return `${who} attacks the closeout.`
      if (/pulls up early/.test(text)) return `${who} pulls up early.`
      if (/off the dribble/.test(text)) return `${who} goes one-on-one.`
      if (/attacks the rim/.test(text)) return `${who} attacks the rim.`
      return `${who} drives to the basket.`
    case 'shot': {
      const shot = event.shot
      const blocked = /^(.+?) blocks /.exec(text)
      if (blocked) return `${who} goes up, ${last(blocked[1])} blocks it!`
      const goaltending = /^(.+?) is called for goaltending/.exec(text)
      if (goaltending) return `Goaltending on ${last(goaltending[1])}: ${who}'s basket counts. ${score}`
      const assisted = event.assistPlayerId ? ` (${name(event.assistPlayerId)} assist)` : ''
      const andOne = /through the contact/.test(text) ? ' And one!' : ''
      const made = shot?.made
      const end = made ? `${assisted}.${andOne} ${score}` : '.'
      if (/heaves? from long range|banks in a heave/.test(text)) return made ? `${who} banks in the heave! ${score}` : `${who}'s heave is off.`
      if (/alley-oop/.test(text)) return made ? `Alley-oop, ${who} slams it${end}` : `${who} can't finish the alley-oop.`
      if (/the dunk|'s dunk/.test(text)) return made ? `${who} throws it down${end}` : `${who} misses the dunk.`
      if (/the putback|'s putback/.test(text)) return made ? `${who} puts it back${end}` : `${who} misses the putback.`
      if (/tips it in|tip it in|'s tip-in/.test(text)) return made ? `${who} tips it in${end}` : `${who} can't tip it in.`
      if (/a floater|the floater|'s floater/.test(text)) return made ? `${who} drops the floater${end}` : `${who}'s floater rolls off.`
      if (/hook shot/.test(text)) return made ? `${who} hits the hook${end}` : `${who} misses the hook.`
      if (/catch-and-shoot/.test(text)) return made ? `${who} catches and buries the three${end}` : `${who} misses the ${shot?.contest === 'open' ? 'open ' : ''}three.`
      if (/pull-up three/.test(text)) return made ? `${who} pulls up, hits the three${end}` : `${who} misses the pull-up three.`
      const close = (shot?.distanceM ?? 9) < 2.2
      const drove = previous?.type === 'drive' && previous.playerId === event.playerId && !/post|drop step|faces up|hook/.test(previous.text)
      if (shot?.value === 3) return made ? `${who} hits the three${assisted}. ${score}` : `${who} misses the three.`
      const action = made ? close ? 'lays it in' : 'scores the jumper' : close ? 'misses at the rim' : 'misses the jumper'
      return `${drove ? `${who} drives, ${action}` : `${who} ${action}`}${made ? `${assisted}.${andOne} ${score}` : '.'}`
    }
    case 'free-throw': {
      const made = /\bmakes\b/.test(text)
      const which = /free throw (\d) of (\d)/.exec(text)
      return `${who} ${made ? 'makes' : 'misses'} the free throw${which ? ` (${which[1]} of ${which[2]})` : ''}.${made ? ` ${score}` : ''}`
    }
    case 'foul':
      if (/technical foul/.test(text)) return `Technical foul on ${who}.`
      if (/unsportsmanlike/.test(text)) return `Unsportsmanlike foul on ${who}: two shots and the ball.`
      if (/charge/.test(text)) return `Charge! Offensive foul on ${who}.`
      if (/Illegal screen/.test(text)) return `Illegal screen by ${who}.`
      if (/pushes off/.test(text)) return `Offensive foul on ${who}.`
      if (/intentionally/.test(text)) return `${who} fouls to stop the clock.`
      if (/and one/.test(text)) return `Foul on ${who}: and one!`
      return text
    case 'rebound': return /offensive/.test(text) ? `Offensive rebound, ${who}.` : `${who} grabs the rebound.`
    case 'turnover': {
      const stolen = /^(.+?) steals /.exec(text)
      if (stolen) return /'s pass/.test(text) ? `${last(stolen[1])} picks off the pass!` : `${last(stolen[1])} steals it from ${who}!`
      if (/travels/.test(text)) return `${who} travels.`
      if (/three seconds/.test(text)) return `Three seconds on ${who}.`
      if (/8-second/.test(text)) return '8-second violation: they could not cross halfcourt in time.'
      if (/5-second/.test(text)) return '5-second violation on the throw-in.'
      if (/double dribble/.test(text)) return `Double dribble on ${who}.`
      if (/carrying/.test(text)) return `Carrying on ${who}.`
      if (/Basket interference/.test(text)) return `Basket interference on ${who}: no basket.`
      if (/goes back over halfcourt/.test(text)) return `${who}'s pass goes into the backcourt: violation.`
      if (/backcourt violation/.test(text)) return `Backcourt violation on ${who}.`
      if (/steps on the sideline/.test(text)) return `${who} steps on the sideline.`
      if (/pass sails/.test(text)) return `${who}'s pass sails out of bounds.`
      if (/steps out of bounds/.test(text)) return `${who} steps out of bounds.`
      return `${who} loses it out of bounds.`
    }
    case 'shot-clock': return 'Shot clock violation. Turnover.'
    case 'held-ball': { const arrow = /awards the throw-in to (.+?)\.$/.exec(text)?.[1]; const pair = /^Held ball between (.+?) and (.+?)\./.exec(text); return `Held ball${pair ? ` (${last(pair[1])}, ${last(pair[2])})` : ''}: the arrow gives it to ${arrow ?? 'the other team'}.` }
    case 'substitution': return event.outgoingPlayerId && event.playerId ? `${who} checks in for ${name(event.outgoingPlayerId)}.` : text
    case 'command':
      if (/free-throw line/.test(text)) return `${who} steps to the free-throw line.`
      if (/sets a ball screen/.test(text)) { const screener = /^(.+?) sets a ball screen/.exec(text)![1]; return `${last(screener)} screens for ${who}.` }
      if (/takes the throw-in in the frontcourt/.test(text)) return `${who} takes the throw-in.`
      if (/holds the ball for the last shot/.test(text)) return `${who} holds for the last shot.`
      if (/runs down the clock/.test(text)) return `${who} runs down the clock.`
      if (/half-court offense|brings the ball forward|frontcourt/.test(text)) return `${who} brings it up.`
      if (/Kicked ball/.test(text)) { const team = /\. (.+?) keep the ball/.exec(text)?.[1]; return `Kicked ball on ${who}${team ? `: ${team} keep it` : ''}.` }
      if (/out of bounds: .+ keep the ball/.test(text)) { const team = /: (.+?) keep the ball/.exec(text)?.[1]; const line = /(sideline|baseline) throw-in/.exec(text)?.[1]; return `Out of bounds off ${who}: ${team} ball${line ? `, ${line} throw-in` : ''}.` }
      if (/keep the ball after the unsportsmanlike/.test(text)) return `${/^(.+?) keep the ball/.exec(text)?.[1] ?? 'They'} keep the ball after the free throws.`
      if (/organizes the attack/.test(text)) return `${who} sets up the offense.`
      if (/after the block/.test(text)) return 'Blocked out of bounds: they keep it.'
      return text
    case 'final': return `${text} ${score}`
    case 'period-end': return `${text} ${score}`
    default: return text
  }
}
