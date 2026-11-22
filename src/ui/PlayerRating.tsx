import type { PlayerKnowledge } from '../domain/scouting';
import type { PlayerAttributes, SkillAttributes, Position } from '../domain/types';
import { ABILITY_RATING_DESCRIPTION, MATCH_RATING_DESCRIPTION, abilityRating, exactAbilityRating, playerMatchRating, playerPIR, type AbilityRating, type PlayerBoxStats } from '../world/performance-rating';
import './player-rating.css';

interface PlayerRatingProps {
  attributes?: PlayerAttributes;
  knowledge?: PlayerKnowledge;
  attribute?: keyof SkillAttributes;
  /** Weights the overall rating by what the position needs; omitted, the five positions count equally. */
  position?: Position | null;
  compact?: boolean;
  label?: string;
  /** The explanation in the tooltip; the overall-ability scale by default (potential passes its own). */
  description?: string;
}

/** Knowledge always wins if a caller also supplies attributes. */
export function PlayerRating({ attributes, knowledge, attribute, position, compact = false, label = 'Ability', description = ABILITY_RATING_DESCRIPTION }: PlayerRatingProps) {
  let rating: AbilityRating = { kind: 'unknown', min: null, max: null, low: null, high: null };
  if (knowledge) rating = abilityRating(knowledge, { position, attribute });
  else if (attributes) rating = exactAbilityRating(attributes, { position, attribute });
  // The number behind the stars: the overall rating (1-99), or the skill (1-20) when one skill is shown.
  const number = rating.kind === 'unknown' ? '?' : rating.kind === 'range' ? `${rating.low}–${rating.high}` : `${rating.low}`;
  const value = attribute || compact ? number : `OVR ${number}`;
  const scale = attribute ? ' out of 20' : '';
  const accessible = rating.kind === 'unknown' ? `${label}: unknown` : rating.kind === 'range'
    ? `${label}: estimated ${attribute ? '' : 'overall '}${rating.low} to ${rating.high}${scale}, ${rating.min} to ${rating.max} out of 5 stars`
    : `${label}: ${attribute ? '' : 'overall '}${rating.low}${scale}, ${rating.min} out of 5 stars`;
  return <span className={`player-rating${compact ? ' player-rating--compact' : ''} player-rating--${rating.kind}`} role="img" aria-label={accessible} title={`${accessible}. ${description}`}>
    <span className="player-rating-stars" aria-hidden="true">{Array.from({ length: 5 }, (_, index) => <span className="player-rating-star" key={index}>
      <span>☆</span>
      {rating.kind === 'range' && <span className="player-rating-star-range" style={{ width: `${Math.max(0, Math.min(1, rating.max! - index)) * 100}%` }}>★</span>}
      <span className="player-rating-star-fill" style={{ width: `${Math.max(0, Math.min(1, (rating.min ?? 0) - index)) * 100}%` }}>★</span>
    </span>)}</span>
    <span className="player-rating-value" aria-hidden="true">{value}</span>
  </span>;
}

/** The tooltip of a live match rating (owner request, 18 November 2026): the rating so far and the box score behind it. */
export function liveMatchRatingSummary(stats: PlayerBoxStats | null | undefined): string {
  const rating = playerMatchRating(stats);
  if (rating === null || !stats) return 'Match rating so far: – (not played yet)';
  return `Match rating so far: ${rating.toFixed(1)} · ${stats.points} pts, ${stats.rebounds} reb, ${stats.assists} ast, ${stats.turnovers} TO · PIR ${playerPIR(stats)}`;
}

interface MatchRatingProps {
  stats?: PlayerBoxStats | null; value?: number | null; compact?: boolean; label?: string
  /** Live: the tooltip shows the rating so far with points, rebounds, assists and turnovers. */
  live?: boolean
  /** Extra class for placement (the court circles use a smaller badge). */
  className?: string
}
export function MatchRating({ stats, value, compact = false, label = 'Match', live = false, className }: MatchRatingProps) {
  const rating = stats === undefined ? value ?? null : playerMatchRating(stats);
  const accessible = rating === null ? `${label}: unrated, no appearance` : `${label}: ${rating.toFixed(1)} out of 10`;
  const tone = rating === null ? 'unrated' : rating >= 7 ? 'good' : rating < 5 ? 'poor' : 'neutral';
  const title = live ? liveMatchRatingSummary(stats) : `${accessible}. ${MATCH_RATING_DESCRIPTION}`;
  return <span className={`match-rating match-rating--${tone}${compact ? ' match-rating--compact' : ''}${className ? ` ${className}` : ''}`} role="img" aria-label={live ? `${label}: ${title.replace(/^Match rating so far: /, 'match rating so far ')}` : accessible} title={title} data-match-rating={rating === null ? 'unrated' : rating.toFixed(1)}>
    <span aria-hidden="true">{rating === null ? (live ? '–' : '—') : rating.toFixed(1)}</span>
  </span>;
}
