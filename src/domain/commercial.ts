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
  /** Format 64 (commercial-2 only): the exit clause agreed at signing; null for an inherited, already paid season. */
  clause?: SponsorClause | null;
  /** Format 64 (commercial-2 only): an early end by the sponsor or the club; null while the agreement runs its term. */
  exit?: CommercialExit | null;
}

/** The sponsor's stated objective: finish at or above `position` in the named league (format 64). */
export interface SponsorObjective {
  leagueId: string;
  position: number;
  leagueSize: number;
}

/**
 * The performance and exit clause of a commercial-2 agreement (format 64). The sponsor may leave early after a season
 * in which the club is relegated, misses its objective badly or sees its appeal fall sharply; it then pays the agreed
 * exit payment. The club may end the agreement early by paying the termination fee for each cancelled season.
 */
export interface SponsorClause {
  /** Null for naming rights, which carry no league objective. */
  objective: SponsorObjective | null;
  /** The club's appeal when the offer was made; a sharp fall from it lets the sponsor leave. */
  appeal: number;
  /** Paid by the sponsor when it leaves early under the clause, in euro cents. */
  exitPayment: number;
  /** Paid by the club for each season it cancels by ending the agreement early, in euro cents. */
  terminationFee: number;
}

export type CommercialExitReason = 'relegation' | 'objective' | 'decline' | 'club';

/** An agreement ended early (format 64). Seasons after `lastSeason` are cancelled and owe nothing. */
export interface CommercialExit {
  by: 'sponsor' | 'club';
  reason: CommercialExitReason;
  /** The calendar boundary at which notice was given. */
  seasonNumber: number;
  round: number;
  date: string;
  /** The last season the agreement still covers (one before its start when it is cancelled before starting). */
  lastSeason: number;
  /** The exit payment received from the sponsor, or the termination fee the club paid, in euro cents (positive). */
  amount: number;
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
  /** Format 64 (commercial-2 only): the league position the sponsor expects. */
  objective?: SponsorObjective | null;
}

/** An arena naming-rights offer (format 64): the arena carries `arenaName` while the agreement runs. */
export interface NamingRightsOffer {
  id: string;
  clubId: string;
  sponsorId: string;
  window: SponsorshipWindow;
  madeAt: CommercialAnchor;
  appeal: number;
  forSeason: number;
  seasons: number;
  initialAnnualFee: number;
  annualFee: number;
  arenaName: string;
  /** What the fee was built from: the sponsorship benchmark, arena seats against the league and league level. */
  basis: { benchmark: number; capacity: number; leagueCapacity: number; tier: number };
  expiresOn: string;
  status: SponsorshipOffer['status'];
  closedOn: string | null;
  request: SponsorshipRequest | null;
}

/** One exclusive arena naming-rights contract covering whole seasons, paid in two dated installments each season. */
export interface NamingRightsAgreement {
  id: string;
  clubId: string;
  sponsorId: string;
  offerId: string;
  arenaName: string;
  startsSeason: number;
  endsSeason: number;
  annualFee: number;
  signedOn: string;
  automatic: boolean;
  clause: SponsorClause;
  exit: CommercialExit | null;
}

export interface SeasonNamingRights {
  plans: Record<string, SponsorshipPlan>;
  agreements: NamingRightsAgreement[];
  offers: NamingRightsOffer[];
  events: CommercialEvent[];
}

export type CommercialEvent = CommercialAnchor & (
  | { type: 'offers'; clubId: string; window: SponsorshipWindow; completedRounds: number; offerIds: string[] }
  | { type: 'request'; offerId: string }
  | { type: 'accept'; offerId: string; agreementId: string }
  | { type: 'decline'; offerId: string }
  | { type: 'policy'; clubId: string; delegated: boolean }
  | { type: 'expire'; offerIds: string[] }
  /** Format 64: a sponsor leaves early under the clause at a season end. */
  | { type: 'exit'; agreementId: string; reason: Exclude<CommercialExitReason, 'club'> }
  /** Format 64: the managed club ends an agreement early and pays the termination fee. */
  | { type: 'terminate'; agreementId: string }
);

/**
 * `commercial-1`: main-sponsor agreements without exit clauses (every career before format 64). `commercial-2`
 * (format 64, new careers): exit clauses on main-sponsor agreements and arena naming rights in `naming`.
 */
export interface SeasonCommercial {
  model: 'commercial-1' | 'commercial-2';
  enabledSince: CommercialAnchor | null;
  plans: Record<string, SponsorshipPlan>;
  agreements: SponsorshipAgreement[];
  offers: SponsorshipOffer[];
  events: CommercialEvent[];
  /** Present exactly in commercial-2 careers. */
  naming?: SeasonNamingRights;
}

/** Ledger detail for a sponsorship payment made under an explicit agreement. */
export interface SponsorshipPayment {
  agreementId: string;
  sponsorId: string;
  installment: 1 | 2 | 'bonus';
}

/** Ledger detail for a naming-rights installment (format 64). */
export interface NamingRightsPayment {
  agreementId: string;
  sponsorId: string;
  installment: 1 | 2;
}

/** Ledger detail for an exit payment received or a termination fee paid (format 64). */
export interface SponsorExitPayment {
  agreementId: string;
  sponsorId: string;
  contract: 'main' | 'naming';
  by: 'sponsor' | 'club';
}
