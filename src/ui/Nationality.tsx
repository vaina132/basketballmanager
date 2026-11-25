import type { SeasonState } from '../domain/season'
import { countryFlagCode } from '../data/country-flags'
import { staffNationality } from '../data/staff-directory'
import { worldOf } from '../world/career-world'
import { careerPlayerNationality } from '../world/generated-people'
import { CountryFlag } from './CountryFlag'
import { NATIONALITY_SUGGESTIONS } from './nationality-suggestions'

/**
 * Owner feedback (22 November 2026): player nationalities on the profile, the Squad list and transfer search; that
 * evening, real flags everywhere a country shows. The pack's nationality field is free text from the provider; only
 * names of real countries are shown (`src/data/country-flags.ts`), so a club or city name that slipped into the field
 * stays blank, like an unknown nationality.
 */
export function playerNationality(season: SeasonState | null, playerId: string): string | null {
  if (!season) return null
  // Format 105: academy prospects and draft prospects carry their own nationality (`careerPlayerNationality`).
  const country = careerPlayerNationality({ academy: season.academy, ...(season.draft ? { draft: season.draft } : {}), world: worldOf(season) }, playerId)
  return countryFlagCode(country) ? country! : null
}

/** A small flag and, unless compact, the country name; nothing for an unknown country. */
export function Nationality({ country, compact = false }: { country: string | null; compact?: boolean }) {
  if (!country || !countryFlagCode(country)) return null
  return <span className={`nationality${compact ? ' nationality-compact' : ''}`} data-nationality={country} title={compact ? country : undefined}>
    <CountryFlag country={country} decorative />{compact ? <span className="sr-only">{country}</span> : <span>{country}</span>}
  </span>
}

/** A staff member's flag after his name (generated and real staff have a nationality; the authored ones do not). */
export function StaffNationality({ personId }: { personId: string }) {
  return <Nationality country={staffNationality(personId)} compact />
}

const PLACES: ReadonlyMap<string, string> = new Map(NATIONALITY_SUGGESTIONS.map(item => [item.nationality.toLowerCase(), item.place]))

/**
 * The countries of a manager's free-text nationality: a country ("Spain") or a suggestion's nationality ("Spanish"),
 * or several joined by "/", ",", "&" or "+" ("Spanish / Italian"). Words that name no country are left out.
 */
export function managerCountries(nationality: string | null | undefined): string[] {
  const country = (text: string) => { const value = text.trim(); const place = PLACES.get(value.toLowerCase()) ?? value; return countryFlagCode(place) ? place : null }
  if (!nationality?.trim()) return []
  const whole = country(nationality)
  if (whole) return [whole]
  return [...new Set(nationality.split(/[/,;&+]|\band\b/u).map(country).filter((item): item is string => !!item))]
}

/** The manager's flags, decorative beside his written nationality. */
export function ManagerFlags({ nationality }: { nationality: string | null | undefined }) {
  const countries = managerCountries(nationality)
  return countries.length ? <span className="manager-flags" data-manager-flags={countries.join('|')}>{countries.map(country => <CountryFlag key={country} country={country} decorative />)}</span> : null
}
