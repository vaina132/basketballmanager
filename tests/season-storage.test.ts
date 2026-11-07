import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { DEVELOPMENT_CLUBS } from '../src/data/development-league';
import { createMatch, isPlayerEligible, setAutoSubstitutions, setTactics, simulateToEnd, simulateToQuarterEnd, stepMatch, substitutePlayer } from '../src/engine/match';
import { parseMatch, serializeMatch } from '../src/storage/match-storage';
import { MAX_SEASON_SAVE_BYTES, parseSeason, serializeSeason, validateSeasonState } from '../src/storage/season-storage';
import { advanceSeason, createSeason, managedSide } from '../src/world/season';

interface Envelope { format: string; formatVersion: number; engineVersion: string; state: SeasonState }
const selectedClub = DEVELOPMENT_CLUBS.at(-1)!.id;
let initial: SeasonState, completedMatch: SeasonState, nextRound: SeasonState;
let initialText: string, nextRoundText: string;
function finish(season: SeasonState): SeasonState {
  return { ...season, activeMatch: simulateToEnd(setAutoSubstitutions(season.activeMatch, managedSide(season), true)) };
}
function corrupt(text: string, change: (envelope: Envelope) => void): string {
  const envelope = JSON.parse(text) as Envelope;
  change(envelope);
  return JSON.stringify(envelope);
}

beforeAll(() => {
  initial = createSeason(37, selectedClub, 'off', false, false);
  completedMatch = finish(initial);
  nextRound = advanceSeason(completedMatch);
  initialText = serializeSeason(initial);
  nextRoundText = serializeSeason(nextRound);
}, 30_000);

describe('season persistence boundaries', () => {
  it('round-trips a club choice, exact calendar, independent fixture and zero seed', () => {
    expect(managedSide(initial)).toBe('away');
    expect(parseSeason(initialText)).toEqual(initial);
    expect(parseSeason(serializeSeason(createSeason(0)))).toEqual(createSeason(0));
    expect(parseSeason(initialText)).not.toBe(initial);
  });

  it('resumes away-side tactical changes and a lineup change to the identical next matchday', () => {
    const side = managedSide(initial);
    let match = simulateToQuarterEnd(setAutoSubstitutions(initial.activeMatch, side, true));
    match = setTactics(match, side, { outsideShare: .8, pressure: .25 });
    const incoming = match[side].players.find(player => !match.lineups[side].includes(player.id) && match.stats[player.id]!.fouls < 5)!;
    match = substitutePlayer(match, side, match.lineups[side][0]!, incoming.id);
    const changed = { ...initial, activeMatch: match };
    const restored = parseSeason(serializeSeason(changed));
    expect(restored).toEqual(changed);
    const uninterrupted = { ...changed, activeMatch: simulateToEnd(changed.activeMatch) };
    const resumed = { ...restored, activeMatch: simulateToEnd(restored.activeMatch) };
    expect(advanceSeason(resumed)).toEqual(advanceSeason(uninterrupted));
  }, 30_000);

  it('retains completed but uncommitted results without posting or recovering twice', () => {
    const restored = parseSeason(serializeSeason(completedMatch));
    expect(restored.fixtures.every(fixture => fixture.result === null)).toBe(true);
    expect(advanceSeason(restored)).toEqual(nextRound);
    expect(parseSeason(nextRoundText)).toEqual(nextRound);
    expect(() => advanceSeason(parseSeason(nextRoundText))).toThrow(/Finish the current match/);
  });

  it('round-trips a live completed pass with its authoritative handler and matchups', () => {
    let match = initial.activeMatch;
    for (let count = 0; count < 100 && !match.possessionPlay?.passerId; count += 1) match = stepMatch(match);
    expect(match.possessionPlay?.passerId).toBeTruthy();
    const state = { ...initial, activeMatch: match };
    expect(parseSeason(serializeSeason(state))).toEqual(state);
  });

  it('preserves a mandatory away-team replacement and resumes only after that decision', () => {
    let critical: SeasonState | undefined;
    for (let seed = 1; seed <= 30 && !critical; seed += 1) {
      const candidate = createSeason(seed, selectedClub, 'off', false, false);
      candidate.activeMatch = simulateToEnd(candidate.activeMatch);
      if (candidate.activeMatch.requiredSubstitutions.length) critical = candidate;
    }
    expect(critical).toBeDefined();
    const restored = parseSeason(serializeSeason(critical!));
    expect(restored).toEqual(critical);
    expect(() => advanceSeason(restored)).toThrow(/resolve required decisions/);
    const side = managedSide(restored), decision = restored.activeMatch.requiredSubstitutions[0]!;
    const incoming = restored.activeMatch[side].players.find(player => !restored.activeMatch.lineups[side].includes(player.id) && isPlayerEligible(restored.activeMatch, player.id))!;
    restored.activeMatch = substitutePlayer(restored.activeMatch, side, decision.playerId, incoming.id);
    expect(parseSeason(serializeSeason(restored))).toEqual(restored);
    const next = advanceSeason(finish(restored));
    expect(parseSeason(serializeSeason(next))).toEqual(next);
  }, 30_000);

  it('keeps official default awards separate from earned player statistics', () => {
    const envelope = JSON.parse(nextRoundText) as Envelope;
    const fixture = envelope.state.fixtures[0]!, result = fixture.result!;
    const losingSide = result.score.home > result.score.away ? 'home' : 'away';
    const winningSide = losingSide === 'home' ? 'away' : 'home';
    const losingClub = envelope.state.clubs.find(club => club.id === (losingSide === 'home' ? fixture.homeClubId : fixture.awayClubId))!;
    for (const player of losingClub.players) result.stats[player.id]!.fouls = 5;
    result.kind = 'default';
    result.winnerClubId = winningSide === 'home' ? fixture.homeClubId : fixture.awayClubId;
    result.officialScore = { home: winningSide === 'home' ? 2 : 0, away: winningSide === 'away' ? 2 : 0 };
    const restored = parseSeason(JSON.stringify(envelope));
    expect(restored.fixtures[0]!.result!.score).toEqual(result.score);
    expect(restored.fixtures[0]!.result!.officialScore).toEqual(result.officialScore);
    expect(result.score).not.toEqual(result.officialScore);
  });

  it('validates and restores all ten round boundaries with compact complete results', () => {
    let season = nextRound;
    for (let round = 2; round <= 10; round += 1) {
      season = advanceSeason(finish(season));
      const text = serializeSeason(season);
      expect(new TextEncoder().encode(text).byteLength).toBeLessThan(MAX_SEASON_SAVE_BYTES);
      const restored = parseSeason(text);
      expect(restored).toEqual(season);
      season = restored;
    }
    expect(season.status).toBe('complete');
    expect(season.fixtures.filter(fixture => fixture.result)).toHaveLength(30);
    expect(season.fixtures.every(fixture => !Object.hasOwn(fixture.result!, 'events'))).toBe(true);
    expect(() => advanceSeason(season)).toThrow(/complete/);
    const damaged = structuredClone(season);
    damaged.activeMatch.stats[damaged.activeMatch.home.players[0]!.id]!.condition -= 1;
    expect(() => validateSeasonState(damaged)).toThrow(/committed final result/);
  }, 60_000);

  it('keeps exhibition formats separate and leaves their exact snapshots unchanged', () => {
    for (const version of ['rules-2', 'possession-3'] as const) {
      const match = createMatch(91, version), text = serializeMatch(match);
      expect(() => parseSeason(text)).toThrow(/unsupported save format/);
      expect(() => parseMatch(initialText)).toThrow(/unsupported save format/);
      expect(parseMatch(text)).toEqual(match);
    }
  });

  it('rejects oversized, malformed, unsafe and pathological data before replacing state', () => {
    expect(() => parseSeason(' '.repeat(MAX_SEASON_SAVE_BYTES + 1))).toThrow(/too large/);
    expect(() => parseSeason('not json')).toThrow(/valid JSON/);
    expect(() => parseSeason(initialText.replace('"state":', '"__proto__":{},"state":'))).toThrow(/unsafe/);
    expect(() => parseSeason(JSON.stringify(Array.from({ length: 20_001 }, () => 0)))).toThrow(/oversized collection/);
    let deep: unknown = 0;
    for (let index = 0; index < 45; index += 1) deep = { nested: deep };
    expect(() => parseSeason(JSON.stringify(deep))).toThrow(/nested/);
    const unusual = structuredClone(initial) as unknown as Record<string, unknown>;
    unusual.conditions = new Date();
    expect(() => validateSeasonState(unusual)).toThrow(/plain save data/);
    expect(initial.activeMatch.status).toBe('ready');
    expect(initial.fixtures.every(fixture => fixture.result === null)).toBe(true);
  });
});

describe('malformed season imports', () => {
  const cases: Array<[string, (envelope: Envelope) => void]> = [
    ['unsupported format version', e => { e.formatVersion = 6; }],
    ['unsupported envelope engine', e => { e.engineVersion = 'rules-2'; }],
    ['unsupported state version', e => { (e.state as unknown as Record<string, unknown>).schemaVersion = 6; }],
    ['unknown data pack', e => { (e.state as unknown as Record<string, unknown>).dataPackId = 'real-league'; }],
    ['unknown state field', e => { (e.state as unknown as Record<string, unknown>).extra = true; }],
    ['invalid seed', e => { e.state.seed = -1; }],
    ['unknown managed club', e => { e.state.managedClubId = 'missing'; }],
    ['mismatched simulation date', e => { e.state.date = '2026-09-06'; }],
    ['invalid calendar date', e => { e.state.date = '2026-02-31'; }],
    ['premature complete state', e => { e.state.status = 'complete'; }],
    ['skipped matchday', e => { e.state.round = 2; }],
    ['modified club data', e => { (e.state.clubs[0] as unknown as Record<string, unknown>).name = 'Unverified club'; }],
    ['duplicate club identity', e => { (e.state.clubs as unknown[])[1] = e.state.clubs[0]; }],
    ['missing club plan', e => { delete e.state.plans[e.state.clubs[0]!.id]; }],
    ['unsupported plan field', e => { (e.state.plans[selectedClub] as unknown as Record<string, unknown>).budget = 1000; }],
    ['duplicate planned starter', e => { e.state.plans[selectedClub]!.lineup[1] = e.state.plans[selectedClub]!.lineup[0]!; }],
    ['foreign planned starter', e => { e.state.plans[selectedClub]!.lineup[0] = e.state.clubs[0]!.players[0]!.id; }],
    ['unbounded tactical value', e => { e.state.plans[selectedClub]!.tactics.tempo = 1.1; }],
    ['manual opponent club', e => { e.state.plans[e.state.clubs[0]!.id]!.autoSubstitutions = false; }],
    ['altered initial condition', e => { e.state.conditions[e.state.clubs[0]!.players[0]!.id] = 99; }],
    ['foreign condition record', e => { e.state.conditions.missing = 100; }],
    ['missing scheduled fixture', e => { e.state.fixtures.pop(); }],
    ['duplicate fixture', e => { e.state.fixtures[1] = e.state.fixtures[0]!; }],
    ['altered fixture date', e => { e.state.fixtures[0]!.date = '2026-09-12'; }],
    ['swapped fixture venue', e => { const f = e.state.fixtures[0]!; [f.homeClubId, f.awayClubId] = [f.awayClubId, f.homeClubId]; }],
    ['wrong active fixture', e => { e.state.activeFixtureId = e.state.fixtures[4]!.id; }],
    ['wrong match seed', e => { e.state.activeMatch.seed += 1; }],
    ['foreign active match', e => { e.state.activeMatch = createMatch(e.state.activeMatch.seed); }],
    ['injury setting changed for one fixture', e => { e.state.activeMatch.injuryMode = 'standard'; }],
    ['opponent assistant disabled', e => { e.state.activeMatch.autoSubstitutions.home = false; }],
    ['pregame condition mismatch', e => { e.state.activeMatch.stats[e.state.activeMatch.home.players[0]!.id]!.condition = 99; }],
    ['future fixture prematurely committed', e => { e.state.fixtures[0]!.result = nextRound.fixtures[0]!.result; }],
  ];
  it.each(cases)('rejects %s', (_name, change) => {
    expect(() => parseSeason(corrupt(initialText, change))).toThrow();
  });

  const resultCases: Array<[string, (envelope: Envelope) => void]> = [
    ['missing committed result', e => { e.state.fixtures[0]!.result = null; }],
    ['extra result field', e => { (e.state.fixtures[0]!.result as unknown as Record<string, unknown>).events = []; }],
    ['score inconsistent with players', e => { e.state.fixtures[0]!.result!.score.home += 1; }],
    ['wrong official score', e => { e.state.fixtures[0]!.result!.officialScore.home += 1; }],
    ['foreign winner', e => { e.state.fixtures[0]!.result!.winnerClubId = 'missing'; }],
    ['wrong winning club', e => { const f = e.state.fixtures[0]!; f.result!.winnerClubId = f.result!.winnerClubId === f.homeClubId ? f.awayClubId : f.homeClubId; }],
    ['normal match ending before four periods', e => { e.state.fixtures[0]!.result!.periods = 3; }],
    ['invalid default with eligible players', e => { e.state.fixtures[0]!.result!.kind = 'default'; }],
    ['unknown box score player', e => { const stats = e.state.fixtures[0]!.result!.stats; stats.missing = { ...Object.values(stats)[0]! }; }],
    ['impossible shot totals', e => { Object.values(e.state.fixtures[0]!.result!.stats)[0]!.fieldGoalsMade = 1_000_000; }],
    ['unreconciled player minutes', e => { Object.values(e.state.fixtures[0]!.result!.stats)[0]!.secondsPlayed += 1; }],
    ['fouls beyond exclusion', e => { Object.values(e.state.fixtures[0]!.result!.stats)[0]!.fouls = 6; }],
    ['more assists than baskets', e => { Object.values(e.state.fixtures[0]!.result!.stats)[0]!.assists = 10000; }],
    ['more steals than opposing turnovers', e => { Object.values(e.state.fixtures[0]!.result!.stats)[0]!.steals = 10000; }],
    ['unreconciled recovered condition', e => { e.state.conditions[e.state.clubs[0]!.players[0]!.id] = 50; }],
    ['partial next matchday committed', e => { e.state.fixtures[3]!.result = e.state.fixtures[0]!.result; }],
  ];
  it.each(resultCases)('rejects %s', (_name, change) => {
    expect(() => parseSeason(corrupt(nextRoundText, change))).toThrow();
  });
});
