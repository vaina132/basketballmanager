import { gameDate } from './career-text'
import { Icon } from './Icon'
import './continue-control.css'

/** A Continue run in progress: the day being processed, what it processes, the days done and the days expected. */
export interface ContinueRunView {
  day: string
  label: string
  /** Days done in this run. */
  steps: number
  /** Days expected until the run's natural stop, done ones included: an estimate (postseason games and offers can add days). */
  total: number
  /** The manager pressed Stop: the run ends after the day in progress. */
  stopping: boolean
}

/**
 * The one Continue control, always at the top right of the top bar (owner request, 16 November 2026: "like in Football
 * Manager"). Idle, it shows the career's day and what today is; during a run the same place holds Stop.
 */
export function ContinueControl({ day, status, busy, run, onContinue, onStop }: { day: string; status: string; busy: boolean; run: ContinueRunView | null; onContinue: () => void; onStop: () => void }) {
  return <div className="continue-control" data-continue-state={run ? run.stopping ? 'stopping' : 'running' : 'idle'}>
    <div className="continue-day"><time dateTime={run?.day ?? day}>{gameDate(run?.day ?? day, true)}</time><span>{run ? run.stopping ? 'Stopping after this day' : 'Continuing…' : status}</span></div>
    {run
      ? <button id="continue-stop" className="button continue-button" onClick={onStop} disabled={run.stopping} aria-describedby="continue-progress-label"><Icon name="pause" size={15} />{run.stopping ? 'Stopping…' : 'Stop'}</button>
      : <button id="continue-career" className="button primary continue-button" onClick={onContinue} disabled={busy} aria-keyshortcuts="Space" title="Continue (Space)">Continue<Icon name="next" size={15} /></button>}
  </div>
}

/** The progress of a run below the top bar: the date ticking, what is processed and a bar of the share done. */
export function ContinueProgress({ run }: { run: ContinueRunView }) {
  const total = Math.max(run.total, run.steps + 1), percent = Math.round(run.steps / total * 100)
  const days = `Day ${run.steps + 1} of ${total}`
  return <div className="continue-progress" data-continue-progress>
    <p id="continue-progress-label" className="continue-progress-text"><time dateTime={run.day}>{gameDate(run.day)}</time><span>{run.label || 'Processing'}</span></p>
    <div className="continue-progress-bar" role="progressbar" aria-labelledby="continue-progress-label" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={days}><span style={{ width: `${percent}%` }} /></div>
    <span className="continue-progress-count">{days}</span>
  </div>
}

interface ShortcutEvent { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; repeat: boolean; defaultPrevented: boolean; target: EventTarget | null }
/** Focus on a field or control keeps Space for that control; a dialog keeps it too. */
const KEEPS_SPACE = 'input, textarea, select, button, a[href], summary, label, video, audio, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="slider"], [role="spinbutton"], [role="option"], [role="tab"], [role="checkbox"], [role="radio"], [role="switch"], [role="menuitem"], [role="textbox"], [role="combobox"], [role="dialog"], [role="alertdialog"], dialog'

/** Space presses Continue when no field or control has focus (AGENTS.md: keyboard access). */
export function isContinueShortcut(event: ShortcutEvent): boolean {
  if (event.key !== ' ' || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.repeat || event.defaultPrevented) return false
  const target = event.target as { closest?: (selector: string) => unknown } | null
  return !(target && typeof target.closest === 'function' && target.closest(KEEPS_SPACE))
}
