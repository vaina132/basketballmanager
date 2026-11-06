import { useMemo } from 'react'
import type { MatchState } from '../domain/types'

/** Match feedback follows the displayed action boundary, never a future shot. */
export function ShotCreation({ match }: { match: MatchState }) {
  const totals = useMemo(() => {
    const events = match.events.filter(event => event.side === 'home')
    const shots = events.filter(event => event.type === 'shot' && event.shot)
    return {
      passes: events.filter(event => event.type === 'pass').length,
      drives: events.filter(event => event.type === 'drive').length,
      attempts: shots.length,
      open: shots.filter(event => event.shot?.contest === 'open').length,
      contested: shots.filter(event => event.shot?.contest === 'contested').length,
      threes: shots.filter(event => event.shot?.value === 3).length,
    }
  }, [match.events])
  if (match.engineVersion !== 'possession-3') return null

  return <section className="shot-creation" aria-label="Your shot creation">
    <div className="shot-creation-heading"><h3>Shot creation</h3><span>{match.home.shortName} / Current match</span></div>
    <dl>
      <div><dt>Completed passes</dt><dd data-creation="passes">{totals.passes}</dd></div>
      <div><dt>Drives</dt><dd data-creation="drives">{totals.drives}</dd></div>
      <div><dt>Open attempts</dt><dd data-creation="open">{totals.open}<small> / {totals.attempts}</small></dd></div>
      <div><dt>Contested attempts</dt><dd data-creation="contested">{totals.contested}<small> / {totals.attempts}</small></dd></div>
      <div><dt>Three-point attempts</dt><dd data-creation="threes">{totals.threes}<small> / {totals.attempts}</small></dd></div>
    </dl>
  </section>
}
