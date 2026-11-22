import type { SeasonState } from '../../src/domain/season';
import { setAutoSubstitutions, simulateToEnd } from '../../src/engine/match';
import { quoteBoardFunding, type BoardFundingQuote } from '../../src/world/board-funding-policy';
import { setEmploymentDelegation } from '../../src/world/employment';
import { setFacilityDelegation, startFacilityUpgrade } from '../../src/world/facilities';
import { FACILITY_TYPES, getActiveFacilityProject, quoteFacilityUpgrade } from '../../src/world/facilities-policy';
import { advanceMarket } from '../../src/world/market';
import { getMarketStartReason } from '../../src/world/market-policy';
import { advanceSeason, createSeason, managedSide, NEW_CAREER_SYSTEMS, rolloverSeason } from '../../src/world/season';

export const advanceMatchday = (state: SeasonState) => advanceSeason({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch!, managedSide(state), true)) });

/** A Rhine career (seed 227 by default) with automatic contracts and facilities, played to the end of the first offseason
 * market. It keeps the earlier staffing (`staffing: false`) on purpose: careers with the board-capital facilities
 * (`simpleFacilities: false`, formats before 74) had no opening staff. */
export function playFirstSeason(boardConsequences: boolean, seed = 227): SeasonState {
  const manager = { name: 'Verdict Manager', dateOfBirth: '1984-03-17', nationality: 'Germany' };
  let state = createSeason({ seed, managedClubId: 'rhine-falcons', injuryMode: 'standard', manager, ...NEW_CAREER_SYSTEMS, staffing: false, simpleFacilities: false, boardConsequences });
  state = setEmploymentDelegation(setFacilityDelegation(state, true), true);
  while (state.status === 'active') state = advanceMatchday(state);
  for (let step = 0; step < 80 && getMarketStartReason(state); step += 1) state = advanceMarket(state);
  return state;
}

/** The manager upgrades the most expensive affordable facility whenever idle, until an upgrade needs board capital.
 * Board capital exists only with the facilities of formats before 74, so this career also keeps their staffing. */
export function driveToFundingRequest(clubId: string, seed: number): { state: SeasonState; quote: BoardFundingQuote } {
  let state = createSeason({ seed, managedClubId: clubId, injuryMode: 'off', ...NEW_CAREER_SYSTEMS, staffing: false, simpleFacilities: false });
  for (let step = 0; step < 40; step += 1) {
    if (!getActiveFacilityProject(state, clubId)) {
      const affordable = FACILITY_TYPES.map(type => quoteFacilityUpgrade(state, type, clubId)).filter(quote => quote.canStart).sort((a, b) => b.cost - a.cost)[0];
      if (affordable) state = startFacilityUpgrade(state, affordable.type);
      const quote = FACILITY_TYPES.map(type => quoteBoardFunding(state, type, clubId)).find(item => item.eligible);
      if (quote) return { state, quote };
    }
    if (state.status === 'active') state = advanceMatchday(state);
    else {
      state = setEmploymentDelegation(state, true);
      for (let i = 0; i < 80 && getMarketStartReason(state); i += 1) state = advanceMarket(state);
      state = rolloverSeason(state);
    }
  }
  throw new Error('No funding request became possible.');
}
