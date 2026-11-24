import type { CareerWorld, WorldContext } from '../domain/world';
import type { PresidentTraits } from '../data/development-presidents';
import { isNbaClub } from './career-world';

/**
 * Format 99 (provisional number; owner decision, 24 November 2026: "fix manager careers"; new careers only, marker
 * `world.careerBalance`, option `careerBalance`). Ten-season automatic careers found that a manager of a mid club who
 * delegates everything was dismissed after his second season in three of four worlds (Spain: a club ranked 9th of 18
 * was asked for 56% wins), and that in a world of the NBA alone a dismissed manager never worked again (NBA jobs ask a
 * reputation of 60-70, while his faded to about 30). Worlds without the marker keep their rules exactly.
 *
 * - Results targets follow the club's squad rank within its league, not its third: about 72% wins for the strongest
 *   squad falling evenly to about 28% for the weakest (64% to 36% in the NBA), less a small margin, so an expected season
 *   meets its target (`balancedWinRate`). The president's ambition moves it a little (`ambitionStep` per point away from 3).
 * - Boards judge results as a share of the games counted (`balancedResultsImpact`): a few wins below the target pace is
 *   Concerned, not a dismissal; a clearly bad season (about five or six wins short in a 34-game season) still is.
 * - Without a club, a good name fades at most `maxFade` points below the reputation the manager left with.
 * - In a world of the NBA alone, the NBA jobs of clubs in the lower half of the league's record ask less of a manager
 *   who has waited without a club: `reliefPoints` every `reliefDays`, down to `reliefFloor` (the level every unemployed
 *   reputation reaches). In worlds with European leagues their jobs remain the way back, so the NBA's stay as they are.
 */
export const CAREER_BALANCE_RULES = Object.freeze({
  /** Expected win share of the strongest and of the weakest squad in a league, linear by squad rank in between. */
  bestRate: 0.72, worstRate: 0.28,
  /**
   * The same for NBA clubs: squad strength separates NBA results less in this game (ten seasons on the live pack, seed 7:
   * the strongest third of NBA squads won 56% of its games and the weakest third 42%; in Spain 64% and 37%).
   */
  nbaBestRate: 0.64, nbaWorstRate: 0.36,
  /** The target sits this far below the expected share, so an average season for the squad meets it. */
  margin: 0.03,
  /** Each point of the president's ambition above or below 3 moves the target by this much, within the bounds. */
  ambitionStep: 0.03, minRate: 0.25, maxRate: 0.72,
  /** Results impact: wins above or below the target pace, as a share of the games counted (at least half the season's games). */
  tolerance: 0.04, pointsPerShare: 250, cap: 30,
  /** Reputation fades at most this many points below the reputation the manager left with. */
  maxFade: 10,
  /** NBA-only worlds: requirement relief for an unemployed manager, every `reliefDays` without a club, and its floor. */
  reliefPoints: 3, reliefDays: 35, reliefFloor: 30,
});

/** Whether a career uses the format-99 board and career balance. */
export const usesCareerBalance = (context: WorldContext | undefined | null): boolean => context?.world?.careerBalance === true;

/** The results target as a win share, from the club's squad rank in its league and its president's ambition (null: no president board). */
export function balancedWinRate(rank: number, clubs: number, traits: Pick<PresidentTraits, 'ambition'> | null, nba = false): number {
  const { margin, ambitionStep, minRate, maxRate } = CAREER_BALANCE_RULES;
  const bestRate = nba ? CAREER_BALANCE_RULES.nbaBestRate : CAREER_BALANCE_RULES.bestRate, worstRate = nba ? CAREER_BALANCE_RULES.nbaWorstRate : CAREER_BALANCE_RULES.worstRate;
  const expected = bestRate - (bestRate - worstRate) * (clubs > 1 ? (rank - 1) / (clubs - 1) : 0.5);
  const rate = expected - margin + (traits ? (traits.ambition - 3) * ambitionStep : 0);
  return Math.round(Math.max(minRate, Math.min(maxRate, rate)) * 100) / 100;
}

/** Assessment points from results: the gap to the target pace as a share of the games counted (at least half the season). */
export function balancedResultsImpact(wins: number, targetPace: number, played: number, games: number): number {
  const { tolerance, pointsPerShare, cap } = CAREER_BALANCE_RULES;
  const share = (wins - targetPace) / Math.max(1, played, Math.ceil(games / 2));
  const beyond = Math.sign(share) * Math.max(0, Math.abs(share) - tolerance);
  return Math.round(Math.max(-cap, Math.min(cap, beyond * pointsPerShare))) || 0;
}

/** The lowest an unemployed manager's good name fades to: the resting level, or `maxFade` below the reputation left with. */
export function fadeFloor(base: number, level: number): number {
  return Math.max(level, base - CAREER_BALANCE_RULES.maxFade);
}

/** A world of the NBA alone: every club of its leagues is an NBA club. */
export function isNbaOnlyWorld(world: CareerWorld | undefined | null): boolean {
  if (!world?.nba || !world.domesticLeagues?.length) return false;
  const lower = (world.lowerDivisions ?? []).flatMap(list => 'clubIds' in list ? list.clubIds : []);
  return lower.length === 0 && world.domesticLeagues.every(league => league.clubIds.every(clubId => isNbaClub(world, clubId)));
}

/**
 * NBA-only worlds with the balance: the requirement of an NBA job open to a manager `days` without a club. Clubs in the
 * lower half of the league's record ask `reliefPoints` less every `reliefDays`, never below `reliefFloor`; others as given.
 */
export function nbaSecondChanceRequirement(requirement: number, leaguePosition: number, leagueClubs: number, days: number): number {
  if (leaguePosition <= leagueClubs / 2) return requirement;
  const { reliefPoints, reliefDays, reliefFloor } = CAREER_BALANCE_RULES;
  const relief = Math.floor(Math.max(0, days) / reliefDays) * reliefPoints;
  return Math.min(requirement, Math.max(reliefFloor, requirement - relief));
}

/** Plain-English additions to the career rules for careers with the balance (format 99), shown after the fade rule. */
export function careerBalanceNote(context: WorldContext | undefined | null): string {
  if (!usesCareerBalance(context)) return '';
  const { maxFade, reliefPoints, reliefDays, reliefFloor } = CAREER_BALANCE_RULES;
  const nba = isNbaOnlyWorld(context?.world) ? ` NBA clubs in the lower half of the league's record ask ${reliefPoints} points less of you every ${reliefDays / 7} weeks without a club, down to ${reliefFloor}.` : '';
  return ` A good name never fades more than ${maxFade} points below the reputation you left with.${nba}`;
}

/** Plain-English results target rule for careers with the balance (format 99). */
export function balancedTargetText(): string {
  const { bestRate, worstRate, nbaBestRate, nbaWorstRate, margin, ambitionStep } = CAREER_BALANCE_RULES;
  const share = (rate: number) => Math.round((rate - margin) * 100);
  return `The target follows the squad's rank in its league: about ${share(bestRate)}% of counted games for the strongest squad, falling evenly to about ${share(worstRate)}% for the weakest (${share(nbaBestRate)}% to ${share(nbaWorstRate)}% in the NBA), moved by ${Math.round(ambitionStep * 100)} points for each point of the president's ambition above or below the middle`;
}

/** Plain-English results review rule for careers with the balance (format 99). */
export function balancedReviewText(): string {
  const { tolerance, pointsPerShare, cap } = CAREER_BALANCE_RULES;
  return `Reviews compare wins with the expected pace as a share of the games counted (at least half the season's games). Within ${Math.round(tolerance * 100)} points of the pace there is no change; beyond it, each percentage point counts ${pointsPerShare / 100} assessment points, capped at ${cap} in either direction.`;
}
