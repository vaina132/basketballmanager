import { beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SeasonState } from '../src/domain/season';
import type { CareerWorld } from '../src/domain/world';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { parseSeason, serializeSeason, serializeSeasonCompact } from '../src/storage/season-storage';
import { acceptNamingOffer, acceptSponsorshipOffer, arenaNameFor, getClubNamingRights, getClubSponsorship, quoteNamingOffer, quoteSponsorshipTermination, setNamingDelegation, terminateSponsorship } from '../src/world/commercial';
import { clubFinanceDefinition, worldOf } from '../src/world/career-world';
import { agreementFor, bestNamingOffer, COMMERCIAL_CLAUSE_RULES, namingAgreementFor, namingArenaName, namingPaymentsDue, namingRightsValue, sponsorExitDecision, sponsorExitTriggers, terminationTerms } from '../src/world/commercial-policy';
import { getFinanceBalance } from '../src/world/finance';
import { setEmploymentDelegation } from '../src/world/employment';
import { advanceMarket } from '../src/world/market';
import { getMarketStartReason } from '../src/world/market-policy';
import { advanceSeason, createSeason, dateForRound, getPostseasons, managedSide, NEW_CAREER_SYSTEMS, rolloverSeason } from '../src/world/season';
import { getInboxItems } from '../src/ui/inbox-items';
import { NamingRightsPanel } from '../src/ui/NamingRightsPanel';
import { SeasonWorkspace } from '../src/ui/SeasonWorkspace';
import { SponsorshipPanel } from '../src/ui/SponsorshipPanel';
import { testWorld } from './world-fixtures';

const club = 'rhine-falcons';
const noop = () => {};
const play = (state: SeasonState) => state.activeMatch ? { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) } : state;
const advance = (state: SeasonState) => advanceSeason(play(state));
const advanceTo = (state: SeasonState, round: number) => { let next = state; while (next.round < round && next.status === 'active') next = advance(next); return next; };
const finishSeason = (state: SeasonState) => {
  let next = setEmploymentDelegation(state, true);
  while (next.status === 'active') next = advance(next);
  for (let step = 0; step < 80 && getMarketStartReason(next); step += 1) next = advanceMarket(next);
  return next;
};
const restore = (state: SeasonState) => parseSeason(serializeSeason(state));
const naming = (state: SeasonState) => state.commercial.naming!;
const renderNaming = (state: SeasonState) => renderToStaticMarkup(<NamingRightsPanel season={state} onAcceptNaming={noop} onDeclineNaming={noop} onRequestNaming={noop} onNamingDelegation={noop} onTerminateSponsorship={noop} />);
const renderSponsor = (state: SeasonState) => renderToStaticMarkup(<SponsorshipPanel season={state} onEnableSponsorship={noop} onAcceptSponsorship={noop} onDeclineSponsorship={noop} onRequestSponsorship={noop} onSponsorshipDelegation={noop} onTerminateSponsorship={noop} />);

/** One test country with two divisions: six clubs (last two relegated) and five (first and the playoff winner promoted). */
function twoDivisionWorld(): CareerWorld {
  const world = testWorld(11);
  const playerContracts = Object.fromEntries(world.clubs.flatMap(item => item.players.map((player, index) => [player.id, 1 + (index % 3)])));
  return { ...world, id: 'divisions-test', rosterModel: 'club-roster-1', playerContracts, domesticLeagues: [
    { id: 'first', name: 'First division', country: 'Testland', tier: 1, clubIds: world.clubs.slice(0, 6).map(item => item.id), postseason: 'test-tier1-1' },
    { id: 'second', name: 'Second division', country: 'Testland', tier: 2, clubIds: world.clubs.slice(6).map(item => item.id), postseason: 'test-tier2-1' },
  ] };
}

describe('exit clause and naming-rights rules', () => {
  const clause = { objective: { leagueId: 'first', position: 3, leagueSize: 12 }, appeal: 1.1, exitPayment: 5_000_000, terminationFee: 10_000_000 };
  const agreement = { id: 'sponsorship-agreement-9', startsSeason: 2, endsSeason: 4, clause, exit: null };
  const evidence = { relegated: false, leagueId: 'first', position: 4, appeal: 1.05, economy: false };

  it('triggers only after a season the agreement outlives: relegation, a bad miss of the objective or a sharp fall in appeal', () => {
    expect(sponsorExitTriggers(agreement, 2, evidence)).toEqual([]);
    expect(sponsorExitTriggers(agreement, 2, { ...evidence, relegated: true })).toEqual(['relegation']);
    // A bad miss: a quarter of the league (three places) below the objective.
    expect(sponsorExitTriggers(agreement, 2, { ...evidence, position: 5 })).toEqual([]);
    expect(sponsorExitTriggers(agreement, 2, { ...evidence, position: 6 })).toEqual(['objective']);
    expect(sponsorExitTriggers(agreement, 2, { ...evidence, position: 9, leagueId: 'second' })).toEqual([]);
    expect(sponsorExitTriggers(agreement, 2, { ...evidence, appeal: 0.951 })).toEqual([]);
    expect(sponsorExitTriggers(agreement, 2, { ...evidence, appeal: 0.95 })).toEqual(['decline']);
    // Appeal moves half as much in worlds with an economy, so half the fall is as sharp.
    expect(sponsorExitTriggers(agreement, 2, { ...evidence, appeal: 1.025, economy: true })).toEqual(['decline']);
    expect(sponsorExitTriggers(agreement, 2, { ...evidence, relegated: true, position: 12, appeal: 0.8 })).toEqual(['relegation', 'objective', 'decline']);
    // The final covered season, an agreement already ended and an inherited season have nothing to end.
    expect(sponsorExitTriggers(agreement, 4, { ...evidence, relegated: true })).toEqual([]);
    expect(sponsorExitTriggers({ ...agreement, exit: { by: 'club', reason: 'club', seasonNumber: 2, round: 3, date: '2027-09-25', lastSeason: 2, amount: 0 } }, 2, { ...evidence, relegated: true })).toEqual([]);
    expect(sponsorExitTriggers({ ...agreement, clause: null }, 2, { ...evidence, relegated: true })).toEqual([]);
  });

  it('decides from the career seed with each trigger\'s chance, never from match randomness', () => {
    const decisions = Array.from({ length: 400 }, (_, seed) => sponsorExitDecision(seed, agreement, 2, { ...evidence, relegated: true }));
    expect(decisions.every(reason => reason === null || reason === 'relegation')).toBe(true);
    const share = decisions.filter(Boolean).length / decisions.length;
    expect(share).toBeGreaterThan(COMMERCIAL_CLAUSE_RULES.exitChance.relegation / 100 - 0.08);
    expect(share).toBeLessThan(COMMERCIAL_CLAUSE_RULES.exitChance.relegation / 100 + 0.08);
    expect(Array.from({ length: 400 }, (_, seed) => sponsorExitDecision(seed, agreement, 2, { ...evidence, relegated: true }))).toEqual(decisions);
  });

  it('charges the club half a season\'s fee for each season it cancels, with notice to the end of the current season', () => {
    expect(terminationTerms(agreement, 2)).toEqual({ lastSeason: 2, cancelledSeasons: 2, fee: 20_000_000 });
    expect(terminationTerms(agreement, 1)).toEqual({ lastSeason: 1, cancelledSeasons: 3, fee: 30_000_000 });
    expect(terminationTerms(agreement, 4).cancelledSeasons).toBe(0);
  });

  it('values naming rights by the sponsorship benchmark, arena seats against the league and league level', () => {
    const basis = { benchmark: 20_000_000, capacity: 4000, leagueCapacity: 4000, tier: 1 };
    expect(namingRightsValue(basis, 1)).toBe(20_000_000 * COMMERCIAL_CLAUSE_RULES.namingFeeShare);
    expect(namingRightsValue({ ...basis, benchmark: 200_000_000 }, 1)).toBe(10 * namingRightsValue(basis, 1));
    expect(namingRightsValue({ ...basis, capacity: 5000 }, 1)).toBeGreaterThan(namingRightsValue(basis, 1));
    expect(namingRightsValue({ ...basis, capacity: 40_000 }, 1)).toBe(namingRightsValue(basis, 1) * COMMERCIAL_CLAUSE_RULES.namingCapacityFactor[1]);
    expect(namingRightsValue({ ...basis, tier: 2 }, 1)).toBeLessThan(namingRightsValue(basis, 1));
    expect(namingRightsValue({ ...basis, tier: 3 }, 1)).toBeLessThan(namingRightsValue({ ...basis, tier: 2 }, 1));
    expect(namingRightsValue(basis, 1.2)).toBeGreaterThan(namingRightsValue(basis, 1));
  });

  it('pays each naming season in two dated installments, on matchday six and after the final matchday', () => {
    const terms = { plans: {}, offers: [], events: [], agreements: [{ id: 'naming-agreement-1', clubId: club, sponsorId: 'corvale-freight', offerId: 'naming-offer-1', arenaName: 'Corvale Freight Arena', startsSeason: 2, endsSeason: 3, annualFee: 3_000_001, signedOn: '2026-10-10', automatic: false, clause: { ...clause, objective: null }, exit: null }] };
    const due = (seasonNumber: number, round: number, complete: boolean) => namingPaymentsDue(terms, { seasonNumber, round, complete }, 10).map(payment => [payment.seasonNumber, payment.round, payment.namingRights.installment, payment.amount]);
    expect(due(2, 5, false)).toEqual([]);
    expect(due(2, 6, false)).toEqual([[2, 6, 1, 1_500_000]]);
    expect(due(2, 10, true)).toEqual([[2, 6, 1, 1_500_000], [2, 10, 2, 1_500_001]]);
    // An exit after season two cancels season three.
    const ended = { ...terms, agreements: [{ ...terms.agreements[0]!, exit: { by: 'sponsor' as const, reason: 'relegation' as const, seasonNumber: 2, round: 10, date: '2028-05-20', lastSeason: 2, amount: 750_000 } }] };
    expect(namingPaymentsDue(ended, { seasonNumber: 3, round: 10, complete: true }, 10).map(payment => payment.seasonNumber)).toEqual([2, 2]);
  });
});

describe('naming rights and early termination in a new career', () => {
  let opening: SeasonState, renewal: SeasonState, signed: SeasonState, nextOpening: SeasonState, nextRenewal: SeasonState;
  beforeAll(() => {
    opening = createSeason({ seed: 227, managedClubId: club, injuryMode: 'off', ...NEW_CAREER_SYSTEMS });
    renewal = advanceTo(opening, 6);
    const namingOffer = naming(renewal).offers.find(offer => offer.clubId === club)!;
    signed = acceptNamingOffer(acceptSponsorshipOffer(renewal, renewal.commercial.offers.find(offer => offer.clubId === club)!.id), namingOffer.id);
    nextOpening = rolloverSeason(finishSeason(signed));
    nextRenewal = advanceTo(nextOpening, 6);
  }, 240_000);

  it('makes naming offers on matchday six that follow each club\'s arena and appeal; rivals sign automatically', () => {
    expect(opening.commercial.model).toBe('commercial-2');
    expect(naming(opening).offers).toEqual([]);
    const offers = naming(renewal).offers;
    expect(offers.filter(offer => offer.clubId === club)).toHaveLength(COMMERCIAL_CLAUSE_RULES.namingOffersPerWindow);
    for (const offer of offers) {
      expect(offer).toMatchObject({ forSeason: 2, madeAt: { date: dateForRound(6) }, arenaName: namingArenaName(worldOf(renewal), offer.sponsorId) });
      const value = namingRightsValue(offer.basis, offer.appeal), discount = 1 - 0.03 * (offer.seasons - 1);
      expect(offer.initialAnnualFee).toBeGreaterThanOrEqual(Math.floor(value * 0.95 * discount / 100_000) * 100_000);
      expect(offer.initialAnnualFee).toBeLessThanOrEqual(Math.ceil(value * 1.05 * discount / 100_000) * 100_000);
    }
    // Arena seats are valued against the league: the largest venue's basis is above the smallest's.
    const bases = new Map(offers.map(offer => [offer.clubId, offer.basis.capacity]));
    expect(Math.max(...bases.values())).toBeGreaterThan(Math.min(...bases.values()));
    for (const rival of renewal.clubs.filter(item => item.id !== club)) expect(naming(renewal).agreements.filter(agreement => agreement.clubId === rival.id && agreement.automatic)).toHaveLength(1);
    // The managed club decides; main-sponsor offers state the sponsor's objective.
    expect(getClubNamingRights(renewal)!.open).toHaveLength(COMMERCIAL_CLAUSE_RULES.namingOffersPerWindow);
    expect(renewal.commercial.offers.filter(offer => offer.clubId === club).every(offer => offer.objective && offer.objective.leagueSize === 6)).toBe(true);
    const html = renderNaming(renewal);
    expect(html).toContain('Arena naming rights');
    expect(html.match(/data-naming-offer="/g)).toHaveLength(COMMERCIAL_CLAUSE_RULES.namingOffersPerWindow);
    expect(renderSponsor(renewal)).not.toContain('data-sponsor-terminate');
    expect(getInboxItems(renewal).some(item => item.title === 'Naming-rights offers waiting' && item.needsAction)).toBe(true);
  });

  it('automatic control signs the largest guaranteed naming offer at once', () => {
    const best = bestNamingOffer(getClubNamingRights(renewal)!.open)!;
    const automatic = setNamingDelegation(renewal, true);
    expect(naming(automatic).agreements.at(-1)).toMatchObject({ clubId: club, offerId: best.id, automatic: true, arenaName: best.arenaName, startsSeason: 2 });
    expect(getClubNamingRights(automatic)).toMatchObject({ delegated: true, open: [] });
    expect(automatic.finance.ledger).toEqual(renewal.finance.ledger);
  });

  it('signs naming rights with its clause, renames the arena from its first season and books installments on their dates', () => {
    const agreement = naming(signed).agreements.find(item => item.clubId === club)!;
    const offer = naming(renewal).offers.find(item => item.id === agreement.offerId)!;
    expect(agreement).toMatchObject({ startsSeason: 2, endsSeason: 1 + offer.seasons, annualFee: offer.annualFee, exit: null, clause: { objective: null, exitPayment: Math.round(offer.annualFee * 0.25 / 100) * 100, terminationFee: Math.round(offer.annualFee * 0.5 / 100) * 100 } });
    expect(quoteNamingOffer(signed, offer.id).canAccept).toBe(false);
    // The official venue stays in the world data; the arena carries the partner's name only while the agreement runs.
    expect(arenaNameFor(signed, club)).toBe('RHF Arena');
    expect(arenaNameFor(nextOpening, club)).toBe(agreement.arenaName);
    expect(arenaNameFor(nextOpening, club, 1)).toBe('RHF Arena');
    expect(clubFinanceDefinition(worldOf(nextOpening), club).venue).toBe('RHF Arena');
    expect(renderNaming(nextOpening)).toContain(`data-arena-name="${agreement.arenaName}"`);
    const fixtures = renderToStaticMarkup(<SeasonWorkspace season={nextOpening} onNewCareer={noop} onOpenMatch={noop} onAdvance={noop} onRollover={noop} onLoad={noop} />);
    expect(fixtures).toContain(agreement.arenaName);
    // Matchday six of the first covered season: the first installment, once.
    const paid = nextRenewal.finance.ledger.filter(entry => entry.kind === 'naming-rights' && entry.clubId === club);
    expect(paid).toEqual([expect.objectContaining({ seasonNumber: 2, round: 6, amount: Math.floor(agreement.annualFee / 2), sourceId: `naming-${agreement.id}-s2-1`, namingRights: { agreementId: agreement.id, sponsorId: agreement.sponsorId, installment: 1 } })]);
    expect(nextOpening.finance.ledger.some(entry => entry.kind === 'naming-rights')).toBe(false);
    expect(getClubNamingRights(nextRenewal)!.payments.map(payment => payment.status)).toEqual(['received', 'scheduled']);
    expect(restore(nextRenewal)).toEqual(nextRenewal);
  });

  it('lets the club end an agreement early for its termination fee, booked on the day and saved', () => {
    const main = agreementFor(nextRenewal.commercial, club, 2)!;
    expect(main.clause).toBeTruthy();
    const quote = getClubSponsorship(nextRenewal).termination;
    if (main.endsSeason > 2) {
      expect(quote).toMatchObject({ agreement: { id: main.id }, lastSeason: 2, cancelledSeasons: main.endsSeason - 2 });
    } else expect(quote).toBeNull();
    const namingAgreement = namingAgreementFor(naming(nextRenewal), club, 2)!;
    const namingQuote = quoteSponsorshipTermination(nextRenewal, 'naming', namingAgreement.id);
    expect(namingQuote).toMatchObject({ canTerminate: true, lastSeason: 2, cancelledSeasons: namingAgreement.endsSeason - 2, fee: (namingAgreement.endsSeason - 2) * namingAgreement.clause.terminationFee });
    expect(renderNaming(nextRenewal)).toContain(`data-sponsor-terminate="${namingAgreement.id}"`);
    const cash = getFinanceBalance(nextRenewal.finance, club).cash;
    const ended = terminateSponsorship(nextRenewal, 'naming', namingAgreement.id);
    const entry = ended.finance.ledger.at(-1)!;
    expect(entry).toMatchObject({ clubId: club, kind: 'sponsor-exit', seasonNumber: 2, round: 6, amount: -namingQuote.fee, sourceId: `exit-${namingAgreement.id}`, sponsorExit: { agreementId: namingAgreement.id, sponsorId: namingAgreement.sponsorId, contract: 'naming', by: 'club' } });
    expect(getFinanceBalance(ended.finance, club).cash).toBe(cash - namingQuote.fee);
    // Notice runs to the end of this season: the arena keeps the name now, but not next season.
    expect(arenaNameFor(ended, club)).toBe(namingAgreement.arenaName);
    expect(namingAgreementFor(naming(ended), club, 3)).toBeUndefined();
    expect(naming(ended).events.at(-1)).toMatchObject({ type: 'terminate', agreementId: namingAgreement.id });
    expect(() => terminateSponsorship(ended, 'naming', namingAgreement.id)).toThrow(/already ended early/);
    expect(getInboxItems(ended).find(item => item.id === `exit-${namingAgreement.id}`)?.detail).toMatch(/termination fee/);
    expect(restore(ended)).toEqual(ended);
    // A future agreement can be cancelled before it starts: every season is charged.
    const offer = renewal.commercial.offers.find(item => item.clubId === club)!;
    const future = acceptSponsorshipOffer(renewal, offer.id);
    const signedMain = future.commercial.agreements.at(-1)!;
    const cancel = quoteSponsorshipTermination(future, 'main', signedMain.id);
    expect(cancel).toMatchObject({ lastSeason: 1, cancelledSeasons: offer.seasons, fee: offer.seasons * signedMain.clause!.terminationFee });
    const cancelled = terminateSponsorship(future, 'main', signedMain.id);
    expect(agreementFor(cancelled.commercial, club, 2)).toBeUndefined();
    expect(restore(cancelled)).toEqual(cancelled);
    // The inherited season has no clause and cannot be ended.
    expect(quoteSponsorshipTermination(renewal, 'main', agreementFor(renewal.commercial, club, 1)!.id).reason).toMatch(/no early-termination clause/);
  });
});

describe('a sponsor leaving after relegation', () => {
  let complete: SeasonState;
  beforeAll(() => {
    const world = twoDivisionWorld();
    complete = setEmploymentDelegation(createSeason({ seed: 9, world, managedClubId: world.clubs[0]!.id, ...NEW_CAREER_SYSTEMS }), true);
    while (complete.status === 'active') complete = advance(complete);
  }, 240_000);

  it('ends the relegated club\'s agreements with notice at the season end, books the exit payment on that date and opens new offers', () => {
    const relegated = getPostseasons(complete, 1)[0]!.outcome.relegated.map(entry => entry.clubId!);
    const exits = complete.commercial.agreements.filter(agreement => agreement.exit);
    expect(exits.length).toBeGreaterThan(0);
    const finalRound = complete.round, finalDate = complete.date;
    for (const agreement of exits) {
      expect(relegated).toContain(agreement.clubId);
      expect(agreement.exit).toEqual({ by: 'sponsor', reason: 'relegation', seasonNumber: 1, round: finalRound, date: finalDate, lastSeason: 1, amount: agreement.clause!.exitPayment });
      expect(agreement.clause!.exitPayment).toBe(Math.round(agreement.annualFee * COMMERCIAL_CLAUSE_RULES.exitPaymentShare / 100) * 100);
      expect(complete.finance.ledger.filter(entry => entry.sourceId === `exit-${agreement.id}`)).toEqual([expect.objectContaining({ clubId: agreement.clubId, kind: 'sponsor-exit', seasonNumber: 1, round: finalRound, amount: agreement.clause!.exitPayment, sponsorExit: { agreementId: agreement.id, sponsorId: agreement.sponsorId, contract: 'main', by: 'sponsor' } })]);
      // The sponsor that left makes no new offer; other sponsors' second-round offers follow, set in the club's new division.
      const second = complete.commercial.offers.filter(offer => offer.clubId === agreement.clubId && offer.window === 'second-round');
      expect(second.length).toBeGreaterThan(0);
      expect(second.every(offer => offer.sponsorId !== agreement.sponsorId && offer.objective?.leagueId === 'second')).toBe(true);
      expect(agreementFor(complete.commercial, agreement.clubId, 2)?.id).not.toBe(agreement.id);
    }
    // Every relegated club's clause was decided by the seeded rule, the same for every club.
    for (const agreement of complete.commercial.agreements.filter(item => relegated.includes(item.clubId) && item.startsSeason === 2 && item.clause && item.source === 'offer' && !complete.commercial.offers.find(offer => offer.id === item.offerId && offer.window === 'second-round'))) {
      const decided = sponsorExitDecision(complete.seed, { ...agreement, exit: null }, 1, { relegated: true, leagueId: 'first', position: null, appeal: agreement.clause!.appeal, economy: false });
      expect(!!agreement.exit).toBe(decided !== null);
    }
    for (const agreement of naming(complete).agreements.filter(item => item.exit)) expect(relegated).toContain(agreement.clubId);
    const managed = complete.managedClubId, own = exits.find(agreement => agreement.clubId === managed);
    if (own) expect(getInboxItems(complete).find(item => item.id === `exit-${own.id}`)?.detail).toMatch(/relegation/);
    expect(parseSeason(serializeSeasonCompact(complete))).toEqual(complete);
  });

  it('keeps an exited agreement out of the next season\'s opening payments', () => {
    let next = complete;
    for (let step = 0; step < 120 && getMarketStartReason(next); step += 1) next = advanceMarket(next);
    next = rolloverSeason(next);
    const ended = new Set(complete.commercial.agreements.filter(agreement => agreement.exit).map(agreement => agreement.id));
    const opening = next.finance.ledger.filter(entry => entry.seasonNumber === 2 && entry.kind === 'sponsor' && entry.sponsorship);
    expect(opening.length).toBeGreaterThan(0);
    expect(opening.some(entry => ended.has(entry.sponsorship!.agreementId))).toBe(false);
    expect(parseSeason(serializeSeasonCompact(next))).toEqual(next);
  }, 120_000);
});

describe('older careers keep the original sponsorship rules', () => {
  it('creates no naming rights, objectives or clauses without the format-64 model', () => {
    const legacy = advanceTo(createSeason({ seed: 227, managedClubId: club, injuryMode: 'off', ...NEW_CAREER_SYSTEMS, namingRights: false }), 6);
    expect(legacy.commercial.model).toBe('commercial-1');
    expect(Object.hasOwn(legacy.commercial, 'naming')).toBe(false);
    expect(legacy.commercial.offers.every(offer => !Object.hasOwn(offer, 'objective'))).toBe(true);
    expect(legacy.commercial.agreements.every(agreement => !Object.hasOwn(agreement, 'clause') && !Object.hasOwn(agreement, 'exit'))).toBe(true);
    expect(getClubNamingRights(legacy)).toBeNull();
    expect(getClubSponsorship(legacy)).toMatchObject({ clauses: false, termination: null, ended: [] });
    expect(arenaNameFor(legacy, club)).toBe('RHF Arena');
    expect(quoteSponsorshipTermination(legacy, 'main', agreementFor(legacy.commercial, club, 1)!.id).canTerminate).toBe(false);
    expect(renderNaming(legacy)).toBe('');
    expect(legacy.finance.ledger.some(entry => entry.kind === 'naming-rights' || entry.kind === 'sponsor-exit')).toBe(false);
    expect(restore(legacy)).toEqual(legacy);
  }, 120_000);
});
