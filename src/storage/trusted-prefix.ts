import type { SeasonState } from '../domain/season';
import { roundKey } from '../world/career-world';

/**
 * Incremental checkpoint checks (16 November 2026). A checkpoint the save worker has accepted is a trusted prefix for the
 * next checkpoint of the same career: everything it held that is dated before its own week (its "cut") passed the full
 * career check. When a new state keeps that past exactly (`matchesTrustedPrefix`), the career check skips the checks of
 * those unchanged earlier records and resumes each replay from the point the previous check recorded, instead of
 * replaying the whole career again. Every record of the cut's week and later, and every check of the current state,
 * still runs in full. Anything unexpected, a refusal included, sends the state to the full check, which decides.
 *
 * Only the checkpoint queue's own states take this path (`checkCheckpointState` in `season-storage.ts`); imports, loads
 * of unsealed files and exports keep the full check. Nothing here is ever read from or written to a save.
 */
export interface PrefixCut { seasonNumber: number; round: number }

/** What one accepted check recorded about its state for the next checkpoint. Never mutated once recorded. */
export interface CheckRecord {
  readonly state: SeasonState;
  readonly cut: PrefixCut;
  /** Per journal: how many leading records were dated before the cut, where the replay values were recorded. */
  readonly counts: ReadonlyMap<string, number>;
  /** Replay values (named `journal:key`) at those counts. */
  readonly values: ReadonlyMap<string, unknown>;
}

interface ActiveCheck {
  cut: PrefixCut;
  trusted: CheckRecord | null;
  counts: Map<string, number> | null;
  values: Map<string, unknown> | null;
  skipped: Record<string, number>;
}

let active: ActiveCheck | null = null;
let lastSkipped: Record<string, number> = {};

/** The trusted records the last check skipped, by journal (for tests and measurements). */
export function lastPrefixSkips(): Readonly<Record<string, number>> { return lastSkipped; }

/** The week of a state: records dated in it or later are never trusted. */
export const cutOf = (state: Pick<SeasonState, 'seasonNumber' | 'round'>): PrefixCut => ({ seasonNumber: state.seasonNumber, round: state.round });
const cutKey = (cut: PrefixCut) => roundKey(cut.seasonNumber, cut.round);

/** Leading records dated before the cut (journals are chronological in any state the check accepted). */
function leadingBefore<T>(items: readonly T[], at: (item: T) => number, cut: PrefixCut): number {
  const limit = cutKey(cut);
  let count = 0;
  // Malformed records end the prefix; the validators report them with their own messages.
  while (count < items.length && items[count] !== null && typeof items[count] === 'object' && at(items[count]!) < limit) count += 1;
  return count;
}

/**
 * Run one career check of `state`. With `trusted` (already matched by `matchesTrustedPrefix`), validators may skip the
 * trusted records; with `record`, they remember their replay values for the next checkpoint. Returns what was recorded.
 */
export function withPrefixCheck(state: SeasonState, trusted: CheckRecord | null, record: boolean, run: () => void): CheckRecord | null {
  const previous = active;
  const check: ActiveCheck = { cut: cutOf(state), trusted, counts: record ? new Map() : null, values: record ? new Map() : null, skipped: {} };
  active = check;
  try { run(); }
  finally { active = previous; lastSkipped = check.skipped; }
  return record ? { state, cut: check.cut, counts: check.counts!, values: check.values! } : null;
}

export interface PrefixPlan {
  /** Leading records whose checks the trusted check already passed: skip their checks (0 without trust). */
  skip: number;
  /** The index at which to remember replay values for the next checkpoint (-1 when not recording). */
  record: number;
}

/**
 * The plan for one validator loop over a registered journal. `items` must be the array the loop walks and `at` its records'
 * `roundKey`. A skip is granted only for journals `matchesTrustedPrefix` compared and only when the trusted check recorded
 * the same count, so the skipped records are exactly the trusted state's records dated before its cut.
 */
export function prefixPlan<T>(name: string, items: readonly T[], at: (item: T) => number): PrefixPlan {
  if (!active) return { skip: 0, record: -1 };
  let skip = 0;
  const trusted = active.trusted;
  if (trusted && JOURNALS.has(name)) {
    const count = trusted.counts.get(name);
    if (count !== undefined && count <= items.length && count === leadingBefore(items, at, trusted.cut)) skip = count;
    if (skip) active.skipped[name] = skip;
  }
  let record = -1;
  if (active.counts) { record = leadingBefore(items, at, active.cut); active.counts.set(name, record); }
  return { skip, record };
}

/**
 * The trusted state's cut as a `roundKey`, or -Infinity without trust. A check made at a calendar boundary before it
 * (a registration round, a weekly replay) reads only records dated before it, which the trusted prefix keeps unchanged,
 * and was passed by the trusted check: it may be skipped.
 */
export function trustedCutKey(): number {
  return active?.trusted ? cutKey(active.trusted.cut) : -Infinity;
}

/** Remember a replay value at this journal's record index. Store copies of anything the loop mutates later. */
export function remember(name: string, key: string, value: unknown): void {
  active?.values?.set(`${name}:${key}`, value);
}

/** A replay value the trusted check remembered at the skip index, or undefined. */
export function recall<T>(name: string, key: string): T | undefined {
  return active?.trusted?.values.get(`${name}:${key}`) as T | undefined;
}

/** Whether a value was remembered (a remembered value may itself be undefined or null). */
export function recalled(name: string, key: string): boolean {
  return !!active?.trusted?.values.has(`${name}:${key}`);
}

// ---------------------------------------------------------------------------------------------------------------------
// The trusted prefix: which parts of a new state must equal the trusted state's.

/** Exact structural equality of JSON-like save data, including key order (which iteration order can depend on). */
export function sameJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return Number.isNaN(left) && Number.isNaN(right);
  if (Array.isArray(left)) {
    if (!Array.isArray(right) || left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) if (!sameJson(left[index], right[index])) return false;
    return true;
  }
  if (Array.isArray(right)) return false;
  const a = Object.keys(left), b = Object.keys(right);
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    const key = a[index]!;
    if (key !== b[index] || !sameJson((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key])) return false;
  }
  return true;
}

type Dated = { seasonNumber: number; round: number };
interface Journal {
  items: (state: SeasonState) => readonly unknown[] | undefined;
  at: (item: never) => number;
}
const dated = (item: Dated) => roundKey(item.seasonNumber, item.round);
const dated1 = (item: Dated) => roundKey(item.seasonNumber, item.round + 1);

/**
 * Journals whose earlier records validators may skip. Each must be append-only in a live game for records dated before
 * the current week; records of the current week may still be rewritten (they are never trusted).
 */
const JOURNALS = new Map<string, Journal>([
  ['employment.contracts', { items: state => state.employment?.contracts, at: (item: { signedSeason: number; signedRound: number }) => roundKey(item.signedSeason, item.signedRound) }],
  ['negotiations.records', { items: state => state.negotiations?.records, at: dated }],
  ['recruitment.events', { items: state => state.recruitment?.events, at: dated }],
  ['facilities.events', { items: state => state.facilities?.events, at: dated }],
  ['relationships.events', { items: state => state.relationships?.events, at: dated }],
  ['finance.ledger', { items: state => state.finance?.ledger, at: dated }],
  // A season's recruitment window follows its final matchday: dated after every matchday of that season.
  ['market.windows', { items: state => state.market?.windows, at: (window: { seasonNumber: number }) => roundKey(window.seasonNumber, 99) }],
  // A board review follows its matchday's results, and the latest one is still rewritten (format 73).
  ['board.reviews', { items: state => state.board?.reviews, at: dated1 }],
  // A week's report is written at the next week's start, and the latest one is still rewritten (format 73 summaries).
  ['academy.weeks', { items: state => state.academy?.weeks, at: (week: { seasonNumber: number; afterRound: number }) => roundKey(week.seasonNumber, week.afterRound + 1) }],
]);

/** Top-level parts that cannot change during a season (season-end exchanges, money and archives change at the rollover). */
const SEASON_CONSTANTS = ['schemaVersion', 'engineVersion', 'dataPackId', 'seed', 'world', 'manager', 'injuryMode', 'history', 'divisions', 'europe', 'background', 'economySeasons'] as const;

/**
 * Whether `state` keeps the trusted state's past exactly: the same career and season, time moving forward, the season's
 * constants equal, and in every registered journal the trusted records dated before its cut unchanged and all other
 * records dated at or after the cut (nothing back-dated). Current-season games of earlier weeks must be unchanged too.
 */
export function matchesTrustedPrefix(trusted: CheckRecord, state: SeasonState): boolean {
  return trustedPrefixMismatch(trusted, state) === null;
}

/** Why `state` does not keep the trusted state's past (`matchesTrustedPrefix`), or null when it does. */
export function trustedPrefixMismatch(trusted: CheckRecord, state: SeasonState): string | null {
  const before = trusted.state, cut = trusted.cut, limit = cutKey(cut);
  if (!state || typeof state !== 'object' || state.seasonNumber !== before.seasonNumber || typeof state.round !== 'number' || state.round < before.round) return 'season or matchday';
  if (typeof state.date !== 'string' || state.date < before.date || state.round === before.round && before.status === 'complete' && state.status !== 'complete') return 'calendar';
  for (const key of SEASON_CONSTANTS) if (Object.hasOwn(before, key) !== Object.hasOwn(state, key) || !sameJson(before[key], state[key])) return key;
  if (!sameJson((before.finance as { archives?: unknown })?.archives, (state.finance as { archives?: unknown })?.archives)) return 'finance.archives';
  for (const [name, journal] of JOURNALS) {
    const old = journal.items(before), next = journal.items(state);
    if (!Array.isArray(old) || !Array.isArray(next)) return name;
    const at = journal.at as (item: unknown) => number;
    const count = leadingBefore(old, at, cut);
    if (next.length < count) return name;
    for (let index = 0; index < count; index += 1) if (!sameJson(old[index], next[index])) return `${name}[${index}]`;
    for (let index = count; index < next.length; index += 1) if (next[index] !== null && typeof next[index] === 'object' && at(next[index]) < limit) return `${name}[${index}] back-dated`;
  }
  if (!Array.isArray(state.fixtures) || state.fixtures.length !== before.fixtures.length) return 'fixtures';
  for (let index = 0; index < before.fixtures.length; index += 1) {
    const fixture = before.fixtures[index]!;
    if (fixture.round < cut.round && !sameJson(fixture, state.fixtures[index])) return `fixtures[${index}]`;
  }
  return null;
}
