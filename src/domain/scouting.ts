import type { PlayerAttributes } from './types';

export interface ScoutingAssignment { playerId: string; seasonNumber: number; round: number }
export interface SquadObservation {
  playerId: string;
  seasonNumber: number;
  round: number;
  date: string;
  /** The player's registered club at observation, not the observing club. */
  clubId: string;
  rosterId: string;
  attributes: PlayerAttributes;
}
export interface ScoutingReview extends Omit<SquadObservation, 'attributes'> {
  outcome: 'observed' | 'no-minutes';
  attributes: PlayerAttributes | null;
}
export interface ClubScouting {
  delegated: boolean;
  shortlist: string[];
  assignments: ScoutingAssignment[];
  reviews: ScoutingReview[];
  /** Latest exact squad assessment is retained as uncertain memory after departure. */
  squadKnowledge: Record<string, SquadObservation>;
}
export interface SeasonScouting {
  model: 'scouting-1';
  enabledSince: { seasonNumber: number; round: number } | null;
  clubs: Record<string, ClubScouting>;
}
export interface ScoutingRange { min: number; max: number }
export type ScoutingRanges = Record<keyof PlayerAttributes, ScoutingRange>;
/** Safe UI/AI projection: frozen observation ratings never leave this boundary. */
export interface PlayerKnowledge {
  playerId: string;
  kind: 'own' | 'report' | 'unknown';
  level: 0 | 1 | 2 | 3;
  attributes: PlayerAttributes | null;
  ranges: ScoutingRanges | null;
  observedOn: string | null;
  observedClubId: string | null;
  ageDays: number | null;
  freshness: 'current' | 'recent' | 'aging' | 'stale' | 'unknown';
  source: 'squad' | 'observation' | null;
  observations: number;
}
export interface ScoutingAssignmentQuote {
  playerId: string;
  clubId: string;
  canAssign: boolean;
  reason: string | null;
}
