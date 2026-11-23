import { describe, expect, it } from 'vitest';
import { nbaGames } from './helpers/nba-calibration';
import { nbaPack, NBA_CLUB_IDS } from './helpers/nba-pack';
import { calibrationFor, FREE_THROWS, PLAYS, ROTATION, SCORE_EFFECT } from '../src/engine/calibration';
import { FIBA_2024, isNba, NBA_2026, NBA_2026B, rulesetById } from '../src/engine/rulesets';
import { worldFromPack } from '../src/world/real-world';
import { createSeason, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { fixtureRuleset, validateWorld, worldOf } from '../src/world/career-world';
import type { CareerWorld } from '../src/domain/world';
import { usesNbaBalance } from '../src/world/nba-balance';
import { staffRoomForWages } from '../src/world/wage-pool';
import { nbaOwnerCeiling, nbaOwnerCeilingLevel } from '../src/world/nba-cap-policy';
import { presidentTraits } from '../src/world/presidents';
import { seasonSalaryBudget } from '../src/world/board-consequences';
import { NBA_FIRST_APRON, NBA_TAX_LINE } from '../src/world/nba-cap';
import { getClubContractSummary } from '../src/world/employment-policy';

/**
 * NBA step 12 (format 96, `world.nba.balance`, ruleset `nba-2026b`): the balance measured on five automatic seasons of
 * the live pack. A fast synthetic check of the retuned figures, the format guard, and that formats 90-95 keep theirs.
 */
const before = nbaGames(1, 12_000, 'nba-2026').summary, after = nbaGames(1, 12_000, 'nba-2026b').summary;
const band = (value: number, low: number, high: number) => { expect(value).toBeGreaterThanOrEqual(low); expect(value).toBeLessThanOrEqual(high); };
/** A format 90-95 NBA world: the same world without the step-12 marker, playing the `nba-2026` calibration. */
const withoutBalance = (world: CareerWorld): CareerWorld => { const { balance: _balance, ...nba } = world.nba!; return { ...world, nba: { ...nba, ruleset: 'nba-2026' } }; };

describe('the step-12 NBA calibration (nba-2026b)', () => {
  it('reports the measured table against the format 90-95 calibration', () => {
    const rows = (['points', 'possessions', 'threeShare', 'ftPct', 'overtimePct', 'homeWinPct', 'within5', 'margin', 'starterMinutes', 'starterMinutesP90'] as const).map(key => `  ${key}: ${before[key]} -> ${after[key]}`);
    console.info(`NBA calibration nba-2026 -> nba-2026b, ${after.games} synthetic games:\n${rows.join('\n')}`);
    expect(after.games).toBe(132);
  });

  it('keeps NBA scoring, pace and shot profile', () => {
    band(after.points, 108, 120);
    band(after.possessions, 95, 103);
    band(after.threeShare, 38, 46);
    band(after.ftPct, 75, 81);
    band(after.homeWinPct, 45, 65);
    band(after.overtimePct, 0, 15);
  });

  it('plays closer finishes and gives starters fewer minutes', () => {
    // The real rosters (five seasons): overtime about 3.5% -> 5%, games within five points about 21% -> 34%, stars 36-38 -> 33-36 minutes.
    expect(after.within5).toBeGreaterThan(before.within5);
    expect(after.margin).toBeLessThan(before.margin);
    expect(after.starterMinutesP90).toBeLessThanOrEqual(before.starterMinutesP90);
    band(after.starterMinutes, 28, 34);
    expect(after.starterMinutesP90).toBeLessThanOrEqual(36.5);
  });

  it('changes only the nba-2026b set: FIBA and the format 90-95 NBA set are untouched', () => {
    const fiba = calibrationFor(FIBA_2024), nba = calibrationFor(NBA_2026), next = calibrationFor(NBA_2026B);
    expect(fiba.ROTATION).toBe(ROTATION);
    expect(fiba.SCORE_EFFECT).toBe(SCORE_EFFECT);
    expect(fiba.PLAYS).toBe(PLAYS);
    expect(nba.SCORE_EFFECT).toBe(SCORE_EFFECT);
    expect(nba.HOME_COURT_MAKE_BONUS).toBe(.007);
    expect(nba.FREE_THROWS).toEqual({ ...FREE_THROWS, base: .48 });
    expect(nba.ROTATION.plannedMinutes).toEqual([34.5, 33.5, 32.5, 31.5, 30.5, 22, 18.5, 16, 12, 6, 0, 0]);
    expect(nba.ROTATION.qualityMinutes).toBe(.25);
    expect(nba.PLAYS.intentional).toEqual(PLAYS.intentional);
    expect(next.HOME_COURT_MAKE_BONUS).toBe(.005);
    expect(next.SCORE_EFFECT).toEqual({ ...SCORE_EFFECT, perPoint: .0022, fourthQuarter: 2.5 });
    expect(next.ROTATION).toEqual({ ...nba.ROTATION, plannedMinutes: [34, 33, 32.5, 31.5, 30.5, 22.5, 19, 16.5, 12.5, 6, 0, 0], qualityMinutes: .1 });
    expect(next.PLAYS).toEqual({ ...nba.PLAYS, intentional: [{ lead: 2, seconds: 24 }] });
    // Everything else is the NBA set's.
    for (const key of ['SHOT_SELECTION', 'FREE_THROWS', 'REBOUNDS', 'FLOW', 'LATE_GAME', 'BLOCKS'] as const) expect(next[key]).toBe(nba[key]);
    expect({ ...rulesetById('nba-2026b'), id: 'nba-2026' }).toEqual(NBA_2026);
    expect(isNba(NBA_2026B)).toBe(true);
  });
});

describe('format 96 NBA worlds', () => {
  const world = worldFromPack(nbaPack(), 'nba');

  it('marks new NBA worlds, plays their games under nba-2026b, and refuses the marker before format 96', () => {
    expect(world.nba!.balance).toBe('nba-balance-1');
    expect(world.nba!.ruleset).toBe('nba-2026b');
    expect(fixtureRuleset({ world }, { homeClubId: 'nba-bos', awayClubId: 'nba-lal' })).toBe('nba-2026b');
    const state = createSeason({ seed: 5, world, managedClubId: 'nba-bos', ...NEW_CAREER_SYSTEMS });
    expect(usesNbaBalance(state)).toBe(true);
    const text = serializeSeason(state);
    expect(worldOf(parseSeason(text)).nba!.balance).toBe('nba-balance-1');
    const envelope = JSON.parse(text);
    envelope.formatVersion = 95; envelope.state.schemaVersion = 95;
    expect(() => parseSeason(JSON.stringify(envelope))).toThrow(/world\.nba\.balance.*format 96 or later/);
    // The revision and the marker go together.
    expect(() => validateWorld({ ...world, nba: { ...world.nba!, ruleset: 'nba-2026' } })).toThrow(/world\.nba/);
    expect(() => validateWorld(withoutBalance(world))).not.toThrow();
    expect(() => validateWorld({ ...withoutBalance(world), nba: { ...withoutBalance(world).nba!, ruleset: 'nba-2026b' } })).toThrow(/world\.nba/);
  });

  it('keeps format 90-95 NBA worlds on nba-2026 and their money rules', () => {
    const old = withoutBalance(world);
    expect(fixtureRuleset({ world: old }, { homeClubId: 'nba-bos', awayClubId: 'nba-lal' })).toBe('nba-2026');
    const state = createSeason({ seed: 5, world: old, managedClubId: 'nba-bos', ...NEW_CAREER_SYSTEMS });
    expect(usesNbaBalance(state)).toBe(false);
    expect(NBA_CLUB_IDS.some(id => staffRoomForWages(state, id, 1) > 0)).toBe(true);
  });

  it('sets an NBA club\'s wages pool to its owner\'s ceiling, with no staff budget on top', () => {
    const state = createSeason({ seed: 5, world, managedClubId: 'nba-bos', ...NEW_CAREER_SYSTEMS });
    for (const id of NBA_CLUB_IDS) {
      const ambition = presidentTraits(world, id).ambition, level = nbaOwnerCeilingLevel(world, id);
      expect(level).toBe(ambition <= 2 ? 'below-tax' : ambition === 3 ? 'at-tax' : 'apron');
      expect(nbaOwnerCeiling(world, id)).toBeLessThanOrEqual(level === 'apron' ? NBA_FIRST_APRON : NBA_TAX_LINE);
      expect(staffRoomForWages(state, id, 1)).toBe(0);
      expect(staffRoomForWages(state, id, 2)).toBe(0);
      expect(getClubContractSummary(state, id, 2).budget).toBe(seasonSalaryBudget(state, id, 2));
    }
  });
});
