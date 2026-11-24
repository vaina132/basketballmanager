import { deflateRaw, fromBase64, inflateRaw, toBase64 } from './deflate';
import { MAX_SEASON_SAVE_BYTES } from './season-limits';

/**
 * Save growth (owner decision, 24 November 2026): the game's own saves store their compact-3 text compressed. A
 * ten-season career's compact text had grown to 12-17 MB (1-2 MiB a season), close to the 32 MB save limit in large
 * worlds; DEFLATE stores it about five times smaller, so a stored save grows by about 0.3-0.45 MB a season.
 *
 * The envelope keeps its readable header and carries the compact-3 envelope text as DEFLATE in base64:
 * `{ format, formatVersion, engineVersion, encoding: 'compact-3-deflate', bytes, data }`, where `bytes` is the UTF-8
 * length of the compact-3 text. Decompression is lossless: the inner text is exactly what `compact-3` saves contain, it
 * must name the same format and the compact-3 encoding, and it passes every check a compact-3 save passes.
 * Saves of formats 73 and later may use it (the compact-3 formats); older formats keep their own encodings.
 */
export const COMPRESSED_SAVE_ENCODING = 'compact-3-deflate';
/** The compact text inside may exceed the stored-file limit (that is the point), within a bound on decoding work. */
export const MAX_COMPACT_SAVE_TEXT_BYTES = MAX_SEASON_SAVE_BYTES * 4;
export const COMPRESSED_ENVELOPE_KEYS = ['format', 'formatVersion', 'engineVersion', 'encoding', 'bytes', 'data'] as const;

function fail(reason: string): never { throw new Error(`Invalid season save: ${reason}.`); }

/** Wrap a compact-3 envelope text; the header fields are copied from it. */
export function compressSaveText(header: { format: string; formatVersion: number; engineVersion: string }, compactText: string): string {
  const bytes = new TextEncoder().encode(compactText);
  if (bytes.byteLength > MAX_COMPACT_SAVE_TEXT_BYTES) throw new Error('The season file is too large. This career has reached the supported save size.');
  return JSON.stringify({ format: header.format, formatVersion: header.formatVersion, engineVersion: header.engineVersion, encoding: COMPRESSED_SAVE_ENCODING, bytes: bytes.byteLength, data: toBase64(deflateRaw(bytes)) });
}

/** The compact-3 envelope text inside a compressed envelope (its keys already checked by the caller). */
export function decompressSaveText(envelope: Record<string, unknown>): string {
  const { bytes, data } = envelope;
  if (!Number.isSafeInteger(bytes) || (bytes as number) < 0 || (bytes as number) > MAX_COMPACT_SAVE_TEXT_BYTES) fail('the compressed data has an invalid size');
  if (typeof data !== 'string') fail('the compressed data is missing');
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(inflateRaw(fromBase64(data), bytes as number)); }
  catch (error) { fail(error instanceof Error ? error.message.replace(/\.$/, '') : 'the compressed data is damaged'); }
  return text;
}

/** The compact-3 envelope a compressed save text carries, as parsed JSON (tools and tests; no save checks). */
export function compactSaveEnvelope(text: string): Record<string, unknown> {
  const envelope = JSON.parse(text) as Record<string, unknown>;
  return envelope.encoding === COMPRESSED_SAVE_ENCODING ? JSON.parse(decompressSaveText(envelope)) as Record<string, unknown> : envelope;
}
