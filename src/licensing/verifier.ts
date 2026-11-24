import type { LicensedEntitlement } from './entitlement'

/**
 * Checks a licence key (owner decision, 24 November 2026). Only the stub exists for now; the Gumroad check comes when
 * the owner decides to sell (docs/licensing.md, "Gumroad"). The real verifier will call a small server function of our
 * own (for example a Vercel serverless function), which calls Gumroad's licence verify API with the product id, so the
 * decision is not made in the browser alone and the browser never talks to Gumroad directly.
 */
export type VerifyResult =
  | { kind: 'licensed'; entitlement: LicensedEntitlement }
  /** The key is not a valid licence (unknown, refunded, disputed or for another product). */
  | { kind: 'invalid'; message: string }
  /** The check could not run (offline, server down); the player may try again. */
  | { kind: 'unavailable'; message: string }
  /** No licence check exists in this build yet. */
  | { kind: 'not-configured'; message: string }

export interface LicenceVerifier {
  verify(key: string): Promise<VerifyResult>
}

/** The stub: there is no licence check yet, so every key gets "not configured". No network call is made. */
export const notConfiguredVerifier: LicenceVerifier = {
  async verify() {
    return { kind: 'not-configured', message: 'Licence keys cannot be checked in this version of the game yet.' }
  },
}
