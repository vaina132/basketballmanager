import { beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FinanceEntry } from '../src/domain/finance';
import type { SeasonState } from '../src/domain/season';
import { parseSeason, serializeSeason, serializeSeasonCompact } from '../src/storage/season-storage';
import { quoteBoardFunding } from '../src/world/board-funding-policy';
import { automateFacilities, cancelFacilityUpgrade, repayFacilityLoan, setFacilityDelegation, startArenaExpansion, startFacilityUpgrade, takeBankLoan, takeFacilityLoan } from '../src/world/facilities';
import { arenaExpansionSizes, FACILITY_BANK_REASON, FACILITY_RULES_2, FACILITY_RULES_3, facilityPracticeBonusPercent, getArenaCapacity, getClubFacilities, getFacilityLevel, getFacilityUpkeep, medicalRecoveryPercent, quoteArenaExpansion, quoteFacilityUpgrade, scoutingEvidencePercent, startingFacilityLevel, upgradeAutomationCushion } from '../src/world/facilities-policy';
import { BANK_LOAN_RULES, bankLoanLimit, debtReserve, debtSchedule, outstandingDebt, paymentRounds } from '../src/world/facility-debt';
import { getClubDebts, quoteBankLoan } from '../src/world/facility-financing';
import { forecastGate, getFinanceBalance, setTicketPlan } from '../src/world/finance';
import { getSpendableCash } from '../src/world/payroll-policy';
import { createSeason, NEW_CAREER_SYSTEMS, rolloverSeason } from '../src/world/season';
import { seasonRounds } from '../src/world/career-world';
import { worldFromPack } from '../src/world/real-world';
import { setEmploymentDelegation } from '../src/world/employment';
import { advanceMarket } from '../src/world/market';
import { getMarketStartReason } from '../src/world/market-policy';
import { SimpleFacilitiesPanel } from '../src/ui/SimpleFacilitiesPanel';
import { BankPanel } from '../src/ui/BankPanel';
import { advanceMatchday } from './helpers/board-funding';
import { economyPack } from './helpers/economy-pack';

/** Owner request (16 November 2026): six levels, the arena as seats, a simple bank loan and no confusing controls. */
const club = 'rhine-falcons';
const manager = { name: 'Six Level Manager', dateOfBirth: '1984-03-17', nationality: 'Germany' };
// Its cash and calendar scenarios were set before every club started with staff (format 74): it keeps the earlier staffing.
const career = () => createSeason({ seed: 227, managedClubId: club, injuryMode: 'off', manager, ...NEW_CAREER_SYSTEMS, staffing: false });
/** Rule fixtures only: an artificial cost or sold-out gate, without claiming to be a valid career export. */
function entry(state: SeasonState, fields: Partial<FinanceEntry>): SeasonState {
  const item: FinanceEntry = { id: `finance-${state.finance.ledger.length + 1}`, clubId: club, seasonNumber: state.seasonNumber, round: state.round, kind: 'operations', amount: 0, sourceId: `test-${state.finance.ledger.length}`, ticket: null, coach: null, payroll: null, ...fields };
  return { ...state, finance: { ...state.finance, ledger: [...state.finance.ledger, item] } };
}
const spend = (state: SeasonState, amount: number) => entry(state, { amount: -amount });
const soldOut = (state: SeasonState, capacity: number) => [1, 2].reduce((next, game) => entry(next, { kind: 'tickets', amount: 0, sourceId: `test-gate-${game}`, ticket: { fixtureId: `test-${game}`, price: 2_000, attendance: capacity, capacity } }), state);
const noop = () => {};
const until = (state: SeasonState, done: (state: SeasonState) => boolean, limit = 40) => { let next = state; for (let step = 0; step < limit && !done(next); step += 1) next = advanceMatchday(next); return next; };
function toNextSeason(state: SeasonState): SeasonState {
  let next = until(state, item => item.status !== 'active');
  next = setEmploymentDelegation(next, true);
  for (let step = 0; step < 80 && getMarketStartReason(next); step += 1) next = advanceMarket(next);
  return rolloverSeason(next);
}

describe('six facility levels (format 74 model)', () => {
  it('starts new careers with six named levels, the arena as seats and the bank loan, and no upkeep plans or board capital', () => {
    const state = career();
    expect(state.facilities).toMatchObject({ model: 'facilities-3', financing: 'bank-1', maintenanceSince: null });
    const view = getClubFacilities(state);
    expect(view.rows.map(row => [row.type, row.maxLevel, row.levelName])).toEqual([['arena', 6, null], ['training', 6, 'Average'], ['youth', 6, 'Average'], ['medical', 6, 'Average'], ['scouting', 6, 'Average']]);
    expect(view.rows.find(row => row.type === 'arena')!.quote.reason).toMatch(/seats instead of levels/);
    expect(view.expansions.map(item => item.seats)).toEqual([500, 1_000]);
    expect(quoteBoardFunding(state, 'training').reason).toMatch(/paid from Remaining budget/);
    expect(() => takeFacilityLoan(state, 'training')).toThrow();
  });

  it('places each club\'s starting levels by its money level and stature', () => {
    const pack = economyPack([
      { id: 'acb', name: 'Liga ACB', country: 'Spain', tier: 1, levels: [17, 16, 15, 13, 12, 11, 10, 9] },
      { id: 'feb', name: 'Primera FEB', country: 'Spain', tier: 2, levels: [10, 9, 9, 8, 7, 6] },
    ], { members: ['acb-1', 'acb-2'] });
    const world = worldFromPack(pack, ['acb', 'feb']);
    const levels = (clubId: string) => (['training', 'youth', 'medical', 'scouting'] as const).map(type => startingFacilityLevel({ world }, clubId, type));
    const average = (clubId: string) => levels(clubId).reduce((sum, level) => sum + level, 0) / 4;
    for (const id of ['acb-1', 'acb-3', 'acb-8', 'feb-1', 'feb-6']) for (const level of levels(id)) expect(level).toBeGreaterThanOrEqual(1), expect(level).toBeLessThanOrEqual(6);
    expect(average('acb-1')).toBeGreaterThanOrEqual(4);
    expect(average('acb-1')).toBeGreaterThan(average('acb-8'));
    expect(average('acb-3')).toBeGreaterThan(average('feb-6'));
    expect(average('feb-6')).toBeLessThanOrEqual(3);
    // Without an economy every club starts Average; the arena has seats, not levels.
    expect(startingFacilityLevel({}, club, 'training')).toBe(3);
    expect(startingFacilityLevel({ world }, 'acb-1', 'arena')).toBe(3);
  });

  it('scales every effect over six levels: below today\'s base at Very Poor, today\'s top at Excellent', () => {
    const rules = FACILITY_RULES_3;
    for (const table of [rules.practicePercent, rules.medicalRecoveryPercent, rules.medicalRecurrencePercent, rules.medicalPhysioPercent, rules.scoutingEvidencePercent, rules.scoutingDiscoveryPercent]) {
      expect(table).toHaveLength(6);
      expect(table[0]).toBeLessThan(0);
      expect(table[2]).toBe(0);
      for (let index = 1; index < 6; index += 1) expect(table[index]).toBeGreaterThan(table[index - 1]!);
    }
    expect(rules.practicePercent[5]).toBe(10);
    expect(rules.medicalRecoveryPercent[5]).toBe(FACILITY_RULES_2.medicalRecoveryPercent[3]);
    expect(rules.scoutingEvidencePercent[5]).toBe(FACILITY_RULES_2.scoutingEvidencePercent[3]);
    for (const table of Object.values(rules.costs)) for (let index = 2; index < 6; index += 1) expect(table[index]).toBeGreaterThan(table[index - 1]!);
  });
});

describe('a six-level upgrade, an arena expansion and a bank loan', () => {
  let opening: SeasonState, upgraded: SeasonState, built: SeasonState, borrowed: SeasonState, expanding: SeasonState, expanded: SeasonState;
  beforeAll(() => {
    opening = career();
    upgraded = startFacilityUpgrade(opening, 'training');
    built = until(upgraded, state => getFacilityLevel(state, 'training', club) === 4);
    borrowed = takeBankLoan(built, 10_000_000, 2);
    expanding = startArenaExpansion(borrowed, 500);
    expanded = until(expanding, state => state.facilities.projects.at(-1)!.completedOn !== null || state.status !== 'active');
  }, 600_000);

  it('raises one level at a time, paid in full from Remaining budget, with its effect and upkeep from completion', () => {
    const quote = quoteFacilityUpgrade(opening, 'training');
    expect(quote).toMatchObject({ fromLevel: 3, toLevel: 4, cost: FACILITY_RULES_3.costs.training[3], durationDays: FACILITY_RULES_3.weeks[3]! * 7, bonusAfter: 4, canStart: true });
    expect(getSpendableCash(upgraded, club)).toBe(getSpendableCash(opening, club) - quote.cost);
    expect(getFacilityLevel(upgraded, 'training', club)).toBe(3);
    expect(facilityPracticeBonusPercent(upgraded, 'training', club)).toBe(0);
    expect(getFacilityLevel(built, 'training', club)).toBe(4);
    expect(facilityPracticeBonusPercent(built, 'training', club)).toBe(4);
    expect(getClubFacilities(built).rows.find(row => row.type === 'training')).toMatchObject({ levelName: 'Good', upkeepPerRound: FACILITY_RULES_3.upkeep.training[3]! - FACILITY_RULES_3.upkeep.training[2]! });
    expect(medicalRecoveryPercent(built, club)).toBe(0);
    expect(scoutingEvidencePercent(built, club)).toBe(0);
    expect(quoteFacilityUpgrade(upgraded, 'medical').reason).toMatch(/Finish or cancel/);
  });

  it('adds a bank loan to Remaining budget at once and keeps this season\'s budget whole until repayments start next season', () => {
    const quote = quoteBankLoan(built, club, 2, 10_000_000);
    expect(quote).toMatchObject({ principal: 10_000_000, seasons: 2, payments: 2 * paymentRounds(seasonRounds(built)).length, canBorrow: true });
    expect(quote.rateBasisPoints).toBeGreaterThanOrEqual(400);
    expect(quote.rateBasisPoints).toBeLessThanOrEqual(700);
    expect(getSpendableCash(borrowed, club)).toBe(getSpendableCash(built, club) + 10_000_000);
    expect(getFinanceBalance(borrowed.finance, club).cash).toBe(getFinanceBalance(built.finance, club).cash + 10_000_000);
    expect(debtReserve(borrowed, club)).toBe(0);
    expect(quote.schedule.every(payment => payment.seasonNumber > built.seasonNumber)).toBe(true);
    expect(quote.schedule.at(-1)!.balanceAfter).toBe(0);
    expect(quote.total).toBe(quote.schedule.reduce((sum, payment) => sum + payment.amount, 0));
    expect(getClubDebts(borrowed)).toMatchObject({ enabled: true, outstanding: 10_000_000, limit: bankLoanLimit(borrowed, club) });
    expect(quoteBankLoan(borrowed, club, 5, 1_000_000).reason).toMatch(/term of 1, 2, 3, 4 seasons/);
    expect(quoteBankLoan(borrowed, club, 2, bankLoanLimit(borrowed, club)).reason).toMatch(/borrowing limit/);
  });

  it('adds the arena\'s seats only when the expansion is finished, and the next home gate uses them', () => {
    const quote = quoteArenaExpansion(borrowed, 500);
    expect(quote).toMatchObject({ seats: 500, capacityAfter: quote.capacityBefore + 500, durationDays: FACILITY_RULES_3.expansionWeeks[0]! * 7, cost: FACILITY_RULES_3.expansionCosts[0], canStart: true });
    expect(getArenaCapacity(expanding, club)).toBe(quote.capacityBefore);
    expect(expanded.status).toBe('active');
    expect(getArenaCapacity(expanded, club)).toBe(quote.capacityBefore + 500);
    expect(expanded.finance.roundCapacities![club]).toBe(quote.capacityBefore + 500);
    expect(getFacilityUpkeep(expanded, club)).toBe(getFacilityUpkeep(built, club) + quote.upkeepAfter);
    const home = expanded.fixtures.find(fixture => fixture.homeClubId === club && !fixture.result);
    if (home) expect(forecastGate(expanded, home, 2_000).capacity).toBe(quote.capacityBefore + 500);
    // Sizes follow the arena: at most half its seats, the smallest always.
    expect(arenaExpansionSizes(expanded, club)).toEqual(FACILITY_RULES_3.expansionSeats.filter((seats, index) => index === 0 || seats * 2 <= quote.capacityBefore + 500));
  });

  it('keeps the strict save check consistent across the upgrade, the loan and the expansion', () => {
    const restored = parseSeason(serializeSeason(expanded));
    expect(restored.facilities).toEqual(expanded.facilities);
    expect(getArenaCapacity(restored, club)).toBe(getArenaCapacity(expanded, club));
    expect(parseSeason(serializeSeasonCompact(expanded)).facilities.debts).toEqual(expanded.facilities.debts);
  });

  it('shows one switch, each level with one Upgrade button, the arena seats with Expand, and the Bank', () => {
    const html = renderToStaticMarkup(<SimpleFacilitiesPanel season={built} onEnableFacilities={noop} onFacilityUpgrade={noop} onCancelFacilityUpgrade={noop} onFacilityDelegation={noop} onArenaExpansion={noop} />);
    expect(html).toContain('Let the board handle facilities');
    expect(html).not.toMatch(/Reduced|Manual|Lease|Repair/);
    expect(html).toContain('data-facility-upgrade="arena"');
    expect(html.match(/data-facility-upgrade="/g)).toHaveLength(5);
    expect(html).toContain('Good');
    const bank = renderToStaticMarkup(<BankPanel season={borrowed} onBorrow={noop} onRepayLoan={noop} />);
    expect(bank).toContain('Borrow');
    expect(bank).toContain(`data-debts-outstanding="10000000"`);
    expect(bank).toContain('Next payment');
  });
});

describe('repayments and season ends', () => {
  let ended: SeasonState, offseasonExpansion: SeasonState, nextSeason: SeasonState, paid: SeasonState;
  beforeAll(() => {
    const borrowed = takeBankLoan(career(), 5_000_000, 1);
    ended = until(borrowed, state => state.status !== 'active');
    offseasonExpansion = startArenaExpansion(ended, 500);
    nextSeason = toNextSeason(offseasonExpansion);
    paid = until(nextSeason, state => state.status !== 'active');
  }, 900_000);

  it('repays the loan with interest from next season, reserving each season\'s payments', () => {
    const debt = nextSeason.facilities.debts![0]!;
    const schedule = debtSchedule(debt, seasonRounds(nextSeason));
    expect(schedule.every(payment => payment.seasonNumber === 2)).toBe(true);
    expect(debtReserve(nextSeason, club)).toBe(schedule.reduce((sum, payment) => sum + payment.amount, 0));
    const payments = paid.finance.ledger.filter(item => item.debt?.debtId === debt.id && typeof item.debt.payment === 'number');
    expect(payments.map(item => -item.amount)).toEqual(schedule.map(payment => payment.amount));
    expect(outstandingDebt(paid, club)).toBe(0);
    expect(-payments.reduce((sum, item) => sum + item.amount, 0)).toBeGreaterThan(5_000_000);
  });

  it('finishes an expansion started at a season end by the next season\'s first home gate, and the strict check agrees', () => {
    const project = offseasonExpansion.facilities.projects.at(-1)!;
    expect(project).toMatchObject({ kind: 'expansion', seats: 500, clubId: club });
    const done = nextSeason.facilities.projects.find(item => item.id === project.id)!;
    const capacity = getArenaCapacity(ended, club);
    // Here the work's planned day falls in the offseason, so the new season's opening day completes it before the first gate.
    expect(done.completedOn).toBe(nextSeason.date);
    expect(nextSeason.finance.roundCapacities![club]).toBe(capacity + 500);
    const settled = until(nextSeason, state => state.facilities.projects.find(item => item.id === project.id)!.completedOn !== null);
    expect(getArenaCapacity(settled, club)).toBe(capacity + 500);
    expect(parseSeason(serializeSeason(offseasonExpansion)).facilities).toEqual(offseasonExpansion.facilities);
    expect(parseSeason(serializeSeason(nextSeason)).facilities).toEqual(nextSeason.facilities);
    expect(parseSeason(serializeSeason(paid)).facilities.debts).toEqual(paid.facilities.debts);
    // The compact save seals the completed season; the loan, its payments and the seats survive it.
    const sealed = parseSeason(serializeSeasonCompact(paid));
    expect(sealed.facilities.debts).toEqual(paid.facilities.debts);
    expect(getArenaCapacity(sealed, club)).toBe(capacity + 500);
  });

  it('repays a loan early for what is left plus the fee', () => {
    const started = takeBankLoan(nextSeason, 2_000_000, 2);
    const id = started.facilities.debts!.at(-1)!.id;
    const repaid = repayFacilityLoan(started, id);
    expect(getSpendableCash(repaid, club)).toBe(getSpendableCash(started, club) - 2_000_000 - 40_000);
    expect(outstandingDebt(repaid, club)).toBe(outstandingDebt(nextSeason, club));
  });
});

describe('paying for projects and the board\'s prudent loans', () => {
  it('points a short budget to the bank instead of asking how to pay', () => {
    const state = career();
    const short = spend(state, getSpendableCash(state, club) - 1_000_000);
    expect(quoteFacilityUpgrade(short, 'training').reason).toBe(FACILITY_BANK_REASON);
    expect(quoteArenaExpansion(short, 500).reason).toBe(FACILITY_BANK_REASON);
    const html = renderToStaticMarkup(<SimpleFacilitiesPanel season={short} onEnableFacilities={noop} onFacilityUpgrade={noop} onCancelFacilityUpgrade={noop} onFacilityDelegation={noop} onArenaExpansion={noop} onBorrowFor={noop} />);
    expect(html).toContain('Let the board handle facilities');
  });

  it('borrows only the shortfall to expand a sold-out arena, once, keeping its cash cushion (computer clubs and the board alike)', () => {
    const state = career();
    const cost = quoteArenaExpansion(state, 500).cost, cushion = upgradeAutomationCushion(state, club);
    const short = soldOut(spend(state, getSpendableCash(state, club) - (cost + cushion - 5_000_000)), getArenaCapacity(state, club));
    const run = setFacilityDelegation(short, true);
    const debt = run.facilities.debts!.find(item => item.clubId === club)!;
    expect(debt).toMatchObject({ kind: 'bank', seasons: BANK_LOAN_RULES.automaticTermSeasons, principal: 5_000_000 });
    expect(run.facilities.projects.at(-1)).toMatchObject({ clubId: club, kind: 'expansion', seats: 500 });
    expect(getSpendableCash(run, club)).toBeGreaterThanOrEqual(cushion);
    // No sold-out arena, or a loan still running: no new loan.
    expect(setFacilityDelegation(spend(state, getSpendableCash(state, club) - (cost + cushion - 5_000_000)), true).facilities.debts).toEqual([]);
    const owing = soldOut(takeBankLoan(short, 1_000_000, 1), getArenaCapacity(state, club));
    expect(automateFacilities({ ...owing, facilities: { ...owing.facilities, delegated: { ...owing.facilities.delegated, [club]: true } } }).facilities.debts!.filter(item => item.clubId === club)).toHaveLength(1);
  });

  it('takes the loan and starts the expansion during the calendar, and the strict save check rebuilds both', () => {
    // Cancelled projects are not refunded, so the board is left short of the expansion plus its cushion; free tickets sell out.
    let state = setTicketPlan(career(), { delegated: false, price: 0 });
    for (const type of ['training', 'youth', 'medical', 'scouting'] as const) state = cancelFacilityUpgrade(startFacilityUpgrade(state, type), `facility-project-${state.facilities.projects.length + 1}`);
    expect(getSpendableCash(state, club)).toBeLessThan(quoteArenaExpansion(state, 500).cost + upgradeAutomationCushion(state, club));
    state = setFacilityDelegation(state, true);
    state = until(state, next => next.facilities.debts!.some(debt => debt.clubId === club), 10);
    const debt = state.facilities.debts!.find(item => item.clubId === club)!;
    expect(debt).toMatchObject({ kind: 'bank', seasons: BANK_LOAN_RULES.automaticTermSeasons, date: state.date });
    expect(state.facilities.projects.find(project => project.clubId === club && project.kind === 'expansion')).toMatchObject({ seats: 500, startedOn: state.date });
    expect(parseSeason(serializeSeason(state)).facilities).toEqual(state.facilities);
  }, 600_000);
});
