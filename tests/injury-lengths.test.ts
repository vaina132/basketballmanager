import { describe, expect, it } from 'vitest';
import type { SeasonInjury, SeasonState } from '../src/domain/season';
import { INJURY_DURATIONS_2, INJURY_MODEL_2, MATCH_INJURY_TYPES, pickInjuryKind } from '../src/domain/injuries';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { createSeasonInjury, injuryDays, isRecovering } from '../src/world/health';
import { advanceSeason, createSeason, managedSide, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { seasonRounds } from '../src/world/career-world';

const DAY_MS = 86_400_000;
const length = (injury: Pick<SeasonInjury, 'occurredOn' | 'returnOn'>) => Math.round((Date.parse(`${injury.returnOn}T00:00:00Z`) - Date.parse(`${injury.occurredOn}T00:00:00Z`)) / DAY_MS);
const bucket = (days: number) => days < 7 ? 'under a week' : days < 21 ? '1-3 weeks' : days < 56 ? '3-8 weeks' : 'longer';
const finish = (state: SeasonState): SeasonState => state.activeMatch && state.activeMatch.status !== 'finished' ? { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) } : state;

/** Shares of injury lengths for kinds drawn in their research shares, with stable hashes. */
function lengths(model?: typeof INJURY_MODEL_2) {
  const counts: Record<string, number> = { 'under a week': 0, '1-3 weeks': 0, '3-8 weeks': 0, longer: 0 };
  const draws = 40_000;
  for (let index = 0; index < draws; index += 1) {
    const kind = pickInjuryKind((index + 0.5) / draws);
    counts[bucket(injuryDays(kind, Math.imul(index + 1, 2654435761) >>> 0, false, model))]! += 1;
  }
  return Object.fromEntries(Object.entries(counts).map(([key, count]) => [key, count / draws]));
}

describe('injury lengths for new careers (owner feedback, 22 November 2026)', () => {
  it('keeps most injuries short but gives every club long absences over a season', () => {
    for (const type of MATCH_INJURY_TYPES) {
      const [min, median, max] = INJURY_DURATIONS_2[type.kind];
      expect(min).toBeGreaterThanOrEqual(type.minDays);
      expect(median).toBeGreaterThanOrEqual(type.medianDays);
      expect(max).toBeGreaterThanOrEqual(type.maxDays);
      expect(min <= median && median <= max).toBe(true);
    }
    const research = lengths(), lifted = lengths(INJURY_MODEL_2);
    // Before: well over half the injuries were gone within a week and one in eight lasted three weeks or more.
    expect(research['under a week']).toBeGreaterThan(0.5);
    expect(research['3-8 weeks']! + research.longer!).toBeLessThan(0.15);
    // Now: most injuries still under three weeks, about one in five three weeks or more, one in twenty over two months.
    expect(lifted['under a week']! + lifted['1-3 weeks']!).toBeGreaterThan(0.7);
    expect(lifted['under a week']).toBeGreaterThan(0.3);
    expect(lifted['under a week']).toBeLessThan(0.45);
    expect(lifted['3-8 weeks']! + lifted.longer!).toBeGreaterThan(0.18);
    expect(lifted.longer).toBeGreaterThan(0.04);
    // Careers created before keep their diagnoses: no model means the research durations.
    const fixture = { id: 'f', date: '2026-11-07' };
    expect(createSeasonInjury(5, fixture, 'club', 'player', 'fracture')).toEqual(createSeasonInjury(5, fixture, 'club', 'player', 'fracture', [], 0, undefined));
    expect(length(createSeasonInjury(5, fixture, 'club', 'player', 'fracture', [], 0, INJURY_MODEL_2))).toBeGreaterThanOrEqual(28);
  });

  it('records every match injury for its full length in a season, keeps the player out until then, and passes the strict check', () => {
    let state = createSeason({ seed: 25, managedClubId: 'rhine-falcons', injuryMode: 'standard', ...NEW_CAREER_SYSTEMS });
    expect(state.injuryModel).toBe(INJURY_MODEL_2);
    expect(createSeason({ seed: 25, managedClubId: 'rhine-falcons', injuryMode: 'standard', ...NEW_CAREER_SYSTEMS, injuryLengths: false }).injuryModel).toBeUndefined();
    const rounds = seasonRounds(state);
    for (let guard = 0; guard < 200 && state.round < rounds; guard += 1) state = advanceSeason(finish(state));
    const counts: Record<string, number> = { 'under a week': 0, '1-3 weeks': 0, '3-8 weeks': 0, longer: 0 };
    for (const injury of state.injuries) counts[bucket(length(injury))]! += 1;
    // A long injury the engine reported keeps the player out of every game of his club until his return date.
    let gamesMissed = 0, longOut = 0;
    for (const injury of state.injuries) {
      const missed = state.fixtures.filter(fixture => fixture.result && fixture.date > injury.occurredOn && isRecovering(injury, fixture.date, state.physio) && [fixture.homeClubId, fixture.awayClubId].includes(injury.clubId));
      for (const fixture of missed) {
        expect(fixture.result!.injuries[injury.playerId]).toBe(injury.kind);
        expect(fixture.result!.stats[injury.playerId]?.secondsPlayed ?? 0).toBe(0);
      }
      gamesMissed += missed.length;
      if (length(injury) >= 21 && missed.length) longOut += 1;
      // The engine reported him injured in his originating game.
      expect(state.fixtures.find(fixture => fixture.id === injury.fixtureId)!.result!.injuries[injury.playerId]).toBe(injury.kind);
    }
    expect(state.injuries.length).toBeGreaterThan(5);
    expect(longOut).toBeGreaterThan(0);
    expect(gamesMissed).toBeGreaterThan(state.injuries.length);
    expect(counts['3-8 weeks']! + counts.longer!).toBeGreaterThan(0);
    const saved = parseSeason(serializeSeason(state));
    expect(saved.injuryModel).toBe(INJURY_MODEL_2);
    expect(() => parseSeason(serializeSeason({ ...state, injuryModel: 'injuries-9' as never }))).toThrow(/injuryModel/);
  }, 600_000);
});
