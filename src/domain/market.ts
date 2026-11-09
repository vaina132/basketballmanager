/** Pending proposals reserve annual wage room, never current cash or player registration. */
export interface MarketOffer {
  id: string;
  clubId: string;
  playerId: string;
  /** The completed season in which recruitment takes place. */
  seasonNumber: number;
  offeredOn: string;
  responseOn: string;
  expiresOn: string;
  seasonWage: number;
  seasons: number;
  status: 'pending' | 'countered' | 'accepted' | 'rejected' | 'withdrawn' | 'expired' | 'replaced';
  respondedOn: string | null;
  closedOn: string | null;
  negotiationId: string | null;
}

export type MarketEvent =
  | { type: 'offer'; id: string; date: string; clubId: string; playerId: string; seasonWage: number; seasons: number }
  | { type: 'withdraw'; date: string; offerId: string }
  | { type: 'advance'; date: string };

export interface MarketWindow {
  seasonNumber: number;
  openedOn: string;
  closesOn: string;
  date: string;
  contractCountBefore: number;
  negotiationCountBefore: number;
  closed: boolean;
  events: MarketEvent[];
  /** Materialized from the event journal and normal negotiation replies on import. */
  offers: MarketOffer[];
}

export interface SeasonMarket {
  model: 'market-1';
  enabledSince: { seasonNumber: number; round: number; contractCount: number; negotiationCount: number } | null;
  windows: MarketWindow[];
}
