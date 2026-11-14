import type { Player } from './types';

export const FULL_ROSTER_MODEL = 'club-roster-1' as const;
/** Prototype club capacity; competition-specific quotas belong to competition rules. */
export const MAX_CLUB_ROSTER_SIZE = 40;
export const MAX_MATCHDAY_PLAYERS = 12;

/** Immutable registration identity, separate from later skill development. */
export interface RosterSnapshot {
  id: string;
  clubId: string;
  fromRound: number;
  players: readonly Player[];
}
