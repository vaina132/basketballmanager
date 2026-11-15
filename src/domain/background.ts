import type { Player } from './types';

/**
 * Clubs outside the full world (step 3.4d, shared with 3.5). A background club keeps its identity and, once it has
 * one, its squad; it has no finances, staff, academy, board, contracts or transfers, and its players cannot be signed
 * in sprint 3. Its squad does not train: players age by the same dated decline as everyone else (`applyAgingAttributes`).
 */
export interface BackgroundClub {
  id: string;
  name: string;
  shortName: string;
  color: string;
  country: string;
  /** Why the club is outside the full world: relegated out of it (step 3.4d-2). European entrants follow at 3.5. */
  origin: 'relegated';
  /** The first season the club spends outside the full world. */
  since: number;
  /** Its squad when it left, as developed until then. */
  players: Player[];
}

/** Format 53: present in careers that record divisions; empty until clubs can leave the full world (step 3.4d-2). */
export interface SeasonBackground {
  model: 'background-1';
  clubs: BackgroundClub[];
}

/**
 * A country's real next division below its lowest full division. Italy and France have none for now (owner decision,
 * 15 November 2026). Format 53 listed identities only (the game never produced such a list); from format 54 the clubs
 * are in the world itself, with generated squads and estimated club data, outside every opening league, and join the
 * full world only when promoted.
 */
export interface LowerDivisionIdentities {
  country: string;
  tier: number;
  name: string;
  clubs: { id: string; name: string; shortName: string; color: string }[];
}
export interface LowerDivisionMembers {
  country: string;
  tier: number;
  name: string;
  clubIds: string[];
}
export type LowerDivision = LowerDivisionIdentities | LowerDivisionMembers;
