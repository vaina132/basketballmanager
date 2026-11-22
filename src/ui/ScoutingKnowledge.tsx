import type { PlayerKnowledge } from '../domain/scouting'
import type { Position } from '../domain/types'
import { SCOUTING_ATTRIBUTES } from '../world/scouting-policy'
import { EXTRA_ATTRIBUTE_LABELS, EXTRA_ATTRIBUTES } from '../world/extra-attributes'
import { POTENTIAL_RATING_DESCRIPTION } from '../world/potential'
import { PlayerRating } from './PlayerRating'
import './scouting-knowledge.css'

const labels = { twoPoint: 'Two-point shot', threePoint: 'Three-point shot', freeThrow: 'Free throws', passing: 'Passing', defense: 'Defense', rebounding: 'Rebounding', stamina: 'Stamina', ...EXTRA_ATTRIBUTE_LABELS }
/** The seven skills, then the five further abilities when the knowledge carries them. */
const shownAttributes = (knowledge: PlayerKnowledge) => [...SCOUTING_ATTRIBUTES, ...EXTRA_ATTRIBUTES.filter(key => knowledge.attributes?.[key] !== undefined || knowledge.ranges?.[key] !== undefined)]
const dates = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
export const scoutingDate = (date: string) => dates.format(new Date(`${date}T00:00:00Z`))

export function knowledgeLabel(knowledge: PlayerKnowledge): string {
  if (knowledge.kind === 'own') return 'Exact · Own squad'
  if (knowledge.kind === 'unknown') return 'Not scouted'
  // Format 78: an estimate from the scouting network, without a report.
  if (knowledge.source === 'network') return 'Scout network estimate'
  return `${knowledge.level === 1 ? 'Initial' : knowledge.level === 2 ? 'Developing' : 'Detailed'} report · ${knowledge.level}/3`
}

/**
 * Only safe knowledge projections enter this component; outsider base attributes are never accepted. `potential` is
 * the hidden potential's projection (`getPotentialKnowledge`), always a range.
 */
export function ScoutingKnowledge({ knowledge, potential, position, compact = false }: { knowledge: PlayerKnowledge; potential?: PlayerKnowledge; position: Position; compact?: boolean }) {
  return <div className={`scouting-knowledge${compact ? ' scouting-knowledge-compact' : ''}`} data-knowledge-kind={knowledge.kind}>
    <div className="scouting-knowledge-overall"><span>Overall ability</span><PlayerRating knowledge={knowledge} position={position} label="Overall ability" /></div>
    {potential && <div className="scouting-knowledge-overall scouting-knowledge-potential" data-potential-kind={potential.kind}><span>Potential</span><PlayerRating knowledge={potential} position={position} label="Potential" description={POTENTIAL_RATING_DESCRIPTION} /></div>}
    <div className="scouting-knowledge-status"><strong>{knowledgeLabel(knowledge)}</strong><span>{knowledge.kind === 'own' ? 'Current squad assessment' : knowledge.kind === 'unknown' ? 'No skill assessment available' : knowledge.source === 'network' ? 'Wide estimate, no report yet' : `${knowledge.freshness === 'recent' ? 'Recent' : knowledge.freshness === 'aging' ? 'Aging' : 'Stale'} · ${knowledge.ageDays} ${knowledge.ageDays === 1 ? 'day' : 'days'} old`}</span></div>
    {knowledge.kind !== 'unknown' && <dl className="scouting-knowledge-ratings">{shownAttributes(knowledge).map(attribute => {
      const exact = knowledge.kind === 'own' ? knowledge.attributes?.[attribute] : undefined
      const range = knowledge.kind === 'report' ? knowledge.ranges?.[attribute] : undefined
      const low = exact ?? range?.min ?? 1, high = exact ?? range?.max ?? 20
      return <div key={attribute}><dt>{labels[attribute]}</dt><dd><span data-scouting-attribute={attribute}>{exact !== undefined ? exact : range ? `${range.min}–${range.max}` : 'Unknown'}</span><span className={`scouting-rating-track${exact !== undefined ? ' scouting-rating-exact' : ''}`} aria-hidden="true"><i style={exact !== undefined ? { left: 0, width: `${high / 20 * 100}%` } : { left: `${(low - 1) / 20 * 100}%`, width: `${(high - low + 1) / 20 * 100}%` }} /></span></dd></div>
    })}</dl>}
    <p className="scouting-knowledge-note">{knowledge.kind === 'own' ? 'Exact current skills on a 1–20 scale. Stamina is a permanent skill, separate from match condition.' : knowledge.kind === 'unknown' ? 'Assign a match observation to build a report. The player must get court time for knowledge to improve.' : knowledge.source === 'network' ? 'An estimate from your scouting network: better scouts estimate closer. Scout him for a sharper report.' : <>{knowledge.source === 'squad' ? 'Based on a former squad assessment from' : 'Last observed on'} {knowledge.observedOn && <time dateTime={knowledge.observedOn}>{scoutingDate(knowledge.observedOn)}</time>}. Skill ranges are estimates on a 1–20 scale; repeated observations narrow them and older reports widen.</>}</p>
  </div>
}
