import { countryFlagCode } from '../data/country-flags'
import { flagUrl } from './flag-urls'

/**
 * A country's real flag (owner feedback, 22 November 2026, evening): an SVG picture from the `country-flag-icons` set
 * for every country the game knows, never an emoji (Windows shows flag emoji as letter pairs such as "HR"). Unknown
 * names render nothing.
 */
export function CountryFlag({ country, decorative = false }: { country: string | null; decorative?: boolean }) {
  const code = countryFlagCode(country)
  const url = code ? flagUrl(code) : null
  if (!url) return null
  return <img className="country-flag" src={url} width={30} height={20} alt={decorative ? '' : `${country} flag`} aria-hidden={decorative || undefined} loading="lazy" decoding="async" draggable={false} data-flag={code!} />
}
