/**
 * The flag pictures (`country-flag-icons`, MIT, 3:2 SVGs). Each flag is its own small file, fetched only when a screen
 * shows it, so the game's code stays small; none is inlined into the bundle (`vite.config.ts`).
 */
const FILES = import.meta.glob<string>('./*.svg', { base: '../../node_modules/country-flag-icons/3x2/', query: '?url', import: 'default', eager: true })
const URLS: ReadonlyMap<string, string> = new Map(Object.entries(FILES).map(([path, url]) => [path.slice(2, -4), url]))

/** The picture of a flag code (`src/data/country-flags.ts`), or null when the flag set has none. */
export function flagUrl(code: string): string | null {
  return URLS.get(code) ?? null
}
