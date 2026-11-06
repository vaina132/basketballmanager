import { describe, expect, it } from 'vitest';
import type { MatchState, Side } from '../src/domain/types';
import {
  canSubstituteNow, createMatch as createVersionedMatch, remainingTimeouts, requestTimeout,
  setAutoSubstitutions, setInjuryMode, stepMatch, substitutePlayer,
} from '../src/engine/match';

// Preserve the legacy sporting contract independently of the current default engine.
const createMatch = (seed = 42) => createVersionedMatch(seed, 'rules-2');

const other = (side: Side): Side => side === 'home' ? 'away' : 'home';
const sides = ['home', 'away'] as const;

function fixture(seed: number): MatchState {
  let state = setInjuryMode(createMatch(seed), 'off');
  for (const side of sides) state = setAutoSubstitutions(state, side, false);
  return state;
}

/** Search normal transitions for the sporting outcome, not a fixed favorite score. */
function shootingFoul(value: 2 | 3, made: boolean): MatchState {
  for (let seed = 1; seed <= 2000; seed += 1) {
    const next = stepMatch(fixture(seed));
    const shot = next.events.find(event => event.type === 'shot');
    if (!next.freeThrows) continue;
    if (made && next.freeThrows.total === 1 && shot?.shot?.made && shot.shot.value === value) return next;
    if (!made && next.freeThrows.total === value && !shot) return next;
  }
  throw new Error(`No ${value}-point ${made ? 'made' : 'missed'} shooting foul in bounded seed range.`);
}

function threeFreeThrows(lastMade: boolean): MatchState {
  for (let seed = 1; seed <= 2000; seed += 1) {
    const start = stepMatch(fixture(seed));
    if (start.freeThrows?.total !== 3) continue;
    const final = stepMatch(stepMatch(stepMatch(start)));
    const attempts = final.events.filter(event => event.type === 'free-throw');
    const finalAttempt = attempts.at(-1);
    if (attempts.length !== 3 || !finalAttempt) continue;
    const precedingScore = attempts[1]!.score;
    const scored = finalAttempt.score.home + finalAttempt.score.away > precedingScore.home + precedingScore.away;
    if (scored === lastMade) return start;
  }
  throw new Error(`No three-free-throw sequence ending ${lastMade ? 'made' : 'missed'} in bounded seed range.`);
}

describe('shooting foul award and box-score scenarios (R04)', () => {
  it.each([
    { value: 2 as const, made: false },
    { value: 3 as const, made: false },
    { value: 2 as const, made: true },
    { value: 3 as const, made: true },
  ])('accounts for a $value-point attempt with a shooting foul, made=$made', ({ value, made }) => {
    let state = shootingFoul(value, made);
    const sequence = { ...state.freeThrows! };
    const shooter = sequence.shooterId;
    const offense = sequence.side;
    const defense = other(offense);
    const awarded = made ? 1 : value;
    const shooting = state.stats[shooter]!;

    expect(sequence.total).toBe(awarded);
    expect(sequence.remaining).toBe(awarded);
    expect(state.teamFouls[defense]).toBe(1);
    expect(state.events.filter(event => event.type === 'foul')).toHaveLength(1);
    expect(state[defense].players.reduce((total, player) => total + state.stats[player.id]!.fouls, 0)).toBe(1);
    expect(shooting.fieldGoalsAttempted).toBe(made ? 1 : 0);
    expect(shooting.fieldGoalsMade).toBe(made ? 1 : 0);
    expect(shooting.threePointersAttempted).toBe(made && value === 3 ? 1 : 0);
    expect(shooting.threePointersMade).toBe(made && value === 3 ? 1 : 0);
    expect(shooting.freeThrowsAttempted).toBe(0);
    expect(state.score[offense]).toBe(made ? value : 0);
    expect(state[offense].players.reduce((total, player) => total + state.stats[player.id]!.fieldGoalsAttempted, 0)).toBe(made ? 1 : 0);

    const gameClock = state.clockSeconds;
    const courtSeconds = { ...state.courtSeconds };
    for (let attempt = 1; attempt <= awarded; attempt += 1) {
      state = stepMatch(state);
      expect(state.clockSeconds).toBe(gameClock);
      expect(state.courtSeconds).toEqual(courtSeconds);
      expect(state.stats[shooter]!.freeThrowsAttempted).toBe(attempt);
      expect(state.stats[shooter]!.fieldGoalsAttempted).toBe(made ? 1 : 0);
    }
    expect(state.freeThrows).toBeNull();
    expect(state.score[offense]).toBe((made ? value : 0) + state.stats[shooter]!.freeThrowsMade);
    expect(state.stats[shooter]!.points).toBe(state.score[offense]);
  });

  it('changes a non-shooting defensive award from a throw-in on foul four to two free throws on foul five', () => {
    for (let seed = 1; seed <= 2000; seed += 1) {
      const before = fixture(seed);
      const offense = before.possession, defense = other(offense);
      before.teamFouls[defense] = 3;
      const fourth = stepMatch(before);
      if (!fourth.events.some(event => event.type === 'foul' && event.text.includes('non-shooting'))) continue;
      const fifthBefore = structuredClone(before);
      fifthBefore.teamFouls[defense] = 4;
      const fifth = stepMatch(fifthBefore);
      expect(fourth.teamFouls[defense]).toBe(4);
      expect(fourth.freeThrows).toBeNull();
      expect(fourth.possession).toBe(offense);
      expect(fourth.phase).toBe('dead-ball');
      expect(fifth.teamFouls[defense]).toBe(5);
      expect(fifth.freeThrows).toMatchObject({ side: offense, total: 2, remaining: 2 });
      expect(fifth.phase).toBe('free-throws');
      expect(fifth.clockSeconds).toBe(fourth.clockSeconds);
      expect(fifth.score).toEqual(fourth.score);
      return;
    }
    throw new Error('No non-shooting defensive foul in bounded seed range.');
  });
});

describe('free-throw coaching opportunity matrix (R11)', () => {
  it('allows a timeout and a non-shooter substitution before the first free throw without consuming an attempt', () => {
    const state = threeFreeThrows(true);
    const sequence = { ...state.freeThrows! };
    const side = sequence.side;
    const outgoing = state.lineups[side].find(id => id !== sequence.shooterId)!;
    const incoming = state[side].players.find(player => !state.lineups[side].includes(player.id))!.id;
    const changed = substitutePlayer(state, side, outgoing, incoming);
    const timeout = requestTimeout(changed, side);
    expect(timeout.lineups[side]).toContain(incoming);
    expect(timeout.pendingSubstitutions[side]).toHaveLength(0);
    expect(timeout.timeoutUsage[side].firstHalf).toBe(1);
    expect(timeout.freeThrows).toEqual(sequence);
    expect(timeout.stats[sequence.shooterId]!.freeThrowsAttempted).toBe(0);
    expect(timeout.clockSeconds).toBe(state.clockSeconds);
    expect(timeout.rngState).toBe(state.rngState);
    expect(canSubstituteNow(timeout, side, sequence.shooterId)).toBe(false);
  });

  it.each([true, false])('keeps mid-series requests queued until a legal opportunity; last attempt made=%s', lastMade => {
    const start = threeFreeThrows(lastMade);
    const sequence = { ...start.freeThrows! };
    let state = stepMatch(start);
    expect(state.freeThrows?.remaining).toBe(2);
    expect(state.stoppage).toBeNull();
    const requests = sides.map(side => ({
      side,
      outId: state.lineups[side][0]!,
      inId: state[side].players.find(player => !state.lineups[side].includes(player.id))!.id,
    }));
    for (const request of requests) {
      state = substitutePlayer(state, request.side, request.outId, request.inId);
      state = requestTimeout(state, request.side);
    }
    const beforeSecond = state;
    state = stepMatch(state);
    expect(state.freeThrows?.remaining).toBe(1);
    expect(state.clockSeconds).toBe(beforeSecond.clockSeconds);
    expect(state.courtSeconds).toEqual(beforeSecond.courtSeconds);
    for (const { side, outId } of requests) {
      expect(state.lineups[side]).toContain(outId);
      expect(state.pendingSubstitutions[side]).toHaveLength(1);
      expect(state.timeoutRequested[side]).toBe(true);
      expect(state.timeoutUsage[side].firstHalf).toBe(0);
      expect(canSubstituteNow(state, side)).toBe(false);
    }
    state = stepMatch(state);
    expect(state.freeThrows).toBeNull();
    expect(state.clockSeconds).toBe(start.clockSeconds);
    expect(state.stats[sequence.shooterId]!.freeThrowsAttempted).toBe(3);
    for (const { side, outId, inId } of requests) {
      expect(state.lineups[side]).toContain(lastMade ? inId : outId);
      expect(state.pendingSubstitutions[side]).toHaveLength(lastMade ? 0 : 1);
      expect(state.timeoutRequested[side]).toBe(!lastMade);
      expect(state.timeoutUsage[side].firstHalf).toBe(lastMade ? 1 : 0);
    }
    if (lastMade) {
      expect(state.possession).toBe(other(sequence.side));
      expect(state.shotClockSeconds).toBe(24);
      const lastAttemptIndex = state.events.length - 1 - [...state.events].reverse().findIndex(event => event.type === 'free-throw');
      expect(state.events.findIndex(event => event.type === 'substitution')).toBeGreaterThan(lastAttemptIndex);
      expect(state.events.findIndex(event => event.type === 'timeout')).toBeGreaterThan(lastAttemptIndex);
    } else {
      expect(state.phase).toBe('live-ball');
      expect(state.stoppage).toBeNull();
      expect(state.events.at(-1)?.type).toBe('rebound');
      expect(state.shotClockSeconds).toBe(state.possession === sequence.side ? 14 : 24);
    }
  });
});

describe('queued late-game timeout entitlement (R10)', () => {
  it('uses the final-two-minute allowance when a request made before 2:00 is granted after crossing it', () => {
    for (let seed = 1; seed <= 24; seed += 1) {
      let state = setInjuryMode(createMatch(seed), 'off');
      for (const side of sides) state = setAutoSubstitutions(state, side, true);
      for (let action = 0; action < 2000 && state.status !== 'finished'; action += 1) {
        if (state.period === 4 && state.clockSeconds > 120 && state.clockSeconds <= 145 && state.phase === 'live-ball' && !state.stoppage) {
          const requested = requestTimeout(state, 'home');
          const granted = stepMatch(requested);
          if (granted.clockSeconds <= 120 && granted.timeoutUsage.home.lateFourth === 1) {
            expect(remainingTimeouts(state, 'home')).toBe(3);
            expect(requested.timeoutRequested.home).toBe(true);
            expect(requested.timeoutUsage.home.secondHalf).toBe(0);
            expect(requested.clockSeconds).toBeGreaterThan(120);
            expect(granted.timeoutUsage.home.secondHalf).toBe(1);
            expect(granted.timeoutRequested.home).toBe(false);
            expect(remainingTimeouts(granted, 'home')).toBe(1);
            expect([...granted.events].reverse().find(event => event.type === 'timeout')!.clockSeconds).toBeLessThanOrEqual(120);
            const second = requestTimeout(granted, 'home');
            expect(second.timeoutUsage.home.secondHalf).toBe(2);
            expect(second.timeoutUsage.home.lateFourth).toBe(2);
            expect(remainingTimeouts(second, 'home')).toBe(0);
            expect(() => requestTimeout(second, 'home')).toThrow(/No timeouts remain/);
            return;
          }
        }
        state = stepMatch(state);
      }
    }
    throw new Error('No naturally generated timeout opportunity crossing 2:00 in the bounded seed range.');
  });
});
