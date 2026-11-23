import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import type { MarketOffer } from '../src/domain/market';
import { nbaPack, NBA_CLUB_IDS } from './helpers/nba-pack';
import { economyPack } from './helpers/economy-pack';
import { worldFromPack } from '../src/world/real-world';
import { advanceSeason, createSeason, dateForRound, managedSide, NEW_CAREER_SYSTEMS, rolloverSeason } from '../src/world/season';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { setEmploymentDelegation } from '../src/world/employment';
import { advanceMarket } from '../src/world/market';
import { addMarketDays, compareMarketOffers, getMarketStartReason, MARKET_WINDOW_DAYS } from '../src/world/market-policy';
import { parseSeason, serializeSeason, serializeSeasonCompact } from '../src/storage/season-storage';
import { contractForSeason, effectiveContractsForSeason } from '../src/world/employment-policy';
import { isNbaClub, seasonRounds } from '../src/world/career-world';
import { financeLedgerEntries } from '../src/world/finance-ledger';
import { contractAskingWage } from '../src/world/contract-roles';
import { evaluateNegotiation } from '../src/world/negotiations-policy';
import { getActiveCareerPlayers, getCareerPlayerAge, getCareerWage } from '../src/world/player-catalog';
import { getInboxItems } from '../src/ui/inbox-items';
import { centsToUsd, NBA_SALARY_CAP } from '../src/world/nba-cap';
import { nbaRegularSeasonEndRound, nbaTaxBills } from '../src/world/nba-cap-policy';
import { europeanWage, isNbaLevel, isNbaPaidPlayer, NBA_MINIMUM_TEAM_SALARY, nbaDeparturesFrom, nbaEligibilityReason, NBA_MOVES_RULES, nbaOfferOrder, nbaSalaryFloorShortfall, nbaTransferReason, nbaValue, usesNbaMoves } from '../src/world/nba-moves';

/**
 * NBA step 7 (format 93, provisional): free agency and moves between the NBA and Europe. The rules on a combined
 * synthetic world of the NBA and Spain's Liga Endesa, then one automatic season and its offseason: cap-legal NBA
 * signings, every NBA club at 13-15 and every Spanish club at eight or more, moves both ways, NBA offers first for
 * NBA-level players, the minimum team salary charged exactly, and the strict save check.
 */
const SPAIN = { id: 'acb', name: 'Liga Endesa', country: 'Spain', tier: 1 as const, levels: [16, 16, 15, 15, 14, 14, 13, 13, 12, 12, 11, 11, 10, 10, 9, 9, 8, 8] };
const world = worldFromPack(nbaPack([SPAIN]), ['acb', 'nba']);
const play = (state: SeasonState) => advanceSeason(state.activeMatch && state.activeMatch.status !== 'finished' ? { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) } : state);

describe('the rules of NBA free agency and NBA-Europe moves', () => {
  const state = createSeason({ seed: 3, world, managedClubId: 'acb-1', ...NEW_CAREER_SYSTEMS });
  const nbaPlayers = NBA_CLUB_IDS.flatMap(id => world.clubs.find(club => club.id === id)!.players.map(player => player.id));
  const star = nbaPlayers.find(id => isNbaLevel(state, id))!, fringe = nbaPlayers.find(id => !isNbaLevel(state, id))!;
  const opens = dateForRound(seasonRounds(state), 1), closes = addMarketDays(opens, MARKET_WINDOW_DAYS);
  const early = { ...state, status: 'complete' as const, round: seasonRounds(state), date: opens }, late = { ...early, date: addMarketDays(closes, -3) };

  it('marks new NBA worlds only, and knows NBA level and NBA pay', () => {
    expect(world.nba?.moves).toBe('nba-moves-1');
    expect(usesNbaMoves(state)).toBe(true);
    expect(usesNbaMoves({ world: worldFromPack(economyPack([SPAIN]), 'acb') })).toBe(false);
    expect(nbaValue(state, star)).toBeGreaterThanOrEqual(NBA_MOVES_RULES.nbaLevel);
    expect(nbaValue(state, fringe)).toBeLessThan(NBA_MOVES_RULES.nbaLevel);
    expect(isNbaPaidPlayer(world, star)).toBe(true);
    expect(isNbaPaidPlayer(world, 'acb-1-p0')).toBe(false);
  });

  it('asks European clubs a European wage: below the NBA level always, at it only late in free agency or in season', () => {
    const nbaWage = getCareerWage(state, star);
    expect(contractAskingWage(early, 'acb-1', star)).toBeGreaterThanOrEqual(nbaWage);
    expect(contractAskingWage(late, 'acb-1', star)).toBe(europeanWage(late, star));
    expect(contractAskingWage({ ...state, date: '2026-12-01' }, 'acb-1', star)).toBe(europeanWage(state, star));
    expect(europeanWage(state, star)! * 4).toBeLessThan(nbaWage);
    expect(contractAskingWage(early, 'acb-1', fringe)).toBe(europeanWage(early, fringe));
    // An NBA club still pays NBA money; a European player asks the same as before from a European club.
    expect(contractAskingWage(early, 'nba-nyk', fringe)).toBeGreaterThan(europeanWage(early, fringe)!);
    expect(contractAskingWage(late, 'acb-2', 'acb-1-p0')).toBe(contractAskingWage(early, 'acb-2', 'acb-1-p0'));
    // The player's answer follows the offering club.
    const offer = europeanWage(early, fringe)!;
    expect(evaluateNegotiation(fringe, offer, 1, undefined, early, undefined, 'acb-1').outcome).toBe('accepted');
    expect(evaluateNegotiation(fringe, offer, 1, undefined, early, undefined, 'nba-nyk').outcome).not.toBe('accepted');
  });

  it('puts NBA offers first for NBA-level players and European offers first below that level', () => {
    expect(nbaOfferOrder(state, star, 'nba-bos', 'acb-1')).toBeLessThan(0);
    expect(nbaOfferOrder(state, fringe, 'nba-bos', 'acb-1')).toBeGreaterThan(0);
    expect(nbaOfferOrder(state, star, 'acb-2', 'acb-1')).toBe(0);
    const offer = (clubId: string, playerId: string, seasonWage: number) => ({ id: clubId, clubId, playerId, seasonWage, seasons: 1 }) as MarketOffer;
    // A richer European offer still loses to an NBA offer for an NBA-level player, and wins for a fringe player.
    expect(compareMarketOffers(early, offer('nba-bos', star, 100_000_000), offer('acb-1', star, 900_000_000))).toBeLessThan(0);
    expect(compareMarketOffers(early, offer('nba-bos', fringe, 900_000_000), offer('acb-1', fringe, 10_000_000))).toBeGreaterThan(0);
  });

  it('signs Europeans to NBA clubs from 23 at rotation level, under contract only through a release clause', () => {
    const europeans = world.clubs.filter(club => !isNbaClub(world, club.id)).flatMap(club => club.players.map(player => player.id));
    const age = (id: string) => getCareerPlayerAge(early, id, early.date)!;
    const ready = europeans.find(id => age(id) >= 23 && nbaValue(early, id) >= NBA_MOVES_RULES.europeanLevel)!;
    const young = europeans.find(id => age(id) < 23 && nbaValue(early, id) >= NBA_MOVES_RULES.europeanLevel)!;
    const modest = europeans.find(id => age(id) >= 23 && nbaValue(early, id) < NBA_MOVES_RULES.europeanLevel)!;
    expect(nbaEligibilityReason(early, 'nba-bos', ready)).toBeNull();
    expect(nbaEligibilityReason(early, 'nba-bos', young)).toMatch(/through the draft/);
    expect(nbaEligibilityReason(early, 'nba-bos', modest)).toMatch(/rotation player/);
    expect(nbaEligibilityReason(early, 'acb-2', modest)).toBeNull();
    expect(nbaEligibilityReason(early, 'nba-bos', fringe)).toBeNull();
    expect(nbaTransferReason(state, 'acb-1', 'nba-bos', false, true)).toBeNull();
    expect(nbaTransferReason(state, 'acb-1', 'nba-bos')).toMatch(/release clause/);
    expect(nbaTransferReason(state, 'acb-1', 'nba-bos', true, true)).toMatch(/free agents only/);
    expect(nbaTransferReason(state, 'nba-bos', 'acb-1')).toMatch(/not sold to European clubs/);
    expect(nbaTransferReason(state, 'nba-bos', 'nba-nyk')).toMatch(/only by trade/);
    expect(nbaTransferReason(state, 'acb-1', 'acb-2')).toBeNull();
  });

  it('charges the shortfall below the minimum team salary of $148.465M (90% of the cap)', () => {
    expect(Math.round(centsToUsd(NBA_MINIMUM_TEAM_SALARY))).toBe(148_465_000);
    expect(NBA_MINIMUM_TEAM_SALARY / NBA_SALARY_CAP).toBeCloseTo(0.9, 3);
    expect(nbaSalaryFloorShortfall(NBA_MINIMUM_TEAM_SALARY - 123_400)).toBe(123_400);
    expect(nbaSalaryFloorShortfall(NBA_MINIMUM_TEAM_SALARY)).toBe(0);
  });

  it('refuses the moves marker before format 93 and in a world without the cap', () => {
    const envelope = JSON.parse(serializeSeason(state));
    expect(parseSeason(JSON.stringify(envelope)).world?.nba?.moves).toBe('nba-moves-1');
    envelope.formatVersion = 92; envelope.state.schemaVersion = 92;
    expect(() => parseSeason(JSON.stringify(envelope))).toThrow(/world\.nba\.moves.*format 93 or later/);
    const { cap: _cap, ...uncapped } = world.nba!;
    expect(() => createSeason({ seed: 3, world: { ...world, nba: uncapped }, managedClubId: 'acb-1', ...NEW_CAREER_SYSTEMS })).toThrow(/world\.nba/);
  });
});

describe('one automatic season and offseason of the NBA with Spain', () => {
  let complete: SeasonState, offseason: SeasonState, next: SeasonState;
  const nba = (clubId: string) => isNbaClub(world, clubId);
  beforeAll(() => {
    let state = setEmploymentDelegation(createSeason({ seed: 11, world, managedClubId: 'acb-1', ...NEW_CAREER_SYSTEMS }), true);
    const started = performance.now();
    while (state.status === 'active') state = play(state);
    complete = state;
    for (let steps = 0; steps < 300 && getMarketStartReason(state); steps += 1) state = advanceMarket(state);
    offseason = state;
    parseSeason(serializeSeasonCompact(offseason));
    next = rolloverSeason(offseason);
    parseSeason(serializeSeasonCompact(next));
    console.log(`NBA + Liga Endesa season and offseason: ${((performance.now() - started) / 1000).toFixed(0)} s`);
  }, 3_400_000);

  it('signs every NBA contract on a cap-legal route and ends the market with every NBA club at 13-15 and every Spanish club at eight or more', () => {
    expect(getMarketStartReason(offseason)).toBeNull();
    const season2 = effectiveContractsForSeason(offseason.employment, 2);
    for (const id of NBA_CLUB_IDS) {
      const size = season2.filter(contract => contract.clubId === id).length;
      expect(size).toBeGreaterThanOrEqual(13);
      expect(size).toBeLessThanOrEqual(15);
    }
    for (const club of world.clubs.filter(item => !nba(item.id))) expect(season2.filter(contract => contract.clubId === club.id).length).toBeGreaterThanOrEqual(8);
    const signed = offseason.employment.contracts.filter(contract => contract.kind !== 'initial' && contract.kind !== 'joined' && nba(contract.clubId));
    expect(signed.length).toBeGreaterThan(20);
    expect(signed.every(contract => contract.capRoute !== undefined)).toBe(true);
  });

  it('moves players both ways: NBA players without NBA offers to Europe at European wages, a handful of Europeans to the NBA', () => {
    const toEurope: string[] = [], toNba: string[] = [];
    for (const contract of effectiveContractsForSeason(offseason.employment, 2)) {
      const before = contractForSeason(offseason.employment, contract.playerId, 1);
      if (!before || before.clubId === contract.clubId) continue;
      if (nba(before.clubId) && !nba(contract.clubId)) { toEurope.push(contract.playerId); expect(contract.seasonWage).toBeLessThan(getCareerWage(offseason, contract.playerId)); }
      if (!nba(before.clubId) && nba(contract.clubId)) toNba.push(contract.playerId);
    }
    console.log(`Moves: NBA -> Europe ${toEurope.length}, Europe -> NBA ${toNba.length}`);
    // NBA players left without an NBA contract are free agents asking European clubs European wages in season
    // (the NBA's 450 places hold nearly all its players until the draft adds rookies, so few are left over).
    const left = NBA_CLUB_IDS.flatMap(id => world.clubs.find(club => club.id === id)!.players.map(player => player.id)).filter(id => !contractForSeason(next.employment, id, 2) && getActiveCareerPlayers(next).some(player => player.id === id));
    console.log(`NBA players without a contract for season 2: ${left.length}`);
    for (const id of left) expect(contractAskingWage(next, 'acb-1', id)).toBeLessThan(getCareerWage(next, id));
    expect(toNba.length).toBeGreaterThan(0);
    // A handful of Europeans a summer, each 23 or older at rotation level, at most one per NBA club.
    expect(toNba.length).toBeLessThanOrEqual(12);
    for (const id of toNba) expect(nbaValue(offseason, id)).toBeGreaterThanOrEqual(NBA_MOVES_RULES.europeanLevel);
    const nbaClubsSigning = toNba.map(id => contractForSeason(offseason.employment, id, 2)!.clubId);
    expect(new Set(nbaClubsSigning).size).toBe(nbaClubsSigning.length);
    // The Spanish clubs that lost players to the NBA have them in their Inbox.
    const losing = toNba.map(id => contractForSeason(offseason.employment, id, 1)!.clubId)[0]!;
    const inbox = getInboxItems({ ...offseason, managedClubId: losing }).filter(item => item.id.startsWith('nba-'));
    expect(inbox.length).toBe(nbaDeparturesFrom(offseason, losing).length);
    expect(inbox.length).toBeGreaterThan(0);
    expect(inbox[0]!.title).toMatch(/signs in the NBA/);
  });

  it('gives NBA-level players contested by both sides to the NBA', () => {
    const window = offseason.market.windows.at(-1)!;
    let contested = 0;
    for (const offer of window.offers.filter(item => item.status === 'accepted')) {
      const rivals = window.offers.filter(item => item.chosenOfferId === offer.id);
      if (!rivals.length || rivals.every(rival => nba(rival.clubId) === nba(offer.clubId))) continue;
      contested += 1;
      if (isNbaLevel({ ...offseason, date: offer.respondedOn! }, offer.playerId)) expect(nba(offer.clubId)).toBe(true);
    }
    console.log(`Offers contested by NBA and European clubs: ${contested}`);
  });

  it('charges each NBA club below the minimum team salary its exact shortfall in the last regular-season week', () => {
    const round = nbaRegularSeasonEndRound(complete)!;
    const entries = [...financeLedgerEntries(complete.finance)].filter(entry => entry.kind === 'salary-floor');
    const below = nbaTaxBills(complete, round).bills.filter(bill => bill.payroll < NBA_MINIMUM_TEAM_SALARY);
    expect(entries.map(entry => [entry.clubId, -entry.amount, entry.round]).sort()).toEqual(below.map(bill => [bill.clubId, NBA_MINIMUM_TEAM_SALARY - bill.payroll, round]).sort());
    console.log(`Clubs below the minimum team salary: ${below.length}`);
  });
});
