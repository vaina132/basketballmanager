/**
 * NBA step 9 (provisional format 95, new careers in a world with the NBA's money rules, marker `world.nbaTrades`):
 * player-for-player trades between NBA clubs. Draft picks cannot be traded; no money changes hands.
 */

/** One player moving in a completed trade: the terms he leaves and the `trade` contracts that carry them on unchanged. */
export interface TradeMove {
  playerId: string;
  fromClubId: string;
  toClubId: string;
  /** The former club's terms in force at the trade and its later terms, in journal order (the records stay). */
  releasedContractIds: string[];
  /** The new `trade` contracts, one for each released term and in the same order. */
  contractIds: string[];
}

/** A completed trade (`employment.trades`): the release references that registration and payroll read. */
export interface EmploymentTrade {
  id: string;
  /** The season during which the trade was agreed. */
  seasonNumber: number;
  /** In season: the registration boundary's date; offseason trades: the new season's first day. */
  completedOn: string;
  startsSeason: number;
  startsRound: number;
  /** `manager`: the manager's proposal accepted by the other club; `computer`: two computer clubs at a fixed trade date. */
  source: 'manager' | 'computer';
  proposalId?: string;
  /** The two clubs, in the proposing (or first-chosen) club's order. */
  clubIds: [string, string];
  moves: TradeMove[];
}

/** `pending`: waiting for the other club's answer; `declined`; `agreed` (offseason: the trade takes effect at the new season); `completed`; `called-off` (an agreed offseason trade no longer legal at the season change); `withdrawn`. */
export type TradeProposalStatus = 'pending' | 'declined' | 'agreed' | 'completed' | 'called-off' | 'withdrawn';

/** The manager's trade offer and the other club's answer (the `trades-1` journal). */
export interface TradeProposal {
  id: string;
  seasonNumber: number;
  /** `season`: proposed during the season (answer and registration at the next week); `offseason`: after the draft window. */
  phase: 'season' | 'offseason';
  /** The week of the proposal (the season's last week in the offseason). */
  round: number;
  proposedOn: string;
  /** The day the other club answers: the next week's first day in season, the next recruitment day in the offseason. */
  answerOn: string;
  fromClubId: string;
  toClubId: string;
  /** The manager's players offered (1-3). */
  sends: string[];
  /** The other club's players asked for (1-3). */
  receives: string[];
  status: TradeProposalStatus;
  /** When the answer, the withdrawal or the season change settled it. */
  settledOn: string | null;
  /** The other club's reason, in words (declined or called off). */
  reason: string | null;
  tradeId: string | null;
}

export interface SeasonTrades {
  model: 'trades-1';
  proposals: TradeProposal[];
}
