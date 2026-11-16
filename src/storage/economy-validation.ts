import type { SeasonState } from '../domain/season';
import type { EconomyChangeReason } from '../domain/world';
import { CLUB_ECONOMY_KEYS, computeEconomySeasons, ECONOMY_BANDS, MAX_ECONOMY_AMOUNT } from '../world/economy';
import { worldOf } from '../world/career-world';

function fail(path: string, reason: string): never { throw new Error(`Invalid season save: ${path} ${reason}.`); }
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const isWhole = (value: unknown, min: number, max: number) => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
const ENTRY_KEYS = [...CLUB_ECONOMY_KEYS, 'playerBill', 'target', 'reasons'] as const;
const REASONS: readonly EconomyChangeReason[] = ['promoted', 'relegated', 'joined-euroleague', 'left-euroleague', 'joined-eurocup', 'left-eurocup', 'joined-bcl', 'left-bcl', 'band'];

/**
 * Format 72: the shape of a career's per-season club money (one table for each season after the first, whole-cent
 * figures within the economy's limits). Checked before any replay reads the figures; `validateEconomyHistory` then
 * re-derives them exactly once the history they come from has been validated.
 */
export function validateEconomySeasonsShape(state: Record<string, unknown>, version: number): void {
  if (!Object.hasOwn(state, 'economySeasons')) return;
  if (version < 72) fail('economySeasons', 'requires format 72 or later');
  if (!worldOf(state as unknown as SeasonState).economy) fail('economySeasons', 'requires a world with researched club money');
  const value = state.economySeasons;
  if (!isObject(value) || !exactKeys(value, ['model', 'seasons']) || value.model !== 'economy-seasons-1') fail('economySeasons', 'must use the supported per-season club money model');
  const seasonNumber = state.seasonNumber as number;
  if (!Array.isArray(value.seasons) || value.seasons.length !== seasonNumber - 1) fail('economySeasons.seasons', 'must hold one table for each season after the first');
  for (const [index, table] of value.seasons.entries()) {
    const path = `economySeasons.seasons[${index}]`;
    if (!isObject(table) || !exactKeys(table, ['seasonNumber', 'clubs']) || table.seasonNumber !== index + 2 || !isObject(table.clubs)) fail(path, 'must name its season and hold each club\'s figures');
    for (const [clubId, entry] of Object.entries(table.clubs)) {
      const at = `${path}.clubs.${clubId}`;
      if (!isObject(entry) || !exactKeys(entry, ENTRY_KEYS) || !ECONOMY_BANDS.includes(entry.band as never) || !isWhole(entry.budget, 1, MAX_ECONOMY_AMOUNT) || !isWhole(entry.target, 1, MAX_ECONOMY_AMOUNT)
        || ['sponsorship', 'funding', 'openingCash', 'operatingCost', 'playerBill'].some(key => !isWhole(entry[key], 0, MAX_ECONOMY_AMOUNT)) || !isWhole(entry.ticketPrice, 100, 100_000) || (entry.ticketPrice as number) % 100 !== 0 || !isWhole(entry.scale, 1, 1_000_000)
        || !Array.isArray(entry.reasons) || entry.reasons.some(reason => !REASONS.includes(reason as EconomyChangeReason))) fail(at, 'needs a band, a budget and target, season income and costs, a whole-euro ticket price, a scale, a player wage bill and its reasons');
    }
  }
}

function sameData(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) !== Array.isArray(right)) return false;
  const a = Object.keys(left), b = Object.keys(right);
  return a.length === b.length && a.every(key => Object.hasOwn(right, key) && sameData((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
}

/**
 * Format 72: every season's figures must be exactly those the rules give from the validated history (divisions,
 * European entrants, exchanges with next divisions and each completed season's registrations).
 */
export function validateEconomyHistory(state: SeasonState): void {
  if (!state.economySeasons) return;
  if (!sameData(state.economySeasons.seasons, computeEconomySeasons(state))) fail('economySeasons.seasons', 'must match the club money that follows each season\'s divisions and European places');
}
