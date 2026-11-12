import type { CommercialAnchor, CommercialEvent, SeasonCommercial, SponsorshipAgreement, SponsorshipOffer, SponsorshipWindow } from '../domain/commercial';
import type { SeasonState } from '../domain/season';
import { incumbentSponsorId } from '../data/development-sponsors';
import { recordSponsorshipPayment } from './finance';
import { agreementFor, bestSponsorshipOffer, buildSponsorshipOffers, commercialGovernsSeason, needsSponsorshipOffers, respondToSponsorshipRequest, sponsorAppeal, sponsorAvailable, sponsorshipPaymentsDue, sponsorshipSourceId, sponsorshipInstallment, SPONSORSHIP_REFERENCE_FEE, SPONSORSHIP_RENEWAL_ROUND, SPONSORSHIP_SECOND_INSTALLMENT_ROUND, type DueSponsorshipPayment } from './commercial-policy';
import { dateForRound, getStandings, MAX_SEASON_NUMBER } from './season';

export { createCommercial } from './commercial-policy';

export function commercialAnchor(state: Pick<SeasonState, 'seasonNumber' | 'round' | 'date' | 'finance'>): CommercialAnchor {
  return { seasonNumber: state.seasonNumber, round: state.round, date: state.date, ledgerCount: state.finance.ledger.length };
}

/** Committed matchdays in the current season; a played but uncommitted match does not count yet. */
export function completedSeasonRounds(state: Pick<SeasonState, 'status' | 'fixtures'>): number {
  return state.status === 'complete' ? 10 : state.fixtures.filter(fixture => fixture.result).reduce((round, fixture) => Math.max(round, fixture.round), 0);
}

function withEvent(state: SeasonState, commercial: SeasonCommercial, event: CommercialEvent): SeasonState {
  return { ...state, commercial: { ...commercial, events: [...commercial.events, event] } };
}

function finalPosition(state: Pick<SeasonState, 'clubs' | 'fixtures' | 'seasonNumber'>): (seasonNumber: number, clubId: string) => number | null {
  return (seasonNumber, clubId) => seasonNumber === state.seasonNumber ? getStandings(state).find(row => row.clubId === clubId)?.position ?? null : null;
}

function paymentsDueNow(state: SeasonState): DueSponsorshipPayment[] {
  const booked = new Set(state.finance.ledger.filter(entry => entry.kind === 'sponsor').map(entry => `${entry.clubId}/${entry.sourceId}`));
  return sponsorshipPaymentsDue(state.commercial, state.clubs.length, { seasonNumber: state.seasonNumber, round: state.round, complete: state.status === 'complete' }, finalPosition(state))
    .filter(payment => payment.seasonNumber === state.seasonNumber && payment.round === state.round && payment.sponsorship.installment !== 1 && !booked.has(`${payment.clubId}/${payment.sourceId}`));
}

/**
 * Converts each club's fixed sponsor into an explicit agreement for the current season, already paid by the fixed
 * sponsorship. Negotiated agreements apply from the next season; offers arrive on matchday six.
 */
export function enableCommercial(state: SeasonState): SeasonState {
  if (state.commercial.enabledSince) return state;
  if (!state.finance.enabledSince) throw new Error('Enable club finances before negotiating sponsorship.');
  if (state.status !== 'active') throw new Error('Enable sponsorship negotiations during an active season.');
  const agreements: SponsorshipAgreement[] = state.clubs.map((club, index) => ({
    id: `sponsorship-agreement-${index + 1}`, clubId: club.id, sponsorId: incumbentSponsorId(club.id), source: 'inherited', offerId: null,
    startsSeason: state.seasonNumber, endsSeason: state.seasonNumber, annualFee: SPONSORSHIP_REFERENCE_FEE, bonus: 0, signedOn: state.date, automatic: false, prepaidSeasons: [state.seasonNumber],
  }));
  const enabled: SeasonState = { ...state, commercial: { ...state.commercial, enabledSince: commercialAnchor(state), agreements } };
  return automateSponsorship(state.round >= SPONSORSHIP_RENEWAL_ROUND ? openSponsorshipWindows(enabled, 'renewal') : enabled);
}

/** Every club without a contract for next season and without open offers receives offers, in club order. */
export function openSponsorshipWindows(state: SeasonState, window: SponsorshipWindow): SeasonState {
  if (!state.commercial.enabledSince || state.seasonNumber >= MAX_SEASON_NUMBER) return state;
  let commercial = state.commercial;
  const anchor = commercialAnchor(state), completedRounds = completedSeasonRounds(state);
  for (const club of state.clubs) {
    if (!needsSponsorshipOffers(commercial, club.id, state.seasonNumber)) continue;
    const appeal = sponsorAppeal({ clubs: state.clubs, fixtures: state.fixtures, ledger: state.finance.ledger, seasonNumber: state.seasonNumber, completedRounds }, club.id).appeal;
    const offers = buildSponsorshipOffers({ seed: state.seed, commercial, clubId: club.id, window, anchor, appeal });
    if (!offers.length) continue;
    commercial = { ...commercial, offers: [...commercial.offers, ...offers], events: [...commercial.events, { ...anchor, type: 'offers', clubId: club.id, window, completedRounds, offerIds: offers.map(offer => offer.id) }] };
  }
  return commercial === state.commercial ? state : { ...state, commercial };
}

export interface SponsorshipOfferQuote {
  offer: SponsorshipOffer;
  canAccept: boolean;
  canRequest: boolean;
  reason: string | null;
  totalGuaranteed: number;
  payments: { seasonNumber: number; installment: 1 | 2; date: string; amount: number }[];
}

export function quoteSponsorshipOffer(state: SeasonState, offerId: string): SponsorshipOfferQuote {
  const offer = state.commercial.offers.find(item => item.id === offerId);
  if (!offer) throw new Error('Choose a sponsorship offer made to a club in this career.');
  let reason: string | null = null;
  if (!state.commercial.enabledSince) reason = 'Enable sponsorship negotiations first.';
  else if (offer.status !== 'open') reason = 'This offer is no longer open.';
  else if (state.date > offer.expiresOn) reason = 'This offer has expired.';
  else if (agreementFor(state.commercial, offer.clubId, offer.forSeason)) reason = 'The club already has a main sponsor for that season.';
  else if (!sponsorAvailable(state.commercial, offer.sponsorId, offer.clubId, offer.forSeason)) reason = 'This sponsor has committed to another club.';
  const payments: SponsorshipOfferQuote['payments'] = [];
  for (let season = offer.forSeason; season < offer.forSeason + offer.seasons && season <= MAX_SEASON_NUMBER; season += 1) {
    payments.push({ seasonNumber: season, installment: 1, date: dateForRound(1, season), amount: sponsorshipInstallment(offer, 1) });
    payments.push({ seasonNumber: season, installment: 2, date: dateForRound(SPONSORSHIP_SECOND_INSTALLMENT_ROUND, season), amount: sponsorshipInstallment(offer, 2) });
  }
  return { offer, canAccept: reason === null, canRequest: reason === null && offer.request === null, reason, totalGuaranteed: offer.annualFee * offer.seasons, payments };
}

function acceptOffer(state: SeasonState, offerId: string, automatic: boolean): SeasonState {
  const quote = quoteSponsorshipOffer(state, offerId);
  if (!quote.canAccept) throw new Error(quote.reason!);
  const offer = quote.offer;
  const agreement: SponsorshipAgreement = {
    id: `sponsorship-agreement-${state.commercial.agreements.length + 1}`, clubId: offer.clubId, sponsorId: offer.sponsorId, source: 'offer', offerId: offer.id,
    startsSeason: offer.forSeason, endsSeason: offer.forSeason + offer.seasons - 1, annualFee: offer.annualFee, bonus: offer.bonus, signedOn: state.date, automatic, prepaidSeasons: [],
  };
  const offers = state.commercial.offers.map(item => item.id === offer.id ? { ...item, status: 'accepted' as const, closedOn: state.date } : item.clubId === offer.clubId && item.status === 'open' ? { ...item, status: 'superseded' as const, closedOn: state.date } : item);
  return withEvent(state, { ...state.commercial, agreements: [...state.commercial.agreements, agreement], offers }, { ...commercialAnchor(state), type: 'accept', offerId, agreementId: agreement.id });
}

/** Automatic control (and every AI club) accepts the best open offer under the shared rules. */
export function automateSponsorship(state: SeasonState): SeasonState {
  if (!state.commercial.enabledSince) return state;
  let next = state;
  for (const club of state.clubs) {
    if (!next.commercial.plans[club.id]?.delegated) continue;
    const best = bestSponsorshipOffer(next.commercial.offers.filter(offer => offer.clubId === club.id && offer.status === 'open' && quoteSponsorshipOffer(next, offer.id).canAccept));
    if (best) next = acceptOffer(next, best.id, true);
  }
  return next;
}

function managedOpenOffer(state: SeasonState, offerId: string): SponsorshipOffer {
  const offer = state.commercial.offers.find(item => item.id === offerId);
  if (!state.commercial.enabledSince || !offer || offer.clubId !== state.managedClubId) throw new Error('Choose a sponsorship offer made to your club.');
  if (offer.status !== 'open' || state.date > offer.expiresOn) throw new Error('This offer is no longer open.');
  return offer;
}

export function acceptSponsorshipOffer(state: SeasonState, offerId: string): SeasonState {
  managedOpenOffer(state, offerId);
  return acceptOffer(state, offerId, false);
}

export function declineSponsorshipOffer(state: SeasonState, offerId: string): SeasonState {
  managedOpenOffer(state, offerId);
  const offers = state.commercial.offers.map(item => item.id === offerId ? { ...item, status: 'declined' as const, closedOn: state.date } : item);
  return withEvent(state, { ...state.commercial, offers }, { ...commercialAnchor(state), type: 'decline', offerId });
}

/** One request for better terms per offer; the sponsor answers at once and its answer is final. */
export function requestSponsorshipImprovement(state: SeasonState, offerId: string): SeasonState {
  const offer = managedOpenOffer(state, offerId);
  if (offer.request) throw new Error('You have already asked this sponsor for better terms.');
  const response = respondToSponsorshipRequest(state.seed, offer);
  const offers = state.commercial.offers.map(item => item.id === offerId ? { ...item, request: response.request, annualFee: response.annualFee, status: response.status, closedOn: response.status === 'open' ? null : state.date } : item);
  return withEvent(state, { ...state.commercial, offers }, { ...commercialAnchor(state), type: 'request', offerId });
}

export function setSponsorshipDelegation(state: SeasonState, delegated: boolean): SeasonState {
  if (!state.commercial.enabledSince) throw new Error('Enable sponsorship negotiations first.');
  if (typeof delegated !== 'boolean') throw new Error('Choose manual or automatic sponsorship control.');
  if (state.commercial.plans[state.managedClubId]!.delegated === delegated) return state;
  const plans = { ...state.commercial.plans, [state.managedClubId]: { delegated } };
  return automateSponsorship(withEvent(state, { ...state.commercial, plans }, { ...commercialAnchor(state), type: 'policy', clubId: state.managedClubId, delegated }));
}

/** Matchday preparation: the second installment falls due on matchday six, which also opens renewal offers. */
export function processCommercialRound(state: SeasonState): SeasonState {
  if (!state.commercial.enabledSince) return state;
  let next = state;
  if (state.round === SPONSORSHIP_SECOND_INSTALLMENT_ROUND) for (const payment of paymentsDueNow(next)) next = recordSponsorshipPayment(next, payment);
  if (state.round === SPONSORSHIP_RENEWAL_ROUND) next = openSponsorshipWindows(next, 'renewal');
  return automateSponsorship(next);
}

/** After the final matchday: earned top-half bonuses, then a second round of offers for clubs still without a sponsor. */
export function completeCommercialSeason(state: SeasonState): SeasonState {
  if (!state.commercial.enabledSince) return state;
  let next = state;
  for (const payment of paymentsDueNow(next)) next = recordSponsorshipPayment(next, payment);
  return automateSponsorship(openSponsorshipWindows(next, 'second-round'));
}

/** At a new season's opening, offers that would have started by then can no longer begin. */
export function startCommercialSeason(state: SeasonState): SeasonState {
  if (!state.commercial.enabledSince) return state;
  const expired = state.commercial.offers.filter(offer => offer.status === 'open' && offer.forSeason <= state.seasonNumber).map(offer => offer.id);
  if (!expired.length) return state;
  const ids = new Set(expired);
  const offers = state.commercial.offers.map(offer => ids.has(offer.id) ? { ...offer, status: 'expired' as const, closedOn: state.date } : offer);
  return withEvent(state, { ...state.commercial, offers }, { ...commercialAnchor(state), type: 'expire', offerIds: expired });
}

export interface SponsorshipPaymentRow { label: string; date: string; amount: number; status: 'received' | 'scheduled' | 'conditional' | 'not-earned' }
export interface ClubSponsorship {
  enabled: boolean;
  delegated: boolean;
  current: SponsorshipAgreement | null;
  next: SponsorshipAgreement | null;
  /** True when this season's money came from the fixed sponsorship (negotiations disabled or the activation season). */
  fixedThisSeason: boolean;
  open: SponsorshipOffer[];
  closed: SponsorshipOffer[];
  payments: SponsorshipPaymentRow[];
}

/** Read-only summary for Club and the manager's desk; it never changes the career. */
export function getClubSponsorship(state: SeasonState, clubId = state.managedClubId): ClubSponsorship {
  const commercial = state.commercial;
  const current = commercial.enabledSince ? agreementFor(commercial, clubId, state.seasonNumber) ?? null : null;
  const nextAgreement = commercial.enabledSince ? agreementFor(commercial, clubId, state.seasonNumber + 1) ?? null : null;
  const fixedThisSeason = !commercialGovernsSeason(commercial, state.seasonNumber);
  const payments: SponsorshipPaymentRow[] = [];
  if (current && !fixedThisSeason && !current.prepaidSeasons.includes(state.seasonNumber)) {
    const received = (installment: 1 | 2 | 'bonus') => state.finance.ledger.some(entry => entry.kind === 'sponsor' && entry.clubId === clubId && entry.sourceId === sponsorshipSourceId(current, state.seasonNumber, installment));
    payments.push({ label: 'Opening installment', date: dateForRound(1, state.seasonNumber), amount: sponsorshipInstallment(current, 1), status: received(1) ? 'received' : 'scheduled' });
    payments.push({ label: 'Matchday 6 installment', date: dateForRound(SPONSORSHIP_SECOND_INSTALLMENT_ROUND, state.seasonNumber), amount: sponsorshipInstallment(current, 2), status: received(2) ? 'received' : 'scheduled' });
    if (current.bonus > 0) payments.push({ label: 'Top-half bonus', date: dateForRound(10, state.seasonNumber), amount: current.bonus, status: received('bonus') ? 'received' : state.status === 'complete' ? 'not-earned' : 'conditional' });
  }
  const offers = commercial.offers.filter(offer => offer.clubId === clubId && offer.forSeason === state.seasonNumber + 1);
  return {
    enabled: commercial.enabledSince !== null, delegated: commercial.plans[clubId]?.delegated ?? false, current, next: nextAgreement,
    fixedThisSeason, open: offers.filter(offer => offer.status === 'open'), closed: offers.filter(offer => offer.status !== 'open'), payments,
  };
}
