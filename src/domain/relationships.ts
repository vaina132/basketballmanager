import type { Player } from './types';

export type SquadRole = 'development' | 'rotation' | 'starter';
export type RelationshipTalk = 'explain' | 'minutes-promise';
export type PressTopic = 'losing-run' | 'winning-run';
export type PressAnswer = 'back' | 'demand' | 'credit' | 'leaders' | 'routine';
/** Format 66: `relationships-2` (new careers) adds squad-rank default roles and contract requests; `relationships-1` keeps its rules. */
export type RelationshipsModel = 'relationships-1' | 'relationships-2';
/** Why a player asked about a new contract: the middle of his final season, or another club's offer for him. */
export type ContractRequestTrigger = 'mid-season' | 'interest';
/** The manager's answer: open renewal talks now, promise talks at the season's end, or decline. */
export type ContractRequestReply = 'talks' | 'promise' | 'decline';
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
  /** Format 34: a press answer after a run of results, with the squad and most-used players it addressed. */
  | { type: 'press'; clubId: string; topic: PressTopic; triggerRound: number; answer: PressAnswer; playerIds: string[]; coreIds: string[] }
  | { type: 'prepare'; rosterIds: Record<string, string>; values: Record<string, number> }
  /** Format 66 (`relationships-2`): a final-year player asks for renewal talks; negotiationCount orders it against offers. */
  | { type: 'contract-request'; clubId: string; playerId: string; trigger: ContractRequestTrigger; negotiationCount: number }
  /** Format 66: the club's answer to its open request. */
  | { type: 'contract-reply'; clubId: string; playerId: string; requestId: string; reply: ContractRequestReply; negotiationCount: number }
);
export interface SeasonRelationships {
  model: RelationshipsModel;
  enabledSince: RelationshipAnchor | null;
  events: RelationshipEvent[];
  /**
   * `relationships-2` only: each registration snapshot's players, best overall rating first, recorded when the snapshot
   * was first prepared (keyed by roster id). Players without an agreed role default to a role by this rank.
   */
  squadRanks?: Record<string, string[]>;
}
export type ContractRequestStatus = 'open' | 'ignored' | 'declined' | 'talks' | 'promised' | 'kept' | 'lapsed' | 'broken' | 'renewed' | 'departed';
/** A contract request and its outcome, derived from the journal, contracts and negotiation records. */
export interface ContractRequest {
  id: string;
  clubId: string;
  playerId: string;
  seasonNumber: number;
  round: number;
  date: string;
  trigger: ContractRequestTrigger;
  reply: ContractRequestReply | null;
  repliedOn: string | null;
  status: ContractRequestStatus;
  /** Last date to answer before the request counts as ignored. */
  replyBy: string;
  /** For talks or a promise: the date by which an offer must follow (a promise: the start of the next season). */
  deadlineDate: string | null;
  outcomeDate: string | null;
  /** Extra wage share (percent) this club must pay to re-sign him while the refusal is remembered. */
  premiumPercent: number;
}
export interface PressQuestion {
  id: string;
  clubId: string;
  topic: PressTopic;
  seasonNumber: number;
  /** The matchday whose result completed the run. */
  triggerRound: number;
  date: string;
  question: string;
  answers: readonly PressAnswer[];
  /** Registered players addressed by the answer, and the most-used players in the run. */
  playerIds: string[];
  coreIds: string[];
  answered: PressAnswer | null;
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
  /** `relationships-2`: the latest contract request at this club, and every request in order. */
  contractRequest?: ContractRequest | null;
  contractRequests?: ContractRequest[];
  /** `relationships-2`: the player's rank in the registered squad that sets his default role (null when an agreed role applies or unranked). */
  squadRank?: number | null;
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
