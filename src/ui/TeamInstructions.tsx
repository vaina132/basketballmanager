import type { MatchState, Side, Tactics } from '../domain/types'
import { setAutoSubstitutions, setTactics } from '../engine/match'
import { Icon } from './Icon'
import { automaticChoiceLabels } from './automatic-choice'

type Apply = (action: (state: MatchState) => MatchState) => void

interface TeamInstructionsProps {
  match: MatchState
  managedSide?: Side
  apply: Apply
  idPrefix?: string
  includeRotation?: boolean
  /** The hired assistant coach's name; without one, automatic rotation is labelled as the manager's own rules. */
  assistantName?: string
}

const instructions: { key: keyof Tactics; id: string; label: string; low: string; high: string }[] = [
  { key: 'tempo', id: 'tempo', label: 'Tempo', low: 'Patient', high: 'Fast' },
  { key: 'outsideShare', id: 'outside-emphasis', label: 'Outside emphasis', low: 'Inside', high: 'Perimeter' },
  { key: 'pressure', id: 'defensive-pressure', label: 'Defensive pressure', low: 'Contain', high: 'Aggressive' },
]

export function TeamInstructions({ match, managedSide = 'home', apply, idPrefix = '', includeRotation = false, assistantName }: TeamInstructionsProps) {
  const disabled = match.status === 'finished'
  const automatic = match.autoSubstitutions[managedSide]
  const labels = automaticChoiceLabels(assistantName)
  const rotation = automatic ? labels.policy : 'Manual'

  function changeTactic(key: keyof Tactics, value: number) {
    apply(state => state.tactics[managedSide][key] === value ? state : setTactics(state, managedSide, { [key]: value }))
  }

  return <div className="team-instructions">
    {instructions.map(({ key, id, label, low, high }) => {
      const value = Math.round(match.tactics[managedSide][key] * 100)
      const description = value < 34 ? low : value > 66 ? high : 'Balanced'
      const controlId = `${idPrefix}${id}`
      return <div className="tactic" key={key}>
        <div className="tactic-heading"><label className="instruction-icon-label" htmlFor={controlId}><Icon name={key === 'tempo' ? 'clock' : key === 'pressure' ? 'shield' : 'target'} size={16} />{label}</label><span className="instruction-value">{value}<small>{description}</small></span></div>
        <input id={controlId} type="range" min={0} max={100} step={5} value={value} aria-valuetext={`${value} of 100, ${description}`} onChange={event => changeTactic(key, Number(event.target.value) / 100)} disabled={disabled} />
        <div className="range-labels"><span>{low}</span><span>{high}</span></div>
      </div>
    })}
    {includeRotation && <div className="tactic tactic-rotation">
      <div className="tactic-heading"><label htmlFor={`${idPrefix}rotation-control`}>Rotation control</label><span className="instruction-value" data-rotation-policy={rotation}>{rotation}</span></div>
      <input id={`${idPrefix}rotation-control`} type="range" min={0} max={1} step={1} value={automatic ? 1 : 0} aria-valuetext={rotation} aria-describedby={`${idPrefix}rotation-hint`} onChange={event => {
        const enabled = event.target.value === '1'
        apply(state => state.autoSubstitutions[managedSide] === enabled ? state : setAutoSubstitutions(state, managedSide, enabled))
      }} disabled={disabled} />
      <div className="range-labels"><span>Manual</span><span>{labels.policy}</span></div>
      <p className="coach-help rotation-hint" id={`${idPrefix}rotation-hint`}>{labels.hint}</p>
    </div>}
  </div>
}
