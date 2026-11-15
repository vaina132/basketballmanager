import type { SeasonState } from '../../src/domain/season';
import { setAutoSubstitutions, simulateToEnd } from '../../src/engine/match';
import { hireFitnessCoach, releaseFitnessCoach } from '../../src/world/fitness';
import { availableFitnessCoaches, getClubFitnessCoach } from '../../src/world/fitness-policy';
import { hireScout } from '../../src/world/scouts';
import { advanceSeason, createSeason, managedSide, rolloverSeason } from '../../src/world/season';
import { setTrainingPlan } from '../../src/world/training';

export const fitnessClub = 'rhine-falcons';
export const finishFitnessMatch = (state: SeasonState): SeasonState => ({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch!, managedSide(state), true)) });
export const advanceFitnessCareer = (state: SeasonState): SeasonState => advanceSeason(finishFitnessMatch(state));
export const useHeavyTraining = (state: SeasonState): SeasonState => setTrainingPlan(state, { ...state.training.plans[state.managedClubId]!, delegated: false, intensity: 'heavy', focus: 'balanced' });

/** Actual career commands only; no edited conditions, injuries, ledger or contracts. */
export function createFitnessCareers() {
  const initial = useHeavyTraining(hireScout(createSeason(731, fitnessClub, 'off', true, true, true, true, null, false, true, false, false, true, true), 'scout-06'));
  const hired = hireFitnessCoach(initial, 'fitness-12');
  const fulltime = finishFitnessMatch(hired);
  const withoutCoach = advanceFitnessCareer(initial);
  const reported = advanceSeason(fulltime);
  const released = releaseFitnessCoach(reported, getClubFitnessCoach(reported)!.id);
  const replacement = availableFitnessCoaches(released).filter(coach => coach.fee === 2_000_000)[0]!;
  const replaced = hireFitnessCoach(released, replacement.id);
  const replacementWeek = advanceFitnessCareer(replaced);
  const boundaries = [initial, reported, replaced, replacementWeek];
  let roundTen = replacementWeek;
  while (roundTen.round < 10) { roundTen = advanceFitnessCareer(roundTen); boundaries.push(roundTen); }
  const completed = advanceFitnessCareer(roundTen);
  const nextYear = rolloverSeason(completed);
  boundaries.push(completed, nextYear);
  let secondSeason = nextYear;
  while (secondSeason.status === 'active') { secondSeason = advanceFitnessCareer(secondSeason); boundaries.push(secondSeason); }
  const allocationBlocked = hireScout(hireScout(useHeavyTraining(createSeason(731, fitnessClub, 'off', true, true, true, true, null, false, true, false, false, true, true)), 'scout-19'), 'scout-13');
  return { initial, hired, fulltime, withoutCoach, reported, released, replaced, replacementWeek, roundTen, completed, nextYear, secondSeason, allocationBlocked, boundaries };
}
