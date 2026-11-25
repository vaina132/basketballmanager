import { describe, expect, it } from 'vitest';
import type { CareerWorld } from '../src/domain/world';
import type { SeasonState } from '../src/domain/season';
import type { MarketEvent } from '../src/domain/market';
import { testWorld } from './world-fixtures';
import { advanceSeason, createSeason, managedSide, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { parseSeason, serializeSeason, serializeSeasonCompact } from '../src/storage/season-storage';
import { advanceMarket, decideClubTransfer, submitMarketOffer, submitTransferOffer, withdrawMarketOffer } from '../src/world/market';
import { getLiveMarketOffers, getMarketWindow } from '../src/world/market-policy';
import { scheduledOfferQuote, setEmploymentDelegation } from '../src/world/employment';
import { setFacilityDelegation } from '../src/world/facilities';
import { setPayrollDelegation } from '../src/world/payroll';
import { setSponsorshipDelegation } from '../src/world/commercial';
import { withRealEconomy } from '../src/world/economy';
import { validateWorld } from '../src/world/career-world';
import { withLowerDivisions } from '../src/world/lower-division';
import { contractForSeason, getAvailablePlayers, minimumSquadWage, quotePlayerContract, WAGE_STEP } from '../src/world/employment-policy';
import { quoteTransferOffer, requiredTransferFee } from '../src/world/transfers-policy';
import { contractAskingWage } from '../src/world/contract-roles';
import { budgetSeasonOf, nextBudgetWithdrawal, usesManagerOfferWithdrawal } from '../src/world/offer-withdrawals';
import { getInboxItems, offerWithdrawalInboxItems } from '../src/ui/inbox-items';

/**
 * Format 103 (`world.managerOfferWithdrawal`): the manager's pending offers that his club's wage budget no longer covers
 * when the player answers are withdrawn the day before, as a recorded step, with an Inbox message. Worlds without the
 * marker keep their rules (the answer still stops the offseason with the wage-budget error).
 */
const MANAGED_INDEX = 0;
/** One country, two divisions of six and a third of four, researched money; two of the manager's players leave after season 1 (wage room), the rest, a cheap player among them, stay on three-season contracts. */
function withdrawalWorld(): CareerWorld {
  const base = testWorld(12);
  const managed = base.clubs[MANAGED_INDEX]!;
  const cheap = managed.players.at(-1)!;
  const playerContracts = Object.fromEntries(base.clubs.flatMap(club => club.players.map((player, index) => [player.id, club.id === managed.id ? index < 2 ? 1 : 3 : 1 + (index % 3)])));
  const world = withRealEconomy(withLowerDivisions({ ...base, id: 'offer-withdrawal-test', rosterModel: 'club-roster-1', playerContracts, domesticLeagues: [
    { id: 'first', name: 'First division', country: 'Testland', tier: 1, clubIds: base.clubs.slice(0, 6).map(club => club.id), postseason: 'test-tier1-1', standingsRule: 'fiba-2026-d' },
    { id: 'second', name: 'Second division', country: 'Testland', tier: 2, clubIds: base.clubs.slice(6).map(club => club.id), postseason: 'test-tier2-2', standingsRule: 'fiba-2026-d' },
  ] }, [{ country: 'Testland', tier: 3, name: 'Third division', clubs: Array.from({ length: 4 }, (_, index) => ({ id: `third-${index + 1}`, name: `Third Club ${index + 1}`, shortName: `TC${index + 1}`, color: '#336699' })) }]));
  return { ...world, wages: { ...world.wages, [cheap.id]: 2_000_000 } };
}
const WORLD = withdrawalWorld();
const MANAGED = WORLD.clubs[MANAGED_INDEX]!.id;
const CHEAP = WORLD.clubs[MANAGED_INDEX]!.players.at(-1)!.id;
const play = (state: SeasonState) => state.activeMatch ? { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) } : state;
const career = (managerOfferWithdrawal = true) => createSeason({ seed: 6, world: WORLD, managedClubId: MANAGED, ...NEW_CAREER_SYSTEMS, managerOfferWithdrawal });
const roundTrip = (state: SeasonState) => parseSeason(serializeSeasonCompact(state));

/** Season 1 played with everything automatic but recruitment, then the offseason's first day. */
function seasonEnd(managerOfferWithdrawal: boolean): SeasonState {
  let state = setSponsorshipDelegation(setPayrollDelegation(setFacilityDelegation(setEmploymentDelegation(career(managerOfferWithdrawal), false), true), true), true);
  while (state.status === 'active') state = advanceSeason(play(state));
  return state;
}

/** The highest wage (in wage steps) the club can offer this player for one season now, or null. */
function highestFittingWage(state: SeasonState, playerId: string): number | null {
  const asking = contractAskingWage(state, MANAGED, playerId);
  if (!quotePlayerContract(state, playerId, asking, 1, MANAGED).canOffer) return null;
  let low = asking, high = asking + 2_000 * WAGE_STEP;
  while (quotePlayerContract(state, playerId, high, 1, MANAGED).canOffer) { low = high; high *= 2; }
  while (high - low > WAGE_STEP) {
    const middle = low + Math.floor((high - low) / 2 / WAGE_STEP) * WAGE_STEP;
    if (quotePlayerContract(state, playerId, middle, 1, MANAGED).canOffer) low = middle; else high = middle;
  }
  return low;
}

/**
 * The scenario: a computer club bids for the manager's cheap player; on the day the bid reaches him, the manager offers a
 * free agent all the wages his budget allows, then agrees the sale (which keeps wages to replace the cheap player).
 */
function offerThenSell(managerOfferWithdrawal: boolean) {
  let state = seasonEnd(managerOfferWithdrawal);
  const nextSeason = state.seasonNumber + 1;
  expect(contractForSeason(state.employment, CHEAP, nextSeason)?.clubId).toBe(MANAGED);
  expect(contractForSeason(state.employment, CHEAP, nextSeason)!.seasonWage).toBeLessThan(minimumSquadWage(state, MANAGED, nextSeason));
  const buyer = state.clubs.find(club => club.id !== MANAGED && quoteTransferOffer(state, CHEAP, contractAskingWage(state, club.id, CHEAP), 1, requiredTransferFee(state, CHEAP), club.id).canOffer)!;
  expect(buyer).toBeDefined();
  state = submitTransferOffer(state, CHEAP, contractAskingWage(state, buyer.id, CHEAP), 1, requiredTransferFee(state, CHEAP), buyer.id);
  const bid = getLiveMarketOffers(state).find(offer => offer.playerId === CHEAP && offer.clubId === buyer.id)!;
  for (let steps = 0; steps < 5 && getMarketWindow(state)!.offers.find(offer => offer.id === bid.id)!.status !== 'club-review'; steps += 1) state = advanceMarket(state);
  expect(getMarketWindow(state)!.offers.find(offer => offer.id === bid.id)!.status).toBe('club-review');
  // The free agent the manager can pay the most for (the largest wage leaves the least room once the sale is agreed).
  const target = getAvailablePlayers(state).map(player => ({ id: player.id, wage: highestFittingWage(state, player.id) })).filter(item => item.wage !== null).sort((a, b) => b.wage! - a.wage! || a.id.localeCompare(b.id))[0]!;
  expect(target).toBeDefined();
  state = submitMarketOffer(state, target.id, target.wage!, 1);
  const offer = getLiveMarketOffers(state).find(item => item.clubId === MANAGED && item.playerId === target.id)!;
  expect(scheduledOfferQuote(state, offer).canOffer).toBe(true);
  state = decideClubTransfer(state, bid.id, 'accept');
  return { state, offer, bid, target: target.id, nextSeason };
}

describe('the manager offer withdrawal marker (format 103)', () => {
  it('marks new careers with the spending balance only, and older formats refuse the marker', () => {
    const state = career();
    expect(state.world!.managerOfferWithdrawal).toBe(true);
    expect(usesManagerOfferWithdrawal(state)).toBe(true);
    expect(career(false).world!.managerOfferWithdrawal).toBeUndefined();
    expect(createSeason({ seed: 6, world: WORLD, managedClubId: MANAGED, ...NEW_CAREER_SYSTEMS, spendingBalance: false }).world!.managerOfferWithdrawal).toBeUndefined();
    expect(createSeason({ seed: 6, ...NEW_CAREER_SYSTEMS }).world?.managerOfferWithdrawal).toBeUndefined();
    expect(() => createSeason({ seed: 6, world: WORLD, managerOfferWithdrawal: 'yes' as unknown as boolean })).toThrow(/offer withdrawal setting/);
    const envelope = JSON.parse(serializeSeason(state));
    expect(parseSeason(JSON.stringify(envelope))).toEqual(state);
    envelope.formatVersion = 102; envelope.state.schemaVersion = 102;
    expect(() => parseSeason(JSON.stringify(envelope))).toThrow(/managerOfferWithdrawal.*format 103/);
    // A career without the marker still loads as an older format.
    const older = JSON.parse(serializeSeason(career(false)));
    delete older.state.world.backgroundSquads;  // format 104, a later rule
    older.formatVersion = 102; older.state.schemaVersion = 102;
    expect(parseSeason(JSON.stringify(older)).world!.managerOfferWithdrawal).toBeUndefined();
    expect(() => validateWorld({ ...WORLD, managerOfferWithdrawal: true })).toThrow(/managerOfferWithdrawal.*spending balance/);
    expect(budgetSeasonOf('This offer exceeds the season 3 wage budget after protecting space for eight players.')).toBe(3);
    expect(budgetSeasonOf('The recruitment period has closed.')).toBeNull();
  });
});

describe('the manager offer withdrawal after an agreed sale (format 103)', () => {
  it('withdraws the offer the wage budget no longer covers before the player answers, and tells the manager', () => {
    const { state, offer, target, nextSeason } = offerThenSell(true);
    // The agreed sale keeps wages to replace the cheap player, so the offer no longer fits.
    const quote = scheduledOfferQuote(state, getLiveMarketOffers(state).find(item => item.id === offer.id)!);
    expect(quote.canOffer).toBe(false);
    expect(budgetSeasonOf(quote.reason)).toBe(nextSeason);
    const answerDay = offer.responseOn;
    const next = advanceMarket(state);
    expect(next.date).toBe(answerDay);
    const window = getMarketWindow(next)!;
    const withdrawal = window.events.find(event => event.type === 'withdraw' && event.offerId === offer.id) as Extract<MarketEvent, { type: 'withdraw' }>;
    expect(withdrawal).toEqual({ type: 'withdraw', date: state.date, offerId: offer.id, budgetSeason: nextSeason, soldPlayerId: CHEAP });
    expect(window.offers.find(item => item.id === offer.id)).toMatchObject({ status: 'withdrawn', closedOn: state.date });
    expect(contractForSeason(next.employment, target, nextSeason)?.clubId).not.toBe(MANAGED);
    // The Inbox names the offer, the sale and the season, with a link to Transfers.
    const items = offerWithdrawalInboxItems(next);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ date: state.date, category: 'players', target: 'bid', needsAction: false, playerId: target });
    expect(items[0]!.title).toMatch(/^Offer withdrawn · /);
    expect(items[0]!.detail).toMatch(/^Your offer to .+ was withdrawn: after the sale of .+ the club's wage budget for \d{4}\/\d{2} no longer covers it\./);
    expect(getInboxItems(next).some(item => item.id === items[0]!.id)).toBe(true);
    // The strict save check replays the recorded withdrawal exactly, and the career goes on from the reloaded save.
    const reloaded = roundTrip(next);
    expect(reloaded).toEqual(next);
    expect(advanceMarket(reloaded)).toEqual(advanceMarket(next));
    // A forged withdrawal is refused: a season the offer does not cover, or a sale the club did not agree.
    const forged = (event: Partial<Extract<MarketEvent, { type: 'withdraw' }>>) => {
      const envelope = JSON.parse(serializeSeason(next));
      const events = envelope.state.market.windows.at(-1).events as Record<string, unknown>[];
      Object.assign(events.find(item => item.type === 'withdraw' && item.offerId === offer.id)!, event);
      return () => parseSeason(JSON.stringify(envelope));
    };
    expect(forged({ budgetSeason: nextSeason + 5 })).toThrow(/season the offer covers/);
    expect(forged({ soldPlayerId: target })).toThrow(/sale its club agreed/);
  }, 600_000);

  it('leaves careers without the marker unchanged: the answer still stops on the wage budget', () => {
    const { state, offer } = offerThenSell(false);
    expect(nextBudgetWithdrawal(state, offer.responseOn)).toBeNull();
    expect(() => advanceMarket(state)).toThrow(/exceeds the season \d+ wage budget/);
    // A budget withdrawal cannot be recorded in such a career.
    const envelope = JSON.parse(serializeSeason(withdrawMarketOffer(state, offer.id)));
    const events = envelope.state.market.windows.at(-1).events as Record<string, unknown>[];
    Object.assign(events.at(-1)!, { budgetSeason: state.seasonNumber + 1 });
    expect(() => parseSeason(JSON.stringify(envelope))).toThrow(/offer withdrawal/);
  }, 600_000);
});
