/** Calendar and competition identities are separate from employment and weekly club accounting. */
export type CompetitionStage = 'qualifying' | 'regular' | 'play-in' | 'round-of-16' | 'quarter-final' | 'semi-final' | 'third-place' | 'final' | 'play-out';

export interface CompetitionGame {
  id: string;
  competitionId: string;
  stage: CompetitionStage;
  /** The round inside this stage, never the global calendar cursor or an accounting period. */
  stageRound: number;
  groupId: string | null;
  seriesId: string | null;
  date: string;
  homeClubId: string;
  awayClubId: string;
  neutral: boolean;
}

export interface CompetitionGameResult {
  fixtureId: string;
  /** Official scores, including a played/default distinction supplied by the match engine. */
  home: number;
  away: number;
  winnerClubId: string;
}

export interface CompetitionSeries {
  id: string;
  competitionId: string;
  stage: Exclude<CompetitionStage, 'regular'>;
  higherSeedId: string;
  lowerSeedId: string;
  /** Hosts in game order; null is a neutral venue, not an unknown participant. */
  hosts: readonly ('higher' | 'lower' | 'neutral')[];
  dates: readonly string[];
  winsRequired: number;
}

export interface CompetitionTableRow {
  clubId: string;
  played: number;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  position: number;
  /** No sporting tie-break separates these clubs; a completed table under a sourced rule uses a deterministic draw. */
  rankingTie?: 'unresolved' | 'draw';
}

/**
 * Opt-in, immutable career rules. Absence preserves the original prototype ranking.
 * - `lnb-2026-1`: LNB article 205 for the French top and second divisions (format 48).
 * - `fiba-2026-d`: FIBA Official Basketball Rules 2026, Appendix D, the labelled default for every other league
 *   without a verified rule of its own (format 51).
 */
export type DomesticStandingsRule = 'lnb-2026-1' | 'fiba-2026-d';

/** The first save format that may carry each rule. Older formats cannot, and migration never adds one. */
export const STANDINGS_RULE_FORMAT: Readonly<Record<DomesticStandingsRule, number>> = Object.freeze({ 'lnb-2026-1': 48, 'fiba-2026-d': 51 });

/** The league's own verified rule, or null when none has been verified yet (new worlds then use the FIBA default). */
export function sourcedStandingsRule(country: string, tier: number): DomesticStandingsRule | null {
  return country === 'France' && (tier === 1 || tier === 2) ? 'lnb-2026-1' : null;
}

/** The rule a new world gives a league. */
export function standingsRuleFor(country: string, tier: number): DomesticStandingsRule {
  return sourcedStandingsRule(country, tier) ?? 'fiba-2026-d';
}

/**
 * Rules a saved world may carry for a league of this country and tier: its own rule, or the FIBA default where no
 * rule of its own was verified when the world was created. A sourced rule is never applied to another country.
 */
export function standingsRuleAllowed(rule: unknown, country: string, tier: number): rule is DomesticStandingsRule {
  return rule === standingsRuleFor(country, tier);
}

export interface CalendarDay {
  date: string;
  /** One-based week from the first Saturday. Several game days can share the same week. */
  week: number;
  fixtureIds: string[];
  /** Weekly processing runs once, independently of whether the manager has a game. */
  closesWeek: boolean;
}
