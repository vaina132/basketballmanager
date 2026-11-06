import { describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { setAutoSubstitutions, simulateToEnd, stepMatch } from '../src/engine/match';
import { advanceSeason, createSeason, getActiveFixture, managedSide } from '../src/world/season';
import { createSeasonInjury, daysUntilReturn, getPlayerHealth, getSeasonInjuries, isRecovering } from '../src/world/health';

function finish(state: SeasonState): SeasonState {
  return { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) };
}

describe('season injury policy and deterministic recovery', () => {
  it('sets one injury policy for the managed club and all simulated fixtures', () => {
    expect(createSeason().injuryMode).toBe('standard');
    for (const injuryMode of ['standard', 'reduced', 'off'] as const) {
      const state = createSeason(19, 'aegean-waves', injuryMode);
      expect(state.activeMatch.injuryMode).toBe(injuryMode);
      const next = advanceSeason(finish(state));
      expect(next.activeMatch.injuryMode).toBe(injuryMode);
      if (injuryMode === 'off') {
        expect(next.injuries).toEqual([]);
        expect(next.fixtures.filter(fixture => fixture.result).every(fixture => !Object.keys(fixture.result!.injuries).length)).toBe(true);
      }
    }
    expect(() => createSeason(19, 'aegean-waves', 'unknown' as never)).toThrow(/injury setting/);
  });

  it('produces stable bounded episodes and clears on the UTC return date', () => {
    const fixture = { id: 'test-fixture', date: '2026-10-25' };
    for (const kind of ['ankle', 'muscle'] as const) {
      const injury = createSeasonInjury(144, fixture, 'club', 'player', kind);
      expect(createSeasonInjury(144, fixture, 'club', 'player', kind)).toEqual(injury);
      const duration = daysUntilReturn(fixture.date, injury.returnOn);
      expect(duration).toBeGreaterThanOrEqual(7);
      expect(duration).toBeLessThanOrEqual(kind === 'ankle' ? 28 : 21);
      expect(isRecovering(injury, fixture.date)).toBe(true);
      expect(isRecovering(injury, '2026-10-24')).toBe(false);
      expect(isRecovering(injury, injury.returnOn)).toBe(false);
      expect(daysUntilReturn(injury.returnOn, injury.returnOn)).toBe(0);
      expect(daysUntilReturn('2027-01-01', injury.returnOn)).toBe(0);
    }
    expect(daysUntilReturn('2026-10-24', '2026-10-26')).toBe(2);
    expect(daysUntilReturn('2028-02-28', '2028-03-01')).toBe(2);
  });

  it('shows a genuine uncommitted away-club incident without changing state or restarting recovery', () => {
    const initial = createSeason(9, 'atlantic-pilots');
    const state = finish(initial);
    expect(state.activeMatch.injuries['atl-8']).toEqual({ kind: 'muscle', occurredAtSeconds: 1798 });
    const before = structuredClone(state);
    const episode = getPlayerHealth(state, 'atl-8')!;
    expect(episode).toMatchObject({ playerId: 'atl-8', clubId: 'atlantic-pilots', fixtureId: 'dev-r1-g1', occurredOn: '2026-09-05', returnOn: '2026-09-15' });
    expect(state.injuries).toEqual([]);
    expect(getSeasonInjuries(state)).toContainEqual(episode);
    expect(getSeasonInjuries(state)).toEqual(getSeasonInjuries(state));
    expect(state).toEqual(before);

    const carried = advanceSeason(state);
    expect(state).toEqual(before);
    expect(carried.date).toBe('2026-09-12');
    expect(carried.injuries).toContainEqual(episode);
    expect(getSeasonInjuries(carried).filter(injury => injury.id === episode.id)).toHaveLength(1);
    expect(getPlayerHealth(carried, 'atl-8')).toEqual(episode);
    expect(daysUntilReturn(carried.date, episode.returnOn)).toBe(3);
    expect(carried.activeMatch.preExistingInjuries).toContain('atl-8');
    expect(carried.activeMatch.lineups[managedSide(carried)]).not.toContain('atl-8');
    expect(carried.activeMatch.stats['atl-8']!.secondsPlayed).toBe(0);
    expect(carried.activeMatch.events.some(event => event.type === 'injury' && event.playerId === 'atl-8')).toBe(false);
    const nextFinished = finish(carried);
    expect(nextFinished.activeMatch.stats['atl-8']!.secondsPlayed).toBe(0);
    expect(nextFinished.activeMatch.stats['atl-8']!.points).toBe(0);
    const cleared = advanceSeason(nextFinished);
    expect(cleared.date).toBe('2026-09-19');
    expect(getPlayerHealth(cleared, 'atl-8')).toBeNull();
    expect(cleared.activeMatch.injuries['atl-8']).toBeUndefined();
    expect(cleared.activeMatch.preExistingInjuries ?? []).not.toContain('atl-8');
    expect(cleared.injuries.filter(injury => injury.playerId === 'atl-8')).toEqual([episode]);
    expect(advanceSeason(state)).toEqual(carried);
  });

  it('preserves a mandatory injury pause until replaced and projects recovery immediately', () => {
    let state = createSeason(9, 'atlantic-pilots');
    let current = setAutoSubstitutions(state.activeMatch, managedSide(state), true);
    for (let count = 0; count < 5000 && current.status !== 'finished'; count += 1) {
      const next = stepMatch(current);
      if (next.injuries['atl-8']) {
        state = { ...state, activeMatch: stepMatch(setAutoSubstitutions(current, managedSide(state), false)) };
        break;
      }
      current = next;
    }
    expect(state.activeMatch.requiredSubstitutions).toContainEqual({ side: 'away', playerId: 'atl-8', reason: 'injured' });
    expect(getPlayerHealth(state, 'atl-8')?.returnOn).toBe('2026-09-15');
    expect(() => advanceSeason(state)).toThrow(/Finish/);
    expect(advanceSeason(finish(state)).injuries.some(injury => injury.playerId === 'atl-8')).toBe(true);
  });

  it('applies the same recovery to AI clubs and records their injuries in compact results', () => {
    // The same fixture is a background AI game when managing Aegean Waves.
    let state = advanceSeason(finish(createSeason(9, 'aegean-waves')));
    const episode = state.injuries.find(injury => injury.playerId === 'atl-8')!;
    expect(episode).toMatchObject({ clubId: 'atlantic-pilots', returnOn: '2026-09-15' });
    expect(state.fixtures.find(fixture => fixture.id === 'dev-r1-g1')!.result!.injuries['atl-8']).toBe('muscle');
    state = advanceSeason(finish(state));
    const second = state.fixtures.find(fixture => fixture.round === 2 && [fixture.homeClubId, fixture.awayClubId].includes('atlantic-pilots'))!;
    expect(second.result!.injuries['atl-8']).toBe('muscle');
    expect(second.result!.stats['atl-8']!.secondsPlayed).toBe(0);
    expect(state.injuries.filter(injury => injury.playerId === 'atl-8')).toEqual([episode]);
    state = advanceSeason(finish(state));
    const third = state.fixtures.find(fixture => fixture.round === 3 && [fixture.homeClubId, fixture.awayClubId].includes('atlantic-pilots'))!;
    expect(third.result!.injuries['atl-8']).toBeUndefined();
    expect(getPlayerHealth(state, 'atl-8')).toBeNull();
  });

  it('rejects mismatched policy and overlapping incidents atomically', () => {
    const completed = finish(createSeason(9, 'atlantic-pilots'));
    expect(() => advanceSeason({ ...completed, injuryMode: 'off' })).toThrow(/same season injury/);
    const injury = createSeasonInjury(completed.seed, getActiveFixture(completed), 'atlantic-pilots', 'atl-8', 'muscle');
    const malformed = { ...completed, injuries: [injury] };
    const before = structuredClone(malformed);
    expect(() => advanceSeason(malformed)).toThrow(/duplicate injury/);
    expect(malformed).toEqual(before);
  });
});
