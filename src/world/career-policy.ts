import type { SeasonCareer } from '../domain/career';
import type { ArchivedFixture, SeasonFixture, SeasonState } from '../domain/season';
import type { Team } from '../domain/types';
import { careerMovesGovern, managedClubAtRound, managedClubFor } from './career';
import { seasonVerdict, verdictForConfidence, type SeasonVerdict } from './board-consequences';
import { getStandings } from './season';
import { fullWorldClubsIn, seasonRounds } from './career-world';
import { seasonLeagues } from './divisions';
import type { WorldContext } from '../domain/world';
import { CAREER_RULES, careerPointKey, coachProtected, midSeasonMinimumGames, resignationsCounting, restartsBefore, startingConfidence, usesCareerRules } from './career-rules';

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
  if (!usesCareerRules(state.career)) return { value, seasons };
  const resignations = resignationsCounting(state.career, penalty?.seasonNumber ?? throughSeason, penalty?.before).length;
  return resignations ? { value: Math.max(0, value - resignations * CAREER_RULES.resignationReputationCost), seasons, resignations } : { value, seasons };
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
}

function seasonFixtures(state: CareerContext, seasonNumber: number): readonly (SeasonFixture | ArchivedFixture)[] | null {
  return seasonNumber === state.seasonNumber ? state.fixtures : state.history.find(archive => archive.seasonNumber === seasonNumber)?.fixtures ?? null;
}

export function vacancyRequirement(position: number, clubs: readonly Pick<Team, 'id'>[]): number {
  return VACANCY_BASE_REQUIREMENT + VACANCY_STEP * (clubs.length - position);
}

/** Offers come best first (the highest requirement); ties keep the world's club order. */
const orderBy = (clubs: readonly Pick<Team, 'id'>[]) => (a: ClubVacancy, b: ClubVacancy) => b.requirement - a.requirement || clubs.findIndex(club => club.id === a.clubId) - clubs.findIndex(club => club.id === b.clubId);

/** Vacancies the reputation earns; a manager who must find a club still gets the job asking for the least. */
function offersFor(vacancies: readonly ClubVacancy[], reputation: number, mustMove: boolean, clubs: readonly Pick<Team, 'id'>[]): ClubVacancy[] {
  const offers = vacancies.filter(item => item.requirement <= reputation).sort(orderBy(clubs));
  if (mustMove && !offers.length && vacancies.length) return [[...vacancies].sort((a, b) => a.requirement - b.requirement || clubs.findIndex(club => club.id === a.clubId) - clubs.findIndex(club => club.id === b.clubId))[0]!];
  return offers;
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
  // whose coach is outside his protected first season, when there is one).
  if (dismissed && !vacancies.length && others.length) {
    const least = [...others].sort((a, b) => Number(isProtected(a.id)) - Number(isProtected(b.id)) || seasonVerdict(state.board, a.id, seasonNumber, seasonRounds(state))!.confidence - seasonVerdict(state.board, b.id, seasonNumber, seasonRounds(state))!.confidence)[0]!;
    vacancies.push(vacancy(least.id, 'change'));
  }
  const reputation = managerReputation(state, seasonNumber, rules ? { seasonNumber, before: careerPointKey(seasonNumber, seasonRounds(state), 'end') } : undefined);
  const offers = offersFor(vacancies, reputation.value, dismissed, seasonClubs);
  return { seasonNumber, clubId, verdict, dismissed, reputation, vacancies: [...vacancies].sort(orderBy(seasonClubs)), offers, ...(rules && pressure && !dismissed ? { warning: true as const } : {}) };
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
  if (!vacancies.length && others.length) {
    const least = [...others].sort((a, b) => Number(isProtected(a.id)) - Number(isProtected(b.id)) || review.clubs[a.id]!.confidence - review.clubs[b.id]!.confidence)[0]!;
    vacancies.push(vacancy(least.id, 'change', review.clubs[least.id]!.confidence));
    replaced.push(least.id);
  }
  const confidence = review.clubs[managed]!.confidence;
  const reputation = managerReputation(state, seasonNumber - 1, { seasonNumber, before: careerPointKey(seasonNumber, round + 1, 'season') });
  const verdict: SeasonVerdict = { clubId: managed, seasonNumber, reviewId: review.id, date: review.date, confidence, verdict: verdictForConfidence(confidence) };
  return { seasonNumber, round, reviewId: review.id, replaced, outlook: { seasonNumber, clubId: managed, verdict, dismissed: true, reputation, vacancies: [...vacancies].sort(orderBy(seasonClubs)), offers: offersFor(vacancies, reputation.value, true, seasonClubs), timing: 'mid-season' } };
}

/** Why the manager cannot resign now, or null. Career-2 careers resign between matches, during a season or offseason. */
export function resignationRefusal(state: SeasonState): string | null {
  if (!usesCareerRules(state.career) || !careerMovesGovern(state.career, state.seasonNumber)) return 'Resigning is part of careers started with dismissal and job offers in this version.';
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
  if (!vacancies.length) {
    const least = [...others].sort((a, b) => Number(isProtected(a.id)) - Number(isProtected(b.id)) || confidence(a.id) - confidence(b.id))[0]!;
    vacancies.push(vacancy(least.id, 'change', confidence(least.id)));
  }
  const base = managerReputation(state, inSeason ? seasonNumber - 1 : seasonNumber, { seasonNumber, before: Infinity });
  const reputation: ManagerReputation = { ...base, value: Math.max(0, base.value - CAREER_RULES.resignationReputationCost), resignations: (base.resignations ?? 0) + 1 };
  const current = confidence(managed), latest = state.board.reviews.at(-1);
  const verdict: SeasonVerdict = { clubId: managed, seasonNumber, reviewId: latest?.id ?? '', date: state.date, confidence: current, verdict: verdictForConfidence(current) };
  return { seasonNumber, clubId: managed, verdict, dismissed: false, reputation, vacancies: [...vacancies].sort(orderBy(seasonClubs)), offers: offersFor(vacancies, reputation.value, true, seasonClubs), timing: 'resignation' };
}

/** Why the manager cannot take this club's job at the current season end, or null. */
export function jobOfferRefusal(outlook: SeasonEndOutlook | null, clubId: string): string | null {
  if (!outlook) return 'There are no job offers at this point of the season.';
  if (!outlook.offers.some(offer => offer.clubId === clubId)) return 'Choose a club that has offered you its job.';
  return null;
}
