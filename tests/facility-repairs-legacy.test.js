import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseSeason, serializeSeasonCompact } from '../src/storage/season-storage';
import { startFacilityRepair } from '../src/world/facilities';
import { getClubFacilities, getFacilityCondition, getFacilityUpkeepBreakdown } from '../src/world/facilities-policy';
import { createSeasonInjury } from '../src/world/health';

/** Careers created before format 65 keep `facilities-1`: three facilities, upkeep-plan condition and no repairs. */
describe('older careers keep their facilities (format 65)', () => {
  it('load a format-59 career with its three facilities and no repairs, and save it unchanged', () => {
    const bytes = readFileSync(new URL('./fixtures/season59-places-legacy-opening.json.gz', import.meta.url));
    const state = parseSeason(gunzipSync(bytes).toString('utf8'));
    expect(state.facilities.model).toBe('facilities-1');
    const club = getClubFacilities(state);
    expect(club.rows.map(row => row.type)).toEqual(['arena', 'training', 'youth']);
    expect(club.rows.every(row => row.repair === null && row.condition === 100)).toBe(true);
    expect(Object.keys(getFacilityUpkeepBreakdown(state, state.managedClubId))).toEqual(['arena', 'training', 'youth', 'total']);
    for (const entry of state.finance.ledger.filter(item => item.kind === 'facility-upkeep')) expect(Object.keys(entry.facilityUpkeep)).toEqual(['arena', 'training', 'youth']);
    // A worn arena exists only in new careers; older ones never wear without upkeep choices.
    expect(getFacilityCondition({ ...state, date: '2031-09-06' }, 'arena', state.managedClubId)).toBe(100);
    expect(() => startFacilityRepair(state, 'arena')).toThrow(/current facilities model/);
    // Injuries keep their original diagnoses (no medical centre).
    for (const injury of state.injuries) expect(createSeasonInjury(state.seed, { id: injury.fixtureId, date: injury.occurredOn }, injury.clubId, injury.playerId, injury.kind, state.injuries)).toEqual(injury);
    expect(parseSeason(serializeSeasonCompact(state))).toEqual(state);
  }, 120_000);
});
