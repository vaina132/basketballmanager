import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { realIdNbaPack, realNbaClubId, NBA_CLUB_IDS } from './helpers/nba-pack';
import { worldFromPack } from '../src/world/real-world';
import { createSeason, getPostseasons, getStandings, managedSide, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { setEmploymentDelegation } from '../src/world/employment';
import { runContinueStep } from '../src/world/continue-step';
import { NO_CLUB } from '../src/world/career-rules';
import { isNbaClub, seasonRounds, worldOf } from '../src/world/career-world';
import { acceptNationalOffer, nationalManagedSide, offerNationalJob } from '../src/world/national';
import { seasonEndOutlook } from '../src/world/career-policy';
import { clubHeadCoach, coachPlaces, managerSeasonFacts, MANAGER_COACH } from '../src/world/head-coaches';
import { REAL_NBA_COACHES } from '../src/data/real-coaches';
import { parseSeason, serializeSeasonCompact } from '../src/storage/season-storage';
import { advanceMarket } from '../src/world/market';
import { getMarketStartReason } from '../src/world/market-policy';
import { rolloverSeason } from '../src/world/season';

/**
 * NBA step 10 (format 91): job moves in a combined world of the NBA (real club ids, so the real head coaches are
 * found) and Spain's Liga Endesa. One season is played with Continue, the manager at an NBA club holding Spain's
 * national job (NBA games and national windows on the same weeks); the season-end job market is then read with the
 * manager's reputation and the boards' final verdicts set by the test.
 */
const SPAIN = { id: 'acb', name: 'Liga Endesa', country: 'Spain', tier: 1 as const, levels: [16, 16, 15, 15, 14, 14, 13, 13, 12, 12, 11, 11, 10, 10, 9, 9, 8, 8] };
const MIA = realNbaClubId('nba-mia');
const manager = { name: 'Moving Manager', dateOfBirth: '1979-02-11', nationality: 'Spain' };
const world = worldFromPack(realIdNbaPack([SPAIN]), ['acb', 'nba']);
const nbaIds = NBA_CLUB_IDS.map(realNbaClubId);

let opening: SeasonState, complete: SeasonState, next: SeasonState;
const nationalDates: string[] = [];
let nationalTeamId = '';

/** Continue through the season, finishing every match the manager has (club and national) automatically. */
function playSeason(start: SeasonState): SeasonState {
  let state = start;
  for (let guard = 0; guard < 6000 && state.status === 'active'; guard += 1) {
    const national = state.national?.activeMatch;
    if (national && national.status !== 'finished') { state = { ...state, national: { ...state.national!, activeMatch: simulateToEnd(setAutoSubstitutions(national, nationalManagedSide(state), true)) } }; continue; }
    if (state.activeMatch && state.activeMatch.status !== 'finished') { state = { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) }; continue; }
    const result = runContinueStep(state);
    if ('outlook' in result) {
      // Stay unless dismissed; a dismissed manager takes his best offer or leaves without a club.
      const decision = result.outlook.dismissed ? { moveTo: result.outlook.offers[0]?.clubId ?? NO_CLUB } : undefined;
      const decided = runContinueStep(state, { decided: true, ...(decision ? { decision } : {}) });
      state = (decided as { state: SeasonState }).state;
      continue;
    }
    if (result.step === 'national') nationalDates.push(result.state.date);
    state = result.state;
  }
  return state;
}

/**
 * The completed season with the manager at `clubId` (outside a protected first season: no board changes recorded), his
 * coaching attributes all `attribute` and the given final confidences (every other board content, at 60 or more).
 */
function at(clubId: string, attribute: number, confidences: Readonly<Record<string, number>>): SeasonState {
  const rounds = seasonRounds(complete);
  const reviews = complete.board.reviews.map(review => review.seasonNumber === 1 && review.round === rounds ? { ...review, clubs: Object.fromEntries(Object.entries(review.clubs).map(([id, club]) => [id, id in confidences ? { ...club, confidence: confidences[id]! } : { ...club, confidence: Math.max(club.confidence, 60) }])) } : review);
  const coaches = { ...complete.coaches!, manager: { start: Object.fromEntries(Object.keys(complete.coaches!.manager.start).map(key => [key, attribute])) as NonNullable<SeasonState["coaches"]>["manager"]["start"], seasons: [] } };
  return { ...complete, managedClubId: clubId, career: { ...complete.career, moves: [] }, board: { ...complete.board, reviews, restarts: [] }, coaches };
}

beforeAll(() => {
  opening = setEmploymentDelegation(createSeason({ seed: 7, world, managedClubId: MIA, manager, ...NEW_CAREER_SYSTEMS }), true);
  nationalTeamId = opening.national!.teams.find(team => team.country === 'Spain')!.id;
  const offered = offerNationalJob(opening, nationalTeamId);
  const started = acceptNationalOffer(offered, offered.national!.offers.at(-1)!.id);
  const begun = performance.now();
  complete = playSeason(started);
  let offseason = setEmploymentDelegation(complete, true);
  for (let steps = 0; steps < 200 && getMarketStartReason(offseason); steps += 1) offseason = advanceMarket(offseason);
  next = rolloverSeason(offseason);
  console.log(`NBA + Liga Endesa season with Continue: ${((performance.now() - begun) / 1000).toFixed(1)} s`);
}, 3_500_000);

describe('NBA careers in a combined world (format 91)', () => {
  it('starts the NBA clubs with their real head coaches and frees the coach of the manager\'s club', () => {
    expect(worldOf(complete).nbaJobs).toBe(true);
    expect(coachPlaces(opening).clubs[MIA]).toBe(MANAGER_COACH);
    expect(coachPlaces(opening).free).toContain('coach-erik-spoelstra');
    const names = new Set(REAL_NBA_COACHES.map(coach => coach.name));
    const held = nbaIds.filter(id => id !== MIA).map(id => clubHeadCoach(opening, id)).filter(coach => coach && coach !== MANAGER_COACH && names.has(coach.name));
    expect(held).toHaveLength(29);
  });

  it('plays the NBA season and the national windows together (NBA clubs keep their players; the manager coaches both)', () => {
    expect(complete.status).toBe('complete');
    const team = complete.national!.competitions.flatMap(competition => competition.fixtures).filter(fixture => fixture.homeTeamId === nationalTeamId || fixture.awayTeamId === nationalTeamId);
    const windowGames = team.filter(fixture => fixture.window !== 3);
    expect(windowGames.length).toBeGreaterThan(0);
    expect(windowGames.every(fixture => fixture.result)).toBe(true);
    expect(nationalDates.length).toBeGreaterThan(0);
    const managed = complete.career.moves.length ? complete.career.moves[0]!.fromClubId : MIA;
    expect(complete.fixtures.filter(fixture => !fixture.stage && (fixture.homeClubId === managed || fixture.awayClubId === managed) && fixture.result)).toHaveLength(82);
  });

  it('offers a strong European manager an NBA job first, and a weak one none', () => {
    const table = getStandings(complete);
    const nbaVacancy = nbaIds.filter(id => id !== MIA).sort((a, b) => table.find(row => row.clubId === b)!.position - table.find(row => row.clubId === a)!.position)[0]!;
    const spanish = 'acb-4';
    const lowSpanish = table.filter(row => row.clubId.startsWith('acb-') && row.clubId !== spanish).sort((a, b) => b.position - a.position)[0]!.clubId;
    const strong = seasonEndOutlook(at(spanish, 16, { [spanish]: 90, [nbaVacancy]: 5, [lowSpanish]: 5 }), 1)!;
    expect(strong.reputation.value).toBeGreaterThanOrEqual(70);
    const nbaOffer = strong.vacancies.find(item => item.clubId === nbaVacancy)!;
    expect(nbaOffer.requirement).toBeGreaterThanOrEqual(60);
    expect(nbaOffer.requirement).toBeLessThanOrEqual(strong.reputation.value);
    expect(strong.offers[0]!.clubId).toBe(nbaVacancy);
    const weak = seasonEndOutlook(at(spanish, 6, { [spanish]: 45, [nbaVacancy]: 5, [lowSpanish]: 5 }), 1)!;
    expect(weak.reputation.value).toBeLessThan(60);
    expect(weak.vacancies.some(item => item.clubId === nbaVacancy)).toBe(true);
    expect(weak.offers.some(item => isNbaClub(world, item.clubId))).toBe(false);
    expect(weak.offers.map(item => item.clubId)).toContain(lowSpanish);
  });

  it('brings European offers, not NBA ones, to a manager dismissed by an NBA owner', () => {
    const table = getStandings(complete);
    const nbaVacancy = nbaIds.filter(id => id !== MIA).sort((a, b) => table.find(row => row.clubId === b)!.position - table.find(row => row.clubId === a)!.position)[0]!;
    const lowSpanish = table.filter(row => row.clubId.startsWith('acb-')).sort((a, b) => b.position - a.position).slice(0, 2).map(row => row.clubId);
    const outlook = seasonEndOutlook(at(MIA, 20, { [MIA]: 12, [nbaVacancy]: 5, [lowSpanish[0]!]: 5, [lowSpanish[1]!]: 5 }), 1)!;
    expect(outlook.dismissed).toBe(true);
    expect(outlook.reputation.value).toBeLessThan(60);
    expect(outlook.offers.length).toBeGreaterThan(0);
    expect(outlook.offers.every(item => item.clubId.startsWith('acb-'))).toBe(true);
  });

  it('counts an NBA title as a trophy in the manager\'s season', () => {
    const champion = getPostseasons(complete, 1).find(entry => entry.league.id === 'nba')!.outcome.champion!;
    expect(managerSeasonFacts({ ...complete, managedClubId: champion, career: { ...complete.career, moves: [] } }).trophy).toBe(true);
  });

  it('saves strictly at the season end and continues into season two', () => {
    expect(worldOf(parseSeason(serializeSeasonCompact(complete))).nbaJobs).toBe(true);
    expect(next.seasonNumber).toBe(2);
    expect(parseSeason(serializeSeasonCompact(next)).seasonNumber).toBe(2);
  });
});
