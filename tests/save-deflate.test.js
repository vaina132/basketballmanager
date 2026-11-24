import { deflateRawSync, inflateRawSync, constants } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { deflateRaw, fromBase64, inflateRaw, toBase64 } from '../src/storage/deflate';

function random(seed) { let value = seed >>> 0; return () => { value = (value * 1664525 + 1013904223) >>> 0; return value / 2 ** 32; }; }

const encoder = new TextEncoder();
const samples = [
  ['empty', new Uint8Array(0)],
  ['one byte', new Uint8Array([65])],
  ['two symbols', encoder.encode('abababababababababababab')],
  ['a long run', new Uint8Array(100_000).fill(7)],
  ['compact-like text', encoder.encode(Array.from({ length: 4000 }, (_, index) => `["§1a${index % 37}",${index % 44},"operations",-${(index * 7919) % 2_000_000},0]`).join(','))],
  ['random bytes', (() => { const next = random(3), bytes = new Uint8Array(70_000); for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(next() * 256); return bytes; })()],
  ['skewed bytes', (() => { const next = random(5), bytes = new Uint8Array(200_000); for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(next() ** 6 * 256); return bytes; })()],
  ['multi-byte text', encoder.encode('Dončić Šarūnas Jokić Ñ ü ğ ş ı İ '.repeat(3000))],
];

describe('save compression (raw DEFLATE)', () => {
  it.each(samples)('round-trips %s and stays readable by zlib', (_name, bytes) => {
    const packed = deflateRaw(bytes);
    expect(inflateRaw(packed, bytes.length)).toEqual(bytes);
    expect(new Uint8Array(inflateRawSync(packed))).toEqual(bytes);
  });

  it.each(samples)('reads what zlib writes (%s), stored, fixed and dynamic blocks', (_name, bytes) => {
    for (const options of [{ level: 0 }, { level: 1, strategy: constants.Z_FIXED }, { level: 9 }, { level: 6, windowBits: 9 }]) {
      const packed = new Uint8Array(deflateRawSync(bytes, options));
      expect(inflateRaw(packed, bytes.length)).toEqual(bytes);
    }
  });

  it('compresses repetitive save text several-fold', () => {
    const bytes = samples[4][1];
    expect(deflateRaw(bytes).length).toBeLessThan(bytes.length / 4);
  });

  it('refuses damaged or oversized streams instead of guessing', () => {
    const bytes = samples[4][1], packed = deflateRaw(bytes);
    expect(() => inflateRaw(packed, bytes.length - 1)).toThrow(/recorded size/);
    expect(() => inflateRaw(packed, bytes.length + 1)).toThrow(/recorded size|ends early/);
    expect(() => inflateRaw(packed.subarray(0, packed.length >> 1), bytes.length)).toThrow();
    expect(() => inflateRaw(new Uint8Array([0xff, 0xff, 0xff]), 10)).toThrow();
    // A stored block whose length check does not match.
    expect(() => inflateRaw(new Uint8Array([1, 5, 0, 0, 0, 1, 2, 3, 4, 5]), 5)).toThrow(/stored block/);
    // A distance before the start.
    const far = new Uint8Array(deflateRawSync(Buffer.from('abcabcabc')));
    expect(() => inflateRaw(far, 3)).toThrow();
  });

  it('writes and reads base64 exactly and refuses other text', () => {
    for (const bytes of samples.map(([, value]) => value)) {
      const text = toBase64(bytes);
      expect(text).toBe(Buffer.from(bytes).toString('base64'));
      expect(fromBase64(text)).toEqual(bytes);
    }
    expect(() => fromBase64('abc')).toThrow(/base64/);
    expect(() => fromBase64('ab$c')).toThrow(/base64/);
    expect(() => fromBase64('a=bc')).toThrow(/base64/);
  });
});
