import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import type { CareerWorld } from '../src/domain/world';
import { economyPack } from './helpers/economy-pack';
import { nbaPack } from './helpers/nba-pack';
import { worldFromPack } from '../src/world/real-world';
import { advanceSeason, createSeason, getStandings, managedSide, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { clubLevel, managerReputation, seasonEndOutlook, vacancyRequirement } from '../src/world/career-policy';
import { NBA_JOB_RULES } from '../src/world/nba-jobs';
import { EUROLEAGUE_JOB_RULES, euroleagueJobsNote, euroleagueJobsWorld, euroleagueVacancyRequirement, usesEuroleagueJobs } from '../src/world/euroleague-jobs';
import { seasonRounds, validateWorld, worldOf } from '../src/world/career-world';

/**
 * Format 102 (provisional; owner decision 24 November 2026): in careers without the NBA, clubs playing in that season's
 * EuroLeague are bigger jobs than other top-division clubs (`world.euroleagueJobs`). Older careers keep the tier order.
 */
const SPAIN = { id: 'acb', name: 'Liga Endesa', country: 'Spain', tier: 1 as const, levels: [16, 16, 15, 15, 14, 14, 13, 13, 12, 12, 11, 11, 10, 10, 9, 9, 8, 8] };
const SPAIN_2 = { id: 'leb', name: 'Primera FEB', country: 'Spain', tier: 2 as const, levels: [9, 9, 8, 8, 7, 7, 6, 6, 5, 5, 4, 4, 4, 4, 3, 3, 3, 3] };
const withoutMarker = (world: CareerWorld): CareerWorld => { const { euroleagueJobs: _marker, ...rest } = world; return rest as CareerWorld; };
const play = (state: SeasonState) => advanceSeason(state.activeMatch && state.activeMatch.status !== 'finished' ? { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) } : state);
const manager = { name: 'Test Manager', dateOfBirth: '1980-05-01', nationality: 'Spain' };

describe('the rules (format 102)', () => {
  it('asks a EuroLeague club for one place more than usual, and never less than 50 to 60 by its place', () => {
    expect(euroleagueVacancyRequirement(18, 18, 25)).toBe(EUROLEAGUE_JOB_RULES.weakestRequirement);
    expect(euroleagueVacancyRequirement(1, 18, 127)).toBe(127 + EUROLEAGUE_JOB_RULES.premium);
    expect(euroleagueVacancyRequirement(14, 18, 49)).toBe(55);
    expect(euroleagueVacancyRequirement(16, 18, 37)).toBe(51);
    expect(euroleagueVacancyRequirement(1, 1, 25)).toBe(EUROLEAGUE_JOB_RULES.bestRequirement);
    for (let position = 1; position <= 18; position += 1) {
      const usual = 25 + 6 * (18 - position);
      expect(euroleagueVacancyRequirement(position, 18, usual)).toBeGreaterThan(usual);
      if (position > 1) expect(euroleagueVacancyRequirement(position, 18, usual)).toBeLessThanOrEqual(euroleagueVacancyRequirement(position - 1, 18, usual + 6));
    }
  });
});

describe('the EuroLeague jobs marker (format 102)', () => {
  const pack = economyPack([SPAIN, SPAIN_2], { members: ['acb-1', 'acb-2'] });
  const world = worldFromPack(pack, ['acb', 'leb']);

  it('marks new careers in a world with a EuroLeague and without the NBA, and nowhere else', () => {
    const state = createSeason({ seed: 5, world, managedClubId: 'acb-9', manager, ...NEW_CAREER_SYSTEMS });
    expect(worldOf(state).euroleagueJobs).toBe(true);
    expect(usesEuroleagueJobs(worldOf(state))).toBe(true);
    expect(euroleagueJobsNote(worldOf(state))).toMatch(/EuroLeague are the biggest jobs/);
    const older = createSeason({ seed: 5, world, managedClubId: 'acb-9', manager, ...NEW_CAREER_SYSTEMS, euroleagueJobs: false });
    expect(worldOf(older).euroleagueJobs).toBeUndefined();
    expect(euroleagueJobsNote(worldOf(older))).toBe('');
    // Apart from the marker the career opens exactly as before.
    expect({ ...state, world: withoutMarker(worldOf(state)) }).toEqual(older);
    // No EuroLeague, the NBA, or the built-in league: no marker.
    const plain = worldFromPack(economyPack([SPAIN]), 'acb');
    expect(euroleagueJobsWorld(plain)).toBe(false);
    expect(worldOf(createSeason({ seed: 5, world: plain, managedClubId: 'acb-9', ...NEW_CAREER_SYSTEMS })).euroleagueJobs).toBeUndefined();
    const nbaWorld = worldFromPack(nbaPack([SPAIN], { members: ['acb-1', 'acb-2'] }), ['acb', 'nba']);
    expect(euroleagueJobsWorld(nbaWorld)).toBe(false);
    expect(worldOf(createSeason({ seed: 5, world: nbaWorld, managedClubId: 'acb-9', ...NEW_CAREER_SYSTEMS })).euroleagueJobs).toBeUndefined();
    expect(() => validateWorld({ ...nbaWorld, euroleagueJobs: true })).toThrow(/euroleagueJobs/);
    expect(createSeason({ seed: 5, ...NEW_CAREER_SYSTEMS }).world?.euroleagueJobs).toBeUndefined();
    expect(() => createSeason({ seed: 5, world, euroleagueJobs: 'yes' as unknown as boolean })).toThrow(/EuroLeague jobs setting/);
  });

  it('keeps the marker through a strict round trip and refuses it before format 102', () => {
    const state = createSeason({ seed: 5, world, managedClubId: 'acb-9', manager, ...NEW_CAREER_SYSTEMS });
    const envelope = JSON.parse(serializeSeason(state));
    expect(parseSeason(JSON.stringify(envelope))).toEqual(state);
    envelope.formatVersion = 101; envelope.state.schemaVersion = 101;
    expect(() => parseSeason(JSON.stringify(envelope))).toThrow(/euroleagueJobs.*format 102/);
    const wrong = JSON.parse(serializeSeason(state));
    wrong.state.world.euroleagueJobs = false;
    expect(() => parseSeason(JSON.stringify(wrong))).toThrow(/euroleagueJobs/);
  });

  it('ranks EuroLeague clubs first, then the top division, then the second division; older careers by tier alone', () => {
    const state = createSeason({ seed: 5, world, managedClubId: 'acb-9', manager, ...NEW_CAREER_SYSTEMS });
    const level = clubLevel(state, 1);
    expect([level('acb-1'), level('acb-2'), level('acb-5'), level('leb-1')]).toEqual([NBA_JOB_RULES.euroleagueLevel, NBA_JOB_RULES.euroleagueLevel, 1, 2]);
    const tier = clubLevel({ ...state, world: withoutMarker(worldOf(state)) }, 1);
    expect([tier('acb-1'), tier('acb-2'), tier('acb-5'), tier('leb-1')]).toEqual([1, 1, 1, 2]);
  });
});

describe('job offers in a Europe-only world with the EuroLeague (format 102)', () => {
  // Two of the weakest Spanish squads play the EuroLeague, so they finish low in the table and their usual requirement is small.
  const LEAGUE = { ...SPAIN, levels: [16, 16, 15, 14, 13, 12, 11, 10, 6, 6] };
  const world = worldFromPack(economyPack([LEAGUE], { members: ['acb-9', 'acb-10'] }), 'acb');
  let complete: SeasonState;

  beforeAll(() => {
    let state = createSeason({ seed: 7, world, managedClubId: 'acb-6', manager, ...NEW_CAREER_SYSTEMS });
    for (let guard = 0; guard < 400 && state.status === 'active'; guard += 1) state = play(state);
    complete = state;
  }, 3_500_000);

  /** The completed season with the manager's final confidence `confidence` and the given clubs Under pressure. */
  function finishedWith(state: SeasonState, confidence: number, pressure: readonly string[]): SeasonState {
    const rounds = seasonRounds(state);
    const reviews = state.board.reviews.map(review => review.seasonNumber === 1 && review.round === rounds ? { ...review, clubs: Object.fromEntries(Object.entries(review.clubs).map(([id, club]) => [id, { ...club, confidence: id === state.managedClubId ? confidence : pressure.includes(id) ? 5 : Math.max(club.confidence, 60) }])) } : review);
    return { ...state, board: { ...state.board, reviews, restarts: [] } };
  }

  it('offers a strong manager the EuroLeague club first and keeps it from a weak one; older careers order by requirement', () => {
    expect(worldOf(complete).euroleagueJobs).toBe(true);
    const table = getStandings(complete), position = (id: string) => table.find(row => row.clubId === id)!.position;
    // The EuroLeague club with the worse record, and the best-placed ordinary club other than the manager's.
    const euroleague = ['acb-9', 'acb-10'].sort((a, b) => position(b) - position(a))[0]!;
    const ordinary = table.map(row => row.clubId).find(id => !['acb-9', 'acb-10', 'acb-6'].includes(id))!;
    expect(position(ordinary)).toBeLessThan(position(euroleague));
    const usual = (id: string) => vacancyRequirement(position(id), complete.clubs);
    const older = (state: SeasonState): SeasonState => ({ ...state, world: withoutMarker(worldOf(state)) });

    const strong = finishedWith(complete, 99, [euroleague, ordinary]);
    const reputation = managerReputation(strong).value;
    const outlook = seasonEndOutlook(strong)!;
    const requirement = (id: string) => outlook.vacancies.find(item => item.clubId === id)!.requirement;
    expect(requirement(euroleague)).toBe(euroleagueVacancyRequirement(position(euroleague), 10, usual(euroleague)));
    expect(requirement(euroleague)).toBeGreaterThanOrEqual(EUROLEAGUE_JOB_RULES.weakestRequirement);
    expect(requirement(ordinary)).toBe(usual(ordinary));
    expect(reputation).toBeGreaterThanOrEqual(Math.max(requirement(euroleague), requirement(ordinary)));
    expect(outlook.offers.map(item => item.clubId)).toEqual([euroleague, ordinary]);
    // Older careers: the same season orders the offers by requirement, the ordinary club first, and the EuroLeague club asks as usual.
    const before = seasonEndOutlook(older(strong))!;
    expect(before.offers.map(item => item.clubId)).toEqual([ordinary, euroleague]);
    expect(before.vacancies.find(item => item.clubId === euroleague)!.requirement).toBe(usual(euroleague));

    // A weak manager (Concerned, still employed) reaches the EuroLeague club's usual requirement but not its new one.
    const weak = finishedWith(complete, 40, [euroleague]);
    const weakReputation = managerReputation(weak).value;
    expect(weakReputation).toBeLessThan(EUROLEAGUE_JOB_RULES.weakestRequirement);
    expect(weakReputation).toBeGreaterThanOrEqual(usual(euroleague));
    expect(seasonEndOutlook(weak)!.offers.map(item => item.clubId)).not.toContain(euroleague);
    expect(seasonEndOutlook(older(weak))!.offers.map(item => item.clubId)).toContain(euroleague);
  });

  it('saves strictly after the season', () => {
    expect(parseSeason(serializeSeason(complete))).toEqual(complete);
  }, 600_000);
});
