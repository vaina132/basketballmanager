import type { InjuryKind, InjuryRisk } from './injuries';
export type Side = 'home' | 'away';
export type EngineVersion = 'rules-2' | 'possession-3';
/**
 * Format 79 (owner feedback 16, 22 November 2026): the richer play model of the possession engine (`src/engine/plays.ts`):
 * pick-and-rolls, post-ups, drives and kick-outs, fast breaks, putbacks and the other named actions. Matches without it
 * replay with the earlier possession actions unchanged.
 * Format 81 (owner feedback, 22 November 2026 evening: "a more realistic flow ... the ball going out, backcourt
 * violations"): `plays-3` adds the dead balls of a real game (balls knocked out of bounds, kicked balls, more held
 * balls, 8-second, 5-second and double-dribble violations, goaltending, unsportsmanlike fouls), realistic timeouts and
 * holds for the last shot. `plays-2` matches replay unchanged.
 */
export type PlayModel = 'plays-2' | 'plays-3';
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
 * New careers store them on every player (`src/world/extra-attributes.ts`); records without them (exhibition teams,
 * the fictional development world, older careers) play, train and show as before.
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

/**
 * Format 86: a computer side's head coach's automatic rotation (`src/world/coach-steering.ts`, `coachRotation`): how deep
 * the bench plays, how much young players are trusted, when tired or foul-troubled players sit, how quickly he changes,
 * when his best five close a tight game and how soon he stops a run with a timeout. Derived from the coach; never random.
 */
export interface CoachRotation {
  /** -2 (short bench: the starters play more) to +2 (deep bench). */
  depth: number;
  /** Rating points added to the young players (`young`) when the rotation ranks its players; negative: veterans first. */
  youthBonus: number;
  /** The side's players aged 22 or under on the game's date. */
  young: string[];
  /** Condition below which a player wants rest (usual 92). */
  restCondition: number;
  /** Minutes of need against a player in foul trouble (usual 5). */
  foulTrouble: number;
  /** Minutes of need a change must gain (usual 3): a good tactician changes sooner. */
  swapThreshold: number;
  /** Seconds left in which the best five close a tight game (usual 180). */
  closingSeconds: number;
  /** Added to the points of an unanswered run that bring a timeout (-1 a good tactician, +1 a poor one). */
  timeoutRun: number;
}

/** Serializable, deterministic action-boundary snapshot. No wall-clock state. */
export interface MatchState {
  schemaVersion: 2;
  engineVersion: EngineVersion;
  possessionPlay?: PossessionPlay | null;
  /** Format 79: the richer play model (possession engine only); absent in older matches, which keep the earlier actions. */
  playModel?: PlayModel;
  /** Format 79, with the play model: the sides run by a computer coach, who call timeouts in a bad run. */
  computerCoach?: Side[];
  /** Format 85: a game at one venue (Primera FEB's final stage, Final Fours, BCL qualification): no home-court advantage. */
  neutralVenue?: true;
  /** Format 86: how a computer side's head coach runs its automatic rotation (absent: the usual rotation). */
  coachRotation?: Partial<Record<Side, CoachRotation>>;
  /** NBA step 3 (provisional format 90): the competition's rules; absent means FIBA-2024 (src/engine/rulesets.ts). */
  ruleset?: import('../engine/rulesets').RulesetId;
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
