import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { COMPACT_JSON_LIMITS, compactJson, compactJson2, compactJson3, expandJson, expandJson3 } from '../src/storage/compact-json';

const persisted = value => JSON.parse(JSON.stringify(value));
const limits = changes => ({ ...COMPACT_JSON_LIMITS, ...changes });
const empty = { strings: [], shapes: [], nodes: [], value: null };

describe('lossless compact-2 JSON', () => {
  it('round trips marker literals, Unicode, ordered keys and distinct shapes containing null characters', () => {
    const repeated = { text: 'A long repeated sentence with escaped "quotes" and 🏀.', list: [null, true, false, 3.5, -2, ...Array.from({ length: 20 }, (_, index) => index)] };
    const value = {
      b: repeated, a: structuredClone(repeated), other: [repeated, structuredClone(repeated)],
      markers: [['§r', 0], ['§o', 1], ['§a'], '§s§r', '§0', '§', '\ud800'],
      shapes: [{ 'a\u0000b': 1 }, { a: 2, b: 3 }], empty: [{}, []],
    };
    const encoded = compactJson2(value);
    expect(encoded.nodes.length).toBeGreaterThan(0);
    expect(JSON.stringify(expandJson(persisted(encoded)))).toBe(JSON.stringify(value));
    expect(JSON.stringify(expandJson(persisted(compactJson(value))))).toBe(JSON.stringify(value));
  });

  it('reconstructs independent arrays and objects for repeated references', () => {
    const item = { attributes: { passing: 12, defense: 14, stamina: 16 }, details: ['a-long-player-identifier', 'another-long-identifier'] };
    const restored = expandJson(persisted(compactJson2([item, item, [item]])));
    expect(restored).toEqual([item, item, [item]]);
    expect(restored[0]).not.toBe(restored[1]);
    expect(restored[0].attributes).not.toBe(restored[1].attributes);
    expect(restored[0].details).not.toBe(restored[2][0].details);
    restored[0].attributes.passing = 1;
    restored[0].details.push('changed');
    expect(restored[1]).toEqual(item);
    expect(restored[2][0]).toEqual(item);
  });

  it('reduces a genuine completed season without losing any fields or reordering keys', () => {
    const file = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/season40-board-complete.json.gz', import.meta.url))).toString('utf8'));
    const legacy = compactJson(file.state), compact = compactJson2(file.state);
    expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify(legacy).length * 0.65);
    expect(JSON.stringify(expandJson(persisted(compact)))).toBe(JSON.stringify(file.state));
  });

  it.each([
    { ...empty, nodes: null },
    { ...empty, nodes: [null] },
    { ...empty, nodes: [[['§r', 0]]] }, // self-reference
    { ...empty, nodes: [[['§r', 1]], []] }, // forward reference
    { ...empty, nodes: [['§r', 0]] }, // a node must be a subtree, not a reference alias
    { ...empty, nodes: [[]], value: ['§r', 1] },
    { ...empty, nodes: [[]], value: ['§r', -1] },
    { ...empty, nodes: [[]], value: ['§r', 0.5] },
    { ...empty, nodes: [[]], value: ['§r', '0'] },
    { ...empty, nodes: [[]], value: ['§r', 0, 0] },
    { ...empty, nodes: [['§o', 0]] }, // even unused nodes must be valid
    { ...empty, nodes: [['§99']] },
    { ...empty, shapes: [null] },
    { ...empty, shapes: [['a', 'a']] },
    { ...empty, shapes: [['constructor']] },
    { ...empty, shapes: [[0.5]], strings: ['key'] },
    { ...empty, strings: ['value'], value: '§00' },
    { ...empty, value: undefined },
    { ...empty, value: Infinity },
    { ...empty, value: { unexpected: true } },
  ])('rejects malformed data, including unused dictionary entries %#', malformed => {
    expect(() => expandJson(malformed)).toThrow(/compact season data/);
  });

  it('rejects exponential expansion before allocating the restored graph, including unused bombs', () => {
    const nodes = [[0]];
    for (let index = 1; index < 15; index += 1) nodes.push([['§r', index - 1], ['§r', index - 1]]);
    for (const value of [null, ['§r', nodes.length - 1]]) {
      expect(() => expandJson({ ...empty, nodes, value }, limits({ maxValues: 1000 }))).toThrow(/expanded values/);
    }
  });

  it('counts decoded depth rather than reference markers, and rejects a deeply nested reference chain', () => {
    const nodes = [[null]];
    for (let index = 1; index < 40; index += 1) nodes.push([['§r', index - 1]]);
    expect(() => expandJson({ ...empty, nodes, value: ['§r', 39] })).not.toThrow();
    expect(() => expandJson({ ...empty, nodes, value: [['§r', 39]] })).toThrow(/nested objects/);
    let value = null;
    for (let index = 0; index < 40; index += 1) value = [value];
    expect(expandJson(compactJson2(value))).toEqual(value);
  });

  it('enforces the expanded UTF-8 JSON byte budget including escaped strings, property names and separators', () => {
    const value = { 'é🏀\n"': ['🏀\n"\ud800', '🏀\n"\ud800'], rest: { ok: true } };
    const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
    const encoded = compactJson2(value);
    expect(expandJson(encoded, limits({ maxBytes: bytes }))).toEqual(value);
    expect(() => expandJson(encoded, limits({ maxBytes: bytes - 1 }))).toThrow(/byte limit/);
    // Long string references must count every expansion, not just their dictionary storage.
    const shared = { ...empty, strings: ['x'.repeat(50)], value: ['§0', '§0', '§0'] };
    expect(() => expandJson(shared, limits({ maxBytes: 120 }))).toThrow(/byte limit/);
  });


  it('refuses to write a payload beyond the reader budget, and round trips the exact byte boundary', () => {
    const item = { '\u00e9\u{1f3c0}\n"': ['repeated text with "quotes" and \u{1f3c0}', 'repeated text with "quotes" and \u{1f3c0}'], stats: [1, 2, 3, 4] };
    const value = [item, structuredClone(item), structuredClone(item)];
    const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
    const tooSmall = limits({ maxBytes: bytes - 1 });
    const atBoundary = limits({ maxBytes: bytes });
    // A decoder would reject this otherwise well-formed payload; the writer must refuse before it can be stored.
    const encoded = compactJson2(value);
    expect(() => expandJson(encoded, tooSmall)).toThrow(/byte limit/);
    expect(() => compactJson2(value, tooSmall)).toThrow(/byte limit/);
    const accepted = compactJson2(value, atBoundary);
    expect(expandJson(persisted(accepted), atBoundary)).toEqual(value);
  });

  it('checks generated table sizes even when every original collection fits the chosen limit', () => {
    const value = { a: { b: { c: 1 }, d: { e: 2 } }, f: { g: { h: 3 }, i: { j: 4 } } };
    // Every original object has at most two properties; their distinct shapes still exceed a two-entry table.
    const smallTables = limits({ maxCollectionEntries: 2 });
    expect(() => compactJson2(value, smallTables)).toThrow(/shape table/);
    expect(expandJson(persisted(compactJson2(value)))).toEqual(value);
  });

  it('bounds direct collections and rejects non-JSON encoder inputs', () => {
    expect(() => expandJson({ ...empty, value: [1, 2, 3] }, limits({ maxCollectionEntries: 2 }))).toThrow(/collection entries/);
    expect(() => compactJson2({ value: undefined })).toThrow(/JSON values/);
    expect(() => compactJson2([Infinity])).toThrow(/JSON values/);
  });
});

// Format 73 (step 3.7): the same tables in a tighter layout. Objects are `[shape, ...values]`, shared texts use base-36
// indexes, node references are `["§@", index]` and arrays that start with a number or a marker are escaped with "§:".
describe('lossless compact-3 JSON', () => {
  it('round trips numbers first in arrays, marker literals, base-36 text indexes and empty collections', () => {
    const repeated = { text: 'A long repeated sentence with escaped "quotes" and 🏀.', list: [null, true, false, 3.5, -2, ...Array.from({ length: 20 }, (_, index) => index)] };
    const ids = Array.from({ length: 400 }, (_, index) => `a-shared-identifier-${index}`);
    const value = {
      b: repeated, a: structuredClone(repeated), other: [repeated, structuredClone(repeated)],
      markers: [['§r', 0], ['§o', 1], ['§a'], ['§:', 2], ['§@', 0], '§s§r', '§0', '§a', '§§', '§', '\ud800', [0], [1, 'x'], [[2]], [-1.5, 'y']],
      shapes: [{ 'a\u0000b': 1 }, { a: 2, b: 3 }], empty: [{}, [], [{}], [[]]],
      ids: [...ids, ...ids],
    };
    const encoded = compactJson3(value);
    expect(encoded.nodes.length).toBeGreaterThan(0);
    expect(encoded.strings.length).toBeGreaterThan(36);
    expect(JSON.stringify(expandJson3(persisted(encoded)))).toBe(JSON.stringify(value));
    // Objects carry no marker and base-36 indexes are shorter than decimal ones.
    expect(encoded.value[0]).toBe(0);
    expect(JSON.stringify(encoded).length).toBeLessThan(JSON.stringify(compactJson2(value)).length);
    // Each layout is read only by its own reader.
    expect(() => expandJson3(persisted(compactJson2(value)))).toThrow(/compact season data/);
  });

  it('reduces a genuine completed season further than compact-2 and restores it exactly', () => {
    const file = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/season40-board-complete.json.gz', import.meta.url))).toString('utf8'));
    const compact2 = compactJson2(file.state), compact3 = compactJson3(file.state);
    expect(JSON.stringify(compact3).length).toBeLessThan(JSON.stringify(compact2).length * 0.95);
    expect(JSON.stringify(expandJson3(persisted(compact3)))).toBe(JSON.stringify(file.state));
    const restored = expandJson3(persisted(compactJson3([file.state.clubs[0], file.state.clubs[0]])));
    expect(restored[0]).not.toBe(restored[1]);
    expect(restored[0]).toEqual(file.state.clubs[0]);
  });

  it.each([
    { ...empty, nodes: null },
    { ...empty, nodes: [null] },
    { ...empty, nodes: [[['§@', 0]]] }, // self-reference
    { ...empty, nodes: [[['§@', 1]], []] }, // forward reference
    { ...empty, nodes: [['§@', 0]] },
    { ...empty, nodes: [[]], value: ['§@', 1] },
    { ...empty, nodes: [[]], value: ['§@', '0'] },
    { ...empty, nodes: [[0]] }, // an unknown shape, even in an unused node
    { ...empty, shapes: [['a']], value: [0] }, // too few values for the shape
    { ...empty, shapes: [['a']], value: [0, 1, 2] },
    { ...empty, shapes: [['a']], value: [0.5, 1] },
    { ...empty, shapes: [['a']], value: [-1, 1] },
    { ...empty, strings: ['value'], value: '§00' },
    { ...empty, strings: ['value'], value: '§1' },
    { ...empty, strings: ['value'], value: '§A' },
    { ...empty, strings: ['value'], value: '§' },
    { ...empty, value: Infinity },
    { ...empty, value: { unexpected: true } },
    { strings: [], shapes: [], value: null }, // compact-3 always has a node table
  ])('rejects malformed compact-3 data %#', malformed => {
    expect(() => expandJson3(malformed)).toThrow(/compact season data/);
  });

  it('keeps the expansion budgets', () => {
    const nodes = [[null]];
    for (let index = 1; index < 15; index += 1) nodes.push([['§@', index - 1], ['§@', index - 1]]);
    expect(() => expandJson3({ ...empty, nodes, value: ['§@', nodes.length - 1] }, limits({ maxValues: 1000 }))).toThrow(/expanded values/);
    const value = { 'é🏀\n"': ['🏀\n"\ud800', '🏀\n"\ud800'], rest: { ok: true } };
    const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
    expect(expandJson3(compactJson3(value), limits({ maxBytes: bytes }))).toEqual(value);
    expect(() => expandJson3(compactJson3(value), limits({ maxBytes: bytes - 1 }))).toThrow(/byte limit/);
    expect(() => compactJson3(value, limits({ maxBytes: bytes - 1 }))).toThrow(/byte limit/);
    expect(() => compactJson3([Infinity])).toThrow(/JSON values/);
  });
});
