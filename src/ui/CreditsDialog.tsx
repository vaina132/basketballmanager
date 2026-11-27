import { useEffect, useRef } from 'react'
import { Icon } from './Icon'
import './credits.css'

/** The flag set's MIT licence, which must travel with its pictures (owner feedback, 22 November 2026, evening). */
export function FlagCredit() {
  return <details className="photo-credits" data-credits="flags">
    <summary>Flags: <a href="https://gitlab.com/catamphetamine/country-flag-icons" target="_blank" rel="noreferrer">country-flag-icons</a> by catamphetamine, MIT License</summary>
    <p className="flag-licence">Copyright (c) 2020 @catamphetamine</p>
    <p className="flag-licence">Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the 'Software'), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:</p>
    <p className="flag-licence">The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.</p>
    <p className="flag-licence">THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.</p>
  </details>
}

/**
 * The one Credits view (owner decision, 22 November 2026), reachable from the footer of every career page: the flag
 * licence. Player photos (25 November 2026) and club logos (27 November 2026) were replaced by drawings.
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
      <FlagCredit />
    </div>
  </dialog>
}
