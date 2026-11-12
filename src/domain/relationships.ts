import type { Player } from './types';

export type SquadRole = 'development' | 'rotation' | 'starter';
export type RelationshipTalk = 'explain' | 'minutes-promise';
export interface RelationshipAnchor {
  seasonNumber: number;
  round: number;
  date: string;
  /** Completed senior matchdays across the career: year one round ten = 10. */
  completedRounds: number;
  contractCount: number;
  /** Prefix of this season's immutable registration snapshots. */
  rosterCount: number;
}
export type RelationshipEvent = RelationshipAnchor & { id: string } & (
  | { type: 'role'; clubId: string; playerId: string; role: SquadRole }
  | { type: 'talk'; clubId: string; playerId: string; choice: RelationshipTalk }
  | { type: 'prepare'; rosterIds: Record<string, string>; values: Record<string, number> }
);
export interface SeasonRelationships {
  model: 'relationships-1';
  enabledSince: RelationshipAnchor | null;
  events: RelationshipEvent[];
}
export interface PlayingTimePromise {
  id: string;
  status: 'active' | 'kept' | 'broken' | 'unresolved' | 'departed';
  targetMinutes: number;
  eligibleGames: number;
  averageMinutes: number | null;
  remainingGames: number;
  remainingClubGames: number;
  deadlineDate: string;
  deadlineRound: number;
  outcomeDate: string | null;
  fixtureIds: string[];
}
export interface PlayerRelationship {
  player: Player;
  clubId: string;
  role: SquadRole;
  roleLabel: string;
  minMinutes: number;
  maxMinutes: number;
  morale: number;
  trust: number;
  moraleLabel: string;
  eligibleGames: number;
  averageMinutes: number | null;
  evidenceFixtureIds: string[];
  concern: string | null;
  reasons: { label: string; impact: number }[];
  promise: PlayingTimePromise | null;
  promises: PlayingTimePromise[];
  history: { id: string; date: string; label: string; detail: string }[];
  canTalk: boolean;
  talkReason: string | null;
}
export interface RoleAgreementQuote {
  role: SquadRole;
  roleLabel: string;
  minMinutes: number;
  maxMinutes: number;
  totalMinimum: number;
  trustChange: number;
  effectiveFrom: string;
  canAgree: boolean;
  reason: string | null;
}
export interface RelationshipTalkQuote {
  choice: RelationshipTalk;
  title: string;
  detail: string;
  trustChange: number;
  targetMinutes: number;
  deadlineDate: string;
  canTalk: boolean;
  reason: string | null;
}
