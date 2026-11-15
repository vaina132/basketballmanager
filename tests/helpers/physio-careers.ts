import type { SeasonState } from '../../src/domain/season';
import { setAutoSubstitutions, simulateToEnd } from '../../src/engine/match';
import { advanceSeason, createSeason, managedSide, rolloverSeason } from '../../src/world/season';
import { enablePhysio, hirePhysio, releasePhysio } from '../../src/world/physio';
import { availablePhysios, getClubPhysio } from '../../src/world/physio-policy';
import { hireFitnessCoach } from '../../src/world/fitness';
import { availableFitnessCoaches } from '../../src/world/fitness-policy';
import { hireScout } from '../../src/world/scouts';
import { setTrainingPlan } from '../../src/world/training';

export const finishPhysioMatch = (state: SeasonState): SeasonState => ({
  ...state,
  activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch!, managedSide(state), true)),
});

/** Exercise the same committed world transition used by the browser worker. */
export const advancePhysioCareer = (state: SeasonState): SeasonState => advanceSeason(finishPhysioMatch(state));

/** Genuine first-match injury, paired care, retained history and two complete seasons. */
export function createPhysioCareers() {
  let opening = hireScout(createSeason(227, 'rhine-falcons', 'standard', true, true, true, true, null, false, true, false, false, true, true), 'scout-06');
  opening = hireFitnessCoach(opening, availableFitnessCoaches(opening).find(coach => coach.fee === 2_000_000)!.id);
  opening = setTrainingPlan(opening, { ...opening.training.plans[opening.managedClubId]!, delegated: false, intensity: 'heavy' });
  const initial = enablePhysio(advancePhysioCareer(opening));
  const hired = hirePhysio(initial, 'physio-12');
  const fulltime = finishPhysioMatch(hired);
  const withoutPhysio = advancePhysioCareer(initial);
  const treated = advanceSeason(fulltime);
  const continuedCare = advancePhysioCareer(treated);
  const baselineReturn = advancePhysioCareer(withoutPhysio);
  const released = releasePhysio(treated, getClubPhysio(treated)!.id);
  const replacement = availablePhysios(released).find(physio => physio.fee === 2_000_000)!;
  const replaced = hirePhysio(released, replacement.id);
  const replacementWeek = advancePhysioCareer(replaced);
  const boundaries = [initial, hired, treated, released, replaced, replacementWeek];
  let roundTen = replacementWeek;
  while (roundTen.round < 10) { roundTen = advancePhysioCareer(roundTen); boundaries.push(roundTen); }
  const completed = advancePhysioCareer(roundTen);
  const nextYear = rolloverSeason(completed);
  boundaries.push(completed, nextYear);
  let secondSeason = nextYear;
  while (secondSeason.status === 'active') { secondSeason = advancePhysioCareer(secondSeason); boundaries.push(secondSeason); }
  return { opening, initial, hired, fulltime, withoutPhysio, treated, continuedCare, baselineReturn, released, replaced, replacementWeek, roundTen, completed, nextYear, secondSeason, boundaries };
}

/** This seed produces a naturally occurring injury that can cross a fixture boundary. */
export function createPhysioEligibilityCareers() {
  const opening = createSeason(9, 'aegean-waves', 'standard', false, false, true, true);
  const initial = enablePhysio(advancePhysioCareer(opening));
  const hired = hirePhysio(initial, 'physio-12');
  const fulltime = finishPhysioMatch(hired);
  const treated = advanceSeason(fulltime);
  const withoutPhysio = advancePhysioCareer(initial);
  const returned = advancePhysioCareer(treated);
  const stillUnavailable = advancePhysioCareer(withoutPhysio);
  return { initial, hired, fulltime, treated, withoutPhysio, returned, stillUnavailable };
}
