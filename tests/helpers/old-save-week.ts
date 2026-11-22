import { expect } from 'vitest';
import type { SeasonState } from '../../src/domain/season';
import { setAutoSubstitutions, simulateToEnd } from '../../src/engine/match';
import { parseSeason, serializeSeason } from '../../src/storage/season-storage';
import { financeLedgerCount, financeLedgerSlice } from '../../src/world/finance-ledger';
import { advanceSeason, managedSide } from '../../src/world/season';
import { isAcademyOutcome, summarizeAcademyHistory, summarizeAcademyPlayer } from '../../src/world/academy-history';
import { sealCompletedHistory, withoutCountedGames } from '../../src/world/sealed-history';
import type { AcademyWeek } from '../../src/domain/academy';
import type { BoardReview } from '../../src/domain/board';
import type { RelationshipEvent } from '../../src/domain/relationships';

/**
 * Old-save continuation checks that hold under intended rule changes (development mode, sprint 4 onwards).
 *
 * Match calibration and realistic injuries changed the simulated results after an old save, so a week played from
 * a captured file no longer equals the independently captured next week. These checks keep what must still hold:
 * the week passes the full strict save check, the career keeps the rules it was recorded with, every event recorded
 * before the save is unchanged, time moves forward by exactly one week, and the week follows the captured calendar.
 */

/**
 * Some baselines (formats 45-49) recorded the next week as the bare state their runtime produced. Read it through the
 * plain envelope that runtime wrote, so it is migrated and strictly checked like any other file of its format.
 */
export const parseCapturedState = (raw: { schemaVersion: number }): SeasonState => parseSeason(JSON.stringify({ format: 'basketball-manager-season', formatVersion: raw.schemaVersion, engineVersion: 'possession-3', state: raw }));

/** Play the prepared senior match (if any) with automatic substitutions and close the week. */
export const playWeek = (state: SeasonState): SeasonState => advanceSeason(state.activeMatch ? { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) } : state);

const RULE_KEY = /^(model|engineVersion|injuryMode|schemaVersion|dataPackId|seed)$|Model$|Since$|Rule$/;

/**
 * The rules a career was recorded with, by path: every system's model, every activation boundary (`enabledSince`,
 * `fundingSince` and the like), the engine, injury mode, data pack and seed. Arrays and the prepared match are
 * not searched; the career's world is compared whole by `expectValidOldSaveWeek`.
 */
export function careerRules(state: SeasonState): Record<string, unknown> {
  const rules: Record<string, unknown> = {};
  const walk = (value: object, path: string) => {
    for (const [key, child] of Object.entries(value)) {
      const at = path ? `${path}.${key}` : key;
      if (RULE_KEY.test(key)) rules[at] = child;
      else if (child && typeof child === 'object' && !Array.isArray(child) && at !== 'activeMatch' && at !== 'world') walk(child, at);
    }
  };
  walk(state, '');
  return rules;
}

/**
 * Records that are never rewritten once made (registrations, contracts, wage agreements, transfers, reports, reviews,
 * diagnoses and journals). `*` stands for every club. Each must keep its recorded entries, in order, at its start.
 */
const HISTORY = [
  'rosters', 'restWeeks', 'injuries', 'payroll.agreements', 'employment.contracts', 'employment.transfers', 'employment.buyouts',
  'recruitment.events', 'negotiations.records', 'scouting.clubs.*.reviews', 'physio.rehabilitation', 'academy.intakes', 'academy.weeks',
  'academy.graduates', 'lifecycle.reviews', 'lifecycle.notices', 'facilities.events', 'relationships.events', 'board.reviews',
  'career.moves', 'commercial.events',
] as const;

/**
 * Format 73 (step 3.7, save size) lightens three kinds of record every week: an earlier academy report of a club keeps
 * only its outcome, only the latest board review lists each club's counted games, and only the latest morale snapshot
 * keeps its values. These records are compared in their lightened form; everything else they hold must be unchanged.
 */
const LIGHTENED: Partial<Record<(typeof HISTORY)[number], (items: unknown[]) => unknown[]>> = {
  'academy.weeks': weeks => (weeks as AcademyWeek[]).map(week => ({ ...week, players: Object.fromEntries(Object.entries(week.players).map(([id, player]) => [id, isAcademyOutcome(player) ? player : summarizeAcademyPlayer(player)])) })),
  'board.reviews': reviews => withoutCountedGames(reviews as BoardReview[]),
  'relationships.events': events => (events as RelationshipEvent[]).map(event => event.type === 'prepare' ? { ...event, rosterIds: {}, values: {} } : event),
};

/**
 * A state captured before format 73, in the lighter form format 73 keeps for every career (step 3.7, save size): rival
 * academy reports that are no longer a club's latest keep their outcome, completed seasons are sealed, and only the
 * latest board review and morale snapshot keep their counted games and values (`sealCompletedHistory`). Migration,
 * every week and every rollover apply these projections to old careers too, so exact comparisons with a state captured
 * by an earlier runtime compare it in this form; every other field must still match exactly.
 */
export const withFormat73Records = <T extends SeasonState>(state: T): T => sealCompletedHistory(summarizeAcademyHistory(state)) as T;

function arraysAt(state: unknown, path: string): [string, unknown[] | undefined][] {
  let found: [string, unknown][] = [['', state]];
  for (const part of path.split('.')) {
    found = found.flatMap(([at, value]) => {
      if (!value || typeof value !== 'object') return [];
      const record = value as Record<string, unknown>;
      return part === '*' ? Object.keys(record).map(key => [`${at}.${key}`, record[key]] as [string, unknown]) : [[at ? `${at}.${part}` : part, record[part]] as [string, unknown]];
    });
  }
  return found.map(([at, value]) => [at, Array.isArray(value) ? value : undefined]);
}

const schedule = (fixture: SeasonState['fixtures'][number]) => ({ ...fixture, result: null });
const addWeek = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);

/** Every event recorded in `before` is unchanged in `after`: past seasons, played games, the ledger and every history list. */
export function expectPastKept(before: SeasonState, after: SeasonState): void {
  expect(after.history, 'past seasons').toEqual(before.history);
  if (before.world) expect(after.world, 'the career world').toEqual(before.world);
  const fixtures = new Map(after.fixtures.map(fixture => [fixture.id, fixture]));
  for (const fixture of before.fixtures) {
    const kept = fixtures.get(fixture.id);
    expect(kept, `fixture ${fixture.id}`).toBeDefined();
    // Played games keep their results and statistics; games still to play keep their date, venue and pairing.
    if (fixture.result) expect(kept, `played fixture ${fixture.id}`).toEqual(fixture);
    else expect(schedule(kept!), `scheduled fixture ${fixture.id}`).toEqual(fixture);
  }
  const count = financeLedgerCount(before.finance);
  expect(financeLedgerCount(after.finance)).toBeGreaterThanOrEqual(count);
  expect(financeLedgerSlice(after.finance, 0, count), 'ledger receipts').toEqual(financeLedgerSlice(before.finance));
  for (const path of HISTORY) {
    const later = new Map(arraysAt(after, path));
    for (const [at, recorded] of arraysAt(before, path)) {
      if (!recorded) continue;
      const kept = later.get(at);
      expect(kept, at).toBeDefined();
      const lighten = LIGHTENED[path] ?? (items => items);
      expect(lighten(kept!.slice(0, recorded.length)), at).toEqual(lighten(recorded));
    }
  }
  const youth = new Map(after.youthCompetition.seasons.flatMap(season => season.fixtures).map(fixture => [fixture.id, fixture]));
  for (const season of before.youthCompetition.seasons) for (const fixture of season.fixtures) {
    expect(youth.has(fixture.id), `youth fixture ${fixture.id}`).toBe(true);
    if (fixture.result) expect(youth.get(fixture.id), `played youth fixture ${fixture.id}`).toEqual(fixture);
  }
}

/**
 * A week continued from an old save (`before`, already migrated) to `next`. With the independently captured next
 * week (`recorded`, migrated the same way), the week must also reach the same date, keep the same rules and
 * fields, play the same games and prepare the same next game; only the simulated outcomes may differ.
 */
export function expectValidOldSaveWeek(before: SeasonState, next: SeasonState, recorded?: SeasonState): void {
  // The full strict save check: writing validates the whole career and reading replays it.
  expect(parseSeason(serializeSeason(next))).toEqual(next);
  // Exactly one week later, in the same season.
  expect([next.seasonNumber, next.round, next.date]).toEqual([before.seasonNumber, before.round + 1, addWeek(before.date)]);
  // The old career keeps its rules, club, manager and world.
  expect(careerRules(next)).toEqual(careerRules(before));
  expect([next.managedClubId, next.manager]).toEqual([before.managedClubId, before.manager]);
  if (before.divisions) expect(next.divisions).toEqual(before.divisions);
  if (before.europe) expect(next.europe).toEqual(before.europe);
  expectPastKept(before, next);
  if (!recorded) return;
  expect([next.seasonNumber, next.round, next.date, next.status]).toEqual([recorded.seasonNumber, recorded.round, recorded.date, recorded.status]);
  expect(Object.keys(next).sort()).toEqual(Object.keys(recorded).sort());
  expect(careerRules(next)).toEqual(careerRules(recorded));
  // The same games were played this week and the same game is prepared next; regular-season pairings are unchanged.
  const played = (state: SeasonState) => state.fixtures.filter(fixture => fixture.result).map(fixture => fixture.id).sort();
  expect(played(next)).toEqual(played(recorded));
  expect(next.activeFixtureId).toBe(recorded.activeFixtureId);
  const regular = (state: SeasonState) => state.fixtures.filter(fixture => !fixture.stage).map(schedule);
  expect(regular(next)).toEqual(regular(recorded));
}
