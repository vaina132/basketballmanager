import type { ClubFacilities, FacilityProject, FacilityType, FacilityUpgradeQuote, SeasonFacilities } from '../domain/facilities';
import type { SeasonState } from '../domain/season';
import { getClubFinanceDefinition } from '../data/development-finances';
import { getFinanceBalance } from './finance';
import { getSpendableCash } from './payroll-policy';
import { getTransferPaymentSummary } from './transfer-payments';

export const FACILITY_TYPES: readonly FacilityType[] = ['arena', 'training', 'youth'];
export const FACILITY_MAX_LEVEL = 4;
export const FACILITY_AUTOMATION_BUFFER = 15_000_000;
export const FACILITY_CONSTRUCTION_CAPACITY_PERCENT = 90;
const COSTS: Record<FacilityType, readonly number[]> = { arena: [0, 10_000_000, 16_000_000, 24_000_000], training: [0, 7_500_000, 12_000_000, 18_000_000], youth: [0, 6_000_000, 10_000_000, 15_000_000] };
const UPKEEP: Record<FacilityType, readonly number[]> = { arena: [0, 50_000, 90_000, 120_000], training: [0, 40_000, 70_000, 100_000], youth: [0, 30_000, 50_000, 70_000] };
const BUILD_DAYS = [0, 21, 28, 42] as const;
const BONUS_PERCENT = [0, 5, 8, 10] as const;
const ADDED_SEATS = [0, 500, 1400, 2600] as const;
export type FacilitiesContext = { facilities?: SeasonFacilities; date?: string };

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
  return BONUS_PERCENT[getFacilityLevel(state, type, clubId, onDate) - 1]!;
}

export function getFacilityUpkeepBreakdown(state: FacilitiesContext, clubId: string, onDate = state.date): { arena: number; training: number; youth: number; total: number } {
  const arena = UPKEEP.arena[getFacilityLevel(state, 'arena', clubId, onDate) - 1]!;
  const training = UPKEEP.training[getFacilityLevel(state, 'training', clubId, onDate) - 1]!;
  const youth = UPKEEP.youth[getFacilityLevel(state, 'youth', clubId, onDate) - 1]!;
  return { arena, training, youth, total: arena + training + youth };
}

export function getFacilityUpkeep(state: FacilitiesContext, clubId: string, onDate = state.date): number { return getFacilityUpkeepBreakdown(state, clubId, onDate).total; }

export function getArenaFullCapacity(state: FacilitiesContext, clubId: string, onDate = state.date): number {
  return getClubFinanceDefinition(clubId).capacity + ADDED_SEATS[getFacilityLevel(state, 'arena', clubId, onDate) - 1]!;
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
  const cost = fromLevel === FACILITY_MAX_LEVEL ? 0 : COSTS[type][toLevel - 1]!;
  const durationDays = fromLevel === FACILITY_MAX_LEVEL ? 0 : BUILD_DAYS[toLevel - 1]!;
  const available = getSpendableCash(state, clubId), currentUpkeep = getFacilityUpkeep(state, clubId), upkeepAfter = UPKEEP[type][toLevel - 1]!;
  let reason: string | null = null;
  if (!state.facilities?.enabledSince) reason = 'Enable club facilities before commissioning an upgrade.';
  else if (!state.finance.enabledSince) reason = 'Enable club finances before funding construction.';
  else if (type === 'training' && !state.training.enabledSince) reason = 'Enable senior training before upgrading its facilities.';
  else if (type === 'youth' && !state.academy.enabledSince) reason = 'Open the youth academy before upgrading its infrastructure.';
  else if (fromLevel === FACILITY_MAX_LEVEL) reason = 'This facility is already at the highest development level.';
  else if (getActiveFacilityProject(state, clubId)) reason = 'Finish or cancel the current club project before starting another.';
  else if (getFinanceBalance(state.finance, clubId).unpaid > 0) reason = 'Settle unpaid club costs before funding construction.';
  else if (getTransferPaymentSummary(state, clubId).overdue > 0) reason = 'Settle overdue transfer payments before funding construction.';
  else if (available < cost) reason = 'The upgrade exceeds the remaining budget after salary and transfer commitments.';
  return { clubId, type, fromLevel, toLevel, cost, durationDays, dueOn: facilityCompletionDate(state.date, durationDays), remainingBudgetAfter: Math.max(0, available - cost), upkeepAfter, totalUpkeepAfter: currentUpkeep - UPKEEP[type][fromLevel - 1]! + upkeepAfter, bonusAfter: type === 'arena' ? 0 : BONUS_PERCENT[toLevel - 1]!, capacityAfter: type === 'arena' ? getClubFinanceDefinition(clubId).capacity + ADDED_SEATS[toLevel - 1]! : 0, canStart: reason === null, reason };
}

export function getClubFacilities(state: SeasonState, clubId = state.managedClubId): ClubFacilities {
  if (!state.clubs.some(club => club.id === clubId)) throw new Error('Choose a club in this career.');
  const active = getActiveFacilityProject(state, clubId), upkeep = getFacilityUpkeepBreakdown(state, clubId);
  return { enabled: state.facilities?.enabledSince !== null && state.facilities?.enabledSince !== undefined, clubId, delegated: state.facilities?.delegated[clubId] ?? false, remainingBudget: getSpendableCash(state, clubId), upkeepPerRound: upkeep.total, arenaCapacity: (state.status === 'active' ? state.finance.roundCapacities?.[clubId] : undefined) ?? getArenaCapacity(state, clubId), arenaFullCapacity: getArenaFullCapacity(state, clubId), rows: FACILITY_TYPES.map(type => ({ type, level: getFacilityLevel(state, type, clubId), maxLevel: 4, bonusPercent: type === 'arena' ? 0 : facilityPracticeBonusPercent(state, type, clubId), capacity: type === 'arena' ? getArenaFullCapacity(state, clubId) : 0, upkeepPerRound: upkeep[type], project: active?.type === type ? active : null, quote: quoteFacilityUpgrade(state, type, clubId) })) };
}
