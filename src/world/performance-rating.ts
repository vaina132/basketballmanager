import type { PlayerKnowledge } from '../domain/scouting';
import type { ArchivedFixture, SeasonFixture, SeasonState } from '../domain/season';
import type { MatchState, Player, PlayerAttributes, PlayerStats, Position, Team } from '../domain/types';
import { getFixtureTeams } from './rosters';

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
  attribute?: keyof PlayerAttributes;
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
const ATTRIBUTE_KEYS: readonly (keyof PlayerAttributes)[] = ['twoPoint', 'threePoint', 'freeThrow', 'passing', 'defense', 'rebounding', 'stamina'];
type SkillWeights = Readonly<Record<keyof PlayerAttributes, number>>;
/** What each position needs most; every row sums to 1. Guards lean on passing and shooting, bigs on inside scoring and rebounding. */
export const OVR_POSITION_WEIGHTS: Readonly<Record<Position, SkillWeights>> = {
  PG: { twoPoint: 0.15, threePoint: 0.20, freeThrow: 0.08, passing: 0.27, defense: 0.15, rebounding: 0.05, stamina: 0.10 },
  SG: { twoPoint: 0.18, threePoint: 0.26, freeThrow: 0.10, passing: 0.14, defense: 0.17, rebounding: 0.06, stamina: 0.09 },
  SF: { twoPoint: 0.20, threePoint: 0.20, freeThrow: 0.08, passing: 0.10, defense: 0.18, rebounding: 0.14, stamina: 0.10 },
  PF: { twoPoint: 0.24, threePoint: 0.12, freeThrow: 0.06, passing: 0.08, defense: 0.20, rebounding: 0.22, stamina: 0.08 },
  C: { twoPoint: 0.26, threePoint: 0.04, freeThrow: 0.06, passing: 0.07, defense: 0.22, rebounding: 0.28, stamina: 0.07 },
};
const POSITIONS = Object.keys(OVR_POSITION_WEIGHTS) as Position[];
const BALANCED_WEIGHTS = Object.fromEntries(ATTRIBUTE_KEYS.map(key => [key, mean(POSITIONS.map(position => OVR_POSITION_WEIGHTS[position][key]))])) as SkillWeights;
/** Each point of weighted skill (1-20) is worth 8 rating points: a weighted 12 is 60, a weighted 15 is 84. */
export const OVR_SCALE = { perSkillPoint: 8, offset: -36, min: 1, max: 99 } as const;
/** 85 or more is five stars; every 6 points less is half a star less, down to one star below 43. */
export const OVR_STAR_SCALE = { fiveStars: 85, halfStarStep: 6 } as const;
const COUNTING_KEYS: readonly (keyof PlayerBoxStats)[] = [
  'secondsPlayed', 'points', 'fieldGoalsMade', 'fieldGoalsAttempted', 'threePointersMade', 'threePointersAttempted',
  'freeThrowsMade', 'freeThrowsAttempted', 'rebounds', 'assists', 'steals', 'blocks', 'turnovers', 'fouls',
];
function mean(values: readonly number[]): number { return values.reduce((sum, value) => sum + value, 0) / values.length; }
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

/** Position-weighted overall rating from 1 to 99. Not potential, and not a match prediction. */
export function overallRating(attributes: PlayerAttributes, position?: Position | null): number {
  const weights = position ? OVR_POSITION_WEIGHTS[position] : BALANCED_WEIGHTS;
  const weighted = ATTRIBUTE_KEYS.reduce((sum, key) => sum + weights[key] * attributes[key], 0);
  return Math.max(OVR_SCALE.min, Math.min(OVR_SCALE.max, Math.round(OVR_SCALE.perSkillPoint * weighted + OVR_SCALE.offset)));
}

export function overallRatingStars(ovr: number): number {
  const halfSteps = Math.floor((ovr - OVR_STAR_SCALE.fiveStars) / OVR_STAR_SCALE.halfStarStep) + 8;
  return Math.max(1, Math.min(5, 1 + halfSteps / 2));
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
