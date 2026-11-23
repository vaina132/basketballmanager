import { clubRosterLimit, clubSalaryBudget, clubSalaryCeiling, isCapClub, minRosterSize, usesFullClubRoster } from '../world/club-roster-policy';
import { NBA_CAP_ROUTES, NBA_LOWEST_MINIMUM, type NbaCapRoute } from '../world/nba-cap';
import { nbaRegularSeasonEndRound, nbaTaxBills } from '../world/nba-cap-policy';
import { isNbaPaidPlayer, nbaSalaryFloorShortfall, usesNbaMoves } from '../world/nba-moves';
import { TRADES_FORMAT, validateTradeAt, validateTradeRecords, validateTradesState } from './trades-validation';
import { seasonSalaryCeiling, staffAllocationCeiling } from '../world/board-consequences';
import { usesWagePool } from '../world/wage-pool';
import { usesClubLevelStaff } from '../world/staff-levels';
import { staffWagesSourceId, staffWeekWages, usesStaffContracts } from '../world/staff-contracts';
import { selectedTeam } from '../world/matchday-selection';
import { createBoard } from '../world/board';
import type { SeasonBoard } from '../domain/board';
import type { SeasonCommercial } from '../domain/commercial';
import { validateBoard } from './board-validation';
import { validateCommercial } from './commercial-validation';
import { commercialGovernsSeason, createCommercial, exitSourceId, namingPaymentsDue, openingSponsorshipClubs, sponsorshipPaymentsDue } from '../world/commercial-policy';
import { createRelationships } from '../world/relationships';
import type { SeasonRelationships } from '../domain/relationships';
import type { SeasonMedia } from '../domain/media';
import { validateRelationships } from './relationships-validation';
import type { ArchivedFixture, ClubPlan, DomesticDivisions, FixtureResult, SeasonArchive, SeasonEurope, SeasonFixture, SeasonInjury, SeasonState } from '../domain/season';
import { SEASON_SCHEMA_VERSION } from '../domain/season';
import { usesEconomyBalance } from '../world/economy-balance';
import { surplusWageCeiling, usesSurplusSpending } from '../world/surplus-spending';
import { isInjuryKind, isMatchInjuryKind, type InjuryModel } from '../domain/injuries';
import type { SeasonNational } from '../domain/national';
import { STANDINGS_RULE_FORMAT } from '../domain/competition';
import type { BackgroundClub, ClubExchange, SeasonBackground } from '../domain/background';
import type { EmploymentDeparture } from '../domain/employment';
import { computeExchanges, departureFor, joinedContracts, leavingRecord } from '../world/exchanges';
import { createBackground, validateBackground } from '../world/background';
import { backgroundConditions, backgroundRosterId, backgroundSide } from '../world/europe';
import { EUROPEAN_FORMAT_VERSION, playedEuropeanCompetitions } from '../world/european-formats';
import { openingEurope } from '../world/european-places';
import { openingEuropeTwo } from '../world/european-entry';
import { selectBackgroundMatchday } from '../world/background';
import type { FacilityAnchor, FacilityEvent, FacilityType, SeasonFacilities } from '../domain/facilities';
import { createFacilities, applyFacilityEvent, facilitiesAtEventCount } from '../world/facilities';
import { FACILITY_RULES_3, facilityMaxLevel, facilityTypes, getArenaCapacity, getFacilityUpkeepBreakdown, medicalRecoveryPercent } from '../world/facilities-policy';
import { BANK_LOAN_RULES, debtSchedule, debtSourceId, FACILITY_FINANCING_RULES } from '../world/facility-debt';
import type { FinanceBalance, FinanceEntry } from '../domain/finance';
import type { PayrollCharge, PayrollItem, PlayerWageAgreement, SeasonPayroll } from '../domain/payroll';
import type { SeasonTraining, TrainingPlan, TrainingPoints, TrainingWeekReport } from '../domain/training';
import type { RosterSnapshot } from '../domain/roster';
import type { SeasonEmployment, EmploymentContract, EmploymentTransfer, EmploymentBuyout } from '../domain/employment';
import type { SeasonScouting } from '../domain/scouting';
import type { SeasonScouts, ScoutContract } from '../domain/scouts';
import type { SeasonFitness, FitnessContract } from '../domain/fitness';
import type { SeasonPhysio, PhysioContract } from '../domain/physio';
import type { SeasonAssistant, AssistantContract } from '../domain/assistant';
import type { AcademyWeek, AcademyWeekFullPlayer, SeasonAcademy } from '../domain/academy';
import type { SeasonLifecycle } from '../domain/lifecycle';
import type { SeasonYouth, YouthCoachContract } from '../domain/youth';
import type { SeasonYouthCompetition, YouthFixture, YouthFixtureFull } from '../domain/youth-competition';
import type { SeasonNegotiations } from '../domain/negotiations';
import type { MarketEvent, MarketWindow, SeasonMarket } from '../domain/market';
import type { InSeasonEvent, SeasonRecruitment } from '../domain/recruitment';
import type { CoachingWeekAssignment, SeasonCoaching } from '../domain/coaching';
import type { PlayerStats, Side, Team } from '../domain/types';
import { DEVELOPMENT_DATA_PACK_ID, DEVELOPMENT_START_DATE } from '../data/development-league';
import { DEVELOPMENT_COACHES } from '../data/development-coaches';
import { DEVELOPMENT_SCOUTS } from '../data/development-scouts';
import { DEVELOPMENT_FITNESS_COACHES } from '../data/development-fitness';
import { DEVELOPMENT_PHYSIOS } from '../data/development-physios';
import { DEVELOPMENT_ASSISTANTS } from '../data/development-assistants';
import { DEVELOPMENT_YOUTH_COACHES } from '../data/development-youth';
import { isNbaClub, clubHasAcademy, clubsEverInFullWorld, fixtureRuleset, fullWorldClubs, fullWorldClubsIn, isMemberList, isWorldClub, playsAtNeutralVenue, roundKey, roundOrdinal, seasonRounds, validateWorld, worldOf, worldPlayer, worldRounds } from '../world/career-world';
import type { CareerWorld, SeasonEconomy, WorldContext } from '../domain/world';
import { getCareerPlayers, getCareerPlayer, getCareerWage, type CareerPlayerContext } from '../world/player-catalog';
import { MAX_MATCH_PERIODS } from '../engine/match';
import { isCourtPosition } from '../engine/positions';
import { applyExchanges, plansWithDefaults, domesticSchedule, europeanPlacesAfter, DAILY_RECOVERY, dateForRound, fixtureSeed, getPostseasons, seasonExchangesOf, getStandings, MAX_SEASON_NUMBER, recoverThroughGameDays, ROUND_INTERVAL_DAYS, scheduledFixtures, weekCloseCondition, weekLastGameDate } from '../world/season';
import { divisionChanges, openingDivisions, seasonLeagues } from '../world/divisions';
import { calendarDaysBetween } from '../world/competition-calendar';
import { createSeasonInjury, isRecovering } from '../world/health';
import { INJURY_MODEL_2 } from '../domain/injuries';
import { createTraining, developClub, processTrainingWeek, TRAINING_ATTRIBUTES, TRAINING_FOCUSES, TRAINING_INTENSITIES } from '../world/training';
import { potentialPointCap, trainingHeadroom } from '../world/potential';
import { coachingAssignments, COACHING_BUDGET, createCoaching, MAX_COACHES } from '../world/coaching';
import { annualFundingFor, annualSponsorshipFor, createFinance, forecastGate, fundingSourceId, maxTicketPriceFor, openingCashFor, roundOperatingCostFor, seasonFundingShare, TICKET_PRICE_STEP } from '../world/finance';
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
import { academyAtBoundary, buildAcademyWeek, createAcademy, enableAcademy, graduateAcademyProspect, prepareAcademySeason, processAcademyWeek } from '../world/academy';
import { validationReplayCache } from './replay-cache';
import { knownTrees, prefixPlan, recall, remember, SCOUTING_REVIEWS, trustedCutKey, trustedPrefixMismatch, withPrefixCheck, type CheckRecord } from './trusted-prefix';
import { canSummarizeAcademyReport, createAcademyHistoryContext, isAcademyOutcome, summarizeAcademyHistory, summarizeAcademyPlayer } from '../world/academy-history';
import { createYouth } from '../world/youth';
import { buildYouthClubTeam, createYouthCompetition, enableYouthCompetition, prepareYouthSeason, prepareYouthFixture, settleYouthFixture, getYouthPlayerStatus, youthCompetitionAtBoundary, youthInjuryHistory, youthSeasonFixtures, youthShortageResult, YOUTH_DEFAULT_REASON, YOUTH_RECURRENCE_MODEL } from '../world/youth-competition';
import { youthCoachAssignments } from '../world/youth-policy';
import { canSummarizeYouthFixture, createYouthHistoryContext, isYouthOutcome, summarizeYouthFixture, summarizeYouthHistory, type YouthHistoryContext } from '../world/youth-history';
import { createLifecycle, enableLifecycle, lifecycleAtBoundary, prepareLifecycleSeason } from '../world/lifecycle';
import { getPlayerAging, type LifecycleContext } from '../world/lifecycle-policy';
import { processRehabilitationWeek } from '../world/rehabilitation';
import { MAX_SCOUTS, scoutEvidence } from '../world/scout-policy';
import { staffAllocation, usesFullStaff } from '../world/staff-policy';
import type { SeasonRivalries } from '../domain/rivalries';
import { createRivalries } from '../world/rivalries';
import { validateRivalries, validateRivalryGrowth } from './rivalries-validation';
import { validateEconomyHistory, validateEconomySeasonsShape } from './economy-validation';
import type { SeasonCareer } from '../domain/career';
import { createCareer, deferCareerDecisions, managedClubAtLedger, managedClubAtRound, managedClubFor, matchClubFor, releaseAcademyFocus } from '../world/career';
import { validateCareer, validateCareerDecisions } from './career-validation';
import { NO_CLUB } from '../world/career-rules';
import { createNegotiations } from '../world/negotiations';
import { applyMarketEvent, createMarket } from '../world/market';
import { applyInSeasonEvent, createInSeasonRecruitment as createRecruitment } from '../world/recruitment';
import { getTransferPaymentSchedule, processTransferPayments } from '../world/transfer-payments';
import { addMarketDays, MARKET_MAX_EVENTS, MARKET_WINDOW_DAYS, isLiveMarketOffer } from '../world/market-policy';
import { evaluateNegotiation } from '../world/negotiations-policy';
import { contractRolesApply, isSquadRole, roleWage } from '../world/contract-roles';
import { contractForSeason, contractForRound, effectiveContractsForSeason, effectiveContractsForRound, getContractedClubs, getContractedClubsForRound, registrationChangeRounds, quotePlayerContract, MIN_ROSTER_SIZE, MIN_CONTRACT_WAGE, maxContractWage, MAX_CONTRACT_SEASONS, WAGE_STEP, lowestMinimumSquadWage } from '../world/employment-policy';
import { maxTransferFee } from '../world/transfers-policy';
import { maxReleaseFee } from '../world/release-clauses';
import { readLocalSeason, writeLocalSeason } from './season-indexed-db';
import { validateMatchState } from './validate-match';
import { FIBA_2024, gameSeconds, rulesetById, type Ruleset } from '../engine/rulesets';
import { MAX_SEASON_COLLECTION_ENTRIES, MAX_SEASON_SAVE_BYTES, MAX_SEASON_SAVE_VALUES } from './season-limits';
import { ASSISTANT_DIRECTORY, COACH_DIRECTORY, FITNESS_DIRECTORY, PHYSIO_DIRECTORY, SCOUT_DIRECTORY, YOUTH_COACH_DIRECTORY, staffMember } from '../data/staff-directory';
import { COMPACT_JSON_3_ENCODING, COMPACT_JSON_ENCODING, LEGACY_COMPACT_JSON_ENCODING, compactJson3, expandJson, expandJson3 } from './compact-json';
import { cachedCalculation, withCalculationCache } from '../world/pure-cache';
import { ledgerBoundaryIndex } from './ledger-boundaries';
import { appendFinanceLedgerEntry, financeAtLedgerBoundary, financeLedgerCount, financeLedgerEntry, financeLedgerSlice } from '../world/finance-ledger';
import { archiveFinancialHistory, MAX_FINANCE_LOGICAL_ENTRIES, MAX_FINANCE_SEGMENT_ENTRIES } from '../world/finance-archives';
import { expandFinanceForValidation } from './finance-archive-validation';
import { fixturePlayerEvidence, summarizeSeniorHistory } from '../world/senior-history';
import { validateArchivedAppearances, validateSealedSeniorSummary, validateSeniorSummary } from './senior-history-validation';
import { isSealedSeniorResult, isSealedYouthFixture, sealCompletedHistory, SEALED_HISTORY_FORMAT, seniorSealedThrough } from '../world/sealed-history';
import { abilityShapeProblem } from '../world/extra-attributes';
import { ACADEMY_GRADUATION_AGE, academyPointCap, developAcademyPlayer, emptyAcademyPoints } from '../world/academy-policy';
import { playerAgeOnDate } from '../data/development-player-profiles';
import { staffFee } from '../world/economy';
import { PACKED_SAVE_FORMAT, packSeasonForSave, unpackSavedSeason } from './save-packing';
import { isNationalFixtureId, nationalDutyDays } from '../world/national';
import { validateNationalShape, withEarlierNationalFields } from './national-validation';
import { validateCoachesShape } from './coaches-validation';
import { COACH_STEERING_MODEL, type SteeringCoach } from '../world/coach-steering';
import { computerCoachRotation, trainingCoaches } from '../world/head-coaches';

export { MAX_SEASON_SAVE_BYTES } from './season-limits';
export { SEASON_SCHEMA_VERSION } from '../domain/season';
const FORMAT = 'basketball-manager-season';
/** Every accepted season format; older formats are validated as written, then migrated to the current one. */
type SeasonFormatVersion = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 | 25 | 26 | 27 | 28 | 29 | 30 | 31 | 32 | 33 | 34 | 35 | 36 | 37 | 38 | 39 | 40 | 41 | 42 | 43 | 44 | 45 | 46 | 47 | 48 | 49 | 50 | 51 | 52 | 53 | 54 | 55 | 56 | 57 | 58 | 59 | 60 | 61 | 62 | 63 | 64 | 65 | 66 | 67 | 68 | 69 | 70 | 71 | 72 | 73 | 74 | 75 | 76 | 77 | 78 | 79 | 80 | 81 | 82 | 83 | 84 | 85 | 86 | 87 | 88 | 89 | 90 | 91 | 92 | 93 | 94;
const SUPPORTED_FORMATS: readonly number[] = Array.from({ length: SEASON_SCHEMA_VERSION }, (_, index) => index + 1);
/**
 * The first format that carries six facility levels, arena seats and the simple bank loan (`facilities-3`, `bank-1`).
 * They went live while the schema was still 73, so format-73 careers started with them stay valid; format 74 adds the
 * opening staff and squad roles on top.
 */
const SIX_LEVEL_FORMAT = Math.min(73, SEASON_SCHEMA_VERSION);
const SIDES = ['home', 'away'] as const;
const STAT_KEYS: readonly (keyof PlayerStats)[] = [
  'secondsPlayed', 'points', 'fieldGoalsMade', 'fieldGoalsAttempted', 'threePointersMade',
  'threePointersAttempted', 'freeThrowsMade', 'freeThrowsAttempted', 'rebounds', 'assists',
  'steals', 'blocks', 'turnovers', 'fouls', 'condition',
];
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function fail(path: string, reason: string): never { throw new Error(`Invalid season save: ${path} ${reason}.`); }

/** The canonical games of a season given its own results (regular calendar plus due postseason games, step 3.4b). */
function canonicalFixtures(context: { clubs: readonly Team[]; fixtures: unknown; world: CareerWorld; divisions?: DomesticDivisions; seed: number; europe?: SeasonEurope; national?: unknown }, seasonNumber: number, path: string): SeasonFixture[] {
  if (!Array.isArray(context.fixtures)) fail(path, 'must be an array');
  try { return scheduledFixtures({ ...context, fixtures: context.fixtures as SeasonFixture[] }, seasonNumber); }
  catch { return fail(path, 'does not match the versioned schedule'); }
}
/** Step 3.4c: a season's division memberships must list the world's leagues in order, each at its opening size, covering every club once. */
function validateDivisionShape(value: unknown, world: CareerWorld, path: string, seasonNumber: number): DomesticDivisions {
  const divisions = record(value, path, ['changesFrom', 'leagues']);
  number(divisions.changesFrom, `${path}.changesFrom`, 1, seasonNumber);
  const leagues = array(divisions.leagues, `${path}.leagues`, world.domesticLeagues!.length), seen = new Set<string>();
  for (const [index, value] of leagues.entries()) {
    const league = record(value, `${path}.leagues[${index}]`, ['id', 'clubIds']), opening = world.domesticLeagues![index]!;
    if (league.id !== opening.id || !Array.isArray(league.clubIds) || league.clubIds.length !== opening.clubIds.length) fail(`${path}.leagues[${index}]`, 'must list the world\'s league at its opening size');
    for (const id of league.clubIds as unknown[]) { if (typeof id !== 'string' || seen.has(id) || !world.clubs.some(club => club.id === id)) fail(`${path}.leagues[${index}].clubIds`, 'must assign each club to exactly one league'); seen.add(id); }
  }
  if (seen.size !== fullWorldClubs(world).length) fail(`${path}.leagues`, 'must cover every club of the full world');
  return divisions as unknown as DomesticDivisions;
}

/**
 * Step 3.4c: every season's memberships follow from the opening leagues and the promotions and relegations of each
 * season from `changesFrom` on. Archives before it (played before format 50) carry none.
 */
function validateDivisionHistory(state: SeasonState): void {
  const world = worldOf(state), divisions = state.divisions!;
  let expected = world.domesticLeagues!.map(league => ({ id: league.id, clubIds: [...league.clubIds] }));
  for (const archive of state.history) {
    const path = `history[${archive.seasonNumber - 1}].divisions`;
    if (archive.seasonNumber < divisions.changesFrom) { if (archive.divisions !== undefined) fail(path, 'cannot be recorded before division changes began'); continue; }
    if (!sameData(archive.divisions, { changesFrom: divisions.changesFrom, leagues: expected })) fail(path, 'must follow from the opening leagues and each completed season\'s promotions and relegations');
    // Step 3.4d-2: each season end's exchanges with a next division follow the moves between divisions.
    try { expected = applyExchanges(divisionChanges(seasonLeagues(world, archive.divisions), getPostseasons({ world, fixtures: archive.fixtures, divisions: archive.divisions }, archive.seasonNumber)).leagues, seasonExchangesOf(state.background, archive.seasonNumber)); }
    catch (error) { fail(path, `cannot move clubs between divisions: ${error instanceof Error ? error.message : 'invalid postseason'}`); }
  }
  if (!sameData(divisions.leagues, expected)) fail('divisions.leagues', 'must follow from the opening leagues and each completed season\'s promotions and relegations');
}

/** Step 3.5f: a season's European places list every played competition in order at its field size, each club once. */
function validateEuropeShape(value: unknown, world: CareerWorld, path: string, version = SEASON_SCHEMA_VERSION): SeasonEurope {
  const two = value !== null && typeof value === 'object' && (value as { model?: unknown }).model === 'places-2';
  if (two && version < 83) fail(`${path}.model`, 'places-2 requires format 83 or later');
  const optional = two ? (['held', 'decision', 'answers', 'offered'] as const).filter(key => Object.hasOwn(value as object, key)) : [];
  const europe = record(value, path, ['model', 'entrants', 'oneYear', ...optional]);
  if (europe.model !== 'places-1' && !two) fail(`${path}.model`, 'is unsupported');
  const competitions = playedEuropeanCompetitions(world), entrants = array(europe.entrants, `${path}.entrants`, competitions.length), seen = new Set<string>();
  for (const [index, value] of entrants.entries()) {
    const entry = record(value, `${path}.entrants[${index}]`, ['competitionId', 'clubIds', ...(two ? ['places'] : [])]), competition = competitions[index]!;
    if (entry.competitionId !== competition.id || !Array.isArray(entry.clubIds) || entry.clubIds.length !== competition.clubIds.length) fail(`${path}.entrants[${index}]`, 'must list the competition at its field size');
    for (const id of entry.clubIds as unknown[]) { if (typeof id !== 'string' || seen.has(id) || !world.clubs.some(club => club.id === id)) fail(`${path}.entrants[${index}].clubIds`, 'must list clubs of this world, each in one competition'); seen.add(id); }
    if (two) {
      const places = array(entry.places, `${path}.entrants[${index}].places`, (entry.clubIds as unknown[]).length);
      if (places.length !== (entry.clubIds as unknown[]).length) fail(`${path}.entrants[${index}].places`, 'must give every entrant one place');
      for (const [at, place] of places.entries()) validatePlace(place, `${path}.entrants[${index}].places[${at}]`);
    }
  }
  const euroleague = competitions.findIndex(competition => competition.kind === 'euroleague');
  if (!Array.isArray(europe.oneYear) || (europe.oneYear as unknown[]).some(id => euroleague < 0 || !((entrants[euroleague] as { clubIds: unknown[] }).clubIds.includes(id)))) fail(`${path}.oneYear`, 'must list EuroLeague entrants');
  if (two && Object.hasOwn(europe, 'held')) for (const [index, item] of boundedList(europe.held, `${path}.held`, 400).entries()) {
    const held = record(item, `${path}.held[${index}]`, ['clubId', 'competitionId', 'type', 'until', 'reason']);
    if (!world.clubs.some(club => club.id === held.clubId) || !competitions.some(competition => competition.id === held.competitionId) || !['licence', 'multi-year'].includes(held.type as string) || !(held.until === null || Number.isInteger(held.until)) || !['relegated', 'unpaid', 'declined', 'higher'].includes(held.reason as string)) fail(`${path}.held[${index}]`, 'must keep a licence or multi-year place of a club of this world');
  }
  if (two && Object.hasOwn(europe, 'answers')) for (const [index, item] of boundedList(europe.answers, `${path}.answers`, 6).entries()) {
    const answer = record(item, `${path}.answers[${index}]`, ['clubId', 'competitionId', 'accept']);
    if (typeof answer.clubId !== 'string' || !competitions.some(competition => competition.id === answer.competitionId) || typeof answer.accept !== 'boolean') fail(`${path}.answers[${index}]`, 'must answer an offered competition');
  }
  if (two && Object.hasOwn(europe, 'offered')) {
    const offered = array(europe.offered, `${path}.offered`, competitions.length);
    offered.forEach((value, index) => { const entry = record(value, `${path}.offered[${index}]`, ['competitionId', 'clubIds']); if (entry.competitionId !== competitions[index]!.id || !Array.isArray(entry.clubIds) || entry.clubIds.length !== competitions[index]!.clubIds.length || (entry.clubIds as unknown[]).some(id => typeof id !== 'string' || !world.clubs.some(club => club.id === id))) fail(`${path}.offered[${index}]`, 'must list the competition at its field size'); });
  }
  if (two && Object.hasOwn(europe, 'decision')) record(europe.decision, `${path}.decision`, ['seasonNumber', 'date', 'offers', 'lost', 'wildCards', 'chosen']);
  return europe as unknown as SeasonEurope;
}

const boundedList = (value: unknown, path: string, max: number): unknown[] => { if (!Array.isArray(value) || value.length > max) fail(path, 'must be a short list'); return value; };
const PLACE_TYPES = ['licence', 'multi-year', 'route', 'wild-card', 'one-year', 'drop-down', 'league', 'title-holder', 'invitation'];
/** Format 83: one entrant's place: a known type, an end season (none only for a permanent licence) and a reason. */
function validatePlace(value: unknown, path: string): void {
  const raw = value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
  const place = record(value, path, ['type', 'until', 'reason', ...(['rank', 'route'] as const).filter(key => Object.hasOwn(raw, key))]);
  if (!PLACE_TYPES.includes(place.type as string) || (place.until === null) !== (place.type === 'licence') || place.until !== null && !Number.isInteger(place.until) || typeof place.reason !== 'string') fail(path, 'must name a place type, its end season and its reason');
  if (Object.hasOwn(place, 'rank')) number(place.rank, `${path}.rank`, 1, 100);
  if (Object.hasOwn(place, 'route')) { number(place.route, `${path}.route`, 1, 3); if (place.type !== 'route') fail(`${path}.route`, 'belongs to a EuroCup route place'); }
}

/** A season's places as its places day decided them (the manager's later answers are kept beside them). */
const withoutAnswers = (europe: SeasonEurope | undefined): SeasonEurope | undefined => {
  if (!europe || !Object.hasOwn(europe, 'answers')) return europe;
  const { answers: _answers, ...rest } = europe;
  return rest;
};

/** Step 3.5f: the opening season uses the world's lists; every later season's places follow from the season before. */
function validateEuropeHistory(state: SeasonState, context: CareerPlayerContext): void {
  const world = worldOf(state), two = state.europe?.model === 'places-2';
  // Format 83: every season of a career uses one model; the places day rebuilds each season exactly, with the manager's answers.
  let expected = two ? openingEuropeTwo(world) : openingEurope(world);
  const extra = two ? { managedClubId: state.managedClubId, ...(state.career ? { career: state.career } : {}), board: state.board, ...(state.facilities ? { facilities: state.facilities } : {}), ...(state.economySeasons ? { economySeasons: state.economySeasons } : {}) } : {};
  const answersUsed = (europe: SeasonEurope, decided: SeasonEurope, path: string) => {
    for (const answer of europe.answers ?? []) if (!decided.decision?.offers.some(offer => offer.clubId === answer.clubId && offer.competitionId === answer.competitionId)) fail(`${path}.answers`, 'must answer a place offered to the club');
  };
  for (const archive of state.history) {
    const path = `history[${archive.seasonNumber - 1}].europe`;
    if (two !== (archive.europe?.model === 'places-2')) fail(path, 'must use the career\'s European places model');
    if (!sameData(withoutAnswers(archive.europe), expected)) fail(path, 'must follow from the opening lists and each completed season\'s orders and European results');
    try {
      expected = europeanPlacesAfter({ ...context, ...extra, world, seed: state.seed, seasonNumber: archive.seasonNumber, history: state.history, fixtures: archive.fixtures as unknown as SeasonFixture[], clubs: state.clubs, europe: archive.europe!, ...(archive.divisions ? { divisions: archive.divisions } : {}), ...(state.background ? { background: state.background } : {}) });
    } catch (error) { fail(path, `cannot decide the next season's places: ${error instanceof Error ? error.message : 'invalid results'}`); }
    if (two) answersUsed(archive.europe!, expected, path);
  }
  if (!sameData(withoutAnswers(state.europe), expected)) fail('europe', 'must follow from the opening lists and each completed season\'s orders and European results');
  if (two && state.europe!.answers) {
    if (state.status !== 'complete' || !state.managedClubId || state.europe!.answers.some(answer => answer.clubId !== state.managedClubId)) fail('europe.answers', 'are given by the manager\'s club once the season is complete');
    let decided: SeasonEurope | undefined;
    try { decided = europeanPlacesAfter({ ...context, ...extra, ...state, world } as unknown as SeasonState); } catch (error) { fail('europe.answers', `cannot decide the next season's places: ${error instanceof Error ? error.message : 'invalid results'}`); }
    answersUsed(state.europe!, decided!, 'europe');
  }
}

/** Whether a club was in the full world in that season (step 3.4d-2): staff appointments name a club of their own season. */
const inFullWorld = (context: WorldContext & { background?: SeasonBackground }, clubId: string, year: unknown) => typeof year === 'number' && Number.isInteger(year) && year >= 1 && fullWorldClubsIn(context, year).some(club => club.id === clubId);

/** Opening terms of clubs joining the full world among the first `count` contracts: they need no player response (step 3.4d-2). */
/** Agreements in a contract prefix that no player response explains: joining squads' opening terms (format 55) and `trade` contracts (format 94). */
const joinedIn = (contracts: readonly { kind: string }[] | undefined, count: number) => (contracts ?? []).slice(0, count).filter(contract => contract.kind === 'joined' || contract.kind === 'trade').length;

/**
 * Step 3.4d-2: every completed season's exchanges with a next division, and the record of clubs outside the full world,
 * rebuilt from the career's own results, squads and registrations. Exchanges are decided when a season completes; the
 * leaving clubs' records (their final registration minus players with another club's opening terms) and the returning
 * clubs' return season are written at the rollover.
 */
function validateBackgroundHistory(state: SeasonState, employment: SeasonEmployment | undefined, context: CareerPlayerContext): void {
  const background = state.background!, world = worldOf(state), rounds = seasonRounds(state);
  const lastCompleted = state.status === 'complete' ? state.seasonNumber : state.seasonNumber - 1;
  const exchanges: ClubExchange[] = [];
  let records: BackgroundClub[] = [];
  for (let year = background.changesFrom!; year <= lastCompleted; year += 1) {
    const fixtures = year === state.seasonNumber ? state.fixtures : state.history[year - 1]!.fixtures, divisions = divisionsInSeason(state, year);
    const found = computeExchanges({ world, seed: state.seed, seasonNumber: year, career: state.career, lifecycle: state.lifecycle, academy: state.academy, divisions, background: { ...background, exchanges: [...exchanges], clubs: records } }, getPostseasons({ world, fixtures, divisions }, year), dateForRound(1, year + 1));
    exchanges.push(...found);
    if (year >= state.seasonNumber || !found.length) continue;
    const registered = clubsForEmploymentYear(employment, year, rounds, context);
    records = records.map(club => club.until === undefined && found.some(exchange => exchange.joining.includes(club.id)) ? { ...club, until: year + 1 } : club);
    for (const exchange of found) for (const clubId of exchange.leaving) records.push(leavingRecord(state, registered.find(club => club.id === clubId)!, seasonLeagues(world, divisions).find(league => league.id === exchange.leagueId)!.country, year + 1, employment?.enabledSince ? employment : null));
  }
  if (!sameData(background.exchanges, exchanges)) fail('background.exchanges', 'must follow from each completed season\'s divisions, results and squads');
  if (!sameData(background.clubs, records)) fail('background.clubs', 'must hold exactly the clubs that left the full world, with their squads');
}

/** A season's own division memberships (step 3.4c): an archive's, or the current season's. */
const divisionsInSeason = (state: Pick<SeasonState, 'seasonNumber' | 'divisions' | 'history'>, year: number) => year === state.seasonNumber ? state.divisions : state.history.find(archive => archive.seasonNumber === year)?.divisions;

/** A fixture's exact fields: postseason games also carry their stage, series, game number and venue flag. */
const fixtureKeys = (expected: SeasonFixture): string[] => ['id', 'round', 'date', 'homeClubId', 'awayClubId', ...(expected.stage ? ['stage', 'seriesId', 'game', ...(expected.neutral ? ['neutral'] : [])] : []), ...(expected.competition ? ['competition'] : []), 'result'];
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
function validateOptionalReleaseFee(fields: Record<string, unknown>, path: string, context: WorldContext): void {
  if (!Object.hasOwn(fields, 'releaseFee')) return;
  // Format 62: worlds with a researched economy allow release fees up to EUR 50 million.
  const fee = number(fields.releaseFee, `${path}.releaseFee`, 100_000, maxReleaseFee(context));
  if (fee % 100_000) fail(`${path}.releaseFee`, 'must use whole thousand-euro steps');
}
/**
 * relationships-3 (squad roles everywhere): contracts, offers and player replies record the squad role offered. The key
 * is accepted only in careers whose contracts carry roles; replays then reproduce it exactly.
 */
function roleKeys(value: unknown, context: { relationships?: SeasonRelationships }): string[] {
  return value !== null && typeof value === 'object' && Object.hasOwn(value, 'role') && contractRolesApply(context) ? ['role'] : [];
}
function validateOptionalRole(fields: Record<string, unknown>, path: string): void {
  if (Object.hasOwn(fields, 'role') && !isSquadRole(fields.role)) fail(`${path}.role`, 'must identify a Star, Starter, Rotation, Reserve or Prospect role');
}
function validateTransferMode(fields: Record<string, unknown>, path: string, loans = false): void {
  if (!Object.hasOwn(fields, 'transferMode')) return;
  // Format 78 (`recruitment-2`): a loan offer for the rest of the season, with its fee paid at once.
  if (loans && fields.transferMode === 'loan' && Object.hasOwn(fields, 'transferFee') && fields.transferPaymentPlan === 'upfront' && fields.seasons === 1 && !Object.hasOwn(fields, 'releaseFee')) return;
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
/** Compare every retained row without allocating a second copy and key list of a growing ledger prefix. */
function samePrefix(actual: readonly unknown[], source: readonly unknown[]): boolean {
  if (actual.length > source.length) return false;
  for (let index = 0; index < actual.length; index += 1) if (!sameData(actual[index], source[index])) return false;
  return true;
}
function score(value: unknown, path: string): Record<Side, number> {
  const fields = record(value, path, SIDES);
  return { home: number(fields.home, `${path}.home`, 0, 1_000_000), away: number(fields.away, `${path}.away`, 0, 1_000_000) };
}
function checkSize(text: string): void {
  if (text.length > MAX_SEASON_SAVE_BYTES || new TextEncoder().encode(text).byteLength > MAX_SEASON_SAVE_BYTES) throw new Error('The season file is too large. The season save limit is 32 MB.');
}
/**
 * Bounds and plain-data checks of a save's JSON tree; returns its node count. `known` parts (`knownTrees`) add their
 * recorded node counts instead of being walked again.
 */
function checkJsonTree(root: unknown, known?: ReadonlyMap<object, number>, startDepth = 0): number {
  const pending: { value: unknown; depth: number }[] = [{ value: root, depth: startDepth }];
  let count = 0;
  while (pending.length) {
    const { value, depth } = pending.pop()!;
    const nodes = known && value !== null && typeof value === 'object' ? known.get(value) : undefined;
    if ((count += nodes ?? 1) > MAX_SEASON_SAVE_VALUES || depth > 40) throw new Error('The season file has too many values or nested objects.');
    if (nodes !== undefined || value === null || typeof value !== 'object') continue;
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error('The season must contain plain save data.');
    const entries = Object.entries(value);
    if (entries.length > MAX_SEASON_COLLECTION_ENTRIES) throw new Error('The season file contains an oversized collection.');
    for (const [key, child] of entries) {
      if (FORBIDDEN_KEYS.has(key)) throw new Error('The season file contains an unsafe property.');
      pending.push({ value: child, depth: depth + 1 });
    }
  }
  return count;
}
/** A checkpoint check's tree walk, reusing what the trusted check (or an earlier walk of this check) counted. */
const checkStateTree = (value: unknown) => checkJsonTree(value, knownTrees(value, (part, depth) => checkJsonTree(part, undefined, depth)));

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
/** `rules`: the competition's rules (NBA step 3); every league plays FIBA until a league records the NBA rules. */
function validateResult(value: unknown, path: string, home: Team, away: Team, legacy: boolean, rosterAware = false, selection = false, rules: Ruleset = FIBA_2024): FixtureResult {
  const fields = record(value, path, ['score', 'officialScore', 'winnerClubId', 'kind', 'periods', 'stats', ...(legacy ? [] : ['injuries']), ...(rosterAware ? ['rosterIds'] : []), ...(selection ? ['selection'] : [])]);
  const injuries = legacy ? {} : validateInjuryMap(fields.injuries, `${path}.injuries`, [...home.players, ...away.players].map(player => player.id));
  const { periods, earned, loser } = validateResultSummary(fields, path, home, away);
  const elapsedLimit = gameSeconds(rules, periods);
  const players = [...home.players, ...away.players];
  const stats = record(fields.stats, `${path}.stats`, players.map(player => player.id));
  const totals = { home: { points: 0, seconds: 0, eligible: 0, made: 0, assists: 0, steals: 0, blocks: 0, turnovers: 0, misses: 0 }, away: { points: 0, seconds: 0, eligible: 0, made: 0, assists: 0, steals: 0, blocks: 0, turnovers: 0, misses: 0 } };
  for (const side of SIDES) {
    const team = side === 'home' ? home : away;
    for (const player of team.players) {
      const location = `${path}.stats.${player.id}`;
      const entry = record(stats[player.id], location, STAT_KEYS);
      for (const key of STAT_KEYS) number(entry[key], `${location}.${key}`, key === 'condition' ? 35 : 0, key === 'secondsPlayed' ? elapsedLimit : key === 'fouls' ? rules.foulOut : key === 'condition' ? 100 : 1_000_000, key !== 'condition');
      const stat = entry as unknown as PlayerStats;
      if (stat.fieldGoalsMade > stat.fieldGoalsAttempted || stat.threePointersMade > stat.threePointersAttempted || stat.freeThrowsMade > stat.freeThrowsAttempted) fail(location, 'has more makes than attempts');
      if (stat.threePointersMade > stat.fieldGoalsMade || stat.threePointersAttempted > stat.fieldGoalsAttempted || stat.fieldGoalsMade - stat.threePointersMade > stat.fieldGoalsAttempted - stat.threePointersAttempted) fail(location, 'has inconsistent two-point and three-point totals');
      if (stat.points !== 2 * stat.fieldGoalsMade + stat.threePointersMade + stat.freeThrowsMade) fail(location, 'has points inconsistent with shooting');
      const total = totals[side];
      total.points += stat.points; total.seconds += stat.secondsPlayed; total.eligible += stat.fouls < rules.foulOut && !Object.hasOwn(injuries, player.id) ? 1 : 0;
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
function validateArchivedResult(value: unknown, path: string, home: Team, away: Team, rosterAware = false, outcomes = false, selection = false, rules: Ruleset = FIBA_2024): ArchivedFixture['result'] {
  const summarized = outcomes && value !== null && typeof value === 'object' && Object.hasOwn(value, 'appearances');
  const fields = record(value, path, ['score', 'officialScore', 'winnerClubId', 'kind', 'periods', 'injuries', ...(rosterAware ? ['stats', 'rosterIds'] : []), ...(summarized ? ['appearances'] : []), ...(selection ? ['selection'] : [])]);
  if (summarized) {
    validateResultSummary(fields, path, home, away);
    validateInjuryMap(fields.injuries, `${path}.injuries`, [...home.players, ...away.players].map(player => player.id));
    validateArchivedAppearances(fields as unknown as ArchivedFixture['result'], path, home, away, rules);
    return fields as unknown as ArchivedFixture['result'];
  }
  if (rosterAware && fields.stats !== null) return validateResult(value, path, home, away, false, true, selection, rules);
  validateResultSummary(fields, path, home, away);
  validateInjuryMap(fields.injuries, `${path}.injuries`, [...home.players, ...away.players].map(player => player.id));
  return fields as unknown as ArchivedFixture['result'];
}

/** Each registration boundary retains the precise players and jersey assignments then in force. */
function validateRosters(value: unknown, path: string, clubs: readonly Team[], seasonNumber: number, employment?: SeasonEmployment, throughRound?: number, context: CareerPlayerContext = {}): RosterSnapshot[] {
  throughRound ??= seasonRounds(context);
  const expected = rostersForEmploymentYear(employment, seasonNumber, throughRound, context);
  if (!sameData(value, expected) || !sameData(clubs, clubsForEmploymentYear(employment, seasonNumber, throughRound, context))) fail(path, 'must preserve the exact opening and arrival roster snapshots at their registration boundaries');
  return value as RosterSnapshot[];
}

/** Step 3.5b: a background side's expected roster reference and matchday selection for a European game. */
type BackgroundSelection = (clubId: string) => { rosterId: string; team: Team };

function recordedTeams(value: unknown, fixture: SeasonFixture, clubs: readonly Team[], rosters: readonly RosterSnapshot[], path: string, outcomes = false, selection = false, background?: BackgroundSelection): { home: Team; away: Team } {
  const summarized = outcomes && value !== null && typeof value === 'object' && Object.hasOwn(value, 'appearances');
  const fields = record(value, path, ['score', 'officialScore', 'winnerClubId', 'kind', 'periods', 'injuries', 'stats', 'rosterIds', ...(summarized ? ['appearances'] : []), ...(selection ? ['selection'] : [])]);
  const refs = record(fields.rosterIds, `${path}.rosterIds`, SIDES);
  const selected = selection ? record(fields.selection, `${path}.selection`, ['home', 'away', 'rested']) : null;
  const restingIds: string[] = [];
  const teams = Object.fromEntries(SIDES.map(side => {
    const clubId = side === 'home' ? fixture.homeClubId : fixture.awayClubId;
    if (fixture.competition && !clubs.some(club => club.id === clubId)) {
      if (!background || !selected) fail(`${path}.rosterIds.${side}`, 'must identify a club of this season');
      const expected = background!(clubId);
      if (refs[side] !== expected.rosterId) fail(`${path}.rosterIds.${side}`, 'must identify the background club\'s squad for the season');
      if (!sameData(selected![side], expected.team.players.map(player => player.id))) fail(`${path}.selection.${side}`, 'must be the background club\'s matchday selection of its best available players');
      return [side, expected.team];
    }
    const snapshot = rosterForRound(rosters, clubId, fixture.round);
    if (refs[side] !== snapshot.id) fail(`${path}.rosterIds.${side}`, 'must identify this club\'s registered roster at the fixture boundary');
    const registered = { ...clubs.find(club => club.id === clubId)!, players: snapshot.players };
    if (!selected) return [side, registered];
    if (!Array.isArray(selected[side])) fail(`${path}.selection.${side}`, 'must list selected players');
    const ids = selected[side] as string[];
    let chosen: Team;
    try { chosen = selectedTeam(registered, ids); } catch { fail(`${path}.selection.${side}`, 'must select five to twelve distinct registered players'); }
    restingIds.push(...snapshot.players.filter(player => !ids.includes(player.id)).map(player => player.id));
    return [side, chosen];
  })) as unknown as { home: Team; away: Team };
  if (selected) { const resting = record(selected.rested, `${path}.selection.rested`, restingIds); for (const id of restingIds) number(resting[id], `${path}.selection.rested.${id}`, 35, 100, false); }
  return teams;
}

/** Compact result diagnoses identify both new injuries and players already unavailable. */
function validateInjuryMap(value: unknown, path: string, playerIds: readonly string[]): Record<string, SeasonInjury['kind']> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object');
  const fields = value as Record<string, unknown>;
  for (const [id, kind] of Object.entries(fields)) {
    if (!playerIds.includes(id)) fail(`${path}.${id}`, 'must identify a participating player');
    if (!isInjuryKind(kind)) fail(`${path}.${id}`, 'must identify a supported injury');
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

function completedDevelopmentWeeks(anchor: { seasonNumber: number; round: number } | null, seasonNumber: number, round: number, rounds: number): number {
  return anchor ? (seasonNumber - anchor.seasonNumber) * (rounds - 1) + Math.min(round - 1, rounds - 1) - (anchor.round - 1) : 0;
}

/**
 * A bound on one season's coaching contracts. `coaching-1` careers are bounded by the catalog coaching limit; club-level
 * careers by money only (hires, sackings and rehires), so they get a generous fixed bound.
 */
function maximumCoachingContracts(clubs: number, levelled: boolean): number {
  return levelled ? Math.max(20_000, clubs * MAX_COACHES * 4) : clubs * Math.floor(COACHING_BUDGET / Math.min(...DEVELOPMENT_COACHES.map(coach => coach.fee)));
}

/** Current-year contracts retain released appointments so expenditure and past weeks reconcile. */
function validateCoaching(value: unknown, clubs: readonly Team[], seasonNumber: number, round: number, rounds: number, version: number): SeasonCoaching {
  const contracted = value !== null && typeof value === 'object' && (value as { model?: unknown }).model === 'coaching-4';
  const full = value !== null && typeof value === 'object' && Object.hasOwn(value, 'fullStaff');
  const fields = record(value, 'coaching', ['model', 'enabledSince', 'contracts', ...(contracted ? ['terms'] : []), ...(full ? ['fullStaff'] : [])]);
  // Format 74 ('coaching-2'): every club starts staffed and a sacked coach's fee stops counting against the limits.
  // Format 75 ('coaching-3'): 'coaching-2' with one wage pool for player wages and staff fees.
  // Format 76 ('coaching-4'): 'coaching-3' with staff contracts of 1-3 seasons (`terms`), weekly salaries and compensation.
  if (fields.model !== 'coaching-1' && fields.model !== 'coaching-2' && fields.model !== 'coaching-3' && fields.model !== 'coaching-4') fail('coaching.model', 'is unsupported');
  const levelled = fields.model === 'coaching-2' || fields.model === 'coaching-3' || fields.model === 'coaching-4';
  if (contracted && version < 76) fail('coaching.model', 'requires format 76 or later');
  if (contracted) {
    if (fields.terms === null || typeof fields.terms !== 'object' || Array.isArray(fields.terms) || Object.keys(fields.terms).length > 20_000) fail('coaching.terms', 'must be a bounded record of staff contracts');
    const clubIds = new Set(clubs.map(club => club.id));
    for (const [personId, value] of Object.entries(fields.terms as Record<string, unknown>)) {
      const path = `coaching.terms.${personId}`, term = record(value, path, ['clubId', 'fromSeason', 'untilSeason']);
      if (typeof term.clubId !== 'string' || !clubIds.has(term.clubId)) fail(`${path}.clubId`, 'must identify a club of this season');
      const from = number(term.fromSeason, `${path}.fromSeason`, 1, seasonNumber);
      number(term.untilSeason, `${path}.untilSeason`, Math.max(from, seasonNumber), from + 2);
    }
  }
  if (levelled && version < 74) fail('coaching.model', 'requires format 74 or later');
  if (fields.model === 'coaching-3' && version < 75) fail('coaching.model', 'requires format 75 or later');
  // Format 84: computer clubs always fill every staff role (careers with the wage pool, `coaching-3` and later).
  if (full && (fields.fullStaff !== true || version < 84 || (fields.model !== 'coaching-3' && fields.model !== 'coaching-4'))) fail('coaching.fullStaff', 'must be true, in a format 84 career with the wage pool');
  let earliestRound = 1;
  if (fields.enabledSince !== null) {
    const anchor = record(fields.enabledSince, 'coaching.enabledSince', ['seasonNumber', 'round']);
    const year = number(anchor.seasonNumber, 'coaching.enabledSince.seasonNumber', 1, seasonNumber);
    const enabledRound = number(anchor.round, 'coaching.enabledSince.round', 1, year === seasonNumber ? round : rounds);
    if (year === seasonNumber) earliestRound = enabledRound;
  }
  const maximumContracts = maximumCoachingContracts(clubs.length, levelled);
  if (!Array.isArray(fields.contracts) || fields.contracts.length > maximumContracts) fail('coaching.contracts', 'must be a bounded contract history');
  if (fields.enabledSince === null && fields.contracts.length !== 0) fail('coaching.contracts', 'must be empty while coaching is disabled');
  const expenses = new Map(clubs.map(club => [club.id, 0]));
  let previousRound = earliestRound;
  for (const [index, value] of fields.contracts.entries()) {
    const path = `coaching.contracts[${index}]`;
    const contract = record(value, path, ['id', 'coachId', 'clubId', 'seasonNumber', 'startedRound', 'releasedRound', 'focus', 'renew']);
    if (contract.id !== `coach-s${seasonNumber}-c${index + 1}` || contract.seasonNumber !== seasonNumber) fail(path, 'must use sequential identities in the current season');
    const coach = staffMember(COACH_DIRECTORY, contract.coachId);
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
  if (!levelled) for (const [clubId, expense] of expenses) if (expense > COACHING_BUDGET) fail(`coaching.contracts.${clubId}`, 'exceeds the annual coaching budget, including released contracts');
  const coaching = fields as unknown as SeasonCoaching;
  for (let interval = 1; interval <= round; interval += 1) {
    const appointments = coaching.contracts.filter(contract => contract.startedRound <= interval && (contract.releasedRound === null || contract.releasedRound > interval));
    if (new Set(appointments.map(contract => contract.coachId)).size !== appointments.length) fail('coaching.contracts', 'assigns one coach to simultaneous contracts');
    for (const club of clubs) {
      const employed = appointments.filter(contract => contract.clubId === club.id);
      if (employed.length > MAX_COACHES) fail(`coaching.contracts.${club.id}`, 'exceeds the coaching staff limit');
      // Club-level careers (format 74 and later) have no catalog coaching limit: their coaches' fees are checked against
      // the club's own staff limit (Wages left) with every ledger payment.
    }
  }
  return coaching;
}

function validateLedgerBoundary(ledger: readonly FinanceEntry[], index: number, year: number, round: number, path: string): void {
  const boundary = roundKey(year, round);
  const indexed = ledgerBoundaryIndex(ledger);
  if (indexed.prefixLatest[index]! > boundary || indexed.suffixEarliest[index]! < boundary) fail(path, 'must identify a contiguous ledger prefix on the recorded matchday');
}

/** Retained appointment and ledger boundaries explain every named scouting observation. */
/**
 * Staff budgets follow board verdicts (format 33). Staff and finance checks run before the board is validated, so
 * they read it defensively; validateBoard later proves the anchor and every review exact or rejects the save.
 */
const BUDGET_BOARD = Symbol('validation budget board');
const STAFF_BUDGETS = Symbol('validation staff allocations');
function budgetBoard(raw: unknown): Pick<SeasonBoard, 'consequencesSince' | 'reviews'> | undefined {
  if (raw === null || typeof raw !== 'object') return undefined;
  return cachedCalculation(raw, BUDGET_BOARD, '', () => {
    const board = raw as SeasonBoard, since = board.consequencesSince;
    if (since === null || typeof since !== 'object' || !Number.isInteger(since.seasonNumber) || !Array.isArray(board.reviews) || board.reviews.some(review => review === null || typeof review !== 'object' || review.clubs === null || typeof review.clubs !== 'object')) return undefined;
    return board;
  });
}
function staffBudgetFor(board: unknown, clubId: string, year: number, context: WorldContext): number {
  const compute = () => staffAllocation({ ...(context.world ? { world: context.world } : {}), dataPackId: context.dataPackId, board: budgetBoard(board) as SeasonBoard | undefined, seasonNumber: year, ...(context.economySeasons ? { economySeasons: context.economySeasons } : {}) }, clubId, year);
  return board !== null && typeof board === 'object' ? cachedCalculation(board, STAFF_BUDGETS, `${clubId}/${year}/${seasonRounds(context)}`, compute) : compute();
}

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
  const firstRound = number(anchor.round, 'scouts.enabledSince.round', 1, firstYear === state.seasonNumber ? state.round : seasonRounds(state));
  const firstLedger = number(anchor.ledgerIndex, 'scouts.enabledSince.ledgerIndex', 0, financeLedgerCount({ ledger }));
  const firstBoundary = roundKey(firstYear, firstRound);
  if ([state.finance.enabledSince, state.scouting.enabledSince].some(enabled => roundKey(enabled.seasonNumber, enabled.round) > firstBoundary)) fail('scouts.enabledSince', 'cannot precede finances or scouting activation');
  validateLedgerBoundary(ledger, firstLedger, firstYear, firstRound, 'scouts.enabledSince.ledgerIndex');
  const contracts: ScoutContract[] = [];
  let previousLedger = firstLedger - 1, previousBoundary = firstBoundary;
  const fees = new Map(state.clubs.map(club => [club.id, coaching.contracts.filter(contract => contract.clubId === club.id).reduce((sum, contract) => sum + staffFee(state, club.id, staffMember(COACH_DIRECTORY, contract.coachId)!.fee), 0)]));
  for (const [index, value] of fields.contracts.entries()) {
    const path = `scouts.contracts[${index}]`;
    const entry = record(value, path, ['id', 'scoutId', 'clubId', 'seasonNumber', 'startedRound', 'releasedRound', 'renew', 'hiredLedgerIndex', 'releasedLedgerIndex']);
    if (entry.id !== `scout-contract-${index + 1}`) fail(`${path}.id`, 'must retain career-wide sequential appointment identities');
    const scout = staffMember(SCOUT_DIRECTORY, entry.scoutId);
    if (!scout || typeof entry.clubId !== 'string' || !inFullWorld(state, entry.clubId, entry.seasonNumber)) fail(path, 'must identify a catalog scout and club');
    const year = number(entry.seasonNumber, `${path}.seasonNumber`, firstYear, state.seasonNumber);
    const round = number(entry.startedRound, `${path}.startedRound`, year === firstYear ? firstRound : 1, year === state.seasonNumber ? state.round : seasonRounds(state));
    if (roundKey(year, round) < previousBoundary) fail(path, 'must retain chronological appointment order');
    previousBoundary = roundKey(year, round);
    const hired = number(entry.hiredLedgerIndex, `${path}.hiredLedgerIndex`, previousLedger + 1, financeLedgerCount({ ledger }) - 1);
    previousLedger = hired;
    validateLedgerBoundary(ledger, hired, year, round, `${path}.hiredLedgerIndex`);
    const charged = financeLedgerEntry({ ledger }, hired);
    if (!charged || charged.kind !== 'scouting' || charged.clubId !== entry.clubId || charged.seasonNumber !== year || charged.round !== round || charged.sourceId !== `scouting-${entry.id}`) fail(path, 'must be followed immediately by its actual appointment fee');
    if (typeof entry.renew !== 'boolean') fail(`${path}.renew`, 'must be boolean');
    if (entry.releasedRound === null) {
      if (entry.releasedLedgerIndex !== null) fail(`${path}.releasedLedgerIndex`, 'must be empty for an unreleased appointment');
    } else {
      const releasedRound = number(entry.releasedRound, `${path}.releasedRound`, round, year === state.seasonNumber ? state.round : seasonRounds(state));
      const released = number(entry.releasedLedgerIndex, `${path}.releasedLedgerIndex`, hired + 1, financeLedgerCount({ ledger }));
      validateLedgerBoundary(ledger, released, year, releasedRound, `${path}.releasedLedgerIndex`);
    }
    const active = contracts.filter(contract => contract.seasonNumber === year && (contract.releasedLedgerIndex === null || contract.releasedLedgerIndex > hired));
    if (active.some(contract => contract.scoutId === scout.id)) fail(path, 'cannot appoint a scout already employed at this ledger boundary');
    if (active.filter(contract => contract.clubId === entry.clubId).length >= MAX_SCOUTS) fail(path, 'exceeds the three-scout staff limit at this appointment');
    // Format 74 ('coaching-2'): the employed staff's fees are checked in ledger order with the finances instead.
    if (year === state.seasonNumber && !usesClubLevelStaff({ coaching })) {
      const total = fees.get(entry.clubId)! + staffFee(state, entry.clubId, scout.fee);
      if (total > staffBudgetFor(state.board, entry.clubId, year, state)) fail(path, 'exceeds the shared annual staff allocation including released appointments');
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
  const firstRound = number(anchor.round, 'fitness.enabledSince.round', 1, firstYear === state.seasonNumber ? Math.min((seasonRounds(state) - 1), state.round) : (seasonRounds(state) - 1));
  const firstLedger = number(anchor.ledgerIndex, 'fitness.enabledSince.ledgerIndex', 0, financeLedgerCount({ ledger }));
  const firstBoundary = roundKey(firstYear, firstRound);
  if ([state.finance.enabledSince, state.training.enabledSince].some(enabled => roundKey(enabled.seasonNumber, enabled.round) > firstBoundary)) fail('fitness.enabledSince', 'cannot precede finances or training activation');
  validateLedgerBoundary(ledger, firstLedger, firstYear, firstRound, 'fitness.enabledSince.ledgerIndex');
  const contracts: FitnessContract[] = [];
  let previousLedger = firstLedger - 1, previousBoundary = firstBoundary;
  const fees = new Map(state.clubs.map(club => [club.id, coaching.contracts.filter(contract => contract.clubId === club.id).reduce((sum, contract) => sum + staffFee(state, club.id, staffMember(COACH_DIRECTORY, contract.coachId)!.fee), 0) + scouts.contracts.filter(contract => contract.clubId === club.id && contract.seasonNumber === state.seasonNumber).reduce((sum, contract) => sum + staffFee(state, club.id, staffMember(SCOUT_DIRECTORY, contract.scoutId)!.fee), 0)]));
  for (const [index, value] of fields.contracts.entries()) {
    const path = `fitness.contracts[${index}]`;
    const entry = record(value, path, ['id', 'coachId', 'clubId', 'seasonNumber', 'startedRound', 'releasedRound', 'renew', 'hiredLedgerIndex', 'releasedLedgerIndex']);
    if (entry.id !== `fitness-contract-${index + 1}`) fail(`${path}.id`, 'must retain career-wide sequential appointment identities');
    const coach = staffMember(FITNESS_DIRECTORY, entry.coachId);
    if (!coach || typeof entry.clubId !== 'string' || !inFullWorld(state, entry.clubId, entry.seasonNumber)) fail(path, 'must identify a catalog fitness coach and club');
    const year = number(entry.seasonNumber, `${path}.seasonNumber`, firstYear, state.seasonNumber);
    const round = number(entry.startedRound, `${path}.startedRound`, year === firstYear ? firstRound : 1, year === state.seasonNumber ? Math.min((seasonRounds(state) - 1), state.round) : (seasonRounds(state) - 1));
    if (roundKey(year, round) < previousBoundary) fail(path, 'must retain chronological appointment order');
    previousBoundary = roundKey(year, round);
    const hired = number(entry.hiredLedgerIndex, `${path}.hiredLedgerIndex`, previousLedger + 1, financeLedgerCount({ ledger }) - 1);
    previousLedger = hired;
    validateLedgerBoundary(ledger, hired, year, round, `${path}.hiredLedgerIndex`);
    const charged = financeLedgerEntry({ ledger }, hired);
    if (!charged || charged.kind !== 'fitness' || charged.clubId !== entry.clubId || charged.seasonNumber !== year || charged.round !== round || charged.sourceId !== `fitness-${entry.id}`) fail(path, 'must be followed immediately by its actual appointment fee');
    if (typeof entry.renew !== 'boolean') fail(`${path}.renew`, 'must be boolean');
    if (entry.releasedRound === null) {
      if (entry.releasedLedgerIndex !== null) fail(`${path}.releasedLedgerIndex`, 'must be empty for an unreleased appointment');
    } else {
      const releasedRound = number(entry.releasedRound, `${path}.releasedRound`, round, year === state.seasonNumber ? state.round : seasonRounds(state));
      const released = number(entry.releasedLedgerIndex, `${path}.releasedLedgerIndex`, hired + 1, financeLedgerCount({ ledger }));
      validateLedgerBoundary(ledger, released, year, releasedRound, `${path}.releasedLedgerIndex`);
    }
    const active = contracts.filter(contract => contract.seasonNumber === year && (contract.releasedLedgerIndex === null || contract.releasedLedgerIndex > hired));
    if (active.some(contract => contract.coachId === coach.id)) fail(path, 'cannot appoint a fitness coach already employed at this ledger boundary');
    if (active.filter(contract => contract.clubId === entry.clubId).length >= 1) fail(path, 'exceeds the one-fitness-coach staff limit at this appointment');
    // Format 74 ('coaching-2'): the employed staff's fees are checked in ledger order with the finances instead.
    if (year === state.seasonNumber && !usesClubLevelStaff({ coaching })) {
      const total = fees.get(entry.clubId)! + staffFee(state, entry.clubId, coach.fee);
      if (total > staffBudgetFor(state.board, entry.clubId, year, state)) fail(path, 'exceeds the shared annual staff allocation including released appointments');
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
  const firstRound = number(anchor.round, 'physio.enabledSince.round', 1, firstYear === state.seasonNumber ? Math.min((seasonRounds(state) - 1), state.round) : (seasonRounds(state) - 1));
  const firstLedger = number(anchor.ledgerIndex, 'physio.enabledSince.ledgerIndex', 0, financeLedgerCount({ ledger }));
  const firstBoundary = roundKey(firstYear, firstRound);
  if ([state.finance.enabledSince].some(enabled => roundKey(enabled.seasonNumber, enabled.round) > firstBoundary)) fail('physio.enabledSince', 'cannot precede finances activation');
  validateLedgerBoundary(ledger, firstLedger, firstYear, firstRound, 'physio.enabledSince.ledgerIndex');
  const contracts: PhysioContract[] = [];
  let previousLedger = firstLedger - 1, previousBoundary = firstBoundary;
  const fees = new Map(state.clubs.map(club => [club.id, coaching.contracts.filter(contract => contract.clubId === club.id).reduce((sum, contract) => sum + staffFee(state, club.id, staffMember(COACH_DIRECTORY, contract.coachId)!.fee), 0) + scouts.contracts.filter(contract => contract.clubId === club.id && contract.seasonNumber === state.seasonNumber).reduce((sum, contract) => sum + staffFee(state, club.id, staffMember(SCOUT_DIRECTORY, contract.scoutId)!.fee), 0) + fitness.contracts.filter(contract => contract.clubId === club.id && contract.seasonNumber === state.seasonNumber).reduce((sum, contract) => sum + staffFee(state, club.id, staffMember(FITNESS_DIRECTORY, contract.coachId)!.fee), 0)]));
  for (const [index, value] of fields.contracts.entries()) {
    const path = `physio.contracts[${index}]`;
    const entry = record(value, path, ['id', 'physioId', 'clubId', 'seasonNumber', 'startedRound', 'releasedRound', 'renew', 'hiredLedgerIndex', 'releasedLedgerIndex']);
    if (entry.id !== `physio-contract-${index + 1}`) fail(`${path}.id`, 'must retain career-wide sequential appointment identities');
    const coach = staffMember(PHYSIO_DIRECTORY, entry.physioId);
    if (!coach || typeof entry.clubId !== 'string' || !inFullWorld(state, entry.clubId, entry.seasonNumber)) fail(path, 'must identify a catalog physiotherapist and club');
    const year = number(entry.seasonNumber, `${path}.seasonNumber`, firstYear, state.seasonNumber);
    const round = number(entry.startedRound, `${path}.startedRound`, year === firstYear ? firstRound : 1, year === state.seasonNumber ? Math.min((seasonRounds(state) - 1), state.round) : (seasonRounds(state) - 1));
    if (roundKey(year, round) < previousBoundary) fail(path, 'must retain chronological appointment order');
    previousBoundary = roundKey(year, round);
    const hired = number(entry.hiredLedgerIndex, `${path}.hiredLedgerIndex`, previousLedger + 1, financeLedgerCount({ ledger }) - 1);
    previousLedger = hired;
    validateLedgerBoundary(ledger, hired, year, round, `${path}.hiredLedgerIndex`);
    const charged = financeLedgerEntry({ ledger }, hired);
    if (!charged || charged.kind !== 'physio' || charged.clubId !== entry.clubId || charged.seasonNumber !== year || charged.round !== round || charged.sourceId !== `physio-${entry.id}`) fail(path, 'must be followed immediately by its actual appointment fee');
    if (typeof entry.renew !== 'boolean') fail(`${path}.renew`, 'must be boolean');
    if (entry.releasedRound === null) {
      if (entry.releasedLedgerIndex !== null) fail(`${path}.releasedLedgerIndex`, 'must be empty for an unreleased appointment');
    } else {
      const releasedRound = number(entry.releasedRound, `${path}.releasedRound`, round, year === state.seasonNumber ? state.round : seasonRounds(state));
      const released = number(entry.releasedLedgerIndex, `${path}.releasedLedgerIndex`, hired + 1, financeLedgerCount({ ledger }));
      validateLedgerBoundary(ledger, released, year, releasedRound, `${path}.releasedLedgerIndex`);
    }
    const active = contracts.filter(contract => contract.seasonNumber === year && (contract.releasedLedgerIndex === null || contract.releasedLedgerIndex > hired));
    if (active.some(contract => contract.physioId === coach.id)) fail(path, 'cannot appoint a physiotherapist already employed at this ledger boundary');
    if (active.filter(contract => contract.clubId === entry.clubId).length >= 1) fail(path, 'exceeds the one-physio staff limit at this appointment');
    // Format 74 ('coaching-2'): the employed staff's fees are checked in ledger order with the finances instead.
    if (year === state.seasonNumber && !usesClubLevelStaff({ coaching })) {
      const total = fees.get(entry.clubId)! + staffFee(state, entry.clubId, coach.fee);
      if (total > staffBudgetFor(state.board, entry.clubId, year, state)) fail(path, 'exceeds the shared annual staff allocation including released appointments');
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
  const firstRound = number(anchor.round, 'assistant.enabledSince.round', 1, firstYear === state.seasonNumber ? state.round : seasonRounds(state));
  const firstLedger = number(anchor.ledgerIndex, 'assistant.enabledSince.ledgerIndex', 0, financeLedgerCount({ ledger }));
  const firstBoundary = roundKey(firstYear, firstRound);
  if ([state.finance.enabledSince].some(enabled => roundKey(enabled.seasonNumber, enabled.round) > firstBoundary)) fail('assistant.enabledSince', 'cannot precede finances activation');
  validateLedgerBoundary(ledger, firstLedger, firstYear, firstRound, 'assistant.enabledSince.ledgerIndex');
  const finalRoundCommitted = (year: number, index: number) => (ledgerBoundaryIndex(ledger).commits.get(roundKey(year, seasonRounds(state)))?.first ?? Infinity) < index;
  if (firstRound === seasonRounds(state) && finalRoundCommitted(firstYear, firstLedger)) fail('assistant.enabledSince', 'must precede the final matchday financial commit');
  const contracts: AssistantContract[] = [];
  let previousLedger = firstLedger - 1, previousBoundary = firstBoundary;
  const fees = new Map(state.clubs.map(club => [club.id, coaching.contracts.filter(contract => contract.clubId === club.id).reduce((sum, contract) => sum + staffFee(state, club.id, staffMember(COACH_DIRECTORY, contract.coachId)!.fee), 0) + scouts.contracts.filter(contract => contract.clubId === club.id && contract.seasonNumber === state.seasonNumber).reduce((sum, contract) => sum + staffFee(state, club.id, staffMember(SCOUT_DIRECTORY, contract.scoutId)!.fee), 0) + fitness.contracts.filter(contract => contract.clubId === club.id && contract.seasonNumber === state.seasonNumber).reduce((sum, contract) => sum + staffFee(state, club.id, staffMember(FITNESS_DIRECTORY, contract.coachId)!.fee), 0) + physio.contracts.filter(contract => contract.clubId === club.id && contract.seasonNumber === state.seasonNumber).reduce((sum, contract) => sum + staffFee(state, club.id, staffMember(PHYSIO_DIRECTORY, contract.physioId)!.fee), 0)]));
  for (const [index, value] of fields.contracts.entries()) {
    const path = `assistant.contracts[${index}]`;
    const entry = record(value, path, ['id', 'assistantId', 'clubId', 'seasonNumber', 'startedRound', 'releasedRound', 'renew', 'hiredLedgerIndex', 'releasedLedgerIndex']);
    if (entry.id !== `assistant-contract-${index + 1}`) fail(`${path}.id`, 'must retain career-wide sequential appointment identities');
    const coach = staffMember(ASSISTANT_DIRECTORY, entry.assistantId);
    if (!coach || typeof entry.clubId !== 'string' || !inFullWorld(state, entry.clubId, entry.seasonNumber)) fail(path, 'must identify a catalog assistant coach and club');
    const year = number(entry.seasonNumber, `${path}.seasonNumber`, firstYear, state.seasonNumber);
    const round = number(entry.startedRound, `${path}.startedRound`, year === firstYear ? firstRound : 1, year === state.seasonNumber ? state.round : seasonRounds(state));
    if (roundKey(year, round) < previousBoundary) fail(path, 'must retain chronological appointment order');
    previousBoundary = roundKey(year, round);
    const hired = number(entry.hiredLedgerIndex, `${path}.hiredLedgerIndex`, previousLedger + 1, financeLedgerCount({ ledger }) - 1);
    previousLedger = hired;
    validateLedgerBoundary(ledger, hired, year, round, `${path}.hiredLedgerIndex`);
    const charged = financeLedgerEntry({ ledger }, hired);
    if (!charged || charged.kind !== 'assistant' || charged.clubId !== entry.clubId || charged.seasonNumber !== year || charged.round !== round || charged.sourceId !== `assistant-${entry.id}`) fail(path, 'must be followed immediately by its actual appointment fee');
    if (round === seasonRounds(state) && finalRoundCommitted(year, hired)) fail(path, 'cannot appoint an assistant after the final matchday financial commit');
    if (typeof entry.renew !== 'boolean') fail(`${path}.renew`, 'must be boolean');
    if (entry.releasedRound === null) {
      if (entry.releasedLedgerIndex !== null) fail(`${path}.releasedLedgerIndex`, 'must be empty for an unreleased appointment');
    } else {
      const releasedRound = number(entry.releasedRound, `${path}.releasedRound`, round, year === state.seasonNumber ? state.round : seasonRounds(state));
      const released = number(entry.releasedLedgerIndex, `${path}.releasedLedgerIndex`, hired + 1, financeLedgerCount({ ledger }));
      validateLedgerBoundary(ledger, released, year, releasedRound, `${path}.releasedLedgerIndex`);
    }
    const active = contracts.filter(contract => contract.seasonNumber === year && (contract.releasedLedgerIndex === null || contract.releasedLedgerIndex > hired));
    if (active.some(contract => contract.assistantId === coach.id)) fail(path, 'cannot appoint an assistant coach already employed at this ledger boundary');
    if (active.filter(contract => contract.clubId === entry.clubId).length >= 1) fail(path, 'exceeds the one-assistant staff limit at this appointment');
    // Format 74 ('coaching-2'): the employed staff's fees are checked in ledger order with the finances instead.
    if (year === state.seasonNumber && !usesClubLevelStaff({ coaching })) {
      const total = fees.get(entry.clubId)! + staffFee(state, entry.clubId, coach.fee);
      if (total > staffBudgetFor(state.board, entry.clubId, year, state)) fail(path, 'exceeds the shared annual staff allocation including released appointments');
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
  const firstRound = number(anchor.round, 'youth.enabledSince.round', 1, firstYear === state.seasonNumber ? Math.min(state.round, (seasonRounds(state) - 1)) : (seasonRounds(state) - 1));
  const firstLedger = number(anchor.ledgerIndex, 'youth.enabledSince.ledgerIndex', 0, financeLedgerCount({ ledger }));
  const firstBoundary = roundKey(firstYear, firstRound);
  if ([state.finance.enabledSince, state.academy.enabledSince].some(enabled => roundKey(enabled.seasonNumber, enabled.round) > firstBoundary)) fail('youth.enabledSince', 'cannot precede finances or academy activation');
  if (roundKey(state.academy.enabledSince.seasonNumber, state.academy.enabledSince.round) === firstBoundary && firstLedger < state.academy.enabledSince.ledgerIndex) fail('youth.enabledSince.ledgerIndex', 'cannot precede academy activation within the same matchday');
  validateLedgerBoundary(ledger, firstLedger, firstYear, firstRound, 'youth.enabledSince.ledgerIndex');
  const contracts: YouthCoachContract[] = [];
  let previousLedger = firstLedger - 1, previousBoundary = firstBoundary;
  const fees = new Map(state.clubs.map(club => [club.id, coaching.contracts.filter(contract => contract.clubId === club.id).reduce((sum, contract) => sum + staffFee(state, club.id, staffMember(COACH_DIRECTORY, contract.coachId)!.fee), 0) + scouts.contracts.filter(contract => contract.clubId === club.id && contract.seasonNumber === state.seasonNumber).reduce((sum, contract) => sum + staffFee(state, club.id, staffMember(SCOUT_DIRECTORY, contract.scoutId)!.fee), 0) + fitness.contracts.filter(contract => contract.clubId === club.id && contract.seasonNumber === state.seasonNumber).reduce((sum, contract) => sum + staffFee(state, club.id, staffMember(FITNESS_DIRECTORY, contract.coachId)!.fee), 0) + physio.contracts.filter(contract => contract.clubId === club.id && contract.seasonNumber === state.seasonNumber).reduce((sum, contract) => sum + staffFee(state, club.id, staffMember(PHYSIO_DIRECTORY, contract.physioId)!.fee), 0) + assistant.contracts.filter(contract => contract.clubId === club.id && contract.seasonNumber === state.seasonNumber).reduce((sum, contract) => sum + staffFee(state, club.id, staffMember(ASSISTANT_DIRECTORY, contract.assistantId)!.fee), 0)]));
  for (const [index, value] of fields.contracts.entries()) {
    const path = `youth.contracts[${index}]`;
    const entry = record(value, path, ['id', 'coachId', 'clubId', 'seasonNumber', 'startedRound', 'releasedRound', 'renew', 'hiredLedgerIndex', 'releasedLedgerIndex']);
    if (entry.id !== `youth-contract-${index + 1}`) fail(`${path}.id`, 'must retain career-wide sequential appointment identities');
    const coach = staffMember(YOUTH_COACH_DIRECTORY, entry.coachId);
    if (!coach || typeof entry.clubId !== 'string' || !inFullWorld(state, entry.clubId, entry.seasonNumber)) fail(path, 'must identify a catalog youth coach and club');
    const year = number(entry.seasonNumber, `${path}.seasonNumber`, firstYear, state.seasonNumber);
    const round = number(entry.startedRound, `${path}.startedRound`, year === firstYear ? firstRound : 1, year === state.seasonNumber ? Math.min(state.round, (seasonRounds(state) - 1)) : (seasonRounds(state) - 1));
    if (roundKey(year, round) < previousBoundary) fail(path, 'must retain chronological appointment order');
    previousBoundary = roundKey(year, round);
    const hired = number(entry.hiredLedgerIndex, `${path}.hiredLedgerIndex`, previousLedger + 1, financeLedgerCount({ ledger }) - 1);
    previousLedger = hired;
    validateLedgerBoundary(ledger, hired, year, round, `${path}.hiredLedgerIndex`);
    const charged = financeLedgerEntry({ ledger }, hired);
    if (!charged || charged.kind !== 'youth' || charged.clubId !== entry.clubId || charged.seasonNumber !== year || charged.round !== round || charged.sourceId !== `youth-${entry.id}`) fail(path, 'must be followed immediately by its actual appointment fee');
    if (typeof entry.renew !== 'boolean') fail(`${path}.renew`, 'must be boolean');
    if (entry.releasedRound === null) {
      if (entry.releasedLedgerIndex !== null) fail(`${path}.releasedLedgerIndex`, 'must be empty for an unreleased appointment');
    } else {
      const releasedRound = number(entry.releasedRound, `${path}.releasedRound`, round, year === state.seasonNumber ? state.round : seasonRounds(state));
      const released = number(entry.releasedLedgerIndex, `${path}.releasedLedgerIndex`, hired + 1, financeLedgerCount({ ledger }));
      validateLedgerBoundary(ledger, released, year, releasedRound, `${path}.releasedLedgerIndex`);
    }
    const active = contracts.filter(contract => contract.seasonNumber === year && (contract.releasedLedgerIndex === null || contract.releasedLedgerIndex > hired));
    if (active.some(contract => contract.coachId === coach.id)) fail(path, 'cannot appoint an youth coach already employed at this ledger boundary');
    if (active.filter(contract => contract.clubId === entry.clubId).length >= 1) fail(path, 'exceeds the one-youth staff limit at this appointment');
    // Format 74 ('coaching-2'): the employed staff's fees are checked in ledger order with the finances instead.
    if (year === state.seasonNumber && !usesClubLevelStaff({ coaching })) {
      const total = fees.get(entry.clubId)! + staffFee(state, entry.clubId, coach.fee);
      if (total > staffBudgetFor(state.board, entry.clubId, year, state)) fail(path, 'exceeds the shared annual staff allocation including released appointments');
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
  const round = number(anchor.round, 'academy.enabledSince.round', 1, year === state.seasonNumber ? Math.min(state.round, (seasonRounds(state) - 1)) : (seasonRounds(state) - 1));
  const ledger = number(anchor.ledgerIndex, 'academy.enabledSince.ledgerIndex', 0, financeLedgerCount(state.finance));
  number(anchor.contractCount, 'academy.enabledSince.contractCount', 0, state.employment.contracts.length);
  number(anchor.negotiationCount, 'academy.enabledSince.negotiationCount', 0, state.negotiations.records.length);
  validateLedgerBoundary(state.finance.ledger, ledger, year, round, 'academy.enabledSince.ledgerIndex');
  const identities = new Set<string>();
  for (const [index, item] of (fields.prospects as unknown[]).entries()) {
    const path = `academy.prospects[${index}]`;
    const prospect = record(item, path, ['player', 'dateOfBirth', 'seasonWage', 'clubId', 'intakeSeason', 'intakeRound']);
    const player = record(prospect.player, `${path}.player`, ['id', 'name', 'number', 'position', 'heightCm', 'weightKg', 'skinTone', 'hairColor', 'attributes']);
    if (typeof player.id !== 'string' || identities.has(player.id) || worldPlayer(worldOf(state), player.id)) fail(`${path}.player.id`, 'must identify a unique prospect outside the original player catalog');
    identities.add(player.id);
    const abilityProblem = abilityShapeProblem(player.attributes, TRAINING_ATTRIBUTES);
    if (abilityProblem) fail(`${path}.player.attributes`, abilityProblem);
  }
  for (const [index, item] of (fields.intakes as unknown[]).entries()) record(item, `academy.intakes[${index}]`, ['id', 'clubId', 'seasonNumber', 'round', 'date', 'initial', 'prospectIds', ...(version >= 27 && item !== null && typeof item === 'object' && Object.hasOwn(item, 'source') ? ['source'] : [])]);
  for (const [index, item] of (fields.weeks as unknown[]).entries()) {
    const path = `academy.weeks[${index}]`;
    const week = record(item, path, ['id', 'seasonNumber', 'afterRound', 'fromDate', 'toDate', 'coaches', 'players']);
    number(week.seasonNumber, `${path}.seasonNumber`, 1, state.seasonNumber);
    if (typeof week.id !== 'string') fail(`${path}.id`, 'must identify its development interval');
    if (week.players === null || typeof week.players !== 'object' || Array.isArray(week.players)) fail(`${path}.players`, 'must be an object');
    // The retention index reads club identities before replay; validate its inputs first. Exact report fields,
    // membership, interval identity and club ownership are checked against independently generated weeks below.
    for (const [id, player] of Object.entries(week.players)) {
      if (player === null || typeof player !== 'object' || Array.isArray(player)) fail(`${path}.players.${id}`, 'must be an object');
      if (typeof (player as Record<string, unknown>).clubId !== 'string') fail(`${path}.players.${id}.clubId`, 'must identify a club');
    }
  }
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
function validateYouthCompetitionShape(value: unknown, state: SeasonState, version: SeasonFormatVersion): SeasonYouthCompetition {
  const fields = record(value, 'youthCompetition', ['model', 'enabledSince', 'seasons']);
  // Format 72: careers that start with youth matches have recurring youth injuries (`youth-competition-2`); others keep `youth-competition-1`.
  if (fields.model === YOUTH_RECURRENCE_MODEL && version < 72) fail('youthCompetition.model', 'requires format 72 or later for recurring youth injuries');
  if (fields.model !== 'youth-competition-1' && fields.model !== YOUTH_RECURRENCE_MODEL || !Array.isArray(fields.seasons) || fields.seasons.length > MAX_SEASON_NUMBER) fail('youthCompetition', 'must retain a supported bounded competition history');
  if (fields.enabledSince === null) {
    if (!sameData(fields, createYouthCompetition(fields.model as SeasonYouthCompetition['model']))) fail('youthCompetition', 'must retain its empty default while disabled');
    return fields as unknown as SeasonYouthCompetition;
  }
  const anchor = record(fields.enabledSince, 'youthCompetition.enabledSince', ['seasonNumber', 'round', 'date', 'ledgerIndex', 'contractCount', 'negotiationCount', 'recruitmentEventCount', 'academyIntakeCount', 'academyGraduateCount']);
  const firstYear = number(anchor.seasonNumber, 'youthCompetition.enabledSince.seasonNumber', 1, state.seasonNumber);
  const firstRound = number(anchor.round, 'youthCompetition.enabledSince.round', 1, firstYear === state.seasonNumber ? state.round : seasonRounds(state));
  if (anchor.date !== dateForRound(firstRound, firstYear)) fail('youthCompetition.enabledSince.date', 'must identify its actual active matchday');
  number(anchor.ledgerIndex, 'youthCompetition.enabledSince.ledgerIndex', 0, financeLedgerCount(state.finance));
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
    const fixtures = array(season.fixtures, `${path}.fixtures`, domesticSchedule(state.clubs, year, { ...state, divisions: divisionsInSeason(state, year) }).filter(fixture => fixture.round >= fromRound && clubHasAcademy(worldOf(state), fixture.homeClubId)).length);
    for (const [fixtureIndex, value] of fixtures.entries()) {
      const fixturePath = `${path}.fixtures[${fixtureIndex}]`;
      const outcome = version >= 43 && value !== null && typeof value === 'object' && 'detail' in value && value.detail === 'outcome';
      // Format 73: a completed season's rival result keeps its score and diagnoses only.
      const sealed = version >= SEALED_HISTORY_FORMAT && value !== null && typeof value === 'object' && 'detail' in value && value.detail === 'season';
      if (sealed && year >= state.seasonNumber) fail(fixturePath, 'can be sealed only in a completed season');
      const fixture = record(value, fixturePath, ['id', 'seasonNumber', 'round', 'date', 'homeClubId', 'awayClubId', 'home', 'away', 'startingConditions', 'result', ...(outcome ? ['detail', 'playerIds'] : sealed ? ['detail'] : [])]);
      if (sealed) {
        if (fixture.result === null || fixture.home !== null || fixture.away !== null || fixture.startingConditions !== null) fail(fixturePath, 'must retain a completed result without squads or starting conditions');
        const result = record(fixture.result, `${fixturePath}.result`, ['kind', 'played', 'score', 'officialScore', 'winnerClubId', 'periods', 'stats', 'injuries', 'reason']);
        if (!sameData(result.stats, {}) || !Array.isArray(result.injuries) || fixture.seasonNumber !== year) fail(`${fixturePath}.result`, 'must retain only the result and its diagnoses');
        score(result.officialScore, `${fixturePath}.result.officialScore`);
        if (result.kind !== 'no-contest' && result.winnerClubId !== fixture.homeClubId && result.winnerClubId !== fixture.awayClubId) fail(`${fixturePath}.result.winnerClubId`, 'must identify a participating club');
        for (const [injuryIndex, injury] of result.injuries.entries()) {
          const entry = record(injury, `${fixturePath}.result.injuries[${injuryIndex}]`, ['id', 'playerId', 'clubId', 'kind', 'fixtureId', 'occurredOn', 'returnOn']);
          if (entry.fixtureId !== fixture.id || entry.occurredOn !== fixture.date || ![fixture.homeClubId, fixture.awayClubId].includes(entry.clubId as string) || !isInjuryKind(entry.kind) || typeof entry.returnOn !== 'string' || entry.returnOn <= (entry.occurredOn as string)) fail(`${fixturePath}.result.injuries[${injuryIndex}]`, 'must retain a diagnosis from this fixture');
        }
        continue;
      }
      if (outcome) {
        if (fixture.result === null || fixture.home !== null || fixture.away !== null || fixture.startingConditions !== null) fail(fixturePath, 'must retain a completed outcome without replacement squads or starting conditions');
        const players = record(fixture.playerIds, `${fixturePath}.playerIds`, SIDES);
        for (const side of SIDES) {
          const ids = players[side];
          if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) fail(`${fixturePath}.playerIds.${side}`, 'must retain distinct original players in squad order');
        }
      }
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
function replayYouthRound(replay: SeasonState, original: SeasonState, historyContext: YouthHistoryContext | null): SeasonState {
  if (!replay.youthCompetition.enabledSince) return replay;
  const season = replay.youthCompetition.seasons.find(item => item.seasonNumber === replay.seasonNumber)!;
  const saved = original.youthCompetition.seasons.find(item => item.seasonNumber === replay.seasonNumber);
  if (!saved) fail('youthCompetition.seasons', 'must retain every prepared season');
  const settlements = new Map<string, YouthFixture>();
  for (const fixture of season.fixtures.filter(item => item.round === replay.round)) {
    const path = `youthCompetition.${fixture.id}`, stored = saved.fixtures.find(item => item.id === fixture.id);
    if (!stored?.result) fail(path, 'must retain its completed matchday result');
    const prepared = prepareYouthFixture(replay, fixture);
    const fullFixture: YouthFixtureFull = {
      id: fixture.id, seasonNumber: fixture.seasonNumber, round: fixture.round, date: fixture.date,
      homeClubId: fixture.homeClubId, awayClubId: fixture.awayClubId,
      home: prepared.home, away: prepared.away, startingConditions: prepared.startingConditions, result: stored.result,
    };
    const outcome = isYouthOutcome(stored);
    if (outcome && (!historyContext || !canSummarizeYouthFixture(historyContext, fullFixture))) fail(path, 'must retain full detail for current, manager and latest club fixtures');
    if (!sameData(outcome ? summarizeYouthFixture(fullFixture) : fullFixture, stored)) fail(path, 'must preserve its exact calendar, academy membership, development and starting condition');
    const result = stored.result;
    if (prepared.lineups.home.length < 5 || prepared.lineups.away.length < 5) {
      const canonical = settleYouthFixture(replay, fixture);
      if (!sameData(outcome ? summarizeYouthFixture(canonical) : canonical, stored)) fail(`${path}.result`, 'must retain the canonical unplayed forfeit or no-contest without invented statistics');
    } else {
      if (result.played !== true || !['played', 'default'].includes(result.kind)) fail(`${path}.result`, 'must retain an actual played result for two eligible starting teams');
      if (result.reason !== (result.kind === 'default' ? 'The match ended after a team had fewer than two eligible players.' : null)) fail(`${path}.result.reason`, 'must describe only the supported match outcome');
      if (!Array.isArray(result.injuries) || result.injuries.length > prepared.home.players.length + prepared.away.players.length) fail(`${path}.result.injuries`, 'must retain bounded new diagnoses');
      const injuryMap = { ...prepared.unavailable }, diagnosed = new Set<string>();
      for (const [index, value] of result.injuries.entries()) {
        const injuryPath = `${path}.result.injuries[${index}]`;
        const injury = record(value, injuryPath, ['id', 'playerId', 'clubId', 'kind', 'fixtureId', 'occurredOn', 'returnOn']);
        const club = [prepared.home, prepared.away].find(team => team.players.some(player => player.id === injury.playerId));
        if (!club || !isInjuryKind(injury.kind) || diagnosed.has(injury.playerId as string) || Object.hasOwn(prepared.unavailable, injury.playerId as string) || replay.injuryMode === 'off') fail(injuryPath, 'must identify one new supported diagnosis for an available participant');
        const expected = createSeasonInjury(replay.seed, fixture, club.id, injury.playerId as string, injury.kind as SeasonInjury['kind'], youthInjuryHistory(replay.youthCompetition, [injury.playerId as string], fixture.date));
        if (!sameData(injury, expected)) fail(injuryPath, 'must preserve the original deterministic diagnosis and return date');
        diagnosed.add(injury.playerId as string);
        injuryMap[injury.playerId as string] = injury.kind as SeasonInjury['kind'];
      }
      validateResult({ score: result.score, officialScore: result.officialScore, winnerClubId: result.winnerClubId, kind: result.kind === 'played' ? 'normal' : 'default', periods: result.periods, stats: result.stats, injuries: injuryMap }, `${path}.result`, prepared.home, prepared.away, false);
      for (const id of Object.keys(prepared.unavailable)) requireNoPlay(result.stats[id]!, `${path}.result.stats.${id}`);
      for (const id of diagnosed) if (result.stats[id]!.secondsPlayed === 0) fail(`${path}.result.injuries`, 'requires actual exposure before a new diagnosis');
    }
    // Retain the checked representation only after independently reconstructed squads have passed every
    // result, participation and injury check. Later condition calculations use the same complete statistics.
    settlements.set(fixture.id, stored);
  }
  return { ...replay, youthCompetition: { ...replay.youthCompetition, seasons: replay.youthCompetition.seasons.map(item => item === season ? { ...item, fixtures: item.fixtures.map(fixture => settlements.get(fixture.id) ?? fixture) } : item) } };
}

/** Activation prefixes keep supplemental identities out of commands issued earlier the same day. */
function activateYouthReplay(replay: SeasonState, original: SeasonState): SeasonState {
  const anchor = original.youthCompetition.enabledSince;
  if (!anchor || anchor.seasonNumber !== replay.seasonNumber || anchor.round !== replay.round) return replay;
  const path = 'youthCompetition.enabledSince', boundary = roundKey(anchor.seasonNumber, anchor.round);
  const academy = original.academy.enabledSince!;
  if (!academy || roundKey(academy.seasonNumber, academy.round) > boundary || roundKey(academy.seasonNumber, academy.round) === boundary && (academy.ledgerIndex > anchor.ledgerIndex || academy.contractCount > anchor.contractCount || academy.negotiationCount > anchor.negotiationCount)) fail(path, 'requires the academy already active at its exact source boundary');
  validateLedgerBoundary(original.finance.ledger, anchor.ledgerIndex, anchor.seasonNumber, anchor.round, `${path}.ledgerIndex`);
  const contracts = original.employment.contracts.slice(0, anchor.contractCount), replies = original.negotiations.records.slice(0, anchor.negotiationCount), events = original.recruitment.events.slice(0, anchor.recruitmentEventCount);
  if (anchor.contractCount !== original.negotiations.enabledSince!.contractCount + replies.filter(reply => reply.outcome === 'accepted').length + joinedIn(original.employment?.contracts, anchor.contractCount)) fail(`${path}.contractCount`, 'must retain the agreements explained by its exact response prefix');
  for (const [index, contract] of original.employment.contracts.entries()) if (index < anchor.contractCount ? roundKey(contract.signedSeason, contract.signedRound) > boundary : roundKey(contract.signedSeason, contract.signedRound) < boundary) fail(`${path}.contractCount`, 'must identify a chronological agreement prefix');
  for (const [index, reply] of original.negotiations.records.entries()) if (index < anchor.negotiationCount ? roundKey(reply.seasonNumber, reply.round) > boundary : roundKey(reply.seasonNumber, reply.round) < boundary) fail(`${path}.negotiationCount`, 'must identify a chronological response prefix');
  for (const [index, event] of original.recruitment.events.entries()) if (index < anchor.recruitmentEventCount ? roundKey(event.seasonNumber, event.round) > boundary : roundKey(event.seasonNumber, event.round) < boundary) fail(`${path}.recruitmentEventCount`, 'must identify a chronological recruitment prefix');
  const enabled = enableYouthCompetition({ ...replay, finance: financeAtLedgerBoundary(original.finance, anchor.ledgerIndex), employment: { ...original.employment, contracts }, negotiations: { ...original.negotiations, records: replies }, recruitment: { ...original.recruitment, events } });
  if (!sameData(enabled.youthCompetition.enabledSince, anchor)) fail(path, 'must preserve the exact pre-supplement intake, graduation and command boundaries');
  return enabled;
}

/**
 * Format 73: the weeks of sealed seasons keep their identities and dates, each prospect's last report of a season in the
 * week it was made (the season's final week, or the week before his graduation) and only the final week's staff, as
 * appointed. A kept full report is rebuilt from its prior points, instruction, staff, facilities and the diagnoses that
 * set its availability, so its gains and prior points are exact (other clubs' youth conditions come from player lines
 * that sealing deletes, so theirs are kept as recorded). Other clubs' instructions are the automatic focus, and a
 * prospect's kept points never fall from one kept report to the next (they chain exactly across adjacent weeks).
 */
function validateSealedAcademyWeeks(state: SeasonState, anchor: NonNullable<SeasonAcademy['enabledSince']>, through: number): number {
  const rounds = seasonRounds(state), prospects = new Map(state.academy.prospects.map(prospect => [prospect.player.id, prospect]));
  const graduation = new Map(state.academy.graduates.map(graduate => [graduate.prospectId, graduate.availableSince]));
  const previous = new Map<string, { index: number; points: TrainingPoints }>();
  let index = 0;
  for (let year = anchor.seasonNumber; year <= through; year += 1) {
    const firstRound = year === anchor.seasonNumber ? anchor.round : 1, clubs = fullWorldClubsIn(state, year), clubIds = new Set(clubs.map(club => club.id));
    const conditionsClub = state.career?.moves.some(move => move.seasonNumber === year && move.phase === 'season') ? null : managedClubFor(state, year, false);
    // Each prospect's last week of the season: the final week, or the week before his graduation; none outside the full world.
    const lastWeek = new Map<string, number>();
    for (const prospect of state.academy.prospects) {
      if (!clubIds.has(prospect.clubId) || prospect.intakeSeason > year) continue;
      const graduated = graduation.get(prospect.player.id);
      const last = !graduated || graduated.seasonNumber > year ? rounds - 1 : graduated.seasonNumber < year ? 0 : graduated.round - 1;
      if (last >= Math.max(firstRound, prospect.intakeSeason === year ? prospect.intakeRound : 1)) lastWeek.set(prospect.player.id, last);
    }
    for (let afterRound = firstRound; afterRound < rounds; afterRound += 1) {
      const path = `academy.weeks[${index}]`, week = state.academy.weeks[index];
      if (!week) fail(path, 'must retain every completed academy interval');
      if (week.id !== `academy-week-${index + 1}` || week.seasonNumber !== year || week.afterRound !== afterRound || week.fromDate !== dateForRound(afterRound, year) || week.toDate !== dateForRound(afterRound + 1, year)) fail(path, 'must retain its chronological development interval');
      if (week.coaches === null || typeof week.coaches !== 'object' || Array.isArray(week.coaches)) fail(`${path}.coaches`, 'must be an object');
      for (const [clubId, coach] of Object.entries(week.coaches)) if (coach !== null) record(coach, `${path}.coaches.${clubId}`, ['contractId', 'coachId', 'bonusPercent']);
      if (!sameData(week.coaches, afterRound === rounds - 1 ? youthCoachAssignments(state.youth, clubs, year, afterRound) : {})) fail(`${path}.coaches`, 'must keep only the season\'s final week staff, as appointed');
      if (week.players === null || typeof week.players !== 'object' || Array.isArray(week.players)) fail(`${path}.players`, 'must be an object');
      if (!sameIds(Object.keys(week.players), [...lastWeek].filter(([, last]) => last === afterRound).map(([id]) => id))) fail(`${path}.players`, 'must keep each prospect\'s last report of the season in the week it was made');
      const managed = managedClubAtRound(state, year, afterRound), full: string[] = [];
      for (const [id, player] of Object.entries(week.players)) {
        const prospect = prospects.get(id), location = `${path}.players.${id}`;
        if (!prospect || prospect.clubId !== player.clubId || roundKey(prospect.intakeSeason, prospect.intakeRound) > roundKey(year, afterRound)) fail(location, 'must report a prospect of this academy club');
        const outcome = isAcademyOutcome(player);
        const entry = record(player, location, outcome ? ['detail', 'clubId', 'focus', 'pointsAfter'] : Object.keys(player).filter(key => ['clubId', 'focus', 'pointsBefore', 'gains', 'coachingGains', 'pointsAfter', 'availability', 'facility'].includes(key)));
        if (!TRAINING_FOCUSES.includes(entry.focus as TrainingPlan['focus']) || prospect.clubId !== managed && entry.focus !== 'balanced') fail(`${location}.focus`, 'must retain a supported instruction for this club');
        const points = record(entry.pointsAfter, `${location}.pointsAfter`, TRAINING_ATTRIBUTES);
        for (const key of TRAINING_ATTRIBUTES) number(points[key], `${location}.pointsAfter.${key}`, 0, academyPointCap(prospect.player.attributes[key]));
        const earlier = previous.get(id), from = outcome ? undefined : (player as AcademyWeekFullPlayer).pointsBefore as Partial<TrainingPoints> | undefined;
        if (earlier && (from && earlier.index === index - 1 ? !sameData(from, earlier.points) : TRAINING_ATTRIBUTES.some(key => (from ?? player.pointsAfter)[key]! < earlier.points[key]))) fail(location, 'must continue the prospect\'s development from his previous kept report');
        previous.set(id, { index, points: player.pointsAfter });
        if (!outcome) full.push(id);
      }
      if (full.length) {
        let built: AcademyWeek;
        try {
          built = buildAcademyWeek({
            rounds, ...(state.world ? { world: state.world } : {}), facilities: state.facilities, youth: state.youth, youthCompetition: youthCompetitionAtBoundary(state.youthCompetition, year, afterRound, true),
            clubs: clubs.map(({ id }) => ({ id })), seasonNumber: year, afterRound, fromDate: week.fromDate, toDate: week.toDate, weekNumber: index + 1,
            academy: { prospects: full.map(id => prospects.get(id)!), graduates: [], points: Object.fromEntries(full.map(id => [id, (week.players[id] as AcademyWeekFullPlayer).pointsBefore])), focus: Object.fromEntries(full.map(id => [id, week.players[id]!.focus])) },
          });
        } catch (error) { fail(path, `cannot rebuild its kept reports: ${error instanceof Error ? error.message : 'invalid evidence'}`); }
        for (const id of full) {
          const stored = week.players[id] as AcademyWeekFullPlayer, location = `${path}.players.${id}`;
          let expected = built.players[id] as AcademyWeekFullPlayer;
          if (expected.availability && stored.clubId !== conditionsClub) {
            const kept = record(stored.availability, `${location}.availability`, ['availableDays', 'conditionBefore', 'conditionAfter']);
            const conditionBefore = number(kept.conditionBefore, `${location}.availability.conditionBefore`, 35, 100, false), conditionAfter = number(kept.conditionAfter, `${location}.availability.conditionAfter`, 35, 100, false);
            expected = { ...expected, availability: { ...expected.availability, conditionBefore, conditionAfter } };
          }
          if (!sameData(expected, stored)) fail(location, 'must keep the exact development of its kept report from its prior points, instruction, staff and availability');
        }
      }
      index += 1;
    }
  }
  return index;
}

/**
 * Format 73: youth seasons of completed seasons, checked without the detail sealing deletes. Games follow the season's
 * schedule; other clubs' games are sealed and the managed club's stay complete. Every result follows the shortage rule
 * from the squads' membership and earlier diagnoses, its kind, reason, winner and official score agree, and each
 * diagnosis is the deterministic one for its player, game and kind. The managed club's games also keep the exact squads
 * (attributes within the development the sealed academy weeks bound), box scores, and starting conditions of its own
 * players. Other clubs' exact scores, a removed diagnosis, and opponents' starting conditions are not verifiable here:
 * the games are not simulated again and their squads' points and player lines are gone.
 */
function validateSealedYouthSeasons(state: SeasonState, through: number): void {
  const competition = state.youthCompetition;
  if (!competition.enabledSince || competition.enabledSince.seasonNumber > through) return;
  // Each prospect's kept points by season (the last report of that season), bounding his development during it.
  const kept = new Map<string, Map<number, TrainingPoints>>();
  for (const week of state.academy.weeks) {
    if (week.seasonNumber > through) break;
    for (const [id, player] of Object.entries(week.players)) { const seasons = kept.get(id) ?? new Map<number, TrainingPoints>(); seasons.set(week.seasonNumber, player.pointsAfter); kept.set(id, seasons); }
  }
  const pointsWithin = (id: string, year: number): { low: TrainingPoints; high: TrainingPoints } => {
    let low = emptyAcademyPoints();
    for (const [season, points] of kept.get(id) ?? []) if (season < year) low = points;
    return { low, high: kept.get(id)?.get(year) ?? low };
  };
  const prospects = new Map(state.academy.prospects.map(prospect => [prospect.player.id, prospect]));
  for (const [seasonIndex, season] of competition.seasons.entries()) {
    const year = season.seasonNumber;
    if (year > through) continue;
    const seasonPath = `youthCompetition.seasons[${seasonIndex}]`, clubs = fullWorldClubsIn(state, year);
    const context: SeasonState = { ...state, clubs: clubs as Team[], divisions: divisionsInSeason(state, year), seasonNumber: year, round: season.fromRound, date: dateForRound(season.fromRound, year) };
    const schedule = youthSeasonFixtures(context, season.fromRound);
    if (season.fixtures.length !== schedule.length) fail(`${seasonPath}.fixtures`, 'must retain every scheduled game exactly once');
    const managed = managedClubFor(state, year, false), moved = state.career?.moves.some(move => move.seasonNumber === year && move.phase === 'season') ?? false;
    for (const [index, fixture] of season.fixtures.entries()) {
      const path = `${seasonPath}.fixtures[${index}]`, planned = schedule[index]!;
      if (fixture.id !== planned.id || fixture.seasonNumber !== year || fixture.round !== planned.round || fixture.date !== planned.date || fixture.homeClubId !== planned.homeClubId || fixture.awayClubId !== planned.awayClubId) fail(path, 'must keep the identity, date and venue of its scheduled game');
      const result = fixture.result;
      if (!result) fail(`${path}.result`, 'must retain the completed result');
      const own = fixture.homeClubId === managed || fixture.awayClubId === managed;
      if (own ? Object.hasOwn(fixture, 'detail') : !isSealedYouthFixture(fixture)) fail(path, own ? 'must keep the managed club\'s game complete' : 'must be sealed as another club\'s game of a completed season');
      const at: SeasonState = { ...context, round: fixture.round, date: fixture.date };
      const teams = { home: buildYouthClubTeam(at, fixture.homeClubId), away: buildYouthClubTeam(at, fixture.awayClubId) };
      const statuses = new Map([...teams.home.players, ...teams.away.players].map(player => [player.id, getYouthPlayerStatus(state, player.id, fixture.date, fixture.id)]));
      const unavailable = Object.fromEntries([...statuses.values()].filter(status => status.injury).map(status => [status.playerId, status.injury!.kind]));
      const short = (side: Side) => teams[side].players.filter(player => !Object.hasOwn(unavailable, player.id)).length < 5;
      if (own) {
        const full = fixture as YouthFixtureFull;
        // The squads' identities and order are exact; each attribute lies within the development the kept reports bound.
        for (const side of SIDES) {
          const frozen = full[side], location = `${path}.${side}`;
          if (frozen === null || typeof frozen !== 'object' || !Array.isArray(frozen.players)) fail(location, 'must retain the squad frozen at settlement');
          const guessed: Record<string, TrainingPoints> = {};
          for (const player of frozen.players) {
            const prospect = player && typeof player === 'object' ? prospects.get(player.id) : undefined;
            if (!prospect || player.attributes === null || typeof player.attributes !== 'object') continue;
            const points = Object.fromEntries(TRAINING_ATTRIBUTES.map(key => [key, (player.attributes[key] - prospect.player.attributes[key]) * 100])) as TrainingPoints, { low, high } = pointsWithin(player.id, year);
            if (TRAINING_ATTRIBUTES.some(key => !(points[key] >= Math.floor(low[key] / 100) * 100 && points[key] <= Math.floor(high[key] / 100) * 100))) fail(`${location}.players`, 'must keep each prospect\'s development of that matchday');
            guessed[player.id] = points;
          }
          let expected: Team;
          try { expected = buildYouthClubTeam({ ...at, academy: { ...state.academy, points: { ...state.academy.points, ...guessed } } }, side === 'home' ? fixture.homeClubId : fixture.awayClubId); }
          catch { fail(`${location}.players`, 'must keep each prospect\'s development of that matchday'); }
          if (!sameData(expected, frozen)) fail(location, 'must keep the exact academy squad of that matchday');
        }
        const conditions = record(full.startingConditions, `${path}.startingConditions`, [...statuses.keys()]);
        for (const [id, status] of statuses) {
          number(conditions[id], `${path}.startingConditions.${id}`, 35, 100, false);
          if (!moved && prospects.get(id)!.clubId === managed && conditions[id] !== status.condition) fail(`${path}.startingConditions.${id}`, 'must keep the player\'s condition before the game');
        }
      }
      if (short('home') || short('away')) {
        if (!sameData(result, youthShortageResult(teams.home, teams.away, short('home'), short('away')))) fail(`${path}.result`, 'must retain the canonical unplayed forfeit or no-contest');
        continue;
      }
      if (result.played !== true || !['played', 'default'].includes(result.kind)) fail(`${path}.result`, 'must retain an actual played result for two eligible starting teams');
      if (result.reason !== (result.kind === 'default' ? YOUTH_DEFAULT_REASON : null)) fail(`${path}.result.reason`, 'must describe only the supported match outcome');
      if (!Array.isArray(result.injuries) || result.injuries.length > statuses.size) fail(`${path}.result.injuries`, 'must retain bounded new diagnoses');
      const injuries: Record<string, SeasonInjury['kind']> = {};
      for (const [injuryIndex, value] of result.injuries.entries()) {
        const injuryPath = `${path}.result.injuries[${injuryIndex}]`, injury = record(value, injuryPath, ['id', 'playerId', 'clubId', 'kind', 'fixtureId', 'occurredOn', 'returnOn']);
        const club = (['home', 'away'] as const).map(side => teams[side]).find(team => team.players.some(player => player.id === injury.playerId));
        if (!club || !isInjuryKind(injury.kind) || Object.hasOwn(injuries, injury.playerId as string) || Object.hasOwn(unavailable, injury.playerId as string) || state.injuryMode === 'off') fail(injuryPath, 'must identify one new supported diagnosis for an available participant');
        if (!sameData(injury, createSeasonInjury(state.seed, fixture, club.id, injury.playerId as string, injury.kind as SeasonInjury['kind'], youthInjuryHistory(competition, [injury.playerId as string], fixture.date)))) fail(injuryPath, 'must preserve the original deterministic diagnosis and return date');
        injuries[injury.playerId as string] = injury.kind as SeasonInjury['kind'];
      }
      const summary = { score: result.score, officialScore: result.officialScore, winnerClubId: result.winnerClubId, kind: result.kind === 'played' ? 'normal' : 'default', periods: result.periods };
      if (!own) { validateResultSummary(summary, `${path}.result`, teams.home, teams.away); continue; }
      const full = fixture as YouthFixtureFull;
      validateResult({ ...summary, stats: result.stats, injuries: { ...unavailable, ...injuries } }, `${path}.result`, full.home!, full.away!, false);
      for (const id of Object.keys(unavailable)) requireNoPlay(result.stats[id]!, `${path}.result.stats.${id}`);
      for (const id of Object.keys(injuries)) if (result.stats[id]!.secondsPlayed === 0) fail(`${path}.result.injuries`, 'requires actual exposure before a new diagnosis');
    }
  }
}

/** The academy and youth records at the end of the latest sealed season, from which the current season replays. */
function sealedAcademyReplay(replay: SeasonState, state: SeasonState, through: number, weekCount: number): SeasonState {
  const academy = state.academy, rounds = seasonRounds(state);
  const prefix = <T>(items: readonly T[], keep: (item: T) => boolean, path: string): T[] => {
    const count = items.filter(keep).length;
    if (items.slice(0, count).some(item => !keep(item))) fail(path, 'must keep earlier seasons\' records before later ones');
    return items.slice(0, count);
  };
  const prospects = prefix(academy.prospects, prospect => prospect.intakeSeason <= through, 'academy.prospects');
  const intakes = prefix(academy.intakes, intake => intake.seasonNumber <= through, 'academy.intakes');
  const graduates = prefix(academy.graduates, graduate => graduate.availableSince.seasonNumber <= through, 'academy.graduates');
  // Earlier graduations are kept as recorded; each must still be a plausible age-out or accepted promotion.
  const byId = new Map(prospects.map(prospect => [prospect.player.id, prospect]));
  for (const [index, graduate] of graduates.entries()) {
    const path = `academy.graduates[${index}]`, prospect = byId.get(graduate.prospectId), at = graduate.availableSince;
    if (!prospect || graduate.id !== `academy-graduate-${index + 1}` || graduate.clubId !== prospect.clubId || graduate.graduatedOn !== dateForRound(at.round, at.seasonNumber) || roundKey(at.seasonNumber, at.round) < roundKey(prospect.intakeSeason, prospect.intakeRound)) fail(path, 'must graduate a prospect of its academy on its recorded date');
    if (!sameData(graduate.sourcePoints, academy.points[graduate.prospectId]) || !sameData(graduate.player, developAcademyPlayer(prospect, graduate.sourcePoints))) fail(path, 'must keep the prospect\'s developed points at graduation');
    if (graduate.kind === 'age-out' ? at.round !== 1 || graduate.offerId !== null || graduate.contractId !== null || (playerAgeOnDate(prospect.dateOfBirth, graduate.graduatedOn) ?? 0) < ACADEMY_GRADUATION_AGE
      : graduate.kind !== 'promotion' || !state.employment.contracts.some(contract => contract.id === graduate.contractId && contract.playerId === graduate.prospectId && contract.clubId === graduate.clubId && contract.startsSeason === at.seasonNumber && contract.startsRound === at.round)) fail(path, 'must be an age-out at a season opening or an accepted promotion');
  }
  const graduated = new Set(graduates.map(graduate => graduate.prospectId)), latest = new Map<string, TrainingPoints>();
  const weeks = academy.weeks.slice(0, weekCount);
  for (const week of weeks) for (const [id, player] of Object.entries(week.players)) latest.set(id, player.pointsAfter);
  // A graduate leaves with the points of his last kept report (or none before any development).
  for (const [index, graduate] of graduates.entries()) if (!sameData(graduate.sourcePoints, latest.get(graduate.prospectId) ?? emptyAcademyPoints())) fail(`academy.graduates[${index}].sourcePoints`, 'must equal the points of the prospect\'s last kept report');
  const points = Object.fromEntries(prospects.map(prospect => {
    const id = prospect.player.id;
    return [id, { ...(graduated.has(id) ? academy.points[id]! : latest.get(id) ?? emptyAcademyPoints()) }];
  }));
  const focus = Object.fromEntries(prospects.map(prospect => [prospect.player.id, academy.focus[prospect.player.id]!])) as Record<string, TrainingPlan['focus']>;
  const youthAnchor = state.youthCompetition.enabledSince;
  const youthCompetition = youthAnchor && youthAnchor.seasonNumber <= through ? { ...state.youthCompetition, seasons: state.youthCompetition.seasons.filter(season => season.seasonNumber <= through) } : createYouthCompetition();
  return {
    ...replay, clubs: fullWorldClubsIn(state, through), divisions: divisionsInSeason(state, through), seasonNumber: through, round: rounds, date: dateForRound(rounds, through),
    academy: { ...academy, prospects, intakes, graduates, weeks, points, focus }, youthCompetition,
  };
}

/** Reproduce intake, every completed youth week and each permanent senior graduation. */
function validateAcademyHistory(state: SeasonState, version: SeasonFormatVersion): void {
  const academy = state.academy, anchor = academy.enabledSince;
  if (!anchor) {
    if (state.youthCompetition.enabledSince) fail('youthCompetition.enabledSince', 'requires an active academy');
    return;
  }
  const boundary = roundKey(anchor.seasonNumber, anchor.round);
  const requirements = [state.finance.enabledSince, state.payroll.enabledSince, state.employment.enabledSince, state.negotiations.enabledSince, state.recruitment.enabledSince];
  if (requirements.some(item => !item || roundKey(item.seasonNumber, item.round) > boundary)) fail('academy.enabledSince', 'requires finances, payroll, employment, negotiations and in-season recruitment already active');
  for (const item of [state.payroll.enabledSince, state.recruitment.enabledSince]) if (item && roundKey(item.seasonNumber, item.round) === boundary && item.ledgerIndex > anchor.ledgerIndex) fail('academy.enabledSince.ledgerIndex', 'cannot precede required payroll or recruitment activation within the same matchday');
  const originalIds = new Set(worldOf(state).clubs.flatMap(club => club.players.map(player => player.id)));
  const prospects = new Map(academy.prospects.map(prospect => [prospect.player.id, prospect]));
  // Format 42 summarizes completed seasons' rival reports; format 73 also the current season's, every week, once a report
  // is no longer its club's latest. The outcome is replayed exactly, so a current-season outcome is accepted in any format
  // (a test may write a current career under an older format number); completed seasons' outcomes need format 42.
  const historyContext = createAcademyHistoryContext(state);
  const youthHistoryContext = version >= 43 ? createYouthHistoryContext(state) : null;
  const focus = record(academy.focus, 'academy.focus', [...prospects.keys()]);
  record(academy.points, 'academy.points', [...prospects.keys()]);
  for (const [id, value] of Object.entries(focus)) if (!TRAINING_FOCUSES.includes(value as TrainingPlan['focus']) || prospects.get(id)!.clubId !== state.managedClubId && value !== 'balanced') fail(`academy.focus.${id}`, 'must retain a supported manager instruction or the automatic club focus');
  const firstContracts = state.employment.contracts.slice(0, anchor.contractCount), firstReplies = state.negotiations.records.slice(0, anchor.negotiationCount);
  if (anchor.contractCount !== state.negotiations.enabledSince!.contractCount + firstReplies.filter(reply => reply.outcome === 'accepted').length + joinedIn(state.employment?.contracts, anchor.contractCount)) fail('academy.enabledSince.contractCount', 'must identify the exact agreements explained by the response prefix');
  for (const [index, contract] of state.employment.contracts.entries()) if (index < anchor.contractCount ? roundKey(contract.signedSeason, contract.signedRound) > boundary : roundKey(contract.signedSeason, contract.signedRound) < boundary) fail('academy.enabledSince.contractCount', 'must identify a chronological employment prefix');
  for (const [index, reply] of state.negotiations.records.entries()) if (index < anchor.negotiationCount ? roundKey(reply.seasonNumber, reply.round) > boundary : roundKey(reply.seasonNumber, reply.round) < boundary) fail('academy.enabledSince.negotiationCount', 'must identify a chronological response prefix');
  // Incremental checkpoint checks (`trusted-prefix.ts`): the weeks an accepted checkpoint held before its own week are
  // unchanged, so the replay resumes from the context that check reached at the start of that week. Every replayed value
  // the iterations read (academy, youth season, clubs, calendar, graduates' senior entries) is in that context; the rest
  // is the career's unchanged world and seed. Later weeks and the final comparisons run in full.
  const weekPlan = version === SEASON_SCHEMA_VERSION ? prefixPlan('academy.weeks', academy.weeks, week => roundKey(week.seasonNumber, week.afterRound + 1)) : { skip: 0, record: -1 };
  const saved = weekPlan.skip > 0 ? recall<{ replay: SeasonState; weekIndex: number; round: number }>('academy.weeks', 'replay') : undefined;
  const resume = saved && saved.weekIndex === weekPlan.skip && saved.round <= state.round ? saved : undefined;
  let replay: SeasonState = resume ? resume.replay : {
    ...state, clubs: fullWorldClubsIn(state, anchor.seasonNumber), divisions: divisionsInSeason(state, anchor.seasonNumber), academy: createAcademy(), youthCompetition: createYouthCompetition(state.youthCompetition.model), seasonNumber: anchor.seasonNumber, round: anchor.round, date: dateForRound(anchor.round, anchor.seasonNumber), status: 'active',
    finance: financeAtLedgerBoundary(state.finance, anchor.ledgerIndex), employment: { ...state.employment, contracts: firstContracts }, negotiations: { ...state.negotiations, records: firstReplies },
    conditions: Object.fromEntries(Object.entries(state.conditions).filter(([id]) => originalIds.has(id))),
    training: { ...state.training, points: Object.fromEntries(Object.entries(state.training.points).filter(([id]) => originalIds.has(id))) },
  };
  // Format 73: completed seasons are sealed. Their weeks and youth games are checked without the deleted detail
  // (`validateSealedAcademyWeeks`, `validateSealedYouthSeasons`), and the current season replays from each prospect's
  // accumulated points at the previous season's end.
  const sealedThrough = version >= SEALED_HISTORY_FORMAT && state.seasonNumber > anchor.seasonNumber ? state.seasonNumber - 1 : 0;
  let weekIndex = resume ? resume.weekIndex : 0;
  // A resumed replay holds the sealed weeks and youth seasons the trusted check accepted; the final comparisons below
  // require them unchanged, so their checks are not repeated.
  if (resume) { /* Resumed below at the trusted week. */ }
  else if (sealedThrough) {
    weekIndex = validateSealedAcademyWeeks(state, anchor, sealedThrough);
    validateSealedYouthSeasons(state, sealedThrough);
    replay = sealedAcademyReplay(replay, state, sealedThrough, weekIndex);
  } else {
    try { replay = enableAcademy(replay); }
    catch (error) { fail('academy.enabledSince', `cannot initialize its recorded intake: ${error instanceof Error ? error.message : 'invalid activation'}`); }
    replay = activateYouthReplay(replay, state);
  }
  for (let year = resume ? state.seasonNumber : sealedThrough ? sealedThrough + 1 : anchor.seasonNumber; year <= state.seasonNumber; year += 1) {
    const firstRound = year === anchor.seasonNumber ? anchor.round : 1, lastRound = year === state.seasonNumber ? state.round : seasonRounds(state);
    if (year > anchor.seasonNumber && !resume) {
      // A move at the previous season's end (or in its offseason, format 63) released that club's prospects before the opening graduations.
      for (const move of state.career?.moves.filter(item => item.seasonNumber === year - 1 && item.phase !== 'season') ?? []) replay = { ...replay, academy: releaseAcademyFocus(replay.academy, move.fromClubId) };
      // Each season's own full-world clubs run academies (step 3.4d-2).
      replay = { ...replay, clubs: fullWorldClubsIn(state, year), seasonNumber: year, round: 1, date: dateForRound(1, year), divisions: divisionsInSeason(state, year) };
      replay = prepareAcademySeason(replay);
      replay = prepareYouthSeason(replay);
      replay = activateYouthReplay(replay, state);
    }
    for (let round = resume ? resume.round : firstRound + 1; round <= lastRound; round += 1) {
      if (year === state.seasonNumber && round === state.round && weekIndex === weekPlan.record) remember('academy.weeks', 'replay', { replay, weekIndex, round });
      // Format 63: a mid-season move before the previous week's games released the former club's prospects then.
      for (const move of state.career?.moves.filter(item => item.seasonNumber === year && item.phase === 'season' && item.round === round - 1) ?? []) replay = { ...replay, academy: releaseAcademyFocus(replay.academy, move.fromClubId) };
      replay = replayYouthRound(replay, state, youthHistoryContext);
      const raw = academy.weeks[weekIndex], path = `academy.weeks[${weekIndex}]`, afterRound = round - 1;
      if (!raw) fail(path, 'must retain every completed academy interval');
      // Prospects of a club outside the full world that season wait for its return (step 3.4d-2).
      const seasonClubs = fullWorldClubsIn(state, year);
      const active = replay.academy.prospects.filter(prospect => !replay.academy.graduates.some(graduate => graduate.prospectId === prospect.player.id) && seasonClubs.some(club => club.id === prospect.clubId));
      const players = record(raw.players, `${path}.players`, active.map(prospect => prospect.player.id));
      const historicalFocus = { ...replay.academy.focus };
      const outcomes = new Set<string>();
      for (const prospect of active) {
        const id = prospect.player.id;
        const outcome = (version >= 42 || year === state.seasonNumber) && isAcademyOutcome(raw.players[id]!);
        const entry = record(players[id], `${path}.players.${id}`, outcome ? ['detail', 'clubId', 'focus', 'pointsAfter'] : ['clubId', 'focus', 'pointsBefore', 'gains', 'coachingGains', 'pointsAfter', ...(replay.youthCompetition.enabledSince ? ['availability'] : []), ...(state.facilities.enabledSince && state.facilities.enabledSince.date <= dateForRound(afterRound, year) ? ['facility'] : [])]);
        if (outcome) {
          if (entry.clubId !== prospect.clubId || !canSummarizeAcademyReport(historyContext, raw, raw.players[id]!)) fail(`${path}.players.${id}`, 'must retain full detail for current, manager and latest club development reports');
          outcomes.add(id);
        }
        if (!TRAINING_FOCUSES.includes(entry.focus as TrainingPlan['focus']) || prospect.clubId !== managedClubAtRound(state, year, afterRound) && entry.focus !== 'balanced') fail(`${path}.players.${id}.focus`, 'must retain a supported instruction for this club');
        historicalFocus[id] = entry.focus as TrainingPlan['focus'];
      }
      replay = { ...replay, academy: processAcademyWeek({ rounds: seasonRounds(state), ...(state.world ? { world: state.world } : {}), facilities: state.facilities, academy: { ...replay.academy, focus: historicalFocus }, youth: state.youth, youthCompetition: replay.youthCompetition, clubs: fullWorldClubsIn(state, year).map(({ id }) => ({ id })), seasonNumber: year, afterRound, fromDate: dateForRound(afterRound, year), toDate: dateForRound(round, year) }, input => validationReplayCache.calculate('academy-week', input, buildAcademyWeek)), seasonNumber: year, round, date: dateForRound(round, year) };
      const fullWeek = replay.academy.weeks.at(-1)!;
      const expectedWeek = outcomes.size ? { ...fullWeek, players: Object.fromEntries(Object.entries(fullWeek.players).map(([id, player]) => [id, outcomes.has(id) ? summarizeAcademyPlayer(player) : player])) } : fullWeek;
      if (!sameData(expectedWeek, raw)) fail(path, 'must reconcile exact prospect membership, focus, staff, prior points and development gains');
      // Keep the verified representation for the final history comparison. Accumulated development points
      // remain those calculated from the full report, never values accepted from an outcome record.
      replay = { ...replay, academy: { ...replay.academy, weeks: [...replay.academy.weeks.slice(0, -1), raw] } };
      weekIndex += 1;
      // Contract order is the actual acceptance order, including simultaneous arrivals.
      for (const contract of state.employment.contracts.filter(contract => contract.kind === 'midseason' && contract.startsSeason === year && contract.startsRound === round)) {
        const offer = state.recruitment.offers.find(offer => offer.academyProspectId === contract.playerId && offer.status === 'accepted' && state.negotiations.records.some(reply => reply.id === offer.negotiationId && reply.contractId === contract.id));
        if (!offer) continue;
        replay = graduateAcademyProspect({ ...replay, employment: state.employment, recruitment: { ...state.recruitment, offers: state.recruitment.offers.map(item => item.id === offer.id ? { ...item, status: 'pending' } : item) } }, contract.playerId, 'promotion', offer.id, contract.id);
      }
      replay = activateYouthReplay(replay, state);
    }
    if (year < state.seasonNumber || state.status === 'complete') replay = replayYouthRound(replay, state, youthHistoryContext);
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
  const round = number(anchor.round, 'lifecycle.enabledSince.round', 1, year === state.seasonNumber ? state.round : seasonRounds(state));
  if (anchor.date !== dateForRound(round, year)) fail('lifecycle.enabledSince.date', 'must identify its actual active-season boundary');
  for (const [index, item] of fields.reviews.entries()) record(item, `lifecycle.reviews[${index}]`, [...LIFECYCLE_ANCHOR_KEYS, 'id', 'noticeIds']);
  for (const [index, item] of fields.notices.entries()) record(item, `lifecycle.notices[${index}]`, ['id', 'reviewId', 'playerId', 'clubId', 'announcedSeason', 'announcedRound', 'announcedOn', 'targetAge', 'lastSeason', 'retirementSeason', 'retiredOn']);
  return fields as unknown as SeasonLifecycle;
}

/** Rebuild notices from exactly the population, terms and pending offers known at each review. */
function validateLifecycleHistory(state: SeasonState, recruitmentHolds: RecruitmentHolds[]): void {
  const lifecycle = state.lifecycle, first = lifecycle.enabledSince;
  if (!first) return;
  const firstBoundary = roundKey(first.seasonNumber, first.round);
  const prerequisites = [state.academy.enabledSince, state.employment.enabledSince, state.negotiations.enabledSince, state.payroll.enabledSince];
  if (prerequisites.some(anchor => !anchor || roundKey(anchor.seasonNumber, anchor.round) > firstBoundary)) fail('lifecycle.enabledSince', 'requires academy, employment, negotiations and payroll already active');
  if (lifecycle.reviews.length !== state.seasonNumber - first.seasonNumber + 1) fail('lifecycle.reviews', 'must retain activation and every later opening review exactly once');
  let replayed = createLifecycle();
  for (const [index, review] of lifecycle.reviews.entries()) {
    const path = `lifecycle.reviews[${index}]`, year = first.seasonNumber + index, round = index === 0 ? first.round : 1;
    if (review.id !== `lifecycle-review-${index + 1}` || review.seasonNumber !== year || review.round !== round || review.date !== dateForRound(round, year)) fail(path, 'must identify activation followed by each canonical season opening');
    if (index === 0 && !sameData(Object.fromEntries(LIFECYCLE_ANCHOR_KEYS.map(key => [key, review[key]])), first)) fail('lifecycle.enabledSince', 'must match the first retained review source exactly');
    const ledgerIndex = number(review.ledgerIndex, `${path}.ledgerIndex`, 0, financeLedgerCount(state.finance));
    const contractCount = number(review.contractCount, `${path}.contractCount`, 0, state.employment.contracts.length);
    const negotiationCount = number(review.negotiationCount, `${path}.negotiationCount`, 0, state.negotiations.records.length);
    const recruitmentEventCount = number(review.recruitmentEventCount, `${path}.recruitmentEventCount`, 0, state.recruitment.events.length);
    const marketEventCount = number(review.marketEventCount, `${path}.marketEventCount`, 0, state.market.windows.reduce((sum, window) => sum + window.events.length, 0));
    validateLedgerBoundary(state.finance.ledger, ledgerIndex, year, round, `${path}.ledgerIndex`);
    const replies = state.negotiations.records.slice(0, negotiationCount);
    if (contractCount !== state.negotiations.enabledSince!.contractCount + replies.filter(reply => reply.outcome === 'accepted').length + joinedIn(state.employment?.contracts, contractCount)) fail(`${path}.contractCount`, 'must retain the agreements explained by the exact player-response prefix');
    const boundary = roundKey(year, round);
    for (const [at, contract] of state.employment.contracts.entries()) if (at < contractCount ? roundKey(contract.signedSeason, contract.signedRound) > boundary : roundKey(contract.signedSeason, contract.signedRound) < boundary) fail(`${path}.contractCount`, 'must identify a chronological contract prefix');
    for (const [at, reply] of state.negotiations.records.entries()) if (at < negotiationCount ? roundKey(reply.seasonNumber, reply.round) > boundary : roundKey(reply.seasonNumber, reply.round) < boundary) fail(`${path}.negotiationCount`, 'must identify a chronological response prefix');
    for (const [at, event] of state.recruitment.events.entries()) if (at < recruitmentEventCount ? roundKey(event.seasonNumber, event.round) > boundary : roundKey(event.seasonNumber, event.round) < boundary) fail(`${path}.recruitmentEventCount`, 'must identify a chronological in-season command prefix');
    // Reviews occur while active: all earlier offseason windows are complete, none from this year exist yet.
    const windows = state.market.windows.filter(window => window.seasonNumber < year);
    if (marketEventCount !== windows.reduce((sum, window) => sum + window.events.length, 0)) fail(`${path}.marketEventCount`, 'must retain exactly the completed earlier recruitment windows');
    if (index > 0) {
      if (ledgerIndex !== state.finance.ledger.filter(entry => entry.seasonNumber < year).length || contractCount !== state.employment.contracts.filter(contract => contract.signedSeason < year).length || negotiationCount !== state.negotiations.records.filter(reply => reply.seasonNumber < year).length || recruitmentEventCount !== state.recruitment.events.filter(event => event.seasonNumber < year).length) fail(path, 'must review the opening population before new-season cash, replies or offers');
    } else {
      for (const anchor of [state.academy.enabledSince, state.payroll.enabledSince]) if (anchor && roundKey(anchor.seasonNumber, anchor.round) === boundary && anchor.ledgerIndex > ledgerIndex) fail(`${path}.ledgerIndex`, 'cannot precede required feature activation on the same matchday');
      if (state.academy.enabledSince!.contractCount > contractCount || state.academy.enabledSince!.negotiationCount > negotiationCount) fail(path, 'cannot precede academy activation journal prefixes');
    }
    const finance = financeAtLedgerBoundary(state.finance, ledgerIndex), ledger = finance.ledger, paidSources = new Set(ledger.map(entry => entry.sourceId));
    const contracts = state.employment.contracts.slice(0, contractCount);
    const employment = { ...state.employment, contracts, transfers: state.employment.transfers.filter(transfer => contracts.some(contract => contract.id === transfer.contractId)).map(transfer => ({ ...transfer, payments: transfer.payments.filter(payment => paidSources.has(payment.id)) })), buyouts: state.employment.buyouts.filter(buyout => paidSources.has(buyout.id)), market: null,
      // Step 3.7: only departures decided at earlier season ends. A later departure releasing a noticed player's last
      // seasons ended his agreement early in this review's replay, so it rebuilt a shorter notice than live play kept.
      ...(state.employment.departures ? { departures: state.employment.departures.filter(departure => departure.seasonNumber < year) } : {}) };
    const youthAnchor = state.youthCompetition.enabledSince;
    const youthVisible = !youthAnchor || roundKey(youthAnchor.seasonNumber, youthAnchor.round) < roundKey(year, round) || youthAnchor.seasonNumber === year && youthAnchor.round === round && youthAnchor.ledgerIndex <= ledgerIndex && youthAnchor.contractCount <= contractCount && youthAnchor.negotiationCount <= negotiationCount && youthAnchor.recruitmentEventCount <= recruitmentEventCount;
    const youthCompetition = youthVisible ? youthCompetitionAtBoundary(state.youthCompetition, year, round) : createYouthCompetition(state.youthCompetition.model);
    const academy = academyAtBoundary(state.academy, year, round, contractCount, !youthVisible && youthAnchor && youthAnchor.seasonNumber === year && youthAnchor.round === round ? youthAnchor.academyIntakeCount : undefined);
    const offers = recruitmentEventCount ? recruitmentHolds.find(hold => hold.eventCount === recruitmentEventCount)?.offers : [];
    if (!offers) fail(`${path}.recruitmentEventCount`, 'must reference a replayed in-season command boundary');
    const context: SeasonState = {
      ...state, managedClubId: managedClubAtRound(state, year, round), seasonNumber: year, round, date: review.date, status: 'active', academy, lifecycle: replayed, youthCompetition, employment,
      clubs: clubsForEmploymentYear(employment, year, round, { world: worldOf(state), academy, lifecycle: replayed, seasonNumber: year, round, background: state.background }),
      finance, negotiations: { ...state.negotiations, records: replies },
      recruitment: { ...state.recruitment, events: state.recruitment.events.slice(0, recruitmentEventCount), offers }, market: { ...state.market, windows },
    };
    try { replayed = (index === 0 ? enableLifecycle(context) : prepareLifecycleSeason(context)).lifecycle; }
    catch (error) { fail(path, `cannot review its recorded career boundary: ${error instanceof Error ? error.message : 'invalid source'}`); }
    if (!sameData(replayed.reviews.at(-1), review)) fail(path, 'must reproduce exact source prefixes and the canonical retirement decisions');
  }
  if (!sameData(replayed, lifecycle)) fail('lifecycle.notices', 'must preserve deterministic ages, population protection, existing agreements, pending terms and immutable retirement dates');
}

/** One check's background sides: a pure function of the career context, the club and the season, worked out once each. */
function backgroundSides(context: Parameters<typeof backgroundSide>[0]): (clubId: string, seasonNumber: number) => Team {
  const sides = new Map<string, Team>();
  return (clubId, seasonNumber) => {
    const key = `${seasonNumber}/${clubId}`;
    let side = sides.get(key);
    if (!side) { side = backgroundSide(context, clubId, seasonNumber); sides.set(key, side); }
    return side;
  };
}

/**
 * Format 80: an injury from a national game (owner, 22 November 2026). While the game's competition is kept: the player
 * was injured in it, his club was a full-world club of that season and the diagnosis is the career's deterministic one
 * (recurrence from the earlier history, the club's medical centre). Older seasons' competitions are dropped at the
 * rollover; their injuries keep basic checks (development mode).
 */
function validateNationalInjury(value: unknown, path: string, national: unknown, context: CareerPlayerContext, history: readonly SeasonInjury[], career: { seed: number; world: CareerWorld; facilities: SeasonFacilities; injuryModel: InjuryModel | undefined }): SeasonInjury {
  const injury = record(value, path, ['id', 'playerId', 'clubId', 'kind', 'fixtureId', 'occurredOn', 'returnOn']) as unknown as SeasonInjury;
  if (typeof injury.playerId !== 'string' || typeof injury.clubId !== 'string' || injury.id !== `${injury.fixtureId}:${injury.playerId}` || !isMatchInjuryKind(injury.kind) || typeof injury.occurredOn !== 'string' || typeof injury.returnOn !== 'string' || !(injury.returnOn > injury.occurredOn)) fail(path, 'must be a supported diagnosis from a national game');
  const competitions = national !== null && typeof national === 'object' && Array.isArray((national as { competitions?: unknown }).competitions) ? (national as SeasonNational).competitions : [];
  const competition = competitions.find(item => item !== null && typeof item === 'object' && Array.isArray(item.fixtures) && item.fixtures.some(fixture => fixture?.id === injury.fixtureId));
  if (!competition) {
    if (!/^n[qt]-s(\d+)-/u.test(injury.fixtureId) || Number(/^n[qt]-s(\d+)-/u.exec(injury.fixtureId)![1]) >= context.seasonNumber! - 1) fail(path, 'must come from a recorded national game');
    return injury;
  }
  const fixture = competition.fixtures.find(item => item.id === injury.fixtureId)!;
  const result = fixture.result as { injuries?: Record<string, unknown>; squads?: { home?: unknown; away?: unknown } } | null;
  if (!result || fixture.date !== injury.occurredOn || result.injuries?.[injury.playerId] !== injury.kind) fail(path, 'must match its national game\'s injuries');
  if (!fullWorldClubsIn(context, competition.seasonNumber).some(club => club.id === injury.clubId)) fail(path, 'must name the player\'s club');
  const expected = createSeasonInjury(career.seed, fixture, injury.clubId, injury.playerId, injury.kind, history, medicalRecoveryPercent({ world: career.world, facilities: career.facilities }, injury.clubId, fixture.date), career.injuryModel);
  if (!sameData(injury, expected)) fail(path, 'must retain the original diagnosis and recovery date');
  return injury;
}

/** Rebuild treatment before using it to decide any historical fixture availability. */
function validateRehabilitation(physio: SeasonPhysio, state: SeasonState, employment: SeasonEmployment | undefined): void {
  if (!physio.enabledSince) return;
  if (!Array.isArray(physio.rehabilitation) || physio.rehabilitation.length > 600 * state.seasonNumber * (seasonRounds(state) - 1)) fail('physio.rehabilitation', 'must retain a bounded chronological treatment history');
  for (const [index, value] of physio.rehabilitation.entries()) record(value, `physio.rehabilitation[${index}]`, ['id', 'injuryId', 'playerId', 'clubId', 'seasonNumber', 'afterRound', 'fromDate', 'toDate', 'rosterId', 'contractId', 'physioId', 'eligibleDays', 'creditBefore', 'creditEarned', 'creditAfter', 'returnBefore', 'returnAfter']);
  const schedules = new Map<string, SeasonFixture>(), years = new Map<string, number>();
  // Each season's canonical games, including the postseason games its own results made due (step 3.4b).
  for (let year = 1; year <= state.seasonNumber; year += 1) for (const fixture of canonicalFixtures({ clubs: state.clubs, fixtures: year === state.seasonNumber ? state.fixtures : state.history[year - 1]?.fixtures, world: worldOf(state), divisions: year === state.seasonNumber ? state.divisions : state.history[year - 1]?.divisions, seed: state.seed, ...(state.national ? { national: true } : {}), ...((year === state.seasonNumber ? state.europe : state.history[year - 1]?.europe) ? { europe: year === state.seasonNumber ? state.europe : state.history[year - 1]!.europe } : {}) }, year, 'injuries')) { schedules.set(fixture.id, fixture); years.set(fixture.id, year); }
  const players = new Set(getCareerPlayers(state).map(player => player.id));
  // Step 3.5b: a background side's player injured in a European game.
  const sides = backgroundSides(state);
  const backgroundPlayer = (fixture: SeasonFixture, clubId: string, playerId: string) => !!fixture.competition && !fullWorldClubsIn(state, years.get(fixture.id)!).some(club => club.id === clubId) && sides(clubId, years.get(fixture.id)!).players.some(player => player.id === playerId);
  // Incremental checkpoint checks (`trusted-prefix.ts`): injuries of games before the trusted checkpoint's week are
  // unchanged, and their diagnoses read only earlier injuries, those games and the medical facilities of their days.
  const injuryPlan = prefixPlan('injuries', state.injuries);
  for (const [index, value] of state.injuries.entries()) {
    const path = `injuries[${index}]`, injury = record(value, path, ['id', 'playerId', 'clubId', 'kind', 'fixtureId', 'occurredOn', 'returnOn']);
    if (index < injuryPlan.skip) continue;
    // Format 80: national games' injuries are checked with the chronological injury history.
    if (state.national && typeof injury.fixtureId === 'string' && isNationalFixtureId(injury.fixtureId)) continue;
    const fixture = schedules.get(injury.fixtureId as string);
    if (!fixture || !players.has(injury.playerId as string) && !backgroundPlayer(fixture, injury.clubId as string, injury.playerId as string) || ![fixture.homeClubId, fixture.awayClubId].includes(injury.clubId as string) || !isInjuryKind(injury.kind)) fail(path, 'must identify a supported diagnosis and originating fixture');
    if (!sameData(injury, createSeasonInjury(state.seed, fixture, injury.clubId as string, injury.playerId as string, injury.kind as SeasonInjury['kind'], state.injuries, medicalRecoveryPercent(state, injury.clubId as string, fixture.date), state.injuryModel))) fail(path, 'must retain the original diagnosis and recovery date');
  }
  let replayed: SeasonPhysio = { ...physio, rehabilitation: [] };
  // Incremental checkpoint checks (`trusted-prefix.ts`): the weeks before the trusted checkpoint's week read only treatment
  // and injury records it already held; resume the treatment replay where its check reached that week.
  const resume = recall<{ replayed: SeasonPhysio; seasonNumber: number; afterRound: number }>('physio.rehabilitation', 'replay');
  const resumed = resume && resume.seasonNumber === state.seasonNumber && roundKey(resume.seasonNumber, resume.afterRound + 1) === trustedCutKey() ? resume : undefined;
  if (resumed) replayed = resumed.replayed;
  for (let year = resumed ? state.seasonNumber : physio.enabledSince.seasonNumber; year <= state.seasonNumber; year += 1) {
    const fromRound = year === physio.enabledSince.seasonNumber ? physio.enabledSince.round : 1;
    const throughRound = year === state.seasonNumber ? Math.min(state.round - 1, (seasonRounds(state) - 1)) : (seasonRounds(state) - 1);
    const rosters = year === state.seasonNumber ? state.rosters : state.history[year - 1]?.rosters;
    if (!Array.isArray(rosters)) fail('physio.rehabilitation', 'requires the retained registration history for every treatment season');
    for (let afterRound = resumed ? resumed.afterRound : fromRound; afterRound <= throughRound; afterRound += 1) {
      if (year === state.seasonNumber && afterRound === state.round - 1) remember('physio.rehabilitation', 'replay', { replayed, seasonNumber: year, afterRound });
      const fromDate = dateForRound(afterRound, year), toDate = dateForRound(afterRound + 1, year);
      replayed = processRehabilitationWeek({ ...(state.world ? { world: state.world } : {}), ...(state.facilities ? { facilities: state.facilities } : {}), physio: replayed, clubs: clubsForEmploymentYear(employment, year, afterRound, state), rosters, injuries: state.injuries.filter(injury => injury.occurredOn <= fromDate), seasonNumber: year, afterRound, fromDate, toDate });
    }
  }
  if (!sameData(replayed.rehabilitation, physio.rehabilitation)) fail('physio.rehabilitation', 'must reconcile exact historical staff, registration, treatment days, credits and return dates');
}

function validateTicketPrice(value: unknown, path: string, context: WorldContext, clubId: string): number {
  const price = number(value, path, 0, maxTicketPriceFor(context, clubId));
  if (price % TICKET_PRICE_STEP !== 0) fail(path, 'must use whole-euro price steps');
  return price;
}

function clubsForEmploymentYear(employment: SeasonEmployment | undefined, seasonNumber: number, round?: number, context: CareerPlayerContext = {}): readonly Team[] {
  round ??= seasonRounds(context);
  const definitions = fullWorldClubsIn(context, seasonNumber);
  return employment ? getContractedClubsForRound({ ...context, employment, clubs: definitions }, seasonNumber, round) : definitions;
}

/** Registration stays unchanged between contract/transfer starts. Rebuild only possible changes, in order;
 * still compare complete player records, since a candidate boundary need not actually change a squad.
 * This is a fresh reconstruction from the supplied contract prefix, never a saved snapshot or cached verdict.
 */
function rostersForEmploymentYear(employment: SeasonEmployment | undefined, year: number, throughRound: number, context: CareerPlayerContext): RosterSnapshot[] {
  const rosters = createRosterSnapshots(clubsForEmploymentYear(employment, year, 1, context), year);
  for (const round of employment ? registrationChangeRounds(employment, year, throughRound) : []) {
    for (const club of clubsForEmploymentYear(employment, year, round, context)) {
      if (!sameData(rosterForRound(rosters, club.id, round).players, club.players)) {
        rosters.push({ id: `roster-s${year}-${club.id}-r${round}`, clubId: club.id, fromRound: round,
          players: club.players.map(player => ({ ...player, attributes: { ...player.attributes } })) });
      }
    }
  }
  return rosters;
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

function validateFacilitiesShape(value: unknown, state: SeasonState, version: number): SeasonFacilities {
  const funding = version >= 32;
  const maintenance = version >= 36;
  // Format 71: careers can finance projects with loans and leases (`loans-1`); format 74: the simple bank loan (`bank-1`).
  const financed = value !== null && typeof value === 'object' && Object.hasOwn(value, 'financing');
  const fields = record(value, 'facilities', ['model', 'enabledSince', 'delegated', 'projects', 'events', ...(funding ? ['fundingSince'] : []), ...(maintenance ? ['maintenanceSince'] : []), ...(financed ? ['financing', 'debts'] : [])]);
  if (financed && (fields.financing !== 'loans-1' && fields.financing !== 'bank-1' || !Array.isArray(fields.debts) || fields.debts.length > 20_000)) fail('facilities.debts', 'must retain a bounded loan and lease history of the supported financing model');
  if (fields.model !== 'facilities-1' && fields.model !== 'facilities-2' && fields.model !== 'facilities-3') fail('facilities.model', 'is unsupported');
  // Format 65: medical and scouting facilities, seasonal wear and repairs (`facilities-2`) belong to new careers only.
  if (fields.model === 'facilities-2' && version < 65) fail('facilities.model', 'requires format 65 or later');
  if (financed && version < 71) fail('facilities.financing', 'requires format 71 or later');
  // Format 74 (owner request, 16 November 2026): six named levels, arena seats and the simple bank loan go together.
  // The format guard names the format the six-level model shipped with.
  const six = fields.model === 'facilities-3', bank = fields.financing === 'bank-1';
  if (six && version < SIX_LEVEL_FORMAT) fail('facilities.model', `requires format ${SIX_LEVEL_FORMAT} or later`);
  if (six !== bank) fail('facilities.financing', 'must pair six facility levels with the simple bank loan');
  const repairs = fields.model === 'facilities-2';
  const { fundingSince: _fundingDefault, maintenanceSince: _maintenanceDefault, ...legacyDefaults } = createFacilities(clubsEverInFullWorld(state, state.seasonNumber), state.managedClubId, fields.model as SeasonFacilities['model'], financed ? fields.financing as SeasonFacilities['financing'] : undefined);
  const defaults = { ...legacyDefaults, ...(funding ? { fundingSince: null } : {}), ...(maintenance ? { maintenanceSince: null } : {}) };
  const policies = record(fields.delegated, 'facilities.delegated', clubsEverInFullWorld(state, state.seasonNumber).map(club => club.id));
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
    const year = number(anchor.seasonNumber, `${path}.seasonNumber`, 1, state.seasonNumber), round = number(anchor.round, `${path}.round`, 1, year === state.seasonNumber ? state.round : seasonRounds(state));
    const ledgerIndex = number(anchor.ledgerIndex, `${path}.ledgerIndex`, 0, financeLedgerCount(state.finance));
    const contractCount = number(anchor.contractCount, `${path}.contractCount`, 0, state.employment?.contracts.length ?? 0);
    const negotiationCount = number(anchor.negotiationCount, `${path}.negotiationCount`, 0, state.negotiations?.records.length ?? 0);
    const recruitmentCount = number(anchor.recruitmentEventCount, `${path}.recruitmentEventCount`, 0, recruitmentEvents.length);
    const marketCount = number(anchor.marketEventCount, `${path}.marketEventCount`, 0, marketEvents.length);
    const calendar = roundKey(year, round);
    const commitIndexes = state.finance.ledger.flatMap((entry, index) => entry.seasonNumber === year && entry.round === round && (['tickets', 'operations', 'facility-upkeep'].includes(entry.kind) || entry.kind === 'payroll' && entry.payroll?.type === 'installment') ? [index] : []);
    if (commitIndexes.length && ledgerIndex > commitIndexes[0]! && (round < seasonRounds(state) || ledgerIndex <= commitIndexes.at(-1)!)) fail(path, 'cannot interleave a facilities decision with the atomic matchday financial commit');
    if (calendar < roundKey(state.finance.enabledSince!.seasonNumber, state.finance.enabledSince!.round)) fail(path, 'cannot precede finance activation');
    // Opening construction completes before the new sponsorship entries; all other cash stays chronological.
    for (const [i, entry] of state.finance.ledger.entries()) if (i < ledgerIndex ? roundKey(entry.seasonNumber, entry.round) > calendar : roundKey(entry.seasonNumber, entry.round) < calendar && !(round === 1 && entry.seasonNumber === year - 1 && entry.round === seasonRounds(state))) fail(path, 'must identify a contiguous chronological cash prefix');
    for (const [i, entry] of recruitmentEvents.entries()) if (i < recruitmentCount ? roundKey(entry.seasonNumber, entry.round) > calendar : roundKey(entry.seasonNumber, entry.round) < calendar) fail(path, 'must identify the actual recruitment command prefix');
    const previousMarketCount = windows.filter(window => window.seasonNumber < year).reduce((sum, window) => sum + window.events.length, 0);
    const current = windows.find(window => window.seasonNumber === year);
    if (marketCount < previousMarketCount || marketCount > previousMarketCount + (round === seasonRounds(state) ? current?.events.length ?? 0 : 0)) fail(path, 'must identify the current offseason command prefix');
    const visibleMarket = current?.events.slice(0, marketCount - previousMarketCount) ?? [];
    const expectedDate = round === seasonRounds(state) ? visibleMarket.filter(event => event.type === 'advance').at(-1)?.date ?? dateForRound(round, year) : dateForRound(round, year);
    if (anchor.date !== expectedDate || (anchor.date as string) > state.date) fail(`${path}.date`, 'must be a calendar date already reached by its exact command prefix');
    for (const [i, entry] of (state.negotiations?.records ?? []).entries()) if (i < negotiationCount ? entry.date > expectedDate : entry.date < expectedDate) fail(path, 'must identify the chronological player response prefix');
    const initialContracts = (state.employment?.contracts ?? []).filter(contract => contract.kind === 'initial');
    if (contractCount > 0 && contractCount < initialContracts.length) fail(path, 'must retain all initial employment agreements together');
    for (const [i, contract] of (state.employment?.contracts ?? []).entries()) if (i < contractCount ? roundKey(contract.signedSeason, contract.signedRound) > calendar : roundKey(contract.signedSeason, contract.signedRound) < calendar) fail(path, 'must identify the chronological signed-contract prefix');
    const negotiationAnchor = state.negotiations?.enabledSince;
    if (negotiationAnchor && calendar >= roundKey(negotiationAnchor.seasonNumber, negotiationAnchor.round) && contractCount >= negotiationAnchor.contractCount && contractCount !== negotiationAnchor.contractCount + state.negotiations.records.slice(0, negotiationCount).filter(entry => entry.outcome === 'accepted').length + joinedIn(state.employment?.contracts, contractCount)) fail(path, 'must preserve contracts explained by the response prefix');
    return anchor as unknown as FacilityAnchor;
  };
  const anchor = checkAnchor(fields.enabledSince, 'facilities.enabledSince');
  if (funding && fields.fundingSince !== null) {
    const fundingSince = checkAnchor(fields.fundingSince, 'facilities.fundingSince');
    if (fundingSince.date < anchor.date || FACILITY_ANCHOR_KEYS.filter(key => !['seasonNumber', 'round', 'date'].includes(key)).some(key => fundingSince[key] < anchor[key])) fail('facilities.fundingSince', 'cannot precede facilities activation');
    if (!state.board?.enabledSince) fail('facilities.fundingSince', 'requires board reviews');
  }
  if (maintenance && fields.maintenanceSince !== null) {
    const maintenanceSince = checkAnchor(fields.maintenanceSince, 'facilities.maintenanceSince');
    if (maintenanceSince.date < anchor.date || FACILITY_ANCHOR_KEYS.filter(key => !['seasonNumber', 'round', 'date'].includes(key)).some(key => maintenanceSince[key] < anchor[key])) fail('facilities.maintenanceSince', 'cannot precede facilities activation');
  }
  let previous = anchor;
  // Incremental checkpoint checks (`trusted-prefix.ts`): decisions made before the trusted checkpoint's week are unchanged
  // and their anchors were checked by it (records added since are dated at or after that week).
  const eventPlan = version === SEASON_SCHEMA_VERSION ? prefixPlan('facilities.events', fields.events as FacilityEvent[], event => roundKey(event.seasonNumber, event.round)) : { skip: 0 };
  for (const [index, raw] of fields.events.entries()) {
    if (index < eventPlan.skip) { const event = raw as FacilityEvent; previous = Object.fromEntries(FACILITY_ANCHOR_KEYS.map(key => [key, event[key]])) as unknown as FacilityAnchor; continue; }
    const path = `facilities.events[${index}]`, type = raw && typeof raw === 'object' ? raw.type : undefined;
    const fundsRepair = repairs && type === 'funding' && Object.hasOwn(raw, 'project');
    // Format 74: an arena start names the seats it adds; there are no repairs, upkeep plans, board capital or leases.
    const expansion = six && type === 'start' && raw.facilityType === 'arena';
    const extra = type === 'start' ? ['projectId', 'clubId', 'facilityType', ...(expansion ? ['seats'] : [])] : type === 'repair' && repairs ? ['projectId', 'clubId', 'facilityType'] : type === 'cancel' ? ['projectId'] : type === 'delegate' ? ['clubId', 'delegated'] : type === 'process' ? [] : six ? type === 'borrow' ? ['debtId', 'clubId', 'principal', 'seasons', 'rateBasisPoints'] : type === 'repay' ? ['debtId'] : null
      : type === 'maintenance' && maintenance ? ['clubId', 'plan'] : type === 'funding' && funding ? ['clubId', 'facilityType', 'amount', 'mode', 'approved', 'confidence', 'requiredConfidence', 'capitalRemaining', ...(fundsRepair ? ['project'] : [])]
      : !financed ? null : type === 'loan' ? ['debtId', 'clubId', 'facilityType', 'project', 'principal', 'seasons', 'rateBasisPoints'] : type === 'lease' ? ['debtId', 'projectId', 'clubId', 'facilityType', 'seasons'] : type === 'repay' || type === 'end-lease' ? ['debtId'] : null;
    if (!extra) fail(path, 'must identify a supported facilities decision');
    const event = record(raw, path, [...FACILITY_ANCHOR_KEYS, 'type', ...extra]);
    if (fundsRepair && event.project !== 'repair') fail(`${path}.project`, 'must name a repair');
    if (Object.hasOwn(event, 'facilityType') && !facilityTypes(fields as Pick<SeasonFacilities, 'model'>).includes(event.facilityType as FacilityType)) fail(`${path}.facilityType`, 'must name a facility of this career');
    if (expansion && !FACILITY_RULES_3.expansionSeats.includes(event.seats as number)) fail(`${path}.seats`, 'must name a supported arena expansion size');
    const at = checkAnchor(Object.fromEntries(FACILITY_ANCHOR_KEYS.map(key => [key, event[key]])), path);
    if (at.date < previous.date || FACILITY_ANCHOR_KEYS.filter(key => !['seasonNumber', 'round', 'date'].includes(key)).some(key => at[key] < previous[key])) fail(path, 'must preserve chronological command and commitment prefixes');
    previous = at;
  }
  for (const [index, raw] of fields.projects.entries()) {
    const kind = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>).kind : undefined;
    const lease = financed && !six && kind === 'lease', repair = repairs && !lease && raw !== null && typeof raw === 'object' && Object.hasOwn(raw, 'kind');
    // Format 74: an arena expansion keeps level 1 and records the seats it adds.
    const expansion = six && raw !== null && typeof raw === 'object' && (raw as Record<string, unknown>).type === 'arena';
    const path = `facilities.projects[${index}]`, project = record(raw, path, ['id', 'clubId', 'type', 'fromLevel', 'toLevel', 'cost', 'startedOn', 'dueOn', 'completedOn', 'cancelledOn', 'startEventIndex', ...(repair ? ['kind', 'conditionBefore'] : []), ...(lease ? ['kind', ...(Object.hasOwn(raw, 'returnedOn') ? ['returnedOn'] : [])] : []), ...(expansion ? ['kind', 'seats'] : [])]);
    if (expansion && (project.kind !== 'expansion' || project.fromLevel !== 1 || project.toLevel !== 1 || !FACILITY_RULES_3.expansionSeats.includes(project.seats as number))) fail(path, 'must add a supported number of seats to the arena');
    if (six && !expansion && (project.toLevel !== (project.fromLevel as number) + 1 || (project.toLevel as number) > facilityMaxLevel(fields as Pick<SeasonFacilities, 'model'>))) fail(path, 'must raise one facility by one level');
    if (lease && (project.toLevel !== (project.fromLevel as number) + 1 || project.cost !== 0 || project.dueOn !== project.startedOn || project.cancelledOn !== null || Object.hasOwn(project, 'returnedOn') && (typeof project.returnedOn !== 'string' || project.completedOn === null || project.returnedOn < (project.completedOn as string)))) fail(path, 'must install one leased level for nothing upfront, and hand it back only after it was installed');
    if (repair && (project.kind !== 'repair' || project.fromLevel !== project.toLevel)) fail(path, 'must restore condition at an unchanged level');
    if (repair) number(project.conditionBefore, `${path}.conditionBefore`, 0, 100);
    if (project.id !== `facility-project-${index + 1}`) fail(`${path}.id`, 'must retain sequential project identities');
    number(project.startEventIndex, `${path}.startEventIndex`, 0, fields.events.length - 1);
  }
  // Format 71: loan and lease terms; the command replay rebuilds each one exactly.
  if (financed) for (const [index, raw] of (fields.debts as unknown[]).entries()) {
    // Format 74: a bank loan is tied to no project or facility.
    const path = `facilities.debts[${index}]`, debt = record(raw, path, ['id', 'kind', 'clubId', ...(bank ? [] : ['projectId', 'facilityType']), 'principal', 'rateBasisPoints', 'seasons', 'payment', 'total', 'seasonNumber', 'round', 'date', 'ledgerIndex', 'startEventIndex', 'settled']);
    const terms = bank ? BANK_LOAN_RULES.termSeasons : FACILITY_FINANCING_RULES.termSeasons;
    if (debt.id !== `facility-debt-${index + 1}` || (bank ? debt.kind !== 'bank' : debt.kind !== 'loan' && debt.kind !== 'lease') || !terms.includes(debt.seasons as number)) fail(path, 'must retain sequential loan and lease terms');
    for (const key of ['principal', 'payment', 'total', 'ledgerIndex', 'startEventIndex', 'rateBasisPoints'] as const) number(debt[key], `${path}.${key}`, 0, Number.MAX_SAFE_INTEGER);
    if (debt.kind !== 'lease' && (debt.rateBasisPoints as number) > FACILITY_FINANCING_RULES.maxRateBasisPoints || debt.kind === 'lease' && debt.rateBasisPoints !== 0) fail(`${path}.rateBasisPoints`, 'must be a supported rate');
    if (debt.settled !== null) {
      const settled = record(debt.settled, `${path}.settled`, ['seasonNumber', 'round', 'date', 'ledgerIndex', 'amount']);
      number(settled.amount, `${path}.settled.amount`, 0, Number.MAX_SAFE_INTEGER);
    }
  }
  return fields as unknown as SeasonFacilities;
}

interface MarketReplaySnapshot { eventCount: number; seasonNumber: number; market: SeasonMarket }

/**
 * The facility project a payment belongs to: its construction cost, the board capital that funded it (format 32), or
 * the loan received for it or the lease agreed for it (format 71).
 */
const facilityProjectOf = (entry: FinanceEntry, facilities: SeasonFacilities): string | null => entry.kind === 'facility' ? entry.sourceId : entry.kind === 'board-capital' ? entry.boardCapital?.projectId ?? null
  : (entry.kind === 'loan' || entry.kind === 'lease') && entry.debt?.payment === 'start' ? facilities.debts?.find(debt => debt.id === entry.debt!.debtId)?.projectId ?? null : null;

/**
 * The facilities command that booked a payment, as its event index: a project's start (its cost, board capital or the
 * loan or lease for it), or a bank loan received (format 74, tied to no project). Null for any other entry.
 */
function facilityCommandOf(entry: FinanceEntry, facilities: SeasonFacilities): number | null {
  const projectId = facilityProjectOf(entry, facilities);
  if (projectId !== null) return facilities.projects.find(project => project.id === projectId)?.startEventIndex ?? null;
  if (entry.kind !== 'loan' || entry.debt?.payment !== 'start') return null;
  const debt = facilities.debts?.find(item => item.id === entry.debt!.debtId);
  return debt?.kind === 'bank' ? debt.startEventIndex : null;
}

/** A command may share a date with later completion/cancellation; counters disambiguate that history. */
function facilitiesAtPrefix(state: SeasonState, date: string, ledgerIndex: number, contractCount: number, negotiationCount: number, recruitmentEventCount: number, marketEventCount: number): SeasonFacilities {
  const visible = (anchor: FacilityAnchor) => anchor.date <= date && anchor.ledgerIndex <= ledgerIndex && anchor.contractCount <= contractCount && anchor.negotiationCount <= negotiationCount && anchor.recruitmentEventCount <= recruitmentEventCount && anchor.marketEventCount <= marketEventCount;
  if (!state.facilities.enabledSince || !visible(state.facilities.enabledSince)) return createFacilities(state.clubs, managedClubAtLedger(state, ledgerIndex), state.facilities.model, state.facilities.financing);
  const count = state.facilities.events.findIndex(event => !visible(event));
  return facilitiesAtEventCount(state.facilities, count < 0 ? state.facilities.events.length : count, managedClubAtLedger(state, state.facilities.enabledSince.ledgerIndex));
}

function validateFacilitiesHistory(state: SeasonState, holds: RecruitmentHolds[], markets: MarketReplaySnapshot[]): void {
  const source = state.facilities, anchor = source.enabledSince;
  if (!anchor) return;
  // Defaults follow the club managed at activation; a later move journals its control changes as ordinary events.
  // Every club that has been in the full world keeps its facilities (step 3.4d-2).
  const { fundingSince: _unusedDefault, maintenanceSince: _unusedMaintenance, ...base } = createFacilities(clubsEverInFullWorld(state, state.seasonNumber), managedClubAtLedger(state, anchor.ledgerIndex), source.model, source.financing);
  const fundingFormat = Object.hasOwn(source, 'fundingSince'), fundingSince = source.fundingSince ?? null;
  const maintenanceFormat = Object.hasOwn(source, 'maintenanceSince'), maintenanceSince = source.maintenanceSince ?? null;
  let facilities: SeasonFacilities = { ...base, enabledSince: anchor, ...(fundingFormat ? { fundingSince: null } : {}), ...(maintenanceFormat ? { maintenanceSince: null } : {}) };
  let previousLedger = anchor.ledgerIndex;
  // Incremental checkpoint checks (`trusted-prefix.ts`): resume the command replay where the trusted checkpoint's check
  // reached its week; each later command is replayed against a context rebuilt from this state, as in a full check.
  const plan = prefixPlan('facilities.events', source.events, event => roundKey(event.seasonNumber, event.round));
  const resume = plan.skip > 0 ? recall<{ facilities: SeasonFacilities; previousLedger: number }>('facilities.events', 'replay') : undefined;
  if (resume) { facilities = resume.facilities; previousLedger = resume.previousLedger; }
  for (const [index, event] of source.events.entries()) {
    if (resume && index < plan.skip) continue;
    if (index === plan.record) remember('facilities.events', 'replay', { facilities, previousLedger });
    const path = `facilities.events[${index}]`, year = event.seasonNumber, round = event.round;
    // Board funding applies from its activation anchor; an approval must start the funded upgrade at once.
    if (fundingSince && event.date >= fundingSince.date && FACILITY_ANCHOR_KEYS.filter(key => !['seasonNumber', 'round', 'date'].includes(key)).every(key => event[key] >= fundingSince[key])) facilities = { ...facilities, fundingSince };
    // Upkeep plans apply from their activation anchor, like board funding.
    if (maintenanceSince && event.date >= maintenanceSince.date && FACILITY_ANCHOR_KEYS.filter(key => !['seasonNumber', 'round', 'date'].includes(key)).every(key => event[key] >= maintenanceSince[key])) facilities = { ...facilities, maintenanceSince };
    if (event.type === 'funding' && event.approved) {
      const next = source.events[index + 1];
      if (next?.type !== (event.project === 'repair' ? 'repair' : 'start') || next.clubId !== event.clubId || next.facilityType !== event.facilityType || next.date !== event.date || next.ledgerIndex !== event.ledgerIndex + 1) fail(path, 'must start the funded upgrade immediately after the board approves its capital');
    }
    // Format 71: a loan pays for the project that starts immediately afterwards.
    if (event.type === 'loan') {
      const next = source.events[index + 1];
      if (next?.type !== (event.project === 'repair' ? 'repair' : 'start') || next.clubId !== event.clubId || next.facilityType !== event.facilityType || next.date !== event.date || next.ledgerIndex !== event.ledgerIndex + 1) fail(path, 'must start the project the loan pays for immediately after the loan is received');
    }
    const finance = financeAtLedgerBoundary(state.finance, event.ledgerIndex), ledger = finance.ledger;
    const contracts = state.employment.contracts.slice(0, event.contractCount);
    const sourceIds = new Set(ledger.map(entry => entry.sourceId));
    const employment: SeasonEmployment = event.contractCount === 0 ? createEmployment() : { ...state.employment, contracts, transfers: state.employment.transfers.filter(transfer => contracts.some(contract => contract.id === transfer.contractId)).map(transfer => ({ ...transfer, payments: transfer.payments.filter(payment => sourceIds.has(payment.id)) })), buyouts: state.employment.buyouts.filter(buyout => sourceIds.has(buyout.id)), market: null };
    const academyAnchor = state.academy.enabledSince;
    const academyVisible = !academyAnchor || academyAnchor.ledgerIndex <= event.ledgerIndex && academyAnchor.contractCount <= event.contractCount && academyAnchor.negotiationCount <= event.negotiationCount;
    const academy = academyVisible ? academyAtBoundary(state.academy, year, round, event.contractCount) : createAcademy();
    const lifecycle = lifecycleAtBoundary(state.lifecycle, year, round, event.contractCount, event.recruitmentEventCount, event.marketEventCount, event.ledgerIndex, event.negotiationCount);
    const clubs = clubsForEmploymentYear(employment, year, round, { world: worldOf(state), academy, lifecycle, seasonNumber: year, round, background: state.background });
    const snapshot = markets.filter(item => item.eventCount === event.marketEventCount && item.seasonNumber <= year).at(-1);
    const market: SeasonMarket = snapshot ? { ...snapshot.market, windows: snapshot.market.windows.filter(window => window.seasonNumber <= year).map(window => ({ ...window, closed: window.seasonNumber < year })) } : { ...state.market, windows: state.market.windows.filter(window => window.seasonNumber < year) };
    const live = holds.find(hold => hold.eventCount === event.recruitmentEventCount)?.offers ?? [];
    const payrollVisible = state.payroll.enabledSince && state.payroll.enabledSince.ledgerIndex <= event.ledgerIndex;
    const payroll = payrollVisible ? { ...state.payroll, agreements: state.payroll.agreements.filter(agreement => agreement.seasonNumber < year || agreement.seasonNumber === year && agreement.startsRound <= round && (!employment.enabledSince || contractForRound(employment, agreement.playerId, year, agreement.startsRound)?.clubId === agreement.clubId)) } : createPayroll(clubs, state.managedClubId);
    const trainingAnchor = state.training.enabledSince;
    const training = trainingAnchor && roundKey(trainingAnchor.seasonNumber, trainingAnchor.round) <= roundKey(year, round) ? state.training : { ...state.training, enabledSince: null };
    // Format 87: automatic spending reads that season's own schedule (`remainingHomeShare`).
    let replay: SeasonState = { ...state, managedClubId: managedClubAtLedger(state, event.ledgerIndex), training, seasonNumber: year, round, date: event.date, status: round === seasonRounds(state) && ledger.some(entry => entry.seasonNumber === year && entry.round === seasonRounds(state) && entry.kind === 'operations') ? 'complete' : 'active', clubs, academy, lifecycle, employment, facilities, finance, payroll, negotiations: { ...state.negotiations, records: state.negotiations.records.slice(0, event.negotiationCount) }, recruitment: { ...state.recruitment, events: state.recruitment.events.slice(0, event.recruitmentEventCount), offers: live }, market , ...(usesEconomyBalance(state) && year !== state.seasonNumber ? { fixtures: (state.history.find(archive => archive.seasonNumber === year)?.fixtures ?? []) as unknown as SeasonState['fixtures'] } : {}) };
    if (event.ledgerIndex < previousLedger) fail(path, 'cannot rewind cash after a funded approval');
    for (const [i, command] of state.recruitment.events.entries()) {
      const nextLedger = event.ledgerIndex + Number(['start', 'repair', 'loan', 'lease', 'repay', 'end-lease', 'borrow'].includes(event.type));
      if (i < event.recruitmentEventCount ? command.ledgerIndexBefore > event.ledgerIndex : command.ledgerIndexBefore < nextLedger) fail(path, 'must preserve the cash ordering of the recorded recruitment prefix and project payment');
    }
    if (event.type === 'process' && event.date === dateForRound(round, year)) {
      const expectedLedger = state.finance.ledger.filter(entry => entry.seasonNumber < year || entry.seasonNumber === year && entry.round < round).length;
      const expectedRecruitment = state.recruitment.events.filter(entry => entry.seasonNumber < year || entry.seasonNumber === year && entry.round < round).length;
      if (event.ledgerIndex !== expectedLedger || event.recruitmentEventCount !== expectedRecruitment) fail(path, 'must process construction at the new calendar boundary before replies and new-round payments');
    }
    try { replay = applyFacilityEvent(replay, event); } catch (error) { fail(path, `does not follow construction rules: ${error instanceof Error ? error.message : 'invalid command'}`); }
    if (!samePrefix(replay.finance.ledger, state.finance.ledger)) fail(path, 'must pay the exact approved project once at its anchored cash boundary');
    facilities = replay.facilities; previousLedger = financeLedgerCount(replay.finance);
  }
  if (plan.record === source.events.length) remember('facilities.events', 'replay', { facilities, previousLedger });
  if (fundingFormat) facilities = { ...facilities, fundingSince };
  if (maintenanceFormat) facilities = { ...facilities, maintenanceSince };
  if (!sameData(facilities, source)) fail('facilities', 'must exactly reproduce funded costs, levels, dates, cancellations and delegation from its command history');
  // A due project completes at the first calendar boundary actually visited, even across a long offseason.
  const dates = new Set<string>();
  for (let year = anchor.seasonNumber; year <= state.seasonNumber; year += 1) {
    for (let round = 1; round <= (year === state.seasonNumber ? state.round : seasonRounds(state)); round += 1) { const date = dateForRound(round, year); if (date >= anchor.date) dates.add(date); }
    for (const event of state.market.windows.find(window => window.seasonNumber === year)?.events ?? []) if (event.type === 'advance') dates.add(event.date);
  }
  const visited = [...dates].sort();
  for (const project of source.projects) {
    const first = visited.find(date => date > project.startedOn && date >= project.dueOn);
    const expected = first && (!project.cancelledOn || project.cancelledOn >= first) ? first : null;
    if (project.completedOn !== expected) fail(`facilities.projects.${project.id}.completedOn`, 'must complete at the first visited calendar boundary after its due date');
  }
}

function validateEmployment(value: unknown, seasonNumber: number, round: number, status: SeasonState['status'], managedClubId: string, datedMarket = false, version = 30, context: CareerPlayerContext & Partial<Pick<SeasonState, 'seed' | 'career' | 'board' | 'relationships'>> & { wagePool?: boolean } = {}): SeasonEmployment {
  // Format 75 ('coaching-3'): player wages may also use the unused staff budget; a basic bound (development mode).
  const pooledStaffRoom = (clubId: string, year: number): number => context.wagePool ? staffAllocationCeiling(context, clubId, year) : 0;
  // Format 88: clubs run automatically may use extra wage room from cash above their reserve; a basic bound (development mode).
  const spending = usesSurplusSpending(context);
  const surplusRoom = (ceiling: number): number => spending ? surplusWageCeiling(ceiling) : 0;
  const fields = record(value, 'employment', ['model', 'enabledSince', 'delegated', 'contracts', 'market', ...(version >= 15 ? ['transfers'] : []), ...(version >= 17 ? ['buyouts'] : []), ...(version >= 55 && value !== null && typeof value === 'object' && Object.hasOwn(value, 'departures') ? ['departures'] : []), ...(version >= TRADES_FORMAT && value !== null && typeof value === 'object' && Object.hasOwn(value, 'trades') ? ['trades'] : [])]);
  // Format 94: completed NBA trades, in worlds with trades only (their shape here; each trade is checked at its first contract).
  const trades = validateTradeRecords(fields.trades, context, seasonNumber, round, status);
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
  const firstRound = number(anchor.round, 'employment.enabledSince.round', 1, firstYear === seasonNumber ? round : seasonRounds(context));
  if (status === 'complete' && seasonNumber < MAX_SEASON_NUMBER) {
    if (!sameData(fields.market, { seasonNumber: seasonNumber + 1 })) fail('employment.market', 'must identify the next season after the final matchday');
  } else if (fields.market !== null) fail('employment.market', 'must be closed during the active season');
  const worldClubs = fullWorldClubs(worldOf(context)), wages = worldOf(context).wages;
  const catalog = worldClubs.flatMap(club => club.players.map(player => ({ player, clubId: club.id })));
  const catalogById = new Map(getCareerPlayers(context, seasonNumber, round).map(player => [player.id, { player }]));
  // Clubs that joined the full world at a season end can hold terms too (step 3.4d-2).
  const exchanges = context.background?.exchanges ?? [];
  const clubIds = [...worldClubs.map(club => club.id), ...exchanges.flatMap(exchange => exchange.joining).filter(id => !worldClubs.some(club => club.id === id))];
  if (fields.contracts.length < catalog.length) fail('employment.contracts', 'must retain each opening employment agreement');
  let previousTransferDate = '';
  const transferPlayers = new Set<string>();
  for (const [index, value] of rawTransfers.entries()) {
    const path = `employment.transfers[${index}]`;
    const raw = record(value, path, ['id', 'offerId', 'playerId', 'fromClubId', 'toClubId', 'seasonNumber', 'completedOn', 'startsSeason', 'fee', 'releasedContractIds', 'contractId', ...(version >= 16 ? ['paymentPlan', 'installments', 'payments'] : []), ...(version >= 19 ? ['startsRound'] : []), ...optionalClauseKeys(value, version, ['mode'])]);
    const transfer = version < 19 ? { ...raw, startsRound: 1 } : raw;
    if (transfer.id !== `employment-transfer-${index + 1}`) fail(`${path}.id`, 'must use sequential transfer identities');
    const year = number(transfer.seasonNumber, `${path}.seasonNumber`, firstYear, seasonNumber);
    const startsRound = number(transfer.startsRound, `${path}.startsRound`, 1, year === seasonNumber ? round : seasonRounds(context)), midseason = startsRound > 1;
    if (midseason ? transfer.startsSeason !== year : year === seasonNumber && status !== 'complete' || transfer.startsSeason !== year + 1 || year >= MAX_SEASON_NUMBER) fail(path, 'must identify its actual current-season or offseason registration boundary');
    if (!catalogById.has(transfer.playerId as string) || !clubIds.includes(transfer.fromClubId as string) || !clubIds.includes(transfer.toClubId as string) || transfer.fromClubId === transfer.toClubId) fail(path, 'must identify a catalog player and two different clubs');
    if (typeof transfer.completedOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(transfer.completedOn) || (midseason ? transfer.completedOn !== dateForRound(startsRound, year) : transfer.completedOn < dateForRound(seasonRounds(context), year) || transfer.completedOn > addMarketDays(dateForRound(seasonRounds(context), year), MARKET_WINDOW_DAYS)) || transfer.completedOn < previousTransferDate || new Date(`${transfer.completedOn}T00:00:00Z`).toISOString().slice(0, 10) !== transfer.completedOn) fail(`${path}.completedOn`, 'must identify a chronological completion date at the legal registration boundary');
    previousTransferDate = transfer.completedOn;
    const playerBoundary = `${year}/${midseason ? 'active' : 'offseason'}/${transfer.playerId}`;
    if (transferPlayers.has(playerBoundary)) fail(path, 'cannot transfer the same player twice in one window');
    transferPlayers.add(playerBoundary);
    if (typeof transfer.offerId !== 'string' || typeof transfer.contractId !== 'string' || !Array.isArray(transfer.releasedContractIds) || !transfer.releasedContractIds.length || transfer.releasedContractIds.some(id => typeof id !== 'string') || new Set(transfer.releasedContractIds).size !== transfer.releasedContractIds.length) fail(path, 'must identify its offer, new contract and distinct released terms');
    const fee = number(transfer.fee, `${path}.fee`, 100_000, maxTransferFee(context));
    if (fee % 100_000 !== 0) fail(`${path}.fee`, 'must use whole thousand-euro steps');
    if (Object.hasOwn(transfer, 'mode') && transfer.mode !== 'release-clause' && !(transfer.mode === 'loan' && version >= 78 && midseason && transfer.paymentPlan === 'upfront')) fail(`${path}.mode`, 'must identify an explicit release-clause transfer');
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
        const paymentRound = number(payment.round, `${paymentPath}.round`, 1, paymentYear === seasonNumber ? round : seasonRounds(context));
        const earliest = dateForRound(paymentRound, paymentYear), latest = paymentRound === seasonRounds(context) ? addMarketDays(earliest, MARKET_WINDOW_DAYS) : earliest;
        if (typeof payment.paidOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(payment.paidOn) || payment.paidOn < earliest || payment.paidOn > latest || payment.paidOn < previousPaidOn || payment.paidOn < expected[installmentIndex]!.dueOn || !Number.isFinite(Date.parse(`${payment.paidOn}T00:00:00Z`)) || new Date(`${payment.paidOn}T00:00:00Z`).toISOString().slice(0, 10) !== payment.paidOn) fail(`${paymentPath}.paidOn`, 'must identify a chronological due payment on its actual calendar boundary');
        const amount = number(payment.amount, `${paymentPath}.amount`, 1, expected[installmentIndex]!.amount - paid[installmentIndex]!);
        if (paid.slice(0, installmentIndex).some((amount, earlier) => amount !== expected[earlier]!.amount)) fail(paymentPath, 'must settle earlier installments first');
        if (paymentIndex === 0 && (installmentIndex !== 0 || amount !== expected[0]!.amount || payment.paidOn !== transfer.completedOn || paymentYear !== year || paymentRound !== (midseason ? startsRound : seasonRounds(context)))) fail(paymentPath, 'must pay the complete first installment when the transfer completes');
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
    if (typeof buyout.completedOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(buyout.completedOn) || buyout.completedOn < dateForRound(seasonRounds(context), year) || buyout.completedOn >= addMarketDays(dateForRound(seasonRounds(context), year), MARKET_WINDOW_DAYS) || buyout.completedOn < previousBuyoutDate || !Number.isFinite(Date.parse(`${buyout.completedOn}T00:00:00Z`)) || new Date(`${buyout.completedOn}T00:00:00Z`).toISOString().slice(0, 10) !== buyout.completedOn) fail(`${path}.completedOn`, 'must retain a chronological offseason date before recruitment closes');
    const contractCountBefore = number(buyout.contractCountBefore, `${path}.contractCountBefore`, previousBuyoutContracts, fields.contracts.length);
    previousBuyoutContracts = contractCountBefore;
    previousBuyoutNegotiations = number(buyout.negotiationCountBefore, `${path}.negotiationCountBefore`, previousBuyoutNegotiations, 20_000);
    previousBuyoutDate = buyout.completedOn;
    const playerBoundary = `${year}/${buyout.clubId}/${buyout.playerId}`;
    if (releasedPlayers.has(playerBoundary)) fail(path, 'cannot release the same player from the same club twice in one window');
    releasedPlayers.add(playerBoundary);
    if (!Array.isArray(buyout.releasedContractIds) || !buyout.releasedContractIds.length || buyout.releasedContractIds.some(id => typeof id !== 'string') || new Set(buyout.releasedContractIds).size !== buyout.releasedContractIds.length) fail(`${path}.releasedContractIds`, 'must identify distinct released agreements');
    number(buyout.amount, `${path}.amount`, 1, maxContractWage(context) * MAX_CONTRACT_SEASONS);
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
    const current = contractForRound(employment, transfer.playerId, transfer.seasonNumber, transfer.startsRound > 1 ? transfer.startsRound : seasonRounds(context));
    if (current?.id !== source.id || source.releaseFee !== transfer.fee || !sameData(transfer.releasedContractIds, [source.id])) fail(path, 'must trigger the active agreement\'s exact release fee without releasing distinct future rights');
    const throughYear = Math.max(source.endsSeason, ...validated.filter(contract => contract.playerId === transfer.playerId).map(contract => contract.endsSeason));
    for (let year = transfer.startsSeason; year <= throughYear; year += 1) {
      const future = year === transfer.seasonNumber ? contractForRound(employment, transfer.playerId, year, transfer.startsRound) : contractForSeason(employment, transfer.playerId, year);
      if (future && future.id !== source.id) fail(path, 'cannot use one release clause to cancel a distinct future agreement');
    }
  };
  // Step 3.4d-2: a club leaving the full world loses its terms from its first season outside, recorded at the rollover.
  if (version >= 55) {
    const expected: EmploymentDeparture[] = [];
    for (const exchange of exchanges.filter(item => item.seasonNumber < seasonNumber)) for (const clubId of exchange.leaving) {
      const signed = (fields.contracts as EmploymentContract[]).filter(contract => contract.signedSeason < exchange.seasonNumber || contract.signedSeason === exchange.seasonNumber && contract.kind !== 'joined');
      expected.push(departureFor({ ...normalized, contracts: signed, departures: [...expected] }, clubId, exchange.seasonNumber));
    }
    if (!sameData(fields.departures ?? [], expected) || Object.hasOwn(fields, 'departures') !== expected.length > 0) fail('employment.departures', 'must end exactly the terms of each club that left the full world');
  }
  let previousBoundary = roundKey(firstYear, firstRound);
  // Incremental checkpoint checks (`trusted-prefix.ts`): agreements signed before the trusted checkpoint's week are
  // unchanged and were checked by it; only their place in the replayed prefix is kept.
  const contractPlan = version === SEASON_SCHEMA_VERSION ? prefixPlan('employment.contracts', fields.contracts as EmploymentContract[], contract => roundKey(contract.signedSeason, contract.signedRound)) : { skip: 0 };
  for (const [index, value] of fields.contracts.entries()) {
    if (index < contractPlan.skip) { const trusted = value as EmploymentContract; previousBoundary = roundKey(trusted.signedSeason, trusted.signedRound); validated.push(trusted); continue; }
    const path = `employment.contracts[${index}]`;
    const raw = record(value, path, ['id', 'playerId', 'clubId', 'startsSeason', 'endsSeason', 'seasonWage', 'signedSeason', 'signedRound', 'kind', ...(version >= 18 ? ['startsRound'] : []), ...optionalClauseKeys(value, version, ['releaseFee']), ...roleKeys(value, context), ...(version >= 92 && value !== null && typeof value === 'object' && Object.hasOwn(value, 'capRoute') ? ['capRoute'] : [])]);
    // Format 92: an NBA club's cap route, on its own signings only.
    if (Object.hasOwn(raw, 'capRoute') && (!NBA_CAP_ROUTES.includes(raw.capRoute as NbaCapRoute) || !isCapClub(context, raw.clubId as string) || raw.kind === 'initial' || raw.kind === 'joined')) fail(`employment.contracts[${index}].capRoute`, 'must name the cap route of an NBA club\'s signing');
    const entry = version < 18 ? { ...raw, startsRound: 1 } : raw;
    if (entry.id !== `employment-contract-${index + 1}`) fail(`${path}.id`, 'must use sequential contract identities');
    const player = catalogById.get(entry.playerId as string)?.player;
    if (!player) fail(`${path}.playerId`, 'must identify a player in the stable catalog');
    if (!clubIds.includes(entry.clubId as string)) fail(`${path}.clubId`, 'must identify a club in this league');
    const signedSeason = number(entry.signedSeason, `${path}.signedSeason`, firstYear, seasonNumber);
    const signedRound = number(entry.signedRound, `${path}.signedRound`, 1, signedSeason === seasonNumber ? round : seasonRounds(context));
    const boundary = roundKey(signedSeason, signedRound);
    if (boundary < previousBoundary) fail(path, 'must retain chronological signing order');
    previousBoundary = boundary;
    const startsSeason = number(entry.startsSeason, `${path}.startsSeason`, firstYear, Math.min(MAX_SEASON_NUMBER, seasonNumber + 1));
    const endsSeason = number(entry.endsSeason, `${path}.endsSeason`, startsSeason, Math.min(MAX_SEASON_NUMBER, startsSeason + MAX_CONTRACT_SEASONS - 1));
    const startsRound = number(entry.startsRound, `${path}.startsRound`, 1, seasonRounds(context));
    const midseason = entry.kind === 'midseason' || entry.kind === 'midseason-transfer', traded = entry.kind === 'trade' && version >= TRADES_FORMAT;
    if (!midseason && !traded && startsRound !== 1) fail(`${path}.startsRound`, 'must preserve opening-day registration for ordinary contracts');
    validateOptionalRole(entry, path);
    // relationships-3: a smaller role offered lowers the player's demand (`SQUAD_ROLE_RULES.contracts`).
    // Format 92: an NBA signing may be a late free agent's minimum salary (`nbaLateFreeAgentMinimum`), never below the rookie minimum.
    // Format 93: a player paid on the NBA's scale may sign with a European club for a European wage (`nba-moves.ts`); the
    // negotiation replay checks his exact demand, so only the contract minimum bounds it here.
    const usualWage = roleWage(getCareerWage(context, player.id), entry.role as EmploymentContract['role'], context);
    const lowestWage = usesNbaMoves(context) && isNbaPaidPlayer(worldOf(context), player.id) && !isCapClub(context, entry.clubId as string) ? MIN_CONTRACT_WAGE : usualWage;
    // Format 94: a traded term keeps its wage exactly (checked against the released term below).
    const seasonWage = number(entry.seasonWage, `${path}.seasonWage`, traded ? 0 : Object.hasOwn(entry, 'capRoute') ? Math.min(NBA_LOWEST_MINIMUM, usualWage) : lowestWage, maxContractWage(context));
    if (seasonWage % WAGE_STEP !== 0) fail(`${path}.seasonWage`, 'must use supported wage increments');
    validateOptionalReleaseFee(entry, path, context);
    if (index < catalog.length) {
      if (Object.hasOwn(entry, 'releaseFee') || Object.hasOwn(entry, 'role')) fail(`${path}.releaseFee`, 'cannot add an unnegotiated clause or role to the opening contract');
      const expected = catalog[index]!;
      if (entry.kind !== 'initial' || entry.playerId !== expected.player.id || entry.clubId !== expected.clubId || startsSeason !== firstYear || endsSeason !== firstYear + (worldOf(context).playerContracts?.[player.id] ?? 1) - 1 || signedSeason !== firstYear || signedRound !== firstRound || seasonWage !== wages[player.id]) fail(path, 'must preserve the opening squad and initial terms at activation');
    } else {
      if (!midseason && !traded && startsSeason !== signedSeason + 1) fail(`${path}.startsSeason`, 'must start in the season following the signing');
      const current = contractForRound(prefixEmployment(), player.id, signedSeason, signedRound);
      if (traded) {
        // Format 94: a traded player's term carried on unchanged; the whole trade is checked at its first contract.
        const trade = trades.find(item => item.moves.some(move => move.contractIds.includes(entry.id as string)));
        if (!trade) fail(path, 'must belong to a completed trade');
        if (trade.moves[0]!.contractIds[0] === entry.id) validateTradeAt(trade, prefixEmployment(), fields.contracts as EmploymentContract[], index, context, path);
      } else if (entry.kind === 'midseason' && version >= 18) {
        if (current || startsSeason !== signedSeason || endsSeason !== signedSeason || startsRound !== signedRound || signedRound < 2) fail(path, 'must register a previously uncontracted player for the remaining current season at the reply boundary');
      } else if (entry.kind === 'midseason-transfer' && version >= 19) {
        const transfer = (transfers as EmploymentTransfer[]).find(item => item.contractId === entry.id);
        if (!current || !transfer || current.clubId !== transfer.fromClubId || transfer.toClubId !== entry.clubId || transfer.playerId !== player.id || startsSeason !== signedSeason || startsRound !== signedRound || signedRound < 2 || transfer.startsRound !== startsRound || transfer.startsSeason !== startsSeason || transfer.seasonNumber !== signedSeason) fail(path, 'must link the current employer, buyer and exact in-season arrival boundary');
        const released = validated.filter(contract => contract.playerId === player.id && contract.clubId === current.clubId && Array.from({ length: Math.max(0, contract.endsSeason - startsSeason + 1) }, (_, offset) => startsSeason + offset).some(year => (year === startsSeason ? contractForRound(prefixEmployment(), player.id, year, startsRound) : contractForSeason(prefixEmployment(), player.id, year))?.id === contract.id));
        if (!sameData(transfer.releasedContractIds, released.map(contract => contract.id))) fail(path, 'must release exactly the selling club\'s effective current and future terms');
        validateClauseTrigger(transfer, current, path);
      } else if (entry.kind === 'joined' && version >= 55) {
        // A joining club's opening terms, written at the rollover after the season whose end decided the exchange.
        const exchange = exchanges.find(item => item.seasonNumber === signedSeason && item.joining.includes(entry.clubId as string));
        if (!exchange || signedSeason >= seasonNumber || signedRound !== seasonRounds(context)) fail(path, 'must open the squad of a club that joined the full world at an earlier season end');
        const firstIndex = (fields.contracts as EmploymentContract[]).findIndex(contract => contract.kind === 'joined' && contract.signedSeason === signedSeason && exchange!.joining.includes(contract.clubId));
        const expected = joinedContracts({ ...context, seed: context.seed ?? 0, seasonNumber: signedSeason }, exchange!, firstIndex + 1, dateForRound(1, signedSeason + 1));
        if (!sameData(expected[index - firstIndex], entry)) fail(path, 'must give the joining squad its estimated opening terms');
      } else if (entry.kind === 'renewal') {
        if (!current || current.clubId !== entry.clubId || current.endsSeason !== signedSeason) fail(path, 'must renew an expiring agreement at the same club');
      } else if (entry.kind === 'free-agent') {
        if (signedRound !== seasonRounds(context) || signedSeason === seasonNumber && status !== 'complete') fail(path, 'must be signed during a completed season\'s recruitment window');
        const releasedFuture = current && [...prefixEmployment().transfers, ...prefixEmployment().buyouts].some(release => release.startsSeason === signedSeason + 1 && release.releasedContractIds.includes(current.id));
        if (current && current.clubId === entry.clubId && (current.endsSeason === signedSeason || !releasedFuture)) fail(path, 'must record an ordinary same-club extension as a renewal');
      } else if (entry.kind === 'transfer' && version >= 15) {
        const transfer = (transfers as EmploymentTransfer[]).find(item => item.contractId === entry.id);
        if (!transfer || transfer.playerId !== player.id || transfer.toClubId !== entry.clubId || transfer.seasonNumber !== signedSeason || signedRound !== seasonRounds(context) || transfer.startsSeason !== startsSeason) fail(path, 'must link the transferred player and buying club to a completed offseason transfer');
        const source = contractForSeason(prefixEmployment(), player.id, startsSeason);
        const released = validated.filter(contract => contract.playerId === player.id && contract.clubId === transfer.fromClubId && contract.endsSeason >= startsSeason && ![...prefixEmployment().transfers, ...prefixEmployment().buyouts].some(previous => previous.releasedContractIds.includes(contract.id)));
        if (!source || source.clubId !== transfer.fromClubId || !sameData(transfer.releasedContractIds, released.map(contract => contract.id))) fail(path, 'must release exactly the effective future terms of the selling club');
        validateClauseTrigger(transfer, source, path);
      } else fail(`${path}.kind`, 'must identify an initial agreement, renewal, free-agent signing, transfer or trade');
    }
    if (Array.from({ length: endsSeason - startsSeason + 1 }, (_, offset) => startsSeason + offset).some(year => Array.from({ length: seasonRounds(context) }, (_, offset) => offset + 1).some(round => effectiveContractsForRound(prefixEmployment(entry as unknown as EmploymentContract), year, round).filter(contract => contract.playerId === player.id).length > 1))) fail(path, 'overlaps another effective employment agreement for this player');
    const contract = entry as unknown as EmploymentContract;
    validated.push(contract);
    // A joining club's opening squad is not bought within a budget, like the career's opening contracts.
    // Format 94: a trade's salary matching replaces the club's wage budget; its squad limits are checked with the trade.
    if (index >= catalog.length && entry.kind !== 'joined' && !traded) for (let year = startsSeason; year <= endsSeason; year += 1) {
      const annual = effectiveContractsForSeason(prefixEmployment(undefined, index), year).filter(contract => contract.clubId === entry.clubId);
      const wages = annual.reduce((sum, contract) => sum + contract.seasonWage, 0);
      // Format 72: the budget known at signing; format 70: the highest budget a board verdict could allow.
      // Format 92: an NBA club's minimum contracts it needs for its 13 players fit whatever its owner's ceiling (as the guard allows).
      if (entry.capRoute === 'minimum' && annual.length <= minRosterSize(context, entry.clubId as string)) { if (annual.length > clubRosterLimit(context, entry.clubId as string)) fail(path, 'must fit the club\'s squad limit'); continue; }
      if (annual.length > clubRosterLimit(context, entry.clubId as string) || wages + Math.max(0, MIN_ROSTER_SIZE - annual.length) * lowestMinimumSquadWage(context, entry.clubId as string, year) > Math.max(clubSalaryBudget(context, entry.clubId as string, year, signedSeason), seasonSalaryCeiling(context, entry.clubId as string, year)) + pooledStaffRoom(entry.clubId as string, year) + surplusRoom(Math.max(clubSalaryBudget(context, entry.clubId as string, year, signedSeason), seasonSalaryCeiling(context, entry.clubId as string, year)))) fail(path, 'exceeds the roster limit or annual wage allocation including minimum-squad reserves');
    }
  }
  const employment = normalized;
  if (trades.some(trade => trade.moves.some(move => move.contractIds.some(id => !validated.some(contract => contract.id === id && contract.kind === 'trade'))))) fail('employment.trades', 'must link every traded term to one retained trade contract');
  if ((transfers as EmploymentTransfer[]).some(transfer => !validated.some(contract => contract.id === transfer.contractId && contract.kind === (transfer.startsRound > 1 ? 'midseason-transfer' : 'transfer')))) fail('employment.transfers', 'must link every transfer to one retained transfer contract');
  // Each season's own full-world clubs (step 3.4d-2): clubs outside the full world that season hold no registrations.
  // Registration rounds before the trusted checkpoint's week were checked by it; no later agreement or release reaches them.
  const checkedBefore = trustedCutKey();
  for (let year = firstYear; year <= seasonNumber; year += 1) for (const clubId of fullWorldClubsIn(context, year).map(club => club.id)) {
    if (roundKey(year, year === seasonNumber ? round : seasonRounds(context)) < checkedBefore) continue;
    // Format 72: agreed wages stay when a club's allocation falls, so registrations meet its highest allocation for the season.
    const ceiling = clubSalaryCeiling(context, clubId, year);
    for (let at = 1; at <= (year === seasonNumber ? round : seasonRounds(context)); at += 1) {
      if (roundKey(year, at) < checkedBefore) continue;
      const registrations = effectiveContractsForRound(employment, year, at).filter(contract => contract.clubId === clubId);
      // Format 92: an NBA club's payroll follows the cap rules (opening payrolls may stand above the owner's ceiling).
      if (registrations.length < MIN_ROSTER_SIZE || registrations.length > clubRosterLimit(context, clubId) || !isCapClub(context, clubId) && registrations.reduce((sum, contract) => sum + contract.seasonWage, 0) > Math.max(ceiling, seasonSalaryCeiling(context, clubId, year)) + pooledStaffRoom(clubId, year) + surplusRoom(Math.max(ceiling, seasonSalaryCeiling(context, clubId, year)))) fail('employment.contracts', 'must retain a legal squad and salary allocation at every registration boundary');
    }
  }
  // Clubs leaving the full world sit out the window; joining clubs' squads sign at the rollover (step 3.4d-2).
  if (!datedMarket && status === 'complete' && seasonNumber < MAX_SEASON_NUMBER) for (const clubId of fullWorldClubsIn(context, seasonNumber).map(club => club.id)) {
    if (clubId === managedClubId && !employment.delegated || exchanges.some(exchange => exchange.seasonNumber === seasonNumber && exchange.leaving.includes(clubId))) continue;
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
  const firstRound = number(anchor.round, 'market.enabledSince.round', 1, firstYear === state.seasonNumber ? state.round : seasonRounds(state));
  const contractCount = number(anchor.contractCount, 'market.enabledSince.contractCount', 0, state.employment.contracts.length);
  const negotiation = record(state.negotiations, 'negotiations', ['model', 'enabledSince', 'records']);
  if (!Array.isArray(negotiation.records)) fail('negotiations.records', 'must contain the response journal');
  const negotiationAnchor = record(negotiation.enabledSince, 'negotiations.enabledSince', ['seasonNumber', 'round', 'contractCount']);
  const negotiationCount = number(anchor.negotiationCount, 'market.enabledSince.negotiationCount', 0, negotiation.records.length);
  const firstBoundary = roundKey(firstYear, firstRound);
  if ((state.employment.buyouts ?? []).some(buyout => buyout.seasonNumber < firstYear)) fail('employment.buyouts', 'cannot precede the first retained recruitment window');
  if ((state.employment.transfers ?? []).some(transfer => transfer.startsRound === 1 && transfer.seasonNumber < firstYear)) fail('employment.transfers', 'cannot precede the first retained offseason recruitment window');
  if (!state.employment.enabledSince || !state.payroll.enabledSince || !state.finance.enabledSince || !state.negotiations.enabledSince || roundKey(state.negotiations.enabledSince.seasonNumber, state.negotiations.enabledSince.round) > firstBoundary) fail('market.enabledSince', 'requires contracts, finances, payroll and negotiations active before market activation');
  const baselineContracts = number(negotiationAnchor.contractCount, 'negotiations.enabledSince.contractCount', 0, state.employment.contracts.length);
  const records = state.negotiations.records;
  const activationRecords = records.slice(0, negotiationCount);
  if (contractCount !== baselineContracts + activationRecords.filter(entry => entry.outcome === 'accepted').length + joinedIn(state.employment?.contracts, contractCount)) fail('market.enabledSince.contractCount', 'must identify the agreements present at the recorded response boundary');
  for (const [index, entry] of records.entries()) {
    const boundary = roundKey(entry.seasonNumber, entry.round);
    if (index < negotiationCount ? boundary > firstBoundary : boundary < firstBoundary) fail('market.enabledSince.negotiationCount', 'must identify the response journal present at activation');
  }
  const lastCompleted = Math.min(MAX_SEASON_NUMBER - 1, state.status === 'complete' ? state.seasonNumber : state.seasonNumber - 1);
  const count = Math.max(0, lastCompleted - firstYear + 1);
  if (fields.windows.length !== count) fail('market.windows', 'must retain every recruitment window since activation');
  const windows: MarketWindow[] = [];
  let eventCount = 0;
  // Incremental checkpoint checks (`trusted-prefix.ts`): windows of seasons before the trusted checkpoint's are unchanged
  // and were replayed by its check; resume with the windows, command count and facility snapshots it reached.
  const plan = version === SEASON_SCHEMA_VERSION ? prefixPlan('market.windows', fields.windows as MarketWindow[], window => roundKey(window.seasonNumber, 99)) : { skip: 0, record: -1 };
  const resume = plan.skip > 0 ? recall<{ windows: MarketWindow[]; eventCount: number; snapshots: MarketReplaySnapshot[] }>('market.windows', 'replay') : undefined;
  if (resume) { windows.push(...resume.windows); eventCount = resume.eventCount; snapshots.push(...resume.snapshots); }
  const rememberReplay = () => remember('market.windows', 'replay', { windows: windows.slice(), eventCount, snapshots: snapshots.slice() });
  for (const [index, raw] of fields.windows.entries()) {
    if (resume && index < plan.skip) continue;
    if (index === plan.record) rememberReplay();
    const path = `market.windows[${index}]`;
    const window = record(raw, path, ['seasonNumber', 'openedOn', 'closesOn', 'date', 'contractCountBefore', 'negotiationCountBefore', 'closed', 'events', 'offers', ...(version >= 14 ? ['competitionFromEvent'] : [])]);
    const year = firstYear + index, openedOn = dateForRound(seasonRounds(state), year), closesOn = addMarketDays(openedOn, MARKET_WINDOW_DAYS);
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
    // Opening terms of clubs that joined at an earlier season end come before the window too (step 3.4d-2).
    // Format 94: trades before the window too (in-season trades of this season; offseason trades complete at the season change, after it).
    const expectedContractCount = baselineContracts + beforeRecords.filter(entry => entry.outcome === 'accepted').length + state.employment.contracts.filter(contract => contract.kind === 'joined' && contract.signedSeason < year || contract.kind === 'trade' && (contract.signedSeason < year || contract.signedSeason === year && contract.signedRound < seasonRounds(state))).length;
    if (window.negotiationCountBefore !== expectedNegotiationCount || window.contractCountBefore !== expectedContractCount) fail(path, 'must anchor the exact agreements and responses already present before the window');
    const beforeTransfers = (state.employment.transfers ?? []).filter(transfer => transfer.seasonNumber < year || transfer.seasonNumber === year && transfer.startsRound > 1);
    const beforeBuyouts = (state.employment.buyouts ?? []).filter(buyout => buyout.seasonNumber < year);
    // Transfer payments and buyout settlements can book cash during recruitment. Later seasons and this
    // window's fees must not finance earlier proposals while replaying history.
    const beforePaymentIds = new Set(beforeTransfers.flatMap(transfer => transfer.payments.filter(payment => payment.paidOn <= openedOn).map(payment => payment.id)));
    const previousMarketEvents = windows.reduce((sum, item) => sum + item.events.length, 0);
    const beforeLedger = state.finance.ledger.filter(entry => (entry.seasonNumber < year || entry.seasonNumber === year && (entry.kind !== 'buyout' && (entry.kind !== 'transfer' || beforePaymentIds.has(entry.sourceId)))) && (facilityCommandOf(entry, state.facilities) === null || state.facilities.events[facilityCommandOf(entry, state.facilities)!]!.marketEventCount <= previousMarketEvents));
    if (!sameData(beforeLedger, financeLedgerSlice(state.finance, 0, beforeLedger.length))) fail(path, 'must open after a contiguous financial history, before the transfer fees for this window');
    const employment = { ...state.employment, contracts: state.employment.contracts.slice(0, expectedContractCount), transfers: beforeTransfers.map(transfer => ({ ...transfer, payments: transfer.payments.filter(payment => beforePaymentIds.has(payment.id)) })), buyouts: beforeBuyouts, market: { seasonNumber: year + 1 } };
    const initialWindow: MarketWindow = { seasonNumber: year, openedOn, closesOn, date: openedOn, contractCountBefore: expectedContractCount, negotiationCountBefore: expectedNegotiationCount, closed: false, competitionFromEvent, events: [], offers: [] };
    let replay: SeasonState = {
      ...state, managedClubId: managedClubFor(state, year, true), academy: academyAtBoundary(state.academy, year, seasonRounds(state), expectedContractCount), lifecycle: lifecycleAtBoundary(state.lifecycle, year, seasonRounds(state), expectedContractCount, state.recruitment.events.filter(event => event.seasonNumber <= year).length, windows.reduce((sum, item) => sum + item.events.length, 0), beforeLedger.length, expectedNegotiationCount), seasonNumber: year, round: seasonRounds(state), status: 'complete', date: openedOn, employment,
      negotiations: { ...state.negotiations, records: beforeRecords },
      market: { model: 'market-1', enabledSince: { seasonNumber: firstYear, round: firstRound, contractCount, negotiationCount }, windows: [...windows, initialWindow] },
      conditions: { ...state.conditions },
      finance: financeAtLedgerBoundary(state.finance, beforeLedger.length), recruitment: createRecruitment(),
    };
    replay.clubs = getContractedClubs(replay, year);
    const synchronizeFacilities = (count: number, date: string) => {
      // Facilities are independent commands between market decisions. Only their exact paid prefix
      // may enter the next offer quote; later construction cannot finance or cancel an earlier bid.
      while (true) {
        const entry = financeLedgerEntry(state.finance, financeLedgerCount(replay.finance));
        // Board capital precedes the upgrade it funds and follows the same project boundary; a bank loan (format 74)
        // follows its own command.
        const command = entry ? facilityCommandOf(entry, state.facilities) : null;
        if (!entry || command === null) break;
        const event = state.facilities.events[command];
        if (!event || event.seasonNumber !== year || event.marketEventCount > count || event.date > date || event.contractCount > replay.employment.contracts.length || event.negotiationCount > replay.negotiations.records.length) break;
        const { id, ...charge } = entry;
        const finance = appendFinanceLedgerEntry(replay.finance, charge);
        if (financeLedgerEntry(finance, financeLedgerCount(finance) - 1)!.id !== id) fail(path, 'must retain the exact sequential identity at this facility payment boundary');
        replay = { ...replay, finance };
      }
      replay.facilities = facilitiesAtPrefix(state, date, financeLedgerCount(replay.finance), replay.employment.contracts.length, replay.negotiations.records.length, state.recruitment.events.filter(event => event.seasonNumber <= year).length, count);
      snapshots.push({ eventCount: count, seasonNumber: year, market: replay.market });
    };
    synchronizeFacilities(previousMarketEvents, openedOn);
    for (const [eventIndex, rawEvent] of window.events.entries()) {
      if (competitionFromEvent === eventIndex && replay.market.windows.at(-1)!.offers.some(isLiveMarketOffer)) fail(`${path}.competitionFromEvent`, 'must begin after all earlier single-offer proposals have resolved');
      const eventPath = `${path}.events[${eventIndex}]`;
      if (!rawEvent || typeof rawEvent !== 'object' || Array.isArray(rawEvent)) fail(eventPath, 'must be a supported market command');
      const type = (rawEvent as Record<string, unknown>).type;
      const event = record(rawEvent, eventPath, type === 'offer' ? ['type', 'id', 'date', 'clubId', 'playerId', 'seasonWage', 'seasons', ...(version >= 15 && Object.hasOwn(rawEvent, 'transferFee') ? ['transferFee'] : []), ...(version >= 16 && Object.hasOwn(rawEvent, 'transferPaymentPlan') ? ['transferPaymentPlan'] : []), ...optionalClauseKeys(rawEvent, version, ['releaseFee', 'transferMode']), ...roleKeys(rawEvent, state)] : type === 'withdraw' ? ['type', 'date', 'offerId'] : type === 'advance' ? ['type', 'date'] : version >= 15 && type === 'club-decision' ? ['type', 'date', 'offerId', 'response'] : version >= 17 && type === 'buyout' ? ['type', 'id', 'date', 'clubId', 'playerId'] : []);
      if (!validDate(event.date, openedOn, closesOn)) fail(`${eventPath}.date`, 'must be a real date inside the recruitment window');
      if (type === 'offer') {
        if (typeof event.id !== 'string' || typeof event.clubId !== 'string' || typeof event.playerId !== 'string') fail(eventPath, 'must identify an offer, player and club');
        number(event.seasonWage, `${eventPath}.seasonWage`, MIN_CONTRACT_WAGE, maxContractWage(state));
        number(event.seasons, `${eventPath}.seasons`, 1, MAX_CONTRACT_SEASONS);
        validateOptionalReleaseFee(event, eventPath, state);
        validateOptionalRole(event, eventPath);
        validateTransferMode(event, eventPath);
        if (Object.hasOwn(event, 'transferFee')) { const fee = number(event.transferFee, `${eventPath}.transferFee`, 100_000, maxTransferFee(state)); if (fee % 100_000) fail(`${eventPath}.transferFee`, 'must use thousand-euro steps'); }
        if (Object.hasOwn(event, 'transferPaymentPlan') && (!Object.hasOwn(event, 'transferFee') || !['upfront', 'two-payments', 'three-payments'].includes(event.transferPaymentPlan as string))) fail(`${eventPath}.transferPaymentPlan`, 'must identify a supported plan on a paid transfer offer');
      } else if (type === 'club-decision' && (typeof event.offerId !== 'string' || !['accept', 'reject', 'counter'].includes(event.response as string))) fail(eventPath, 'must identify a pending club decision and supported response');
      else if (type === 'buyout' && (typeof event.id !== 'string' || typeof event.clubId !== 'string' || typeof event.playerId !== 'string')) fail(eventPath, 'must identify the release, player and club');
      else if (type === 'withdraw' && typeof event.offerId !== 'string') fail(`${eventPath}.offerId`, 'must identify a live proposal');
      synchronizeFacilities(previousMarketEvents + eventIndex, event.date as string);
      replay.lifecycle = lifecycleAtBoundary(state.lifecycle, year, seasonRounds(state), replay.employment.contracts.length, state.recruitment.events.filter(event => event.seasonNumber <= year).length, windows.reduce((sum, item) => sum + item.events.length, 0) + eventIndex, financeLedgerCount(replay.finance), replay.negotiations.records.length);
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
    // Wage-pool careers (format 75): a selling club's wage budget includes the staff budget its staff left unused, and a
    // past season's staff are not kept, so the replay cannot tell whether a refused sale was refused for want of wages
    // budget. Such a refusal's recorded reason is accepted as it is (the decision, a refusal, is replayed exactly).
    const comparableWindow = usesWagePool({ coaching: state.coaching as { model: string } | undefined }) ? withRecordedSellerReasons(legacyComparable as unknown as MarketWindow, window as unknown as MarketWindow) : legacyComparable;
    if (!sameData(comparableWindow, window)) fail(path, 'does not match its replayed dates, deadlines, statuses, player choices and offer reservations');
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
        // A club leaving the full world sat out the window (step 3.4d-2).
        if ((state.background?.exchanges ?? []).some(exchange => exchange.seasonNumber === year && exchange.leaving.includes(club.id))) continue;
        const retained = effectiveContractsForSeason(replay.employment, year + 1).filter(contract => contract.clubId === club.id);
        if (retained.length < MIN_ROSTER_SIZE) fail(path, 'must finish recruitment for every club before rollover');
      }
    }
    windows.push(comparable);
  }
  if (plan.record === fields.windows.length) rememberReplay();
  return fields as unknown as SeasonMarket;
}

interface RecruitmentHolds { eventCount: number; ledgerIndex: number; seasonNumber: number; round: number; negotiationCount: number; offers: SeasonRecruitment['offers']; amounts: Record<string, number> }

function migrateRecruitmentTransfers(recruitment: SeasonRecruitment): SeasonRecruitment {
  return { ...recruitment, transfersEnabledSince: null, offers: recruitment.offers.map(offer => ({ ...offer, seasons: 1, transfer: null })) };
}

/** Format 78: the manager's transfer and loan list (basic shape check; listings change no agreement). */
function validateListings(value: unknown, state: SeasonState): void {
  if (!Array.isArray(value) || value.length > 500) fail('recruitment.listings', 'must hold a bounded list');
  const clubIds = new Set(state.clubs.map(club => club.id)), seen = new Set<string>();
  for (const [index, raw] of value.entries()) {
    const path = `recruitment.listings[${index}]`, listing = record(raw, path, ['clubId', 'playerId', 'transfer', 'loan', 'askingFee', 'listedOn']);
    if (typeof listing.clubId !== 'string' || !clubIds.has(listing.clubId) || typeof listing.playerId !== 'string' || seen.has(`${listing.clubId}:${listing.playerId}`)) fail(path, 'must identify one player of a club once');
    seen.add(`${listing.clubId}:${listing.playerId}`);
    if (typeof listing.transfer !== 'boolean' || typeof listing.loan !== 'boolean' || !listing.transfer && !listing.loan) fail(path, 'must list the player for a transfer, a loan or both');
    const fee = number(listing.askingFee, `${path}.askingFee`, 100_000, maxTransferFee(state));
    if (fee % 100_000) fail(`${path}.askingFee`, 'must use whole thousand-euro steps');
    if (typeof listing.listedOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(listing.listedOn) || listing.listedOn > state.date || !Number.isFinite(Date.parse(`${listing.listedOn}T00:00:00Z`))) fail(`${path}.listedOn`, 'must be a real date up to today');
  }
}

/** Commands are replayed against the exact cash and ownership prefix available when issued. */
function validateRecruitment(value: unknown, state: SeasonState, version: number): RecruitmentHolds[] {
  // Format 78 (`recruitment-2`): the transfer and loan list, bids for the manager's players and loans.
  const listed = value !== null && typeof value === 'object' && (value as Record<string, unknown>).model === 'recruitment-2';
  if (listed && version < 78) fail('recruitment.model', 'requires format 78 or later');
  const original = record(value, 'recruitment', ['model', 'enabledSince', 'events', 'offers', ...(version >= 19 ? ['transfersEnabledSince'] : []), ...(listed ? ['listings'] : [])]);
  const fields = version >= 19 ? original : { ...original, transfersEnabledSince: null, offers: Array.isArray(original.offers) ? original.offers.map(offer => ({ ...offer, seasons: 1, transfer: null })) : original.offers };
  if (listed) validateListings(original.listings, state);
  if (fields.model !== 'recruitment-1' && !listed || !Array.isArray(fields.events) || fields.events.length > 20_000 || !Array.isArray(fields.offers) || fields.offers.length > fields.events.length) fail('recruitment', 'must retain a supported bounded command journal');
  if (fields.enabledSince === null) {
    if (!sameData(listed ? { ...fields, model: 'recruitment-1', listings: undefined } : fields, { ...createRecruitment(), ...(listed ? { listings: undefined } : {}) }) || state.employment.contracts.some(contract => contract.kind === 'midseason' || contract.kind === 'midseason-transfer')) fail('recruitment', 'must retain no in-season commands or agreements while disabled');
    return [];
  }
  const anchor = record(fields.enabledSince, 'recruitment.enabledSince', ['seasonNumber', 'round', 'ledgerIndex', 'contractCount', 'negotiationCount']);
  const firstYear = number(anchor.seasonNumber, 'recruitment.enabledSince.seasonNumber', 1, state.seasonNumber);
  const firstRound = number(anchor.round, 'recruitment.enabledSince.round', 1, firstYear === state.seasonNumber ? state.round : seasonRounds(state));
  const firstBoundary = roundOrdinal(firstYear, firstRound, seasonRounds(state));
  const lastBoundary = roundOrdinal(state.seasonNumber, state.round, seasonRounds(state));
  const anchorLedger = number(anchor.ledgerIndex, 'recruitment.enabledSince.ledgerIndex', 0, financeLedgerCount(state.finance));
  const anchorContracts = number(anchor.contractCount, 'recruitment.enabledSince.contractCount', 0, state.employment.contracts.length);
  const anchorNegotiations = number(anchor.negotiationCount, 'recruitment.enabledSince.negotiationCount', 0, state.negotiations.records.length);
  if (!state.employment.enabledSince || !state.finance.enabledSince || !state.payroll.enabledSince || !state.negotiations.enabledSince || [state.employment.enabledSince, state.finance.enabledSince, state.payroll.enabledSince, state.negotiations.enabledSince].some(item => roundOrdinal(item.seasonNumber, item.round, seasonRounds(state)) > firstBoundary)) fail('recruitment.enabledSince', 'requires employment, finance, payroll and negotiations already active');
  const baselineContracts = state.negotiations.enabledSince.contractCount;
  const verifyPrefix = (year: number, round: number, ledgerIndex: number, contractCount: number, negotiationCount: number, path: string) => {
    const boundary = roundOrdinal(year, round, seasonRounds(state));
    if (contractCount !== baselineContracts + state.negotiations.records.slice(0, negotiationCount).filter(entry => entry.outcome === 'accepted').length + joinedIn(state.employment?.contracts, contractCount)) fail(path, 'must anchor exactly the contracts explained by the recorded response prefix');
    for (const [index, entry] of state.finance.ledger.entries()) {
      const entryBoundary = roundOrdinal(entry.seasonNumber, entry.round, seasonRounds(state));
      if (index < ledgerIndex ? entryBoundary > boundary : entryBoundary < boundary) fail(path, 'must identify a contiguous cash prefix on this matchday');
    }
    for (const [index, entry] of state.negotiations.records.entries()) {
      const entryBoundary = roundOrdinal(entry.seasonNumber, entry.round, seasonRounds(state));
      if (index < negotiationCount ? entryBoundary > boundary || entry.seasonNumber === year && entry.round === round && entry.status === 'complete' : entryBoundary < boundary) fail(path, 'must identify the chronological active-season response prefix');
    }
  };
  verifyPrefix(firstYear, firstRound, anchorLedger, anchorContracts, anchorNegotiations, 'recruitment.enabledSince');
  for (const [index, raw] of (original.offers as unknown[]).entries()) {
    const offer = record(raw, `recruitment.offers[${index}]`, ['id', 'clubId', 'playerId', 'seasonNumber', 'offeredRound', 'responseRound', 'offeredOn', 'responseOn', 'seasonWage', 'remainingWages', 'status', 'respondedOn', 'closedOn', 'negotiationId', 'chosenOfferId', 'reason', ...(version >= 19 ? ['seasons', 'transfer'] : []), ...optionalClauseKeys(raw, version, ['releaseFee']), ...roleKeys(raw, state), ...(version >= 25 && Object.hasOwn(raw as object, 'academyProspectId') ? ['academyProspectId'] : [])]);
    validateOptionalRole(offer, `recruitment.offers[${index}]`);
    if (version >= 19 && offer.transfer !== null) record(offer.transfer, `recruitment.offers[${index}].transfer`, ['sellerClubId', 'contractId', 'fee', 'paymentPlan', 'requiredFee', 'clubStatus', 'clubResponseOn', 'clubRespondedOn', 'clubReason', 'counterFee', ...optionalClauseKeys(offer.transfer, version, ['mode'])]);
  }
  if (fields.transfersEnabledSince !== null) record(fields.transfersEnabledSince, 'recruitment.transfersEnabledSince', ['seasonNumber', 'round', 'ledgerIndex', 'contractCount', 'negotiationCount']);
  let recruitment: SeasonRecruitment = { model: listed ? 'recruitment-2' : 'recruitment-1', ...(listed ? { listings: original.listings as SeasonRecruitment['listings'] } : {}), enabledSince: { seasonNumber: firstYear, round: firstRound, ledgerIndex: anchorLedger, contractCount: anchorContracts, negotiationCount: anchorNegotiations }, transfersEnabledSince: null, events: [], offers: [] };
  let boundary = firstBoundary, previousLedger = anchorLedger, previousContracts = anchorContracts, previousNegotiations = anchorNegotiations;
  let holds: RecruitmentHolds[] = [];
  const generatedContracts = new Set<string>(), generatedResponses = new Set<string>(), generatedTransfers = new Set<string>();
  const knownAt = knownAtBoundaries(state);
  // Incremental checkpoint checks (`trusted-prefix.ts`): resume the command replay (journal, holds and generated records)
  // where the trusted checkpoint's check reached its week; later commands replay against contexts rebuilt from this state.
  interface Resume { recruitment: SeasonRecruitment; boundary: number; previousLedger: number; previousContracts: number; previousNegotiations: number; holds: RecruitmentHolds[]; contracts: string[]; responses: string[]; transfers: string[] }
  const plan = version === SEASON_SCHEMA_VERSION ? prefixPlan('recruitment.events', fields.events as InSeasonEvent[], event => roundKey(event.seasonNumber, event.round)) : { skip: 0, record: -1 };
  const resume = plan.skip > 0 ? recall<Resume>('recruitment.events', 'replay') : undefined;
  if (resume) {
    ({ recruitment, boundary, previousLedger, previousContracts, previousNegotiations } = resume);
    holds = resume.holds.slice();
    for (const id of resume.contracts) generatedContracts.add(id);
    for (const id of resume.responses) generatedResponses.add(id);
    for (const id of resume.transfers) generatedTransfers.add(id);
  }
  const rememberReplay = () => remember('recruitment.events', 'replay', { recruitment, boundary, previousLedger, previousContracts, previousNegotiations, holds: holds.slice(), contracts: [...generatedContracts], responses: [...generatedResponses], transfers: [...generatedTransfers] } satisfies Resume);
  for (const [index, raw] of fields.events.entries()) {
    if (resume && index < plan.skip) continue;
    if (index === plan.record) rememberReplay();
    const path = `recruitment.events[${index}]`;
    const type = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).type : undefined;
    const event = record(raw, path, ['type', 'seasonNumber', 'round', 'date', 'ledgerIndexBefore', 'contractCountBefore', 'negotiationCountBefore', ...(type === 'offer' ? ['id', 'clubId', 'playerId', 'seasonWage', ...(version >= 19 ? ['seasons', 'transferFee', 'transferPaymentPlan'].filter(key => Object.hasOwn(raw as object, key)) : []), ...optionalClauseKeys(raw, version, ['releaseFee', 'transferMode']), ...roleKeys(raw, state), ...(version >= 25 && Object.hasOwn(raw as object, 'academyProspectId') ? ['academyProspectId'] : [])] : type === 'withdraw' ? ['offerId'] : version >= 19 && type === 'club-decision' ? ['offerId', 'response'] : [])]);
    if (!['offer', 'withdraw', 'resolve', ...(version >= 19 ? ['enable-transfers', 'club-decision'] : [])].includes(type as string)) fail(`${path}.type`, 'must identify a supported in-season command');
    if (type === 'offer') { validateOptionalReleaseFee(event, path, state); validateOptionalRole(event, path); validateTransferMode(event, path, listed); }
    const year = number(event.seasonNumber, `${path}.seasonNumber`, firstYear, state.seasonNumber), round = number(event.round, `${path}.round`, 1, year === state.seasonNumber ? state.round : seasonRounds(state));
    const eventBoundary = roundOrdinal(year, round, seasonRounds(state));
    if (eventBoundary !== boundary + (type === 'resolve' ? 1 : 0) || event.date !== dateForRound(round, year)) fail(path, 'must process each successive matchday before new commands at that boundary');
    boundary = eventBoundary;
    const ledgerIndex = number(event.ledgerIndexBefore, `${path}.ledgerIndexBefore`, previousLedger, financeLedgerCount(state.finance));
    const contractCount = number(event.contractCountBefore, `${path}.contractCountBefore`, previousContracts, state.employment.contracts.length);
    const negotiationCount = number(event.negotiationCountBefore, `${path}.negotiationCountBefore`, previousNegotiations, state.negotiations.records.length);
    verifyPrefix(year, round, ledgerIndex, contractCount, negotiationCount, path);
    if (type === 'resolve') {
      // Only opening-day funding precedes a season-opening reply; later sponsorship installments fall on matchday six.
      const allowed = state.finance.ledger.filter(entry => entry.seasonNumber < year || entry.seasonNumber === year && (entry.round < round || round === 1 && entry.round === 1 && (entry.kind === 'opening' || entry.kind === 'sponsor'))).length;
      if (ledgerIndex !== allowed) fail(`${path}.ledgerIndexBefore`, 'must resolve after the prior matchday and before new matchday discretionary spending');
    }
    const finance = financeAtLedgerBoundary(state.finance, ledgerIndex), ledger = finance.ledger, sourceIds = new Set(ledger.filter(entry => entry.kind === 'transfer').map(entry => entry.sourceId));
    const contracts = state.employment.contracts.slice(0, contractCount);
    const employment: SeasonEmployment = { ...state.employment, contracts, transfers: state.employment.transfers.filter(transfer => contracts.some(contract => contract.id === transfer.contractId)).map(transfer => ({ ...transfer, payments: transfer.payments.filter(payment => sourceIds.has(payment.id)) })), buyouts: state.employment.buyouts.filter(buyout => ledger.some(entry => entry.kind === 'buyout' && entry.sourceId === buyout.id)), market: null };
    const youthAnchor = state.youthCompetition.enabledSince;
    const youthVisible = !youthAnchor || roundKey(youthAnchor.seasonNumber, youthAnchor.round) < roundKey(year, round) || youthAnchor.seasonNumber === year && youthAnchor.round === round && youthAnchor.ledgerIndex <= ledgerIndex && youthAnchor.contractCount <= contractCount && youthAnchor.negotiationCount <= negotiationCount && youthAnchor.recruitmentEventCount <= index;
    const youthCompetition = youthVisible ? youthCompetitionAtBoundary(state.youthCompetition, year, round) : createYouthCompetition(state.youthCompetition.model);
    const academy = academyAtBoundary(state.academy, year, round, contractCount, !youthVisible && youthAnchor && youthAnchor.seasonNumber === year && youthAnchor.round === round ? youthAnchor.academyIntakeCount : undefined);
    const lifecycle = lifecycleAtBoundary(state.lifecycle, year, round, contractCount, index, state.market.windows.filter(window => window.seasonNumber < year).reduce((sum, window) => sum + window.events.length, 0), ledgerIndex, negotiationCount);
    const catalogContext = { world: worldOf(state), academy, lifecycle, seasonNumber: year, round, background: state.background };
    const clubs = clubsForEmploymentYear(employment, year, round, catalogContext);
    const rosters = rostersForEmploymentYear(employment, year, round, catalogContext);
    const catalogIds = new Set(getCareerPlayers(catalogContext).map(player => player.id));
    // Clubs that have left the full world since that season have no plans now: the replay gives them a joining club's.
    const filled = plansWithDefaults(state, clubs);
    let replay: SeasonState = { ...state, ...knownAt(year, round, 'active'), managedClubId: managedClubAtRound(state, year, round), academy, lifecycle, youthCompetition, conditions: Object.fromEntries(Object.entries(state.conditions).filter(([id]) => catalogIds.has(id))), plans: filled.plans, training: { ...state.training, plans: filled.training, points: Object.fromEntries(Object.entries(state.training.points).filter(([id]) => catalogIds.has(id))) }, seasonNumber: year, round, date: event.date as string, status: 'active', clubs, rosters, employment, recruitment, finance, payroll: { ...state.payroll, agreements: state.payroll.agreements.filter(agreement => agreement.seasonNumber < year || agreement.seasonNumber === year && agreement.startsRound <= round && contractForRound(employment, agreement.playerId, year, agreement.startsRound)?.clubId === agreement.clubId) }, negotiations: { ...state.negotiations, records: state.negotiations.records.slice(0, negotiationCount) }, market: createMarket() };
    try { replay = applyInSeasonEvent(replay, event as unknown as InSeasonEvent); }
    catch (error) { fail(path, `does not follow recruitment rules: ${error instanceof Error ? error.message : 'invalid command'}`); }
    if (!sameData(replay.employment.contracts, state.employment.contracts.slice(0, replay.employment.contracts.length)) || !sameData(replay.negotiations.records, state.negotiations.records.slice(0, replay.negotiations.records.length))) fail(path, 'must preserve the exact agreements and player replies generated at this boundary');
    if (!samePrefix(replay.finance.ledger, state.finance.ledger)) fail(path, 'must reproduce the exact transfer debit and seller receipt at this command boundary');
    const replayedSources = new Set(replay.finance.ledger.filter(entry => entry.kind === 'transfer').map(entry => entry.sourceId));
    const expectedTransfers = state.employment.transfers.filter(transfer => replay.employment.contracts.some(contract => contract.id === transfer.contractId)).map(transfer => ({ ...transfer, payments: transfer.payments.filter(payment => replayedSources.has(payment.id)) }));
    if (!sameData(replay.employment.transfers, expectedTransfers)) fail(path, 'must preserve the agreed fee, release references, schedule and actual transfer receipts');
    for (const transfer of replay.employment.transfers.slice(employment.transfers.length)) generatedTransfers.add(transfer.id);
    for (const contract of replay.employment.contracts.slice(contractCount)) generatedContracts.add(contract.id);
    for (const response of replay.negotiations.records.slice(negotiationCount)) generatedResponses.add(response.id);
    recruitment = replay.recruitment;
    previousLedger = financeLedgerCount(replay.finance); previousContracts = replay.employment.contracts.length; previousNegotiations = replay.negotiations.records.length;
    const liveOffers = recruitment.offers.filter(offer => offer.seasonNumber === year && (offer.status === 'pending' || offer.status === 'club-review'));
    holds.push({ eventCount: index + 1, ledgerIndex, seasonNumber: year, round, negotiationCount: replay.negotiations.records.length, offers: liveOffers, amounts: Object.fromEntries(clubs.map(club => [club.id, liveOffers.filter(offer => offer.clubId === club.id).reduce((sum, offer) => sum + offer.remainingWages + (offer.transfer?.fee ?? 0), 0)])) });
  }
  if (plan.record === fields.events.length) rememberReplay();
  if (boundary !== lastBoundary || !sameData(recruitment, fields)) fail('recruitment', 'must retain every advanced matchday and exactly its replayed offers, choices, reservations and responses');
  if (state.employment.contracts.some(contract => (contract.kind === 'midseason' || contract.kind === 'midseason-transfer') && !generatedContracts.has(contract.id)) || state.negotiations.records.some(entry => entry.startsSeason === entry.seasonNumber && !generatedResponses.has(entry.id)) || state.employment.transfers.some(transfer => transfer.startsRound > 1 && !generatedTransfers.has(transfer.id))) fail('recruitment.events', 'must explain every in-season agreement, transfer and player reply');
  return holds;
}

/**
 * What a replayed contract offer knew of later seasons' money when it was made: the board reviews given before it and
 * the per-season club money tables decided by then. An offer at an in-season boundary of matchday `round` comes before
 * that matchday's review (a review follows a week's games; offers come at the next boundary), and an offseason offer
 * after the season's final review; the next season's money table exists once the season is complete (`foreseeEconomy`).
 * The game reads both to set a later season's staff budget, and with it the wage pool its offers must fit
 * (`staffRoomForWages`), so a review or table added after the offer must not change the check (22 November 2026: a
 * season's final review cut next season's staff budget below what a computer club's honest renewal had used, and the
 * save was refused). Views are remembered per boundary; the board is read defensively, as `validateBoard` runs later.
 */
function knownAtBoundaries(state: SeasonState): (year: number, round: number, status: SeasonState['status']) => Partial<Pick<SeasonState, 'board' | 'economySeasons'>> {
  const known = new Map<string, Partial<Pick<SeasonState, 'board' | 'economySeasons'>>>();
  return (year, round, status) => {
    const key = `${year}/${status === 'complete' ? 'offseason' : round}`;
    let view = known.get(key);
    if (view) return view;
    view = {};
    const board = budgetBoard(state.board);
    if (board) {
      const reviews = board.reviews.filter(review => review.seasonNumber < year || review.seasonNumber === year && (status === 'complete' || review.round < round));
      if (reviews.length !== board.reviews.length) view.board = { ...state.board, reviews };
    }
    const economy = state.economySeasons, through = status === 'complete' ? year + 1 : year;
    if (economy && Array.isArray(economy.seasons) && economy.seasons.some(table => table?.seasonNumber > through)) view.economySeasons = { ...economy, seasons: economy.seasons.filter(table => table?.seasonNumber <= through) };
    known.set(key, view);
    return view;
  };
}

/** The state with no staff under contract in any role (the most staff budget a wage-pool club can leave to wages). */
function withoutStaffContracts(state: SeasonState): SeasonState {
  return { ...state, coaching: { ...state.coaching, contracts: [] }, scouts: { ...state.scouts, contracts: [] }, fitness: { ...state.fitness, contracts: [] }, physio: { ...state.physio, contracts: [] }, assistant: { ...state.assistant, contracts: [] }, youth: { ...state.youth, contracts: [] } };
}

const SELLER_WAGES_REASON = 'The selling club needs wages budget to replace its departing players.';
/** The replayed window with each refused sale's recorded wages-budget reason, where the replay found another reason. */
function withRecordedSellerReasons(replayed: MarketWindow, saved: MarketWindow): MarketWindow {
  if (!Array.isArray(saved.offers)) return replayed;
  return { ...replayed, offers: replayed.offers.map((offer, index) => {
    const recorded = saved.offers[index]?.transfer;
    return offer.transfer && recorded && saved.offers[index]!.id === offer.id && offer.transfer.clubStatus === 'rejected' && recorded.clubStatus === 'rejected' && recorded.clubReason === SELLER_WAGES_REASON && offer.transfer.clubReason !== SELLER_WAGES_REASON ? { ...offer, transfer: { ...offer.transfer, clubReason: SELLER_WAGES_REASON } } : offer;
  }) };
}

/** Replay accepted replies against the contract prefix independently of present-day reservations. */
/**
 * Whether the next agreement in a contract prefix came before an offer without a player response: a joining squad's
 * opening term from an earlier season end, or a `trade` contract (format 94) within the offer's recorded contract count
 * (trades complete between replies, so only that count places them; any other agreement still needs its reply).
 */
function unexplainedBefore(contract: EmploymentContract | undefined, year: number, prefixLength: number, countBefore: unknown): boolean {
  if (!contract) return false;
  if (contract.kind === 'joined') return contract.signedSeason < year;
  return contract.kind === 'trade' && typeof countBefore === 'number' && prefixLength < countBefore;
}

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
  const firstRound = number(anchor.round, 'negotiations.enabledSince.round', 1, firstYear === state.seasonNumber ? state.round : seasonRounds(state));
  const contractCount = number(anchor.contractCount, 'negotiations.enabledSince.contractCount', 0, state.employment.contracts.length);
  const firstBoundary = roundKey(firstYear, firstRound), employmentAnchor = state.employment.enabledSince;
  if (!employmentAnchor || roundKey(employmentAnchor.seasonNumber, employmentAnchor.round) > firstBoundary) fail('negotiations.enabledSince', 'requires player employment to be active before negotiations begin');
  const contracts = state.employment.contracts;
  for (const [index, contract] of contracts.entries()) {
    const boundary = roundKey(contract.signedSeason, contract.signedRound);
    if (index < contractCount && boundary > firstBoundary || index >= contractCount && (boundary < firstBoundary || contract.kind === 'initial')) fail('negotiations.enabledSince.contractCount', 'must identify the employment agreements already present at activation');
    if (index < contractCount && Object.hasOwn(contract, 'releaseFee')) fail('negotiations.enabledSince.contractCount', 'cannot hide a release clause agreed before negotiation activation');
  }
  let prefix = contracts.slice(0, contractCount);
  const knownAt = knownAtBoundaries(state);
  const entries: SeasonNegotiations['records'] = [];
  const conversations = new Map<string, { offeredWage: number; offeredSeasons: number; releaseFee?: number; role?: unknown; boundary: number; date: string }>();
  let previousBoundary = roundKey(firstYear, firstRound) * 2;
  let previousDate = dateForRound(firstRound, firstYear);
  // Incremental checkpoint checks (`trusted-prefix.ts`): offers made before the trusted checkpoint's week are unchanged and
  // were checked by it; only the contract prefix, conversations and chronology they leave behind are rebuilt.
  const plan = prefixPlan('negotiations.records', fields.records as SeasonNegotiations['records'], record => roundKey(record.seasonNumber, record.round));
  for (const [index, value] of fields.records.entries()) {
    if (index < plan.skip) {
      const entry = value as SeasonNegotiations['records'][number], year = entry.seasonNumber;
      while (unexplainedBefore(contracts[prefix.length], year, prefix.length, entry.contractCountBefore)) prefix = [...prefix, contracts[prefix.length]!];
      previousBoundary = roundKey(year, entry.round) * 2 + (entry.status === 'complete' ? 1 : 0);
      previousDate = entry.date;
      if (entry.outcome === 'accepted') prefix = [...prefix, contracts[prefix.length]!];
      conversations.set(`${entry.clubId}/${entry.playerId}/${entry.startsSeason}`, { offeredWage: entry.offeredWage, offeredSeasons: entry.offeredSeasons, releaseFee: entry.releaseFee, boundary: previousBoundary, date: entry.date });
      entries.push(entry);
      continue;
    }
    const path = `negotiations.records[${index}]`;
    const entry = record(value, path, ['id', 'clubId', 'playerId', 'seasonNumber', 'round', 'date', 'status', 'startsSeason', 'offeredWage', 'offeredSeasons', 'outcome', 'reason', 'requiredWage', 'counterOffer', 'alternativeOffer', 'contractId', 'contractCountBefore', ...optionalClauseKeys(value, version, ['releaseFee']), ...roleKeys(value, state)]);
    if (entry.id !== `negotiation-${index + 1}`) fail(`${path}.id`, 'must use sequential negotiation identities');
    if (typeof entry.clubId !== 'string' || !inFullWorld(state, entry.clubId, entry.seasonNumber)) fail(`${path}.clubId`, 'must identify a club in this league');
    if (typeof entry.playerId !== 'string') fail(`${path}.playerId`, 'must identify an existing career player');
    const year = number(entry.seasonNumber, `${path}.seasonNumber`, firstYear, state.seasonNumber);
    // Joining squads' opening terms (step 3.4d-2) were written at earlier rollovers, without a player response.
    const round = number(entry.round, `${path}.round`, 1, year === state.seasonNumber ? state.round : seasonRounds(state));
    while (unexplainedBefore(contracts[prefix.length], year, prefix.length, entry.contractCountBefore)) prefix = [...prefix, contracts[prefix.length]!];
    getCareerPlayer(state, entry.playerId, year, round);
    if (entry.status !== 'active' && entry.status !== 'complete') fail(`${path}.status`, 'must identify the calendar phase when the offer was made');
    if (entry.status === 'complete' && (round !== seasonRounds(state) || year === state.seasonNumber && state.status !== 'complete')) fail(`${path}.status`, 'cannot negotiate in an offseason before it begins');
    // Ordered by season, matchday and then the offseason after the final matchday (seasons of any length, step 3.2 fix).
    const boundary = roundKey(year, round) * 2 + (entry.status === 'complete' ? 1 : 0);
    if (boundary < previousBoundary || typeof entry.date !== 'string' || entry.date < previousDate) fail(path, 'must retain chronological offer order from activation onward');
    previousBoundary = boundary;
    previousDate = entry.date;
    const linkedOffer = state.market?.windows.find(window => window.seasonNumber === year)?.offers.find(offer => offer.negotiationId === entry.id);
    const inSeasonOffer = state.recruitment?.offers.find(offer => offer.negotiationId === entry.id);
    if (linkedOffer ? entry.status !== 'complete' || entry.date !== linkedOffer.respondedOn : entry.date !== dateForRound(round, year)) fail(`${path}.date`, 'must identify the actual offer matchday or replayed market response');
    if (inSeasonOffer ? entry.startsSeason !== year || entry.status !== 'active' || entry.date !== inSeasonOffer.respondedOn || round !== inSeasonOffer.responseRound : entry.startsSeason !== year + 1 || year >= MAX_SEASON_NUMBER) fail(`${path}.startsSeason`, 'must identify the supported season and linked reply boundary');
    const offeredWage = number(entry.offeredWage, `${path}.offeredWage`, MIN_CONTRACT_WAGE, maxContractWage(state));
    if (offeredWage % WAGE_STEP !== 0) fail(`${path}.offeredWage`, 'must use supported wage increments');
    const offeredSeasons = number(entry.offeredSeasons, `${path}.offeredSeasons`, 1, inSeasonOffer ? Math.min(MAX_CONTRACT_SEASONS, MAX_SEASON_NUMBER - year + 1) : Math.min(MAX_CONTRACT_SEASONS, MAX_SEASON_NUMBER - year));
    validateOptionalReleaseFee(entry, path, state);
    const releaseFee = entry.releaseFee as number | undefined;
    validateOptionalRole(entry, path);
    const role = entry.role as EmploymentContract['role'];
    const conversation = `${entry.clubId}/${entry.playerId}/${entry.startsSeason}`, previous = conversations.get(conversation);
    if (previous?.offeredWage === offeredWage && previous.offeredSeasons === offeredSeasons && previous.releaseFee === releaseFee && previous.role === role && previous.boundary === boundary && previous.date === entry.date) fail(path, 'duplicates the unchanged latest offer in this negotiation at this boundary');
    if (entry.contractCountBefore !== prefix.length) fail(`${path}.contractCountBefore`, 'must identify the complete employment history when this offer was submitted');
    const replay: SeasonState = {
      ...state, ...knownAt(year, round, entry.status), managedClubId: entry.status === 'complete' ? managedClubFor(state, year, true) : managedClubAtRound(state, year, round), academy: academyAtBoundary(state.academy, year, round, prefix.length), lifecycle: lifecycleAtBoundary(state.lifecycle, year, round, prefix.length, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, index), seasonNumber: year, round, date: entry.date as string, status: entry.status,
      employment: { ...state.employment, contracts: prefix, transfers: (state.employment.transfers ?? []).filter(transfer => prefix.some(contract => contract.id === transfer.contractId)), buyouts: (state.employment.buyouts ?? []).filter(buyout => buyout.negotiationCountBefore <= index && buyout.completedOn <= (entry.date as string)), market: entry.status === 'complete' ? { seasonNumber: year + 1 } : null },
      negotiations: { model: 'negotiations-1', enabledSince: { seasonNumber: firstYear, round: firstRound, contractCount }, records: entries },
      market: createMarket(),
      recruitment: { ...createRecruitment(), offers: recruitmentHolds.filter(hold => hold.negotiationCount <= index && (hold.seasonNumber < year || hold.seasonNumber === year && hold.round <= round)).at(-1)?.offers ?? [] },
    };
    replay.clubs = getContractedClubsForRound(replay, year, round);
    // A dated offseason reply keeps the role checked when the offer was made (the market replay checks it there).
    const terms = { ...(releaseFee === undefined ? {} : { releaseFee }), ...(role === undefined || linkedOffer ? {} : { role }) };
    const quote = quotePlayerContract(replay, entry.playerId, offeredWage, offeredSeasons, entry.clubId, undefined, undefined, 'upfront', terms);
    // Wage-pool careers (format 75): the wage budget includes the staff budget the club's staff leave unused, and the
    // replay knows only today's staff (staff hired since use more of it), so an offer is also accepted within the budget
    // the club would have had with no staff, the most it could have had (the registration check keeps the same bound).
    // Format 92: an NBA club's dated offer keeps the cap route it had when made (room under the cap then may be gone by the
    // reply, after its other offers were answered first); the market replay checks that route on the offer's own day.
    const fits = quote.canOffer || inSeasonOffer || linkedOffer?.transfer || linkedOffer?.capRoute !== undefined || usesWagePool({ coaching: state.coaching as { model: string } | undefined }) && quotePlayerContract(withoutStaffContracts(replay), entry.playerId, offeredWage, offeredSeasons, entry.clubId, undefined, undefined, 'upfront', terms).canOffer;
    if (!fits) fail(path, 'must satisfy ownership, signing-window, overlap, roster and budget rules when submitted');
    if (contractRolesApply(state) && role === undefined) fail(`${path}.role`, 'must record the squad role offered with these terms');
    const expected = evaluateNegotiation(entry.playerId, offeredWage, offeredSeasons, releaseFee, replay, role, entry.clubId as string);
    const decision = { outcome: entry.outcome, reason: entry.reason, requiredWage: entry.requiredWage, counterOffer: entry.counterOffer, alternativeOffer: entry.alternativeOffer };
    if (!sameData(decision, expected)) fail(path, 'must preserve the canonical player response and offered alternatives');
    if (entry.outcome === 'accepted') {
      const contract = contracts[prefix.length];
      if (!contract || entry.contractId !== contract.id || contract.playerId !== entry.playerId || contract.clubId !== entry.clubId || contract.signedSeason !== year || contract.signedRound !== round || contract.startsSeason !== entry.startsSeason || contract.endsSeason !== (entry.startsSeason as number) + offeredSeasons - 1 || contract.seasonWage !== offeredWage || contract.releaseFee !== releaseFee || contract.role !== role) fail(`${path}.contractId`, 'must identify the next employment agreement with exactly the accepted terms');
      prefix = [...prefix, contract];
    } else if (entry.contractId !== null) fail(`${path}.contractId`, 'cannot attach an employment agreement to an unaccepted offer');
    conversations.set(conversation, { offeredWage, offeredSeasons, releaseFee, role, boundary, date: entry.date });
    entries.push(entry as unknown as SeasonNegotiations['records'][number]);
  }
  while (contracts[prefix.length]?.kind === 'joined' || contracts[prefix.length]?.kind === 'trade') prefix = [...prefix, contracts[prefix.length]!];
  if (prefix.length !== contracts.length) fail('negotiations.records', 'must explain every employment agreement signed after negotiation activation');
  return fields as unknown as SeasonNegotiations;
}

/** Reports preserve what was observed at a committed fixture, never current hidden ratings. */
function validateScouting(value: unknown, state: SeasonState, version: number): SeasonScouting {
  const fields = record(value, 'scouting', ['model', 'enabledSince', 'clubs']);
  // Format 78: the scouting network (`scouting-2`) keeps the scouting-1 records; only the manager's estimates differ.
  if (fields.model === 'scouting-2' && version < 78) fail('scouting.model', 'requires format 78 or later');
  if (fields.model !== 'scouting-1' && fields.model !== 'scouting-2') fail('scouting.model', 'is unsupported');
  if (fields.enabledSince === null) {
    if (fields.model !== 'scouting-1' || !sameData(fields, createScouting(state.clubs, state.managedClubId))) fail('scouting', 'must retain empty default scouting offices while disabled');
    return fields as unknown as SeasonScouting;
  }
  const anchor = record(fields.enabledSince, 'scouting.enabledSince', ['seasonNumber', 'round']);
  const firstYear = number(anchor.seasonNumber, 'scouting.enabledSince.seasonNumber', 1, state.seasonNumber);
  const firstRound = number(anchor.round, 'scouting.enabledSince.round', 1, firstYear === state.seasonNumber ? state.round : seasonRounds(state));
  const firstBoundary = roundKey(firstYear, firstRound);
  const committedRound = state.status === 'complete' ? seasonRounds(state) : state.round - 1;
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
    const boundary = roundKey(year, round);
    if (!Object.hasOwn(entry, 'observer')) {
      if (enabled && boundary > roundKey(enabled.seasonNumber, enabled.round)) fail(`${path}.observer`, 'must retain the observer selected after scout recruitment activation');
      return null;
    }
    if (!enabled || boundary < roundKey(enabled.seasonNumber, enabled.round)) fail(`${path}.observer`, 'cannot precede scout recruitment activation');
    // Format 73: a report of a sealed season keeps its observer and evidence, not its ledger position at assignment.
    const sealedReport = version >= SEALED_HISTORY_FORMAT && year <= seniorSealedThrough(state.seasonNumber) && entry.observer !== null && typeof entry.observer === 'object' && !Object.hasOwn(entry.observer, 'assignedLedgerIndex');
    if (sealedReport) {
      const source = record(entry.observer, `${path}.observer`, ['contractId', 'scoutId', 'evidence']);
      if (source.contractId === null) { if (source.scoutId !== null || source.evidence !== 100) fail(`${path}.observer`, 'must preserve the baseline observation source and evidence'); return null; }
      const contract = state.scouts.contracts.find(contract => contract.id === source.contractId), scout = staffMember(SCOUT_DIRECTORY, source.scoutId);
      if (!contract || !scout || contract.scoutId !== scout.id || contract.clubId !== clubId || contract.seasonNumber !== year || contract.startedRound > round || source.evidence !== scoutEvidence(scout)) fail(`${path}.observer`, 'must preserve the appointed scout and catalog evidence');
      const mission = `${year}/${round}/${scout.id}`;
      if (scoutMissions.has(mission)) fail(`${path}.observer`, 'cannot assign one named scout to multiple players on the same matchday');
      scoutMissions.add(mission);
      return scout.id;
    }
    const source = record(entry.observer, `${path}.observer`, ['contractId', 'scoutId', 'evidence', 'assignedLedgerIndex']);
    const assigned = number(source.assignedLedgerIndex, `${path}.observer.assignedLedgerIndex`, enabled.ledgerIndex, financeLedgerCount(state.finance));
    validateLedgerBoundary(state.finance.ledger, assigned, year, round, `${path}.observer.assignedLedgerIndex`);
    const commit = ledgerBoundaryIndex(state.finance.ledger).commits.get(boundary);
    if (commit && assigned > commit.first) fail(`${path}.observer.assignedLedgerIndex`, 'must assign the observation before its matchday result is financially committed');
    if (source.contractId === null) {
      if (source.scoutId !== null || source.evidence !== 100) fail(`${path}.observer`, 'must preserve the baseline observation source and evidence');
      return null;
    }
    const contract = state.scouts.contracts.find(contract => contract.id === source.contractId);
    const scout = staffMember(SCOUT_DIRECTORY, source.scoutId);
    if (!contract || !scout || contract.scoutId !== scout.id || contract.clubId !== clubId || contract.seasonNumber !== year || contract.startedRound > round || contract.hiredLedgerIndex >= assigned || source.evidence !== scoutEvidence(scout)) fail(`${path}.observer`, 'must preserve the appointed scout and catalog evidence at the actual assignment boundary');
    if (contract.releasedRound !== null && (contract.releasedRound < round || !completed || assigned >= contract.releasedLedgerIndex! || !commit || contract.releasedLedgerIndex! <= commit.last)) fail(`${path}.observer`, 'cannot retain work cancelled before the observation was completed');
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
    const round = number(entry.round, `${path}.round`, 1, year === state.seasonNumber ? state.round : seasonRounds(state));
    if (roundKey(year, round) < firstBoundary) fail(path, 'cannot precede scouting activation');
    if (entry.date !== dateForRound(round, year)) fail(`${path}.date`, 'must identify the observed matchday');
    const snapshots = registrations.get(year);
    const snapshot = snapshots?.some(roster => roster.clubId === entry.clubId) ? rosterForRound(snapshots, entry.clubId as string, round) : undefined;
    if (!snapshot || !snapshot.players.some(member => member.id === player.id) || entry.rosterId !== snapshot.id) fail(path, 'must identify the player\'s registered club and roster at observation');
    if (review) {
      if (year === state.seasonNumber && round > committedRound) fail(path, 'requires a committed fixture before a review is available');
      const fixture = results.get(year)?.find(fixture => fixture.round === round && [fixture.homeClubId, fixture.awayClubId].includes(snapshot.clubId));
      // Format 73: a sealed game keeps no per-player participation; its report keeps its recorded outcome.
      const sealed = version >= SEALED_HISTORY_FORMAT && !!fixture && isSealedSeniorResult(fixture.result as ArchivedFixture['result']);
      const stats = fixture && !sealed ? fixturePlayerEvidence(fixture, player.id) : undefined;
      if (!stats && !sealed) fail(path, 'must reference an available recorded player appearance');
      const expectedOutcome = sealed ? entry.outcome === 'no-minutes' ? 'no-minutes' : 'observed' : stats!.secondsPlayed > 0 ? 'observed' : 'no-minutes';
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
    observedRatings.push({ playerId: player.id, boundary: roundKey(year, round), attributes, loss, path });
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
      if (!state.fixtures.some(fixture => fixture.round === state.round && [fixture.homeClubId, fixture.awayClubId].includes(target.id))) fail(location, 'requires a scheduled match for the observed player this week');
      pending.add(assignment.playerId);
      if (observer(assignment, state.seasonNumber, state.round, club.id, location, false) === null && ++baselineAssignments > 2) fail(location, 'exceeds the two baseline observations for this matchday');
    }
    if (!Array.isArray(office.reviews) || office.reviews.length > 20_000) fail(`${path}.reviews`, 'must retain a bounded report history');
    const missions = new Set<string>(), perRound = new Map<number, number>();
    let previousBoundary = firstBoundary;
    // Incremental checkpoint checks (`trusted-prefix.ts`): reports of matchdays before the trusted checkpoint's week are
    // unchanged and passed its check, which read only their own records, registrations, results and appointments of those
    // weeks. Their observed ratings are recalled for the cross-checks below, and the one bound that reads today's state
    // (ratings within the player's current development) is checked again. Later reports are checked in full.
    const journal = `${SCOUTING_REVIEWS}${club.id}`, firstRating = observedRatings.length;
    const plan = version === SEASON_SCHEMA_VERSION ? prefixPlan(journal, office.reviews as { seasonNumber: number; round: number }[]) : { skip: 0, record: -1 };
    const saved = plan.skip > 0 ? recall<{ count: number; ratings: typeof observedRatings }>(journal, 'ratings') : undefined;
    const resume = saved && saved.count === plan.skip ? saved : undefined;
    if (resume) {
      const last = office.reviews[plan.skip - 1] as { seasonNumber: number; round: number };
      previousBoundary = roundKey(last.seasonNumber, last.round);
      for (const rating of resume.ratings) {
        const player = catalogById.get(rating.playerId);
        if (!player) fail(`${rating.path}.playerId`, 'must identify a player in the stable catalog');
        for (const attribute of TRAINING_ATTRIBUTES) {
          const points = state.training.points[player.id]![attribute], loss = rating.loss[attribute];
          number(rating.attributes[attribute], `${rating.path}.attributes.${attribute}`, Math.max(1, player.attributes[attribute] - loss), Math.max(1, Math.min(20, player.attributes[attribute] + Math.floor(points / 100)) - loss));
        }
        observedRatings.push(rating);
      }
    }
    const rememberRatings = (count: number) => remember(journal, 'ratings', { count, ratings: observedRatings.slice(firstRating) });
    for (const [index, value] of office.reviews.entries()) {
      if (resume && index < plan.skip) continue;
      if (index === plan.record) rememberRatings(index);
      const location = `${path}.reviews[${index}]`, report = observation(value, location, true);
      if (report.snapshot.clubId === club.id) fail(location, 'must observe an outsider at the recorded boundary');
      const boundary = roundKey(report.year, report.round);
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
    if (plan.record === office.reviews.length) rememberRatings(plan.record);
    // Own-squad memories survive departure at their last actual observation boundary.
    const lastOwned = new Map<string, { year: number; round: number }>();
    for (let year = firstYear; year <= state.seasonNumber; year += 1) {
      const snapshots = registrations.get(year);
      // A club only has registrations in seasons it spent in the full world (step 3.4d-2). A club that leaves loses its
      // scouting office at that rollover and a returning club starts a new one (season.ts keeps only the full world's
      // offices), so memories of players who left before a season away must not be expected (step 3.7 acceptance: a
      // relegated club's player signed elsewhere in the offseason market was still demanded after the club came back).
      if (!snapshots?.some(roster => roster.clubId === club.id)) { lastOwned.clear(); continue; }
      const arrivalRefresh = state.rosters.some(roster => roster.fromRound === state.round && roster.fromRound > 1) ? state.round : 1;
      const through = year === state.seasonNumber ? Math.max(1, committedRound, firstYear === year ? firstRound : 1, arrivalRefresh) : seasonRounds(state);
      for (let observedRound = year === firstYear ? firstRound : 1; observedRound <= through; observedRound += 1) {
        for (const player of rosterForRound(snapshots, club.id, observedRound).players) lastOwned.set(player.id, { year, round: observedRound });
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
  const firstRound = number(anchor.round, 'payroll.enabledSince.round', 1, firstYear === seasonNumber ? round : seasonRounds(context));
  number(anchor.ledgerIndex, 'payroll.enabledSince.ledgerIndex', 0, ledgerLength);
  const expectedAgreements: PlayerWageAgreement[] = [];
  for (let year = firstYear; year <= seasonNumber; year += 1) {
    const fromRound = year === firstYear ? firstRound : 1, throughRound = year === seasonNumber ? round : seasonRounds(context);
    for (const club of clubsForEmploymentYear(employment, year, fromRound, context)) for (const player of club.players) {
      const contract = employment ? contractForRound(employment, player.id, year, fromRound) : undefined;
      expectedAgreements.push({ id: `wage-s${year}-${player.id}`, playerId: player.id, clubId: club.id, seasonNumber: year, startsRound: fromRound, seasonWage: contract?.seasonWage ?? getCareerWage(context, player.id) });
    }
    // Format 94: a player traded during the season is paid by his new club from the trade's week.
    for (const contract of employment?.contracts ?? []) if ((contract.kind === 'midseason' || contract.kind === 'midseason-transfer' || contract.kind === 'trade') && contract.startsSeason === year && contract.startsRound > fromRound && contract.startsRound <= throughRound) expectedAgreements.push({ id: `wage-s${year}-${contract.playerId}${contract.kind !== 'midseason' ? `-r${contract.startsRound}` : ''}`, playerId: contract.playerId, clubId: contract.clubId, seasonNumber: year, startsRound: contract.startsRound, seasonWage: contract.seasonWage });
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
function validateFinance(value: unknown, clubs: readonly Team[], fixtures: SeasonFixture[], archives: SeasonArchive[], coaching: SeasonCoaching, seasonNumber: number, round: number, status: SeasonState['status'], managedClubId: string, payroll?: SeasonPayroll, employment?: SeasonEmployment, recruitmentHolds: RecruitmentHolds[] = [], scouts: SeasonScouts = createScouts(), fitness: SeasonFitness = createFitness(), physio: SeasonPhysio = createPhysio(), assistant: SeasonAssistant = createAssistant(), youth: SeasonYouth = createYouth(), version = 30, facilities: SeasonFacilities = createFacilities(clubs, managedClubId), commercial: SeasonCommercial = createCommercial(clubs, managedClubId), board?: unknown, rivalries?: SeasonRivalries, world?: CareerWorld, divisions?: DomesticDivisions, background?: SeasonBackground, press?: Pick<SeasonState, 'media' | 'relationships'>, economySeasons?: SeasonEconomy): void {
  // Venues, derbies and the season length come from the career's world; hand-built contexts below carry it explicitly.
  const worldContext = world ? { world, ...(economySeasons ? { economySeasons } : {}) } : {}, seasonLength = seasonRounds(worldContext);
  // Format 72: each season's money figures (a context without a season reads the world's opening figures).
  const yearContext = (year: number): WorldContext => world ? { world, seasonNumber: year, ...(economySeasons ? { economySeasons } : {}) } : {};
  const fields = record(value, 'finance', ['model', 'enabledSince', 'plans', 'roundPrices', 'ledger', ...(version >= 28 && Object.hasOwn(value as object, 'roundCapacities') ? ['roundCapacities'] : [])]);
  if (fields.model !== 'finance-1') fail('finance.model', 'is unsupported');
  const clubIds = clubs.map(club => club.id);
  const plans = record(fields.plans, 'finance.plans', clubIds), prices = record(fields.roundPrices, 'finance.roundPrices', clubIds);
  for (const club of clubs) {
    const plan = record(plans[club.id], `finance.plans.${club.id}`, ['delegated', 'price']);
    if (typeof plan.delegated !== 'boolean') fail(`finance.plans.${club.id}.delegated`, 'must be boolean');
    validateTicketPrice(plan.price, `finance.plans.${club.id}.price`, yearContext(seasonNumber), club.id);
    validateTicketPrice(prices[club.id], `finance.roundPrices.${club.id}`, yearContext(seasonNumber), club.id);
  }
  if (facilities.enabledSince) {
    const capacities = record(fields.roundCapacities, 'finance.roundCapacities', clubIds);
    for (const club of clubs) if (capacities[club.id] !== getArenaCapacity({ facilities, ...worldContext }, club.id, dateForRound(round, seasonNumber))) fail(`finance.roundCapacities.${club.id}`, 'must retain the capacity locked for the prepared fixture');
  } else if (Object.hasOwn(fields, 'roundCapacities')) fail('finance.roundCapacities', 'must be absent while facilities are disabled');
  // Format 44 has already checked each stored segment before constructing this temporary complete view.
  const ledgerLimit = version >= 44 ? MAX_FINANCE_LOGICAL_ENTRIES : MAX_FINANCE_SEGMENT_ENTRIES;
  if (!Array.isArray(fields.ledger) || fields.ledger.length > ledgerLimit) fail('finance.ledger', `must contain at most ${ledgerLimit} entries`);
  if (fields.enabledSince === null) {
    if (payroll?.enabledSince) fail('payroll.enabledSince', 'requires active club finances');
    if (fields.ledger.length) fail('finance.ledger', 'must be empty while finances are disabled');
    if (!sameData(fields, createFinance(clubs, managedClubId, worldContext))) fail('finance', 'must retain the default plans and prices while disabled');
    return;
  }
  const anchor = record(fields.enabledSince, 'finance.enabledSince', ['seasonNumber', 'round']);
  const firstYear = number(anchor.seasonNumber, 'finance.enabledSince.seasonNumber', 1, seasonNumber);
  const firstRound = number(anchor.round, 'finance.enabledSince.round', 1, firstYear === seasonNumber ? round : seasonLength);
  const payrollAnchor = payroll?.enabledSince;
  if (payrollAnchor && roundKey(payrollAnchor.seasonNumber, payrollAnchor.round) < roundKey(firstYear, firstRound)) fail('payroll.enabledSince', 'cannot precede club finances');
  const committedRound = status === 'complete' ? round : round - 1;
  const financeRounds = Math.max(0, (seasonNumber - firstYear) * seasonLength + committedRound - firstRound + 1);
  // Seasons under negotiated sponsorship pay only covered clubs at the opening; earlier seasons pay every club.
  const openingSponsors = new Map<number, string[]>();
  // Each season's own full-world clubs (step 3.4d-2); a club joining the full world for the first time gets opening funds.
  const clubsIn = (year: number): readonly Team[] => world ? fullWorldClubsIn({ world, background }, year) : clubs;
  // A pure function of the season, worked out once per season (the ledger loop asks for every entry).
  const openingsByYear = new Map<number, string[]>();
  const openingsIn = (year: number): string[] => {
    const known = openingsByYear.get(year);
    if (known) return known;
    let openings: string[];
    if (year === firstYear) openings = clubsIn(firstYear).map(club => club.id);
    else {
      const earlier = new Set([...clubsIn(firstYear).map(club => club.id), ...(background?.exchanges ?? []).filter(exchange => exchange.seasonNumber < year - 1).flatMap(exchange => exchange.joining)]);
      openings = (background?.exchanges ?? []).filter(exchange => exchange.seasonNumber === year - 1).flatMap(exchange => exchange.joining).filter(id => !earlier.has(id));
    }
    openingsByYear.set(year, openings);
    return openings;
  };
  for (let year = firstYear; year <= seasonNumber; year += 1) openingSponsors.set(year, openingSponsorshipClubs(commercial, clubsIn(year), year));
  const minimumEntries = clubs.length + [...openingSponsors.values()].reduce((sum, ids) => sum + ids.length, 0) + financeRounds * clubs.length + [ ...archives.flatMap(archive => archive.fixtures.map(fixture => ({ ...fixture, year: archive.seasonNumber }))), ...fixtures.map(fixture => ({ ...fixture, year: seasonNumber })) ].filter(fixture => fixture.result && (fixture.year > firstYear || fixture.year === firstYear && fixture.round >= firstRound)).length;
  if (fields.ledger.length < minimumEntries) fail('finance.ledger', 'is missing required opening, sponsorship, operating or ticket entries');
  // An arena project started after a gate was booked cannot have closed its seats (an offseason start is dated on the
  // final week's Saturday, before that week's later postseason games): judge each gate by the projects started before it.
  const arenaStarts = facilities.projects.filter(project => project.type === 'arena').map(project => ({ project, ledgerIndex: facilities.events[project.startEventIndex]?.ledgerIndex ?? 0 }));
  const facilitiesForGate = (clubId: string, index: number, date: string): SeasonFacilities => {
    const later = arenaStarts.filter(item => item.project.clubId === clubId && item.ledgerIndex > index && item.project.startedOn < date).map(item => item.project);
    return later.length ? { ...facilities, projects: facilities.projects.filter(project => !later.includes(project)) } : facilities;
  };
  type RequiredEvent = Pick<FinanceEntry, 'clubId' | 'seasonNumber' | 'round' | 'kind' | 'sourceId'> & { amount?: number; fixture?: SeasonFixture | ArchivedFixture; sponsorship?: FinanceEntry['sponsorship']; boardCapital?: FinanceEntry['boardCapital']; namingRights?: FinanceEntry['namingRights']; sponsorExit?: FinanceEntry['sponsorExit']; debt?: FinanceEntry['debt'] };
  const origin = (clubId: string, kind: FinanceEntry['kind'], sourceId: string) => `${clubId}/${kind}/${sourceId}`;
  const required = new Map<string, RequiredEvent>();
  const schedules = new Map<number, readonly (SeasonFixture | ArchivedFixture)[]>(archives.map(archive => [archive.seasonNumber, archive.fixtures]));
  schedules.set(seasonNumber, fixtures);
  const add = (entry: RequiredEvent) => required.set(origin(entry.clubId, entry.kind, entry.sourceId), entry);
  for (const clubId of openingsIn(firstYear)) add({ clubId, seasonNumber: firstYear, round: firstRound, kind: 'opening', sourceId: 'opening', amount: openingCashFor(yearContext(firstYear), clubId) });
  for (let year = firstYear + 1; year <= seasonNumber; year += 1) for (const clubId of openingsIn(year)) add({ clubId, seasonNumber: year, round: 1, kind: 'opening', sourceId: `opening-s${year}`, amount: openingCashFor(yearContext(year), clubId) });
  for (let year = firstYear; year <= seasonNumber; year += 1) {
    const fromRound = year === firstYear ? firstRound : 1, throughRound = year === seasonNumber ? committedRound : seasonLength;
    if (!commercialGovernsSeason(commercial, year)) for (const club of clubsIn(year)) add({ clubId: club.id, seasonNumber: year, round: fromRound, kind: 'sponsor', sourceId: `sponsor-s${year}`, amount: year === firstYear ? Math.floor(annualSponsorshipFor(yearContext(year), club.id) * (seasonLength + 1 - firstRound) / seasonLength) : annualSponsorshipFor(yearContext(year), club.id) });
    // Format 62: season funding follows the sponsors at every season opening (pro-rated in the activation season).
    for (const club of clubsIn(year)) { const funding = annualFundingFor(yearContext(year), club.id); if (funding > 0) add({ clubId: club.id, seasonNumber: year, round: fromRound, kind: 'sponsor', sourceId: fundingSourceId(year), amount: year === firstYear && firstRound > 1 ? seasonFundingShare(funding, seasonLength, firstRound) : funding }); }
    for (let playedRound = fromRound; playedRound <= throughRound; playedRound += 1) for (const club of clubsIn(year)) add({ clubId: club.id, seasonNumber: year, round: playedRound, kind: 'operations', sourceId: `operations-s${year}-r${playedRound}`, amount: -roundOperatingCostFor(yearContext(year), club.id) });
    // Step 3.5b: a background side's home game earns the full world nothing.
    const hosts = new Set(clubsIn(year).map(club => club.id));
    // Format 85: a game at one venue earns neither club a gate.
    for (const fixture of schedules.get(year)!) if (fixture.result && fixture.round >= fromRound && fixture.round <= throughRound && hosts.has(fixture.homeClubId) && !playsAtNeutralVenue({ world }, fixture)) add({ clubId: fixture.homeClubId, seasonNumber: year, round: fixture.round, kind: 'tickets', sourceId: `tickets-${fixture.id}`, fixture });
  }
  // Approved board capital funds exactly the upgrade that starts next (the facilities replay checks the decision).
  for (const [index, event] of facilities.events.entries()) {
    const start = facilities.events[index + 1];
    if (event.type === 'funding' && event.approved && (start?.type === 'start' || start?.type === 'repair')) add({ clubId: event.clubId, seasonNumber: event.seasonNumber, round: event.round, kind: 'board-capital', sourceId: `board-capital-${start.projectId}`, amount: event.amount, boardCapital: { projectId: start.projectId, facilityType: event.facilityType } });
  }
  // Negotiated agreements (validated separately) owe dated installments and only earned bonuses.
  // Each season's own division memberships (step 3.4c): archives carry theirs, the current season its own.
  const divisionsOfYear = (year: number) => year === seasonNumber ? divisions : archives.find(archive => archive.seasonNumber === year)?.divisions;
  const standingsByYear = new Map<number, Map<string, number>>();
  const finalPosition = (year: number, clubId: string) => {
    let positions = standingsByYear.get(year);
    if (!positions) { positions = new Map(getStandings({ world, clubs, fixtures: schedules.get(year)!, divisions: divisionsOfYear(year) }).map(row => [row.clubId, row.position])); standingsByYear.set(year, positions); }
    return positions.get(clubId) ?? null;
  };
  for (const payment of sponsorshipPaymentsDue(commercial, (id, year) => (world ? seasonLeagues(world, divisionsOfYear(year)) : []).find(league => league.clubIds.includes(id))?.clubIds.length ?? clubs.length, { seasonNumber, round, complete: status === 'complete' }, finalPosition, seasonLength, (id, year) => clubsIn(year).some(club => club.id === id))) add({ clubId: payment.clubId, seasonNumber: payment.seasonNumber, round: payment.round, kind: 'sponsor', sourceId: payment.sourceId, amount: payment.amount, sponsorship: payment.sponsorship });
  // Format 64: naming installments (matchday six and after the final matchday) and each early end's exit payment or fee.
  if (version >= 64 && commercial.naming) {
    for (const payment of namingPaymentsDue(commercial.naming, { seasonNumber, round, complete: status === 'complete' }, seasonLength, (id, year) => clubsIn(year).some(club => club.id === id))) add({ clubId: payment.clubId, seasonNumber: payment.seasonNumber, round: payment.round, kind: 'naming-rights', sourceId: payment.sourceId, amount: payment.amount, namingRights: payment.namingRights });
    for (const [contract, agreements] of [['main', commercial.agreements], ['naming', commercial.naming.agreements]] as const) for (const agreement of agreements) {
      if (!agreement.exit) continue;
      add({ clubId: agreement.clubId, seasonNumber: agreement.exit.seasonNumber, round: agreement.exit.round, kind: 'sponsor-exit', sourceId: exitSourceId(agreement.id), amount: agreement.exit.by === 'sponsor' ? agreement.exit.amount : -agreement.exit.amount, sponsorExit: { agreementId: agreement.id, sponsorId: agreement.sponsorId, contract, by: agreement.exit.by } });
    }
  }

  for (const project of facilities.projects) {
    // Format 71: a leased level is paid through its lease, never upfront.
    if (project.kind === 'lease') continue;
    const event = facilities.events[project.startEventIndex]!;
    add({ clubId: project.clubId, seasonNumber: event.seasonNumber, round: event.round, kind: 'facility', sourceId: project.id, amount: -project.cost });
  }
  // Format 71: each loan received (or lease agreed at no cost), every scheduled payment already due while the debt ran
  // and the club was in the full world, and any early settlement (the command replay checks its amount).
  for (const debt of version >= 71 ? facilities.debts ?? [] : []) {
    // Format 74: a bank loan books like a facility loan.
    const paymentKind = debt.kind === 'lease' ? 'lease' as const : 'loan-repayment' as const;
    add({ clubId: debt.clubId, seasonNumber: debt.seasonNumber, round: debt.round, kind: debt.kind === 'lease' ? 'lease' : 'loan', sourceId: debtSourceId(debt.id, 'start'), amount: debt.kind === 'lease' ? 0 : debt.principal, debt: { debtId: debt.id, payment: 'start' } });
    for (const payment of debtSchedule(debt, seasonLength)) {
      if (roundKey(payment.seasonNumber, payment.round) > roundKey(seasonNumber, committedRound) || debt.settled && roundKey(payment.seasonNumber, payment.round) >= roundKey(debt.settled.seasonNumber, debt.settled.round) || !clubsIn(payment.seasonNumber).some(club => club.id === debt.clubId)) continue;
      add({ clubId: debt.clubId, seasonNumber: payment.seasonNumber, round: payment.round, kind: paymentKind, sourceId: debtSourceId(debt.id, payment.number), amount: -payment.amount, debt: { debtId: debt.id, payment: payment.number } });
    }
    if (debt.settled) add({ clubId: debt.clubId, seasonNumber: debt.settled.seasonNumber, round: debt.settled.round, kind: paymentKind, sourceId: debtSourceId(debt.id, 'settle'), amount: -debt.settled.amount, debt: { debtId: debt.id, payment: 'settle' } });
  }
  // Incremental checkpoint checks (`trusted-prefix.ts`): upkeep of matchdays before the trusted checkpoint's week is booked
  // by trusted entries, which the trusted check matched to these requirements; they are neither required nor matched again.
  const upkeepCheckedBefore = trustedCutKey();
  if (facilities.enabledSince) for (let year = facilities.enabledSince.seasonNumber; year <= seasonNumber; year += 1) {
    const from = year === facilities.enabledSince.seasonNumber ? facilities.enabledSince.round : 1, through = year === seasonNumber ? committedRound : seasonLength;
    for (let at = from; at <= through; at += 1) for (const club of clubsIn(year)) {
      if (roundKey(year, at) < upkeepCheckedBefore) continue;
      const date = dateForRound(at, year), upkeep = getFacilityUpkeepBreakdown({ facilities, ...yearContext(year) }, club.id, date);
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
  for (const buyout of buyoutRecords.values()) add({ clubId: buyout.clubId, seasonNumber: buyout.seasonNumber, round: seasonLength, kind: 'buyout', sourceId: buyout.id, amount: -buyout.amount });
  // Format 76 ('coaching-4'): appointments pay nothing up front (their entries keep amount 0); salaries are weekly.
  const staffContracts = usesStaffContracts({ coaching });
  // Format 84: a computer club's minimum appointment is made whatever its money (unpaid costs or not enough cash), so in
  // these careers staff appointments are not checked against the club's money (a basic check, development mode).
  const fullStaff = usesFullStaff({ coaching });
  const upfront = (year: number, clubId: string, fee: number) => staffContracts ? 0 : -staffFee(yearContext(year), clubId, fee);
  const staffAppointments = new Map<string, number>(staffContracts ? [
    ...scouts.contracts.map(contract => [`scouts/${contract.id}`, contract.hiredLedgerIndex] as const), ...fitness.contracts.map(contract => [`fitness/${contract.id}`, contract.hiredLedgerIndex] as const),
    ...physio.contracts.map(contract => [`physio/${contract.id}`, contract.hiredLedgerIndex] as const), ...assistant.contracts.map(contract => [`assistant/${contract.id}`, contract.hiredLedgerIndex] as const),
    ...youth.contracts.map(contract => [`youth/${contract.id}`, contract.hiredLedgerIndex] as const),
  ] : []);
  const scoutContracts = new Map(scouts.contracts.map(contract => [contract.id, contract]));
  for (const contract of scouts.contracts) add({ clubId: contract.clubId, seasonNumber: contract.seasonNumber, round: contract.startedRound, kind: 'scouting', sourceId: `scouting-${contract.id}`, amount: upfront(contract.seasonNumber, contract.clubId, staffMember(SCOUT_DIRECTORY, contract.scoutId)!.fee) });
  const fitnessContracts = new Map(fitness.contracts.map(contract => [contract.id, contract]));
  for (const contract of fitness.contracts) add({ clubId: contract.clubId, seasonNumber: contract.seasonNumber, round: contract.startedRound, kind: 'fitness', sourceId: `fitness-${contract.id}`, amount: upfront(contract.seasonNumber, contract.clubId, staffMember(FITNESS_DIRECTORY, contract.coachId)!.fee) });
  const physioContracts = new Map(physio.contracts.map(contract => [contract.id, contract]));
  for (const contract of physio.contracts) add({ clubId: contract.clubId, seasonNumber: contract.seasonNumber, round: contract.startedRound, kind: 'physio', sourceId: `physio-${contract.id}`, amount: upfront(contract.seasonNumber, contract.clubId, staffMember(PHYSIO_DIRECTORY, contract.physioId)!.fee) });
  const assistantContracts = new Map(assistant.contracts.map(contract => [contract.id, contract]));
  for (const contract of assistant.contracts) add({ clubId: contract.clubId, seasonNumber: contract.seasonNumber, round: contract.startedRound, kind: 'assistant', sourceId: `assistant-${contract.id}`, amount: upfront(contract.seasonNumber, contract.clubId, staffMember(ASSISTANT_DIRECTORY, contract.assistantId)!.fee) });
  const youthContracts = new Map(youth.contracts.map(contract => [contract.id, contract]));
  for (const contract of youth.contracts) add({ clubId: contract.clubId, seasonNumber: contract.seasonNumber, round: contract.startedRound, kind: 'youth', sourceId: `youth-${contract.id}`, amount: upfront(contract.seasonNumber, contract.clubId, staffMember(YOUTH_COACH_DIRECTORY, contract.coachId)!.fee) });

  const wageGroups = new Map<string, PlayerWageAgreement[]>(), remainingWages = new Map<string, number>(), prepaid = new Set<string>();
  const wageGroup = (year: number, clubId: string) => `${year}/${clubId}`;
  for (const agreement of payroll?.agreements ?? []) {
    const key = wageGroup(agreement.seasonNumber, agreement.clubId), group = wageGroups.get(key) ?? [];
    group.push(agreement); wageGroups.set(key, group);
    const gross = agreement.seasonWage - Math.floor((agreement.startsRound - 1) * agreement.seasonWage / seasonLength);
    remainingWages.set(agreement.id, gross);
  }
  if (payrollAnchor) for (let year = payrollAnchor.seasonNumber; year <= seasonNumber; year += 1) {
    const from = year === payrollAnchor.seasonNumber ? payrollAnchor.round : 1, through = year === seasonNumber ? committedRound : seasonLength;
    for (let paidRound = from; paidRound <= through; paidRound += 1) for (const club of clubsIn(year)) add({ clubId: club.id, seasonNumber: year, round: paidRound, kind: 'payroll', sourceId: `payroll-s${year}-r${paidRound}` });
  }
  const agreementActive = (agreement: PlayerWageAgreement, index: number, atRound: number) => {
    if (agreement.startsRound > atRound) return false;
    const transfers = (employment?.transfers ?? []).filter(transfer => (transferIndexes.get(transfer.id) ?? -1) >= 0 && transferIndexes.get(transfer.id)! <= index);
    if (atRound > agreementThroughRound({ ...worldContext, employment: employment ? { ...employment, transfers } : undefined }, agreement)) return false;
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
  // Format 74 ('coaching-2'): a sacked person's fee stops counting against the staff budget from the release. Roles that
  // keep a release boundary leave the totals at it; this season's coaches leave from their release round; coaches of
  // completed seasons keep no release record, so their fees are checked one by one (a basic check, development mode).
  const levelledStaff = usesClubLevelStaff({ coaching });
  // Format 75 ('coaching-3'): staff fees may also use unused player salary budget; a basic bound (development mode).
  const pooledSalaryRoom = (clubId: string, year: number): number => usesWagePool({ coaching }) ? seasonSalaryCeiling({ ...(worldContext as WorldContext), ...(board !== null && typeof board === 'object' ? { board: board as SeasonBoard } : {}) }, clubId, year) : 0;
  const staffReleases = levelledStaff ? ([
    ...scouts.contracts.map(contract => [contract, staffMember(SCOUT_DIRECTORY, contract.scoutId)?.fee] as const),
    ...fitness.contracts.map(contract => [contract, staffMember(FITNESS_DIRECTORY, contract.coachId)?.fee] as const),
    ...physio.contracts.map(contract => [contract, staffMember(PHYSIO_DIRECTORY, contract.physioId)?.fee] as const),
    ...assistant.contracts.map(contract => [contract, staffMember(ASSISTANT_DIRECTORY, contract.assistantId)?.fee] as const),
    ...youth.contracts.map(contract => [contract, staffMember(YOUTH_COACH_DIRECTORY, contract.coachId)?.fee] as const),
  ] as const).flatMap(([contract, fee]) => contract.releasedLedgerIndex === null || fee === undefined ? [] : [{ at: contract.releasedLedgerIndex, key: `${contract.seasonNumber}/${contract.clubId}`, fee: staffFee(yearContext(contract.seasonNumber), contract.clubId, fee) }]).sort((left, right) => left.at - right.at) : [];
  const releasedCoaches = levelledStaff ? coaching.contracts.filter(contract => contract.releasedRound !== null) : [];
  const coachEntries = new Map<string, number>(), creditedCoaches = new Set<string>();
  let releaseCursor = 0;
  /** The staff fees counted against a club's season budget just before ledger entry `index`. */
  const countedStaffFees = (feeKey: string, index: number, year: number, entryRound: number): number => {
    if (!levelledStaff) return feeTotals.get(feeKey) ?? 0;
    for (; releaseCursor < staffReleases.length && staffReleases[releaseCursor]!.at <= index; releaseCursor += 1) {
      const release = staffReleases[releaseCursor]!;
      feeTotals.set(release.key, (feeTotals.get(release.key) ?? 0) - release.fee);
    }
    if (year === seasonNumber) for (const contract of releasedCoaches) {
      if (creditedCoaches.has(contract.id) || contract.releasedRound! > entryRound || (coachEntries.get(contract.id) ?? index) >= index) continue;
      creditedCoaches.add(contract.id);
      const key = `${year}/${contract.clubId}`;
      feeTotals.set(key, (feeTotals.get(key) ?? 0) - staffFee(yearContext(year), contract.clubId, staffMember(COACH_DIRECTORY, contract.coachId)!.fee));
    }
    return feeTotals.get(feeKey) ?? 0;
  };
  const paidTransferTotals = new Map<string, number>();
  const paidTransferCounts = new Map<string, number>();
  const currentContracts = new Map(coaching.contracts.map(contract => [contract.id, contract]));
  // Clubs that were in the full world at some point keep their ledgers (step 3.4d-2).
  const balances = new Map<string, FinanceBalance>((world ? [...fullWorldClubs(world), ...world.clubs.filter(club => (background?.exchanges ?? []).some(exchange => exchange.joining.includes(club.id)))] : clubs).map(club => [club.id, { cash: 0, unpaid: 0 }]));
  const maximumContracts = maximumCoachingContracts(clubs.length, usesClubLevelStaff({ coaching }));
  let previousDate = roundKey(firstYear, firstRound), entryYear = firstYear, yearIndex = 0;
  const operatingClubs = new Set<string>();
  let payrollStarted = false;
  const taxEntries = new Map<number, { round: number; count: number; expected: number }>();
  // Incremental checkpoint checks (`trusted-prefix.ts`): entries booked before the trusted checkpoint's week are unchanged
  // and their recomputed gates and upkeep were checked by it. Every entry still runs the ledger's order, balance and
  // requirement bookkeeping below; only those two recomputations are skipped for trusted entries.
  const ledgerPlan = version === SEASON_SCHEMA_VERSION ? prefixPlan('finance.ledger', fields.ledger as FinanceEntry[], entry => roundKey(entry.seasonNumber, entry.round)) : { skip: 0 };
  for (const [index, value] of fields.ledger.entries()) {
    const path = `finance.ledger[${index}]`;
    const entry = record(value, path, ['id', 'clubId', 'seasonNumber', 'round', 'kind', 'amount', 'sourceId', 'ticket', 'coach', ...(payroll ? ['payroll'] : []), ...(version >= 21 && value !== null && typeof value === 'object' && Object.hasOwn(value, 'scout') ? ['scout'] : []), ...(version >= 22 && value !== null && typeof value === 'object' && Object.hasOwn(value, 'fitness') ? ['fitness'] : []), ...(version >= 23 && value !== null && typeof value === 'object' && Object.hasOwn(value, 'physio') ? ['physio'] : []), ...(version >= 24 && value !== null && typeof value === 'object' && Object.hasOwn(value, 'assistant') ? ['assistant'] : []), ...(version >= 25 && value !== null && typeof value === 'object' && Object.hasOwn(value, 'youth') ? ['youth'] : []), ...(version >= 28 && value !== null && typeof value === 'object' ? ['facility', 'facilityUpkeep'].filter(key => Object.hasOwn(value, key)) : []), ...(version >= 31 && value !== null && typeof value === 'object' && Object.hasOwn(value, 'sponsorship') ? ['sponsorship'] : []), ...(version >= 32 && value !== null && typeof value === 'object' && Object.hasOwn(value, 'boardCapital') ? ['boardCapital'] : []), ...(version >= 64 && value !== null && typeof value === 'object' ? ['namingRights', 'sponsorExit'].filter(key => Object.hasOwn(value, key)) : []), ...(version >= 71 && value !== null && typeof value === 'object' && Object.hasOwn(value, 'debt') ? ['debt'] : [])]);
    if (entry.id !== `finance-${index + 1}`) fail(`${path}.id`, 'must use sequential career-wide identities');
    if (typeof entry.clubId !== 'string' || !balances.has(entry.clubId)) fail(`${path}.clubId`, 'must identify a club in this league');
    const year = number(entry.seasonNumber, `${path}.seasonNumber`, firstYear, seasonNumber);
    const entryRound = number(entry.round, `${path}.round`, 1, year === seasonNumber ? round : seasonLength);
    const calendar = roundKey(year, entryRound);
    if (calendar < previousDate) fail(path, 'must follow the financial calendar without preceding activation');
    if (payrollAnchor) {
      const activationDate = roundKey(payrollAnchor.seasonNumber, payrollAnchor.round);
      if (index < payrollAnchor.ledgerIndex ? calendar > activationDate : calendar < activationDate) fail('payroll.enabledSince.ledgerIndex', 'must identify the ledger boundary on the activation date');
    }
    if (calendar !== previousDate) { operatingClubs.clear(); payrollStarted = false; }
    previousDate = calendar;
    if (!['opening', 'sponsor', 'operations', 'tickets', 'coaching', ...(version >= 21 ? ['scouting'] : []), ...(version >= 22 ? ['fitness'] : []), ...(version >= 23 ? ['physio'] : []), ...(version >= 24 ? ['assistant'] : []), ...(version >= 25 ? ['youth'] : []), ...(version >= 28 ? ['facility', 'facility-upkeep'] : []), ...(version >= 32 ? ['board-capital'] : []), ...(version >= 64 ? ['naming-rights', 'sponsor-exit'] : []), ...(version >= 71 ? ['loan', 'loan-repayment', 'lease'] : []), ...(staffContracts ? ['staff-wages', 'staff-compensation'] : []), ...(payroll ? ['payroll'] : []), ...(employment?.transfers ? ['transfer'] : []), ...(employment?.buyouts ? ['buyout'] : []), ...(version >= 92 && world?.nba?.cap ? ['luxury-tax', 'tax-share'] : []), ...(version >= 93 && world?.nba?.moves ? ['salary-floor'] : [])].includes(entry.kind as string)) fail(`${path}.kind`, 'is unsupported');
    const kind = entry.kind as FinanceEntry['kind'];
    if (kind !== 'scouting' && Object.hasOwn(entry, 'scout')) fail(`${path}.scout`, 'must be absent from other financial events');
    if (kind !== 'fitness' && Object.hasOwn(entry, 'fitness')) fail(`${path}.fitness`, 'must be absent from other financial events');
    if (kind !== 'physio' && Object.hasOwn(entry, 'physio')) fail(`${path}.physio`, 'must be absent from other financial events');
    if (kind !== 'assistant' && Object.hasOwn(entry, 'assistant')) fail(`${path}.assistant`, 'must be absent from other financial events');
    if (kind !== 'facility' && Object.hasOwn(entry, 'facility')) fail(`${path}.facility`, 'must be absent from other financial events');
    if (kind !== 'facility-upkeep' && Object.hasOwn(entry, 'facilityUpkeep')) fail(`${path}.facilityUpkeep`, 'must be absent from other financial events');
    if (kind !== 'youth' && Object.hasOwn(entry, 'youth')) fail(`${path}.youth`, 'must be absent from other financial events');
    if (kind !== 'sponsor' && Object.hasOwn(entry, 'sponsorship')) fail(`${path}.sponsorship`, 'must be absent from other financial events');
    if (kind !== 'board-capital' && Object.hasOwn(entry, 'boardCapital')) fail(`${path}.boardCapital`, 'must be absent from other financial events');
    if (kind !== 'naming-rights' && Object.hasOwn(entry, 'namingRights')) fail(`${path}.namingRights`, 'must be absent from other financial events');
    if (kind !== 'sponsor-exit' && Object.hasOwn(entry, 'sponsorExit')) fail(`${path}.sponsorExit`, 'must be absent from other financial events');
    const debtKind = kind === 'loan' || kind === 'loan-repayment' || kind === 'lease';
    if (debtKind !== Object.hasOwn(entry, 'debt')) fail(`${path}.debt`, 'must identify the loan or lease of a debt entry, and only there');
    if (payrollAnchor && calendar === roundKey(payrollAnchor.seasonNumber, payrollAnchor.round)) {
      if ((kind === 'opening' || kind === 'sponsor') && index >= payrollAnchor.ledgerIndex) fail('payroll.enabledSince.ledgerIndex', 'must follow opening funds and sponsorship already booked at activation');
      if ((kind === 'tickets' || kind === 'operations' || kind === 'payroll') && index < payrollAnchor.ledgerIndex) fail('payroll.enabledSince.ledgerIndex', 'must precede the activation matchday financial commit');
    }
    const amount = number(entry.amount, `${path}.amount`, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
    if (typeof entry.sourceId !== 'string') fail(`${path}.sourceId`, 'must identify its financial event');
    const key = origin(entry.clubId, kind, entry.sourceId);
    if (seen.has(key)) fail(`${path}.sourceId`, 'duplicates a financial event');
    seen.add(key);

    if (year !== entryYear) { entryYear = year; yearIndex = 0; }
    const openingClubs = openingsIn(year), openingRows = openingClubs.length, sponsorRows = openingSponsors.get(year)!;
    if (yearIndex < openingRows + sponsorRows.length) {
      const opening = yearIndex < openingRows, expectedClub = opening ? openingClubs[yearIndex]! : sponsorRows[yearIndex - openingRows]!;
      if (kind !== (opening ? 'opening' : 'sponsor') || entry.clubId !== expectedClub) fail(path, 'must record opening funds and annual sponsors before other financial events');
    }
    yearIndex += 1;

    if (kind === 'tickets' || kind === 'operations') financialCommitRounds.add(calendar);
    if (payroll && kind !== 'payroll' && entry.payroll !== null) fail(`${path}.payroll`, 'must be empty for non-payroll events');
    if (kind === 'facility-upkeep' && index < ledgerPlan.skip && calendar < upkeepCheckedBefore) {
      record(entry.facilityUpkeep, `${path}.facilityUpkeep`, ['arena', 'training', 'youth', ...(facilities.model !== 'facilities-1' ? ['medical', 'scouting'] : [])]);
    } else if (kind === 'facility' || kind === 'facility-upkeep') {
      if (entry.ticket !== null || entry.coach !== null) fail(path, 'must not mix facilities and unrelated payment details');
      const expected = required.get(key);
      if (!expected || expected.kind !== kind || expected.seasonNumber !== year || expected.round !== entryRound || expected.amount !== amount) fail(path, 'must match one exact funded project or dated upkeep charge');
      if (kind === 'facility') {
        const details = record(entry.facility, `${path}.facility`, ['projectId', 'type']);
        const project = facilities.projects.find(project => project.id === details.projectId);
        if (!project || project.type !== details.type || project.id !== entry.sourceId || facilities.events[project.startEventIndex]?.ledgerIndex !== index) fail(path, 'must charge the exact project at its approval boundary');
      } else {
        const details = record(entry.facilityUpkeep, `${path}.facilityUpkeep`, ['arena', 'training', 'youth', ...(facilities.model !== 'facilities-1' ? ['medical', 'scouting'] : [])]);
        if (index >= ledgerPlan.skip) {
          const { total: _total, ...breakdown } = getFacilityUpkeepBreakdown({ facilities, ...yearContext(year) }, entry.clubId, dateForRound(entryRound, year));
          if (!sameData(details, breakdown)) fail(path, 'must charge the completed facility levels on this matchday');
        }
        if (operatingClubs.size !== clubs.length || payrollStarted) fail(path, 'must book upkeep after all operating costs and before matchday payroll');
      }
      required.delete(key);
    } else if (kind === 'payroll') {
      if (!payrollAnchor || index < payrollAnchor.ledgerIndex) fail(path, 'cannot charge wages before payroll activation');
      if (entry.ticket !== null || entry.coach !== null) fail(path, 'must not mix ticket or coaching details with payroll');
      const details = record(entry.payroll, `${path}.payroll`, ['type', 'fromRound', 'throughRound', 'items']);
      if (details.type !== 'installment' && details.type !== 'prepayment') fail(`${path}.payroll.type`, 'is unsupported');
      if (details.type === 'installment') financialCommitRounds.add(calendar);
      else if (financialCommitRounds.has(calendar)) fail(path, 'cannot prepay during the atomic matchday financial commit');
      if (details.fromRound !== entryRound || details.throughRound !== (details.type === 'prepayment' ? seasonLength : entryRound)) fail(`${path}.payroll`, 'must identify the exact payable installment range');
      const agreements = wageGroups.get(wageGroup(year, entry.clubId));
      if (!agreements || entryRound < agreements[0]!.startsRound) fail(path, 'must identify active wage agreements');
      let expectedItems: PayrollItem[];
      if (details.type === 'installment') {
        const expected = required.get(key);
        if (!expected || expected.kind !== 'payroll' || expected.seasonNumber !== year || expected.round !== entryRound) fail(path, 'must identify a completed matchday payroll installment');
        expectedItems = agreements.filter(agreement => agreementActive(agreement, index, entryRound) && !prepaid.has(agreement.id)).map(agreement => {
          const gross = payrollInstallment(agreement.seasonWage, entryRound, seasonLength);
          return { agreementId: agreement.id, playerId: agreement.playerId, gross, discount: 0, amount: gross };
        });
        required.delete(key);
      } else {
        const items = array(details.items, `${path}.payroll.items`, 1);
        const item = record(items[0], `${path}.payroll.items[0]`, ['agreementId', 'playerId', 'gross', 'discount', 'amount']);
        const agreement = agreements.find(agreement => agreement.id === item.agreementId);
        if (!agreement || !agreementActive(agreement, index, entryRound) || prepaid.has(agreement.id) || entry.sourceId !== `prepay-${agreement.id}`) fail(path, 'must identify one active unpaid agreement exactly once');
        const gross = agreement.seasonWage - Math.floor((entryRound - 1) * agreement.seasonWage / seasonLength);
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
      const paired = financeLedgerEntry({ ledger: fields.ledger as FinanceEntry[] }, index + (amount < 0 ? 1 : -1));
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
      if (!expected || !buyout || expected.kind !== 'buyout' || expected.seasonNumber !== year || entryRound !== seasonLength || amount !== -buyout.amount) fail(path, 'must match exactly one recorded contract buyout settlement');
      const balance = balances.get(entry.clubId)!;
      const transferReserve = (employment?.transfers ?? []).filter(transfer => transfer.toClubId === entry.clubId && paidTransferTotals.has(transfer.id)).reduce((sum, transfer) => sum + transfer.fee - paidTransferTotals.get(transfer.id)!, 0);
      if (balance.unpaid > 0 || balance.cash < -amount + wageReserve(year, entry.clubId, index, entryRound) + transferReserve + recruitmentReserve(year, entry.clubId, index)) fail(path, 'must settle the buyout using cash after protecting player wages and unpaid transfer commitments');
      required.delete(key);
    } else if (kind === 'fitness') {
      if (entry.ticket !== null || entry.coach !== null) fail(path, 'must record the fitness fee without unrelated details');
      const details = record(entry.fitness, `${path}.fitness`, ['contractId', 'coachId']);
      const contract = fitnessContracts.get(details.contractId as string), expected = required.get(key);
      if (!contract || !expected || expected.kind !== 'fitness' || contract.hiredLedgerIndex !== index || contract.coachId !== details.coachId || expected.seasonNumber !== year || expected.round !== entryRound || expected.amount !== amount) fail(path, 'must record exactly the hired fitness coach fee at its original ledger boundary');
      const feeKey = `${year}/${entry.clubId}`, total = countedStaffFees(feeKey, index, year, entryRound) - amount;
      if (total > staffBudgetFor(board, entry.clubId, year, { ...worldContext, dataPackId: (worldContext as WorldContext).world?.id ?? DEVELOPMENT_DATA_PACK_ID }) + pooledSalaryRoom(entry.clubId, year)) fail(path, 'exceeds the shared annual staff allocation including released appointments');
      feeTotals.set(feeKey, total);
      const balance = balances.get(entry.clubId)!;
      const transfers = (employment?.transfers ?? []).filter(transfer => transfer.toClubId === entry.clubId && paidTransferTotals.has(transfer.id));
      const transferReserve = transfers.reduce((sum, transfer) => sum + transfer.fee - paidTransferTotals.get(transfer.id)!, 0);
      const overdue = transfers.some(transfer => transfer.installments.filter(item => item.dueOn <= dateForRound(entryRound, year)).reduce((sum, item) => sum + item.amount, 0) > paidTransferTotals.get(transfer.id)!);
      if (!fullStaff && (overdue || balance.unpaid > 0 || !staffContracts && balance.cash < -amount + wageReserve(year, entry.clubId, index, entryRound) + transferReserve + recruitmentReserve(year, entry.clubId, index))) fail(path, 'must fund the fitness fee after protecting wages and transfer holds and settling arrears');
      required.delete(key);
    } else if (kind === 'physio') {
      if (entry.ticket !== null || entry.coach !== null) fail(path, 'must record the physio fee without unrelated details');
      const details = record(entry.physio, `${path}.physio`, ['contractId', 'physioId']);
      const contract = physioContracts.get(details.contractId as string), expected = required.get(key);
      if (!contract || !expected || expected.kind !== 'physio' || contract.hiredLedgerIndex !== index || contract.physioId !== details.physioId || expected.seasonNumber !== year || expected.round !== entryRound || expected.amount !== amount) fail(path, 'must record exactly the hired physiotherapist fee at its original ledger boundary');
      const feeKey = `${year}/${entry.clubId}`, total = countedStaffFees(feeKey, index, year, entryRound) - amount;
      if (total > staffBudgetFor(board, entry.clubId, year, { ...worldContext, dataPackId: (worldContext as WorldContext).world?.id ?? DEVELOPMENT_DATA_PACK_ID }) + pooledSalaryRoom(entry.clubId, year)) fail(path, 'exceeds the shared annual staff allocation including released appointments');
      feeTotals.set(feeKey, total);
      const balance = balances.get(entry.clubId)!;
      const transfers = (employment?.transfers ?? []).filter(transfer => transfer.toClubId === entry.clubId && paidTransferTotals.has(transfer.id));
      const transferReserve = transfers.reduce((sum, transfer) => sum + transfer.fee - paidTransferTotals.get(transfer.id)!, 0);
      const overdue = transfers.some(transfer => transfer.installments.filter(item => item.dueOn <= dateForRound(entryRound, year)).reduce((sum, item) => sum + item.amount, 0) > paidTransferTotals.get(transfer.id)!);
      if (!fullStaff && (overdue || balance.unpaid > 0 || !staffContracts && balance.cash < -amount + wageReserve(year, entry.clubId, index, entryRound) + transferReserve + recruitmentReserve(year, entry.clubId, index))) fail(path, 'must fund the physio fee after protecting wages and transfer holds and settling arrears');
      required.delete(key);
    } else if (kind === 'assistant') {
      if (entry.ticket !== null || entry.coach !== null) fail(path, 'must record the assistant fee without unrelated details');
      const details = record(entry.assistant, `${path}.assistant`, ['contractId', 'assistantId']);
      const contract = assistantContracts.get(details.contractId as string), expected = required.get(key);
      if (!contract || !expected || expected.kind !== 'assistant' || contract.hiredLedgerIndex !== index || contract.assistantId !== details.assistantId || expected.seasonNumber !== year || expected.round !== entryRound || expected.amount !== amount) fail(path, 'must record exactly the hired assistant coach fee at its original ledger boundary');
      const feeKey = `${year}/${entry.clubId}`, total = countedStaffFees(feeKey, index, year, entryRound) - amount;
      if (total > staffBudgetFor(board, entry.clubId, year, { ...worldContext, dataPackId: (worldContext as WorldContext).world?.id ?? DEVELOPMENT_DATA_PACK_ID }) + pooledSalaryRoom(entry.clubId, year)) fail(path, 'exceeds the shared annual staff allocation including released appointments');
      feeTotals.set(feeKey, total);
      const balance = balances.get(entry.clubId)!;
      const transfers = (employment?.transfers ?? []).filter(transfer => transfer.toClubId === entry.clubId && paidTransferTotals.has(transfer.id));
      const transferReserve = transfers.reduce((sum, transfer) => sum + transfer.fee - paidTransferTotals.get(transfer.id)!, 0);
      const overdue = transfers.some(transfer => transfer.installments.filter(item => item.dueOn <= dateForRound(entryRound, year)).reduce((sum, item) => sum + item.amount, 0) > paidTransferTotals.get(transfer.id)!);
      if (!fullStaff && (overdue || balance.unpaid > 0 || !staffContracts && balance.cash < -amount + wageReserve(year, entry.clubId, index, entryRound) + transferReserve + recruitmentReserve(year, entry.clubId, index))) fail(path, 'must fund the assistant fee after protecting wages and transfer holds and settling arrears');
      required.delete(key);
    } else if (kind === 'youth') {
      if (entry.ticket !== null || entry.coach !== null) fail(path, 'must record the youth fee without unrelated details');
      const details = record(entry.youth, `${path}.youth`, ['contractId', 'coachId']);
      const contract = youthContracts.get(details.contractId as string), expected = required.get(key);
      if (!contract || !expected || expected.kind !== 'youth' || contract.hiredLedgerIndex !== index || contract.coachId !== details.coachId || expected.seasonNumber !== year || expected.round !== entryRound || expected.amount !== amount) fail(path, 'must record exactly the hired youth coach fee at its original ledger boundary');
      const feeKey = `${year}/${entry.clubId}`, total = countedStaffFees(feeKey, index, year, entryRound) - amount;
      if (total > staffBudgetFor(board, entry.clubId, year, { ...worldContext, dataPackId: (worldContext as WorldContext).world?.id ?? DEVELOPMENT_DATA_PACK_ID }) + pooledSalaryRoom(entry.clubId, year)) fail(path, 'exceeds the shared annual staff allocation including released appointments');
      feeTotals.set(feeKey, total);
      const balance = balances.get(entry.clubId)!;
      const transfers = (employment?.transfers ?? []).filter(transfer => transfer.toClubId === entry.clubId && paidTransferTotals.has(transfer.id));
      const transferReserve = transfers.reduce((sum, transfer) => sum + transfer.fee - paidTransferTotals.get(transfer.id)!, 0);
      const overdue = transfers.some(transfer => transfer.installments.filter(item => item.dueOn <= dateForRound(entryRound, year)).reduce((sum, item) => sum + item.amount, 0) > paidTransferTotals.get(transfer.id)!);
      if (!fullStaff && (overdue || balance.unpaid > 0 || !staffContracts && balance.cash < -amount + wageReserve(year, entry.clubId, index, entryRound) + transferReserve + recruitmentReserve(year, entry.clubId, index))) fail(path, 'must fund the youth fee after protecting wages and transfer holds and settling arrears');
      required.delete(key);
    } else if (kind === 'scouting') {
      if (entry.ticket !== null || entry.coach !== null) fail(path, 'must record the scout fee without unrelated details');
      const details = record(entry.scout, `${path}.scout`, ['contractId', 'scoutId']);
      const contract = scoutContracts.get(details.contractId as string), expected = required.get(key);
      if (!contract || !expected || expected.kind !== 'scouting' || contract.hiredLedgerIndex !== index || contract.scoutId !== details.scoutId || expected.seasonNumber !== year || expected.round !== entryRound || expected.amount !== amount) fail(path, 'must record exactly the hired scout fee at its original ledger boundary');
      const feeKey = `${year}/${entry.clubId}`, total = countedStaffFees(feeKey, index, year, entryRound) - amount;
      if (total > staffBudgetFor(board, entry.clubId, year, { ...worldContext, dataPackId: (worldContext as WorldContext).world?.id ?? DEVELOPMENT_DATA_PACK_ID }) + pooledSalaryRoom(entry.clubId, year)) fail(path, 'exceeds the shared annual staff allocation including released appointments');
      feeTotals.set(feeKey, total);
      const balance = balances.get(entry.clubId)!;
      const transfers = (employment?.transfers ?? []).filter(transfer => transfer.toClubId === entry.clubId && paidTransferTotals.has(transfer.id));
      const transferReserve = transfers.reduce((sum, transfer) => sum + transfer.fee - paidTransferTotals.get(transfer.id)!, 0);
      const overdue = transfers.some(transfer => transfer.installments.filter(item => item.dueOn <= dateForRound(entryRound, year)).reduce((sum, item) => sum + item.amount, 0) > paidTransferTotals.get(transfer.id)!);
      if (!fullStaff && (overdue || balance.unpaid > 0 || !staffContracts && balance.cash < -amount + wageReserve(year, entry.clubId, index, entryRound) + transferReserve + recruitmentReserve(year, entry.clubId, index))) fail(path, 'must fund the scout fee after protecting wages and transfer holds and settling arrears');
      required.delete(key);
    } else if (kind === 'coaching') {
      if (entry.ticket !== null) fail(`${path}.ticket`, 'must be empty for a coaching fee');
      const details = record(entry.coach, `${path}.coach`, ['contractId', 'coachId']);
      const coach = staffMember(COACH_DIRECTORY, details.coachId);
      if (!coach || amount !== upfront(year, entry.clubId, coach.fee)) fail(path, 'must record the full catalog coaching fee');
      const contractMatch = typeof details.contractId === 'string' ? /^coach-s([1-9]\d*)-c([1-9]\d*)$/.exec(details.contractId) : null;
      if (!contractMatch || Number(contractMatch[1]) !== year || Number(contractMatch[2]) > maximumContracts || entry.sourceId !== `coaching-${details.contractId}`) fail(`${path}.coach.contractId`, 'must identify a supported contract in this season');
      if (coachOrigins.has(details.contractId as string)) fail(`${path}.coach.contractId`, 'duplicates a paid contract');
      coachOrigins.add(details.contractId as string);
      if (!coaching.enabledSince || calendar < roundKey(coaching.enabledSince.seasonNumber, coaching.enabledSince.round)) fail(path, 'cannot charge coaching before its activation');
      if (year === seasonNumber) {
        const contract = currentContracts.get(details.contractId as string);
        const bookedRound = contract && firstYear === year ? Math.max(firstRound, contract.startedRound) : contract?.startedRound;
        if (!contract || contract.clubId !== entry.clubId || contract.coachId !== details.coachId || entryRound !== bookedRound) fail(path, 'must match its current-season coaching contract and booking round');
      }
      // Historical contracts are not archived. Their catalog fees and annual limits remain verifiable.
      const feeKey = `${year}/${entry.clubId}`, total = countedStaffFees(feeKey, index, year, entryRound) - amount;
      if (total > staffBudgetFor(board, entry.clubId, year, { ...worldContext, dataPackId: (worldContext as WorldContext).world?.id ?? DEVELOPMENT_DATA_PACK_ID }) + pooledSalaryRoom(entry.clubId, year)) fail(path, 'exceeds the shared annual staff allocation including released appointments');
      if (levelledStaff && year === seasonNumber) coachEntries.set(details.contractId as string, index);
      if (!levelledStaff || year === seasonNumber) feeTotals.set(feeKey, total);
      const balance = balances.get(entry.clubId)!;
      const transferReserve = (employment?.transfers ?? []).filter(transfer => transfer.toClubId === entry.clubId && paidTransferTotals.has(transfer.id)).reduce((sum, transfer) => sum + transfer.fee - paidTransferTotals.get(transfer.id)!, 0);
      if (!fullStaff && (balance.unpaid > 0 || !staffContracts && balance.cash < -amount + wageReserve(year, entry.clubId, index, entryRound) + transferReserve + recruitmentReserve(year, entry.clubId, index))) fail(path, 'cannot hire or renew a coach without sufficient cash, settled obligations, reserved player wages and agreed transfer installments');
    } else if (kind === 'luxury-tax' || kind === 'tax-share' || kind === 'salary-floor') {
      // Format 92: the luxury tax at the end of the NBA's regular season, and the equal shares of the clubs that paid none.
      // Format 93: in the same week, the shortfall below the minimum team salary.
      if (entry.ticket !== null || entry.coach !== null || !world?.nba || !employment || !isNbaClub(world, entry.clubId) || entry.sourceId !== `${kind}-s${year}`) fail(path, 'must be an NBA club\'s luxury tax or tax share of its season');
      if (year === seasonNumber && entryRound !== nbaRegularSeasonEndRound({ world, fixtures })) fail(path, 'must be booked in the NBA\'s last regular-season week');
      const bills = nbaTaxBills({ world, employment, fixtures: [], seasonNumber: year }, entryRound), bill = bills.bills.find(item => item.clubId === entry.clubId);
      if (kind === 'salary-floor' ? !bill || nbaSalaryFloorShortfall(bill.payroll) <= 0 || amount !== -nbaSalaryFloorShortfall(bill.payroll) : kind === 'luxury-tax' ? !bill || bill.tax <= 0 || amount !== -bill.tax : bills.share <= 0 || !bills.receivers.includes(entry.clubId) || amount !== bills.share) fail(path, 'must charge the exact luxury tax or minimum-salary shortfall on the payroll, or pay the exact equal share of a club that paid none');
      const counted = taxEntries.get(year) ?? { round: entryRound, count: 0, expected: bills.bills.filter(item => item.tax > 0).length + (bills.share > 0 ? bills.receivers.length : 0) + (world.nba.moves ? bills.bills.filter(item => nbaSalaryFloorShortfall(item.payroll) > 0).length : 0) };
      if (counted.round !== entryRound) fail(path, 'must book the season\'s luxury tax in one week');
      counted.count += 1; taxEntries.set(year, counted);
    } else if (kind === 'staff-wages' || kind === 'staff-compensation') {
      // Format 76: weekly staff salaries (checked against the contracts of the current season) and sacking compensation.
      if (entry.ticket !== null || entry.coach !== null || amount >= 0) fail(path, 'must be a staff salary or compensation payment');
      if (kind === 'staff-wages') {
        if (entry.sourceId !== staffWagesSourceId(year, entryRound)) fail(`${path}.sourceId`, 'must identify the week of the staff salaries');
        const hiredBefore = (contract: { role: string; contractId: string }) => contract.role === 'coaches' ? coachEntries.has(contract.contractId) : (staffAppointments.get(`${contract.role}/${contract.contractId}`) ?? Infinity) < index;
        if (year === seasonNumber && -amount !== staffWeekWages({ ...yearContext(year), coaching, scouts, fitness, physio, assistant, youth, seasonNumber: year }, entry.clubId, entryRound, seasonLength, hiredBefore)) fail(path, 'must pay the salaries of the staff employed that week');
      } else if (!/^staff-compensation-(coaches|scouts|fitness|physio|assistant|youth)-/.test(entry.sourceId)) fail(`${path}.sourceId`, 'must identify the contract ended early');
    } else {
      if (entry.coach !== null) fail(`${path}.coach`, 'must be empty for a non-coaching event');
      const expected = required.get(key);
      if (!expected || expected.seasonNumber !== year || expected.round !== entryRound) fail(path, 'does not match a required financial event in the calendar');
      if (kind === 'tickets') {
        const hasCapacity = !!facilities.enabledSince && index >= facilities.enabledSince.ledgerIndex;
        const ticket = record(entry.ticket, `${path}.ticket`, ['fixtureId', 'price', 'attendance', ...(hasCapacity ? ['capacity'] : [])]);
        const fixture = expected.fixture!;
        if (ticket.fixtureId !== fixture.id) fail(`${path}.ticket.fixtureId`, 'must identify its completed home fixture');
        const price = validateTicketPrice(ticket.price, `${path}.ticket.price`, yearContext(year), entry.clubId);
        if (index >= ledgerPlan.skip) {
          const gate = forecastGate({ ...worldContext, fixtures: schedules.get(year)!, seasonNumber: year, rivalries, ...(hasCapacity ? { facilities: facilitiesForGate(entry.clubId, index, fixture.date) } : {}), ...(press ? press : {}) }, fixture, price);
          if (hasCapacity && ticket.capacity !== gate.capacity) fail(`${path}.ticket.capacity`, 'must retain the actual construction-adjusted matchday capacity');
          number(ticket.attendance, `${path}.ticket.attendance`, 0, gate.capacity);
          if (ticket.attendance !== gate.attendance || amount !== gate.revenue) fail(path, 'does not match attendance and revenue from the pre-round sporting results');
        }
        if (year === seasonNumber && entryRound === round && price !== prices[entry.clubId]) fail(`${path}.ticket.price`, 'must match the current matchday locked price');
      } else {
        if (entry.ticket !== null) fail(`${path}.ticket`, 'must be empty for a non-ticket event');
        if (amount !== expected.amount) fail(`${path}.amount`, 'does not match its required financial event');
        if (kind === 'sponsor' && !sameData(entry.sponsorship ?? null, expected.sponsorship ?? null)) fail(`${path}.sponsorship`, 'must identify the agreement installment it pays');
        if (kind === 'board-capital' && !sameData(entry.boardCapital, expected.boardCapital)) fail(`${path}.boardCapital`, 'must identify the funded facility upgrade');
        if (kind === 'naming-rights' && !sameData(entry.namingRights, expected.namingRights)) fail(`${path}.namingRights`, 'must identify the naming installment it pays');
        if (kind === 'sponsor-exit' && !sameData(entry.sponsorExit, expected.sponsorExit)) fail(`${path}.sponsorExit`, 'must identify the agreement that ended early');
        if (debtKind && !sameData(entry.debt, expected.debt)) fail(`${path}.debt`, 'must identify the loan or lease payment it books');
      }
      required.delete(key);
    }

    const before = balances.get(entry.clubId)!;
    const settled = amount >= 0 ? Math.min(before.unpaid, amount) : Math.min(before.cash, -amount);
    const after = amount >= 0 ? { cash: before.cash + amount - settled, unpaid: before.unpaid - settled } : { cash: before.cash - settled, unpaid: before.unpaid - amount - settled };
    if (!Number.isSafeInteger(after.cash) || !Number.isSafeInteger(after.unpaid)) fail(path, 'exceeds supported accounting values');
    balances.set(entry.clubId, after);
    if (kind === 'operations') operatingClubs.add(entry.clubId);
    if (kind === 'payroll' && (entry.payroll as PayrollCharge | null)?.type === 'installment') payrollStarted = true;
  }
  for (const [year, counted] of taxEntries) if (counted.count !== counted.expected) fail('finance.ledger', `must book every luxury tax, tax share and minimum-salary shortfall of season ${year}`);
  if (required.size) { if ((globalThis as { DEBUG_FIN?: (keys: string[]) => void }).DEBUG_FIN) (globalThis as unknown as { DEBUG_FIN: (keys: string[]) => void }).DEBUG_FIN([...required.keys()]); fail('finance.ledger', 'is missing required calendar financial events'); }
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
    const finance = financeAtLedgerBoundary(state.finance, count), prefix = finance.ledger, paidIds = new Set(prefix.filter(entry => entry.kind === 'transfer' && entry.amount < 0).map(entry => entry.sourceId));
    const transfers = state.employment.transfers.filter(transfer => paidIds.has(transfer.id)).map(transfer => ({ ...transfer, payments: transfer.payments.filter(payment => paidIds.has(payment.id)) }));
    const agreements = state.payroll.agreements.filter(agreement => {
      const incoming = state.employment.transfers.find(transfer => transfer.startsRound > 1 && transfer.startsSeason === agreement.seasonNumber && transfer.startsRound === agreement.startsRound && transfer.playerId === agreement.playerId && transfer.toClubId === agreement.clubId);
      return !incoming || paidIds.has(incoming.id);
    });
    const replay = { ...state, seasonNumber: year, round, date, employment: { ...state.employment, transfers }, payroll: { ...state.payroll, agreements }, finance };
    const expected = financeLedgerSlice(processTransferPayments(replay).finance, count);
    // A truncated invalid log must reach the same exact-payment comparison; the bounded adapter does not clamp.
    if (!sameData(expected, financeLedgerSlice(state.finance, count, Math.min(count + expected.length, financeLedgerCount(state.finance))))) fail('finance.ledger', 'must settle due transfer installments at the recorded calendar boundary using only then-available cash');
  };
  const lastClub = state.clubs.at(-1)!.id;
  const openingSponsor = (entry: FinanceEntry | undefined, seasonNumber: number) => entry?.kind === 'sponsor' && entry.round === 1 && entry.seasonNumber === seasonNumber;
  for (const [index, entry] of ledger.entries()) {
    // The season-opening sponsorship block ends with the last paid club, which under agreements may not be the last club.
    const openingBlockEnd = openingSponsor(entry, entry.seasonNumber) && entry.seasonNumber > state.finance.enabledSince!.seasonNumber && !openingSponsor(financeLedgerEntry(state.finance, index + 1), entry.seasonNumber);
    if (openingBlockEnd || entry.clubId === lastClub && entry.kind === 'payroll' && entry.payroll?.type === 'installment') audit(index + 1, entry.seasonNumber, entry.round);
  }
  const firstYear = Math.min(...state.employment.transfers.map(transfer => transfer.startsSeason));
  for (let year = firstYear; year <= state.seasonNumber; year += 1) {
    const lastRound = year === state.seasonNumber ? state.round : seasonRounds(state);
    for (let round = 1; round <= lastRound; round += 1) {
      const date = dateForRound(round, year);
      let boundary = ledger.findIndex(entry => entry.seasonNumber === year && entry.round === round && (entry.kind === 'tickets' || entry.kind === 'operations'));
      if (boundary < 0) {
        if (year !== state.seasonNumber || round !== state.round || state.status !== 'active') continue;
        boundary = financeLedgerCount({ ledger });
      }
      // A manual salary prepayment can follow preparation on the same date and
      // release discount cash without running the calendar again. Its ledger row
      // has no automatic/manual marker. Anchor to the last actual preparation
      // receipt block, never to that optional later command's resulting cash.
      let lastReceipt = boundary - 1;
      const automaticReceipt = (entry: FinanceEntry) => entry.kind === 'transfer' && receipts.get(entry.sourceId)?.paidOn === date && state.employment.transfers.some(transfer => transfer.payments.slice(1).some(payment => payment.id === entry.sourceId));
      let receipt = financeLedgerEntry(state.finance, lastReceipt);
      while (receipt && receipt.seasonNumber === year && receipt.round === round && !automaticReceipt(receipt)) receipt = financeLedgerEntry(state.finance, --lastReceipt);
      if (receipt && receipt.seasonNumber === year && receipt.round === round && receipt.kind === 'transfer' && receipts.get(receipt.sourceId)?.paidOn === date) boundary = lastReceipt + 1;
      else if (financeLedgerSlice(state.finance, lastReceipt + 1, boundary).some(entry => entry.payroll?.type === 'prepayment')) continue;
      // Preparation can follow automatic salary prepayments. Rebuild its trailing
      // receipt block instead of running payments a second time after seller income.
      while (boundary > 0 && automaticReceipt(financeLedgerEntry(state.finance, boundary - 1)!)) boundary -= 1;
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
function validateTraining(value: unknown, clubs: readonly Team[], fixtures: SeasonFixture[], injuries: SeasonInjury[], seasonNumber: number, round: number, coaching?: SeasonCoaching, rosters?: readonly RosterSnapshot[], fitness: SeasonFitness = createFitness(), physio: SeasonPhysio = createPhysio(), version = 30, context: CareerPlayerContext & LifecycleContext & Partial<Pick<SeasonState, 'seed'>> & { facilities?: SeasonFacilities; restWeeks?: SeasonState['restWeeks']; national?: SeasonState['national']; trainingCoaches?: (seasonNumber: number, afterRound: number) => Readonly<Record<string, SteeringCoach>> | undefined } = {}): { training: SeasonTraining; conditionsAfter: Record<string, number> | null } {
  // Sprint 4: each player's hidden potential, derived from the career seed, limits his training points.
  const seed = context.seed ?? fail('seed', 'is required to check training against player potential');
  const fields = record(value, 'training', ['model', 'enabledSince', 'plans', 'points', 'lastWeek']);
  if (fields.model !== 'training-1' && fields.model !== 'training-2') fail('training.model', 'is unsupported');
  validateTrainingPlans(fields.plans, 'training.plans', clubs);
  let weeks = 0;
  if (fields.enabledSince !== null) {
    const anchor = record(fields.enabledSince, 'training.enabledSince', ['seasonNumber', 'round']);
    const year = number(anchor.seasonNumber, 'training.enabledSince.seasonNumber', 1, seasonNumber);
    const startRound = number(anchor.round, 'training.enabledSince.round', 1, year === seasonNumber ? round : seasonRounds(context));
    weeks = (seasonNumber - year) * (seasonRounds(context) - 1) + Math.min(round - 1, (seasonRounds(context) - 1)) - (startRound - 1);
  }
  const coachingWeeks = coaching ? Math.min(weeks, completedDevelopmentWeeks(coaching.enabledSince, seasonNumber, round, seasonRounds(context))) : 0;
  // Free agents retain their development; registrations only determine who trains this week.
  const catalog = getCareerPlayers(context, seasonNumber, round);
  const points = record(fields.points, 'training.points', catalog.map(player => player.id));
  const playerWeeks = (playerId: string) => {
    const graduate = context.academy?.graduates.find(entry => entry.player.id === playerId);
    return graduate ? Math.min(weeks, completedDevelopmentWeeks(graduate.availableSince, seasonNumber, round, seasonRounds(context))) : weeks;
  };
  const agingWeeks = context.lifecycle?.enabledSince ? Math.min(weeks, completedDevelopmentWeeks(context.lifecycle.enabledSince, seasonNumber, round, seasonRounds(context))) : 0;
  const facilityWeeks = context.facilities?.enabledSince ? Math.min(weeks, completedDevelopmentWeeks(context.facilities.enabledSince, seasonNumber, round, seasonRounds(context))) : 0;
  const pointBudget = (id: string, prior = false) => {
    const available = Math.max(0, playerWeeks(id) - Number(prior)), coached = Math.min(available, Math.max(0, coachingWeeks - Number(prior)));
    const weighted = Math.min(available, Math.max(0, agingWeeks - Number(prior)));
    return available * 35 + weighted * 8 + coached * 8 + Math.min(coached, weighted) * 2 + Math.min(available, Math.max(0, facilityWeeks - Number(prior))) * 4;
  };
  for (const player of catalog) {
    const entry = record(points[player.id], `training.points.${player.id}`, TRAINING_ATTRIBUTES), headroom = trainingHeadroom({ ...context, seed, training: { model: fields.model } }, player.id);
    for (const attribute of TRAINING_ATTRIBUTES) number(entry[attribute], `training.points.${player.id}.${attribute}`, 0, potentialPointCap(headroom, player.attributes[attribute]));
    if (TRAINING_ATTRIBUTES.reduce((total, attribute) => total + (entry[attribute] as number), 0) > pointBudget(player.id)) fail(`training.points.${player.id}`, 'exceeds available training weeks');
  }
  const training = fields as unknown as SeasonTraining, anchor = training.enabledSince;
  const needsReport = anchor !== null && round > 1 && (anchor.seasonNumber < seasonNumber || anchor.round < round);
  if (!needsReport) {
    if (fields.lastWeek !== null) fail('training.lastWeek', 'must be empty before an enabled training interval or after rollover');
    return { training, conditionsAfter: null };
  }
  const report = record(fields.lastWeek, 'training.lastWeek', ['seasonNumber', 'afterRound', 'fromDate', 'toDate', 'plans', 'players', ...(coaching ? ['coaching'] : []), ...(rosters ? ['rosterIds'] : []), ...(version >= 22 && fields.lastWeek !== null && typeof fields.lastWeek === 'object' && Object.hasOwn(fields.lastWeek, 'fitness') ? ['fitness'] : [])]);
  const afterRound = Math.min(round - 1, (seasonRounds(context) - 1));
  if (report.seasonNumber !== seasonNumber || report.afterRound !== afterRound || report.fromDate !== weekLastGameDate(fixtures, afterRound, seasonNumber) || report.toDate !== dateForRound(afterRound + 1, seasonNumber)) fail('training.lastWeek', 'must identify the most recent completed training interval');
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
      if (Object.hasOwn(entry, 'facility')) { const bonus = record(entry.facility, `${path}.facility`, ['earnedPoints', 'gains']); number(bonus.earnedPoints, `${path}.facility.earnedPoints`, -4, 4); record(bonus.gains, `${path}.facility.gains`, TRAINING_ATTRIBUTES); }
      if (Object.hasOwn(entry, 'aging')) record(entry.aging, `${path}.aging`, ['ordinaryPracticePoints', 'adjustedPracticePoints', 'rateBasisPoints']);
      if (!TRAINING_FOCUSES.includes(entry.focus as TrainingPlan['focus']) || !TRAINING_INTENSITIES.includes(entry.intensity as TrainingPlan['intensity'])) fail(path, 'has unsupported training instructions');
      number(entry.availableDays, `${path}.availableDays`, 0, 7);
      number(entry.conditionBefore, `${path}.conditionBefore`, 35, 100, false);
      number(entry.conditionAfter, `${path}.conditionAfter`, 35, 100, false);
      conditionsBefore[player.id] = weekCloseCondition({ fixtures, restWeeks: context.restWeeks, seasonNumber }, afterRound, club.id, player.id)!;
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
  // Format 86: each club's head coach during this training, from the opening coaches and the board's changes before it.
  const headCoaches = context.trainingCoaches?.(seasonNumber, afterRound);
  const replayed = processTrainingWeek({
    ...(context.world ? { world: context.world } : {}), seed, ...(headCoaches ? { headCoaches } : {}),
    training: { ...training, plans: appliedPlans, points: pointsBefore, lastWeek: null }, clubs: intervalClubs, conditions: conditionsBefore,
    // Final-round injuries happen after the last training day and must not be replayed into it.
    injuries: injuries.filter(injury => injury.occurredOn <= (report.fromDate as string)),
    seasonNumber, afterRound, fromDate: report.fromDate as string, toDate: report.toDate as string, coaching: appliedCoaching, rosters, fitness, physio, lifecycle: context.lifecycle, academy: context.academy, facilities: context.facilities,
    // Format 80: called-up players' national duty, from the stored national squads and minutes.
    ...(context.national ? { nationalDuty: nationalDutyDays(context.national, report.fromDate as string, report.toDate as string) } : {}),
  });
  const replayedReport = rosters ? replayed.training.lastWeek : withoutRosterReport(replayed.training.lastWeek);
  if (!sameData(coaching ? replayedReport : withoutCoachingReport(replayedReport), training.lastWeek) || !sameData(replayed.training.points, training.points)) fail('training.lastWeek', 'does not reconcile with training plans, coaching, fitness staffing, availability, recovery and development');
  return { training, conditionsAfter: replayed.conditions };
}

/** Older schemas keep their original constraints before migration adds career fields. */
/** Format 67: the media record of a career created with it; press answers and standing are checked with relationships and board reviews. */
function validateMediaShape(value: unknown, state: SeasonState): void {
  const media = record(value, 'media', ['model', 'since']);
  if (media.model !== 'media-1') fail('media.model', 'is unsupported');
  const since = record(media.since, 'media.since', ['seasonNumber', 'round', 'date']);
  if (since.seasonNumber !== 1 || since.round !== 1 || since.date !== dateForRound(1, 1)) fail('media.since', 'must be the career opening');
  const relationships = state.relationships as SeasonRelationships | undefined;
  if (!relationships?.enabledSince || relationships.enabledSince.seasonNumber !== 1 || relationships.enabledSince.round !== 1 || relationships.enabledSince.completedRounds !== 0) fail('media', 'requires squad relationships from the career opening');
}

function validateState(value: unknown, version: SeasonFormatVersion): void {
  // A cheap cache-admission hint, not trusted evidence. Malformed inputs still receive every normal check.
  const candidate = value && typeof value === 'object' ? value as Partial<SeasonState> : null;
  const workload = candidate && Array.isArray(candidate.clubs) && Number.isSafeInteger(candidate.seasonNumber) && candidate.seasonNumber! > 0 ? candidate.clubs.length * candidate.seasonNumber! : Infinity;
  // Legacy full-detail evidence can be much larger than its migrated representation. Check it normally;
  // only the current-format replay may populate/exhaust the reusable cache.
  // An incremental checkpoint check (`trusted-prefix.ts`) replays only the latest weeks: identifying its large inputs for
  // reuse would cost more than it saves, so it runs without the replay cache (which never holds verdicts).
  const checked = (run: () => void) => version === SEASON_SCHEMA_VERSION && trustedCutKey() === -Infinity ? validationReplayCache.run(() => withCalculationCache(run), workload) : withCalculationCache(run);
  // Never keep a second full ledger in live state, or carry a cached acceptance across mutable inputs.
  if (version >= 44 && value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const state = value as Record<string, unknown>;
    if (state.finance && typeof state.finance === 'object' && Object.hasOwn(state.finance, 'archives')) checkStateTree(value);
    const finance = expandFinanceForValidation(state.finance, state.seasonNumber);
    checked(() => validateStateUncached(finance === state.finance ? state : { ...state, finance }, version));
  } else checked(() => validateStateUncached(value, version));
}

function validateStateUncached(value: unknown, version: SeasonFormatVersion): void {
  const legacy = version === 1, career = version >= 3;
  checkStateTree(value);
  const state = record(value, 'state', ['schemaVersion', 'engineVersion', 'dataPackId', 'seed', 'managedClubId', 'date', 'status', 'round', 'clubs', 'plans', 'conditions', 'fixtures', 'activeFixtureId', 'activeMatch', ...(legacy ? [] : ['injuryMode', 'injuries']), ...(career ? ['seasonNumber', 'history'] : []), ...(version >= 4 ? ['training'] : []), ...(version >= 5 ? ['coaching'] : []), ...(version >= 6 ? ['finance'] : []), ...(version >= 7 ? ['payroll'] : []), ...(version >= 8 ? ['manager'] : []), ...(version >= 9 ? ['rosters'] : []), ...(version >= 10 ? ['employment'] : []), ...(version >= 11 ? ['scouting'] : []), ...(version >= 12 ? ['negotiations'] : []), ...(version >= 13 ? ['market'] : []), ...(version >= 18 ? ['recruitment'] : []), ...(version >= 21 ? ['scouts'] : []), ...(version >= 22 ? ['fitness'] : []), ...(version >= 23 ? ['physio'] : []), ...(version >= 24 ? ['assistant'] : []), ...(version >= 25 ? ['academy', 'youth'] : []), ...(version >= 26 ? ['lifecycle'] : []), ...(version >= 27 ? ['youthCompetition'] : []), ...(version >= 28 ? ['facilities'] : []), ...(version >= 29 ? ['relationships'] : []), ...(version >= 30 ? ['board'] : []), ...(version >= 37 ? ['commercial', 'rivalries', 'career'] : version >= 35 ? ['commercial', 'rivalries'] : version >= 31 ? ['commercial'] : []), ...(version >= 47 && value !== null && typeof value === 'object' && Object.hasOwn(value, 'restWeeks') ? ['restWeeks'] : []), ...(version >= 50 && value !== null && typeof value === 'object' && Object.hasOwn(value, 'divisions') ? ['divisions'] : []), ...(version >= 53 && value !== null && typeof value === 'object' && Object.hasOwn(value, 'background') ? ['background'] : []), ...(version >= 60 && value !== null && typeof value === 'object' && Object.hasOwn(value, 'europe') ? ['europe'] : []), ...(value !== null && typeof value === 'object' && Object.hasOwn(value, 'media') ? ['media'] : []), ...(value !== null && typeof value === 'object' && Object.hasOwn(value, 'economySeasons') ? ['economySeasons'] : []), ...(value !== null && typeof value === 'object' && Object.hasOwn(value, 'injuryModel') ? ['injuryModel'] : []), ...(value !== null && typeof value === 'object' && Object.hasOwn(value, 'matchModel') ? ['matchModel'] : []), ...(value !== null && typeof value === 'object' && Object.hasOwn(value, 'national') ? ['national'] : []), ...(value !== null && typeof value === 'object' && Object.hasOwn(value, 'coaches') ? ['coaches'] : []), ...(value !== null && typeof value === 'object' && Object.hasOwn(value, 'trades') ? ['trades'] : []), ...(version >= 39 && value !== null && typeof value === 'object' && Object.hasOwn(value, 'world') ? ['world'] : [])]);
  if (state.schemaVersion !== version || state.engineVersion !== 'possession-3') fail('state', 'uses an unsupported schema or engine');
  // Format 39: careers outside the built-in league carry their world, which must be complete and named by dataPackId.
  if (Object.hasOwn(state, 'world')) {
    if (version < 39) fail('world', 'is not supported before format 39');
    try { validateWorld(state.world); } catch (error) { fail('world', error instanceof Error ? error.message.replace(/^Invalid career world: /, '').replace(/\.$/, '') : 'is invalid'); }
    if (state.dataPackId !== (state.world as CareerWorld).id || state.dataPackId === DEVELOPMENT_DATA_PACK_ID) fail('dataPackId', 'must name the world the career carries');
  } else if (state.dataPackId !== DEVELOPMENT_DATA_PACK_ID) fail('state', 'uses an unsupported data pack');
  const world = worldOf(state as unknown as SeasonState);
  const fullRoster = usesFullClubRoster({ world });
  if (world.domesticLeagues && version < 47) fail('world.domesticLeagues', 'requires format 47 or later');
  for (const league of world.domesticLeagues ?? []) if (Object.hasOwn(league, 'standingsRule') && version < STANDINGS_RULE_FORMAT[league.standingsRule!]) fail('world.domesticLeagues.standingsRule', `requires format ${STANDINGS_RULE_FORMAT[league.standingsRule!]} or later`);
  if (version < 49 && world.domesticLeagues?.some(league => Object.hasOwn(league, 'postseason'))) fail('world.domesticLeagues.postseason', 'requires format 49 or later');
  if (version < 50 && Object.hasOwn(world, 'playerContracts')) fail('world.playerContracts', 'requires format 50 or later');
  if (version < 53 && Object.hasOwn(world, 'lowerDivisions')) fail('world.lowerDivisions', 'requires format 53 or later');
  if (version < 56 && Object.hasOwn(world, 'europeanCompetitions')) fail('world.europeanCompetitions', 'requires format 56 or later');
  for (const competition of world.europeanCompetitions ?? []) if (Object.hasOwn(competition, 'format')) {
    const since = Object.hasOwn(EUROPEAN_FORMAT_VERSION, competition.format!) ? EUROPEAN_FORMAT_VERSION[competition.format!] : 57;
    if (version < since) fail('world.europeanCompetitions.format', `requires format ${since} or later`);
  }
  // Format 60 (step 3.5f): European places, unchosen top divisions and one-year EuroLeague places.
  if (version < 60 && (Object.hasOwn(world, 'europeanPlaces') || Object.hasOwn(world, 'backgroundLeagues') || world.europeanCompetitions?.some(competition => Object.hasOwn(competition, 'oneYear')))) fail('world.europeanPlaces', 'requires format 60 or later');
  // Format 62 (sprint 4): researched club money; older careers keep the development economy's constants.
  if (version < 62 && Object.hasOwn(world, 'economy')) fail('world.economy', 'requires format 62 or later');
  // Format 85: neutral venues and next-division countries are rules of new careers only.
  for (const key of ['neutralVenues', 'nextDivisionCountries'] as const) if (version < 85 && Object.hasOwn(world, key)) fail(`world.${key}`, 'requires format 85 or later');
  // Format 86: head coaches who steer their clubs (`coaches-2`) are a rule of new careers only; checked before anything they change.
  if (version < 86 && state.coaches !== null && typeof state.coaches === 'object' && (state.coaches as { model?: unknown }).model === COACH_STEERING_MODEL) fail('coaches.model', 'needs format 86 or later to steer clubs');
  // Format 87: the economy balance is a rule of new careers only.
  if (version < 87 && Object.hasOwn(world, 'economyBalance')) fail('world.economyBalance', 'requires format 87 or later');
  // Format 88: rich clubs' surplus spending is a rule of new careers only.
  if (version < 88 && Object.hasOwn(world, 'surplusSpending')) fail('world.surplusSpending', 'requires format 88 or later');
  // Format 89: the spending balance is a rule of new careers only.
  if (version < 89 && Object.hasOwn(world, 'spendingBalance')) fail('world.spendingBalance', 'requires format 89 or later');
  // Format 90: the NBA (its league, standings rule and postseason) is a rule of new careers only.
  if (version < 92 && world.nba && Object.hasOwn(world.nba, 'cap')) fail('world.nba.cap', 'requires format 92 or later');
  // Format 93 (NBA step 7, provisional): free agency and NBA-Europe moves.
  if (version < 93 && world.nba && Object.hasOwn(world.nba, 'moves')) fail('world.nba.moves', 'requires format 93 or later');
  if (version < 90 && (Object.hasOwn(world, 'nba') || world.domesticLeagues?.some(league => league.postseason === 'nba-2026-1'))) fail('world.nba', 'requires format 90 or later');
  // Format 91: NBA careers (real NBA head coaches, NBA job rules).
  if (version < 91 && Object.hasOwn(world, 'nbaJobs')) fail('world.nbaJobs', 'requires format 91 or later');
  // Format 94: NBA trades (the world marker, the offer journal and completed trades).
  if (version < TRADES_FORMAT && Object.hasOwn(world, 'nbaTrades')) fail('world.nbaTrades', `requires format ${TRADES_FORMAT} or later`);
  if (version < TRADES_FORMAT && Object.hasOwn(state, 'trades')) fail('trades', `requires format ${TRADES_FORMAT} or later`);
  // Format 63: the career-2 rules (protected first season, fresh confidence, mid-season moves, resignations) need it.
  const careerModel = state.career !== null && typeof state.career === 'object' ? (state.career as { model?: unknown }).model : undefined;
  if (version < 63 && (careerModel === 'career-2' || state.board !== null && typeof state.board === 'object' && Object.hasOwn(state.board, 'restarts'))) fail('career.model', 'requires format 63 or later');
  // Format 69: careers with unemployed seasons (`career-3`); an unemployed manager has no managed club (empty id).
  if (version < 69 && careerModel === 'career-3') fail('career.model', 'requires format 69 or later');
  const careerMoves = careerModel === 'career-3' && Array.isArray((state.career as { moves?: unknown }).moves) ? (state.career as { moves: unknown[] }).moves : [];
  const lastMove = careerMoves.at(-1) as { toClubId?: unknown } | undefined;
  const unemployed = careerModel === 'career-3' && state.managedClubId === NO_CLUB && !!lastMove && typeof lastMove === 'object' && lastMove.toClubId === NO_CLUB;
  // Format 72: per-season club money, shape first; it is re-derived exactly once the history is validated.
  validateEconomySeasonsShape(state, version);
  const economySeasons = Object.hasOwn(state, 'economySeasons') ? state.economySeasons as SeasonEconomy : undefined;
  const usesEurope = version >= 60 && Object.hasOwn(world, 'europeanPlaces');
  if (usesEurope !== Object.hasOwn(state, 'europe')) fail('europe', usesEurope ? 'must record this season\'s European places' : 'requires format 60 and a world with European places');
  const seasonEurope = usesEurope ? validateEuropeShape(state.europe, world, 'europe', version) : undefined;
  // Format 53 listed identities only; from format 54 the next-division clubs are in the world.
  if (world.lowerDivisions?.some(entry => isMemberList(entry) !== (version >= 54))) fail('world.lowerDivisions', version >= 54 ? 'must list clubs of the world from format 54' : 'requires format 54 to list clubs of the world');
  // Format 50: careers whose leagues have postseasons record each season's divisions.
  const usesDivisions = version >= 50 && !!world.domesticLeagues?.some(league => league.postseason);
  if (usesDivisions !== Object.hasOwn(state, 'divisions')) fail('divisions', usesDivisions ? 'must record this season\'s division memberships' : 'requires format 50 and leagues with postseasons');
  const seasonDivisions = usesDivisions ? validateDivisionShape(state.divisions, world, 'divisions', number(state.seasonNumber, 'seasonNumber', 1, MAX_SEASON_NUMBER)) : undefined;
  // Format 53: careers that record divisions also record the clubs outside the full world.
  if ((usesDivisions && version >= 53) !== Object.hasOwn(state, 'background')) fail('background', usesDivisions && version >= 53 ? 'must record the clubs outside the full world' : 'requires format 53 and recorded divisions');
  if (fullRoster && version < 46) fail('world.rosterModel', 'requires format 46 or later');
  if (version >= 8 && state.manager !== null && !sameData(state.manager, validateManagerProfile(state.manager, DEVELOPMENT_START_DATE))) fail('manager', 'must contain normalized profile details valid at the initial career date');
  const seed = number(state.seed, 'seed', 0, 0xffff_ffff), round = number(state.round, 'round', 1, worldRounds(world));
  const seasonNumber = career ? number(state.seasonNumber, 'seasonNumber', 1, MAX_SEASON_NUMBER) : 1;
  const injuryMode = legacy ? 'off' : state.injuryMode;
  if (!['standard', 'reduced', 'off'].includes(injuryMode as string)) fail('injuryMode', 'must be standard, reduced or off');
  // Owner feedback (22 November 2026): new careers diagnose match injuries with the longer `injuries-2` durations.
  if (Object.hasOwn(state, 'injuryModel') && state.injuryModel !== INJURY_MODEL_2) fail('injuryModel', 'must be injuries-2 when recorded');
  // Format 76 guard: the longer injury lengths arrived with format 76; older saves without the field are unaffected.
  if (Object.hasOwn(state, 'injuryModel') && version < 76) fail('injuryModel', 'requires format 76 or later (careers created with the longer injury lengths)');
  const injuryModel = Object.hasOwn(state, 'injuryModel') ? INJURY_MODEL_2 : undefined;
  // The bound scales with the games recorded (step 3.7): realistic injuries in a 70-club world with Europe pass 600 a season.
  const recordedGames = (Array.isArray(state.fixtures) ? state.fixtures.length : 0) + (Array.isArray(state.history) ? state.history.reduce((count: number, archive: unknown) => count + (archive && typeof archive === 'object' && Array.isArray((archive as { fixtures?: unknown }).fixtures) ? (archive as { fixtures: unknown[] }).fixtures.length : 0), 0) : 0);
  if (!legacy && (!Array.isArray(state.injuries) || state.injuries.length > 600 * seasonNumber + 3 * recordedGames)) fail('injuries', 'must be a bounded injury history');
  if (state.status !== 'active' && state.status !== 'complete') fail('status', 'must be active or complete');
  if (state.status === 'complete' && round !== worldRounds(world)) fail('round', 'must reach the final matchday before completion');
  // A club that joined the full world from a next division (step 3.4d-2) can appoint the manager too (22 November 2026:
  // a manager dismissed at a season end took the job of a club promoted the season before). Here only the world's
  // catalog is checked; membership of this season's leagues is checked against the season's clubs below.
  if (typeof state.managedClubId !== 'string' || !unemployed && !isWorldClub(world, state.managedClubId) && !world.clubs.some(club => club.id === state.managedClubId)) fail('managedClubId', 'must identify a club in this league');
  const academy = version >= 25 ? validateAcademyShape(state.academy, state as unknown as SeasonState, version) : createAcademy();
  const lifecycle = version >= 26 ? validateLifecycleShape(state.lifecycle, state as unknown as SeasonState) : createLifecycle();
  const youthCompetition = version >= 27 ? validateYouthCompetitionShape(state.youthCompetition, state as unknown as SeasonState, version) : createYouthCompetition();
  const facilities = version >= 28 ? validateFacilitiesShape(state.facilities, state as unknown as SeasonState, version) : createFacilities(fullWorldClubs(world), state.managedClubId, 'facilities-1');
  const relationships = version >= 29 ? state.relationships as unknown as SeasonRelationships : createRelationships();
  const board = version >= 30 ? state.board as unknown as SeasonBoard : createBoard();
  const commercial = version >= 31 ? state.commercial as unknown as SeasonCommercial : createCommercial(fullWorldClubs(world), state.managedClubId as string);
  if (version >= 35) validateRivalries(state.rivalries, state as unknown as SeasonState, version);
  const rivalries = version >= 35 ? state.rivalries as unknown as SeasonRivalries : createRivalries();
  const careerRecord = version >= 37 ? state.career as unknown as SeasonCareer : undefined;
  const careerContext: CareerPlayerContext & Pick<SeasonState, 'seed'> & Partial<Pick<SeasonState, 'career'>> = { world, academy, lifecycle, seasonNumber, round, date: state.date as string, seed, ...(version >= 37 ? { career: state.career as SeasonCareer } : {}), ...(Object.hasOwn(state, 'background') ? { background: state.background as SeasonBackground } : {}), ...(economySeasons ? { economySeasons } : {}) };
  const marketEnabled = version >= 13 && record(state.market, 'market', ['model', 'enabledSince', 'windows']).enabledSince !== null;
  // Every later replay attributes decisions through the validated moves.
  if (version >= 37) validateCareer(state.career, state as unknown as SeasonState, version);
  if (Object.hasOwn(state, 'background')) validateBackground(state.background, { ...(state as unknown as SeasonState), divisions: seasonDivisions }, version);
  // Format 70: board-2 season verdicts change player salary budgets, so the salary checks read the board.
  const employmentContext = { ...careerContext, ...((board as SeasonBoard | undefined)?.model === 'board-2' ? { board } : {}), ...(contractRolesApply({ relationships }) ? { relationships } : {}), ...(version >= 75 && usesWagePool({ coaching: state.coaching as { model: string } | undefined }) ? { wagePool: true } : {}) };
  const employment = version >= 10 ? validateEmployment(state.employment, seasonNumber, round, state.status, state.managedClubId, marketEnabled, version, employmentContext) : undefined;
  if (!sameData(state.clubs, clubsForEmploymentYear(employment, seasonNumber, round, careerContext))) fail('clubs', 'must match the versioned player catalog and effective employment registrations');
  if (version >= 55 && Object.hasOwn(state, 'background')) validateBackgroundHistory(state as unknown as SeasonState, employment, careerContext);
  const clubs = state.clubs as readonly Team[], clubIds = clubs.map(club => club.id);
  const rosters = version >= 9 ? validateRosters(state.rosters, 'rosters', clubs, seasonNumber, employment, round, careerContext) : undefined;
  if (typeof state.managedClubId !== 'string' || !unemployed && !clubIds.includes(state.managedClubId)) fail('managedClubId', 'must identify a club in this league');
  const plans = record(state.plans, 'plans', clubIds);
  const playerIds = getCareerPlayers(careerContext, seasonNumber, round).map(player => player.id);
  const conditions = record(state.conditions, 'conditions', playerIds);
  for (const playerId of playerIds) number(conditions[playerId], `conditions.${playerId}`, 0, 100, false);
  const registeredPlayers = new Set(clubs.flatMap(club => club.players.map(player => player.id)));
  for (const playerId of playerIds) if (!registeredPlayers.has(playerId) && conditions[playerId] !== 100) fail(`conditions.${playerId}`, 'must retain offseason recovery while the player remains unregistered');
  for (const club of clubs) {
    const planValue = plans[club.id], circled = planValue !== null && typeof planValue === 'object' && Object.hasOwn(planValue, 'slots');
    const plan = record(planValue, `plans.${club.id}`, ['tactics', 'lineup', 'autoSubstitutions', ...(fullRoster ? ['matchday'] : []), ...(circled ? ['slots'] : [])]);
    if (fullRoster && plan.matchday !== null) { try { selectedTeam(club, plan.matchday as string[]); } catch { fail(`plans.${club.id}.matchday`, 'must select five to twelve distinct registered players'); } }
    const tactics = record(plan.tactics, `plans.${club.id}.tactics`, ['tempo', 'outsideShare', 'pressure']);
    for (const key of ['tempo', 'outsideShare', 'pressure']) number(tactics[key], `plans.${club.id}.tactics.${key}`, 0, 1, false);
    const lineup = array(plan.lineup, `plans.${club.id}.lineup`, 5);
    if (new Set(lineup).size !== 5 || lineup.some(id => !club.players.some(player => player.id === id))) fail(`plans.${club.id}.lineup`, 'must select five distinct players from its club');
    // Format 74: the circles the manager chose for planned starters, one different position each.
    if (circled) {
      const circles = (plan.slots !== null && typeof plan.slots === 'object' && !Array.isArray(plan.slots) ? plan.slots : fail(`plans.${club.id}.slots`, 'must be an object')) as Record<string, unknown>, chosen = Object.keys(circles);
      if (!chosen.length || chosen.some(id => !lineup.includes(id)) || new Set(Object.values(circles)).size !== chosen.length || Object.values(circles).some(value => !isCourtPosition(value))) fail(`plans.${club.id}.slots`, 'must give planned starters a different court position each');
    }
    if (typeof plan.autoSubstitutions !== 'boolean' || club.id !== state.managedClubId && !plan.autoSubstitutions) fail(`plans.${club.id}.autoSubstitutions`, 'must be boolean and enabled for opponent clubs');
    for (const player of club.players) number(conditions[player.id], `conditions.${player.id}`, 0, 100, false);
  }
  const coaching = version >= 5 ? validateCoaching(state.coaching, clubs, seasonNumber, round, worldRounds(world), version) : undefined;
  const scouts = version >= 21 ? validateScouts(state.scouts, state as unknown as SeasonState, coaching!) : createScouts();
  const fitness = version >= 22 ? validateFitness(state.fitness, state as unknown as SeasonState, coaching!, scouts) : createFitness();
  const physio = version >= 23 ? validatePhysio(state.physio, state as unknown as SeasonState, coaching!, scouts, fitness) : createPhysio();
  const assistant = version >= 24 ? validateAssistant(state.assistant, state as unknown as SeasonState, coaching!, scouts, fitness, physio) : createAssistant();
  const youth = version >= 25 ? validateYouth(state.youth, state as unknown as SeasonState, coaching!, scouts, fitness, physio, assistant) : createYouth();
  validateAcademyHistory({ ...state, academy, youth, youthCompetition, facilities } as unknown as SeasonState, version);
  validateRehabilitation(physio, state as unknown as SeasonState, employment);
  const history: SeasonInjury[] = [];
  const latestInjuries = new Map<string, SeasonInjury>();
  // Format 80: injuries from national games join the chronological history before the first club game after them.
  const nationalInjuries = Object.hasOwn(state, 'national') && Array.isArray(state.injuries) ? (state.injuries as unknown[]).filter(injury => injury !== null && typeof injury === 'object' && typeof (injury as { fixtureId?: unknown }).fixtureId === 'string' && isNationalFixtureId((injury as { fixtureId: string }).fixtureId)).sort((a, b) => {
    const left = a as SeasonInjury, right = b as SeasonInjury;
    return left.occurredOn < right.occurredOn ? -1 : left.occurredOn > right.occurredOn ? 1 : left.id < right.id ? -1 : 1;
  }) : [];
  let nationalAt = 0;
  function recordNationalInjuriesBefore(date: string): void {
    while (nationalAt < nationalInjuries.length && typeof (nationalInjuries[nationalAt] as SeasonInjury).occurredOn === 'string' && (nationalInjuries[nationalAt] as SeasonInjury).occurredOn < date) {
      const path = `injuries.${String((nationalInjuries[nationalAt] as SeasonInjury).id)}`;
      const injury = validateNationalInjury(nationalInjuries[nationalAt], path, state.national, careerContext, history, { seed, world, facilities, injuryModel });
      history.push(injury);
      latestInjuries.set(injury.playerId, injury);
      nationalAt += 1;
    }
  }
  function recordFixtureInjuries(result: ArchivedFixture['result'], expected: SeasonFixture, home: Team, away: Team, path: string, stats?: FixtureResult['stats']): void {
    recordNationalInjuriesBefore(expected.date);
    const participants = new Set([...home.players, ...away.players].map(player => player.id));
    const carried = [...latestInjuries.values()].filter(injury => participants.has(injury.playerId) && isRecovering(injury, expected.date, physio));
    for (const injury of carried) {
      if (result.injuries[injury.playerId] !== injury.kind) fail(`${path}.result.injuries`, 'must retain every player still recovering at this fixture');
      const evidence = stats?.[injury.playerId] ?? result.appearances?.[injury.playerId];
      if (evidence) {
        if ('appeared' in evidence) { if (evidence.appeared || evidence.secondsPlayed || evidence.fouls) fail(`${path}.result.appearances`, 'cannot record play during a carried injury'); }
        else requireNoPlay(evidence, `${path}.result.stats.${injury.playerId}`);
      }
    }
    for (const [id, kind] of Object.entries(result.injuries)) {
      if (carried.some(injury => injury.playerId === id)) continue;
      if (injuryMode === 'off') fail(`${path}.result.injuries`, 'cannot record a new injury while injuries are off');
      const evidence = stats?.[id] ?? result.appearances?.[id];
      if (evidence && evidence.secondsPlayed === 0) fail(`${path}.result.injuries.${id}`, 'requires exposure in its originating fixture');
      const club = home.players.some(player => player.id === id) ? home : away;
      // Recurrences last longer: the player's earlier diagnoses are already in the chronological history.
      const injury = createSeasonInjury(seed, expected, club.id, id, kind, history, medicalRecoveryPercent({ world, facilities }, club.id, expected.date), injuryModel);
      history.push(injury);
      latestInjuries.set(id, injury);
    }
  }
  // Step 3.5b: a background side's selection follows from its season's squad and the injuries committed before the game.
  const sides = backgroundSides(careerContext);
  const backgroundSelection = (year: number, fixture: SeasonFixture): BackgroundSelection => clubId => {
    const squad = sides(clubId, year), ids = new Set(squad.players.map(player => player.id));
    return { rosterId: backgroundRosterId(clubId, year), team: selectBackgroundMatchday(squad, new Set(history.filter(injury => injury.fixtureId !== fixture.id && ids.has(injury.playerId) && isRecovering(injury, fixture.date, physio)).map(injury => injury.playerId))) };
  };
  // Format 73: a sealed game's new diagnoses are its stored injuries, in their original order (its players' per-game
  // participation is no longer kept). Later recurrences still read them from the chronological history.
  const storedInjuries = new Map<string, unknown[]>();
  if (version >= SEALED_HISTORY_FORMAT && Array.isArray(state.injuries)) for (const injury of state.injuries as unknown[]) {
    const fixtureId = injury !== null && typeof injury === 'object' ? (injury as { fixtureId?: unknown }).fixtureId : undefined;
    if (typeof fixtureId === 'string') { const list = storedInjuries.get(fixtureId) ?? []; list.push(injury); storedInjuries.set(fixtureId, list); }
  }
  function recordSealedInjuries(result: ArchivedFixture['result'], expected: SeasonFixture, home: Team, away: Team, path: string): void {
    recordNationalInjuriesBefore(expected.date);
    for (const raw of storedInjuries.get(expected.id) ?? []) {
      const injury = record(raw, `${path}.result.injuries`, ['id', 'playerId', 'clubId', 'kind', 'fixtureId', 'occurredOn', 'returnOn']) as unknown as SeasonInjury;
      const team = injury.clubId === home.id ? home : injury.clubId === away.id ? away : null;
      if (!team || !team.players.some(player => player.id === injury.playerId) || result.injuries[injury.playerId] !== injury.kind || injury.occurredOn !== expected.date || typeof injury.id !== 'string' || typeof injury.returnOn !== 'string' || injury.returnOn <= injury.occurredOn) fail(`${path}.result.injuries`, 'must match the diagnoses recorded for this game');
      history.push(injury);
      latestInjuries.set(injury.playerId, injury);
    }
  }
  if (career) {
    const archives = array(state.history, 'history', seasonNumber - 1);
    // Incremental checkpoint checks (`trusted-prefix.ts`): completed seasons equal the trusted checkpoint's, whose check
    // validated them; resume with the injury history their games left.
    const archived = recall<{ history: SeasonInjury[]; latest: [string, SeasonInjury][] }>('history', 'injuries');
    if (archived) { history.push(...archived.history); for (const [playerId, injury] of archived.latest) latestInjuries.set(playerId, injury); }
    if (!archived) for (const [archiveIndex, value] of archives.entries()) {
      const path = `history[${archiveIndex}]`, summarized = version >= 45 && value !== null && typeof value === 'object' && Object.hasOwn(value, 'summary');
      const archive = record(value, path, ['seasonNumber', 'fixtures', ...(version >= 9 ? ['rosters'] : []), ...(summarized ? ['summary'] : []), ...(usesDivisions && value !== null && typeof value === 'object' && Object.hasOwn(value, 'divisions') ? ['divisions'] : []), ...(usesEurope ? ['europe'] : [])]);
      const archiveDivisions = archive.divisions === undefined ? undefined : validateDivisionShape(archive.divisions, world, `${path}.divisions`, archiveIndex + 1);
      if (archive.seasonNumber !== archiveIndex + 1) fail(`${path}.seasonNumber`, 'must preserve every previous season in order');
      // That season's own full-world clubs (step 3.4d-2).
      const archiveClubs = clubsForEmploymentYear(employment, archiveIndex + 1, worldRounds(world), careerContext);
      const archivedRosters = version >= 9 ? validateRosters(archive.rosters, `${path}.rosters`, archiveClubs, archiveIndex + 1, employment, worldRounds(world), careerContext) : undefined;
      const archiveEurope = usesEurope ? validateEuropeShape(archive.europe, world, `${path}.europe`, version) : undefined;
      const schedule = canonicalFixtures({ clubs: archiveClubs, fixtures: archive.fixtures, world, divisions: archiveDivisions, seed, ...(archiveEurope ? { europe: archiveEurope } : {}), ...(Object.hasOwn(state, 'national') ? { national: true } : {}) }, archiveIndex + 1, `${path}.fixtures`);
      const fixtures = array(archive.fixtures, `${path}.fixtures`, schedule.length);
      let hasPlayerStats: boolean | undefined;
      for (const [index, value] of fixtures.entries()) {
        const location = `${path}.fixtures[${index}]`, expected = schedule[index]!;
        const fixture = record(value, location, fixtureKeys(expected));
        for (const key of fixtureKeys(expected)) if (key !== 'result' && fixture[key] !== expected[key as keyof SeasonFixture]) fail(location, 'does not match the versioned schedule');
        if (version >= SEALED_HISTORY_FORMAT && fixture.result !== null && typeof fixture.result === 'object' && Object.hasOwn(fixture.result, 'fouls')) {
          if (archiveIndex + 1 > seniorSealedThrough(seasonNumber) || !archivedRosters) fail(`${location}.result`, 'can be sealed only in seasons before the latest completed one');
          const managed = managedClubFor(state as unknown as SeasonState, archiveIndex + 1, false);
          if (expected.homeClubId === managed || expected.awayClubId === managed) fail(`${location}.result`, 'must retain the full box score of the club managed in this season');
          // A sealed game's sides are the clubs' registrations at that round (a background side's season squad).
          const side = (clubId: string): Team => fixture.competition && !archiveClubs.some(club => club.id === clubId) ? sides(clubId, archiveIndex + 1)
            : { ...archiveClubs.find(club => club.id === clubId)!, players: rosterForRound(archivedRosters!, clubId, expected.round).players };
          const home = side(expected.homeClubId), away = side(expected.awayClubId);
          const sealed = record(fixture.result, `${location}.result`, ['score', 'officialScore', 'winnerClubId', 'kind', 'periods', 'injuries', 'stats', 'fouls']);
          if (sealed.stats !== null) fail(`${location}.result.stats`, 'cannot be kept in a sealed result');
          validateResultSummary(sealed, `${location}.result`, home, away);
          validateInjuryMap(sealed.injuries, `${location}.result.injuries`, [...home.players, ...away.players].map(player => player.id));
          const fouls = record(sealed.fouls, `${location}.result.fouls`, SIDES);
          const foulOut = rulesetById(fixtureRuleset({ world }, expected)).foulOut;
          number(fouls.home, `${location}.result.fouls.home`, 0, foulOut * home.players.length); number(fouls.away, `${location}.result.fouls.away`, 0, foulOut * away.players.length);
          recordSealedInjuries(sealed as unknown as ArchivedFixture['result'], expected, home, away, location);
          continue;
        }
        const { home, away } = archivedRosters ? recordedTeams(fixture.result, expected, archiveClubs, archivedRosters, `${location}.result`, version >= 45, fullRoster, backgroundSelection(archiveIndex + 1, expected)) : { home: archiveClubs.find(club => club.id === expected.homeClubId)!, away: archiveClubs.find(club => club.id === expected.awayClubId)! };
        const result = validateArchivedResult(fixture.result, `${location}.result`, home, away, version >= 9, version >= 45, fullRoster, rulesetById(fixtureRuleset({ world }, expected)));
        if (version >= 9) {
          const available = result.stats !== null || result.appearances !== undefined;
          if (hasPlayerStats !== undefined && available !== hasPlayerStats) fail(`${path}.fixtures`, 'must have consistent player-statistics coverage for the archived season');
          hasPlayerStats = available;
        }
        recordFixtureInjuries(result, expected, home, away, location, version >= 9 ? result.stats ?? undefined : undefined);
      }
      if (version >= SEALED_HISTORY_FORMAT && (archive.fixtures as ArchivedFixture[]).some(fixture => isSealedSeniorResult(fixture.result))) validateSealedSeniorSummary(archive as unknown as SeasonState['history'][number], path, clubId => fullWorldClubsIn(careerContext, archiveIndex + 1).some(club => club.id === clubId) ? null : sides(clubId, archiveIndex + 1).players.map(player => player.id));
      else if (version >= 45) validateSeniorSummary(archive as unknown as SeasonState['history'][number], managedClubFor(state as unknown as SeasonState, archiveIndex + 1, false), path);
    }
    remember('history', 'injuries', { history: history.slice(), latest: [...latestInjuries] });
  }
  const schedule = canonicalFixtures({ clubs, fixtures: state.fixtures, world, divisions: seasonDivisions, seed, ...(seasonEurope ? { europe: seasonEurope } : {}), ...(Object.hasOwn(state, 'national') ? { national: true } : {}) }, seasonNumber, 'fixtures'), fixtures = array(state.fixtures, 'fixtures', schedule.length);
  const committedRound = state.status === 'complete' ? round : round - 1;
  // Step 3.4a: the current week's game day is its earliest date with an unplayed game; earlier game days are committed.
  let pendingDay: string | null = null;
  if (state.status !== 'complete') for (const value of fixtures) { const item = value as SeasonFixture; if (item && typeof item === 'object' && item.round === round && item.result === null && typeof item.date === 'string' && (pendingDay === null || item.date < pendingDay)) pendingDay = item.date; }
  const restWeeks: NonNullable<SeasonState['restWeeks']> = [];
  if (world.domesticLeagues) {
    const expected = Array.from({ length: committedRound }, (_, i) => i + 1).flatMap(week => clubs.filter(club => !schedule.some(fixture => fixture.round === week && [fixture.homeClubId, fixture.awayClubId].includes(club.id))).map(club => ({ round: week, clubId: club.id })));
    const rows = array(state.restWeeks, 'restWeeks', expected.length);
    for (const [index, value] of rows.entries()) {
      const row = record(value, 'restWeeks', ['round', 'clubId', 'conditions']), boundary = expected[index]!;
      if (row.round !== boundary.round || row.clubId !== boundary.clubId) fail('restWeeks', 'must retain exactly each completed club rest week in calendar order');
      const players = rosterForRound(rosters!, boundary.clubId, boundary.round).players;
      const conditions = record(row.conditions, 'restWeeks.conditions', players.map(player => player.id));
      for (const player of players) {
        number(conditions[player.id], 'restWeeks.conditions', 35, 100, false);
        if (boundary.round === 1 && conditions[player.id] !== 100) fail('restWeeks.conditions', 'must start the season fully recovered');
      }
      restWeeks.push(row as unknown as NonNullable<SeasonState['restWeeks']>[number]);
    }
  } else if (Object.hasOwn(state, 'restWeeks')) fail('restWeeks', 'requires a domestic calendar');
  for (const [index, value] of fixtures.entries()) {
    const path = `fixtures[${index}]`, expected = schedule[index]!;
    const fixture = record(value, path, fixtureKeys(expected));
    for (const key of fixtureKeys(expected)) if (key !== 'result' && fixture[key] !== expected[key as keyof SeasonFixture]) fail(path, 'does not match the versioned schedule');
    if (expected.round <= committedRound || expected.round === round && pendingDay !== null && expected.date < pendingDay) {
      if (fixture.result === null) fail(`${path}.result`, 'is missing from a completed matchday');
      const { home, away } = rosters ? recordedTeams(fixture.result, expected, clubs, rosters, `${path}.result`, false, fullRoster, backgroundSelection(seasonNumber, expected)) : { home: clubs.find(club => club.id === expected.homeClubId)!, away: clubs.find(club => club.id === expected.awayClubId)! };
      const result = validateResult(fixture.result, `${path}.result`, home, away, legacy, version >= 9, fullRoster, rulesetById(fixtureRuleset({ world }, expected)));
      if (!legacy) recordFixtureInjuries(result, expected, home, away, path, result.stats);
    } else if (fixture.result !== null) fail(`${path}.result`, 'cannot be committed before its matchday');
  }
  // Step 3.4c: each season's divisions follow from the previous seasons' promotions and relegations.
  if (seasonDivisions) validateDivisionHistory(state as unknown as SeasonState);
  // Step 3.5f: each season's European places follow from the opening lists and every completed season.
  // Completed seasons and this season's places equal the trusted checkpoint's (`trusted-prefix.ts`), whose check derived them.
  if (seasonEurope && trustedCutKey() === -Infinity) validateEuropeHistory(state as unknown as SeasonState, careerContext);
  // Format 68: grown rivalries are re-derived from the validated history before any replay reads their derbies.
  if (version >= 68) validateRivalryGrowth(state as unknown as SeasonState);
  // Format 72: each season's club money follows from the validated divisions, European places and registrations.
  validateEconomyHistory(state as unknown as SeasonState);
  recordNationalInjuriesBefore('9999-12-31');
  if (!legacy) {
    const injuries = state.injuries as unknown[];
    for (const [index, injury] of injuries.entries()) record(injury, `injuries[${index}]`, ['id', 'playerId', 'clubId', 'kind', 'fixtureId', 'occurredOn', 'returnOn']);
    const ids = injuries.map(injury => (injury as SeasonInjury).id);
    if (new Set(ids).size !== ids.length || !sameIds(ids, history.map(injury => injury.id))) fail('injuries', 'must match the committed fixture injury history exactly');
    const byId = new Map(injuries.map(entry => [(entry as SeasonInjury).id, entry]));
    for (const injury of history) if (!sameData(byId.get(injury.id), injury)) fail(`injuries.${injury.id}`, 'has inconsistent identity, diagnosis, origin or recovery dates');
  }
  // After a move at this season's end, the final match still belongs to the club that played the season.
  const matchClub = matchClubFor({ managedClubId: state.managedClubId as string, seasonNumber, career: careerRecord });
  // The managed match is the managed club's game on the current game day (at the season's end, on its last game day).
  const gameDay = state.status === 'complete' ? weekLastGameDate(fixtures as SeasonFixture[], round, seasonNumber) : pendingDay;
  const active = gameDay === null ? undefined : (fixtures as SeasonFixture[]).find(fixture => fixture.round === round && fixture.date === gameDay && [fixture.homeClubId, fixture.awayClubId].includes(matchClub));
  let payroll: SeasonPayroll | undefined;
  if (version >= 7) {
    const finance = record(state.finance, 'finance', ['model', 'enabledSince', 'plans', 'roundPrices', 'ledger', ...(version >= 28 && Object.hasOwn(state.finance as object, 'roundCapacities') ? ['roundCapacities'] : [])]);
    if (!Array.isArray(finance.ledger)) fail('finance.ledger', 'must be an array');
    payroll = validatePayroll(state.payroll, clubs, seasonNumber, round, state.managedClubId, financeLedgerCount({ ledger: finance.ledger as FinanceEntry[] }), employment, careerContext);
    if (employment?.enabledSince) {
      const anchor = payroll.enabledSince;
      if (!anchor || roundKey(anchor.seasonNumber, anchor.round) > roundKey(employment.enabledSince.seasonNumber, employment.enabledSince.round)) fail('employment.enabledSince', 'requires payroll active from the employment activation boundary');
    }
  }
  const normalizedState = { ...state, scouts, fitness, physio, assistant, academy, youth, lifecycle, youthCompetition, facilities, relationships, board, commercial, ...(employment ? { employment } : {}), recruitment: version >= 19 ? state.recruitment : version === 18 ? migrateRecruitmentTransfers(state.recruitment as unknown as SeasonRecruitment) : createRecruitment() } as unknown as SeasonState;
  const recruitmentHolds = version >= 18 ? validateRecruitment(state.recruitment, normalizedState, version) : [];
  if (version >= 6) validateFinance(state.finance, clubs, fixtures as SeasonFixture[], state.history as SeasonArchive[], coaching!, seasonNumber, round, state.status, state.managedClubId, payroll, employment, recruitmentHolds, scouts, fitness, physio, assistant, youth, version, facilities, commercial, state.board, rivalries, world, state.divisions as DomesticDivisions | undefined, state.background as SeasonBackground | undefined, Object.hasOwn(state, 'media') ? { media: state.media as SeasonMedia, relationships: state.relationships as SeasonRelationships } : undefined, economySeasons);
  // Format 86: head coaches steer training (`coaches-2`); who coaches where is replayed from the board's changes.
  const steering = version >= 86 && state.coaches !== null && typeof state.coaches === 'object' && (state.coaches as { model?: unknown }).model === COACH_STEERING_MODEL ? (seasonNumber: number, afterRound: number) => {
    try { return trainingCoaches(state as unknown as SeasonState, seasonNumber, afterRound); } catch { return fail('coaches', 'must name each club\'s head coach through the board\'s changes'); }
  } : undefined;
  const development = version >= 4 ? validateTraining(state.training, clubs, fixtures as SeasonFixture[], history, seasonNumber, round, coaching, rosters, fitness, physio, version, { ...careerContext, facilities, restWeeks, ...(Object.hasOwn(state, 'national') ? { national: state.national as SeasonState['national'] } : {}), ...(steering ? { trainingCoaches: steering } : {}) }) : null;
  if (version >= 11) validateScouting(state.scouting, normalizedState, version);
  const marketSnapshots: MarketReplaySnapshot[] = [];
  if (version >= 13) validateMarket(state.market, normalizedState, version, marketSnapshots);
  if (version >= 28) validateFacilitiesHistory(normalizedState, recruitmentHolds, marketSnapshots);
  if (version >= 12) validateNegotiations(state.negotiations, normalizedState, recruitmentHolds, version);
  validateLifecycleHistory(normalizedState, recruitmentHolds);
  // Format 94: the manager's trade offers and every computer trade, decided again.
  validateTradesState(normalizedState as unknown as SeasonState, version);
  const marketWindow = marketEnabled ? (state.market as unknown as SeasonMarket).windows.find(window => window.seasonNumber === seasonNumber) : null;
  const expectedDate = state.status === 'complete' && marketWindow ? marketWindow.date : dateForRound(round, seasonNumber);
  if (state.activeFixtureId !== (active?.id ?? null) || state.date !== expectedDate) fail('activeFixtureId/date', 'must identify the current fixture or validated offseason date');
  if (version >= 16) {
    if (employment!.transfers.some(transfer => transfer.payments.some(payment => payment.paidOn > expectedDate))) fail('employment.transfers.payments', 'cannot record future cash receipts');
    validateTransferPaymentBoundaries(normalizedState);
  }
  if (!active) {
    // Format 69: a season (or its end) without a club (career-3) has no managed match.
    if (!world.domesticLeagues && matchClub !== NO_CLUB || state.activeMatch !== null) fail('activeMatch', 'must be null during a calendar rest week');
  } else validateMatchState(state.activeMatch);
  validateRelationships(normalizedState, version);
  validateCommercial(normalizedState, version);
  validateBoard(normalizedState, version);
  // Format 38: the board's dismissal and job offers decide every governed season end.
  if (version >= 38) validateCareerDecisions(normalizedState);
  const match = state.activeMatch as SeasonState['activeMatch'];
  if (match && active) {
  if (match.engineVersion !== 'possession-3' || match.seed !== fixtureSeed(seed, active.id)) fail('activeMatch', 'has the wrong engine or fixture seed');
  // Step 3.5b: a European opponent outside the full world plays its background selection, undeveloped.
  const backgroundTeam = (clubId: string) => active.competition && !clubs.some(club => club.id === clubId) ? backgroundSelection(seasonNumber, active)(clubId).team : undefined;
  const homeBackground = backgroundTeam(active.homeClubId), awayBackground = backgroundTeam(active.awayClubId);
  let home = homeBackground ?? clubs.find(club => club.id === active.homeClubId)!, away = awayBackground ?? clubs.find(club => club.id === active.awayClubId)!;
  if (fullRoster) {
    try { if (!homeBackground) home = selectedTeam(home, match.home.players.map(player => player.id)); if (!awayBackground) away = selectedTeam(away, match.away.players.map(player => player.id)); } catch { fail('activeMatch', 'must use legal matchday selections from the registered clubs'); }
    for (const side of SIDES) { const plan = (plans[match[side].id] as unknown as ClubPlan | undefined); if (plan && plan.matchday !== null && !sameData(plan.matchday, match[side].players.map(player => player.id))) fail('activeMatch', 'must retain the chosen matchday selection'); }
  }
  if (match.status === 'ready') for (const team of [homeBackground, awayBackground]) if (team) {
    const expected = backgroundConditions(fixtures as SeasonFixture[], team, active.date);
    if (team.players.some(player => match.stats[player.id]?.condition !== expected[player.id])) fail('activeMatch.stats', 'must start background players at their condition after earlier European games');
  }
  const developed = (team: Team, background: Team | undefined) => development && !background ? developClub(team, development.training, { ...careerContext, date: active.date }) : team;
  if (!sameData(match.home, developed(home, homeBackground)) || !sameData(match.away, developed(away, awayBackground))) fail('activeMatch', 'must use the fixture home and away squads with their current development');
  const opposition: Side = active.homeClubId === matchClub ? 'away' : 'home';
  if (!match.autoSubstitutions[opposition]) fail('activeMatch.autoSubstitutions', 'must enable opponent substitutions');
  // Format 79: the match uses the career's play model, and the opponent has a computer coach.
  // NBA step 3 (provisional format 90): a match with competition rules needs format 90 and the rules of its league.
  if (Object.hasOwn(match, 'ruleset') && version < 90) fail('activeMatch.ruleset', 'needs save format 90 or later');
  if ((match.ruleset ?? null) !== (fixtureRuleset({ world }, active as SeasonFixture) ?? null)) fail('activeMatch.ruleset', 'must follow the rules of the fixture\'s league');
  if ((match.playModel ?? null) !== (state.matchModel ?? null) || match.playModel && !match.computerCoach?.includes(opposition)) fail('activeMatch.playModel', 'must use the career\'s play model with a computer coach for the opponent');
  // Format 85: a game at one venue is played without home advantage in careers with that rule, and only then.
  if (!!match.neutralVenue !== playsAtNeutralVenue({ world }, active as SeasonFixture)) fail('activeMatch.neutralVenue', 'must mark exactly the games at one venue in careers with neutral venues');
  // Format 86: each computer side runs its head coach's rotation, exactly as derived from the coach and its players' ages.
  for (const side of SIDES) {
    let expected: ReturnType<typeof computerCoachRotation> = null;
    // The match's own manager side (after a move at a season end, his former club's final match) runs no coach's rotation.
    try { expected = computerCoachRotation({ ...(state as unknown as SeasonState), managedClubId: matchClub }, match[side], { seasonNumber, round: active.round, date: active.date }); } catch { fail('coaches', 'must name each club\'s head coach through the board\'s changes'); }
    if (!sameData(match.coachRotation?.[side] ?? null, expected)) fail(`activeMatch.coachRotation.${side}`, 'must follow the side\'s head coach in careers where head coaches steer, and only then');
  }
  // Format 74: only the manager chooses circles on the court picture; computer clubs play listed positions.
  if (match.slots?.[opposition] || match.startingSlots?.[opposition]) fail('activeMatch.slots', 'must leave the opponent in its listed positions');
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
    const result = { score: match.score, officialScore: match.result.officialScore, winnerClubId: match[match.result.winner].id, kind: match.result.kind, periods: match.period, stats: match.stats, ...(legacy ? {} : { injuries: Object.fromEntries(Object.entries(match.injuries).map(([id, injury]) => [id, injury.kind])) }), ...(rosters ? { rosterIds: { home: rosterForRound(rosters, home.id, round).id, away: rosterForRound(rosters, away.id, round).id } } : {}), ...(fullRoster ? { selection: active.result!.selection } : {}) };
    if (!sameData(active.result, result)) fail('activeMatch', 'does not match its committed final result');
  }
  }
  // Recovery belongs to a completed matchday, so imports cannot run it twice.
  for (const club of clubs) {
    for (const player of club.players) {
      const latest = (fixtures as SeasonFixture[]).find(fixture => fixture.round === committedRound && (fixture.result?.stats[player.id] || Object.hasOwn(fixture.result?.selection?.rested ?? {}, player.id)));
      const previous = (committedRound >= 1 ? weekCloseCondition({ fixtures: fixtures as SeasonFixture[], restWeeks, seasonNumber }, committedRound, club.id, player.id) : undefined) ?? 100;
      const weekStart = dateForRound(round, seasonNumber), lastPlayed = state.status === 'complete' ? undefined : (fixtures as SeasonFixture[]).filter(fixture => fixture.round === round && fixture.result && (fixture.result.stats[player.id] || Object.hasOwn(fixture.result.selection?.rested ?? {}, player.id))).sort((a, b) => a.date < b.date ? -1 : 1).at(-1);
      const marketRecoveryDays = state.status === 'complete' && marketWindow ? (Date.parse(`${marketWindow.date}T00:00:00.000Z`) - Date.parse(`${dateForRound(round, seasonNumber)}T00:00:00.000Z`)) / 86_400_000 : 0;
      const arrival = academy.graduates.find(graduate => graduate.player.id === player.id && graduate.availableSince.seasonNumber === seasonNumber && graduate.availableSince.round === round);
      const startOfWeek = development?.conditionsAfter?.[player.id] ?? (!latest && arrival?.condition !== undefined ? arrival.condition : Math.min(100, Math.round((previous + DAILY_RECOVERY * (round > 1 ? calendarDaysBetween(weekLastGameDate(fixtures as SeasonFixture[], round - 1, seasonNumber), weekStart) : ROUND_INTERVAL_DAYS)) * 1000) / 1000));
      const current = gameDay ?? weekStart;
      const expected = state.status === 'complete' ? Math.min(100, Math.round((previous + DAILY_RECOVERY * marketRecoveryDays) * 1000) / 1000)
        : lastPlayed ? recoverThroughGameDays(lastPlayed.result!.stats[player.id]?.condition ?? lastPlayed.result!.selection!.rested[player.id]!, fixtures as SeasonFixture[], round, lastPlayed.date, current)
          : recoverThroughGameDays(startOfWeek, fixtures as SeasonFixture[], round, weekStart, current);
      if (conditions[player.id] !== expected) fail(`conditions.${player.id}`, 'does not match the last committed recovery boundary');
      if (match?.status === 'ready' && (club.id === match.home.id || club.id === match.away.id) && match.stats[player.id] && match.stats[player.id]!.condition !== conditions[player.id]) fail(`activeMatch.stats.${player.id}.condition`, 'must match current season condition before tipoff');
    }
  }
  // Format 67 guard: careers created with press topics and media standing record when they began (the career opening).
  // Checked last, so an older file's own format checks report first.
  if (Object.hasOwn(state, 'media')) {
    if (version < 67) fail('media', 'requires format 67 or later');
    validateMediaShape(state.media, state as unknown as SeasonState);
  }
  // Format 70 guard: careers created with president personalities (board-2) need format 70 or later.
  if ((state.board as SeasonBoard | undefined)?.model === 'board-2' && version < 70) fail('board.model', 'requires format 70 or later');
  // Format 80 guard: national teams (`national-1`) need format 80 or later and a real-club world with a national team's country.
  if (Object.hasOwn(state, 'national')) validateNationalShape(state.national, state as unknown as SeasonState, version);
  // Format 82 guard: real head coaches (`coaches-1`) need format 82 or later and a real-club career with job changes.
  if (Object.hasOwn(state, 'coaches')) validateCoachesShape(state.coaches, state as unknown as SeasonState, version);
  // Format 79 guard: careers created with the richer play model (`plays-2`) need format 79 or later.
  // Format 81 guard: careers created with the dead balls of a real game (`plays-3`) need format 81 or later.
  if (Object.hasOwn(state, 'matchModel') && (state.matchModel === 'plays-3' ? version < 81 : state.matchModel !== 'plays-2' || version < 79)) fail('matchModel', 'must be plays-2 (format 79 or later) or plays-3 (format 81 or later)');
}

/** Validate every reference and committed round before replacing any live season. */
export function validateSeasonState(value: unknown): asserts value is SeasonState { validateState(value, SEASON_SCHEMA_VERSION); }

/** The plain layout: readable, used by tests and tools. The game's own saves use `serializeSeasonCompact`. */
export function serializeSeason(state: SeasonState): string {
  validateSeasonState(state);
  const envelope = { format: FORMAT, formatVersion: SEASON_SCHEMA_VERSION, engineVersion: 'possession-3', state };
  checkJsonTree(envelope);
  const text = JSON.stringify(envelope);
  checkSize(text);
  return text;
}

/**
 * Format 40's compact layout (`compact-json.ts`): repeated field names and long identifiers are stored once, which
 * makes a real 18-club season about 30% of the plain size. Local saves, checkpoints and exported files use it.
 */
export function serializeSeasonCompact(state: SeasonState): string {
  validateSeasonState(state);
  return encodeSeasonCompact(state);
}

/** The compact encoding alone, for a state the caller has just checked (`serializeCheckpoint`). */
function encodeSeasonCompact(state: SeasonState): string {
  // Format 73: the finance ledger is packed losslessly (`save-packing.ts`) and written in the compact-3 layout.
  const { strings, shapes, nodes, value } = compactJson3(packSeasonForSave(state));
  const envelope = { format: FORMAT, formatVersion: SEASON_SCHEMA_VERSION, engineVersion: 'possession-3', encoding: COMPACT_JSON_3_ENCODING, strings, shapes, nodes, state: value };
  // Encoded tables, object markers and the envelope must fit the reader's limits too.
  checkJsonTree(envelope);
  const text = JSON.stringify(envelope);
  checkSize(text);
  return text;
}

// Incremental checkpoint checks (`trusted-prefix.ts`): the last checkpoint this worker accepted, with its replay values.
let lastCheckpoint: CheckRecord | null = null;

/**
 * The career check of one incremental checkpoint, without the full-check fallback: throws when it refuses. `trusted` must
 * have been matched by `matchesTrustedPrefix`. Returns what this check recorded for the next checkpoint.
 */
export function checkAgainstTrustedPrefix(state: SeasonState, trusted: CheckRecord): CheckRecord {
  return withPrefixCheck(state, trusted, true, () => validateSeasonState(state))!;
}

/**
 * The checkpoint queue's career check (`createCheckpointQueue`). A state that keeps the previous accepted checkpoint's past
 * exactly is checked incrementally; anything else, an incremental refusal or error included, gets the full check, which
 * decides. Throws exactly when the full check would refuse the state. Imports and loads never come here.
 */
export function checkCheckpointState(state: SeasonState): 'incremental' | 'full' {
  const previous = lastCheckpoint;
  let trusted: CheckRecord | null = null;
  try {
    const mismatch = previous ? trustedPrefixMismatch(previous, state) : 'no trusted checkpoint';
    trusted = mismatch === null ? previous : null;
    lastFallback = mismatch;
  } catch (error) { trusted = null; lastFallback = `prefix comparison failed: ${error instanceof Error ? error.message : 'unknown error'}`; }
  // Trust is given up until a check accepts this state: after any refusal the next checkpoint starts from a full check, so
  // replay values an interrupted check may have touched are never reused.
  lastCheckpoint = null;
  if (trusted) {
    try { lastCheckpoint = checkAgainstTrustedPrefix(state, trusted); return 'incremental'; }
    // The full check below decides: an incremental refusal or error never refuses a checkpoint on its own.
    catch (error) { lastFallback = `incremental check: ${error instanceof Error ? error.message : 'unknown error'}`; }
  }
  lastCheckpoint = withPrefixCheck(state, null, true, () => validateSeasonState(state));
  return 'full';
}

let lastFallback: string | null = null;
/** Why the last checkpoint check was a full one (null after an incremental check), for tests and measurements. */
export function lastCheckpointFallback(): string | null { return lastFallback; }

/** Forget the trusted checkpoint (a new career, or tests). */
export function resetCheckpointTrust(): void { lastCheckpoint = null; }

/** Check a checkpoint of the game's own state (incrementally when possible), then encode it like `serializeSeasonCompact`. */
export function serializeCheckpoint(state: SeasonState): string {
  checkCheckpointState(state);
  return encodeSeasonCompact(state);
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
    ...previous, schemaVersion: SEASON_SCHEMA_VERSION, rivalries: createRivalries(), career: createCareer(), commercial: createCommercial(clubs, previous.managedClubId), board: createBoard(), relationships: createRelationships(), facilities: createFacilities(clubs, previous.managedClubId, 'facilities-1'), seasonNumber, rosters, scouts: createScouts(), fitness: createFitness(), physio: createPhysio(), assistant: createAssistant(), academy: createAcademy(), youth: createYouth(), lifecycle: createLifecycle(), youthCompetition: createYouthCompetition(), employment: createEmployment(), scouting: createScouting(clubs, previous.managedClubId), negotiations: createNegotiations(), market: createMarket(), recruitment: createRecruitment(),
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

/**
 * Internal local-checkpoint reader. The caller MUST verify a current checks-version seal issued only after full
 * serialization validation (`career-saves.ts`). An integrity fingerprint is not itself proof of valid gameplay.
 * Imports, missing/mismatched seals and older formats use parseSeason. Never route an imported file directly here.
 */
export function parseSealedSeason(text: string): SeasonState {
  const { version, state } = decodeSeasonText(text);
  if (version !== SEASON_SCHEMA_VERSION) return parseSeason(text);
  if (state === null || typeof state !== 'object' || Array.isArray(state)) fail('state', 'must be an object');
  const fields = state as Record<string, unknown>;
  checkJsonTree(state);
  if (fields.schemaVersion !== SEASON_SCHEMA_VERSION || fields.engineVersion !== 'possession-3') fail('state', 'uses an unsupported schema or engine');
  if (Object.hasOwn(fields, 'world')) {
    try { validateWorld(fields.world); } catch (error) { fail('world', error instanceof Error ? error.message.replace(/^Invalid career world: /, '').replace(/\.$/, '') : 'is invalid'); }
    if (fields.dataPackId !== (fields.world as CareerWorld).id || fields.dataPackId === DEVELOPMENT_DATA_PACK_ID) fail('dataPackId', 'must name the world the career carries');
  } else if (fields.dataPackId !== DEVELOPMENT_DATA_PACK_ID) fail('state', 'uses an unsupported data pack');
  return state as SeasonState;
}

/** The envelope's format version and its (expanded) state, before any check of the state's contents. */
function decodeSeasonText(text: string): { version: SeasonFormatVersion; state: unknown } {
  checkSize(text);
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error('This is not a valid JSON season file.'); }
  checkJsonTree(parsed);
  // Plain envelopes remain readable for tools. Each compact encoding belongs to an explicit format version.
  const fields = parsed !== null && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  const compact = SUPPORTED_FORMATS.includes(fields.formatVersion as number) && (fields.formatVersion as number) >= 40 && Object.hasOwn(fields, 'encoding');
  const sharedNodes = compact && (fields.formatVersion as number) >= 41;
  const envelope = record(parsed, 'envelope', ['format', 'formatVersion', 'engineVersion', ...(compact ? ['encoding', 'strings', 'shapes'] : []), ...(sharedNodes ? ['nodes'] : []), 'state']);
  if (envelope.format !== FORMAT || !SUPPORTED_FORMATS.includes(envelope.formatVersion as number) || envelope.engineVersion !== 'possession-3') throw new Error('This season file uses an unsupported save format or engine version.');
  if (compact) {
    // Format 73 writes compact-3 (`compact-json.ts`); formats 41-72 compact-2 and format 40 compact-1.
    const layout3 = (envelope.formatVersion as number) >= PACKED_SAVE_FORMAT;
    if (envelope.encoding !== (layout3 ? COMPACT_JSON_3_ENCODING : sharedNodes ? COMPACT_JSON_ENCODING : LEGACY_COMPACT_JSON_ENCODING)) throw new Error('This season file uses an unsupported save encoding.');
    try { envelope.state = (layout3 ? expandJson3 : expandJson)({ strings: envelope.strings, shapes: envelope.shapes, ...(sharedNodes ? { nodes: envelope.nodes } : {}), value: envelope.state }); } catch (error) { throw new Error(`Invalid season save: ${error instanceof Error ? error.message : 'the compact data is damaged'}`); }
    // Format 73 packs the finance ledger inside compact files; the checks read it as the game wrote it.
    if ((envelope.formatVersion as number) >= PACKED_SAVE_FORMAT) envelope.state = unpackSavedSeason(envelope.state);
  }
  // Format 80 saves from before national injuries and career earnings keep loading (none recorded yet).
  return { version: envelope.formatVersion as SeasonFormatVersion, state: envelope.formatVersion === 80 ? withEarlierNationalFields(envelope.state) : envelope.state };
}

/** Format 73: careers of real-data worlds follow the closed money gaps (staff pay, reserves, capital and offers by season money). */
export const REAL_WORLD_MONEY_FORMAT = 73;
export const OLDER_REAL_CAREER_MESSAGE = 'This career was saved by an earlier version of the game, before club money changed for real-club careers. It cannot be continued: please start a new career.';

function isRealMoneyCareer(state: unknown): boolean {
  const world = state !== null && typeof state === 'object' ? (state as { world?: unknown }).world : undefined;
  return world !== null && typeof world === 'object' && Object.hasOwn(world, 'economy') && (world as { economy?: unknown }).economy != null;
}

export function parseSeason(text: string): SeasonState {
  const { version, state } = decodeSeasonText(text);
  // Development mode (owner, 15 November 2026): older real-club careers (worlds with researched money, `world.economy`)
  // are refused rather than migrated; their money records follow the earlier rules. The development world and test
  // worlds keep the development constants, so their older careers still load.
  if (version < REAL_WORLD_MONEY_FORMAT && isRealMoneyCareer(state)) throw new Error(OLDER_REAL_CAREER_MESSAGE);
  const envelope = { state };
  // Validate the original shape and accounting before adding any recoverable metadata.
  validateState(envelope.state, version);
  if (version === SEASON_SCHEMA_VERSION) return envelope.state as SeasonState;
  const previous = envelope.state as SeasonState;
  const previousMarket = version >= 13 ? version < 15 ? migrateMarketTransfers(version < 14 ? migrateMarketCompetition(previous.market) : previous.market) : previous.market : createMarket();
  const upgraded: SeasonState = version >= 9 ? {
    ...previous, schemaVersion: SEASON_SCHEMA_VERSION, rivalries: version >= 35 ? previous.rivalries : createRivalries(), career: version >= 38 ? previous.career : version === 37 ? deferCareerDecisions(previous.career, previous) : createCareer(), commercial: version >= 31 ? previous.commercial : createCommercial(previous.clubs, previous.managedClubId), board: version >= 33 ? previous.board : version >= 30 ? { ...previous.board, consequencesSince: null } : createBoard(), relationships: version >= 29 ? previous.relationships : createRelationships(), facilities: version >= 36 ? previous.facilities : version >= 32 ? { ...previous.facilities, maintenanceSince: null } : version >= 28 ? { ...previous.facilities, fundingSince: null, maintenanceSince: null } : createFacilities(previous.clubs, previous.managedClubId, 'facilities-1'), youthCompetition: version >= 27 ? previous.youthCompetition : createYouthCompetition(), lifecycle: version >= 26 ? previous.lifecycle : createLifecycle(), academy: version >= 25 ? previous.academy : createAcademy(), youth: version >= 25 ? previous.youth : createYouth(), assistant: version >= 24 ? previous.assistant : createAssistant(), physio: version >= 23 ? previous.physio : createPhysio(), fitness: version >= 22 ? previous.fitness : createFitness(), scouts: version >= 21 ? previous.scouts : createScouts(), recruitment: version >= 19 ? previous.recruitment : version === 18 ? migrateRecruitmentTransfers(previous.recruitment) : createRecruitment(),
    employment: version >= 10 ? { ...(version < 16 ? migrateTransferPayments({ ...previous.employment, transfers: version >= 15 ? previous.employment.transfers : [] }) : previous.employment), buyouts: version >= 17 ? previous.employment.buyouts : [], contracts: previous.employment.contracts.map(contract => ({ ...contract, startsRound: version >= 18 ? contract.startsRound : 1 })), transfers: (version < 16 ? migrateTransferPayments({ ...previous.employment, transfers: version >= 15 ? previous.employment.transfers : [] }).transfers : previous.employment.transfers).map(transfer => ({ ...transfer, startsRound: version >= 19 ? transfer.startsRound : 1 })) } : createEmployment(),
    scouting: version >= 11 ? previous.scouting : createScouting(previous.clubs, previous.managedClubId), negotiations: version >= 12 ? previous.negotiations : createNegotiations(),
    market: { ...previousMarket, windows: previousMarket.windows.map(window => ({ ...window, offers: window.offers.map(offer => ({ ...offer, transfer: offer.transfer ? { ...offer.transfer, paymentPlan: version < 16 ? 'upfront' as const : offer.transfer.paymentPlan } : null })) })) },
  } : migrateRosterHistory(previous, version);
  // The original history has already passed its format's complete replay checks. Apply only the projections
  // introduced after that format: an existing format-42 academy history keeps its chosen full/outcome detail.
  const academyUpgraded = version < 42 ? summarizeAcademyHistory(upgraded) : upgraded;
  const summarized = version < 43 ? summarizeYouthHistory(academyUpgraded) : academyUpgraded;
  // Format 73: completed seasons of older saves are sealed as a rollover would have done.
  const archived = sealCompletedHistory(summarizeSeniorHistory(archiveFinancialHistory(summarized)));
  // Format 50: careers with postseasons begin moving clubs between divisions at the end of the season being played.
  // Saves from format 50 on already record the season's divisions and keep them.
  const divisions = version < 50 ? openingDivisions(worldOf(archived), archived.seasonNumber) : undefined;
  const withDivisions = divisions ? { ...archived, divisions } : archived;
  // Format 53: careers that record divisions start an empty record of clubs outside the full world.
  // Format 55: careers saved earlier exchange clubs with a next division from the end of their next season.
  const withBackground = version < 53 && withDivisions.divisions ? { ...withDivisions, background: createBackground(withDivisions.seasonNumber + 1) }
    : version < 55 && withDivisions.background ? { ...withDivisions, background: { ...withDivisions.background, changesFrom: withDivisions.seasonNumber + 1, exchanges: [] } } : withDivisions;
  validateSeasonState(withBackground);
  return withBackground;
}

export async function saveLocalSeason(state: SeasonState, expectedRevision: number): Promise<void> { await writeLocalSeason(serializeSeasonCompact(state), expectedRevision); }
export async function loadLocalSeason(): Promise<SeasonState | null> { const text = await readLocalSeason(); return text === null ? null : parseSeason(text); }
