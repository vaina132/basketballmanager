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
  /** No sporting tie-break separates these clubs; a completed LNB table uses a deterministic draw. */
  rankingTie?: 'unresolved' | 'draw';
}

/** Opt-in, immutable career rules. Absence preserves the original prototype ranking. */
export type DomesticStandingsRule = 'lnb-2026-1';

export interface CalendarDay {
  date: string;
  /** One-based week from the first Saturday. Several game days can share the same week. */
  week: number;
  fixtureIds: string[];
  /** Weekly processing runs once, independently of whether the manager has a game. */
  closesWeek: boolean;
}
