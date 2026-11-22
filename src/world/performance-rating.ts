import type { PlayerKnowledge } from '../domain/scouting';
import type { ArchivedFixture, SeasonFixture, SeasonState } from '../domain/season';
import type { MatchState, Player, PlayerAttributes, SkillAttributes, PlayerStats, Position, Team } from '../domain/types';
import { getFixtureTeams } from './rosters';
import { overallRating, overallRatingStars } from './overall-rating';
export { OVR_POSITION_WEIGHTS, OVR_SCALE, OVR_STAR_SCALE, overallRating, overallRatingStars } from './overall-rating';

/** Box-score totals also work without the separate current-condition field. */
export type PlayerBoxStats = Omit<PlayerStats, 'condition'>;
export interface AbilityRating {
  kind: 'exact' | 'range' | 'unknown';
  /** Stars from 1 to 5 in half steps. */
  min: number | null;
  max: number | null;
  /** The number behind the stars: the overall rating (1-99), or the skill itself (1-20) for one skill. */
  low: number | null;
  high: number | null;
}
export interface AbilityRatingOptions {
  /** Unknown positions use the average of the five position weightings. */
  position?: Position | null;
  attribute?: keyof SkillAttributes;
}
export interface MatchMvp {
  playerId: string;
  clubId: string;
  player: Player;
  club: Team;
  stats: PlayerBoxStats;
  pir: number;
  rating: number;
}

export const GAME_PIR_DESCRIPTION = 'Game PIR: points + rebounds + assists + steals + blocks − missed field goals − missed free throws − turnovers − personal fouls. Fouls drawn and shots blocked against are not recorded and are omitted.';
export const MATCH_RATING_DESCRIPTION = 'Match rating: 6.0 + game PIR ÷ 10, limited to 1.0–10.0. Live ratings are provisional; players without an appearance are unrated.';
export const ABILITY_RATING_DESCRIPTION = 'Overall rating (1-99): the seven skills weighted by what the player\'s position needs. Stars show it from 1 to 5 in half steps: 85 or more is 5 stars and every 6 points less is half a star less. Scouted ability remains an estimated range.';
const ATTRIBUTE_KEYS: readonly (keyof SkillAttributes)[] = ['twoPoint', 'threePoint', 'freeThrow', 'passing', 'defense', 'rebounding', 'stamina'];
const COUNTING_KEYS: readonly (keyof PlayerBoxStats)[] = [
  'secondsPlayed', 'points', 'fieldGoalsMade', 'fieldGoalsAttempted', 'threePointersMade', 'threePointersAttempted',
  'freeThrowsMade', 'freeThrowsAttempted', 'rebounds', 'assists', 'steals', 'blocks', 'turnovers', 'fouls',
];
const compareText = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

/** Three-point misses are already included in total field-goal misses. */
export function playerPIR(stats: PlayerBoxStats): number {
  return stats.points + stats.rebounds + stats.assists + stats.steals + stats.blocks
    - (stats.fieldGoalsAttempted - stats.fieldGoalsMade)
    - (stats.freeThrowsAttempted - stats.freeThrowsMade) - stats.turnovers - stats.fouls;
}

export function hasPlayerParticipated(stats: PlayerBoxStats | null | undefined): boolean {
  return !!stats && COUNTING_KEYS.some(key => stats[key] !== 0);
}

/** A small sample never receives a per-minute multiplier. */
export function playerMatchRating(stats: PlayerBoxStats | null | undefined): number | null {
  if (!stats || !hasPlayerParticipated(stats)) return null;
  return Math.round(Math.max(1, Math.min(10, 6 + playerPIR(stats) / 10)) * 10) / 10;
}

export function attributeAbilityStars(value: number): number {
  const stars = value / 4;
  return Math.max(1, Math.min(5, Math.round(stars * 2) / 2));
}

export function overallAbilityStars(attributes: PlayerAttributes, position?: Position | null): number {
  return overallRatingStars(overallRating(attributes, position));
}

/** Exact rating from known skills: the overall rating, or one skill when `attribute` is given. */
export function exactAbilityRating(attributes: PlayerAttributes, { position, attribute }: AbilityRatingOptions = {}): AbilityRating {
  const value = attribute ? attributes[attribute] : overallRating(attributes, position);
  const stars = attribute ? attributeAbilityStars(value) : overallRatingStars(value);
  return { kind: 'exact', min: stars, max: stars, low: value, high: value };
}

/** Only the supplied knowledge projection can reveal ability; never consult a player catalog. */
export function abilityRating(knowledge: PlayerKnowledge, options: AbilityRatingOptions = {}): AbilityRating {
  if (knowledge.kind === 'own' && knowledge.attributes) return exactAbilityRating(knowledge.attributes, options);
  if (knowledge.kind === 'report' && knowledge.ranges) {
    const { attribute, position } = options;
    const bound = (side: 'min' | 'max') => Object.fromEntries(ATTRIBUTE_KEYS.map(key => [key, knowledge.ranges![key][side]])) as unknown as PlayerAttributes;
    const low = attribute ? knowledge.ranges[attribute].min : overallRating(bound('min'), position);
    const high = attribute ? knowledge.ranges[attribute].max : overallRating(bound('max'), position);
    const stars = attribute ? attributeAbilityStars : overallRatingStars;
    let min = stars(low), max = stars(high);
    // Rounding may collapse a narrow uncertain range. Keep its uncertainty visible.
    if (min === max) { min = Math.max(1, min - 0.5); max = Math.min(5, max + 0.5); }
    return { kind: 'range', min, max, low, high };
  }
  return { kind: 'unknown', min: null, max: null, low: null, high: null };
}

/** Stable ties: winning club, points, assists, rebounds, fewer turnovers, player ID. */
export function selectMatchMvp(teams: readonly Team[], stats: Readonly<Record<string, PlayerBoxStats>> | null | undefined, winnerClubId: string | null): MatchMvp | null {
  if (!stats) return null;
  const candidates: MatchMvp[] = [];
  for (const club of teams) for (const player of club.players) {
    const line = stats[player.id], rating = playerMatchRating(line);
    if (!line || rating === null) continue;
    candidates.push({ playerId: player.id, clubId: club.id, player, club, stats: line, pir: playerPIR(line), rating });
  }
  return candidates.sort((left, right) => right.pir - left.pir
    || Number(right.clubId === winnerClubId) - Number(left.clubId === winnerClubId)
    || right.stats.points - left.stats.points || right.stats.assists - left.stats.assists
    || right.stats.rebounds - left.stats.rebounds || left.stats.turnovers - right.stats.turnovers
    || compareText(left.playerId, right.playerId) || compareText(left.clubId, right.clubId))[0] ?? null;
}

export function getMatchMvp(match: Pick<MatchState, 'home' | 'away' | 'stats' | 'status' | 'result'>): MatchMvp | null {
  if (match.status !== 'finished' || !match.result) return null;
  return selectMatchMvp([match.home, match.away], match.stats, match[match.result.winner].id);
}

export function getFixtureMvp(season: SeasonState, fixture: SeasonFixture | ArchivedFixture, seasonNumber = season.seasonNumber): MatchMvp | null {
  if (!fixture.result || fixture.result.stats === null) return null;
  const teams = getFixtureTeams(season, fixture, seasonNumber);
  return selectMatchMvp([teams.home, teams.away], fixture.result.stats, fixture.result.winnerClubId);
}
