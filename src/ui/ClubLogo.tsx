import type { CSSProperties } from 'react'
import { badgeMarkup, competitionMarkup } from './club-badge'
import './club-logo.css'

/**
 * Drawn badges replace the real club and competition logos (owner decision, 27 November 2026). Every club, real or
 * fictional, gets a badge in its colour with its short name; competitions get a small emblem with their initials.
 */
type BadgeClub = { id: string; name: string; shortName: string; color?: string }

/** A club's badge inside the existing fixed-size box, so nothing shifts. */
export function ClubBadge({ club, className, style }: { club: BadgeClub | null | undefined; className: string; fallback?: unknown; style?: CSSProperties }) {
  if (!club) return <span className={className} style={style} />
  return <span className={`${className} has-club-logo`} style={style} data-club-badge={club.id}>
    <svg className="club-badge-drawing" viewBox="0 0 100 100" role="img" aria-label={club.name} dangerouslySetInnerHTML={{ __html: badgeMarkup(club.id, club.shortName || club.name, club.color) }} />
  </span>
}

/** A small inline emblem: a competition's initials ring, or a club's badge when its colour and short name are given. */
export function InlineLogo({ kind, id, name, size = 16, decorative = false, club }: { kind: 'club' | 'competition'; id: string | null | undefined; name: string; size?: number; decorative?: boolean; club?: { shortName: string; color?: string } }) {
  if (!id) return null
  const markup = kind === 'competition' ? competitionMarkup(name) : club ? badgeMarkup(id, club.shortName, club.color) : null
  if (!markup) return null
  return <svg className="inline-logo" width={size} height={size} viewBox="0 0 100 100" role={decorative ? undefined : 'img'} aria-hidden={decorative || undefined} aria-label={decorative ? undefined : name} data-logo-kind={kind} dangerouslySetInnerHTML={{ __html: markup }} />
}
