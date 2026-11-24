/**
 * The player's licence in this browser (owner decision, 24 November 2026). It is kept in the browser's storage, never
 * inside a save file: saves stay shareable between players, and editing a save cannot unlock the game.
 *
 * Limitations (docs/licensing.md): anything in the browser can be changed by a determined player, so this only keeps
 * honest players honest; a licence is per browser (a new browser or cleared site data asks for the key again); while
 * the browser blocks storage the licence lasts only this visit.
 */
export type LicensedEntitlement = { status: 'licensed'; key: string; productId: string; verifiedAt: string }
export type Entitlement = { status: 'unlicensed' } | LicensedEntitlement

export const UNLICENSED: Entitlement = { status: 'unlicensed' }
export const ENTITLEMENT_STORAGE_KEY = 'courtside.licence'

/** The part of `Storage` used here, so tests can pass a storage that fails. */
export type EntitlementStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function browserStorage(): EntitlementStorage | null {
  try { return globalThis.localStorage ?? null } catch { return null }
}

const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200

/** Reads a stored entitlement; anything missing, damaged or unreadable is "unlicensed". */
export function parseEntitlement(raw: string | null | undefined): Entitlement {
  if (!raw) return UNLICENSED
  try {
    const value: unknown = JSON.parse(raw)
    if (value && typeof value === 'object') {
      const entry = value as Record<string, unknown>
      if (entry.status === 'licensed' && text(entry.key) && text(entry.productId) && text(entry.verifiedAt) && !Number.isNaN(Date.parse(entry.verifiedAt))) {
        return { status: 'licensed', key: entry.key, productId: entry.productId, verifiedAt: entry.verifiedAt }
      }
    }
  } catch { /* a damaged entry counts as no licence */ }
  return UNLICENSED
}

/** The entitlement remembered in this browser; "unlicensed" when there is none or storage is blocked. */
export function loadEntitlement(storage: EntitlementStorage | null = browserStorage()): Entitlement {
  try { return parseEntitlement(storage?.getItem(ENTITLEMENT_STORAGE_KEY)) } catch { return UNLICENSED }
}

/** Remembers the entitlement in this browser. False when the browser blocks storage (it then lasts this visit). */
export function saveEntitlement(entitlement: Entitlement, storage: EntitlementStorage | null = browserStorage()): boolean {
  try {
    if (!storage) return false
    if (entitlement.status === 'unlicensed') storage.removeItem(ENTITLEMENT_STORAGE_KEY)
    else storage.setItem(ENTITLEMENT_STORAGE_KEY, JSON.stringify(entitlement))
    return true
  } catch { return false }
}
