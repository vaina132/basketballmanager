/**
 * Rules per competition (NBA step 3, 23 November 2026). A match records `ruleset` only when one is chosen; a match
 * without it plays the FIBA rules exactly as before (`rulesOf` returns `FIBA_2024`), so every earlier match replays bit
 * for bit (tests/match-ruleset-golden.test.ts). The engine reads game length, foul limits, the team-foul penalty,
 * timeouts and the three-point line from here; calibration per ruleset is in src/engine/calibration.ts.
 *
 * Simplification: the engine's floor stays 28 x 15 m for both rulesets (positions are court fractions); the NBA
 * three-point spots are placed at the NBA arc distance, so shots keep the same make chances relative to the line.
 */
import type { MatchState, Side } from '../domain/types';

export type RulesetId = 'fiba-2024' | 'nba-2026';
export const RULESET_IDS: readonly RulesetId[] = ['fiba-2024', 'nba-2026'];

export interface Ruleset {
  id: RulesetId;
  /** Game-clock seconds of a quarter and of an overtime. */
  quarterSeconds: number; overtimeSeconds: number;
  /** Personal fouls that exclude a player. */
  foulOut: number;
  /**
   * Team-foul penalty (free throws on non-shooting fouls) from this many team fouls in a quarter. FIBA counts overtime
   * with the fourth quarter (`overtimeFouls` null); the NBA starts each overtime afresh with its own limit and also gives
   * the penalty from the `lateFouls`th team foul in the last `lateSeconds` of any period.
   */
  penalty: { fouls: number; overtimeFouls: number | null; lateSeconds: number; lateFouls: number | null };
  /**
   * Timeouts. FIBA: 2 in the first half, 3 in the second (at most 2 in the last 2:00 of the fourth), 1 per overtime.
   * NBA: 7 a game, at most 4 in the fourth quarter and 2 in its last 3:00, 2 per overtime. The saved usage keeps its
   * four counters: for the NBA `firstHalf` counts quarters 1-3, `secondHalf` the fourth quarter and `lateFourth` its
   * last 3:00.
   */
  timeouts: { model: 'fiba' | 'nba'; game: number; firstHalf: number; secondHalf: number; late: number; lateSeconds: number; overtime: number };
  /** Three-point line from the basket (metres), and in the corners. */
  threePointM: number; cornerThreeM: number;
  /** Fouls that count as foul trouble for the automatic rotation, by quarter (overtime as the fourth). */
  foulTrouble: readonly [number, number, number, number];
  /** Players dressed for a game. */
  matchdaySquad: number;
  /** NBA: defensive three seconds (a technical free throw, the attack keeps the ball) per half-court action; FIBA none. */
  defensiveThreeSeconds: number;
}

export const FIBA_2024: Ruleset = Object.freeze({
  id: 'fiba-2024', quarterSeconds: 600, overtimeSeconds: 300, foulOut: 5,
  penalty: Object.freeze({ fouls: 5, overtimeFouls: null, lateSeconds: 120, lateFouls: null }),
  timeouts: Object.freeze({ model: 'fiba', game: 5, firstHalf: 2, secondHalf: 3, late: 2, lateSeconds: 120, overtime: 1 }),
  threePointM: 6.75, cornerThreeM: 6.6, foulTrouble: Object.freeze([2, 3, 4, 4]) as readonly [number, number, number, number], matchdaySquad: 12, defensiveThreeSeconds: 0,
}) as Ruleset;

export const NBA_2026: Ruleset = Object.freeze({
  id: 'nba-2026', quarterSeconds: 720, overtimeSeconds: 300, foulOut: 6,
  penalty: Object.freeze({ fouls: 5, overtimeFouls: 4, lateSeconds: 120, lateFouls: 2 }),
  timeouts: Object.freeze({ model: 'nba', game: 7, firstHalf: 7, secondHalf: 4, late: 2, lateSeconds: 180, overtime: 2 }),
  threePointM: 7.24, cornerThreeM: 6.71, foulTrouble: Object.freeze([2, 3, 4, 5]) as readonly [number, number, number, number], matchdaySquad: 13,
  // About one call a game for both teams (NBA 2024-25: roughly 0.5 per team per game).
  defensiveThreeSeconds: .0045,
}) as Ruleset;

const BY_ID: Readonly<Record<RulesetId, Ruleset>> = { 'fiba-2024': FIBA_2024, 'nba-2026': NBA_2026 };
export const isRulesetId = (value: unknown): value is RulesetId => value === 'fiba-2024' || value === 'nba-2026';
export function rulesetById(id: RulesetId | undefined): Ruleset { return id === undefined ? FIBA_2024 : BY_ID[id]; }
/** The rules a match plays: FIBA when no ruleset is recorded. */
export function rulesOf(state: Pick<MatchState, 'ruleset'> | { ruleset?: RulesetId }): Ruleset { return state.ruleset === undefined ? FIBA_2024 : BY_ID[state.ruleset]; }
export const isNba = (rules: Ruleset): boolean => rules.id === 'nba-2026';

/** Seconds on the clock at the start of `period` (1-4 quarters, then overtimes). */
export function periodSeconds(rules: Ruleset, period: number): number { return period <= 4 ? rules.quarterSeconds : rules.overtimeSeconds; }
/** Regulation length in seconds (2400 FIBA, 2880 NBA). */
export function regulationSeconds(rules: Ruleset): number { return 4 * rules.quarterSeconds; }
/** Game seconds played at `clock` in `period`. */
export function elapsedSeconds(rules: Ruleset, period: number, clock: number): number {
  return period <= 4 ? period * rules.quarterSeconds - clock : 4 * rules.quarterSeconds + (period - 4) * rules.overtimeSeconds - clock;
}
/** Length of a finished game of `periods` periods. */
export function gameSeconds(rules: Ruleset, periods: number): number { return elapsedSeconds(rules, periods, 0); }
/** The foul count from which the rotation treats a player as in foul trouble in `period`. */
export function foulTroubleLimit(rules: Ruleset, period: number): number { return rules.foulTrouble[Math.min(4, Math.max(1, period)) - 1]!; }
/** Whether team fouls are reset at the start of `period` (FIBA: quarters only; NBA: every period). */
export function resetsTeamFouls(rules: Ruleset, period: number): boolean { return period <= 4 || rules.penalty.overtimeFouls !== null; }

/**
 * After a foul by `side`, whether its team fouls give the other team free throws on a non-shooting foul. FIBA: the
 * fifth team foul of a quarter (overtime with the fourth). NBA: the fifth of a quarter, the fourth of an overtime, or
 * the second in the last two minutes of any period (counted from the period's foul events, no state of its own).
 */
export function inPenalty(state: Pick<MatchState, 'teamFouls' | 'period' | 'clockSeconds' | 'events'> & { ruleset?: RulesetId }, side: Side): boolean {
  const rules = rulesOf(state), penalty = rules.penalty;
  if (penalty.lateFouls === null) return state.teamFouls[side] >= penalty.fouls;
  if (state.teamFouls[side] >= (state.period > 4 ? penalty.overtimeFouls ?? penalty.fouls : penalty.fouls)) return true;
  if (state.clockSeconds > penalty.lateSeconds) return false;
  let late = 0;
  for (let index = state.events.length - 1; index >= 0; index -= 1) {
    const event = state.events[index]!;
    if (event.period !== state.period || event.clockSeconds > penalty.lateSeconds) break;
    if (event.type === 'foul' && event.side === side) late += 1;
  }
  return late >= penalty.lateFouls;
}
