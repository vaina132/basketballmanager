import type { MatchState } from '../domain/types';
import { readLocalMatch, writeLocalMatch } from './indexed-db';
import { validateMatchState } from './validate-match';

export const MAX_SAVE_BYTES = 5 * 1024 * 1024;
const FORMAT = 'basketball-manager-exhibition';
const FORMAT_VERSION = 2;
const ENGINE_VERSION = 'rules-2';
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function checkSize(text: string): void {
  if (text.length > MAX_SAVE_BYTES || new TextEncoder().encode(text).byteLength > MAX_SAVE_BYTES) {
    throw new Error('The match file is too large. The exhibition save limit is 5 MB.');
  }
}

/** Reject dangerous keys and pathological structures before domain validation. */
function checkJsonTree(root: unknown): void {
  const pending: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }];
  let inspected = 0;
  while (pending.length > 0) {
    const { value, depth } = pending.pop()!;
    // Court scenes repeat ten actor positions per action; allow long overtime
    // histories while retaining independent byte, depth and collection limits.
    if (++inspected > 500_000 || depth > 40) {
      throw new Error('The match file has too many values or nested objects.');
    }
    if (value === null || typeof value !== 'object') continue;
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      throw new Error('The match must contain plain save data.');
    }
    const entries = Object.entries(value);
    if (entries.length > 20_000) throw new Error('The match file contains an oversized collection.');
    for (const [key, child] of entries) {
      if (FORBIDDEN_KEYS.has(key)) throw new Error('The match file contains an unsafe property.');
      pending.push({ value: child, depth: depth + 1 });
    }
  }
}

export function serializeMatch(state: MatchState): string {
  checkJsonTree(state);
  validateMatchState(state);
  const text = JSON.stringify({
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    engineVersion: ENGINE_VERSION,
    state,
  });
  checkSize(text);
  return text;
}

/** Fully validates before returning a replacement; never mutates an active match. */
export function parseMatch(text: string): MatchState {
  checkSize(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('This is not a valid JSON match file.');
  }
  checkJsonTree(parsed);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('This is not a basketball exhibition save.');
  }
  const envelope = parsed as Record<string, unknown>;
  const expected = ['format', 'formatVersion', 'engineVersion', 'state'];
  if (Object.keys(envelope).length !== expected.length || !expected.every((key) => Object.hasOwn(envelope, key))) {
    throw new Error('The match file envelope is incomplete or contains unsupported fields.');
  }
  if (envelope.format === FORMAT && (envelope.formatVersion === 1 || envelope.engineVersion === 'prototype-1')) {
    throw new Error('This exhibition was saved with the earlier prototype engine. Keep it as a backup and start a new exhibition with the current rules engine. Your stored save has not been changed.');
  }
  if (envelope.format !== FORMAT || envelope.formatVersion !== FORMAT_VERSION || envelope.engineVersion !== ENGINE_VERSION) {
    throw new Error('This match file uses an unsupported save format or engine version.');
  }
  validateMatchState(envelope.state);
  return envelope.state;
}

export async function saveLocalMatch(state: MatchState): Promise<void> {
  await writeLocalMatch(serializeMatch(state));
}

export async function loadLocalMatch(): Promise<MatchState | null> {
  const text = await readLocalMatch();
  return text === null ? null : parseMatch(text);
}
