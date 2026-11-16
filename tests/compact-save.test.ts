import { describe, expect, it } from 'vitest';
import { compactJson, expandJson } from '../src/storage/compact-json';
import { parseSeason, serializeSeason, serializeSeasonCompact } from '../src/storage/season-storage';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { advanceSeason, createSeason, managedSide, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { testWorld } from './world-fixtures';
import { SEASON_SCHEMA_VERSION } from './helpers/season-format';

const roundTrip = (value: unknown) => expandJson(JSON.parse(JSON.stringify(compactJson(value))));

describe('the compact save layout', () => {
  it('restores any JSON data exactly, including key order and marker-like values', () => {
    const tricky = {
      b: 1, a: [{ x: 1, y: 'a-long-identifier-1' }, { x: 2, y: 'a-long-identifier-1' }], '2': 'numeric key', '10': 'another',
      empty: {}, none: [], nested: [[1, 2], [{ deep: { deeper: [null, true, false, 0, -1.5] } }]],
      markers: ['§o', 3, 'x'], marker2: ['§a'], escaped: '§12', section: '§', shared: ['§s§', '§s§'], nothing: null,
    };
    const restored = roundTrip(tricky);
    expect(restored).toEqual(tricky);
    expect(JSON.stringify(restored)).toBe(JSON.stringify(tricky));
    // Repeated long texts and repeated key lists are stored once.
    const compact = compactJson({ list: Array.from({ length: 50 }, (_, index) => ({ clubId: 'club-0000-1111-2222', round: index })) });
    expect(compact.strings).toEqual(['club-0000-1111-2222']);
    expect(compact.shapes).toHaveLength(2);
  });

  it('refuses damaged compact data instead of guessing', () => {
    const compact = JSON.parse(JSON.stringify(compactJson({ a: { b: 'a-long-identifier-1', c: 'a-long-identifier-1' } })));
    expect(() => expandJson({ ...compact, shapes: [['__proto__']], value: ['§o', 0, 1] })).toThrow(/unsafe/);
    expect(() => expandJson({ ...compact, value: ['§o', 99] })).toThrow(/unknown shape/);
    expect(() => expandJson({ ...compact, value: '§99' })).toThrow(/unknown string/);
    expect(() => expandJson({ ...compact, value: ['§o', 0] })).toThrow(/unknown shape/);
    expect(() => expandJson({ ...compact, strings: [1] })).toThrow(/string table/);
  });

  it('saves a career compactly and loads it back exactly; damage inside is still caught by the save checks', () => {
    let state = createSeason({ seed: 71, managedClubId: 'w1-rhine-falcons', world: testWorld(8), ...NEW_CAREER_SYSTEMS });
    for (let round = 0; round < 4; round += 1) state = advanceSeason({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch!, managedSide(state), true)) });
    const plain = serializeSeason(state), compact = serializeSeasonCompact(state);
    expect(parseSeason(compact)).toEqual(state);
    expect(parseSeason(plain)).toEqual(state);
    expect(compact.length).toBeLessThan(plain.length * 0.5);
    const file = JSON.parse(compact);
    // Format 73 writes the compact-3 layout: the state is `[shape, ...values]`, with the finance ledger packed.
    expect(file).toMatchObject({ formatVersion: SEASON_SCHEMA_VERSION, encoding: 'compact-3' });
    expect(() => parseSeason(JSON.stringify({ ...file, encoding: 'other' }))).toThrow(/unsupported save encoding/);
    expect(() => parseSeason(JSON.stringify({ ...file, encoding: 'compact-2' }))).toThrow(/unsupported save encoding/);
    // Change the managed club's seed field inside the compact state: the ordinary checks must still notice.
    const seedIndex = file.shapes[file.state[0]].indexOf('seed');
    const changed = structuredClone(file); changed.state[seedIndex + 1] = file.state[seedIndex + 1] + 1;
    expect(() => parseSeason(JSON.stringify(changed))).toThrow(/Invalid season save/);
  }, 300_000);
});
