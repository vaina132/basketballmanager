/**
 * Automatic recovery when a page file is missing after a new version of the game goes live (owner, 23 November 2026:
 * no paid skew protection; make the existing Save and reload automatic instead). The career is saved through the same
 * path as the Save and reload button, then the game reloads once and loads the new version's files.
 *
 * Loop guard: the time of the automatic reload is kept in sessionStorage (it survives the reload, per tab). A second
 * failure within GUARD_MS of it does not reload again: the page shows the usual Save and reload message instead. If
 * sessionStorage cannot be read or written, the guard cannot work, so nothing reloads by itself either.
 */
export const RELOAD_GUARD_KEY = 'basketball-manager:new-version-reload'
export const GUARD_MS = 2 * 60 * 1000

export interface ReloadDeps {
  storage: () => Storage | null
  reload: () => void
  now: () => number
}

const browserDeps: ReloadDeps = {
  storage: () => (typeof window !== 'undefined' ? window.sessionStorage : null),
  reload: () => window.location.reload(),
  now: () => Date.now(),
}

let pending: Promise<boolean> | null = null

/** True while an automatic reload may still happen: no earlier one in this tab within the guard time. */
export function autoReloadAllowed(deps: ReloadDeps = browserDeps): boolean {
  try {
    const storage = deps.storage()
    if (!storage) return false
    const last = Number(storage.getItem(RELOAD_GUARD_KEY))
    return !(Number.isFinite(last) && last > 0 && deps.now() - last < GUARD_MS)
  } catch { return false }
}

/**
 * Saves (via `save`, which returns false when the career could not be saved) and reloads once. Resolves true when the
 * reload was started, false when the caller should show the Save and reload message instead. Calls made while one is
 * already under way share it, so the career is saved once.
 */
export function reloadForNewVersion(save: () => Promise<boolean>, deps: ReloadDeps = browserDeps): Promise<boolean> {
  if (pending) return pending
  if (!autoReloadAllowed(deps)) return Promise.resolve(false)
  pending = (async () => {
    try {
      if (!await save()) return false
      deps.storage()!.setItem(RELOAD_GUARD_KEY, String(deps.now()))
      deps.reload()
      return true
    } catch { return false }
  })()
  const current = pending
  // A reload that failed to start (or was refused) lets a later failure try again within the guard rules.
  void current.then(started => { if (!started && pending === current) pending = null })
  return current
}

/**
 * Vite fires `vite:preloadError` on window when a page file or its styles cannot be downloaded. The event is left
 * alone so that the failed import still reaches the page's error boundary, which shows the message if no reload starts.
 */
export function listenForMissingPageFiles(target: EventTarget, save: () => Promise<boolean>, deps: ReloadDeps = browserDeps): () => void {
  const handle = () => { void reloadForNewVersion(save, deps) }
  target.addEventListener('vite:preloadError', handle)
  return () => target.removeEventListener('vite:preloadError', handle)
}

/** For tests: forget a reload under way (a real one ends with the page reloading). */
export function resetNewVersionReload() { pending = null }
