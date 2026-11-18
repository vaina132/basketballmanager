import { Icon } from './Icon'

/**
 * The career point each save holds ("Matchday 14"), and when the last one finished (null when loaded from a save).
 * Saving is manual (owner, 18 November 2026): `unsaved` says that the career has changed since the last save or load.
 */
export interface SaveProgress {
  /** Whether a checkpoint is being checked or written now. */
  saving: boolean
  /** The newest career point waiting to be saved: the one the queue writes next. */
  pending: string | null
  /** The career point of the last save written or loaded, and the time it finished writing. */
  saved: { label: string; at: number | null } | null
  /** Whether the career open now differs from the last save written or loaded. */
  unsaved?: boolean
}

const clock = (at: number) => new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

/**
 * What closing the game now would cost, in plain words: the browser's own leave warning shows a fixed text, so the
 * save status says it (owner feedback: "Saving..." stayed on in long play without saying how far back a career goes).
 */
export function closeWarning(progress: SaveProgress): string {
  return progress.saved ? `Your career is saved up to ${progress.saved.label}. If you close the game now, it continues from there${progress.pending && progress.saving ? `; ${progress.pending} is still being saved` : ''}.` : 'Your career has not been saved yet. If you close the game now, it is lost.'
}

/** Whether leaving the page now would lose progress: a save is still running, or the career has unsaved changes. */
export function hasUnsavedProgress(progress: SaveProgress): boolean {
  return progress.saving || !!progress.unsaved
}

/** Top bar save status: "Saved 14:32 · Matchday 14", "Unsaved changes since Matchday 14", or "Saving Matchday 16…". */
export function SaveStatus({ progress }: { progress: SaveProgress }) {
  const { saving, pending, saved, unsaved } = progress
  if (!saving && !saved && !unsaved) return null
  if (!saving && unsaved) return <span className="save-status save-status-unsaved" role="status" title={`Saving is manual: press Save to keep your progress. ${closeWarning(progress)}`} data-save-status="unsaved">
    <Icon name="clock" size={13} />
    <span>{saved ? `Unsaved changes since ${saved.label}` : 'Not saved yet'}</span>
  </span>
  const title = saving ? `Each save is fully checked before it is written, so saving can take a minute in long careers. ${closeWarning(progress)}` : `Last save${saved!.at ? ` finished at ${clock(saved!.at)}` : ' loaded'}: ${saved!.label}.`
  return <span className={`save-status${saving ? ' save-status-busy' : ''}`} role="status" title={title} data-save-status={saving ? 'saving' : 'saved'}>
    <Icon name={saving ? 'clock' : 'check'} size={13} />
    {saving ? <span>Saving {pending ?? 'your career'}…</span> : <span>Saved{saved!.at ? ` ${clock(saved!.at)}` : ''} · {saved!.label}</span>}
    {saving && <small>{saved ? `Saved: ${saved.label}` : 'Not saved yet'}</small>}
  </span>
}
