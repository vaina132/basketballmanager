import type { ClubFacilities, FacilityProject, FacilityType, FacilityUpgradeQuote, MaintenancePlan, SeasonFacilities } from '../domain/facilities';
import type { SeasonState } from '../domain/season';
import type { WorldContext } from '../domain/world';
import { clubFinanceDefinition, seasonRounds, worldOf } from './career-world';
import { getFinanceBalance } from './finance';
import { getSpendableCash } from './payroll-policy';
import { getTransferPaymentSummary } from './transfer-payments';
import { dateForRound, MAX_SEASON_NUMBER } from './season';
import { memoizePure } from './pure-cache';
import { automationCushion, scaledMoney } from './economy';

export const FACILITY_TYPES: readonly FacilityType[] = ['arena', 'training', 'youth'];
export const FACILITY_MAX_LEVEL = 4;
export const FACILITY_AUTOMATION_BUFFER = 15_000_000;
/** The cash automatic control keeps after an upgrade, at the club's money level (format 62). */
export const facilityAutomationBuffer = (context: WorldContext, clubId: string): number => automationCushion(context, clubId, FACILITY_AUTOMATION_BUFFER);
/** An upgrade's construction cost and a level's weekly upkeep at the club's money level (format 62; unchanged otherwise). */
const facilityCost = (context: WorldContext, clubId: string, type: FacilityType, level: number): number => scaledMoney(context, clubId, COSTS[type][level - 1]!);
const facilityUpkeep = (context: WorldContext, clubId: string, type: FacilityType, level: number): number => scaledMoney(context, clubId, UPKEEP[type][level - 1]!, 100);
export const FACILITY_CONSTRUCTION_CAPACITY_PERCENT = 90;
/** The only upgrade blocker that board capital can resolve. */
export const FACILITY_FUNDS_REASON = 'The upgrade exceeds the remaining budget after salary and transfer commitments.';
const COSTS: Record<FacilityType, readonly number[]> = { arena: [0, 10_000_000, 16_000_000, 24_000_000], training: [0, 7_500_000, 12_000_000, 18_000_000], youth: [0, 6_000_000, 10_000_000, 15_000_000] };
const UPKEEP: Record<FacilityType, readonly number[]> = { arena: [0, 50_000, 90_000, 120_000], training: [0, 40_000, 70_000, 100_000], youth: [0, 30_000, 50_000, 70_000] };
const BUILD_DAYS = [0, 21, 28, 42] as const;
const BONUS_PERCENT = [0, 5, 8, 10] as const;
const ADDED_SEATS = [0, 500, 1400, 2600] as const;
export type FacilitiesContext = { facilities?: SeasonFacilities; date?: string } & WorldContext;

/** Condition of an upgraded facility moves once per senior matchday under the plan in force before that matchday. */
export const FACILITY_WEAR_PER_MATCHDAY = 5;
export const FACILITY_RECOVERY_PER_MATCHDAY = 10;
export const FACILITY_REDUCED_UPKEEP_PERCENT = 50;

// Facility histories are immutable arrays, so derived values are remembered per events array.
const plansByEvents = new WeakMap<SeasonFacilities['events'], Map<string, { date: string; plan: MaintenancePlan }[]>>();
const conditionsByEvents = new WeakMap<SeasonFacilities['events'], Map<string, number>>();
function clubPlans(facilities: SeasonFacilities, clubId: string): { date: string; plan: MaintenancePlan }[] {
  let index = plansByEvents.get(facilities.events);
  if (!index) {
    index = new Map();
    for (const event of facilities.events) if (event.type === 'maintenance') index.set(event.clubId, [...(index.get(event.clubId) ?? []), { date: event.date, plan: event.plan }]);
    plansByEvents.set(facilities.events, index);
  }
  return index.get(clubId) ?? [];
}

/** The plan in force for a matchday: the club's latest choice made before that matchday's date. */
export function maintenancePlanOn(facilities: SeasonFacilities | undefined, clubId: string, matchdayDate = '9999-12-31'): MaintenancePlan {
  if (!facilities?.maintenanceSince) return 'full';
  let plan: MaintenancePlan = 'full';
  for (const choice of clubPlans(facilities, clubId)) if (choice.date < matchdayDate) plan = choice.plan;
  return plan;
}

/** Senior matchday dates from a start date (inclusive) up to an end date (exclusive), keyed "from|before|matchdays per season". */
const matchdayDates = memoizePure((key: string): readonly string[] => {
  const [from, before, length] = key.split('|') as [string, string, string];
  const rounds = Number(length);
  const dates: string[] = [];
  const first = Math.max(1, Number(from.slice(0, 4)) - 2027), last = Math.min(MAX_SEASON_NUMBER, Number(before.slice(0, 4)) - 2024);
  for (let season = first; season <= last; season += 1) for (let round = 1; round <= rounds; round += 1) {
    const date = dateForRound(round, season);
    if (date >= from && date < before) dates.push(date);
  }
  return Object.freeze(dates);
});

/**
 * Condition 0-100 of an upgraded facility, rebuilt from its latest completion and every later matchday's plan.
 * Standard (level-one) facilities and careers without maintenance choices always stay at 100.
 */
export function getFacilityCondition(state: FacilitiesContext, type: FacilityType, clubId: string, onDate = state.date ?? '9999-12-31'): number {
  const facilities = state.facilities, since = facilities?.maintenanceSince;
  if (!facilities || !since || getFacilityLevel(state, type, clubId, onDate) === 1) return 100;
  const completed = facilities.projects.filter(project => project.clubId === clubId && project.type === type && project.completedOn !== null && project.completedOn <= onDate).map(project => project.completedOn!).sort().at(-1)!;
  const rounds = seasonRounds(state), key = `${clubId}|${completed}|${onDate}|${since.date}|${rounds}`;
  let cache = conditionsByEvents.get(facilities.events);
  if (!cache) { cache = new Map(); conditionsByEvents.set(facilities.events, cache); }
  const known = cache.get(key);
  if (known !== undefined) return known;
  let condition = 100;
  for (const date of matchdayDates(`${completed}|${onDate}|${rounds}`)) {
    if (date <= since.date) continue;
    condition = maintenancePlanOn(facilities, clubId, date) === 'reduced' ? Math.max(0, condition - FACILITY_WEAR_PER_MATCHDAY) : Math.min(100, condition + FACILITY_RECOVERY_PER_MATCHDAY);
  }
  cache.set(key, condition);
  return condition;
}

export function facilityCompletionDate(date: string, days: number): string {
  const time = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== date || !Number.isInteger(days) || days < 0) throw new Error('Choose a real construction date and duration.');
  return new Date(time + days * 86_400_000).toISOString().slice(0, 10);
}

/** Future plans never count as a completed building. Historical dates keep their original level. */
export function getFacilityLevel(state: FacilitiesContext, type: FacilityType, clubId: string, onDate = state.date ?? '9999-12-31'): number {
  if (!FACILITY_TYPES.includes(type)) throw new Error('Choose an arena, training or youth facility.');
  if (!state.facilities?.enabledSince || state.facilities.enabledSince.date > onDate) return 1;
  return state.facilities.projects.filter(project => project.clubId === clubId && project.type === type && project.completedOn !== null && project.completedOn <= onDate).reduce((level, project) => Math.max(level, project.toLevel), 1);
}

export function getActiveFacilityProject(state: FacilitiesContext, clubId: string): FacilityProject | null {
  return state.facilities?.projects.find(project => project.clubId === clubId && project.completedOn === null && project.cancelledOn === null) ?? null;
}

export function facilityPracticeBonusPercent(state: FacilitiesContext, type: 'training' | 'youth', clubId: string, onDate = state.date): number {
  // A worn facility delivers only part of its practice benefit.
  return Math.round(BONUS_PERCENT[getFacilityLevel(state, type, clubId, onDate) - 1]! * getFacilityCondition(state, type, clubId, onDate) / 100);
}

export function getFacilityUpkeepBreakdown(state: FacilitiesContext, clubId: string, onDate = state.date): { arena: number; training: number; youth: number; total: number } {
  const percent = state.facilities?.maintenanceSince && state.facilities.maintenanceSince.date < (onDate ?? '9999-12-31') && maintenancePlanOn(state.facilities, clubId, onDate) === 'reduced' ? FACILITY_REDUCED_UPKEEP_PERCENT : 100;
  const cost = (type: FacilityType) => Math.round(facilityUpkeep(state, clubId, type, getFacilityLevel(state, type, clubId, onDate)) * percent / 100);
  const arena = cost('arena'), training = cost('training'), youth = cost('youth');
  return { arena, training, youth, total: arena + training + youth };
}

export function getFacilityUpkeep(state: FacilitiesContext, clubId: string, onDate = state.date): number { return getFacilityUpkeepBreakdown(state, clubId, onDate).total; }

export function getArenaFullCapacity(state: FacilitiesContext, clubId: string, onDate = state.date): number {
  // Sections of a worn arena expansion are closed for safety.
  return clubFinanceDefinition(worldOf(state), clubId).capacity + Math.floor(ADDED_SEATS[getFacilityLevel(state, 'arena', clubId, onDate) - 1]! * getFacilityCondition(state, 'arena', clubId, onDate) / 100);
}

/** Starts and manual cancellations on matchday cannot change that day's already prepared gate. */
export function getArenaCapacity(state: FacilitiesContext, clubId: string, onDate = state.date ?? '9999-12-31'): number {
  const capacity = getArenaFullCapacity(state, clubId, onDate);
  const disrupted = state.facilities?.enabledSince && state.facilities.enabledSince.date <= onDate && state.facilities.projects.some(project => project.clubId === clubId && project.type === 'arena' && project.startedOn < onDate && (project.cancelledOn === null || project.cancelledOn >= onDate) && (project.completedOn === null || project.completedOn > onDate));
  return disrupted ? Math.floor(capacity * FACILITY_CONSTRUCTION_CAPACITY_PERCENT / 100) : capacity;
}

export function quoteFacilityUpgrade(state: SeasonState, type: FacilityType, clubId = state.managedClubId): FacilityUpgradeQuote {
  if (!FACILITY_TYPES.includes(type)) throw new Error('Choose an arena, training or youth facility.');
  if (!state.clubs.some(club => club.id === clubId)) throw new Error('Choose a club in this career.');
  const fromLevel = getFacilityLevel(state, type, clubId), toLevel = Math.min(FACILITY_MAX_LEVEL, fromLevel + 1);
  const cost = fromLevel === FACILITY_MAX_LEVEL ? 0 : facilityCost(state, clubId, type, toLevel);
  const durationDays = fromLevel === FACILITY_MAX_LEVEL ? 0 : BUILD_DAYS[toLevel - 1]!;
  const available = getSpendableCash(state, clubId), currentUpkeep = getFacilityUpkeep(state, clubId), upkeepAfter = facilityUpkeep(state, clubId, type, toLevel);
  let reason: string | null = null;
  if (!state.facilities?.enabledSince) reason = 'Enable club facilities before commissioning an upgrade.';
  else if (!state.finance.enabledSince) reason = 'Enable club finances before funding construction.';
  else if (type === 'training' && !state.training.enabledSince) reason = 'Enable senior training before upgrading its facilities.';
  else if (type === 'youth' && !state.academy.enabledSince) reason = 'Open the youth academy before upgrading its infrastructure.';
  else if (fromLevel === FACILITY_MAX_LEVEL) reason = 'This facility is already at the highest development level.';
  else if (getActiveFacilityProject(state, clubId)) reason = 'Finish or cancel the current club project before starting another.';
  else if (getFinanceBalance(state.finance, clubId).unpaid > 0) reason = 'Settle unpaid club costs before funding construction.';
  else if (getTransferPaymentSummary(state, clubId).overdue > 0) reason = 'Settle overdue transfer payments before funding construction.';
  else if (available < cost) reason = FACILITY_FUNDS_REASON;
  return { clubId, type, fromLevel, toLevel, cost, durationDays, dueOn: facilityCompletionDate(state.date, durationDays), remainingBudgetAfter: Math.max(0, available - cost), upkeepAfter, totalUpkeepAfter: currentUpkeep - facilityUpkeep(state, clubId, type, fromLevel) + upkeepAfter, bonusAfter: type === 'arena' ? 0 : BONUS_PERCENT[toLevel - 1]!, capacityAfter: type === 'arena' ? clubFinanceDefinition(worldOf(state), clubId).capacity + ADDED_SEATS[toLevel - 1]! : 0, canStart: reason === null, reason };
}

export function getClubFacilities(state: SeasonState, clubId = state.managedClubId): ClubFacilities {
  if (!state.clubs.some(club => club.id === clubId)) throw new Error('Choose a club in this career.');
  const active = getActiveFacilityProject(state, clubId), upkeep = getFacilityUpkeepBreakdown(state, clubId);
  const maintenance = { enabled: !!state.facilities?.maintenanceSince, chosen: maintenancePlanOn(state.facilities, clubId), current: maintenancePlanOn(state.facilities, clubId, state.date) };
  return { enabled: state.facilities?.enabledSince !== null && state.facilities?.enabledSince !== undefined, maintenance, clubId, delegated: state.facilities?.delegated[clubId] ?? false, remainingBudget: getSpendableCash(state, clubId), upkeepPerRound: upkeep.total, arenaCapacity: (state.status === 'active' ? state.finance.roundCapacities?.[clubId] : undefined) ?? getArenaCapacity(state, clubId), arenaFullCapacity: getArenaFullCapacity(state, clubId), rows: FACILITY_TYPES.map(type => ({ type, level: getFacilityLevel(state, type, clubId), maxLevel: 4, bonusPercent: type === 'arena' ? 0 : facilityPracticeBonusPercent(state, type, clubId), capacity: type === 'arena' ? getArenaFullCapacity(state, clubId) : 0, upkeepPerRound: upkeep[type], project: active?.type === type ? active : null, quote: quoteFacilityUpgrade(state, type, clubId), condition: getFacilityCondition(state, type, clubId) })) };
}
