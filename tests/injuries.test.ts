import { describe, expect, it } from 'vitest';
import type { SeasonInjury } from '../src/domain/season';
import { injuryLabel, injuryRiskTotal, MATCH_INJURY_KINDS, MATCH_INJURY_TYPES, pickInjuryKind, type MatchInjuryKind } from '../src/domain/injuries';
import { FICTIONAL_AWAY, FICTIONAL_HOME } from '../src/data/fictional-teams';
import { createFixtureMatch, simulateToEnd } from '../src/engine/match';
import { parseMatch, serializeMatch } from '../src/storage/match-storage';
import { createSeasonInjury, daysUntilReturn, injuryDays, injuryRiskFor, injuryRiskMap, isRecurrence, recurrenceFactor } from '../src/world/health';

const automatic = { home: true, away: true };
const episode = (kind: SeasonInjury['kind'], occurredOn: string, returnOn: string, playerId = 'player'): SeasonInjury => ({ id: `${occurredOn}:${playerId}`, playerId, clubId: 'club', kind, fixtureId: `fixture-${occurredOn}`, occurredOn, returnOn });
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** New injuries and minutes played over many simulated fixtures between the two fictional clubs. */
function sample(games: number, options: Parameters<typeof createFixtureMatch>[3] = {}) {
  let injuries = 0, minutes = 0;
  const kinds = new Map<string, number>();
  for (let seed = 1; seed <= games; seed += 1) {
    const match = simulateToEnd(createFixtureMatch(seed * 7919, FICTIONAL_HOME, FICTIONAL_AWAY, { autoSubstitutions: automatic, ...options }));
    minutes += Object.values(match.stats).reduce((sum, stats) => sum + stats.secondsPlayed, 0) / 60;
    for (const injury of Object.values(match.injuries)) { injuries += 1; kinds.set(injury.kind, (kinds.get(injury.kind) ?? 0) + 1); }
  }
  return { injuries, minutes, rate: injuries / minutes, kinds };
}

describe('realistic injury types and durations', () => {
  it('covers every kind with shares that sum to 100 and readable labels', () => {
    expect(MATCH_INJURY_TYPES.reduce((sum, type) => sum + type.share, 0)).toBeCloseTo(100, 9);
    for (const type of MATCH_INJURY_TYPES) {
      expect(type.minDays).toBeGreaterThanOrEqual(1);
      expect(type.minDays).toBeLessThanOrEqual(type.medianDays);
      expect(type.medianDays).toBeLessThanOrEqual(type.maxDays);
      expect(injuryLabel(type.kind)).toBe(type.label);
      expect(injuryLabel(type.kind)).not.toMatch(/-/);
    }
    expect(injuryLabel('ankle')).toBe('Ankle injury');
    expect(injuryLabel('muscle')).toBe('Muscle injury');
  });

  it('draws kinds in their research shares, favouring a recurring kind', () => {
    const steps = 100_000, counts = new Map<MatchInjuryKind, number>();
    for (let index = 0; index < steps; index += 1) { const kind = pickInjuryKind((index + 0.5) / steps); counts.set(kind, (counts.get(kind) ?? 0) + 1); }
    for (const type of MATCH_INJURY_TYPES) expect(Math.abs((counts.get(type.kind) ?? 0) / steps * 100 - type.share)).toBeLessThan(0.01);
    const risk = { hamstring: 4 }, raised = new Map<MatchInjuryKind, number>();
    for (let index = 0; index < steps; index += 1) { const kind = pickInjuryKind((index + 0.5) / steps, risk); raised.set(kind, (raised.get(kind) ?? 0) + 1); }
    expect(injuryRiskTotal(risk)).toBeCloseTo(1.21, 9);
    expect(raised.get('hamstring')! / steps).toBeCloseTo(28 / 121, 3);
    expect(raised.get('ankle-sprain')!).toBeLessThan(counts.get('ankle-sprain')!);
  });

  it('keeps every duration within its range around the median, from a stable hash', () => {
    const fixture = { id: 'duration-fixture', date: '2026-10-24' };
    for (const type of MATCH_INJURY_TYPES) {
      const days: number[] = [];
      for (let index = 0; index < 1_500; index += 1) {
        const injury = createSeasonInjury(31, fixture, 'club', `player-${index}`, type.kind);
        expect(createSeasonInjury(31, fixture, 'club', `player-${index}`, type.kind)).toEqual(injury);
        days.push(daysUntilReturn(fixture.date, injury.returnOn));
      }
      days.sort((left, right) => left - right);
      expect(days[0]).toBeGreaterThanOrEqual(type.minDays);
      expect(days.at(-1)).toBeLessThanOrEqual(type.maxDays);
      const median = days[days.length / 2]!;
      expect(Math.abs(median - type.medianDays)).toBeLessThanOrEqual(Math.max(1, type.medianDays * 0.1));
      // Skewed: the mean sits above the median for the wide ranges, and long tails occur.
      if (type.maxDays >= 4 * type.medianDays) expect(days.reduce((sum, value) => sum + value, 0) / days.length).toBeGreaterThan(type.medianDays);
    }
    // Legacy kinds keep their provisional ranges for older careers.
    for (const kind of ['ankle', 'muscle'] as const) {
      const duration = daysUntilReturn(fixture.date, createSeasonInjury(31, fixture, 'club', 'player', kind).returnOn);
      expect(duration).toBeGreaterThanOrEqual(7);
      expect(duration).toBeLessThanOrEqual(kind === 'ankle' ? 28 : 21);
    }
  });
});

describe('injury rate in simulated games', () => {
  it('injures about 0.00085 players per minute played, 0.3 times that when reduced and never when off', () => {
    const standard = sample(160);
    // FIBA games last 40 minutes: about 400 player-minutes per game.
    expect(standard.minutes).toBeGreaterThan(160 * 395);
    // Expected about 0.0009 (minutes beyond 32 carry 1.3 times the risk); the band allows sampling noise.
    expect(standard.rate).toBeGreaterThan(0.00062);
    expect(standard.rate).toBeLessThan(0.00125);
    expect([...standard.kinds.keys()].every(kind => (MATCH_INJURY_KINDS as readonly string[]).includes(kind))).toBe(true);
    const reduced = sample(160, { injuryMode: 'reduced' });
    expect(reduced.rate).toBeLessThan(standard.rate * 0.55);
    expect(reduced.injuries).toBeGreaterThan(0);
    expect(sample(20, { injuryMode: 'off' }).injuries).toBe(0);
  }, 120_000);

  it('raises the rate and the recurring kind for players with an injury history', () => {
    const everyone = [...FICTIONAL_HOME.players, ...FICTIONAL_AWAY.players].map(player => player.id);
    const injuryRisk = Object.fromEntries(everyone.map(id => [id, { hamstring: 4, calf: 4 }]));
    const normal = sample(120), recurring = sample(120, { injuryRisk });
    expect(recurring.rate).toBeGreaterThan(normal.rate * 1.15);
    const muscle = (result: typeof normal) => ((result.kinds.get('hamstring') ?? 0) + (result.kinds.get('calf') ?? 0)) / result.injuries;
    expect(muscle(recurring)).toBeGreaterThan(muscle(normal) * 2);
    // The risk travels with a saved match and is checked on load.
    const match = createFixtureMatch(5, FICTIONAL_HOME, FICTIONAL_AWAY, { injuryRisk: { [everyone[0]!]: { hamstring: 4 } } });
    expect(match.injuryRisk).toEqual({ [everyone[0]!]: { hamstring: 4 } });
    expect(parseMatch(serializeMatch(match))).toEqual(match);
    for (const risk of [{ ankle: 2 }, { hamstring: 0 }, {}]) {
      const envelope = JSON.parse(serializeMatch(match));
      envelope.state.injuryRisk[everyone[0]!] = risk;
      expect(() => parseMatch(JSON.stringify(envelope))).toThrow(/injuryRisk/);
    }
    expect(Object.hasOwn(createFixtureMatch(5, FICTIONAL_HOME, FICTIONAL_AWAY, { injuryRisk: {} }), 'injuryRisk')).toBe(false);
    expect(() => createFixtureMatch(5, FICTIONAL_HOME, FICTIONAL_AWAY, { injuryRisk: { unknown: { hamstring: 2 } } })).toThrow(/injury risk/);
    expect(() => createFixtureMatch(5, FICTIONAL_HOME, FICTIONAL_AWAY, { injuryRisk: { [everyone[0]!]: { ankle: 2 } as never } })).toThrow(/injury risk/);
    expect(() => createFixtureMatch(5, FICTIONAL_HOME, FICTIONAL_AWAY, { injuryRisk: { [everyone[0]!]: { hamstring: 0 } } })).toThrow(/injury risk/);
  }, 120_000);
});

describe('recurrence after earlier injuries', () => {
  const returned = '2026-10-01';
  it('raises same-kind risk in windows counted from the return date', () => {
    const at = (kind: MatchInjuryKind, days: number) => recurrenceFactor(episode(kind, '2026-09-20', returned), kind, addDays(returned, days));
    expect([0, 27, 28, 62, 63, 364, 365].map(days => at('hamstring', days))).toEqual([4, 4, 2.5, 2.5, 1.5, 1.5, 1]);
    expect([0, 41, 42, 364, 365].map(days => at('ankle-sprain', days))).toEqual([2, 2, 1.4, 1.4, 1]);
    // Minor knee, back and tendon injuries: x2 for eight weeks, then x1.3 until the season ends (1 July).
    expect([0, 55, 56].map(days => at('back', days))).toEqual([2, 2, 1.3]);
    expect(recurrenceFactor(episode('knee-minor', '2026-09-20', returned), 'knee-minor', '2027-06-30')).toBe(1.3);
    expect(recurrenceFactor(episode('knee-minor', '2026-09-20', returned), 'knee-minor', '2027-07-01')).toBe(1);
    // Other kinds, other players' kinds and legacy kinds never recur; a player back early counts as week zero.
    expect(at('fracture', 5)).toBe(1);
    expect(recurrenceFactor(episode('calf', '2026-09-20', returned), 'hamstring', returned)).toBe(1);
    expect(recurrenceFactor(episode('muscle', '2026-09-20', returned), 'hamstring', returned)).toBe(1);
    expect(recurrenceFactor(episode('hamstring', '2026-09-20', returned), 'hamstring', '2026-09-25')).toBe(4);
  });

  it('doubles lower-limb risk for 90 days after a concussion and builds the match option per player', () => {
    const history = [episode('concussion', '2026-09-20', returned), episode('hamstring', '2026-10-10', '2026-10-20'), episode('ankle-sprain', '2026-10-10', '2026-10-15', 'other')];
    const risk = injuryRiskFor(history, 'player', '2026-11-01');
    expect(risk.hamstring).toBe(8);
    expect(risk['ankle-sprain']).toBe(2);
    expect(risk.acl).toBe(2);
    expect(risk.concussion).toBeUndefined();
    expect(risk.hand).toBeUndefined();
    expect(injuryRiskFor(history, 'player', addDays(returned, 90))).toEqual({ hamstring: 1.5 });
    expect(injuryRiskFor(history, 'player', '2026-09-20')).toEqual({});
    expect(injuryRiskMap(history, ['player', 'other', 'fresh'], '2026-11-01')).toEqual({ player: risk, other: { 'ankle-sprain': 2 } });
  });

  it('makes a recurrence last 1.3 times as long', () => {
    const history = [episode('hamstring', '2026-09-20', returned)], fixture = { id: 'recurrence-fixture', date: '2026-10-10' };
    expect(isRecurrence(history, 'player', 'hamstring', fixture.date)).toBe(true);
    expect(isRecurrence(history, 'player', 'calf', fixture.date)).toBe(false);
    for (let index = 0; index < 50; index += 1) {
      const first = createSeasonInjury(8, fixture, 'club', 'player', 'hamstring'), again = createSeasonInjury(8, fixture, 'club', 'player', 'hamstring', history);
      const base = daysUntilReturn(fixture.date, first.returnOn);
      expect(daysUntilReturn(fixture.date, again.returnOn)).toBe(Math.round(base * 1.3));
      fixture.id = `recurrence-fixture-${index}`;
    }
    expect(injuryDays('acl', 12345, true)).toBe(Math.round(injuryDays('acl', 12345) * 1.3));
  });
});
