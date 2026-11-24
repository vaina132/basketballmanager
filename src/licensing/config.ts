/**
 * The paid version's switch (owner decision, 24 November 2026): the first half of the first season is free and the rest
 * needs a licence. The infrastructure exists, but it stays OFF while the owner play-tests: with the switch off nothing
 * is ever blocked and the unlock screen never shows. See docs/licensing.md.
 *
 * It is a build-time setting: set `VITE_LICENSING_ENABLED=true` in the build's environment (for example Vercel's
 * project settings) to switch it on. Anything else, or no value, keeps it off.
 */
export const LICENSING_ENABLED: boolean = import.meta.env.VITE_LICENSING_ENABLED === 'true'

const buyUrl: unknown = import.meta.env.VITE_LICENSING_BUY_URL
/** Where the Buy link points once the Gumroad product exists (`VITE_LICENSING_BUY_URL`, https only). Empty: no Buy link yet. */
export const LICENSING_BUY_URL: string = typeof buyUrl === 'string' && buyUrl.startsWith('https://') ? buyUrl : ''
