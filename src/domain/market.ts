export interface TransferProposal {
  sellerClubId: string;
  contractId: string;
  fee: number;
  requiredFee: number;
  clubStatus: 'pending' | 'review' | 'accepted' | 'countered' | 'rejected';
  clubResponseOn: string;
  clubRespondedOn: string | null;
  clubReason: string | null;
  counterFee: number | null;
}

/** Proposals reserve salary capacity and any transfer fee without changing registration. */
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
  status: 'pending' | 'countered' | 'accepted' | 'rejected' | 'withdrawn' | 'expired' | 'replaced' | 'lost' | 'club-review';
  respondedOn: string | null;
  closedOn: string | null;
  negotiationId: string | null;
  /** The accepted proposal that ended this rival offer; no invented salary rejection. */
  chosenOfferId: string | null;
  transfer: TransferProposal | null;
}

export type MarketEvent =
  | { type: 'offer'; id: string; date: string; clubId: string; playerId: string; seasonWage: number; seasons: number; transferFee?: number }
  | { type: 'withdraw'; date: string; offerId: string }
  | { type: 'club-decision'; date: string; offerId: string; response: 'accept' | 'reject' | 'counter' }
  | { type: 'advance'; date: string };

export interface MarketWindow {
  seasonNumber: number;
  openedOn: string;
  closesOn: string;
  date: string;
  contractCountBefore: number;
  negotiationCountBefore: number;
  closed: boolean;
  /** Journal boundary at which competing bids start; null retains legacy rules. */
  competitionFromEvent: number | null;
  events: MarketEvent[];
  /** Materialized from the event journal and normal negotiation replies on import. */
  offers: MarketOffer[];
}

export interface SeasonMarket {
  model: 'market-1';
  enabledSince: { seasonNumber: number; round: number; contractCount: number; negotiationCount: number } | null;
  windows: MarketWindow[];
}
