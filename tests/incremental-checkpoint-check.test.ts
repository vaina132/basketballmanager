import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { createCheckpointQueue } from '../src/storage/career-saves';
import { directSeasonCodec, type SeasonCodec } from '../src/storage/season-codec';
import type { CheckpointReason } from '../src/storage/season-indexed-db';
import { checkAgainstTrustedPrefix, checkCheckpointState, resetCheckpointTrust, validateSeasonState } from '../src/storage/season-storage';
import { lastPrefixSkips, matchesTrustedPrefix, withPrefixCheck } from '../src/storage/trusted-prefix';
import { setEmploymentDelegation } from '../src/world/employment';
import { advanceSeason, createSeason, managedSide, NEW_CAREER_SYSTEMS } from '../src/world/season';

const storage = vi.hoisted(() => ({ readSeasonJournal: vi.fn(), writeSeasonCheckpoint: vi.fn(), readLocalSeason: vi.fn(), writeLocalSeason: vi.fn() }));
vi.mock('../src/storage/season-indexed-db', () => storage);

const play = (state: SeasonState): SeasonState => advanceSeason(state.activeMatch ? { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) } : state);
/** The save worker checks a structured clone of the game's state. */
const clone = (state: SeasonState): SeasonState => structuredClone(state);

// One career with every system, delegated: a checkpoint a few weeks in (trusted) and the next week's checkpoint.
let trusted: SeasonState, next: SeasonState;
beforeAll(() => {
  let state = setEmploymentDelegation(createSeason({ seed: 31, managedClubId: 'rhine-falcons', injuryMode: 'standard', ...NEW_CAREER_SYSTEMS }), true);
  while (state.round < 6) state = play(state);
  trusted = state;
  while (state.round < 7) state = play(state);
  next = state;
}, 600_000);
beforeEach(() => { vi.resetAllMocks(); resetCheckpointTrust(); });

/** The record an accepted full check of the trusted state leaves for the next checkpoint. */
const trustedRecord = () => { const state = clone(trusted); return withPrefixCheck(state, null, true, () => validateSeasonState(state))!; };

describe('incremental checkpoint checks', () => {
  it('accepts a valid next week from the trusted checkpoint, skipping its earlier records', () => {
    expect(checkCheckpointState(clone(trusted))).toBe('full');
    expect(checkCheckpointState(clone(next))).toBe('incremental');
    const skips = lastPrefixSkips();
    for (const journal of ['finance.ledger', 'relationships.events', 'employment.contracts', 'academy.weeks', 'board.reviews']) expect(skips[journal], journal).toBeGreaterThan(0);
    // The full check agrees.
    expect(() => validateSeasonState(clone(next))).not.toThrow();
  }, 600_000);

  it('sends a state with an edited past to the full check, which refuses it', () => {
    const record = trustedRecord();
    const edited = clone(next);
    const earlier = edited.finance.ledger.findIndex(entry => entry.kind === 'tickets' && entry.round < trusted.round);
    expect(earlier).toBeGreaterThanOrEqual(0);
    edited.finance.ledger[earlier] = { ...edited.finance.ledger[earlier]!, amount: edited.finance.ledger[earlier]!.amount + 100 };
    expect(matchesTrustedPrefix(record, edited)).toBe(false);
    checkCheckpointState(clone(trusted));
    expect(() => checkCheckpointState(edited)).toThrow(/Invalid season save/);
    // An edited earlier relationship command is refused the same way.
    const command = clone(next), event = command.relationships.events.findIndex(item => item.round < trusted.round - 1 && item.type === 'prepare');
    expect(event).toBeGreaterThanOrEqual(0);
    command.relationships.events[event] = { ...command.relationships.events[event]!, date: '2000-01-01' };
    expect(matchesTrustedPrefix(record, command)).toBe(false);
    expect(() => checkCheckpointState(command)).toThrow(/Invalid season save/);
  }, 600_000);

  it('refuses an edited new week on its own, without the full check', () => {
    const record = trustedRecord();
    const edited = clone(next), latest = edited.finance.ledger.findLastIndex(entry => entry.kind === 'tickets');
    expect(edited.finance.ledger[latest]!.round).toBeGreaterThanOrEqual(trusted.round);
    edited.finance.ledger[latest] = { ...edited.finance.ledger[latest]!, amount: edited.finance.ledger[latest]!.amount + 100 };
    expect(matchesTrustedPrefix(record, edited)).toBe(true);
    expect(() => checkAgainstTrustedPrefix(edited, record)).toThrow(/Invalid season save: finance\.ledger/);
    // A new week's game result is refused too.
    const result = clone(next), game = result.fixtures.find(fixture => fixture.round === trusted.round && fixture.result)!;
    game.result = { ...game.result!, score: { ...game.result!.score, home: game.result!.score.home + 1 } };
    expect(matchesTrustedPrefix(record, result)).toBe(true);
    expect(() => checkAgainstTrustedPrefix(result, record)).toThrow(/Invalid season save/);
    checkCheckpointState(clone(trusted));
    expect(() => checkCheckpointState(result)).toThrow(/Invalid season save/);
  }, 600_000);

  it('is what the checkpoint queue uses, while exports keep the full check', async () => {
    storage.writeSeasonCheckpoint.mockImplementation(async (serialized: string, revision: number, reason: CheckpointReason, seal?: string) => ({ revision: revision + 1, savedAt: '2026-11-16T12:00:00.000Z', reason, serialized, ...(seal ? { seal } : {}) }));
    const calls: string[] = [];
    const codec: SeasonCodec = {
      parse: text => directSeasonCodec.parse(text),
      serialize: state => { calls.push('serialize'); return directSeasonCodec.serialize(state); },
      checkpoint: state => { calls.push('checkpoint'); return directSeasonCodec.checkpoint!(state); },
    };
    let revision = 0;
    const queue = createCheckpointQueue({ codec, revision: () => revision, written: checkpoint => { revision = checkpoint.revision; } });
    await queue.save(clone(trusted), 'matchday');
    await queue.save(clone(next), 'matchday');
    expect(calls).toEqual(['checkpoint', 'checkpoint']);
    expect(lastPrefixSkips()['finance.ledger']).toBeGreaterThan(0);
    expect(storage.writeSeasonCheckpoint).toHaveBeenCalledTimes(2);
    // A refused new week writes nothing.
    const refused = clone(next), latest = refused.finance.ledger.findLastIndex(entry => entry.kind === 'tickets');
    refused.finance.ledger[latest] = { ...refused.finance.ledger[latest]!, amount: refused.finance.ledger[latest]!.amount + 100 };
    await expect(queue.save(refused, 'matchday')).rejects.toThrow(/Invalid season save/);
    expect(storage.writeSeasonCheckpoint).toHaveBeenCalledTimes(2);
  }, 600_000);
});
