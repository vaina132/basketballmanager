import { beforeAll, describe, expect, it } from 'vitest';
import type { FinanceEntry } from '../src/domain/finance';
import type { SeasonState } from '../src/domain/season';
import type { CareerWorld } from '../src/domain/world';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { boardUnpaidCosts } from '../src/world/board';
import { quoteBoardFunding } from '../src/world/board-funding-policy';
import { automateFacilities, endFacilityLease, leaseFacility, processFacilityProjects, repayFacilityLoan, startFacilityUpgrade, takeFacilityLoan } from '../src/world/facilities';
import { facilityAutomationBuffer, FACILITY_LEASED_REASON, getArenaCapacity, getArenaFullCapacity, getFacilityLevel, quoteFacilityRepair, quoteFacilityUpgrade } from '../src/world/facilities-policy';
import { boardDebtImpactFor, borrowingLimit, debtReserve, debtSchedule, FACILITY_FINANCING_RULES, loanPayment, outstandingDebt } from '../src/world/facility-debt';
import { getClubDebts, quoteDebtSettlement, quoteFacilityLease, quoteFacilityLoan } from '../src/world/facility-financing';
import { financeLedgerRows, getFinanceBalance } from '../src/world/finance';
import { getSpendableCash } from '../src/world/payroll-policy';
import { advanceSeason, createSeason, dateForRound, managedSide, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { testWorld } from './world-fixtures';
import { advanceMatchday } from './helpers/board-funding';
import { advanceMarket } from '../src/world/market';
import { setEmploymentDelegation } from '../src/world/employment';
import { BEFORE_SAVED_IDEAS, beforeSavedIdeas, withoutFacilityFinancing } from './helpers/legacy-season';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FacilitiesPanel } from '../src/ui/FacilitiesPanel';
import { DebtsPanel } from '../src/ui/DebtsPanel';
import { FacilityFinancing } from '../src/ui/FacilityFinancing';

const club = 'rhine-falcons';
const manager = { name: 'Loan Manager', dateOfBirth: '1984-03-17', nationality: 'Germany' };
const career = (managedClubId = club) => createSeason({ seed: 227, managedClubId, injuryMode: 'off', manager, ...NEW_CAREER_SYSTEMS });
const debtEntries = (state: SeasonState) => state.finance.ledger.filter(entry => entry.debt);
/** Pure guard fixtures use an artificial operating expense, without claiming to be valid career exports. */
function spend(state: SeasonState, clubId: string, amount: number): SeasonState {
  const entry: FinanceEntry = { id: `finance-${state.finance.ledger.length + 1}`, clubId, seasonNumber: state.seasonNumber, round: state.round, kind: 'operations', amount: -amount, sourceId: `test-cost-${state.finance.ledger.length}`, ticket: null, coach: null, payroll: null };
  return { ...state, finance: { ...state.finance, ledger: [...state.finance.ledger, entry] } };
}
const until = (state: SeasonState, round: number) => { let next = state; while (next.round < round) next = advanceMatchday(next); return next; };

describe('facility financing rules (format 71)', () => {
  it('starts new careers with loans and leases, and keeps older careers paying upfront', () => {
    const state = career();
    expect(state.facilities).toMatchObject({ financing: 'loans-1', debts: [] });
    expect(quoteFacilityLoan(state, 'arena').canBorrow).toBe(true);
    const legacy = withoutFacilityFinancing(state);
    expect(quoteFacilityLoan(legacy, 'arena').reason).toMatch(/facility financing/);
    expect(quoteFacilityLease(legacy, 'arena').reason).toMatch(/facility financing/);
    expect(() => takeFacilityLoan(legacy, 'arena')).toThrow(/facility financing/);
    const older = beforeSavedIdeas(createSeason({ seed: 227, managedClubId: club, injuryMode: 'off', manager, ...NEW_CAREER_SYSTEMS, ...BEFORE_SAVED_IDEAS }));
    expect(older.facilities.financing).toBeUndefined();
    expect(getSpendableCash(older, club)).toBe(getSpendableCash(state, club));
  });

  it('prices loans at 4-7% from the club\'s debt and cash, and repays them in equal payments', () => {
    const { baseRateBasisPoints, maxRateBasisPoints } = FACILITY_FINANCING_RULES;
    const state = career(), limit = borrowingLimit(state, club);
    expect(limit).toBe(30_000_000);
    const quote = quoteFacilityLoan(state, 'arena', club, 'upgrade', 2);
    // EUR 100,000 of a 300,000 limit: 4% + 2 x 1/3 points, in quarter points; cash above the cushion adds nothing.
    expect(quote).toMatchObject({ cost: 10_000_000, principal: 10_000_000, downPayment: 0, rateBasisPoints: 475, payments: 4, canBorrow: true });
    expect(quote.payment).toBe(loanPayment(10_000_000, 475, 4, 10));
    expect(quote.schedule.map(item => [item.seasonNumber, item.round])).toEqual([[1, 3], [1, 8], [2, 3], [2, 8]]);
    expect(quote.schedule.at(-1)!.balanceAfter).toBe(0);
    expect(quote.schedule.reduce((sum, item) => sum + item.principal, 0)).toBe(10_000_000);
    expect(quote.interest).toBe(quote.total - 10_000_000);
    // Each payment charges half a year's interest on the principal still owed.
    expect(quote.schedule[0]!.amount - quote.schedule[0]!.principal).toBe(Math.round(10_000_000 * 0.0475 / 2));
    expect(quote.dueThisSeason).toBe(quote.schedule[0]!.amount + quote.schedule[1]!.amount);
    // Thin cash adds a point; the rate never passes 7%.
    const thin = spend(state, club, getSpendableCash(state, club) - facilityAutomationBuffer(state, club) + 100);
    expect(quoteFacilityLoan(thin, 'arena', club, 'upgrade', 2).rateBasisPoints).toBe(575);
    expect(quoteFacilityLoan(state, 'arena', club, 'upgrade', 2, 5_000_000).rateBasisPoints).toBe(baseRateBasisPoints + 25);
    expect(quoteFacilityLoan(state, 'arena', club, 'upgrade', 6).reason).toMatch(/2 to 5 seasons/);
    expect(quoteFacilityLoan(state, 'arena', club, 'upgrade', 3, 10_000_050).reason).toMatch(/whole-euro loan amount/);
    expect(maxRateBasisPoints).toBe(700);
  });
});

describe('a loan-financed upgrade', () => {
  let opening: SeasonState, borrowed: SeasonState, paid: SeasonState;
  beforeAll(() => {
    opening = career();
    borrowed = takeFacilityLoan(opening, 'arena', 'upgrade', 2);
    paid = until(borrowed, 4);
  }, 120_000);

  it('books the principal, pays the upgrade in full and reserves this season\'s repayments', () => {
    const quote = quoteFacilityLoan(opening, 'arena', club, 'upgrade', 2), debt = borrowed.facilities.debts![0]!;
    expect(debt).toMatchObject({ id: 'facility-debt-1', kind: 'loan', clubId: club, facilityType: 'arena', principal: 10_000_000, rateBasisPoints: 475, seasons: 2, payment: quote.payment, total: quote.total, settled: null });
    expect(borrowed.facilities.projects.find(project => project.id === debt.projectId)).toMatchObject({ type: 'arena', fromLevel: 1, toLevel: 2, cost: 10_000_000 });
    expect(borrowed.finance.ledger.slice(-2).map(entry => [entry.kind, entry.amount, entry.sourceId])).toEqual([['loan', 10_000_000, 'facility-debt-1'], ['facility', -10_000_000, debt.projectId]]);
    expect(borrowed.facilities.events.slice(-2).map(event => event.type)).toEqual(['loan', 'start']);
    expect(getFinanceBalance(borrowed.finance, club).cash).toBe(getFinanceBalance(opening.finance, club).cash);
    // Available cash shows the committed repayments.
    expect(debtReserve(borrowed, club)).toBe(quote.dueThisSeason);
    expect(getSpendableCash(borrowed, club)).toBe(getSpendableCash(opening, club) - quote.dueThisSeason);
    expect(outstandingDebt(borrowed, club)).toBe(10_000_000);
  });

  it('books each payment on its date, with interest and principal', () => {
    const debt = borrowed.facilities.debts![0]!, schedule = debtSchedule(debt, 10);
    expect(debtEntries(paid).map(entry => [entry.kind, entry.round, entry.amount, entry.sourceId])).toEqual([['loan', 1, 10_000_000, 'facility-debt-1'], ['loan-repayment', 3, -schedule[0]!.amount, 'facility-debt-1-p1']]);
    expect(outstandingDebt(paid, club)).toBe(schedule[0]!.balanceAfter);
    expect(debtReserve(paid, club)).toBe(schedule[1]!.amount);
    const summary = getClubDebts(paid);
    expect(summary).toMatchObject({ outstanding: schedule[0]!.balanceAfter, dueThisSeason: schedule[1]!.amount, limit: 30_000_000 });
    expect(summary.rows[0]!.position).toMatchObject({ booked: 1, next: schedule[1] });
  });

  it('repays early with a 2% fee, and books nothing more', { timeout: 60_000 }, () => {
    const remaining = outstandingDebt(paid, club), quote = quoteDebtSettlement(paid, 'facility-debt-1');
    expect(quote).toMatchObject({ outstanding: remaining, charge: Math.round(remaining * 0.02), amount: remaining + Math.round(remaining * 0.02), canSettle: true });
    const repaid = repayFacilityLoan(paid, 'facility-debt-1');
    expect(repaid.finance.ledger.at(-1)).toMatchObject({ kind: 'loan-repayment', amount: -quote.amount, sourceId: 'facility-debt-1-settle', debt: { debtId: 'facility-debt-1', payment: 'settle' } });
    expect(repaid.facilities.debts![0]!.settled).toMatchObject({ seasonNumber: 1, round: 4, amount: quote.amount });
    expect(outstandingDebt(repaid, club)).toBe(0);
    expect(debtReserve(repaid, club)).toBe(0);
    expect(() => repayFacilityLoan(repaid, 'facility-debt-1')).toThrow(/already been repaid/);
    const later = until(repaid, 9);
    expect(debtEntries(later).filter(entry => typeof entry.debt!.payment === 'number').map(entry => entry.sourceId)).toEqual(['facility-debt-1-p1']);
  });

  it('turns a payment cash cannot cover into unpaid costs that the board sees', { timeout: 60_000 }, () => {
    // Round 2: leave the club almost no cash before its round-3 payment.
    const second = until(borrowed, 2), cash = getFinanceBalance(second.finance, club).cash;
    const broke = spend(second, club, cash - 100_000);
    const missed = until(broke, 4);
    const payment = missed.finance.ledger.find(entry => entry.sourceId === 'facility-debt-1-p1')!;
    const row = financeLedgerRows(missed.finance, club).find(item => item.sourceId === 'facility-debt-1-p1')!;
    expect(row.unpaidDelta).toBeGreaterThan(0);
    expect(row.unpaidDelta).toBeLessThanOrEqual(-payment.amount);
    expect(getFinanceBalance(missed.finance, club).unpaid).toBeGreaterThan(0);
    const review = missed.board.reviews.find(item => item.seasonNumber === 1 && item.round === 3)!;
    expect(review.clubs[club]!.unpaid).toBeGreaterThan(0);
    expect(boardUnpaidCosts(missed, club)).toBe(getFinanceBalance(missed.finance, club).unpaid);
    // Settling is refused while costs are unpaid; new spending stays blocked.
    expect(quoteDebtSettlement(missed, 'facility-debt-1').reason).toMatch(/unpaid club costs/);
  });

  it('saves, loads and replays loans, payments and early repayment, and refuses them in an older format', { timeout: 120_000 }, () => {
    const repaid = repayFacilityLoan(paid, 'facility-debt-1');
    for (const state of [borrowed, paid, repaid]) expect(parseSeason(serializeSeason(state))).toEqual(state);
    const file = JSON.parse(serializeSeason(paid));
    // Recurring youth injuries (format 72) would be refused first; this check is about loans and leases.
    file.formatVersion = 70; file.state.schemaVersion = 70; file.state.youthCompetition.model = 'youth-competition-1';
    expect(() => parseSeason(JSON.stringify(file))).toThrow(/facilities\.financing requires format 71/);
  });
});

describe('a lease', () => {
  let opening: SeasonState, leased: SeasonState, installed: SeasonState, running: SeasonState, ended: SeasonState;
  beforeAll(() => {
    opening = career();
    leased = leaseFacility(opening, 'arena', 2);
    installed = advanceMatchday(leased);
    running = until(installed, 4);
    ended = endFacilityLease(running, 'facility-debt-1');
  }, 120_000);

  it('installs the level for the next matchday with nothing paid now, at a total above the price', () => {
    const quote = quoteFacilityLease(opening, 'arena', club, 2), debt = leased.facilities.debts![0]!;
    expect(quote).toMatchObject({ price: 10_000_000, total: 11_400_000, premium: 1_400_000, payments: 4, payment: 2_850_000, canLease: true });
    expect(debt).toMatchObject({ kind: 'lease', principal: 10_000_000, rateBasisPoints: 0, total: 11_400_000, payment: 2_850_000 });
    const project = leased.facilities.projects.find(item => item.id === debt.projectId)!;
    expect(project).toMatchObject({ kind: 'lease', fromLevel: 1, toLevel: 2, cost: 0, startedOn: leased.date, dueOn: leased.date, completedOn: null });
    expect(leased.finance.ledger.at(-1)).toMatchObject({ kind: 'lease', amount: 0, sourceId: debt.id });
    expect(leased.finance.ledger.some(entry => entry.kind === 'facility' && entry.sourceId === project.id)).toBe(false);
    expect(getFinanceBalance(leased.finance, club).cash).toBe(getFinanceBalance(opening.finance, club).cash);
    // No seats are closed, and the prepared matchday keeps its capacity; the next one has the leased seats.
    expect(getFacilityLevel(leased, 'arena', club)).toBe(1);
    expect(getFacilityLevel(installed, 'arena', club)).toBe(2);
    expect(installed.facilities.projects.find(item => item.id === project.id)!.completedOn).toBe(installed.date);
    expect(getArenaFullCapacity(installed, club)).toBe(getArenaFullCapacity(opening, club) + 500);
    expect(installed.finance.roundCapacities![club]).toBe(getArenaFullCapacity(installed, club));
    expect(() => takeFacilityLoan(installed, 'arena')).toThrow(FACILITY_LEASED_REASON);
    expect(quoteFacilityUpgrade(installed, 'arena').reason).toBe(FACILITY_LEASED_REASON);
    expect(quoteFacilityLease(opening, 'youth').reason).toMatch(/arena seating and training equipment/);
  });

  it('books lease payments on their dates, and ending early costs a penalty and hands the level back', () => {
    const debt = running.facilities.debts![0]!;
    expect(debtEntries(running).map(entry => [entry.kind, entry.round, entry.amount])).toEqual([['lease', 1, 0], ['lease', 3, -2_850_000]]);
    const quote = quoteDebtSettlement(running, debt.id);
    expect(quote).toMatchObject({ outstanding: 3 * 2_850_000, charge: Math.round(3 * 2_850_000 * 0.25), amount: Math.round(3 * 2_850_000 * 0.25), canSettle: true });
    expect(ended.finance.ledger.at(-1)).toMatchObject({ kind: 'lease', amount: -quote.amount, sourceId: `${debt.id}-settle` });
    expect(ended.facilities.projects.find(item => item.id === debt.projectId)!.returnedOn).toBe(running.date);
    // The prepared matchday keeps its seats; the level is gone after today.
    expect(getFacilityLevel(ended, 'arena', club)).toBe(2);
    expect(getFacilityLevel(ended, 'arena', club, dateForRound(5, 1))).toBe(1);
    expect(outstandingDebt(ended, club)).toBe(0);
    expect(() => endFacilityLease(ended, debt.id)).toThrow(/already ended/);
  });

  it('stops payments after the lease ends and replays the whole history', { timeout: 120_000 }, () => {
    const later = until(ended, 9);
    expect(getFacilityLevel(later, 'arena', club)).toBe(1);
    expect(later.finance.roundCapacities![club]).toBe(getArenaFullCapacity(opening, club));
    expect(debtEntries(later).map(entry => entry.sourceId)).toEqual(['facility-debt-1', 'facility-debt-1-p1', 'facility-debt-1-settle']);
    expect(quoteFacilityUpgrade(later, 'arena').reason).not.toBe(FACILITY_LEASED_REASON);
    for (const state of [leased, installed, running, ended, later]) expect(parseSeason(serializeSeason(state))).toEqual(state);
  });
});

describe('a loan in the offseason', () => {
  it('pays for an upgrade during the transfer window and replays with the window\'s other decisions', { timeout: 180_000 }, () => {
    let state = setEmploymentDelegation(career(), true);
    while (state.status === 'active') state = advanceMatchday(state);
    state = advanceMarket(state);
    const quote = quoteFacilityLoan(state, 'training', club, 'upgrade', 4);
    expect(quote.canBorrow).toBe(true);
    // Payments start in the next season's first payment week, so nothing is reserved during the offseason.
    expect(quote.schedule[0]).toMatchObject({ seasonNumber: 2, round: 3 });
    expect(quote.dueThisSeason).toBe(0);
    state = takeFacilityLoan(state, 'training', 'upgrade', 4);
    for (let step = 0; step < 3; step += 1) state = advanceMarket(state);
    expect(parseSeason(serializeSeason(state))).toEqual(state);
  });
});

describe('debt and the board', () => {
  it('maps debt ratios to small, capped review effects', () => {
    expect([0, 40, 41, 55, 56, 70, 71, 85, 86, 100, 400].map(boardDebtImpactFor)).toEqual([0, 0, -1, -1, -2, -2, -3, -3, -4, -4, -4]);
  });

  it('records the debt effect in reviews and makes capital requests harder', { timeout: 120_000 }, () => {
    // A two-season training lease (EUR 85,500) and then a full arena loan (EUR 100,000): 62% of the EUR 300,000 limit.
    const leased = advanceMatchday(leaseFacility(career(), 'training', 2));
    const borrowed = takeFacilityLoan(leased, 'arena', 'upgrade', 3);
    const ratio = Math.round(outstandingDebt(borrowed, club) * 100 / 30_000_000);
    expect(ratio).toBe(62);
    const plain = quoteBoardFunding(leased, 'youth'), harder = quoteBoardFunding(borrowed, 'youth');
    expect(plain.debtSurcharge).toBe(0);
    expect(harder.debtSurcharge).toBe(5);
    expect(harder.requiredConfidence).toBe(plain.requiredConfidence + 5);
    const reviewed = advanceMatchday(borrowed);
    const review = reviewed.board.reviews.at(-1)!.clubs[club]!;
    expect(review.debtImpact).toBe(-2);
    expect(review.assessment).toBe(Math.max(0, Math.min(100, 50 + review.resultsImpact + review.injuryRelief + review.financeImpact + (review.rivalryImpact ?? 0) + (review.mediaImpact ?? 0) - 2)));
    // Rival clubs without debt carry no debt effect.
    expect(Object.entries(reviewed.board.reviews.at(-1)!.clubs).filter(([id, item]) => id !== club && item.debtImpact !== undefined)).toEqual([]);
    expect(parseSeason(serializeSeason(reviewed))).toEqual(reviewed);
  });
});

describe('automatic borrowing', () => {
  // A season on, the rivals' opening upgrades are complete and no arena is worn below the repair condition.
  const later = () => processFacilityProjects({ ...career(), date: dateForRound(1, 2) });
  // Alpine Stags' president (generosity 2) needs confidence 55: the board refuses capital at the opening confidence of 50.
  const rival = 'alpine-stags';
  const withCash = (state: SeasonState, clubId: string, available: number) => spend(state, clubId, getSpendableCash(state, clubId) - available);

  it('repairs a worn arena with a loan when cash is short, keeping half the cushion after this season\'s repayments', { timeout: 60_000 }, () => {
    const worn = processFacilityProjects({ ...career(), date: dateForRound(1, 5) });
    const repair = quoteFacilityRepair(worn, 'arena', rival), cushion = facilityAutomationBuffer(worn, rival);
    expect(repair.canStart).toBe(true);
    const loan = quoteFacilityLoan(worn, 'arena', rival, 'repair', FACILITY_FINANCING_RULES.automaticTermSeasons);
    // Enough for half the cushion and this season's repayments, but not for the repair with half the cushion.
    const short = withCash(worn, rival, cushion / 2 + loan.dueThisSeason + 10_000);
    expect(quoteBoardFunding(short, 'arena', rival, 'automatic', 'repair').approved).toBe(false);
    const automated = automateFacilities(short);
    const debt = automated.facilities.debts!.find(item => item.clubId === rival)!;
    expect(debt).toMatchObject({ kind: 'loan', facilityType: 'arena', seasons: FACILITY_FINANCING_RULES.automaticTermSeasons, principal: repair.cost });
    expect(automated.facilities.projects.find(item => item.id === debt.projectId)).toMatchObject({ kind: 'repair', clubId: rival, type: 'arena' });
    // With less cash the club waits instead; with plenty it pays from cash.
    const poorer = automateFacilities(withCash(worn, rival, cushion / 2));
    expect(poorer.facilities.debts!.some(item => item.clubId === rival)).toBe(false);
    expect(poorer.facilities.projects.some(item => item.clubId === rival && item.kind === 'repair' && item.startedOn === worn.date)).toBe(false);
    const rich = automateFacilities(worn);
    expect(rich.facilities.debts!.some(item => item.clubId === rival)).toBe(false);
    expect(rich.facilities.projects.some(item => item.clubId === rival && item.kind === 'repair')).toBe(true);
  });

  it('borrows for more seats only after sold-out home games', { timeout: 60_000 }, () => {
    const state = later(), cushion = facilityAutomationBuffer(state, rival);
    expect(getFacilityLevel(state, 'arena', rival)).toBe(1);
    const short = withCash(state, rival, cushion + 1_000_000);
    expect(quoteFacilityUpgrade(short, 'youth', rival).remainingBudgetAfter).toBeLessThan(cushion);
    // Without a full house the club does not borrow.
    expect(automateFacilities(short).facilities.debts!.some(item => item.clubId === rival)).toBe(false);
    const capacity = getArenaFullCapacity(short, rival);
    let soldOut = short;
    for (const fixtureId of ['test-home-1', 'test-home-2']) soldOut = { ...soldOut, finance: { ...soldOut.finance, ledger: [...soldOut.finance.ledger, { id: `finance-${soldOut.finance.ledger.length + 1}`, clubId: rival, seasonNumber: 1, round: 1, kind: 'tickets', amount: capacity * 1800, sourceId: `tickets-${fixtureId}`, ticket: { fixtureId, price: 1800, attendance: capacity, capacity }, coach: null, payroll: null }] } };
    const automated = automateFacilities(withCash(soldOut, rival, cushion + 1_000_000));
    const debt = automated.facilities.debts!.find(item => item.clubId === rival)!;
    expect(debt).toMatchObject({ kind: 'loan', facilityType: 'arena', principal: 10_000_000 });
    expect(automated.facilities.projects.find(item => item.id === debt.projectId)).toMatchObject({ type: 'arena', fromLevel: 1, toLevel: 2 });
  });

  const soldOutArena = (state: SeasonState) => {
    const capacity = getArenaFullCapacity(state, rival);
    let soldOut = state;
    for (const fixtureId of ['test-home-1', 'test-home-2']) soldOut = { ...soldOut, finance: { ...soldOut.finance, ledger: [...soldOut.finance.ledger, { id: `finance-${soldOut.finance.ledger.length + 1}`, clubId: rival, seasonNumber: 1, round: 1, kind: 'tickets', amount: capacity * 1800, sourceId: `tickets-${fixtureId}`, ticket: { fixtureId, price: 1800, attendance: capacity, capacity }, coach: null, payroll: null }] } };
    return soldOut;
  };
  const leases = (state: SeasonState) => state.facilities.debts!.filter(item => item.clubId === rival && item.kind === 'lease');

  it('leases more seats after sold-out games when a loan cannot pay, within half the limit and half the cushion', { timeout: 60_000 }, () => {
    const opening = later(), cushion = facilityAutomationBuffer(opening, rival), term = FACILITY_FINANCING_RULES.automaticTermSeasons;
    // A small loan already runs for a finished youth upgrade, and automatic control takes one loan at a time.
    const borrowed = takeFacilityLoan(withCash(opening, rival, 20_000_000), 'youth', 'upgrade', 3, 1_000_000, rival);
    const soldOut = soldOutArena(processFacilityProjects({ ...borrowed, date: borrowed.facilities.projects.at(-1)!.dueOn }));
    const quote = quoteFacilityLease(soldOut, 'arena', rival, term);
    expect(quote.debtAfter).toBeLessThanOrEqual(borrowingLimit(soldOut, rival) * FACILITY_FINANCING_RULES.automaticMaxDebtPercent / 100);
    const automated = automateFacilities(withCash(soldOut, rival, cushion + 1_000_000));
    const [lease] = leases(automated);
    expect(lease).toMatchObject({ facilityType: 'arena', seasons: term, principal: quote.price, total: quote.total });
    expect(automated.facilities.projects.find(item => item.id === lease!.projectId)).toMatchObject({ kind: 'lease', type: 'arena', fromLevel: 1, toLevel: 2, cost: 0 });
    // Not with less than half the cushion left after this season's payments, nor without a full house.
    expect(leases(automateFacilities(withCash(soldOut, rival, cushion / 2 + quote.dueThisSeason - 10_000)))).toEqual([]);
    expect(leases(automateFacilities(withCash(processFacilityProjects({ ...borrowed, date: borrowed.facilities.projects.at(-1)!.dueOn }), rival, cushion + 1_000_000)))).toEqual([]);
  });

  it('leases training equipment that has fallen behind the league, only without debt and keeping its whole cushion', { timeout: 60_000 }, () => {
    const opening = later(), term = FACILITY_FINANCING_RULES.automaticTermSeasons;
    expect(opening.clubs.map(club => getFacilityLevel(opening, 'training', club.id))).toEqual(opening.clubs.map(() => 1));
    // Three clubs' training equipment is a level up, so Alpine Stags' is below the league's average.
    let ahead = opening;
    for (const clubId of ['rhine-falcons', 'aegean-waves', 'danube-lynx']) ahead = { ...ahead, facilities: { ...ahead.facilities, projects: [...ahead.facilities.projects, { id: `facility-project-${ahead.facilities.projects.length + 1}`, clubId, type: 'training', fromLevel: 1, toLevel: 2, cost: 0, startedOn: ahead.date, dueOn: ahead.date, completedOn: ahead.date, cancelledOn: null, startEventIndex: 0 }] } };
    const cushion = facilityAutomationBuffer(ahead, rival), quote = quoteFacilityLease(ahead, 'training', rival, term);
    expect(quote.canLease).toBe(true);
    const automated = automateFacilities(withCash(ahead, rival, cushion + quote.dueThisSeason + 10_000));
    expect(leases(automated)).toEqual([expect.objectContaining({ facilityType: 'training', seasons: term, principal: quote.price })]);
    // Not when the payments would cut into the cushion, nor while the club keeps up with its league.
    expect(leases(automateFacilities(withCash(ahead, rival, cushion + quote.dueThisSeason - 10_000)))).toEqual([]);
    expect(leases(automateFacilities(withCash(opening, rival, cushion + quote.dueThisSeason + 10_000)))).toEqual([]);
    // Nor with another debt running.
    const indebted = takeFacilityLoan(withCash(ahead, rival, 20_000_000), 'youth', 'upgrade', 3, 1_000_000, rival);
    const finished = processFacilityProjects({ ...indebted, date: indebted.facilities.projects.at(-1)!.dueOn });
    expect(leases(automateFacilities(withCash(finished, rival, cushion + quote.dueThisSeason + 2_000_000)))).toEqual([]);
  });
});

describe('arena work started at a season end', () => {
  it('leaves the gates of the final week\'s later playoff games as they were played', { timeout: 300_000 }, () => {
    // Two divisions with playoffs: the final week's later games fall after its Saturday, which stays the calendar date
    // until the first offseason day, so arena work started then is dated before games already played. Seed 2: Adriatic
    // Comets host one of those games.
    const base = testWorld(12), managed = 'w0-adriatic-comets';
    const playerContracts = Object.fromEntries(base.clubs.flatMap(item => item.players.map((player, index) => [player.id, 1 + (index % 3)])));
    const world: CareerWorld = { ...base, id: 'season-end-arena-test', rosterModel: 'club-roster-1', playerContracts, domesticLeagues: [
      { id: 'first', name: 'First division', country: 'Testland', tier: 1, clubIds: base.clubs.slice(0, 6).map(item => item.id), postseason: 'test-tier1-1' },
      { id: 'second', name: 'Second division', country: 'Testland', tier: 2, clubIds: base.clubs.slice(6).map(item => item.id), postseason: 'test-tier2-2' },
    ] };
    let state = setEmploymentDelegation(createSeason({ seed: 2, world, managedClubId: managed, ...NEW_CAREER_SYSTEMS }), true);
    while (state.status === 'active') state = advanceSeason(state.activeMatch ? { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) } : state);
    const fixture = state.fixtures.find(item => item.result && item.date > state.date && item.homeClubId === managed)!;
    expect(fixture).toBeDefined();
    const started = startFacilityUpgrade(state, 'arena');
    expect(started.facilities.projects.at(-1)).toMatchObject({ clubId: managed, type: 'arena', startedOn: state.date });
    // Read by date alone, the project would have closed seats at the later game; the booked gate kept them all.
    const gate = started.finance.ledger.find(entry => entry.kind === 'tickets' && entry.ticket?.fixtureId === fixture.id)!;
    expect(gate.ticket!.capacity).toBe(getArenaCapacity(state, managed, fixture.date));
    expect(getArenaCapacity(started, managed, fixture.date)).toBeLessThan(gate.ticket!.capacity!);
    expect(parseSeason(serializeSeason(started))).toEqual(started);
  });
});

describe('the financing screens', () => {
  it('offers pay now, a loan and a lease with their totals, and lists loans and leases on Club', { timeout: 60_000 }, () => {
    const noop = () => {};
    const state = career();
    const render = (season: SeasonState) => renderToStaticMarkup(createElement(FacilitiesPanel, { season, onEnableFacilities: noop, onFacilityUpgrade: noop, onCancelFacilityUpgrade: noop, onFacilityDelegation: noop, onRequestBoardFunding: noop, onEnableMaintenance: noop, onMaintenancePlan: noop, onFacilityRepair: noop, onFacilityLoan: noop, onFacilityLease: noop }));
    expect(render(state)).toContain('data-facility-upgrade="arena"');
    const choice = (cashAvailable: boolean) => renderToStaticMarkup(createElement(FacilityFinancing, { season: state, type: 'arena', project: 'upgrade', cashAvailable, cashFooter: null, board: null, boardBlock: null, busy: false, onLoan: noop, onLease: noop }));
    const options = choice(true);
    for (const option of ['cash', 'loan', 'lease']) expect(options).toContain(`data-financing-option="${option}"`);
    const loan = quoteFacilityLoan(state, 'arena', club, 'upgrade', 3), terms = choice(false);
    expect(terms).toContain('data-financing="loan"');
    expect(terms).toContain(`data-loan-total="${loan.total}"`);
    expect(terms).toContain(`data-loan-interest="${loan.interest}"`);
    expect(terms).toContain(`data-loan-reserved="${loan.dueThisSeason}"`);
    expect(terms).toContain('Borrow and start');
    const borrowed = until(takeFacilityLoan(state, 'arena', 'upgrade', 2), 4);
    const html = renderToStaticMarkup(createElement(DebtsPanel, { season: borrowed, onRepayLoan: noop, onEndLease: noop }));
    expect(html).toContain('Loans &amp; leases');
    expect(html).toContain('data-debt="facility-debt-1"');
    expect(html).toContain(`data-debt-outstanding="${outstandingDebt(borrowed, club)}"`);
    expect(html).toContain('Repay early');
    expect(renderToStaticMarkup(createElement(DebtsPanel, { season: state }))).toBe('');
  });
});
