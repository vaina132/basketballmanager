import type { SeasonState } from '../domain/season';
import { dateForRound } from '../world/season';
import { roundOrdinal, seasonRounds } from '../world/career-world';
import type { WorldContext } from '../domain/world';

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
export function validateRivalries(value: unknown, state: Pick<SeasonState, 'seasonNumber' | 'round' | 'status' | 'date' | 'market'> & WorldContext): void {
  const fields = record(value, 'rivalries', ['model', 'enabledSince']);
  if (fields.model !== 'rivalries-1') fail('rivalries.model', 'is unsupported');
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
