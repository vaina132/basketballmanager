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

interface YouthFixtureIdentity {
  id: string;
  seasonNumber: number;
  round: number;
  date: string;
  homeClubId: string;
  awayClubId: string;
}

export interface YouthFixtureFull extends YouthFixtureIdentity {
  /** Frozen at settlement, before subsequent practice or promotion changes. */
  home: Team | null;
  away: Team | null;
  startingConditions: Record<string, number> | null;
  result: YouthFixtureResult | null;
}

/** Historical rival squads can be reconstructed from the retained academy records at this matchday. */
export interface YouthFixtureOutcome extends YouthFixtureIdentity {
  detail: 'outcome';
  home: null;
  away: null;
  startingConditions: null;
  /** Includes every original squad member in order, even when no play took place. */
  playerIds: { home: string[]; away: string[] };
  result: YouthFixtureResult;
}

export type YouthFixture = YouthFixtureFull | YouthFixtureOutcome;

export interface YouthCompetitionSeason {
  seasonNumber: number;
  fromRound: number;
  preparedOn: string;
  supplementalIntakeIds: string[];
  fixtures: YouthFixture[];
}

export interface SeasonYouthCompetition {
  /** `youth-competition-2` (careers starting with youth matches, format 72): youth injuries recur like senior ones (`YOUTH_RECURRENCE_MODEL`). */
  model: 'youth-competition-1' | 'youth-competition-2';
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
