/**
 * Lossless compact JSON for season saves. Most of a large save is repetition: every
 * box-score line, ledger entry or academy report spells out the same field names, and long identifiers (real
 * clubs' and players' ids) recur thousands of times. Two tables remove that:
 * - shapes: each distinct ordered key list is stored once; an object becomes `["§o", shapeIndex, ...values]`;
 * - strings: each text of at least 10 characters that occurs more than once is stored once; a use becomes `"§" + index`.
 * Arrays stay arrays; one that starts with an object marker is escaped as `["§a", ...items]`, and an original text
 * that starts with "§" is escaped as `"§s" + text`. Decoding rebuilds objects with the same keys in the same order,
 * so the result equals the original exactly. Shape keys use the string table too (as numbers).
 * Compact-2 also shares repeated object/array subtrees in a topologically ordered node table. References are
 * `["§r", nodeIndex]`; every node may refer only to earlier nodes. Decoding always creates independent objects.
 *
 * Compact-3 (format 73, step 3.7) writes the same tables more tightly: an object is `[shapeIndex, ...values]` (an array
 * whose first item is a number), a shared text is `"§" + index` in base 36, a node reference is `["§@", nodeIndex]`,
 * an array whose first item is a number or a marker is escaped as `["§:", ...items]`, and an original text that starts
 * with "§" is written as `"§" + text` (so it starts with "§§").
 */
import { MAX_SEASON_COLLECTION_ENTRIES, MAX_SEASON_SAVE_BYTES, MAX_SEASON_SAVE_VALUES } from './season-limits';

export const COMPACT_JSON_ENCODING = 'compact-2';
export const LEGACY_COMPACT_JSON_ENCODING = 'compact-1';
export const COMPACT_JSON_3_ENCODING = 'compact-3';
const OBJECT = '§o';
const ARRAY = '§a';
const REFERENCE = '§r';
const MARK = '§';
const ARRAY_3 = '§:';
const REFERENCE_3 = '§@';
/** The table layout: 2 for compact-1/compact-2, 3 for compact-3. */
type Layout = 2 | 3;
const MIN_SHARED_LENGTH = 10;
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);

export interface CompactJson { strings: string[]; shapes: (string | number)[][]; value: unknown }
export interface CompactJson2 extends CompactJson { nodes: unknown[][] }

/**
 * Stored saves remain limited to 32 MiB. Lossless sharing may legitimately restore more than that (several real
 * seasons), but a tiny malicious reference graph must not expand without bound. Keep the plain reader's value,
 * collection and depth limits and separately cap expanded JSON at eight times the stored-file limit.
 */
export const COMPACT_JSON_LIMITS = Object.freeze({
  maxValues: MAX_SEASON_SAVE_VALUES,
  maxCollectionEntries: MAX_SEASON_COLLECTION_ENTRIES,
  maxDepth: 40,
  maxBytes: MAX_SEASON_SAVE_BYTES * 8,
});

export function compactJson(value: unknown, layout: Layout = 2): CompactJson {
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
  const encodeText = layout === 3
    ? (text: string) => { const shared = stringIndex.get(text); return shared !== undefined ? `${MARK}${shared.toString(36)}` : text.startsWith(MARK) ? `${MARK}${text}` : text; }
    : (text: string) => { const shared = stringIndex.get(text); return shared !== undefined ? `${MARK}${shared}` : text.startsWith(MARK) ? `${MARK}s${text}` : text; };
  const encode = (item: unknown): unknown => {
    if (typeof item === 'string') return encodeText(item);
    if (item === null || typeof item !== 'object') return item;
    if (Array.isArray(item)) {
      const items = item.map(encode);
      if (layout === 3) return items.length && (typeof items[0] === 'number' || items[0] === ARRAY_3 || items[0] === REFERENCE_3) ? [ARRAY_3, ...items] : items;
      return items.length && (items[0] === OBJECT || items[0] === ARRAY) ? [ARRAY, ...items] : items;
    }
    const keys = Object.keys(item), key = JSON.stringify(keys);
    let shape = shapeIndex.get(key);
    if (shape === undefined) { shape = shapes.length; shapes.push(keys.map(name => stringIndex.get(name) ?? name)); shapeIndex.set(key, shape); }
    const values = keys.map(name => encode((item as Record<string, unknown>)[name]));
    return layout === 3 ? [shape, ...values] : [OBJECT, shape, ...values];
  };
  return { strings, shapes, value: encode(value) };
}

/**
 * Shares repeated encoded subtrees. Signatures contain only immediate children, with child node IDs in place of
 * whole subtrees; work is proportional to the original tree rather than repeatedly stringifying every descendant.
 * The legacy encoder escapes marker-like strings first, so literal arrays beginning with §r stay unambiguous.
 */
export function compactJson2(value: unknown, limits: Readonly<Record<keyof typeof COMPACT_JSON_LIMITS, number>> = COMPACT_JSON_LIMITS, layout: Layout = 2): CompactJson2 {
  const compact = compactJson(value, layout);
  type Child = string | number | boolean | null | { node: number };
  const records: { children: Child[]; uses: number; length: number }[] = [];
  const bySignature = new Map<string, number>();
  const visit = (item: unknown): Child => {
    if (!Array.isArray(item)) {
      if (item !== null && typeof item !== 'string' && typeof item !== 'boolean' && !(typeof item === 'number' && Number.isFinite(item))) throw new Error('Compact JSON requires JSON values.');
      return item as Child;
    }
    const children = item.map(visit), signature = JSON.stringify(children);
    let node = bySignature.get(signature);
    if (node === undefined) {
      node = records.length;
      bySignature.set(signature, node);
      const length = 2 + Math.max(0, children.length - 1) + children.reduce<number>((sum, child) => sum + (child !== null && typeof child === 'object' ? records[child.node]!.length : JSON.stringify(child).length), 0);
      records.push({ children, uses: 0, length });
    }
    records[node]!.uses += 1;
    return { node };
  };
  const root = visit(compact.value);
  // Tiny subtrees cost more as dictionary entries plus references than they save.
  const shared = records.map((record, node) => ({ record, node })).filter(({ record }) => record.uses > 1 && record.length >= 40);
  const indices = new Map(shared.map(({ node }, index) => [node, index]));
  const write = (child: Child, body = false): unknown => {
    if (child === null || typeof child !== 'object') return child;
    const index = indices.get(child.node);
    if (!body && index !== undefined) return [layout === 3 ? REFERENCE_3 : REFERENCE, index];
    return records[child.node]!.children.map(item => write(item));
  };
  const encoded = { ...compact, nodes: shared.map(({ node }) => write({ node }, true) as unknown[]), value: write(root) };
  // Never emit a payload that the reader's expansion budgets would reject. This validates dictionary entries and
  // computes fully expanded costs without constructing a second copy of the source state.
  prepareCompactJson(encoded, limits, layout);
  return encoded;
}

/** Compact-3: the compact-2 tables in the tighter layout (format 73 saves). */
export function compactJson3(value: unknown, limits: Readonly<Record<keyof typeof COMPACT_JSON_LIMITS, number>> = COMPACT_JSON_LIMITS): CompactJson2 {
  return compactJson2(value, limits, 3);
}

type CompactJsonInput = { strings: unknown; shapes: unknown; value: unknown; nodes?: unknown };
type CompactJsonLimits = Readonly<Record<keyof typeof COMPACT_JSON_LIMITS, number>>;

/**
 * Rebuilds either compact version. Validate all nodes, including unused ones, and their fully expanded resource
 * costs before allocating the result. A shared node's metrics are reused; its objects themselves never are.
 * Optional lower limits support callers with smaller budgets and exact boundary tests.
 */
export function expandJson(compact: CompactJsonInput, limits: CompactJsonLimits = COMPACT_JSON_LIMITS, layout: Layout = 2): unknown {
  return prepareCompactJson(compact, limits, layout)();
}

/** Rebuilds compact-3 (format 73 saves). */
export function expandJson3(compact: CompactJsonInput, limits: CompactJsonLimits = COMPACT_JSON_LIMITS): unknown {
  return prepareCompactJson(compact, limits, 3)();
}

/** Check the same budgets and format rules as the reader, without allocating the expanded result. */
export function validateCompactJson(compact: CompactJsonInput, limits: CompactJsonLimits = COMPACT_JSON_LIMITS, layout: Layout = 2): void {
  prepareCompactJson(compact, limits, layout);
}

/** Preflight first; only invoking the returned function constructs decoded objects and arrays. */
function prepareCompactJson(compact: CompactJsonInput, limits: CompactJsonLimits, layout: Layout): () => unknown {
  const fail = (reason: string): never => { throw new Error(`The compact season data ${reason}.`); };
  if (!Array.isArray(compact.strings) || compact.strings.length > limits.maxCollectionEntries || compact.strings.some(text => typeof text !== 'string')) fail('has an invalid string table');
  const strings = compact.strings as string[];
  if (!Array.isArray(compact.shapes) || compact.shapes.length > limits.maxCollectionEntries) fail('has no valid shape table');
  const utf8 = new TextEncoder(), textBytes = new Map<string, number>();
  const bytesOfText = (text: string): number => {
    let bytes = textBytes.get(text);
    if (bytes === undefined) { bytes = utf8.encode(JSON.stringify(text)).byteLength; textBytes.set(text, bytes); }
    return bytes;
  };
  let scanned = strings.length;
  let tableBytes = 0;
  for (const text of strings) { tableBytes += bytesOfText(text); if (tableBytes > limits.maxBytes) fail('exceeds the expanded byte limit'); }
  const shapes = (compact.shapes as unknown[]).map(shape => {
    if (!Array.isArray(shape) || shape.length > limits.maxCollectionEntries) fail('has an invalid shape');
    scanned += (shape as unknown[]).length + 1;
    if (scanned > limits.maxValues) fail('has too many encoded values');
    const keys = (shape as unknown[]).map(key => typeof key === 'number' && Number.isSafeInteger(key) && key >= 0 ? strings[key] ?? fail('refers to an unknown string') : typeof key === 'string' ? key : fail('has an invalid key'));
    if (keys.some(key => FORBIDDEN.has(key)) || new Set(keys).size !== keys.length) fail('has an unsafe or repeated key');
    return keys;
  });
  const shapeBytes = shapes.map(keys => keys.reduce((sum, key) => sum + bytesOfText(key) + 1, 0));
  const decodeText = layout === 3 ? (text: string): string => {
    if (!text.startsWith(MARK)) return text;
    if (text.startsWith(`${MARK}${MARK}`)) return text.slice(1);
    const index = text.slice(1);
    if (!/^(0|[1-9a-z][0-9a-z]{0,9})$/.test(index) || strings[parseInt(index, 36)] === undefined) fail('refers to an unknown string');
    return strings[parseInt(index, 36)]!;
  } : (text: string): string => {
    if (!text.startsWith(MARK)) return text;
    if (text.startsWith(`${MARK}s`)) return text.slice(2);
    const index = text.slice(1);
    if (!/^(0|[1-9]\d*)$/.test(index) || !Number.isSafeInteger(Number(index)) || strings[Number(index)] === undefined) fail('refers to an unknown string');
    return strings[Number(index)]!;
  };
  const hasNodes = Object.hasOwn(compact, 'nodes');
  if (layout === 3 && !hasNodes) fail('has no node table');
  const reference_ = layout === 3 ? REFERENCE_3 : REFERENCE;
  /** Where an encoded array's items start: 0 for a plain array, 1 after an escape (or a compact-3 shape), 2 after a compact-2 object marker and shape. */
  const isObject = (items: unknown[]) => layout === 3 ? typeof items[0] === 'number' : items[0] === OBJECT;
  const itemsOffset = (items: unknown[]) => layout === 3 ? (typeof items[0] === 'number' || items[0] === ARRAY_3 ? 1 : 0) : items[0] === OBJECT ? 2 : items[0] === ARRAY ? 1 : 0;
  if (hasNodes && (!Array.isArray(compact.nodes) || compact.nodes.length > limits.maxCollectionEntries)) fail('has an invalid node table');
  const nodes = (hasNodes ? compact.nodes : []) as unknown[][];
  type Size = { values: number; bytes: number; depth: number };
  const sizes: Size[] = [];
  const check = (size: Size): Size => {
    if (size.values > limits.maxValues) fail('has too many expanded values');
    if (size.bytes > limits.maxBytes) fail('exceeds the expanded byte limit');
    if (size.depth > limits.maxDepth) fail('has too many nested objects');
    return size;
  };
  const reference = (items: unknown[], before: number): number => {
    const index = items[1];
    if (items.length !== 2 || !Number.isSafeInteger(index) || (index as number) < 0 || (index as number) >= before) fail('refers to an unknown or forward node');
    return index as number;
  };
  const objectShape = (items: unknown[]): number => {
    const index = layout === 3 ? items[0] : items[1];
    if (!Number.isSafeInteger(index) || (index as number) < 0 || !shapes[index as number] || items.length !== shapes[index as number]!.length + (layout === 3 ? 1 : 2)) fail('refers to an unknown shape');
    return index as number;
  };
  const measure = (item: unknown, before: number, depth: number): Size => {
    if (++scanned > limits.maxValues) fail('has too many encoded values');
    if (depth > limits.maxDepth) fail('has too many nested objects');
    if (typeof item === 'string') return check({ values: 1, bytes: bytesOfText(decodeText(item)), depth: 0 });
    if (item === null || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item)) return check({ values: 1, bytes: JSON.stringify(item).length, depth: 0 });
    if (!Array.isArray(item)) fail('contains an unexpected object or scalar');
    const items = item as unknown[];
    if (hasNodes && items[0] === reference_) return sizes[reference(items, before)]!;
    const object = isObject(items), shape = object ? objectShape(items) : undefined;
    const offset = itemsOffset(items), count = items.length - offset;
    if (count > limits.maxCollectionEntries) fail('has too many collection entries');
    const size: Size = { values: 1, bytes: 2 + Math.max(0, count - 1) + (shape === undefined ? 0 : shapeBytes[shape]!), depth: 0 };
    for (let index = offset; index < items.length; index += 1) {
      const child = measure(items[index], before, depth + 1);
      size.values += child.values; size.bytes += child.bytes; size.depth = Math.max(size.depth, child.depth + 1);
      check(size);
    }
    return check(size);
  };
  for (let index = 0; index < nodes.length; index += 1) {
    if (!Array.isArray(nodes[index]) || nodes[index]![0] === reference_) fail('has an invalid node');
    sizes.push(measure(nodes[index], index, 0));
  }
  check(measure(compact.value, nodes.length, 0));
  const decode = (item: unknown): unknown => {
    if (typeof item === 'string') return decodeText(item);
    if (item === null || typeof item !== 'object') return item;
    if (!Array.isArray(item)) fail('contains an unexpected object');
    const items = item as unknown[];
    if (hasNodes && items[0] === reference_) return decode(nodes[items[1] as number]);
    if (isObject(items)) {
      const offset = itemsOffset(items), shape = shapes[items[offset - 1] as number]!;
      const result: Record<string, unknown> = {};
      for (let position = 0; position < shape.length; position += 1) result[shape[position]!] = decode(items[position + offset]);
      return result;
    }
    return items.slice(itemsOffset(items)).map(decode);
  };
  return () => decode(compact.value);
}
