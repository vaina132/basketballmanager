/** A career calendar and ledger boundary; decisions are rebuilt from the evidence available there. */
export interface CommercialAnchor {
  seasonNumber: number;
  round: number;
  date: string;
  /** Finance ledger entries already recorded at this boundary. */
  ledgerCount: number;
}

export interface SponsorshipPlan {
  /** Automatic control accepts the best guaranteed offer as soon as offers arrive. */
  delegated: boolean;
}

/** One exclusive main-sponsor contract covering whole seasons. */
export interface SponsorshipAgreement {
  id: string;
  clubId: string;
  sponsorId: string;
  source: 'inherited' | 'offer';
  offerId: string | null;
  startsSeason: number;
  /** Last covered season, inclusive. */
  endsSeason: number;
  /** Guaranteed fee for each covered season, in euro cents, paid in two dated installments. */
  annualFee: number;
  /** Paid after a covered season only if the club finishes in the top half; zero when not offered. */
  bonus: number;
  signedOn: string;
  automatic: boolean;
  /** Seasons already funded by the fixed sponsorship that preceded activation; nothing more is paid for them. */
  prepaidSeasons: number[];
}

export type SponsorshipWindow = 'renewal' | 'second-round';

export interface SponsorshipRequest {
  askedAnnualFee: number;
  response: 'accepted' | 'countered' | 'withdrawn';
}

export interface SponsorshipOffer {
  id: string;
  clubId: string;
  sponsorId: string;
  window: SponsorshipWindow;
  madeAt: CommercialAnchor;
  /** Club appeal from venue demand, results and attendance at the offer date, rounded to three decimals. */
  appeal: number;
  forSeason: number;
  seasons: number;
  initialAnnualFee: number;
  annualFee: number;
  bonus: number;
  expiresOn: string;
  status: 'open' | 'accepted' | 'declined' | 'withdrawn' | 'superseded' | 'expired';
  closedOn: string | null;
  request: SponsorshipRequest | null;
}

export type CommercialEvent = CommercialAnchor & (
  | { type: 'offers'; clubId: string; window: SponsorshipWindow; completedRounds: number; offerIds: string[] }
  | { type: 'request'; offerId: string }
  | { type: 'accept'; offerId: string; agreementId: string }
  | { type: 'decline'; offerId: string }
  | { type: 'policy'; clubId: string; delegated: boolean }
  | { type: 'expire'; offerIds: string[] }
);

export interface SeasonCommercial {
  model: 'commercial-1';
  enabledSince: CommercialAnchor | null;
  plans: Record<string, SponsorshipPlan>;
  agreements: SponsorshipAgreement[];
  offers: SponsorshipOffer[];
  events: CommercialEvent[];
}

/** Ledger detail for a sponsorship payment made under an explicit agreement. */
export interface SponsorshipPayment {
  agreementId: string;
  sponsorId: string;
  installment: 1 | 2 | 'bonus';
}
