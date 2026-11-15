import type { CompetitionStage } from './competition';

/**
 * A rivalry between two clubs. Fixed rivalries are fictional development-league pairs (not claims about real clubs);
 * from format 68 new careers also derive rivalries from recorded results (`origin: 'results'`, src/world/rivalry-growth.ts).
 */
export interface Rivalry {
  id: string;
  clubIds: readonly [string, string];
  name: string;
  /** 1 (mild) to 3 (fierce): scales the crowd effect. */
  intensity: 1 | 2 | 3;
  origin: 'fictional-development-league' | 'results';
}

export interface RivalryAnchor {
  seasonNumber: number;
  round: number;
  date: string;
  /** Completed senior matchdays across the career at activation. */
  completedRounds: number;
  /** First matchday whose derby counts: the opening matchday of a new career, otherwise the next uncommitted one. */
  effectiveFrom: { seasonNumber: number; round: number };
}

/** Why a pair's intensity grew in a season (or its lasting base); `points` is what the reason added at the time. */
export type RivalryReason =
  | { kind: 'base'; origin: 'fictional-development-league'; points: number }
  /** A playoff or knockout series (one game for single-game ties); `wins` follow the pair's `clubIds` order. */
  | { kind: 'series'; seasonNumber: number; stage: Exclude<CompetitionStage, 'regular'>; competition: string | null; wins: [number, number]; score: [number, number] | null; close: boolean; points: number }
  | { kind: 'title-race' | 'promotion-race' | 'relegation-race'; seasonNumber: number; gap: number; points: number }
  | { kind: 'close-games'; seasonNumber: number; games: number; overtime: number; points: number }
  | { kind: 'meetings'; seasonNumber: number; games: number; points: number }
  | { kind: 'europe'; seasonNumber: number; games: number; points: number }
  | { kind: 'manager-move'; seasonNumber: number; fromClubId: string; toClubId: string; points: number }
  | { kind: 'star-move'; seasonNumber: number; playerId: string; name: string; fromClubId: string; toClubId: string; points: number };

/** A named rivalry at the start of a season: intensity 0-100 on the `RIVALRY_GROWTH_RULES` scale, at or above its first level. */
export interface GrownRivalry {
  /** Sorted club ids. */
  clubIds: readonly [string, string];
  intensity: number;
  /** The lasting base (if any), then the most recent reasons, newest first. */
  reasons: RivalryReason[];
}

/** Format 68: the named rivalries in force during one season, derived from the seasons before it. */
export interface SeasonRivalryTable {
  seasonNumber: number;
  rivalries: GrownRivalry[];
}

/**
 * Format 35: rivalries add derby effects on crowds, board reviews and squad morale from their anchor.
 * Model 'rivalries-1' (careers created before format 68, or without rivalries at their start) plays the world's fixed
 * rivalries. Model 'rivalries-2' (format 68, new careers that start with rivalries) plays rivalries grown from results:
 * `seasons` holds each season's table, which saves re-derive exactly from the recorded fixtures, registrations,
 * divisions and manager moves.
 */
export interface SeasonRivalries {
  model: 'rivalries-1' | 'rivalries-2';
  enabledSince: RivalryAnchor | null;
  seasons?: SeasonRivalryTable[];
}
