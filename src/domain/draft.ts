import type { Player } from './types';

/**
 * NBA step 8 (format 95, provisional): the NBA draft of worlds with `world.nba.draft` (`src/world/nba-draft.ts`,
 * `nba-draft-policy.ts`). One class a season: about 90 generated prospects (labelled "Generated"), the lottery of the
 * 14 clubs outside the playoffs, then two rounds of 30 picks on draft day, about a week after the Finals inside the
 * offseason market. The journal keeps what the draft decided; the strict save check derives it again.
 */
export interface DraftProspect {
  player: Player;
  dateOfBirth: string;
  nationality: string;
  /** The usual season wage he asks as a free agent (euro cents), like a catalog player's wage. */
  wage: number;
}

export interface DraftPick {
  /** 1-60: picks 1-30 are the first round, 31-60 the second. */
  pick: number;
  clubId: string;
  playerId: string;
  /** `manager`: the manager's own choice ("Make pick"); `auto`: a computer club, or the manager's club when he left it to the assistant. */
  by: 'manager' | 'auto';
  /**
   * The rookie contract signed with the pick; null when the club's squad for next season was full (he becomes a free
   * agent) or when he stays at his European club under contract (the club holds his draft rights).
   */
  contractId: string | null;
}

/**
 * Draft-and-stash (owner, 23 November 2026): an NBA club that drafts a player under contract with a European club for
 * next season holds his draft rights; he stays in Europe until the club brings him over (an ordinary transfer offer from
 * the rights holder, the buyout paid to his European club). Rights do not expire and cannot be traded in this version;
 * no other NBA club may sign him while they are held.
 */
export interface DraftRight {
  playerId: string;
  clubId: string;
  /** The season whose draft gave the rights. */
  seasonNumber: number;
  pick: number;
}

export interface DraftLottery {
  /** The 14 lottery clubs, worst regular-season record first. */
  clubs: string[];
  /** The four clubs drawn for picks 1-4, in pick order. */
  drawn: string[];
}

export interface DraftClass {
  seasonNumber: number;
  /** Draft day: about a week after the last possible Finals game, inside the offseason market. */
  date: string;
  lottery: DraftLottery;
  /** The club of each pick, 60 in all (first round, then second round). */
  order: string[];
  prospects: DraftProspect[];
  /** Real players of European clubs in the pool (worlds with the NBA and European countries; absent when none): catalog ids. */
  europeans?: string[];
  picks: DraftPick[];
}

export interface SeasonDraft {
  model: 'draft-1';
  classes: DraftClass[];
  /** Draft rights held for players left at their European clubs (absent until the first). */
  rights?: DraftRight[];
}
