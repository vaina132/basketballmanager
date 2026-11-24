import { LICENSING_ENABLED } from './config'
import type { Entitlement } from './entitlement'
import { freePlayLimit, isPastFreeLimit, type FreeLimitState, type FreePlayLimit } from './free-limit'

export type AdvanceCheck = { allowed: true } | { allowed: false; reason: 'free-limit'; limit: FreePlayLimit | null }

/**
 * The one place where moving the career on (Continue) is checked against the licence (owner decision, 24 November
 * 2026). With licensing off it always allows. With it on, a career past the free part (`isPastFreeLimit`) needs a
 * licence. Saving, loading and looking around are never checked. `enabled` exists for tests.
 */
export function canAdvance(state: FreeLimitState, entitlement: Entitlement, enabled: boolean = LICENSING_ENABLED): AdvanceCheck {
  if (!enabled || entitlement.status === 'licensed' || !isPastFreeLimit(state)) return { allowed: true }
  return { allowed: false, reason: 'free-limit', limit: freePlayLimit(state) }
}
