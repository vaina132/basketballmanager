/**
 * Moves focus to an element after an action re-renders the page. Actions that write a checkpoint make the main
 * region inert while saving, and a focus call during that time is ignored; this keeps trying until the target
 * exists outside any inert region. It gives up if the person has meanwhile focused something else.
 */
export function focusWhenReady(selector: string, timeoutMs = 5000): void {
  const started = performance.now()
  const attempt = () => {
    const current = document.activeElement
    const free = !current || current === document.body || !current.isConnected || !!current.closest('[inert]')
    const target = document.querySelector<HTMLElement>(selector)
    // A target that still holds focus inside an inert region loses it when the browser applies the inert state.
    if (target && !target.closest('[inert]')) {
      if (current === target) return
      if (!free) return
      target.focus({ preventScroll: true })
      if (document.activeElement === target) return
    }
    if (performance.now() - started < timeoutMs) requestAnimationFrame(attempt)
  }
  requestAnimationFrame(attempt)
}
