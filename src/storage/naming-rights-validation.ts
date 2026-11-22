import type { CommercialAnchor, CommercialExit, NamingRightsAgreement, NamingRightsOffer } from '../domain/commercial';
import type { SeasonState } from '../domain/season';
import { seasonRounds, worldOf } from '../world/career-world';
import { COMMERCIAL_CLAUSE_RULES, namingArenaName, sponsorClause, SPONSORSHIP_MAX_APPEAL, SPONSORSHIP_MIN_APPEAL } from '../world/commercial-policy';
import { MAX_SEASON_NUMBER, seasonStartDate } from '../world/season';
import { financeLedgerCount } from '../world/finance-ledger';

/**
 * Format 64: the shape checks for arena naming rights — exact shapes, sequential identities, offers and agreements that
 * agree with each other, exits whose amounts follow the clause, and events in calendar order. The finance validator
 * checks every installment and exit payment against these agreements. Since 22 November 2026 `validateCommercial` also
 * rebuilds every naming offer, exit and acceptance from the calendar (`replayNaming`), as the main-sponsor replay does.
 */
const OFFER_KEYS = ['id', 'clubId', 'sponsorId', 'window', 'madeAt', 'appeal', 'forSeason', 'seasons', 'initialAnnualFee', 'annualFee', 'arenaName', 'basis', 'expiresOn', 'status', 'closedOn', 'request'] as const;
const AGREEMENT_KEYS = ['id', 'clubId', 'sponsorId', 'offerId', 'arenaName', 'startsSeason', 'endsSeason', 'annualFee', 'signedOn', 'automatic', 'clause', 'exit'] as const;
const ANCHOR_KEYS = ['seasonNumber', 'round', 'date', 'ledgerCount'] as const;
const STATUSES = ['open', 'accepted', 'declined', 'withdrawn', 'superseded', 'expired'];
const EVENT_KEYS: Record<string, readonly string[]> = {
  offers: ['clubId', 'window', 'completedRounds', 'offerIds'], request: ['offerId'], accept: ['offerId', 'agreementId'], decline: ['offerId'], policy: ['clubId', 'delegated'], expire: ['offerIds'],
  exit: ['agreementId', 'reason'], terminate: ['agreementId'],
};
const MAX_FEE = 1_000_000_000_000;
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
function date(value: unknown, path: string, latest: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value > latest) fail(path, 'must be an actual career date');
  return value;
}
function same(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }

export function validateNamingRights(state: SeasonState, value: unknown, activation: CommercialAnchor, planClubIds: readonly string[]): void {
  const fields = record(value, 'commercial.naming', ['plans', 'agreements', 'offers', 'events']);
  const world = worldOf(state), sponsors = new Set(world.sponsors.map(sponsor => sponsor.id)), clubs = new Set(planClubIds);
  const plans = record(fields.plans, 'commercial.naming.plans', planClubIds);
  for (const clubId of planClubIds) {
    const plan = record(plans[clubId], `commercial.naming.plans.${clubId}`, ['delegated']);
    if (typeof plan.delegated !== 'boolean' || clubId !== state.managedClubId && !plan.delegated) fail(`commercial.naming.plans.${clubId}.delegated`, 'must be boolean; rival clubs always manage naming rights automatically');
  }
  const limit = 200 * planClubIds.length * state.seasonNumber;
  if (!Array.isArray(fields.offers) || !Array.isArray(fields.agreements) || !Array.isArray(fields.events) || fields.offers.length > limit || fields.agreements.length > limit || fields.events.length > limit) fail('commercial.naming', 'must contain bounded agreements, offers and events');
  const ledgerCount = financeLedgerCount(state.finance), rounds = seasonRounds(state);
  const anchor = (raw: unknown, path: string): CommercialAnchor => {
    const at = record(raw, path, ANCHOR_KEYS);
    const seasonNumber = integer(at.seasonNumber, `${path}.seasonNumber`, activation.seasonNumber, state.seasonNumber);
    return { seasonNumber, round: integer(at.round, `${path}.round`, 1, seasonNumber === state.seasonNumber ? state.round : rounds), date: date(at.date, `${path}.date`, state.date), ledgerCount: integer(at.ledgerCount, `${path}.ledgerCount`, activation.ledgerCount, ledgerCount) };
  };

  const offers = (fields.offers as unknown[]).map((raw, index): NamingRightsOffer => {
    const path = `commercial.naming.offers[${index}]`, offer = record(raw, path, OFFER_KEYS);
    if (offer.id !== `naming-offer-${index + 1}`) fail(`${path}.id`, 'must use sequential identities');
    if (typeof offer.clubId !== 'string' || !clubs.has(offer.clubId) || typeof offer.sponsorId !== 'string' || !sponsors.has(offer.sponsorId)) fail(path, 'must name a club and a sponsor of this world');
    if (offer.window !== 'renewal' && offer.window !== 'second-round') fail(`${path}.window`, 'is unsupported');
    const madeAt = anchor(offer.madeAt, `${path}.madeAt`);
    if (typeof offer.appeal !== 'number' || offer.appeal < SPONSORSHIP_MIN_APPEAL || offer.appeal > SPONSORSHIP_MAX_APPEAL) fail(`${path}.appeal`, 'must stay within the appeal bounds');
    const forSeason = integer(offer.forSeason, `${path}.forSeason`, madeAt.seasonNumber + 1, madeAt.seasonNumber + 1);
    if (forSeason > MAX_SEASON_NUMBER) fail(`${path}.forSeason`, 'must be a playable season');
    integer(offer.seasons, `${path}.seasons`, COMMERCIAL_CLAUSE_RULES.namingMinSeasons, COMMERCIAL_CLAUSE_RULES.namingMaxSeasons);
    const initial = integer(offer.initialAnnualFee, `${path}.initialAnnualFee`, 1, MAX_FEE), fee = integer(offer.annualFee, `${path}.annualFee`, initial, MAX_FEE);
    if (offer.arenaName !== namingArenaName(world, offer.sponsorId)) fail(`${path}.arenaName`, 'must carry the sponsor\'s arena name');
    const basis = record(offer.basis, `${path}.basis`, ['benchmark', 'capacity', 'leagueCapacity', 'tier']);
    for (const key of ['benchmark', 'capacity', 'leagueCapacity', 'tier'] as const) integer(basis[key], `${path}.basis.${key}`, 1, MAX_FEE);
    if (offer.expiresOn !== dayBefore(seasonStartDate(forSeason))) fail(`${path}.expiresOn`, 'must be the day before its season starts');
    if (typeof offer.status !== 'string' || !STATUSES.includes(offer.status) || (offer.status === 'open') !== (offer.closedOn === null) || offer.closedOn !== null && date(offer.closedOn, `${path}.closedOn`, state.date) < madeAt.date) fail(`${path}.status`, 'must be open, or closed on a career date after the offer');
    if (offer.status === 'open' && forSeason <= state.seasonNumber) fail(`${path}.status`, 'cannot stay open after its season has begun');
    if (offer.request !== null) {
      const request = record(offer.request, `${path}.request`, ['askedAnnualFee', 'response']);
      integer(request.askedAnnualFee, `${path}.request.askedAnnualFee`, initial, MAX_FEE);
      if (!['accepted', 'countered', 'withdrawn'].includes(request.response as string)) fail(`${path}.request.response`, 'is unsupported');
    } else if (fee !== initial) fail(`${path}.annualFee`, 'can change only after a request for better terms');
    return offer as unknown as NamingRightsOffer;
  });

  const agreements = (fields.agreements as unknown[]).map((raw, index): NamingRightsAgreement => {
    const path = `commercial.naming.agreements[${index}]`, agreement = record(raw, path, AGREEMENT_KEYS);
    if (agreement.id !== `naming-agreement-${index + 1}`) fail(`${path}.id`, 'must use sequential identities');
    const offer = offers.find(item => item.id === agreement.offerId);
    if (!offer || offer.status !== 'accepted' || agreement.clubId !== offer.clubId || agreement.sponsorId !== offer.sponsorId || agreement.arenaName !== offer.arenaName || agreement.startsSeason !== offer.forSeason || agreement.endsSeason !== offer.forSeason + offer.seasons - 1 || agreement.annualFee !== offer.annualFee || agreement.signedOn !== offer.closedOn) fail(path, 'must carry exactly the terms of its accepted offer');
    if (typeof agreement.automatic !== 'boolean') fail(`${path}.automatic`, 'must be boolean');
    const clause = sponsorClause(null, offer.appeal, offer.annualFee);
    if (!same(agreement.clause, clause)) fail(`${path}.clause`, 'must follow the exit rules for its fee');
    if (agreement.exit !== null) {
      const exitPath = `${path}.exit`, exit = record(agreement.exit, exitPath, ['by', 'reason', 'seasonNumber', 'round', 'date', 'lastSeason', 'amount']);
      const seasonNumber = integer(exit.seasonNumber, `${exitPath}.seasonNumber`, activation.seasonNumber, state.seasonNumber);
      integer(exit.round, `${exitPath}.round`, 1, rounds);
      date(exit.date, `${exitPath}.date`, state.date);
      const lastSeason = integer(exit.lastSeason, `${exitPath}.lastSeason`, offer.forSeason - 1, offer.forSeason + offer.seasons - 2);
      const sponsorExit = exit.by === 'sponsor' && ['relegation', 'objective', 'decline'].includes(exit.reason as string);
      const clubExit = exit.by === 'club' && exit.reason === 'club';
      const expected = sponsorExit ? clause.exitPayment : clause.terminationFee * (offer.forSeason + offer.seasons - 1 - lastSeason);
      const expectedLast = sponsorExit ? seasonNumber : Math.max(seasonNumber, offer.forSeason - 1);
      if (!sponsorExit && !clubExit || lastSeason !== expectedLast || exit.amount !== expected) fail(exitPath, 'must end the agreement at its notice season with the agreed payment');
      if (sponsorExit && exit.round !== rounds) fail(exitPath, 'must follow a season end when the sponsor leaves');
    }
    return agreement as unknown as NamingRightsAgreement;
  });
  if (offers.filter(offer => offer.status === 'accepted').length !== agreements.length) fail('commercial.naming.agreements', 'must hold one agreement for each accepted offer');
  // One naming partner per arena and season.
  for (const [index, agreement] of agreements.entries()) {
    const last = (item: { endsSeason: number; exit: CommercialExit | null }) => item.exit ? Math.min(item.endsSeason, item.exit.lastSeason) : item.endsSeason;
    if (agreements.some((other, position) => position !== index && other.clubId === agreement.clubId && other.startsSeason <= last(agreement) && agreement.startsSeason <= last(other) && agreement.startsSeason <= last(agreement) && other.startsSeason <= last(other))) fail(`commercial.naming.agreements[${index}]`, 'cannot overlap another naming agreement of the same arena');
  }

  let previous = activation, accepts = 0, exits = 0;
  for (const [index, raw] of (fields.events as unknown[]).entries()) {
    const path = `commercial.naming.events[${index}]`;
    const type = (raw as { type?: unknown } | null)?.type;
    if (typeof type !== 'string' || !Object.hasOwn(EVENT_KEYS, type)) fail(`${path}.type`, 'is unsupported');
    const event = record(raw, path, ['type', ...ANCHOR_KEYS, ...EVENT_KEYS[type]!]);
    const at = anchor(Object.fromEntries(ANCHOR_KEYS.map(key => [key, event[key]])), path);
    if (at.seasonNumber < previous.seasonNumber || at.seasonNumber === previous.seasonNumber && at.round < previous.round || at.date < previous.date || at.ledgerCount < previous.ledgerCount) fail(path, 'must keep chronological calendar and ledger order');
    previous = at;
    if (type === 'accept') {
      if (event.agreementId !== `naming-agreement-${accepts + 1}` || agreements[accepts]?.offerId !== event.offerId) fail(path, 'must sign the next naming agreement from its offer');
      accepts += 1;
    } else if (type === 'exit' || type === 'terminate') {
      const agreement = agreements.find(item => item.id === event.agreementId);
      if (!agreement?.exit || agreement.exit.by !== (type === 'exit' ? 'sponsor' : 'club') || agreement.exit.date !== at.date || type === 'exit' && agreement.exit.reason !== event.reason) fail(path, 'must record the early end of a naming agreement');
      exits += 1;
    } else if (type === 'policy') {
      if (typeof event.delegated !== 'boolean' || typeof event.clubId !== 'string' || !clubs.has(event.clubId)) fail(path, 'must change one club between manual and automatic control');
    } else if (type === 'offers' || type === 'expire') {
      if (!Array.isArray(event.offerIds) || event.offerIds.some(id => !offers.some(offer => offer.id === id))) fail(path, 'must name recorded offers');
    } else if (!offers.some(offer => offer.id === event.offerId)) fail(path, 'must name a recorded offer');
  }
  if (accepts !== agreements.length || exits !== agreements.filter(agreement => agreement.exit).length) fail('commercial.naming.events', 'must record every signing and early end');
}
