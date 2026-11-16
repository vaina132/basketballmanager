import { beforeAll, describe, expect, it } from 'vitest';
import type { FacilityProject, FacilityType, SeasonFacilities } from '../src/domain/facilities';
import type { FinanceEntry } from '../src/domain/finance';
import type { ScoutingReview } from '../src/domain/scouting';
import type { SeasonState } from '../src/domain/season';
import { MATCH_INJURY_TYPES } from '../src/domain/injuries';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { quoteBoardFunding } from '../src/world/board-funding-policy';
import { automateFacilities, processFacilityProjects, requestBoardFunding, setFacilityDelegation, setMaintenancePlan, startFacilityRepair, startFacilityUpgrade } from '../src/world/facilities';
import { arenaComfortPercent, conditionEffectPercent, facilityPracticeBonusPercent, facilityWeeklyWear, FACILITY_RULES_2, getClubFacilities, getFacilityCondition, getFacilityUpkeepBreakdown, medicalPhysioPercent, medicalRecoveryPercent, medicalRecurrencePercent, quoteFacilityRepair, scoutingDiscoveryPercent, scoutingEvidencePercent } from '../src/world/facilities-policy';
import { getFinanceBalance } from '../src/world/finance';
import { createSeasonInjury, withMedicalRecurrence } from '../src/world/health';
import { getSpendableCash } from '../src/world/payroll-policy';
import { getPlayerKnowledge } from '../src/world/scouting-policy';
import { getScoutingDiscovery } from '../src/world/scouting-discovery';
import { createSeason, dateForRound, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { seasonRounds } from '../src/world/career-world';
import { advanceMatchday } from './helpers/board-funding';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FacilitiesPanel } from '../src/ui/FacilitiesPanel';

const club = 'rhine-falcons';
const opening = dateForRound(1, 1);
const career = (managedClubId = club) => createSeason({ seed: 227, managedClubId, injuryMode: 'off', manager: { name: 'Repair Manager', dateOfBirth: '1984-03-17', nationality: 'Germany' }, ...NEW_CAREER_SYSTEMS });

/** A synthetic `facilities-2` history: one completed project per facility, at the given level, on the opening day. */
function built(levels: Partial<Record<FacilityType, number>>, extra: Partial<SeasonFacilities> = {}): { facilities: SeasonFacilities } {
  const anchor = { seasonNumber: 1, round: 1, date: opening, ledgerIndex: 0, contractCount: 0, negotiationCount: 0, recruitmentEventCount: 0, marketEventCount: 0 };
  const projects: FacilityProject[] = Object.entries(levels).map(([type, level], index) => ({ id: `facility-project-${index + 1}`, clubId: club, type: type as FacilityType, fromLevel: level! - 1, toLevel: level!, cost: 0, startedOn: opening, dueOn: opening, completedOn: opening, cancelledOn: null, startEventIndex: 0 }));
  return { facilities: { model: 'facilities-2', enabledSince: anchor, delegated: {}, projects, events: [], fundingSince: null, maintenanceSince: null, ...extra } };
}
const ledger = (state: SeasonState) => state.finance.ledger;
/** Pure guard fixtures use an artificial operating expense, without claiming to be valid career exports. */
function spend(state: SeasonState, clubId: string, amount: number): SeasonState {
  const entry: FinanceEntry = { id: `finance-${state.finance.ledger.length + 1}`, clubId, seasonNumber: state.seasonNumber, round: state.round, kind: 'operations', amount: -amount, sourceId: 'test-cost', ticket: null, coach: null, payroll: null };
  return { ...state, finance: { ...state.finance, ledger: [...state.finance.ledger, entry] } };
}
/** The same career read on a later date: every facility has worn for the weeks in between (calendar not advanced). */
const wornUntil = (state: SeasonState, date: string): SeasonState => ({ ...state, date });

describe('facilities-2 rules (format 65)', () => {
  it('starts new careers with five facilities, and keeps three in older careers', () => {
    const state = career();
    expect(state.facilities.model).toBe('facilities-2');
    expect(getClubFacilities(state).rows.map(row => row.type)).toEqual(['arena', 'training', 'youth', 'medical', 'scouting']);
    expect(getFacilityUpkeepBreakdown(state, club)).toEqual({ arena: 0, training: 0, youth: 0, medical: 0, scouting: 0, total: 0 });
    const legacy: SeasonState = { ...state, facilities: { ...state.facilities, model: 'facilities-1' } };
    expect(getClubFacilities(legacy).rows.map(row => row.type)).toEqual(['arena', 'training', 'youth']);
    expect(getClubFacilities(legacy).rows.every(row => row.repair === null)).toBe(true);
    expect(getFacilityCondition(wornUntil(legacy, dateForRound(1, 3)), 'arena', club)).toBe(100);
    expect(quoteFacilityRepair(legacy, 'arena').reason).toMatch(/current facilities model/);
  });

  it('wears the arena and upgraded facilities each season, faster at higher levels, with heavy use and reduced upkeep', () => {
    const rounds = seasonRounds({}), nextSeason = dateForRound(1, 2);
    const standard = built({});
    // Level 1: standard rooms have no condition; the arena wears 8 x 125% points a season.
    expect(getFacilityCondition({ ...standard, date: nextSeason }, 'training', club)).toBe(100);
    expect(getFacilityCondition({ ...standard, date: nextSeason }, 'arena', club)).toBe(100 - Math.floor(rounds * facilityWeeklyWear('arena', 1, false, rounds) / 100));
    // The development league plays ten weeks a season.
    expect(rounds).toBe(10);
    expect(getFacilityCondition({ ...standard, date: nextSeason }, 'arena', club)).toBe(90);
    const top = built({ arena: 4, scouting: 4, medical: 2 });
    const arena = getFacilityCondition({ ...top, date: nextSeason }, 'arena', club), scouting = getFacilityCondition({ ...top, date: nextSeason }, 'scouting', club), medical = getFacilityCondition({ ...top, date: nextSeason }, 'medical', club);
    // Level 4 arena: 14 x 125%; level 4 scouting office: 14 x 75%; level 2 medical centre: 10 x 100%.
    expect([arena, scouting, medical]).toEqual([83, 90, 90]);
    // Reduced upkeep from the opening day triples the wear of upgraded facilities.
    const maintenance = { seasonNumber: 1, round: 1, date: opening, ledgerIndex: 0, contractCount: 0, negotiationCount: 0, recruitmentEventCount: 0, marketEventCount: 0 };
    const neglected = built({ arena: 4 }, { maintenanceSince: maintenance, events: [{ ...maintenance, type: 'maintenance', clubId: club, plan: 'reduced' }] });
    expect(getFacilityCondition({ ...neglected, date: dateForRound(2, 1) }, 'arena', club)).toBe(100 - Math.floor(facilityWeeklyWear('arena', 4, false, rounds) / 100));
    expect(getFacilityCondition({ ...neglected, date: nextSeason }, 'arena', club)).toBe(100 - Math.floor((facilityWeeklyWear('arena', 4, false, rounds) + (rounds - 1) * facilityWeeklyWear('arena', 4, true, rounds)) / 100));
    expect(getFacilityCondition({ ...neglected, date: dateForRound(1, 4) }, 'arena', club)).toBe(0);
  });

  it('shrinks effects below condition 80 and lowers arena attendance demand', () => {
    expect([100, 80, 60, 40, 0].map(conditionEffectPercent)).toEqual([100, 100, 85, 70, 40]);
    const fresh = built({ training: 4, arena: 2 }), later = { ...fresh, date: dateForRound(1, 4) };
    expect(facilityPracticeBonusPercent({ ...fresh, date: dateForRound(2, 1) }, 'training', club)).toBe(10);
    expect(getFacilityCondition(later, 'training', club)).toBe(48);
    expect(facilityPracticeBonusPercent(later, 'training', club)).toBe(8);
    expect(arenaComfortPercent({ ...fresh, date: dateForRound(2, 1) }, club)).toBe(100);
    expect(getFacilityCondition(later, 'arena', club)).toBe(63);
    expect(arenaComfortPercent(later, club)).toBeCloseTo(100 - (100 - conditionEffectPercent(63)) * FACILITY_RULES_2.arenaComfortLossPercent / 60, 6);
    expect(arenaComfortPercent(later, club)).toBeLessThan(100);
  });

  it('shortens injury recovery by at most 12% at the top medical level, and less when worn', () => {
    const top = { ...built({ medical: 4 }), date: dateForRound(2, 1) };
    expect([medicalRecoveryPercent(top, club), medicalRecurrencePercent(top, club), medicalPhysioPercent(top, club)]).toEqual([12, 15, 30]);
    expect(medicalRecoveryPercent({ ...built({ medical: 2 }), date: dateForRound(2, 1) }, club)).toBe(4);
    expect(medicalRecoveryPercent({ ...built({}), date: dateForRound(2, 1) }, club)).toBe(0);
    expect(medicalRecoveryPercent({ ...top, date: dateForRound(1, 6) }, club)).toBeLessThan(12);
    const fixture = { id: 'f1', date: dateForRound(2, 1) };
    let ratioMin = 1, ratioMax = 0, total = 0, shortened = 0;
    for (const type of MATCH_INJURY_TYPES) for (let player = 0; player < 30; player += 1) {
      const plain = createSeasonInjury(227, fixture, club, `p${player}`, type.kind), cared = createSeasonInjury(227, fixture, club, `p${player}`, type.kind, [], medicalRecoveryPercent(top, club));
      const days = (injury: typeof plain) => (Date.parse(injury.returnOn) - Date.parse(injury.occurredOn)) / 86_400_000;
      total += days(plain); shortened += days(cared);
      if (days(plain) >= 30) { ratioMin = Math.min(ratioMin, days(cared) / days(plain)); ratioMax = Math.max(ratioMax, days(cared) / days(plain)); }
      expect(days(cared)).toBeGreaterThanOrEqual(1);
    }
    expect(shortened / total).toBeGreaterThan(0.87);
    expect(shortened / total).toBeLessThan(0.89);
    expect(ratioMin).toBeGreaterThanOrEqual(0.86);
    expect(ratioMax).toBeLessThanOrEqual(0.9);
    // Recurrence: 15% of the extra risk is removed for the club's players only.
    const risks = withMedicalRecurrence({ a: { 'hamstring': 4 }, b: { 'hamstring': 4 } }, [{ playerIds: ['a'], percent: 15 }, { playerIds: ['b'], percent: 0 }]);
    expect(risks).toEqual({ a: { 'hamstring': 1 + 3 * 0.85 }, b: { 'hamstring': 4 } });
  });
});

describe('facilities-2 in a career', () => {
  let worn: SeasonState, repairing: SeasonState, repaired: SeasonState;
  beforeAll(() => {
    // Training level 2 is commissioned on the opening day and completes on matchday 4; reduced upkeep then wears it.
    let state = startFacilityUpgrade(career(), 'training');
    while (state.round < 4) state = advanceMatchday(state);
    state = setMaintenancePlan(state, 'reduced');
    while (getFacilityCondition(state, 'training', club) > 100 - FACILITY_RULES_2.repairMinimumMissing) state = advanceMatchday(state);
    worn = state;
    repairing = startFacilityRepair(setMaintenancePlan(worn, 'full'), 'training');
    const id = repairing.facilities.projects.at(-1)!.id;
    state = repairing;
    while (state.facilities.projects.find(project => project.id === id)!.completedOn === null) state = advanceMatchday(state);
    repaired = state;
  }, 180_000);

  it('books a repair with its cost and duration, and restores condition when it completes', { timeout: 60_000 }, () => {
    const before = setMaintenancePlan(worn, 'full'), quote = quoteFacilityRepair(before, 'training');
    expect(quote).toMatchObject({ level: 2, canStart: true, conditionBefore: getFacilityCondition(worn, 'training', club) });
    expect(quote.cost).toBe(Math.round(7_500_000 * 0.4 * (100 - quote.conditionBefore) / 100 / 10_000) * 10_000);
    expect(quote.durationDays).toBe(7);
    const project = repairing.facilities.projects.at(-1)!;
    expect(project).toMatchObject({ kind: 'repair', type: 'training', fromLevel: 2, toLevel: 2, cost: quote.cost, conditionBefore: quote.conditionBefore, dueOn: quote.dueOn, completedOn: null });
    expect(ledger(repairing).at(-1)).toMatchObject({ kind: 'facility', amount: -quote.cost, sourceId: project.id, facility: { projectId: project.id, type: 'training' } });
    expect(getFinanceBalance(repairing.finance, club).cash).toBe(getFinanceBalance(before.finance, club).cash - quote.cost);
    // One project at a time: no upgrade while the repair runs.
    expect(getClubFacilities(repairing).rows.find(row => row.type === 'arena')!.quote.reason).toMatch(/current club project/);
    expect(repaired.facilities.projects.find(item => item.id === project.id)!.completedOn).toBe(repaired.date);
    expect(getFacilityCondition(repaired, 'training', club)).toBe(100);
    expect(quoteFacilityRepair(repaired, 'training').reason).toMatch(/condition falls to 95/);
  });

  it('saves, loads and replays the repair, and refuses it in an older format', { timeout: 60_000 }, () => {
    for (const state of [worn, repairing, repaired]) expect(parseSeason(serializeSeason(state))).toEqual(state);
    const file = JSON.parse(serializeSeason(repairing));
    file.formatVersion = 64; file.state.schemaVersion = 64;
    expect(() => parseSeason(JSON.stringify(file))).toThrow(/facilities\.model requires format 65/);
  });

  it('shows five facilities, the worn condition with its repair, and the running repair', { timeout: 60_000 }, () => {
    const noop = () => {};
    const render = (season: SeasonState) => renderToStaticMarkup(createElement(FacilitiesPanel, { season, onEnableFacilities: noop, onFacilityUpgrade: noop, onCancelFacilityUpgrade: noop, onFacilityDelegation: noop, onRequestBoardFunding: noop, onEnableMaintenance: noop, onMaintenancePlan: noop, onFacilityRepair: noop }));
    const html = render(setMaintenancePlan(worn, 'full'));
    for (const type of ['arena', 'training', 'youth', 'medical', 'scouting']) expect(html).toContain(`data-facility="${type}"`);
    expect(html).toContain('Medical centre');
    expect(html).toContain('Scouting office');
    expect(html).toContain(`data-facility-condition="${getFacilityCondition(worn, 'training', club)}"`);
    expect(html).toContain('data-facility-repair="training"');
    expect(html).not.toContain('data-facility-repair="medical"');
    const running = render(repairing);
    expect(running).toContain('Training facilities · Repair');
    expect(running).toContain('Repairing');
    expect(running).toContain('Cancel repair');
  });
});

describe('facilities-2 automation and board capital', () => {
  it('repairs worn facilities of rival clubs through the same rules, before any upgrade', { timeout: 60_000 }, () => {
    // Four seasons later, the rivals' opening upgrades are complete and every arena has worn below 70.
    const state = career(), later = processFacilityProjects(wornUntil(state, dateForRound(1, 5)));
    const rivals = later.clubs.filter(item => item.id !== club);
    expect(later.facilities.projects.every(project => project.completedOn !== null)).toBe(true);
    for (const rival of rivals) expect(getFacilityCondition(later, 'arena', rival.id)).toBeLessThan(FACILITY_RULES_2.automaticRepairBelow);
    const automated = automateFacilities(later);
    const repairs = automated.facilities.projects.filter(project => project.kind === 'repair');
    expect(repairs.length).toBeGreaterThan(0);
    for (const project of repairs) {
      expect(project).toMatchObject({ type: 'arena', fromLevel: 1, toLevel: 1, startedOn: later.date });
      expect(project.clubId).not.toBe(club);
      expect(project.cost).toBe(quoteFacilityRepair(later, 'arena', project.clubId).cost);
      expect(ledger(automated).some(entry => entry.kind === 'facility' && entry.sourceId === project.id && entry.amount === -project.cost)).toBe(true);
    }
    // The manager's club is manual and is left alone until delegated.
    expect(automated.facilities.projects.some(project => project.clubId === club && project.kind === 'repair')).toBe(false);
    const delegated = setFacilityDelegation(later, true);
    expect(delegated.facilities.projects.some(project => project.clubId === club && project.kind === 'repair' && project.type === 'arena')).toBe(true);
  });

  it('lets the board fund a repair the club cannot afford, and books its capital first', { timeout: 60_000 }, () => {
    const generous = career().clubs.map(item => item.id).find(id => {
      const state = career(id);
      return quoteBoardFunding(state, 'arena', id).requiredConfidence <= 50;
    })!;
    expect(generous).toBeDefined();
    const later = wornUntil(career(generous), dateForRound(1, 4));
    const repair = quoteFacilityRepair(later, 'arena', generous);
    expect(repair.canStart).toBe(true);
    const poor = spend(later, generous, getSpendableCash(later, generous) - Math.floor(repair.cost / 2));
    expect(quoteFacilityRepair(poor, 'arena', generous).reason).toMatch(/exceeds the remaining budget/);
    const quote = quoteBoardFunding(poor, 'arena', generous, 'manager', 'repair');
    expect(quote).toMatchObject({ project: 'repair', eligible: true, approved: true, cost: repair.cost });
    const funded = requestBoardFunding(poor, 'arena', 'repair');
    const decision = funded.facilities.events.at(-2)!, start = funded.facilities.events.at(-1)!;
    expect(decision).toMatchObject({ type: 'funding', project: 'repair', approved: true, amount: quote.amount });
    expect(start).toMatchObject({ type: 'repair', facilityType: 'arena' });
    expect(ledger(funded).slice(-2).map(entry => entry.kind)).toEqual(['board-capital', 'facility']);
    expect(funded.facilities.projects.at(-1)).toMatchObject({ kind: 'repair', type: 'arena', cost: repair.cost });
  });
});

describe('facilities-2 scouting office', () => {
  it('adds evidence to observations and widens the discovery pool', { timeout: 60_000 }, () => {
    const state = career(), office = built({ scouting: 4 }).facilities;
    const target = state.clubs.find(item => item.id !== club)!.players[0]!;
    const review = (round: number): ScoutingReview => ({ playerId: target.id, seasonNumber: 1, round, date: dateForRound(round, 1), clubId: target.id, rosterId: 'r', outcome: 'observed', attributes: target.attributes } as unknown as ScoutingReview);
    const observed: SeasonState = { ...state, date: dateForRound(3, 1), scouting: { ...state.scouting, clubs: { ...state.scouting.clubs, [club]: { ...state.scouting.clubs[club]!, reviews: [review(1), review(2)] } } } };
    const withOffice: SeasonState = { ...observed, facilities: { ...office, enabledSince: state.facilities.enabledSince, delegated: state.facilities.delegated } };
    expect(scoutingEvidencePercent(withOffice, club)).toBe(50);
    expect(scoutingDiscoveryPercent(withOffice, club)).toBe(30);
    // Two club observations give level 2 knowledge; with a top scouting office, level 3.
    expect(getPlayerKnowledge(observed, target.id).level).toBe(2);
    expect(getPlayerKnowledge(withOffice, target.id).level).toBe(3);
    const plain = getScoutingDiscovery(observed).networkOutsideCount, wider = getScoutingDiscovery(withOffice).networkOutsideCount;
    expect(wider).toBe(Math.min(getScoutingDiscovery(observed).totalOutsideCount, Math.floor(plain * 1.3)));
    expect(wider).toBeGreaterThan(plain);
  });
});
