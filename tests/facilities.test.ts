import { describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import type { FinanceEntry } from '../src/domain/finance';
import { createSeason, dateForRound } from '../src/world/season';
import { applyFacilityEvent, automateFacilities, cancelFacilityUpgrade, createFacilities, enableFacilities, facilitiesAtEventCount, facilityEventAnchor, processFacilityProjects, setFacilityDelegation, startFacilityUpgrade } from '../src/world/facilities';
import { FACILITY_AUTOMATION_BUFFER, facilityPracticeBonusPercent, getArenaCapacity, getArenaFullCapacity, getClubFacilities, getFacilityLevel, getFacilityUpkeep, quoteFacilityUpgrade } from '../src/world/facilities-policy';
import { forecastGate, getFinanceBalance, prepareFinanceRound, processFinanceRound } from '../src/world/finance';
import { getSpendableCash } from '../src/world/payroll-policy';
import { offerAcademyPromotion } from '../src/world/academy';
import { getClubAcademy } from '../src/world/academy-policy';

const clubId = 'rhine-falcons';
function initial(): SeasonState {
  const state = createSeason(227, clubId, 'off', true, false, true, true, null, true, false, true, false, false, false, false, false, true);
  return { ...state, facilities: createFacilities(state.clubs, state.managedClubId) };
}
const enabled = () => enableFacilities(initial());
const atRound = (state: SeasonState, round: number): SeasonState => ({ ...state, round, date: dateForRound(round, state.seasonNumber) });
function freeze<T>(value: T): T { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
/** Pure guard fixtures use artificial operating expenses, without claiming to be valid career exports. */
function spend(state: SeasonState, amount: number): SeasonState {
  const entry: FinanceEntry = { id: `finance-${state.finance.ledger.length + 1}`, clubId, seasonNumber: state.seasonNumber, round: state.round, kind: 'operations', amount: -amount, sourceId: 'test-cost', ticket: null, coach: null, payroll: null };
  return { ...state, finance: { ...state.finance, ledger: [...state.finance.ledger, entry] } };
}

describe('funded, dated club facilities', () => {
  it('activates prospectively, preserves sporting state and keeps dormant systems unavailable', () => {
    const before = freeze(initial()), after = enableFacilities(before);
    expect(after.activeMatch!).toBe(before.activeMatch!);
    expect(after.training).toBe(before.training);
    expect(after.academy).toBe(before.academy);
    expect(after.finance.roundPrices).toBe(before.finance.roundPrices);
    expect(after.facilities.projects.every(project => project.clubId !== clubId)).toBe(true);
    expect(enableFacilities(after)).toBe(after);
    expect(processFacilityProjects(before)).toBe(before);
    expect(getFacilityLevel(before, 'training', clubId)).toBe(1);
    expect(facilityPracticeBonusPercent(before, 'training', clubId)).toBe(0);
    expect(getFacilityUpkeep(before, clubId)).toBe(0);
    expect(quoteFacilityUpgrade({ ...after, training: { ...after.training, enabledSince: null } }, 'training').reason).toMatch(/Enable senior training/);
    expect(quoteFacilityUpgrade({ ...after, academy: { ...after.academy, enabledSince: null } }, 'youth').reason).toMatch(/Open the youth academy/);
    expect(() => enableFacilities({ ...before, finance: { ...before.finance, enabledSince: null } })).toThrow(/finances/);
  });

  it('pays the fixed quote once, retains cancelled costs, and protects salary and live promotion holds', () => {
    const before = enabled(), quote = quoteFacilityUpgrade(before, 'youth');
    const started = startFacilityUpgrade(freeze(before), 'youth');
    const project = started.facilities.projects.at(-1)!;
    expect(quote).toMatchObject({ cost: 6_000_000, durationDays: 21, fromLevel: 1, toLevel: 2, upkeepAfter: 30_000, bonusAfter: 5, canStart: true });
    expect(getFinanceBalance(started.finance, clubId).cash).toBe(getFinanceBalance(before.finance, clubId).cash - quote.cost);
    expect(started.finance.ledger.at(-1)).toMatchObject({ kind: 'facility', amount: -quote.cost, sourceId: project.id, facility: { projectId: project.id, type: 'youth' } });
    expect(quoteFacilityUpgrade(started, 'arena').reason).toMatch(/current club project/);
    expect(() => startFacilityUpgrade(started, 'arena')).toThrow(/current club project/);
    const cancelled = cancelFacilityUpgrade(started, project.id);
    expect(cancelled.finance).toBe(started.finance);
    expect(getFacilityLevel(cancelled, 'youth', clubId)).toBe(1);
    expect(() => cancelFacilityUpgrade(cancelled, project.id)).toThrow(/still under construction/);
    const prospect = getClubAcademy(before)[0]!;
    const offered = offerAcademyPromotion(before, prospect.player.id, 2_000_000);
    const affordableWithoutOffer = spend(before, getSpendableCash(before, clubId) - quote.cost);
    const held = { ...offered, finance: affordableWithoutOffer.finance };
    expect(quoteFacilityUpgrade(affordableWithoutOffer, 'youth').canStart).toBe(true);
    expect(quoteFacilityUpgrade(held, 'youth').reason).toMatch(/salary and transfer commitments/);
    expect(quoteFacilityUpgrade(spend(before, getFinanceBalance(before.finance, clubId).cash + 1), 'arena').reason).toMatch(/unpaid/);
  });

  it('requires a real completion command and retains historical levels and first eligible practice date', () => {
    const started = startFacilityUpgrade(enabled(), 'training'), project = started.facilities.projects.at(-1)!;
    const due = atRound(started, 4);
    expect(project.dueOn).toBe(due.date);
    expect(getFacilityLevel(due, 'training', clubId)).toBe(1);
    expect(facilityPracticeBonusPercent(due, 'training', clubId)).toBe(0);
    expect(processFacilityProjects(atRound(started, 3))).toEqual(atRound(started, 3));
    const completed = processFacilityProjects(freeze(due));
    expect(completed.finance).toBe(due.finance);
    expect(completed.activeMatch!).toBe(due.activeMatch!);
    expect(getFacilityLevel(completed, 'training', clubId)).toBe(2);
    expect(facilityPracticeBonusPercent(completed, 'training', clubId, dateForRound(3))).toBe(0);
    expect(facilityPracticeBonusPercent(completed, 'training', clubId, dateForRound(4))).toBe(5);
    const prior = facilitiesAtEventCount(completed.facilities, started.facilities.events.length, clubId);
    expect(prior).toEqual(started.facilities);
    expect(getFacilityLevel({ ...completed, facilities: prior }, 'training', clubId)).toBe(1);
    expect(processFacilityProjects(completed)).toBe(completed);
    expect(() => cancelFacilityUpgrade(completed, project.id)).toThrow(/still under construction/);
  });

  it('retains all three upgrade terms with diminishing benefits and stops at level four', () => {
    let state = enabled();
    const costs: number[] = [], days: number[] = [];
    for (const expected of [2, 3, 4]) {
      const quote = quoteFacilityUpgrade(state, 'youth');
      costs.push(quote.cost); days.push(quote.durationDays);
      const started = startFacilityUpgrade(state, 'youth');
      state = processFacilityProjects({ ...started, date: quote.dueOn });
      expect(getFacilityLevel(state, 'youth', clubId)).toBe(expected);
      expect(facilityPracticeBonusPercent(state, 'youth', clubId)).toBe([0, 0, 5, 8, 10][expected]);
    }
    expect(costs).toEqual([6_000_000, 10_000_000, 15_000_000]);
    expect(days).toEqual([21, 28, 42]);
    expect(quoteFacilityUpgrade(state, 'youth')).toMatchObject({ fromLevel: 4, toLevel: 4, canStart: false, upkeepAfter: 70_000 });
    expect(() => startFacilityUpgrade(state, 'youth')).toThrow(/highest/);
    expect(state.facilities.projects.filter(project => project.clubId === clubId)).toHaveLength(3);
  });

  it('locks current gates through starts and cancellations while dated future gates reflect construction', () => {
    const state = enabled(), fixture = state.fixtures.find(fixture => fixture.round === 1 && fixture.homeClubId === clubId)!;
    const prior = forecastGate(state, fixture, 0), started = startFacilityUpgrade(state, 'arena');
    expect(forecastGate(started, fixture, 0)).toEqual(prior);
    expect(getArenaCapacity(started, clubId, dateForRound(2))).toBe(3600);
    const prepared = prepareFinanceRound(atRound(started, 2)), project = started.facilities.projects.at(-1)!;
    const cancelled = cancelFacilityUpgrade(prepared, project.id);
    expect(cancelled.finance.roundCapacities![clubId]).toBe(3600);
    expect(getArenaCapacity(cancelled, clubId, cancelled.date)).toBe(3600);
    expect(getArenaCapacity(cancelled, clubId, dateForRound(3))).toBe(4000);
    const completed = prepareFinanceRound(processFacilityProjects(atRound(started, 4)));
    expect(completed.finance.roundCapacities![clubId]).toBe(4500);
    expect(getArenaFullCapacity(completed, clubId)).toBe(4500);
    const offseason = { ...completed, status: 'complete' as const, finance: { ...completed.finance, roundCapacities: { ...completed.finance.roundCapacities!, [clubId]: 4000 } } };
    expect(getClubFacilities(offseason).arenaCapacity).toBe(4500);
  });

  it('books only completed-level upkeep separately from fixed operating costs, including unpaid obligations', () => {
    const completed = processFacilityProjects(atRound(startFacilityUpgrade(enabled(), 'training'), 4));
    const prepared = prepareFinanceRound(completed);
    // Only result existence/winner is consumed by the financial posting command.
    const committed = { ...prepared, fixtures: prepared.fixtures.map(fixture => fixture.round === 4 ? { ...fixture, result: { winnerClubId: fixture.homeClubId } as NonNullable<typeof fixture.result> } : fixture) };
    const posted = processFinanceRound(committed);
    const upkeep = posted.finance.ledger.find(entry => entry.clubId === clubId && entry.kind === 'facility-upkeep')!;
    expect(upkeep).toMatchObject({ amount: -40_000, sourceId: 'facility-upkeep-s1-r4', facilityUpkeep: { arena: 0, training: 40_000, youth: 0 } });
    expect(posted.finance.ledger.filter(entry => entry.clubId === clubId && entry.kind === 'operations')).toHaveLength(1);
    expect(posted.finance.ledger.filter(entry => entry.ticket && entry.round === 4).every(entry => Number.isInteger(entry.ticket!.capacity))).toBe(true);
    expect(() => processFinanceRound(posted)).toThrow(/already been recorded/);
  });

  it('uses the same guarded price for delegated clubs and preserves the additional automatic buffer', () => {
    const state = enabled(), manualBalance = getSpendableCash(state, clubId);
    const automatic = setFacilityDelegation(state, true), project = automatic.facilities.projects.find(project => project.clubId === clubId)!;
    expect(project.type).toBe('youth');
    expect(project.cost).toBe(quoteFacilityUpgrade(state, 'youth').cost);
    expect(manualBalance - project.cost).toBeGreaterThanOrEqual(FACILITY_AUTOMATION_BUFFER);
    expect(automateFacilities(automatic)).toBe(automatic);
    const tight = spend(state, getSpendableCash(state, clubId) - 6_000_000 - FACILITY_AUTOMATION_BUFFER + 1);
    expect(quoteFacilityUpgrade(tight, 'youth').canStart).toBe(true);
    expect(setFacilityDelegation(tight, true).facilities.projects.some(project => project.clubId === clubId)).toBe(false);
    const event = { ...facilityEventAnchor(state), type: 'start' as const, projectId: `facility-project-${state.facilities.projects.length + 1}`, clubId, facilityType: 'arena' as const };
    expect(() => applyFacilityEvent(state, { ...event, ledgerIndex: event.ledgerIndex - 1 })).toThrow(/exact calendar/);
    expect(applyFacilityEvent(state, event)).toEqual(startFacilityUpgrade(state, 'arena'));
  });
});
