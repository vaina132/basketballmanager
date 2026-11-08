import type { ArchivedFixture, FixtureResult, SeasonArchive, SeasonFixture, SeasonInjury, SeasonState } from '../domain/season';
import type { FinanceBalance, FinanceEntry } from '../domain/finance';
import type { PayrollItem, PlayerWageAgreement, SeasonPayroll } from '../domain/payroll';
import type { SeasonTraining, TrainingPlan, TrainingPoints, TrainingWeekReport } from '../domain/training';
import type { CoachingWeekAssignment, SeasonCoaching } from '../domain/coaching';
import type { PlayerStats, Side, Team } from '../domain/types';
import { DEVELOPMENT_CLUBS, DEVELOPMENT_DATA_PACK_ID } from '../data/development-league';
import { DEVELOPMENT_COACHES } from '../data/development-coaches';
import { getSeasonWage } from '../data/development-wages';
import { MAX_MATCH_PERIODS } from '../engine/match';
import { createSchedule, DAILY_RECOVERY, dateForRound, fixtureSeed, MAX_SEASON_NUMBER, ROUND_INTERVAL_DAYS } from '../world/season';
import { createSeasonInjury, isRecovering } from '../world/health';
import { createTraining, developClub, processTrainingWeek, TRAINING_ATTRIBUTES, TRAINING_FOCUSES, TRAINING_INTENSITIES } from '../world/training';
import { coachingAssignments, COACHING_BUDGET, createCoaching, MAX_COACHES } from '../world/coaching';
import { ANNUAL_SPONSORSHIP, createFinance, forecastGate, MAX_TICKET_PRICE, OPENING_CASH, ROUND_OPERATING_COST, TICKET_PRICE_STEP } from '../world/finance';
import { createPayroll } from '../world/payroll';
import { payrollInstallment, PREPAYMENT_DISCOUNT_PERCENT } from '../world/payroll-policy';
import { readLocalSeason, writeLocalSeason } from './season-indexed-db';
import { validateMatchState } from './validate-match';

export const MAX_SEASON_SAVE_BYTES = 8 * 1024 * 1024;
const FORMAT = 'basketball-manager-season';
const SIDES = ['home', 'away'] as const;
const STAT_KEYS: readonly (keyof PlayerStats)[] = [
  'secondsPlayed', 'points', 'fieldGoalsMade', 'fieldGoalsAttempted', 'threePointersMade',
  'threePointersAttempted', 'freeThrowsMade', 'freeThrowsAttempted', 'rebounds', 'assists',
  'steals', 'blocks', 'turnovers', 'fouls', 'condition',
];
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function fail(path: string, reason: string): never { throw new Error(`Invalid season save: ${path} ${reason}.`); }
function record(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object');
  const fields = value as Record<string, unknown>;
  if (keys.some(key => !Object.hasOwn(fields, key)) || Object.keys(fields).some(key => !keys.includes(key))) fail(path, 'has missing or unsupported fields');
  return fields;
}
function number(value: unknown, path: string, min: number, max: number, integer = true): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || integer && !Number.isInteger(value)) fail(path, `must be ${integer ? 'an integer' : 'a number'} between ${min} and ${max}`);
  return value;
}
function array(value: unknown, path: string, length: number): unknown[] {
  if (!Array.isArray(value) || value.length !== length) fail(path, `must contain exactly ${length} entries`);
  return value;
}
function sameData(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) !== Array.isArray(right)) return false;
  const a = Object.keys(left), b = Object.keys(right);
  return a.length === b.length && a.every(key => Object.hasOwn(right, key) && sameData((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
}
function score(value: unknown, path: string): Record<Side, number> {
  const fields = record(value, path, SIDES);
  return { home: number(fields.home, `${path}.home`, 0, 1_000_000), away: number(fields.away, `${path}.away`, 0, 1_000_000) };
}
function checkSize(text: string): void {
  if (text.length > MAX_SEASON_SAVE_BYTES || new TextEncoder().encode(text).byteLength > MAX_SEASON_SAVE_BYTES) throw new Error('The season file is too large. The season save limit is 8 MB.');
}
function checkJsonTree(root: unknown): void {
  const pending: { value: unknown; depth: number }[] = [{ value: root, depth: 0 }];
  let count = 0;
  while (pending.length) {
    const { value, depth } = pending.pop()!;
    if (++count > 800_000 || depth > 40) throw new Error('The season file has too many values or nested objects.');
    if (value === null || typeof value !== 'object') continue;
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error('The season must contain plain save data.');
    const entries = Object.entries(value);
    if (entries.length > 20_000) throw new Error('The season file contains an oversized collection.');
    for (const [key, child] of entries) {
      if (FORBIDDEN_KEYS.has(key)) throw new Error('The season file contains an unsafe property.');
      pending.push({ value: child, depth: depth + 1 });
    }
  }
}

/** Both full current results and compact career archives retain official result rules. */
function validateResultSummary(fields: Record<string, unknown>, path: string, home: Team, away: Team) {
  if (fields.kind !== 'normal' && fields.kind !== 'default') fail(`${path}.kind`, 'is unsupported');
  const periods = number(fields.periods, `${path}.periods`, fields.kind === 'normal' ? 4 : 1, MAX_MATCH_PERIODS);
  const earned = score(fields.score, `${path}.score`), official = score(fields.officialScore, `${path}.officialScore`);
  if (fields.winnerClubId !== home.id && fields.winnerClubId !== away.id) fail(`${path}.winnerClubId`, 'must identify a participating club');
  const winner: Side = fields.winnerClubId === home.id ? 'home' : 'away', loser: Side = winner === 'home' ? 'away' : 'home';
  if (official[winner] <= official[loser]) fail(`${path}.officialScore`, 'does not identify the declared winner');
  if (fields.kind === 'normal' && !sameData(earned, official)) fail(`${path}.officialScore`, 'must equal earned points for a normal result');
  if (fields.kind === 'default') {
    const expected = earned[winner] > earned[loser] ? earned : { [winner]: 2, [loser]: 0 };
    if (!sameData(expected, official)) fail(`${path}.officialScore`, 'does not match the default award rule');
  }
  return { periods, earned, loser };
}

/** Completed matches retain accounting, not a second copy of their event history. */
function validateResult(value: unknown, path: string, home: Team, away: Team, legacy: boolean): FixtureResult {
  const fields = record(value, path, ['score', 'officialScore', 'winnerClubId', 'kind', 'periods', 'stats', ...(legacy ? [] : ['injuries'])]);
  const injuries = legacy ? {} : validateInjuryMap(fields.injuries, `${path}.injuries`, [...home.players, ...away.players].map(player => player.id));
  const { periods, earned, loser } = validateResultSummary(fields, path, home, away);
  const elapsedLimit = periods <= 4 ? periods * 600 : 2400 + (periods - 4) * 300;
  const players = [...home.players, ...away.players];
  const stats = record(fields.stats, `${path}.stats`, players.map(player => player.id));
  const totals = { home: { points: 0, seconds: 0, eligible: 0, made: 0, assists: 0, steals: 0, blocks: 0, turnovers: 0, misses: 0 }, away: { points: 0, seconds: 0, eligible: 0, made: 0, assists: 0, steals: 0, blocks: 0, turnovers: 0, misses: 0 } };
  for (const side of SIDES) {
    const team = side === 'home' ? home : away;
    for (const player of team.players) {
      const location = `${path}.stats.${player.id}`;
      const entry = record(stats[player.id], location, STAT_KEYS);
      for (const key of STAT_KEYS) number(entry[key], `${location}.${key}`, key === 'condition' ? 35 : 0, key === 'secondsPlayed' ? elapsedLimit : key === 'fouls' ? 5 : key === 'condition' ? 100 : 1_000_000, key !== 'condition');
      const stat = entry as unknown as PlayerStats;
      if (stat.fieldGoalsMade > stat.fieldGoalsAttempted || stat.threePointersMade > stat.threePointersAttempted || stat.freeThrowsMade > stat.freeThrowsAttempted) fail(location, 'has more makes than attempts');
      if (stat.threePointersMade > stat.fieldGoalsMade || stat.threePointersAttempted > stat.fieldGoalsAttempted || stat.fieldGoalsMade - stat.threePointersMade > stat.fieldGoalsAttempted - stat.threePointersAttempted) fail(location, 'has inconsistent two-point and three-point totals');
      if (stat.points !== 2 * stat.fieldGoalsMade + stat.threePointersMade + stat.freeThrowsMade) fail(location, 'has points inconsistent with shooting');
      const total = totals[side];
      total.points += stat.points; total.seconds += stat.secondsPlayed; total.eligible += stat.fouls < 5 && !Object.hasOwn(injuries, player.id) ? 1 : 0;
      total.made += stat.fieldGoalsMade; total.assists += stat.assists; total.steals += stat.steals;
      total.blocks += stat.blocks; total.turnovers += stat.turnovers; total.misses += stat.fieldGoalsAttempted - stat.fieldGoalsMade;
    }
    const total = totals[side];
    if (total.points !== earned[side]) fail(`${path}.score.${side}`, 'does not equal player points');
    if (total.seconds > elapsedLimit * 5) fail(`${path}.stats`, 'contains excessive court time');
    if (fields.kind === 'normal' && (total.seconds < elapsedLimit * 2 || total.eligible >= 5 && total.seconds !== elapsedLimit * 5)) fail(`${path}.stats`, 'does not reconcile with elapsed game time');
    if (total.assists > total.made) fail(`${path}.stats`, 'has more assists than made baskets');
  }
  for (const side of SIDES) {
    const other = side === 'home' ? 'away' : 'home';
    if (totals[side].steals > totals[other].turnovers || totals[side].blocks > totals[other].misses) fail(`${path}.stats`, 'has inconsistent steals or blocks');
  }
  if (fields.kind === 'default' && totals[loser].eligible >= 2) fail(path, 'cannot declare default while two eligible players remain');
  return fields as unknown as FixtureResult;
}

/** Old seasons deliberately omit player box scores; current fixtures still validate them. */
function validateArchivedResult(value: unknown, path: string, home: Team, away: Team): ArchivedFixture['result'] {
  const fields = record(value, path, ['score', 'officialScore', 'winnerClubId', 'kind', 'periods', 'injuries']);
  validateResultSummary(fields, path, home, away);
  validateInjuryMap(fields.injuries, `${path}.injuries`, [...home.players, ...away.players].map(player => player.id));
  return fields as unknown as ArchivedFixture['result'];
}

/** Compact result diagnoses identify both new injuries and players already unavailable. */
function validateInjuryMap(value: unknown, path: string, playerIds: readonly string[]): Record<string, SeasonInjury['kind']> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object');
  const fields = value as Record<string, unknown>;
  for (const [id, kind] of Object.entries(fields)) {
    if (!playerIds.includes(id)) fail(`${path}.${id}`, 'must identify a participating player');
    if (kind !== 'ankle' && kind !== 'muscle') fail(`${path}.${id}`, 'must identify a supported injury');
  }
  return fields as Record<string, SeasonInjury['kind']>;
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  const a = [...left].sort(), b = [...right].sort();
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function requireNoPlay(stats: PlayerStats, path: string): void {
  if (STAT_KEYS.some(key => key !== 'condition' && stats[key] !== 0)) fail(path, 'must have zero personal statistics while recovering from an earlier injury');
}

function validateTrainingPlans(value: unknown, path: string, clubs: readonly Team[]): Record<string, TrainingPlan> {
  const plans = record(value, path, clubs.map(club => club.id));
  for (const club of clubs) {
    const location = `${path}.${club.id}`, plan = record(plans[club.id], location, ['delegated', 'intensity', 'focus', 'individual']);
    if (typeof plan.delegated !== 'boolean') fail(`${location}.delegated`, 'must be boolean');
    if (!TRAINING_INTENSITIES.includes(plan.intensity as TrainingPlan['intensity'])) fail(`${location}.intensity`, 'is unsupported');
    if (!TRAINING_FOCUSES.includes(plan.focus as TrainingPlan['focus'])) fail(`${location}.focus`, 'is unsupported');
    const individual = record(plan.individual, `${location}.individual`, club.players.map(player => player.id));
    for (const [id, focus] of Object.entries(individual)) if (focus !== 'team' && !TRAINING_FOCUSES.includes(focus as TrainingPlan['focus'])) fail(`${location}.individual.${id}`, 'is unsupported');
  }
  return plans as unknown as Record<string, TrainingPlan>;
}

function completedDevelopmentWeeks(anchor: { seasonNumber: number; round: number } | null, seasonNumber: number, round: number): number {
  return anchor ? (seasonNumber - anchor.seasonNumber) * 9 + Math.min(round - 1, 9) - (anchor.round - 1) : 0;
}

/** Current-year contracts retain released appointments so expenditure and past weeks reconcile. */
function validateCoaching(value: unknown, clubs: readonly Team[], seasonNumber: number, round: number): SeasonCoaching {
  const fields = record(value, 'coaching', ['model', 'enabledSince', 'contracts']);
  if (fields.model !== 'coaching-1') fail('coaching.model', 'is unsupported');
  let earliestRound = 1;
  if (fields.enabledSince !== null) {
    const anchor = record(fields.enabledSince, 'coaching.enabledSince', ['seasonNumber', 'round']);
    const year = number(anchor.seasonNumber, 'coaching.enabledSince.seasonNumber', 1, seasonNumber);
    const enabledRound = number(anchor.round, 'coaching.enabledSince.round', 1, year === seasonNumber ? round : 10);
    if (year === seasonNumber) earliestRound = enabledRound;
  }
  const maximumContracts = clubs.length * Math.floor(COACHING_BUDGET / Math.min(...DEVELOPMENT_COACHES.map(coach => coach.fee)));
  if (!Array.isArray(fields.contracts) || fields.contracts.length > maximumContracts) fail('coaching.contracts', 'must be a bounded contract history');
  if (fields.enabledSince === null && fields.contracts.length !== 0) fail('coaching.contracts', 'must be empty while coaching is disabled');
  const expenses = new Map(clubs.map(club => [club.id, 0]));
  let previousRound = earliestRound;
  for (const [index, value] of fields.contracts.entries()) {
    const path = `coaching.contracts[${index}]`;
    const contract = record(value, path, ['id', 'coachId', 'clubId', 'seasonNumber', 'startedRound', 'releasedRound', 'focus', 'renew']);
    if (contract.id !== `coach-s${seasonNumber}-c${index + 1}` || contract.seasonNumber !== seasonNumber) fail(path, 'must use sequential identities in the current season');
    const coach = DEVELOPMENT_COACHES.find(coach => coach.id === contract.coachId);
    if (!coach) fail(`${path}.coachId`, 'must identify a coach in the development catalog');
    if (typeof contract.clubId !== 'string' || !expenses.has(contract.clubId)) fail(`${path}.clubId`, 'must identify a club in this league');
    const startedRound = number(contract.startedRound, `${path}.startedRound`, earliestRound, round);
    if (startedRound < previousRound) fail(`${path}.startedRound`, 'must follow contract creation order');
    previousRound = startedRound;
    if (contract.releasedRound !== null) number(contract.releasedRound, `${path}.releasedRound`, startedRound, round);
    if (!TRAINING_FOCUSES.includes(contract.focus as TrainingPlan['focus'])) fail(`${path}.focus`, 'is unsupported');
    if (typeof contract.renew !== 'boolean') fail(`${path}.renew`, 'must be boolean');
    expenses.set(contract.clubId, expenses.get(contract.clubId)! + coach.fee);
  }
  for (const [clubId, expense] of expenses) if (expense > COACHING_BUDGET) fail(`coaching.contracts.${clubId}`, 'exceeds the annual coaching budget, including released contracts');
  const coaching = fields as unknown as SeasonCoaching;
  for (let interval = 1; interval <= round; interval += 1) {
    const appointments = coaching.contracts.filter(contract => contract.startedRound <= interval && (contract.releasedRound === null || contract.releasedRound > interval));
    if (new Set(appointments.map(contract => contract.coachId)).size !== appointments.length) fail('coaching.contracts', 'assigns one coach to simultaneous contracts');
    for (const club of clubs) if (appointments.filter(contract => contract.clubId === club.id).length > MAX_COACHES) fail(`coaching.contracts.${club.id}`, 'exceeds the coaching staff limit');
  }
  return coaching;
}

function validateTicketPrice(value: unknown, path: string): number {
  const price = number(value, path, 0, MAX_TICKET_PRICE);
  if (price % TICKET_PRICE_STEP !== 0) fail(path, 'must use whole-euro price steps');
  return price;
}

/** Retained terms identify every obligation, including those from previous seasons. */
function validatePayroll(value: unknown, clubs: readonly Team[], seasonNumber: number, round: number, managedClubId: string, ledgerLength: number): SeasonPayroll {
  const fields = record(value, 'payroll', ['model', 'enabledSince', 'delegated', 'agreements']);
  if (fields.model !== 'payroll-1') fail('payroll.model', 'is unsupported');
  const delegated = record(fields.delegated, 'payroll.delegated', clubs.map(club => club.id));
  for (const club of clubs) if (typeof delegated[club.id] !== 'boolean') fail(`payroll.delegated.${club.id}`, 'must be boolean');
  if (!Array.isArray(fields.agreements) || fields.agreements.length > 20_000) fail('payroll.agreements', 'must contain at most 20000 retained agreements');
  if (fields.enabledSince === null) {
    if (!sameData(fields, createPayroll(clubs, managedClubId))) fail('payroll', 'must retain default delegation and no agreements while disabled');
    return fields as unknown as SeasonPayroll;
  }
  const anchor = record(fields.enabledSince, 'payroll.enabledSince', ['seasonNumber', 'round', 'ledgerIndex']);
  const firstYear = number(anchor.seasonNumber, 'payroll.enabledSince.seasonNumber', 1, seasonNumber);
  const firstRound = number(anchor.round, 'payroll.enabledSince.round', 1, firstYear === seasonNumber ? round : 10);
  number(anchor.ledgerIndex, 'payroll.enabledSince.ledgerIndex', 0, ledgerLength);
  const players = clubs.flatMap(club => club.players.map(player => ({ clubId: club.id, playerId: player.id })));
  const agreements = array(fields.agreements, 'payroll.agreements', (seasonNumber - firstYear + 1) * players.length);
  for (const [index, value] of agreements.entries()) {
    const path = `payroll.agreements[${index}]`;
    const agreement = record(value, path, ['id', 'playerId', 'clubId', 'seasonNumber', 'startsRound', 'seasonWage']);
    const player = players[index % players.length]!, year = firstYear + Math.floor(index / players.length);
    const expected: PlayerWageAgreement = { id: `wage-s${year}-${player.playerId}`, ...player, seasonNumber: year, startsRound: year === firstYear ? firstRound : 1, seasonWage: getSeasonWage(player.playerId) };
    if (!sameData(agreement, expected)) fail(path, 'must retain the canonical player, club, season and wage terms from activation onward');
  }
  return fields as unknown as SeasonPayroll;
}

/** Reconcile required career cash events against the calendar; no balance is trusted from a save. */
function validateFinance(value: unknown, clubs: readonly Team[], fixtures: SeasonFixture[], archives: SeasonArchive[], coaching: SeasonCoaching, seasonNumber: number, round: number, status: SeasonState['status'], managedClubId: string, payroll?: SeasonPayroll): void {
  const fields = record(value, 'finance', ['model', 'enabledSince', 'plans', 'roundPrices', 'ledger']);
  if (fields.model !== 'finance-1') fail('finance.model', 'is unsupported');
  const clubIds = clubs.map(club => club.id);
  const plans = record(fields.plans, 'finance.plans', clubIds), prices = record(fields.roundPrices, 'finance.roundPrices', clubIds);
  for (const club of clubs) {
    const plan = record(plans[club.id], `finance.plans.${club.id}`, ['delegated', 'price']);
    if (typeof plan.delegated !== 'boolean') fail(`finance.plans.${club.id}.delegated`, 'must be boolean');
    validateTicketPrice(plan.price, `finance.plans.${club.id}.price`);
    validateTicketPrice(prices[club.id], `finance.roundPrices.${club.id}`);
  }
  if (!Array.isArray(fields.ledger) || fields.ledger.length > 20_000) fail('finance.ledger', 'must contain at most 20000 entries');
  if (fields.enabledSince === null) {
    if (payroll?.enabledSince) fail('payroll.enabledSince', 'requires active club finances');
    if (fields.ledger.length) fail('finance.ledger', 'must be empty while finances are disabled');
    if (!sameData(fields, createFinance(clubs, managedClubId))) fail('finance', 'must retain the default plans and prices while disabled');
    return;
  }
  const anchor = record(fields.enabledSince, 'finance.enabledSince', ['seasonNumber', 'round']);
  const firstYear = number(anchor.seasonNumber, 'finance.enabledSince.seasonNumber', 1, seasonNumber);
  const firstRound = number(anchor.round, 'finance.enabledSince.round', 1, firstYear === seasonNumber ? round : 10);
  const payrollAnchor = payroll?.enabledSince;
  if (payrollAnchor && payrollAnchor.seasonNumber * 10 + payrollAnchor.round < firstYear * 10 + firstRound) fail('payroll.enabledSince', 'cannot precede club finances');
  const committedRound = status === 'complete' ? round : round - 1;
  const financeRounds = Math.max(0, (seasonNumber - firstYear) * 10 + committedRound - firstRound + 1);
  const minimumEntries = clubs.length * (seasonNumber - firstYear + 2) + financeRounds * (clubs.length + clubs.length / 2);
  if (fields.ledger.length < minimumEntries) fail('finance.ledger', 'is missing required opening, sponsorship, operating or ticket entries');
  type RequiredEvent = Pick<FinanceEntry, 'clubId' | 'seasonNumber' | 'round' | 'kind' | 'sourceId'> & { amount?: number; fixture?: SeasonFixture | ArchivedFixture };
  const origin = (clubId: string, kind: FinanceEntry['kind'], sourceId: string) => `${clubId}/${kind}/${sourceId}`;
  const required = new Map<string, RequiredEvent>();
  const schedules = new Map<number, readonly (SeasonFixture | ArchivedFixture)[]>(archives.map(archive => [archive.seasonNumber, archive.fixtures]));
  schedules.set(seasonNumber, fixtures);
  const add = (entry: RequiredEvent) => required.set(origin(entry.clubId, entry.kind, entry.sourceId), entry);
  for (const club of clubs) add({ clubId: club.id, seasonNumber: firstYear, round: firstRound, kind: 'opening', sourceId: 'opening', amount: OPENING_CASH });
  for (let year = firstYear; year <= seasonNumber; year += 1) {
    const fromRound = year === firstYear ? firstRound : 1, throughRound = year === seasonNumber ? committedRound : 10;
    for (const club of clubs) add({ clubId: club.id, seasonNumber: year, round: fromRound, kind: 'sponsor', sourceId: `sponsor-s${year}`, amount: year === firstYear ? ANNUAL_SPONSORSHIP / 10 * (11 - firstRound) : ANNUAL_SPONSORSHIP });
    for (let playedRound = fromRound; playedRound <= throughRound; playedRound += 1) for (const club of clubs) add({ clubId: club.id, seasonNumber: year, round: playedRound, kind: 'operations', sourceId: `operations-s${year}-r${playedRound}`, amount: -ROUND_OPERATING_COST });
    for (const fixture of schedules.get(year)!) if (fixture.result && fixture.round >= fromRound && fixture.round <= throughRound) add({ clubId: fixture.homeClubId, seasonNumber: year, round: fixture.round, kind: 'tickets', sourceId: `tickets-${fixture.id}`, fixture });
  }

  const wageGroups = new Map<string, PlayerWageAgreement[]>(), remainingWages = new Map<string, number>(), wageReserves = new Map<string, number>(), prepaid = new Set<string>();
  const wageGroup = (year: number, clubId: string) => `${year}/${clubId}`;
  for (const agreement of payroll?.agreements ?? []) {
    const key = wageGroup(agreement.seasonNumber, agreement.clubId), group = wageGroups.get(key) ?? [];
    group.push(agreement); wageGroups.set(key, group);
    const gross = agreement.seasonWage - Math.floor((agreement.startsRound - 1) * agreement.seasonWage / 10);
    remainingWages.set(agreement.id, gross); wageReserves.set(key, (wageReserves.get(key) ?? 0) + gross);
  }
  if (payrollAnchor) for (let year = payrollAnchor.seasonNumber; year <= seasonNumber; year += 1) {
    const from = year === payrollAnchor.seasonNumber ? payrollAnchor.round : 1, through = year === seasonNumber ? committedRound : 10;
    for (let paidRound = from; paidRound <= through; paidRound += 1) for (const club of clubs) add({ clubId: club.id, seasonNumber: year, round: paidRound, kind: 'payroll', sourceId: `payroll-s${year}-r${paidRound}` });
  }
  const wageReserve = (year: number, clubId: string, index: number) => payrollAnchor && index >= payrollAnchor.ledgerIndex ? wageReserves.get(wageGroup(year, clubId)) ?? 0 : 0;
  function chargeGross(agreement: PlayerWageAgreement, gross: number): void {
    const remaining = remainingWages.get(agreement.id)!;
    if (gross > remaining) fail('finance.ledger.payroll', 'cannot charge more than the remaining wage obligation');
    remainingWages.set(agreement.id, remaining - gross);
    const key = wageGroup(agreement.seasonNumber, agreement.clubId);
    wageReserves.set(key, wageReserves.get(key)! - gross);
  }

  const seen = new Set<string>(), coachOrigins = new Set<string>(), feeTotals = new Map<string, number>(), financialCommitRounds = new Set<number>();
  const currentContracts = new Map(coaching.contracts.map(contract => [contract.id, contract]));
  const balances = new Map<string, FinanceBalance>(clubs.map(club => [club.id, { cash: 0, unpaid: 0 }]));
  const maximumContracts = clubs.length * Math.floor(COACHING_BUDGET / Math.min(...DEVELOPMENT_COACHES.map(coach => coach.fee)));
  let previousDate = firstYear * 10 + firstRound, entryYear = firstYear, yearIndex = 0;
  for (const [index, value] of fields.ledger.entries()) {
    const path = `finance.ledger[${index}]`;
    const entry = record(value, path, ['id', 'clubId', 'seasonNumber', 'round', 'kind', 'amount', 'sourceId', 'ticket', 'coach', ...(payroll ? ['payroll'] : [])]);
    if (entry.id !== `finance-${index + 1}`) fail(`${path}.id`, 'must use sequential career-wide identities');
    if (typeof entry.clubId !== 'string' || !balances.has(entry.clubId)) fail(`${path}.clubId`, 'must identify a club in this league');
    const year = number(entry.seasonNumber, `${path}.seasonNumber`, firstYear, seasonNumber);
    const entryRound = number(entry.round, `${path}.round`, 1, year === seasonNumber ? round : 10);
    const calendar = year * 10 + entryRound;
    if (calendar < previousDate) fail(path, 'must follow the financial calendar without preceding activation');
    if (payrollAnchor) {
      const activationDate = payrollAnchor.seasonNumber * 10 + payrollAnchor.round;
      if (index < payrollAnchor.ledgerIndex ? calendar > activationDate : calendar < activationDate) fail('payroll.enabledSince.ledgerIndex', 'must identify the ledger boundary on the activation date');
    }
    previousDate = calendar;
    if (!['opening', 'sponsor', 'operations', 'tickets', 'coaching', ...(payroll ? ['payroll'] : [])].includes(entry.kind as string)) fail(`${path}.kind`, 'is unsupported');
    const kind = entry.kind as FinanceEntry['kind'];
    if (payrollAnchor && calendar === payrollAnchor.seasonNumber * 10 + payrollAnchor.round) {
      if ((kind === 'opening' || kind === 'sponsor') && index >= payrollAnchor.ledgerIndex) fail('payroll.enabledSince.ledgerIndex', 'must follow opening funds and sponsorship already booked at activation');
      if ((kind === 'tickets' || kind === 'operations' || kind === 'payroll') && index < payrollAnchor.ledgerIndex) fail('payroll.enabledSince.ledgerIndex', 'must precede the activation matchday financial commit');
    }
    const amount = number(entry.amount, `${path}.amount`, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
    if (typeof entry.sourceId !== 'string') fail(`${path}.sourceId`, 'must identify its financial event');
    const key = origin(entry.clubId, kind, entry.sourceId);
    if (seen.has(key)) fail(`${path}.sourceId`, 'duplicates a financial event');
    seen.add(key);

    if (year !== entryYear) { entryYear = year; yearIndex = 0; }
    const openingRows = year === firstYear ? clubs.length : 0;
    if (yearIndex < openingRows + clubs.length) {
      const opening = yearIndex < openingRows, expectedClub = clubs[opening ? yearIndex : yearIndex - openingRows]!;
      if (kind !== (opening ? 'opening' : 'sponsor') || entry.clubId !== expectedClub.id) fail(path, 'must record opening funds and annual sponsors before other financial events');
    }
    yearIndex += 1;

    if (kind === 'tickets' || kind === 'operations') financialCommitRounds.add(calendar);
    if (payroll && kind !== 'payroll' && entry.payroll !== null) fail(`${path}.payroll`, 'must be empty for non-payroll events');
    if (kind === 'payroll') {
      if (!payrollAnchor || index < payrollAnchor.ledgerIndex) fail(path, 'cannot charge wages before payroll activation');
      if (entry.ticket !== null || entry.coach !== null) fail(path, 'must not mix ticket or coaching details with payroll');
      const details = record(entry.payroll, `${path}.payroll`, ['type', 'fromRound', 'throughRound', 'items']);
      if (details.type !== 'installment' && details.type !== 'prepayment') fail(`${path}.payroll.type`, 'is unsupported');
      if (details.type === 'installment') financialCommitRounds.add(calendar);
      else if (financialCommitRounds.has(calendar)) fail(path, 'cannot prepay during the atomic matchday financial commit');
      if (details.fromRound !== entryRound || details.throughRound !== (details.type === 'prepayment' ? 10 : entryRound)) fail(`${path}.payroll`, 'must identify the exact payable installment range');
      const agreements = wageGroups.get(wageGroup(year, entry.clubId));
      if (!agreements || entryRound < agreements[0]!.startsRound) fail(path, 'must identify active wage agreements');
      let expectedItems: PayrollItem[];
      if (details.type === 'installment') {
        const expected = required.get(key);
        if (!expected || expected.kind !== 'payroll' || expected.seasonNumber !== year || expected.round !== entryRound) fail(path, 'must identify a completed matchday payroll installment');
        expectedItems = agreements.filter(agreement => !prepaid.has(agreement.id)).map(agreement => {
          const gross = payrollInstallment(agreement.seasonWage, entryRound);
          return { agreementId: agreement.id, playerId: agreement.playerId, gross, discount: 0, amount: gross };
        });
        required.delete(key);
      } else {
        const items = array(details.items, `${path}.payroll.items`, 1);
        const item = record(items[0], `${path}.payroll.items[0]`, ['agreementId', 'playerId', 'gross', 'discount', 'amount']);
        const agreement = agreements.find(agreement => agreement.id === item.agreementId);
        if (!agreement || prepaid.has(agreement.id) || entry.sourceId !== `prepay-${agreement.id}`) fail(path, 'must identify one unpaid agreement exactly once');
        const gross = agreement.seasonWage - Math.floor((entryRound - 1) * agreement.seasonWage / 10);
        if (remainingWages.get(agreement.id) !== gross) fail(path, 'must prepay exactly the unposted installments from this round');
        const discount = Math.floor(gross * PREPAYMENT_DISCOUNT_PERCENT / 100), net = gross - discount;
        const balance = balances.get(entry.clubId)!, otherReserve = wageReserve(year, entry.clubId, index) - gross;
        if (balance.unpaid > 0 || balance.cash < net + otherReserve) fail(path, 'must settle obligations and retain cash for all other future wages before prepayment');
        expectedItems = [{ agreementId: agreement.id, playerId: agreement.playerId, gross, discount, amount: net }];
        prepaid.add(agreement.id);
      }
      const items = array(details.items, `${path}.payroll.items`, expectedItems.length);
      for (const [itemIndex, item] of items.entries()) record(item, `${path}.payroll.items[${itemIndex}]`, ['agreementId', 'playerId', 'gross', 'discount', 'amount']);
      if (!sameData(items, expectedItems) || amount !== -expectedItems.reduce((sum, item) => sum + item.amount, 0)) fail(path, 'must reconcile exact wage items, discounts and total cost');
      for (const item of expectedItems) chargeGross(agreements.find(agreement => agreement.id === item.agreementId)!, item.gross);
    } else if (kind === 'coaching') {
      if (entry.ticket !== null) fail(`${path}.ticket`, 'must be empty for a coaching fee');
      const details = record(entry.coach, `${path}.coach`, ['contractId', 'coachId']);
      const coach = DEVELOPMENT_COACHES.find(coach => coach.id === details.coachId);
      if (!coach || amount !== -coach.fee) fail(path, 'must record the full catalog coaching fee');
      const contractMatch = typeof details.contractId === 'string' ? /^coach-s([1-9]\d*)-c([1-9]\d*)$/.exec(details.contractId) : null;
      if (!contractMatch || Number(contractMatch[1]) !== year || Number(contractMatch[2]) > maximumContracts || entry.sourceId !== `coaching-${details.contractId}`) fail(`${path}.coach.contractId`, 'must identify a supported contract in this season');
      if (coachOrigins.has(details.contractId as string)) fail(`${path}.coach.contractId`, 'duplicates a paid contract');
      coachOrigins.add(details.contractId as string);
      if (!coaching.enabledSince || calendar < coaching.enabledSince.seasonNumber * 10 + coaching.enabledSince.round) fail(path, 'cannot charge coaching before its activation');
      if (year === seasonNumber) {
        const contract = currentContracts.get(details.contractId as string);
        const bookedRound = contract && firstYear === year ? Math.max(firstRound, contract.startedRound) : contract?.startedRound;
        if (!contract || contract.clubId !== entry.clubId || contract.coachId !== details.coachId || entryRound !== bookedRound) fail(path, 'must match its current-season coaching contract and booking round');
      }
      // Historical contracts are not archived. Their catalog fees and annual limits remain verifiable.
      const feeKey = `${year}/${entry.clubId}`, total = (feeTotals.get(feeKey) ?? 0) - amount;
      if (total > COACHING_BUDGET) fail(path, 'exceeds the annual coaching commitment limit');
      feeTotals.set(feeKey, total);
      const balance = balances.get(entry.clubId)!;
      if (balance.unpaid > 0 || balance.cash < -amount + wageReserve(year, entry.clubId, index)) fail(path, 'cannot hire or renew a coach without sufficient cash, settled obligations and reserved player wages');
    } else {
      if (entry.coach !== null) fail(`${path}.coach`, 'must be empty for a non-coaching event');
      const expected = required.get(key);
      if (!expected || expected.seasonNumber !== year || expected.round !== entryRound) fail(path, 'does not match a required financial event in the calendar');
      if (kind === 'tickets') {
        const ticket = record(entry.ticket, `${path}.ticket`, ['fixtureId', 'price', 'attendance']);
        const fixture = expected.fixture!;
        if (ticket.fixtureId !== fixture.id) fail(`${path}.ticket.fixtureId`, 'must identify its completed home fixture');
        const price = validateTicketPrice(ticket.price, `${path}.ticket.price`);
        const gate = forecastGate({ fixtures: schedules.get(year)! }, fixture, price);
        number(ticket.attendance, `${path}.ticket.attendance`, 0, gate.capacity);
        if (ticket.attendance !== gate.attendance || amount !== gate.revenue) fail(path, 'does not match attendance and revenue from the pre-round sporting results');
        if (year === seasonNumber && entryRound === round && price !== prices[entry.clubId]) fail(`${path}.ticket.price`, 'must match the current matchday locked price');
      } else {
        if (entry.ticket !== null) fail(`${path}.ticket`, 'must be empty for a non-ticket event');
        if (amount !== expected.amount) fail(`${path}.amount`, 'does not match its required financial event');
      }
      required.delete(key);
    }

    const before = balances.get(entry.clubId)!;
    const settled = amount >= 0 ? Math.min(before.unpaid, amount) : Math.min(before.cash, -amount);
    const after = amount >= 0 ? { cash: before.cash + amount - settled, unpaid: before.unpaid - settled } : { cash: before.cash - settled, unpaid: before.unpaid - amount - settled };
    if (!Number.isSafeInteger(after.cash) || !Number.isSafeInteger(after.unpaid)) fail(path, 'exceeds supported accounting values');
    balances.set(entry.clubId, after);
  }
  if (required.size) fail('finance.ledger', 'is missing required calendar financial events');
  for (const contract of coaching.contracts) if (!coachOrigins.has(contract.id)) fail('finance.ledger', 'must retain the fee for every current-year coaching contract, including releases');
}

/** Validate historical identities, while allowing a coach's current focus to have changed. */
function coachingForReport(value: unknown, coaching: SeasonCoaching, clubs: readonly Team[], seasonNumber: number, afterRound: number): SeasonCoaching {
  const expected = coachingAssignments(coaching, clubs, seasonNumber, afterRound);
  if (expected === null) {
    if (value !== null) fail('training.lastWeek.coaching', 'must be empty before coaching is enabled');
    return coaching;
  }
  const snapshot = record(value, 'training.lastWeek.coaching', clubs.map(club => club.id));
  const focuses = new Map<string, CoachingWeekAssignment['focus']>();
  for (const club of clubs) {
    const path = `training.lastWeek.coaching.${club.id}`;
    const assignments = array(snapshot[club.id], path, expected[club.id]!.length);
    for (const [index, value] of assignments.entries()) {
      const assignment = record(value, `${path}[${index}]`, ['contractId', 'coachId', 'focus']), reference = expected[club.id]![index]!;
      if (assignment.contractId !== reference.contractId || assignment.coachId !== reference.coachId) fail(path, 'must identify exactly the coaches contracted for this club during the week');
      if (!TRAINING_FOCUSES.includes(assignment.focus as CoachingWeekAssignment['focus'])) fail(`${path}[${index}].focus`, 'is unsupported');
      focuses.set(reference.contractId, assignment.focus as CoachingWeekAssignment['focus']);
    }
  }
  return { ...coaching, contracts: coaching.contracts.map(contract => focuses.has(contract.id) ? { ...contract, focus: focuses.get(contract.id)! } : contract) };
}

function withoutCoachingReport(report: TrainingWeekReport | null): unknown {
  if (!report) return null;
  const { coaching: _coaching, ...original } = report;
  return { ...original, players: Object.fromEntries(Object.entries(report.players).map(([id, entry]) => { const { coachingGains: _coachingGains, ...player } = entry; return [id, player]; })) };
}

/** Format 4 contained identical training outcomes but no coach attribution fields. */
function migrateTrainingCoaching(training: SeasonTraining): SeasonTraining {
  if (!training.lastWeek) return training;
  return { ...training, lastWeek: { ...training.lastWeek, coaching: null, players: Object.fromEntries(Object.entries(training.lastWeek.players).map(([id, player]) => [id, { ...player, coachingGains: Object.fromEntries(TRAINING_ATTRIBUTES.map(attribute => [attribute, 0])) as TrainingPoints }])) } };
}

/** Reconcile the retained week; older development remains bounded state, not invented history. */
function validateTraining(value: unknown, clubs: readonly Team[], fixtures: SeasonFixture[], injuries: SeasonInjury[], seasonNumber: number, round: number, coaching?: SeasonCoaching): { training: SeasonTraining; conditionsAfter: Record<string, number> | null } {
  const fields = record(value, 'training', ['model', 'enabledSince', 'plans', 'points', 'lastWeek']);
  if (fields.model !== 'training-1') fail('training.model', 'is unsupported');
  validateTrainingPlans(fields.plans, 'training.plans', clubs);
  let weeks = 0;
  if (fields.enabledSince !== null) {
    const anchor = record(fields.enabledSince, 'training.enabledSince', ['seasonNumber', 'round']);
    const year = number(anchor.seasonNumber, 'training.enabledSince.seasonNumber', 1, seasonNumber);
    const startRound = number(anchor.round, 'training.enabledSince.round', 1, year === seasonNumber ? round : 10);
    weeks = (seasonNumber - year) * 9 + Math.min(round - 1, 9) - (startRound - 1);
  }
  const coachingWeeks = coaching ? Math.min(weeks, completedDevelopmentWeeks(coaching.enabledSince, seasonNumber, round)) : 0;
  const playerIds = clubs.flatMap(club => club.players.map(player => player.id));
  const points = record(fields.points, 'training.points', playerIds);
  for (const player of clubs.flatMap(club => club.players)) {
    const entry = record(points[player.id], `training.points.${player.id}`, TRAINING_ATTRIBUTES);
    for (const attribute of TRAINING_ATTRIBUTES) number(entry[attribute], `training.points.${player.id}.${attribute}`, 0, Math.min(200, (20 - player.attributes[attribute]) * 100));
    if (TRAINING_ATTRIBUTES.reduce((total, attribute) => total + (entry[attribute] as number), 0) > weeks * 35 + coachingWeeks * 8) fail(`training.points.${player.id}`, 'exceeds available training weeks');
  }
  const training = fields as unknown as SeasonTraining, anchor = training.enabledSince;
  const needsReport = anchor !== null && round > 1 && (anchor.seasonNumber < seasonNumber || anchor.round < round);
  if (!needsReport) {
    if (fields.lastWeek !== null) fail('training.lastWeek', 'must be empty before an enabled training interval or after rollover');
    return { training, conditionsAfter: null };
  }
  const report = record(fields.lastWeek, 'training.lastWeek', ['seasonNumber', 'afterRound', 'fromDate', 'toDate', 'plans', 'players', ...(coaching ? ['coaching'] : [])]);
  const afterRound = Math.min(round - 1, 9);
  if (report.seasonNumber !== seasonNumber || report.afterRound !== afterRound || report.fromDate !== dateForRound(afterRound, seasonNumber) || report.toDate !== dateForRound(afterRound + 1, seasonNumber)) fail('training.lastWeek', 'must identify the most recent completed training interval');
  const appliedPlans = validateTrainingPlans(report.plans, 'training.lastWeek.plans', clubs);
  const appliedCoaching = coaching ? coachingForReport(report.coaching, coaching, clubs, seasonNumber, afterRound) : undefined;
  const priorCoachingWeeks = Math.max(0, coachingWeeks - (coaching && report.coaching !== null ? 1 : 0));
  const players = record(report.players, 'training.lastWeek.players', playerIds);
  const pointsBefore: Record<string, TrainingPoints> = {}, conditionsBefore: Record<string, number> = {};
  for (const club of clubs) {
    const fixture = fixtures.find(fixture => fixture.round === afterRound && [fixture.homeClubId, fixture.awayClubId].includes(club.id))!;
    for (const player of club.players) {
      const path = `training.lastWeek.players.${player.id}`;
      const entry = record(players[player.id], path, ['focus', 'intensity', 'availableDays', 'conditionBefore', 'conditionAfter', 'gains', ...(coaching ? ['coachingGains'] : [])]);
      if (!TRAINING_FOCUSES.includes(entry.focus as TrainingPlan['focus']) || !TRAINING_INTENSITIES.includes(entry.intensity as TrainingPlan['intensity'])) fail(path, 'has unsupported training instructions');
      number(entry.availableDays, `${path}.availableDays`, 0, 7);
      number(entry.conditionBefore, `${path}.conditionBefore`, 35, 100, false);
      number(entry.conditionAfter, `${path}.conditionAfter`, 35, 100, false);
      conditionsBefore[player.id] = fixture.result!.stats[player.id]!.condition;
      if (entry.conditionBefore !== conditionsBefore[player.id]) fail(`${path}.conditionBefore`, 'must match the preceding committed match');
      const gains = record(entry.gains, `${path}.gains`, TRAINING_ATTRIBUTES);
      const coachingGains = coaching ? record(entry.coachingGains, `${path}.coachingGains`, TRAINING_ATTRIBUTES) : null;
      const previous = {} as TrainingPoints;
      for (const attribute of TRAINING_ATTRIBUTES) {
        const gain = number(gains[attribute], `${path}.gains.${attribute}`, 0, coaching ? 43 : 35);
        if (coachingGains) number(coachingGains[attribute], `${path}.coachingGains.${attribute}`, 0, Math.min(8, gain));
        previous[attribute] = training.points[player.id]![attribute] - gain;
        if (previous[attribute] < 0) fail(`${path}.gains.${attribute}`, 'exceeds retained development points');
      }
      if (TRAINING_ATTRIBUTES.reduce((total, attribute) => total + previous[attribute], 0) > Math.max(0, weeks - 1) * 35 + priorCoachingWeeks * 8) fail(`training.points.${player.id}`, 'exceeds training weeks before the retained report');
      pointsBefore[player.id] = previous;
    }
  }
  const replayed = processTrainingWeek({
    training: { ...training, plans: appliedPlans, points: pointsBefore, lastWeek: null }, clubs, conditions: conditionsBefore,
    // Final-round injuries happen after the last training day and must not be replayed into it.
    injuries: injuries.filter(injury => injury.occurredOn <= (report.fromDate as string)),
    seasonNumber, afterRound, fromDate: report.fromDate as string, toDate: report.toDate as string, coaching: appliedCoaching,
  });
  if (!sameData(coaching ? replayed.training.lastWeek : withoutCoachingReport(replayed.training.lastWeek), training.lastWeek) || !sameData(replayed.training.points, training.points)) fail('training.lastWeek', 'does not reconcile with training plans, coaching, availability, recovery and development');
  return { training, conditionsAfter: replayed.conditions };
}

/** Older schemas keep their original constraints before migration adds career fields. */
function validateState(value: unknown, version: 1 | 2 | 3 | 4 | 5 | 6 | 7): void {
  const legacy = version === 1, career = version >= 3;
  checkJsonTree(value);
  const state = record(value, 'state', ['schemaVersion', 'engineVersion', 'dataPackId', 'seed', 'managedClubId', 'date', 'status', 'round', 'clubs', 'plans', 'conditions', 'fixtures', 'activeFixtureId', 'activeMatch', ...(legacy ? [] : ['injuryMode', 'injuries']), ...(career ? ['seasonNumber', 'history'] : []), ...(version >= 4 ? ['training'] : []), ...(version >= 5 ? ['coaching'] : []), ...(version >= 6 ? ['finance'] : []), ...(version >= 7 ? ['payroll'] : [])]);
  if (state.schemaVersion !== version || state.engineVersion !== 'possession-3' || state.dataPackId !== DEVELOPMENT_DATA_PACK_ID) fail('state', 'uses an unsupported schema, engine or data pack');
  const seed = number(state.seed, 'seed', 0, 0xffff_ffff), round = number(state.round, 'round', 1, 10);
  const seasonNumber = career ? number(state.seasonNumber, 'seasonNumber', 1, MAX_SEASON_NUMBER) : 1;
  const injuryMode = legacy ? 'off' : state.injuryMode;
  if (!['standard', 'reduced', 'off'].includes(injuryMode as string)) fail('injuryMode', 'must be standard, reduced or off');
  if (!legacy && (!Array.isArray(state.injuries) || state.injuries.length > 600 * seasonNumber)) fail('injuries', 'must be a bounded injury history');
  if (state.status !== 'active' && state.status !== 'complete') fail('status', 'must be active or complete');
  if (state.status === 'complete' && round !== 10) fail('round', 'must reach the final matchday before completion');
  if (!sameData(state.clubs, DEVELOPMENT_CLUBS)) fail('clubs', 'must match the versioned development data pack');
  const clubs = state.clubs as readonly Team[], clubIds = clubs.map(club => club.id);
  if (typeof state.managedClubId !== 'string' || !clubIds.includes(state.managedClubId)) fail('managedClubId', 'must identify a club in this league');
  const plans = record(state.plans, 'plans', clubIds);
  const playerIds = clubs.flatMap(club => club.players.map(player => player.id));
  const conditions = record(state.conditions, 'conditions', playerIds);
  for (const club of clubs) {
    const plan = record(plans[club.id], `plans.${club.id}`, ['tactics', 'lineup', 'autoSubstitutions']);
    const tactics = record(plan.tactics, `plans.${club.id}.tactics`, ['tempo', 'outsideShare', 'pressure']);
    for (const key of ['tempo', 'outsideShare', 'pressure']) number(tactics[key], `plans.${club.id}.tactics.${key}`, 0, 1, false);
    const lineup = array(plan.lineup, `plans.${club.id}.lineup`, 5);
    if (new Set(lineup).size !== 5 || lineup.some(id => !club.players.some(player => player.id === id))) fail(`plans.${club.id}.lineup`, 'must select five distinct players from its club');
    if (typeof plan.autoSubstitutions !== 'boolean' || club.id !== state.managedClubId && !plan.autoSubstitutions) fail(`plans.${club.id}.autoSubstitutions`, 'must be boolean and enabled for opponent clubs');
    for (const player of club.players) number(conditions[player.id], `conditions.${player.id}`, 0, 100, false);
  }
  const history: SeasonInjury[] = [];
  const latestInjuries = new Map<string, SeasonInjury>();
  function recordFixtureInjuries(result: ArchivedFixture['result'], expected: SeasonFixture, home: Team, away: Team, path: string, stats?: FixtureResult['stats']): void {
    const carried = [...latestInjuries.values()].filter(injury => [home.id, away.id].includes(injury.clubId) && isRecovering(injury, expected.date));
    for (const injury of carried) {
      if (result.injuries[injury.playerId] !== injury.kind) fail(`${path}.result.injuries`, 'must retain every player still recovering at this fixture');
      if (stats) requireNoPlay(stats[injury.playerId]!, `${path}.result.stats.${injury.playerId}`);
    }
    for (const [id, kind] of Object.entries(result.injuries)) {
      if (carried.some(injury => injury.playerId === id)) continue;
      if (injuryMode === 'off') fail(`${path}.result.injuries`, 'cannot record a new injury while injuries are off');
      if (stats && stats[id]!.secondsPlayed === 0) fail(`${path}.result.injuries.${id}`, 'requires exposure in its originating fixture');
      const club = home.players.some(player => player.id === id) ? home : away;
      const injury = createSeasonInjury(seed, expected, club.id, id, kind);
      history.push(injury);
      latestInjuries.set(id, injury);
    }
  }
  if (career) {
    const archives = array(state.history, 'history', seasonNumber - 1);
    for (const [archiveIndex, value] of archives.entries()) {
      const path = `history[${archiveIndex}]`, archive = record(value, path, ['seasonNumber', 'fixtures']);
      if (archive.seasonNumber !== archiveIndex + 1) fail(`${path}.seasonNumber`, 'must preserve every previous season in order');
      const schedule = createSchedule(clubs, archiveIndex + 1);
      const fixtures = array(archive.fixtures, `${path}.fixtures`, schedule.length);
      for (const [index, value] of fixtures.entries()) {
        const location = `${path}.fixtures[${index}]`, expected = schedule[index]!;
        const fixture = record(value, location, ['id', 'round', 'date', 'homeClubId', 'awayClubId', 'result']);
        for (const key of ['id', 'round', 'date', 'homeClubId', 'awayClubId'] as const) if (fixture[key] !== expected[key]) fail(location, 'does not match the versioned schedule');
        const home = clubs.find(club => club.id === expected.homeClubId)!, away = clubs.find(club => club.id === expected.awayClubId)!;
        const result = validateArchivedResult(fixture.result, `${location}.result`, home, away);
        recordFixtureInjuries(result, expected, home, away, location);
      }
    }
  }
  const schedule = createSchedule(clubs, seasonNumber), fixtures = array(state.fixtures, 'fixtures', schedule.length);
  const committedRound = state.status === 'complete' ? round : round - 1;
  for (const [index, value] of fixtures.entries()) {
    const path = `fixtures[${index}]`, expected = schedule[index]!;
    const fixture = record(value, path, ['id', 'round', 'date', 'homeClubId', 'awayClubId', 'result']);
    for (const key of ['id', 'round', 'date', 'homeClubId', 'awayClubId'] as const) if (fixture[key] !== expected[key]) fail(path, 'does not match the versioned schedule');
    if (expected.round <= committedRound) {
      if (fixture.result === null) fail(`${path}.result`, 'is missing from a completed matchday');
      const home = clubs.find(club => club.id === expected.homeClubId)!, away = clubs.find(club => club.id === expected.awayClubId)!;
      const result = validateResult(fixture.result, `${path}.result`, home, away, legacy);
      if (!legacy) recordFixtureInjuries(result, expected, home, away, path, result.stats);
    } else if (fixture.result !== null) fail(`${path}.result`, 'cannot be committed before its matchday');
  }
  if (!legacy) {
    const injuries = state.injuries as unknown[];
    for (const [index, injury] of injuries.entries()) record(injury, `injuries[${index}]`, ['id', 'playerId', 'clubId', 'kind', 'fixtureId', 'occurredOn', 'returnOn']);
    const ids = injuries.map(injury => (injury as SeasonInjury).id);
    if (new Set(ids).size !== ids.length || !sameIds(ids, history.map(injury => injury.id))) fail('injuries', 'must match the committed fixture injury history exactly');
    const byId = new Map(injuries.map(entry => [(entry as SeasonInjury).id, entry]));
    for (const injury of history) if (!sameData(byId.get(injury.id), injury)) fail(`injuries.${injury.id}`, 'has inconsistent identity, diagnosis, origin or recovery dates');
  }
  const active = (fixtures as SeasonFixture[]).find(fixture => fixture.round === round && [fixture.homeClubId, fixture.awayClubId].includes(state.managedClubId as string))!;
  const coaching = version >= 5 ? validateCoaching(state.coaching, clubs, seasonNumber, round) : undefined;
  let payroll: SeasonPayroll | undefined;
  if (version >= 7) {
    const finance = record(state.finance, 'finance', ['model', 'enabledSince', 'plans', 'roundPrices', 'ledger']);
    if (!Array.isArray(finance.ledger)) fail('finance.ledger', 'must be an array');
    payroll = validatePayroll(state.payroll, clubs, seasonNumber, round, state.managedClubId, finance.ledger.length);
  }
  if (version >= 6) validateFinance(state.finance, clubs, fixtures as SeasonFixture[], state.history as SeasonArchive[], coaching!, seasonNumber, round, state.status, state.managedClubId, payroll);
  const development = version >= 4 ? validateTraining(state.training, clubs, fixtures as SeasonFixture[], history, seasonNumber, round, coaching) : null;
  if (state.activeFixtureId !== active.id || state.date !== active.date) fail('activeFixtureId/date', 'must identify the managed club fixture on the current matchday');
  validateMatchState(state.activeMatch);
  const match = state.activeMatch;
  if (match.engineVersion !== 'possession-3' || match.seed !== fixtureSeed(seed, active.id)) fail('activeMatch', 'has the wrong engine or fixture seed');
  const home = clubs.find(club => club.id === active.homeClubId)!, away = clubs.find(club => club.id === active.awayClubId)!;
  if (!sameData(match.home, development ? developClub(home, development.training) : home) || !sameData(match.away, development ? developClub(away, development.training) : away)) fail('activeMatch', 'must use the fixture home and away squads with their current development');
  const opposition: Side = active.homeClubId === state.managedClubId ? 'away' : 'home';
  if (!match.autoSubstitutions[opposition]) fail('activeMatch.autoSubstitutions', 'must enable opponent substitutions');
  if (match.injuryMode !== injuryMode) fail('activeMatch.injuryMode', 'must match the season-wide injury setting');
  if (legacy) {
    if (Object.keys(match.injuries).length !== 0 || Object.hasOwn(match, 'preExistingInjuries')) fail('activeMatch', 'must use the legacy season-wide injury-off setting');
  } else {
    // The final fixture may already be in history, but its new injuries are not inherited.
    const carried = history.filter(injury => injury.fixtureId !== active.id && [home.id, away.id].includes(injury.clubId) && isRecovering(injury, active.date));
    if (!sameIds(match.preExistingInjuries ?? [], carried.map(injury => injury.playerId))) fail('activeMatch.preExistingInjuries', 'must match the players still recovering at kickoff');
    for (const injury of carried) {
      if (match.injuries[injury.playerId]?.kind !== injury.kind) fail('activeMatch.injuries', 'must retain the carried diagnosis');
      requireNoPlay(match.stats[injury.playerId]!, `activeMatch.stats.${injury.playerId}`);
    }
    if (injuryMode === 'off' && Object.keys(match.injuries).length) fail('activeMatch.injuries', 'cannot record injuries in an injury-free season');
  }
  if (state.status === 'complete') {
    if (match.status !== 'finished' || !match.result) fail('activeMatch', 'must be finished when the season is complete');
    const result = { score: match.score, officialScore: match.result.officialScore, winnerClubId: match[match.result.winner].id, kind: match.result.kind, periods: match.period, stats: match.stats, ...(legacy ? {} : { injuries: Object.fromEntries(Object.entries(match.injuries).map(([id, injury]) => [id, injury.kind])) }) };
    if (!sameData(active.result, result)) fail('activeMatch', 'does not match its committed final result');
  }
  // Recovery belongs to a completed matchday, so imports cannot run it twice.
  for (const club of clubs) {
    const latest = (fixtures as SeasonFixture[]).find(fixture => fixture.round === committedRound && [fixture.homeClubId, fixture.awayClubId].includes(club.id));
    for (const player of club.players) {
      const previous = latest?.result?.stats[player.id].condition ?? 100;
      const expected = state.status === 'complete' ? previous : development?.conditionsAfter?.[player.id] ?? Math.min(100, Math.round((previous + DAILY_RECOVERY * ROUND_INTERVAL_DAYS) * 1000) / 1000);
      if (conditions[player.id] !== expected) fail(`conditions.${player.id}`, 'does not match the last committed recovery boundary');
      if (match.status === 'ready' && (club.id === home.id || club.id === away.id) && match.stats[player.id]!.condition !== conditions[player.id]) fail(`activeMatch.stats.${player.id}.condition`, 'must match current season condition before tipoff');
    }
  }
}

/** Validate every reference and committed round before replacing any live season. */
export function validateSeasonState(value: unknown): asserts value is SeasonState { validateState(value, 7); }

export function serializeSeason(state: SeasonState): string {
  validateSeasonState(state);
  const text = JSON.stringify({ format: FORMAT, formatVersion: 7, engineVersion: 'possession-3', state });
  checkSize(text);
  return text;
}

export function parseSeason(text: string): SeasonState {
  checkSize(text);
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error('This is not a valid JSON season file.'); }
  checkJsonTree(parsed);
  const envelope = record(parsed, 'envelope', ['format', 'formatVersion', 'engineVersion', 'state']);
  if (envelope.format !== FORMAT || ![1, 2, 3, 4, 5, 6, 7].includes(envelope.formatVersion as number) || envelope.engineVersion !== 'possession-3') throw new Error('This season file uses an unsupported save format or engine version.');
  if (envelope.formatVersion === 1) {
    validateState(envelope.state, 1);
    const legacy = envelope.state as Omit<SeasonState, 'schemaVersion' | 'injuryMode' | 'injuries' | 'seasonNumber' | 'history' | 'training' | 'coaching' | 'finance' | 'payroll'>;
    const upgraded: SeasonState = { ...legacy, schemaVersion: 7, seasonNumber: 1, history: [], injuryMode: 'off', injuries: [], training: createTraining(legacy.clubs, false), coaching: createCoaching(legacy.clubs, 1, legacy.round, false), finance: createFinance(legacy.clubs, legacy.managedClubId), payroll: createPayroll(legacy.clubs, legacy.managedClubId), fixtures: legacy.fixtures.map(fixture => ({ ...fixture, result: fixture.result ? { ...fixture.result, injuries: {} } : null })) };
    validateSeasonState(upgraded);
    return upgraded;
  }
  if (envelope.formatVersion === 2) {
    validateState(envelope.state, 2);
    const previous = envelope.state as Omit<SeasonState, 'schemaVersion' | 'seasonNumber' | 'history' | 'training' | 'coaching' | 'finance' | 'payroll'>;
    const upgraded: SeasonState = { ...previous, schemaVersion: 7, seasonNumber: 1, history: [], training: createTraining(previous.clubs, false), coaching: createCoaching(previous.clubs, 1, previous.round, false), finance: createFinance(previous.clubs, previous.managedClubId), payroll: createPayroll(previous.clubs, previous.managedClubId) };
    validateSeasonState(upgraded);
    return upgraded;
  }
  if (envelope.formatVersion === 3) {
    validateState(envelope.state, 3);
    const previous = envelope.state as Omit<SeasonState, 'schemaVersion' | 'training' | 'coaching' | 'finance' | 'payroll'>;
    const upgraded: SeasonState = { ...previous, schemaVersion: 7, training: createTraining(previous.clubs, false), coaching: createCoaching(previous.clubs, previous.seasonNumber, previous.round, false), finance: createFinance(previous.clubs, previous.managedClubId), payroll: createPayroll(previous.clubs, previous.managedClubId) };
    validateSeasonState(upgraded);
    return upgraded;
  }
  if (envelope.formatVersion === 4) {
    validateState(envelope.state, 4);
    const previous = envelope.state as Omit<SeasonState, 'schemaVersion' | 'coaching' | 'finance' | 'payroll'>;
    const upgraded: SeasonState = { ...previous, schemaVersion: 7, training: migrateTrainingCoaching(previous.training), coaching: createCoaching(previous.clubs, previous.seasonNumber, previous.round, false), finance: createFinance(previous.clubs, previous.managedClubId), payroll: createPayroll(previous.clubs, previous.managedClubId) };
    validateSeasonState(upgraded);
    return upgraded;
  }
  if (envelope.formatVersion === 5) {
    validateState(envelope.state, 5);
    const previous = envelope.state as Omit<SeasonState, 'schemaVersion' | 'finance' | 'payroll'>;
    const upgraded: SeasonState = { ...previous, schemaVersion: 7, finance: createFinance(previous.clubs, previous.managedClubId), payroll: createPayroll(previous.clubs, previous.managedClubId) };
    validateSeasonState(upgraded);
    return upgraded;
  }
  if (envelope.formatVersion === 6) {
    validateState(envelope.state, 6);
    const previous = envelope.state as Omit<SeasonState, 'schemaVersion' | 'payroll'>;
    const upgraded: SeasonState = { ...previous, schemaVersion: 7, finance: { ...previous.finance, ledger: previous.finance.ledger.map(entry => ({ ...entry, payroll: null })) }, payroll: createPayroll(previous.clubs, previous.managedClubId) };
    validateSeasonState(upgraded);
    return upgraded;
  }
  validateSeasonState(envelope.state);
  return envelope.state;
}

export async function saveLocalSeason(state: SeasonState, expectedRevision: number): Promise<void> { await writeLocalSeason(serializeSeason(state), expectedRevision); }
export async function loadLocalSeason(): Promise<SeasonState | null> { const text = await readLocalSeason(); return text === null ? null : parseSeason(text); }
