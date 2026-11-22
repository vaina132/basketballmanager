import type { CSSProperties, ReactNode } from 'react'
import { REAL_CLUB_LOGOS, REAL_COMPETITION_LOGOS } from '../data/real-logos'
import './club-logo.css'

/**
 * Real club and competition logos (API-Sports; owner decision, 22 November 2026). Only real-pack clubs
 * and competitions have entries, so fictional worlds and clubs without a logo keep the plain badge.
 */
export const clubLogoUrl = (clubId: string | null | undefined): string | null => clubId && Object.hasOwn(REAL_CLUB_LOGOS, clubId) ? `/logos/clubs/${REAL_CLUB_LOGOS[clubId]}` : null
export const competitionLogoUrl = (competitionId: string | null | undefined): string | null => competitionId && Object.hasOwn(REAL_COMPETITION_LOGOS, competitionId) ? `/logos/competitions/${REAL_COMPETITION_LOGOS[competitionId]}` : null

type BadgeClub = { id: string; name: string; shortName: string; color?: string }

/**
 * A club's badge box: the real logo inside the existing fixed-size box when one exists, otherwise the
 * coloured short name (the badge used before logos). The box keeps its size either way, so nothing shifts.
 */
export function ClubBadge({ club, className, fallback, style }: { club: BadgeClub | null | undefined; className: string; fallback?: ReactNode; style?: CSSProperties }) {
  const logo = clubLogoUrl(club?.id)
  if (club && logo) return <span className={`${className} has-club-logo`} style={style} data-club-logo={club.id}><img className="club-logo-image" src={logo} alt={club.name} width={96} height={96} loading="lazy" decoding="async" /></span>
  return <span className={className} style={{ color: club?.color, ...style }}>{fallback ?? club?.shortName}</span>
}

/** A small inline logo for a club or competition; renders nothing when there is none. */
export function InlineLogo({ kind, id, name, size = 16 }: { kind: 'club' | 'competition'; id: string | null | undefined; name: string; size?: number }) {
  const logo = kind === 'club' ? clubLogoUrl(id) : competitionLogoUrl(id)
  return logo ? <img className="inline-logo" src={logo} alt={name} width={size} height={size} loading="lazy" decoding="async" data-logo-kind={kind} /> : null
}
