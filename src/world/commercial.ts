import { financeLedgerCount, financeLedgerHasEvent, financeLedgerSlice } from './finance-ledger';
import type { FinanceEntry } from '../domain/finance';
import type { CommercialAnchor, CommercialEvent, CommercialExit, CommercialExitReason, NamingRightsAgreement, NamingRightsOffer, SeasonCommercial, SeasonNamingRights, SponsorClause, SponsorshipAgreement, SponsorshipOffer, SponsorshipWindow } from '../domain/commercial';
import type { SeasonState } from '../domain/season';
import { clubFinanceDefinition, incumbentSponsorId, seasonRounds, worldOf, lastCommittedWeek } from './career-world';
import { seasonLeagues } from './divisions';
import { clubEconomy } from './economy';
import { getArenaFullCapacity } from './facilities-policy';
import { getFinanceBalance, recordCommercialEntry, recordSponsorshipPayment } from './finance';
import { getSpendableCash } from './payroll-policy';
import {
  agreementFor, agreementLastSeason, bestNamingOffer, bestSponsorshipOffer, buildNamingOffers, buildSponsorshipOffers, commercialGovernsSeason, exitSourceId, namingAgreementFor, namingInstallment, namingPaymentsDue,
  namingSourceId, namingSponsorAvailable, needsNamingOffers, needsSponsorshipOffers, respondToSponsorshipRequest, sponsorAppeal, sponsorAvailable, sponsorClause, sponsorExitDecision, sponsorLeague,
  sponsorshipPaymentsDue, sponsorshipSourceId, sponsorshipInstallment, sponsorshipReferenceFee, terminationTerms, usesCommercialClauses, NAMING_FIRST_INSTALLMENT_ROUND, SPONSORSHIP_RENEWAL_ROUND,
  SPONSORSHIP_SECOND_INSTALLMENT_ROUND, type DueNamingPayment, type DueSponsorshipPayment, type SponsorExitEvidence, type SponsorLeague,
} from './commercial-policy';
import { dateForRound, getStandings, MAX_SEASON_NUMBER, nextSeasonDivisions } from './season';
import type { WorldContext } from '../domain/world';
import { mediaSponsorBonus } from './media';

export { createCommercial } from './commercial-policy';

export function commercialAnchor(state: Pick<SeasonState, 'seasonNumber' | 'round' | 'date' | 'finance'>): CommercialAnchor {
  return { seasonNumber: state.seasonNumber, round: state.round, date: state.date, ledgerCount: financeLedgerCount(state.finance) };
}

/** Committed matchdays in the current season; a played but uncommitted match does not count yet. */
export function completedSeasonRounds(state: Pick<SeasonState, 'status' | 'fixtures' | 'round'> & WorldContext): number {
  return state.status === 'complete' ? seasonRounds(state) : lastCommittedWeek(state);
}

function withEvent(state: SeasonState, commercial: SeasonCommercial, event: CommercialEvent): SeasonState {
  return { ...state, commercial: { ...commercial, events: [...commercial.events, event] } };
}

function namingOf(commercial: SeasonCommercial): SeasonNamingRights {
  if (!commercial.naming) throw new Error('Arena naming rights are not part of this career.');
  return commercial.naming;
}

function withNaming(state: SeasonState, naming: SeasonNamingRights, event?: CommercialEvent): SeasonState {
  return { ...state, commercial: { ...state.commercial, naming: event ? { ...naming, events: [...naming.events, event] } : naming } };
}

function finalPosition(state: Pick<SeasonState, 'clubs' | 'fixtures' | 'seasonNumber'> & WorldContext): (seasonNumber: number, clubId: string) => number | null {
  return (seasonNumber, clubId) => seasonNumber === state.seasonNumber ? getStandings(state).find(row => row.clubId === clubId)?.position ?? null : null;
}

/** The club's league this season (format 64): a sponsor judges the season just played within it. */
function leagueFor(state: SeasonState, clubId: string): SponsorLeague {
  return sponsorLeague(worldOf(state), state.divisions, state.clubs.map(club => club.id), clubId);
}

/**
 * The league an offer for next season is set in (format 64): this season's during the season; after the final matchday
 * next season's divisions are known, so a relegated or promoted club's objective and arena value follow its new league.
 */
function offerLeagues(state: SeasonState): (clubId: string) => SponsorLeague {
  const world = worldOf(state), clubIds = state.clubs.map(club => club.id);
  const next = state.status === 'complete' && state.divisions ? nextSeasonDivisions(state) : undefined;
  return clubId => next && seasonLeagues(world, next).some(league => league.clubIds.includes(clubId)) ? sponsorLeague(world, next, clubIds, clubId) : sponsorLeague(world, state.divisions, clubIds, clubId);
}

// Step 3.7: archived seasons are looked up in their index (built once per archive list), not expanded on every call.
function bookedSources(state: SeasonState, kind: FinanceEntry['kind']): { has: (clubId: string, sourceId: string) => boolean } {
  const booked = new Set<string>();
  for (const entry of state.finance.ledger) if (entry.kind === kind) booked.add(`${entry.clubId}/${entry.sourceId}`);
  const archived = { ledger: [], archives: state.finance.archives };
  return { has: (clubId, sourceId) => booked.has(`${clubId}/${sourceId}`) || financeLedgerHasEvent(archived, clubId, kind, sourceId) };
}

function paymentsDueNow(state: SeasonState): DueSponsorshipPayment[] {
  const booked = bookedSources(state, 'sponsor');
  // Only the current season's payments are booked here, so its divisions decide each club's league size (step 3.4c).
  return sponsorshipPaymentsDue(state.commercial, id => (state.world ? seasonLeagues(state.world, state.divisions) : []).find(league => league.clubIds.includes(id))?.clubIds.length ?? state.clubs.length, { seasonNumber: state.seasonNumber, round: state.round, complete: state.status === 'complete' }, finalPosition(state), seasonRounds(state), id => state.clubs.some(club => club.id === id))
    .filter(payment => payment.seasonNumber === state.seasonNumber && payment.round === state.round && payment.sponsorship.installment !== 1 && !booked.has(payment.clubId, payment.sourceId));
}

function namingPaymentsDueNow(state: SeasonState): DueNamingPayment[] {
  if (!usesCommercialClauses(state.commercial)) return [];
  const booked = bookedSources(state, 'naming-rights');
  return namingPaymentsDue(namingOf(state.commercial), { seasonNumber: state.seasonNumber, round: state.round, complete: state.status === 'complete' }, seasonRounds(state), id => state.clubs.some(club => club.id === id))
    .filter(payment => payment.seasonNumber === state.seasonNumber && payment.round === state.round && !booked.has(payment.clubId, payment.sourceId));
}

function bookNamingPayments(state: SeasonState): SeasonState {
  let next = state;
  for (const payment of namingPaymentsDueNow(state)) next = recordCommercialEntry(next, { clubId: payment.clubId, kind: 'naming-rights', amount: payment.amount, sourceId: payment.sourceId, namingRights: { ...payment.namingRights } });
  return next;
}

/**
 * Converts each club's fixed sponsor into an explicit agreement for the current season, already paid by the fixed
 * sponsorship. Negotiated agreements apply from the next season; offers arrive on matchday six.
 */
export function enableCommercial(state: SeasonState): SeasonState {
  if (state.commercial.enabledSince) return state;
  if (!state.finance.enabledSince) throw new Error('Enable club finances before negotiating sponsorship.');
  if (state.status !== 'active') throw new Error('Enable sponsorship negotiations during an active season.');
  const world = worldOf(state), clauses = usesCommercialClauses(state.commercial);
  const agreements: SponsorshipAgreement[] = state.clubs.map((club, index) => ({
    id: `sponsorship-agreement-${index + 1}`, clubId: club.id, sponsorId: incumbentSponsorId(world, club.id), source: 'inherited', offerId: null,
    startsSeason: state.seasonNumber, endsSeason: state.seasonNumber, annualFee: sponsorshipReferenceFee(world, club.id, state), bonus: 0, signedOn: state.date, automatic: false, prepaidSeasons: [state.seasonNumber],
    ...(clauses ? { clause: null, exit: null } : {}),
  }));
  const enabled: SeasonState = { ...state, commercial: { ...state.commercial, enabledSince: commercialAnchor(state), agreements } };
  return automateSponsorship(state.round >= SPONSORSHIP_RENEWAL_ROUND ? openSponsorshipWindows(enabled, 'renewal') : enabled);
}

/** Every club without a contract for next season and without open offers receives offers, in club order. */
export function openSponsorshipWindows(state: SeasonState, window: SponsorshipWindow): SeasonState {
  if (!state.commercial.enabledSince || state.seasonNumber >= MAX_SEASON_NUMBER) return state;
  let commercial = state.commercial;
  const anchor = commercialAnchor(state), completedRounds = completedSeasonRounds(state), clauses = usesCommercialClauses(commercial);
  const leagues = clauses ? offerLeagues(state) : null;
  let ledger: FinanceEntry[] | undefined;
  for (const club of state.clubs) {
    if (!needsSponsorshipOffers(commercial, club.id, state.seasonNumber)) continue;
    ledger ??= financeLedgerSlice(state.finance);
    const appeal = sponsorAppeal({ clubs: state.clubs, fixtures: state.fixtures, ledger, seasonNumber: state.seasonNumber, completedRounds, world: worldOf(state) }, club.id).appeal;
    const offers = buildSponsorshipOffers({ seed: state.seed, commercial, clubId: club.id, window, anchor, appeal, world: worldOf(state), ...(leagues ? { league: leagues(club.id) } : {}), ...(state.economySeasons ? { economySeasons: state.economySeasons } : {}) });
    if (!offers.length) continue;
    commercial = { ...commercial, offers: [...commercial.offers, ...offers], events: [...commercial.events, { ...anchor, type: 'offers', clubId: club.id, window, completedRounds, offerIds: offers.map(offer => offer.id) }] };
  }
  return openNamingWindows(commercial === state.commercial ? state : { ...state, commercial }, window);
}

/** Format 64: arena seats against the league's average venue, league level and the sponsorship benchmark. */
function namingBasis(state: SeasonState, league: SponsorLeague, clubId: string): NamingRightsOffer['basis'] {
  const world = worldOf(state);
  const leagueCapacity = Math.round(league.clubIds.reduce((sum, id) => sum + clubFinanceDefinition(world, id).capacity, 0) / Math.max(1, league.clubIds.length));
  return { benchmark: sponsorshipReferenceFee(world, clubId, state), capacity: getArenaFullCapacity(state, clubId), leagueCapacity, tier: league.tier };
}

/** Format 64: every club whose arena has no naming partner for next season and no open naming offers receives offers. */
function openNamingWindows(state: SeasonState, window: SponsorshipWindow): SeasonState {
  if (!usesCommercialClauses(state.commercial) || !state.commercial.enabledSince || state.seasonNumber >= MAX_SEASON_NUMBER) return state;
  let naming = namingOf(state.commercial);
  const anchor = commercialAnchor(state), completedRounds = completedSeasonRounds(state), world = worldOf(state), leagues = offerLeagues(state);
  let ledger: FinanceEntry[] | undefined;
  for (const club of state.clubs) {
    if (!needsNamingOffers(naming, club.id, state.seasonNumber)) continue;
    ledger ??= financeLedgerSlice(state.finance);
    const appeal = sponsorAppeal({ clubs: state.clubs, fixtures: state.fixtures, ledger, seasonNumber: state.seasonNumber, completedRounds, world }, club.id).appeal;
    const offers = buildNamingOffers({ seed: state.seed, naming, clubId: club.id, window, anchor, appeal, world, basis: namingBasis(state, leagues(club.id), club.id) });
    if (!offers.length) continue;
    naming = { ...naming, offers: [...naming.offers, ...offers], events: [...naming.events, { ...anchor, type: 'offers', clubId: club.id, window, completedRounds, offerIds: offers.map(offer => offer.id) }] };
  }
  return naming === state.commercial.naming ? state : withNaming(state, naming);
}

export interface SponsorshipOfferQuote {
  offer: SponsorshipOffer;
  canAccept: boolean;
  canRequest: boolean;
  reason: string | null;
  totalGuaranteed: number;
  payments: { seasonNumber: number; installment: 1 | 2; date: string; amount: number }[];
  /** Format 64: the exit clause the agreement would carry; null in careers without exit clauses. */
  clause: SponsorClause | null;
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
  const clause = usesCommercialClauses(state.commercial) ? sponsorClause(offer.objective ?? null, offer.appeal, offer.annualFee) : null;
  return { offer, canAccept: reason === null, canRequest: reason === null && offer.request === null, reason, totalGuaranteed: offer.annualFee * offer.seasons, payments, clause };
}

function acceptOffer(state: SeasonState, offerId: string, automatic: boolean): SeasonState {
  const quote = quoteSponsorshipOffer(state, offerId);
  if (!quote.canAccept) throw new Error(quote.reason!);
  const offer = quote.offer;
  const agreement: SponsorshipAgreement = {
    id: `sponsorship-agreement-${state.commercial.agreements.length + 1}`, clubId: offer.clubId, sponsorId: offer.sponsorId, source: 'offer', offerId: offer.id,
    startsSeason: offer.forSeason, endsSeason: offer.forSeason + offer.seasons - 1, annualFee: offer.annualFee, bonus: offer.bonus, signedOn: state.date, automatic, prepaidSeasons: [],
    ...(quote.clause ? { clause: quote.clause, exit: null } : {}),
  };
  const offers = state.commercial.offers.map(item => item.id === offer.id ? { ...item, status: 'accepted' as const, closedOn: state.date } : item.clubId === offer.clubId && item.status === 'open' ? { ...item, status: 'superseded' as const, closedOn: state.date } : item);
  return withEvent(state, { ...state.commercial, agreements: [...state.commercial.agreements, agreement], offers }, { ...commercialAnchor(state), type: 'accept', offerId, agreementId: agreement.id });
}

/** Automatic control (and every AI club) accepts the best open offer under the shared rules; format 64 also signs naming rights. */
export function automateSponsorship(state: SeasonState): SeasonState {
  if (!state.commercial.enabledSince) return state;
  let next = state;
  for (const club of state.clubs) {
    if (!next.commercial.plans[club.id]?.delegated) continue;
    const best = bestSponsorshipOffer(next.commercial.offers.filter(offer => offer.clubId === club.id && offer.status === 'open' && quoteSponsorshipOffer(next, offer.id).canAccept));
    if (best) next = acceptOffer(next, best.id, true);
  }
  return usesCommercialClauses(next.commercial) ? automateNaming(next) : next;
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
  const response = respondToSponsorshipRequest(state.seed, offer, mediaSponsorBonus(state, offer.id));
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

/** A manager's move: the former club's sponsorship and naming rights turn automatic, the new club's manual. */
export function handOverCommercialControl(commercial: SeasonCommercial, fromClubId: string, toClubId: string): SeasonCommercial {
  const swap = (plans: SeasonCommercial['plans']) => ({ ...plans, [fromClubId]: { delegated: true }, [toClubId]: { delegated: false } });
  return { ...commercial, plans: swap(commercial.plans), ...(commercial.naming ? { naming: { ...commercial.naming, plans: swap(commercial.naming.plans) } } : {}) };
}

// ---------------------------------------------------------------------------------------------------------------
// Arena naming rights (format 64)

export interface NamingOfferQuote {
  offer: NamingRightsOffer;
  canAccept: boolean;
  canRequest: boolean;
  reason: string | null;
  totalGuaranteed: number;
  payments: { seasonNumber: number; installment: 1 | 2; date: string; amount: number }[];
  clause: SponsorClause;
}

export function quoteNamingOffer(state: SeasonState, offerId: string): NamingOfferQuote {
  const naming = namingOf(state.commercial);
  const offer = naming.offers.find(item => item.id === offerId);
  if (!offer) throw new Error('Choose a naming-rights offer made to a club in this career.');
  let reason: string | null = null;
  if (!state.commercial.enabledSince) reason = 'Enable sponsorship negotiations first.';
  else if (offer.status !== 'open') reason = 'This offer is no longer open.';
  else if (state.date > offer.expiresOn) reason = 'This offer has expired.';
  else if (namingAgreementFor(naming, offer.clubId, offer.forSeason)) reason = 'The arena already has a naming partner for that season.';
  else if (!namingSponsorAvailable(naming, offer.sponsorId, offer.clubId, offer.forSeason)) reason = 'This sponsor has committed to another club.';
  const payments: NamingOfferQuote['payments'] = [];
  for (let season = offer.forSeason; season < offer.forSeason + offer.seasons && season <= MAX_SEASON_NUMBER; season += 1) {
    payments.push({ seasonNumber: season, installment: 1, date: dateForRound(NAMING_FIRST_INSTALLMENT_ROUND, season), amount: namingInstallment(offer, 1) });
    payments.push({ seasonNumber: season, installment: 2, date: dateForRound(seasonRounds(state), season), amount: namingInstallment(offer, 2) });
  }
  return { offer, canAccept: reason === null, canRequest: reason === null && offer.request === null, reason, totalGuaranteed: offer.annualFee * offer.seasons, payments, clause: sponsorClause(null, offer.appeal, offer.annualFee) };
}

function acceptNaming(state: SeasonState, offerId: string, automatic: boolean): SeasonState {
  const quote = quoteNamingOffer(state, offerId);
  if (!quote.canAccept) throw new Error(quote.reason!);
  const naming = namingOf(state.commercial), offer = quote.offer;
  const agreement: NamingRightsAgreement = {
    id: `naming-agreement-${naming.agreements.length + 1}`, clubId: offer.clubId, sponsorId: offer.sponsorId, offerId: offer.id, arenaName: offer.arenaName,
    startsSeason: offer.forSeason, endsSeason: offer.forSeason + offer.seasons - 1, annualFee: offer.annualFee, signedOn: state.date, automatic, clause: quote.clause, exit: null,
  };
  const offers = naming.offers.map(item => item.id === offer.id ? { ...item, status: 'accepted' as const, closedOn: state.date } : item.clubId === offer.clubId && item.status === 'open' ? { ...item, status: 'superseded' as const, closedOn: state.date } : item);
  return withNaming(state, { ...naming, agreements: [...naming.agreements, agreement], offers }, { ...commercialAnchor(state), type: 'accept', offerId, agreementId: agreement.id });
}

function automateNaming(state: SeasonState): SeasonState {
  let next = state;
  for (const club of state.clubs) {
    if (!namingOf(next.commercial).plans[club.id]?.delegated) continue;
    const best = bestNamingOffer(namingOf(next.commercial).offers.filter(offer => offer.clubId === club.id && offer.status === 'open' && quoteNamingOffer(next, offer.id).canAccept));
    if (best) next = acceptNaming(next, best.id, true);
  }
  return next;
}

function managedNamingOffer(state: SeasonState, offerId: string): NamingRightsOffer {
  const offer = state.commercial.naming?.offers.find(item => item.id === offerId);
  if (!state.commercial.enabledSince || !offer || offer.clubId !== state.managedClubId) throw new Error('Choose a naming-rights offer made to your club.');
  if (offer.status !== 'open' || state.date > offer.expiresOn) throw new Error('This offer is no longer open.');
  return offer;
}

export function acceptNamingOffer(state: SeasonState, offerId: string): SeasonState {
  managedNamingOffer(state, offerId);
  return acceptNaming(state, offerId, false);
}

export function declineNamingOffer(state: SeasonState, offerId: string): SeasonState {
  managedNamingOffer(state, offerId);
  const naming = namingOf(state.commercial);
  return withNaming(state, { ...naming, offers: naming.offers.map(item => item.id === offerId ? { ...item, status: 'declined' as const, closedOn: state.date } : item) }, { ...commercialAnchor(state), type: 'decline', offerId });
}

/** As for the main sponsor: one request for 10% more per offer, answered at once. */
export function requestNamingImprovement(state: SeasonState, offerId: string): SeasonState {
  const offer = managedNamingOffer(state, offerId);
  if (offer.request) throw new Error('You have already asked this sponsor for better terms.');
  const response = respondToSponsorshipRequest(state.seed, offer), naming = namingOf(state.commercial);
  return withNaming(state, { ...naming, offers: naming.offers.map(item => item.id === offerId ? { ...item, request: response.request, annualFee: response.annualFee, status: response.status, closedOn: response.status === 'open' ? null : state.date } : item) }, { ...commercialAnchor(state), type: 'request', offerId });
}

export function setNamingDelegation(state: SeasonState, delegated: boolean): SeasonState {
  if (!state.commercial.enabledSince) throw new Error('Enable sponsorship negotiations first.');
  if (typeof delegated !== 'boolean') throw new Error('Choose manual or automatic naming-rights control.');
  const naming = namingOf(state.commercial);
  if (naming.plans[state.managedClubId]!.delegated === delegated) return state;
  return automateSponsorship(withNaming(state, { ...naming, plans: { ...naming.plans, [state.managedClubId]: { delegated } } }, { ...commercialAnchor(state), type: 'policy', clubId: state.managedClubId, delegated }));
}

// ---------------------------------------------------------------------------------------------------------------
// Early exits (format 64)

export type CommercialContract = 'main' | 'naming';
type ClauseAgreement = SponsorshipAgreement | NamingRightsAgreement;

function contractAgreement(state: SeasonState, contract: CommercialContract, agreementId: string): ClauseAgreement | undefined {
  return contract === 'main' ? state.commercial.agreements.find(item => item.id === agreementId) : state.commercial.naming?.agreements.find(item => item.id === agreementId);
}

/** Records an early end: the agreement's exit, its event and the dated exit payment or termination fee. */
function applyExit(state: SeasonState, contract: CommercialContract, agreement: ClauseAgreement, by: 'sponsor' | 'club', reason: CommercialExitReason, lastSeason: number, amount: number): SeasonState {
  const anchor = commercialAnchor(state);
  const exit: CommercialExit = { by, reason, seasonNumber: state.seasonNumber, round: state.round, date: state.date, lastSeason, amount };
  const event: CommercialEvent = by === 'sponsor' ? { ...anchor, type: 'exit', agreementId: agreement.id, reason: reason as Exclude<CommercialExitReason, 'club'> } : { ...anchor, type: 'terminate', agreementId: agreement.id };
  let next: SeasonState;
  if (contract === 'main') next = withEvent(state, { ...state.commercial, agreements: state.commercial.agreements.map(item => item.id === agreement.id ? { ...item, exit } : item) }, event);
  else { const naming = namingOf(state.commercial); next = withNaming(state, { ...naming, agreements: naming.agreements.map(item => item.id === agreement.id ? { ...item, exit } : item) }, event); }
  return recordCommercialEntry(next, { clubId: agreement.clubId, kind: 'sponsor-exit', amount: by === 'sponsor' ? amount : -amount, sourceId: exitSourceId(agreement.id), sponsorExit: { agreementId: agreement.id, sponsorId: agreement.sponsorId, contract, by } });
}

/** Clubs relegated at this season's end: a lower division next season, or out of the full world. */
function relegatedClubIds(state: SeasonState): Set<string> {
  if (!state.divisions || state.status !== 'complete') return new Set();
  const world = worldOf(state), now = seasonLeagues(world, state.divisions), next = seasonLeagues(world, nextSeasonDivisions(state));
  const tier = (leagues: ReturnType<typeof seasonLeagues>, clubId: string) => leagues.find(league => league.clubIds.includes(clubId))?.tier;
  return new Set(state.clubs.map(club => club.id).filter(clubId => { const before = tier(now, clubId), after = tier(next, clubId); return before !== undefined && (after === undefined || after > before); }));
}

/**
 * After the final matchday (and the season's last installments), each sponsor whose clause is triggered decides from the
 * career seed whether to leave: the agreement ends with this season and the sponsor pays its agreed exit payment.
 */
function processCommercialExits(state: SeasonState): SeasonState {
  if (!usesCommercialClauses(state.commercial) || state.status !== 'complete') return state;
  const world = worldOf(state), clubs = new Set(state.clubs.map(club => club.id));
  let relegated: Set<string> | undefined, positions: Map<string, number> | undefined, ledger: FinanceEntry[] | undefined;
  const appeals = new Map<string, number>();
  const evidence = (clubId: string): SponsorExitEvidence => {
    relegated ??= relegatedClubIds(state);
    positions ??= new Map(getStandings(state).map(row => [row.clubId, row.position]));
    ledger ??= financeLedgerSlice(state.finance);
    if (!appeals.has(clubId)) appeals.set(clubId, sponsorAppeal({ clubs: state.clubs, fixtures: state.fixtures, ledger, seasonNumber: state.seasonNumber, completedRounds: seasonRounds(state), world }, clubId).appeal);
    return { relegated: relegated.has(clubId), leagueId: leagueFor(state, clubId).id, position: positions.get(clubId) ?? null, appeal: appeals.get(clubId)!, economy: !!clubEconomy({ world }, clubId) };
  };
  const candidates = (agreements: readonly ClauseAgreement[]) => agreements.filter(agreement => clubs.has(agreement.clubId) && agreement.clause && !agreement.exit && agreementLastSeason(agreement) > state.seasonNumber);
  let next = state;
  for (const [contract, agreements] of [['main', candidates(state.commercial.agreements)], ['naming', candidates(namingOf(state.commercial).agreements)]] as const) {
    for (const agreement of agreements) {
      const reason = sponsorExitDecision(state.seed, agreement, state.seasonNumber, evidence(agreement.clubId));
      if (reason) next = applyExit(next, contract, agreement, 'sponsor', reason, state.seasonNumber, agreement.clause!.exitPayment);
    }
  }
  return next;
}

export interface SponsorshipTerminationQuote {
  agreement: ClauseAgreement;
  canTerminate: boolean;
  reason: string | null;
  /** The last season still covered (one before the start for a term that has not begun). */
  lastSeason: number;
  cancelledSeasons: number;
  fee: number;
}

/** What ending one of the managed club's agreements early would cost now, and whether it is possible. */
export function quoteSponsorshipTermination(state: SeasonState, contract: CommercialContract, agreementId: string): SponsorshipTerminationQuote {
  const agreement = contractAgreement(state, contract, agreementId);
  if (!agreement || agreement.clubId !== state.managedClubId) throw new Error('Choose an agreement of your club.');
  const terms = terminationTerms(agreement, state.seasonNumber);
  let reason: string | null = null;
  if (!usesCommercialClauses(state.commercial) || !agreement.clause) reason = 'This agreement has no early-termination clause.';
  else if (agreement.exit) reason = 'This agreement has already ended early.';
  else if (state.status !== 'active') reason = 'End an agreement during the season, so new sponsors can still make offers.';
  else if (terms.cancelledSeasons < 1) reason = 'This agreement already ends with this season.';
  else if (getFinanceBalance(state.finance, agreement.clubId).unpaid > 0) reason = 'Settle unpaid costs before paying a termination fee.';
  else if (getSpendableCash(state, agreement.clubId) < terms.fee) reason = 'The termination fee is more than your remaining budget.';
  return { agreement, canTerminate: reason === null, reason, ...terms };
}

/** The managed club ends an agreement early: the fee is paid now and the agreement covers no season after this one. */
export function terminateSponsorship(state: SeasonState, contract: CommercialContract, agreementId: string): SeasonState {
  const quote = quoteSponsorshipTermination(state, contract, agreementId);
  if (!quote.canTerminate) throw new Error(quote.reason!);
  return applyExit(state, contract, quote.agreement, 'club', 'club', quote.lastSeason, quote.fee);
}

// ---------------------------------------------------------------------------------------------------------------
// Calendar

/** Matchday preparation: the second installment falls due on matchday six, which also opens renewal offers. */
export function processCommercialRound(state: SeasonState): SeasonState {
  if (!state.commercial.enabledSince) return state;
  let next = state;
  if (state.round === SPONSORSHIP_SECOND_INSTALLMENT_ROUND) for (const payment of paymentsDueNow(next)) next = recordSponsorshipPayment(next, payment);
  if (state.round === NAMING_FIRST_INSTALLMENT_ROUND) next = bookNamingPayments(next);
  if (state.round === SPONSORSHIP_RENEWAL_ROUND) next = openSponsorshipWindows(next, 'renewal');
  return automateSponsorship(next);
}

/**
 * After the final matchday: earned top-half bonuses and the final naming installments, then (format 64) sponsor exits,
 * then a second round of offers for clubs still without a sponsor or naming partner.
 */
export function completeCommercialSeason(state: SeasonState): SeasonState {
  if (!state.commercial.enabledSince) return state;
  let next = state;
  for (const payment of paymentsDueNow(next)) next = recordSponsorshipPayment(next, payment);
  next = processCommercialExits(bookNamingPayments(next));
  return automateSponsorship(openSponsorshipWindows(next, 'second-round'));
}

/** At a new season's opening, offers that would have started by then can no longer begin. */
export function startCommercialSeason(state: SeasonState): SeasonState {
  if (!state.commercial.enabledSince) return state;
  let next = state;
  const expired = state.commercial.offers.filter(offer => offer.status === 'open' && offer.forSeason <= state.seasonNumber).map(offer => offer.id);
  if (expired.length) {
    const ids = new Set(expired);
    const offers = state.commercial.offers.map(offer => ids.has(offer.id) ? { ...offer, status: 'expired' as const, closedOn: state.date } : offer);
    next = withEvent(state, { ...state.commercial, offers }, { ...commercialAnchor(state), type: 'expire', offerIds: expired });
  }
  const naming = next.commercial.naming;
  const namingExpired = naming?.offers.filter(offer => offer.status === 'open' && offer.forSeason <= state.seasonNumber).map(offer => offer.id) ?? [];
  if (naming && namingExpired.length) {
    const ids = new Set(namingExpired);
    next = withNaming(next, { ...naming, offers: naming.offers.map(offer => ids.has(offer.id) ? { ...offer, status: 'expired' as const, closedOn: state.date } : offer) }, { ...commercialAnchor(next), type: 'expire', offerIds: namingExpired });
  }
  return next;
}

// ---------------------------------------------------------------------------------------------------------------
// Read-only summaries

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
  /** Format 64: agreements carry exit clauses. */
  clauses: boolean;
  /** Format 64: the agreement the club could end early now (current, or a separate next agreement), with its cost. */
  termination: SponsorshipTerminationQuote | null;
  /** Format 64: the club's agreements that ended early, newest first. */
  ended: SponsorshipAgreement[];
}

function received(state: SeasonState, clubId: string, kind: FinanceEntry['kind'], sourceId: string): boolean {
  return financeLedgerHasEvent(state.finance, clubId, kind, sourceId);
}

/** The first of two agreements the club could end early, if any. */
function terminationFor(state: SeasonState, contract: CommercialContract, agreements: readonly (ClauseAgreement | null)[]): SponsorshipTerminationQuote | null {
  if (!usesCommercialClauses(state.commercial) || state.status !== 'active') return null;
  for (const agreement of agreements) if (agreement?.clause && !agreement.exit && terminationTerms(agreement, state.seasonNumber).cancelledSeasons > 0) return quoteSponsorshipTermination(state, contract, agreement.id);
  return null;
}

/** Read-only summary for Club and the manager's desk; it never changes the career. */
export function getClubSponsorship(state: SeasonState, clubId = state.managedClubId): ClubSponsorship {
  const commercial = state.commercial;
  const current = commercial.enabledSince ? agreementFor(commercial, clubId, state.seasonNumber) ?? null : null;
  const nextAgreement = commercial.enabledSince ? agreementFor(commercial, clubId, state.seasonNumber + 1) ?? null : null;
  const fixedThisSeason = !commercialGovernsSeason(commercial, state.seasonNumber);
  const payments: SponsorshipPaymentRow[] = [];
  if (current && !fixedThisSeason && !current.prepaidSeasons.includes(state.seasonNumber)) {
    const paid = (installment: 1 | 2 | 'bonus') => received(state, clubId, 'sponsor', sponsorshipSourceId(current, state.seasonNumber, installment));
    payments.push({ label: 'Opening installment', date: dateForRound(1, state.seasonNumber), amount: sponsorshipInstallment(current, 1), status: paid(1) ? 'received' : 'scheduled' });
    payments.push({ label: 'Matchday 6 installment', date: dateForRound(SPONSORSHIP_SECOND_INSTALLMENT_ROUND, state.seasonNumber), amount: sponsorshipInstallment(current, 2), status: paid(2) ? 'received' : 'scheduled' });
    if (current.bonus > 0) payments.push({ label: 'Top-half bonus', date: dateForRound(seasonRounds(state), state.seasonNumber), amount: current.bonus, status: paid('bonus') ? 'received' : state.status === 'complete' ? 'not-earned' : 'conditional' });
  }
  const offers = commercial.offers.filter(offer => offer.clubId === clubId && offer.forSeason === state.seasonNumber + 1);
  const clauses = usesCommercialClauses(commercial);
  return {
    enabled: commercial.enabledSince !== null, delegated: commercial.plans[clubId]?.delegated ?? false, current, next: nextAgreement,
    fixedThisSeason, open: offers.filter(offer => offer.status === 'open'), closed: offers.filter(offer => offer.status !== 'open'), payments,
    clauses, termination: clubId === state.managedClubId ? terminationFor(state, 'main', [current, nextAgreement]) : null,
    ended: commercial.agreements.filter(agreement => agreement.clubId === clubId && agreement.exit).reverse(),
  };
}

export interface ClubNamingRights {
  /** Naming rights exist in this career (format 64) and negotiations are enabled. */
  enabled: boolean;
  delegated: boolean;
  current: NamingRightsAgreement | null;
  next: NamingRightsAgreement | null;
  /** The official venue from the world data and the name the arena carries this season. */
  officialVenue: string;
  arenaName: string;
  open: NamingRightsOffer[];
  closed: NamingRightsOffer[];
  payments: SponsorshipPaymentRow[];
  termination: SponsorshipTerminationQuote | null;
  ended: NamingRightsAgreement[];
}

/** Null in careers without naming rights (every career before format 64). */
export function getClubNamingRights(state: SeasonState, clubId = state.managedClubId): ClubNamingRights | null {
  const naming = state.commercial.naming;
  if (!usesCommercialClauses(state.commercial) || !naming) return null;
  const enabled = state.commercial.enabledSince !== null;
  const current = enabled ? namingAgreementFor(naming, clubId, state.seasonNumber) ?? null : null;
  const nextAgreement = enabled ? namingAgreementFor(naming, clubId, state.seasonNumber + 1) ?? null : null;
  const payments: SponsorshipPaymentRow[] = [];
  if (current) for (const installment of [1, 2] as const) payments.push({
    label: installment === 1 ? 'Matchday 6 installment' : 'Final matchday installment', date: dateForRound(installment === 1 ? NAMING_FIRST_INSTALLMENT_ROUND : seasonRounds(state), state.seasonNumber),
    amount: namingInstallment(current, installment), status: received(state, clubId, 'naming-rights', namingSourceId(current, state.seasonNumber, installment)) ? 'received' : 'scheduled',
  });
  const offers = naming.offers.filter(offer => offer.clubId === clubId && offer.forSeason === state.seasonNumber + 1);
  const officialVenue = clubFinanceDefinition(worldOf(state), clubId).venue;
  return {
    enabled, delegated: naming.plans[clubId]?.delegated ?? false, current, next: nextAgreement, officialVenue, arenaName: current?.arenaName ?? officialVenue,
    open: offers.filter(offer => offer.status === 'open'), closed: offers.filter(offer => offer.status !== 'open'), payments,
    termination: clubId === state.managedClubId ? terminationFor(state, 'naming', [current, nextAgreement]) : null,
    ended: naming.agreements.filter(agreement => agreement.clubId === clubId && agreement.exit).reverse(),
  };
}

/**
 * The name a club's arena carries in a season: its naming partner's arena name while an agreement covers that season,
 * otherwise the official venue from the world data (unchanged there). Null for a club without a venue in this world.
 */
export function arenaNameFor(state: Pick<SeasonState, 'commercial' | 'seasonNumber'> & WorldContext, clubId: string, seasonNumber = state.seasonNumber): string | null {
  const naming = state.commercial?.naming;
  const agreement = naming && state.commercial.enabledSince ? namingAgreementFor(naming, clubId, seasonNumber) : undefined;
  if (agreement) return agreement.arenaName;
  return worldOf(state).finances.find(item => item.clubId === clubId)?.venue ?? null;
}
