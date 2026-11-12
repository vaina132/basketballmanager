import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonCommercial, SponsorshipAgreement } from '../src/domain/commercial';
import type { SeasonState } from '../src/domain/season';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { getFinanceBalance } from '../src/world/finance';
import { acceptSponsorshipOffer, declineSponsorshipOffer, enableCommercial, getClubSponsorship, quoteSponsorshipOffer, requestSponsorshipImprovement, setSponsorshipDelegation } from '../src/world/commercial';
import { bestSponsorshipOffer, createCommercial, openingSponsorshipClubs, respondToSponsorshipRequest, sponsorshipPaymentsDue, SPONSORSHIP_REFERENCE_FEE } from '../src/world/commercial-policy';
import { setEmploymentDelegation } from '../src/world/employment';
import { advanceMarket } from '../src/world/market';
import { getMarketStartReason } from '../src/world/market-policy';
import { advanceSeason, createSeason, dateForRound, managedSide, NEW_CAREER_SYSTEMS, rolloverSeason, seasonStartDate } from '../src/world/season';

const club = 'rhine-falcons';
const advance = (state: SeasonState) => advanceSeason({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) });
const advanceTo = (state: SeasonState, round: number) => { let next = state; while (next.round < round && next.status === 'active') next = advance(next); return next; };
const finishSeason = (state: SeasonState) => {
  let next = setEmploymentDelegation(state, true);
  while (next.status === 'active') next = advance(next);
  for (let step = 0; step < 80 && getMarketStartReason(next); step += 1) next = advanceMarket(next);
  return next;
};
const own = (state: SeasonState) => state.commercial.offers.filter(offer => offer.clubId === club);
const sponsorIncome = (state: SeasonState, clubId: string, seasonNumber: number) => state.finance.ledger.filter(entry => entry.clubId === clubId && entry.kind === 'sponsor' && entry.seasonNumber === seasonNumber).reduce((sum, entry) => sum + entry.amount, 0);

describe('sponsorship rules', () => {
  const agreement = (overrides: Partial<SponsorshipAgreement>): SponsorshipAgreement => ({ id: 'sponsorship-agreement-7', clubId: club, sponsorId: 'corvale-freight', source: 'offer', offerId: 'sponsorship-offer-1', startsSeason: 2, endsSeason: 3, annualFee: 20_100_000, bonus: 2_000_000, signedOn: '2026-10-10', automatic: false, prepaidSeasons: [], ...overrides });
  const commercial = (agreements: SponsorshipAgreement[]): SeasonCommercial => ({ ...createCommercial(createSeason().clubs, club), enabledSince: { seasonNumber: 1, round: 1, date: '2026-09-05', ledgerCount: 0 }, agreements });

  it('splits each covered season into two dated installments and pays a bonus only for a top-half finish', () => {
    const terms = commercial([agreement({})]);
    const due = (seasonNumber: number, round: number, complete: boolean, position: number) => sponsorshipPaymentsDue(terms, 6, { seasonNumber, round, complete }, () => position).map(payment => [payment.seasonNumber, payment.round, payment.sponsorship.installment, payment.amount]);
    expect(due(2, 1, false, 1)).toEqual([[2, 1, 1, 10_050_000]]);
    expect(due(2, 6, false, 1)).toEqual([[2, 1, 1, 10_050_000], [2, 6, 2, 10_050_000]]);
    expect(due(2, 10, true, 3)).toEqual([[2, 1, 1, 10_050_000], [2, 6, 2, 10_050_000], [2, 10, 'bonus', 2_000_000]]);
    expect(due(2, 10, true, 4)).toEqual([[2, 1, 1, 10_050_000], [2, 6, 2, 10_050_000]]);
    expect(due(3, 1, false, 4).filter(([season]) => season === 3)).toEqual([[3, 1, 1, 10_050_000]]);
    // Odd cents stay exact: the second installment carries the remainder.
    expect(sponsorshipPaymentsDue(commercial([agreement({ annualFee: 20_100_001, bonus: 0 })]), 6, { seasonNumber: 2, round: 6, complete: false }, () => 1).reduce((sum, payment) => sum + payment.amount, 0)).toBe(20_100_001);
  });

  it('pays nothing for the activation season or a prepaid inherited season, and only covered clubs at an opening', () => {
    const clubs = createSeason().clubs;
    const terms = commercial([agreement({ startsSeason: 1, endsSeason: 1, prepaidSeasons: [1] }), agreement({ id: 'sponsorship-agreement-8', clubId: 'aegean-waves', startsSeason: 2, endsSeason: 2 })]);
    expect(sponsorshipPaymentsDue(terms, 6, { seasonNumber: 2, round: 10, complete: true }, () => 6).map(payment => payment.clubId)).toEqual(['aegean-waves', 'aegean-waves']);
    expect(openingSponsorshipClubs(terms, clubs, 1)).toEqual(clubs.map(item => item.id));
    expect(openingSponsorshipClubs(terms, clubs, 2)).toEqual(['aegean-waves']);
    expect(openingSponsorshipClubs(undefined, clubs, 5)).toEqual(clubs.map(item => item.id));
  });

  it('prefers the largest guaranteed total, then the annual fee and bonus', () => {
    const base = { clubId: club, window: 'renewal' as const, madeAt: { seasonNumber: 1, round: 6, date: '2026-10-10', ledgerCount: 0 }, appeal: 1, forSeason: 2, initialAnnualFee: 0, expiresOn: '2027-09-03', status: 'open' as const, closedOn: null, request: null };
    const offers = [
      { ...base, id: 'a', sponsorId: 'a', seasons: 1, annualFee: 23_000_000, bonus: 0 },
      { ...base, id: 'b', sponsorId: 'b', seasons: 2, annualFee: 19_000_000, bonus: 0 },
      { ...base, id: 'c', sponsorId: 'c', seasons: 2, annualFee: 19_000_000, bonus: 1_900_000 },
    ];
    expect(bestSponsorshipOffer(offers)!.id).toBe('c');
  });
});

describe('sponsorship negotiations in a career', () => {
  let opening: SeasonState, renewal: SeasonState, complete: SeasonState, nextOpening: SeasonState, nextRenewal: SeasonState;
  beforeAll(() => {
    opening = createSeason({ seed: 227, managedClubId: club, injuryMode: 'off', ...NEW_CAREER_SYSTEMS });
    renewal = advanceTo(opening, 6);
  }, 120_000);

  it('turns every fixed sponsor into an inherited, already paid agreement for the first season', () => {
    expect(opening.commercial.enabledSince).toMatchObject({ seasonNumber: 1, round: 1 });
    expect(opening.commercial.agreements).toHaveLength(6);
    for (const agreement of opening.commercial.agreements) expect(agreement).toMatchObject({ source: 'inherited', startsSeason: 1, endsSeason: 1, annualFee: SPONSORSHIP_REFERENCE_FEE, bonus: 0, prepaidSeasons: [1] });
    expect(opening.commercial.offers).toEqual([]);
    expect(sponsorIncome(opening, club, 1)).toBe(SPONSORSHIP_REFERENCE_FEE);
    expect(getClubSponsorship(opening)).toMatchObject({ enabled: true, delegated: false, fixedThisSeason: true, payments: [] });
  });

  it('sends renewal offers on matchday six; rival clubs accept automatically and the manager decides', () => {
    expect(advanceTo(opening, 5).commercial.offers).toEqual([]);
    const offers = own(renewal);
    expect(offers.length).toBe(3);
    expect(offers.every(offer => offer.status === 'open' && offer.forSeason === 2 && offer.expiresOn === '2027-09-03' && offer.madeAt.date === dateForRound(6))).toBe(true);
    expect(offers[0]!.sponsorId).toBe(opening.commercial.agreements.find(agreement => agreement.clubId === club)!.sponsorId);
    expect(offers[0]!.seasons).toBe(2);
    for (const offer of renewal.commercial.offers) {
      expect(offer.appeal).toBeGreaterThanOrEqual(0.75); expect(offer.appeal).toBeLessThanOrEqual(1.25);
      expect(offer.annualFee).toBeGreaterThanOrEqual(0.75 * 0.95 * 0.94 * SPONSORSHIP_REFERENCE_FEE - 50_000);
      expect(offer.annualFee).toBeLessThanOrEqual(1.25 * 1.05 * SPONSORSHIP_REFERENCE_FEE + 50_000);
      expect(offer.annualFee % 100_000).toBe(0);
    }
    const sponsors = renewal.commercial.offers.map(offer => offer.sponsorId);
    expect(new Set(sponsors).size).toBe(sponsors.length);
    // A club's current sponsor negotiates only with that club, whatever the club processing order.
    const incumbents = new Map(opening.commercial.agreements.map(agreement => [agreement.sponsorId, agreement.clubId]));
    for (const offer of renewal.commercial.offers) expect([undefined, offer.clubId]).toContain(incumbents.get(offer.sponsorId));
    const rivals = renewal.clubs.filter(item => item.id !== club);
    for (const rival of rivals) expect(renewal.commercial.agreements.filter(agreement => agreement.clubId === rival.id && agreement.startsSeason === 2)).toHaveLength(1);
    expect(renewal.commercial.agreements.filter(agreement => agreement.startsSeason === 2).every(agreement => agreement.automatic)).toBe(true);
    expect(advanceTo(createSeason({ seed: 227, managedClubId: club, injuryMode: 'off', ...NEW_CAREER_SYSTEMS }), 6).commercial).toEqual(renewal.commercial);
  });

  it('answers one request for better terms and never more', () => {
    const offer = own(renewal)[1]!;
    const asked = requestSponsorshipImprovement(renewal, offer.id);
    const updated = own(asked).find(item => item.id === offer.id)!;
    const response = respondToSponsorshipRequest(renewal.seed, offer);
    expect(updated.request).toEqual(response.request);
    expect(updated.annualFee).toBe(response.annualFee);
    expect(updated.annualFee).toBeGreaterThanOrEqual(offer.annualFee);
    expect(updated.initialAnnualFee).toBe(offer.annualFee);
    if (updated.status === 'open') expect(() => requestSponsorshipImprovement(asked, offer.id)).toThrow(/already asked/);
    expect(asked.finance.ledger).toEqual(renewal.finance.ledger);
  });

  it('signs an accepted offer for future seasons, closes the others and shows the real payment dates', () => {
    const offer = own(renewal)[0]!;
    const quote = quoteSponsorshipOffer(renewal, offer.id);
    expect(quote.canAccept).toBe(true);
    expect(quote.payments.map(payment => [payment.date, payment.amount])).toEqual([[dateForRound(1, 2), Math.floor(offer.annualFee / 2)], [dateForRound(6, 2), offer.annualFee - Math.floor(offer.annualFee / 2)], [dateForRound(1, 3), Math.floor(offer.annualFee / 2)], [dateForRound(6, 3), offer.annualFee - Math.floor(offer.annualFee / 2)]]);
    const signed = acceptSponsorshipOffer(renewal, offer.id);
    const agreement = signed.commercial.agreements.at(-1)!;
    expect(agreement).toMatchObject({ clubId: club, sponsorId: offer.sponsorId, source: 'offer', offerId: offer.id, startsSeason: 2, endsSeason: 3, annualFee: offer.annualFee, bonus: offer.bonus, automatic: false, prepaidSeasons: [] });
    expect(own(signed).map(item => item.status)).toEqual(['accepted', 'superseded', 'superseded']);
    expect(() => acceptSponsorshipOffer(signed, own(signed)[1]!.id)).toThrow(/no longer open/);
    expect(signed.finance.ledger).toEqual(renewal.finance.ledger);
    expect(getClubSponsorship(signed).next).toEqual(agreement);
  });

  it('pays only due installments under the new agreement next season, with no money beyond its terms', () => {
    const signed = acceptSponsorshipOffer(renewal, own(renewal)[0]!.id);
    complete = finishSeason(signed);
    nextOpening = rolloverSeason(complete);
    const agreement = nextOpening.commercial.agreements.find(item => item.clubId === club && item.startsSeason === 2)!;
    const firstHalf = Math.floor(agreement.annualFee / 2);
    expect(nextOpening.finance.ledger.filter(entry => entry.kind === 'sponsor' && entry.seasonNumber === 2)).toHaveLength(6);
    expect(nextOpening.finance.ledger.find(entry => entry.clubId === club && entry.kind === 'sponsor' && entry.seasonNumber === 2)).toMatchObject({ round: 1, amount: firstHalf, sourceId: `sponsorship-${agreement.id}-s2-1`, sponsorship: { agreementId: agreement.id, sponsorId: agreement.sponsorId, installment: 1 } });
    expect(getClubSponsorship(nextOpening).payments.map(payment => payment.status)).toEqual(['received', 'scheduled', ...(agreement.bonus ? ['conditional'] : [])]);
    nextRenewal = advanceTo(nextOpening, 6);
    expect(sponsorIncome(nextRenewal, club, 2)).toBe(agreement.annualFee);
    expect(getFinanceBalance(nextRenewal.finance, club).cash).toBeGreaterThan(0);
  }, 120_000);

  it('second-round offers reach a club that declined everything, and an unsold slot earns nothing', () => {
    let declined = renewal;
    for (const offer of own(renewal)) declined = declineSponsorshipOffer(declined, offer.id);
    expect(getClubSponsorship(declined).open).toEqual([]);
    let ended = setEmploymentDelegation(declined, true);
    while (ended.status === 'active') ended = advance(ended);
    const second = own(ended).filter(offer => offer.window === 'second-round');
    expect(second.length).toBeGreaterThan(0);
    expect(second.every(offer => offer.madeAt.date === dateForRound(10) && offer.status === 'open')).toBe(true);
    for (const offer of second) ended = declineSponsorshipOffer(ended, offer.id);
    for (let step = 0; step < 80 && getMarketStartReason(ended); step += 1) ended = advanceMarket(ended);
    const unsold = rolloverSeason(ended);
    expect(sponsorIncome(unsold, club, 2)).toBe(0);
    expect(getClubSponsorship(unsold).current).toBeNull();
    expect(unsold.finance.ledger.filter(entry => entry.kind === 'sponsor' && entry.seasonNumber === 2 && entry.round === 1).map(entry => entry.clubId)).not.toContain(club);
  }, 120_000);

  it('switching to automatic control accepts the best open offer immediately', () => {
    const automatic = setSponsorshipDelegation(renewal, true);
    const best = bestSponsorshipOffer(own(renewal))!;
    expect(automatic.commercial.agreements.at(-1)).toMatchObject({ clubId: club, offerId: best.id, automatic: true });
    expect(getClubSponsorship(automatic)).toMatchObject({ delegated: true, open: [] });
    expect(setSponsorshipDelegation(automatic, true)).toBe(automatic);
  });

  it('expires offers that could no longer start once the next season opens', () => {
    let waiting = setEmploymentDelegation(renewal, true);
    while (waiting.status === 'active') waiting = advance(waiting);
    for (let step = 0; step < 80 && getMarketStartReason(waiting); step += 1) waiting = advanceMarket(waiting);
    expect(own(waiting).filter(offer => offer.status === 'open').length).toBe(3);
    const opened = rolloverSeason(waiting);
    expect(own(opened).every(offer => offer.status === 'expired' && offer.closedOn === seasonStartDate(2))).toBe(true);
    expect(opened.commercial.events.at(-1)).toMatchObject({ type: 'expire', seasonNumber: 2, round: 1 });
  }, 120_000);

  it('opts older careers in prospectively without touching the current season', () => {
    const legacy = advanceTo(createSeason({ seed: 31, managedClubId: club, injuryMode: 'off', ...NEW_CAREER_SYSTEMS, commercial: false }), 3);
    const enabled = enableCommercial(legacy);
    expect(enabled.finance.ledger).toEqual(legacy.finance.ledger);
    expect(enabled.commercial.agreements.every(agreement => agreement.prepaidSeasons.includes(1))).toBe(true);
    expect(enabled.commercial.offers).toEqual([]);
    const late = enableCommercial(advanceTo(createSeason({ seed: 31, managedClubId: club, injuryMode: 'off', ...NEW_CAREER_SYSTEMS, commercial: false }), 7));
    expect(late.commercial.offers.filter(offer => offer.clubId === club).length).toBe(3);
    expect(() => enableCommercial(createSeason({ seed: 31, managedClubId: club, finance: false, payroll: false }))).toThrow(/finances/);
  }, 120_000);
});
