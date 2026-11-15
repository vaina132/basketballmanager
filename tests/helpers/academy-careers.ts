import type { SeasonState } from '../../src/domain/season';
import { simulateToEnd, setAutoSubstitutions } from '../../src/engine/match';
import { offerAcademyPromotion, setAcademyFocus } from '../../src/world/academy';
import { getClubAcademy } from '../../src/world/academy-policy';
import { hireAssistant } from '../../src/world/assistant';
import { availableAssistants } from '../../src/world/assistant-policy';
import { hireFitnessCoach } from '../../src/world/fitness';
import { availableFitnessCoaches } from '../../src/world/fitness-policy';
import { hirePhysio } from '../../src/world/physio';
import { availablePhysios } from '../../src/world/physio-policy';
import { hireScout } from '../../src/world/scouts';
import { advanceSeason, createSeason, managedSide, rolloverSeason } from '../../src/world/season';
import { offerPlayerContract } from '../../src/world/employment';
import { getCareerWage } from '../../src/world/player-catalog';
import { submitInSeasonOffer } from '../../src/world/recruitment';
import { hireYouthCoach, releaseYouthCoach } from '../../src/world/youth';
import { availableYouthCoaches, getClubYouthCoach } from '../../src/world/youth-policy';

export const academyClub = 'rhine-falcons';
export const advanceAcademyCareer = (state: SeasonState): SeasonState => advanceSeason({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch!, managedSide(state), true)) });

/** All six staff roles, real completed weeks, and a prospect accepted for the next matchday. */
export function createAcademyCareers() {
  let initial = createSeason(227, academyClub, 'standard', true, true, true, true, null, true, true, true, true, true, true, true, true, true, true);
  initial = hireScout(initial, 'scout-06');
  initial = hireFitnessCoach(initial, availableFitnessCoaches(initial).find(coach => coach.fee === 2_000_000)!.id);
  initial = hirePhysio(initial, availablePhysios(initial).find(coach => coach.fee === 2_000_000)!.id);
  initial = hireAssistant(initial, availableAssistants(initial).find(coach => coach.fee === 2_000_000)!.id);
  const hired = hireYouthCoach(initial, 'youth-12');
  const prospect = getClubAcademy(hired)[0]!.prospect;
  const focused = setAcademyFocus(hired, prospect.player.id, 'twoPoint');
  const week = advanceAcademyCareer(focused);
  const released = releaseYouthCoach(week, getClubYouthCoach(week)!.id);
  // A replacement is deliberately not hired: all six paid roles use this year's allocation.
  const developed = advanceAcademyCareer(advanceAcademyCareer(week));
  const pending = offerAcademyPromotion(developed, prospect.player.id, prospect.seasonWage);
  const promoted = advanceAcademyCareer(pending);
  const continued = advanceAcademyCareer(promoted);
  const replacementBlocked = availableYouthCoaches(released)[0]!;
  return { initial, hired, focused, week, released, developed, pending, promoted, continued, prospect, replacementBlocked };
}

/** Preserve the senior squad through actual renewals while the original oldest prospect ages out. */
export function createAcademyAgeOutCareers() {
  let state = createSeason(912, academyClub, 'off', true, false, true, true, null, true, true, true, false, false, false, false, false, true, true);
  state = hireYouthCoach(state, 'youth-12');
  const prospect = getClubAcademy(state)[2]!.prospect;
  state = setAcademyFocus(state, prospect.player.id, 'twoPoint');
  const openings: SeasonState[] = [];
  for (let year = 1; year <= 3; year += 1) {
    for (const player of state.clubs.find(club => club.id === academyClub)!.players) state = offerPlayerContract(state, player.id, getCareerWage(state, player.id), 1);
    while (state.status === 'active') state = advanceAcademyCareer(state);
    state = rolloverSeason(state);
    openings.push(state);
  }
  const ageOut = state;
  const pending = submitInSeasonOffer(ageOut, prospect.player.id, prospect.seasonWage);
  const signed = advanceAcademyCareer(pending);
  const continued = advanceAcademyCareer(signed);
  return { yearTwo: openings[0]!, yearThree: openings[1]!, ageOut, pending, signed, continued, prospect };
}
