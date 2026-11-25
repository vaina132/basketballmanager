import { describe, expect, it } from 'vitest';
import type { Player, PlayerAttributes, Position, SkillAttributes, Team } from '../src/domain/types';
import { economyPack } from './helpers/economy-pack';
import { worldFromPack } from '../src/world/real-world';
import { createSeason, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { validateWorld } from '../src/world/career-world';
import { generateAcademyProspects, generateYouthSquadProspects } from '../src/world/academy-generation';
import { draftClassProspects } from '../src/world/nba-draft';
import { attributesFor } from '../src/world/lower-division';
import { overallRating } from '../src/world/overall-rating';
import { withExtraAttributes } from '../src/world/extra-attributes';
import { createFixtureMatch, simulateToEnd } from '../src/engine/match';
import { calibrationSummary, gameLine, type GameLine } from './helpers/match-calibration';
import { growthShares, POSITION_PROFILES, profileAt, profiledAttributesFor, splitByShares, usesPositionProfiles, type ProfileRegion } from '../src/world/position-profiles';
import { createTraining, processTrainingWeek, TRAINING_ATTRIBUTES } from '../src/world/training';
import { dateForRound } from '../src/world/season';
import type { SeasonLifecycle } from '../src/domain/lifecycle';
import type { SeasonTraining } from '../src/domain/training';
import type { CareerWorld } from '../src/domain/world';

/**
 * Format 106 (`world.positionProfiles`): generated players (academy and youth prospects, NBA draft prospects) are shaped
 * like real players of their position and rating. Ten automatic seasons had shown the three-point share rising 6-7
 * points in Liga ACB and the Süper Ligi and NBA free-throw percentage 3 points: generated players with flat skills had
 * replaced the retiring real players (centres who shot threes and free throws like forwards). Older careers keep the
 * earlier generators exactly.
 */
const SPAIN = { id: 'acb', name: 'Liga Endesa', country: 'Spain', tier: 1 as const, levels: [14, 14, 14, 13, 13, 13, 12, 12, 12, 11, 11, 11, 10, 10, 10, 9, 9, 9, 8, 8] };
const packWorld = worldFromPack(economyPack([SPAIN]), 'acb');
const POSITIONS: readonly Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];
const SKILLS = ['twoPoint', 'threePoint', 'freeThrow', 'passing', 'defense', 'rebounding', 'stamina'] as const;
const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const byPosition = (players: readonly Pick<Player, 'position' | 'attributes'>[], position: Position, key: keyof SkillAttributes | 'overall') => mean(players.filter(player => player.position === position).map(player => key === 'overall' ? overallRating(player.attributes, position) : player.attributes[key]));
const academyPlayers = (profiles: boolean) => Array.from({ length: 60 }, (_, seed) => [1, 2, 3, 4, 5].flatMap(season => generateAcademyProspects(seed + 1, `club-${seed + 1}`, season, 1, true, 3, undefined, profiles).map(prospect => prospect.player))).flat();
const draftPlayers = (profiles: boolean) => Array.from({ length: 12 }, (_, seed) => draftClassProspects(seed + 1, 2, '2027-06-25', true, profiles ? { positionProfiles: true } as CareerWorld : undefined).map(prospect => prospect.player)).flat();

describe('the position profiles marker (format 106)', () => {
  it('marks new real-data careers only, and format 105 refuses the marker', () => {
    const state = createSeason({ seed: 5, world: packWorld, managedClubId: 'acb-6', ...NEW_CAREER_SYSTEMS });
    expect(state.world!.positionProfiles).toBe(true);
    expect(usesPositionProfiles(state.world!)).toBe(true);
    expect(createSeason({ seed: 5, world: packWorld, managedClubId: 'acb-6', ...NEW_CAREER_SYSTEMS, positionProfiles: false }).world!.positionProfiles).toBeUndefined();
    // The built-in league keeps its rules (the golden matches and older tests).
    expect(createSeason({ seed: 5, ...NEW_CAREER_SYSTEMS }).world?.positionProfiles).toBeUndefined();
    expect(() => createSeason({ seed: 5, world: packWorld, positionProfiles: 'yes' as unknown as boolean })).toThrow(/position profiles setting/);
    expect(parseSeason(serializeSeason(state)).world!.positionProfiles).toBe(true);
    const envelope = JSON.parse(serializeSeason(state));
    envelope.formatVersion = 105; envelope.state.schemaVersion = 105;
    expect(() => parseSeason(JSON.stringify(envelope))).toThrow(/positionProfiles.*format 106/);
    const older = JSON.parse(serializeSeason(createSeason({ seed: 5, world: packWorld, managedClubId: 'acb-6', ...NEW_CAREER_SYSTEMS, positionProfiles: false })));
    older.formatVersion = 105; older.state.schemaVersion = 105;
    expect(parseSeason(JSON.stringify(older)).world!.positionProfiles).toBeUndefined();
    expect(() => validateWorld({ ...packWorld, positionProfiles: 'yes' })).toThrow(/positionProfiles/);
    const { domesticLeagues: _leagues, ...withoutLeagues } = packWorld;
    expect(() => validateWorld({ ...withoutLeagues, positionProfiles: true })).toThrow(/positionProfiles.*domestic leagues/);
  }, 120_000);

  it('shapes the opening academy intake of a marked career and leaves an unmarked one as before', () => {
    const shaped = createSeason({ seed: 5, world: packWorld, managedClubId: 'acb-6', ...NEW_CAREER_SYSTEMS });
    const flat = createSeason({ seed: 5, world: packWorld, managedClubId: 'acb-6', ...NEW_CAREER_SYSTEMS, positionProfiles: false });
    const centres = (prospects: typeof shaped.academy.prospects) => prospects.map(prospect => prospect.player).filter(player => player.position === 'C' || player.position === 'PF');
    expect(shaped.academy.prospects.length).toBeGreaterThan(20);
    expect(shaped.academy.prospects.map(prospect => prospect.player.id)).toEqual(flat.academy.prospects.map(prospect => prospect.player.id));
    const shapedBigs = centres(shaped.academy.prospects), flatBigs = centres(flat.academy.prospects);
    expect(mean(shapedBigs.map(player => player.attributes.twoPoint - player.attributes.threePoint))).toBeGreaterThan(mean(flatBigs.map(player => player.attributes.twoPoint - player.attributes.threePoint)) + 1);
    // The earlier rule: every skill 7-11 plus at most the position's two-point bonus.
    for (const prospect of flat.academy.prospects) for (const key of SKILLS) expect(prospect.player.attributes[key]).toBeGreaterThanOrEqual(7);
  }, 120_000);
});

describe('academy and youth prospects', () => {
  const flat = academyPlayers(false), shaped = academyPlayers(true);

  it('look like real players of their position: centres inside and on the boards, guards passing and at the line', () => {
    expect(byPosition(shaped, 'C', 'twoPoint') - byPosition(shaped, 'C', 'threePoint')).toBeGreaterThan(5);
    expect(byPosition(shaped, 'C', 'rebounding') - byPosition(shaped, 'C', 'freeThrow')).toBeGreaterThan(5);
    expect(byPosition(shaped, 'PG', 'passing')).toBeGreaterThan(Math.max(...SKILLS.filter(key => key !== 'passing').map(key => byPosition(shaped, 'PG', key))));
    expect(byPosition(shaped, 'PG', 'freeThrow') - byPosition(shaped, 'C', 'freeThrow')).toBeGreaterThan(3.5);
    // The earlier flat shape: a centre shot free throws like a guard.
    expect(Math.abs(byPosition(flat, 'PG', 'freeThrow') - byPosition(flat, 'C', 'freeThrow'))).toBeLessThan(.5);
    // The gaps between skills follow real European players of the position at the prospects' rating, within a point.
    for (const position of POSITIONS) {
      const profile = profileAt('europe', position, byPosition(shaped, position, 'overall'));
      for (const key of ['threePoint', 'freeThrow', 'passing', 'rebounding'] as const) expect(Math.abs((byPosition(shaped, position, 'twoPoint') - byPosition(shaped, position, key)) - (profile.twoPoint - profile[key]))).toBeLessThan(1.25);
    }
  });

  it('keep the earlier rule\'s level and spread, so academies are as strong as before and individuals differ', () => {
    for (const position of POSITIONS) expect(Math.abs(byPosition(shaped, position, 'overall') - byPosition(flat, position, 'overall'))).toBeLessThan(1);
    const shapes = new Set(shaped.map(player => SKILLS.map(key => player.attributes[key]).join(',')));
    expect(shapes.size / shaped.length).toBeGreaterThan(.9);
    for (const player of shaped) for (const key of SKILLS) { expect(player.attributes[key]).toBeGreaterThanOrEqual(1); expect(player.attributes[key]).toBeLessThanOrEqual(20); }
    // Same identities, positions, ages and wages: only the skills change.
    const strip = (players: readonly Player[]) => players.map(({ attributes: _attributes, ...rest }) => rest);
    expect(strip(shaped)).toEqual(strip(flat));
    const youth = generateYouthSquadProspects(7, 'club-7', 2, 1, [], 8, undefined, true), youthFlat = generateYouthSquadProspects(7, 'club-7', 2, 1, [], 8);
    expect(youth.map(prospect => prospect.player.id)).toEqual(youthFlat.map(prospect => prospect.player.id));
    expect(youth.some((prospect, index) => SKILLS.some(key => prospect.player.attributes[key] !== youthFlat[index]!.player.attributes[key]))).toBe(true);
  });
});

describe('NBA draft prospects', () => {
  const flat = draftPlayers(false), shaped = draftPlayers(true);

  it('keep their target ratings and identities, and older careers keep the earlier class', () => {
    expect(shaped.map(player => player.id)).toEqual(flat.map(player => player.id));
    for (const [index, player] of shaped.entries()) expect(Math.abs(overallRating(player.attributes, player.position) - overallRating(flat[index]!.attributes, player.position))).toBeLessThanOrEqual(1);
    expect(draftClassProspects(3, 2, '2027-06-25', true)).toBe(draftClassProspects(3, 2, '2027-06-25', true, {} as CareerWorld));
  });

  it('carry the experience the rules assume for unknown minutes, as real players do', () => {
    expect(mean(shaped.map(player => player.attributes.intelligence!))).toBeGreaterThan(mean(flat.map(player => player.attributes.intelligence!)) + .5);
  });

  it('shoot like real NBA players of their position: centres below guards at the line and from three', () => {
    expect(byPosition(shaped, 'SG', 'freeThrow') - byPosition(shaped, 'C', 'freeThrow')).toBeGreaterThan(5);
    expect(byPosition(shaped, 'C', 'twoPoint') - byPosition(shaped, 'C', 'threePoint')).toBeGreaterThan(3);
    // The earlier generator nudged a centre's free throws up with every other skill (about 11 against real centres' 8).
    expect(byPosition(flat, 'C', 'freeThrow')).toBeGreaterThan(byPosition(shaped, 'C', 'freeThrow') + 2.5);
  });
});

describe('the profiled generator', () => {
  it('reaches its target rating within a point at every position and level, inside the 1-20 scale', () => {
    for (const region of Object.keys(POSITION_PROFILES) as ProfileRegion[]) for (const position of POSITIONS) for (let target = 25; target <= 95; target += 5) {
      const skills = profiledAttributesFor(target, position, region, key => key.length % 3 - 1);
      expect(Math.abs(overallRating(skills, position) - target)).toBeLessThanOrEqual(1);
      for (const key of SKILLS) { expect(skills[key]).toBeGreaterThanOrEqual(1); expect(skills[key]).toBeLessThanOrEqual(20); }
    }
  });
});

describe('development by position', () => {
  it('splits a balanced week by how real players of the position differ between rating bands, every skill a little', () => {
    for (const region of Object.keys(POSITION_PROFILES) as ProfileRegion[]) for (const position of POSITIONS) {
      const shares = growthShares(region, position);
      expect(SKILLS.reduce((sum, key) => sum + shares[key], 0)).toBe(10_000);
      for (const key of SKILLS) expect(shares[key]).toBeGreaterThan(150);
      for (const points of [0, 1, 7, 20, 33]) {
        const split = splitByShares(points, shares, points % 7);
        expect(SKILLS.reduce((sum, key) => sum + split[key], 0)).toBe(points);
        for (const key of SKILLS) expect(split[key]).toBeGreaterThanOrEqual(0);
      }
    }
    const centre = growthShares('europe', 'C'), guard = growthShares('europe', 'SG');
    expect(centre.twoPoint).toBeGreaterThan(3 * centre.threePoint);
    expect(centre.rebounding).toBeGreaterThan(2.5 * centre.freeThrow);
    expect(guard.threePoint).toBeGreaterThan(guard.rebounding * 4);
  });

  it('practises centres into better centres and keeps the practice a season brings', () => {
    const clubs = packWorld.clubs.slice(0, 6);
    const lifecycle: SeasonLifecycle = { model: 'lifecycle-1', enabledSince: { seasonNumber: 1, round: 1, date: packWorld.startDate, ledgerIndex: 0, contractCount: 0, negotiationCount: 0, recruitmentEventCount: 0, marketEventCount: 0 }, reviews: [], notices: [] };
    const conditions = Object.fromEntries(clubs.flatMap(club => club.players.map(player => [player.id, 90])));
    const season = (world: CareerWorld) => {
      let training: SeasonTraining = createTraining(clubs);
      for (let round = 1; round < 20; round += 1) training = processTrainingWeek({ world, seed: 5, training, clubs, conditions, injuries: [], seasonNumber: 1, afterRound: round, fromDate: dateForRound(round), toDate: dateForRound(round + 1), lifecycle, fixtures: [] }).training;
      return training;
    };
    const shapedTraining = season({ ...packWorld, playerDevelopment: true, positionProfiles: true }), flatTraining = season({ ...packWorld, playerDevelopment: true });
    const players = clubs.flatMap(club => club.players), centres = players.filter(player => player.position === 'C');
    const sum = (training: SeasonTraining, group: readonly Player[], key: keyof SkillAttributes) => group.reduce((total, player) => total + training.points[player.id]![key], 0);
    const all = (training: SeasonTraining) => TRAINING_ATTRIBUTES.reduce((total, key) => total + sum(training, players, key), 0);
    expect(centres.length).toBeGreaterThan(3);
    expect(sum(shapedTraining, centres, 'threePoint')).toBeLessThan(sum(shapedTraining, centres, 'twoPoint') / 2);
    expect(sum(shapedTraining, centres, 'freeThrow')).toBeLessThan(sum(flatTraining, centres, 'freeThrow') / 1.5);
    // The earlier rule: every skill an equal share.
    expect(Math.abs(sum(flatTraining, centres, 'threePoint') - sum(flatTraining, centres, 'twoPoint'))).toBeLessThan(sum(flatTraining, centres, 'twoPoint') * .25);
    // Practice is redistributed, hardly lost to the potential's limits.
    expect(all(shapedTraining)).toBeGreaterThan(all(flatTraining) * .85);
  }, 120_000);
});

/**
 * Measurement: squads of generated players play like squads of real players of the same positions and ratings. The
 * real squads are the real means at each player's rating (`profileAt`); the generated squads keep each player's rating.
 * Squads at top-division ratings; with the earlier flat generator the three-point share rises about 3 points (ten
 * seasons, with clubs choosing players by overall rating, showed 6-7).
 */
describe('generated squads in matches', () => {
  const HEIGHTS: Readonly<Record<Position, number>> = { PG: 188, SG: 194, SF: 200, PF: 206, C: 211 };
  const SQUAD: readonly Position[] = ['PG', 'SG', 'SF', 'SF', 'C', 'PG', 'SG', 'SF', 'PF', 'C', 'SF', 'PF'];
  const TARGETS: Readonly<Record<Position, number>> = { PG: 71, SG: 67, SF: 65, PF: 64, C: 69 };
  const hash = (key: string) => { let value = 2166136261; for (const character of key) value = Math.imul(value ^ character.charCodeAt(0), 16777619) >>> 0; return value; };
  const team = (index: number, strength: number, make: (position: Position, target: number, id: string) => SkillAttributes): Team => ({
    id: `gen-${index}`, name: `Generated ${index}`, shortName: `G${index}`, color: '#6b7280',
    players: SQUAD.map((position, slot) => {
      const id = `gen-${index}-${slot}`, target = TARGETS[position] + strength * 8 - (slot < 5 ? 0 : slot < 9 ? 6 : 12);
      const attributes = make(position, target, id) as PlayerAttributes;
      return { id, name: `Player ${index}-${slot}`, number: slot + 4, position, heightCm: HEIGHTS[position], weightKg: 95, skinTone: '#9aa0a8', hairColor: '#3b3f45', attributes: withExtraAttributes({ id, position, heightCm: HEIGHTS[position], attributes }) };
    }),
  });
  const variation = (id: string) => (key: string) => hash(`${id}:${key}`) % 3 - 1;
  const real = (position: Position, target: number, id: string) => { const profile = profileAt('europe', position, target); return Object.fromEntries(SKILLS.map(key => [key, Math.max(1, Math.min(20, Math.round(profile[key]) + variation(id)(key)))])) as unknown as SkillAttributes; };
  const summary = (make: (position: Position, target: number, id: string) => SkillAttributes) => {
    const teams = [-1, -.5, 0, .5, 1, -.25, .25, .75].map((strength, index) => team(index, strength, make));
    const games: GameLine[] = [];
    let seed = 9100;
    for (let round = 0; round < 2; round += 1) for (const home of teams) for (const away of teams) {
      if (home === away) continue;
      const match = createFixtureMatch(seed++, home, away, { autoSubstitutions: { home: true, away: true }, injuryMode: 'off', playModel: 'plays-2', computerCoach: ['home', 'away'] });
      games.push(gameLine(simulateToEnd(match), { home: match.lineups.home, away: match.lineups.away }));
    }
    return calibrationSummary(games);
  };

  it('keeps the three-point share and free throws near real squads; flat squads shoot more threes', () => {
    const reference = summary(real);
    const shaped = summary((position, target, id) => profiledAttributesFor(target, position, 'europe', variation(id)));
    const flat = summary((position, target, id) => attributesFor(target, position, variation(id)));
    // Measured (deterministic seeds): real 45.5% of shots from three and 75.4% free throws, shaped 46.2% and 73.9%, flat 48.8% and 74.6%.
    expect(Math.abs(shaped.threeShare - reference.threeShare)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(shaped.ftPct - reference.ftPct)).toBeLessThanOrEqual(2);
    expect(flat.threeShare - reference.threeShare).toBeGreaterThan(2.5);
  }, 600_000);
});
