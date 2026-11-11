import { useState } from 'react'
import type { AssistantCoach } from '../domain/assistant'
import type { MatchState, Side, Tactics } from '../domain/types'
import { applyAssistantRotation, applyAssistantTactics, getAssistantAdvice } from '../world/assistant-advice'
import { AssistantPortrait } from './AssistantPortrait'
import { Icon } from './Icon'
import './assistant-advice.css'

const instructions: { key: keyof Tactics; label: string }[] = [{ key: 'tempo', label: 'Tempo' }, { key: 'outsideShare', label: 'Outside emphasis' }, { key: 'pressure', label: 'Defensive pressure' }]

export function AssistantAdvice({ coach, match, side, settled, onPrepare, apply }: {
  coach: AssistantCoach
  match: MatchState
  side: Side
  settled: boolean
  onPrepare: () => void
  apply: (action: (state: MatchState) => MatchState) => void
}) {
  const [open, setOpen] = useState(false)
  const complete = match.status === 'finished'
  // Do not inspect a later simulation boundary while an earlier action is animating.
  const advice = open && settled && !complete ? getAssistantAdvice(match, side, coach) : null
  const rotation = advice?.rotation
  const player = (id: string) => match[side].players.find(item => item.id === id)!
  return <div className="assistant-advice" id="assistant-advice" data-assistant-adviser={coach.id}>
    <div className="assistant-advice-heading"><AssistantPortrait coach={coach} size={32} /><div><strong>{coach.name}</strong><span>Assistant coach</span></div><button id="assistant-advice-toggle" className="button small" disabled={complete} aria-expanded={!!advice} aria-controls="assistant-advice-report" onClick={() => {
      if (advice) setOpen(false)
      else { onPrepare(); setOpen(true) }
    }}><Icon name="staff" size={15} />{complete ? 'Match finished' : advice ? 'Close advice' : 'Get advice'}</button></div>
    {advice && <div id="assistant-advice-report" className="assistant-advice-report">
      <div className="assistant-tactical-advice"><div className="assistant-advice-label"><Icon name="target" size={16} /><strong>Suggested instructions</strong></div>
        {advice.tactics ? <><dl>{instructions.map(({ key, label }) => <div key={key}><dt>{label}</dt><dd><span>{Math.round(match.tactics[side][key] * 100)}</span><Icon name="arrow" size={13} /><strong>{Math.round(advice.tactics![key] * 100)}</strong></dd></div>)}</dl><div className="assistant-advice-actions"><button className="button small" id="assistant-apply-tactics" disabled={!advice.tacticsChanged} onClick={() => { onPrepare(); apply(current => applyAssistantTactics(current, side, coach)) }}>{advice.tacticsChanged ? 'Apply instructions' : 'Instructions match'}</button><details><summary>Why these instructions?</summary>{instructions.map(({ key, label }) => <p key={key}><strong>{label}: </strong>{advice.reasons[key]}</p>)}<p>Advice uses your current five. Review it again after a substitution.</p></details></div></> : <p>No eligible players on the floor. Resolve the required replacement first.</p>}
      </div>
      <div className="assistant-rotation-advice"><div className="assistant-advice-label"><Icon name="swap" size={16} /><strong>Rotation</strong></div>
        {rotation ? <><div className="assistant-suggested-change"><span>{player(rotation.outId).name}<small>Off</small></span><Icon name="arrow" size={16} /><span>{player(rotation.inId).name}<small>On</small></span></div><p>{rotation.reason}</p><button className="button small" id="assistant-apply-rotation" onClick={() => { onPrepare(); apply(current => applyAssistantRotation(current, side, coach)) }}>Make change<Icon name="swap" size={14} /></button><small className="assistant-advice-note">Uses your substitution queue and the next legal opportunity.</small></> : <p className="assistant-rotation-note">{advice.rotationNote}</p>}
      </div>
    </div>}
  </div>
}
