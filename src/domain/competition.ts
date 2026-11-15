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
  /** Personal and technical fouls of each side, supplied only for rules that use them (FIP article 62.3). */
  fouls?: { home: number; away: number };
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
 * - `acb-art7-2026`: ACB Normas Internas 2026/2027, articles 6.2 and 7, for the Spanish top division (format 52).
 * - `bbl-art20-2026`: easyCredit BBL Spielordnung 2026/2027, §§ 16 and 20, for the German top division (format 52).
 * - `fip-art62-2026`: FIP Regolamento Esecutivo Gare, articles 60 and 62, for both Italian divisions (format 52).
 */
export type DomesticStandingsRule = 'lnb-2026-1' | 'fiba-2026-d' | 'acb-art7-2026' | 'bbl-art20-2026' | 'fip-art62-2026';

/** The first save format that may carry each rule. Older formats cannot, and migration never adds one. */
export const STANDINGS_RULE_FORMAT: Readonly<Record<DomesticStandingsRule, number>> = Object.freeze({ 'lnb-2026-1': 48, 'fiba-2026-d': 51, 'acb-art7-2026': 52, 'bbl-art20-2026': 52, 'fip-art62-2026': 52 });
/** The format from which new worlds give leagues without a rule of their own the FIBA default. */
const FIBA_DEFAULT_FORMAT = 51;

/** The league's own verified rule, or null when none has been verified yet (new worlds then use the FIBA default). */
export function sourcedStandingsRule(country: string, tier: number): DomesticStandingsRule | null {
  return ({ 'France/1': 'lnb-2026-1', 'France/2': 'lnb-2026-1', 'Spain/1': 'acb-art7-2026', 'Germany/1': 'bbl-art20-2026', 'Italy/1': 'fip-art62-2026', 'Italy/2': 'fip-art62-2026' } as Record<string, DomesticStandingsRule>)[`${country}/${tier}`] ?? null;
}

/** The rule a new world gives a league. */
export function standingsRuleFor(country: string, tier: number): DomesticStandingsRule {
  return sourcedStandingsRule(country, tier) ?? 'fiba-2026-d';
}

/**
 * Rules a saved world may carry for a league of this country and tier: its own rule, or the FIBA default where no
 * rule of its own existed when the world was created (a rule added in a later format leaves earlier worlds on the
 * default). A sourced rule is never applied to another country.
 */
export function standingsRuleAllowed(rule: unknown, country: string, tier: number): rule is DomesticStandingsRule {
  const own = sourcedStandingsRule(country, tier);
  return rule === standingsRuleFor(country, tier) || rule === 'fiba-2026-d' && own !== null && STANDINGS_RULE_FORMAT[own] > FIBA_DEFAULT_FORMAT;
}

export interface CalendarDay {
  date: string;
  /** One-based week from the first Saturday. Several game days can share the same week. */
  week: number;
  fixtureIds: string[];
  /** Weekly processing runs once, independently of whether the manager has a game. */
  closesWeek: boolean;
}
