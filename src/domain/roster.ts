import type { Player } from './types';

/** Immutable registration identity, separate from later skill development. */
export interface RosterSnapshot {
  id: string;
  clubId: string;
  fromRound: number;
  players: readonly Player[];
}
