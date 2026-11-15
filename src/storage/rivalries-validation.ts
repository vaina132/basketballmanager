import type { SeasonState } from '../domain/season';
import { dateForRound } from '../world/season';
import { roundOrdinal, seasonRounds } from '../world/career-world';
import type { WorldContext } from '../domain/world';
import type { SeasonRivalries } from '../domain/rivalries';
import { computeRivalryTables } from '../world/rivalry-growth';

/** Matchdays as one sequence across seasons, as stored in anchors; it uses the career's season length. */
const ordinal = (year: number, round: number, rounds: number) => roundOrdinal(year, round, rounds);
function fail(path: string, reason: string): never { throw new Error(`Invalid season save: ${path} ${reason}.`); }
function record(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object');
  const fields = value as Record<string, unknown>;
  if (keys.some(key => !Object.hasOwn(fields, key)) || Object.keys(fields).some(key => !keys.includes(key))) fail(path, 'has missing or unsupported fields');
  return fields;
}
function integer(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) fail(path, `must be an integer between ${min} and ${max}`);
  return value;
}

/**
 * Format 35: the anchor must be a calendar boundary actually visited, and derbies count either from a new career's
 * opening matchday or from the matchday after activation. Derby effects themselves are rebuilt by the gate, board
 * and morale replays, which read the same anchor.
 */
export function validateRivalries(value: unknown, state: Pick<SeasonState, 'seasonNumber' | 'round' | 'status' | 'date' | 'market'> & WorldContext, version = 35): void {
  // Format 68: new careers' grown rivalries carry each season's table; older careers keep the fixed model.
  const grown = value !== null && typeof value === 'object' && (value as Record<string, unknown>).model === 'rivalries-2';
  if (grown && version < 68) fail('rivalries.model', 'requires format 68 or later for rivalries grown from results');
  const fields = record(value, 'rivalries', ['model', 'enabledSince', ...(grown ? ['seasons'] : [])]);
  if (fields.model !== 'rivalries-1' && !grown) fail('rivalries.model', 'is unsupported');
  if (grown && (!Array.isArray(fields.seasons) || fields.seasons.length !== state.seasonNumber)) fail('rivalries.seasons', 'must hold one table for each season');
  if (fields.enabledSince === null) return;
  const path = 'rivalries.enabledSince';
  const anchor = record(fields.enabledSince, path, ['seasonNumber', 'round', 'date', 'completedRounds', 'effectiveFrom']);
  const year = integer(anchor.seasonNumber, `${path}.seasonNumber`, 1, state.seasonNumber);
  const round = integer(anchor.round, `${path}.round`, 1, year === state.seasonNumber ? state.round : seasonRounds(state));
  const at = ordinal(year, round, seasonRounds(state)), completedNow = ordinal(state.seasonNumber, state.status === 'complete' ? state.round : state.round - 1, seasonRounds(state));
  const completed = integer(anchor.completedRounds, `${path}.completedRounds`, 0, completedNow);
  if (completed !== at - 1 && !(round === seasonRounds(state) && completed === at)) fail(path, 'must identify an actual pre-match or completed-season boundary');
  const dates = new Set([dateForRound(round, year)]);
  if (completed === at) for (const event of state.market.windows.find(window => window.seasonNumber === year)?.events ?? []) if (event.type === 'advance') dates.add(event.date);
  if (typeof anchor.date !== 'string' || !dates.has(anchor.date) || anchor.date > state.date) fail(`${path}.date`, 'must identify a calendar date actually visited');
  const from = record(anchor.effectiveFrom, `${path}.effectiveFrom`, ['seasonNumber', 'round']);
  const fromAt = ordinal(integer(from.seasonNumber, `${path}.effectiveFrom.seasonNumber`, 1, state.seasonNumber + 1), integer(from.round, `${path}.effectiveFrom.round`, 1, seasonRounds(state)), seasonRounds(state));
  const career = year === 1 && round === 1 && completed === 0 && fromAt === 1;
  if (!career && fromAt !== at + 1) fail(`${path}.effectiveFrom`, 'must start at a new career opening or the matchday after activation');
}

function sameData(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) !== Array.isArray(right)) return false;
  const a = Object.keys(left), b = Object.keys(right);
  return a.length === b.length && a.every(key => Object.hasOwn(right, key) && sameData((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
}

/**
 * Format 68: every season's table must be exactly the one grown from the recorded fixtures, registrations, divisions
 * and manager moves (run after those are validated). The gate, board and morale replays then read the same derbies.
 */
export function validateRivalryGrowth(state: SeasonState): void {
  const rivalries = state.rivalries as SeasonRivalries;
  if (rivalries.model !== 'rivalries-2') return;
  if (!sameData(rivalries.seasons, computeRivalryTables(state))) fail('rivalries.seasons', 'must match the rivalries grown from the recorded results');
}
