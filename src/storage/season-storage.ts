import { createBoard } from '../world/board';
import type { SeasonBoard } from '../domain/board';
import { validateBoard } from './board-validation';
import { createRelationships } from '../world/relationships';
import type { SeasonRelationships } from '../domain/relationships';
import { validateRelationships } from './relationships-validation';
import type { ArchivedFixture, FixtureResult, SeasonArchive, SeasonFixture, SeasonInjury, SeasonState } from '../domain/season';
import type { FacilityAnchor, FacilityEvent, SeasonFacilities } from '../domain/facilities';
import { createFacilities, applyFacilityEvent, facilitiesAtEventCount } from '../world/facilities';
import { getArenaCapacity, getFacilityUpkeepBreakdown } from '../world/facilities-policy';
import { getClubFinanceDefinition } from '../data/development-finances';
import type { FinanceBalance, FinanceEntry } from '../domain/finance';
import type { PayrollItem, PlayerWageAgreement, SeasonPayroll } from '../domain/payroll';
import type { SeasonTraining, TrainingPlan, TrainingPoints, TrainingWeekReport } from '../domain/training';
import type { RosterSnapshot } from '../domain/roster';
import type { SeasonEmployment, EmploymentContract, EmploymentTransfer, EmploymentBuyout } from '../domain/employment';
import type { SeasonScouting } from '../domain/scouting';
import type { SeasonScouts, ScoutContract } from '../domain/scouts';
import type { SeasonFitness, FitnessContract } from '../domain/fitness';
import type { SeasonPhysio, PhysioContract } from '../domain/physio';
import type { SeasonAssistant, AssistantContract } from '../domain/assistant';
import type { SeasonAcademy } from '../domain/academy';
import type { SeasonLifecycle } from '../domain/lifecycle';
import type { SeasonYouth, YouthCoachContract } from '../domain/youth';
import type { SeasonYouthCompetition, YouthFixture } from '../domain/youth-competition';
import type { SeasonNegotiations } from '../domain/negotiations';
import type { MarketEvent, MarketWindow, SeasonMarket } from '../domain/market';
import type { InSeasonEvent, SeasonRecruitment } from '../domain/recruitment';
import type { CoachingWeekAssignment, SeasonCoaching } from '../domain/coaching';
import type { PlayerStats, Side, Team } from '../domain/types';
import { DEVELOPMENT_CLUBS, DEVELOPMENT_DATA_PACK_ID, DEVELOPMENT_START_DATE } from '../data/development-league';
import { DEVELOPMENT_COACHES } from '../data/development-coaches';
import { DEVELOPMENT_SCOUTS } from '../data/development-scouts';
import { DEVELOPMENT_FITNESS_COACHES } from '../data/development-fitness';
import { DEVELOPMENT_PHYSIOS } from '../data/development-physios';
import { DEVELOPMENT_ASSISTANTS } from '../data/development-assistants';
import { DEVELOPMENT_YOUTH_COACHES } from '../data/development-youth';
import { getSeasonWage } from '../data/development-wages';
import { getCareerPlayers, getCareerPlayer, getCareerWage, type CareerPlayerContext } from '../world/player-catalog';
import { MAX_MATCH_PERIODS } from '../engine/match';
import { createSchedule, DAILY_RECOVERY, dateForRound, fixtureSeed, MAX_SEASON_NUMBER, ROUND_INTERVAL_DAYS } from '../world/season';
import { createSeasonInjury, isRecovering } from '../world/health';
import { createTraining, developClub, processTrainingWeek, TRAINING_ATTRIBUTES, TRAINING_FOCUSES, TRAINING_INTENSITIES } from '../world/training';
import { coachingAssignments, COACHING_BUDGET, createCoaching, MAX_COACHES } from '../world/coaching';
import { ANNUAL_SPONSORSHIP, createFinance, forecastGate, MAX_TICKET_PRICE, OPENING_CASH, ROUND_OPERATING_COST, TICKET_PRICE_STEP } from '../world/finance';
import { createPayroll } from '../world/payroll';
import { agreementThroughRound, payrollInstallment, PREPAYMENT_DISCOUNT_PERCENT } from '../world/payroll-policy';
import { validateManagerProfile } from '../world/manager';
import { createRosterSnapshots, rosterForRound } from '../world/rosters';
import { createEmployment } from '../world/employment';
import { createScouting } from '../world/scouting';
import { createScouts } from '../world/scouts';
import { createFitness } from '../world/fitness';
import { createPhysio } from '../world/physio';
import { createAssistant } from '../world/assistant';
import { academyAtBoundary, createAcademy, enableAcademy, graduateAcademyProspect, prepareAcademySeason, processAcademyWeek } from '../world/academy';
import { createYouth } from '../world/youth';
import { createYouthCompetition, enableYouthCompetition, prepareYouthSeason, prepareYouthFixture, settleYouthFixture, getYouthPlayerStatus, youthCompetitionAtBoundary } from '../world/youth-competition';
import { createLifecycle, enableLifecycle, lifecycleAtBoundary, prepareLifecycleSeason } from '../world/lifecycle';
import { getPlayerAging, type LifecycleContext } from '../world/lifecycle-policy';
import { processRehabilitationWeek } from '../world/rehabilitation';
import { MAX_SCOUTS, scoutEvidence } from '../world/scout-policy';
import { STAFF_BUDGET } from '../world/staff-policy';
import { createNegotiations } from '../world/negotiations';
import { applyMarketEvent, createMarket } from '../world/market';
import { applyInSeasonEvent, createInSeasonRecruitment as createRecruitment } from '../world/recruitment';
import { getTransferPaymentSchedule, processTransferPayments } from '../world/transfer-payments';
import { addMarketDays, MARKET_MAX_EVENTS, MARKET_WINDOW_DAYS, isLiveMarketOffer } from '../world/market-policy';
import { evaluateNegotiation } from '../world/negotiations-policy';
import { contractForSeason, contractForRound, effectiveContractsForSeason, effectiveContractsForRound, getContractedClubs, getContractedClubsForRound, quotePlayerContract, EMPLOYMENT_BUDGET, MIN_ROSTER_SIZE, MAX_ROSTER_SIZE, MIN_CONTRACT_WAGE, MAX_CONTRACT_WAGE, MAX_CONTRACT_SEASONS, WAGE_STEP, MIN_ROSTER_WAGE_RESERVE } from '../world/employment-policy';
import { readLocalSeason, writeLocalSeason } from './season-indexed-db';
import { validateMatchState } from './validate-match';
import { MAX_SEASON_SAVE_BYTES, MAX_SEASON_SAVE_VALUES } from './season-limits';

export { MAX_SEASON_SAVE_BYTES } from './season-limits';
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
/** New terms stay absent on old saves; accepting them in an older envelope would rewrite history. */
function optionalClauseKeys(value: unknown, version: number, keys: readonly string[]): string[] {
  return version >= 20 && value !== null && typeof value === 'object' ? keys.filter(key => Object.hasOwn(value, key)) : [];
}
function validateOptionalReleaseFee(fields: Record<string, unknown>, path: string): void {
  if (!Object.hasOwn(fields, 'releaseFee')) return;
  const fee = number(fields.releaseFee, `${path}.releaseFee`, 100_000, 50_000_000);
  if (fee % 100_000) fail(`${path}.releaseFee`, 'must use whole thousand-euro steps');
}
function validateTransferMode(fields: Record<string, unknown>, path: string): void {
  if (!Object.hasOwn(fields, 'transferMode')) return;
  if (fields.transferMode !== 'release-clause' || !Object.hasOwn(fields, 'transferFee') || fields.transferPaymentPlan !== 'upfront') fail(`${path}.transferMode`, 'requires an explicit release-clause trigger and full upfront transfer fee');
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
  if (text.length > MAX_SEASON_SAVE_BYTES || new TextEncoder().encode(text).byteLength > MAX_SEASON_SAVE_BYTES) throw new Error('The season file is too large. The season save limit is 32 MB.');
}
function checkJsonTree(root: unknown): void {
  const pending: { value: unknown; depth: number }[] = [{ value: root, depth: 0 }];
  let count = 0;
  while (pending.length) {
    const { value, depth } = pending.pop()!;
    if (++count > MAX_SEASON_SAVE_VALUES || depth > 40) throw new Error('The season file has too many values or nested objects.');
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
function validateResult(value: unknown, path: string, home: Team, away: Team, legacy: boolean, rosterAware = false): FixtureResult {
  const fields = record(value, path, ['score', 'officialScore', 'winnerClubId', 'kind', 'periods', 'stats', ...(legacy ? [] : ['injuries']), ...(rosterAware ? ['rosterIds'] : [])]);
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

/** Migrated archives have no box scores; newly retained ones validate all player accounting. */
function validateArchivedResult(value: unknown, path: string, home: Team, away: Team, rosterAware = false): ArchivedFixture['result'] {
  const fields = record(value, path, ['score', 'officialScore', 'winnerClubId', 'kind', 'periods', 'injuries', ...(rosterAware ? ['stats', 'rosterIds'] : [])]);
  if (rosterAware && fields.stats !== null) return validateResult(value, path, home, away, false, true);
  validateResultSummary(fields, path, home, away);
  validateInjuryMap(fields.injuries, `${path}.injuries`, [...home.players, ...away.players].map(player => player.id));
  return fields as unknown as ArchivedFixture['result'];
}

/** Each registration boundary retains the precise players and jersey assignments then in force. */
function validateRosters(value: unknown, path: string, clubs: readonly Team[], seasonNumber: number, employment?: SeasonEmployment, throughRound = 10, context: CareerPlayerContext = {}): RosterSnapshot[] {
  const expected = createRosterSnapshots(clubsForEmploymentYear(employment, seasonNumber, 1, context), seasonNumber);
  for (let round = 2; round <= throughRound; round += 1) for (const club of clubsForEmploymentYear(employment, seasonNumber, round, context)) {
    if (!sameData(rosterForRound(expected, club.id, round).players, club.players)) expected.push({ id: `roster-s${seasonNumber}-${club.id}-r${round}`, clubId: club.id, fromRound: round, players: club.players.map(player => ({ ...player, attributes: { ...player.attributes } })) });
  }
  if (!sameData(value, expected) || !sameData(clubs, clubsForEmploymentYear(employment, seasonNumber, throughRound, context))) fail(path, 'must preserve the exact opening and arrival roster snapshots at their registration boundaries');
  return value as RosterSnapshot[];
}

function recordedTeams(value: unknown, fixture: SeasonFixture, clubs: readonly Team[], rosters: readonly RosterSnapshot[], path: string): { home: Team; away: Team } {
  const fields = record(value, path, ['score', 'officialScore', 'winnerClubId', 'kind', 'periods', 'injuries', 'stats', 'rosterIds']);
  const refs = record(fields.rosterIds, `${path}.rosterIds`, SIDES);
  return Object.fromEntries(SIDES.map(side => {
    const clubId = side === 'home' ? fixture.homeClubId : fixture.awayClubId;
    const snapshot = rosterForRound(rosters, clubId, fixture.round);
    if (refs[side] !== snapshot.id) fail(`${path}.rosterIds.${side}`, 'must identify this club\'s registered roster at the fixture boundary');
    return [side, { ...clubs.find(club => club.id === clubId)!, players: snapshot.players }];
  })) as unknown as { home: Team; away: Team };
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

function validateLedgerBoundary(ledger: readonly FinanceEntry[], index: number, year: number, round: number, path: string): void {
  const boundary = year * 10 + round;
  for (const [at, entry] of ledger.entries()) {
    const dated = entry.seasonNumber * 10 + entry.round;
    if (at < index ? dated > boundary : dated < boundary) fail(path, 'must identify a contiguous ledger prefix on the recorded matchday');
  }
}

/** Retained appointment and ledger boundaries explain every named scouting observation. */
function validateScouts(value: unknown, state: SeasonState, coaching: SeasonCoaching): SeasonScouts {
  const fields = record(value, 'scouts', ['model', 'enabledSince', 'contracts']);
  if (fields.model !== 'scouts-1' || !Array.isArray(fields.contracts) || fields.contracts.length > 20_000) fail('scouts', 'must retain a supported bounded appointment history');
  if (fields.enabledSince === null) {
    if (!sameData(fields, createScouts())) fail('scouts', 'must retain its empty default while recruitment is disabled');
    return fields as unknown as SeasonScouts;
  }
  const ledger = state.finance.ledger;
  if (!Array.isArray(ledger) || !state.finance.enabledSince || !state.scouting.enabledSince) fail('scouts.enabledSince', 'requires active finances and scouting');
  const anchor = record(fields.enabledSince, 'scouts.enabledSince', ['seasonNumber', 'round', 'ledgerIndex']);
  const firstYear = number(anchor.seasonNumber, 'scouts.enabledSince.seasonNumber', 1, state.seasonNumber);
  const firstRound = number(anchor.round, 'scouts.enabledSince.round', 1, firstYear === state.seasonNumber ? state.round : 10);
  const firstLedger = number(anchor.ledgerIndex, 'scouts.enabledSince.ledgerIndex', 0, ledger.length);
  const firstBoundary = firstYear * 10 + firstRound;
  if ([state.finance.enabledSince, state.scouting.enabledSince].some(enabled => enabled.seasonNumber * 10 + enabled.round > firstBoundary)) fail('scouts.enabledSince', 'cannot precede finances or scouting activation');
  validateLedgerBoundary(ledger, firstLedger, firstYear, firstRound, 'scouts.enabledSince.ledgerIndex');
  const contracts: ScoutContract[] = [];
  let previousLedger = firstLedger - 1, previousBoundary = firstBoundary;
  const fees = new Map(state.clubs.map(club => [club.id, coaching.contracts.filter(contract => contract.clubId === club.id).reduce((sum, contract) => sum + DEVELOPMENT_COACHES.find(coach => coach.id === contract.coachId)!.fee, 0)]));
  for (const [index, value] of fields.contracts.entries()) {
    const path = `scouts.contracts[${index}]`;
    const entry = record(value, path, ['id', 'scoutId', 'clubId', 'seasonNumber', 'startedRound', 'releasedRound', 'renew', 'hiredLedgerIndex', 'releasedLedgerIndex']);
    if (entry.id !== `scout-contract-${index + 1}`) fail(`${path}.id`, 'must retain career-wide sequential appointment identities');
    const scout = DEVELOPMENT_SCOUTS.find(scout => scout.id === entry.scoutId);
    if (!scout || typeof entry.clubId !== 'string' || !fees.has(entry.clubId)) fail(path, 'must identify a catalog scout and club');
    const year = number(entry.seasonNumber, `${path}.seasonNumber`, firstYear, state.seasonNumber);
    const round = number(entry.startedRound, `${path}.startedRound`, year === firstYear ? firstRound : 1, year === state.seasonNumber ? state.round : 10);
    if (year * 10 + round < previousBoundary) fail(path, 'must retain chronological appointment order');
    previousBoundary = year * 10 + round;
    const hired = number(entry.hiredLedgerIndex, `${path}.hiredLedgerIndex`, previousLedger + 1, ledger.length - 1);
    previousLedger = hired;
    validateLedgerBoundary(ledger, hired, year, round, `${path}.hiredLedgerIndex`);
    const charged = ledger[hired];
    if (!charged || charged.kind !== 'scouting' || charged.clubId !== entry.clubId || charged.seasonNumber !== year || charged.round !== round || charged.sourceId !== `scouting-${entry.id}`) fail(path, 'must be followed immediately by its actual appointment fee');
    if (typeof entry.renew !== 'boolean') fail(`${path}.renew`, 'must be boolean');
    if (entry.releasedRound === null) {
      if (entry.releasedLedgerIndex !== null) fail(`${path}.releasedLedgerIndex`, 'must be empty for an unreleased appointment');
    } else {
      const releasedRound = number(entry.releasedRound, `${path}.releasedRound`, round, year === state.seasonNumber ? state.round : 10);
      const released = number(entry.releasedLedgerIndex, `${path}.releasedLedgerIndex`, hired + 1, ledger.length);
      validateLedgerBoundary(ledger, released, year, releasedRound, `${path}.releasedLedgerIndex`);
    }
    const active = contracts.filter(contract => contract.seasonNumber === year && (contract.releasedLedgerIndex === null || contract.releasedLedgerIndex > hired));
    if (active.some(contract => contract.scoutId === scout.id)) fail(path, 'cannot appoint a scout already employed at this ledger boundary');
    if (active.filter(contract => contract.clubId === entry.clubId).length >= MAX_SCOUTS) fail(path, 'exceeds the three-scout staff limit at this appointment');
    if (year === state.seasonNumber) {
      const total = fees.get(entry.clubId)! + scout.fee;
      if (total > STAFF_BUDGET) fail(path, 'exceeds the shared annual staff allocation including released appointments');
      fees.set(entry.clubId, total);
    }
    contracts.push(entry as unknown as ScoutContract);
  }
  return fields as unknown as SeasonScouts;
}

/** Fitness appointments retain the same historical cash proof as other paid staff. */
function validateFitness(value: unknown, state: SeasonState, coaching: SeasonCoaching, scouts: SeasonScouts): SeasonFitness {
  const fields = record(value, 'fitness', ['model', 'enabledSince', 'contracts']);
  if (fields.model !== 'fitness-1' || !Array.isArray(fields.contracts) || fields.contracts.length > 20_000) fail('fitness', 'must retain a supported bounded appointment history');
  if (fields.enabledSince === null) {
    if (!sameData(fields, createFitness())) fail('fitness', 'must retain its empty default while recruitment is disabled');
    return fields as unknown as SeasonFitness;
  }
  const ledger = state.finance.ledger;
  if (!Array.isArray(ledger) || !state.finance.enabledSince || !state.training.enabledSince) fail('fitness.enabledSince', 'requires active finances and training');
  const anchor = record(fields.enabledSince, 'fitness.enabledSince', ['seasonNumber', 'round', 'ledgerIndex']);
  const firstYear = number(anchor.seasonNumber, 'fitness.enabledSince.seasonNumber', 1, state.seasonNumber);
  const firstRound = number(anchor.round, 'fitness.enabledSince.round', 1, firstYear === state.seasonNumber ? Math.min(9, state.round) : 9);
  const firstLedger = number(anchor.ledgerIndex, 'fitness.enabledSince.ledgerIndex', 0, ledger.length);
  const firstBoundary = firstYear * 10 + firstRound;
  if ([state.finance.enabledSince, state.training.enabledSince].some(enabled => enabled.seasonNumber * 10 + enabled.round > firstBoundary)) fail('fitness.enabledSince', 'cannot precede finances or training activation');
  validateLedgerBoundary(ledger, firstLedger, firstYear, firstRound, 'fitness.enabledSince.ledgerIndex');
  const contracts: FitnessContract[] = [];
  let previousLedger = firstLedger - 1, previousBoundary = firstBoundary;
  const fees = new Map(state.clubs.map(club => [club.id, coaching.contracts.filter(contract => contract.clubId === club.id).reduce((sum, contract) => sum + DEVELOPMENT_COACHES.find(coach => coach.id === contract.coachId)!.fee, 0) + scouts.contracts.filter(contract => contract.clubId === club.id && contract.seasonNumber === state.seasonNumber).reduce((sum, contract) => sum + DEVELOPMENT_SCOUTS.find(scout => scout.id === contract.scoutId)!.fee, 0)]));
  for (const [index, value] of fields.contracts.entries()) {
    const path = `fitness.contracts[${index}]`;
    const entry = record(value, path, ['id', 'coachId', 'clubId', 'seasonNumber', 'startedRound', 'releasedRound', 'renew', 'hiredLedgerIndex', 'releasedLedgerIndex']);
    if (entry.id !== `fitness-contract-${index + 1}`) fail(`${path}.id`, 'must retain career-wide sequential appointment identities');
    const coach = DEVELOPMENT_FITNESS_COACHES.find(coach => coach.id === entry.coachId);
    if (!coach || typeof entry.clubId !== 'string' || !fees.has(entry.clubId)) fail(path, 'must identify a catalog fitness coach and club');
    const year = number(entry.seasonNumber, `${path}.seasonNumber`, firstYear, state.seasonNumber);
    const round = number(entry.startedRound, `${path}.startedRound`, year === firstYear ? firstRound : 1, year === state.seasonNumber ? Math.min(9, state.round) : 9);
    if (year * 10 + round < previousBoundary) fail(path, 'must retain chronological appointment order');
    previousBoundary = year * 10 + round;
    const hired = number(entry.hiredLedgerIndex, `${path}.hiredLedgerIndex`, previousLedger + 1, ledger.length - 1);
    previousLedger = hired;
    validateLedgerBoundary(ledger, hired, year, round, `${path}.hiredLedgerIndex`);
    const charged = ledger[hired];
    if (!charged || charged.kind !== 'fitness' || charged.clubId !== entry.clubId || charged.seasonNumber !== year || charged.round !== round || charged.sourceId !== `fitness-${entry.id}`) fail(path, 'must be followed immediately by its actual appointment fee');
    if (typeof entry.renew !== 'boolean') fail(`${path}.renew`, 'must be boolean');
    if (entry.releasedRound === null) {
      if (entry.releasedLedgerIndex !== null) fail(`${path}.releasedLedgerIndex`, 'must be empty for an unreleased appointment');
    } else {
      const releasedRound = number(entry.releasedRound, `${path}.releasedRound`, round, year === state.seasonNumber ? state.round : 10);
      const released = number(entry.releasedLedgerIndex, `${path}.releasedLedgerIndex`, hired + 1, ledger.length);
      validateLedgerBoundary(ledger, released, year, releasedRound, `${path}.releasedLedgerIndex`);
    }
    const active = contracts.filter(contract => contract.seasonNumber === year && (contract.releasedLedgerIndex === null || contract.releasedLedgerIndex > hired));
    if (active.some(contract => contract.coachId === coach.id)) fail(path, 'cannot appoint a fitness coach already employed at this ledger boundary');
    if (active.filter(contract => contract.clubId === entry.clubId).length >= 1) fail(path, 'exceeds the one-fitness-coach staff limit at this appointment');
    if (year === state.seasonNumber) {
      const total = fees.get(entry.clubId)! + coach.fee;
      if (total > STAFF_BUDGET) fail(path, 'exceeds the shared annual staff allocation including released appointments');
      fees.set(entry.clubId, total);
    }
    contracts.push(entry as unknown as FitnessContract);
  }
  return fields as unknown as SeasonFitness;
}

/** Physio appointments retain their source fees independently of later rehabilitation. */
function validatePhysio(value: unknown, state: SeasonState, coaching: SeasonCoaching, scouts: SeasonScouts, fitness: SeasonFitness): SeasonPhysio {
  const fields = record(value, 'physio', ['model', 'enabledSince', 'contracts', 'rehabilitation']);
  if (fields.model !== 'physio-1' || !Array.isArray(fields.contracts) || fields.contracts.length > 20_000) fail('physio', 'must retain a supported bounded appointment history');
  if (fields.enabledSince === null) {
    if (!sameData(fields, createPhysio())) fail('physio', 'must retain its empty default while recruitment is disabled');
    return fields as unknown as SeasonPhysio;
  }
  const ledger = state.finance.ledger;
  if (!Array.isArray(ledger) || !state.finance.enabledSince) fail('physio.enabledSince', 'requires active finances');
  const anchor = record(fields.enabledSince, 'physio.enabledSince', ['seasonNumber', 'round', 'ledgerIndex']);
  const firstYear = number(anchor.seasonNumber, 'physio.enabledSince.seasonNumber', 1, state.seasonNumber);
  const firstRound = number(anchor.round, 'physio.enabledSince.round', 1, firstYear === state.seasonNumber ? Math.min(9, state.round) : 9);
  const firstLedger = number(anchor.ledgerIndex, 'physio.enabledSince.ledgerIndex', 0, ledger.length);
  const firstBoundary = firstYear * 10 + firstRound;
  if ([state.finance.enabledSince].some(enabled => enabled.seasonNumber * 10 + enabled.round > firstBoundary)) fail('physio.enabledSince', 'cannot precede finances activation');
  validateLedgerBoundary(ledger, firstLedger, firstYear, firstRound, 'physio.enabledSince.ledgerIndex');
  const contracts: PhysioContract[] = [];
  let previousLedger = firstLedger - 1, previousBoundary = firstBoundary;
  const fees = new Map(state.clubs.map(club => [club.id, coaching.contracts.filter(contract => contract.clubId === club.id).reduce((sum, contract) => sum + DEVELOPMENT_COACHES.find(coach => coach.id === contract.coachId)!.fee, 0) + scouts.contracts.filter(contract => contract.clubId === club.id && contract.seasonNumber === state.seasonNumber).reduce((sum, contract) => sum + DEVELOPMENT_SCOUTS.find(scout => scout.id === contract.scoutId)!.fee, 0) + fitness.contracts.filter(contract => contract.clubId === club.id && contract.seasonNumber === state.seasonNumber).reduce((sum, contract) => sum + DEVELOPMENT_FITNESS_COACHES.find(coach => coach.id === contract.coachId)!.fee, 0)]));
  for (const [index, value] of fields.contracts.entries()) {
    const path = `physio.contracts[${index}]`;
    const entry = record(value, path, ['id', 'physioId', 'clubId', 'seasonNumber', 'startedRound', 'releasedRound', 'renew', 'hiredLedgerIndex', 'releasedLedgerIndex']);
    if (entry.id !== `physio-contract-${index + 1}`) fail(`${path}.id`, 'must retain career-wide sequential appointment identities');
    const coach = DEVELOPMENT_PHYSIOS.find(coach => coach.id === entry.physioId);
    if (!coach || typeof entry.clubId !== 'string' || !fees.has(entry.clubId)) fail(path, 'must identify a catalog physiotherapist and club');
    const year = number(entry.seasonNumber, `${path}.seasonNumber`, firstYear, state.seasonNumber);
    const round = number(entry.startedRound, `${path}.startedRound`, year === firstYear ? firstRound : 1, year === state.seasonNumber ? Math.min(9, state.round) : 9);
    if (year * 10 + round < previousBoundary) fail(path, 'must retain chronological appointment order');
    previousBoundary = year * 10 + round;
    const hired = number(entry.hiredLedgerIndex, `${path}.hiredLedgerIndex`, previousLedger + 1, ledger.length - 1);
    previousLedger = hired;
    validateLedgerBoundary(ledger, hired, year, round, `${path}.hiredLedgerIndex`);
    const charged = ledger[hired];
    if (!charged || charged.kind !== 'physio' || charged.clubId !== entry.clubId || charged.seasonNumber !== year || charged.round !== round || charged.sourceId !== `physio-${entry.id}`) fail(path, 'must be followed immediately by its actual appointment fee');
    if (typeof entry.renew !== 'boolean') fail(`${path}.renew`, 'must be boolean');
    if (entry.releasedRound === null) {
      if (entry.releasedLedgerIndex !== null) fail(`${path}.releasedLedgerIndex`, 'must be empty for an unreleased appointment');
    } else {
      const releasedRound = number(entry.releasedRound, `${path}.releasedRound`, round, year === state.seasonNumber ? state.round : 10);
      const released = number(entry.releasedLedgerIndex, `${path}.releasedLedgerIndex`, hired + 1, ledger.length);
      validateLedgerBoundary(ledger, released, year, releasedRound, `${path}.releasedLedgerIndex`);
    }
    const active = contracts.filter(contract => contract.seasonNumber === year && (contract.releasedLedgerIndex === null || contract.releasedLedgerIndex > hired));
    if (active.some(contract => contract.physioId === coach.id)) fail(path, 'cannot appoint a physiotherapist already employed at this ledger boundary');
    if (active.filter(contract => contract.clubId === entry.clubId).length >= 1) fail(path, 'exceeds the one-physio staff limit at this appointment');
    if (year === state.seasonNumber) {
      const total = fees.get(entry.clubId)! + coach.fee;
      if (total > STAFF_BUDGET) fail(path, 'exceeds the shared annual staff allocation including released appointments');
      fees.set(entry.clubId, total);
    }
    contracts.push(entry as unknown as PhysioContract);
  }
  return fields as unknown as SeasonPhysio;
}

/** Paid assistants retain career appointments independently of derived advice. */
function validateAssistant(value: unknown, state: SeasonState, coaching: SeasonCoaching, scouts: SeasonScouts, fitness: SeasonFitness, physio: SeasonPhysio): SeasonAssistant {
  const fields = record(value, 'assistant', ['model', 'enabledSince', 'contracts']);
  if (fields.model !== 'assistant-1' || !Array.isArray(fields.contracts) || fields.contracts.length > 20_000) fail('assistant', 'must retain a supported bounded appointment history');
  if (fields.enabledSince === null) {
    if (!sameData(fields, createAssistant())) fail('assistant', 'must retain its empty default while recruitment is disabled');
    return fields as unknown as SeasonAssistant;
  }
  const ledger = state.finance.ledger;
  if (!Array.isArray(ledger) || !state.finance.enabledSince) fail('assistant.enabledSince', 'requires active finances');
  const anchor = record(fields.enabledSince, 'assistant.enabledSince', ['seasonNumber', 'round', 'ledgerIndex']);
  const firstYear = number(anchor.seasonNumber, 'assistant.enabledSince.seasonNumber', 1, state.seasonNumber);
  const firstRound = number(anchor.round, 'assistant.enabledSince.round', 1, firstYear === state.seasonNumber ? state.round : 10);
  const firstLedger = number(anchor.ledgerIndex, 'assistant.enabledSince.ledgerIndex', 0, ledger.length);
  const firstBoundary = firstYear * 10 + firstRound;
  if ([state.finance.enabledSince].some(enabled => enabled.seasonNumber * 10 + enabled.round > firstBoundary)) fail('assistant.enabledSince', 'cannot precede finances activation');
  validateLedgerBoundary(ledger, firstLedger, firstYear, firstRound, 'assistant.enabledSince.ledgerIndex');
  const finalRoundCommitted = (year: number, index: number) => ledger.slice(0, index).some(entry => entry.seasonNumber === year && entry.round === 10 && (entry.kind === 'tickets' || entry.kind === 'operations' || entry.kind === 'payroll' && entry.payroll?.type === 'installment'));
  if (firstRound === 10 && finalRoundCommitted(firstYear, firstLedger)) fail('assistant.enabledSince', 'must precede the final matchday financial commit');
  const contracts: AssistantContract[] = [];
  let previousLedger = firstLedger - 1, previousBoundary = firstBoundary;
  const fees = new Map(state.clubs.map(club => [club.id, coaching.contracts.filter(contract => contract.clubId === club.id).reduce((sum, contract) => sum + DEVELOPMENT_COACHES.find(coach => coach.id === contract.coachId)!.fee, 0) + scouts.contracts.filter(contract => contract.clubId === club.id && contract.seasonNumber === state.seasonNumber).reduce((sum, contract) => sum + DEVELOPMENT_SCOUTS.find(scout => scout.id === contract.scoutId)!.fee, 0) + fitness.contracts.filter(contract => contract.clubId === club.id && contract.seasonNumber === state.seasonNumber).reduce((sum, contract) => sum + DEVELOPMENT_FITNESS_COACHES.find(coach => coach.id === contract.coachId)!.fee, 0) + physio.contracts.filter(contract => contract.clubId === club.id && contract.seasonNumber === state.seasonNumber).reduce((sum, contract) => sum + DEVELOPMENT_PHYSIOS.find(staff => staff.id === contract.physioId)!.fee, 0)]));
  for (const [index, value] of fields.contracts.entries()) {
    const path = `assistant.contracts[${index}]`;
    const entry = record(value, path, ['id', 'assistantId', 'clubId', 'seasonNumber', 'startedRound', 'releasedRound', 'renew', 'hiredLedgerIndex', 'releasedLedgerIndex']);
    if (entry.id !== `assistant-contract-${index + 1}`) fail(`${path}.id`, 'must retain career-wide sequential appointment identities');
    const coach = DEVELOPMENT_ASSISTANTS.find(coach => coach.id === entry.assistantId);
    if (!coach || typeof entry.clubId !== 'string' || !fees.has(entry.clubId)) fail(path, 'must identify a catalog assistant coach and club');
    const year = number(entry.seasonNumber, `${path}.seasonNumber`, firstYear, state.seasonNumber);
    const round = number(entry.startedRound, `${path}.startedRound`, year === firstYear ? firstRound : 1, year === state.seasonNumber ? state.round : 10);
    if (year * 10 + round < previousBoundary) fail(path, 'must retain chronological appointment order');
    previousBoundary = year * 10 + round;
    const hired = number(entry.hiredLedgerIndex, `${path}.hiredLedgerIndex`, previousLedger + 1, ledger.length - 1);
    previousLedger = hired;
    validateLedgerBoundary(ledger, hired, year, round, `${path}.hiredLedgerIndex`);
    const charged = ledger[hired];
    if (!charged || charged.kind !== 'assistant' || charged.clubId !== entry.clubId || charged.seasonNumber !== year || charged.round !== round || charged.sourceId !== `assistant-${entry.id}`) fail(path, 'must be followed immediately by its actual appointment fee');
    if (round === 10 && finalRoundCommitted(year, hired)) fail(path, 'cannot appoint an assistant after the final matchday financial commit');
    if (typeof entry.renew !== 'boolean') fail(`${path}.renew`, 'must be boolean');
    if (entry.releasedRound === null) {
      if (entry.releasedLedgerIndex !== null) fail(`${path}.releasedLedgerIndex`, 'must be empty for an unreleased appointment');
    } else {
      const releasedRound = number(entry.releasedRound, `${path}.releasedRound`, round, year === state.seasonNumber ? state.round : 10);
      const released = number(entry.releasedLedgerIndex, `${path}.releasedLedgerIndex`, hired + 1, ledger.length);
      validateLedgerBoundary(ledger, released, year, releasedRound, `${path}.releasedLedgerIndex`);
    }
    const active = contracts.filter(contract => contract.seasonNumber === year && (contract.releasedLedgerIndex === null || contract.releasedLedgerIndex > hired));
    if (active.some(contract => contract.assistantId === coach.id)) fail(path, 'cannot appoint an assistant coach already employed at this ledger boundary');
    if (active.filter(contract => contract.clubId === entry.clubId).length >= 1) fail(path, 'exceeds the one-assistant staff limit at this appointment');
    if (year === state.seasonNumber) {
      const total = fees.get(entry.clubId)! + coach.fee;
      if (total > STAFF_BUDGET) fail(path, 'exceeds the shared annual staff allocation including released appointments');
      fees.set(entry.clubId, total);
    }
    contracts.push(entry as unknown as AssistantContract);
  }
  return fields as unknown as SeasonAssistant;
}

/** Youth coaches retain paid appointments independently of prospect development. */
function validateYouth(value: unknown, state: SeasonState, coaching: SeasonCoaching, scouts: SeasonScouts, fitness: SeasonFitness, physio: SeasonPhysio, assistant: SeasonAssistant): SeasonYouth {
  const fields = record(value, 'youth', ['model', 'enabledSince', 'contracts']);
  if (fields.model !== 'youth-1' || !Array.isArray(fields.contracts) || fields.contracts.length > 20_000) fail('youth', 'must retain a supported bounded appointment history');
  if (fields.enabledSince === null) {
    if (!sameData(fields, createYouth())) fail('youth', 'must retain its empty default while recruitment is disabled');
    return fields as unknown as SeasonYouth;
  }
  const ledger = state.finance.ledger;
  if (!Array.isArray(ledger) || !state.finance.enabledSince || !state.academy.enabledSince) fail('youth.enabledSince', 'requires active finances and academy development');
  const anchor = record(fields.enabledSince, 'youth.enabledSince', ['seasonNumber', 'round', 'ledgerIndex']);
  const firstYear = number(anchor.seasonNumber, 'youth.enabledSince.seasonNumber', 1, state.seasonNumber);
  const firstRound = number(anchor.round, 'youth.enabledSince.round', 1, firstYear === state.seasonNumber ? Math.min(state.round, 9) : 9);
  const firstLedger = number(anchor.ledgerIndex, 'youth.enabledSince.ledgerIndex', 0, ledger.length);
  const firstBoundary = firstYear * 10 + firstRound;
  if ([state.finance.enabledSince, state.academy.enabledSince].some(enabled => enabled.seasonNumber * 10 + enabled.round > firstBoundary)) fail('youth.enabledSince', 'cannot precede finances or academy activation');
  if (state.academy.enabledSince.seasonNumber * 10 + state.academy.enabledSince.round === firstBoundary && firstLedger < state.academy.enabledSince.ledgerIndex) fail('youth.enabledSince.ledgerIndex', 'cannot precede academy activation within the same matchday');
  validateLedgerBoundary(ledger, firstLedger, firstYear, firstRound, 'youth.enabledSince.ledgerIndex');
  const contracts: YouthCoachContract[] = [];
  let previousLedger = firstLedger - 1, previousBoundary = firstBoundary;
  const fees = new Map(state.clubs.map(club => [club.id, coaching.contracts.filter(contract => contract.clubId === club.id).reduce((sum, contract) => sum + DEVELOPMENT_COACHES.find(coach => coach.id === contract.coachId)!.fee, 0) + scouts.contracts.filter(contract => contract.clubId === club.id && contract.seasonNumber === state.seasonNumber).reduce((sum, contract) => sum + DEVELOPMENT_SCOUTS.find(scout => scout.id === contract.scoutId)!.fee, 0) + fitness.contracts.filter(contract => contract.clubId === club.id && contract.seasonNumber === state.seasonNumber).reduce((sum, contract) => sum + DEVELOPMENT_FITNESS_COACHES.find(coach => coach.id === contract.coachId)!.fee, 0) + physio.contracts.filter(contract => contract.clubId === club.id && contract.seasonNumber === state.seasonNumber).reduce((sum, contract) => sum + DEVELOPMENT_PHYSIOS.find(staff => staff.id === contract.physioId)!.fee, 0) + assistant.contracts.filter(contract => contract.clubId === club.id && contract.seasonNumber === state.seasonNumber).reduce((sum, contract) => sum + DEVELOPMENT_ASSISTANTS.find(staff => staff.id === contract.assistantId)!.fee, 0)]));
  for (const [index, value] of fields.contracts.entries()) {
    const path = `youth.contracts[${index}]`;
    const entry = record(value, path, ['id', 'coachId', 'clubId', 'seasonNumber', 'startedRound', 'releasedRound', 'renew', 'hiredLedgerIndex', 'releasedLedgerIndex']);
    if (entry.id !== `youth-contract-${index + 1}`) fail(`${path}.id`, 'must retain career-wide sequential appointment identities');
    const coach = DEVELOPMENT_YOUTH_COACHES.find(coach => coach.id === entry.coachId);
    if (!coach || typeof entry.clubId !== 'string' || !fees.has(entry.clubId)) fail(path, 'must identify a catalog youth coach and club');
    const year = number(entry.seasonNumber, `${path}.seasonNumber`, firstYear, state.seasonNumber);
    const round = number(entry.startedRound, `${path}.startedRound`, year === firstYear ? firstRound : 1, year === state.seasonNumber ? Math.min(state.round, 9) : 9);
    if (year * 10 + round < previousBoundary) fail(path, 'must retain chronological appointment order');
    previousBoundary = year * 10 + round;
    const hired = number(entry.hiredLedgerIndex, `${path}.hiredLedgerIndex`, previousLedger + 1, ledger.length - 1);
    previousLedger = hired;
    validateLedgerBoundary(ledger, hired, year, round, `${path}.hiredLedgerIndex`);
    const charged = ledger[hired];
    if (!charged || charged.kind !== 'youth' || charged.clubId !== entry.clubId || charged.seasonNumber !== year || charged.round !== round || charged.sourceId !== `youth-${entry.id}`) fail(path, 'must be followed immediately by its actual appointment fee');
    if (typeof entry.renew !== 'boolean') fail(`${path}.renew`, 'must be boolean');
    if (entry.releasedRound === null) {
      if (entry.releasedLedgerIndex !== null) fail(`${path}.releasedLedgerIndex`, 'must be empty for an unreleased appointment');
    } else {
      const releasedRound = number(entry.releasedRound, `${path}.releasedRound`, round, year === state.seasonNumber ? state.round : 10);
      const released = number(entry.releasedLedgerIndex, `${path}.releasedLedgerIndex`, hired + 1, ledger.length);
      validateLedgerBoundary(ledger, released, year, releasedRound, `${path}.releasedLedgerIndex`);
    }
    const active = contracts.filter(contract => contract.seasonNumber === year && (contract.releasedLedgerIndex === null || contract.releasedLedgerIndex > hired));
    if (active.some(contract => contract.coachId === coach.id)) fail(path, 'cannot appoint an youth coach already employed at this ledger boundary');
    if (active.filter(contract => contract.clubId === entry.clubId).length >= 1) fail(path, 'exceeds the one-youth staff limit at this appointment');
    if (year === state.seasonNumber) {
      const total = fees.get(entry.clubId)! + coach.fee;
      if (total > STAFF_BUDGET) fail(path, 'exceeds the shared annual staff allocation including released appointments');
      fees.set(entry.clubId, total);
    }
    contracts.push(entry as unknown as YouthCoachContract);
  }
  return fields as unknown as SeasonYouth;
}

/** Check the bounded registry before any generated identity reaches senior validation. */
function validateAcademyShape(value: unknown, state: SeasonState, version: number): SeasonAcademy {
  const fields = record(value, 'academy', ['model', 'enabledSince', 'prospects', 'intakes', 'focus', 'points', 'weeks', 'graduates']);
  if (fields.model !== 'academy-1') fail('academy.model', 'must use the supported prospect model');
  for (const key of ['prospects', 'intakes', 'weeks', 'graduates'] as const) if (!Array.isArray(fields[key]) || fields[key].length > 20_000) fail(`academy.${key}`, 'must retain a bounded history');
  if (fields.enabledSince === null) {
    if (!sameData(fields, createAcademy())) fail('academy', 'must retain its empty default while disabled');
    return fields as unknown as SeasonAcademy;
  }
  const anchor = record(fields.enabledSince, 'academy.enabledSince', ['seasonNumber', 'round', 'ledgerIndex', 'contractCount', 'negotiationCount']);
  const year = number(anchor.seasonNumber, 'academy.enabledSince.seasonNumber', 1, state.seasonNumber);
  const round = number(anchor.round, 'academy.enabledSince.round', 1, year === state.seasonNumber ? Math.min(state.round, 9) : 9);
  const ledger = number(anchor.ledgerIndex, 'academy.enabledSince.ledgerIndex', 0, state.finance.ledger.length);
  number(anchor.contractCount, 'academy.enabledSince.contractCount', 0, state.employment.contracts.length);
  number(anchor.negotiationCount, 'academy.enabledSince.negotiationCount', 0, state.negotiations.records.length);
  validateLedgerBoundary(state.finance.ledger, ledger, year, round, 'academy.enabledSince.ledgerIndex');
  const identities = new Set<string>();
  for (const [index, item] of (fields.prospects as unknown[]).entries()) {
    const path = `academy.prospects[${index}]`;
    const prospect = record(item, path, ['player', 'dateOfBirth', 'seasonWage', 'clubId', 'intakeSeason', 'intakeRound']);
    const player = record(prospect.player, `${path}.player`, ['id', 'name', 'number', 'position', 'heightCm', 'weightKg', 'skinTone', 'hairColor', 'attributes']);
    if (typeof player.id !== 'string' || identities.has(player.id) || DEVELOPMENT_CLUBS.some(club => club.players.some(original => original.id === player.id))) fail(`${path}.player.id`, 'must identify a unique prospect outside the original player catalog');
    identities.add(player.id);
    record(player.attributes, `${path}.player.attributes`, TRAINING_ATTRIBUTES);
  }
  for (const [index, item] of (fields.intakes as unknown[]).entries()) record(item, `academy.intakes[${index}]`, ['id', 'clubId', 'seasonNumber', 'round', 'date', 'initial', 'prospectIds', ...(version >= 27 && item !== null && typeof item === 'object' && Object.hasOwn(item, 'source') ? ['source'] : [])]);
  for (const [index, item] of (fields.weeks as unknown[]).entries()) record(item, `academy.weeks[${index}]`, ['id', 'seasonNumber', 'afterRound', 'fromDate', 'toDate', 'coaches', 'players']);
  for (const [index, item] of (fields.graduates as unknown[]).entries()) {
    const path = `academy.graduates[${index}]`;
    const graduate = record(item, path, ['id', 'prospectId', 'player', 'dateOfBirth', 'seasonWage', 'clubId', 'availableSince', 'graduatedOn', 'kind', 'sourcePoints', 'offerId', 'contractId', ...(version >= 27 && item !== null && typeof item === 'object' && Object.hasOwn(item, 'condition') ? ['condition'] : [])]);
    record(graduate.availableSince, `${path}.availableSince`, ['seasonNumber', 'round']);
    record(graduate.player, `${path}.player`, ['id', 'name', 'number', 'position', 'heightCm', 'weightKg', 'skinTone', 'hairColor', 'attributes']);
    record(graduate.sourcePoints, `${path}.sourcePoints`, TRAINING_ATTRIBUTES);
  }
  return fields as unknown as SeasonAcademy;
}

/** A separate prospective competition; disabled imports contain no fabricated youth history. */
function validateYouthCompetitionShape(value: unknown, state: SeasonState): SeasonYouthCompetition {
  const fields = record(value, 'youthCompetition', ['model', 'enabledSince', 'seasons']);
  if (fields.model !== 'youth-competition-1' || !Array.isArray(fields.seasons) || fields.seasons.length > MAX_SEASON_NUMBER) fail('youthCompetition', 'must retain a supported bounded competition history');
  if (fields.enabledSince === null) {
    if (!sameData(fields, createYouthCompetition())) fail('youthCompetition', 'must retain its empty default while disabled');
    return fields as unknown as SeasonYouthCompetition;
  }
  const anchor = record(fields.enabledSince, 'youthCompetition.enabledSince', ['seasonNumber', 'round', 'date', 'ledgerIndex', 'contractCount', 'negotiationCount', 'recruitmentEventCount', 'academyIntakeCount', 'academyGraduateCount']);
  const firstYear = number(anchor.seasonNumber, 'youthCompetition.enabledSince.seasonNumber', 1, state.seasonNumber);
  const firstRound = number(anchor.round, 'youthCompetition.enabledSince.round', 1, firstYear === state.seasonNumber ? state.round : 10);
  if (anchor.date !== dateForRound(firstRound, firstYear)) fail('youthCompetition.enabledSince.date', 'must identify its actual active matchday');
  number(anchor.ledgerIndex, 'youthCompetition.enabledSince.ledgerIndex', 0, state.finance.ledger.length);
  number(anchor.contractCount, 'youthCompetition.enabledSince.contractCount', 0, state.employment.contracts.length);
  number(anchor.negotiationCount, 'youthCompetition.enabledSince.negotiationCount', 0, state.negotiations.records.length);
  number(anchor.recruitmentEventCount, 'youthCompetition.enabledSince.recruitmentEventCount', 0, state.recruitment.events.length);
  number(anchor.academyIntakeCount, 'youthCompetition.enabledSince.academyIntakeCount', 0, state.academy.intakes.length);
  number(anchor.academyGraduateCount, 'youthCompetition.enabledSince.academyGraduateCount', 0, state.academy.graduates.length);
  if (fields.seasons.length !== state.seasonNumber - firstYear + 1) fail('youthCompetition.seasons', 'must retain the activation season and every later season exactly once');
  for (const [index, item] of fields.seasons.entries()) {
    const path = `youthCompetition.seasons[${index}]`, year = firstYear + index, fromRound = index === 0 ? firstRound : 1;
    const season = record(item, path, ['seasonNumber', 'fromRound', 'preparedOn', 'supplementalIntakeIds', 'fixtures']);
    if (season.seasonNumber !== year || season.fromRound !== fromRound || season.preparedOn !== dateForRound(fromRound, year)) fail(path, 'must retain the chronological competition preparation boundary');
    if (!Array.isArray(season.supplementalIntakeIds) || season.supplementalIntakeIds.length > state.clubs.length) fail(`${path}.supplementalIntakeIds`, 'must retain at most one supplemental intake per club');
    const fixtures = array(season.fixtures, `${path}.fixtures`, (11 - fromRound) * 3);
    for (const [fixtureIndex, value] of fixtures.entries()) {
      const fixturePath = `${path}.fixtures[${fixtureIndex}]`;
      const fixture = record(value, fixturePath, ['id', 'seasonNumber', 'round', 'date', 'homeClubId', 'awayClubId', 'home', 'away', 'startingConditions', 'result']);
      if (fixture.result === null) {
        if (fixture.home !== null || fixture.away !== null || fixture.startingConditions !== null) fail(fixturePath, 'cannot retain a frozen squad or condition before settlement');
      } else {
        record(fixture.result, `${fixturePath}.result`, ['kind', 'played', 'score', 'officialScore', 'winnerClubId', 'periods', 'stats', 'injuries', 'reason']);
      }
    }
  }
  return fields as unknown as SeasonYouthCompetition;
}

/** Replay fixed inputs and result accounting without replaying thousands of historical possessions. */
function replayYouthRound(replay: SeasonState, original: SeasonState): SeasonState {
  if (!replay.youthCompetition.enabledSince) return replay;
  const season = replay.youthCompetition.seasons.find(item => item.seasonNumber === replay.seasonNumber)!;
  const saved = original.youthCompetition.seasons.find(item => item.seasonNumber === replay.seasonNumber);
  if (!saved) fail('youthCompetition.seasons', 'must retain every prepared season');
  const settlements = new Map<string, YouthFixture>();
  for (const fixture of season.fixtures.filter(item => item.round === replay.round)) {
    const path = `youthCompetition.${fixture.id}`, stored = saved.fixtures.find(item => item.id === fixture.id);
    if (!stored?.result) fail(path, 'must retain its completed matchday result');
    const prepared = prepareYouthFixture(replay, fixture);
    if (!sameData({ ...fixture, home: prepared.home, away: prepared.away, startingConditions: prepared.startingConditions, result: stored.result }, stored)) fail(path, 'must preserve its exact calendar, academy membership, development and starting condition');
    const result = stored.result;
    if (prepared.lineups.home.length < 5 || prepared.lineups.away.length < 5) {
      if (!sameData(settleYouthFixture(replay, fixture), stored)) fail(`${path}.result`, 'must retain the canonical unplayed forfeit or no-contest without invented statistics');
    } else {
      if (result.played !== true || !['played', 'default'].includes(result.kind)) fail(`${path}.result`, 'must retain an actual played result for two eligible starting teams');
      if (result.reason !== (result.kind === 'default' ? 'The match ended after a team had fewer than two eligible players.' : null)) fail(`${path}.result.reason`, 'must describe only the supported match outcome');
      if (!Array.isArray(result.injuries) || result.injuries.length > prepared.home.players.length + prepared.away.players.length) fail(`${path}.result.injuries`, 'must retain bounded new diagnoses');
      const injuryMap = { ...prepared.unavailable }, diagnosed = new Set<string>();
      for (const [index, value] of result.injuries.entries()) {
        const injuryPath = `${path}.result.injuries[${index}]`;
        const injury = record(value, injuryPath, ['id', 'playerId', 'clubId', 'kind', 'fixtureId', 'occurredOn', 'returnOn']);
        const club = [prepared.home, prepared.away].find(team => team.players.some(player => player.id === injury.playerId));
        if (!club || !['ankle', 'muscle'].includes(injury.kind as string) || diagnosed.has(injury.playerId as string) || Object.hasOwn(prepared.unavailable, injury.playerId as string) || replay.injuryMode === 'off') fail(injuryPath, 'must identify one new supported diagnosis for an available participant');
        const expected = createSeasonInjury(replay.seed, fixture, club.id, injury.playerId as string, injury.kind as SeasonInjury['kind']);
        if (!sameData(injury, expected)) fail(injuryPath, 'must preserve the original deterministic diagnosis and return date');
        diagnosed.add(injury.playerId as string);
        injuryMap[injury.playerId as string] = injury.kind as SeasonInjury['kind'];
      }
      validateResult({ score: result.score, officialScore: result.officialScore, winnerClubId: result.winnerClubId, kind: result.kind === 'played' ? 'normal' : 'default', periods: result.periods, stats: result.stats, injuries: injuryMap }, `${path}.result`, prepared.home, prepared.away, false);
      for (const id of Object.keys(prepared.unavailable)) requireNoPlay(result.stats[id]!, `${path}.result.stats.${id}`);
      for (const id of diagnosed) if (result.stats[id]!.secondsPlayed === 0) fail(`${path}.result.injuries`, 'requires actual exposure before a new diagnosis');
    }
    settlements.set(fixture.id, stored);
  }
  return { ...replay, youthCompetition: { ...replay.youthCompetition, seasons: replay.youthCompetition.seasons.map(item => item === season ? { ...item, fixtures: item.fixtures.map(fixture => settlements.get(fixture.id) ?? fixture) } : item) } };
}

/** Activation prefixes keep supplemental identities out of commands issued earlier the same day. */
function activateYouthReplay(replay: SeasonState, original: SeasonState): SeasonState {
  const anchor = original.youthCompetition.enabledSince;
  if (!anchor || anchor.seasonNumber !== replay.seasonNumber || anchor.round !== replay.round) return replay;
  const path = 'youthCompetition.enabledSince', boundary = anchor.seasonNumber * 10 + anchor.round;
  const academy = original.academy.enabledSince!;
  if (!academy || academy.seasonNumber * 10 + academy.round > boundary || academy.seasonNumber * 10 + academy.round === boundary && (academy.ledgerIndex > anchor.ledgerIndex || academy.contractCount > anchor.contractCount || academy.negotiationCount > anchor.negotiationCount)) fail(path, 'requires the academy already active at its exact source boundary');
  validateLedgerBoundary(original.finance.ledger, anchor.ledgerIndex, anchor.seasonNumber, anchor.round, `${path}.ledgerIndex`);
  const contracts = original.employment.contracts.slice(0, anchor.contractCount), replies = original.negotiations.records.slice(0, anchor.negotiationCount), events = original.recruitment.events.slice(0, anchor.recruitmentEventCount);
  if (anchor.contractCount !== original.negotiations.enabledSince!.contractCount + replies.filter(reply => reply.outcome === 'accepted').length) fail(`${path}.contractCount`, 'must retain the agreements explained by its exact response prefix');
  for (const [index, contract] of original.employment.contracts.entries()) if (index < anchor.contractCount ? contract.signedSeason * 10 + contract.signedRound > boundary : contract.signedSeason * 10 + contract.signedRound < boundary) fail(`${path}.contractCount`, 'must identify a chronological agreement prefix');
  for (const [index, reply] of original.negotiations.records.entries()) if (index < anchor.negotiationCount ? reply.seasonNumber * 10 + reply.round > boundary : reply.seasonNumber * 10 + reply.round < boundary) fail(`${path}.negotiationCount`, 'must identify a chronological response prefix');
  for (const [index, event] of original.recruitment.events.entries()) if (index < anchor.recruitmentEventCount ? event.seasonNumber * 10 + event.round > boundary : event.seasonNumber * 10 + event.round < boundary) fail(`${path}.recruitmentEventCount`, 'must identify a chronological recruitment prefix');
  const enabled = enableYouthCompetition({ ...replay, finance: { ...original.finance, ledger: original.finance.ledger.slice(0, anchor.ledgerIndex) }, employment: { ...original.employment, contracts }, negotiations: { ...original.negotiations, records: replies }, recruitment: { ...original.recruitment, events } });
  if (!sameData(enabled.youthCompetition.enabledSince, anchor)) fail(path, 'must preserve the exact pre-supplement intake, graduation and command boundaries');
  return enabled;
}

/** Reproduce intake, every completed youth week and each permanent senior graduation. */
function validateAcademyHistory(state: SeasonState): void {
  const academy = state.academy, anchor = academy.enabledSince;
  if (!anchor) {
    if (state.youthCompetition.enabledSince) fail('youthCompetition.enabledSince', 'requires an active academy');
    return;
  }
  const boundary = anchor.seasonNumber * 10 + anchor.round;
  const requirements = [state.finance.enabledSince, state.payroll.enabledSince, state.employment.enabledSince, state.negotiations.enabledSince, state.recruitment.enabledSince];
  if (requirements.some(item => !item || item.seasonNumber * 10 + item.round > boundary)) fail('academy.enabledSince', 'requires finances, payroll, employment, negotiations and in-season recruitment already active');
  for (const item of [state.payroll.enabledSince, state.recruitment.enabledSince]) if (item && item.seasonNumber * 10 + item.round === boundary && item.ledgerIndex > anchor.ledgerIndex) fail('academy.enabledSince.ledgerIndex', 'cannot precede required payroll or recruitment activation within the same matchday');
  const originalIds = new Set(DEVELOPMENT_CLUBS.flatMap(club => club.players.map(player => player.id)));
  const prospects = new Map(academy.prospects.map(prospect => [prospect.player.id, prospect]));
  const focus = record(academy.focus, 'academy.focus', [...prospects.keys()]);
  record(academy.points, 'academy.points', [...prospects.keys()]);
  for (const [id, value] of Object.entries(focus)) if (!TRAINING_FOCUSES.includes(value as TrainingPlan['focus']) || prospects.get(id)!.clubId !== state.managedClubId && value !== 'balanced') fail(`academy.focus.${id}`, 'must retain a supported manager instruction or the automatic club focus');
  const firstContracts = state.employment.contracts.slice(0, anchor.contractCount), firstReplies = state.negotiations.records.slice(0, anchor.negotiationCount);
  if (anchor.contractCount !== state.negotiations.enabledSince!.contractCount + firstReplies.filter(reply => reply.outcome === 'accepted').length) fail('academy.enabledSince.contractCount', 'must identify the exact agreements explained by the response prefix');
  for (const [index, contract] of state.employment.contracts.entries()) if (index < anchor.contractCount ? contract.signedSeason * 10 + contract.signedRound > boundary : contract.signedSeason * 10 + contract.signedRound < boundary) fail('academy.enabledSince.contractCount', 'must identify a chronological employment prefix');
  for (const [index, reply] of state.negotiations.records.entries()) if (index < anchor.negotiationCount ? reply.seasonNumber * 10 + reply.round > boundary : reply.seasonNumber * 10 + reply.round < boundary) fail('academy.enabledSince.negotiationCount', 'must identify a chronological response prefix');
  let replay: SeasonState = {
    ...state, academy: createAcademy(), youthCompetition: createYouthCompetition(), seasonNumber: anchor.seasonNumber, round: anchor.round, date: dateForRound(anchor.round, anchor.seasonNumber), status: 'active',
    finance: { ...state.finance, ledger: state.finance.ledger.slice(0, anchor.ledgerIndex) }, employment: { ...state.employment, contracts: firstContracts }, negotiations: { ...state.negotiations, records: firstReplies },
    conditions: Object.fromEntries(Object.entries(state.conditions).filter(([id]) => originalIds.has(id))),
    training: { ...state.training, points: Object.fromEntries(Object.entries(state.training.points).filter(([id]) => originalIds.has(id))) },
  };
  try { replay = enableAcademy(replay); }
  catch (error) { fail('academy.enabledSince', `cannot initialize its recorded intake: ${error instanceof Error ? error.message : 'invalid activation'}`); }
  replay = activateYouthReplay(replay, state);
  let weekIndex = 0;
  for (let year = anchor.seasonNumber; year <= state.seasonNumber; year += 1) {
    const firstRound = year === anchor.seasonNumber ? anchor.round : 1, lastRound = year === state.seasonNumber ? state.round : 10;
    if (year > anchor.seasonNumber) {
      replay = { ...replay, seasonNumber: year, round: 1, date: dateForRound(1, year) };
      replay = prepareAcademySeason(replay);
      replay = prepareYouthSeason(replay);
      replay = activateYouthReplay(replay, state);
    }
    for (let round = firstRound + 1; round <= lastRound; round += 1) {
      replay = replayYouthRound(replay, state);
      const raw = academy.weeks[weekIndex], path = `academy.weeks[${weekIndex}]`, afterRound = round - 1;
      if (!raw) fail(path, 'must retain every completed academy interval');
      const active = replay.academy.prospects.filter(prospect => !replay.academy.graduates.some(graduate => graduate.prospectId === prospect.player.id));
      const players = record(raw.players, `${path}.players`, active.map(prospect => prospect.player.id));
      const historicalFocus = { ...replay.academy.focus };
      for (const prospect of active) {
        const id = prospect.player.id;
        const entry = record(players[id], `${path}.players.${id}`, ['clubId', 'focus', 'pointsBefore', 'gains', 'coachingGains', 'pointsAfter', ...(replay.youthCompetition.enabledSince ? ['availability'] : []), ...(state.facilities.enabledSince && state.facilities.enabledSince.date <= dateForRound(afterRound, year) ? ['facility'] : [])]);
        if (!TRAINING_FOCUSES.includes(entry.focus as TrainingPlan['focus']) || prospect.clubId !== state.managedClubId && entry.focus !== 'balanced') fail(`${path}.players.${id}.focus`, 'must retain a supported instruction for this club');
        historicalFocus[id] = entry.focus as TrainingPlan['focus'];
      }
      replay = { ...replay, academy: processAcademyWeek({ facilities: state.facilities, academy: { ...replay.academy, focus: historicalFocus }, youth: state.youth, youthCompetition: replay.youthCompetition, clubs: state.clubs, seasonNumber: year, afterRound, fromDate: dateForRound(afterRound, year), toDate: dateForRound(round, year) }), seasonNumber: year, round, date: dateForRound(round, year) };
      if (!sameData(replay.academy.weeks.at(-1), raw)) fail(path, 'must reconcile exact prospect membership, focus, staff, prior points and development gains');
      weekIndex += 1;
      // Contract order is the actual acceptance order, including simultaneous arrivals.
      for (const contract of state.employment.contracts.filter(contract => contract.kind === 'midseason' && contract.startsSeason === year && contract.startsRound === round)) {
        const offer = state.recruitment.offers.find(offer => offer.academyProspectId === contract.playerId && offer.status === 'accepted' && state.negotiations.records.some(reply => reply.id === offer.negotiationId && reply.contractId === contract.id));
        if (!offer) continue;
        replay = graduateAcademyProspect({ ...replay, employment: state.employment, recruitment: { ...state.recruitment, offers: state.recruitment.offers.map(item => item.id === offer.id ? { ...item, status: 'pending' } : item) } }, contract.playerId, 'promotion', offer.id, contract.id);
      }
      replay = activateYouthReplay(replay, state);
    }
    if (year < state.seasonNumber || state.status === 'complete') replay = replayYouthRound(replay, state);
  }
  if (weekIndex !== academy.weeks.length) fail('academy.weeks', 'cannot retain future or duplicate development intervals');
  const finalFocus = { ...replay.academy.focus };
  for (const prospect of replay.academy.prospects) if (!replay.academy.graduates.some(graduate => graduate.prospectId === prospect.player.id)) finalFocus[prospect.player.id] = academy.focus[prospect.player.id]!;
  if (!sameData({ ...replay.academy, focus: finalFocus }, academy)) fail('academy', 'must preserve canonical intakes, development, graduate identities and their exact accepted promotion or age-out source');
  if (!sameData(replay.youthCompetition, state.youthCompetition)) fail('youthCompetition', 'must retain the exact activation, scheduled fixtures, frozen squads and committed results without future or fabricated matches');
}

const LIFECYCLE_ANCHOR_KEYS = ['seasonNumber', 'round', 'date', 'ledgerIndex', 'contractCount', 'negotiationCount', 'recruitmentEventCount', 'marketEventCount'] as const;

/** No stored aging overrides: dates, source biographies and immutable notices are authoritative. */
function validateLifecycleShape(value: unknown, state: SeasonState): SeasonLifecycle {
  const fields = record(value, 'lifecycle', ['model', 'enabledSince', 'reviews', 'notices']);
  if (fields.model !== 'lifecycle-1' || !Array.isArray(fields.reviews) || fields.reviews.length > MAX_SEASON_NUMBER || !Array.isArray(fields.notices) || fields.notices.length > 20_000) fail('lifecycle', 'must retain a supported bounded review and retirement history');
  if (fields.enabledSince === null) {
    if (!sameData(fields, createLifecycle())) fail('lifecycle', 'must retain its empty default while disabled');
    return fields as unknown as SeasonLifecycle;
  }
  const anchor = record(fields.enabledSince, 'lifecycle.enabledSince', LIFECYCLE_ANCHOR_KEYS);
  const year = number(anchor.seasonNumber, 'lifecycle.enabledSince.seasonNumber', 1, state.seasonNumber);
  const round = number(anchor.round, 'lifecycle.enabledSince.round', 1, year === state.seasonNumber ? state.round : 10);
  if (anchor.date !== dateForRound(round, year)) fail('lifecycle.enabledSince.date', 'must identify its actual active-season boundary');
  for (const [index, item] of fields.reviews.entries()) record(item, `lifecycle.reviews[${index}]`, [...LIFECYCLE_ANCHOR_KEYS, 'id', 'noticeIds']);
  for (const [index, item] of fields.notices.entries()) record(item, `lifecycle.notices[${index}]`, ['id', 'reviewId', 'playerId', 'clubId', 'announcedSeason', 'announcedRound', 'announcedOn', 'targetAge', 'lastSeason', 'retirementSeason', 'retiredOn']);
  return fields as unknown as SeasonLifecycle;
}

/** Rebuild notices from exactly the population, terms and pending offers known at each review. */
function validateLifecycleHistory(state: SeasonState, recruitmentHolds: RecruitmentHolds[]): void {
  const lifecycle = state.lifecycle, first = lifecycle.enabledSince;
  if (!first) return;
  const firstBoundary = first.seasonNumber * 10 + first.round;
  const prerequisites = [state.academy.enabledSince, state.employment.enabledSince, state.negotiations.enabledSince, state.payroll.enabledSince];
  if (prerequisites.some(anchor => !anchor || anchor.seasonNumber * 10 + anchor.round > firstBoundary)) fail('lifecycle.enabledSince', 'requires academy, employment, negotiations and payroll already active');
  if (lifecycle.reviews.length !== state.seasonNumber - first.seasonNumber + 1) fail('lifecycle.reviews', 'must retain activation and every later opening review exactly once');
  let replayed = createLifecycle();
  for (const [index, review] of lifecycle.reviews.entries()) {
    const path = `lifecycle.reviews[${index}]`, year = first.seasonNumber + index, round = index === 0 ? first.round : 1;
    if (review.id !== `lifecycle-review-${index + 1}` || review.seasonNumber !== year || review.round !== round || review.date !== dateForRound(round, year)) fail(path, 'must identify activation followed by each canonical season opening');
    if (index === 0 && !sameData(Object.fromEntries(LIFECYCLE_ANCHOR_KEYS.map(key => [key, review[key]])), first)) fail('lifecycle.enabledSince', 'must match the first retained review source exactly');
    const ledgerIndex = number(review.ledgerIndex, `${path}.ledgerIndex`, 0, state.finance.ledger.length);
    const contractCount = number(review.contractCount, `${path}.contractCount`, 0, state.employment.contracts.length);
    const negotiationCount = number(review.negotiationCount, `${path}.negotiationCount`, 0, state.negotiations.records.length);
    const recruitmentEventCount = number(review.recruitmentEventCount, `${path}.recruitmentEventCount`, 0, state.recruitment.events.length);
    const marketEventCount = number(review.marketEventCount, `${path}.marketEventCount`, 0, state.market.windows.reduce((sum, window) => sum + window.events.length, 0));
    validateLedgerBoundary(state.finance.ledger, ledgerIndex, year, round, `${path}.ledgerIndex`);
    const replies = state.negotiations.records.slice(0, negotiationCount);
    if (contractCount !== state.negotiations.enabledSince!.contractCount + replies.filter(reply => reply.outcome === 'accepted').length) fail(`${path}.contractCount`, 'must retain the agreements explained by the exact player-response prefix');
    const boundary = year * 10 + round;
    for (const [at, contract] of state.employment.contracts.entries()) if (at < contractCount ? contract.signedSeason * 10 + contract.signedRound > boundary : contract.signedSeason * 10 + contract.signedRound < boundary) fail(`${path}.contractCount`, 'must identify a chronological contract prefix');
    for (const [at, reply] of state.negotiations.records.entries()) if (at < negotiationCount ? reply.seasonNumber * 10 + reply.round > boundary : reply.seasonNumber * 10 + reply.round < boundary) fail(`${path}.negotiationCount`, 'must identify a chronological response prefix');
    for (const [at, event] of state.recruitment.events.entries()) if (at < recruitmentEventCount ? event.seasonNumber * 10 + event.round > boundary : event.seasonNumber * 10 + event.round < boundary) fail(`${path}.recruitmentEventCount`, 'must identify a chronological in-season command prefix');
    // Reviews occur while active: all earlier offseason windows are complete, none from this year exist yet.
    const windows = state.market.windows.filter(window => window.seasonNumber < year);
    if (marketEventCount !== windows.reduce((sum, window) => sum + window.events.length, 0)) fail(`${path}.marketEventCount`, 'must retain exactly the completed earlier recruitment windows');
    if (index > 0) {
      if (ledgerIndex !== state.finance.ledger.filter(entry => entry.seasonNumber < year).length || contractCount !== state.employment.contracts.filter(contract => contract.signedSeason < year).length || negotiationCount !== state.negotiations.records.filter(reply => reply.seasonNumber < year).length || recruitmentEventCount !== state.recruitment.events.filter(event => event.seasonNumber < year).length) fail(path, 'must review the opening population before new-season cash, replies or offers');
    } else {
      for (const anchor of [state.academy.enabledSince, state.payroll.enabledSince]) if (anchor && anchor.seasonNumber * 10 + anchor.round === boundary && anchor.ledgerIndex > ledgerIndex) fail(`${path}.ledgerIndex`, 'cannot precede required feature activation on the same matchday');
      if (state.academy.enabledSince!.contractCount > contractCount || state.academy.enabledSince!.negotiationCount > negotiationCount) fail(path, 'cannot precede academy activation journal prefixes');
    }
    const ledger = state.finance.ledger.slice(0, ledgerIndex), paidSources = new Set(ledger.map(entry => entry.sourceId));
    const contracts = state.employment.contracts.slice(0, contractCount);
    const employment = { ...state.employment, contracts, transfers: state.employment.transfers.filter(transfer => contracts.some(contract => contract.id === transfer.contractId)).map(transfer => ({ ...transfer, payments: transfer.payments.filter(payment => paidSources.has(payment.id)) })), buyouts: state.employment.buyouts.filter(buyout => paidSources.has(buyout.id)), market: null };
    const youthAnchor = state.youthCompetition.enabledSince;
    const youthVisible = !youthAnchor || youthAnchor.seasonNumber * 10 + youthAnchor.round < year * 10 + round || youthAnchor.seasonNumber === year && youthAnchor.round === round && youthAnchor.ledgerIndex <= ledgerIndex && youthAnchor.contractCount <= contractCount && youthAnchor.negotiationCount <= negotiationCount && youthAnchor.recruitmentEventCount <= recruitmentEventCount;
    const youthCompetition = youthVisible ? youthCompetitionAtBoundary(state.youthCompetition, year, round) : createYouthCompetition();
    const academy = academyAtBoundary(state.academy, year, round, contractCount, !youthVisible && youthAnchor && youthAnchor.seasonNumber === year && youthAnchor.round === round ? youthAnchor.academyIntakeCount : undefined);
    const offers = recruitmentEventCount ? recruitmentHolds.find(hold => hold.eventCount === recruitmentEventCount)?.offers : [];
    if (!offers) fail(`${path}.recruitmentEventCount`, 'must reference a replayed in-season command boundary');
    const context: SeasonState = {
      ...state, seasonNumber: year, round, date: review.date, status: 'active', academy, lifecycle: replayed, youthCompetition, employment,
      clubs: clubsForEmploymentYear(employment, year, round, { academy, lifecycle: replayed, seasonNumber: year, round }),
      finance: { ...state.finance, ledger }, negotiations: { ...state.negotiations, records: replies },
      recruitment: { ...state.recruitment, events: state.recruitment.events.slice(0, recruitmentEventCount), offers }, market: { ...state.market, windows },
    };
    try { replayed = (index === 0 ? enableLifecycle(context) : prepareLifecycleSeason(context)).lifecycle; }
    catch (error) { fail(path, `cannot review its recorded career boundary: ${error instanceof Error ? error.message : 'invalid source'}`); }
    if (!sameData(replayed.reviews.at(-1), review)) fail(path, 'must reproduce exact source prefixes and the canonical retirement decisions');
  }
  if (!sameData(replayed, lifecycle)) fail('lifecycle.notices', 'must preserve deterministic ages, population protection, existing agreements, pending terms and immutable retirement dates');
}

/** Rebuild treatment before using it to decide any historical fixture availability. */
function validateRehabilitation(physio: SeasonPhysio, state: SeasonState, employment: SeasonEmployment | undefined): void {
  if (!physio.enabledSince) return;
  if (!Array.isArray(physio.rehabilitation) || physio.rehabilitation.length > 600 * state.seasonNumber * 9) fail('physio.rehabilitation', 'must retain a bounded chronological treatment history');
  for (const [index, value] of physio.rehabilitation.entries()) record(value, `physio.rehabilitation[${index}]`, ['id', 'injuryId', 'playerId', 'clubId', 'seasonNumber', 'afterRound', 'fromDate', 'toDate', 'rosterId', 'contractId', 'physioId', 'eligibleDays', 'creditBefore', 'creditEarned', 'creditAfter', 'returnBefore', 'returnAfter']);
  const schedules = new Map<string, SeasonFixture>();
  for (let year = 1; year <= state.seasonNumber; year += 1) for (const fixture of createSchedule(state.clubs, year)) schedules.set(fixture.id, fixture);
  const players = new Set(getCareerPlayers(state).map(player => player.id));
  for (const [index, value] of state.injuries.entries()) {
    const path = `injuries[${index}]`, injury = record(value, path, ['id', 'playerId', 'clubId', 'kind', 'fixtureId', 'occurredOn', 'returnOn']);
    const fixture = schedules.get(injury.fixtureId as string);
    if (!fixture || !players.has(injury.playerId as string) || ![fixture.homeClubId, fixture.awayClubId].includes(injury.clubId as string) || !['ankle', 'muscle'].includes(injury.kind as string)) fail(path, 'must identify a supported diagnosis and originating fixture');
    if (!sameData(injury, createSeasonInjury(state.seed, fixture, injury.clubId as string, injury.playerId as string, injury.kind as SeasonInjury['kind']))) fail(path, 'must retain the original diagnosis and recovery date');
  }
  let replayed: SeasonPhysio = { ...physio, rehabilitation: [] };
  for (let year = physio.enabledSince.seasonNumber; year <= state.seasonNumber; year += 1) {
    const fromRound = year === physio.enabledSince.seasonNumber ? physio.enabledSince.round : 1;
    const throughRound = year === state.seasonNumber ? Math.min(state.round - 1, 9) : 9;
    const rosters = year === state.seasonNumber ? state.rosters : state.history[year - 1]?.rosters;
    if (!Array.isArray(rosters)) fail('physio.rehabilitation', 'requires the retained registration history for every treatment season');
    for (let afterRound = fromRound; afterRound <= throughRound; afterRound += 1) {
      const fromDate = dateForRound(afterRound, year), toDate = dateForRound(afterRound + 1, year);
      replayed = processRehabilitationWeek({ physio: replayed, clubs: clubsForEmploymentYear(employment, year, afterRound, state), rosters, injuries: state.injuries.filter(injury => injury.occurredOn <= fromDate), seasonNumber: year, afterRound, fromDate, toDate });
    }
  }
  if (!sameData(replayed.rehabilitation, physio.rehabilitation)) fail('physio.rehabilitation', 'must reconcile exact historical staff, registration, treatment days, credits and return dates');
}

function validateTicketPrice(value: unknown, path: string): number {
  const price = number(value, path, 0, MAX_TICKET_PRICE);
  if (price % TICKET_PRICE_STEP !== 0) fail(path, 'must use whole-euro price steps');
  return price;
}

function clubsForEmploymentYear(employment: SeasonEmployment | undefined, seasonNumber: number, round = 10, context: CareerPlayerContext = {}): readonly Team[] {
  return employment ? getContractedClubsForRound({ ...context, employment, clubs: DEVELOPMENT_CLUBS }, seasonNumber, round) : DEVELOPMENT_CLUBS;
}

/** Earlier transfers were settled in full; preserve the original cash event identity. */
function migrateTransferPayments(employment: SeasonEmployment): SeasonEmployment {
  return { ...employment, transfers: (employment.transfers ?? []).map(transfer => ({
    ...transfer, paymentPlan: 'upfront',
    installments: [{ dueOn: transfer.completedOn, amount: transfer.fee }],
    payments: [{ id: transfer.id, installmentIndex: 0, paidOn: transfer.completedOn, seasonNumber: transfer.seasonNumber, round: 10, amount: transfer.fee }],
  })) };
}

/** Retained employment records are the authority for historical and pending registrations. */

const FACILITY_ANCHOR_KEYS = ['seasonNumber', 'round', 'date', 'ledgerIndex', 'contractCount', 'negotiationCount', 'recruitmentEventCount', 'marketEventCount'] as const;

function validateFacilitiesShape(value: unknown, state: SeasonState): SeasonFacilities {
  const fields = record(value, 'facilities', ['model', 'enabledSince', 'delegated', 'projects', 'events']);
  const defaults = createFacilities(DEVELOPMENT_CLUBS, state.managedClubId);
  if (fields.model !== 'facilities-1') fail('facilities.model', 'is unsupported');
  const policies = record(fields.delegated, 'facilities.delegated', DEVELOPMENT_CLUBS.map(club => club.id));
  for (const [id, policy] of Object.entries(policies)) if (typeof policy !== 'boolean') fail(`facilities.delegated.${id}`, 'must be boolean');
  if (!Array.isArray(fields.projects) || !Array.isArray(fields.events) || fields.events.length > 20000 || fields.projects.length > fields.events.length) fail('facilities', 'must retain bounded project and command histories');
  if (fields.enabledSince === null) {
    if (!sameData(fields, defaults)) fail('facilities', 'must retain the default empty facilities while disabled');
    return fields as unknown as SeasonFacilities;
  }
  if (!state.finance?.enabledSince || !Array.isArray(state.finance.ledger)) fail('facilities.enabledSince', 'requires active club finances');
  const recruitmentEvents = state.recruitment?.events ?? [], windows = state.market?.windows ?? [], marketEvents = windows.flatMap(window => window.events);
  const checkAnchor = (raw: unknown, path: string): FacilityAnchor => {
    const anchor = record(raw, path, FACILITY_ANCHOR_KEYS);
    const year = number(anchor.seasonNumber, `${path}.seasonNumber`, 1, state.seasonNumber), round = number(anchor.round, `${path}.round`, 1, year === state.seasonNumber ? state.round : 10);
    const ledgerIndex = number(anchor.ledgerIndex, `${path}.ledgerIndex`, 0, state.finance.ledger.length);
    const contractCount = number(anchor.contractCount, `${path}.contractCount`, 0, state.employment?.contracts.length ?? 0);
    const negotiationCount = number(anchor.negotiationCount, `${path}.negotiationCount`, 0, state.negotiations?.records.length ?? 0);
    const recruitmentCount = number(anchor.recruitmentEventCount, `${path}.recruitmentEventCount`, 0, recruitmentEvents.length);
    const marketCount = number(anchor.marketEventCount, `${path}.marketEventCount`, 0, marketEvents.length);
    const calendar = year * 10 + round;
    const commitIndexes = state.finance.ledger.flatMap((entry, index) => entry.seasonNumber === year && entry.round === round && (['tickets', 'operations', 'facility-upkeep'].includes(entry.kind) || entry.kind === 'payroll' && entry.payroll?.type === 'installment') ? [index] : []);
    if (commitIndexes.length && ledgerIndex > commitIndexes[0]! && (round < 10 || ledgerIndex <= commitIndexes.at(-1)!)) fail(path, 'cannot interleave a facilities decision with the atomic matchday financial commit');
    if (calendar < state.finance.enabledSince!.seasonNumber * 10 + state.finance.enabledSince!.round) fail(path, 'cannot precede finance activation');
    // Opening construction completes before the new sponsorship entries; all other cash stays chronological.
    for (const [i, entry] of state.finance.ledger.entries()) if (i < ledgerIndex ? entry.seasonNumber * 10 + entry.round > calendar : entry.seasonNumber * 10 + entry.round < calendar && !(round === 1 && entry.seasonNumber === year - 1 && entry.round === 10)) fail(path, 'must identify a contiguous chronological cash prefix');
    for (const [i, entry] of recruitmentEvents.entries()) if (i < recruitmentCount ? entry.seasonNumber * 10 + entry.round > calendar : entry.seasonNumber * 10 + entry.round < calendar) fail(path, 'must identify the actual recruitment command prefix');
    const previousMarketCount = windows.filter(window => window.seasonNumber < year).reduce((sum, window) => sum + window.events.length, 0);
    const current = windows.find(window => window.seasonNumber === year);
    if (marketCount < previousMarketCount || marketCount > previousMarketCount + (round === 10 ? current?.events.length ?? 0 : 0)) fail(path, 'must identify the current offseason command prefix');
    const visibleMarket = current?.events.slice(0, marketCount - previousMarketCount) ?? [];
    const expectedDate = round === 10 ? visibleMarket.filter(event => event.type === 'advance').at(-1)?.date ?? dateForRound(round, year) : dateForRound(round, year);
    if (anchor.date !== expectedDate || (anchor.date as string) > state.date) fail(`${path}.date`, 'must be a calendar date already reached by its exact command prefix');
    for (const [i, entry] of (state.negotiations?.records ?? []).entries()) if (i < negotiationCount ? entry.date > expectedDate : entry.date < expectedDate) fail(path, 'must identify the chronological player response prefix');
    const initialContracts = (state.employment?.contracts ?? []).filter(contract => contract.kind === 'initial');
    if (contractCount > 0 && contractCount < initialContracts.length) fail(path, 'must retain all initial employment agreements together');
    for (const [i, contract] of (state.employment?.contracts ?? []).entries()) if (i < contractCount ? contract.signedSeason * 10 + contract.signedRound > calendar : contract.signedSeason * 10 + contract.signedRound < calendar) fail(path, 'must identify the chronological signed-contract prefix');
    const negotiationAnchor = state.negotiations?.enabledSince;
    if (negotiationAnchor && calendar >= negotiationAnchor.seasonNumber * 10 + negotiationAnchor.round && contractCount >= negotiationAnchor.contractCount && contractCount !== negotiationAnchor.contractCount + state.negotiations.records.slice(0, negotiationCount).filter(entry => entry.outcome === 'accepted').length) fail(path, 'must preserve contracts explained by the response prefix');
    return anchor as unknown as FacilityAnchor;
  };
  const anchor = checkAnchor(fields.enabledSince, 'facilities.enabledSince');
  let previous = anchor;
  for (const [index, raw] of fields.events.entries()) {
    const path = `facilities.events[${index}]`, type = raw && typeof raw === 'object' ? raw.type : undefined;
    const extra = type === 'start' ? ['projectId', 'clubId', 'facilityType'] : type === 'cancel' ? ['projectId'] : type === 'delegate' ? ['clubId', 'delegated'] : type === 'process' ? [] : null;
    if (!extra) fail(path, 'must identify a supported facilities decision');
    const event = record(raw, path, [...FACILITY_ANCHOR_KEYS, 'type', ...extra]);
    const at = checkAnchor(Object.fromEntries(FACILITY_ANCHOR_KEYS.map(key => [key, event[key]])), path);
    if (at.date < previous.date || FACILITY_ANCHOR_KEYS.filter(key => !['seasonNumber', 'round', 'date'].includes(key)).some(key => at[key] < previous[key])) fail(path, 'must preserve chronological command and commitment prefixes');
    previous = at;
  }
  for (const [index, raw] of fields.projects.entries()) {
    const path = `facilities.projects[${index}]`, project = record(raw, path, ['id', 'clubId', 'type', 'fromLevel', 'toLevel', 'cost', 'startedOn', 'dueOn', 'completedOn', 'cancelledOn', 'startEventIndex']);
    if (project.id !== `facility-project-${index + 1}`) fail(`${path}.id`, 'must retain sequential project identities');
    number(project.startEventIndex, `${path}.startEventIndex`, 0, fields.events.length - 1);
  }
  return fields as unknown as SeasonFacilities;
}

interface MarketReplaySnapshot { eventCount: number; seasonNumber: number; market: SeasonMarket }

/** A command may share a date with later completion/cancellation; counters disambiguate that history. */
function facilitiesAtPrefix(state: SeasonState, date: string, ledgerIndex: number, contractCount: number, negotiationCount: number, recruitmentEventCount: number, marketEventCount: number): SeasonFacilities {
  const visible = (anchor: FacilityAnchor) => anchor.date <= date && anchor.ledgerIndex <= ledgerIndex && anchor.contractCount <= contractCount && anchor.negotiationCount <= negotiationCount && anchor.recruitmentEventCount <= recruitmentEventCount && anchor.marketEventCount <= marketEventCount;
  if (!state.facilities.enabledSince || !visible(state.facilities.enabledSince)) return createFacilities(state.clubs, state.managedClubId);
  const count = state.facilities.events.findIndex(event => !visible(event));
  return facilitiesAtEventCount(state.facilities, count < 0 ? state.facilities.events.length : count, state.managedClubId);
}

function validateFacilitiesHistory(state: SeasonState, holds: RecruitmentHolds[], markets: MarketReplaySnapshot[]): void {
  const source = state.facilities, anchor = source.enabledSince;
  if (!anchor) return;
  let facilities: SeasonFacilities = { ...createFacilities(state.clubs, state.managedClubId), enabledSince: anchor };
  let previousLedger = anchor.ledgerIndex;
  for (const [index, event] of source.events.entries()) {
    const path = `facilities.events[${index}]`, year = event.seasonNumber, round = event.round;
    const ledger = state.finance.ledger.slice(0, event.ledgerIndex);
    const contracts = state.employment.contracts.slice(0, event.contractCount);
    const sourceIds = new Set(ledger.map(entry => entry.sourceId));
    const employment: SeasonEmployment = event.contractCount === 0 ? createEmployment() : { ...state.employment, contracts, transfers: state.employment.transfers.filter(transfer => contracts.some(contract => contract.id === transfer.contractId)).map(transfer => ({ ...transfer, payments: transfer.payments.filter(payment => sourceIds.has(payment.id)) })), buyouts: state.employment.buyouts.filter(buyout => sourceIds.has(buyout.id)), market: null };
    const academyAnchor = state.academy.enabledSince;
    const academyVisible = !academyAnchor || academyAnchor.ledgerIndex <= event.ledgerIndex && academyAnchor.contractCount <= event.contractCount && academyAnchor.negotiationCount <= event.negotiationCount;
    const academy = academyVisible ? academyAtBoundary(state.academy, year, round, event.contractCount) : createAcademy();
    const lifecycle = lifecycleAtBoundary(state.lifecycle, year, round, event.contractCount, event.recruitmentEventCount, event.marketEventCount, event.ledgerIndex, event.negotiationCount);
    const clubs = clubsForEmploymentYear(employment, year, round, { academy, lifecycle, seasonNumber: year, round });
    const snapshot = markets.filter(item => item.eventCount === event.marketEventCount && item.seasonNumber <= year).at(-1);
    const market: SeasonMarket = snapshot ? { ...snapshot.market, windows: snapshot.market.windows.filter(window => window.seasonNumber <= year).map(window => ({ ...window, closed: window.seasonNumber < year })) } : { ...state.market, windows: state.market.windows.filter(window => window.seasonNumber < year) };
    const live = holds.find(hold => hold.eventCount === event.recruitmentEventCount)?.offers ?? [];
    const payrollVisible = state.payroll.enabledSince && state.payroll.enabledSince.ledgerIndex <= event.ledgerIndex;
    const payroll = payrollVisible ? { ...state.payroll, agreements: state.payroll.agreements.filter(agreement => agreement.seasonNumber < year || agreement.seasonNumber === year && agreement.startsRound <= round && (!employment.enabledSince || contractForRound(employment, agreement.playerId, year, agreement.startsRound)?.clubId === agreement.clubId)) } : createPayroll(clubs, state.managedClubId);
    const trainingAnchor = state.training.enabledSince;
    const training = trainingAnchor && trainingAnchor.seasonNumber * 10 + trainingAnchor.round <= year * 10 + round ? state.training : { ...state.training, enabledSince: null };
    let replay: SeasonState = { ...state, training, seasonNumber: year, round, date: event.date, status: round === 10 && ledger.some(entry => entry.seasonNumber === year && entry.round === 10 && entry.kind === 'operations') ? 'complete' : 'active', clubs, academy, lifecycle, employment, facilities, finance: { ...state.finance, ledger }, payroll, negotiations: { ...state.negotiations, records: state.negotiations.records.slice(0, event.negotiationCount) }, recruitment: { ...state.recruitment, events: state.recruitment.events.slice(0, event.recruitmentEventCount), offers: live }, market };
    if (event.ledgerIndex < previousLedger) fail(path, 'cannot rewind cash after a funded approval');
    for (const [i, command] of state.recruitment.events.entries()) {
      const nextLedger = event.ledgerIndex + Number(event.type === 'start');
      if (i < event.recruitmentEventCount ? command.ledgerIndexBefore > event.ledgerIndex : command.ledgerIndexBefore < nextLedger) fail(path, 'must preserve the cash ordering of the recorded recruitment prefix and project payment');
    }
    if (event.type === 'process' && event.date === dateForRound(round, year)) {
      const expectedLedger = state.finance.ledger.filter(entry => entry.seasonNumber < year || entry.seasonNumber === year && entry.round < round).length;
      const expectedRecruitment = state.recruitment.events.filter(entry => entry.seasonNumber < year || entry.seasonNumber === year && entry.round < round).length;
      if (event.ledgerIndex !== expectedLedger || event.recruitmentEventCount !== expectedRecruitment) fail(path, 'must process construction at the new calendar boundary before replies and new-round payments');
    }
    try { replay = applyFacilityEvent(replay, event); } catch (error) { fail(path, `does not follow construction rules: ${error instanceof Error ? error.message : 'invalid command'}`); }
    if (!sameData(replay.finance.ledger, state.finance.ledger.slice(0, replay.finance.ledger.length))) fail(path, 'must pay the exact approved project once at its anchored cash boundary');
    facilities = replay.facilities; previousLedger = replay.finance.ledger.length;
  }
  if (!sameData(facilities, source)) fail('facilities', 'must exactly reproduce funded costs, levels, dates, cancellations and delegation from its command history');
  // A due project completes at the first calendar boundary actually visited, even across a long offseason.
  const dates = new Set<string>();
  for (let year = anchor.seasonNumber; year <= state.seasonNumber; year += 1) {
    for (let round = 1; round <= (year === state.seasonNumber ? state.round : 10); round += 1) { const date = dateForRound(round, year); if (date >= anchor.date) dates.add(date); }
    for (const event of state.market.windows.find(window => window.seasonNumber === year)?.events ?? []) if (event.type === 'advance') dates.add(event.date);
  }
  const visited = [...dates].sort();
  for (const project of source.projects) {
    const first = visited.find(date => date > project.startedOn && date >= project.dueOn);
    const expected = first && (!project.cancelledOn || project.cancelledOn >= first) ? first : null;
    if (project.completedOn !== expected) fail(`facilities.projects.${project.id}.completedOn`, 'must complete at the first visited calendar boundary after its due date');
  }
}

function validateEmployment(value: unknown, seasonNumber: number, round: number, status: SeasonState['status'], managedClubId: string, datedMarket = false, version = 30, context: CareerPlayerContext = {}): SeasonEmployment {
  const fields = record(value, 'employment', ['model', 'enabledSince', 'delegated', 'contracts', 'market', ...(version >= 15 ? ['transfers'] : []), ...(version >= 17 ? ['buyouts'] : [])]);
  const rawTransfers = version >= 15 ? fields.transfers : [];
  if (!Array.isArray(rawTransfers) || rawTransfers.length > 20_000) fail('employment.transfers', 'must retain at most 20000 completed transfers');
  const transfers = rawTransfers.map(transfer => version < 19 ? { ...transfer, startsRound: 1 } : transfer);
  if (transfers.some(transfer => transfer.startsRound === 1) && !datedMarket) fail('employment.transfers', 'requires the dated market for offseason club transfers');
  const buyouts = version >= 17 ? fields.buyouts : [];
  if (!Array.isArray(buyouts) || buyouts.length > 20_000) fail('employment.buyouts', 'must retain at most 20000 completed contract buyouts');
  if (buyouts.length && !datedMarket) fail('employment.buyouts', 'requires the dated market and retained release commands');
  const normalized = { ...fields, transfers, buyouts, contracts: Array.isArray(fields.contracts) ? fields.contracts.map(contract => version < 18 ? { ...contract, startsRound: 1 } : contract) : fields.contracts } as unknown as SeasonEmployment;
  if (fields.model !== 'employment-1') fail('employment.model', 'is unsupported');
  if (typeof fields.delegated !== 'boolean') fail('employment.delegated', 'must be boolean');
  if (!Array.isArray(fields.contracts) || fields.contracts.length > 20_000) fail('employment.contracts', 'must contain at most 20000 retained contracts');
  if (fields.enabledSince === null) {
    if (!sameData(normalized, createEmployment())) fail('employment', 'must retain its empty default state while disabled');
    return normalized;
  }
  const anchor = record(fields.enabledSince, 'employment.enabledSince', ['seasonNumber', 'round']);
  const firstYear = number(anchor.seasonNumber, 'employment.enabledSince.seasonNumber', 1, seasonNumber);
  const firstRound = number(anchor.round, 'employment.enabledSince.round', 1, firstYear === seasonNumber ? round : 10);
  if (status === 'complete' && seasonNumber < MAX_SEASON_NUMBER) {
    if (!sameData(fields.market, { seasonNumber: seasonNumber + 1 })) fail('employment.market', 'must identify the next season after the final matchday');
  } else if (fields.market !== null) fail('employment.market', 'must be closed during the active season');
  const catalog = DEVELOPMENT_CLUBS.flatMap(club => club.players.map(player => ({ player, clubId: club.id })));
  const catalogById = new Map(getCareerPlayers(context, seasonNumber, round).map(player => [player.id, { player }]));
  const clubIds = DEVELOPMENT_CLUBS.map(club => club.id);
  if (fields.contracts.length < catalog.length) fail('employment.contracts', 'must retain each opening employment agreement');
  let previousTransferDate = '';
  const transferPlayers = new Set<string>();
  for (const [index, value] of rawTransfers.entries()) {
    const path = `employment.transfers[${index}]`;
    const raw = record(value, path, ['id', 'offerId', 'playerId', 'fromClubId', 'toClubId', 'seasonNumber', 'completedOn', 'startsSeason', 'fee', 'releasedContractIds', 'contractId', ...(version >= 16 ? ['paymentPlan', 'installments', 'payments'] : []), ...(version >= 19 ? ['startsRound'] : []), ...optionalClauseKeys(value, version, ['mode'])]);
    const transfer = version < 19 ? { ...raw, startsRound: 1 } : raw;
    if (transfer.id !== `employment-transfer-${index + 1}`) fail(`${path}.id`, 'must use sequential transfer identities');
    const year = number(transfer.seasonNumber, `${path}.seasonNumber`, firstYear, seasonNumber);
    const startsRound = number(transfer.startsRound, `${path}.startsRound`, 1, year === seasonNumber ? round : 10), midseason = startsRound > 1;
    if (midseason ? transfer.startsSeason !== year : year === seasonNumber && status !== 'complete' || transfer.startsSeason !== year + 1 || year >= MAX_SEASON_NUMBER) fail(path, 'must identify its actual current-season or offseason registration boundary');
    if (!catalogById.has(transfer.playerId as string) || !clubIds.includes(transfer.fromClubId as string) || !clubIds.includes(transfer.toClubId as string) || transfer.fromClubId === transfer.toClubId) fail(path, 'must identify a catalog player and two different clubs');
    if (typeof transfer.completedOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(transfer.completedOn) || (midseason ? transfer.completedOn !== dateForRound(startsRound, year) : transfer.completedOn < dateForRound(10, year) || transfer.completedOn > addMarketDays(dateForRound(10, year), MARKET_WINDOW_DAYS)) || transfer.completedOn < previousTransferDate || new Date(`${transfer.completedOn}T00:00:00Z`).toISOString().slice(0, 10) !== transfer.completedOn) fail(`${path}.completedOn`, 'must identify a chronological completion date at the legal registration boundary');
    previousTransferDate = transfer.completedOn;
    const playerBoundary = `${year}/${midseason ? 'active' : 'offseason'}/${transfer.playerId}`;
    if (transferPlayers.has(playerBoundary)) fail(path, 'cannot transfer the same player twice in one window');
    transferPlayers.add(playerBoundary);
    if (typeof transfer.offerId !== 'string' || typeof transfer.contractId !== 'string' || !Array.isArray(transfer.releasedContractIds) || !transfer.releasedContractIds.length || transfer.releasedContractIds.some(id => typeof id !== 'string') || new Set(transfer.releasedContractIds).size !== transfer.releasedContractIds.length) fail(path, 'must identify its offer, new contract and distinct released terms');
    const fee = number(transfer.fee, `${path}.fee`, 100_000, 50_000_000);
    if (fee % 100_000 !== 0) fail(`${path}.fee`, 'must use whole thousand-euro steps');
    if (Object.hasOwn(transfer, 'mode') && transfer.mode !== 'release-clause') fail(`${path}.mode`, 'must identify an explicit release-clause transfer');
    if (transfer.mode === 'release-clause' && transfer.paymentPlan !== 'upfront') fail(`${path}.paymentPlan`, 'must settle an activated release clause fully upfront');
    if (version >= 16) {
      if (!['upfront', 'two-payments', 'three-payments'].includes(transfer.paymentPlan as string)) fail(`${path}.paymentPlan`, 'must identify a supported payment schedule');
      const expected = getTransferPaymentSchedule(fee, transfer.paymentPlan as EmploymentTransfer['paymentPlan'], transfer.completedOn as string, year + 1);
      if (!sameData(transfer.installments, expected)) fail(`${path}.installments`, 'must retain the exact agreed amounts and calendar dates');
      if (!Array.isArray(transfer.payments) || !transfer.payments.length || transfer.payments.length > 10_000) fail(`${path}.payments`, 'must retain its initial payment and bounded receipt history');
      const paid = expected.map(() => 0);
      let previousPaidOn = transfer.completedOn as string;
      for (const [paymentIndex, raw] of transfer.payments.entries()) {
        const paymentPath = `${path}.payments[${paymentIndex}]`;
        const payment = record(raw, paymentPath, ['id', 'installmentIndex', 'paidOn', 'seasonNumber', 'round', 'amount']);
        if (payment.id !== (paymentIndex === 0 ? transfer.id : `${transfer.id}-payment-${paymentIndex + 1}`)) fail(`${paymentPath}.id`, 'must use sequential receipt identities');
        const installmentIndex = number(payment.installmentIndex, `${paymentPath}.installmentIndex`, 0, expected.length - 1);
        const paymentYear = number(payment.seasonNumber, `${paymentPath}.seasonNumber`, year, seasonNumber);
        const paymentRound = number(payment.round, `${paymentPath}.round`, 1, paymentYear === seasonNumber ? round : 10);
        const earliest = dateForRound(paymentRound, paymentYear), latest = paymentRound === 10 ? addMarketDays(earliest, MARKET_WINDOW_DAYS) : earliest;
        if (typeof payment.paidOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(payment.paidOn) || payment.paidOn < earliest || payment.paidOn > latest || payment.paidOn < previousPaidOn || payment.paidOn < expected[installmentIndex]!.dueOn || !Number.isFinite(Date.parse(`${payment.paidOn}T00:00:00Z`)) || new Date(`${payment.paidOn}T00:00:00Z`).toISOString().slice(0, 10) !== payment.paidOn) fail(`${paymentPath}.paidOn`, 'must identify a chronological due payment on its actual calendar boundary');
        const amount = number(payment.amount, `${paymentPath}.amount`, 1, expected[installmentIndex]!.amount - paid[installmentIndex]!);
        if (paid.slice(0, installmentIndex).some((amount, earlier) => amount !== expected[earlier]!.amount)) fail(paymentPath, 'must settle earlier installments first');
        if (paymentIndex === 0 && (installmentIndex !== 0 || amount !== expected[0]!.amount || payment.paidOn !== transfer.completedOn || paymentYear !== year || paymentRound !== (midseason ? startsRound : 10))) fail(paymentPath, 'must pay the complete first installment when the transfer completes');
        paid[installmentIndex]! += amount;
        previousPaidOn = payment.paidOn;
      }
    }
  }
  let previousBuyoutDate = '', previousBuyoutContracts = catalog.length, previousBuyoutNegotiations = 0;
  const releasedPlayers = new Set<string>();
  for (const [index, raw] of buyouts.entries()) {
    const path = `employment.buyouts[${index}]`;
    const buyout = record(raw, path, ['id', 'playerId', 'clubId', 'seasonNumber', 'completedOn', 'startsSeason', 'amount', 'releasedContractIds', 'contractCountBefore', 'negotiationCountBefore']);
    if (buyout.id !== `employment-buyout-${index + 1}`) fail(`${path}.id`, 'must use sequential buyout identities');
    const year = number(buyout.seasonNumber, `${path}.seasonNumber`, firstYear, seasonNumber);
    if (year === seasonNumber && status !== 'complete' || buyout.startsSeason !== year + 1 || year >= MAX_SEASON_NUMBER) fail(path, 'must release future employment after a completed season');
    if (!catalogById.has(buyout.playerId as string) || !clubIds.includes(buyout.clubId as string)) fail(path, 'must identify a catalog player and club');
    if (typeof buyout.completedOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(buyout.completedOn) || buyout.completedOn < dateForRound(10, year) || buyout.completedOn >= addMarketDays(dateForRound(10, year), MARKET_WINDOW_DAYS) || buyout.completedOn < previousBuyoutDate || !Number.isFinite(Date.parse(`${buyout.completedOn}T00:00:00Z`)) || new Date(`${buyout.completedOn}T00:00:00Z`).toISOString().slice(0, 10) !== buyout.completedOn) fail(`${path}.completedOn`, 'must retain a chronological offseason date before recruitment closes');
    const contractCountBefore = number(buyout.contractCountBefore, `${path}.contractCountBefore`, previousBuyoutContracts, fields.contracts.length);
    previousBuyoutContracts = contractCountBefore;
    previousBuyoutNegotiations = number(buyout.negotiationCountBefore, `${path}.negotiationCountBefore`, previousBuyoutNegotiations, 20_000);
    previousBuyoutDate = buyout.completedOn;
    const playerBoundary = `${year}/${buyout.clubId}/${buyout.playerId}`;
    if (releasedPlayers.has(playerBoundary)) fail(path, 'cannot release the same player from the same club twice in one window');
    releasedPlayers.add(playerBoundary);
    if (!Array.isArray(buyout.releasedContractIds) || !buyout.releasedContractIds.length || buyout.releasedContractIds.some(id => typeof id !== 'string') || new Set(buyout.releasedContractIds).size !== buyout.releasedContractIds.length) fail(`${path}.releasedContractIds`, 'must identify distinct released agreements');
    number(buyout.amount, `${path}.amount`, 1, MAX_CONTRACT_WAGE * MAX_CONTRACT_SEASONS);
    const contracts = normalized.contracts.slice(0, contractCountBefore);
    const employment = { ...normalized, contracts, transfers: (transfers as EmploymentTransfer[]).filter(transfer => contracts.some(contract => contract.id === transfer.contractId)), buyouts: buyouts.slice(0, index) as EmploymentBuyout[] };
    const source = contractForSeason(employment, buyout.playerId as string, year + 1);
    const released: EmploymentContract[] = [];
    let amount = 0;
    const through = year + MAX_CONTRACT_SEASONS;
    for (let season = year + 1; season <= through; season += 1) {
      const contract = contractForSeason(employment, buyout.playerId as string, season);
      if (!contract || contract.clubId !== buyout.clubId) continue;
      amount += contract.seasonWage;
      if (!released.some(previous => previous.id === contract.id)) released.push(contract);
    }
    if (!source || source.clubId !== buyout.clubId || !sameData(buyout.releasedContractIds, contracts.filter(contract => released.some(item => item.id === contract.id)).map(contract => contract.id)) || buyout.amount !== amount) fail(path, 'must settle exactly the releasing club\'s effective remaining future salary at its recorded history prefix');
  }
  const validated: EmploymentContract[] = [];
  const prefixEmployment = (include?: EmploymentContract, buyoutLimit = validated.length): SeasonEmployment => {
    const contracts = include ? [...validated, include] : validated;
    return { ...normalized, contracts, transfers: (transfers as EmploymentTransfer[]).filter(transfer => contracts.some(contract => contract.id === transfer.contractId)), buyouts: (buyouts as EmploymentBuyout[]).filter(buyout => buyout.contractCountBefore <= buyoutLimit) };
  };
  const validateClauseTrigger = (transfer: EmploymentTransfer, source: EmploymentContract, path: string) => {
    if (transfer.mode !== 'release-clause') return;
    const employment = prefixEmployment();
    const current = contractForRound(employment, transfer.playerId, transfer.seasonNumber, transfer.startsRound > 1 ? transfer.startsRound : 10);
    if (current?.id !== source.id || source.releaseFee !== transfer.fee || !sameData(transfer.releasedContractIds, [source.id])) fail(path, 'must trigger the active agreement\'s exact release fee without releasing distinct future rights');
    const throughYear = Math.max(source.endsSeason, ...validated.filter(contract => contract.playerId === transfer.playerId).map(contract => contract.endsSeason));
    for (let year = transfer.startsSeason; year <= throughYear; year += 1) {
      const future = year === transfer.seasonNumber ? contractForRound(employment, transfer.playerId, year, transfer.startsRound) : contractForSeason(employment, transfer.playerId, year);
      if (future && future.id !== source.id) fail(path, 'cannot use one release clause to cancel a distinct future agreement');
    }
  };
  let previousBoundary = firstYear * 10 + firstRound;
  for (const [index, value] of fields.contracts.entries()) {
    const path = `employment.contracts[${index}]`;
    const raw = record(value, path, ['id', 'playerId', 'clubId', 'startsSeason', 'endsSeason', 'seasonWage', 'signedSeason', 'signedRound', 'kind', ...(version >= 18 ? ['startsRound'] : []), ...optionalClauseKeys(value, version, ['releaseFee'])]);
    const entry = version < 18 ? { ...raw, startsRound: 1 } : raw;
    if (entry.id !== `employment-contract-${index + 1}`) fail(`${path}.id`, 'must use sequential contract identities');
    const player = catalogById.get(entry.playerId as string)?.player;
    if (!player) fail(`${path}.playerId`, 'must identify a player in the stable catalog');
    if (!clubIds.includes(entry.clubId as string)) fail(`${path}.clubId`, 'must identify a club in this league');
    const signedSeason = number(entry.signedSeason, `${path}.signedSeason`, firstYear, seasonNumber);
    const signedRound = number(entry.signedRound, `${path}.signedRound`, 1, signedSeason === seasonNumber ? round : 10);
    const boundary = signedSeason * 10 + signedRound;
    if (boundary < previousBoundary) fail(path, 'must retain chronological signing order');
    previousBoundary = boundary;
    const startsSeason = number(entry.startsSeason, `${path}.startsSeason`, firstYear, Math.min(MAX_SEASON_NUMBER, seasonNumber + 1));
    const endsSeason = number(entry.endsSeason, `${path}.endsSeason`, startsSeason, Math.min(MAX_SEASON_NUMBER, startsSeason + MAX_CONTRACT_SEASONS - 1));
    const startsRound = number(entry.startsRound, `${path}.startsRound`, 1, 10);
    const midseason = entry.kind === 'midseason' || entry.kind === 'midseason-transfer';
    if (!midseason && startsRound !== 1) fail(`${path}.startsRound`, 'must preserve opening-day registration for ordinary contracts');
    const seasonWage = number(entry.seasonWage, `${path}.seasonWage`, getCareerWage(context, player.id), MAX_CONTRACT_WAGE);
    if (seasonWage % WAGE_STEP !== 0) fail(`${path}.seasonWage`, 'must use supported wage increments');
    validateOptionalReleaseFee(entry, path);
    if (index < catalog.length) {
      if (Object.hasOwn(entry, 'releaseFee')) fail(`${path}.releaseFee`, 'cannot add an unnegotiated clause to the opening contract');
      const expected = catalog[index]!;
      if (entry.kind !== 'initial' || entry.playerId !== expected.player.id || entry.clubId !== expected.clubId || startsSeason !== firstYear || endsSeason !== firstYear || signedSeason !== firstYear || signedRound !== firstRound || seasonWage !== getSeasonWage(player.id)) fail(path, 'must preserve the opening squad and initial terms at activation');
    } else {
      if (!midseason && startsSeason !== signedSeason + 1) fail(`${path}.startsSeason`, 'must start in the season following the signing');
      const current = contractForRound(prefixEmployment(), player.id, signedSeason, signedRound);
      if (entry.kind === 'midseason' && version >= 18) {
        if (current || startsSeason !== signedSeason || endsSeason !== signedSeason || startsRound !== signedRound || signedRound < 2) fail(path, 'must register a previously uncontracted player for the remaining current season at the reply boundary');
      } else if (entry.kind === 'midseason-transfer' && version >= 19) {
        const transfer = (transfers as EmploymentTransfer[]).find(item => item.contractId === entry.id);
        if (!current || !transfer || current.clubId !== transfer.fromClubId || transfer.toClubId !== entry.clubId || transfer.playerId !== player.id || startsSeason !== signedSeason || startsRound !== signedRound || signedRound < 2 || transfer.startsRound !== startsRound || transfer.startsSeason !== startsSeason || transfer.seasonNumber !== signedSeason) fail(path, 'must link the current employer, buyer and exact in-season arrival boundary');
        const released = validated.filter(contract => contract.playerId === player.id && contract.clubId === current.clubId && Array.from({ length: Math.max(0, contract.endsSeason - startsSeason + 1) }, (_, offset) => startsSeason + offset).some(year => (year === startsSeason ? contractForRound(prefixEmployment(), player.id, year, startsRound) : contractForSeason(prefixEmployment(), player.id, year))?.id === contract.id));
        if (!sameData(transfer.releasedContractIds, released.map(contract => contract.id))) fail(path, 'must release exactly the selling club\'s effective current and future terms');
        validateClauseTrigger(transfer, current, path);
      } else if (entry.kind === 'renewal') {
        if (!current || current.clubId !== entry.clubId || current.endsSeason !== signedSeason) fail(path, 'must renew an expiring agreement at the same club');
      } else if (entry.kind === 'free-agent') {
        if (signedRound !== 10 || signedSeason === seasonNumber && status !== 'complete') fail(path, 'must be signed during a completed season\'s recruitment window');
        const releasedFuture = current && [...prefixEmployment().transfers, ...prefixEmployment().buyouts].some(release => release.startsSeason === signedSeason + 1 && release.releasedContractIds.includes(current.id));
        if (current && current.clubId === entry.clubId && (current.endsSeason === signedSeason || !releasedFuture)) fail(path, 'must record an ordinary same-club extension as a renewal');
      } else if (entry.kind === 'transfer' && version >= 15) {
        const transfer = (transfers as EmploymentTransfer[]).find(item => item.contractId === entry.id);
        if (!transfer || transfer.playerId !== player.id || transfer.toClubId !== entry.clubId || transfer.seasonNumber !== signedSeason || signedRound !== 10 || transfer.startsSeason !== startsSeason) fail(path, 'must link the transferred player and buying club to a completed offseason transfer');
        const source = contractForSeason(prefixEmployment(), player.id, startsSeason);
        const released = validated.filter(contract => contract.playerId === player.id && contract.clubId === transfer.fromClubId && contract.endsSeason >= startsSeason && ![...prefixEmployment().transfers, ...prefixEmployment().buyouts].some(previous => previous.releasedContractIds.includes(contract.id)));
        if (!source || source.clubId !== transfer.fromClubId || !sameData(transfer.releasedContractIds, released.map(contract => contract.id))) fail(path, 'must release exactly the effective future terms of the selling club');
        validateClauseTrigger(transfer, source, path);
      } else fail(`${path}.kind`, 'must identify an initial agreement, renewal, free-agent signing or transfer');
    }
    if (Array.from({ length: endsSeason - startsSeason + 1 }, (_, offset) => startsSeason + offset).some(year => Array.from({ length: 10 }, (_, offset) => offset + 1).some(round => effectiveContractsForRound(prefixEmployment(entry as unknown as EmploymentContract), year, round).filter(contract => contract.playerId === player.id).length > 1))) fail(path, 'overlaps another effective employment agreement for this player');
    const contract = entry as unknown as EmploymentContract;
    validated.push(contract);
    if (index >= catalog.length) for (let year = startsSeason; year <= endsSeason; year += 1) {
      const annual = effectiveContractsForSeason(prefixEmployment(undefined, index), year).filter(contract => contract.clubId === entry.clubId);
      const wages = annual.reduce((sum, contract) => sum + contract.seasonWage, 0);
      if (annual.length > MAX_ROSTER_SIZE || wages + Math.max(0, MIN_ROSTER_SIZE - annual.length) * MIN_ROSTER_WAGE_RESERVE > EMPLOYMENT_BUDGET) fail(path, 'exceeds the roster limit or annual wage allocation including minimum-squad reserves');
    }
  }
  const employment = normalized;
  if ((transfers as EmploymentTransfer[]).some(transfer => !validated.some(contract => contract.id === transfer.contractId && contract.kind === (transfer.startsRound > 1 ? 'midseason-transfer' : 'transfer')))) fail('employment.transfers', 'must link every transfer to one retained transfer contract');
  for (let year = firstYear; year <= seasonNumber; year += 1) for (const clubId of clubIds) {
    for (let at = 1; at <= (year === seasonNumber ? round : 10); at += 1) {
      const registrations = effectiveContractsForRound(employment, year, at).filter(contract => contract.clubId === clubId);
      if (registrations.length < MIN_ROSTER_SIZE || registrations.length > MAX_ROSTER_SIZE || registrations.reduce((sum, contract) => sum + contract.seasonWage, 0) > EMPLOYMENT_BUDGET) fail('employment.contracts', 'must retain a legal squad and salary allocation at every registration boundary');
    }
  }
  if (!datedMarket && status === 'complete' && seasonNumber < MAX_SEASON_NUMBER) for (const clubId of clubIds) {
    if (clubId === managedClubId && !employment.delegated) continue;
    const retained = effectiveContractsForSeason(employment, seasonNumber + 1).filter(contract => contract.clubId === clubId);
    if (retained.length < MIN_ROSTER_SIZE) fail('employment.contracts', 'must retain the automatic minimum squad when the recruitment window opens');
  }
  return version < 16 ? migrateTransferPayments(employment) : employment;
}

/** Rebuild every dated window from commands; reservations are derived, never trusted balances. */
function validateMarket(value: unknown, state: SeasonState, version: number, snapshots: MarketReplaySnapshot[] = []): SeasonMarket {
  const validDate = (value: unknown, from: string, through: string): value is string => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < from || value > through) return false;
    const timestamp = Date.parse(`${value}T00:00:00.000Z`);
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
  };
  const fields = record(value, 'market', ['model', 'enabledSince', 'windows']);
  if (fields.model !== 'market-1') fail('market.model', 'is unsupported');
  if (!Array.isArray(fields.windows) || fields.windows.length > MAX_SEASON_NUMBER) fail('market.windows', 'must contain a bounded chronological window history');
  if (fields.enabledSince === null) {
    if (!sameData(fields, createMarket())) fail('market', 'must retain its empty default state while disabled');
    return fields as unknown as SeasonMarket;
  }
  const anchor = record(fields.enabledSince, 'market.enabledSince', ['seasonNumber', 'round', 'contractCount', 'negotiationCount']);
  const firstYear = number(anchor.seasonNumber, 'market.enabledSince.seasonNumber', 1, state.seasonNumber);
  const firstRound = number(anchor.round, 'market.enabledSince.round', 1, firstYear === state.seasonNumber ? state.round : 10);
  const contractCount = number(anchor.contractCount, 'market.enabledSince.contractCount', 0, state.employment.contracts.length);
  const negotiation = record(state.negotiations, 'negotiations', ['model', 'enabledSince', 'records']);
  if (!Array.isArray(negotiation.records)) fail('negotiations.records', 'must contain the response journal');
  const negotiationAnchor = record(negotiation.enabledSince, 'negotiations.enabledSince', ['seasonNumber', 'round', 'contractCount']);
  const negotiationCount = number(anchor.negotiationCount, 'market.enabledSince.negotiationCount', 0, negotiation.records.length);
  const firstBoundary = firstYear * 10 + firstRound;
  if ((state.employment.buyouts ?? []).some(buyout => buyout.seasonNumber < firstYear)) fail('employment.buyouts', 'cannot precede the first retained recruitment window');
  if ((state.employment.transfers ?? []).some(transfer => transfer.startsRound === 1 && transfer.seasonNumber < firstYear)) fail('employment.transfers', 'cannot precede the first retained offseason recruitment window');
  if (!state.employment.enabledSince || !state.payroll.enabledSince || !state.finance.enabledSince || !state.negotiations.enabledSince || state.negotiations.enabledSince.seasonNumber * 10 + state.negotiations.enabledSince.round > firstBoundary) fail('market.enabledSince', 'requires contracts, finances, payroll and negotiations active before market activation');
  const baselineContracts = number(negotiationAnchor.contractCount, 'negotiations.enabledSince.contractCount', 0, state.employment.contracts.length);
  const records = state.negotiations.records;
  const activationRecords = records.slice(0, negotiationCount);
  if (contractCount !== baselineContracts + activationRecords.filter(entry => entry.outcome === 'accepted').length) fail('market.enabledSince.contractCount', 'must identify the agreements present at the recorded response boundary');
  for (const [index, entry] of records.entries()) {
    const boundary = entry.seasonNumber * 10 + entry.round;
    if (index < negotiationCount ? boundary > firstBoundary : boundary < firstBoundary) fail('market.enabledSince.negotiationCount', 'must identify the response journal present at activation');
  }
  const lastCompleted = Math.min(MAX_SEASON_NUMBER - 1, state.status === 'complete' ? state.seasonNumber : state.seasonNumber - 1);
  const count = Math.max(0, lastCompleted - firstYear + 1);
  if (fields.windows.length !== count) fail('market.windows', 'must retain every recruitment window since activation');
  const windows: MarketWindow[] = [];
  let eventCount = 0;
  for (const [index, raw] of fields.windows.entries()) {
    const path = `market.windows[${index}]`;
    const window = record(raw, path, ['seasonNumber', 'openedOn', 'closesOn', 'date', 'contractCountBefore', 'negotiationCountBefore', 'closed', 'events', 'offers', ...(version >= 14 ? ['competitionFromEvent'] : [])]);
    const year = firstYear + index, openedOn = dateForRound(10, year), closesOn = addMarketDays(openedOn, MARKET_WINDOW_DAYS);
    if (window.seasonNumber !== year || window.openedOn !== openedOn || window.closesOn !== closesOn) fail(path, 'must identify its canonical completed-season recruitment interval');
    if (!validDate(window.date, openedOn, closesOn)) fail(`${path}.date`, 'must be a real date inside the recruitment window');
    if (window.closed !== (year < state.seasonNumber)) fail(`${path}.closed`, 'must close exactly when the next season begins');
    if (!Array.isArray(window.events) || !Array.isArray(window.offers) || window.offers.length > window.events.length) fail(path, 'must contain bounded command and derived offer histories');
    const competitionFromEvent = version < 14 || window.competitionFromEvent === null ? null : number(window.competitionFromEvent, `${path}.competitionFromEvent`, 0, window.events.length);
    eventCount += window.events.length;
    if (eventCount > MARKET_MAX_EVENTS) fail('market.windows.events', 'exceeds the retained command limit');
    const beforeRecords = records.filter((entry, recordIndex) => entry.seasonNumber < year || entry.seasonNumber === year && (entry.status === 'active' || year === firstYear && recordIndex < negotiationCount));
    const expectedNegotiationCount = beforeRecords.length;
    if (!sameData(beforeRecords, records.slice(0, expectedNegotiationCount))) fail(`${path}.negotiationCountBefore`, 'must identify a chronological response prefix');
    const expectedContractCount = baselineContracts + beforeRecords.filter(entry => entry.outcome === 'accepted').length;
    if (window.negotiationCountBefore !== expectedNegotiationCount || window.contractCountBefore !== expectedContractCount) fail(path, 'must anchor the exact agreements and responses already present before the window');
    const beforeTransfers = (state.employment.transfers ?? []).filter(transfer => transfer.seasonNumber < year || transfer.seasonNumber === year && transfer.startsRound > 1);
    const beforeBuyouts = (state.employment.buyouts ?? []).filter(buyout => buyout.seasonNumber < year);
    // Transfer payments and buyout settlements can book cash during recruitment. Later seasons and this
    // window's fees must not finance earlier proposals while replaying history.
    const beforePaymentIds = new Set(beforeTransfers.flatMap(transfer => transfer.payments.filter(payment => payment.paidOn <= openedOn).map(payment => payment.id)));
    const previousMarketEvents = windows.reduce((sum, item) => sum + item.events.length, 0);
    const beforeLedger = state.finance.ledger.filter(entry => (entry.seasonNumber < year || entry.seasonNumber === year && (entry.kind !== 'buyout' && (entry.kind !== 'transfer' || beforePaymentIds.has(entry.sourceId)))) && (entry.kind !== 'facility' || state.facilities.events[state.facilities.projects.find(project => project.id === entry.sourceId)!.startEventIndex]!.marketEventCount <= previousMarketEvents));
    if (!sameData(beforeLedger, state.finance.ledger.slice(0, beforeLedger.length))) fail(path, 'must open after a contiguous financial history, before the transfer fees for this window');
    const employment = { ...state.employment, contracts: state.employment.contracts.slice(0, expectedContractCount), transfers: beforeTransfers.map(transfer => ({ ...transfer, payments: transfer.payments.filter(payment => beforePaymentIds.has(payment.id)) })), buyouts: beforeBuyouts, market: { seasonNumber: year + 1 } };
    const initialWindow: MarketWindow = { seasonNumber: year, openedOn, closesOn, date: openedOn, contractCountBefore: expectedContractCount, negotiationCountBefore: expectedNegotiationCount, closed: false, competitionFromEvent, events: [], offers: [] };
    let replay: SeasonState = {
      ...state, academy: academyAtBoundary(state.academy, year, 10, expectedContractCount), lifecycle: lifecycleAtBoundary(state.lifecycle, year, 10, expectedContractCount, state.recruitment.events.filter(event => event.seasonNumber <= year).length, windows.reduce((sum, item) => sum + item.events.length, 0), beforeLedger.length, expectedNegotiationCount), seasonNumber: year, round: 10, status: 'complete', date: openedOn, employment,
      negotiations: { ...state.negotiations, records: beforeRecords },
      market: { model: 'market-1', enabledSince: { seasonNumber: firstYear, round: firstRound, contractCount, negotiationCount }, windows: [...windows, initialWindow] },
      conditions: { ...state.conditions },
      finance: { ...state.finance, ledger: beforeLedger }, recruitment: createRecruitment(),
    };
    replay.clubs = getContractedClubs(replay, year);
    const synchronizeFacilities = (count: number, date: string) => {
      // Facilities are independent commands between market decisions. Only their exact paid prefix
      // may enter the next offer quote; later construction cannot finance or cancel an earlier bid.
      while (true) {
        const entry = state.finance.ledger[replay.finance.ledger.length];
        if (!entry || entry.kind !== 'facility') break;
        const project = state.facilities.projects.find(project => project.id === entry.sourceId);
        const event = project && state.facilities.events[project.startEventIndex];
        if (!event || event.seasonNumber !== year || event.marketEventCount > count || event.date > date || event.contractCount > replay.employment.contracts.length || event.negotiationCount > replay.negotiations.records.length) break;
        replay = { ...replay, finance: { ...replay.finance, ledger: [...replay.finance.ledger, entry] } };
      }
      replay.facilities = facilitiesAtPrefix(state, date, replay.finance.ledger.length, replay.employment.contracts.length, replay.negotiations.records.length, state.recruitment.events.filter(event => event.seasonNumber <= year).length, count);
      snapshots.push({ eventCount: count, seasonNumber: year, market: replay.market });
    };
    synchronizeFacilities(previousMarketEvents, openedOn);
    for (const [eventIndex, rawEvent] of window.events.entries()) {
      if (competitionFromEvent === eventIndex && replay.market.windows.at(-1)!.offers.some(isLiveMarketOffer)) fail(`${path}.competitionFromEvent`, 'must begin after all earlier single-offer proposals have resolved');
      const eventPath = `${path}.events[${eventIndex}]`;
      if (!rawEvent || typeof rawEvent !== 'object' || Array.isArray(rawEvent)) fail(eventPath, 'must be a supported market command');
      const type = (rawEvent as Record<string, unknown>).type;
      const event = record(rawEvent, eventPath, type === 'offer' ? ['type', 'id', 'date', 'clubId', 'playerId', 'seasonWage', 'seasons', ...(version >= 15 && Object.hasOwn(rawEvent, 'transferFee') ? ['transferFee'] : []), ...(version >= 16 && Object.hasOwn(rawEvent, 'transferPaymentPlan') ? ['transferPaymentPlan'] : []), ...optionalClauseKeys(rawEvent, version, ['releaseFee', 'transferMode'])] : type === 'withdraw' ? ['type', 'date', 'offerId'] : type === 'advance' ? ['type', 'date'] : version >= 15 && type === 'club-decision' ? ['type', 'date', 'offerId', 'response'] : version >= 17 && type === 'buyout' ? ['type', 'id', 'date', 'clubId', 'playerId'] : []);
      if (!validDate(event.date, openedOn, closesOn)) fail(`${eventPath}.date`, 'must be a real date inside the recruitment window');
      if (type === 'offer') {
        if (typeof event.id !== 'string' || typeof event.clubId !== 'string' || typeof event.playerId !== 'string') fail(eventPath, 'must identify an offer, player and club');
        number(event.seasonWage, `${eventPath}.seasonWage`, MIN_CONTRACT_WAGE, MAX_CONTRACT_WAGE);
        number(event.seasons, `${eventPath}.seasons`, 1, MAX_CONTRACT_SEASONS);
        validateOptionalReleaseFee(event, eventPath);
        validateTransferMode(event, eventPath);
        if (Object.hasOwn(event, 'transferFee')) { const fee = number(event.transferFee, `${eventPath}.transferFee`, 100_000, 50_000_000); if (fee % 100_000) fail(`${eventPath}.transferFee`, 'must use thousand-euro steps'); }
        if (Object.hasOwn(event, 'transferPaymentPlan') && (!Object.hasOwn(event, 'transferFee') || !['upfront', 'two-payments', 'three-payments'].includes(event.transferPaymentPlan as string))) fail(`${eventPath}.transferPaymentPlan`, 'must identify a supported plan on a paid transfer offer');
      } else if (type === 'club-decision' && (typeof event.offerId !== 'string' || !['accept', 'reject', 'counter'].includes(event.response as string))) fail(eventPath, 'must identify a pending club decision and supported response');
      else if (type === 'buyout' && (typeof event.id !== 'string' || typeof event.clubId !== 'string' || typeof event.playerId !== 'string')) fail(eventPath, 'must identify the release, player and club');
      else if (type === 'withdraw' && typeof event.offerId !== 'string') fail(`${eventPath}.offerId`, 'must identify a live proposal');
      synchronizeFacilities(previousMarketEvents + eventIndex, event.date as string);
      replay.lifecycle = lifecycleAtBoundary(state.lifecycle, year, 10, replay.employment.contracts.length, state.recruitment.events.filter(event => event.seasonNumber <= year).length, windows.reduce((sum, item) => sum + item.events.length, 0) + eventIndex, replay.finance.ledger.length, replay.negotiations.records.length);
      try { replay = applyMarketEvent(replay, event as unknown as MarketEvent); }
      catch (error) { fail(eventPath, `does not follow the market rules: ${error instanceof Error ? error.message : 'invalid command'}`); }
    }
    synchronizeFacilities(previousMarketEvents + window.events.length, window.date as string);
    const regenerated = replay.market.windows.at(-1)!;
    if (competitionFromEvent === window.events.length && regenerated.offers.some(isLiveMarketOffer)) fail(`${path}.competitionFromEvent`, 'cannot change the rules of outstanding single-offer proposals');
    const comparable = { ...regenerated, closed: year < state.seasonNumber };
    const noPaymentPlans = version < 16 ? { ...comparable, offers: comparable.offers.map(offer => ({ ...offer, transfer: offer.transfer ? (({ paymentPlan: _plan, ...oldTransfer }) => oldTransfer)(offer.transfer) : null })) } : comparable;
    const noTransfers = version < 15 ? { ...noPaymentPlans, offers: noPaymentPlans.offers.map(({ transfer: _transfer, ...oldOffer }) => oldOffer) } : noPaymentPlans;
    const legacyComparable = version < 14 ? (({ competitionFromEvent: _boundary, ...oldWindow }) => ({ ...oldWindow, offers: oldWindow.offers.map(({ chosenOfferId: _choice, ...oldOffer }) => oldOffer) }))(noTransfers) : noTransfers;
    if (!sameData(legacyComparable, window)) fail(path, 'does not match its replayed dates, deadlines, statuses, player choices and offer reservations');
    const windowRecords = records.filter((entry, recordIndex) => recordIndex >= expectedNegotiationCount && entry.seasonNumber === year && entry.status === 'complete');
    if (!sameData(replay.negotiations.records.slice(expectedNegotiationCount), windowRecords)) fail(`${path}.offers`, 'must explain each offseason response after the window opened');
    if (!sameData(replay.employment.contracts, state.employment.contracts.slice(0, replay.employment.contracts.length))) fail(`${path}.offers`, 'must preserve the exact contracts signed by scheduled responses');
    const expectedTransfers = (state.employment.transfers ?? []).filter(transfer => transfer.seasonNumber <= year).map(transfer => ({ ...transfer, payments: transfer.payments.filter(payment => payment.seasonNumber <= year) }));
    if (!sameData(replay.employment.transfers ?? [], expectedTransfers)) fail(`${path}.offers`, 'must explain every completed transfer and released agreement');
    if (!sameData(replay.employment.buyouts ?? [], (state.employment.buyouts ?? []).filter(buyout => buyout.seasonNumber <= year))) fail(`${path}.events`, 'must explain every exact buyout settlement and released agreement');
    const throughLedger = state.finance.ledger.filter(entry => entry.seasonNumber <= year);
    if (!sameData(replay.finance.ledger, throughLedger)) fail(`${path}.offers`, 'must reproduce each transfer fee exactly once in the accounts of both clubs');
    if (year < state.seasonNumber) {
      if (regenerated.offers.some(isLiveMarketOffer)) fail(path, 'cannot roll into a new season with pending proposals');
      for (const club of replay.clubs) {
        const retained = effectiveContractsForSeason(replay.employment, year + 1).filter(contract => contract.clubId === club.id);
        if (retained.length < MIN_ROSTER_SIZE) fail(path, 'must finish recruitment for every club before rollover');
      }
    }
    windows.push(comparable);
  }
  return fields as unknown as SeasonMarket;
}

interface RecruitmentHolds { eventCount: number; ledgerIndex: number; seasonNumber: number; round: number; negotiationCount: number; offers: SeasonRecruitment['offers']; amounts: Record<string, number> }

function migrateRecruitmentTransfers(recruitment: SeasonRecruitment): SeasonRecruitment {
  return { ...recruitment, transfersEnabledSince: null, offers: recruitment.offers.map(offer => ({ ...offer, seasons: 1, transfer: null })) };
}

/** Commands are replayed against the exact cash and ownership prefix available when issued. */
function validateRecruitment(value: unknown, state: SeasonState, version: number): RecruitmentHolds[] {
  const original = record(value, 'recruitment', ['model', 'enabledSince', 'events', 'offers', ...(version >= 19 ? ['transfersEnabledSince'] : [])]);
  const fields = version >= 19 ? original : { ...original, transfersEnabledSince: null, offers: Array.isArray(original.offers) ? original.offers.map(offer => ({ ...offer, seasons: 1, transfer: null })) : original.offers };
  if (fields.model !== 'recruitment-1' || !Array.isArray(fields.events) || fields.events.length > 20_000 || !Array.isArray(fields.offers) || fields.offers.length > fields.events.length) fail('recruitment', 'must retain a supported bounded command journal');
  if (fields.enabledSince === null) {
    if (!sameData(fields, createRecruitment()) || state.employment.contracts.some(contract => contract.kind === 'midseason' || contract.kind === 'midseason-transfer')) fail('recruitment', 'must retain no in-season commands or agreements while disabled');
    return [];
  }
  const anchor = record(fields.enabledSince, 'recruitment.enabledSince', ['seasonNumber', 'round', 'ledgerIndex', 'contractCount', 'negotiationCount']);
  const firstYear = number(anchor.seasonNumber, 'recruitment.enabledSince.seasonNumber', 1, state.seasonNumber);
  const firstRound = number(anchor.round, 'recruitment.enabledSince.round', 1, firstYear === state.seasonNumber ? state.round : 10);
  const firstBoundary = (firstYear - 1) * 10 + firstRound;
  const lastBoundary = (state.seasonNumber - 1) * 10 + state.round;
  const anchorLedger = number(anchor.ledgerIndex, 'recruitment.enabledSince.ledgerIndex', 0, state.finance.ledger.length);
  const anchorContracts = number(anchor.contractCount, 'recruitment.enabledSince.contractCount', 0, state.employment.contracts.length);
  const anchorNegotiations = number(anchor.negotiationCount, 'recruitment.enabledSince.negotiationCount', 0, state.negotiations.records.length);
  if (!state.employment.enabledSince || !state.finance.enabledSince || !state.payroll.enabledSince || !state.negotiations.enabledSince || [state.employment.enabledSince, state.finance.enabledSince, state.payroll.enabledSince, state.negotiations.enabledSince].some(item => (item.seasonNumber - 1) * 10 + item.round > firstBoundary)) fail('recruitment.enabledSince', 'requires employment, finance, payroll and negotiations already active');
  const baselineContracts = state.negotiations.enabledSince.contractCount;
  const verifyPrefix = (year: number, round: number, ledgerIndex: number, contractCount: number, negotiationCount: number, path: string) => {
    const boundary = (year - 1) * 10 + round;
    if (contractCount !== baselineContracts + state.negotiations.records.slice(0, negotiationCount).filter(entry => entry.outcome === 'accepted').length) fail(path, 'must anchor exactly the contracts explained by the recorded response prefix');
    for (const [index, entry] of state.finance.ledger.entries()) {
      const entryBoundary = (entry.seasonNumber - 1) * 10 + entry.round;
      if (index < ledgerIndex ? entryBoundary > boundary : entryBoundary < boundary) fail(path, 'must identify a contiguous cash prefix on this matchday');
    }
    for (const [index, entry] of state.negotiations.records.entries()) {
      const entryBoundary = (entry.seasonNumber - 1) * 10 + entry.round;
      if (index < negotiationCount ? entryBoundary > boundary || entry.seasonNumber === year && entry.round === round && entry.status === 'complete' : entryBoundary < boundary) fail(path, 'must identify the chronological active-season response prefix');
    }
  };
  verifyPrefix(firstYear, firstRound, anchorLedger, anchorContracts, anchorNegotiations, 'recruitment.enabledSince');
  for (const [index, raw] of (original.offers as unknown[]).entries()) {
    const offer = record(raw, `recruitment.offers[${index}]`, ['id', 'clubId', 'playerId', 'seasonNumber', 'offeredRound', 'responseRound', 'offeredOn', 'responseOn', 'seasonWage', 'remainingWages', 'status', 'respondedOn', 'closedOn', 'negotiationId', 'chosenOfferId', 'reason', ...(version >= 19 ? ['seasons', 'transfer'] : []), ...optionalClauseKeys(raw, version, ['releaseFee']), ...(version >= 25 && Object.hasOwn(raw as object, 'academyProspectId') ? ['academyProspectId'] : [])]);
    if (version >= 19 && offer.transfer !== null) record(offer.transfer, `recruitment.offers[${index}].transfer`, ['sellerClubId', 'contractId', 'fee', 'paymentPlan', 'requiredFee', 'clubStatus', 'clubResponseOn', 'clubRespondedOn', 'clubReason', 'counterFee', ...optionalClauseKeys(offer.transfer, version, ['mode'])]);
  }
  if (fields.transfersEnabledSince !== null) record(fields.transfersEnabledSince, 'recruitment.transfersEnabledSince', ['seasonNumber', 'round', 'ledgerIndex', 'contractCount', 'negotiationCount']);
  let recruitment: SeasonRecruitment = { model: 'recruitment-1', enabledSince: { seasonNumber: firstYear, round: firstRound, ledgerIndex: anchorLedger, contractCount: anchorContracts, negotiationCount: anchorNegotiations }, transfersEnabledSince: null, events: [], offers: [] };
  let boundary = firstBoundary, previousLedger = anchorLedger, previousContracts = anchorContracts, previousNegotiations = anchorNegotiations;
  const holds: RecruitmentHolds[] = [];
  const generatedContracts = new Set<string>(), generatedResponses = new Set<string>(), generatedTransfers = new Set<string>();
  for (const [index, raw] of fields.events.entries()) {
    const path = `recruitment.events[${index}]`;
    const type = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).type : undefined;
    const event = record(raw, path, ['type', 'seasonNumber', 'round', 'date', 'ledgerIndexBefore', 'contractCountBefore', 'negotiationCountBefore', ...(type === 'offer' ? ['id', 'clubId', 'playerId', 'seasonWage', ...(version >= 19 ? ['seasons', 'transferFee', 'transferPaymentPlan'].filter(key => Object.hasOwn(raw as object, key)) : []), ...optionalClauseKeys(raw, version, ['releaseFee', 'transferMode']), ...(version >= 25 && Object.hasOwn(raw as object, 'academyProspectId') ? ['academyProspectId'] : [])] : type === 'withdraw' ? ['offerId'] : version >= 19 && type === 'club-decision' ? ['offerId', 'response'] : [])]);
    if (!['offer', 'withdraw', 'resolve', ...(version >= 19 ? ['enable-transfers', 'club-decision'] : [])].includes(type as string)) fail(`${path}.type`, 'must identify a supported in-season command');
    if (type === 'offer') { validateOptionalReleaseFee(event, path); validateTransferMode(event, path); }
    const year = number(event.seasonNumber, `${path}.seasonNumber`, firstYear, state.seasonNumber), round = number(event.round, `${path}.round`, 1, year === state.seasonNumber ? state.round : 10);
    const eventBoundary = (year - 1) * 10 + round;
    if (eventBoundary !== boundary + (type === 'resolve' ? 1 : 0) || event.date !== dateForRound(round, year)) fail(path, 'must process each successive matchday before new commands at that boundary');
    boundary = eventBoundary;
    const ledgerIndex = number(event.ledgerIndexBefore, `${path}.ledgerIndexBefore`, previousLedger, state.finance.ledger.length);
    const contractCount = number(event.contractCountBefore, `${path}.contractCountBefore`, previousContracts, state.employment.contracts.length);
    const negotiationCount = number(event.negotiationCountBefore, `${path}.negotiationCountBefore`, previousNegotiations, state.negotiations.records.length);
    verifyPrefix(year, round, ledgerIndex, contractCount, negotiationCount, path);
    if (type === 'resolve') {
      const allowed = state.finance.ledger.filter(entry => entry.seasonNumber < year || entry.seasonNumber === year && (entry.round < round || round === 1 && (entry.kind === 'opening' || entry.kind === 'sponsor'))).length;
      if (ledgerIndex !== allowed) fail(`${path}.ledgerIndexBefore`, 'must resolve after the prior matchday and before new matchday discretionary spending');
    }
    const ledger = state.finance.ledger.slice(0, ledgerIndex), sourceIds = new Set(ledger.filter(entry => entry.kind === 'transfer').map(entry => entry.sourceId));
    const contracts = state.employment.contracts.slice(0, contractCount);
    const employment: SeasonEmployment = { ...state.employment, contracts, transfers: state.employment.transfers.filter(transfer => contracts.some(contract => contract.id === transfer.contractId)).map(transfer => ({ ...transfer, payments: transfer.payments.filter(payment => sourceIds.has(payment.id)) })), buyouts: state.employment.buyouts.filter(buyout => ledger.some(entry => entry.kind === 'buyout' && entry.sourceId === buyout.id)), market: null };
    const youthAnchor = state.youthCompetition.enabledSince;
    const youthVisible = !youthAnchor || youthAnchor.seasonNumber * 10 + youthAnchor.round < year * 10 + round || youthAnchor.seasonNumber === year && youthAnchor.round === round && youthAnchor.ledgerIndex <= ledgerIndex && youthAnchor.contractCount <= contractCount && youthAnchor.negotiationCount <= negotiationCount && youthAnchor.recruitmentEventCount <= index;
    const youthCompetition = youthVisible ? youthCompetitionAtBoundary(state.youthCompetition, year, round) : createYouthCompetition();
    const academy = academyAtBoundary(state.academy, year, round, contractCount, !youthVisible && youthAnchor && youthAnchor.seasonNumber === year && youthAnchor.round === round ? youthAnchor.academyIntakeCount : undefined);
    const lifecycle = lifecycleAtBoundary(state.lifecycle, year, round, contractCount, index, state.market.windows.filter(window => window.seasonNumber < year).reduce((sum, window) => sum + window.events.length, 0), ledgerIndex, negotiationCount);
    const catalogContext = { academy, lifecycle, seasonNumber: year, round };
    const clubs = clubsForEmploymentYear(employment, year, round, catalogContext);
    const rosters = createRosterSnapshots(clubsForEmploymentYear(employment, year, 1, catalogContext), year);
    for (let at = 2; at <= round; at += 1) for (const club of clubsForEmploymentYear(employment, year, at, catalogContext)) if (!sameData(rosterForRound(rosters, club.id, at).players, club.players)) rosters.push({ id: `roster-s${year}-${club.id}-r${at}`, clubId: club.id, fromRound: at, players: [...club.players] });
    let replay: SeasonState = { ...state, academy, lifecycle, youthCompetition, conditions: Object.fromEntries(Object.entries(state.conditions).filter(([id]) => getCareerPlayers(catalogContext).some(player => player.id === id))), training: { ...state.training, points: Object.fromEntries(Object.entries(state.training.points).filter(([id]) => getCareerPlayers(catalogContext).some(player => player.id === id))) }, seasonNumber: year, round, date: event.date as string, status: 'active', clubs, rosters, employment, recruitment, finance: { ...state.finance, ledger }, payroll: { ...state.payroll, agreements: state.payroll.agreements.filter(agreement => agreement.seasonNumber < year || agreement.seasonNumber === year && agreement.startsRound <= round && contractForRound(employment, agreement.playerId, year, agreement.startsRound)?.clubId === agreement.clubId) }, negotiations: { ...state.negotiations, records: state.negotiations.records.slice(0, negotiationCount) }, market: createMarket() };
    try { replay = applyInSeasonEvent(replay, event as unknown as InSeasonEvent); }
    catch (error) { fail(path, `does not follow recruitment rules: ${error instanceof Error ? error.message : 'invalid command'}`); }
    if (!sameData(replay.employment.contracts, state.employment.contracts.slice(0, replay.employment.contracts.length)) || !sameData(replay.negotiations.records, state.negotiations.records.slice(0, replay.negotiations.records.length))) fail(path, 'must preserve the exact agreements and player replies generated at this boundary');
    if (!sameData(replay.finance.ledger, state.finance.ledger.slice(0, replay.finance.ledger.length))) fail(path, 'must reproduce the exact transfer debit and seller receipt at this command boundary');
    const replayedSources = new Set(replay.finance.ledger.filter(entry => entry.kind === 'transfer').map(entry => entry.sourceId));
    const expectedTransfers = state.employment.transfers.filter(transfer => replay.employment.contracts.some(contract => contract.id === transfer.contractId)).map(transfer => ({ ...transfer, payments: transfer.payments.filter(payment => replayedSources.has(payment.id)) }));
    if (!sameData(replay.employment.transfers, expectedTransfers)) fail(path, 'must preserve the agreed fee, release references, schedule and actual transfer receipts');
    for (const transfer of replay.employment.transfers.slice(employment.transfers.length)) generatedTransfers.add(transfer.id);
    for (const contract of replay.employment.contracts.slice(contractCount)) generatedContracts.add(contract.id);
    for (const response of replay.negotiations.records.slice(negotiationCount)) generatedResponses.add(response.id);
    recruitment = replay.recruitment;
    previousLedger = replay.finance.ledger.length; previousContracts = replay.employment.contracts.length; previousNegotiations = replay.negotiations.records.length;
    const liveOffers = recruitment.offers.filter(offer => offer.seasonNumber === year && (offer.status === 'pending' || offer.status === 'club-review'));
    holds.push({ eventCount: index + 1, ledgerIndex, seasonNumber: year, round, negotiationCount: replay.negotiations.records.length, offers: liveOffers, amounts: Object.fromEntries(clubs.map(club => [club.id, liveOffers.filter(offer => offer.clubId === club.id).reduce((sum, offer) => sum + offer.remainingWages + (offer.transfer?.fee ?? 0), 0)])) });
  }
  if (boundary !== lastBoundary || !sameData(recruitment, fields)) fail('recruitment', 'must retain every advanced matchday and exactly its replayed offers, choices, reservations and responses');
  if (state.employment.contracts.some(contract => (contract.kind === 'midseason' || contract.kind === 'midseason-transfer') && !generatedContracts.has(contract.id)) || state.negotiations.records.some(entry => entry.startsSeason === entry.seasonNumber && !generatedResponses.has(entry.id)) || state.employment.transfers.some(transfer => transfer.startsRound > 1 && !generatedTransfers.has(transfer.id))) fail('recruitment.events', 'must explain every in-season agreement, transfer and player reply');
  return holds;
}

/** Replay accepted replies against the contract prefix independently of present-day reservations. */
function validateNegotiations(value: unknown, state: SeasonState, recruitmentHolds: RecruitmentHolds[] = [], version = 30): SeasonNegotiations {
  const fields = record(value, 'negotiations', ['model', 'enabledSince', 'records']);
  if (fields.model !== 'negotiations-1') fail('negotiations.model', 'is unsupported');
  if (!Array.isArray(fields.records) || fields.records.length > 20_000) fail('negotiations.records', 'must contain at most 20000 retained offers');
  if (fields.enabledSince === null) {
    if (!sameData(fields, createNegotiations()) || state.employment.contracts.some(contract => Object.hasOwn(contract, 'releaseFee'))) fail('negotiations', 'must retain an empty journal and no unnegotiated release clauses while disabled');
    return fields as unknown as SeasonNegotiations;
  }
  const anchor = record(fields.enabledSince, 'negotiations.enabledSince', ['seasonNumber', 'round', 'contractCount']);
  const firstYear = number(anchor.seasonNumber, 'negotiations.enabledSince.seasonNumber', 1, state.seasonNumber);
  const firstRound = number(anchor.round, 'negotiations.enabledSince.round', 1, firstYear === state.seasonNumber ? state.round : 10);
  const contractCount = number(anchor.contractCount, 'negotiations.enabledSince.contractCount', 0, state.employment.contracts.length);
  const firstBoundary = firstYear * 10 + firstRound, employmentAnchor = state.employment.enabledSince;
  if (!employmentAnchor || employmentAnchor.seasonNumber * 10 + employmentAnchor.round > firstBoundary) fail('negotiations.enabledSince', 'requires player employment to be active before negotiations begin');
  const contracts = state.employment.contracts;
  for (const [index, contract] of contracts.entries()) {
    const boundary = contract.signedSeason * 10 + contract.signedRound;
    if (index < contractCount && boundary > firstBoundary || index >= contractCount && (boundary < firstBoundary || contract.kind === 'initial')) fail('negotiations.enabledSince.contractCount', 'must identify the employment agreements already present at activation');
    if (index < contractCount && Object.hasOwn(contract, 'releaseFee')) fail('negotiations.enabledSince.contractCount', 'cannot hide a release clause agreed before negotiation activation');
  }
  let prefix = contracts.slice(0, contractCount);
  const entries: SeasonNegotiations['records'] = [];
  const conversations = new Map<string, { offeredWage: number; offeredSeasons: number; releaseFee?: number; boundary: number; date: string }>();
  let previousBoundary = firstYear * 22 + firstRound * 2;
  let previousDate = dateForRound(firstRound, firstYear);
  for (const [index, value] of fields.records.entries()) {
    const path = `negotiations.records[${index}]`;
    const entry = record(value, path, ['id', 'clubId', 'playerId', 'seasonNumber', 'round', 'date', 'status', 'startsSeason', 'offeredWage', 'offeredSeasons', 'outcome', 'reason', 'requiredWage', 'counterOffer', 'alternativeOffer', 'contractId', 'contractCountBefore', ...optionalClauseKeys(value, version, ['releaseFee'])]);
    if (entry.id !== `negotiation-${index + 1}`) fail(`${path}.id`, 'must use sequential negotiation identities');
    if (typeof entry.clubId !== 'string' || !DEVELOPMENT_CLUBS.some(club => club.id === entry.clubId)) fail(`${path}.clubId`, 'must identify a club in this league');
    if (typeof entry.playerId !== 'string') fail(`${path}.playerId`, 'must identify an existing career player');
    const year = number(entry.seasonNumber, `${path}.seasonNumber`, firstYear, state.seasonNumber);
    const round = number(entry.round, `${path}.round`, 1, year === state.seasonNumber ? state.round : 10);
    getCareerPlayer(state, entry.playerId, year, round);
    if (entry.status !== 'active' && entry.status !== 'complete') fail(`${path}.status`, 'must identify the calendar phase when the offer was made');
    if (entry.status === 'complete' && (round !== 10 || year === state.seasonNumber && state.status !== 'complete')) fail(`${path}.status`, 'cannot negotiate in an offseason before it begins');
    const boundary = year * 22 + round * 2 + (entry.status === 'complete' ? 1 : 0);
    if (boundary < previousBoundary || typeof entry.date !== 'string' || entry.date < previousDate) fail(path, 'must retain chronological offer order from activation onward');
    previousBoundary = boundary;
    previousDate = entry.date;
    const linkedOffer = state.market?.windows.find(window => window.seasonNumber === year)?.offers.find(offer => offer.negotiationId === entry.id);
    const inSeasonOffer = state.recruitment?.offers.find(offer => offer.negotiationId === entry.id);
    if (linkedOffer ? entry.status !== 'complete' || entry.date !== linkedOffer.respondedOn : entry.date !== dateForRound(round, year)) fail(`${path}.date`, 'must identify the actual offer matchday or replayed market response');
    if (inSeasonOffer ? entry.startsSeason !== year || entry.status !== 'active' || entry.date !== inSeasonOffer.respondedOn || round !== inSeasonOffer.responseRound : entry.startsSeason !== year + 1 || year >= MAX_SEASON_NUMBER) fail(`${path}.startsSeason`, 'must identify the supported season and linked reply boundary');
    const offeredWage = number(entry.offeredWage, `${path}.offeredWage`, MIN_CONTRACT_WAGE, MAX_CONTRACT_WAGE);
    if (offeredWage % WAGE_STEP !== 0) fail(`${path}.offeredWage`, 'must use supported wage increments');
    const offeredSeasons = number(entry.offeredSeasons, `${path}.offeredSeasons`, 1, inSeasonOffer ? Math.min(MAX_CONTRACT_SEASONS, MAX_SEASON_NUMBER - year + 1) : Math.min(MAX_CONTRACT_SEASONS, MAX_SEASON_NUMBER - year));
    validateOptionalReleaseFee(entry, path);
    const releaseFee = entry.releaseFee as number | undefined;
    const conversation = `${entry.clubId}/${entry.playerId}/${entry.startsSeason}`, previous = conversations.get(conversation);
    if (previous?.offeredWage === offeredWage && previous.offeredSeasons === offeredSeasons && previous.releaseFee === releaseFee && previous.boundary === boundary && previous.date === entry.date) fail(path, 'duplicates the unchanged latest offer in this negotiation at this boundary');
    if (entry.contractCountBefore !== prefix.length) fail(`${path}.contractCountBefore`, 'must identify the complete employment history when this offer was submitted');
    const replay: SeasonState = {
      ...state, academy: academyAtBoundary(state.academy, year, round, prefix.length), lifecycle: lifecycleAtBoundary(state.lifecycle, year, round, prefix.length, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, index), seasonNumber: year, round, date: entry.date as string, status: entry.status,
      employment: { ...state.employment, contracts: prefix, transfers: (state.employment.transfers ?? []).filter(transfer => prefix.some(contract => contract.id === transfer.contractId)), buyouts: (state.employment.buyouts ?? []).filter(buyout => buyout.negotiationCountBefore <= index && buyout.completedOn <= (entry.date as string)), market: entry.status === 'complete' ? { seasonNumber: year + 1 } : null },
      negotiations: { model: 'negotiations-1', enabledSince: { seasonNumber: firstYear, round: firstRound, contractCount }, records: entries },
      market: createMarket(),
      recruitment: { ...createRecruitment(), offers: recruitmentHolds.filter(hold => hold.negotiationCount <= index && (hold.seasonNumber < year || hold.seasonNumber === year && hold.round <= round)).at(-1)?.offers ?? [] },
    };
    replay.clubs = getContractedClubsForRound(replay, year, round);
    const quote = quotePlayerContract(replay, entry.playerId, offeredWage, offeredSeasons, entry.clubId, undefined, undefined, 'upfront', releaseFee === undefined ? {} : { releaseFee });
    if (!inSeasonOffer && !linkedOffer?.transfer && !quote.canOffer) fail(path, 'must satisfy ownership, signing-window, overlap, roster and budget rules when submitted');
    const expected = evaluateNegotiation(entry.playerId, offeredWage, offeredSeasons, releaseFee, replay);
    const decision = { outcome: entry.outcome, reason: entry.reason, requiredWage: entry.requiredWage, counterOffer: entry.counterOffer, alternativeOffer: entry.alternativeOffer };
    if (!sameData(decision, expected)) fail(path, 'must preserve the canonical player response and offered alternatives');
    if (entry.outcome === 'accepted') {
      const contract = contracts[prefix.length];
      if (!contract || entry.contractId !== contract.id || contract.playerId !== entry.playerId || contract.clubId !== entry.clubId || contract.signedSeason !== year || contract.signedRound !== round || contract.startsSeason !== entry.startsSeason || contract.endsSeason !== (entry.startsSeason as number) + offeredSeasons - 1 || contract.seasonWage !== offeredWage || contract.releaseFee !== releaseFee) fail(`${path}.contractId`, 'must identify the next employment agreement with exactly the accepted terms');
      prefix = [...prefix, contract];
    } else if (entry.contractId !== null) fail(`${path}.contractId`, 'cannot attach an employment agreement to an unaccepted offer');
    conversations.set(conversation, { offeredWage, offeredSeasons, releaseFee, boundary, date: entry.date });
    entries.push(entry as unknown as SeasonNegotiations['records'][number]);
  }
  if (prefix.length !== contracts.length) fail('negotiations.records', 'must explain every employment agreement signed after negotiation activation');
  return fields as unknown as SeasonNegotiations;
}

/** Reports preserve what was observed at a committed fixture, never current hidden ratings. */
function validateScouting(value: unknown, state: SeasonState, version: number): SeasonScouting {
  const fields = record(value, 'scouting', ['model', 'enabledSince', 'clubs']);
  if (fields.model !== 'scouting-1') fail('scouting.model', 'is unsupported');
  if (fields.enabledSince === null) {
    if (!sameData(fields, createScouting(state.clubs, state.managedClubId))) fail('scouting', 'must retain empty default scouting offices while disabled');
    return fields as unknown as SeasonScouting;
  }
  const anchor = record(fields.enabledSince, 'scouting.enabledSince', ['seasonNumber', 'round']);
  const firstYear = number(anchor.seasonNumber, 'scouting.enabledSince.seasonNumber', 1, state.seasonNumber);
  const firstRound = number(anchor.round, 'scouting.enabledSince.round', 1, firstYear === state.seasonNumber ? state.round : 10);
  const firstBoundary = firstYear * 10 + firstRound;
  const committedRound = state.status === 'complete' ? 10 : state.round - 1;
  const catalog = getCareerPlayers(state);
  const catalogById = new Map(catalog.map(player => [player.id, player]));
  const clubIds = state.clubs.map(club => club.id);
  const offices = record(fields.clubs, 'scouting.clubs', clubIds);
  const registrations = new Map<number, readonly RosterSnapshot[]>(state.history.map(archive => [archive.seasonNumber, archive.rosters]));
  registrations.set(state.seasonNumber, state.rosters);
  const results = new Map<number, readonly (SeasonFixture | ArchivedFixture)[]>(state.history.map(archive => [archive.seasonNumber, archive.fixtures]));
  results.set(state.seasonNumber, state.fixtures);
  const observedRatings: Array<{ playerId: string; boundary: number; attributes: Record<string, unknown>; loss: TrainingPoints; path: string }> = [];
  const scoutMissions = new Set<string>();
  function observer(entry: Record<string, unknown>, year: number, round: number, clubId: string, path: string, completed: boolean): string | null {
    const enabled = state.scouts.enabledSince;
    const boundary = year * 10 + round;
    if (!Object.hasOwn(entry, 'observer')) {
      if (enabled && boundary > enabled.seasonNumber * 10 + enabled.round) fail(`${path}.observer`, 'must retain the observer selected after scout recruitment activation');
      return null;
    }
    if (!enabled || boundary < enabled.seasonNumber * 10 + enabled.round) fail(`${path}.observer`, 'cannot precede scout recruitment activation');
    const source = record(entry.observer, `${path}.observer`, ['contractId', 'scoutId', 'evidence', 'assignedLedgerIndex']);
    const assigned = number(source.assignedLedgerIndex, `${path}.observer.assignedLedgerIndex`, enabled.ledgerIndex, state.finance.ledger.length);
    validateLedgerBoundary(state.finance.ledger, assigned, year, round, `${path}.observer.assignedLedgerIndex`);
    const commitIndexes = state.finance.ledger.flatMap((item, index) => item.seasonNumber === year && item.round === round && (item.kind === 'tickets' || item.kind === 'operations' || item.kind === 'payroll' && item.payroll?.type === 'installment') ? [index] : []);
    if (commitIndexes.length && assigned > commitIndexes[0]!) fail(`${path}.observer.assignedLedgerIndex`, 'must assign the observation before its matchday result is financially committed');
    if (source.contractId === null) {
      if (source.scoutId !== null || source.evidence !== 100) fail(`${path}.observer`, 'must preserve the baseline observation source and evidence');
      return null;
    }
    const contract = state.scouts.contracts.find(contract => contract.id === source.contractId);
    const scout = DEVELOPMENT_SCOUTS.find(scout => scout.id === source.scoutId);
    if (!contract || !scout || contract.scoutId !== scout.id || contract.clubId !== clubId || contract.seasonNumber !== year || contract.startedRound > round || contract.hiredLedgerIndex >= assigned || source.evidence !== scoutEvidence(scout)) fail(`${path}.observer`, 'must preserve the appointed scout and catalog evidence at the actual assignment boundary');
    if (contract.releasedRound !== null && (contract.releasedRound < round || !completed || assigned >= contract.releasedLedgerIndex! || !commitIndexes.length || contract.releasedLedgerIndex! <= commitIndexes.at(-1)!)) fail(`${path}.observer`, 'cannot retain work cancelled before the observation was completed');
    const mission = `${year}/${round}/${scout.id}`;
    if (scoutMissions.has(mission)) fail(`${path}.observer`, 'cannot assign one named scout to multiple players on the same matchday');
    scoutMissions.add(mission);
    return scout.id;
  }

  function observation(value: unknown, path: string, review: boolean) {
    const entry = record(value, path, ['playerId', 'seasonNumber', 'round', 'date', 'clubId', 'rosterId', 'attributes', ...(review ? ['outcome'] : []), ...(review && version >= 21 && value !== null && typeof value === 'object' && Object.hasOwn(value, 'observer') ? ['observer'] : [])]);
    const player = catalogById.get(entry.playerId as string);
    if (!player) fail(`${path}.playerId`, 'must identify a player in the stable catalog');
    const year = number(entry.seasonNumber, `${path}.seasonNumber`, firstYear, state.seasonNumber);
    const round = number(entry.round, `${path}.round`, 1, year === state.seasonNumber ? state.round : 10);
    if (year * 10 + round < firstBoundary) fail(path, 'cannot precede scouting activation');
    if (entry.date !== dateForRound(round, year)) fail(`${path}.date`, 'must identify the observed matchday');
    const snapshots = registrations.get(year);
    const snapshot = snapshots?.some(roster => roster.clubId === entry.clubId) ? rosterForRound(snapshots, entry.clubId as string, round) : undefined;
    if (!snapshot || !snapshot.players.some(member => member.id === player.id) || entry.rosterId !== snapshot.id) fail(path, 'must identify the player\'s registered club and roster at observation');
    if (review) {
      if (year === state.seasonNumber && round > committedRound) fail(path, 'requires a committed fixture before a review is available');
      const fixture = results.get(year)?.find(fixture => fixture.round === round && [fixture.homeClubId, fixture.awayClubId].includes(snapshot.clubId));
      const stats = fixture?.result?.stats?.[player.id];
      if (!stats) fail(path, 'must reference an available recorded player appearance');
      const expectedOutcome = stats.secondsPlayed > 0 ? 'observed' : 'no-minutes';
      if (entry.outcome !== expectedOutcome) fail(`${path}.outcome`, 'must match whether the player appeared in the recorded fixture');
      if (expectedOutcome === 'no-minutes') {
        if (entry.attributes !== null) fail(`${path}.attributes`, 'cannot reveal ratings without an observed appearance');
        return { entry, player, year, round, snapshot };
      }
    }
    const attributes = record(entry.attributes, `${path}.attributes`, TRAINING_ATTRIBUTES);
    const loss = getPlayerAging(state, player.id, entry.date as string).skillLoss;
    for (const attribute of TRAINING_ATTRIBUTES) {
      const points = state.training.points[player.id]![attribute];
      const current = Math.max(1, Math.min(20, player.attributes[attribute] + Math.floor(points / 100)) - loss[attribute]);
      const rating = number(attributes[attribute], `${path}.attributes.${attribute}`, Math.max(1, player.attributes[attribute] - loss[attribute]), current);
      const week = state.training.lastWeek;
      if (year === state.seasonNumber && round === state.round) {
        if (rating !== current) fail(`${path}.attributes.${attribute}`, 'must reflect the current observed development');
      } else if (year === state.seasonNumber && week?.afterRound === round) {
        const prior = Math.max(1, Math.min(20, player.attributes[attribute] + Math.floor((points - (week.players[player.id]?.gains[attribute] ?? 0)) / 100)) - loss[attribute]);
        if (rating !== prior) fail(`${path}.attributes.${attribute}`, 'must preserve ratings before the following training interval');
      }
    }
    observedRatings.push({ playerId: player.id, boundary: year * 10 + round, attributes, loss, path });
    return { entry, player, year, round, snapshot };
  }

  for (const club of state.clubs) {
    const path = `scouting.clubs.${club.id}`;
    const office = record(offices[club.id], path, ['delegated', 'shortlist', 'assignments', 'reviews', 'squadKnowledge']);
    if (typeof office.delegated !== 'boolean') fail(`${path}.delegated`, 'must be boolean');
    if (!Array.isArray(office.shortlist) || office.shortlist.length > catalog.length || new Set(office.shortlist).size !== office.shortlist.length || office.shortlist.some(id => typeof id !== 'string' || !catalogById.has(id))) fail(`${path}.shortlist`, 'must contain distinct known player identities');
    const capacity = 2 + state.scouts.contracts.filter(contract => contract.clubId === club.id && contract.seasonNumber === state.seasonNumber && contract.releasedRound === null).length;
    if (!Array.isArray(office.assignments) || office.assignments.length > capacity) fail(`${path}.assignments`, 'exceeds the baseline and active named-scout observation capacity');
    const pending = new Set<string>();
    let baselineAssignments = 0;
    for (const [index, value] of office.assignments.entries()) {
      const location = `${path}.assignments[${index}]`;
      const assignment = record(value, location, ['playerId', 'seasonNumber', 'round', ...(version >= 21 && value !== null && typeof value === 'object' && Object.hasOwn(value, 'observer') ? ['observer'] : [])]);
      if (state.status !== 'active' || assignment.seasonNumber !== state.seasonNumber || assignment.round !== state.round) fail(location, 'must identify the current active matchday');
      const target = state.clubs.find(candidate => candidate.players.some(player => player.id === assignment.playerId));
      if (!target || target.id === club.id || typeof assignment.playerId !== 'string' || pending.has(assignment.playerId)) fail(location, 'must identify a distinct registered player outside the observing club');
      pending.add(assignment.playerId);
      if (observer(assignment, state.seasonNumber, state.round, club.id, location, false) === null && ++baselineAssignments > 2) fail(location, 'exceeds the two baseline observations for this matchday');
    }
    if (!Array.isArray(office.reviews) || office.reviews.length > 20_000) fail(`${path}.reviews`, 'must retain a bounded report history');
    const missions = new Set<string>(), perRound = new Map<number, number>();
    let previousBoundary = firstBoundary;
    for (const [index, value] of office.reviews.entries()) {
      const location = `${path}.reviews[${index}]`, report = observation(value, location, true);
      if (report.snapshot.clubId === club.id) fail(location, 'must observe an outsider at the recorded boundary');
      const boundary = report.year * 10 + report.round;
      if (boundary < previousBoundary) fail(location, 'must retain chronological report order');
      previousBoundary = boundary;
      const mission = `${boundary}/${report.player.id}`;
      if (missions.has(mission)) fail(location, 'duplicates a matchday assignment');
      missions.add(mission);
      if (observer(report.entry, report.year, report.round, club.id, location, true) === null) {
        const count = (perRound.get(boundary) ?? 0) + 1; perRound.set(boundary, count);
        if (count > 2) fail(location, 'exceeds the two baseline observations for this matchday');
      }
    }
    // Own-squad memories survive departure at their last actual observation boundary.
    const lastOwned = new Map<string, { year: number; round: number }>();
    for (let year = firstYear; year <= state.seasonNumber; year += 1) {
      const snapshots = registrations.get(year);
      const arrivalRefresh = state.rosters.some(roster => roster.fromRound === state.round && roster.fromRound > 1) ? state.round : 1;
      const through = year === state.seasonNumber ? Math.max(1, committedRound, firstYear === year ? firstRound : 1, arrivalRefresh) : 10;
      for (let observedRound = year === firstYear ? firstRound : 1; observedRound <= through; observedRound += 1) {
        const snapshot = snapshots ? rosterForRound(snapshots, club.id, observedRound) : undefined;
        for (const player of snapshot?.players ?? []) lastOwned.set(player.id, { year, round: observedRound });
      }
    }
    const knowledge = record(office.squadKnowledge, `${path}.squadKnowledge`, [...lastOwned.keys()]);
    for (const [playerId, last] of lastOwned) {
      const location = `${path}.squadKnowledge.${playerId}`, known = observation(knowledge[playerId], location, false);
      if (known.player.id !== playerId || known.snapshot.clubId !== club.id || known.year !== last.year || known.round !== last.round) fail(location, 'must retain the latest observation while this player belonged to the club');
    }
  }
  // Practice remains monotonic while dated aging can lower observed skills. At the floor,
  // retain the feasible developed-rating interval instead of inventing lost training history.
  const previousRatings = new Map<string, typeof observedRatings[number]>(), minimumDeveloped = new Map<string, number>();
  for (const observed of observedRatings.sort((left, right) => left.boundary - right.boundary)) {
    const previous = previousRatings.get(observed.playerId), player = catalogById.get(observed.playerId)!;
    for (const attribute of TRAINING_ATTRIBUTES) {
      const rating = observed.attributes[attribute] as number, loss = observed.loss[attribute];
      if (previous && observed.boundary === previous.boundary && rating !== previous.attributes[attribute]) fail(`${observed.path}.attributes.${attribute}`, 'must agree with simultaneous observations');
      const lower = rating > 1 ? rating + loss : player.attributes[attribute];
      const upper = rating > 1 ? lower : Math.min(20, player.attributes[attribute] + Math.floor(state.training.points[player.id]![attribute] / 100), loss + 1);
      const key = `${player.id}/${attribute}`, possible = Math.max(lower, minimumDeveloped.get(key) ?? player.attributes[attribute]);
      if (possible > upper) fail(`${observed.path}.attributes.${attribute}`, 'must preserve non-decreasing development after accounting for dated aging');
      minimumDeveloped.set(key, possible);
    }
    previousRatings.set(observed.playerId, observed);
  }
  return fields as unknown as SeasonScouting;
}

/** Retained terms identify every obligation, including those from previous seasons. */
function validatePayroll(value: unknown, clubs: readonly Team[], seasonNumber: number, round: number, managedClubId: string, ledgerLength: number, employment?: SeasonEmployment, context: CareerPlayerContext = {}): SeasonPayroll {
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
  const expectedAgreements: PlayerWageAgreement[] = [];
  for (let year = firstYear; year <= seasonNumber; year += 1) {
    const fromRound = year === firstYear ? firstRound : 1, throughRound = year === seasonNumber ? round : 10;
    for (const club of clubsForEmploymentYear(employment, year, fromRound, context)) for (const player of club.players) {
      const contract = employment ? contractForRound(employment, player.id, year, fromRound) : undefined;
      expectedAgreements.push({ id: `wage-s${year}-${player.id}`, playerId: player.id, clubId: club.id, seasonNumber: year, startsRound: fromRound, seasonWage: contract?.seasonWage ?? getCareerWage(context, player.id) });
    }
    for (const contract of employment?.contracts ?? []) if ((contract.kind === 'midseason' || contract.kind === 'midseason-transfer') && contract.startsSeason === year && contract.startsRound > fromRound && contract.startsRound <= throughRound) expectedAgreements.push({ id: `wage-s${year}-${contract.playerId}${contract.kind === 'midseason-transfer' ? `-r${contract.startsRound}` : ''}`, playerId: contract.playerId, clubId: contract.clubId, seasonNumber: year, startsRound: contract.startsRound, seasonWage: contract.seasonWage });
  }
  const agreements = array(fields.agreements, 'payroll.agreements', expectedAgreements.length);
  for (const [index, value] of agreements.entries()) {
    const path = `payroll.agreements[${index}]`;
    const agreement = record(value, path, ['id', 'playerId', 'clubId', 'seasonNumber', 'startsRound', 'seasonWage']);
    const expected = expectedAgreements[index]!;
    if (!sameData(agreement, expected)) fail(path, 'must retain the canonical player, club, season and wage terms from activation onward');
  }
  return fields as unknown as SeasonPayroll;
}

/** Reconcile required career cash events against the calendar; no balance is trusted from a save. */
function validateFinance(value: unknown, clubs: readonly Team[], fixtures: SeasonFixture[], archives: SeasonArchive[], coaching: SeasonCoaching, seasonNumber: number, round: number, status: SeasonState['status'], managedClubId: string, payroll?: SeasonPayroll, employment?: SeasonEmployment, recruitmentHolds: RecruitmentHolds[] = [], scouts: SeasonScouts = createScouts(), fitness: SeasonFitness = createFitness(), physio: SeasonPhysio = createPhysio(), assistant: SeasonAssistant = createAssistant(), youth: SeasonYouth = createYouth(), version = 30, facilities: SeasonFacilities = createFacilities(clubs, managedClubId)): void {
  const fields = record(value, 'finance', ['model', 'enabledSince', 'plans', 'roundPrices', 'ledger', ...(version >= 28 && Object.hasOwn(value as object, 'roundCapacities') ? ['roundCapacities'] : [])]);
  if (fields.model !== 'finance-1') fail('finance.model', 'is unsupported');
  const clubIds = clubs.map(club => club.id);
  const plans = record(fields.plans, 'finance.plans', clubIds), prices = record(fields.roundPrices, 'finance.roundPrices', clubIds);
  for (const club of clubs) {
    const plan = record(plans[club.id], `finance.plans.${club.id}`, ['delegated', 'price']);
    if (typeof plan.delegated !== 'boolean') fail(`finance.plans.${club.id}.delegated`, 'must be boolean');
    validateTicketPrice(plan.price, `finance.plans.${club.id}.price`);
    validateTicketPrice(prices[club.id], `finance.roundPrices.${club.id}`);
  }
  if (facilities.enabledSince) {
    const capacities = record(fields.roundCapacities, 'finance.roundCapacities', clubIds);
    for (const club of clubs) if (capacities[club.id] !== getArenaCapacity({ facilities }, club.id, dateForRound(round, seasonNumber))) fail(`finance.roundCapacities.${club.id}`, 'must retain the capacity locked for the prepared fixture');
  } else if (Object.hasOwn(fields, 'roundCapacities')) fail('finance.roundCapacities', 'must be absent while facilities are disabled');
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

  for (const project of facilities.projects) {
    const event = facilities.events[project.startEventIndex]!;
    add({ clubId: project.clubId, seasonNumber: event.seasonNumber, round: event.round, kind: 'facility', sourceId: project.id, amount: -project.cost });
  }
  if (facilities.enabledSince) for (let year = facilities.enabledSince.seasonNumber; year <= seasonNumber; year += 1) {
    const from = year === facilities.enabledSince.seasonNumber ? facilities.enabledSince.round : 1, through = year === seasonNumber ? committedRound : 10;
    for (let at = from; at <= through; at += 1) for (const club of clubs) {
      const date = dateForRound(at, year), upkeep = getFacilityUpkeepBreakdown({ facilities }, club.id, date);
      if (upkeep.total) add({ clubId: club.id, seasonNumber: year, round: at, kind: 'facility-upkeep', sourceId: `facility-upkeep-s${year}-r${at}`, amount: -upkeep.total });
    }
  }

  const transferReceipts = new Map((employment?.transfers ?? []).flatMap(transfer => transfer.payments.map((payment, paymentIndex) => [payment.id, { transfer, payment, paymentIndex }] as const)));
  const transferIndexes = new Map((employment?.transfers ?? []).map(transfer => [transfer.id, (fields.ledger as FinanceEntry[]).findIndex(entry => entry.kind === 'transfer' && entry.sourceId === transfer.id && entry.amount < 0)]));
  for (const { transfer, payment } of transferReceipts.values()) {
    add({ clubId: transfer.fromClubId, seasonNumber: payment.seasonNumber, round: payment.round, kind: 'transfer', sourceId: payment.id, amount: payment.amount });
    add({ clubId: transfer.toClubId, seasonNumber: payment.seasonNumber, round: payment.round, kind: 'transfer', sourceId: payment.id, amount: -payment.amount });
  }
  const buyoutRecords = new Map((employment?.buyouts ?? []).map(buyout => [buyout.id, buyout]));
  for (const buyout of buyoutRecords.values()) add({ clubId: buyout.clubId, seasonNumber: buyout.seasonNumber, round: 10, kind: 'buyout', sourceId: buyout.id, amount: -buyout.amount });
  const scoutContracts = new Map(scouts.contracts.map(contract => [contract.id, contract]));
  for (const contract of scouts.contracts) add({ clubId: contract.clubId, seasonNumber: contract.seasonNumber, round: contract.startedRound, kind: 'scouting', sourceId: `scouting-${contract.id}`, amount: -DEVELOPMENT_SCOUTS.find(scout => scout.id === contract.scoutId)!.fee });
  const fitnessContracts = new Map(fitness.contracts.map(contract => [contract.id, contract]));
  for (const contract of fitness.contracts) add({ clubId: contract.clubId, seasonNumber: contract.seasonNumber, round: contract.startedRound, kind: 'fitness', sourceId: `fitness-${contract.id}`, amount: -DEVELOPMENT_FITNESS_COACHES.find(coach => coach.id === contract.coachId)!.fee });
  const physioContracts = new Map(physio.contracts.map(contract => [contract.id, contract]));
  for (const contract of physio.contracts) add({ clubId: contract.clubId, seasonNumber: contract.seasonNumber, round: contract.startedRound, kind: 'physio', sourceId: `physio-${contract.id}`, amount: -DEVELOPMENT_PHYSIOS.find(coach => coach.id === contract.physioId)!.fee });
  const assistantContracts = new Map(assistant.contracts.map(contract => [contract.id, contract]));
  for (const contract of assistant.contracts) add({ clubId: contract.clubId, seasonNumber: contract.seasonNumber, round: contract.startedRound, kind: 'assistant', sourceId: `assistant-${contract.id}`, amount: -DEVELOPMENT_ASSISTANTS.find(coach => coach.id === contract.assistantId)!.fee });
  const youthContracts = new Map(youth.contracts.map(contract => [contract.id, contract]));
  for (const contract of youth.contracts) add({ clubId: contract.clubId, seasonNumber: contract.seasonNumber, round: contract.startedRound, kind: 'youth', sourceId: `youth-${contract.id}`, amount: -DEVELOPMENT_YOUTH_COACHES.find(coach => coach.id === contract.coachId)!.fee });

  const wageGroups = new Map<string, PlayerWageAgreement[]>(), remainingWages = new Map<string, number>(), prepaid = new Set<string>();
  const wageGroup = (year: number, clubId: string) => `${year}/${clubId}`;
  for (const agreement of payroll?.agreements ?? []) {
    const key = wageGroup(agreement.seasonNumber, agreement.clubId), group = wageGroups.get(key) ?? [];
    group.push(agreement); wageGroups.set(key, group);
    const gross = agreement.seasonWage - Math.floor((agreement.startsRound - 1) * agreement.seasonWage / 10);
    remainingWages.set(agreement.id, gross);
  }
  if (payrollAnchor) for (let year = payrollAnchor.seasonNumber; year <= seasonNumber; year += 1) {
    const from = year === payrollAnchor.seasonNumber ? payrollAnchor.round : 1, through = year === seasonNumber ? committedRound : 10;
    for (let paidRound = from; paidRound <= through; paidRound += 1) for (const club of clubs) add({ clubId: club.id, seasonNumber: year, round: paidRound, kind: 'payroll', sourceId: `payroll-s${year}-r${paidRound}` });
  }
  const agreementActive = (agreement: PlayerWageAgreement, index: number, atRound: number) => {
    if (agreement.startsRound > atRound) return false;
    const transfers = (employment?.transfers ?? []).filter(transfer => (transferIndexes.get(transfer.id) ?? -1) >= 0 && transferIndexes.get(transfer.id)! <= index);
    if (atRound > agreementThroughRound({ employment: employment ? { ...employment, transfers } : undefined }, agreement)) return false;
    const incoming = (employment?.transfers ?? []).find(transfer => transfer.startsSeason === agreement.seasonNumber && transfer.startsRound > 1 && transfer.startsRound === agreement.startsRound && transfer.playerId === agreement.playerId && transfer.toClubId === agreement.clubId);
    return !incoming || transfers.some(transfer => transfer.id === incoming.id);
  };
  const wageReserve = (year: number, clubId: string, index: number, atRound: number) => payrollAnchor && index >= payrollAnchor.ledgerIndex ? (wageGroups.get(wageGroup(year, clubId)) ?? []).filter(agreement => agreementActive(agreement, index, atRound)).reduce((sum, agreement) => sum + (remainingWages.get(agreement.id) ?? 0), 0) : 0;
  const recruitmentReserve = (year: number, clubId: string, index: number) => recruitmentHolds.filter(hold => hold.seasonNumber === year && hold.ledgerIndex <= index).at(-1)?.amounts[clubId] ?? 0;
  function chargeGross(agreement: PlayerWageAgreement, gross: number): void {
    const remaining = remainingWages.get(agreement.id)!;
    if (gross > remaining) fail('finance.ledger.payroll', 'cannot charge more than the remaining wage obligation');
    remainingWages.set(agreement.id, remaining - gross);
  }

  const seen = new Set<string>(), coachOrigins = new Set<string>(), feeTotals = new Map<string, number>(), financialCommitRounds = new Set<number>();
  const paidTransferTotals = new Map<string, number>();
  const paidTransferCounts = new Map<string, number>();
  const currentContracts = new Map(coaching.contracts.map(contract => [contract.id, contract]));
  const balances = new Map<string, FinanceBalance>(clubs.map(club => [club.id, { cash: 0, unpaid: 0 }]));
  const maximumContracts = clubs.length * Math.floor(COACHING_BUDGET / Math.min(...DEVELOPMENT_COACHES.map(coach => coach.fee)));
  let previousDate = firstYear * 10 + firstRound, entryYear = firstYear, yearIndex = 0;
  for (const [index, value] of fields.ledger.entries()) {
    const path = `finance.ledger[${index}]`;
    const entry = record(value, path, ['id', 'clubId', 'seasonNumber', 'round', 'kind', 'amount', 'sourceId', 'ticket', 'coach', ...(payroll ? ['payroll'] : []), ...(version >= 21 && value !== null && typeof value === 'object' && Object.hasOwn(value, 'scout') ? ['scout'] : []), ...(version >= 22 && value !== null && typeof value === 'object' && Object.hasOwn(value, 'fitness') ? ['fitness'] : []), ...(version >= 23 && value !== null && typeof value === 'object' && Object.hasOwn(value, 'physio') ? ['physio'] : []), ...(version >= 24 && value !== null && typeof value === 'object' && Object.hasOwn(value, 'assistant') ? ['assistant'] : []), ...(version >= 25 && value !== null && typeof value === 'object' && Object.hasOwn(value, 'youth') ? ['youth'] : []), ...(version >= 28 && value !== null && typeof value === 'object' ? ['facility', 'facilityUpkeep'].filter(key => Object.hasOwn(value, key)) : [])]);
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
    if (!['opening', 'sponsor', 'operations', 'tickets', 'coaching', ...(version >= 21 ? ['scouting'] : []), ...(version >= 22 ? ['fitness'] : []), ...(version >= 23 ? ['physio'] : []), ...(version >= 24 ? ['assistant'] : []), ...(version >= 25 ? ['youth'] : []), ...(version >= 28 ? ['facility', 'facility-upkeep'] : []), ...(payroll ? ['payroll'] : []), ...(employment?.transfers ? ['transfer'] : []), ...(employment?.buyouts ? ['buyout'] : [])].includes(entry.kind as string)) fail(`${path}.kind`, 'is unsupported');
    const kind = entry.kind as FinanceEntry['kind'];
    if (kind !== 'scouting' && Object.hasOwn(entry, 'scout')) fail(`${path}.scout`, 'must be absent from other financial events');
    if (kind !== 'fitness' && Object.hasOwn(entry, 'fitness')) fail(`${path}.fitness`, 'must be absent from other financial events');
    if (kind !== 'physio' && Object.hasOwn(entry, 'physio')) fail(`${path}.physio`, 'must be absent from other financial events');
    if (kind !== 'assistant' && Object.hasOwn(entry, 'assistant')) fail(`${path}.assistant`, 'must be absent from other financial events');
    if (kind !== 'facility' && Object.hasOwn(entry, 'facility')) fail(`${path}.facility`, 'must be absent from other financial events');
    if (kind !== 'facility-upkeep' && Object.hasOwn(entry, 'facilityUpkeep')) fail(`${path}.facilityUpkeep`, 'must be absent from other financial events');
    if (kind !== 'youth' && Object.hasOwn(entry, 'youth')) fail(`${path}.youth`, 'must be absent from other financial events');
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
    if (kind === 'facility' || kind === 'facility-upkeep') {
      if (entry.ticket !== null || entry.coach !== null) fail(path, 'must not mix facilities and unrelated payment details');
      const expected = required.get(key);
      if (!expected || expected.kind !== kind || expected.seasonNumber !== year || expected.round !== entryRound || expected.amount !== amount) fail(path, 'must match one exact funded project or dated upkeep charge');
      if (kind === 'facility') {
        const details = record(entry.facility, `${path}.facility`, ['projectId', 'type']);
        const project = facilities.projects.find(project => project.id === details.projectId);
        if (!project || project.type !== details.type || project.id !== entry.sourceId || facilities.events[project.startEventIndex]?.ledgerIndex !== index) fail(path, 'must charge the exact project at its approval boundary');
      } else {
        const details = record(entry.facilityUpkeep, `${path}.facilityUpkeep`, ['arena', 'training', 'youth']);
        const { total: _total, ...breakdown } = getFacilityUpkeepBreakdown({ facilities }, entry.clubId, dateForRound(entryRound, year));
        if (!sameData(details, breakdown)) fail(path, 'must charge the completed facility levels on this matchday');
        const operatingPrefix = fields.ledger.slice(0, index) as FinanceEntry[];
        if (clubs.some(club => !operatingPrefix.some(item => item.clubId === club.id && item.seasonNumber === year && item.round === entryRound && item.kind === 'operations')) || operatingPrefix.some(item => item.seasonNumber === year && item.round === entryRound && item.kind === 'payroll' && item.payroll?.type === 'installment')) fail(path, 'must book upkeep after all operating costs and before matchday payroll');
      }
      required.delete(key);
    } else if (kind === 'payroll') {
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
        expectedItems = agreements.filter(agreement => agreementActive(agreement, index, entryRound) && !prepaid.has(agreement.id)).map(agreement => {
          const gross = payrollInstallment(agreement.seasonWage, entryRound);
          return { agreementId: agreement.id, playerId: agreement.playerId, gross, discount: 0, amount: gross };
        });
        required.delete(key);
      } else {
        const items = array(details.items, `${path}.payroll.items`, 1);
        const item = record(items[0], `${path}.payroll.items[0]`, ['agreementId', 'playerId', 'gross', 'discount', 'amount']);
        const agreement = agreements.find(agreement => agreement.id === item.agreementId);
        if (!agreement || !agreementActive(agreement, index, entryRound) || prepaid.has(agreement.id) || entry.sourceId !== `prepay-${agreement.id}`) fail(path, 'must identify one active unpaid agreement exactly once');
        const gross = agreement.seasonWage - Math.floor((entryRound - 1) * agreement.seasonWage / 10);
        if (remainingWages.get(agreement.id) !== gross) fail(path, 'must prepay exactly the unposted installments from this round');
        const discount = Math.floor(gross * PREPAYMENT_DISCOUNT_PERCENT / 100), net = gross - discount;
        const balance = balances.get(entry.clubId)!, otherReserve = wageReserve(year, entry.clubId, index, entryRound) - gross;
        if (balance.unpaid > 0 || balance.cash < net + otherReserve) fail(path, 'must settle obligations and retain cash for all other future wages before prepayment');
        expectedItems = [{ agreementId: agreement.id, playerId: agreement.playerId, gross, discount, amount: net }];
        prepaid.add(agreement.id);
      }
      const items = array(details.items, `${path}.payroll.items`, expectedItems.length);
      for (const [itemIndex, item] of items.entries()) record(item, `${path}.payroll.items[${itemIndex}]`, ['agreementId', 'playerId', 'gross', 'discount', 'amount']);
      if (!sameData(items, expectedItems) || amount !== -expectedItems.reduce((sum, item) => sum + item.amount, 0)) fail(path, 'must reconcile exact wage items, discounts and total cost');
      for (const item of expectedItems) chargeGross(agreements.find(agreement => agreement.id === item.agreementId)!, item.gross);
    } else if (kind === 'transfer') {
      if (entry.ticket !== null || entry.coach !== null) fail(path, 'must be a transfer payment without unrelated details');
      const expected = required.get(key);
      if (!expected || expected.kind !== 'transfer' || expected.seasonNumber !== year || expected.round !== entryRound || amount !== expected.amount) fail(path, 'must match one side of a recorded transfer payment');
      const receipt = transferReceipts.get(entry.sourceId)!;
      if (amount < 0 && receipt.paymentIndex !== (paidTransferCounts.get(receipt.transfer.id) ?? 0)) fail(path, 'must book transfer receipts in their retained order');
      const paired = fields.ledger[index + (amount < 0 ? 1 : -1)] as FinanceEntry | undefined;
      if (!paired || paired.kind !== 'transfer' || paired.sourceId !== entry.sourceId || paired.amount !== -amount || paired.clubId !== (amount < 0 ? receipt.transfer.fromClubId : receipt.transfer.toClubId)) fail(path, 'must retain an adjacent buyer debit followed by the matching seller credit');
      const balance = balances.get(entry.clubId)!;
      if (amount < 0 && (balance.unpaid > 0 || balance.cash < -amount + wageReserve(year, entry.clubId, index, entryRound))) fail(path, 'must fund the transfer fee while retaining wages and settling unpaid costs');
      if (amount < 0 && receipt.paymentIndex > 0) {
        const earlier = receipt.transfer.payments.slice(0, receipt.paymentIndex).filter(payment => payment.installmentIndex === receipt.payment.installmentIndex).reduce((sum, payment) => sum + payment.amount, 0);
        const remaining = receipt.transfer.installments[receipt.payment.installmentIndex]!.amount - earlier;
        const available = Math.max(0, balance.cash - wageReserve(year, entry.clubId, index, entryRound));
        if (-amount !== Math.min(remaining, available)) fail(path, 'must pay the due balance up to the available cash after the payroll reserve');
      }
      if (amount < 0) {
        paidTransferTotals.set(receipt.transfer.id, (paidTransferTotals.get(receipt.transfer.id) ?? 0) - amount);
        paidTransferCounts.set(receipt.transfer.id, receipt.paymentIndex + 1);
      }
      required.delete(key);
    } else if (kind === 'buyout') {
      if (entry.ticket !== null || entry.coach !== null) fail(path, 'must be a contract settlement without unrelated details');
      const expected = required.get(key), buyout = buyoutRecords.get(entry.sourceId);
      if (!expected || !buyout || expected.kind !== 'buyout' || expected.seasonNumber !== year || entryRound !== 10 || amount !== -buyout.amount) fail(path, 'must match exactly one recorded contract buyout settlement');
      const balance = balances.get(entry.clubId)!;
      const transferReserve = (employment?.transfers ?? []).filter(transfer => transfer.toClubId === entry.clubId && paidTransferTotals.has(transfer.id)).reduce((sum, transfer) => sum + transfer.fee - paidTransferTotals.get(transfer.id)!, 0);
      if (balance.unpaid > 0 || balance.cash < -amount + wageReserve(year, entry.clubId, index, entryRound) + transferReserve + recruitmentReserve(year, entry.clubId, index)) fail(path, 'must settle the buyout using cash after protecting player wages and unpaid transfer commitments');
      required.delete(key);
    } else if (kind === 'fitness') {
      if (entry.ticket !== null || entry.coach !== null) fail(path, 'must record the fitness fee without unrelated details');
      const details = record(entry.fitness, `${path}.fitness`, ['contractId', 'coachId']);
      const contract = fitnessContracts.get(details.contractId as string), expected = required.get(key);
      if (!contract || !expected || expected.kind !== 'fitness' || contract.hiredLedgerIndex !== index || contract.coachId !== details.coachId || expected.seasonNumber !== year || expected.round !== entryRound || expected.amount !== amount) fail(path, 'must record exactly the hired fitness coach fee at its original ledger boundary');
      const feeKey = `${year}/${entry.clubId}`, total = (feeTotals.get(feeKey) ?? 0) - amount;
      if (total > STAFF_BUDGET) fail(path, 'exceeds the shared annual staff allocation including released appointments');
      feeTotals.set(feeKey, total);
      const balance = balances.get(entry.clubId)!;
      const transfers = (employment?.transfers ?? []).filter(transfer => transfer.toClubId === entry.clubId && paidTransferTotals.has(transfer.id));
      const transferReserve = transfers.reduce((sum, transfer) => sum + transfer.fee - paidTransferTotals.get(transfer.id)!, 0);
      const overdue = transfers.some(transfer => transfer.installments.filter(item => item.dueOn <= dateForRound(entryRound, year)).reduce((sum, item) => sum + item.amount, 0) > paidTransferTotals.get(transfer.id)!);
      if (overdue || balance.unpaid > 0 || balance.cash < -amount + wageReserve(year, entry.clubId, index, entryRound) + transferReserve + recruitmentReserve(year, entry.clubId, index)) fail(path, 'must fund the fitness fee after protecting wages and transfer holds and settling arrears');
      required.delete(key);
    } else if (kind === 'physio') {
      if (entry.ticket !== null || entry.coach !== null) fail(path, 'must record the physio fee without unrelated details');
      const details = record(entry.physio, `${path}.physio`, ['contractId', 'physioId']);
      const contract = physioContracts.get(details.contractId as string), expected = required.get(key);
      if (!contract || !expected || expected.kind !== 'physio' || contract.hiredLedgerIndex !== index || contract.physioId !== details.physioId || expected.seasonNumber !== year || expected.round !== entryRound || expected.amount !== amount) fail(path, 'must record exactly the hired physiotherapist fee at its original ledger boundary');
      const feeKey = `${year}/${entry.clubId}`, total = (feeTotals.get(feeKey) ?? 0) - amount;
      if (total > STAFF_BUDGET) fail(path, 'exceeds the shared annual staff allocation including released appointments');
      feeTotals.set(feeKey, total);
      const balance = balances.get(entry.clubId)!;
      const transfers = (employment?.transfers ?? []).filter(transfer => transfer.toClubId === entry.clubId && paidTransferTotals.has(transfer.id));
      const transferReserve = transfers.reduce((sum, transfer) => sum + transfer.fee - paidTransferTotals.get(transfer.id)!, 0);
      const overdue = transfers.some(transfer => transfer.installments.filter(item => item.dueOn <= dateForRound(entryRound, year)).reduce((sum, item) => sum + item.amount, 0) > paidTransferTotals.get(transfer.id)!);
      if (overdue || balance.unpaid > 0 || balance.cash < -amount + wageReserve(year, entry.clubId, index, entryRound) + transferReserve + recruitmentReserve(year, entry.clubId, index)) fail(path, 'must fund the physio fee after protecting wages and transfer holds and settling arrears');
      required.delete(key);
    } else if (kind === 'assistant') {
      if (entry.ticket !== null || entry.coach !== null) fail(path, 'must record the assistant fee without unrelated details');
      const details = record(entry.assistant, `${path}.assistant`, ['contractId', 'assistantId']);
      const contract = assistantContracts.get(details.contractId as string), expected = required.get(key);
      if (!contract || !expected || expected.kind !== 'assistant' || contract.hiredLedgerIndex !== index || contract.assistantId !== details.assistantId || expected.seasonNumber !== year || expected.round !== entryRound || expected.amount !== amount) fail(path, 'must record exactly the hired assistant coach fee at its original ledger boundary');
      const feeKey = `${year}/${entry.clubId}`, total = (feeTotals.get(feeKey) ?? 0) - amount;
      if (total > STAFF_BUDGET) fail(path, 'exceeds the shared annual staff allocation including released appointments');
      feeTotals.set(feeKey, total);
      const balance = balances.get(entry.clubId)!;
      const transfers = (employment?.transfers ?? []).filter(transfer => transfer.toClubId === entry.clubId && paidTransferTotals.has(transfer.id));
      const transferReserve = transfers.reduce((sum, transfer) => sum + transfer.fee - paidTransferTotals.get(transfer.id)!, 0);
      const overdue = transfers.some(transfer => transfer.installments.filter(item => item.dueOn <= dateForRound(entryRound, year)).reduce((sum, item) => sum + item.amount, 0) > paidTransferTotals.get(transfer.id)!);
      if (overdue || balance.unpaid > 0 || balance.cash < -amount + wageReserve(year, entry.clubId, index, entryRound) + transferReserve + recruitmentReserve(year, entry.clubId, index)) fail(path, 'must fund the assistant fee after protecting wages and transfer holds and settling arrears');
      required.delete(key);
    } else if (kind === 'youth') {
      if (entry.ticket !== null || entry.coach !== null) fail(path, 'must record the youth fee without unrelated details');
      const details = record(entry.youth, `${path}.youth`, ['contractId', 'coachId']);
      const contract = youthContracts.get(details.contractId as string), expected = required.get(key);
      if (!contract || !expected || expected.kind !== 'youth' || contract.hiredLedgerIndex !== index || contract.coachId !== details.coachId || expected.seasonNumber !== year || expected.round !== entryRound || expected.amount !== amount) fail(path, 'must record exactly the hired youth coach fee at its original ledger boundary');
      const feeKey = `${year}/${entry.clubId}`, total = (feeTotals.get(feeKey) ?? 0) - amount;
      if (total > STAFF_BUDGET) fail(path, 'exceeds the shared annual staff allocation including released appointments');
      feeTotals.set(feeKey, total);
      const balance = balances.get(entry.clubId)!;
      const transfers = (employment?.transfers ?? []).filter(transfer => transfer.toClubId === entry.clubId && paidTransferTotals.has(transfer.id));
      const transferReserve = transfers.reduce((sum, transfer) => sum + transfer.fee - paidTransferTotals.get(transfer.id)!, 0);
      const overdue = transfers.some(transfer => transfer.installments.filter(item => item.dueOn <= dateForRound(entryRound, year)).reduce((sum, item) => sum + item.amount, 0) > paidTransferTotals.get(transfer.id)!);
      if (overdue || balance.unpaid > 0 || balance.cash < -amount + wageReserve(year, entry.clubId, index, entryRound) + transferReserve + recruitmentReserve(year, entry.clubId, index)) fail(path, 'must fund the youth fee after protecting wages and transfer holds and settling arrears');
      required.delete(key);
    } else if (kind === 'scouting') {
      if (entry.ticket !== null || entry.coach !== null) fail(path, 'must record the scout fee without unrelated details');
      const details = record(entry.scout, `${path}.scout`, ['contractId', 'scoutId']);
      const contract = scoutContracts.get(details.contractId as string), expected = required.get(key);
      if (!contract || !expected || expected.kind !== 'scouting' || contract.hiredLedgerIndex !== index || contract.scoutId !== details.scoutId || expected.seasonNumber !== year || expected.round !== entryRound || expected.amount !== amount) fail(path, 'must record exactly the hired scout fee at its original ledger boundary');
      const feeKey = `${year}/${entry.clubId}`, total = (feeTotals.get(feeKey) ?? 0) - amount;
      if (total > STAFF_BUDGET) fail(path, 'exceeds the shared annual staff allocation including released appointments');
      feeTotals.set(feeKey, total);
      const balance = balances.get(entry.clubId)!;
      const transfers = (employment?.transfers ?? []).filter(transfer => transfer.toClubId === entry.clubId && paidTransferTotals.has(transfer.id));
      const transferReserve = transfers.reduce((sum, transfer) => sum + transfer.fee - paidTransferTotals.get(transfer.id)!, 0);
      const overdue = transfers.some(transfer => transfer.installments.filter(item => item.dueOn <= dateForRound(entryRound, year)).reduce((sum, item) => sum + item.amount, 0) > paidTransferTotals.get(transfer.id)!);
      if (overdue || balance.unpaid > 0 || balance.cash < -amount + wageReserve(year, entry.clubId, index, entryRound) + transferReserve + recruitmentReserve(year, entry.clubId, index)) fail(path, 'must fund the scout fee after protecting wages and transfer holds and settling arrears');
      required.delete(key);
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
      if (total > STAFF_BUDGET) fail(path, 'exceeds the shared annual staff allocation including released appointments');
      feeTotals.set(feeKey, total);
      const balance = balances.get(entry.clubId)!;
      const transferReserve = (employment?.transfers ?? []).filter(transfer => transfer.toClubId === entry.clubId && paidTransferTotals.has(transfer.id)).reduce((sum, transfer) => sum + transfer.fee - paidTransferTotals.get(transfer.id)!, 0);
      if (balance.unpaid > 0 || balance.cash < -amount + wageReserve(year, entry.clubId, index, entryRound) + transferReserve + recruitmentReserve(year, entry.clubId, index)) fail(path, 'cannot hire or renew a coach without sufficient cash, settled obligations, reserved player wages and agreed transfer installments');
    } else {
      if (entry.coach !== null) fail(`${path}.coach`, 'must be empty for a non-coaching event');
      const expected = required.get(key);
      if (!expected || expected.seasonNumber !== year || expected.round !== entryRound) fail(path, 'does not match a required financial event in the calendar');
      if (kind === 'tickets') {
        const hasCapacity = !!facilities.enabledSince && index >= facilities.enabledSince.ledgerIndex;
        const ticket = record(entry.ticket, `${path}.ticket`, ['fixtureId', 'price', 'attendance', ...(hasCapacity ? ['capacity'] : [])]);
        const fixture = expected.fixture!;
        if (ticket.fixtureId !== fixture.id) fail(`${path}.ticket.fixtureId`, 'must identify its completed home fixture');
        const price = validateTicketPrice(ticket.price, `${path}.ticket.price`);
        const gate = forecastGate({ fixtures: schedules.get(year)!, ...(hasCapacity ? { facilities } : {}) }, fixture, price);
        if (hasCapacity && ticket.capacity !== gate.capacity) fail(`${path}.ticket.capacity`, 'must retain the actual construction-adjusted matchday capacity');
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

/** Audit mandatory payment runs using only cash and receipts present at that boundary. */
function validateTransferPaymentBoundaries(state: SeasonState): void {
  if (!state.employment.transfers.some(transfer => transfer.paymentPlan !== 'upfront')) return;
  const ledger = state.finance.ledger;
  const receipts = new Map(state.employment.transfers.flatMap(transfer => transfer.payments.map(payment => [payment.id, payment] as const)));
  const checked = new Set<string>();
  const audit = (count: number, year: number, round: number): void => {
    const date = dateForRound(round, year), key = `${count}/${date}`;
    if (checked.has(key)) return;
    checked.add(key);
    const prefix = ledger.slice(0, count), paidIds = new Set(prefix.filter(entry => entry.kind === 'transfer' && entry.amount < 0).map(entry => entry.sourceId));
    const transfers = state.employment.transfers.filter(transfer => paidIds.has(transfer.id)).map(transfer => ({ ...transfer, payments: transfer.payments.filter(payment => paidIds.has(payment.id)) }));
    const agreements = state.payroll.agreements.filter(agreement => {
      const incoming = state.employment.transfers.find(transfer => transfer.startsRound > 1 && transfer.startsSeason === agreement.seasonNumber && transfer.startsRound === agreement.startsRound && transfer.playerId === agreement.playerId && transfer.toClubId === agreement.clubId);
      return !incoming || paidIds.has(incoming.id);
    });
    const replay = { ...state, seasonNumber: year, round, date, employment: { ...state.employment, transfers }, payroll: { ...state.payroll, agreements }, finance: { ...state.finance, ledger: prefix } };
    const expected = processTransferPayments(replay).finance.ledger.slice(count);
    if (!sameData(expected, ledger.slice(count, count + expected.length))) fail('finance.ledger', 'must settle due transfer installments at the recorded calendar boundary using only then-available cash');
  };
  const lastClub = state.clubs.at(-1)!.id;
  for (const [index, entry] of ledger.entries()) {
    if (entry.clubId === lastClub && (entry.kind === 'sponsor' && entry.seasonNumber > state.finance.enabledSince!.seasonNumber || entry.kind === 'payroll' && entry.payroll?.type === 'installment')) audit(index + 1, entry.seasonNumber, entry.round);
  }
  const firstYear = Math.min(...state.employment.transfers.map(transfer => transfer.startsSeason));
  for (let year = firstYear; year <= state.seasonNumber; year += 1) {
    const lastRound = year === state.seasonNumber ? state.round : 10;
    for (let round = 1; round <= lastRound; round += 1) {
      const date = dateForRound(round, year);
      let boundary = ledger.findIndex(entry => entry.seasonNumber === year && entry.round === round && (entry.kind === 'tickets' || entry.kind === 'operations'));
      if (boundary < 0) {
        if (year !== state.seasonNumber || round !== state.round || state.status !== 'active') continue;
        boundary = ledger.length;
      }
      // A manual salary prepayment can follow preparation on the same date and
      // release discount cash without running the calendar again. Its ledger row
      // has no automatic/manual marker. Anchor to the last actual preparation
      // receipt block, never to that optional later command's resulting cash.
      let lastReceipt = boundary - 1;
      const automaticReceipt = (entry: FinanceEntry) => entry.kind === 'transfer' && receipts.get(entry.sourceId)?.paidOn === date && state.employment.transfers.some(transfer => transfer.payments.slice(1).some(payment => payment.id === entry.sourceId));
      while (lastReceipt >= 0 && ledger[lastReceipt]!.seasonNumber === year && ledger[lastReceipt]!.round === round && !automaticReceipt(ledger[lastReceipt]!)) lastReceipt -= 1;
      if (lastReceipt >= 0 && ledger[lastReceipt]!.seasonNumber === year && ledger[lastReceipt]!.round === round && ledger[lastReceipt]!.kind === 'transfer' && receipts.get(ledger[lastReceipt]!.sourceId)?.paidOn === date) boundary = lastReceipt + 1;
      else if (ledger.slice(lastReceipt + 1, boundary).some(entry => entry.payroll?.type === 'prepayment')) continue;
      // Preparation can follow automatic salary prepayments. Rebuild its trailing
      // receipt block instead of running payments a second time after seller income.
      while (boundary > 0 && automaticReceipt(ledger[boundary - 1]!)) boundary -= 1;
      audit(boundary, year, round);
    }
  }
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

function withoutRosterReport(report: TrainingWeekReport | null): TrainingWeekReport | null {
  if (!report) return null;
  const { rosterIds: _rosterIds, ...previous } = report;
  return previous as TrainingWeekReport;
}

/** Format 4 contained identical training outcomes but no coach attribution fields. */
function migrateTrainingCoaching(training: SeasonTraining): SeasonTraining {
  if (!training.lastWeek) return training;
  return { ...training, lastWeek: { ...training.lastWeek, coaching: null, players: Object.fromEntries(Object.entries(training.lastWeek.players).map(([id, player]) => [id, { ...player, coachingGains: Object.fromEntries(TRAINING_ATTRIBUTES.map(attribute => [attribute, 0])) as TrainingPoints }])) } };
}

/** Reconcile the retained week; older development remains bounded state, not invented history. */
function validateTraining(value: unknown, clubs: readonly Team[], fixtures: SeasonFixture[], injuries: SeasonInjury[], seasonNumber: number, round: number, coaching?: SeasonCoaching, rosters?: readonly RosterSnapshot[], fitness: SeasonFitness = createFitness(), physio: SeasonPhysio = createPhysio(), version = 30, context: CareerPlayerContext & LifecycleContext & { facilities?: SeasonFacilities } = {}): { training: SeasonTraining; conditionsAfter: Record<string, number> | null } {
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
  // Free agents retain their development; registrations only determine who trains this week.
  const catalog = getCareerPlayers(context, seasonNumber, round);
  const points = record(fields.points, 'training.points', catalog.map(player => player.id));
  const playerWeeks = (playerId: string) => {
    const graduate = context.academy?.graduates.find(entry => entry.player.id === playerId);
    return graduate ? Math.min(weeks, completedDevelopmentWeeks(graduate.availableSince, seasonNumber, round)) : weeks;
  };
  const agingWeeks = context.lifecycle?.enabledSince ? Math.min(weeks, completedDevelopmentWeeks(context.lifecycle.enabledSince, seasonNumber, round)) : 0;
  const facilityWeeks = context.facilities?.enabledSince ? Math.min(weeks, completedDevelopmentWeeks(context.facilities.enabledSince, seasonNumber, round)) : 0;
  const pointBudget = (id: string, prior = false) => {
    const available = Math.max(0, playerWeeks(id) - Number(prior)), coached = Math.min(available, Math.max(0, coachingWeeks - Number(prior)));
    const weighted = Math.min(available, Math.max(0, agingWeeks - Number(prior)));
    return available * 35 + weighted * 8 + coached * 8 + Math.min(coached, weighted) * 2 + Math.min(available, Math.max(0, facilityWeeks - Number(prior))) * 4;
  };
  for (const player of catalog) {
    const entry = record(points[player.id], `training.points.${player.id}`, TRAINING_ATTRIBUTES);
    for (const attribute of TRAINING_ATTRIBUTES) number(entry[attribute], `training.points.${player.id}.${attribute}`, 0, Math.min(200, (20 - player.attributes[attribute]) * 100));
    if (TRAINING_ATTRIBUTES.reduce((total, attribute) => total + (entry[attribute] as number), 0) > pointBudget(player.id)) fail(`training.points.${player.id}`, 'exceeds available training weeks');
  }
  const training = fields as unknown as SeasonTraining, anchor = training.enabledSince;
  const needsReport = anchor !== null && round > 1 && (anchor.seasonNumber < seasonNumber || anchor.round < round);
  if (!needsReport) {
    if (fields.lastWeek !== null) fail('training.lastWeek', 'must be empty before an enabled training interval or after rollover');
    return { training, conditionsAfter: null };
  }
  const report = record(fields.lastWeek, 'training.lastWeek', ['seasonNumber', 'afterRound', 'fromDate', 'toDate', 'plans', 'players', ...(coaching ? ['coaching'] : []), ...(rosters ? ['rosterIds'] : []), ...(version >= 22 && fields.lastWeek !== null && typeof fields.lastWeek === 'object' && Object.hasOwn(fields.lastWeek, 'fitness') ? ['fitness'] : [])]);
  const afterRound = Math.min(round - 1, 9);
  if (report.seasonNumber !== seasonNumber || report.afterRound !== afterRound || report.fromDate !== dateForRound(afterRound, seasonNumber) || report.toDate !== dateForRound(afterRound + 1, seasonNumber)) fail('training.lastWeek', 'must identify the most recent completed training interval');
  if (rosters) {
    const refs = record(report.rosterIds, 'training.lastWeek.rosterIds', clubs.map(club => club.id));
    for (const club of clubs) if (refs[club.id] !== rosterForRound(rosters, club.id, afterRound).id) fail(`training.lastWeek.rosterIds.${club.id}`, 'must identify the club roster registered during the training interval');
  }
  const intervalClubs = rosters ? clubs.map(club => ({ ...club, players: rosterForRound(rosters, club.id, afterRound).players })) : clubs;
  const appliedPlans = validateTrainingPlans(report.plans, 'training.lastWeek.plans', intervalClubs);
  const appliedCoaching = coaching ? coachingForReport(report.coaching, coaching, intervalClubs, seasonNumber, afterRound) : undefined;
  const players = record(report.players, 'training.lastWeek.players', intervalClubs.flatMap(club => club.players.map(player => player.id)));
  const pointsBefore: Record<string, TrainingPoints> = { ...training.points }, conditionsBefore: Record<string, number> = {};
  for (const club of intervalClubs) {
    const fixture = fixtures.find(fixture => fixture.round === afterRound && [fixture.homeClubId, fixture.awayClubId].includes(club.id))!;
    for (const player of club.players) {
      const path = `training.lastWeek.players.${player.id}`;
      const value = players[player.id];
      const entry = record(value, path, ['focus', 'intensity', 'availableDays', 'conditionBefore', 'conditionAfter', 'gains', ...(coaching ? ['coachingGains'] : []), ...(version >= 22 && value !== null && typeof value === 'object' && Object.hasOwn(value, 'fitness') ? ['fitness'] : []), ...(version >= 26 && value !== null && typeof value === 'object' && Object.hasOwn(value, 'aging') ? ['aging'] : []), ...(version >= 28 && value !== null && typeof value === 'object' && Object.hasOwn(value, 'facility') ? ['facility'] : [])]);
      if (Object.hasOwn(entry, 'facility')) { const bonus = record(entry.facility, `${path}.facility`, ['earnedPoints', 'gains']); number(bonus.earnedPoints, `${path}.facility.earnedPoints`, 0, 4); record(bonus.gains, `${path}.facility.gains`, TRAINING_ATTRIBUTES); }
      if (Object.hasOwn(entry, 'aging')) record(entry.aging, `${path}.aging`, ['ordinaryPracticePoints', 'adjustedPracticePoints', 'rateBasisPoints']);
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
        const weighted = !!context.lifecycle?.enabledSince && (report.fromDate as string) >= context.lifecycle.enabledSince.date;
        const gain = number(gains[attribute], `${path}.gains.${attribute}`, 0, (weighted ? (coaching ? 53 : 43) : coaching ? 43 : 35) + (context.facilities?.enabledSince ? 4 : 0));
        if (coachingGains) number(coachingGains[attribute], `${path}.coachingGains.${attribute}`, 0, Math.min(weighted ? 10 : 8, gain));
        previous[attribute] = training.points[player.id]![attribute] - gain;
        if (previous[attribute] < 0) fail(`${path}.gains.${attribute}`, 'exceeds retained development points');
      }
      if (TRAINING_ATTRIBUTES.reduce((total, attribute) => total + previous[attribute], 0) > pointBudget(player.id, true)) fail(`training.points.${player.id}`, 'exceeds training weeks before the retained report');
      pointsBefore[player.id] = previous;
    }
  }
  const replayed = processTrainingWeek({
    training: { ...training, plans: appliedPlans, points: pointsBefore, lastWeek: null }, clubs: intervalClubs, conditions: conditionsBefore,
    // Final-round injuries happen after the last training day and must not be replayed into it.
    injuries: injuries.filter(injury => injury.occurredOn <= (report.fromDate as string)),
    seasonNumber, afterRound, fromDate: report.fromDate as string, toDate: report.toDate as string, coaching: appliedCoaching, rosters, fitness, physio, lifecycle: context.lifecycle, academy: context.academy, facilities: context.facilities,
  });
  const replayedReport = rosters ? replayed.training.lastWeek : withoutRosterReport(replayed.training.lastWeek);
  if (!sameData(coaching ? replayedReport : withoutCoachingReport(replayedReport), training.lastWeek) || !sameData(replayed.training.points, training.points)) fail('training.lastWeek', 'does not reconcile with training plans, coaching, fitness staffing, availability, recovery and development');
  return { training, conditionsAfter: replayed.conditions };
}

/** Older schemas keep their original constraints before migration adds career fields. */
function validateState(value: unknown, version: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 | 25 | 26 | 27 | 28 | 29 | 30): void {
  const legacy = version === 1, career = version >= 3;
  checkJsonTree(value);
  const state = record(value, 'state', ['schemaVersion', 'engineVersion', 'dataPackId', 'seed', 'managedClubId', 'date', 'status', 'round', 'clubs', 'plans', 'conditions', 'fixtures', 'activeFixtureId', 'activeMatch', ...(legacy ? [] : ['injuryMode', 'injuries']), ...(career ? ['seasonNumber', 'history'] : []), ...(version >= 4 ? ['training'] : []), ...(version >= 5 ? ['coaching'] : []), ...(version >= 6 ? ['finance'] : []), ...(version >= 7 ? ['payroll'] : []), ...(version >= 8 ? ['manager'] : []), ...(version >= 9 ? ['rosters'] : []), ...(version >= 10 ? ['employment'] : []), ...(version >= 11 ? ['scouting'] : []), ...(version >= 12 ? ['negotiations'] : []), ...(version >= 13 ? ['market'] : []), ...(version >= 18 ? ['recruitment'] : []), ...(version >= 21 ? ['scouts'] : []), ...(version >= 22 ? ['fitness'] : []), ...(version >= 23 ? ['physio'] : []), ...(version >= 24 ? ['assistant'] : []), ...(version >= 25 ? ['academy', 'youth'] : []), ...(version >= 26 ? ['lifecycle'] : []), ...(version >= 27 ? ['youthCompetition'] : []), ...(version >= 28 ? ['facilities'] : []), ...(version >= 29 ? ['relationships'] : []), ...(version >= 30 ? ['board'] : [])]);
  if (state.schemaVersion !== version || state.engineVersion !== 'possession-3' || state.dataPackId !== DEVELOPMENT_DATA_PACK_ID) fail('state', 'uses an unsupported schema, engine or data pack');
  if (version >= 8 && state.manager !== null && !sameData(state.manager, validateManagerProfile(state.manager, DEVELOPMENT_START_DATE))) fail('manager', 'must contain normalized profile details valid at the initial career date');
  const seed = number(state.seed, 'seed', 0, 0xffff_ffff), round = number(state.round, 'round', 1, 10);
  const seasonNumber = career ? number(state.seasonNumber, 'seasonNumber', 1, MAX_SEASON_NUMBER) : 1;
  const injuryMode = legacy ? 'off' : state.injuryMode;
  if (!['standard', 'reduced', 'off'].includes(injuryMode as string)) fail('injuryMode', 'must be standard, reduced or off');
  if (!legacy && (!Array.isArray(state.injuries) || state.injuries.length > 600 * seasonNumber)) fail('injuries', 'must be a bounded injury history');
  if (state.status !== 'active' && state.status !== 'complete') fail('status', 'must be active or complete');
  if (state.status === 'complete' && round !== 10) fail('round', 'must reach the final matchday before completion');
  if (typeof state.managedClubId !== 'string' || !DEVELOPMENT_CLUBS.some(club => club.id === state.managedClubId)) fail('managedClubId', 'must identify a club in this league');
  const academy = version >= 25 ? validateAcademyShape(state.academy, state as unknown as SeasonState, version) : createAcademy();
  const lifecycle = version >= 26 ? validateLifecycleShape(state.lifecycle, state as unknown as SeasonState) : createLifecycle();
  const youthCompetition = version >= 27 ? validateYouthCompetitionShape(state.youthCompetition, state as unknown as SeasonState) : createYouthCompetition();
  const facilities = version >= 28 ? validateFacilitiesShape(state.facilities, state as unknown as SeasonState) : createFacilities(DEVELOPMENT_CLUBS, state.managedClubId);
  const relationships = version >= 29 ? state.relationships as unknown as SeasonRelationships : createRelationships();
  const board = version >= 30 ? state.board as unknown as SeasonBoard : createBoard();
  const careerContext: CareerPlayerContext = { academy, lifecycle, seasonNumber, round, date: state.date as string };
  const marketEnabled = version >= 13 && record(state.market, 'market', ['model', 'enabledSince', 'windows']).enabledSince !== null;
  const employment = version >= 10 ? validateEmployment(state.employment, seasonNumber, round, state.status, state.managedClubId, marketEnabled, version, careerContext) : undefined;
  if (!sameData(state.clubs, clubsForEmploymentYear(employment, seasonNumber, round, careerContext))) fail('clubs', 'must match the versioned player catalog and effective employment registrations');
  const clubs = state.clubs as readonly Team[], clubIds = clubs.map(club => club.id);
  const rosters = version >= 9 ? validateRosters(state.rosters, 'rosters', clubs, seasonNumber, employment, round, careerContext) : undefined;
  if (typeof state.managedClubId !== 'string' || !clubIds.includes(state.managedClubId)) fail('managedClubId', 'must identify a club in this league');
  const plans = record(state.plans, 'plans', clubIds);
  const playerIds = getCareerPlayers(careerContext, seasonNumber, round).map(player => player.id);
  const conditions = record(state.conditions, 'conditions', playerIds);
  for (const playerId of playerIds) number(conditions[playerId], `conditions.${playerId}`, 0, 100, false);
  const registeredPlayers = new Set(clubs.flatMap(club => club.players.map(player => player.id)));
  for (const playerId of playerIds) if (!registeredPlayers.has(playerId) && conditions[playerId] !== 100) fail(`conditions.${playerId}`, 'must retain offseason recovery while the player remains unregistered');
  for (const club of clubs) {
    const plan = record(plans[club.id], `plans.${club.id}`, ['tactics', 'lineup', 'autoSubstitutions']);
    const tactics = record(plan.tactics, `plans.${club.id}.tactics`, ['tempo', 'outsideShare', 'pressure']);
    for (const key of ['tempo', 'outsideShare', 'pressure']) number(tactics[key], `plans.${club.id}.tactics.${key}`, 0, 1, false);
    const lineup = array(plan.lineup, `plans.${club.id}.lineup`, 5);
    if (new Set(lineup).size !== 5 || lineup.some(id => !club.players.some(player => player.id === id))) fail(`plans.${club.id}.lineup`, 'must select five distinct players from its club');
    if (typeof plan.autoSubstitutions !== 'boolean' || club.id !== state.managedClubId && !plan.autoSubstitutions) fail(`plans.${club.id}.autoSubstitutions`, 'must be boolean and enabled for opponent clubs');
    for (const player of club.players) number(conditions[player.id], `conditions.${player.id}`, 0, 100, false);
  }
  const coaching = version >= 5 ? validateCoaching(state.coaching, clubs, seasonNumber, round) : undefined;
  const scouts = version >= 21 ? validateScouts(state.scouts, state as unknown as SeasonState, coaching!) : createScouts();
  const fitness = version >= 22 ? validateFitness(state.fitness, state as unknown as SeasonState, coaching!, scouts) : createFitness();
  const physio = version >= 23 ? validatePhysio(state.physio, state as unknown as SeasonState, coaching!, scouts, fitness) : createPhysio();
  const assistant = version >= 24 ? validateAssistant(state.assistant, state as unknown as SeasonState, coaching!, scouts, fitness, physio) : createAssistant();
  const youth = version >= 25 ? validateYouth(state.youth, state as unknown as SeasonState, coaching!, scouts, fitness, physio, assistant) : createYouth();
  validateAcademyHistory({ ...state, academy, youth, youthCompetition, facilities } as unknown as SeasonState);
  validateRehabilitation(physio, state as unknown as SeasonState, employment);
  const history: SeasonInjury[] = [];
  const latestInjuries = new Map<string, SeasonInjury>();
  function recordFixtureInjuries(result: ArchivedFixture['result'], expected: SeasonFixture, home: Team, away: Team, path: string, stats?: FixtureResult['stats']): void {
    const participants = new Set([...home.players, ...away.players].map(player => player.id));
    const carried = [...latestInjuries.values()].filter(injury => participants.has(injury.playerId) && isRecovering(injury, expected.date, physio));
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
      const path = `history[${archiveIndex}]`, archive = record(value, path, ['seasonNumber', 'fixtures', ...(version >= 9 ? ['rosters'] : [])]);
      if (archive.seasonNumber !== archiveIndex + 1) fail(`${path}.seasonNumber`, 'must preserve every previous season in order');
      const archivedRosters = version >= 9 ? validateRosters(archive.rosters, `${path}.rosters`, clubsForEmploymentYear(employment, archiveIndex + 1, 10, careerContext), archiveIndex + 1, employment, 10, careerContext) : undefined;
      const schedule = createSchedule(clubs, archiveIndex + 1);
      const fixtures = array(archive.fixtures, `${path}.fixtures`, schedule.length);
      let hasPlayerStats: boolean | undefined;
      for (const [index, value] of fixtures.entries()) {
        const location = `${path}.fixtures[${index}]`, expected = schedule[index]!;
        const fixture = record(value, location, ['id', 'round', 'date', 'homeClubId', 'awayClubId', 'result']);
        for (const key of ['id', 'round', 'date', 'homeClubId', 'awayClubId'] as const) if (fixture[key] !== expected[key]) fail(location, 'does not match the versioned schedule');
        const { home, away } = archivedRosters ? recordedTeams(fixture.result, expected, clubs, archivedRosters, `${location}.result`) : { home: clubs.find(club => club.id === expected.homeClubId)!, away: clubs.find(club => club.id === expected.awayClubId)! };
        const result = validateArchivedResult(fixture.result, `${location}.result`, home, away, version >= 9);
        if (version >= 9) {
          const available = result.stats !== null;
          if (hasPlayerStats !== undefined && available !== hasPlayerStats) fail(`${path}.fixtures`, 'must have consistent player-statistics coverage for the archived season');
          hasPlayerStats = available;
        }
        recordFixtureInjuries(result, expected, home, away, location, version >= 9 ? result.stats ?? undefined : undefined);
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
      const { home, away } = rosters ? recordedTeams(fixture.result, expected, clubs, rosters, `${path}.result`) : { home: clubs.find(club => club.id === expected.homeClubId)!, away: clubs.find(club => club.id === expected.awayClubId)! };
      const result = validateResult(fixture.result, `${path}.result`, home, away, legacy, version >= 9);
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
  let payroll: SeasonPayroll | undefined;
  if (version >= 7) {
    const finance = record(state.finance, 'finance', ['model', 'enabledSince', 'plans', 'roundPrices', 'ledger', ...(version >= 28 && Object.hasOwn(state.finance as object, 'roundCapacities') ? ['roundCapacities'] : [])]);
    if (!Array.isArray(finance.ledger)) fail('finance.ledger', 'must be an array');
    payroll = validatePayroll(state.payroll, clubs, seasonNumber, round, state.managedClubId, finance.ledger.length, employment, careerContext);
    if (employment?.enabledSince) {
      const anchor = payroll.enabledSince;
      if (!anchor || anchor.seasonNumber * 10 + anchor.round > employment.enabledSince.seasonNumber * 10 + employment.enabledSince.round) fail('employment.enabledSince', 'requires payroll active from the employment activation boundary');
    }
  }
  const normalizedState = { ...state, scouts, fitness, physio, assistant, academy, youth, lifecycle, youthCompetition, facilities, relationships, board, ...(employment ? { employment } : {}), recruitment: version >= 19 ? state.recruitment : version === 18 ? migrateRecruitmentTransfers(state.recruitment as unknown as SeasonRecruitment) : createRecruitment() } as unknown as SeasonState;
  const recruitmentHolds = version >= 18 ? validateRecruitment(state.recruitment, normalizedState, version) : [];
  if (version >= 6) validateFinance(state.finance, clubs, fixtures as SeasonFixture[], state.history as SeasonArchive[], coaching!, seasonNumber, round, state.status, state.managedClubId, payroll, employment, recruitmentHolds, scouts, fitness, physio, assistant, youth, version, facilities);
  const development = version >= 4 ? validateTraining(state.training, clubs, fixtures as SeasonFixture[], history, seasonNumber, round, coaching, rosters, fitness, physio, version, { ...careerContext, facilities }) : null;
  if (version >= 11) validateScouting(state.scouting, normalizedState, version);
  const marketSnapshots: MarketReplaySnapshot[] = [];
  if (version >= 13) validateMarket(state.market, normalizedState, version, marketSnapshots);
  if (version >= 28) validateFacilitiesHistory(normalizedState, recruitmentHolds, marketSnapshots);
  if (version >= 12) validateNegotiations(state.negotiations, normalizedState, recruitmentHolds, version);
  validateLifecycleHistory(normalizedState, recruitmentHolds);
  const marketWindow = marketEnabled ? (state.market as unknown as SeasonMarket).windows.find(window => window.seasonNumber === seasonNumber) : null;
  const expectedDate = state.status === 'complete' && marketWindow ? marketWindow.date : active.date;
  if (state.activeFixtureId !== active.id || state.date !== expectedDate) fail('activeFixtureId/date', 'must identify the current fixture or validated offseason date');
  if (version >= 16) {
    if (employment!.transfers.some(transfer => transfer.payments.some(payment => payment.paidOn > expectedDate))) fail('employment.transfers.payments', 'cannot record future cash receipts');
    validateTransferPaymentBoundaries(normalizedState);
  }
  validateMatchState(state.activeMatch);
  validateRelationships(normalizedState, version);
  validateBoard(normalizedState, version);
  const match = state.activeMatch;
  if (match.engineVersion !== 'possession-3' || match.seed !== fixtureSeed(seed, active.id)) fail('activeMatch', 'has the wrong engine or fixture seed');
  const home = clubs.find(club => club.id === active.homeClubId)!, away = clubs.find(club => club.id === active.awayClubId)!;
  if (!sameData(match.home, development ? developClub(home, development.training, { ...careerContext, date: active.date }) : home) || !sameData(match.away, development ? developClub(away, development.training, { ...careerContext, date: active.date }) : away)) fail('activeMatch', 'must use the fixture home and away squads with their current development');
  const opposition: Side = active.homeClubId === state.managedClubId ? 'away' : 'home';
  if (!match.autoSubstitutions[opposition]) fail('activeMatch.autoSubstitutions', 'must enable opponent substitutions');
  if (match.injuryMode !== injuryMode) fail('activeMatch.injuryMode', 'must match the season-wide injury setting');
  if (legacy) {
    if (Object.keys(match.injuries).length !== 0 || Object.hasOwn(match, 'preExistingInjuries')) fail('activeMatch', 'must use the legacy season-wide injury-off setting');
  } else {
    // The final fixture may already be in history, but its new injuries are not inherited.
    const participants = new Set([...home.players, ...away.players].map(player => player.id));
    const carried = history.filter(injury => injury.fixtureId !== active.id && participants.has(injury.playerId) && isRecovering(injury, active.date, physio));
    if (!sameIds(match.preExistingInjuries ?? [], carried.map(injury => injury.playerId))) fail('activeMatch.preExistingInjuries', 'must match the players still recovering at kickoff');
    for (const injury of carried) {
      if (match.injuries[injury.playerId]?.kind !== injury.kind) fail('activeMatch.injuries', 'must retain the carried diagnosis');
      requireNoPlay(match.stats[injury.playerId]!, `activeMatch.stats.${injury.playerId}`);
    }
    if (injuryMode === 'off' && Object.keys(match.injuries).length) fail('activeMatch.injuries', 'cannot record injuries in an injury-free season');
  }
  if (state.status === 'complete') {
    if (match.status !== 'finished' || !match.result) fail('activeMatch', 'must be finished when the season is complete');
    const result = { score: match.score, officialScore: match.result.officialScore, winnerClubId: match[match.result.winner].id, kind: match.result.kind, periods: match.period, stats: match.stats, ...(legacy ? {} : { injuries: Object.fromEntries(Object.entries(match.injuries).map(([id, injury]) => [id, injury.kind])) }), ...(rosters ? { rosterIds: { home: rosterForRound(rosters, home.id, round).id, away: rosterForRound(rosters, away.id, round).id } } : {}) };
    if (!sameData(active.result, result)) fail('activeMatch', 'does not match its committed final result');
  }
  // Recovery belongs to a completed matchday, so imports cannot run it twice.
  for (const club of clubs) {
    for (const player of club.players) {
      const latest = (fixtures as SeasonFixture[]).find(fixture => fixture.round === committedRound && fixture.result?.stats[player.id]);
      const previous = latest?.result?.stats[player.id]?.condition ?? 100;
      const marketRecoveryDays = state.status === 'complete' && marketWindow ? (Date.parse(`${marketWindow.date}T00:00:00.000Z`) - Date.parse(`${active.date}T00:00:00.000Z`)) / 86_400_000 : 0;
      const arrival = academy.graduates.find(graduate => graduate.player.id === player.id && graduate.availableSince.seasonNumber === seasonNumber && graduate.availableSince.round === round);
      const expected = state.status === 'complete' ? Math.min(100, Math.round((previous + DAILY_RECOVERY * marketRecoveryDays) * 1000) / 1000) : development?.conditionsAfter?.[player.id] ?? (!latest && arrival?.condition !== undefined ? arrival.condition : Math.min(100, Math.round((previous + DAILY_RECOVERY * ROUND_INTERVAL_DAYS) * 1000) / 1000));
      if (conditions[player.id] !== expected) fail(`conditions.${player.id}`, 'does not match the last committed recovery boundary');
      if (match.status === 'ready' && (club.id === home.id || club.id === away.id) && match.stats[player.id]!.condition !== conditions[player.id]) fail(`activeMatch.stats.${player.id}.condition`, 'must match current season condition before tipoff');
    }
  }
}

/** Validate every reference and committed round before replacing any live season. */
export function validateSeasonState(value: unknown): asserts value is SeasonState { validateState(value, 30); }

export function serializeSeason(state: SeasonState): string {
  validateSeasonState(state);
  const text = JSON.stringify({ format: FORMAT, formatVersion: 30, engineVersion: 'possession-3', state });
  checkSize(text);
  return text;
}

/** Old schemas had immutable pack rosters; ownership is recoverable, discarded box scores are not. */
function migrateRosterHistory(previous: SeasonState, version: number): SeasonState {
  const seasonNumber = version >= 3 ? previous.seasonNumber : 1;
  const clubs = previous.clubs, rosters = createRosterSnapshots(clubs, seasonNumber);
  const refsFor = (snapshots: readonly RosterSnapshot[], fixture: Pick<SeasonFixture, 'homeClubId' | 'awayClubId' | 'round'>) => ({
    home: rosterForRound(snapshots, fixture.homeClubId, fixture.round).id,
    away: rosterForRound(snapshots, fixture.awayClubId, fixture.round).id,
  });
  const training = version >= 5 ? previous.training : version === 4 ? migrateTrainingCoaching(previous.training) : createTraining(clubs, false);
  return {
    ...previous, schemaVersion: 30, board: createBoard(), relationships: createRelationships(), facilities: createFacilities(clubs, previous.managedClubId), seasonNumber, rosters, scouts: createScouts(), fitness: createFitness(), physio: createPhysio(), assistant: createAssistant(), academy: createAcademy(), youth: createYouth(), lifecycle: createLifecycle(), youthCompetition: createYouthCompetition(), employment: createEmployment(), scouting: createScouting(clubs, previous.managedClubId), negotiations: createNegotiations(), market: createMarket(), recruitment: createRecruitment(),
    manager: version >= 8 ? previous.manager : null,
    injuryMode: version >= 2 ? previous.injuryMode : 'off',
    injuries: version >= 2 ? previous.injuries : [],
    training: {
      ...training,
      lastWeek: training.lastWeek ? { ...training.lastWeek, rosterIds: Object.fromEntries(clubs.map(club => [club.id, rosterForRound(rosters, club.id, training.lastWeek!.afterRound).id])) } : null,
    },
    coaching: version >= 5 ? previous.coaching : createCoaching(clubs, seasonNumber, previous.round, false),
    finance: version >= 7 ? previous.finance : version === 6 ? { ...previous.finance, ledger: previous.finance.ledger.map(entry => ({ ...entry, payroll: null })) } : createFinance(clubs, previous.managedClubId),
    payroll: version >= 7 ? previous.payroll : createPayroll(clubs, previous.managedClubId),
    fixtures: previous.fixtures.map(fixture => ({ ...fixture, result: fixture.result ? { ...fixture.result, injuries: version >= 2 ? fixture.result.injuries : {}, rosterIds: refsFor(rosters, fixture) } : null })),
    history: version >= 3 ? previous.history.map(archive => {
      const archivedRosters = createRosterSnapshots(clubs, archive.seasonNumber);
      return { ...archive, rosters: archivedRosters, fixtures: archive.fixtures.map(fixture => ({ ...fixture, result: { ...fixture.result, rosterIds: refsFor(archivedRosters, fixture), stats: null } })) };
    }) : [],
  };
}

/** Keep every recorded single-offer outcome, enabling rival bids only after the imported journal. */
function migrateMarketCompetition(market: SeasonMarket): SeasonMarket {
  return {
    ...market,
    windows: market.windows.map(window => ({
      ...window, competitionFromEvent: window.closed || window.offers.some(isLiveMarketOffer) ? null : window.events.length,
      offers: window.offers.map(offer => ({ ...offer, chosenOfferId: null })),
    })),
  };
}

function migrateMarketTransfers(market: SeasonMarket): SeasonMarket {
  return { ...market, windows: market.windows.map(window => ({ ...window, offers: window.offers.map(offer => ({ ...offer, transfer: null })) })) };
}

export function parseSeason(text: string): SeasonState {
  checkSize(text);
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error('This is not a valid JSON season file.'); }
  checkJsonTree(parsed);
  const envelope = record(parsed, 'envelope', ['format', 'formatVersion', 'engineVersion', 'state']);
  if (envelope.format !== FORMAT || ![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30].includes(envelope.formatVersion as number) || envelope.engineVersion !== 'possession-3') throw new Error('This season file uses an unsupported save format or engine version.');
  const version = envelope.formatVersion as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 | 25 | 26 | 27 | 28 | 29 | 30;
  // Validate the original shape and accounting before adding any recoverable metadata.
  validateState(envelope.state, version);
  if (version === 30) return envelope.state as SeasonState;
  const previous = envelope.state as SeasonState;
  const previousMarket = version >= 13 ? version < 15 ? migrateMarketTransfers(version < 14 ? migrateMarketCompetition(previous.market) : previous.market) : previous.market : createMarket();
  const upgraded: SeasonState = version >= 9 ? {
    ...previous, schemaVersion: 30, board: createBoard(), relationships: version >= 29 ? previous.relationships : createRelationships(), facilities: version >= 28 ? previous.facilities : createFacilities(previous.clubs, previous.managedClubId), youthCompetition: version >= 27 ? previous.youthCompetition : createYouthCompetition(), lifecycle: version >= 26 ? previous.lifecycle : createLifecycle(), academy: version >= 25 ? previous.academy : createAcademy(), youth: version >= 25 ? previous.youth : createYouth(), assistant: version >= 24 ? previous.assistant : createAssistant(), physio: version >= 23 ? previous.physio : createPhysio(), fitness: version >= 22 ? previous.fitness : createFitness(), scouts: version >= 21 ? previous.scouts : createScouts(), recruitment: version >= 19 ? previous.recruitment : version === 18 ? migrateRecruitmentTransfers(previous.recruitment) : createRecruitment(),
    employment: version >= 10 ? { ...(version < 16 ? migrateTransferPayments({ ...previous.employment, transfers: version >= 15 ? previous.employment.transfers : [] }) : previous.employment), buyouts: version >= 17 ? previous.employment.buyouts : [], contracts: previous.employment.contracts.map(contract => ({ ...contract, startsRound: version >= 18 ? contract.startsRound : 1 })), transfers: (version < 16 ? migrateTransferPayments({ ...previous.employment, transfers: version >= 15 ? previous.employment.transfers : [] }).transfers : previous.employment.transfers).map(transfer => ({ ...transfer, startsRound: version >= 19 ? transfer.startsRound : 1 })) } : createEmployment(),
    scouting: version >= 11 ? previous.scouting : createScouting(previous.clubs, previous.managedClubId), negotiations: version >= 12 ? previous.negotiations : createNegotiations(),
    market: { ...previousMarket, windows: previousMarket.windows.map(window => ({ ...window, offers: window.offers.map(offer => ({ ...offer, transfer: offer.transfer ? { ...offer.transfer, paymentPlan: version < 16 ? 'upfront' as const : offer.transfer.paymentPlan } : null })) })) },
  } : migrateRosterHistory(previous, version);
  validateSeasonState(upgraded);
  return upgraded;
}

export async function saveLocalSeason(state: SeasonState, expectedRevision: number): Promise<void> { await writeLocalSeason(serializeSeason(state), expectedRevision); }
export async function loadLocalSeason(): Promise<SeasonState | null> { const text = await readLocalSeason(); return text === null ? null : parseSeason(text); }
