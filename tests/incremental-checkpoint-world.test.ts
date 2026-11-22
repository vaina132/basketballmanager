import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { checkAgainstTrustedPrefix, checkCheckpointState, lastCheckpointFallback, resetCheckpointTrust, validateSeasonState } from '../src/storage/season-storage';
import { matchesTrustedPrefix, withPrefixCheck, type CheckRecord } from '../src/storage/trusted-prefix';
import { dateForRound } from '../src/world/season';
import { submitInSeasonTransferOffer } from '../src/world/recruitment';
import { requiredInSeasonTransferFee } from '../src/world/recruitment-policy';
import { requiredNegotiationWage } from '../src/world/negotiations-policy';
import { incrementalCareer, incrementalWorld, playWeek } from './helpers/incremental-careers';

/**
 * Incremental checkpoint checks in a real-club career with every system of formats 77-80 (national teams included):
 * on tampered saves the incremental check refuses exactly what the full check refuses, whether the change is in the
 * trusted prefix (the full check decides) or after it (the incremental check refuses on its own).
 */
const clone = (state: SeasonState): SeasonState => structuredClone(state);
const weeks: SeasonState[] = [];
/** The career at the start of `round` (weeks[round - 1]). */
const at = (round: number) => weeks[round - 1]!;

beforeAll(() => {
  const world = incrementalWorld(10);
  let state = incrementalCareer(world, 11);
  // The manager buys a player at once (an in-season transfer with its fee paid upfront).
  const signing = 'bsl-10-p11';
  state = submitInSeasonTransferOffer(state, signing, requiredNegotiationWage(signing, 1, undefined, state, 'development'), 1, requiredInSeasonTransferFee(state, signing), state.managedClubId, 'upfront', { role: 'development' });
  weeks.push(state);
  // Through the November FIBA window (its national games are played in week 12) and a few weeks more.
  while (state.round < 15) { state = playWeek(state); weeks.push(state); }
}, 1_800_000);
beforeEach(() => resetCheckpointTrust());

/** What the full check says about a state: null when accepted, else its message. */
function fullVerdict(state: SeasonState): string | null {
  try { validateSeasonState(clone(state)); return null; } catch (error) { return error instanceof Error ? error.message : String(error); }
}
/** The record an accepted check of `trusted` leaves for the next checkpoint. */
const recordOf = (trusted: SeasonState): CheckRecord => { const state = clone(trusted); return withPrefixCheck(state, null, true, () => validateSeasonState(state))!; };

/**
 * The incremental check of `next` after `trusted` agrees with the full check: a state in the trusted prefix's past that
 * changed is never trusted, the incremental check alone refuses whatever the full check refuses, and the checkpoint
 * queue's check throws exactly when the full check does.
 */
function expectAgreement(trusted: SeasonState, next: SeasonState, expected: { prefix: boolean; refused: boolean }) {
  const full = fullVerdict(next);
  expect(full !== null, `full check: ${full}`).toBe(expected.refused);
  const record = recordOf(trusted);
  expect(matchesTrustedPrefix(record, clone(next))).toBe(expected.prefix);
  if (expected.prefix) {
    let incremental: string | null = null;
    try { checkAgainstTrustedPrefix(clone(next), record); } catch (error) { incremental = error instanceof Error ? error.message : String(error); }
    expect(incremental !== null, `incremental check: ${incremental}`).toBe(full !== null);
  }
  resetCheckpointTrust();
  checkCheckpointState(clone(trusted));
  if (full === null) expect(checkCheckpointState(clone(next))).toBe(expected.prefix ? 'incremental' : 'full');
  else expect(() => checkCheckpointState(clone(next))).toThrow(/Invalid season save/);
}

/** The first week whose games (played on the way to the next week) did `happen`, from `from` on. */
function weekWhere(from: number, happen: (before: SeasonState, after: SeasonState) => boolean): number {
  for (let round = from; round < weeks.length; round += 1) if (happen(at(round), at(round + 1))) return round;
  throw new Error('The career has no such week.');
}

describe('incremental checkpoint checks in a real-club career with national teams', () => {
  it('checks each untouched week incrementally, the national window included', () => {
    const window = weekWhere(2, (before, after) => !!after.national?.competitions[0]?.fixtures.some(fixture => fixture.result) && !before.national?.competitions[0]?.fixtures.some(fixture => fixture.result));
    for (const round of [1, 2, 5, window - 1, window, window + 1]) {
      resetCheckpointTrust();
      checkCheckpointState(clone(at(round)));
      expect(checkCheckpointState(clone(at(round + 1))), `week ${round + 1}: ${lastCheckpointFallback()}`).toBe('incremental');
    }
  }, 1_800_000);

  it('agrees with the full check on a changed score, before and after the trusted week', () => {
    for (const round of [3, 12]) {
      const trusted = at(round), next = at(round + 1);
      // A game of an earlier week: the trusted prefix differs, and the full check refuses.
      const earlier = clone(next), old = earlier.fixtures.find(fixture => fixture.round < round && fixture.result)!;
      old.result = { ...old.result!, score: { ...old.result!.score, home: old.result!.score.home + 1 } };
      expectAgreement(trusted, earlier, { prefix: false, refused: true });
      // A game of the new week: the incremental check refuses it on its own.
      const latest = clone(next), game = latest.fixtures.find(fixture => fixture.round === round && fixture.result)!;
      game.result = { ...game.result!, score: { ...game.result!.score, away: game.result!.score.away + 2 } };
      expectAgreement(trusted, latest, { prefix: true, refused: true });
      // The untouched week is accepted by both.
      expectAgreement(trusted, next, { prefix: true, refused: false });
    }
  }, 1_800_000);

  it('agrees with the full check on a changed transfer', () => {
    const arrival = weekWhere(1, (before, after) => after.employment.transfers.length > before.employment.transfers.length);
    // The transfer of the new week.
    const latest = clone(at(arrival + 1)), index = latest.employment.transfers.length - 1;
    latest.employment.transfers[index] = { ...latest.employment.transfers[index]!, fee: latest.employment.transfers[index]!.fee + 100_000 };
    expectAgreement(at(arrival), latest, { prefix: true, refused: true });
    // The same transfer once it is in the trusted past (dated by its first registered week, the week after it).
    const later = clone(at(arrival + 3));
    expect(later.employment.transfers[index]!.startsRound).toBeLessThan(arrival + 2);
    later.employment.transfers[index] = { ...later.employment.transfers[index]!, fee: later.employment.transfers[index]!.fee + 100_000 };
    expectAgreement(at(arrival + 2), later, { prefix: false, refused: true });
  }, 1_800_000);

  it('agrees with the full check on a changed national result, in the window week and later', () => {
    const window = weekWhere(2, (before, after) => !!after.national?.competitions[0]?.fixtures.some(fixture => fixture.result) && !before.national?.competitions[0]?.fixtures.some(fixture => fixture.result));
    for (const round of [window, window + 2]) {
      const next = clone(at(round + 1)), competition = next.national!.competitions[0]!;
      const fixture = competition.fixtures.find(item => item.result)!;
      fixture.result = { ...fixture.result!, home: fixture.result!.home + 1 };
      // National teams are checked in full on every checkpoint: the change is refused either way.
      expectAgreement(at(round), next, { prefix: true, refused: true });
    }
  }, 1_800_000);

  it('agrees with the full check on a changed injury, before and after the trusted week', () => {
    const injured = weekWhere(2, (before, after) => after.injuries.length > before.injuries.length);
    // An injury of the new week's games.
    const latest = clone(at(injured + 1)), index = latest.injuries.length - 1;
    expect(latest.injuries[index]!.occurredOn >= dateForRound(injured, latest.seasonNumber)).toBe(true);
    latest.injuries[index] = { ...latest.injuries[index]!, returnOn: dateForRound(injured + 6, latest.seasonNumber) };
    expectAgreement(at(injured), latest, { prefix: true, refused: true });
    // The same injury a few weeks later, in the trusted past.
    const later = clone(at(injured + 3));
    later.injuries[index] = { ...later.injuries[index]!, returnOn: dateForRound(injured + 6, later.seasonNumber) };
    expectAgreement(at(injured + 2), later, { prefix: false, refused: true });
  }, 1_800_000);

  it('never trusts a prefix that differs from the one its check accepted, even when the trusted object changed in place', () => {
    // The direct codec (no worker) checks the game's own objects: a trusted state changed afterwards must not lend trust.
    const trusted = clone(at(6)), next = clone(at(7));
    expect(checkCheckpointState(trusted)).toBe('full');
    const index = trusted.finance.ledger.findIndex(entry => entry.kind === 'tickets' && entry.round < 6);
    // The same change in both objects: structurally equal, but not the prefix the check accepted.
    for (const state of [trusted, next]) state.finance.ledger[index] = { ...state.finance.ledger[index]!, amount: state.finance.ledger[index]!.amount + 100 };
    expect(() => checkCheckpointState(next)).toThrow(/Invalid season save/);
    expect(lastCheckpointFallback()).toBe('trusted prefix digest');
    // After a refusal, the next checkpoint starts again from a full check.
    expect(checkCheckpointState(clone(at(7)))).toBe('full');
    expect(lastCheckpointFallback()).toBe('no trusted checkpoint');
    expect(checkCheckpointState(clone(at(8)))).toBe('incremental');
  }, 1_800_000);

  it('is faster than the full check', () => {
    const time = (run: () => unknown) => { const start = performance.now(); run(); return performance.now() - start; };
    const trusted = at(13), next = at(14);
    const full = Math.min(time(() => validateSeasonState(clone(next))), time(() => validateSeasonState(clone(next))));
    let incremental = Infinity;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      resetCheckpointTrust();
      checkCheckpointState(clone(trusted));
      const state = clone(next);
      incremental = Math.min(incremental, time(() => expect(checkCheckpointState(state)).toBe('incremental')));
    }
    // A loose bound (machines differ): measured at about a third of the full check.
    expect(incremental).toBeLessThan(full * 0.8);
  }, 1_800_000);
});
