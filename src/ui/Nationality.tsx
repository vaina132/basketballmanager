import type { SeasonState } from '../domain/season'
import { worldOf } from '../world/career-world'
import { CountryFlag } from './CountryFlag'

/**
 * Owner feedback (22 November 2026): player nationalities on the profile, the Squad list and transfer search. The
 * pack's nationality field is free text from the provider; only names of real countries listed here are shown, so a
 * club or city name that slipped into the field stays blank, like an unknown nationality.
 */
const COUNTRY_CODES: Readonly<Record<string, string>> = {
  Albania: 'AL', 'Antigua and Barbuda': 'AG', Angola: 'AO', Argentina: 'AR', Armenia: 'AM', Australia: 'AU', Austria: 'AT', Azerbaijan: 'AZ',
  Bahamas: 'BS', Belarus: 'BY', Belgium: 'BE', Benin: 'BJ', 'Bosnia and Herzegovina': 'BA', Brazil: 'BR', 'British Virgin Islands': 'VG', Bulgaria: 'BG',
  Cameroon: 'CM', Canada: 'CA', 'Cape Verde': 'CV', 'Central African Republic': 'CF', Chad: 'TD', Chile: 'CL', China: 'CN', Colombia: 'CO', Congo: 'CG',
  Croatia: 'HR', Cuba: 'CU', Cyprus: 'CY', 'Czech Republic': 'CZ', Czechia: 'CZ', Denmark: 'DK', 'Dominican Republic': 'DO', 'DR Congo': 'CD',
  Egypt: 'EG', England: 'GB', Estonia: 'EE', Finland: 'FI', France: 'FR', Gabon: 'GA', Gambia: 'GM', Georgia: 'GE', Germany: 'DE', Ghana: 'GH',
  Greece: 'GR', Guinea: 'GN', Haiti: 'HT', Hungary: 'HU', Iceland: 'IS', Iran: 'IR', Ireland: 'IE', Israel: 'IL', Italy: 'IT', 'Ivory Coast': 'CI',
  Jamaica: 'JM', Japan: 'JP', Jordan: 'JO', Kazakhstan: 'KZ', Kosovo: 'XK', Latvia: 'LV', Lebanon: 'LB', Lithuania: 'LT', Luxembourg: 'LU', Mali: 'ML',
  Mexico: 'MX', Moldova: 'MD', Montenegro: 'ME', Morocco: 'MA', Netherlands: 'NL', 'New Zealand': 'NZ', Nigeria: 'NG', 'North Macedonia': 'MK',
  Norway: 'NO', Panama: 'PA', Philippines: 'PH', Poland: 'PL', Portugal: 'PT', 'Puerto Rico': 'PR', 'Republic of the Congo': 'CG', Romania: 'RO',
  Russia: 'RU', Scotland: 'GB', Senegal: 'SN', Serbia: 'RS', Slovakia: 'SK', Slovenia: 'SI', 'South Africa': 'ZA', 'South Korea': 'KR',
  'South Sudan': 'SS', Spain: 'ES', Sweden: 'SE', Switzerland: 'CH', Thailand: 'TH', 'Trinidad and Tobago': 'TT', Tunisia: 'TN', Turkey: 'TR',
  Türkiye: 'TR', Uganda: 'UG', Ukraine: 'UA', 'United Kingdom': 'GB', Uruguay: 'UY', USA: 'US', 'United States': 'US', Venezuela: 'VE', Wales: 'GB',
  Zimbabwe: 'ZW',
}

/** The player's nationality as a known country name, or null when unknown (older careers kept no nationality). */
export function playerNationality(season: SeasonState | null, playerId: string): string | null {
  if (!season) return null
  const profiles = worldOf(season).playerProfiles
  const country = Object.hasOwn(profiles, playerId) ? profiles[playerId]!.nationality : undefined
  return country && Object.hasOwn(COUNTRY_CODES, country) ? country : null
}

function flagEmoji(code: string): string {
  return code === 'XK' ? '🇽🇰' : String.fromCodePoint(...[...code].map(letter => 0x1f1e6 + letter.charCodeAt(0) - 65))
}

/** A small flag (drawn for the six league countries, an emoji otherwise) and, unless compact, the country name. */
export function Nationality({ country, compact = false }: { country: string | null; compact?: boolean }) {
  if (!country) return null
  const drawn = CountryFlag({ country, decorative: true })
  const flag = drawn ?? <span className="nationality-emoji" aria-hidden="true">{flagEmoji(COUNTRY_CODES[country]!)}</span>
  return <span className={`nationality${compact ? ' nationality-compact' : ''}`} data-nationality={country} title={compact ? country : undefined}>
    {flag}{compact ? <span className="sr-only">{country}</span> : <span>{country}</span>}
  </span>
}
