/**
 * A lossless compact form of JSON data for season saves (format 40). Most of a large save is repetition: every
 * box-score line, ledger entry or academy report spells out the same field names, and long identifiers (real
 * clubs' and players' ids) recur thousands of times. Two tables remove that:
 * - shapes: each distinct ordered key list is stored once; an object becomes `["§o", shapeIndex, ...values]`;
 * - strings: each text of at least 10 characters that occurs more than once is stored once; a use becomes `"§" + index`.
 * Arrays stay arrays; one that starts with an object marker is escaped as `["§a", ...items]`, and an original text
 * that starts with "§" is escaped as `"§s" + text`. Decoding rebuilds objects with the same keys in the same order,
 * so the result equals the original exactly. Shape keys use the string table too (as numbers).
 */
export const COMPACT_JSON_ENCODING = 'compact-1';
const OBJECT = '§o';
const ARRAY = '§a';
const MARK = '§';
const MIN_SHARED_LENGTH = 10;
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);

export interface CompactJson { strings: string[]; shapes: (string | number)[][]; value: unknown }

export function compactJson(value: unknown): CompactJson {
  // Count long texts (values and keys) to decide which are worth sharing.
  const counts = new Map<string, number>();
  const note = (text: string) => { if (text.length >= MIN_SHARED_LENGTH) counts.set(text, (counts.get(text) ?? 0) + 1); };
  const count = (item: unknown): void => {
    if (typeof item === 'string') note(item);
    else if (Array.isArray(item)) item.forEach(count);
    else if (item !== null && typeof item === 'object') for (const [key, child] of Object.entries(item)) { note(key); count(child); }
  };
  count(value);
  const strings: string[] = [], stringIndex = new Map<string, number>();
  for (const [text, uses] of counts) if (uses > 1) { stringIndex.set(text, strings.length); strings.push(text); }
  const shapes: (string | number)[][] = [], shapeIndex = new Map<string, number>();
  const encodeText = (text: string) => { const shared = stringIndex.get(text); return shared !== undefined ? `${MARK}${shared}` : text.startsWith(MARK) ? `${MARK}s${text}` : text; };
  const encode = (item: unknown): unknown => {
    if (typeof item === 'string') return encodeText(item);
    if (item === null || typeof item !== 'object') return item;
    if (Array.isArray(item)) {
      const items = item.map(encode);
      return items.length && (items[0] === OBJECT || items[0] === ARRAY) ? [ARRAY, ...items] : items;
    }
    const keys = Object.keys(item), key = keys.join('\u0000');
    let shape = shapeIndex.get(key);
    if (shape === undefined) { shape = shapes.length; shapes.push(keys.map(name => stringIndex.get(name) ?? name)); shapeIndex.set(key, shape); }
    return [OBJECT, shape, ...keys.map(name => encode((item as Record<string, unknown>)[name]))];
  };
  return { strings, shapes, value: encode(value) };
}

/** Rebuilds the original data; throws on malformed input instead of guessing. */
export function expandJson(compact: { strings: unknown; shapes: unknown; value: unknown }): unknown {
  const fail = (reason: string): never => { throw new Error(`The compact season data ${reason}.`); };
  if (!Array.isArray(compact.strings) || compact.strings.some(text => typeof text !== 'string')) fail('has an invalid string table');
  const strings = compact.strings as string[];
  if (!Array.isArray(compact.shapes)) fail('has no shape table');
  const shapes = (compact.shapes as unknown[]).map(shape => {
    if (!Array.isArray(shape)) fail('has an invalid shape');
    const keys = (shape as unknown[]).map(key => typeof key === 'number' ? strings[key] ?? fail('refers to an unknown string') : typeof key === 'string' ? key : fail('has an invalid key'));
    if (keys.some(key => FORBIDDEN.has(key)) || new Set(keys).size !== keys.length) fail('has an unsafe or repeated key');
    return keys;
  });
  const decodeText = (text: string): string => {
    if (!text.startsWith(MARK)) return text;
    if (text.startsWith(`${MARK}s`)) return text.slice(2);
    const index = text.slice(1);
    if (!/^\d+$/.test(index) || strings[Number(index)] === undefined) fail('refers to an unknown string');
    return strings[Number(index)]!;
  };
  const decode = (item: unknown): unknown => {
    if (typeof item === 'string') return decodeText(item);
    if (item === null || typeof item !== 'object') return item;
    if (!Array.isArray(item)) fail('contains an unexpected object');
    const items = item as unknown[];
    if (items[0] === OBJECT) {
      const shape = Number.isInteger(items[1]) ? shapes[items[1] as number] : undefined;
      if (!shape || items.length !== shape.length + 2) fail('refers to an unknown shape');
      const result: Record<string, unknown> = {};
      for (let position = 0; position < shape!.length; position += 1) result[shape![position]!] = decode(items[position + 2]);
      return result;
    }
    return (items[0] === ARRAY ? items.slice(1) : items).map(decode);
  };
  return decode(compact.value);
}
