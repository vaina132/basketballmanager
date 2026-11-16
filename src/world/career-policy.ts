import type { CareerMove, CareerMovePhase, SeasonCareer } from '../domain/career';
import type { ArchivedFixture, SeasonFixture, SeasonState } from '../domain/season';
import type { Team } from '../domain/types';
import { careerMovesGovern, managedClubAtRound, managedClubFor } from './career';
import { seasonVerdict, verdictForConfidence, type SeasonVerdict } from './board-consequences';
import { getStandings } from './season';
import { fullWorldClubsIn, seasonRounds } from './career-world';
import { seasonLeagues } from './divisions';
import type { WorldContext } from '../domain/world';
import { allowsUnemployment, CAREER_RULES, careerPointKey, coachProtected, fadedReputation, isUnemployed, midSeasonMinimumGames, NO_CLUB, resignationsCounting, restartsBefore, startingConfidence, usesCareerRules } from './career-rules';
import { calendarDaysBetween } from './competition-calendar';
import { dateForRound } from './season';

/** A season verdict of Under pressure ends the manager's job when dismissal and job changes are on. */
export const DISMISSAL_VERDICT = 'pressure' as const;
/** Reputation weighs the final board confidence of the manager's last three seasons, most recent first. */
export const REPUTATION_WEIGHTS: readonly number[] = Object.freeze([3, 2, 1]);
/** Reputation assumed before any season has a final board review. */
export const STARTING_REPUTATION = 45;
/** Reputation a club needs from a new coach: 25 for last place, 6 more for each place higher in the final table. */
export const VACANCY_BASE_REQUIREMENT = 25;
export const VACANCY_STEP = 6;

type CareerContext = Pick<SeasonState, 'managedClubId' | 'board' | 'clubs' | 'fixtures' | 'history' | 'seasonNumber'> & { career?: SeasonCareer; divisions?: SeasonState['divisions']; background?: SeasonState['background'] } & WorldContext;

export interface ReputationSeason { seasonNumber: number; clubId: string; confidence: number; weight: number }
/** `resignations` (career-2 careers, only when there are any): resignations still costing reputation. */
export interface ManagerReputation { value: number; seasons: ReputationSeason[]; resignations?: number }

/**
 * The manager's reputation after `throughSeason`, from the boards of the clubs they ran; it never reads hidden data.
 * Career-2 careers subtract the cost of resignations in the three seasons up to `penalty.seasonNumber` (default
 * `throughSeason`) made before the career point `penalty.before`.
 */
export function managerReputation(state: CareerContext, throughSeason = state.seasonNumber, penalty?: { seasonNumber: number; before: number }): ManagerReputation {
  const { value, seasons } = reputationSeasons(state, throughSeason);
  if (!usesCareerRules(state.career)) return { value, seasons };
  const resignations = resignationsCounting(state.career, penalty?.seasonNumber ?? throughSeason, penalty?.before).length;
  return resignations ? { value: Math.max(0, value - resignations * CAREER_RULES.resignationReputationCost), seasons, resignations } : { value, seasons };
}

/** The weighted final board confidences behind reputation, before any resignation cost (a season ended without a club counts for nothing). */
function reputationSeasons(state: CareerContext, throughSeason: number): ManagerReputation {
  const seasons: ReputationSeason[] = [];
  for (const [offset, weight] of REPUTATION_WEIGHTS.entries()) {
    const seasonNumber = throughSeason - offset;
    if (seasonNumber < 1) break;
    const clubId = managedClubFor(state, seasonNumber, false);
    const verdict = seasonVerdict(state.board, clubId, seasonNumber, seasonRounds(state));
    if (verdict) seasons.push({ seasonNumber, clubId, confidence: verdict.confidence, weight });
  }
  const weights = seasons.reduce((sum, season) => sum + season.weight, 0);
  const value = weights ? Math.round(seasons.reduce((sum, season) => sum + season.confidence * season.weight, 0) / weights) : STARTING_REPUTATION;
  return { value, seasons };
}

export interface ClubVacancy {
  clubId: string;
  position: number;
  /** Reputation the club needs from its next coach. */
  requirement: number;
  /** `pressure`: the club's own board is replacing its coach; `change`: no other club had a vacancy for a manager who needs a club. */
  reason: 'pressure' | 'change';
  confidence: number;
}

export interface SeasonEndOutlook {
  seasonNumber: number;
  clubId: string;
  verdict: SeasonVerdict;
  dismissed: boolean;
  reputation: ManagerReputation;
  vacancies: ClubVacancy[];
  /** Clubs offering the manager their job, best first; a dismissed manager always has at least one. */
  offers: ClubVacancy[];
  /** Career-2: a season ending Under pressure in the manager's protected first season brings a final warning instead. */
  warning?: true;
  /** Career-2: a dismissal after an in-season review, or the jobs offered to a resigning manager (absent at season ends). */
  timing?: 'mid-season' | 'resignation';
  /** Career-3 (format 69): a dismissed or resigning manager may decline every offer and leave without a club. */
  unemployment?: true;
}

function seasonFixtures(state: CareerContext, seasonNumber: number): readonly (SeasonFixture | ArchivedFixture)[] | null {
  return seasonNumber === state.seasonNumber ? state.fixtures : state.history.find(archive => archive.seasonNumber === seasonNumber)?.fixtures ?? null;
}

export function vacancyRequirement(position: number, clubs: readonly Pick<Team, 'id'>[]): number {
  return VACANCY_BASE_REQUIREMENT + VACANCY_STEP * (clubs.length - position);
}

/** Offers come best first (the highest requirement); ties keep the world's club order. */
const orderBy = (clubs: readonly Pick<Team, 'id'>[]) => (a: ClubVacancy, b: ClubVacancy) => b.requirement - a.requirement || clubs.findIndex(club => club.id === a.clubId) - clubs.findIndex(club => club.id === b.clubId);

/**
 * A reserve or B team ("Fenerbahçe II"): a club's second team, named after the first team with a reserve mark. It
 * never offers the manager its job (its board still changes coach). The data has no reserve flag, so the name decides.
 */
export function isReserveTeam(club: Pick<Team, 'name'>): boolean {
  return /\s(?:II|III|B|2)$/u.test(club.name.trim());
}

/** Whether a club can offer the manager its job: any club of the world except a reserve or B team. */
const offersJob = (clubs: readonly Pick<Team, 'id' | 'name'>[], clubId: string) => { const club = clubs.find(item => item.id === clubId); return !club || !isReserveTeam(club); };

/** A club's level for job offers: its league's tier in that season (1 is a top division); 1 in a world of one league. */
function clubLevel(state: CareerContext, seasonNumber: number): (clubId: string) => number {
  if (!state.world?.domesticLeagues) return () => 1;
  const divisions = seasonNumber === state.seasonNumber ? state.divisions : state.history.find(archive => archive.seasonNumber === seasonNumber)?.divisions;
  const leagues = seasonLeagues(state.world, divisions);
  return clubId => leagues.find(league => league.clubIds.includes(clubId))?.tier ?? 1;
}

/** The best fits first: the highest club level, then the highest requirement; ties keep the world's club order. */
const bestFit = (clubs: readonly Pick<Team, 'id'>[], level: (clubId: string) => number) => (a: ClubVacancy, b: ClubVacancy) => level(a.clubId) - level(b.clubId) || orderBy(clubs)(a, b);

/**
 * Vacancies the reputation earns, at most `CAREER_RULES.maxJobOffers` best fits and never a reserve team's; a manager
 * who must find a club still gets the job asking for the least.
 */
export function offersFor(vacancies: readonly ClubVacancy[], reputation: number, mustMove: boolean, clubs: readonly Pick<Team, 'id' | 'name'>[], level: (clubId: string) => number): ClubVacancy[] {
  const open = vacancies.filter(item => offersJob(clubs, item.clubId));
  const offers = open.filter(item => item.requirement <= reputation).sort(bestFit(clubs, level)).slice(0, CAREER_RULES.maxJobOffers);
  if (mustMove && !offers.length && open.length) return [[...open].sort((a, b) => a.requirement - b.requirement || clubs.findIndex(club => club.id === a.clubId) - clubs.findIndex(club => club.id === b.clubId))[0]!];
  return offers;
}

/** The board that makes a change for a dismissed or resigning manager without offers: the least confident one that can offer a job. */
function leastConfident<T extends Pick<Team, 'id' | 'name'>>(others: readonly T[], order: (a: T, b: T) => number): T {
  const eligible = others.filter(club => !isReserveTeam(club));
  return [...(eligible.length ? eligible : others)].sort(order)[0]!;
}

/**
 * What the end of a season means for the manager, once its final board review exists and job changes govern it:
 * the board's verdict, clubs replacing their coach and the offers the manager's reputation earns. Null otherwise.
 * Career-2 careers (format 63): a coach in his protected first season is never dismissed, and a season ending Under
 * pressure then brings a final warning instead; rival clubs follow the same rule.
 */
export function seasonEndOutlook(state: CareerContext, seasonNumber = state.seasonNumber): SeasonEndOutlook | null {
  if (!careerMovesGovern(state.career, seasonNumber)) return null;
  const clubId = managedClubFor(state, seasonNumber, false);
  const verdict = seasonVerdict(state.board, clubId, seasonNumber, seasonRounds(state));
  const fixtures = seasonFixtures(state, seasonNumber);
  if (!verdict || !fixtures) return null;
  const rules = usesCareerRules(state.career), restarts = rules ? restartsBefore(state.board, seasonNumber, seasonRounds(state), 'end') : [];
  // Career-3 (format 69): a season ended without a club has no verdict for the manager (`unemployedSeasonEndVacancies`).
  const unemployment = allowsUnemployment(state.career);
  const isProtected = (id: string) => rules && coachProtected(restarts, id, seasonNumber);
  // Owner decision (a), 15 November 2026: a club leaving the full world at this season end counts as a dismissal, so the
  // manager is offered at least one job at a full-world club. Leaving clubs offer no jobs.
  const leaving = new Set((state.background?.exchanges ?? []).filter(exchange => exchange.seasonNumber === seasonNumber).flatMap(exchange => exchange.leaving));
  const seasonClubs = state.world?.domesticLeagues ? fullWorldClubsIn(state, seasonNumber) : state.clubs;
  const pressure = verdict.verdict === DISMISSAL_VERDICT;
  const dismissed = pressure && !isProtected(clubId) || leaving.has(clubId);
  // That season's own divisions (step 3.4c).
  const divisions = seasonNumber === state.seasonNumber ? state.divisions : state.history.find(archive => archive.seasonNumber === seasonNumber)?.divisions;
  const standings = getStandings({ ...state, fixtures, divisions });
  const vacancy = (id: string, reason: ClubVacancy['reason']): ClubVacancy => {
    const position = standings.find(row => row.clubId === id)!.position;
    return { clubId: id, position, requirement: vacancyRequirement(position, seasonClubs.filter(club => !state.world?.domesticLeagues || seasonLeagues(state.world, divisions).find(league => league.clubIds.includes(id))!.clubIds.includes(club.id))), reason, confidence: seasonVerdict(state.board, id, seasonNumber, seasonRounds(state))!.confidence };
  };
  const others = seasonClubs.filter(club => club.id !== clubId && !leaving.has(club.id) && seasonVerdict(state.board, club.id, seasonNumber, seasonRounds(state)));
  const vacancies = others.filter(club => seasonVerdict(state.board, club.id, seasonNumber, seasonRounds(state))!.verdict === DISMISSAL_VERDICT && !isProtected(club.id)).map(club => vacancy(club.id, 'pressure'));
  // A dismissed manager is never left without a club: the least confident board then makes a change (career-2: a board
  // whose coach is outside his protected first season, when there is one). Career-3 keeps this only for a club leaving
  // the full world (owner decision (a)); otherwise a dismissed manager without offers becomes unemployed.
  const guaranteed = !unemployment || leaving.has(clubId);
  if (dismissed && guaranteed && !vacancies.some(item => offersJob(seasonClubs, item.clubId)) && others.length) {
    const least = leastConfident(others, (a, b) => Number(isProtected(a.id)) - Number(isProtected(b.id)) || seasonVerdict(state.board, a.id, seasonNumber, seasonRounds(state))!.confidence - seasonVerdict(state.board, b.id, seasonNumber, seasonRounds(state))!.confidence);
    vacancies.push(vacancy(least.id, 'change'));
  }
  const reputation = managerReputation(state, seasonNumber, rules ? { seasonNumber, before: careerPointKey(seasonNumber, seasonRounds(state), 'end') } : undefined);
  const offers = offersFor(vacancies, reputation.value, dismissed && guaranteed, seasonClubs, clubLevel(state, seasonNumber));
  return { seasonNumber, clubId, verdict, dismissed, reputation, vacancies: [...vacancies].sort(orderBy(seasonClubs)), offers, ...(rules && pressure && !dismissed ? { warning: true as const } : {}), ...(unemployment && dismissed ? { unemployment: true as const } : {}) };
}

/**
 * Career-3 (format 69): the clubs replacing their coach at the end of a season the manager finished without a club:
 * every club whose season ended Under pressure, outside a protected first season and not leaving the full world. Their
 * jobs stay open to the unemployed manager through that offseason. Empty otherwise.
 */
export function unemployedSeasonEndVacancies(state: CareerContext, seasonNumber = state.seasonNumber): ClubVacancy[] {
  if (!allowsUnemployment(state.career) || !careerMovesGovern(state.career, seasonNumber) || managedClubFor(state, seasonNumber, false) !== NO_CLUB) return [];
  const fixtures = seasonFixtures(state, seasonNumber), rounds = seasonRounds(state);
  if (!fixtures) return [];
  const restarts = restartsBefore(state.board, seasonNumber, rounds, 'end');
  const leaving = new Set((state.background?.exchanges ?? []).filter(exchange => exchange.seasonNumber === seasonNumber).flatMap(exchange => exchange.leaving));
  const seasonClubs = state.world?.domesticLeagues ? fullWorldClubsIn(state, seasonNumber) : state.clubs;
  const divisions = seasonNumber === state.seasonNumber ? state.divisions : state.history.find(archive => archive.seasonNumber === seasonNumber)?.divisions;
  const standings = getStandings({ ...state, fixtures, divisions });
  const vacancies = seasonClubs.filter(club => !leaving.has(club.id) && seasonVerdict(state.board, club.id, seasonNumber, rounds)?.verdict === DISMISSAL_VERDICT && !coachProtected(restarts, club.id, seasonNumber)).map((club): ClubVacancy => {
    const position = standings.find(row => row.clubId === club.id)!.position;
    const league = state.world?.domesticLeagues ? seasonLeagues(state.world, divisions).find(item => item.clubIds.includes(club.id)) : undefined;
    return { clubId: club.id, position, requirement: vacancyRequirement(position, league ? seasonClubs.filter(item => league.clubIds.includes(item.id)) : seasonClubs), reason: 'pressure', confidence: seasonVerdict(state.board, club.id, seasonNumber, rounds)!.confidence };
  });
  return vacancies.sort(orderBy(seasonClubs));
}

/** Requirements during a season use the table so far (in the offseason, the final table), within each club's own league. */
function liveVacancy(state: CareerContext, seasonNumber: number, throughRound: number, seasonClubs: readonly Team[]) {
  const fixtures = (seasonFixtures(state, seasonNumber) ?? []).map(fixture => fixture.round <= throughRound ? fixture : { ...fixture, result: null }) as (SeasonFixture | ArchivedFixture)[];
  const divisions = seasonNumber === state.seasonNumber ? state.divisions : state.history.find(archive => archive.seasonNumber === seasonNumber)?.divisions;
  const standings = getStandings({ ...state, clubs: seasonClubs, fixtures, divisions });
  return (id: string, reason: ClubVacancy['reason'], confidence: number): ClubVacancy => {
    const position = standings.find(row => row.clubId === id)!.position;
    const league = state.world?.domesticLeagues ? seasonLeagues(state.world, divisions).find(item => item.clubIds.includes(id)) : undefined;
    return { clubId: id, position, requirement: vacancyRequirement(position, league ? seasonClubs.filter(club => league.clubIds.includes(club.id)) : seasonClubs), reason, confidence };
  };
}

/** Career-2: the boards that replace their coach after an in-season review, and the dismissed manager's offers. */
export interface MidSeasonChanges {
  seasonNumber: number;
  /** The reviewed week; the changes take effect before the next week's games. */
  round: number;
  reviewId: string;
  /** Rival clubs appointing a new coach, in the world's club order (a board making a change for a dismissed manager last). */
  replaced: string[];
  /** The manager's dismissal and offers (`timing: 'mid-season'`); null when the manager keeps the job. */
  outlook: SeasonEndOutlook | null;
}

/**
 * Career-2: after an in-season review (not the season's final one), a board whose confidence is below
 * `CAREER_RULES.midSeasonDismissalBelow` replaces its coach once the club has played a third of its regular-season
 * games and before its regular season ends, unless the coach is in his protected first season. The same rule applies
 * to the manager and every rival club. A dismissed manager receives offers as at a season end: rivals replacing their
 * coach now, or else the least confident board, by reputation and always at least one. Null when nothing changes.
 */
export function midSeasonChanges(state: CareerContext, reviewIndex = state.board.reviews.length - 1): MidSeasonChanges | null {
  if (!usesCareerRules(state.career)) return null;
  const review = state.board.reviews[reviewIndex];
  if (!review || review.round >= seasonRounds(state) || !careerMovesGovern(state.career, review.seasonNumber)) return null;
  const seasonNumber = review.seasonNumber, round = review.round;
  const mandate = state.board.mandates.find(item => item.id === review.mandateId);
  const restarts = restartsBefore(state.board, seasonNumber, round + 1, 'season');
  const managed = managedClubAtRound(state, seasonNumber, round);
  const seasonClubs = (state.world?.domesticLeagues ? fullWorldClubsIn(state, seasonNumber) : state.clubs).filter(club => review.clubs[club.id]);
  const isProtected = (id: string) => coachProtected(restarts, id, seasonNumber);
  const fails = (id: string) => {
    const result = review.clubs[id], objective = mandate?.clubs[id];
    return !!result && !!objective && objective.games > 0 && result.played >= midSeasonMinimumGames(objective.games) && result.played < objective.games && result.confidence < CAREER_RULES.midSeasonDismissalBelow && !isProtected(id);
  };
  const replaced = seasonClubs.filter(club => club.id !== managed && fails(club.id)).map(club => club.id);
  if (!fails(managed)) return replaced.length ? { seasonNumber, round, reviewId: review.id, replaced, outlook: null } : null;
  const vacancy = liveVacancy(state, seasonNumber, round, seasonClubs);
  const vacancies = replaced.map(id => vacancy(id, 'pressure', review.clubs[id]!.confidence));
  const others = seasonClubs.filter(club => club.id !== managed);
  // Career-3 (format 69): no board makes a change only to find the dismissed manager a club.
  const unemployment = allowsUnemployment(state.career);
  if (!unemployment && !vacancies.some(item => offersJob(seasonClubs, item.clubId)) && others.length) {
    const least = leastConfident(others, (a, b) => Number(isProtected(a.id)) - Number(isProtected(b.id)) || review.clubs[a.id]!.confidence - review.clubs[b.id]!.confidence);
    vacancies.push(vacancy(least.id, 'change', review.clubs[least.id]!.confidence));
    replaced.push(least.id);
  }
  const confidence = review.clubs[managed]!.confidence;
  const reputation = managerReputation(state, seasonNumber - 1, { seasonNumber, before: careerPointKey(seasonNumber, round + 1, 'season') });
  const verdict: SeasonVerdict = { clubId: managed, seasonNumber, reviewId: review.id, date: review.date, confidence, verdict: verdictForConfidence(confidence) };
  return { seasonNumber, round, reviewId: review.id, replaced, outlook: { seasonNumber, clubId: managed, verdict, dismissed: true, reputation, vacancies: [...vacancies].sort(orderBy(seasonClubs)), offers: offersFor(vacancies, reputation.value, !unemployment, seasonClubs, clubLevel(state, seasonNumber)), timing: 'mid-season', ...(unemployment ? { unemployment: true as const } : {}) } };
}

/** Why the manager cannot resign now, or null. Career-2 careers resign between matches, during a season or offseason. */
export function resignationRefusal(state: SeasonState): string | null {
  if (!usesCareerRules(state.career) || !careerMovesGovern(state.career, state.seasonNumber)) return 'Resigning is part of careers started with dismissal and job offers in this version.';
  if (isUnemployed(state)) return 'You are not managing a club.';
  if (state.status !== 'complete') {
    if (state.fixtures.some(fixture => fixture.round === state.round && fixture.result)) return 'This week\'s games have started. You can resign once they are recorded.';
    if (state.activeMatch && (state.activeMatch.status !== 'ready' || state.activeMatch.stepCount !== 0)) return 'Record this week\'s match first, then you can resign before the next one.';
  }
  const last = state.career.moves.at(-1);
  if (last && last.seasonNumber === state.seasonNumber && last.round === state.round && last.date === state.date) return 'You started this job today. You can resign after the next matchday or recruitment day.';
  return null;
}

/**
 * The jobs offered to a manager who resigns now (career-2): clubs whose board is Under pressure today and whose coach
 * is outside his protected first season, or else the least confident board, at the reputation left after the
 * resignation. There is always at least one offer: below every requirement, the job asking for the least.
 */
export function resignationOutlook(state: SeasonState): SeasonEndOutlook | null {
  if (resignationRefusal(state)) return null;
  const seasonNumber = state.seasonNumber, inSeason = state.status !== 'complete', rounds = seasonRounds(state);
  const managed = state.managedClubId, restarts = state.board.restarts ?? [];
  // In the offseason, coaches are judged for the next season; clubs leaving the full world offer no jobs.
  const judged = inSeason ? seasonNumber : seasonNumber + 1;
  const leaving = new Set(inSeason ? [] : (state.background?.exchanges ?? []).filter(exchange => exchange.seasonNumber === seasonNumber).flatMap(exchange => exchange.leaving));
  const seasonClubs = state.world?.domesticLeagues ? fullWorldClubsIn(state, seasonNumber) : state.clubs;
  const others = seasonClubs.filter(club => club.id !== managed && !leaving.has(club.id));
  if (!others.length) return null;
  const confidence = (id: string) => startingConfidence(state.board, id);
  const isProtected = (id: string) => coachProtected(restarts, id, judged);
  const vacancy = liveVacancy(state, seasonNumber, inSeason ? state.round - 1 : rounds, seasonClubs);
  const vacancies = others.filter(club => confidence(club.id) < CAREER_RULES.seasonDismissalBelow && !isProtected(club.id)).map(club => vacancy(club.id, 'pressure', confidence(club.id)));
  // Career-3 (format 69): only boards Under pressure offer a job; the manager may leave without one.
  const unemployment = allowsUnemployment(state.career);
  if (!vacancies.some(item => offersJob(seasonClubs, item.clubId)) && !unemployment) {
    const least = leastConfident(others, (a, b) => Number(isProtected(a.id)) - Number(isProtected(b.id)) || confidence(a.id) - confidence(b.id));
    vacancies.push(vacancy(least.id, 'change', confidence(least.id)));
  }
  const base = managerReputation(state, inSeason ? seasonNumber - 1 : seasonNumber, { seasonNumber, before: Infinity });
  const reputation: ManagerReputation = { ...base, value: Math.max(0, base.value - CAREER_RULES.resignationReputationCost), resignations: (base.resignations ?? 0) + 1 };
  const current = confidence(managed), latest = state.board.reviews.at(-1);
  const verdict: SeasonVerdict = { clubId: managed, seasonNumber, reviewId: latest?.id ?? '', date: state.date, confidence: current, verdict: verdictForConfidence(current) };
  return { seasonNumber, clubId: managed, verdict, dismissed: false, reputation, vacancies: [...vacancies].sort(orderBy(seasonClubs)), offers: offersFor(vacancies, reputation.value, !unemployment, seasonClubs, clubLevel(state, seasonNumber)), timing: 'resignation', ...(unemployment ? { unemployment: true as const } : {}) };
}

/**
 * Why the manager cannot take this club's job at the current season end, or null. Career-3 (format 69): no club
 * (`NO_CLUB`) declines every offer after a dismissal, or resigns without a new job.
 */
export function jobOfferRefusal(outlook: SeasonEndOutlook | null, clubId: string): string | null {
  if (!outlook) return 'There are no job offers at this point of the season.';
  if (clubId === NO_CLUB) return outlook.unemployment && (outlook.dismissed || outlook.timing === 'resignation') ? null : 'Choose a club that has offered you its job.';
  if (!outlook.offers.some(offer => offer.clubId === clubId)) return 'Choose a club that has offered you its job.';
  return null;
}

/** Career-3: the reputation of a manager without a club, from the reputation left with and the time since. */
export interface UnemployedReputation extends ManagerReputation {
  /** The reputation the manager left with (resignation costs as they stand at this point). */
  base: number;
  /** The day the manager left the last club. */
  since: string;
  /** Whole days without a club so far. */
  days: number;
}

/** A point of the career at which an unemployed manager can take a job: before a week's games, or a day of an offseason. */
export interface CareerPoint { seasonNumber: number; round: number; phase: Exclude<CareerMovePhase, 'end'>; date: string }

/**
 * Career-3 (format 69): the manager's reputation at `at`, unemployed since the last of `prior` (the moves made before
 * `at`). The base is the last three season ends the manager finished at a club (the season of an in-season departure
 * does not count), less the resignations among `prior` still costing reputation; it then fades by `fadedReputation`.
 */
export function unemployedReputation(state: CareerContext, prior: readonly CareerMove[], at: Pick<CareerPoint, 'seasonNumber' | 'date'>): UnemployedReputation {
  const start = prior.at(-1);
  if (!start || start.toClubId !== NO_CLUB) throw new Error('The manager is not unemployed at this point.');
  const through = start.phase === 'season' ? start.seasonNumber - 1 : start.seasonNumber;
  const raw = reputationSeasons(state, Math.max(0, through));
  const resignations = prior.filter(move => move.reason === 'resigned' && move.seasonNumber <= at.seasonNumber && move.seasonNumber > at.seasonNumber - CAREER_RULES.resignationSeasons).length;
  const base = Math.max(0, raw.value - resignations * CAREER_RULES.resignationReputationCost);
  const days = Math.max(0, calendarDaysBetween(start.date, at.date));
  return { value: fadedReputation(base, days), seasons: raw.seasons, ...(resignations ? { resignations } : {}), base, since: start.date, days };
}

/** Career-3: a job open to an unemployed manager, and until when. */
export interface JobVacancy extends ClubVacancy {
  /** `season`: the board replaced its coach at an in-season review; `end`: the club's season ended Under pressure. */
  opened: 'season' | 'end';
  /** The season and week of the review or season end that opened the job. */
  seasonNumber: number;
  round: number;
  /** The last day the job can be taken: the Saturday of its last open week, or null for a season-end job (open through that offseason). */
  openUntil: string | null;
  /** Whether the club offers the job now: the manager's reputation reaches its requirement. */
  offered: boolean;
}

export interface JobMarket { point: CareerPoint; reputation: UnemployedReputation; vacancies: JobVacancy[] }

/**
 * Career-3 (format 69): the jobs open to an unemployed manager at a point of the career, rebuilt from the recorded
 * reviews, restarts and tables. During a season: clubs whose board replaced its coach at a review in the last
 * `vacancyOpenWeeks` weeks. In an offseason: clubs whose season ended Under pressure. Best first.
 */
export function jobMarketAt(state: CareerContext, prior: readonly CareerMove[], point: CareerPoint): JobMarket {
  const reputation = unemployedReputation(state, prior, point), rounds = seasonRounds(state), weeks = CAREER_RULES.vacancyOpenWeeks;
  const seasonClubs = state.world?.domesticLeagues ? fullWorldClubsIn(state, point.seasonNumber) : state.clubs;
  const found = new Map<string, JobVacancy>();
  if (point.phase === 'season') {
    for (const [index, review] of state.board.reviews.entries()) {
      if (review.seasonNumber !== point.seasonNumber || review.round >= rounds || point.round <= review.round || point.round > review.round + weeks) continue;
      const changes = midSeasonChanges(state, index);
      if (!changes?.replaced.length) continue;
      const vacancy = liveVacancy(state, point.seasonNumber, review.round, seasonClubs);
      const last = Math.min(review.round + weeks, rounds);
      for (const clubId of changes.replaced) found.set(clubId, { ...vacancy(clubId, 'pressure', review.clubs[clubId]!.confidence), opened: 'season', seasonNumber: point.seasonNumber, round: review.round, openUntil: dateForRound(last, point.seasonNumber), offered: false });
    }
  } else {
    const outlook = seasonEndOutlook(state, point.seasonNumber);
    const vacancies = outlook ? outlook.vacancies : unemployedSeasonEndVacancies(state, point.seasonNumber);
    for (const vacancy of vacancies) found.set(vacancy.clubId, { ...vacancy, opened: 'end', seasonNumber: point.seasonNumber, round: rounds, openUntil: null, offered: false });
  }
  // The same offer rule as at a season end: reserve teams never offer the job, and only the best fits offer it.
  const open = [...found.values()].filter(vacancy => offersJob(seasonClubs, vacancy.clubId));
  const offered = new Set(offersFor(open, reputation.value, false, seasonClubs, clubLevel(state, point.seasonNumber)).map(vacancy => vacancy.clubId));
  const vacancies = open.map(vacancy => ({ ...vacancy, offered: offered.has(vacancy.clubId) })).sort(orderBy(seasonClubs));
  return { point, reputation, vacancies };
}

/** Career-3: the career point now, at which an unemployed manager can take a job (before this week's games, or in the offseason). */
export function currentCareerPoint(state: Pick<SeasonState, 'seasonNumber' | 'round' | 'status' | 'date'>): CareerPoint {
  return { seasonNumber: state.seasonNumber, round: state.round, phase: state.status === 'complete' ? 'offseason' : 'season', date: state.date };
}

/** Career-3: the job market now, or null while the manager has a club. */
export function jobMarket(state: SeasonState): JobMarket | null {
  if (!isUnemployed(state) || state.career.moves.at(-1)?.toClubId !== NO_CLUB) return null;
  return jobMarketAt(state, state.career.moves, currentCareerPoint(state));
}

/** Career-3: why an unemployed manager cannot take this club's job now, or null. */
export function jobRefusal(state: SeasonState, clubId: string): string | null {
  if (!allowsUnemployment(state.career)) return 'Unemployed seasons are part of careers started in this version.';
  const market = jobMarket(state);
  if (!market) return 'You already manage a club.';
  if (state.status !== 'complete' && state.fixtures.some(fixture => fixture.round === state.round && fixture.result)) return 'This week\'s games have started. You can take a job once they are recorded.';
  const last = state.career.moves.at(-1)!;
  if (last.seasonNumber === state.seasonNumber && last.round === state.round && last.phase === market.point.phase && last.date === state.date) return 'You left your club at this point. Open jobs can be taken from the next week or recruitment day.';
  const vacancy = market.vacancies.find(item => item.clubId === clubId);
  if (!vacancy) return 'This club has no job open to you.';
  if (!vacancy.offered) return vacancy.requirement <= market.reputation.value ? `The board chose other candidates: only the ${CAREER_RULES.maxJobOffers} clubs that fit your reputation best offer you their job.` : `The board looks for a reputation of ${vacancy.requirement}; yours is ${market.reputation.value}.`;
  return null;
}
