import type { SeasonState } from '../domain/season';
import { roundKey } from '../world/career-world';
import { dateForRound } from '../world/season';

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
  /** Node counts of the parts `knownTrees` walked or recalled in this check. */
  trees?: Map<object, number>;
}

let active: ActiveCheck | null = null;
let lastSkipped: Record<string, number> = {};

/** The trusted records the last check skipped, by journal (for tests and measurements). */
export function lastPrefixSkips(): Readonly<Record<string, number>> { return lastSkipped; }

/** The week of a state: records dated in it or later are never trusted. */
export const cutOf = (state: Pick<SeasonState, 'seasonNumber' | 'round'>): PrefixCut => ({ seasonNumber: state.seasonNumber, round: state.round });
const cutKey = (cut: PrefixCut) => roundKey(cut.seasonNumber, cut.round);

/**
 * A record's calendar position: a `roundKey` (its week) or an ISO date (the day of its game). Records before the cut's
 * week are trusted; weeks run from their Saturday (`state.date`) to the next Friday.
 */
type Position = number | string;
const beforeCut = (cut: PrefixCut) => {
  const limit = cutKey(cut), day = dateForRound(cut.round, cut.seasonNumber);
  return (position: Position) => typeof position === 'number' ? position < limit : typeof position === 'string' && position < day;
};

/** Leading records dated before the cut (journals are chronological in any state the check accepted). */
function leadingBefore<T>(items: readonly T[], at: (item: T) => Position, cut: PrefixCut): number {
  const before = beforeCut(cut);
  let count = 0;
  // Malformed records end the prefix; the validators report them with their own messages.
  while (count < items.length && items[count] !== null && typeof items[count] === 'object' && before(at(items[count]!))) count += 1;
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
 * The plan for one validator loop over a registered journal: `items` must be the array the loop walks. Records are dated
 * by the journal's registered position (never the caller's), so a skip is granted only for records `matchesTrustedPrefix`
 * compared, and only when the trusted check recorded the same count: the skipped records are exactly the trusted state's
 * records dated before its cut.
 */
export function prefixPlan<T>(name: string, items: readonly T[], _at?: (item: T) => number): PrefixPlan {
  const journal = journalFor(name);
  if (!active || !journal) return { skip: 0, record: -1 };
  const at = journal.at as (item: T) => Position;
  let skip = 0;
  const trusted = active.trusted;
  if (trusted) {
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

/** Top-level parts the trusted prefix compares whole (`SEASON_CONSTANTS`), whose JSON tree checks carry over. */
const TREE_PARTS = ['world', 'history'] as const;

/**
 * The node counts of a state's whole-compared parts for its JSON tree check (`checkJsonTree` in `season-storage.ts`),
 * which then adds each count instead of walking that part again. In an incremental check the parts equal the trusted
 * state's exactly (plain data of the same shape at the same depth), so its walk's count and verdict carry over; otherwise
 * `walk` checks each part once (at depth 1) and the count is remembered for the next checkpoint. Undefined outside a
 * checkpoint check.
 */
export function knownTrees(root: unknown, walk: (part: object, depth: number) => number): ReadonlyMap<object, number> | undefined {
  if (!active || root === null || typeof root !== 'object') return undefined;
  const trees = active.trees ??= new Map();
  const known = new Map<object, number>();
  for (const key of TREE_PARTS) {
    const part = (root as Record<string, unknown>)[key];
    if (part === null || typeof part !== 'object') continue;
    let nodes = trees.get(part);
    if (nodes === undefined) nodes = active.trusted?.values.get(`tree:${key}`) as number | undefined;
    if (nodes === undefined) nodes = walk(part, 1);
    trees.set(part, nodes);
    active.values?.set(`tree:${key}`, nodes);
    known.set(part, nodes);
  }
  return known;
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

/**
 * Exact structural equality of JSON-like save data, including key order (which iteration order can depend on) and
 * prototypes (so a part equal to plain trusted data is plain data too).
 */
export function sameJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return Number.isNaN(left) && Number.isNaN(right);
  if (Object.getPrototypeOf(left) !== Object.getPrototypeOf(right)) return false;
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
  /** The record's calendar position: records before the cut's week are trusted. */
  at: (item: never) => Position;
  /** Equality of a trusted record (default: exact). */
  same?: (left: never, right: never, cut: PrefixCut) => boolean;
}
const dated = (item: Dated) => roundKey(item.seasonNumber, item.round);
const dated1 = (item: Dated) => roundKey(item.seasonNumber, item.round + 1);
/** Offseason records (a season's recruitment window follows its final matchday): after every matchday of that season. */
const OFFSEASON = 99;
/** A career point (moves, fresh starts): its week during the season, after every matchday at its end or offseason. */
const careerPoint = (item: { seasonNumber: number; round?: number; phase?: string }) => roundKey(item.seasonNumber, item.phase === 'season' && typeof item.round === 'number' ? item.round : OFFSEASON);

/**
 * Journals that must keep their records dated before the cut, and validators may skip (those named in `prefixPlan`
 * calls). Each must be append-only in a live game for records dated before the current week; records of the current
 * week may still be rewritten (they are never trusted).
 */
const JOURNALS = new Map<string, Journal>([
  ['employment.contracts', { items: state => state.employment?.contracts, at: (item: { signedSeason: number; signedRound: number }) => roundKey(item.signedSeason, item.signedRound) }],
  // A transfer's in-season arrival week, or its offseason window; later installments are added to its payments.
  ['employment.transfers', { items: state => state.employment?.transfers, at: (item: { seasonNumber: number; startsRound: number }) => roundKey(item.seasonNumber, item.startsRound > 1 ? item.startsRound : OFFSEASON), same: sameTransfer }],
  ['employment.buyouts', { items: state => state.employment?.buyouts, at: (item: { seasonNumber: number }) => roundKey(item.seasonNumber, OFFSEASON) }],
  ['negotiations.records', { items: state => state.negotiations?.records, at: dated }],
  ['recruitment.events', { items: state => state.recruitment?.events, at: dated }],
  ['facilities.events', { items: state => state.facilities?.events, at: dated }],
  ['relationships.events', { items: state => state.relationships?.events, at: dated }],
  ['finance.ledger', { items: state => state.finance?.ledger, at: dated }],
  ['market.windows', { items: state => state.market?.windows, at: (window: { seasonNumber: number }) => roundKey(window.seasonNumber, OFFSEASON) }],
  ['commercial.events', { items: state => state.commercial?.events, at: dated }],
  // A board review follows its matchday's results, and the latest one is still rewritten (format 73).
  ['board.reviews', { items: state => state.board?.reviews, at: dated1 }],
  ['board.restarts', { items: state => state.board?.restarts ?? [], at: careerPoint }],
  ['career.moves', { items: state => state.career?.moves ?? [], at: careerPoint }],
  // A week's report is written at the next week's start, and the latest one is still rewritten (format 73 summaries).
  ['academy.weeks', { items: state => state.academy?.weeks, at: (week: { seasonNumber: number; afterRound: number }) => roundKey(week.seasonNumber, week.afterRound + 1) }],
  // Treatment of a week is recorded at the next week's start.
  ['physio.rehabilitation', { items: state => state.physio?.rehabilitation ?? [], at: (item: { seasonNumber: number; afterRound: number }) => roundKey(item.seasonNumber, item.afterRound + 1) }],
  // Injuries are dated by their game's day.
  ['injuries', { items: state => state.injuries, at: (item: { occurredOn: string }) => item.occurredOn }],
]);

/** Each observing club's scouting reports (`scouting.reviews:<club id>`), compared office by office. */
export const SCOUTING_REVIEWS = 'scouting.reviews:';
const SCOUTING_JOURNAL: Journal = { items: () => undefined, at: dated };
const journalFor = (name: string): Journal | undefined => JOURNALS.get(name) ?? (name.startsWith(SCOUTING_REVIEWS) ? SCOUTING_JOURNAL : undefined);

/** A trusted transfer keeps every term and its installments paid before the cut; later installments are new records. */
function sameTransfer(left: Record<string, unknown>, right: Record<string, unknown>, cut: PrefixCut): boolean {
  const a = Object.keys(left), b = Object.keys(right);
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    const key = a[index]!;
    if (key !== b[index]) return false;
    if (key !== 'payments') { if (!sameJson(left[key], right[key])) return false; continue; }
    const old = left.payments, next = right.payments;
    if (!Array.isArray(old) || !Array.isArray(next)) return false;
    const count = leadingBefore(old, dated, cut);
    if (count !== old.length || next.length < count) return false;
    for (let item = 0; item < count; item += 1) if (!sameJson(old[item], next[item])) return false;
    for (let item = count; item < next.length; item += 1) if (next[item] === null || typeof next[item] !== 'object' || dated(next[item] as Dated) < cutKey(cut)) return false;
  }
  return true;
}

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
  const before = trusted.state, cut = trusted.cut, limit = cutKey(cut), trustedBefore = beforeCut(cut);
  if (!state || typeof state !== 'object' || state.seasonNumber !== before.seasonNumber || typeof state.round !== 'number' || state.round < before.round) return 'season or matchday';
  if (typeof state.date !== 'string' || state.date < before.date || state.round === before.round && before.status === 'complete' && state.status !== 'complete') return 'calendar';
  for (const key of SEASON_CONSTANTS) if (Object.hasOwn(before, key) !== Object.hasOwn(state, key) || !sameJson(before[key], state[key])) return key;
  if (!sameJson((before.finance as { archives?: unknown })?.archives, (state.finance as { archives?: unknown })?.archives)) return 'finance.archives';
  for (const [name, journal] of JOURNALS) {
    const old = journal.items(before), next = journal.items(state);
    if (!Array.isArray(old) || !Array.isArray(next)) return name;
    const at = journal.at as (item: unknown) => Position, same = (journal.same ?? sameJson) as (left: unknown, right: unknown, cut: PrefixCut) => boolean;
    const count = leadingBefore(old, at, cut);
    if (next.length < count) return name;
    for (let index = 0; index < count; index += 1) if (!same(old[index], next[index], cut)) return `${name}[${index}]`;
    for (let index = count; index < next.length; index += 1) if (next[index] !== null && typeof next[index] === 'object' && trustedBefore(at(next[index]))) return `${name}[${index}] back-dated`;
  }
  // Each scouting office's reports, by observing club (the season's full-world clubs keep their offices all season).
  const offices = (before.scouting as { clubs?: Record<string, { reviews?: unknown }> } | undefined)?.clubs ?? {}, nextOffices = (state.scouting as { clubs?: Record<string, { reviews?: unknown }> } | undefined)?.clubs;
  for (const clubId of Object.keys(offices)) {
    const old = offices[clubId]?.reviews, next = nextOffices?.[clubId]?.reviews, name = `${SCOUTING_REVIEWS}${clubId}`;
    if (!Array.isArray(old) || !Array.isArray(next)) return name;
    const count = leadingBefore(old, dated as (item: unknown) => Position, cut);
    if (next.length < count) return name;
    for (let index = 0; index < count; index += 1) if (!sameJson(old[index], next[index])) return `${name}[${index}]`;
    for (let index = count; index < next.length; index += 1) if (next[index] !== null && typeof next[index] === 'object' && dated(next[index] as Dated) < limit) return `${name}[${index}] back-dated`;
  }
  // Games of earlier weeks are unchanged. Postseason and knockout games are added as results make them due, in calendar
  // order, so they are matched by identity; an added game must belong to the cut's week or later.
  if (!Array.isArray(state.fixtures)) return 'fixtures';
  const games = new Map<unknown, unknown>();
  for (const fixture of state.fixtures) if (fixture !== null && typeof fixture === 'object') games.set(fixture.id, fixture);
  const known = new Set<string>();
  for (const fixture of before.fixtures) {
    known.add(fixture.id);
    if (fixture.round < cut.round && !sameJson(fixture, games.get(fixture.id))) return `fixtures.${fixture.id}`;
  }
  for (const fixture of state.fixtures) if (fixture !== null && typeof fixture === 'object' && !known.has(fixture.id) && !(fixture.round >= cut.round)) return `fixtures.${fixture.id} back-dated`;
  return null;
}
