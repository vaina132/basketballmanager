export interface NegotiationTerms { seasonWage: number; seasons: number; releaseFee?: number }
export interface NegotiationDecision {
  outcome: 'accepted' | 'countered' | 'rejected';
  reason: 'terms-met' | 'term-premium' | 'below-demand' | 'far-below-demand';
  requiredWage: number;
  counterOffer: NegotiationTerms | null;
  alternativeOffer: NegotiationTerms | null;
}
export interface NegotiationRecord extends NegotiationDecision {
  id: string;
  clubId: string;
  playerId: string;
  seasonNumber: number;
  round: number;
  date: string;
  status: 'active' | 'complete';
  startsSeason: number;
  offeredWage: number;
  offeredSeasons: number;
  releaseFee?: number;
  contractCountBefore: number;
  contractId: string | null;
}
export interface SeasonNegotiations {
  model: 'negotiations-1';
  enabledSince: { seasonNumber: number; round: number; contractCount: number } | null;
  records: NegotiationRecord[];
}
