import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { enableFacilityMaintenance, setMaintenancePlan, startFacilityUpgrade } from '../src/world/facilities';
import { FACILITY_RECOVERY_PER_MATCHDAY, FACILITY_REDUCED_UPKEEP_PERCENT, FACILITY_WEAR_PER_MATCHDAY, facilityPracticeBonusPercent, getFacilityCondition, getFacilityLevel, getFacilityUpkeep, maintenancePlanOn } from '../src/world/facilities-policy';
import { createSeason, dateForRound, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { advanceMatchday } from './helpers/board-funding';
import { currentSeasonFile } from './helpers/season-format';

const club = 'rhine-falcons';
const upkeepAt = (state: SeasonState, round: number) => state.finance.ledger.find(entry => entry.kind === 'facility-upkeep' && entry.clubId === club && entry.seasonNumber === 1 && entry.round === round)?.amount;
const career = (facilityMaintenance: boolean) => createSeason({ seed: 227, managedClubId: club, injuryMode: 'off', manager: { name: 'Upkeep Manager', dateOfBirth: '1984-03-17', nationality: 'Germany' }, ...NEW_CAREER_SYSTEMS, facilityMaintenance });
let worn: SeasonState, restored: SeasonState;

beforeAll(() => {
  // Training level 2 is commissioned on the opening day and completes on matchday 4 (21 days later).
  let state = startFacilityUpgrade(career(true), 'training');
  while (state.round < 4) state = advanceMatchday(state);
  state = setMaintenancePlan(state, 'reduced');
  while (state.round < 8) state = advanceMatchday(state);
  worn = state;
  state = setMaintenancePlan(state, 'full');
  while (state.round < 10) state = advanceMatchday(state);
  restored = state;
}, 120_000);

describe('facility maintenance rules', () => {
  it('keeps standard facilities and careers without upkeep choices at full condition', () => {
    const plain = career(false);
    expect(plain.facilities.maintenanceSince).toBeNull();
    expect(getFacilityCondition(plain, 'arena', club)).toBe(100);
    expect(maintenancePlanOn(plain.facilities, club)).toBe('full');
    expect([FACILITY_WEAR_PER_MATCHDAY, FACILITY_RECOVERY_PER_MATCHDAY, FACILITY_REDUCED_UPKEEP_PERCENT]).toEqual([5, 10, 50]);
    expect(() => setMaintenancePlan(plain, 'reduced')).toThrow(/Enable facility maintenance/);
  });
});

describe('facility maintenance in a career', () => {
  it('halves upkeep from the matchday after choosing reduced upkeep, while the facility wears', () => {
    expect(getFacilityLevel(worn, 'training', club)).toBe(2);
    expect(maintenancePlanOn(worn.facilities, club, dateForRound(4))).toBe('full');
    expect(maintenancePlanOn(worn.facilities, club, dateForRound(5))).toBe('reduced');
    expect(upkeepAt(worn, 4)).toBe(-40_000);
    expect(upkeepAt(worn, 5)).toBe(-20_000);
    // Matchdays 5-7 under reduced upkeep: 100 - 3 x 5.
    expect(getFacilityCondition(worn, 'training', club)).toBe(85);
    expect(facilityPracticeBonusPercent(worn, 'training', club)).toBe(4);
    expect(getFacilityUpkeep(worn, club)).toBe(20_000);
  });

  it('recovers under full upkeep and keeps every effect valid in the save', () => {
    // Matchday 8 still reduced (80), matchday 9 under full upkeep (+10).
    expect(getFacilityCondition(restored, 'training', club)).toBe(90);
    expect(upkeepAt(restored, 9)).toBe(-40_000);
    expect(parseSeason(serializeSeason(restored))).toEqual(restored);
    expect(() => setMaintenancePlan(restored, 'full')).toThrow(/already selected/);
  });

  it('lets older careers opt in without changing anything before the switch', () => {
    let plain = startFacilityUpgrade(career(false), 'training');
    while (plain.round < 6) plain = advanceMatchday(plain);
    const switched = enableFacilityMaintenance(plain);
    expect(getFacilityCondition(switched, 'training', club)).toBe(100);
    expect(parseSeason(serializeSeason(switched))).toEqual(switched);
    expect(enableFacilityMaintenance(switched)).toBe(switched);
  }, 60_000);

  it.each([
    ['a changed upkeep plan', (copy: SeasonState) => { const event = copy.facilities.events.find(item => item.type === 'maintenance')! as { plan: string }; event.plan = 'full'; }],
    ['a removed upkeep choice', (copy: SeasonState) => { copy.facilities.events = copy.facilities.events.filter(item => item.type !== 'maintenance'); }],
  ])('rejects %s', (_label, mutate) => {
    const copy = structuredClone(worn);
    mutate(copy);
    expect(() => parseSeason(currentSeasonFile(copy))).toThrow(/Invalid season save/);
  });

  it('rejects upkeep choices in a format-35 file', () => {
    const file = JSON.parse(serializeSeason(worn));
    file.formatVersion = 35; file.state.schemaVersion = 35;
    expect(() => parseSeason(JSON.stringify(file))).toThrow(/unsupported fields/);
  });
});
