import type { SeasonState } from '../../src/domain/season';
import { setAutoSubstitutions, simulateToEnd } from '../../src/engine/match';
import { hireAssistant, releaseAssistant, setAssistantRenewal } from '../../src/world/assistant';
import { availableAssistants, getClubAssistant } from '../../src/world/assistant-policy';
import { hireFitnessCoach } from '../../src/world/fitness';
import { availableFitnessCoaches } from '../../src/world/fitness-policy';
import { hirePhysio } from '../../src/world/physio';
import { availablePhysios } from '../../src/world/physio-policy';
import { hireScout } from '../../src/world/scouts';
import { advanceSeason, createSeason, managedSide, rolloverSeason } from '../../src/world/season';

export const assistantClub = 'rhine-falcons';
export const finishAssistantMatch = (state: SeasonState): SeasonState => ({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch!, managedSide(state), true)) });
export const advanceAssistantCareer = (state: SeasonState): SeasonState => advanceSeason(finishAssistantMatch(state));

/** Actual appointments and career commands; all five staff roles share the allocation. */
export function createAssistantCareers() {
  let initial = hireScout(createSeason(731, assistantClub, 'off', true, true, true, true, null, false, true, false, false, true, true, true, true), 'scout-06');
  initial = hireFitnessCoach(initial, availableFitnessCoaches(initial).find(staff => staff.fee === 2_000_000)!.id);
  initial = hirePhysio(initial, availablePhysios(initial).find(staff => staff.fee === 2_000_000)!.id);
  const hired = hireAssistant(initial, availableAssistants(initial).find(staff => staff.fee === 2_000_000)!.id);
  const afterWeek = advanceAssistantCareer(hired);
  const released = releaseAssistant(afterWeek, getClubAssistant(afterWeek)!.id);
  const replaced = hireAssistant(released, availableAssistants(released).find(staff => staff.fee === 3_000_000)!.id);
  let roundTen = replaced;
  while (roundTen.round < 10) roundTen = advanceAssistantCareer(roundTen);
  const fulltime = finishAssistantMatch(roundTen);
  const completed = advanceSeason(fulltime);
  const nextYear = rolloverSeason(completed);
  const noRenewal = setAssistantRenewal(completed, getClubAssistant(completed)!.id, false);
  const nextWithoutRenewal = rolloverSeason(noRenewal);
  return { initial, hired, afterWeek, released, replaced, roundTen, fulltime, completed, nextYear, noRenewal, nextWithoutRenewal };
}
