import { useEffect, useRef } from 'react'
import { Icon } from './Icon'
import { LogoCredit, PhotoCredits } from './PhotoCredits'
import './player-photo.css'

/**
 * The one Credits view (owner decision, 22 November 2026): logos and every player photo's author and licence,
 * reachable from the footer of every career page instead of a credit line under each photo.
 */
export function CreditsDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)

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

  return <dialog ref={dialog} id="credits-dialog" className="credits-dialog" aria-labelledby="credits-dialog-title" onCancel={event => { event.preventDefault(); onClose() }}>
    <header className="credits-dialog-heading">
      <h2 id="credits-dialog-title">Credits</h2>
      <button ref={closeButton} id="credits-dialog-close" className="button small" onClick={onClose}><Icon name="close" size={15} />Close</button>
    </header>
    <div className="credits-dialog-body" tabIndex={0} role="region" aria-label="Credits">
      <LogoCredit />
      <PhotoCredits defaultOpen />
    </div>
  </dialog>
}
