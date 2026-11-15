import { requireCalendarWeek } from './calendar-boundary';
import { competitionTable } from './competition-table';
import { createBoard, enableBoard, enableBoardConsequences, prepareBoardSeason, processBoardRound } from './board';
import { summarizeAcademyHistory } from './academy-history';
import { summarizeYouthHistory } from './youth-history';
import { fixturePlayerEvidence, summarizeSeniorHistory } from './senior-history';
import { createRivalries, enableRivalries } from './rivalries';
import { appointManager, createCareer, enableCareerMoves, matchClubFor } from './career';
import { jobOfferRefusal, seasonEndOutlook, type SeasonEndOutlook } from './career-policy';
import { addCalendarDays, domesticRoundDates, roundRobinGames, roundRobinRoundCount, calendarDaysBetween } from './competition-calendar';
import { derivePostseason, POSTSEASON_FORMATS, POSTSEASON_SLOT_OFFSETS, postseasonOutcome } from './postseason';
import { divisionChanges, openingDivisions, seasonLeagues } from './divisions';
import { createBackground } from './background';
import { backgroundConditions, backgroundMatchdayTeam, backgroundPlan, backgroundRosterId, backgroundSide, europeanRegularFixtures, getEuropeanCompetitions, playsEurope } from './europe';
import type { ClubExchange } from '../domain/background';
import { computeExchanges, departureFor, joinedContracts, leavingRecord } from './exchanges';
import type { SeasonEndDecision } from '../domain/career';
import { completeCommercialSeason, createCommercial, enableCommercial, processCommercialRound, startCommercialSeason } from './commercial';
import { createRelationships, enableRelationships, automateRelationships, prepareRelationshipsRound, getPreparedRelationshipMorale } from './relationships';
import { createFacilities, enableBoardFunding, enableFacilities, enableFacilityMaintenance, processFacilityProjects, automateFacilities } from './facilities';
import type { ArchivedFixture, ClubPlan, DomesticDivisions, FixtureResult, SeasonFixture, SeasonState, Standing } from '../domain/season';
import { SEASON_SCHEMA_VERSION } from '../domain/season';
import { archiveFinancialHistory } from './finance-archives';
import type { InjuryMode, MatchState, Side, Team } from '../domain/types';
import type { ManagerProfile } from '../domain/manager';
import { DEVELOPMENT_CLUBS, DEVELOPMENT_START_DATE } from '../data/development-league';
import { DEVELOPMENT_WORLD } from '../data/development-world';
import type { CareerWorld } from '../domain/world';
import { fullWorldClubs, MAX_SEASON_ROUNDS, MAX_WORLD_CLUBS, MIN_WORLD_CLUBS, regularWorldRounds, seasonRounds, storedWorld, validateWorld, worldOf } from './career-world';
import { createFixtureMatch, simulateToEnd } from '../engine/match';
import { injuriesFromMatch, isRecovering } from './health';
import { createTraining, developClub, processTrainingWeek, withTrainingPoints } from './training';
import { createCoaching, recruitAiCoaches, renewSeasonCoaching } from './coaching';
import { createFinance, DEFAULT_TICKET_PRICE, enableFinance, openClubFinances, prepareFinanceRound, processFinanceRound, startFinanceSeason } from './finance';
import { processTransferPayments } from './transfer-payments';
import { createInSeasonRecruitment, enableInSeasonRecruitment, enableInSeasonTransfers, resolveInSeasonRecruitment, scheduleInSeasonRecruitment } from './recruitment';
import { createPayroll, enablePayroll, preparePayrollRound, processPayrollRound, startPayrollSeason } from './payroll';
import { validateManagerProfile } from './manager';
import { createRosterSnapshots, getFixtureTeams, rosterForRound } from './rosters';
import { createEmployment, enableEmployment, finalizeEmploymentMarket, prepareEmploymentMarket } from './employment';
import { createScouting, enableScouting, prepareScoutingAssignments, processScoutingRound, refreshSquadKnowledge } from './scouting';
import { createScouts, enableScouts, recruitAiScouts, renewSeasonScouts } from './scouts';
import { createFitness, enableFitness, recruitAiFitnessCoaches, renewSeasonFitness } from './fitness';
import { createPhysio, enablePhysio, recruitAiPhysios, renewSeasonPhysio } from './physio';
import { createAssistant, enableAssistant, recruitAiAssistants, renewSeasonAssistant } from './assistant';
import { DEVELOPMENT_ASSISTANTS } from '../data/development-assistants';
import { applyAssistantTactics } from './assistant-advice';
import { createAcademy, enableAcademy, prepareAcademySeason, processAcademyWeek } from './academy';
import { createYouth, enableYouth, recruitAiYouthCoaches, renewSeasonYouth } from './youth';
import { createLifecycle, enableLifecycle, prepareLifecycleSeason } from './lifecycle';
import { createYouthCompetition, enableYouthCompetition, prepareYouthSeason, processYouthRound } from './youth-competition';
import { processRehabilitationWeek } from './rehabilitation';
import { createNegotiations, enableNegotiations } from './negotiations';
import { createMarket, enableMarket } from './market';
import { getMarketStartReason, getMarketWindow } from './market-policy';
import { memoizePure } from './pure-cache';
import { ASSISTANT_DIRECTORY } from '../data/staff-directory';
import { usesFullClubRoster } from './club-roster-policy';
import { canSelectMatchday, captureMatchdaySelection, reconcileMatchdayPlan, selectedTeam, teamForMatchday } from './matchday-selection';
import type { WorldContext } from '../domain/world';

export const ROUND_INTERVAL_DAYS = 7;
export const DAILY_RECOVERY = 3;
/** The ISO calendar used by saves has four-digit years. */
export const MAX_SEASON_NUMBER = 7974;
const DAY_MS = 86_400_000;
const SIDES: readonly Side[] = ['home', 'away'];
const defaultPlan = (club: Team, automatic: boolean): ClubPlan => ({
  tactics: { tempo: .5, outsideShare: .45, pressure: .5 },
  lineup: club.players.slice(0, 5).map(player => player.id),
  autoSubstitutions: automatic,
});

function seasonYear(seasonNumber: number): number {
  if (!Number.isInteger(seasonNumber) || seasonNumber < 1 || seasonNumber > MAX_SEASON_NUMBER) throw new Error('Choose a supported career season number.');
  return Number(DEVELOPMENT_START_DATE.slice(0, 4)) + seasonNumber - 1;
}

export function seasonLabel(seasonNumber = 1): string {
  const year = seasonYear(seasonNumber);
  return `${year}/${String((year + 1) % 100).padStart(2, '0')}`;
}

// Calendar lookups run constantly during simulation and save validation; inputs are validated before the caches.
const seasonStarts = memoizePure((year: number): string => {
  const september = new Date(Date.UTC(year, 8, 1));
  september.setUTCDate(1 + (6 - september.getUTCDay() + 7) % 7);
  return september.toISOString().slice(0, 10);
});
const roundDates = memoizePure((key: string): string => {
  const separator = key.indexOf('|');
  const start = Date.parse(`${key.slice(0, separator)}T00:00:00.000Z`);
  return new Date(start + (Number(key.slice(separator + 1)) - 1) * ROUND_INTERVAL_DAYS * DAY_MS).toISOString().slice(0, 10);
});

/** Development seasons begin on the first Saturday in September, in UTC. */
export function seasonStartDate(seasonNumber = 1): string {
  return seasonStarts(seasonYear(seasonNumber));
}

/** Date arithmetic is UTC-only and does not depend on locale or the wall clock. */
export function dateForRound(round: number, seasonNumber = 1): string {
  if (!Number.isInteger(round) || round < 1 || round > MAX_SEASON_ROUNDS) throw new Error('Choose a supported matchday.');
  return roundDates(`${seasonStartDate(seasonNumber)}|${round}`);
}

/**
 * Circle scheduling: each club plays once per round and meets every opponent at home and away. Any even number of
 * clubs gives 2 x (clubs - 1) matchdays; six clubs give the built-in league's ten, with unchanged fixtures.
 */
/** The season-specific division memberships a schedule, table or postseason uses (step 3.4c). */
type DivisionContext = WorldContext & { divisions?: DomesticDivisions | null; seed?: number };

/** Format 57: worlds with European games keep every game in calendar order (date, then id), so each club's games are in the order played. */
const byCalendar = (a: Pick<SeasonFixture, 'date' | 'id'>, b: Pick<SeasonFixture, 'date' | 'id'>) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** The season's regular games: the domestic calendar and, in worlds that play them, the European regular seasons (step 3.5b). */
export function createSchedule(clubs: readonly Team[] = DEVELOPMENT_CLUBS, seasonNumber = 1, context: DivisionContext = {}): SeasonFixture[] {
  const domestic = domesticSchedule(clubs, seasonNumber, context);
  return context.world && playsEurope(context.world) ? [...domestic, ...europeanRegularFixtures(context, seasonNumber)].sort(byCalendar) : domestic;
}

/** The domestic regular season only (the youth competition mirrors it). */
export function domesticSchedule(clubs: readonly Team[] = DEVELOPMENT_CLUBS, seasonNumber = 1, context: DivisionContext = {}): SeasonFixture[] {
  const world = context.world;
  if (world?.domesticLeagues) {
    const start = seasonStartDate(seasonNumber), weeks = regularWorldRounds(world);
    return seasonLeagues(world, context.divisions).flatMap(league => roundRobinGames({ competitionId: league.id, clubIds: league.clubIds, dates: domesticRoundDates(start, roundRobinRoundCount(league.clubIds.length), weeks), season: seasonNumber }).map(game => ({ id: game.id, round: calendarDaysBetween(start, game.date) / 7 + 1, date: game.date, homeClubId: game.homeClubId, awayClubId: game.awayClubId, result: null }))).sort((a, b) => a.round - b.round || a.id.localeCompare(b.id));
  }
  const count = clubs.length;
  if (count < MIN_WORLD_CLUBS || count > MAX_WORLD_CLUBS || count % 2 !== 0 || new Set(clubs.map(club => club.id)).size !== count) throw new Error('A league needs an even number of distinct clubs.');
  seasonYear(seasonNumber);
  const prefix = seasonNumber === 1 ? 'dev' : `dev-s${seasonNumber}`;
  const legRounds = count - 1;
  let ring = clubs.map(club => club.id);
  const firstLeg: SeasonFixture[] = [];
  for (let round = 1; round <= legRounds; round += 1) {
    for (let game = 0; game < count / 2; game += 1) {
      const pair = [ring[game]!, ring[ring.length - 1 - game]!] as const;
      const reverse = (round + game) % 2 === 0;
      firstLeg.push({ id: `${prefix}-r${round}-g${game + 1}`, round, date: dateForRound(round, seasonNumber), homeClubId: pair[reverse ? 1 : 0], awayClubId: pair[reverse ? 0 : 1], result: null });
    }
    ring = [ring[0]!, ring.at(-1)!, ...ring.slice(1, -1)];
  }
  return [...firstLeg, ...firstLeg.map(fixture => ({
    ...fixture, id: fixture.id.replace(`r${fixture.round}-`, `r${fixture.round + legRounds}-`), round: fixture.round + legRounds,
    date: dateForRound(fixture.round + legRounds, seasonNumber), homeClubId: fixture.awayClubId, awayClubId: fixture.homeClubId,
  }))];
}

/** Independent fixture streams make results independent of UI and processing order. */
/** Format 49 (step 3.4b): postseason games carry their stage. League tables, board targets and positions use domestic regular-season games only (format 57: never European games). */
export const isRegularFixture = (fixture: { stage?: unknown; competition?: unknown }) => !fixture.stage && !fixture.competition;
/** A domestic game (regular season or postseason), as opposed to a European one (format 57). */
export const isDomesticFixture = (fixture: { competition?: unknown }) => !fixture.competition;
/** A postseason or European game's own fields, copied into archives. */
export const postseasonFields = (fixture: SeasonFixture | ArchivedFixture) => ({ ...(fixture.stage ? { stage: fixture.stage, seriesId: fixture.seriesId!, game: fixture.game!, ...(fixture.neutral ? { neutral: true as const } : {}) } : {}), ...(fixture.competition ? { competition: fixture.competition } : {}) });

type DomesticLeague = NonNullable<CareerWorld['domesticLeagues']>[number];
/** A league's final regular-season order (first to last), or null while any of its regular games is unplayed. */
function regularOrder(world: CareerWorld, league: DomesticLeague, fixtures: readonly (SeasonFixture | ArchivedFixture)[]): string[] | null {
  const games = fixtures.filter(fixture => isRegularFixture(fixture) && league.clubIds.includes(fixture.homeClubId));
  if (games.length !== league.clubIds.length * (league.clubIds.length - 1) || games.some(fixture => !fixture.result)) return null;
  return getStandings({ clubs: world.clubs, fixtures: games, world: { ...world, domesticLeagues: [league] } }).map(row => row.clubId);
}

/** The league calendar's week and date of a postseason slot: three a week (Saturday, Tuesday, Thursday) after the regular season. */
export function postseasonSlotDay(world: CareerWorld, seasonNumber: number, slot: number): { round: number; date: string } {
  const perWeek = POSTSEASON_SLOT_OFFSETS.length, round = regularWorldRounds(world) + Math.floor((slot - 1) / perWeek) + 1;
  return { round, date: addCalendarDays(dateForRound(round, seasonNumber), POSTSEASON_SLOT_OFFSETS[(slot - 1) % perWeek]!) };
}

/** Each league's postseason as far as results decide it: its series, the games that should exist and the outcome so far. */
export function getPostseasons(context: { fixtures: readonly (SeasonFixture | ArchivedFixture)[] } & DivisionContext, seasonNumber: number) {
  const world = worldOf(context), leagues = seasonLeagues(world, context.divisions).filter(league => league.postseason);
  const orders = new Map(leagues.map(league => [league.id, regularOrder(world, league, context.fixtures)]));
  return leagues.map(league => {
    const other = leagues.find(item => item.country === league.country && item.tier !== league.tier);
    const format = POSTSEASON_FORMATS[league.postseason!], order = orders.get(league.id)!;
    const derived = derivePostseason({ leagueId: league.id, format, seasonNumber, order, otherOrder: other ? orders.get(other.id)! : null, slotDay: slot => postseasonSlotDay(world, seasonNumber, slot), fixtures: context.fixtures });
    return { league, format, order, ...derived, outcome: postseasonOutcome(format, order, derived.series) };
  });
}

/** The season's canonical games so far: the regular calendar, then the postseason games that results have made due, in calendar order. */
export function scheduledFixtures(context: { clubs: readonly Team[]; fixtures: readonly (SeasonFixture | ArchivedFixture)[] } & DivisionContext, seasonNumber: number): SeasonFixture[] {
  const regular = createSchedule(context.clubs, seasonNumber, context), world = worldOf(context), europe = playsEurope(world);
  if (!world.domesticLeagues?.some(league => league.postseason) && !europe) return regular;
  const post: SeasonFixture[] = getPostseasons(context, seasonNumber).flatMap(entry => entry.fixtures).map(fixture => ({ ...fixture, result: null }));
  // Format 57: European knockout games share the weeks of the domestic regular season, so the whole season is in calendar order.
  if (europe) return [...regular, ...post, ...getEuropeanCompetitions(context, seasonNumber).flatMap(entry => entry.fixtures).map(fixture => ({ ...fixture, result: null }))].sort(byCalendar);
  return [...regular, ...post.sort((a, b) => a.round - b.round || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))];
}

/** Adds the postseason games that results have made due; existing games (and their results) are kept as they are. */
function withDueFixtures(state: SeasonState): SeasonState {
  const expected = scheduledFixtures(state, state.seasonNumber);
  if (expected.length === state.fixtures.length) return state;
  const existing = new Map(state.fixtures.map(fixture => [fixture.id, fixture]));
  return { ...state, fixtures: expected.map(fixture => existing.get(fixture.id) ?? fixture) };
}

/** Step 3.4a: the week's current game day, the earliest date with an unplayed game; null once the week's games are played. */
export function currentGameDay(state: Pick<SeasonState, 'fixtures' | 'round'>): string | null {
  let day: string | null = null;
  for (const fixture of state.fixtures) if (fixture.round === state.round && !fixture.result && (day === null || fixture.date < day)) day = fixture.date;
  return day;
}

/** The week's last game date (its own Saturday when it has no games): weekly training and recovery start from there. */
export function weekLastGameDate(fixtures: readonly (SeasonFixture | ArchivedFixture)[], round: number, seasonNumber: number): string {
  let last = dateForRound(round, seasonNumber);
  for (const fixture of fixtures) if (fixture.round === round && fixture.date > last) last = fixture.date;
  return last;
}

/** Rest between game days of one week: ordinary daily recovery, no practice. */
export function recoverConditions(conditions: Record<string, number>, days: number): void {
  for (const id of Object.keys(conditions)) conditions[id] = recoveredCondition(conditions[id]!, days);
}
const recoveredCondition = (condition: number, days: number) => Math.min(100, Math.round((condition + DAILY_RECOVERY * days) * 1000) / 1000);

type GameRecord = Pick<SeasonFixture, 'round' | 'date' | 'homeClubId' | 'awayClubId'> & { result: { stats: Record<string, { condition: number }> | null; selection?: { rested: Record<string, number> } } | null };
/**
 * A condition carried from `from` to `to` inside one week the way the game does it: one recovery step at each game day
 * of the week after `from`, up to and including `to` (a game day, or the week's Saturday).
 */
export function recoverThroughGameDays(condition: number, fixtures: readonly GameRecord[], round: number, from: string, to: string): number {
  const days = [...new Set(fixtures.filter(fixture => fixture.round === round && fixture.date > from && fixture.date <= to).map(fixture => fixture.date))].sort();
  if (days.at(-1) !== to && to > from) days.push(to);
  let value = condition, previous = from;
  for (const day of days) { value = recoveredCondition(value, calendarDaysBetween(previous, day)); previous = day; }
  return value;
}

/**
 * A player's condition as of the week's last game day: after the club's last game that week (played or rested) and the
 * rest after it, or the week's rest record when the club had no game. Undefined when neither exists.
 */
export function weekCloseCondition(context: { fixtures: readonly GameRecord[]; restWeeks?: SeasonState['restWeeks']; seasonNumber: number }, round: number, clubId: string, playerId: string): number | undefined {
  let last: GameRecord | undefined;
  for (const fixture of context.fixtures) if (fixture.round === round && fixture.result && (fixture.homeClubId === clubId || fixture.awayClubId === clubId) && (!last || fixture.date > last.date)) last = fixture;
  if (!last) return context.restWeeks?.find(row => row.round === round && row.clubId === clubId)?.conditions[playerId];
  const base = last.result!.stats?.[playerId]?.condition ?? last.result!.selection?.rested[playerId];
  return base === undefined ? undefined : recoverThroughGameDays(base, context.fixtures, round, last.date, weekLastGameDate(context.fixtures as readonly SeasonFixture[], round, context.seasonNumber));
}

export function fixtureSeed(seed: number, fixtureId: string): number {
  let hash = (2166136261 ^ seed) >>> 0;
  for (let index = 0; index < fixtureId.length; index += 1) hash = Math.imul(hash ^ fixtureId.charCodeAt(index), 16777619) >>> 0;
  return hash;
}

export function getActiveFixture(season: SeasonState): SeasonFixture {
  const fixture = season.fixtures.find(fixture => fixture.id === season.activeFixtureId);
  if (!fixture) throw new Error('The active season fixture is missing.');
  return fixture;
}

/** UI squad adapter on rest weeks. Never saved, played or displayed as a current match. */
export function careerPresentationMatch(season: SeasonState): MatchState {
  if (season.activeMatch) return season.activeMatch;
  const own = season.fixtures.filter(fixture => [fixture.homeClubId, fixture.awayClubId].includes(season.managedClubId));
  const fixture = own.find(fixture => !fixture.result) ?? own.at(-1);
  if (!fixture) throw new Error('The managed club has no fixtures in its calendar.');
  return prepareMatch(season, { ...fixture, round: season.round, date: season.date });
}

/** The manager's side of the prepared or final match: after a move at a season end, the former club's final match. */
export function managedSide(season: SeasonState): Side {
  const fixture = getActiveFixture(season), clubId = matchClubFor(season);
  if (fixture.homeClubId === clubId) return 'home';
  if (fixture.awayClubId === clubId) return 'away';
  throw new Error('The active fixture must include the managed club.');
}

function prepareMatch(season: Pick<SeasonState, 'seed' | 'clubs' | 'plans' | 'conditions' | 'managedClubId' | 'injuryMode' | 'injuries' | 'training'> & Partial<Pick<SeasonState, 'physio' | 'assistant' | 'seasonNumber' | 'lifecycle' | 'academy' | 'relationships' | 'fixtures' | 'background'>> & WorldContext, fixture: SeasonFixture): MatchState {
  const homeClub = season.clubs.find(club => club.id === fixture.homeClubId);
  const awayClub = season.clubs.find(club => club.id === fixture.awayClubId);
  // Step 3.5b: a European game's club outside the full world plays as a background side.
  const background = (clubId: string) => fixture.competition ? backgroundMatchdayTeam(season, clubId, fixture, season.seasonNumber ?? 1) : undefined;
  const homeBackground = homeClub ? undefined : background(fixture.homeClubId), awayBackground = awayClub ? undefined : background(fixture.awayClubId);
  if (!homeClub && !homeBackground || !awayClub && !awayBackground) throw new Error('A fixture refers to a missing club.');
  const home = homeClub ? teamForMatchday(season, homeClub, fixture) : homeBackground!, away = awayClub ? teamForMatchday(season, awayClub, fixture) : awayBackground!;
  const homePlan = homeClub ? season.plans[home.id]! : backgroundPlan(home), awayPlan = awayClub ? season.plans[away.id]! : backgroundPlan(away);
  const lineup = (club: Team, plan: ClubPlan) => [...new Set([...plan.lineup.filter(id => club.players.some(player => player.id === id)), ...club.players.map(player => player.id)])].slice(0, 5);
  const registeredPlayers = new Set([...home.players, ...away.players].map(player => player.id));
  const preparedMorale = season.relationships ? getPreparedRelationshipMorale(season as SeasonState, fixture.round, season.seasonNumber) : undefined;
  // Background players have no squad relationships: a neutral assessment.
  const morale = preparedMorale ? { ...preparedMorale, values: Object.fromEntries([...home.players, ...away.players].map(player => [player.id, Object.hasOwn(preparedMorale.values, player.id) ? preparedMorale.values[player.id]! : 50])) } : undefined;
  const backgroundCondition = (team: Team | undefined) => team ? backgroundConditions(season.fixtures ?? [], team, fixture.date) : {};
  const conditions = { ...backgroundCondition(homeBackground), ...backgroundCondition(awayBackground), ...Object.fromEntries([homeClub ? home : null, awayClub ? away : null].flatMap(team => team ? team.players.map(player => [player.id, season.conditions[player.id]!]) : [])) };
  const develop = (team: Team, full: boolean) => full ? developClub(team, season.training, { ...season, date: fixture.date }) : team;
  let match = createFixtureMatch(fixtureSeed(season.seed, fixture.id), develop(home, !!homeClub), develop(away, !!awayClub), {
    ...(morale ? { morale } : {}),
    lineups: { home: lineup(home, homePlan), away: lineup(away, awayPlan) },
    tactics: { home: homePlan.tactics, away: awayPlan.tactics },
    autoSubstitutions: { home: home.id === season.managedClubId ? homePlan.autoSubstitutions : true, away: away.id === season.managedClubId ? awayPlan.autoSubstitutions : true },
    conditions,
    injuryMode: season.injuryMode,
    preExistingInjuries: Object.fromEntries(season.injuries.filter(injury => registeredPlayers.has(injury.playerId) && isRecovering(injury, fixture.date, season.physio)).map(injury => [injury.playerId, injury.kind])),
  });
  if (season.assistant?.enabledSince) for (const side of SIDES) {
    if (match[side].id === season.managedClubId) continue;
    const contract = season.assistant.contracts.find(contract => contract.clubId === match[side].id && contract.seasonNumber === season.seasonNumber && contract.startedRound <= fixture.round && contract.releasedRound === null);
    const coach = contract && ASSISTANT_DIRECTORY.find(coach => coach.id === contract.assistantId);
    if (coach && match.status !== 'finished') match = applyAssistantTactics(match, side, coach);
  }
  return match;
}

/** One pre-tipoff command for every UI selection route. No fees, random draws or completed history are changed. */
export function setMatchdaySelection(state: SeasonState, playerIds: readonly string[] | null): SeasonState {
  if (!canSelectMatchday(state)) throw new Error('Choose the matchday squad before tipoff.');
  const club = state.clubs.find(club => club.id === state.managedClubId)!;
  if (playerIds !== null) selectedTeam(club, playerIds);
  const ids = playerIds === null ? null : club.players.filter(player => playerIds.includes(player.id)).map(player => player.id);
  const plan = state.plans[club.id]!;
  // Keep pre-match tactics and lineup edits already made on the prepared match.
  if (!state.activeMatch) throw new Error('Select the matchday squad when your next fixture opens.');
  const side = managedSide(state), edited = state.activeMatch;
  const next = { ...state, plans: { ...state.plans, [club.id]: { ...plan, tactics: { ...edited.tactics[side] }, autoSubstitutions: edited.autoSubstitutions[side], lineup: [...edited.lineups[side]], matchday: ids } } };
  return { ...next, activeMatch: prepareMatch(next, getActiveFixture(next)) };
}

/** Optional career systems, named. Omitted systems keep the positional defaults (training, coaching, finance and payroll on). */
export interface SeasonSystems {
  training?: boolean; coaching?: boolean; finance?: boolean; payroll?: boolean; employment?: boolean; scouting?: boolean;
  negotiations?: boolean; market?: boolean; scouts?: boolean; fitness?: boolean; physio?: boolean; assistant?: boolean;
  academy?: boolean; youth?: boolean; lifecycle?: boolean; youthCompetition?: boolean; facilities?: boolean;
  relationships?: boolean; board?: boolean; commercial?: boolean; boardFunding?: boolean; boardConsequences?: boolean; rivalries?: boolean; facilityMaintenance?: boolean; careerMoves?: boolean;
}
export interface SeasonOptions extends SeasonSystems {
  seed?: number; managedClubId?: string; injuryMode?: InjuryMode; manager?: ManagerProfile | null;
  /** The league to play in; the built-in fictional league when omitted. Other worlds are stored in the career's save. */
  world?: CareerWorld;
}

/** Every system a brand-new career starts with, as chosen by the New career screen. */
export const NEW_CAREER_SYSTEMS: Readonly<Required<SeasonSystems>> = Object.freeze({
  training: true, coaching: true, finance: true, payroll: true, employment: true, scouting: true, negotiations: true, market: true,
  scouts: true, fitness: true, physio: true, assistant: true, academy: true, youth: true, lifecycle: true, youthCompetition: true,
  facilities: true, relationships: true, board: true, commercial: true, boardFunding: true, boardConsequences: true, rivalries: true, facilityMaintenance: true, careerMoves: true,
});
const SEASON_OPTION_KEYS = new Set(['seed', 'managedClubId', 'injuryMode', 'manager', 'world', ...Object.keys(NEW_CAREER_SYSTEMS)]);

/** Create a career from named options (preferred) or the original positional arguments, which stay supported. */
export function createSeason(options: SeasonOptions): SeasonState;
export function createSeason(seed?: number, managedClubId?: string, injuryMode?: InjuryMode, trainingEnabled?: boolean, coachingEnabled?: boolean, financeEnabled?: boolean, payrollEnabled?: boolean, manager?: ManagerProfile | null, employmentEnabled?: boolean, scoutingEnabled?: boolean, negotiationsEnabled?: boolean, marketEnabled?: boolean, scoutsEnabled?: boolean, fitnessEnabled?: boolean, physioEnabled?: boolean, assistantEnabled?: boolean, academyEnabled?: boolean, youthEnabled?: boolean, lifecycleEnabled?: boolean, youthCompetitionEnabled?: boolean, facilitiesEnabled?: boolean, relationshipsEnabled?: boolean, boardEnabled?: boolean): SeasonState;
export function createSeason(first?: number | SeasonOptions, ...positional: unknown[]): SeasonState {
  if (typeof first !== 'object' || first === null) return (createSeasonFromFlags as (...args: unknown[]) => SeasonState)(first, ...positional);
  const unknown = Object.keys(first).filter(key => !SEASON_OPTION_KEYS.has(key));
  if (unknown.length || positional.length) throw new Error(`Unsupported career options: ${unknown.join(', ') || 'extra positional arguments'}.`);
  const options = first, finance = options.finance ?? true;
  return createSeasonFromFlags(options.seed, options.managedClubId, options.injuryMode, options.training ?? true, options.coaching ?? true, finance, options.payroll ?? finance, options.manager ?? null, options.employment ?? false, options.scouting ?? false, options.negotiations ?? false, options.market ?? false, options.scouts ?? false, options.fitness ?? false, options.physio ?? false, options.assistant ?? false, options.academy ?? false, options.youth ?? false, options.lifecycle ?? false, options.youthCompetition ?? false, options.facilities ?? false, options.relationships ?? false, options.board ?? false, options.commercial ?? false, options.boardFunding ?? false, options.boardConsequences ?? false, options.rivalries ?? false, options.facilityMaintenance ?? false, options.careerMoves ?? false, options.world ?? DEVELOPMENT_WORLD);
}

// Systems added after the positional form was frozen (starting with sponsorship) are reachable only through named options.
function createSeasonFromFlags(seed = 42, managedClubId?: string, injuryMode: InjuryMode = 'standard', trainingEnabled = true, coachingEnabled = true, financeEnabled = true, payrollEnabled = financeEnabled, manager: ManagerProfile | null = null, employmentEnabled = false, scoutingEnabled = false, negotiationsEnabled = false, marketEnabled = false, scoutsEnabled = false, fitnessEnabled = false, physioEnabled = false, assistantEnabled = false, academyEnabled = false, youthEnabled = false, lifecycleEnabled = false, youthCompetitionEnabled = false, facilitiesEnabled = false, relationshipsEnabled = false, boardEnabled = false, commercialEnabled = false, boardFundingEnabled = false, boardConsequencesEnabled = false, rivalriesEnabled = false, maintenanceEnabled = false, careerMovesEnabled = false, world: CareerWorld = DEVELOPMENT_WORLD): SeasonState {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) throw new Error('Choose a whole-number season seed between zero and 4294967295.');
  validateWorld(world);
  managedClubId ??= fullWorldClubs(world)[0]!.id;
  if (!fullWorldClubs(world).some(club => club.id === managedClubId)) throw new Error(world.id === DEVELOPMENT_WORLD.id ? 'Choose a club from the development league.' : 'Choose a club from this league.');
  if (!['standard', 'reduced', 'off'].includes(injuryMode)) throw new Error('Choose a valid season injury setting.');
  if (typeof trainingEnabled !== 'boolean') throw new Error('Choose a valid training setting.');
  if (typeof coachingEnabled !== 'boolean') throw new Error('Choose a valid coaching setting.');
  if (typeof financeEnabled !== 'boolean') throw new Error('Choose a valid club finance setting.');
  if (typeof payrollEnabled !== 'boolean' || payrollEnabled && !financeEnabled) throw new Error('Player payroll requires enabled club finances and a valid payroll setting.');
  if (typeof employmentEnabled !== 'boolean' || employmentEnabled && !payrollEnabled) throw new Error('Player contracts require enabled payroll and a valid contract setting.');
  if (typeof scoutingEnabled !== 'boolean') throw new Error('Choose a valid scouting setting.');
  if (typeof scoutsEnabled !== 'boolean' || scoutsEnabled && (!scoutingEnabled || !financeEnabled)) throw new Error('Scout recruitment requires enabled scouting and club finances.');
  if (typeof fitnessEnabled !== 'boolean' || fitnessEnabled && (!trainingEnabled || !financeEnabled)) throw new Error('Fitness coaches require enabled training and club finances.');
  if (typeof physioEnabled !== 'boolean' || physioEnabled && !financeEnabled) throw new Error('Physios require enabled club finances.');
  if (typeof assistantEnabled !== 'boolean' || assistantEnabled && !financeEnabled) throw new Error('Assistant coaches require enabled club finances.');
  if (typeof academyEnabled !== 'boolean' || academyEnabled && (!employmentEnabled || !negotiationsEnabled || !payrollEnabled || !financeEnabled)) throw new Error('The academy requires finances, payroll, employment and negotiations.');
  if (typeof youthEnabled !== 'boolean' || youthEnabled && !academyEnabled) throw new Error('Youth coaches require an enabled academy.');
  if (typeof lifecycleEnabled !== 'boolean' || lifecycleEnabled && !academyEnabled) throw new Error('Player aging and retirement require an enabled academy.');
  if (typeof youthCompetitionEnabled !== 'boolean' || youthCompetitionEnabled && !academyEnabled) throw new Error('Youth matches require an enabled academy.');
  if (typeof boardEnabled !== 'boolean') throw new Error('Choose a valid board expectations setting.');
  if (typeof relationshipsEnabled !== 'boolean') throw new Error('Choose a valid squad relationships setting.');
  if (typeof facilitiesEnabled !== 'boolean' || facilitiesEnabled && !financeEnabled) throw new Error('Club facilities require enabled finances.');
  if (typeof commercialEnabled !== 'boolean' || commercialEnabled && !financeEnabled) throw new Error('Sponsorship negotiations require enabled club finances.');
  if (typeof boardFundingEnabled !== 'boolean' || boardFundingEnabled && (!facilitiesEnabled || !boardEnabled)) throw new Error('Board funding requests require club facilities and board reviews.');
  if (typeof boardConsequencesEnabled !== 'boolean' || boardConsequencesEnabled && !boardEnabled) throw new Error('Board verdicts require board reviews.');
  if (typeof rivalriesEnabled !== 'boolean') throw new Error('Choose a valid rivalries setting.');
  if (typeof maintenanceEnabled !== 'boolean' || maintenanceEnabled && !facilitiesEnabled) throw new Error('Facility upkeep plans require club facilities.');
  if (typeof careerMovesEnabled !== 'boolean' || careerMovesEnabled && !boardEnabled) throw new Error('Dismissal and job changes require board reviews.');
  if (typeof negotiationsEnabled !== 'boolean' || negotiationsEnabled && !employmentEnabled) throw new Error('Contract negotiations require enabled player contracts and a valid negotiation setting.');
  if (typeof marketEnabled !== 'boolean' || marketEnabled && !negotiationsEnabled) throw new Error('The offseason calendar requires enabled negotiations and a valid setting.');
  const managerProfile = manager === null ? null : validateManagerProfile(manager, DEVELOPMENT_START_DATE);
  // Next-division clubs (format 54) start outside the full world.
  const clubs = fullWorldClubs(world);
  const divisions = openingDivisions(world);
  // Step 3.5e: the season's opening games include those already due (the BCL's qualification and drawn groups).
  const fixtures = scheduledFixtures({ clubs, fixtures: [], world, divisions, seed }, 1);
  const first = fixtures.find(fixture => fixture.round === 1 && [fixture.homeClubId, fixture.awayClubId].includes(managedClubId));
  const preparation = {
    ...storedWorld(world), seed, clubs, managedClubId, injuryMode, injuries: [], training: createTraining(clubs, trainingEnabled), coaching: createCoaching(clubs, 1, 1, coachingEnabled),
    plans: Object.fromEntries(clubs.map(club => [club.id, { ...defaultPlan(club, club.id !== managedClubId), ...(usesFullClubRoster({ world }) ? { matchday: null } : {}) }])),
    conditions: Object.fromEntries(clubs.flatMap(club => club.players.map(player => [player.id, 100]))),
  };
  const state: SeasonState = {
    schemaVersion: SEASON_SCHEMA_VERSION, engineVersion: 'possession-3', dataPackId: world.id, seasonNumber: 1, history: [], manager: managerProfile, rosters: createRosterSnapshots(clubs, 1), finance: createFinance(clubs, managedClubId), payroll: createPayroll(clubs, managedClubId), employment: createEmployment(), recruitment: createInSeasonRecruitment(), scouting: createScouting(clubs, managedClubId), scouts: createScouts(), fitness: createFitness(), physio: createPhysio(), assistant: createAssistant(), academy: createAcademy(), youth: createYouth(), lifecycle: createLifecycle(), youthCompetition: createYouthCompetition(), facilities: createFacilities(clubs, managedClubId), relationships: createRelationships(), board: createBoard(), rivalries: createRivalries(), career: createCareer(), commercial: createCommercial(clubs, managedClubId), negotiations: createNegotiations(), market: createMarket(),
    ...preparation, ...(world.domesticLeagues ? { restWeeks: [] } : {}), ...(divisions ? { divisions, background: createBackground() } : {}), date: dateForRound(1), status: 'active', round: 1, fixtures,
    activeFixtureId: first?.id ?? null, activeMatch: first ? prepareMatch(preparation, first) : null,
  };
  const funded = financeEnabled ? enableFinance(state) : state;
  const paid = payrollEnabled ? preparePayrollRound(enablePayroll(funded)) : funded;
  const contracted = employmentEnabled ? enableEmployment(paid) : paid;
  const observed = scoutingEnabled ? enableScouting(contracted) : contracted;
  const staffed = scoutsEnabled ? enableScouts(observed) : observed;
  const fitnessReady = fitnessEnabled ? enableFitness(staffed) : staffed;
  const medicalReady = physioEnabled ? enablePhysio(fitnessReady) : fitnessReady;
  const assisted = assistantEnabled ? enableAssistant(medicalReady) : medicalReady;
  const negotiated = negotiationsEnabled ? enableNegotiations(assisted) : assisted;
  const marketReady = marketEnabled ? enableMarket(negotiated) : negotiated;
  const ready = employmentEnabled && negotiationsEnabled ? enableInSeasonTransfers(enableInSeasonRecruitment(marketReady)) : marketReady;
  const academyReady = academyEnabled ? enableAcademy(ready) : ready;
  const academyStaffed = youthEnabled ? enableYouth(academyReady) : academyReady;
  const developed = lifecycleEnabled ? enableLifecycle(academyStaffed) : academyStaffed;
  const youthReady = youthCompetitionEnabled ? enableYouthCompetition(developed) : developed;
  const built = facilitiesEnabled ? enableFacilities(youthReady) : youthReady;
  const sponsored = commercialEnabled ? enableCommercial(built) : built;
  const related = relationshipsEnabled ? prepareRelationshipsRound(enableRelationships(sponsored)) : sponsored;
  const boarded = boardEnabled ? enableBoard(related, 'career') : related;
  const capitalised = boardFundingEnabled ? enableBoardFunding(boarded) : boarded;
  const judged = boardConsequencesEnabled ? enableBoardConsequences(capitalised) : capitalised;
  const rivalled = rivalriesEnabled ? enableRivalries(judged, 'career') : judged;
  const maintained = maintenanceEnabled ? enableFacilityMaintenance(rivalled) : rivalled;
  const reviewed = careerMovesEnabled ? enableCareerMoves(maintained, 'career') : maintained;
  // Only a genuinely new career is prepared after initial staffing. Legacy opt-in never rewrites its current match.
  return first && (assistantEnabled || relationshipsEnabled) ? { ...reviewed, activeMatch: prepareMatch(reviewed, first) } : reviewed;
}

function compactResult(match: MatchState, rosterIds: FixtureResult['rosterIds']): FixtureResult {
  if (match.status !== 'finished' || !match.result) throw new Error('Only a finished game can post a season result.');
  return {
    score: { ...match.score }, officialScore: { ...match.result.officialScore }, winnerClubId: match[match.result.winner].id,
    kind: match.result.kind, periods: match.period, rosterIds,
    stats: Object.fromEntries(Object.entries(match.stats).map(([id, stats]) => [id, { ...stats }])),
    injuries: Object.fromEntries(Object.entries(match.injuries).map(([id, injury]) => [id, injury.kind])),
  };
}

function postMatch(season: SeasonState, fixture: SeasonFixture, match: MatchState): void {
  if (fixture.result) throw new Error('This fixture result has already been committed.');
  if (match.home.id !== fixture.homeClubId || match.away.id !== fixture.awayClubId || match.seed !== fixtureSeed(season.seed, fixture.id)) throw new Error('The match does not belong to its season fixture.');
  const rosterIds = {} as FixtureResult['rosterIds'];
  for (const side of SIDES) {
    // Step 3.5b: a background side's selection comes from its squad for the season.
    if (fixture.competition && !season.clubs.some(club => club.id === match[side].id)) {
      const squad = new Set(backgroundSide(season, match[side].id, season.seasonNumber).players.map(player => player.id));
      if (match[side].players.some(player => !squad.has(player.id))) throw new Error('The match squad does not match its background squad.');
      rosterIds[side] = backgroundRosterId(match[side].id, season.seasonNumber);
      continue;
    }
    const snapshot = rosterForRound(season.rosters, match[side].id, fixture.round);
    const registeredIds = new Set(snapshot.players.map(player => player.id));
    const matchIds = match[side].players.map(player => player.id);
    if (registeredIds.size !== snapshot.players.length || new Set(matchIds).size !== matchIds.length || (!usesFullClubRoster(season) && matchIds.length !== registeredIds.size) || matchIds.some(id => !registeredIds.has(id))) throw new Error('The match squad does not match its registered roster.');
    if (usesFullClubRoster(season)) selectedTeam({ ...match[side], players: snapshot.players }, matchIds);
    rosterIds[side] = snapshot.id;
  }
  fixture.result = compactResult(match, rosterIds);
  if (usesFullClubRoster(season)) fixture.result.selection = captureMatchdaySelection(season.clubs, match.home, match.away, season.conditions);
  for (const injury of injuriesFromMatch(season.seed, fixture, match)) {
    if (season.injuries.some(existing => existing.id === injury.id || existing.playerId === injury.playerId && isRecovering(existing, fixture.date, season.physio))) throw new Error('An unavailable player cannot receive a duplicate injury episode.');
    season.injuries.push(injury);
  }
  for (const side of SIDES) {
    const club = match[side], previous = season.plans[club.id];
    if (!previous) continue;
    // Fouls reset next game. Keep the final lineup, filling any excluded-player
    // vacancies from the previous starters and then the roster's stable order.
    const lineup = [...new Set([...match.lineups[side], ...previous.lineup, ...club.players.map(player => player.id)])].slice(0, 5);
    season.plans[club.id] = { ...previous, tactics: { ...match.tactics[side] }, lineup, autoSubstitutions: club.id === season.managedClubId ? match.autoSubstitutions[side] : true };
    for (const player of club.players) season.conditions[player.id] = match.stats[player.id]!.condition;
  }
}

/** Commits a complete round atomically; a failed transition leaves its input untouched. */
/**
 * Commit the current matchday. On the final matchday the manager's season-end decision applies after the final board
 * review and before the offseason opens, so the new club runs that offseason. Without a decision the manager stays,
 * unless the board dismissed them: they then join the best club that offered its job.
 */
export function advanceSeason(state: SeasonState, decision?: SeasonEndDecision): SeasonState {
  const rounds = seasonRounds(state);
  if (decision !== undefined && (state.round !== rounds || !decision || typeof decision !== 'object' || typeof decision.moveTo !== 'string' || Object.keys(decision).length !== 1)) throw new Error('A club change can only be decided when the final matchday is committed.');
  const committed = commitMatchday(state);
  let next = committed.next;
  // Step 3.4a: more games this week (a postseason game day), so the week's management waits for its last game day.
  if (!committed.weekDone) {
    if (decision !== undefined) throw new Error('A club change can only be decided when the final matchday is committed.');
    return prepareGameDay(next);
  }
  if (next.round === rounds) {
    next.status = 'complete';
    // Step 3.4d-2: clubs leaving and joining the full world are decided now, before the manager's season-end decision.
    const exchanges = computeExchanges(next, getPostseasons(next, next.seasonNumber), dateForRound(1, next.seasonNumber + 1));
    if (exchanges.length) next = { ...next, background: { ...next.background!, exchanges: [...next.background!.exchanges!, ...exchanges] } };
    const outlook = seasonEndOutlook(next);
    if (decision) { const refusal = jobOfferRefusal(outlook, decision.moveTo); if (refusal) throw new Error(refusal); }
    const moveTo = decision?.moveTo ?? (outlook?.dismissed ? outlook.offers[0]?.clubId : undefined);
    if (moveTo) next = appointManager(next, moveTo, outlook!.dismissed ? 'dismissed' : 'moved');
    // Earned sponsor bonuses follow the final review; clubs still without a sponsor receive a second round of offers.
    next = completeCommercialSeason(next);
    return automateFacilities(prepareEmploymentMarket(next));
  }
  return prepareNextMatchday(state, next);
}

/**
 * The board's verdict and the job offers that committing the final matchday would bring, without committing it; the
 * manager decides from this before the offseason opens. Null before the final matchday or while job changes are off.
 */
export function previewSeasonEnd(state: SeasonState): SeasonEndOutlook | null {
  if (state.status !== 'active' || state.round !== seasonRounds(state)) return null;
  const committed = commitMatchday(state);
  return committed.weekDone ? seasonEndOutlook(committed.next) : null;
}

/** The prepared match of the week's next game day, when the managed club plays on it (step 3.4a). */
function prepareGameDay(state: SeasonState): SeasonState {
  const day = currentGameDay(state)!;
  const fixture = state.fixtures.find(fixture => fixture.round === state.round && fixture.date === day && !fixture.result && [fixture.homeClubId, fixture.awayClubId].includes(state.managedClubId));
  return { ...state, activeFixtureId: fixture?.id ?? null, activeMatch: fixture ? prepareMatch(state, fixture) : null };
}

/**
 * Play the current game day: the managed match and the day's other games. After the week's last game day, commit the
 * week's results, accounts and board review (`weekDone`); before it, players recover until the next game day.
 */
function commitMatchday(state: SeasonState): { next: SeasonState; weekDone: boolean } {
  if (state.status === 'complete') throw new Error('This season is complete.');
  requireCalendarWeek(state, false);
  if (state.engineVersion !== 'possession-3') throw new Error('The season must use the supported possession engine.');
  if (state.date !== dateForRound(state.round, state.seasonNumber)) throw new Error('The current round is not awaiting results on this date.');
  if (worldOf(state).domesticLeagues && !Array.isArray(state.restWeeks)) throw new Error('The domestic calendar requires its rest-week evidence.');
  const day = currentGameDay(state);
  const current = day ? state.fixtures.find(fixture => fixture.round === state.round && fixture.date === day && !fixture.result && [fixture.homeClubId, fixture.awayClubId].includes(state.managedClubId)) : undefined;
  if (!!current !== !!state.activeMatch || (current?.id ?? null) !== state.activeFixtureId) throw new Error('The calendar and managed match disagree.');
  if (state.activeMatch) {
    if (state.activeMatch.engineVersion !== state.engineVersion) throw new Error('The season and its match must use the supported possession engine.');
    if (state.activeMatch.status !== 'finished' || state.activeMatch.requiredSubstitutions.length) throw new Error('Finish the current match and resolve required decisions before continuing.');
    if (state.activeMatch.injuryMode !== state.injuryMode || state.injuryMode === 'off' && (state.injuries.length || Object.keys(state.activeMatch.injuries).length)) throw new Error('Every club must use the same season injury setting.');
    managedSide(state);
    if (current!.round !== state.round || current!.date !== day || current!.result) throw new Error('The current round is not awaiting this match result.');
  }
  let next: SeasonState = {
    ...state,
    fixtures: state.fixtures.map(fixture => ({ ...fixture })),
    plans: Object.fromEntries(Object.entries(state.plans).map(([id, plan]) => [id, { ...plan, tactics: { ...plan.tactics }, lineup: [...plan.lineup] }])),
    conditions: { ...state.conditions },
    injuries: state.injuries.map(injury => ({ ...injury })),
  };
  for (const fixture of next.fixtures.filter(fixture => fixture.round === next.round && fixture.date === day)) {
    const match = fixture.id === next.activeFixtureId ? next.activeMatch! : simulateToEnd(prepareMatch(next, fixture));
    postMatch(next, fixture, match);
  }
  // Results can make postseason games due, some of them later this same week.
  next = withDueFixtures(next);
  const following = currentGameDay(next);
  if (day && following) {
    recoverConditions(next.conditions, calendarDaysBetween(day, following));
    return { next, weekDone: false };
  }
  if (next.restWeeks) {
    const playing = new Set(next.fixtures.filter(fixture => fixture.round === next.round).flatMap(fixture => [fixture.homeClubId, fixture.awayClubId]));
    next.restWeeks = [...next.restWeeks, ...next.clubs.filter(club => !playing.has(club.id)).map(club => ({ round: next.round, clubId: club.id, conditions: Object.fromEntries(club.players.map(player => [player.id, next.conditions[player.id]!])) }))];
  }
  next = processYouthRound(next);
  next = processFinanceRound(next);
  next = processPayrollRound(next);
  next = processTransferPayments(next);
  next = processScoutingRound(next);
  return { next: processBoardRound(next), weekDone: true };
}

/** After an ordinary matchday: staff hiring, the calendar step and the next prepared match. */
function prepareNextMatchday(state: SeasonState, committed: SeasonState): SeasonState {
  // Training and recovery start from the week's last game day (step 3.4a), read before the week moves on.
  const trainedFrom = weekLastGameDate(committed.fixtures, committed.round, committed.seasonNumber);
  let next = recruitAiScouts(committed);
  next = recruitAiFitnessCoaches(next);
  next = recruitAiPhysios(next);
  next = recruitAiAssistants(next);
  next = recruitAiYouthCoaches(next);
  next = recruitAiCoaches(next);
  next.round += 1;
  next.date = dateForRound(next.round, next.seasonNumber);
  next = processFacilityProjects(next);
  next.physio = processRehabilitationWeek({ ...storedWorld(worldOf(next)), physio: next.physio, clubs: next.clubs, rosters: next.rosters, injuries: next.injuries, seasonNumber: next.seasonNumber, afterRound: next.round - 1, fromDate: state.date, toDate: next.date });
  if (next.training.enabledSince) {
    const trained = processTrainingWeek({ ...storedWorld(worldOf(next)), facilities: next.facilities, training: next.training, coaching: next.coaching, fitness: next.fitness, physio: next.physio, lifecycle: next.lifecycle, academy: next.academy, clubs: next.clubs, rosters: next.rosters, conditions: next.conditions, injuries: next.injuries, seasonNumber: next.seasonNumber, afterRound: next.round - 1, fromDate: trainedFrom, toDate: next.date });
    next.training = trained.training; next.conditions = trained.conditions;
  } else {
    recoverConditions(next.conditions, calendarDaysBetween(trainedFrom, next.date));
  }
  next.academy = processAcademyWeek({ rounds: seasonRounds(next), ...storedWorld(worldOf(next)), facilities: next.facilities, academy: next.academy, youth: next.youth, youthCompetition: next.youthCompetition, clubs: next.clubs, seasonNumber: next.seasonNumber, afterRound: next.round - 1, fromDate: state.date, toDate: next.date });
  const registeredBefore = next.rosters.length;
  next = resolveInSeasonRecruitment(next);
  next = prepareFinanceRound(next);
  next = processCommercialRound(next);
  next = preparePayrollRound(next);
  next = processTransferPayments(next);
  if (next.rosters.length !== registeredBefore) next = refreshSquadKnowledge(next);
  next = prepareScoutingAssignments(next);
  next = scheduleInSeasonRecruitment(next);
  next = automateFacilities(next);
  next = automateRelationships(prepareRelationshipsRound(next));
  // Step 3.4a: a week whose first game day falls after its Saturday rests until then; the manager's match is that day's.
  const firstDay = currentGameDay(next);
  if (!firstDay) return { ...next, activeFixtureId: null, activeMatch: null };
  if (firstDay > next.date) recoverConditions(next.conditions, calendarDaysBetween(next.date, firstDay));
  return prepareGameDay(next);
}

/** The exchanges recorded at the end of `seasonNumber` (step 3.4d-2). */
export function seasonExchangesOf(background: SeasonState['background'], seasonNumber: number): ClubExchange[] {
  return (background?.exchanges ?? []).filter(exchange => exchange.seasonNumber === seasonNumber);
}

/** Divisions after a season end's exchanges: each lowest division loses its leaving clubs and gains the joining ones. */
export function applyExchanges(leagues: readonly { id: string; clubIds: string[] }[], exchanges: readonly ClubExchange[]): { id: string; clubIds: string[] }[] {
  return leagues.map(league => {
    const exchange = exchanges.find(item => item.leagueId === league.id);
    return exchange ? { id: league.id, clubIds: [...league.clubIds.filter(id => !exchange.leaving.includes(id)), ...exchange.joining] } : { id: league.id, clubIds: [...league.clubIds] };
  });
}

/**
 * The next season's divisions (step 3.4c): from the season in which changes began, the completed season's promotions
 * and relegations move clubs between each country's divisions. Worlds without recorded divisions keep their leagues.
 */
export function nextSeasonDivisions(state: Pick<SeasonState, 'divisions' | 'seasonNumber' | 'fixtures' | 'clubs'> & Partial<Pick<SeasonState, 'background'>> & WorldContext): DomesticDivisions | undefined {
  if (!state.divisions) return undefined;
  if (state.seasonNumber < state.divisions.changesFrom) return state.divisions;
  const changed = divisionChanges(seasonLeagues(worldOf(state), state.divisions), getPostseasons(state, state.seasonNumber));
  return { changesFrom: state.divisions.changesFrom, leagues: applyExchanges(changed.leagues, seasonExchangesOf(state.background, state.seasonNumber)) };
}

/** Archive the completed competition and prepare the same club's next opening day. */
export function rolloverSeason(state: SeasonState): SeasonState {
  if (state.status !== 'complete') throw new Error('Complete the current season before starting the next one.');
  if (state.engineVersion !== 'possession-3' || state.activeMatch && state.activeMatch.engineVersion !== state.engineVersion) throw new Error('The season and its match must use the supported possession engine.');
  const marketWindow = getMarketWindow(state), rounds = seasonRounds(state);
  if (state.round !== rounds || (state.market?.enabledSince ? !marketWindow || marketWindow.closed || state.date !== marketWindow.date || state.date < marketWindow.openedOn || state.date > marketWindow.closesOn : state.date !== dateForRound(rounds, state.seasonNumber))) throw new Error('The season must finish its final matchday and recruitment calendar before rollover.');
  if (state.market?.enabledSince) { const reason = getMarketStartReason(state); if (reason) throw new Error(reason); }
  if (state.activeMatch && (state.activeMatch.status !== 'finished' || !state.activeMatch.result || state.activeMatch.requiredSubstitutions.length)) throw new Error('Finish the current match and resolve required decisions before continuing.');
  if (state.activeMatch && (state.activeMatch.injuryMode !== state.injuryMode || state.injuryMode === 'off' && (state.injuries.length || Object.keys(state.activeMatch.injuries).length))) throw new Error('Every club must use the same season injury setting.');
  if (state.history.length !== state.seasonNumber - 1 || state.history.some((archive, index) => archive.seasonNumber !== index + 1)) throw new Error('Career history must contain each previous season exactly once.');
  const canonical = scheduledFixtures(state, state.seasonNumber);
  if (state.fixtures.length !== canonical.length || state.fixtures.some((fixture, index) => {
    const expected = canonical[index]!;
    return !fixture.result || fixture.id !== expected.id || fixture.round !== expected.round || fixture.date !== expected.date || fixture.homeClubId !== expected.homeClubId || fixture.awayClubId !== expected.awayClubId;
  })) throw new Error('Every scheduled fixture must have a committed result before rollover.');
  // The final match is the managed club's game on the season's last game day, if it plays then (step 3.4a).
  const finalDay = weekLastGameDate(state.fixtures, rounds, state.seasonNumber);
  const expectedFinal = state.fixtures.find(fixture => fixture.round === rounds && fixture.date === finalDay && [fixture.homeClubId, fixture.awayClubId].includes(matchClubFor(state)));
  if ((expectedFinal?.id ?? null) !== state.activeFixtureId || !!expectedFinal !== !!state.activeMatch) throw new Error('The final match must agree with the completed calendar.');
  if (state.activeMatch) {
    const current = getActiveFixture(state);
    managedSide(state);
    if (current.round !== rounds || state.activeMatch.home.id !== current.homeClubId || state.activeMatch.away.id !== current.awayClubId || state.activeMatch.seed !== fixtureSeed(state.seed, current.id)) throw new Error('The final match does not belong to the completed season.');
    const result = current.result!;
    if (result.winnerClubId !== state.activeMatch[state.activeMatch.result!.winner].id || result.kind !== state.activeMatch.result!.kind || result.periods !== state.activeMatch.period || SIDES.some(side => result.score[side] !== state.activeMatch!.score[side] || result.officialScore[side] !== state.activeMatch!.result!.officialScore[side])) throw new Error('The final score must match its committed fixture result.');
  }
  const seasonNumber = state.seasonNumber + 1;
  const divisions = nextSeasonDivisions(state);
  const fixtures = scheduledFixtures({ ...state, divisions, fixtures: [] }, seasonNumber);
  const first = fixtures.find(fixture => fixture.round === 1 && [fixture.homeClubId, fixture.awayClubId].includes(state.managedClubId));
  const recoveryDays = (Date.parse(`${dateForRound(1, seasonNumber)}T00:00:00.000Z`) - Date.parse(`${state.date}T00:00:00.000Z`)) / DAY_MS;
  const archive = {
    seasonNumber: state.seasonNumber,
    ...(state.divisions ? { divisions: state.divisions } : {}),
    rosters: state.rosters.map(roster => ({ ...roster, players: roster.players.map(player => ({ ...player, attributes: { ...player.attributes } })) })),
    fixtures: state.fixtures.map((fixture): ArchivedFixture => {
      const result = fixture.result!;
      getFixtureTeams(state, fixture);
      return {
        id: fixture.id, round: fixture.round, date: fixture.date, homeClubId: fixture.homeClubId, awayClubId: fixture.awayClubId, ...postseasonFields(fixture),
        result: { score: { ...result.score }, officialScore: { ...result.officialScore }, winnerClubId: result.winnerClubId, kind: result.kind, periods: result.periods, injuries: { ...result.injuries }, rosterIds: { ...result.rosterIds }, stats: Object.fromEntries(Object.entries(result.stats).map(([id, stats]) => [id, { ...stats }])), ...(result.selection ? { selection: { home: [...result.selection.home], away: [...result.selection.away], rested: { ...result.selection.rested } } } : {}) },
      };
    }),
  };
  // Step 3.4d-2: leaving clubs' terms end and joining clubs' squads sign before next season's registrations are final.
  const exchanges = seasonExchangesOf(state.background, state.seasonNumber);
  let exchanged = state;
  if (exchanges.length && state.employment.enabledSince) {
    const departures = exchanges.flatMap(exchange => exchange.leaving.map(clubId => departureFor(state.employment, clubId, state.seasonNumber)));
    let contracts = state.employment.contracts;
    for (const exchange of exchanges) contracts = [...contracts, ...joinedContracts(state, exchange, contracts.length + 1, dateForRound(1, seasonNumber))];
    exchanged = { ...state, employment: { ...state.employment, contracts, departures: [...(state.employment.departures ?? []), ...departures] } };
  }
  // Finish recruitment before publishing the new roster, payroll and match together.
  // The archive above still refers to the completed season's registrations.
  const recruited = finalizeEmploymentMarket(exchanged);
  const background = exchanges.length ? {
    ...state.background!,
    clubs: [
      ...state.background!.clubs.map(club => club.until === undefined && exchanges.some(exchange => exchange.joining.includes(club.id)) ? { ...club, until: seasonNumber } : club),
      ...exchanges.flatMap(exchange => exchange.leaving.map(clubId => leavingRecord(state, state.clubs.find(club => club.id === clubId)!, seasonLeagues(worldOf(state), state.divisions).find(league => league.id === exchange.leagueId)!.country, seasonNumber, recruited.employment.enabledSince ? recruited.employment : null))),
    ],
  } : state.background;
  let next: SeasonState = {
    ...recruited, seasonNumber, history: [...state.history, archive], rosters: createRosterSnapshots(recruited.clubs, seasonNumber), fixtures, ...(state.restWeeks ? { restWeeks: [] } : {}), ...(divisions ? { divisions } : {}), ...(background ? { background } : {}), round: 1, date: dateForRound(1, seasonNumber), status: 'active', activeFixtureId: first?.id ?? null, activeMatch: null,
    plans: Object.fromEntries(recruited.clubs.map(club => {
      // A club joining the full world starts from the default plan (step 3.4d-2).
      const plan = state.plans[club.id] ?? { ...defaultPlan(club, true), ...(usesFullClubRoster(state) ? { matchday: null } : {}) };
      const registered = new Set(club.players.map(player => player.id));
      const lineup = [...new Set([...plan.lineup.filter(id => registered.has(id)), ...club.players.map(player => player.id)])].slice(0, 5);
      return [club.id, reconcileMatchdayPlan({ ...plan, tactics: { ...plan.tactics }, lineup }, club)];
    })),
    conditions: Object.fromEntries(Object.entries(state.conditions).map(([id, condition]) => [id, Math.min(100, Math.round((condition + DAILY_RECOVERY * recoveryDays) * 1000) / 1000)])),
    injuries: state.injuries.map(injury => ({ ...injury })),
    training: { ...state.training, lastWeek: null, plans: Object.fromEntries(recruited.clubs.map(club => {
      const plan = state.training.plans[club.id] ?? { delegated: true, intensity: 'standard' as const, focus: 'balanced' as const, individual: {} };
      return [club.id, { ...plan, individual: Object.fromEntries(club.players.map(player => [player.id, plan.individual[player.id] ?? 'team'])) }];
    })) },
    coaching: { ...state.coaching, contracts: [] },
  };
  // Step 3.4d-2: clubs joining the full world get each system's opening records.
  const joining = exchanges.flatMap(exchange => exchange.joining);
  if (joining.length) {
    next = { ...next, conditions: { ...Object.fromEntries(next.clubs.filter(club => joining.includes(club.id)).flatMap(club => club.players.map(player => [player.id, 100]))), ...next.conditions } };
    next = { ...next, training: withTrainingPoints(next.training, next.clubs.filter(club => joining.includes(club.id)).flatMap(club => club.players)) };
  }
  if (exchanges.length) {
    // Per-club settings follow the full world's clubs: leaving clubs' settings go, joining clubs start delegated.
    // Facilities and sponsorship plans stay with every club that has been in the full world; a joining club starts delegated.
    next = { ...next, facilities: { ...next.facilities, delegated: { ...next.facilities.delegated, ...Object.fromEntries(next.clubs.filter(club => !Object.hasOwn(next.facilities.delegated, club.id)).map(club => [club.id, true])) } },
      commercial: { ...next.commercial, plans: { ...next.commercial.plans, ...Object.fromEntries(next.clubs.filter(club => !Object.hasOwn(next.commercial.plans, club.id)).map(club => [club.id, { delegated: true }])) } } };
    const keep = <T>(record: Record<string, T>, fallback: T) => Object.fromEntries(next.clubs.map(club => [club.id, Object.hasOwn(record, club.id) ? record[club.id]! : fallback]));
    const offices = createScouting(next.clubs, next.managedClubId).clubs;
    next = { ...next, payroll: { ...next.payroll, delegated: keep(next.payroll.delegated, true) }, finance: { ...next.finance, plans: keep(next.finance.plans, { delegated: true, price: DEFAULT_TICKET_PRICE }), roundPrices: keep(next.finance.roundPrices, DEFAULT_TICKET_PRICE) },
      scouting: { ...next.scouting, clubs: Object.fromEntries(next.clubs.map(club => [club.id, next.scouting.clubs[club.id] ?? offices[club.id]!])) } };
  }
  next = archiveFinancialHistory(next);
  next = processFacilityProjects(next);
  next = prepareAcademySeason(next);
  next = prepareYouthSeason(next);
  next = prepareLifecycleSeason(next);
  // Joining clubs' opening funds come after the calendar's construction step and before the new season's sponsorship.
  if (joining.length) next = openClubFinances(next, joining, new Set(joining.filter(clubId => !state.background!.clubs.some(club => club.id === clubId))));
  next = startCommercialSeason(next);
  next = startFinanceSeason(next);
  next = startPayrollSeason(next);
  next = resolveInSeasonRecruitment(next);
  next = processTransferPayments(next);
  next = renewSeasonCoaching(next, state.coaching);
  next = renewSeasonScouts(next);
  next = renewSeasonFitness(next);
  next = renewSeasonPhysio(next);
  next = renewSeasonAssistant(next);
  next = renewSeasonYouth(next);
  next = recruitAiScouts(next);
  next = recruitAiFitnessCoaches(next);
  next = recruitAiPhysios(next);
  next = recruitAiAssistants(next);
  next = recruitAiYouthCoaches(next);
  next = recruitAiCoaches(next);
  next = preparePayrollRound(next);
  next = processTransferPayments(next);
  next = prepareScoutingAssignments(refreshSquadKnowledge(next));
  next = scheduleInSeasonRecruitment(next);
  next = automateFacilities(next);
  next = automateRelationships(prepareRelationshipsRound(next));
  next = prepareBoardSeason(next);
  next.activeMatch = first ? prepareMatch(next, first) : null;
  return summarizeSeniorHistory(summarizeYouthHistory(summarizeAcademyHistory(next)));
}

/**
 * Each side's personal fouls in a completed game, from the retained player evidence of its selected players (full box
 * scores, or the per-player appearances kept for archived games of other clubs). The engine has no technical fouls.
 */
function fixtureFouls(fixture: SeasonFixture | ArchivedFixture): { home: number; away: number } {
  const selection = fixture.result?.selection;
  if (!selection) throw new Error('A table that counts fouls needs each game\'s selected players.');
  const side = (ids: readonly string[]) => ids.reduce((sum, id) => sum + (fixturePlayerEvidence(fixture, id)?.fouls ?? 0), 0);
  return { home: side(selection.home), away: side(selection.away) };
}

/** Each domestic league uses its saved rule; legacy worlds retain their original ordering. */
export function getStandings(season: { clubs: readonly Team[]; fixtures: readonly (SeasonFixture | ArchivedFixture)[] } & DivisionContext): Standing[] {
  if (season.world?.domesticLeagues) return seasonLeagues(season.world, season.divisions).flatMap(league => {
    const fixtures = season.fixtures.filter(fixture => isRegularFixture(fixture) && league.clubIds.includes(fixture.homeClubId));
    if (league.standingsRule) return competitionTable({
      competitionId: league.id, clubIds: league.clubIds, rule: league.standingsRule,
      games: fixtures.map(fixture => ({ ...fixture, competitionId: league.id, stage: 'regular' as const, stageRound: fixture.round, groupId: null, seriesId: null, neutral: false })),
      results: fixtures.flatMap(fixture => fixture.result ? [{ fixtureId: fixture.id, home: fixture.result.officialScore.home, away: fixture.result.officialScore.away, winnerClubId: fixture.result.winnerClubId, ...(league.standingsRule === 'fip-art62-2026' ? { fouls: fixtureFouls(fixture) } : {}) }] : []),
    }).map(row => ({ ...row, difference: row.pointsFor - row.pointsAgainst }));
    return getStandings({ clubs: season.clubs.filter(club => league.clubIds.includes(club.id)), fixtures });
  });
  const rows = new Map(season.clubs.map(club => [club.id, { position: 0, clubId: club.id, played: 0, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, difference: 0 }]));
  for (const fixture of season.fixtures) {
    if (!fixture.result || !isRegularFixture(fixture)) continue;
    for (const side of SIDES) {
      const id = side === 'home' ? fixture.homeClubId : fixture.awayClubId;
      const row = rows.get(id);
      if (!row) throw new Error('A result refers to a club outside the league.');
      row.played += 1;
      if (fixture.result.winnerClubId === id) row.wins += 1; else row.losses += 1;
      row.pointsFor += fixture.result.officialScore[side];
      row.pointsAgainst += fixture.result.officialScore[side === 'home' ? 'away' : 'home'];
      row.difference = row.pointsFor - row.pointsAgainst;
    }
  }
  return [...rows.values()].sort((a, b) => b.wins - a.wins || b.difference - a.difference || b.pointsFor - a.pointsFor || (a.clubId < b.clubId ? -1 : a.clubId > b.clubId ? 1 : 0)).map((row, index) => ({ ...row, position: index + 1 }));
}
