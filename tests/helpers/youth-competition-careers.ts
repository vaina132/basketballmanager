import type { SeasonState } from '../../src/domain/season';
import { setAutoSubstitutions, simulateToEnd } from '../../src/engine/match';
import { offerAcademyPromotion } from '../../src/world/academy';
import { getClubAcademy } from '../../src/world/academy-policy';
import { offerPlayerContract, setEmploymentDelegation } from '../../src/world/employment';
import { getCareerWage } from '../../src/world/player-catalog';
import { requiredNegotiationWage } from '../../src/world/negotiations-policy';
import { advanceSeason, createSeason, managedSide, rolloverSeason } from '../../src/world/season';
import { enableYouthCompetition, getYouthFixtures, getYouthPlayerStatus } from '../../src/world/youth-competition';

export const advanceYouthCareer = (state: SeasonState): SeasonState => advanceSeason({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) });
export const createYouthCareer = (seed = 227) => createSeason(seed, 'rhine-falcons', 'standard', true, true, true, true, null, true, true, true, false, true, true, true, true, true, true, true, true);

export function createYouthCompetitionCareers() {
  const initial = createYouthCareer(), played = advanceYouthCareer(initial);
  const prospect = getClubAcademy(played).find(row => getYouthPlayerStatus(played, row.player.id).available)!;
  const pending = offerAcademyPromotion(played, prospect.player.id, requiredNegotiationWage(prospect.player.id, 1, undefined, played));
  const promoted = advanceYouthCareer(pending), continued = advanceYouthCareer(promoted);
  let complete = setEmploymentDelegation(continued, true);
  while (complete.status === 'active') complete = advanceYouthCareer(complete);
  const opening = rolloverSeason(complete), openingNext = advanceYouthCareer(opening);
  return { initial, played, pending, promoted, continued, complete, opening, openingNext, prospect };
}

/** Actual old career with eight senior players: four ordinary promotions leave a four-player youth squad. */
export function createYouthShortageCareers(legacy: SeasonState) {
  const initial = enableYouthCompetition(legacy);
  const fixture = getYouthFixtures(initial).find(item => item.round === 2 && ![item.homeClubId, item.awayClubId].includes(initial.managedClubId) && [item.homeClubId, item.awayClubId].every(id => initial.clubs.find(club => club.id === id)!.players.length === 8))!;
  if (!fixture) throw new Error('The genuine old career must contain two eight-player senior squads meeting next matchday.');
  const bid = (state: SeasonState, clubId: string) => {
    let next = state;
    for (const row of getClubAcademy(next, clubId).slice(0, 4)) next = offerAcademyPromotion(next, row.player.id, requiredNegotiationWage(row.player.id, 1, undefined, next), clubId);
    return next;
  };
  const pendingOne = bid(initial, fixture.homeClubId), pendingBoth = bid(pendingOne, fixture.awayClubId);
  const promotedOne = advanceYouthCareer(pendingOne), promotedBoth = advanceYouthCareer(pendingBoth);
  const forfeit = advanceYouthCareer(promotedOne), noContest = advanceYouthCareer(promotedBoth);
  return { initial, fixture, pendingOne, pendingBoth, promotedOne, promotedBoth, forfeit, noContest };
}

/** The manager renews eight senior players, then promotes four academy players at the next opening. */
export function createManagedYouthShortageCareers() {
  let state = createSeason(227, 'rhine-falcons', 'off', true, true, true, true, null, true, true, true, false, true, true, true, true, true, true, true, true);
  for (const player of state.clubs.find(club => club.id === state.managedClubId)!.players.slice(0, 8)) state = offerPlayerContract(state, player.id, getCareerWage(state, player.id), 1);
  while (state.status === 'active') state = advanceYouthCareer(state);
  const opening = rolloverSeason(state);
  let pending = opening;
  for (const row of getClubAcademy(opening).slice(0, 4)) pending = offerAcademyPromotion(pending, row.player.id, requiredNegotiationWage(row.player.id, 1, undefined, pending));
  const short = advanceYouthCareer(pending), forfeited = advanceYouthCareer(short);
  return { opening, pending, short, forfeited };
}

/** Find an actual diagnosis before submitting a separate, otherwise identical pending-promotion branch. */
export function createYouthInjuryCareers() {
  for (const seed of [227, 912, 9, 3, 11]) {
    let before = createYouthCareer(seed);
    while (before.round < 10) {
      const injured = advanceYouthCareer(before);
      const casualty = getClubAcademy(injured).find(row => getYouthPlayerStatus(injured, row.player.id).injury && getYouthPlayerStatus(before, row.player.id).available);
      if (casualty) {
        const pending = offerAcademyPromotion(before, casualty.player.id, requiredNegotiationWage(casualty.player.id, 1, undefined, before));
        const cancelled = advanceYouthCareer(pending);
        const partial = advanceYouthCareer(cancelled);
        return { before, injured, pending, cancelled, partial, playerId: casualty.player.id };
      }
      before = injured;
    }
  }
  throw new Error('The supported genuine seeds must expose a youth injury before the final matchday.');
}
