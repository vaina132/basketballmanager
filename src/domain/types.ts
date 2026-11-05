export type Side = 'home' | 'away';
export type Position = 'PG' | 'SG' | 'SF' | 'PF' | 'C';

export interface PlayerAttributes {
  readonly twoPoint: number;
  readonly threePoint: number;
  readonly freeThrow: number;
  readonly passing: number;
  readonly defense: number;
  readonly rebounding: number;
  readonly stamina: number;
}

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
  | 'tipoff' | 'shot' | 'free-throw' | 'turnover' | 'foul' | 'rebound'
  | 'period-end' | 'period-start' | 'final' | 'substitution' | 'tactics'
  | 'foul-out' | 'injury' | 'timeout' | 'command' | 'shot-clock' | 'held-ball';

export interface MatchEvent {
  id: number;
  period: number;
  clockSeconds: number;
  type: MatchEventType;
  side?: Side;
  playerId?: string;
  outgoingPlayerId?: string;
  text: string;
  score: Record<Side, number>;
  shot?: { x: number; y: number; made: boolean; value: 2 | 3 };
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

/** Serializable, deterministic action-boundary snapshot. No wall-clock state. */
export interface MatchState {
  schemaVersion: 2;
  engineVersion: 'rules-2';
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
  injuries: Record<string, { kind: 'ankle' | 'muscle'; occurredAtSeconds: number }>;
  courtSeconds: Record<Side, number>;
  result: MatchResult | null;
  lineups: Record<Side, string[]>;
  tactics: Record<Side, Tactics>;
  stats: Record<string, PlayerStats>;
  events: MatchEvent[];
  stepCount: number;
}
