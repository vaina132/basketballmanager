import type { CommercialAnchor, CommercialEvent, CommercialExit, NamingRightsAgreement, NamingRightsOffer, SeasonCommercial, SeasonNamingRights, SponsorshipAgreement, SponsorshipOffer, SponsorshipWindow } from '../domain/commercial';
import type { SeasonState } from '../domain/season';
import type { CareerMove } from '../domain/career';
import { managedClubAtLedger } from '../world/career';
import { clubFinanceDefinition, clubsEverInFullWorld, fullWorldClubsIn, incumbentSponsorId, roundKey, roundOrdinal, seasonRounds, worldOf } from '../world/career-world';
import { prefixPlan, recall, remember } from './trusted-prefix';
import {
  agreementFor, agreementLastSeason, bestNamingOffer, bestNamingOfferAfterExit, bestOfferAfterExit, bestSponsorshipOffer, buildNamingOffers, buildSponsorshipOffers, clearlyBetterFee, COMMERCIAL_CLAUSE_RULES, createCommercial, namingAgreementFor, namingSponsorAvailable,
  needsNamingOffers, needsSponsorshipOffers, respondToSponsorshipRequest, sponsorAppeal, sponsorAvailable, sponsorClause, sponsorExitDecision, sponsorLeague, sponsorshipReferenceFee, terminationTerms, SPONSORSHIP_RENEWAL_ROUND, type SponsorExitEvidence, type SponsorLeague,
} from '../world/commercial-policy';
import { validateNamingRights } from './naming-rights-validation';
import { dateForRound, getStandings, MAX_SEASON_NUMBER, nextSeasonDivisions, seasonStartDate } from '../world/season';
import { seasonLeagues } from '../world/divisions';
import { financeAtLedgerBoundary, financeLedgerCount } from '../world/finance-ledger';
import { ledgerClubNet } from '../world/finance-ledger-index';
import { getFinanceBalance } from '../world/finance';
import { automationCushion, clubEconomy } from '../world/economy';
import { getArenaFullCapacity } from '../world/facilities-policy';
import { mediaSponsorBonus } from '../world/media';

const ANCHOR_KEYS = ['seasonNumber', 'round', 'date', 'ledgerCount'] as const;
const EVENT_KEYS: Record<CommercialEvent['type'], readonly string[]> = {
  offers: ['clubId', 'window', 'completedRounds', 'offerIds'], request: ['offerId'], accept: ['offerId', 'agreementId'], decline: ['offerId'], policy: ['clubId', 'delegated'], expire: ['offerIds'],
  exit: ['agreementId', 'reason'], terminate: ['agreementId'],
};
const SPONSOR_EXIT_REASONS: readonly string[] = ['relegation', 'objective', 'decline'];
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
  const model = (state.commercial as { model?: unknown } | null)?.model;
  // Format 64: new careers use exit clauses and naming rights (commercial-2); older careers keep commercial-1 exactly.
  if (model === 'commercial-2' && version < 64) fail('commercial.model', 'requires format 64 or later');
  const clauses = model === 'commercial-2';
  const fields = record(state.commercial, 'commercial', ['model', 'enabledSince', 'plans', 'agreements', 'offers', 'events', ...(clauses ? ['naming'] : [])]);
  if (fields.model !== 'commercial-1' && !clauses) fail('commercial.model', 'is unsupported');
  const defaults = createCommercial(state.clubs, state.managedClubId, clauses ? 'commercial-2' : 'commercial-1');
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
    startsSeason: activation.seasonNumber, endsSeason: activation.seasonNumber, annualFee: sponsorshipReferenceFee(worldOf(state), club.id, { seasonNumber: activation.seasonNumber, economySeasons: state.economySeasons }), bonus: 0, signedOn: activation.date, automatic: false, prepaidSeasons: [activation.seasonNumber],
    ...(clauses ? { clause: null, exit: null } : {}),
  }));
  let replay: SeasonCommercial = { ...defaults, plans: createCommercial([...planClubs], managedClubAtLedger(state, activation.ledgerCount)).plans, enabledSince: activation, agreements: inherited };
  const events = fields.events as unknown[];
  let index = 0, previous: CommercialAnchor = activation;

  const seasonFixtures = (seasonNumber: number) => seasonNumber === state.seasonNumber ? state.fixtures : state.history.find(archive => archive.seasonNumber === seasonNumber)?.fixtures ?? fail('commercial', 'requires the original fixtures of every negotiated season');
  // Format 64: objectives are set within the club's league that season.
  const seasonDivisions = (seasonNumber: number) => seasonNumber === state.seasonNumber ? state.divisions : state.history.find(archive => archive.seasonNumber === seasonNumber)?.divisions;
  // A club's appeal after a number of a season's matchdays reads only that season's games and gate receipts: the main
  // sponsor, naming rights and clause exits share one reading per club and boundary.
  const appeals = new Map<string, number>();
  const appealOf = (seasonNumber: number, completedRounds: number, clubId: string): number => {
    const key = `${seasonNumber}|${completedRounds}|${clubId}`;
    let appeal = appeals.get(key);
    if (appeal === undefined) { appeal = sponsorAppeal({ world: worldOf(state), clubs: fullWorldClubsIn(state, seasonNumber), fixtures: seasonFixtures(seasonNumber), ledger, seasonNumber, completedRounds }, clubId).appeal; appeals.set(key, appeal); }
    return appeal;
  };
  const setExit = (agreementId: string, exit: CommercialExit) => { replay = { ...replay, agreements: replay.agreements.map(item => item.id === agreementId ? { ...item, exit } : item) }; };
  // The final matchday's commit starts with its gate receipts, or with the week's running costs when the final week has
  // no home game of a full-world club (a calendar whose last games are a week earlier, step 3.7).
  const completionStart = (seasonNumber: number) => { const first = ledger.findIndex(entry => entry.seasonNumber === seasonNumber && entry.round === seasonRounds(state) && (entry.kind === 'tickets' || entry.kind === 'operations')); return first < 0 ? financeLedgerCount({ ledger }) : first; };
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
    const agreement: SponsorshipAgreement = { id, clubId: offer.clubId, sponsorId: offer.sponsorId, source: 'offer', offerId: offer.id, startsSeason: offer.forSeason, endsSeason: offer.forSeason + offer.seasons - 1, annualFee: offer.annualFee, bonus: offer.bonus, signedOn: at.date, automatic, prepaidSeasons: [], ...(clauses ? { clause: sponsorClause(offer.objective ?? null, offer.appeal, offer.annualFee), exit: null } : {}) };
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
  /**
   * Format 64: what each sponsor saw after a season (`processCommercialExits`): relegation into a lower division or out
   * of the full world, the final position in the club's league and appeal, from that season's own records.
   */
  const evidenceBySeason = new Map<number, { clubIds: string[]; relegated: Set<string>; positions: Map<string, number> }>();
  const exitEvidence = (seasonNumber: number, clubId: string): SponsorExitEvidence => {
    const world = worldOf(state), divisions = seasonDivisions(seasonNumber);
    let season = evidenceBySeason.get(seasonNumber);
    if (!season) {
      const clubs = fullWorldClubsIn(state, seasonNumber), relegated = new Set<string>();
      if (state.divisions && divisions) {
        const now = seasonLeagues(world, divisions), next = seasonLeagues(world, seasonNumber < state.seasonNumber ? seasonDivisions(seasonNumber + 1) : nextSeasonDivisions(state));
        const tier = (leagues: typeof now, id: string) => leagues.find(league => league.clubIds.includes(id))?.tier;
        for (const club of clubs) { const before = tier(now, club.id), after = tier(next, club.id); if (before !== undefined && (after === undefined || after > before)) relegated.add(club.id); }
      }
      const positions = new Map(getStandings({ ...(state.world ? { world: state.world } : {}), dataPackId: state.dataPackId, clubs, fixtures: seasonFixtures(seasonNumber), divisions }).map(row => [row.clubId, row.position]));
      season = { clubIds: clubs.map(club => club.id), relegated, positions };
      evidenceBySeason.set(seasonNumber, season);
    }
    const appeal = appealOf(seasonNumber, seasonRounds(state), clubId);
    return { relegated: season.relegated.has(clubId), leagueId: sponsorLeague(world, divisions, season.clubIds, clubId).id, position: season.positions.get(clubId) ?? null, appeal, economy: !!clubEconomy({ world }, clubId) };
  };
  /**
   * The cash a club had before paying a termination fee, read from the ledger at that point: no unpaid costs, and its
   * net wealth covers the fee and still keeps `keep`. Spending left subtracts reserves from net wealth, so this is a
   * necessary condition of the live rule (reserves are not rebuilt here).
   */
  const cashAllows = (clubId: string, ledgerCount: number, fee: number, keep: number) => {
    const finance = financeAtLedgerBoundary(state.finance, ledgerCount);
    return getFinanceBalance(finance, clubId).unpaid === 0 && ledgerClubNet(finance, clubId) - fee >= keep;
  };
  const automaticKeep = (clubId: string, seasonNumber: number) => automationCushion({ ...(state.world ? { world: state.world } : {}), dataPackId: state.dataPackId, seasonNumber, ...(state.economySeasons ? { economySeasons: state.economySeasons } : {}) }, clubId, COMMERCIAL_CLAUSE_RULES.automaticExitCushion) / 2;
  /**
   * Format 64: sponsors leaving under their clause at a season end, recorded before that season's second-round offers.
   * Each agreement still covering a later season is decided again from the seed and the season's evidence, in agreement
   * order: exactly the sponsors the clauses send away must leave, with their reasons.
   */
  const consumeExits = (boundary: Extract<Boundary, { kind: 'window' }>) => {
    const seasonNumber = boundary.seasonNumber, seasonClubs = new Set(fullWorldClubsIn(state, seasonNumber).map(club => club.id));
    for (const agreement of replay.agreements.filter(item => seasonClubs.has(item.clubId) && item.clause && !item.exit && agreementLastSeason(item) > seasonNumber)) {
      const reason = sponsorExitDecision(state.seed, agreement, seasonNumber, exitEvidence(seasonNumber, agreement.clubId));
      if (!reason) continue;
      const path = `commercial.events[${index}]`;
      if (index >= events.length) fail('commercial.events', 'is missing a sponsor exit its clause decided at a season end');
      const event = eventAt(index) as Extract<CommercialEvent, { type: 'exit' }>;
      if (event.type !== 'exit' || event.agreementId !== agreement.id || event.reason !== reason) fail(path, 'must record exactly the sponsor exits the clauses decide at the season end, in agreement order');
      if (event.seasonNumber !== seasonNumber || event.round !== boundary.round || event.date !== boundary.date || event.ledgerCount < completionStart(seasonNumber)) fail(path, 'must occur at its season end');
      setExit(agreement.id, { by: 'sponsor', reason, seasonNumber, round: event.round, date: event.date, lastSeason: seasonNumber, amount: agreement.clause!.exitPayment });
      previous = anchorOfEvent(event); index += 1;
    }
  };
  /**
   * Format 64: automatic control's early exits at matchday six, a run of club terminations right before that window's
   * offers. Each must end an automatically managed club's current agreement for a clearly better offer, rebuilt here,
   * with no unpaid costs and net wealth that pays the fee and keeps half the automatic cushion (`cashAllows`).
   */
  const consumeAutomaticExits = (boundary: Extract<Boundary, { kind: 'window' }>, seasonClubs: ReturnType<typeof fullWorldClubsIn>, leagueOf: (clubId: string) => { league?: SponsorLeague }) => {
    let end = index;
    while (end < events.length && (events[end] as { type?: unknown } | null)?.type === 'terminate') end += 1;
    const atBoundary = (event: CommercialEvent) => event.seasonNumber === boundary.seasonNumber && event.round === boundary.round && event.date === boundary.date;
    const following = end > index && end < events.length ? eventAt(end) : null;
    if (!following || following.type !== 'offers' || !atBoundary(following)) return;
    while (index < end) {
      const path = `commercial.events[${index}]`, event = eventAt(index) as Extract<CommercialEvent, { type: 'terminate' }>, at = anchorOfEvent(event);
      const agreement = replay.agreements.find(item => item.id === event.agreementId);
      const terms = agreement && terminationTerms(agreement, at.seasonNumber);
      if (!atBoundary(event) || !agreement?.clause || agreement.exit || !replay.plans[agreement.clubId]?.delegated || agreement.startsSeason > at.seasonNumber || !terms || terms.cancelledSeasons < 1 || !seasonClubs.some(club => club.id === agreement.clubId)) fail(path, 'must end an automatically managed club\'s current agreement with later seasons, before the matchday-six offers');
      const appeal = appealOf(at.seasonNumber, boundary.completedRounds, agreement.clubId);
      const best = bestOfferAfterExit({ world: worldOf(state), seed: state.seed, commercial: replay, agreement, window: 'renewal', anchor: at, appeal, ...leagueOf(agreement.clubId), ...(state.economySeasons ? { economySeasons: state.economySeasons } : {}) });
      if (!best || !clearlyBetterFee(agreement.annualFee, best.annualFee)) fail(path, 'must leave an agreement only for a clearly better offer');
      if (!cashAllows(agreement.clubId, at.ledgerCount, terms.fee, automaticKeep(agreement.clubId, at.seasonNumber))) fail(path, 'must leave an agreement only while the club can pay the fee and keep half its cash cushion');
      setExit(agreement.id, { by: 'club', reason: 'club', seasonNumber: at.seasonNumber, round: at.round, date: at.date, lastSeason: terms.lastSeason, amount: terms.fee });
      previous = at; index += 1;
    }
  };
  /** After the final matchday, offers are set in next season's divisions where the club plays in one (as live). */
  const offerLeague = (boundary: Extract<Boundary, { kind: 'window' }>, clubId: string): SponsorLeague => {
    const world = worldOf(state), ids = fullWorldClubsIn(state, boundary.seasonNumber).map(club => club.id);
    const nextDivisions = boundary.window === 'second-round' && state.divisions ? boundary.seasonNumber < state.seasonNumber ? seasonDivisions(boundary.seasonNumber + 1) : nextSeasonDivisions(state) : undefined;
    const next = nextDivisions && seasonLeagues(world, nextDivisions).some(league => league.clubIds.includes(clubId));
    return next ? sponsorLeague(world, nextDivisions, ids, clubId) : sponsorLeague(world, seasonDivisions(boundary.seasonNumber), ids, clubId);
  };
  const consumeWindow = (boundary: Extract<Boundary, { kind: 'window' }>) => {
    if (clauses && boundary.window === 'second-round') consumeExits(boundary);
    let at: CommercialAnchor | null = boundary.activation ? activation : null;
    const seasonClubs = fullWorldClubsIn(state, boundary.seasonNumber);
    const leagueOf = (clubId: string) => clauses ? { league: offerLeague(boundary, clubId) } : {};
    if (clauses && boundary.window === 'renewal' && !boundary.activation) consumeAutomaticExits(boundary, seasonClubs, leagueOf);
    for (const club of seasonClubs) {
      if (!needsSponsorshipOffers(replay, club.id, boundary.seasonNumber) || boundary.seasonNumber >= MAX_SEASON_NUMBER) continue;
      const appeal = appealOf(boundary.seasonNumber, boundary.completedRounds, club.id);
      // Availability, not the boundary's ledger position, decides whether any offer exists; no offer means no event.
      if (!buildSponsorshipOffers({ world: worldOf(state), seed: state.seed, commercial: replay, clubId: club.id, window: boundary.window, anchor: at ?? { seasonNumber: boundary.seasonNumber, round: boundary.round, date: boundary.date, ledgerCount: 0 }, appeal, ...leagueOf(club.id), ...(state.economySeasons ? { economySeasons: state.economySeasons } : {}) }).length) continue;
      if (!at) {
        const first = index < events.length ? eventAt(index) : null;
        if (first?.type !== 'offers') fail(`commercial.events[${index}]`, 'is missing sponsorship offers owed at a calendar boundary');
        at = anchorOfEvent(first);
        if (at.seasonNumber !== boundary.seasonNumber || at.round !== boundary.round || at.date !== boundary.date || boundary.window === 'second-round' && at.ledgerCount < completionStart(boundary.seasonNumber)) fail(`commercial.events[${index}]`, 'must occur at its sponsorship calendar boundary');
      }
      const expected = buildSponsorshipOffers({ world: worldOf(state), seed: state.seed, commercial: replay, clubId: club.id, window: boundary.window, anchor: at, appeal, ...leagueOf(club.id), ...(state.economySeasons ? { economySeasons: state.economySeasons } : {}) });
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
    // Format 69: a period without a club (an empty club id) hands no club to the manager, and takes none from them.
    replay = { ...replay, plans: { ...replay.plans, ...(move.fromClubId ? { [move.fromClubId]: { delegated: true } } : {}), ...(move.toClubId ? { [move.toClubId]: { delegated: false } } : {}) } };
    consumeAutomation({ seasonNumber: move.seasonNumber, round: move.round ?? seasonRounds(state), date: move.date, ledgerCount: move.ledgerCount });
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
    if (event.type === 'offers' || event.type === 'expire' || event.type === 'exit') fail(path, 'must occur at a sponsorship calendar boundary');
    previous = at; index += 1;
    if (event.type === 'terminate') {
      // Format 64: the managed club ends an agreement early during the season; notice runs to this season's end.
      const agreement = replay.agreements.find(item => item.id === event.agreementId);
      const terms = agreement && terminationTerms(agreement, at.seasonNumber);
      const duringSeason = at.round < seasonRounds(state) || at.ledgerCount < completionStart(at.seasonNumber);
      if (!clauses || !agreement?.clause || agreement.exit || agreement.clubId !== managedAt(event) || !terms || terms.cancelledSeasons < 1 || !duringSeason) fail(path, 'must end an agreement of the managed club with later seasons, during the season');
      if (!cashAllows(agreement.clubId, at.ledgerCount, terms.fee, 0)) fail(path, 'must end an agreement only when the club can pay the termination fee');
      setExit(agreement.id, { by: 'club', reason: 'club', seasonNumber: at.seasonNumber, round: at.round, date: at.date, lastSeason: terms.lastSeason, amount: terms.fee });
      return;
    }
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
      const response = respondToSponsorshipRequest(state.seed, offer, mediaSponsorBonus(state, offer.id));
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
    // Format 63 (career-2): a mid-season move follows its week's opening and precedes the new manager's commands; an
    // offseason resignation follows the season's completion.
    for (const move of state.career?.moves ?? []) if (move.seasonNumber === season && move.ledgerCount >= activation.ledgerCount) boundaries.push({ kind: 'move', move, key: move.phase === 'season' ? [ordinal(season, move.round!, seasonRounds(state)), -0.5] : [ordinal(season, seasonRounds(state), seasonRounds(state)), move.phase === 'offseason' ? 1.5 : 0.5] });
    if (season < state.seasonNumber || state.status === 'complete') boundaries.push({ kind: 'window', window: 'second-round', seasonNumber: season, round: seasonRounds(state), date: dateForRound(seasonRounds(state), season), completedRounds: seasonRounds(state), activation: false, key: [ordinal(season, seasonRounds(state), seasonRounds(state)), 1] });
  }
  boundaries.sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1]);
  // Incremental checkpoint checks (`trusted-prefix.ts`): commands and calendar boundaries before the trusted checkpoint's
  // week are unchanged, so the replay resumes where its check reached that week; everything later replays in full.
  const plan = prefixPlan('commercial.events', events as CommercialEvent[], event => roundKey(event.seasonNumber, event.round));
  const cutOrdinal = ordinal(state.seasonNumber, state.round, seasonRounds(state));
  interface Resume { replay: SeasonCommercial; index: number; previous: CommercialAnchor; boundary: number }
  let recorded = false;
  const rememberAt = (boundary: number, at: number) => {
    if (recorded || at < cutOrdinal || index !== plan.record) return;
    remember('commercial.events', 'replay', { replay, index, previous, boundary } satisfies Resume); recorded = true;
  };
  const saved = plan.skip > 0 ? recall<Resume>('commercial.events', 'replay') : undefined;
  const resume = saved && saved.index === plan.skip ? saved : undefined;
  if (resume) ({ replay, index, previous } = resume);
  for (let position = resume ? resume.boundary : 0; position < boundaries.length; position += 1) {
    const boundary = boundaries[position]!;
    while (index < events.length && before(keyOf(eventAt(index)), boundary.key)) { rememberAt(position, keyOf(eventAt(index))[0]); consumeManual(); }
    rememberAt(position, boundary.key[0]);
    if (boundary.kind === 'window') consumeWindow(boundary); else if (boundary.kind === 'move') consumeMove(boundary); else consumeExpiry(boundary);
  }
  while (index < events.length) { rememberAt(boundaries.length, keyOf(eventAt(index))[0]); consumeManual(); }
  rememberAt(boundaries.length, Infinity);

  if (!equal(replay.plans, fields.plans)) fail('commercial.plans', 'must match the recorded control changes');
  if (clauses) {
    validateNamingRights(state, fields.naming, activation, planClubs.map(club => club.id));
    replayNaming();
  }
  if (!equal(replay.offers, fields.offers)) fail('commercial.offers', 'must exactly match the offers, requests and outcomes rebuilt from the calendar');
  if (!equal(replay.agreements, fields.agreements)) fail('commercial.agreements', 'must exactly match inherited agreements and accepted offers');
  if (replay.offers.some(offer => offer.status === 'open' && offer.forSeason <= state.seasonNumber)) fail('commercial.offers', 'cannot keep an offer open after its season has begun');

  /**
   * Format 64 (exact since 22 November 2026): rebuild arena naming rights from activation at the same calendar
   * boundaries as the main sponsor: each window's offers regenerated from the club's evidence, arena seats and money,
   * sponsors' clause exits decided again at each season end, automatic early exits and acceptances recomputed, and the
   * manager's commands applied by the live rules. The stored plans, offers and agreements must match exactly.
   */
  function replayNaming(): void {
    const stored = fields.naming as SeasonNamingRights, list = stored.events as CommercialEvent[];
    let naming: SeasonNamingRights = { plans: createCommercial([...planClubs], managedClubAtLedger(state, activation.ledgerCount), 'commercial-2').naming!.plans, agreements: [], offers: [], events: [] };
    let at = 0;
    const pathAt = (position: number) => `commercial.naming.events[${position}]`;
    // Shapes and calendar order were checked by `validateNamingRights`.
    const next = () => list[at]!;
    const setNamingExit = (agreementId: string, exit: CommercialExit) => { naming = { ...naming, agreements: naming.agreements.map(item => item.id === agreementId ? { ...item, exit } : item) }; };
    const acceptable = (offer: NamingRightsOffer, date: string) => offer.status === 'open' && date <= offer.expiresOn && !namingAgreementFor(naming, offer.clubId, offer.forSeason) && namingSponsorAvailable(naming, offer.sponsorId, offer.clubId, offer.forSeason);
    const accept = (offer: NamingRightsOffer, anchorAt: CommercialAnchor, agreementId: unknown, automatic: boolean, path: string) => {
      const id = `naming-agreement-${naming.agreements.length + 1}`;
      if (agreementId !== id) fail(`${path}.agreementId`, 'must identify the next sequential naming agreement');
      const agreement: NamingRightsAgreement = { id, clubId: offer.clubId, sponsorId: offer.sponsorId, offerId: offer.id, arenaName: offer.arenaName, startsSeason: offer.forSeason, endsSeason: offer.forSeason + offer.seasons - 1, annualFee: offer.annualFee, signedOn: anchorAt.date, automatic, clause: sponsorClause(null, offer.appeal, offer.annualFee), exit: null };
      naming = { ...naming, agreements: [...naming.agreements, agreement], offers: naming.offers.map(item => item.id === offer.id ? { ...item, status: 'accepted', closedOn: anchorAt.date } : item.clubId === offer.clubId && item.status === 'open' ? { ...item, status: 'superseded', closedOn: anchorAt.date } : item) };
    };
    /** Automatic control leaves no acceptable naming offer waiting for a delegated club. */
    const automation = (anchorAt: CommercialAnchor) => {
      for (const club of fullWorldClubsIn(state, anchorAt.seasonNumber)) {
        if (!naming.plans[club.id]?.delegated) continue;
        const best = bestNamingOffer(naming.offers.filter(offer => offer.clubId === club.id && acceptable(offer, anchorAt.date)));
        if (!best) continue;
        const path = pathAt(at);
        if (at >= list.length) fail('commercial.naming.events', 'is missing an automatic naming-rights acceptance');
        const event = next();
        if (event.type !== 'accept' || !sameAnchor(event, anchorAt) || event.offerId !== best.id) fail(path, 'must accept the best guaranteed naming offer for an automatically managed club');
        accept(best, anchorAt, event.agreementId, true, path);
        at += 1;
      }
    };
    /** Arena seats against the league's average venue, league level and the sponsorship benchmark (`namingBasis`). */
    const basis = (boundary: Extract<Boundary, { kind: 'window' }>, clubId: string, date: string): NamingRightsOffer['basis'] => {
      const world = worldOf(state), league = offerLeague(boundary, clubId);
      const leagueCapacity = Math.round(league.clubIds.reduce((sum, id) => sum + clubFinanceDefinition(world, id).capacity, 0) / Math.max(1, league.clubIds.length));
      const money = { seasonNumber: boundary.window === 'second-round' ? boundary.seasonNumber + 1 : boundary.seasonNumber, ...(state.economySeasons ? { economySeasons: state.economySeasons } : {}) };
      return { benchmark: sponsorshipReferenceFee(world, clubId, money), capacity: getArenaFullCapacity(state, clubId, date), leagueCapacity, tier: league.tier };
    };
    const appealAt = (boundary: Extract<Boundary, { kind: 'window' }>, clubId: string) => appealOf(boundary.seasonNumber, boundary.completedRounds, clubId);
    const atBoundary = (event: CommercialEvent, boundary: Extract<Boundary, { kind: 'window' }>) => event.seasonNumber === boundary.seasonNumber && event.round === boundary.round && event.date === boundary.date;
    /** Sponsors leaving under their clause after the final matchday, after the main sponsors' exits. */
    const exits = (boundary: Extract<Boundary, { kind: 'window' }>) => {
      const seasonNumber = boundary.seasonNumber, seasonClubs = new Set(fullWorldClubsIn(state, seasonNumber).map(club => club.id));
      for (const agreement of naming.agreements.filter(item => seasonClubs.has(item.clubId) && item.clause && !item.exit && agreementLastSeason(item) > seasonNumber)) {
        const reason = sponsorExitDecision(state.seed, agreement, seasonNumber, exitEvidence(seasonNumber, agreement.clubId));
        if (!reason) continue;
        const path = pathAt(at);
        if (at >= list.length) fail('commercial.naming.events', 'is missing a naming sponsor exit its clause decided at a season end');
        const event = next() as Extract<CommercialEvent, { type: 'exit' }>;
        if (event.type !== 'exit' || event.agreementId !== agreement.id || event.reason !== reason) fail(path, 'must record exactly the naming sponsor exits the clauses decide at the season end, in agreement order');
        if (!atBoundary(event, boundary) || event.ledgerCount < completionStart(seasonNumber)) fail(path, 'must occur at its season end');
        setNamingExit(agreement.id, { by: 'sponsor', reason, seasonNumber, round: event.round, date: event.date, lastSeason: seasonNumber, amount: agreement.clause.exitPayment });
        at += 1;
      }
    };
    /** Automatic control's early naming exits at matchday six, right before that window's naming offers. */
    const automaticExits = (boundary: Extract<Boundary, { kind: 'window' }>) => {
      let end = at;
      while (end < list.length && list[end]?.type === 'terminate') end += 1;
      const following = end > at && end < list.length ? list[end]! : null;
      if (!following || following.type !== 'offers' || !atBoundary(following, boundary)) return;
      const seasonClubs = fullWorldClubsIn(state, boundary.seasonNumber);
      while (at < end) {
        const path = pathAt(at), event = next() as Extract<CommercialEvent, { type: 'terminate' }>, anchorAt = anchorOfEvent(event);
        const agreement = naming.agreements.find(item => item.id === event.agreementId);
        const terms = agreement && terminationTerms(agreement, anchorAt.seasonNumber);
        if (!atBoundary(event, boundary) || !agreement || agreement.exit || !naming.plans[agreement.clubId]?.delegated || agreement.startsSeason > anchorAt.seasonNumber || !terms || terms.cancelledSeasons < 1 || !seasonClubs.some(club => club.id === agreement.clubId)) fail(path, 'must end an automatically managed club\'s current naming agreement with later seasons, before the matchday-six offers');
        const best = bestNamingOfferAfterExit({ world: worldOf(state), seed: state.seed, naming, agreement, window: 'renewal', anchor: anchorAt, appeal: appealAt(boundary, agreement.clubId), basis: basis(boundary, agreement.clubId, anchorAt.date) });
        if (!best || !clearlyBetterFee(agreement.annualFee, best.annualFee)) fail(path, 'must leave a naming agreement only for a clearly better offer');
        if (!cashAllows(agreement.clubId, anchorAt.ledgerCount, terms.fee, automaticKeep(agreement.clubId, anchorAt.seasonNumber))) fail(path, 'must leave a naming agreement only while the club can pay the fee and keep half its cash cushion');
        setNamingExit(agreement.id, { by: 'club', reason: 'club', seasonNumber: anchorAt.seasonNumber, round: anchorAt.round, date: anchorAt.date, lastSeason: terms.lastSeason, amount: terms.fee });
        at += 1;
      }
    };
    const window = (boundary: Extract<Boundary, { kind: 'window' }>) => {
      if (boundary.window === 'second-round') exits(boundary);
      if (boundary.window === 'renewal' && !boundary.activation) automaticExits(boundary);
      let anchorAt: CommercialAnchor | null = boundary.activation ? activation : null;
      for (const club of fullWorldClubsIn(state, boundary.seasonNumber)) {
        if (!needsNamingOffers(naming, club.id, boundary.seasonNumber) || boundary.seasonNumber >= MAX_SEASON_NUMBER) continue;
        const appeal = appealAt(boundary, club.id), terms = basis(boundary, club.id, boundary.date);
        const build = (anchor: CommercialAnchor) => buildNamingOffers({ world: worldOf(state), seed: state.seed, naming, clubId: club.id, window: boundary.window, anchor, appeal, basis: terms });
        // Availability, not the ledger position, decides whether any offer exists; no offer means no event.
        if (!build(anchorAt ?? { seasonNumber: boundary.seasonNumber, round: boundary.round, date: boundary.date, ledgerCount: 0 }).length) continue;
        const path = pathAt(at);
        if (at >= list.length) fail('commercial.naming.events', 'is missing naming-rights offers owed at a calendar boundary');
        const event = next();
        if (!anchorAt) {
          if (event.type !== 'offers') fail(path, 'is missing naming-rights offers owed at a calendar boundary');
          anchorAt = anchorOfEvent(event);
          if (!atBoundary(event, boundary) || boundary.window === 'second-round' && anchorAt.ledgerCount < completionStart(boundary.seasonNumber)) fail(path, 'must occur at its naming-rights calendar boundary');
        }
        const expected = build(anchorAt);
        if (event.type !== 'offers' || !sameAnchor(event, anchorAt) || event.clubId !== club.id || event.window !== boundary.window || event.completedRounds !== boundary.completedRounds || !equal(event.offerIds, expected.map(offer => offer.id))) fail(path, 'must record exactly the naming offers owed to each club at this boundary, in club order');
        naming = { ...naming, offers: [...naming.offers, ...expected] };
        at += 1;
      }
      if (anchorAt) automation(anchorAt);
    };
    const move = (boundary: Extract<Boundary, { kind: 'move' }>) => {
      const { move: change } = boundary;
      naming = { ...naming, plans: { ...naming.plans, ...(change.fromClubId ? { [change.fromClubId]: { delegated: true } } : {}), ...(change.toClubId ? { [change.toClubId]: { delegated: false } } : {}) } };
      automation({ seasonNumber: change.seasonNumber, round: change.round ?? seasonRounds(state), date: change.date, ledgerCount: change.ledgerCount });
    };
    const expiry = (boundary: Extract<Boundary, { kind: 'expire' }>) => {
      const expired = naming.offers.filter(offer => offer.status === 'open' && offer.forSeason <= boundary.seasonNumber).map(offer => offer.id);
      if (!expired.length) return;
      const path = pathAt(at);
      if (at >= list.length) fail('commercial.naming.events', 'is missing the expiry of naming offers at a season opening');
      const event = next();
      if (event.type !== 'expire' || event.seasonNumber !== boundary.seasonNumber || event.round !== 1 || event.date !== boundary.date || !equal(event.offerIds, expired)) fail(path, 'must expire exactly the naming offers that could no longer start, at the season opening');
      const ids = new Set(expired);
      naming = { ...naming, offers: naming.offers.map(offer => ids.has(offer.id) ? { ...offer, status: 'expired', closedOn: event.date } : offer) };
      at += 1;
    };
    const manual = () => {
      const path = pathAt(at), event = next(), anchorAt = anchorOfEvent(event);
      if (event.type === 'offers' || event.type === 'expire' || event.type === 'exit') fail(path, 'must occur at a naming-rights calendar boundary');
      at += 1;
      if (event.type === 'terminate') {
        const agreement = naming.agreements.find(item => item.id === event.agreementId);
        const terms = agreement && terminationTerms(agreement, anchorAt.seasonNumber);
        const duringSeason = anchorAt.round < seasonRounds(state) || anchorAt.ledgerCount < completionStart(anchorAt.seasonNumber);
        if (!agreement || agreement.exit || agreement.clubId !== managedAt(event) || !terms || terms.cancelledSeasons < 1 || !duringSeason) fail(path, 'must end a naming agreement of the managed club with later seasons, during the season');
        if (!cashAllows(agreement.clubId, anchorAt.ledgerCount, terms.fee, 0)) fail(path, 'must end a naming agreement only when the club can pay the termination fee');
        setNamingExit(agreement.id, { by: 'club', reason: 'club', seasonNumber: anchorAt.seasonNumber, round: anchorAt.round, date: anchorAt.date, lastSeason: terms.lastSeason, amount: terms.fee });
        return;
      }
      if (event.type === 'policy') {
        if (event.clubId !== managedAt(event) || typeof event.delegated !== 'boolean' || naming.plans[event.clubId]?.delegated === event.delegated) fail(path, 'must change the managed club between manual and automatic naming-rights control');
        naming = { ...naming, plans: { ...naming.plans, [event.clubId]: { delegated: event.delegated } } };
        automation(anchorAt);
        return;
      }
      const offer = naming.offers.find(item => item.id === event.offerId);
      if (!offer || offer.clubId !== managedAt(event) || offer.status !== 'open' || anchorAt.date > offer.expiresOn) fail(path, 'must act on an open naming offer made to the managed club');
      if (event.type === 'decline') { naming = { ...naming, offers: naming.offers.map(item => item.id === offer.id ? { ...item, status: 'declined', closedOn: anchorAt.date } : item) }; return; }
      if (event.type === 'request') {
        if (offer.request) fail(path, 'can ask each naming sponsor for better terms only once');
        const response = respondToSponsorshipRequest(state.seed, offer);
        naming = { ...naming, offers: naming.offers.map(item => item.id === offer.id ? { ...item, request: response.request, annualFee: response.annualFee, status: response.status, closedOn: response.status === 'open' ? null : anchorAt.date } : item) };
        return;
      }
      if (naming.plans[offer.clubId]?.delegated || !acceptable(offer, anchorAt.date)) fail(path, 'must accept an available naming offer while the club manages naming rights manually');
      accept(offer, anchorAt, event.agreementId, false, path);
    };

    // Incremental checkpoint checks (`trusted-prefix.ts`): as for the main sponsor, resume where the trusted check reached
    // its week; everything later replays in full.
    const namingPlan = prefixPlan('commercial.naming.events', list, event => roundKey(event.seasonNumber, event.round));
    interface NamingResume { naming: SeasonNamingRights; at: number; boundary: number }
    let kept = false;
    const keep = (boundary: number, key: number) => {
      if (kept || key < cutOrdinal || at !== namingPlan.record) return;
      remember('commercial.naming.events', 'replay', { naming, at, boundary } satisfies NamingResume); kept = true;
    };
    const saved = namingPlan.skip > 0 ? recall<NamingResume>('commercial.naming.events', 'replay') : undefined;
    const resumed = saved && saved.at === namingPlan.skip ? saved : undefined;
    if (resumed) ({ naming, at } = resumed);
    for (let position = resumed ? resumed.boundary : 0; position < boundaries.length; position += 1) {
      const boundary = boundaries[position]!;
      while (at < list.length && before(keyOf(next()), boundary.key)) { keep(position, keyOf(next())[0]); manual(); }
      keep(position, boundary.key[0]);
      if (boundary.kind === 'window') window(boundary); else if (boundary.kind === 'move') move(boundary); else expiry(boundary);
    }
    while (at < list.length) { keep(boundaries.length, keyOf(next())[0]); manual(); }
    keep(boundaries.length, Infinity);
    if (!equal(naming.plans, stored.plans)) fail('commercial.naming.plans', 'must match the recorded control changes');
    if (!equal(naming.offers, stored.offers)) fail('commercial.naming.offers', 'must exactly match the naming offers, requests and outcomes rebuilt from the calendar');
    if (!equal(naming.agreements, stored.agreements)) fail('commercial.naming.agreements', 'must exactly match the accepted naming offers and their early ends');
  }
}
