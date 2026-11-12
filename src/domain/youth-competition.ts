import type { SeasonInjury } from './season';
import type { PlayerStats, Team } from './types';

export interface YouthCompetitionAnchor {
  seasonNumber: number;
  round: number;
  date: string;
  ledgerIndex: number;
  contractCount: number;
  negotiationCount: number;
  recruitmentEventCount: number;
  academyIntakeCount: number;
  academyGraduateCount: number;
}

export interface YouthFixtureResult {
  kind: 'played' | 'default' | 'no-contest';
  /** False for an unplayed shortage decision; those results have no player statistics. */
  played: boolean;
  score: { home: number; away: number };
  officialScore: { home: number; away: number };
  winnerClubId: string | null;
  periods: number;
  stats: Record<string, PlayerStats>;
  /** Only diagnoses first suffered in this fixture; earlier episodes remain in earlier results. */
  injuries: SeasonInjury[];
  reason: string | null;
}

export interface YouthFixture {
  id: string;
  seasonNumber: number;
  round: number;
  date: string;
  homeClubId: string;
  awayClubId: string;
  /** Frozen at settlement, before subsequent practice or promotion changes. */
  home: Team | null;
  away: Team | null;
  startingConditions: Record<string, number> | null;
  result: YouthFixtureResult | null;
}

export interface YouthCompetitionSeason {
  seasonNumber: number;
  fromRound: number;
  preparedOn: string;
  supplementalIntakeIds: string[];
  fixtures: YouthFixture[];
}

export interface SeasonYouthCompetition {
  model: 'youth-competition-1';
  enabledSince: YouthCompetitionAnchor | null;
  seasons: YouthCompetitionSeason[];
}

export interface YouthPlayerStatus {
  playerId: string;
  condition: number;
  available: boolean;
  injury: SeasonInjury | null;
  returnOn: string | null;
}
