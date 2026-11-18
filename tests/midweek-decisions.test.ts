import { describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { validateSeasonState } from '../src/storage/season-storage';
import { continueUntilStop } from '../src/ui/continue-run';
import { roundOrdinal, seasonRounds } from '../src/world/career-world';
import { getPressQuestion } from '../src/world/press-policy';
import { agreeSquadRole, answerPress, getSquadRelationships, quoteSquadRole, relationshipEventAnchor, squadRoles } from '../src/world/relationships';
import { createSeason, managedSide, NEW_CAREER_SYSTEMS } from '../src/world/season';
// @ts-expect-error: a plain JavaScript helper shared with the European competition tests (no type declarations).
import { placesWorld } from './helpers/europe-worlds.js';

const finish = (state: SeasonState): SeasonState => state.activeMatch && state.activeMatch.status !== 'finished'
  ? { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) } : state;
const partlyPlayed = (state: SeasonState) => state.status === 'active' && state.fixtures.some(fixture => fixture.round >= state.round && fixture.result);
/** The first role change the Squad list allows, if any. */
function changeRole(state: SeasonState): SeasonState | null {
  for (const row of getSquadRelationships(state)) for (const role of squadRoles(state.relationships.model)) {
    if (role !== row.role && quoteSquadRole(state, row.player.id, role).canAgree) return agreeSquadRole(state, row.player.id, role);
  }
  return null;
}

// Owner report (18 November 2026): a role changed on Squad at a Continue stop between a week's game days made every
// later save fail the strict check ("relationships.events[7] must identify an actual pre-match ... boundary").
describe('player decisions between a week\'s game days', () => {
  it('records them at the week\'s start, so the strict save check accepts every stop Continue makes', () => {
    const world = placesWorld(), clubId = world.clubs[0].id;
    let state = createSeason({ world, seed: 31, managedClubId: clubId, injuryMode: 'standard', ...NEW_CAREER_SYSTEMS });
    let midweek = 0;
    for (let run = 0; run < 14 && midweek < 2; run += 1) {
      for (const step of [(current: SeasonState) => current, finish]) {
        let current = step(state);
        const changed = changeRole(current);
        if (changed) current = changed;
        const question = getPressQuestion(current);
        if (question && !question.answered) current = answerPress(current, question.answers[0]!);
        if (partlyPlayed(current)) {
          expect(relationshipEventAnchor(current).completedRounds).toBe(roundOrdinal(current.seasonNumber, current.round - 1, seasonRounds(current)));
          if (changed) midweek += 1;
        }
        expect(() => validateSeasonState(structuredClone(current))).not.toThrow();
        state = current;
      }
      state = continueUntilStop(state).state;
    }
    expect(midweek).toBeGreaterThan(0);
  }, 600_000);
});
