import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { FreePlayLimit, LicensedEntitlement, LicenceVerifier } from '../licensing'
import { Icon } from './Icon'
import './unlock-game.css'

/** What the free part covered, in one sentence. */
export function freePartText(limit: FreePlayLimit | null): string {
  if (!limit) return 'You have played the free part of the game: the first half of your first season.'
  const games = `${limit.played} of ${limit.total} regular-season games`
  return `You have played the free part of the game: the first half of your first season (${games}${limit.basis === 'world' ? ' in the world' : ''}).`
}

/**
 * The "Unlock the full game" screen (owner decision, 24 November 2026). It opens only when licensing is switched on and
 * Continue is refused (`canAdvance`); with the switch off it is never shown. Saving, loading and every page stay usable:
 * the screen closes, and the career continues from the same day once a licence key is accepted.
 */
export function UnlockGame({ limit, verifier, buyUrl, busy, onUnlocked, onSave, onClose }: {
  limit: FreePlayLimit | null
  verifier: LicenceVerifier
  /** The shop page; empty while the game is not on sale yet. */
  buyUrl: string
  busy: boolean
  onUnlocked: (entitlement: LicensedEntitlement) => void
  onSave: () => void
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [key, setKey] = useState('')
  const [checking, setChecking] = useState(false)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)

  useEffect(() => {
    const element = dialog.current!
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (!element.open) element.showModal()
    input.current?.focus({ preventScroll: true })
    return () => {
      element.close()
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
    }
  }, [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    const entered = key.trim()
    if (!entered || checking) return
    setChecking(true); setMessage(null)
    try {
      const result = await verifier.verify(entered)
      if (result.kind === 'licensed') { onUnlocked(result.entitlement); return }
      setMessage({ text: result.message, error: true })
    } catch {
      setMessage({ text: 'The licence key could not be checked. Try again in a moment.', error: true })
    } finally { setChecking(false) }
  }

  return <dialog ref={dialog} id="unlock-game" className="unlock-dialog" aria-labelledby="unlock-game-title" aria-describedby="unlock-game-summary" onCancel={event => { event.preventDefault(); onClose() }}>
    <header className="unlock-dialog-heading">
      <h2 id="unlock-game-title"><Icon name="star" size={16} />Unlock the full game</h2>
      <button id="unlock-game-close" className="button small" onClick={onClose}><Icon name="close" size={15} />Close</button>
    </header>
    <div className="unlock-dialog-body">
      <p id="unlock-game-summary">{freePartText(limit)} A licence unlocks the rest of the season and every season after it.</p>
      <p className="unlock-kept" data-unlock-kept><Icon name="save" size={15} />Your career is kept. Save it now; it continues from this day once the game is unlocked. Saving, loading and every page stay open.</p>
      <form className="unlock-form" onSubmit={event => { void submit(event) }}>
        <label htmlFor="unlock-game-key">Licence key</label>
        <div className="unlock-form-row">
          <input ref={input} id="unlock-game-key" name="licence-key" type="text" autoComplete="off" spellCheck={false} value={key} onChange={event => setKey(event.target.value)} disabled={checking} placeholder="XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX" />
          <button id="unlock-game-submit" className="button primary" type="submit" disabled={checking || !key.trim()}>{checking ? 'Checking…' : 'Unlock'}</button>
        </div>
        {message && <p className={message.error ? 'unlock-message unlock-message-error' : 'unlock-message'} role={message.error ? 'alert' : 'status'}>{message.text}</p>}
      </form>
      <div className="unlock-actions">
        {buyUrl
          ? <a id="unlock-game-buy" className="button" href={buyUrl} target="_blank" rel="noreferrer"><Icon name="wallet" size={15} />Buy a licence</a>
          : <span className="unlock-no-shop" data-unlock-no-shop>Licences are not on sale yet.</span>}
        <button id="unlock-game-save" className="button" onClick={onSave} disabled={busy}><Icon name="save" size={15} />Save career</button>
      </div>
    </div>
  </dialog>
}
