import { useEffect, useRef } from 'react'
import type { CareerSaveEntry } from '../storage/career-saves'
import { seasonLabel } from '../world/season'
import { Icon } from './Icon'
import './career-save-history.css'

interface CareerSaveHistoryProps {
  entries: CareerSaveEntry[]
  loading: boolean
  error: string | null
  busy: boolean
  onRefresh: () => void
  onRestore: (revision: number) => void
  onClose: () => void
}

const savedDateFormatter = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
const gameDateFormatter = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const sourceLabels: Record<CareerSaveEntry['reason'], string> = {
  manual: 'Manual save',
  'new-game': 'New game',
  matchday: 'Matchday autosave',
  rollover: 'New season autosave',
  recovery: 'Recovery save',
  legacy: 'Previous save',
}

function SavedTime({ value }: { value: string | null }) {
  if (!value || !Number.isFinite(Date.parse(value))) return <span>Time unavailable</span>
  return <time dateTime={value}>{savedDateFormatter.format(new Date(value))}</time>
}

export function CareerSaveHistory({ entries, loading, error, busy, onRefresh, onRestore, onClose }: CareerSaveHistoryProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const latest = [...entries].sort((left, right) => right.revision - left.revision).slice(0, 5)

  useEffect(() => {
    const element = dialog.current!
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (!element.open) element.showModal()
    closeButton.current?.focus({ preventScroll: true })
    return () => {
      element.close()
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
    }
  }, [])

  return <dialog ref={dialog} id="career-save-history" className="career-save-history" aria-labelledby="career-save-history-title" aria-describedby="career-save-history-help" onCancel={event => { event.preventDefault(); onClose() }}>
    <header className="career-save-history-heading">
      <h2 id="career-save-history-title">Save history</h2>
      <div><button className="text-button" onClick={onRefresh} disabled={loading || busy}><Icon name="restart" size={15} />Refresh</button><button ref={closeButton} id="career-save-history-close" className="button small" onClick={onClose}><Icon name="close" size={15} />Close</button></div>
    </header>
    <p id="career-save-history-help" className="career-save-history-help">Keeps the five most recent local season saves. Restoring loads that point; your next save creates a new checkpoint.</p>
    {error && <p className="career-save-history-error" role="alert">{error}</p>}
    {(loading || busy) && <p className="career-save-history-status" role="status">{busy ? 'Restoring saved season…' : 'Loading save history…'}</p>}
    <div className="career-save-history-scroll" tabIndex={0} role="region" aria-label="Local season saves" aria-busy={loading || busy}>
      {latest.length > 0 ? <table className="career-save-history-table">
        <thead><tr><th scope="col">Saved · device time</th><th scope="col">Club / season</th><th scope="col">Game date</th><th scope="col">Source / match</th><th scope="col"><span className="visually-hidden">Restore</span></th></tr></thead>
        <tbody>{latest.map(entry => <tr key={entry.revision} data-save-revision={entry.revision} className={entry.valid ? '' : 'career-save-unreadable'}>
          <th scope="row"><strong>Save {entry.revision}</strong><SavedTime value={entry.savedAt} /></th>
          <td><strong>{entry.clubName}</strong><span>{entry.seasonNumber !== null ? `${seasonLabel(entry.seasonNumber)} · Season ${entry.seasonNumber}` : 'Season unavailable'}</span>{!entry.valid && <p id={`career-save-error-${entry.revision}`} className="career-save-entry-error">Unreadable save{entry.error ? `: ${entry.error}` : ''}</p>}</td>
          <td>{entry.date !== null ? <time dateTime={entry.date}>{gameDateFormatter.format(new Date(`${entry.date}T00:00:00Z`))}</time> : <span>Unavailable</span>}<span>{entry.status === 'complete' ? 'Season complete' : entry.round !== null ? `Matchday ${entry.round}` : 'Matchday unavailable'}</span></td>
          <td><strong>{sourceLabels[entry.reason]}</strong><span>{entry.matchStatus === 'ready' ? 'Pre-match' : entry.matchStatus === 'playing' ? 'Match in progress' : entry.matchStatus === 'finished' ? 'Full time' : 'Match unavailable'}</span></td>
          <td><button className="button small" onClick={() => onRestore(entry.revision)} disabled={!entry.valid || loading || busy} aria-label={`Restore save ${entry.revision}`} aria-describedby={!entry.valid ? `career-save-error-${entry.revision}` : undefined}>Restore</button></td>
        </tr>)}</tbody>
      </table> : !loading && <p className="career-save-history-empty">{error ? 'Save history is unavailable. Refresh to try again.' : 'No local season saves yet.'}</p>}
    </div>
    <p className="career-save-history-note">Saved times use your device’s time zone. Game dates belong to the simulated season.</p>
  </dialog>
}
