import { afterAll, describe, expect, it } from 'vitest';
import type { CareerWorld, EconomyBand } from '../src/domain/world';
import type { SeasonState } from '../src/domain/season';
import { economyPack } from './helpers/economy-pack';
import { worldFromPack } from '../src/world/real-world';
import { REAL_ECONOMY_RULES, revenueMixFor } from '../src/world/economy';
import { overallRating } from '../src/world/overall-rating';
import { requireWorldContexts, validateWorld } from '../src/world/career-world';
import { advanceSeason, createSeason, managedSide, NEW_CAREER_SYSTEMS, rolloverSeason } from '../src/world/season';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { setEmploymentDelegation } from '../src/world/employment';
import { advanceMarket } from '../src/world/market';
import { getMarketStartReason } from '../src/world/market-policy';
import { ANNUAL_SPONSORSHIP, DEFAULT_TICKET_PRICE, defaultTicketPriceFor, fundingSourceId, getFinanceBalance, MAX_TICKET_PRICE, maxTicketPriceFor, OPENING_CASH, ROUND_OPERATING_COST } from '../src/world/finance';
import { financeLedgerEntries } from '../src/world/finance-ledger';
import { staffAllocation, STAFF_BUDGET } from '../src/world/staff-policy';
import { FACILITY_AUTOMATION_BUFFER, facilityAutomationBuffer } from '../src/world/facilities-policy';
import { MAX_CONTRACT_WAGE, maxContractWage } from '../src/world/employment-policy';
import { MAX_TRANSFER_FEE, maxTransferFee } from '../src/world/transfers-policy';
import { sponsorshipReferenceFee, SPONSORSHIP_REFERENCE_FEE } from '../src/world/commercial-policy';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { DEVELOPMENT_WORLD } from '../src/data/development-world';

const play = (state: SeasonState) => advanceSeason(state.activeMatch ? { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) } : state);
const EURO = 100;
const economyOf = (world: CareerWorld, clubId: string) => world.finances.find(item => item.clubId === clubId)!.economy!;
const wageBill = (world: CareerWorld, clubId: string) => world.clubs.find(club => club.id === clubId)!.players.reduce((sum, player) => sum + world.wages[player.id]!, 0);

/** Spain's two divisions, France's, Italy's second, Turkey's and Greece's top divisions; a listed EuroLeague of six. */
const pack = economyPack([
  { id: 'acb', name: 'Liga ACB', country: 'Spain', tier: 1, levels: [17, 16, 15, 13, 12, 11, 10, 9] },
  { id: 'feb', name: 'Primera FEB', country: 'Spain', tier: 2, levels: [10, 9, 9, 8, 7, 6] },
  { id: 'lnb', name: 'Betclic Elite', country: 'France', tier: 1, levels: [15, 13, 12, 11, 10, 9] },
  { id: 'a2', name: 'Serie A2', country: 'Italy', tier: 2, levels: [9, 8, 8, 7, 6, 5] },
  { id: 'bsl', name: 'Basketbol Super Ligi', country: 'Turkey', tier: 1, levels: [16, 13, 11, 10, 9, 8] },
  { id: 'gbl', name: 'Greek Basket League', country: 'Greece', tier: 1, levels: [17, 12, 10, 9, 8, 7] },
], { members: ['acb-1', 'acb-2', 'bsl-1', 'gbl-1'], foreign: [{ id: 'srb-1', country: 'Serbia', level: 15 }, { id: 'isr-1', country: 'Israel', level: 14 }] });

describe('realistic money for real-club worlds (format 62)', () => {
  afterAll(() => requireWorldContexts(false));
  const world = worldFromPack(pack, ['acb', 'feb', 'lnb', 'a2', 'bsl', 'gbl']);
  const leagueOf = (clubId: string) => world.domesticLeagues!.find(league => league.clubIds.includes(clubId));

  it('places every club in its band and country range by squad strength, the EuroLeague first', () => {
    expect(() => validateWorld(world)).not.toThrow();
    expect(world.economy).toBe('real-2026-1');
    const band = (clubId: string) => economyOf(world, clubId).band;
    // A EuroLeague of six: its strongest 45% (three) form the top group, whatever their country.
    expect(['acb-1', 'gbl-1', 'acb-2', 'bsl-1', 'srb-1', 'isr-1'].map(band).filter(item => item === 'euroleague-top')).toHaveLength(3);
    expect(['acb-1', 'acb-2', 'bsl-1', 'gbl-1', 'srb-1', 'isr-1'].every(id => band(id).startsWith('euroleague'))).toBe(true);
    // Outside the EuroLeague, a top division's upper half by strength is the upper band.
    expect([band('acb-3'), band('acb-4'), band('acb-5'), band('acb-8')]).toEqual(['top-upper', 'top-upper', 'top-lower', 'top-lower']);
    expect([band('feb-1'), band('a2-1')]).toEqual(['second', 'second']);
    // Next divisions below the chosen ones: Spain's Segunda FEB is a third division, Greece's Elite League a second.
    const lower = (country: string) => { const entry = world.lowerDivisions!.find(item => item.country === country)!; return 'clubIds' in entry ? entry.clubIds : []; };
    expect(lower('Spain').length && lower('Spain').every(id => band(id) === 'third')).toBeTruthy();
    expect(lower('Greece').length && lower('Greece').every(id => band(id) === 'second')).toBeTruthy();
    // Turkey's listed next division (TB2L) is a third tier, below the unchosen TBL: no Turkish next division here.
    expect(world.lowerDivisions!.some(entry => entry.country === 'Turkey')).toBe(false);
    for (const finance of world.finances) {
      const economy = finance.economy!;
      const country = leagueOf(finance.clubId)?.country ?? world.lowerDivisions!.find(entry => 'clubIds' in entry && entry.clubIds.includes(finance.clubId))?.country ?? 'Other';
      const table = REAL_ECONOMY_RULES.budgets[economy.band];
      const [low, , high] = table[country] ?? table.default!;
      expect(economy.budget).toBeGreaterThanOrEqual(low * EURO);
      expect(economy.budget).toBeLessThanOrEqual(high * EURO);
    }
    // Stronger squads get bigger budgets within their band and country.
    expect(economyOf(world, 'acb-3').budget).toBeGreaterThan(economyOf(world, 'acb-4').budget);
    expect(economyOf(world, 'acb-5').budget).toBeGreaterThan(economyOf(world, 'acb-8').budget);
    // Typical lower-half budgets differ by country: a Spanish club outspends a Greek one of the same place.
    expect(economyOf(world, 'acb-8').budget).toBeGreaterThan(economyOf(world, 'gbl-6').budget);
  });

  it('pays player wage bills near the band\'s share, convex by overall rating, within the contract limits', () => {
    for (const finance of world.finances) {
      const economy = finance.economy!;
      const share = wageBill(world, finance.clubId) / economy.budget * 100;
      const target = REAL_ECONOMY_RULES.wageShare[economy.band] * (100 - REAL_ECONOMY_RULES.headCoachPercent) / 100;
      expect(Math.abs(share - target)).toBeLessThan(2);
    }
    const ranked = (clubId: string) => [...world.clubs.find(item => item.id === clubId)!.players].sort((a, b) => overallRating(b.attributes, b.position) - overallRating(a.attributes, a.position)).map(player => world.wages[player.id]!);
    const middle = ranked('acb-5');
    expect(middle[0]!).toBeGreaterThan(middle[Math.floor(middle.length / 2)]! * 2);
    expect(middle[0]!).toBeGreaterThan(middle.at(-1)! * 5);
    const top = ranked('acb-1');
    // EuroLeague top group: the bench floor (EUR 150,000 net, cost x2 in Spain) and a star in the millions.
    expect(Math.min(...top)).toBeGreaterThanOrEqual(REAL_ECONOMY_RULES.benchFloor['euroleague-top'] * 2 * EURO * 0.99);
    expect(top[0]!).toBeGreaterThan(2_000_000 * EURO);
    for (const wage of Object.values(world.wages)) expect(wage).toBeLessThanOrEqual(maxContractWage({ world }));
  });

  it('gives each league its arenas, usual crowds and ticket yield, and the EuroLeague its own', () => {
    const finances = (ids: readonly string[]) => world.finances.filter(item => ids.includes(item.clubId));
    const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
    const euroleague = ['acb-1', 'acb-2', 'bsl-1', 'gbl-1', 'srb-1', 'isr-1'];
    for (const item of finances(euroleague)) expect(item.economy!.ticketPrice).toBeGreaterThanOrEqual(30 * EURO), expect(item.economy!.ticketPrice).toBeLessThanOrEqual(40 * EURO);
    expect(mean(finances(euroleague).map(item => item.capacity))).toBeGreaterThan(10_000);
    const league = (id: string) => world.domesticLeagues!.find(entry => entry.id === id)!.clubIds.filter(clubId => !euroleague.includes(clubId));
    for (const [id, rule] of [['acb', REAL_ECONOMY_RULES.gates.top.Spain!], ['lnb', REAL_ECONOMY_RULES.gates.top.France!], ['gbl', REAL_ECONOMY_RULES.gates.top.Greece!], ['a2', REAL_ECONOMY_RULES.gates.second.Italy!]] as const) {
      const items = finances(league(id));
      expect(mean(items.map(item => item.capacity)) / rule.seats).toBeGreaterThan(0.75);
      expect(mean(items.map(item => item.capacity)) / rule.seats).toBeLessThan(1.35);
      expect(Math.abs(mean(items.map(item => item.referenceDemand / item.capacity)) - rule.fill)).toBeLessThan(0.05);
      for (const item of items) {
        expect(item.economy!.ticketPrice / EURO).toBeGreaterThanOrEqual(Math.floor(rule.price * 0.85));
        expect(item.economy!.ticketPrice / EURO).toBeLessThanOrEqual(Math.ceil(rule.price * 1.15));
        expect(maxTicketPriceFor({ world }, item.clubId)).toBe(item.economy!.ticketPrice * 3);
      }
    }
    // Stronger clubs draw more.
    expect(world.finances.find(item => item.clubId === 'acb-3')!.capacity).toBeGreaterThan(world.finances.find(item => item.clubId === 'acb-8')!.capacity);
  });

  it('balances each club\'s season: tickets, sponsorship and funding cover wages, staff, operations and a reserve', () => {
    expect(Object.values(revenueMixFor('top-upper', 'Germany')).reduce((sum, value) => sum + value, 0)).toBe(100);
    expect(revenueMixFor('top-lower', 'Spain').public).toBe(25);
    for (const finance of world.finances) {
      const economy = finance.economy!;
      const costs = wageBill(world, finance.clubId) + staffAllocation({ world, seasonNumber: 1 }, finance.clubId) + economy.operatingCost;
      expect(costs / economy.budget).toBeGreaterThan(0.94);
      expect(costs / economy.budget).toBeLessThan(0.99);
      expect(economy.sponsorship + economy.funding).toBeLessThanOrEqual(economy.budget);
      expect(economy.openingCash).toBe(Math.round(economy.budget * 0.2 / 10_000) * 10_000);
      // Catalog amounts follow the club's level: the staff allocation is its head coach and support staff share.
      const staffShare = (REAL_ECONOMY_RULES.wageShare[economy.band] * REAL_ECONOMY_RULES.headCoachPercent / 100 + REAL_ECONOMY_RULES.supportStaffPercent) / 100;
      expect(Math.abs(staffAllocation({ world, seasonNumber: 1 }, finance.clubId) / economy.budget - staffShare)).toBeLessThan(0.002);
      expect(sponsorshipReferenceFee(world, finance.clubId)).toBe(economy.sponsorship);
    }
    const bands = new Set(world.finances.map(item => item.economy!.band));
    expect([...bands].sort()).toEqual((['euroleague', 'euroleague-top', 'second', 'third', 'top-lower', 'top-upper'] as EconomyBand[]).sort());
    expect(world.presidents.find(item => item.clubId === 'acb-1')!.seasonCapital).toBeGreaterThan(world.presidents.find(item => item.clubId === 'feb-6')!.seasonCapital * 20);
  });

  it('keeps AI clubs\' cash plausible through a season and into the next, and saves the new accounts', () => {
    requireWorldContexts(true);
    const german = worldFromPack(economyPack([{ id: 'bbl', name: 'easyCredit BBL', country: 'Germany', tier: 1, levels: [16, 14, 13, 12, 11, 10, 9, 8] }]), 'bbl');
    let state = setEmploymentDelegation(createSeason({ seed: 5, world: german, managedClubId: 'bbl-5', injuryMode: 'standard', ...NEW_CAREER_SYSTEMS }), true);
    const ai = state.clubs.map(club => club.id).filter(id => id !== 'bbl-5');
    const opening = new Map(ai.map(id => [id, getFinanceBalance(state.finance, id).cash]));
    const check = () => {
      for (const id of ai) {
        const balance = getFinanceBalance(state.finance, id), economy = economyOf(german, id);
        expect(balance.unpaid).toBe(0);
        expect(balance.cash).toBeGreaterThan(0);
        // No hoarding: never more than the opening position plus a tenth of the budget.
        expect(balance.cash).toBeLessThan(opening.get(id)! + economy.budget * 0.1);
      }
    };
    // The opening receipts: opening cash, sponsorship and season funding at each club's figures.
    const first = [...financeLedgerEntries(state.finance)];
    for (const id of ai) {
      expect(first.find(entry => entry.clubId === id && entry.kind === 'opening')!.amount).toBe(economyOf(german, id).openingCash);
      expect(first.find(entry => entry.clubId === id && entry.sourceId === 'sponsor-s1')!.amount).toBe(economyOf(german, id).sponsorship);
      expect(first.find(entry => entry.clubId === id && entry.sourceId === fundingSourceId(1))!.amount).toBe(economyOf(german, id).funding);
    }
    while (state.status === 'active') { state = play(state); check(); }
    for (const id of ai) expect(getFinanceBalance(state.finance, id).cash).toBeLessThan(opening.get(id)!);
    for (let steps = 0; steps < 200 && getMarketStartReason(state); steps += 1) state = advanceMarket(state);
    state = rolloverSeason(state);
    for (let week = 0; week < 3; week += 1) { state = play(state); check(); }
    // Season two: negotiated sponsors pay their installments and every club receives its season funding again.
    const ledger = [...financeLedgerEntries(state.finance)];
    expect(ai.every(id => ledger.some(entry => entry.clubId === id && entry.sourceId === fundingSourceId(2) && entry.amount === economyOf(german, id).funding))).toBe(true);
    expect(parseSeason(serializeSeason(state))).toEqual(state);
    const envelope = JSON.parse(serializeSeason(state));
    envelope.formatVersion = 61; envelope.state.schemaVersion = 61;
    expect(() => parseSeason(JSON.stringify(envelope))).toThrow(/economy requires format 62/);
  }, 300_000);

  it('rejects incomplete economy figures', () => {
    const club = world.finances[0]!;
    const broken = { ...world, finances: world.finances.map(item => item === club ? { ...item, economy: { ...item.economy!, ticketPrice: 1250 } } : item) };
    expect(() => validateWorld(broken)).toThrow(/whole-euro ticket price/);
    const { economy: _economy, ...plain } = club;
    expect(() => validateWorld({ ...world, finances: world.finances.map(item => item === club ? plain : item) })).toThrow(/finances/);
    const { economy: _id, ...noEconomy } = world;
    expect(() => validateWorld(noEconomy)).toThrow(/finances/);
  });
});

describe('the development world keeps its economy (format 62)', () => {
  it('uses the development constants for every money flow', () => {
    const world = DEVELOPMENT_WORLD;
    expect(world.economy).toBeUndefined();
    const clubId = world.clubs[0]!.id;
    expect([defaultTicketPriceFor({}, clubId), maxTicketPriceFor({}, clubId), staffAllocation({ seasonNumber: 1 }, clubId), facilityAutomationBuffer({}, clubId), maxContractWage({}), maxTransferFee({}), sponsorshipReferenceFee(world, clubId)])
      .toEqual([DEFAULT_TICKET_PRICE, MAX_TICKET_PRICE, STAFF_BUDGET, FACILITY_AUTOMATION_BUFFER, MAX_CONTRACT_WAGE, MAX_TRANSFER_FEE, SPONSORSHIP_REFERENCE_FEE]);
    let state = createSeason({ seed: 3, managedClubId: clubId, ...NEW_CAREER_SYSTEMS });
    const opening = [...financeLedgerEntries(state.finance)];
    expect(opening.filter(entry => entry.kind === 'opening').every(entry => entry.amount === OPENING_CASH)).toBe(true);
    expect(opening.filter(entry => entry.kind === 'sponsor').every(entry => entry.amount === ANNUAL_SPONSORSHIP && entry.sourceId === 'sponsor-s1')).toBe(true);
    state = play(state);
    expect([...financeLedgerEntries(state.finance)].filter(entry => entry.kind === 'operations').every(entry => entry.amount === -ROUND_OPERATING_COST)).toBe(true);
    expect(Object.values(state.finance.plans).every(plan => plan.price === DEFAULT_TICKET_PRICE)).toBe(true);
  });
});
