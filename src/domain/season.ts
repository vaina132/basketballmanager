import type { MatchResult, MatchState, PlayerStats, Side, Tactics, Team } from './types';

export interface ClubPlan {
  tactics: Tactics;
  lineup: string[];
  autoSubstitutions: boolean;
}

/** Compact completed fixture: no duplicated animation history. */
export interface FixtureResult {
  score: Record<Side, number>;
  officialScore: Record<Side, number>;
  winnerClubId: string;
  kind: MatchResult['kind'];
  periods: number;
  stats: Record<string, PlayerStats>;
}

export interface SeasonFixture {
  id: string;
  round: number;
  date: string;
  homeClubId: string;
  awayClubId: string;
  result: FixtureResult | null;
}

export interface SeasonState {
  schemaVersion: 1;
  engineVersion: 'possession-3';
  dataPackId: 'development-league-1';
  seed: number;
  managedClubId: string;
  date: string;
  status: 'active' | 'complete';
  round: number;
  clubs: readonly Team[];
  plans: Record<string, ClubPlan>;
  conditions: Record<string, number>;
  fixtures: SeasonFixture[];
  activeFixtureId: string;
  activeMatch: MatchState;
}

export interface Standing {
  position: number;
  clubId: string;
  played: number;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  difference: number;
}
