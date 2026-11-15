import type { CommercialAnchor, CommercialEvent, SeasonCommercial, SponsorshipAgreement, SponsorshipOffer, SponsorshipWindow } from '../domain/commercial';
import type { SeasonState } from '../domain/season';
import type { CareerMove } from '../domain/career';
import { managedClubAtLedger } from '../world/career';
import { clubsEverInFullWorld, fullWorldClubsIn, incumbentSponsorId, roundOrdinal, seasonRounds, worldOf } from '../world/career-world';
import { agreementFor, bestSponsorshipOffer, buildSponsorshipOffers, createCommercial, needsSponsorshipOffers, respondToSponsorshipRequest, sponsorAppeal, sponsorAvailable, SPONSORSHIP_REFERENCE_FEE, SPONSORSHIP_RENEWAL_ROUND } from '../world/commercial-policy';
import { dateForRound, MAX_SEASON_NUMBER, seasonStartDate } from '../world/season';
import { financeLedgerCount } from '../world/finance-ledger';

const ANCHOR_KEYS = ['seasonNumber', 'round', 'date', 'ledgerCount'] as const;
const EVENT_KEYS: Record<CommercialEvent['type'], readonly string[]> = {
  offers: ['clubId', 'window', 'completedRounds', 'offerIds'], request: ['offerId'], accept: ['offerId', 'agreementId'], decline: ['offerId'], policy: ['clubId', 'delegated'], expire: ['offerIds'],
};
/** Matchdays as one sequence across seasons, as stored in anchors; it uses the career's season length. */
const ordinal = (seasonNumber: number, round: number, rounds: number) => roundOrdinal(seasonNumber, round, rounds);
const dayBefore = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
function fail(path: string, reason: string): never { throw new Error(`Invalid season save: ${path} ${reason}.`); }
function record(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object');
  const fields = value as Record<string, unknown>;
  if (keys.some(key => !Object.hasOwn(fields, key)) || Object.keys(fields).some(key => !keys.includes(key))) fail(path, 'has missing or unsupported fields');
  return fields;
}
function integer(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) fail(path, `must be an integer between ${min} and ${max}`);
  return value;
}
function equal(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) !== Array.isArray(right)) return false;
  const a = Object.keys(left), b = Object.keys(right);
  return a.length === b.length && a.every(key => Object.hasOwn(right, key) && equal((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
}

type Boundary = { key: [number, number] } & ({ kind: 'window'; window: SponsorshipWindow; seasonNumber: number; round: number; date: string; completedRounds: number; activation: boolean } | { kind: 'expire'; seasonNumber: number; date: string } | { kind: 'move'; move: CareerMove });
const before = (left: [number, number], right: [number, number]) => left[0] < right[0] || left[0] === right[0] && left[1] < right[1];

/**
 * Rebuild sponsorship history from activation: every offer is regenerated from the club's evidence at its calendar
 * boundary, requests and automatic choices are recomputed, and the stored offers and agreements must match exactly.
 */
export function validateCommercial(state: SeasonState, version: number): void {
  if (version < 31) return;
  const fields = record(state.commercial, 'commercial', ['model', 'enabledSince', 'plans', 'agreements', 'offers', 'events']);
  if (fields.model !== 'commercial-1') fail('commercial.model', 'is unsupported');
  const defaults = createCommercial(state.clubs, state.managedClubId);
  // Commands belong to the club managed at their ledger position; a move hands control over at its own position.
  const managedAt = (event: CommercialEvent) => managedClubAtLedger(state, event.ledgerCount);
  const limit = 200 * state.clubs.length * state.seasonNumber;
  if (!Array.isArray(fields.agreements) || !Array.isArray(fields.offers) || !Array.isArray(fields.events) || fields.agreements.length > limit || fields.offers.length > limit || fields.events.length > limit) fail('commercial', 'must contain bounded agreements, offers and events');
  if (fields.enabledSince === null) {
    if (!equal(fields, defaults)) fail('commercial', 'must remain empty while sponsorship negotiations are disabled');
    return;
  }
  if (!state.finance.enabledSince) fail('commercial.enabledSince', 'requires active club finances');
  const ledger = state.finance.ledger;
  const anchor = (raw: unknown, path: string): CommercialAnchor => {
    const value = record(raw, path, ANCHOR_KEYS);
    const seasonNumber = integer(value.seasonNumber, `${path}.seasonNumber`, 1, state.seasonNumber);
    const round = integer(value.round, `${path}.round`, 1, seasonNumber === state.seasonNumber ? state.round : seasonRounds(state));
    const ledgerCount = integer(value.ledgerCount, `${path}.ledgerCount`, 0, financeLedgerCount({ ledger }));
    if (typeof value.date !== 'string' || value.date > state.date) fail(`${path}.date`, 'must be an actual career date');
    const matchday = dateForRound(round, seasonNumber);
    const latest = seasonNumber < MAX_SEASON_NUMBER ? dayBefore(seasonStartDate(seasonNumber + 1)) : '9999-12-31';
    if (round < seasonRounds(state) ? value.date !== matchday : value.date < matchday || value.date > latest) fail(`${path}.date`, 'must fall on its matchday or within that season\'s offseason');
    return { seasonNumber, round, date: value.date, ledgerCount };
  };
  const activation = anchor(fields.enabledSince, 'commercial.enabledSince');
  if (activation.date !== dateForRound(activation.round, activation.seasonNumber)) fail('commercial.enabledSince.date', 'must identify an active matchday');
  if (ordinal(state.finance.enabledSince.seasonNumber, state.finance.enabledSince.round, seasonRounds(state)) > ordinal(activation.seasonNumber, activation.round, seasonRounds(state))) fail('commercial.enabledSince', 'cannot precede club finances');

  // Plans stay with every club that has been in the full world (step 3.4d-2).
  const planClubs = clubsEverInFullWorld(state, state.seasonNumber);
  const plans = record(fields.plans, 'commercial.plans', planClubs.map(club => club.id));
  for (const club of planClubs) {
    const plan = record(plans[club.id], `commercial.plans.${club.id}`, ['delegated']);
    if (typeof plan.delegated !== 'boolean' || club.id !== state.managedClubId && !plan.delegated) fail(`commercial.plans.${club.id}.delegated`, 'must be boolean; rival clubs always manage sponsorship automatically');
  }

  const inherited: SponsorshipAgreement[] = fullWorldClubsIn(state, activation.seasonNumber).map((club, index) => ({
    id: `sponsorship-agreement-${index + 1}`, clubId: club.id, sponsorId: incumbentSponsorId(worldOf(state), club.id), source: 'inherited', offerId: null,
    startsSeason: activation.seasonNumber, endsSeason: activation.seasonNumber, annualFee: SPONSORSHIP_REFERENCE_FEE, bonus: 0, signedOn: activation.date, automatic: false, prepaidSeasons: [activation.seasonNumber],
  }));
  let replay: SeasonCommercial = { ...defaults, plans: createCommercial([...planClubs], managedClubAtLedger(state, activation.ledgerCount)).plans, enabledSince: activation, agreements: inherited };
  const events = fields.events as unknown[];
  let index = 0, previous: CommercialAnchor = activation;

  const seasonFixtures = (seasonNumber: number) => seasonNumber === state.seasonNumber ? state.fixtures : state.history.find(archive => archive.seasonNumber === seasonNumber)?.fixtures ?? fail('commercial', 'requires the original fixtures of every negotiated season');
  const completionStart = (seasonNumber: number) => { const first = ledger.findIndex(entry => entry.seasonNumber === seasonNumber && entry.round === seasonRounds(state) && entry.kind === 'tickets'); return first < 0 ? financeLedgerCount({ ledger }) : first; };
  const eventAt = (position: number): CommercialEvent => {
    const path = `commercial.events[${position}]`;
    const raw = events[position];
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw) || !Object.hasOwn(EVENT_KEYS, (raw as { type?: string }).type ?? '')) fail(`${path}.type`, 'is unsupported');
    const type = (raw as { type: CommercialEvent['type'] }).type;
    const value = record(raw, path, ['type', ...ANCHOR_KEYS, ...EVENT_KEYS[type]]);
    const at = anchor(Object.fromEntries(ANCHOR_KEYS.map(key => [key, value[key]])), path);
    if (ordinal(at.seasonNumber, at.round, seasonRounds(state)) < ordinal(previous.seasonNumber, previous.round, seasonRounds(state)) || at.date < previous.date || at.ledgerCount < previous.ledgerCount) fail(path, 'must keep chronological calendar and ledger order');
    return value as unknown as CommercialEvent;
  };
  const keyOf = (event: CommercialEvent): [number, number] => [ordinal(event.seasonNumber, event.round, seasonRounds(state)), event.round === seasonRounds(state) && event.ledgerCount >= completionStart(event.seasonNumber) ? 2 : 0];
  const sameAnchor = (event: CommercialEvent, at: CommercialAnchor) => event.seasonNumber === at.seasonNumber && event.round === at.round && event.date === at.date && event.ledgerCount === at.ledgerCount;
  const anchorOfEvent = (event: CommercialEvent): CommercialAnchor => ({ seasonNumber: event.seasonNumber, round: event.round, date: event.date, ledgerCount: event.ledgerCount });

  const acceptable = (offer: SponsorshipOffer, date: string) => offer.status === 'open' && date <= offer.expiresOn && !agreementFor(replay, offer.clubId, offer.forSeason) && sponsorAvailable(replay, offer.sponsorId, offer.clubId, offer.forSeason);
  const accept = (offer: SponsorshipOffer, at: CommercialAnchor, agreementId: unknown, automatic: boolean, path: string) => {
    const id = `sponsorship-agreement-${replay.agreements.length + 1}`;
    if (agreementId !== id) fail(`${path}.agreementId`, 'must identify the next sequential agreement');
    const agreement: SponsorshipAgreement = { id, clubId: offer.clubId, sponsorId: offer.sponsorId, source: 'offer', offerId: offer.id, startsSeason: offer.forSeason, endsSeason: offer.forSeason + offer.seasons - 1, annualFee: offer.annualFee, bonus: offer.bonus, signedOn: at.date, automatic, prepaidSeasons: [] };
    replay = { ...replay, agreements: [...replay.agreements, agreement], offers: replay.offers.map(item => item.id === offer.id ? { ...item, status: 'accepted', closedOn: at.date } : item.clubId === offer.clubId && item.status === 'open' ? { ...item, status: 'superseded', closedOn: at.date } : item) };
  };
  /** Automatic control leaves no acceptable offer waiting for a delegated club. */
  const consumeAutomation = (at: CommercialAnchor) => {
    for (const club of fullWorldClubsIn(state, at.seasonNumber)) {
      if (!replay.plans[club.id]!.delegated) continue;
      const best = bestSponsorshipOffer(replay.offers.filter(offer => offer.clubId === club.id && acceptable(offer, at.date)));
      if (!best) continue;
      const path = `commercial.events[${index}]`;
      if (index >= events.length) fail('commercial.events', 'is missing an automatic sponsorship acceptance');
      const event = eventAt(index);
      if (event.type !== 'accept' || !sameAnchor(event, at) || event.offerId !== best.id) fail(path, 'must accept the best guaranteed offer for an automatically managed club');
      accept(best, at, event.agreementId, true, path);
      previous = at; index += 1;
    }
  };
  const consumeWindow = (boundary: Extract<Boundary, { kind: 'window' }>) => {
    let at: CommercialAnchor | null = boundary.activation ? activation : null;
    const seasonClubs = fullWorldClubsIn(state, boundary.seasonNumber);
    for (const club of seasonClubs) {
      if (!needsSponsorshipOffers(replay, club.id, boundary.seasonNumber) || boundary.seasonNumber >= MAX_SEASON_NUMBER) continue;
      const appeal = sponsorAppeal({ world: worldOf(state), clubs: seasonClubs, fixtures: seasonFixtures(boundary.seasonNumber), ledger, seasonNumber: boundary.seasonNumber, completedRounds: boundary.completedRounds }, club.id).appeal;
      // Availability, not the boundary's ledger position, decides whether any offer exists; no offer means no event.
      if (!buildSponsorshipOffers({ world: worldOf(state), seed: state.seed, commercial: replay, clubId: club.id, window: boundary.window, anchor: at ?? { seasonNumber: boundary.seasonNumber, round: boundary.round, date: boundary.date, ledgerCount: 0 }, appeal }).length) continue;
      if (!at) {
        const first = index < events.length ? eventAt(index) : null;
        if (first?.type !== 'offers') fail(`commercial.events[${index}]`, 'is missing sponsorship offers owed at a calendar boundary');
        at = anchorOfEvent(first);
        if (at.seasonNumber !== boundary.seasonNumber || at.round !== boundary.round || at.date !== boundary.date || boundary.window === 'second-round' && at.ledgerCount < completionStart(boundary.seasonNumber)) fail(`commercial.events[${index}]`, 'must occur at its sponsorship calendar boundary');
      }
      const expected = buildSponsorshipOffers({ world: worldOf(state), seed: state.seed, commercial: replay, clubId: club.id, window: boundary.window, anchor: at, appeal });
      const path = `commercial.events[${index}]`;
      if (index >= events.length) fail('commercial.events', 'is missing sponsorship offers owed at a calendar boundary');
      const event = eventAt(index);
      if (event.type !== 'offers' || !sameAnchor(event, at) || event.clubId !== club.id || event.window !== boundary.window || event.completedRounds !== boundary.completedRounds || !equal(event.offerIds, expected.map(offer => offer.id))) fail(path, 'must record exactly the offers owed to each club at this boundary, in club order');
      replay = { ...replay, offers: [...replay.offers, ...expected] };
      previous = at; index += 1;
    }
    if (at) consumeAutomation(at);
  };
  /** A season-end move: the former club turns automatic and takes its best acceptable offer at once; the new club is manual. */
  const consumeMove = (boundary: Extract<Boundary, { kind: 'move' }>) => {
    const { move } = boundary;
    replay = { ...replay, plans: { ...replay.plans, [move.fromClubId]: { delegated: true }, [move.toClubId]: { delegated: false } } };
    consumeAutomation({ seasonNumber: move.seasonNumber, round: seasonRounds(state), date: move.date, ledgerCount: move.ledgerCount });
  };
  const consumeExpiry = (boundary: Extract<Boundary, { kind: 'expire' }>) => {
    const expired = replay.offers.filter(offer => offer.status === 'open' && offer.forSeason <= boundary.seasonNumber).map(offer => offer.id);
    if (!expired.length) return;
    const path = `commercial.events[${index}]`;
    if (index >= events.length) fail('commercial.events', 'is missing the expiry of offers at a season opening');
    const event = eventAt(index);
    if (event.type !== 'expire' || event.seasonNumber !== boundary.seasonNumber || event.round !== 1 || event.date !== boundary.date || !equal(event.offerIds, expired)) fail(path, 'must expire exactly the offers that could no longer start, at the season opening');
    const ids = new Set(expired);
    replay = { ...replay, offers: replay.offers.map(offer => ids.has(offer.id) ? { ...offer, status: 'expired', closedOn: event.date } : offer) };
    previous = anchorOfEvent(event); index += 1;
  };
  const consumeManual = () => {
    const path = `commercial.events[${index}]`;
    const event = eventAt(index), at = anchorOfEvent(event);
    if (event.type === 'offers' || event.type === 'expire') fail(path, 'must occur at a sponsorship calendar boundary');
    previous = at; index += 1;
    if (event.type === 'policy') {
      if (event.clubId !== managedAt(event) || typeof event.delegated !== 'boolean' || replay.plans[event.clubId]!.delegated === event.delegated) fail(path, 'must change the managed club between manual and automatic control');
      replay = { ...replay, plans: { ...replay.plans, [event.clubId]: { delegated: event.delegated } } };
      consumeAutomation(at);
      return;
    }
    const offer = replay.offers.find(item => item.id === event.offerId);
    if (!offer || offer.clubId !== managedAt(event) || offer.status !== 'open' || at.date > offer.expiresOn) fail(path, 'must act on an open offer made to the managed club');
    if (event.type === 'decline') { replay = { ...replay, offers: replay.offers.map(item => item.id === offer.id ? { ...item, status: 'declined', closedOn: at.date } : item) }; return; }
    if (event.type === 'request') {
      if (offer.request) fail(path, 'can ask each sponsor for better terms only once');
      const response = respondToSponsorshipRequest(state.seed, offer);
      replay = { ...replay, offers: replay.offers.map(item => item.id === offer.id ? { ...item, request: response.request, annualFee: response.annualFee, status: response.status, closedOn: response.status === 'open' ? null : at.date } : item) };
      return;
    }
    if (replay.plans[offer.clubId]!.delegated || !acceptable(offer, at.date)) fail(path, 'must accept an available offer while the club manages sponsorship manually');
    accept(offer, at, event.agreementId, false, path);
  };

  // Calendar boundaries since activation, ordered against events by matchday and the final-matchday ledger commit.
  const boundaries: Boundary[] = [];
  if (activation.round >= SPONSORSHIP_RENEWAL_ROUND) boundaries.push({ kind: 'window', window: 'renewal', seasonNumber: activation.seasonNumber, round: activation.round, date: activation.date, completedRounds: activation.round - 1, activation: true, key: [ordinal(activation.seasonNumber, activation.round, seasonRounds(state)), -1] });
  for (let season = activation.seasonNumber; season <= state.seasonNumber; season += 1) {
    if (season > activation.seasonNumber) boundaries.push({ kind: 'expire', seasonNumber: season, date: dateForRound(1, season), key: [ordinal(season, 1, seasonRounds(state)), -1] });
    if ((season > activation.seasonNumber || activation.round < SPONSORSHIP_RENEWAL_ROUND) && (season < state.seasonNumber || state.round >= SPONSORSHIP_RENEWAL_ROUND)) boundaries.push({ kind: 'window', window: 'renewal', seasonNumber: season, round: SPONSORSHIP_RENEWAL_ROUND, date: dateForRound(SPONSORSHIP_RENEWAL_ROUND, season), completedRounds: SPONSORSHIP_RENEWAL_ROUND - 1, activation: false, key: [ordinal(season, SPONSORSHIP_RENEWAL_ROUND, seasonRounds(state)), -1] });
    for (const move of state.career?.moves ?? []) if (move.seasonNumber === season && move.ledgerCount >= activation.ledgerCount) boundaries.push({ kind: 'move', move, key: [ordinal(season, seasonRounds(state), seasonRounds(state)), 0.5] });
    if (season < state.seasonNumber || state.status === 'complete') boundaries.push({ kind: 'window', window: 'second-round', seasonNumber: season, round: seasonRounds(state), date: dateForRound(seasonRounds(state), season), completedRounds: seasonRounds(state), activation: false, key: [ordinal(season, seasonRounds(state), seasonRounds(state)), 1] });
  }
  for (const boundary of boundaries) {
    while (index < events.length && before(keyOf(eventAt(index)), boundary.key)) consumeManual();
    if (boundary.kind === 'window') consumeWindow(boundary); else if (boundary.kind === 'move') consumeMove(boundary); else consumeExpiry(boundary);
  }
  while (index < events.length) consumeManual();

  if (!equal(replay.plans, fields.plans)) fail('commercial.plans', 'must match the recorded control changes');
  if (!equal(replay.offers, fields.offers)) fail('commercial.offers', 'must exactly match the offers, requests and outcomes rebuilt from the calendar');
  if (!equal(replay.agreements, fields.agreements)) fail('commercial.agreements', 'must exactly match inherited agreements and accepted offers');
  if (replay.offers.some(offer => offer.status === 'open' && offer.forSeason <= state.seasonNumber)) fail('commercial.offers', 'cannot keep an offer open after its season has begun');
}
