import { describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { NBA_CLUB_IDS, nbaPack, realIdNbaPack, realNbaClubId } from './helpers/nba-pack';
import { economyPack } from './helpers/economy-pack';
import { worldFromPack } from '../src/world/real-world';
import { createSeason, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { worldOf } from '../src/world/career-world';
import { REAL_NBA_COACHES, REAL_NBA_COACH_POSTS } from '../src/data/real-coaches';
import { coachOverall, COACH_LEVELS, estimateCoach, recordScore } from '../src/world/coach-ratings';
import { clubHeadCoach, coachPlaces, coachWorld, headCoachLists, MANAGER_COACH, worldClubLevel } from '../src/world/head-coaches';
import { clubLevel, managerReputation, offersFor, type ClubVacancy } from '../src/world/career-policy';
import { nbaCoachFacts, nbaVacancyRequirement, NBA_JOB_RULES, usesNbaJobs } from '../src/world/nba-jobs';
import { restartBoard } from '../src/world/career';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';

/**
 * NBA step 10 (format 91): NBA careers. Real NBA head coaches in an NBA world, the job levels and requirements, the
 * format guard, and European careers left exactly as they were.
 */
const SPAIN = { id: 'acb', name: 'Liga Endesa', country: 'Spain', tier: 1 as const, levels: [16, 16, 15, 15, 14, 14, 13, 13, 12, 12, 11, 11, 10, 10, 9, 9, 8, 8] };
const SPAIN_2 = { id: 'leb', name: 'Primera FEB', country: 'Spain', tier: 2 as const, levels: [9, 9, 8, 8, 7, 7, 6, 6, 5, 5, 4, 4, 4, 4, 3, 3, 3, 3] };
const BOS = realNbaClubId('nba-bos'), WAS = realNbaClubId('nba-was'), GSW = realNbaClubId('nba-gsw');
const manager = { name: 'Test Manager', dateOfBirth: '1980-05-01', nationality: 'Spain' };

describe('real NBA head coaches (format 91)', () => {
  const world = worldFromPack(realIdNbaPack([SPAIN]), ['acb', 'nba']);
  const state = createSeason({ seed: 3, world, managedClubId: BOS, manager, ...NEW_CAREER_SYSTEMS });

  it('marks NBA careers on the world and gives every NBA club its real head coach', () => {
    expect(worldOf(state).nbaJobs).toBe(true);
    expect(usesNbaJobs(worldOf(state))).toBe(true);
    const pool = coachWorld(worldOf(state));
    for (const post of REAL_NBA_COACH_POSTS) {
      const coach = pool.coaches.get(pool.opening.get(post.teamId)!)!;
      expect(coach.name).toBe(REAL_NBA_COACHES.find(item => item.id === post.coachId)!.name);
      expect(coach.generated).toBeUndefined();
      for (const value of Object.values(coach.attributes)) { expect(value).toBeGreaterThanOrEqual(1); expect(value).toBeLessThanOrEqual(20); }
    }
    expect(clubHeadCoach(state, GSW)).toMatchObject({ name: 'Steve Kerr', titles: { nba: 4, league: 0 } });
    // The Spanish clubs keep the European rules (generated coaches here: the test pack's ids have no real posts).
    expect(pool.coaches.get(pool.opening.get('acb-1')!)!.generated).toBe(true);
    // The manager's own club: its real coach (Joe Mazzulla) becomes a free agent, first among the free coaches.
    const places = coachPlaces(state);
    expect(places.clubs[BOS]).toBe(MANAGER_COACH);
    const mazzulla = pool.opening.get(BOS)!;
    expect(places.free).toContain(mazzulla);
    expect(places.spells[mazzulla]!.at(-1)).toMatchObject({ clubId: null, reason: 'displaced' });
    expect(headCoachLists(state, NBA_CLUB_IDS.map(realNbaClubId)).free[0]!.name).toBe('Joe Mazzulla');
    // A club that sacks its coach hires the best free coach within its pull: here the displaced Mazzulla.
    const changed = restartBoard(state, WAS, 'ai', 'season');
    expect(clubHeadCoach(changed, WAS)).toMatchObject({ name: 'Joe Mazzulla' });
  });

  it('rates NBA coaches at the NBA job level, counting NBA championships like EuroLeague titles', () => {
    expect(worldClubLevel(worldOf(state), BOS)).toBe(COACH_LEVELS.nba);
    expect(worldClubLevel(worldOf(state), 'acb-1')).toBe(COACH_LEVELS.top);
    const kerr = REAL_NBA_COACHES.find(coach => coach.name === 'Steve Kerr')!, keefe = REAL_NBA_COACHES.find(coach => coach.name === 'Brian Keefe')!;
    expect(nbaCoachFacts(kerr)).toMatchObject({ level: COACH_LEVELS.nba, titles: { nba: 4, league: 0 } });
    expect(nbaCoachFacts(keefe).titles.nba).toBeUndefined();
    expect(recordScore(nbaCoachFacts(kerr).titles)).toBeCloseTo(4 * 4 + 0.3, 6);
    const rated = (facts: typeof kerr) => estimateCoach(facts.id, facts, facts.level, '2026-09-05');
    // Four NBA titles make Kerr far better known than a first-job NBA coach, and an NBA job pays reputation above a
    // EuroLeague one at the same record.
    expect(rated(nbaCoachFacts(kerr)).reputation).toBeGreaterThan(rated(nbaCoachFacts(keefe)).reputation + 20);
    expect(rated(nbaCoachFacts(keefe)).reputation).toBeGreaterThan(rated({ ...keefe, level: COACH_LEVELS.euroleague }).reputation);
    expect(coachOverall(rated(nbaCoachFacts(kerr)).attributes)).toBeGreaterThanOrEqual(15);
  });

  it('keeps generated coaches at NBA clubs in careers without the NBA careers option (format 90 rules)', () => {
    const old = createSeason({ seed: 3, world, managedClubId: BOS, manager, ...NEW_CAREER_SYSTEMS, nbaJobs: false });
    expect(worldOf(old).nbaJobs).toBeUndefined();
    const pool = coachWorld(worldOf(old));
    expect(pool.coaches.get(pool.opening.get(GSW)!)!.generated).toBe(true);
    expect(worldClubLevel(worldOf(old), GSW)).toBe(COACH_LEVELS.top);
  });

  it('opens a career directly at an NBA club with the same starting reputation as a European top-division club', () => {
    const european = createSeason({ seed: 3, world, managedClubId: 'acb-1', manager, ...NEW_CAREER_SYSTEMS });
    expect(state.managedClubId).toBe(BOS);
    expect(managerReputation(state).value).toBe(managerReputation(european).value);
  });

  it('refuses the NBA careers marker in saves before format 91 and keeps it through a strict round trip', () => {
    const text = serializeSeason(state);
    expect(worldOf(parseSeason(text)).nbaJobs).toBe(true);
    const envelope = JSON.parse(text);
    envelope.formatVersion = 90; envelope.state.schemaVersion = 90;  // A format-92 NBA world (with the cap) is refused first for its cap, then for the NBA careers marker.
    expect(() => parseSeason(JSON.stringify(envelope))).toThrow(/format 9[12] or later/);
    expect(() => createSeason({ seed: 3, world, managedClubId: BOS, ...NEW_CAREER_SYSTEMS, nbaJobs: 'yes' as unknown as boolean })).toThrow(/NBA careers/);
  });
});

describe('NBA job levels and requirements (format 91)', () => {
  const pack = nbaPack([SPAIN, SPAIN_2], { members: ['acb-1', 'acb-2'] });
  const world = { ...worldFromPack(pack, ['acb', 'leb', 'nba']), nbaJobs: true as const };
  const context = (nbaJobs: boolean) => ({ world: nbaJobs ? world : { ...world, nbaJobs: undefined }, seasonNumber: 1, history: [] }) as unknown as SeasonState;

  it('ranks NBA jobs first, then EuroLeague clubs, then the top division, then the second division', () => {
    const level = clubLevel(context(true), 1);
    expect([level('nba-bos'), level('acb-1'), level('acb-5'), level('leb-1')]).toEqual([NBA_JOB_RULES.nbaLevel, NBA_JOB_RULES.euroleagueLevel, 1, 2]);
    // Careers without the marker keep ordering by tier alone.
    const tier = clubLevel(context(false), 1);
    expect([tier('nba-bos'), tier('acb-1'), tier('acb-5'), tier('leb-1')]).toEqual([1, 1, 1, 2]);
    const vacancy = (clubId: string, requirement: number): ClubVacancy => ({ clubId, position: 10, requirement, reason: 'pressure', confidence: 20 });
    const vacancies = [vacancy('leb-1', 40), vacancy('acb-5', 50), vacancy('acb-1', 55), vacancy('nba-bos', 62)];
    const clubs = world.clubs.map(club => ({ id: club.id, name: club.name }));
    expect(offersFor(vacancies, 80, false, clubs, level).map(item => item.clubId)).toEqual(['nba-bos', 'acb-1', 'acb-5', 'leb-1']);
    expect(offersFor(vacancies, 52, false, clubs, level).map(item => item.clubId)).toEqual(['acb-5', 'leb-1']);
    // A manager who must move is never handed an NBA job beyond his reputation while another club can take him.
    const beyond = (item: ClubVacancy) => item.clubId.startsWith('nba-') && item.requirement > 30;
    expect(offersFor([vacancy('nba-bos', 60), vacancy('acb-5', 45)], 30, true, clubs, level, beyond).map(item => item.clubId)).toEqual(['acb-5']);
    expect(offersFor([vacancy('nba-bos', 60)], 30, true, clubs, level, beyond).map(item => item.clubId)).toEqual(['nba-bos']);
  });

  it('asks 70 from the best NBA record down to 60 from the worst, or the conference requirement when higher', () => {
    expect(nbaVacancyRequirement(30, 30, 15, 15, 25, 6)).toBe(60);
    expect(nbaVacancyRequirement(1, 30, 1, 15, 25, 6)).toBe(109);
    expect(nbaVacancyRequirement(1, 30, 15, 15, 25, 6)).toBe(70);
    expect(nbaVacancyRequirement(16, 30, 9, 15, 25, 6)).toBe(65);
    expect(nbaVacancyRequirement(12, 30, 6, 15, 25, 6)).toBe(79);
  });
});

describe('European careers are unchanged by the NBA careers option', () => {
  it('opens the same world and season with and without it', () => {
    const world = worldFromPack(economyPack([SPAIN, SPAIN_2], { members: ['acb-1', 'acb-2'] }), ['acb', 'leb']);
    const on = createSeason({ seed: 9, world, managedClubId: 'acb-3', manager, ...NEW_CAREER_SYSTEMS });
    const off = createSeason({ seed: 9, world, managedClubId: 'acb-3', manager, ...NEW_CAREER_SYSTEMS, nbaJobs: false });
    expect(worldOf(on).nbaJobs).toBeUndefined();
    expect(on).toEqual(off);
    expect(serializeSeason(on)).toBe(serializeSeason(off));
  });
});
