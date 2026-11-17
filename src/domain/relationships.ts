import type { Player } from './types';
import type { PressStyle } from './media';

/** `development` is the Reserve role. Star and Prospect belong to the `relationships-3` model (squad roles everywhere). */
export type SquadRole = 'development' | 'rotation' | 'starter' | 'star' | 'prospect';
export type RelationshipTalk = 'explain' | 'minutes-promise';
/** Format 34: runs of three results. Format 67 (careers with media) adds topics chosen from what happened. */
export type PressTopic = 'losing-run' | 'winning-run' | RichPressTopic;
export type RichPressTopic = 'big-win' | 'heavy-defeat' | 'derby-win' | 'derby-defeat' | 'playing-time' | 'injury' | 'signing' | 'sale' | 'board-pressure' | 'europe' | 'promotion-race' | 'relegation-battle' | 'rival-comments';
/** Format 34 answers, then (format 67) the four answer styles of the richer press conferences. */
export type PressAnswer = 'back' | 'demand' | 'credit' | 'leaders' | 'routine' | PressStyle;
/**
 * Format 66: `relationships-2` (new careers) adds squad-rank default roles and contract requests; `relationships-1` keeps its rules.
 * `relationships-3` (squad roles everywhere, new careers from format 74): five roles (Star and Prospect added) with
 * their own minutes, defaults by squad rank and age, the role as a contract term, and requests for talks or to leave.
 */
export type RelationshipsModel = 'relationships-1' | 'relationships-2' | 'relationships-3';
/** `relationships-3`: an unmet role escalates: the player asks for talks, then asks to leave; settled once his minutes meet the role. */
export type RoleRequestStage = 'talks' | 'leave' | 'settled';
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
  /** Format 67 (careers with media) adds the named players (`subjectIds`) and the media standing before the answer. */
  | { type: 'press'; clubId: string; topic: PressTopic; triggerRound: number; answer: PressAnswer; playerIds: string[]; coreIds: string[]; subjectIds?: string[]; standing?: number }
  | { type: 'prepare'; rosterIds: Record<string, string>; values: Record<string, number> }
  /** Format 66 (`relationships-2`): a final-year player asks for renewal talks; negotiationCount orders it against offers. */
  | { type: 'contract-request'; clubId: string; playerId: string; trigger: ContractRequestTrigger; negotiationCount: number }
  /** Format 66: the club's answer to its open request. */
  | { type: 'contract-reply'; clubId: string; playerId: string; requestId: string; reply: ContractRequestReply; negotiationCount: number }
  /** `relationships-3`: a step of an unmet role's escalation, recorded at a matchday boundary when its condition holds. */
  | { type: 'role-request'; clubId: string; playerId: string; stage: RoleRequestStage }
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
  /** Format 67 (careers with media): the named players, the club the question is about and the standing before answering. */
  subjectIds?: string[];
  opponentId?: string;
  standing?: number;
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
  /** `relationships-3`: where the role comes from (a default, an agreement or a contract term) and the contract's role. */
  roleSource?: 'default' | 'agreed' | 'contract';
  contractRole?: SquadRole | null;
  /** `relationships-3`: the open request for talks or to leave about an unmet role, if any. */
  roleRequest?: RoleRequest | null;
  /** `relationships-3`: the longer evidence window (up to six eligible games in the role) behind a request for talks. */
  roleEvidence?: { games: number; averageMinutes: number | null; unmet: boolean };
}
/** `relationships-3`: the player's open escalation about an unmet role. */
export interface RoleRequest {
  id: string;
  clubId: string;
  playerId: string;
  stage: 'talks' | 'leave';
  /** When he asked for talks, and (for a transfer request) when he asked to leave. */
  talksOn: string;
  leaveOn: string | null;
  /** Whether the manager has answered the request for talks with a conversation or a role change. */
  answered: boolean;
  /** The career matchday count when he asked for talks (a transfer request follows after `leaveAfterRounds`). */
  talksCompletedRounds: number;
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
