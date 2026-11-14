import { SEASON_SCHEMA_VERSION } from '../domain/season';

/**
 * Integrity fingerprints for local checkpoints that the game fully validates before writing. Kept beside the
 * checkpoint, never inside portable save text, they allow an unchanged checkpoint to skip repeated history replay.
 * Imports always receive the full checks. This checksum detects changed text; it is not authentication against
 * someone deliberately editing both the browser's payload and its checksum.
 *
 * Bump SAVE_CHECKS_VERSION whenever the save checks start refusing something they accepted before (or a release
 * must not trust an earlier release's checkpoints): every existing seal then stops matching, and older checkpoints
 * are checked in full once more.
 */
// Version 1 was produced by an unfinished path that skipped validation before writing. Always re-check those saves.
export const SAVE_CHECKS_VERSION = 2;
const SEAL_PREFIX = `courtside-save-seal|format-${SEASON_SCHEMA_VERSION}|checks-${SAVE_CHECKS_VERSION}|`;
export const SEAL_PATTERN = /^[0-9a-f]{64}$/;

/** Fingerprint fully validated text; unavailable Web Crypto leaves the checkpoint on the strict loading path. */
export async function saveSeal(serialized: string): Promise<string | undefined> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return undefined;
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(SEAL_PREFIX + serialized));
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    // Fingerprinting is optional: crypto restrictions must never prevent a validated save or a strict load.
    return undefined;
  }
}

/** Whether a stored seal matches this validation version and text; crypto failures require full validation. */
export async function sealMatches(serialized: string, seal: unknown): Promise<boolean> {
  return typeof seal === 'string' && SEAL_PATTERN.test(seal) && await saveSeal(serialized) === seal;
}
