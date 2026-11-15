import type { SeasonCareer } from '../domain/career';
import type { ArchivedFixture, SeasonFixture, SeasonState } from '../domain/season';
import type { Team } from '../domain/types';
import { careerMovesGovern, managedClubFor } from './career';
import { seasonVerdict, type SeasonVerdict } from './board-consequences';
import { getStandings } from './season';
import { seasonRounds } from './career-world';
import { seasonLeagues } from './divisions';
import type { WorldContext } from '../domain/world';

/** A season verdict of Under pressure ends the manager's job when dismissal and job changes are on. */
export const DISMISSAL_VERDICT = 'pressure' as const;
/** Reputation weighs the final board confidence of the manager's last three seasons, most recent first. */
export const REPUTATION_WEIGHTS: readonly number[] = Object.freeze([3, 2, 1]);
/** Reputation assumed before any season has a final board review. */
export const STARTING_REPUTATION = 45;
/** Reputation a club needs from a new coach: 25 for last place, 6 more for each place higher in the final table. */
export const VACANCY_BASE_REQUIREMENT = 25;
export const VACANCY_STEP = 6;

type CareerContext = Pick<SeasonState, 'managedClubId' | 'board' | 'clubs' | 'fixtures' | 'history' | 'seasonNumber'> & { career?: SeasonCareer; divisions?: SeasonState['divisions'] } & WorldContext;

export interface ReputationSeason { seasonNumber: number; clubId: string; confidence: number; weight: number }
export interface ManagerReputation { value: number; seasons: ReputationSeason[] }

/** The manager's reputation after `throughSeason`, from the boards of the clubs they ran; it never reads hidden data. */
export function managerReputation(state: CareerContext, throughSeason = state.seasonNumber): ManagerReputation {
  const seasons: ReputationSeason[] = [];
  for (const [offset, weight] of REPUTATION_WEIGHTS.entries()) {
    const seasonNumber = throughSeason - offset;
    if (seasonNumber < 1) break;
    const clubId = managedClubFor(state, seasonNumber, false);
    const verdict = seasonVerdict(state.board, clubId, seasonNumber, seasonRounds(state));
    if (verdict) seasons.push({ seasonNumber, clubId, confidence: verdict.confidence, weight });
  }
  const weights = seasons.reduce((sum, season) => sum + season.weight, 0);
  return { value: weights ? Math.round(seasons.reduce((sum, season) => sum + season.confidence * season.weight, 0) / weights) : STARTING_REPUTATION, seasons };
}

export interface ClubVacancy {
  clubId: string;
  position: number;
  /** Reputation the club needs from its next coach. */
  requirement: number;
  /** `pressure`: the club's own season ended Under pressure; `change`: no other club had a vacancy for a dismissed manager. */
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
}

function seasonFixtures(state: CareerContext, seasonNumber: number): readonly (SeasonFixture | ArchivedFixture)[] | null {
  return seasonNumber === state.seasonNumber ? state.fixtures : state.history.find(archive => archive.seasonNumber === seasonNumber)?.fixtures ?? null;
}

export function vacancyRequirement(position: number, clubs: readonly Pick<Team, 'id'>[]): number {
  return VACANCY_BASE_REQUIREMENT + VACANCY_STEP * (clubs.length - position);
}

/**
 * What the end of a season means for the manager, once its final board review exists and job changes govern it:
 * the board's verdict, clubs replacing their coach and the offers the manager's reputation earns. Null otherwise.
 */
export function seasonEndOutlook(state: CareerContext, seasonNumber = state.seasonNumber): SeasonEndOutlook | null {
  if (!careerMovesGovern(state.career, seasonNumber)) return null;
  const clubId = managedClubFor(state, seasonNumber, false);
  const verdict = seasonVerdict(state.board, clubId, seasonNumber, seasonRounds(state));
  const fixtures = seasonFixtures(state, seasonNumber);
  if (!verdict || !fixtures) return null;
  const dismissed = verdict.verdict === DISMISSAL_VERDICT;
  // That season's own divisions (step 3.4c).
  const divisions = seasonNumber === state.seasonNumber ? state.divisions : state.history.find(archive => archive.seasonNumber === seasonNumber)?.divisions;
  const standings = getStandings({ ...state, fixtures, divisions });
  const vacancy = (id: string, reason: ClubVacancy['reason']): ClubVacancy => {
    const position = standings.find(row => row.clubId === id)!.position;
    return { clubId: id, position, requirement: vacancyRequirement(position, state.clubs.filter(club => !state.world?.domesticLeagues || seasonLeagues(state.world, divisions).find(league => league.clubIds.includes(id))!.clubIds.includes(club.id))), reason, confidence: seasonVerdict(state.board, id, seasonNumber, seasonRounds(state))!.confidence };
  };
  const others = state.clubs.filter(club => club.id !== clubId && seasonVerdict(state.board, club.id, seasonNumber, seasonRounds(state)));
  const vacancies = others.filter(club => seasonVerdict(state.board, club.id, seasonNumber, seasonRounds(state))!.verdict === DISMISSAL_VERDICT).map(club => vacancy(club.id, 'pressure'));
  // A dismissed manager is never left without a club: the least confident board then makes a change.
  if (dismissed && !vacancies.length && others.length) {
    const least = [...others].sort((a, b) => seasonVerdict(state.board, a.id, seasonNumber, seasonRounds(state))!.confidence - seasonVerdict(state.board, b.id, seasonNumber, seasonRounds(state))!.confidence)[0]!;
    vacancies.push(vacancy(least.id, 'change'));
  }
  const reputation = managerReputation(state, seasonNumber);
  const order = (a: ClubVacancy, b: ClubVacancy) => b.requirement - a.requirement || state.clubs.findIndex(club => club.id === a.clubId) - state.clubs.findIndex(club => club.id === b.clubId);
  let offers = vacancies.filter(item => item.requirement <= reputation.value).sort(order);
  // Below every requirement, a dismissed manager still gets the job asking for the least.
  if (dismissed && !offers.length && vacancies.length) offers = [[...vacancies].sort((a, b) => a.requirement - b.requirement || state.clubs.findIndex(club => club.id === a.clubId) - state.clubs.findIndex(club => club.id === b.clubId))[0]!];
  return { seasonNumber, clubId, verdict, dismissed, reputation, vacancies: [...vacancies].sort(order), offers };
}

/** Why the manager cannot take this club's job at the current season end, or null. */
export function jobOfferRefusal(outlook: SeasonEndOutlook | null, clubId: string): string | null {
  if (!outlook) return 'There are no job offers at this point of the season.';
  if (!outlook.offers.some(offer => offer.clubId === clubId)) return 'Choose a club that has offered you its job.';
  return null;
}
