import { describe, expect, it } from 'vitest';
import type { AcademyProspect, AcademyWeekFullPlayer } from '../src/domain/academy';
import type { SeasonState } from '../src/domain/season';
import type { TrainingPoints } from '../src/domain/training';
import type { Position } from '../src/domain/types';
import type { CareerWorld } from '../src/domain/world';
import { economyPack } from './helpers/economy-pack';
import { worldFromPack } from '../src/world/real-world';
import { advanceSeason, createSeason, managedSide, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { validateWorld } from '../src/world/career-world';
import { buildAcademyWeek } from '../src/world/academy';
import { ACADEMY_POSITION_TRAINING, academyPointCap, academyShares, academySkillCap, developAcademyPlayer, emptyAcademyPoints, usesAcademyPositionTraining } from '../src/world/academy-policy';
import { growthShares } from '../src/world/position-profiles';
import { createYouth } from '../src/world/youth';
import { TRAINING_ATTRIBUTES } from '../src/world/training';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';

/**
 * Format 108 (owner decision 25 November 2026, `world.academyPositionTraining`): academy practice follows the
 * prospect's position. Since format 106 a senior balanced week follows each position's real development shares, but the
 * academy still added about three points to every skill, so academy guards rebounded like forwards and academy centres
 * shot threes and free throws like forwards (part of the measured rise of the three-point share in Liga ACB). Now a
 * balanced academy week splits its points by the same shares, and each skill's academy limit is the position's share of
 * the same 21-point allowance. Older careers keep three points a skill exactly.
 */
const SPAIN = { id: 'acb', name: 'Liga Endesa', country: 'Spain', tier: 1 as const, levels: [14, 14, 14, 13, 13, 13, 12, 12, 12, 11, 11, 11, 10, 10, 10, 9, 9, 9, 8, 8] };
const packWorld = worldFromPack(economyPack([SPAIN]), 'acb');
const SHAPED: Pick<CareerWorld, 'academyPositionTraining'> = { academyPositionTraining: true };
const total = (points: TrainingPoints) => TRAINING_ATTRIBUTES.reduce((sum, key) => sum + points[key], 0);

/** A prospect of `position` with every skill at 8 (room for any academy limit). */
const prospect = (position: Position, index = 0): AcademyProspect => ({
  player: { id: `academy-test-${position}-${index}`, name: `Test ${position}`, number: 10 + index, position, attributes: { twoPoint: 8, threePoint: 8, freeThrow: 8, passing: 8, defense: 8, rebounding: 8, stamina: 8 } },
  clubId: 'acb-1', dateOfBirth: '2009-01-01', seasonWage: 1, intakeSeason: 1, intakeRound: 1,
} as unknown as AcademyProspect);

/** `weeks` balanced academy weeks from no progress (no youth coach, facilities or youth competition: 28 points a week). */
function academyWeeks(prospects: AcademyProspect[], world: CareerWorld | undefined, weeks: number): Record<string, { first: TrainingPoints; points: TrainingPoints }> {
  let points: Record<string, TrainingPoints> = Object.fromEntries(prospects.map(item => [item.player.id, emptyAcademyPoints()]));
  const first: Record<string, TrainingPoints> = {};
  for (let week = 0; week < weeks; week += 1) {
    const afterRound = week % 30 + 1;
    const built = buildAcademyWeek({
      rounds: 34, ...(world ? { world } : {}), youth: createYouth(), clubs: [{ id: 'acb-1' }], seasonNumber: 1, afterRound, fromDate: '2026-10-01', toDate: '2026-10-08', weekNumber: week + 1,
      academy: { prospects, graduates: [], points, focus: Object.fromEntries(prospects.map(item => [item.player.id, 'balanced' as const])) },
    });
    points = Object.fromEntries(prospects.map(item => [item.player.id, { ...(built.players[item.player.id] as AcademyWeekFullPlayer).pointsAfter }]));
    if (week === 0) for (const item of prospects) first[item.player.id] = { ...(built.players[item.player.id] as AcademyWeekFullPlayer).gains };
  }
  return Object.fromEntries(prospects.map(item => [item.player.id, { first: first[item.player.id]!, points: points[item.player.id]! }]));
}

describe('the academy position training marker (format 108)', () => {
  it('marks new careers with position profiles only, and format 107 refuses the marker', () => {
    const state = createSeason({ seed: 5, world: packWorld, managedClubId: 'acb-6', ...NEW_CAREER_SYSTEMS });
    expect(state.world!.academyPositionTraining).toBe(true);
    expect(usesAcademyPositionTraining(state.world)).toBe(true);
    expect(createSeason({ seed: 5, world: packWorld, managedClubId: 'acb-6', ...NEW_CAREER_SYSTEMS, academyPositionTraining: false }).world!.academyPositionTraining).toBeUndefined();
    // Needs position profiles: careers without them keep the earlier academy.
    expect(createSeason({ seed: 5, world: packWorld, managedClubId: 'acb-6', ...NEW_CAREER_SYSTEMS, positionProfiles: false }).world!.academyPositionTraining).toBeUndefined();
    expect(createSeason({ seed: 5, ...NEW_CAREER_SYSTEMS }).world?.academyPositionTraining).toBeUndefined();
    expect(() => createSeason({ seed: 5, world: packWorld, academyPositionTraining: 'yes' as unknown as boolean })).toThrow(/academy position training setting/);
    expect(parseSeason(serializeSeason(state)).world!.academyPositionTraining).toBe(true);
    const envelope = JSON.parse(serializeSeason(state));
    envelope.formatVersion = 107; envelope.state.schemaVersion = 107;
    expect(() => parseSeason(JSON.stringify(envelope))).toThrow(/world\.academyPositionTraining.*format 108 or later/);
    const older = JSON.parse(serializeSeason(createSeason({ seed: 5, world: packWorld, managedClubId: 'acb-6', ...NEW_CAREER_SYSTEMS, academyPositionTraining: false })));
    older.formatVersion = 107; older.state.schemaVersion = 107;
    expect(parseSeason(JSON.stringify(older)).world!.academyPositionTraining).toBeUndefined();
    expect(() => validateWorld({ ...packWorld, positionProfiles: true, academyPositionTraining: 'yes' })).toThrow(/academyPositionTraining/);
    expect(() => validateWorld({ ...packWorld, academyPositionTraining: true })).toThrow(/academyPositionTraining.*position profiles/);
  }, 120_000);
});

describe('academy practice by position', () => {
  it('uses the senior balanced week\'s European shares, and limits that add up to the same 21 points', () => {
    for (const position of ['PG', 'SG', 'SF', 'PF', 'C'] as const) {
      expect(academyShares(position)).toEqual(growthShares('europe', position));
      const player = prospect(position).player, caps = TRAINING_ATTRIBUTES.map(key => academySkillCap(player, key, SHAPED));
      expect(caps.reduce((sum, cap) => sum + cap, 0)).toBe(ACADEMY_POSITION_TRAINING.allowance * 100);
      for (const cap of caps) expect(cap % 100).toBe(0);
      // Older careers: three points in every skill, as before.
      for (const key of TRAINING_ATTRIBUTES) expect(academySkillCap(player, key, undefined)).toBe(academyPointCap(player.attributes[key]));
    }
    const centre = prospect('C').player, guard = prospect('SG').player;
    expect(academySkillCap(centre, 'threePoint', SHAPED)).toBe(100);
    expect(academySkillCap(centre, 'defense', SHAPED)).toBe(500);
    expect(academySkillCap(guard, 'rebounding', SHAPED)).toBe(100);
    expect(academySkillCap(guard, 'threePoint', SHAPED)).toBe(400);
    // A skill never passes 20.
    expect(academySkillCap({ ...centre, attributes: { ...centre.attributes, defense: 18 } }, 'defense', SHAPED)).toBe(200);
  });

  it('gives a guard\'s week to shooting and passing and a centre\'s to the inside game, with the same total', () => {
    const guards = [prospect('PG'), prospect('SG')], centres = [prospect('C')], all = [...guards, ...centres];
    const shaped = academyWeeks(all, { ...packWorld, positionProfiles: true, academyPositionTraining: true }, 1);
    const flat = academyWeeks(all, packWorld, 1);
    for (const guard of guards) {
      const gains = shaped[guard.player.id]!.first;
      expect(gains.threePoint).toBeGreaterThan(gains.rebounding);
      expect(gains.passing).toBeGreaterThan(gains.rebounding);
      expect(gains.threePoint + gains.freeThrow + gains.passing).toBeGreaterThan(3 * gains.rebounding + 6);
    }
    const centre = shaped[centres[0]!.player.id]!.first;
    expect(centre.rebounding).toBeGreaterThan(centre.threePoint);
    expect(centre.twoPoint + centre.rebounding).toBeGreaterThan(2 * (centre.threePoint + centre.freeThrow));
    for (const item of all) {
      expect(total(shaped[item.player.id]!.first)).toBe(28);
      // Older careers: four points in every skill.
      expect(flat[item.player.id]!.first).toEqual(Object.fromEntries(TRAINING_ATTRIBUTES.map(key => [key, 4])));
    }
  });

  it('keeps the whole academy allowance over a full stay and shapes what it brings', () => {
    const all = (['PG', 'SG', 'SF', 'PF', 'C'] as const).map(position => prospect(position));
    const shaped = academyWeeks(all, { ...packWorld, positionProfiles: true, academyPositionTraining: true }, 120);
    const flat = academyWeeks(all, packWorld, 120);
    const whole = (points: TrainingPoints) => TRAINING_ATTRIBUTES.reduce((sum, key) => sum + Math.floor(points[key] / 100), 0);
    for (const item of all) {
      expect(whole(shaped[item.player.id]!.points)).toBe(21);
      expect(whole(flat[item.player.id]!.points)).toBe(21);
    }
    const centre = developAcademyPlayer(all[4]!, shaped[all[4]!.player.id]!.points, SHAPED).attributes;
    expect(centre).toMatchObject({ twoPoint: 13, threePoint: 9, freeThrow: 9, passing: 9, defense: 13, rebounding: 12, stamina: 12 });
    const guard = developAcademyPlayer(all[1]!, shaped[all[1]!.player.id]!.points, SHAPED).attributes;
    expect(guard.threePoint - guard.rebounding).toBe(3);
    expect(developAcademyPlayer(all[4]!, flat[all[4]!.player.id]!.points, undefined).attributes).toMatchObject({ twoPoint: 11, threePoint: 11, freeThrow: 11, rebounding: 11 });
    // The format-108 progress is beyond an older career's limits, so it is never read under the earlier rule.
    expect(() => developAcademyPlayer(all[4]!, shaped[all[4]!.player.id]!.points, undefined)).toThrow(/supported limits/);
  });

  it('plays academy weeks in a marked career that pass the save check', () => {
    let state: SeasonState = createSeason({ seed: 5, world: packWorld, managedClubId: 'acb-6', ...NEW_CAREER_SYSTEMS });
    for (let step = 0; step < 6 && state.academy.weeks.length < 2; step += 1) {
      if (state.activeMatch && state.activeMatch.status !== 'finished') state = { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) };
      state = advanceSeason(state);
    }
    expect(state.academy.weeks.length).toBeGreaterThan(0);
    const week = state.academy.weeks.at(-1)!, byId = new Map(state.academy.prospects.map(item => [item.player.id, item]));
    const centres = Object.entries(week.players).filter(([id, report]) => byId.get(id)!.player.position === 'C' && report.focus === 'balanced');
    expect(centres.length).toBeGreaterThan(0);
    for (const [, report] of centres) {
      const gains = (report as AcademyWeekFullPlayer).gains;
      expect(gains.twoPoint + gains.rebounding + gains.defense).toBeGreaterThan(gains.threePoint + gains.freeThrow + gains.passing);
    }
    expect(parseSeason(serializeSeason(state)).academy).toEqual(state.academy);
  }, 300_000);
});
