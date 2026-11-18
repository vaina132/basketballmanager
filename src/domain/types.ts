import type { InjuryKind, InjuryRisk } from './injuries';
export type Side = 'home' | 'away';
export type EngineVersion = 'rules-2' | 'possession-3';
export type Position = 'PG' | 'SG' | 'SF' | 'PF' | 'C';

/** The seven trained skills (1-20): every player record has them; training, potential and the overall rating use them. */
export interface SkillAttributes {
  readonly twoPoint: number;
  readonly threePoint: number;
  readonly freeThrow: number;
  readonly passing: number;
  readonly defense: number;
  readonly rebounding: number;
  readonly stamina: number;
}

/**
 * Five further abilities (owner decision, 18 November 2026), 1-20 like the skills: Blocking, Stealing, Intelligence
 * (decisions, fewer turnovers), Mental (close games, late in the game) and Discipline (faster training progress).
 * New careers store them on every player; records without them (exhibition teams, older careers) use the values
 * `extraAttributes` in `src/world/extra-attributes.ts` estimates from the player's other details.
 */
export interface ExtraAttributes {
  readonly blocking: number;
  readonly stealing: number;
  readonly intelligence: number;
  readonly mental: number;
  readonly discipline: number;
}

export interface PlayerAttributes extends SkillAttributes, Partial<ExtraAttributes> {}

export interface Player {
  readonly id: string;
  readonly name: string;
  readonly number: number;
  readonly position: Position;
  readonly heightCm: number;
  readonly weightKg: number;
  readonly skinTone: string;
  readonly hairColor: string;
  readonly attributes: PlayerAttributes;
}

export interface Team {
  readonly id: string;
  readonly name: string;
  readonly shortName: string;
  readonly color: string;
  readonly players: readonly Player[];
}

/** Prototype instructions, each bounded to the inclusive range [0, 1]. */
export interface Tactics {
  tempo: number;
  outsideShare: number;
  pressure: number;
}

export interface PlayerStats {
  secondsPlayed: number;
  points: number;
  fieldGoalsMade: number;
  fieldGoalsAttempted: number;
  threePointersMade: number;
  threePointersAttempted: number;
  freeThrowsMade: number;
  freeThrowsAttempted: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fouls: number;
  condition: number;
}

export type MatchEventType =
  | 'tipoff' | 'pass' | 'drive' | 'shot' | 'free-throw' | 'turnover' | 'foul' | 'rebound'
  | 'period-end' | 'period-start' | 'final' | 'substitution' | 'tactics'
  | 'foul-out' | 'injury' | 'timeout' | 'command' | 'shot-clock' | 'held-ball';

/** Court coordinates are normalized to the 28 by 15 metre playing surface. */
export interface CourtPoint { x: number; y: number }
export interface CourtPosition extends CourtPoint { playerId: string }
export interface CourtBallPoint extends CourtPoint { height: number }
/** Deterministic presentation data. Durations never advance the simulation clock. */
export interface CourtScene {
  kind: 'setup' | 'pass' | 'drive' | 'shot' | 'free-throw' | 'rebound' | 'turnover';
  durationMs: number;
  offense: Side;
  start: CourtPosition[];
  end: CourtPosition[];
  ball: { from: CourtBallPoint; to: CourtBallPoint; arcHeight: number };
}

export interface MatchEvent {
  id: number;
  period: number;
  clockSeconds: number;
  type: MatchEventType;
  side?: Side;
  playerId?: string;
  receiverId?: string;
  outgoingPlayerId?: string;
  assistPlayerId?: string;
  text: string;
  score: Record<Side, number>;
  shot?: { x: number; y: number; made: boolean; value: 2 | 3; defenderId?: string; contest?: 'open' | 'pressured' | 'contested'; distanceM?: number };
  scene?: CourtScene;
}

export type InjuryMode = 'standard' | 'reduced' | 'off';
export interface SubstitutionRequest { outId: string; inId: string }
export interface RequiredSubstitution { side: Side; playerId: string; reason: 'fouled-out' | 'injured' }
export interface Stoppage {
  reason: 'pre-game' | 'whistle' | 'made-basket' | 'free-throws' | 'period-end' | 'timeout';
  substitutionSides: Side[];
  timeoutSides: Side[];
}
export interface FreeThrowSequence { side: Side; shooterId: string; total: 1 | 2 | 3; remaining: number }
export interface TimeoutUsage { firstHalf: number; secondHalf: number; overtime: number; lateFourth: number }
export interface MatchResult { winner: Side; kind: 'normal' | 'default'; officialScore: Record<Side, number> }

/** Sporting positions and control at a resolved live-action boundary. */
export interface PossessionPlay {
  offense: Side;
  handlerId: string;
  passerId: string | null;
  actions: number;
  positions: CourtPosition[];
  matchups: { attackerId: string; defenderId: string }[];
}

/** Serializable, deterministic action-boundary snapshot. No wall-clock state. */
export interface MatchState {
  schemaVersion: 2;
  engineVersion: EngineVersion;
  possessionPlay?: PossessionPlay | null;
  /** Frozen when the career round is prepared; later conversations never rewrite a match. */
  morale?: { model: 'morale-1'; eventCount: number; values: Record<string, number> };
  seed: number;
  rngState: number;
  home: Team;
  away: Team;
  score: Record<Side, number>;
  period: number;
  clockSeconds: number;
  status: 'ready' | 'playing' | 'finished';
  phase: 'live-ball' | 'dead-ball' | 'free-throws' | 'period-end';
  possession: Side;
  possessionArrow: Side;
  shotClockSeconds: number;
  frontcourt: boolean;
  teamFouls: Record<Side, number>;
  timeoutUsage: Record<Side, TimeoutUsage>;
  timeoutRequested: Record<Side, boolean>;
  pendingSubstitutions: Record<Side, SubstitutionRequest[]>;
  requiredSubstitutions: RequiredSubstitution[];
  freeThrows: FreeThrowSequence | null;
  stoppage: Stoppage | null;
  substitutionLocks: string[];
  autoSubstitutions: Record<Side, boolean>;
  injuryMode: InjuryMode;
  injuries: Record<string, { kind: InjuryKind; occurredAtSeconds: number }>;
  /** Modern scheduled fixtures only: unavailable before tipoff, not new match injuries. */
  preExistingInjuries?: string[];
  /** Format 61, career fixtures only: per-kind risk multipliers from each player's earlier injuries (recurrence). */
  injuryRisk?: Record<string, InjuryRisk>;
  courtSeconds: Record<Side, number>;
  result: MatchResult | null;
  lineups: Record<Side, string[]>;
  /**
   * The court picture's chosen circles (format 74): the position played by each player the manager put in a circle,
   * for players on court and reserves queued for a circle. Everyone else plays his listed position (computer clubs,
   * the automatic rotation's changes, a five the manager never arranged).
   */
  slots?: Partial<Record<Side, Record<string, Position>>>;
  /** The chosen circles when the clock first ran, kept so that the next game starts from the circles set before tip-off. */
  startingSlots?: Partial<Record<Side, Record<string, Position>>>;
  tactics: Record<Side, Tactics>;
  stats: Record<string, PlayerStats>;
  events: MatchEvent[];
  stepCount: number;
}
