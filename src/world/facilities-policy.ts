import type { ClubFacilities, FacilityProject, FacilityRepairQuote, FacilityType, FacilityUpgradeQuote, MaintenancePlan, SeasonFacilities } from '../domain/facilities';
import type { SeasonState } from '../domain/season';
import type { WorldContext } from '../domain/world';
import { clubFinanceDefinition, seasonRounds, worldOf } from './career-world';
import { getFinanceBalance } from './finance';
import { getSpendableCash } from './payroll-policy';
import { getTransferPaymentSummary } from './transfer-payments';
import { dateForRound, MAX_SEASON_NUMBER } from './season';
import { memoizePure } from './pure-cache';
import { automationCushion, scaledMoney } from './economy';

/** The three facilities of `facilities-1` careers (formats 28-64). */
export const FACILITY_TYPES: readonly FacilityType[] = ['arena', 'training', 'youth'];
/** `facilities-2` (new careers, format 65) adds the medical centre and the scouting office. */
export const ALL_FACILITY_TYPES: readonly FacilityType[] = ['arena', 'training', 'youth', 'medical', 'scouting'];
/** The facilities a career's model has. */
export const facilityTypes = (facilities: Pick<SeasonFacilities, 'model'> | undefined): readonly FacilityType[] => facilities?.model === 'facilities-2' ? ALL_FACILITY_TYPES : FACILITY_TYPES;
export const usesFacilityRepairs = (facilities: Pick<SeasonFacilities, 'model'> | undefined): boolean => facilities?.model === 'facilities-2';
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
/** The only repair blocker that board capital can resolve (`facilities-2`). */
export const FACILITY_REPAIR_FUNDS_REASON = 'The repair exceeds the remaining budget after salary and transfer commitments.';

/**
 * Rules of the `facilities-2` model (format 65, new careers; owner-approved saved idea, 15 November 2026). They are
 * provisional, reversible game defaults, not real-world figures. Money is in euro cents of the development economy;
 * real-data worlds scale every amount with the club's money level (`scaledMoney`), as for the other facilities.
 */
export const FACILITY_RULES_2 = Object.freeze({
  /** Construction cost of levels 1-4 (level 1 is the standard facility): between the training and arena upgrades. */
  costs: { medical: [0, 8_500_000, 13_500_000, 20_000_000], scouting: [0, 8_000_000, 12_500_000, 19_000_000] },
  /** Extra upkeep per senior matchday of levels 1-4. */
  upkeep: { medical: [0, 45_000, 75_000, 105_000], scouting: [0, 35_000, 55_000, 80_000] },
  /** Condition points lost per season at levels 1-4 under full upkeep, spread over the season's weeks. */
  seasonWear: [8, 10, 12, 14],
  /** Heavy use: percent of the seasonal wear by facility (crowds and daily practice wear the arena and training most). */
  usePercent: { arena: 125, training: 125, youth: 100, medical: 100, scouting: 75 } as Record<FacilityType, number>,
  /** Reduced upkeep (half the cost) multiplies the wear of upgraded facilities; full upkeep never restores condition. */
  reducedUpkeepWear: 3,
  /** A facility gives its full effect from this condition; below it the effect falls linearly to the floor at 0. */
  fullEffectCondition: 80,
  floorEffectPercent: 40,
  /** Arena attendance demand lost when the arena's effect is at its floor (condition 0), in proportion below that. */
  arenaComfortLossPercent: 15,
  /** Medical centre, by level: shorter diagnosed recovery (%), lower extra recurrence risk (%), more physio credit per day (%). */
  medicalRecoveryPercent: [0, 4, 8, 12],
  medicalRecurrencePercent: [0, 5, 10, 15],
  medicalPhysioPercent: [0, 10, 20, 30],
  /** Scouting office, by level: more evidence per observation (%) and a wider discovery pool (%). */
  scoutingEvidencePercent: [0, 15, 30, 50],
  scoutingDiscoveryPercent: [0, 10, 20, 30],
  /** Repairing from condition 0 to 100 costs this share of the facility's level-two upgrade, times the level factor. */
  repairFullCostPercent: 40,
  repairLevelPercent: [75, 100, 150, 200],
  /** Repair time: this many days per started 25 missing condition points (7-28 days). */
  repairDaysPerQuarter: 7,
  /** A repair restores at least this many points (condition 95 or lower). */
  repairMinimumMissing: 5,
  /** Automatic control and rival clubs repair the most worn facility below this condition, keeping half their cushion. */
  automaticRepairBelow: 70,
});

const COSTS: Record<FacilityType, readonly number[]> = { arena: [0, 10_000_000, 16_000_000, 24_000_000], training: [0, 7_500_000, 12_000_000, 18_000_000], youth: [0, 6_000_000, 10_000_000, 15_000_000], ...FACILITY_RULES_2.costs };
const UPKEEP: Record<FacilityType, readonly number[]> = { arena: [0, 50_000, 90_000, 120_000], training: [0, 40_000, 70_000, 100_000], youth: [0, 30_000, 50_000, 70_000], ...FACILITY_RULES_2.upkeep };
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

function conditionCache(facilities: SeasonFacilities): Map<string, number> {
  let cache = conditionsByEvents.get(facilities.events);
  if (!cache) { cache = new Map(); conditionsByEvents.set(facilities.events, cache); }
  return cache;
}

/** The latest completed project (upgrade or repair) of one facility on or before a date. */
function latestCompletion(facilities: SeasonFacilities, type: FacilityType, clubId: string, onDate: string): string | undefined {
  let latest: string | undefined;
  for (const project of facilities.projects) if (project.clubId === clubId && project.type === type && project.completedOn !== null && project.completedOn <= onDate && (latest === undefined || project.completedOn > latest)) latest = project.completedOn;
  return latest;
}

/**
 * `facilities-2`: hundredths of a condition point one senior week takes from a facility: the level's seasonal wear,
 * spread over the season's weeks, times its use and, for upgraded facilities under reduced upkeep, the neglect factor.
 */
export function facilityWeeklyWear(type: FacilityType, level: number, reduced: boolean, rounds: number): number {
  return Math.round(FACILITY_RULES_2.seasonWear[level - 1]! * FACILITY_RULES_2.usePercent[type] * (reduced && level > 1 ? FACILITY_RULES_2.reducedUpkeepWear : 1) / rounds);
}

/** `facilities-2`: whether a facility has a condition at all (every upgraded facility, and the arena at every level). */
export function hasFacilityCondition(state: FacilitiesContext, type: FacilityType, clubId: string, onDate = state.date ?? '9999-12-31'): boolean {
  if (!usesFacilityRepairs(state.facilities)) return !!state.facilities?.maintenanceSince && getFacilityLevel(state, type, clubId, onDate) > 1;
  return type === 'arena' || getFacilityLevel(state, type, clubId, onDate) > 1;
}

/**
 * Condition 0-100 of a facility. `facilities-1`: rebuilt from an upgraded facility's latest completion and every later
 * matchday's upkeep plan; standard facilities and careers without upkeep choices stay at 100. `facilities-2`: every
 * senior week wears it from its latest completed upgrade or repair (or facilities activation) until the date.
 */
export function getFacilityCondition(state: FacilitiesContext, type: FacilityType, clubId: string, onDate = state.date ?? '9999-12-31'): number {
  const facilities = state.facilities;
  if (usesFacilityRepairs(facilities)) {
    const enabled = facilities!.enabledSince;
    if (!enabled || enabled.date > onDate || !hasFacilityCondition(state, type, clubId, onDate)) return 100;
    const level = getFacilityLevel(state, type, clubId, onDate), from = latestCompletion(facilities!, type, clubId, onDate) ?? enabled.date;
    const rounds = seasonRounds(state), key = `wear|${clubId}|${type}|${level}|${from}|${onDate}|${rounds}`, cache = conditionCache(facilities!);
    const known = cache.get(key);
    if (known !== undefined) return known;
    let wear = 0;
    for (const date of matchdayDates(`${from}|${onDate}|${rounds}`)) wear += facilityWeeklyWear(type, level, maintenancePlanOn(facilities, clubId, date) === 'reduced', rounds);
    const condition = Math.max(0, 100 - Math.floor(wear / 100));
    cache.set(key, condition);
    return condition;
  }
  const since = facilities?.maintenanceSince;
  if (!facilities || !since || getFacilityLevel(state, type, clubId, onDate) === 1) return 100;
  const completed = latestCompletion(facilities, type, clubId, onDate)!;
  const rounds = seasonRounds(state), key = `${clubId}|${completed}|${onDate}|${since.date}|${rounds}`;
  const cache = conditionCache(facilities);
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

/** `facilities-2`: the share of its benefit a facility in this condition delivers (full from 80, 40% at 0). */
export function conditionEffectPercent(condition: number): number {
  return Math.min(100, Math.round(FACILITY_RULES_2.floorEffectPercent + condition * (100 - FACILITY_RULES_2.floorEffectPercent) / FACILITY_RULES_2.fullEffectCondition));
}

/** The share of a facility's benefit its condition still delivers: condition itself in `facilities-1`, the effect curve in `facilities-2`. */
export function facilityEffectPercent(state: FacilitiesContext, type: FacilityType, clubId: string, onDate = state.date ?? '9999-12-31'): number {
  const condition = getFacilityCondition(state, type, clubId, onDate);
  return usesFacilityRepairs(state.facilities) ? conditionEffectPercent(condition) : condition;
}

export function facilityCompletionDate(date: string, days: number): string {
  const time = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== date || !Number.isInteger(days) || days < 0) throw new Error('Choose a real construction date and duration.');
  return new Date(time + days * 86_400_000).toISOString().slice(0, 10);
}

/** Future plans never count as a completed building. Historical dates keep their original level. */
export function getFacilityLevel(state: FacilitiesContext, type: FacilityType, clubId: string, onDate = state.date ?? '9999-12-31'): number {
  if (!ALL_FACILITY_TYPES.includes(type)) throw new Error('Choose an arena, training, youth, medical or scouting facility.');
  if (!state.facilities?.enabledSince || state.facilities.enabledSince.date > onDate) return 1;
  return state.facilities.projects.filter(project => project.clubId === clubId && project.type === type && project.completedOn !== null && project.completedOn <= onDate).reduce((level, project) => Math.max(level, project.toLevel), 1);
}

export function getActiveFacilityProject(state: FacilitiesContext, clubId: string): FacilityProject | null {
  return state.facilities?.projects.find(project => project.clubId === clubId && project.completedOn === null && project.cancelledOn === null) ?? null;
}

export function facilityPracticeBonusPercent(state: FacilitiesContext, type: 'training' | 'youth', clubId: string, onDate = state.date): number {
  // A worn facility delivers only part of its practice benefit.
  return Math.round(BONUS_PERCENT[getFacilityLevel(state, type, clubId, onDate) - 1]! * facilityEffectPercent(state, type, clubId, onDate) / 100);
}

/** A `facilities-2` effect table's value at the facility's level on a date, scaled by its condition; 0 in older careers. */
function conditionedEffect(state: FacilitiesContext, type: FacilityType, table: readonly number[], clubId: string, onDate: string | undefined): number {
  if (!usesFacilityRepairs(state.facilities) || !state.facilities?.enabledSince) return 0;
  const level = getFacilityLevel(state, type, clubId, onDate);
  return level === 1 ? 0 : Math.round(table[level - 1]! * facilityEffectPercent(state, type, clubId, onDate) / 100);
}

/** `facilities-2`: how much shorter (percent) the club's medical centre makes a new injury's diagnosed recovery. */
export function medicalRecoveryPercent(state: FacilitiesContext, clubId: string, onDate = state.date): number { return conditionedEffect(state, 'medical', FACILITY_RULES_2.medicalRecoveryPercent, clubId, onDate); }
/** `facilities-2`: how much of a player's extra recurrence risk (percent) the club's medical centre removes. */
export function medicalRecurrencePercent(state: FacilitiesContext, clubId: string, onDate = state.date): number { return conditionedEffect(state, 'medical', FACILITY_RULES_2.medicalRecurrencePercent, clubId, onDate); }
/** `facilities-2`: extra rehabilitation credit per day (percent) the club's medical centre gives its physio. */
export function medicalPhysioPercent(state: FacilitiesContext, clubId: string, onDate = state.date): number { return conditionedEffect(state, 'medical', FACILITY_RULES_2.medicalPhysioPercent, clubId, onDate); }
/** `facilities-2`: extra evidence (percent) each observation gives the club's scouting office. */
export function scoutingEvidencePercent(state: FacilitiesContext, clubId: string, onDate = state.date): number { return conditionedEffect(state, 'scouting', FACILITY_RULES_2.scoutingEvidencePercent, clubId, onDate); }
/** `facilities-2`: how much wider (percent) the club's scouting office makes its discovery pool. */
export function scoutingDiscoveryPercent(state: FacilitiesContext, clubId: string, onDate = state.date): number { return conditionedEffect(state, 'scouting', FACILITY_RULES_2.scoutingDiscoveryPercent, clubId, onDate); }

/** `facilities-2`: attendance demand (percent) the arena's condition still draws; 100 in older careers. */
export function arenaComfortPercent(state: FacilitiesContext, clubId: string, onDate = state.date ?? '9999-12-31'): number {
  if (!usesFacilityRepairs(state.facilities) || !state.facilities?.enabledSince) return 100;
  const lost = 100 - facilityEffectPercent(state, 'arena', clubId, onDate);
  return 100 - lost * FACILITY_RULES_2.arenaComfortLossPercent / (100 - FACILITY_RULES_2.floorEffectPercent);
}

export type FacilityUpkeepBreakdown = { arena: number; training: number; youth: number; medical?: number; scouting?: number; total: number };
export function getFacilityUpkeepBreakdown(state: FacilitiesContext, clubId: string, onDate = state.date): FacilityUpkeepBreakdown {
  const percent = state.facilities?.maintenanceSince && state.facilities.maintenanceSince.date < (onDate ?? '9999-12-31') && maintenancePlanOn(state.facilities, clubId, onDate) === 'reduced' ? FACILITY_REDUCED_UPKEEP_PERCENT : 100;
  const cost = (type: FacilityType) => Math.round(facilityUpkeep(state, clubId, type, getFacilityLevel(state, type, clubId, onDate)) * percent / 100);
  const arena = cost('arena'), training = cost('training'), youth = cost('youth');
  if (!usesFacilityRepairs(state.facilities)) return { arena, training, youth, total: arena + training + youth };
  // `facilities-2` (format 65): every ledger row names all five facilities.
  const medical = cost('medical'), scouting = cost('scouting');
  return { arena, training, youth, medical, scouting, total: arena + training + youth + medical + scouting };
}

export function getFacilityUpkeep(state: FacilitiesContext, clubId: string, onDate = state.date): number { return getFacilityUpkeepBreakdown(state, clubId, onDate).total; }

export function getArenaFullCapacity(state: FacilitiesContext, clubId: string, onDate = state.date): number {
  // Sections of a worn arena expansion are closed for safety.
  return clubFinanceDefinition(worldOf(state), clubId).capacity + Math.floor(ADDED_SEATS[getFacilityLevel(state, 'arena', clubId, onDate) - 1]! * facilityEffectPercent(state, 'arena', clubId, onDate ?? '9999-12-31') / 100);
}

/** Starts and manual cancellations on matchday cannot change that day's already prepared gate. Repairs close seats like construction. */
export function getArenaCapacity(state: FacilitiesContext, clubId: string, onDate = state.date ?? '9999-12-31'): number {
  const capacity = getArenaFullCapacity(state, clubId, onDate);
  const disrupted = state.facilities?.enabledSince && state.facilities.enabledSince.date <= onDate && state.facilities.projects.some(project => project.clubId === clubId && project.type === 'arena' && project.startedOn < onDate && (project.cancelledOn === null || project.cancelledOn >= onDate) && (project.completedOn === null || project.completedOn > onDate));
  return disrupted ? Math.floor(capacity * FACILITY_CONSTRUCTION_CAPACITY_PERCENT / 100) : capacity;
}

/** The headline benefit of a facility at a level, before its condition: practice or effect percent, or added seats for the arena. */
export function facilityLevelBenefit(type: FacilityType, level: number): number {
  if (type === 'arena') return ADDED_SEATS[level - 1]!;
  if (type === 'medical') return FACILITY_RULES_2.medicalRecoveryPercent[level - 1]!;
  if (type === 'scouting') return FACILITY_RULES_2.scoutingEvidencePercent[level - 1]!;
  return BONUS_PERCENT[level - 1]!;
}

function requireFacilityType(state: SeasonState, type: FacilityType, clubId: string): void {
  if (!ALL_FACILITY_TYPES.includes(type)) throw new Error('Choose an arena, training, youth, medical or scouting facility.');
  if (!state.clubs.some(club => club.id === clubId)) throw new Error('Choose a club in this career.');
}

export function quoteFacilityUpgrade(state: SeasonState, type: FacilityType, clubId = state.managedClubId): FacilityUpgradeQuote {
  requireFacilityType(state, type, clubId);
  const fromLevel = getFacilityLevel(state, type, clubId), toLevel = Math.min(FACILITY_MAX_LEVEL, fromLevel + 1);
  const cost = fromLevel === FACILITY_MAX_LEVEL ? 0 : facilityCost(state, clubId, type, toLevel);
  const durationDays = fromLevel === FACILITY_MAX_LEVEL ? 0 : BUILD_DAYS[toLevel - 1]!;
  const available = getSpendableCash(state, clubId), currentUpkeep = getFacilityUpkeep(state, clubId), upkeepAfter = facilityUpkeep(state, clubId, type, toLevel);
  let reason: string | null = null;
  if (!state.facilities?.enabledSince) reason = 'Enable club facilities before commissioning an upgrade.';
  else if (!facilityTypes(state.facilities).includes(type)) reason = 'Medical and scouting facilities belong to careers started with the current facilities model.';
  else if (!state.finance.enabledSince) reason = 'Enable club finances before funding construction.';
  else if (type === 'training' && !state.training.enabledSince) reason = 'Enable senior training before upgrading its facilities.';
  else if (type === 'youth' && !state.academy.enabledSince) reason = 'Open the youth academy before upgrading its infrastructure.';
  else if (type === 'scouting' && !state.scouting.enabledSince) reason = 'Enable scouting before upgrading the scouting office.';
  else if (fromLevel === FACILITY_MAX_LEVEL) reason = 'This facility is already at the highest development level.';
  else if (getActiveFacilityProject(state, clubId)) reason = 'Finish or cancel the current club project before starting another.';
  else if (getFinanceBalance(state.finance, clubId).unpaid > 0) reason = 'Settle unpaid club costs before funding construction.';
  else if (getTransferPaymentSummary(state, clubId).overdue > 0) reason = 'Settle overdue transfer payments before funding construction.';
  else if (available < cost) reason = FACILITY_FUNDS_REASON;
  return { clubId, type, fromLevel, toLevel, cost, durationDays, dueOn: facilityCompletionDate(state.date, durationDays), remainingBudgetAfter: Math.max(0, available - cost), upkeepAfter, totalUpkeepAfter: currentUpkeep - facilityUpkeep(state, clubId, type, fromLevel) + upkeepAfter, bonusAfter: type === 'arena' ? 0 : facilityLevelBenefit(type, toLevel), capacityAfter: type === 'arena' ? clubFinanceDefinition(worldOf(state), clubId).capacity + ADDED_SEATS[toLevel - 1]! : 0, canStart: reason === null, reason };
}

/** `facilities-2`: the cost of restoring `missing` condition points of a facility at a level, at the club's money level. */
export function facilityRepairCost(context: WorldContext, clubId: string, type: FacilityType, level: number, missing: number): number {
  if (missing <= 0) return 0;
  const base = Math.max(10_000, Math.round(COSTS[type][1]! * FACILITY_RULES_2.repairFullCostPercent * FACILITY_RULES_2.repairLevelPercent[level - 1]! * missing / 100 / 100 / 100 / 10_000) * 10_000);
  return scaledMoney(context, clubId, base);
}

/** `facilities-2`: seven days per started 25 missing condition points. */
export function facilityRepairDays(missing: number): number {
  return missing <= 0 ? 0 : FACILITY_RULES_2.repairDaysPerQuarter * Math.ceil(missing / 25);
}

/**
 * `facilities-2`: the fully funded terms of restoring a facility to condition 100 at its level. Repairs share the
 * club's one project slot with upgrades, pay in full on approval, and an arena repair closes seats like construction.
 */
export function quoteFacilityRepair(state: SeasonState, type: FacilityType, clubId = state.managedClubId): FacilityRepairQuote {
  requireFacilityType(state, type, clubId);
  const level = getFacilityLevel(state, type, clubId), conditionBefore = getFacilityCondition(state, type, clubId), missing = 100 - conditionBefore;
  const cost = facilityRepairCost(state, clubId, type, level, missing), durationDays = facilityRepairDays(missing);
  const available = state.finance.enabledSince ? getSpendableCash(state, clubId) : 0;
  let reason: string | null = null;
  if (!usesFacilityRepairs(state.facilities)) reason = 'Repair projects belong to careers started with the current facilities model.';
  else if (!state.facilities.enabledSince) reason = 'Enable club facilities before commissioning a repair.';
  else if (!state.finance.enabledSince) reason = 'Enable club finances before funding repairs.';
  else if (!hasFacilityCondition(state, type, clubId)) reason = 'A standard facility has no condition to restore.';
  else if (missing < FACILITY_RULES_2.repairMinimumMissing) reason = `Repairs start once condition falls to ${100 - FACILITY_RULES_2.repairMinimumMissing} or lower.`;
  else if (getActiveFacilityProject(state, clubId)) reason = 'Finish or cancel the current club project before starting another.';
  else if (getFinanceBalance(state.finance, clubId).unpaid > 0) reason = 'Settle unpaid club costs before funding repairs.';
  else if (getTransferPaymentSummary(state, clubId).overdue > 0) reason = 'Settle overdue transfer payments before funding repairs.';
  else if (available < cost) reason = FACILITY_REPAIR_FUNDS_REASON;
  return { clubId, type, level, conditionBefore, cost, durationDays, dueOn: facilityCompletionDate(state.date, durationDays), remainingBudgetAfter: Math.max(0, available - cost), canStart: reason === null, reason };
}

export function getClubFacilities(state: SeasonState, clubId = state.managedClubId): ClubFacilities {
  if (!state.clubs.some(club => club.id === clubId)) throw new Error('Choose a club in this career.');
  const active = getActiveFacilityProject(state, clubId), upkeep = getFacilityUpkeepBreakdown(state, clubId), repairs = usesFacilityRepairs(state.facilities);
  const maintenance = { enabled: !!state.facilities?.maintenanceSince, chosen: maintenancePlanOn(state.facilities, clubId), current: maintenancePlanOn(state.facilities, clubId, state.date) };
  const bonus = (type: FacilityType) => type === 'arena' ? 0 : type === 'training' || type === 'youth' ? facilityPracticeBonusPercent(state, type, clubId) : type === 'medical' ? medicalRecoveryPercent(state, clubId) : scoutingEvidencePercent(state, clubId);
  return { enabled: state.facilities?.enabledSince !== null && state.facilities?.enabledSince !== undefined, model: state.facilities?.model ?? 'facilities-1', maintenance, clubId, delegated: state.facilities?.delegated[clubId] ?? false, remainingBudget: getSpendableCash(state, clubId), upkeepPerRound: upkeep.total, arenaCapacity: (state.status === 'active' ? state.finance.roundCapacities?.[clubId] : undefined) ?? getArenaCapacity(state, clubId), arenaFullCapacity: getArenaFullCapacity(state, clubId), rows: facilityTypes(state.facilities).map(type => ({ type, level: getFacilityLevel(state, type, clubId), maxLevel: 4, bonusPercent: bonus(type), capacity: type === 'arena' ? getArenaFullCapacity(state, clubId) : 0, upkeepPerRound: upkeep[type] ?? 0, project: active?.type === type ? active : null, quote: quoteFacilityUpgrade(state, type, clubId), condition: getFacilityCondition(state, type, clubId), effectPercent: facilityEffectPercent(state, type, clubId), repair: repairs ? quoteFacilityRepair(state, type, clubId) : null })) };
}
