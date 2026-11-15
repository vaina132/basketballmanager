import type { CommercialAnchor, SeasonCommercial, SponsorshipAgreement, SponsorshipOffer, SponsorshipPayment, SponsorshipRequest, SponsorshipWindow } from '../domain/commercial';
import type { FinanceEntry } from '../domain/finance';
import type { ArchivedFixture, SeasonFixture } from '../domain/season';
import type { Team } from '../domain/types';
import type { CareerWorld } from '../domain/world';
import { clubFinanceDefinition } from './career-world';
import { seasonStartDate } from './season';

/** The fixed sponsorship that negotiations replace: EUR 200,000 a season, in euro cents. */
export const SPONSORSHIP_REFERENCE_FEE = 20_000_000;
export const SPONSORSHIP_MIN_APPEAL = 0.75;
export const SPONSORSHIP_MAX_APPEAL = 1.25;
export const SPONSORSHIP_OFFERS_PER_WINDOW = 3;
/** Renewal offers arrive when a club's final contracted season reaches this matchday; the second installment is also due then. */
export const SPONSORSHIP_RENEWAL_ROUND = 6;
export const SPONSORSHIP_SECOND_INSTALLMENT_ROUND = 6;
export const SPONSORSHIP_REQUEST_PERCENT = 10;
export const SPONSORSHIP_BONUS_PERCENT = 10;
/** Each extra contracted season lowers the annual fee by this share in exchange for security. */
export const SPONSORSHIP_TERM_DISCOUNT = 0.03;
/** Home attendance treated as typical when valuing a club; also used before any home game is played. */
export const SPONSORSHIP_NEUTRAL_FILL = 0.8;
const FEE_STEP = 100_000;

function hash(seed: number, key: string): number {
  let value = (2166136261 ^ seed) >>> 0;
  for (let index = 0; index < key.length; index += 1) value = Math.imul(value ^ key.charCodeAt(index), 16777619) >>> 0;
  return value;
}
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const roundFee = (value: number) => Math.max(FEE_STEP, Math.round(value / FEE_STEP) * FEE_STEP);
const dayBefore = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

export function createCommercial(clubs: readonly Team[], managedClubId: string): SeasonCommercial {
  return { model: 'commercial-1', enabledSince: null, plans: Object.fromEntries(clubs.map(club => [club.id, { delegated: club.id !== managedClubId }])), agreements: [], offers: [], events: [] };
}

/** Negotiated agreements govern every season after the activation season, whose fixed payment was already made. */
export function commercialGovernsSeason(commercial: SeasonCommercial | undefined, seasonNumber: number): boolean {
  return !!commercial?.enabledSince && seasonNumber > commercial.enabledSince.seasonNumber;
}

export function agreementFor(commercial: SeasonCommercial, clubId: string, seasonNumber: number): SponsorshipAgreement | undefined {
  return commercial.agreements.find(agreement => agreement.clubId === clubId && agreement.startsSeason <= seasonNumber && agreement.endsSeason >= seasonNumber);
}

/** Clubs paid at a season opening, in club order: everyone under fixed sponsorship, otherwise only covered clubs. */
export function openingSponsorshipClubs(commercial: SeasonCommercial | undefined, clubs: readonly Pick<Team, 'id'>[], seasonNumber: number): string[] {
  if (!commercial || !commercialGovernsSeason(commercial, seasonNumber)) return clubs.map(club => club.id);
  return clubs.filter(club => { const agreement = agreementFor(commercial, club.id, seasonNumber); return agreement && !agreement.prepaidSeasons.includes(seasonNumber); }).map(club => club.id);
}

export function sponsorshipInstallment(agreement: Pick<SponsorshipAgreement, 'annualFee'>, installment: 1 | 2): number {
  const first = Math.floor(agreement.annualFee / 2);
  return installment === 1 ? first : agreement.annualFee - first;
}

export function sponsorshipSourceId(agreement: Pick<SponsorshipAgreement, 'id'>, seasonNumber: number, installment: SponsorshipPayment['installment']): string {
  return `sponsorship-${agreement.id}-s${seasonNumber}-${installment}`;
}

export interface DueSponsorshipPayment {
  clubId: string;
  seasonNumber: number;
  round: number;
  sourceId: string;
  amount: number;
  sponsorship: SponsorshipPayment;
}

/**
 * Every payment owed under negotiated agreements through a calendar boundary. Installments fall on the opening
 * matchday and matchday six; the bonus follows the final matchday only for a top-half finish.
 */
export function sponsorshipPaymentsDue(commercial: SeasonCommercial, clubCount: number | ((clubId: string, seasonNumber: number) => number), through: { seasonNumber: number; round: number; complete: boolean }, finalPosition: (seasonNumber: number, clubId: string) => number | null, calendarRounds?: number, inFullWorld: (clubId: string, seasonNumber: number) => boolean = () => true): DueSponsorshipPayment[] {
  const due: DueSponsorshipPayment[] = [];
  for (const agreement of commercial.agreements) {
    for (let season = agreement.startsSeason; season <= Math.min(agreement.endsSeason, through.seasonNumber); season += 1) {
      // A club outside the full world that season receives nothing from its agreement (step 3.4d-2).
      if (!commercialGovernsSeason(commercial, season) || agreement.prepaidSeasons.includes(season) || !inFullWorld(agreement.clubId, season)) continue;
      const payment = (round: number, installment: SponsorshipPayment['installment'], amount: number) => due.push({ clubId: agreement.clubId, seasonNumber: season, round, sourceId: sponsorshipSourceId(agreement, season, installment), amount, sponsorship: { agreementId: agreement.id, sponsorId: agreement.sponsorId, installment } });
      payment(1, 1, sponsorshipInstallment(agreement, 1));
      if (season < through.seasonNumber || through.round >= SPONSORSHIP_SECOND_INSTALLMENT_ROUND) payment(SPONSORSHIP_SECOND_INSTALLMENT_ROUND, 2, sponsorshipInstallment(agreement, 2));
      if (agreement.bonus > 0 && (season < through.seasonNumber || through.complete)) {
        const position = finalPosition(season, agreement.clubId);
        // The bonus follows the final matchday: a double round robin has 2 x (clubs - 1) matchdays.
        const size = typeof clubCount === 'number' ? clubCount : clubCount(agreement.clubId, season);
        if (position !== null && position <= size / 2) payment(calendarRounds ?? 2 * (size - 1), 'bonus', agreement.bonus);
      }
    }
  }
  return due;
}

export interface SponsorAppeal { reach: number; winShare: number; fill: number; appeal: number }

/**
 * Commercial appeal from venue demand relative to the league, this season's results and actual home attendance.
 * Bounded to 75%-125% so negotiations redistribute rather than inflate the fixed EUR 200,000 benchmark.
 */
export function sponsorAppeal(context: { clubs: readonly Pick<Team, 'id'>[]; fixtures: readonly (SeasonFixture | ArchivedFixture)[]; ledger: readonly FinanceEntry[]; seasonNumber: number; completedRounds: number; world: CareerWorld }, clubId: string): SponsorAppeal {
  const definition = (id: string) => clubFinanceDefinition(context.world, id);
  const reach = definition(clubId).referenceDemand / (context.clubs.reduce((sum, club) => sum + definition(club.id).referenceDemand, 0) / context.clubs.length);
  const played = context.fixtures.filter(fixture => fixture.round <= context.completedRounds && fixture.result && (fixture.homeClubId === clubId || fixture.awayClubId === clubId));
  const winShare = played.length ? played.filter(fixture => fixture.result!.winnerClubId === clubId).length / played.length : 0.5;
  const gates = context.ledger.filter(entry => entry.kind === 'tickets' && entry.clubId === clubId && entry.seasonNumber === context.seasonNumber && entry.round <= context.completedRounds && entry.ticket);
  const fill = gates.length ? gates.reduce((sum, entry) => sum + entry.ticket!.attendance / (entry.ticket!.capacity ?? definition(clubId).capacity), 0) / gates.length : SPONSORSHIP_NEUTRAL_FILL;
  // Each factor is neutral for an average club: league-average demand, half the games won, a typical 80% full arena.
  const appeal = clamp(Math.round(reach * (0.8 + 0.4 * winShare) * (1 + 0.2 * (fill - SPONSORSHIP_NEUTRAL_FILL)) * 1000) / 1000, SPONSORSHIP_MIN_APPEAL, SPONSORSHIP_MAX_APPEAL);
  return { reach, winShare, fill, appeal };
}

/**
 * A sponsor holds one main-sponsor contract and makes offers to one club at a time. While still another club's
 * current sponsor it negotiates only with that club, so club processing order gives no club a free advantage.
 */
export function sponsorAvailable(commercial: SeasonCommercial, sponsorId: string, clubId: string, forSeason: number): boolean {
  if (commercial.agreements.some(agreement => agreement.sponsorId === sponsorId && agreement.clubId !== clubId && agreement.startsSeason <= forSeason && agreement.endsSeason >= forSeason - 1)) return false;
  return !commercial.offers.some(offer => offer.sponsorId === sponsorId && offer.clubId !== clubId && offer.status === 'open');
}

/** Clubs without a contract for next season and without open offers receive a window of offers. */
export function needsSponsorshipOffers(commercial: SeasonCommercial, clubId: string, seasonNumber: number): boolean {
  return !agreementFor(commercial, clubId, seasonNumber + 1) && !commercial.offers.some(offer => offer.clubId === clubId && offer.status === 'open');
}

/** Deterministic offers for one club: the incumbent's renewal first, then other available sponsors in seeded order. */
export function buildSponsorshipOffers(input: { seed: number; commercial: SeasonCommercial; clubId: string; window: SponsorshipWindow; anchor: CommercialAnchor; appeal: number; world: CareerWorld }): SponsorshipOffer[] {
  const { seed, commercial, clubId, window, anchor, appeal, world } = input;
  const forSeason = anchor.seasonNumber + 1;
  const current = agreementFor(commercial, clubId, anchor.seasonNumber);
  const incumbent = window === 'renewal' && current && sponsorAvailable(commercial, current.sponsorId, clubId, forSeason) ? current.sponsorId : null;
  const pool = world.sponsors.map(sponsor => sponsor.id).filter(id => id !== incumbent && sponsorAvailable(commercial, id, clubId, forSeason))
    .sort((left, right) => hash(seed, `${clubId}|${forSeason}|${window}|${left}`) - hash(seed, `${clubId}|${forSeason}|${window}|${right}`) || (left < right ? -1 : left > right ? 1 : 0));
  const chosen = [...(incumbent ? [incumbent] : []), ...pool].slice(0, SPONSORSHIP_OFFERS_PER_WINDOW);
  const expiresOn = dayBefore(seasonStartDate(forSeason));
  return chosen.map((sponsorId, index) => {
    const h = hash(seed, `sponsor-offer|${clubId}|${forSeason}|${window}|${sponsorId}`);
    const seasons = sponsorId === incumbent ? 2 : 1 + h % 3;
    const variation = 0.95 + Math.floor(h / 3) % 11 / 100;
    const annualFee = roundFee(SPONSORSHIP_REFERENCE_FEE * appeal * variation * (1 - SPONSORSHIP_TERM_DISCOUNT * (seasons - 1)));
    const bonus = Math.floor(h / 33) % 2 === 0 ? roundFee(annualFee * SPONSORSHIP_BONUS_PERCENT / 100) : 0;
    return { id: `sponsorship-offer-${commercial.offers.length + index + 1}`, clubId, sponsorId, window, madeAt: { ...anchor }, appeal, forSeason, seasons, initialAnnualFee: annualFee, annualFee, bonus, expiresOn, status: 'open' as const, closedOn: null, request: null };
  });
}

/** Hidden willingness to improve terms, 0-12%; reading it is not part of the manager's interface. */
export function sponsorshipFlexibility(seed: number, offer: Pick<SponsorshipOffer, 'id' | 'sponsorId' | 'clubId'>): number {
  return hash(seed, `sponsor-flex|${offer.id}|${offer.sponsorId}|${offer.clubId}`) % 13;
}

/** One request for 10% more: accepted with enough flexibility, otherwise a smaller counter, or a rare withdrawal. */
export function respondToSponsorshipRequest(seed: number, offer: SponsorshipOffer): { request: SponsorshipRequest; annualFee: number; status: SponsorshipOffer['status'] } {
  const askedAnnualFee = roundFee(offer.annualFee * (100 + SPONSORSHIP_REQUEST_PERCENT) / 100);
  const flexibility = sponsorshipFlexibility(seed, offer);
  if (flexibility >= SPONSORSHIP_REQUEST_PERCENT) return { request: { askedAnnualFee, response: 'accepted' }, annualFee: askedAnnualFee, status: 'open' };
  if (flexibility < 3 && offer.appeal < 0.9) return { request: { askedAnnualFee, response: 'withdrawn' }, annualFee: offer.annualFee, status: 'withdrawn' };
  return { request: { askedAnnualFee, response: 'countered' }, annualFee: Math.max(offer.annualFee, roundFee(offer.annualFee * (100 + flexibility) / 100)), status: 'open' };
}

/** Automatic control and AI clubs take the largest guaranteed total, then the larger annual fee and bonus. */
export function bestSponsorshipOffer(offers: readonly SponsorshipOffer[]): SponsorshipOffer | undefined {
  return [...offers].sort((left, right) => right.annualFee * right.seasons - left.annualFee * left.seasons || right.annualFee - left.annualFee || right.bonus - left.bonus || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))[0];
}
