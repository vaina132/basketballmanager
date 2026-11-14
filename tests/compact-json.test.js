import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { COMPACT_JSON_LIMITS, compactJson, compactJson2, expandJson } from '../src/storage/compact-json';

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
