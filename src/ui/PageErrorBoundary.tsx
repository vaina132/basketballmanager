import { Component } from 'react'
import type { ReactNode } from 'react'
import { Icon } from './Icon'

/**
 * A page's code file could not be downloaded. Pages open on demand, so this happens when a new version of the game is
 * published while it is open (the old file no longer exists) or when the connection drops (owner feedback, 16 November
 * 2026: Inbox opened an empty black screen right after a new career started).
 */
export function isLoadFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /dynamically imported module|Importing a module script failed|Unable to preload CSS|Failed to load module script/i.test(message)
}

/**
 * A background worker failed before it could answer: its file could not be downloaded or started. The game's workers
 * report every error of their own work as a message, so an error event from the worker itself means its code is
 * missing (a new version went live while the game was open) or the connection dropped. Retrying cannot help.
 */
export function isWorkerLoadFailure(event: Event): boolean {
  const message = typeof ErrorEvent !== 'undefined' && event instanceof ErrorEvent ? event.message : ''
  return !message || isLoadFailure(message) || /Unexpected token '<'|MIME type|NetworkError|Failed to fetch/i.test(message)
}

interface PageErrorProps {
  /** What failed, as the player knows it: a page name, or "This screen". */
  title: string
  error: unknown
  onReload: () => void
  /** In a career the reload saves first; otherwise the player continues from the last save after reloading. */
  savesFirst: boolean
  /** Show the page again (an unexpected error may not repeat). Omitted when only a reload can help. */
  onRetry?: () => void
  /**
   * A failure outside page display, always a download failure: what could not be done ("could not be played") and the
   * part of the game that could not be downloaded ("the part of the game that plays matchdays").
   */
  step?: { failed: string; part: string }
}

/** Says plainly what failed and what to do next; a page that fails to show never changes the career. */
export function PageError({ title, error, onReload, savesFirst, onRetry, step }: PageErrorProps) {
  const download = !!step || isLoadFailure(error)
  const detail = error instanceof Error && error.message ? error.message : String(error)
  const retry = !download && onRetry
  const id = step ? 'step-error-title' : 'page-error-title'
  return <section className="panel page-error" role="alert" aria-labelledby={id} data-page-error={step ? 'worker' : download ? 'download' : 'render'}>
    <h2 id={id}><Icon name="close" size={17} />{title} {step?.failed ?? 'could not be opened'}</h2>
    <p>{download ? `The game could not download ${step?.part ?? 'this page'}. A new version of the game may have been published while it was open, or the internet connection dropped.${step ? ' Trying again cannot help; your career has not changed.' : ''}` : 'Something on this page failed while it was being shown. Nothing in your career was changed.'}</p>
    <p>{savesFirst ? 'Choose Save and reload: your career is saved first, then the game reloads and you continue from that save.' : 'Reload the page. A saved career carries on from its last save: choose Continue saved career.'}{retry ? ' Try again shows this page once more.' : ''}</p>
    <div className="page-error-actions">
      <button type="button" className="button primary" onClick={onReload}><Icon name="restart" size={15} />{savesFirst ? 'Save and reload' : 'Reload page'}</button>
      {retry && <button type="button" className="button" onClick={onRetry}>Try again</button>}
    </div>
    <details className="page-error-detail"><summary>Error details</summary><p>{detail}</p></details>
  </section>
}

interface BoundaryProps extends Omit<PageErrorProps, 'error' | 'onRetry'> {
  children: ReactNode
  /** Centred on its own screen, for failures outside the game's page area. */
  fullScreen?: boolean
  /** Offer Try again (default). The outermost boundary would only start the game afresh, which a reload does better. */
  retry?: boolean
}

/**
 * Keeps a failing page from blanking the whole game: the error is shown in place of the page and the navigation keeps
 * working. Give it a `key` per page so that opening another page starts afresh.
 */
export class PageErrorBoundary extends Component<BoundaryProps, { error: unknown }> {
  state: { error: unknown } = { error: null }
  static getDerivedStateFromError(error: unknown) { return { error: error ?? new Error('Unknown error.') } }
  render() {
    if (this.state.error === null) return this.props.children
    const { title, onReload, savesFirst, fullScreen = false, retry = true } = this.props
    const page = <PageError title={title} error={this.state.error} onReload={onReload} savesFirst={savesFirst} onRetry={retry ? () => this.setState({ error: null }) : undefined} />
    return fullScreen ? <main className="page-error-screen">{page}</main> : page
  }
}
