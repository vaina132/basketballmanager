import { describe, expect, it } from 'vitest';
import { compactJson, expandJson } from '../src/storage/compact-json';
import { parseSeason, serializeSeason, serializeSeasonCompact } from '../src/storage/season-storage';
import { compactSaveEnvelope, compressSaveText } from '../src/storage/save-compression';
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
    // Since 24 November 2026 the compact-3 text is stored compressed; the compact layout inside is unchanged.
    expect(JSON.parse(compact)).toMatchObject({ formatVersion: SEASON_SCHEMA_VERSION, encoding: 'compact-3-deflate' });
    const file = compactSaveEnvelope(compact) as any;
    // Format 73 writes the compact-3 layout: the state is `[shape, ...values]`, with the finance ledger packed.
    expect(file).toMatchObject({ formatVersion: SEASON_SCHEMA_VERSION, encoding: 'compact-3' });
    // The uncompressed compact-3 text stays readable.
    expect(parseSeason(JSON.stringify(file))).toEqual(state);
    expect(() => parseSeason(JSON.stringify({ ...file, encoding: 'other' }))).toThrow(/unsupported save encoding/);
    expect(() => parseSeason(JSON.stringify({ ...file, encoding: 'compact-2' }))).toThrow(/unsupported save encoding/);
    // Change the managed club's seed field inside the compact state: the ordinary checks must still notice.
    const seedIndex = file.shapes[file.state[0]].indexOf('seed');
    const changed = structuredClone(file); changed.state[seedIndex + 1] = file.state[seedIndex + 1] + 1;
    expect(() => parseSeason(JSON.stringify(changed))).toThrow(/Invalid season save/);
    expect(() => parseSeason(compressSaveText(changed, JSON.stringify(changed)))).toThrow(/Invalid season save/);
    // A compressed save must carry a compact-3 save of its own format, and its data must be intact.
    const outer = JSON.parse(compact);
    expect(() => parseSeason(compressSaveText({ ...file, formatVersion: SEASON_SCHEMA_VERSION - 1 }, JSON.stringify(file)))).toThrow(/same format/);
    expect(() => parseSeason(compressSaveText(file, JSON.stringify({ ...file, encoding: 'compact-2' })))).toThrow(/same format/);
    expect(() => parseSeason(compressSaveText(file, compressSaveText(file, JSON.stringify(file))))).toThrow(/same format/);
    expect(() => parseSeason(JSON.stringify({ ...outer, formatVersion: 72 }))).toThrow(/unsupported save encoding/);
    expect(() => parseSeason(JSON.stringify({ ...outer, bytes: outer.bytes + 1 }))).toThrow(/Invalid season save/);
    expect(() => parseSeason(JSON.stringify({ ...outer, data: outer.data.slice(0, -8) }))).toThrow(/Invalid season save/);
    expect(() => parseSeason(JSON.stringify({ ...outer, extra: 1 }))).toThrow(/Invalid season save/);
    expect(() => parseSeason(JSON.stringify({ ...outer, bytes: 2 ** 40 }))).toThrow(/invalid size/);
  }, 300_000);
});
