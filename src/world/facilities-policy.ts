import type { ArenaExpansionQuote, ClubFacilities, FacilityProject, FacilityRepairQuote, FacilityType, FacilityUpgradeQuote, MaintenancePlan, SeasonFacilities } from '../domain/facilities';
import type { EconomyBand } from '../domain/world';
import type { SeasonState } from '../domain/season';
import type { WorldContext } from '../domain/world';
import { clubFinanceDefinition, seasonRounds, worldOf } from './career-world';
import { getFinanceBalance } from './finance';
import { getSpendableCash } from './payroll-policy';
import { getTransferPaymentSummary } from './transfer-payments';
import { dateForRound, MAX_SEASON_NUMBER } from './season';
import { memoizePure } from './pure-cache';
import { automationCushion, clubEconomy, REAL_ECONOMY_RULES, scaledMoney, worldEconomy } from './economy';
import { remainingHomeShare, usesEconomyBalance } from './economy-balance';
import { activeLease } from './facility-debt';
import { surplusUpkeepShare } from './surplus-spending';

/** The three facilities of `facilities-1` careers (formats 28-64). */
export const FACILITY_TYPES: readonly FacilityType[] = ['arena', 'training', 'youth'];
/** `facilities-2` (new careers, format 65) adds the medical centre and the scouting office. */
export const ALL_FACILITY_TYPES: readonly FacilityType[] = ['arena', 'training', 'youth', 'medical', 'scouting'];
/** The facilities a career's model has. */
export const facilityTypes = (facilities: Pick<SeasonFacilities, 'model'> | undefined): readonly FacilityType[] => facilities?.model === 'facilities-2' || facilities?.model === 'facilities-3' ? ALL_FACILITY_TYPES : FACILITY_TYPES;
export const usesFacilityRepairs = (facilities: Pick<SeasonFacilities, 'model'> | undefined): boolean => facilities?.model === 'facilities-2';
/** `facilities-3` (format 74): six named levels, an arena of seats, no wear or repairs. */
export const usesSixLevels = (facilities: Pick<SeasonFacilities, 'model'> | undefined): boolean => facilities?.model === 'facilities-3';
export const FACILITY_MAX_LEVEL = 4;
/** The highest level of a career's facilities: 4, or 6 in `facilities-3`. */
export const facilityMaxLevel = (facilities: Pick<SeasonFacilities, 'model'> | undefined): number => usesSixLevels(facilities) ? FACILITY_RULES_3.levelNames.length : FACILITY_MAX_LEVEL;
export const FACILITY_AUTOMATION_BUFFER = 15_000_000;
/** The cash automatic control keeps after an upgrade, at the club's money level (format 62). */
export const facilityAutomationBuffer = (context: WorldContext, clubId: string): number => automationCushion(context, clubId, FACILITY_AUTOMATION_BUFFER);

/**
 * The cash automatic control and rival clubs keep after starting a facility upgrade (money gaps fix, 16 November
 * 2026). In worlds with an economy, spendable cash already protects wages and fees but not the operating costs and
 * facility upkeep still to come this season, which the season's sponsorship and funding (paid at its opening) are meant
 * to cover. So an upgrade must leave those costs for the rest of the season, less a cautious share of the gate income
 * the club's figures expect for the same weeks, plus `seasonEndCashShare` of the budget: a club run automatically ends
 * every season with cash, and invests what its season leaves over. Without an economy, the development cushion.
 */
export function upgradeAutomationCushion(context: FacilitiesContext & Partial<Pick<SeasonState, 'round' | 'status' | 'fixtures'>>, clubId: string): number {
  const base = facilityAutomationBuffer(context, clubId), economy = clubEconomy(context, clubId);
  if (!economy) return base;
  return Math.max(scaledMoney(context, clubId, FACILITY_AUTOMATION_BUFFER), Math.round((economy.budget * REAL_ECONOMY_RULES.automaticSpending.seasonEndCashShare + remainingSeasonShortfall(context, clubId)) / 10_000) * 10_000);
}

/**
 * The money a club's figures say the rest of the season still needs beyond its gate (worlds with an economy): the
 * operating costs and facility upkeep of the weeks left, less `gateCautionShare` of the gate the figures expect for them;
 * never negative, and zero once the season is complete. Format 87 (`usesEconomyBalance`): the gate still to come follows
 * the home games still to play, which end weeks before the season's last costs; older careers spread it over the weeks.
 */
export function remainingSeasonShortfall(context: FacilitiesContext & Partial<Pick<SeasonState, 'round' | 'status' | 'fixtures'>>, clubId: string): number {
  const economy = clubEconomy(context, clubId);
  if (!economy) return 0;
  const rules = REAL_ECONOMY_RULES.automaticSpending, rounds = seasonRounds(context);
  const weeksLeft = context.status !== 'active' || context.round === undefined ? 0 : Math.max(0, rounds - context.round + 1);
  const expectedGate = Math.max(0, economy.budget - economy.sponsorship - economy.funding);
  const costs = weeksLeft * (economy.operatingCost / rounds + getFacilityUpkeep(context, clubId));
  const gate = !usesEconomyBalance(context) ? weeksLeft * expectedGate / rounds * rules.gateCautionShare : weeksLeft ? remainingHomeShare(context, clubId) * expectedGate * rules.gateCautionShare : 0;
  return Math.max(0, costs - gate);
}
/**
 * Whether automatic control and rival clubs may take on a facility upkeep of `upkeepPerMatchday` (money gaps fix): in
 * worlds with an economy, upgraded facilities' upkeep is paid every season from the budget's small reserve, so it must
 * stay within `upkeepShare` of the club's budget over a season; always without an economy.
 */
export function upkeepAllowsAutomaticUpgrade(context: WorldContext, clubId: string, upkeepPerMatchday: number): boolean {
  const economy = clubEconomy(context, clubId), usual = REAL_ECONOMY_RULES.automaticSpending.upkeepShare;
  // Format 88: a club spending from its surplus may carry more upkeep, by its spending appetite.
  return !economy || upkeepPerMatchday * seasonRounds(context) <= economy.budget * (surplusUpkeepShare(context, clubId, usual) ?? usual);
}
/** An upgrade's construction cost and a level's weekly upkeep at the club's money level (format 62; unchanged otherwise). */
const facilityCost = (context: WorldContext, clubId: string, type: FacilityType, level: number): number => scaledMoney(context, clubId, COSTS[type][level - 1]!);
const facilityUpkeep = (context: WorldContext, clubId: string, type: FacilityType, level: number): number => scaledMoney(context, clubId, UPKEEP[type][level - 1]!, 100);
export const FACILITY_CONSTRUCTION_CAPACITY_PERCENT = 90;
/** The only upgrade blocker that board capital can resolve. */
export const FACILITY_FUNDS_REASON = 'The upgrade exceeds your Spending left after salary and transfer commitments.';
/** `facilities-3`: a project the Remaining budget cannot pay for; the bank can lend the difference. */
export const FACILITY_BANK_REASON = 'Not enough Spending left. A bank loan on this page can add the difference.';
/** Format 71: a leased level is upgraded further only once its lease is paid off or ended. */
export const FACILITY_LEASED_REASON = 'This facility is leased. Upgrade it once the lease is paid off or ended.';
/** The only repair blocker that board capital can resolve (`facilities-2`). */
export const FACILITY_REPAIR_FUNDS_REASON = 'The repair exceeds your Spending left after salary and transfer commitments.';

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

/**
 * Rules of the `facilities-3` model (format 74, new careers; owner request, 16 November 2026: six levels for every
 * facility, the arena as seats, a simple bank loan and no confusing controls). Provisional, reversible game defaults,
 * not real-world figures. Money is in euro cents of the development economy; real-data worlds scale every amount with
 * the club's money level (`scaledMoney`), as for the other facility costs. Facilities no longer wear: upkeep covers
 * maintenance, so there are no repairs, upkeep plans or leases, and projects are paid from Remaining budget only.
 */
export const FACILITY_RULES_3 = Object.freeze({
  levelNames: Object.freeze(['Very Poor', 'Poor', 'Average', 'Good', 'Very Good', 'Excellent']) as readonly string[],
  /** Before facilities are active every facility counts as Average, which changes nothing. */
  neutralLevel: 3,
  /**
   * Starting levels by money band (lowest and highest): a club's opening budget places it in the band's range (the
   * band's default budget range, low to high), and a stable per-facility offset of up to half a level either way varies
   * its facilities. Without an economy every club starts at Average.
   */
  startingLevels: Object.freeze({ 'euroleague-top': [5, 6], euroleague: [4, 6], 'top-upper': [3, 5], 'top-lower': [2, 4], second: [2, 3], third: [1, 2], nba: [5, 6] }) as Readonly<Record<EconomyBand, readonly [number, number]>>,
  /** Effects by level, Very Poor to Excellent. Average is today's standard facility; Excellent about today's level 4. */
  practicePercent: Object.freeze([-4, -2, 0, 4, 7, 10]) as readonly number[],
  medicalRecoveryPercent: Object.freeze([-6, -3, 0, 4, 8, 12]) as readonly number[],
  medicalRecurrencePercent: Object.freeze([-8, -4, 0, 5, 10, 15]) as readonly number[],
  medicalPhysioPercent: Object.freeze([-15, -8, 0, 10, 20, 30]) as readonly number[],
  scoutingEvidencePercent: Object.freeze([-15, -8, 0, 15, 30, 50]) as readonly number[],
  scoutingDiscoveryPercent: Object.freeze([-15, -8, 0, 10, 20, 30]) as readonly number[],
  /** Upgrade cost to reach each level (index = level - 1; Very Poor is never built). */
  costs: Object.freeze({
    training: [0, 4_000_000, 6_000_000, 9_000_000, 13_000_000, 18_000_000], youth: [0, 3_000_000, 5_000_000, 7_500_000, 11_000_000, 15_000_000],
    medical: [0, 4_500_000, 6_500_000, 9_500_000, 14_000_000, 20_000_000], scouting: [0, 4_000_000, 6_000_000, 9_000_000, 13_000_000, 19_000_000],
  }) as Readonly<Record<Exclude<FacilityType, 'arena'>, readonly number[]>>,
  /** Weeks of work to reach each level. */
  weeks: Object.freeze([0, 3, 4, 5, 6, 8]) as readonly number[],
  /**
   * Upkeep per senior week at each level. A club's starting facilities are covered by its operating costs (its budget
   * already pays for them), so a club pays the difference between its current level and its starting level.
   */
  upkeep: Object.freeze({
    training: [0, 15_000, 30_000, 50_000, 75_000, 100_000], youth: [0, 10_000, 20_000, 35_000, 50_000, 70_000],
    medical: [0, 15_000, 35_000, 55_000, 80_000, 105_000], scouting: [0, 10_000, 25_000, 40_000, 60_000, 80_000],
  }) as Readonly<Record<Exclude<FacilityType, 'arena'>, readonly number[]>>,
  /**
   * Arena expansion sizes (seats), their price and weeks of work. An expansion may add at most half the arena's current
   * seats (the smallest size is always possible) and the arena never grows beyond `maxArenaSeats`. Seats are added
   * when the work completes; no seats close meanwhile.
   */
  expansionSeats: Object.freeze([500, 1_000, 2_500, 5_000]) as readonly number[],
  expansionCosts: Object.freeze([9_000_000, 17_000_000, 40_000_000, 75_000_000]) as readonly number[],
  expansionWeeks: Object.freeze([4, 6, 10, 16]) as readonly number[],
  expansionMaxSharePercent: 50,
  maxArenaSeats: 22_000,
  /** Arena upkeep per added seat and senior week (the opening arena is covered by operating costs), in cents. */
  seatUpkeep: 40,
});

const COSTS: Record<FacilityType, readonly number[]> = { arena: [0, 10_000_000, 16_000_000, 24_000_000], training: [0, 7_500_000, 12_000_000, 18_000_000], youth: [0, 6_000_000, 10_000_000, 15_000_000], ...FACILITY_RULES_2.costs };
const UPKEEP: Record<FacilityType, readonly number[]> = { arena: [0, 50_000, 90_000, 120_000], training: [0, 40_000, 70_000, 100_000], youth: [0, 30_000, 50_000, 70_000], ...FACILITY_RULES_2.upkeep };
const BUILD_DAYS = [0, 21, 28, 42] as const;
const BONUS_PERCENT = [0, 5, 8, 10] as const;
const ADDED_SEATS = [0, 500, 1400, 2600] as const;
/** The development arenas' average size (3,200-4,200 seats), the base of `ADDED_SEATS`. */
const ADDED_SEATS_BASE = 3_700;
export type FacilitiesContext = { facilities?: SeasonFacilities; date?: string } & WorldContext;

/** A stable per-mille value for a club's facility (FNV-1a), so each facility of a club differs a little. */
function stableShare(key: string): number {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) hash = Math.imul(hash ^ key.charCodeAt(index), 16777619) >>> 0;
  return hash % 1000;
}

const startingLevelCache = new WeakMap<object, Map<string, number>>();
/**
 * `facilities-3`: the level a club's facility starts at in a new career, from the world's opening club money (so a club
 * keeps it whenever it joins the full world): its band's range, its budget's place in that band's default range and a
 * stable offset of up to half a level per facility. Average without an economy or for the arena (which has seats).
 */
export function startingFacilityLevel(context: WorldContext, clubId: string, type: FacilityType): number {
  const rules = FACILITY_RULES_3, world = context.world;
  if (type === 'arena' || !world?.economy) return rules.neutralLevel;
  let cache = startingLevelCache.get(world);
  if (!cache) { cache = new Map(); startingLevelCache.set(world, cache); }
  const key = `${clubId}|${type}`, known = cache.get(key);
  if (known !== undefined) return known;
  const economy = clubEconomy({ world }, clubId);
  let level: number = rules.neutralLevel;
  if (economy) {
    const [low, high] = rules.startingLevels[economy.band], [budgetLow, , budgetHigh] = REAL_ECONOMY_RULES.budgets[economy.band].default!;
    const place = Math.max(0, Math.min(1000, Math.floor((economy.budget - budgetLow * 100) * 1000 / Math.max(1, (budgetHigh - budgetLow) * 100))));
    const value = low * 1000 + place * (high - low) + stableShare(key) - 500;
    level = Math.max(low, Math.min(high, Math.round(value / 1000)));
  }
  cache.set(key, level);
  return level;
}

/**
 * The seats an arena level adds (before its condition). The development figures add 14%, 38% and 70% to a typical
 * development arena; in worlds with an economy each club's expansion keeps those proportions of its own arena, in
 * 100-seat steps (money gaps fix, 16 November 2026), so a 12,000-seat EuroLeague arena grows as much in proportion as
 * a 2,000-seat second-division hall while the cost follows the club's money level.
 */
export function addedArenaSeats(context: WorldContext, clubId: string, level: number): number {
  const seats = ADDED_SEATS[level - 1]!;
  if (!worldEconomy(context) || seats === 0) return seats;
  return Math.max(100, Math.round(seats * clubFinanceDefinition(worldOf(context), clubId).capacity / ADDED_SEATS_BASE / 100) * 100);
}

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

/** Format 71: a leased level handed back early stops counting after its return date. */
const inPlace = (project: FacilityProject, onDate: string): boolean => project.returnedOn === undefined || project.returnedOn >= onDate;

/** The latest completed project (upgrade, repair or lease still in place) of one facility on or before a date. */
function latestCompletion(facilities: SeasonFacilities, type: FacilityType, clubId: string, onDate: string): string | undefined {
  let latest: string | undefined;
  for (const project of facilities.projects) if (project.clubId === clubId && project.type === type && project.completedOn !== null && project.completedOn <= onDate && inPlace(project, onDate) && (latest === undefined || project.completedOn > latest)) latest = project.completedOn;
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
  // `facilities-3`: upkeep covers maintenance; nothing wears.
  if (usesSixLevels(state.facilities)) return false;
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
  if (usesSixLevels(facilities)) return 100;
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
  // `facilities-3`: the arena has seats instead of levels; other facilities start at the club's starting level, and
  // count as Average (no effect) until facilities are active.
  const six = usesSixLevels(state.facilities);
  if (six && type === 'arena') return 1;
  if (!state.facilities?.enabledSince || state.facilities.enabledSince.date > onDate) return six ? FACILITY_RULES_3.neutralLevel : 1;
  return state.facilities.projects.filter(project => project.clubId === clubId && project.type === type && project.completedOn !== null && project.completedOn <= onDate && inPlace(project, onDate)).reduce((level, project) => Math.max(level, project.toLevel), six ? startingFacilityLevel(state, clubId, type) : 1);
}

/** `facilities-3`: a level's name (Very Poor to Excellent). */
export const facilityLevelName = (level: number): string => FACILITY_RULES_3.levelNames[level - 1] ?? `Level ${level}`;

/** Every club's level of one facility on a date, as `getFacilityLevel` gives it, read in one pass (clubs without an upgrade are absent: level 1). */
export function facilityLevelsByClub(state: FacilitiesContext, type: FacilityType, onDate = state.date ?? '9999-12-31'): Map<string, number> {
  const levels = new Map<string, number>();
  if (!state.facilities?.enabledSince || state.facilities.enabledSince.date > onDate) return levels;
  for (const project of state.facilities.projects) if (project.type === type && project.completedOn !== null && project.completedOn <= onDate && inPlace(project, onDate)) levels.set(project.clubId, Math.max(levels.get(project.clubId) ?? 1, project.toLevel));
  return levels;
}

export function getActiveFacilityProject(state: FacilitiesContext, clubId: string): FacilityProject | null {
  return state.facilities?.projects.find(project => project.clubId === clubId && project.completedOn === null && project.cancelledOn === null) ?? null;
}

export function facilityPracticeBonusPercent(state: FacilitiesContext, type: 'training' | 'youth', clubId: string, onDate = state.date): number {
  // `facilities-3`: Very Poor and Poor facilities cost practice (a negative percent), Average changes nothing.
  if (usesSixLevels(state.facilities)) return state.facilities?.enabledSince ? FACILITY_RULES_3.practicePercent[getFacilityLevel(state, type, clubId, onDate) - 1]! : 0;
  // A worn facility delivers only part of its practice benefit.
  return Math.round(BONUS_PERCENT[getFacilityLevel(state, type, clubId, onDate) - 1]! * facilityEffectPercent(state, type, clubId, onDate) / 100);
}

/** A `facilities-2` effect table's value at the facility's level on a date, scaled by its condition; 0 in older careers. */
function conditionedEffect(state: FacilitiesContext, type: FacilityType, table: readonly number[], clubId: string, onDate: string | undefined, sixLevels?: readonly number[]): number {
  // `facilities-3`: the six-level table, negative below Average; nothing wears.
  if (sixLevels && usesSixLevels(state.facilities)) return state.facilities?.enabledSince ? sixLevels[getFacilityLevel(state, type, clubId, onDate) - 1]! : 0;
  if (!usesFacilityRepairs(state.facilities) || !state.facilities?.enabledSince) return 0;
  const level = getFacilityLevel(state, type, clubId, onDate);
  return level === 1 ? 0 : Math.round(table[level - 1]! * facilityEffectPercent(state, type, clubId, onDate) / 100);
}

/** `facilities-2`: how much shorter (percent) the club's medical centre makes a new injury's diagnosed recovery. */
export function medicalRecoveryPercent(state: FacilitiesContext, clubId: string, onDate = state.date): number { return conditionedEffect(state, 'medical', FACILITY_RULES_2.medicalRecoveryPercent, clubId, onDate, FACILITY_RULES_3.medicalRecoveryPercent); }
/** `facilities-2`: how much of a player's extra recurrence risk (percent) the club's medical centre removes. */
export function medicalRecurrencePercent(state: FacilitiesContext, clubId: string, onDate = state.date): number { return conditionedEffect(state, 'medical', FACILITY_RULES_2.medicalRecurrencePercent, clubId, onDate, FACILITY_RULES_3.medicalRecurrencePercent); }
/** `facilities-2`: extra rehabilitation credit per day (percent) the club's medical centre gives its physio. */
export function medicalPhysioPercent(state: FacilitiesContext, clubId: string, onDate = state.date): number { return conditionedEffect(state, 'medical', FACILITY_RULES_2.medicalPhysioPercent, clubId, onDate, FACILITY_RULES_3.medicalPhysioPercent); }
/** `facilities-2`: extra evidence (percent) each observation gives the club's scouting office. */
export function scoutingEvidencePercent(state: FacilitiesContext, clubId: string, onDate = state.date): number { return conditionedEffect(state, 'scouting', FACILITY_RULES_2.scoutingEvidencePercent, clubId, onDate, FACILITY_RULES_3.scoutingEvidencePercent); }
/** `facilities-2`: how much wider (percent) the club's scouting office makes its discovery pool. */
export function scoutingDiscoveryPercent(state: FacilitiesContext, clubId: string, onDate = state.date): number { return conditionedEffect(state, 'scouting', FACILITY_RULES_2.scoutingDiscoveryPercent, clubId, onDate, FACILITY_RULES_3.scoutingDiscoveryPercent); }

/** `facilities-2`: attendance demand (percent) the arena's condition still draws; 100 in older careers. */
export function arenaComfortPercent(state: FacilitiesContext, clubId: string, onDate = state.date ?? '9999-12-31'): number {
  if (!usesFacilityRepairs(state.facilities) || !state.facilities?.enabledSince) return 100;
  const lost = 100 - facilityEffectPercent(state, 'arena', clubId, onDate);
  return 100 - lost * FACILITY_RULES_2.arenaComfortLossPercent / (100 - FACILITY_RULES_2.floorEffectPercent);
}

export type FacilityUpkeepBreakdown = { arena: number; training: number; youth: number; medical?: number; scouting?: number; total: number };
export function getFacilityUpkeepBreakdown(state: FacilitiesContext, clubId: string, onDate = state.date): FacilityUpkeepBreakdown {
  if (usesSixLevels(state.facilities)) {
    // `facilities-3`: levels above the club's starting level, and seats added to its opening arena.
    const level = (type: Exclude<FacilityType, 'arena'>) => sixLevelUpkeep(state, clubId, type, getFacilityLevel(state, type, clubId, onDate));
    const arena = arenaSeatUpkeep(state, clubId, addedSeats(state, clubId, onDate ?? '9999-12-31')), training = level('training'), youth = level('youth'), medical = level('medical'), scouting = level('scouting');
    return { arena, training, youth, medical, scouting, total: arena + training + youth + medical + scouting };
  }
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
  // `facilities-3`: the opening arena plus every expansion completed by that date.
  if (usesSixLevels(state.facilities)) return clubFinanceDefinition(worldOf(state), clubId).capacity + addedSeats(state, clubId, onDate ?? '9999-12-31');
  // Sections of a worn arena expansion are closed for safety.
  return clubFinanceDefinition(worldOf(state), clubId).capacity + Math.floor(addedArenaSeats(state, clubId, getFacilityLevel(state, 'arena', clubId, onDate)) * facilityEffectPercent(state, 'arena', clubId, onDate ?? '9999-12-31') / 100);
}

/**
 * Starts and manual cancellations on matchday cannot change that day's already prepared gate. Repairs close seats like
 * construction; installing leased seating (format 71) closes none.
 */
export function getArenaCapacity(state: FacilitiesContext, clubId: string, onDate = state.date ?? '9999-12-31'): number {
  const capacity = getArenaFullCapacity(state, clubId, onDate);
  // `facilities-3`: an expansion closes no seats while it is built.
  if (usesSixLevels(state.facilities)) return capacity;
  const disrupted = state.facilities?.enabledSince && state.facilities.enabledSince.date <= onDate && state.facilities.projects.some(project => project.clubId === clubId && project.type === 'arena' && project.kind !== 'lease' && project.startedOn < onDate && (project.cancelledOn === null || project.cancelledOn >= onDate) && (project.completedOn === null || project.completedOn > onDate));
  return disrupted ? Math.floor(capacity * FACILITY_CONSTRUCTION_CAPACITY_PERCENT / 100) : capacity;
}

/** `facilities-3`: the headline effect of a facility at a level (practice, recovery or evidence percent; 0 for the arena). */
export function sixLevelBenefit(type: FacilityType, level: number): number {
  if (type === 'arena') return 0;
  const rules = FACILITY_RULES_3;
  return (type === 'medical' ? rules.medicalRecoveryPercent : type === 'scouting' ? rules.scoutingEvidencePercent : rules.practicePercent)[level - 1]!;
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
  if (usesSixLevels(state.facilities)) return quoteSixLevelUpgrade(state, type, clubId);
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
  else if (activeLease(state, clubId, type)) reason = FACILITY_LEASED_REASON;
  else if (getFinanceBalance(state.finance, clubId).unpaid > 0) reason = 'Settle unpaid club costs before funding construction.';
  else if (getTransferPaymentSummary(state, clubId).overdue > 0) reason = 'Settle overdue transfer payments before funding construction.';
  else if (available < cost) reason = FACILITY_FUNDS_REASON;
  return { clubId, type, fromLevel, toLevel, cost, durationDays, dueOn: facilityCompletionDate(state.date, durationDays), remainingBudgetAfter: Math.max(0, available - cost), upkeepAfter, totalUpkeepAfter: currentUpkeep - facilityUpkeep(state, clubId, type, fromLevel) + upkeepAfter, bonusAfter: type === 'arena' ? 0 : facilityLevelBenefit(type, toLevel), capacityAfter: type === 'arena' ? clubFinanceDefinition(worldOf(state), clubId).capacity + addedArenaSeats(state, clubId, toLevel) : 0, canStart: reason === null, reason };
}

/** `facilities-3`: extra upkeep per senior week of a facility at a level, above the club's starting level. */
function sixLevelUpkeep(context: WorldContext, clubId: string, type: Exclude<FacilityType, 'arena'>, level: number): number {
  const table = FACILITY_RULES_3.upkeep[type], extra = table[level - 1]! - table[startingFacilityLevel(context, clubId, type) - 1]!;
  return extra > 0 ? scaledMoney(context, clubId, extra, 100) : 0;
}

/** `facilities-3`: seats added to a club's opening arena by the expansions completed on or before a date. */
function addedSeats(state: FacilitiesContext, clubId: string, onDate: string): number {
  if (!state.facilities?.enabledSince || state.facilities.enabledSince.date > onDate) return 0;
  return state.facilities.projects.reduce((sum, project) => sum + (project.clubId === clubId && project.kind === 'expansion' && project.completedOn !== null && project.completedOn <= onDate ? project.seats ?? 0 : 0), 0);
}

/** `facilities-3`: arena upkeep per senior week for `seats` added seats, at the club's money level. */
const arenaSeatUpkeep = (context: WorldContext, clubId: string, seats: number): number => seats > 0 ? scaledMoney(context, clubId, seats * FACILITY_RULES_3.seatUpkeep, 100) : 0;

/** The common blockers of a `facilities-3` project, before money. */
function sixLevelProjectReason(state: SeasonState, type: FacilityType, clubId: string): string | null {
  if (!state.facilities?.enabledSince) return 'Enable club facilities before commissioning an upgrade.';
  if (!state.finance.enabledSince) return 'Enable club finances before funding construction.';
  if (type === 'training' && !state.training.enabledSince) return 'Enable senior training before upgrading its facilities.';
  if (type === 'youth' && !state.academy.enabledSince) return 'Open the youth academy before upgrading its infrastructure.';
  if (type === 'scouting' && !state.scouting.enabledSince) return 'Enable scouting before upgrading the scouting office.';
  if (getActiveFacilityProject(state, clubId)) return 'Finish or cancel the current club project before starting another.';
  if (getFinanceBalance(state.finance, clubId).unpaid > 0) return 'Settle unpaid club costs before funding construction.';
  if (getTransferPaymentSummary(state, clubId).overdue > 0) return 'Settle overdue transfer payments before funding construction.';
  return null;
}

/** `facilities-3`: one level up, paid in full from Remaining budget on approval. */
function quoteSixLevelUpgrade(state: SeasonState, type: FacilityType, clubId: string): FacilityUpgradeQuote {
  const rules = FACILITY_RULES_3, max = rules.levelNames.length, fromLevel = getFacilityLevel(state, type, clubId), toLevel = Math.min(max, fromLevel + 1);
  const arena = type === 'arena', top = arena || fromLevel === max;
  const cost = top ? 0 : scaledMoney(state, clubId, rules.costs[type as Exclude<FacilityType, 'arena'>][toLevel - 1]!);
  const durationDays = top ? 0 : rules.weeks[toLevel - 1]! * 7;
  const available = state.finance.enabledSince ? getSpendableCash(state, clubId) : 0, currentUpkeep = getFacilityUpkeep(state, clubId);
  const upkeepNow = arena ? 0 : sixLevelUpkeep(state, clubId, type, fromLevel), upkeepAfter = arena ? 0 : sixLevelUpkeep(state, clubId, type, toLevel);
  let reason: string | null = null;
  if (arena) reason = 'The arena has seats instead of levels: choose an expansion size.';
  else if (fromLevel === max) reason = 'This facility is already Excellent.';
  else reason = sixLevelProjectReason(state, type, clubId) ?? (available < cost ? FACILITY_BANK_REASON : null);
  return { clubId, type, fromLevel, toLevel, cost, durationDays, dueOn: facilityCompletionDate(state.date, durationDays), remainingBudgetAfter: Math.max(0, available - cost), upkeepAfter, totalUpkeepAfter: currentUpkeep - upkeepNow + upkeepAfter, bonusAfter: sixLevelBenefit(type, toLevel), capacityAfter: 0, canStart: reason === null, reason };
}

/** `facilities-3`: the expansion sizes a club's arena can take now (at most half its seats, the smallest always, within the maximum). */
export function arenaExpansionSizes(state: FacilitiesContext, clubId: string): number[] {
  const rules = FACILITY_RULES_3, capacity = getArenaFullCapacity(state, clubId);
  return rules.expansionSeats.filter((seats, index) => (index === 0 || seats * 100 <= capacity * rules.expansionMaxSharePercent) && capacity + seats <= rules.maxArenaSeats);
}

/**
 * `facilities-3`: the terms of adding `seats` to a club's arena: the size's price at the club's money level, its weeks
 * of work, and the upkeep of the added seats from completion. Paid in full from Remaining budget on approval.
 */
export function quoteArenaExpansion(state: SeasonState, seats: number, clubId = state.managedClubId): ArenaExpansionQuote {
  requireFacilityType(state, 'arena', clubId);
  const rules = FACILITY_RULES_3, index = rules.expansionSeats.indexOf(seats), size = index >= 0;
  const capacityBefore = getArenaFullCapacity(state, clubId), cost = size ? scaledMoney(state, clubId, rules.expansionCosts[index]!) : 0;
  const durationDays = size ? rules.expansionWeeks[index]! * 7 : 0;
  const available = state.finance.enabledSince ? getSpendableCash(state, clubId) : 0, currentUpkeep = state.facilities?.enabledSince ? getFacilityUpkeep(state, clubId) : 0;
  const added = addedSeats(state, clubId, '9999-12-31');
  const upkeepNow = arenaSeatUpkeep(state, clubId, added), upkeepAfter = arenaSeatUpkeep(state, clubId, added + (size ? seats : 0));
  let reason: string | null = null;
  if (!usesSixLevels(state.facilities)) reason = 'Arena expansions by size belong to careers started with the current facilities model.';
  else if (!size) reason = `Choose an expansion of ${rules.expansionSeats.map(item => item.toLocaleString('en-GB')).join(', ')} seats.`;
  else if (capacityBefore + seats > rules.maxArenaSeats) reason = `The arena cannot grow beyond ${rules.maxArenaSeats.toLocaleString('en-GB')} seats.`;
  else if (index > 0 && seats * 100 > capacityBefore * rules.expansionMaxSharePercent) reason = `One expansion can add at most half the arena's ${capacityBefore.toLocaleString('en-GB')} seats.`;
  else reason = sixLevelProjectReason(state, 'arena', clubId) ?? (available < cost ? FACILITY_BANK_REASON : null);
  return { clubId, seats, capacityBefore, capacityAfter: capacityBefore + (size ? seats : 0), cost, durationDays, dueOn: facilityCompletionDate(state.date, durationDays), remainingBudgetAfter: Math.max(0, available - cost), upkeepAfter, totalUpkeepAfter: currentUpkeep - upkeepNow + upkeepAfter, canStart: reason === null, reason };
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
  const six = usesSixLevels(state.facilities), maxLevel = facilityMaxLevel(state.facilities);
  const expansions = six && state.facilities.enabledSince ? arenaExpansionSizes(state, clubId).map(seats => quoteArenaExpansion(state, seats, clubId)) : [];
  return { enabled: state.facilities?.enabledSince !== null && state.facilities?.enabledSince !== undefined, model: state.facilities?.model ?? 'facilities-1', maintenance, clubId, delegated: state.facilities?.delegated[clubId] ?? false, remainingBudget: getSpendableCash(state, clubId), upkeepPerRound: upkeep.total, arenaCapacity: (state.status === 'active' ? state.finance.roundCapacities?.[clubId] : undefined) ?? getArenaCapacity(state, clubId), arenaFullCapacity: getArenaFullCapacity(state, clubId), expansions, rows: facilityTypes(state.facilities).map(type => ({ type, level: getFacilityLevel(state, type, clubId), maxLevel, levelName: six && type !== 'arena' ? facilityLevelName(getFacilityLevel(state, type, clubId)) : null, bonusPercent: bonus(type), capacity: type === 'arena' ? getArenaFullCapacity(state, clubId) : 0, upkeepPerRound: upkeep[type] ?? 0, project: active?.type === type ? active : null, quote: quoteFacilityUpgrade(state, type, clubId), condition: getFacilityCondition(state, type, clubId), effectPercent: facilityEffectPercent(state, type, clubId), repair: repairs ? quoteFacilityRepair(state, type, clubId) : null })) };
}
