import type { SeasonState } from '../../src/domain/season';
import { getSeasonWage } from '../../src/data/development-wages';
import { setAutoSubstitutions, simulateToEnd } from '../../src/engine/match';
import { offerPlayerContract } from '../../src/world/employment';
import { contractForSeason } from '../../src/world/employment-policy';
import { advanceMarket } from '../../src/world/market';
import { getLiveMarketOffers } from '../../src/world/market-policy';
import { requiredNegotiationWage } from '../../src/world/negotiations-policy';
import { prepayWages } from '../../src/world/payroll';
import { decideInSeasonTransfer, submitInSeasonTransferOffer } from '../../src/world/recruitment';
import { requiredInSeasonTransferFee } from '../../src/world/recruitment-policy';
import { advanceSeason, createSeason, managedSide, rolloverSeason } from '../../src/world/season';

export const outlookClub = 'rhine-falcons', outlookCounterparty = 'aegean-waves';
export const finishOutlookMatch = (state: SeasonState): SeasonState => state.activeMatch!.status === 'finished' ? state : ({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch!, managedSide(state), true)) });
export const advanceOutlookCareer = (state: SeasonState): SeasonState => advanceSeason(finishOutlookMatch(state));
export function completeOutlookSeason(state: SeasonState): SeasonState {
  while (state.status === 'active') state = advanceOutlookCareer(state);
  return state;
}

/** Real commands only: no edited cash, contracts, match dates or retained accounting. */
export function createOutlookCareers() {
  const healthy = createSeason(193, outlookClub, 'off', false, false, true, true, null, true, true, true, true);
  const fulltime = finishOutlookMatch(healthy);
  const prepaid = prepayWages(healthy, 'rhf-1');
  const pending = submitInSeasonTransferOffer(healthy, 'aeg-1', requiredNegotiationWage('aeg-1', 3), 3, requiredInSeasonTransferFee(healthy, 'aeg-1'), outlookClub, 'three-payments');
  const arrived = advanceOutlookCareer(pending);
  const sell = (state: SeasonState): SeasonState => {
    const proposed = submitInSeasonTransferOffer(state, 'rhf-1', getSeasonWage('rhf-1'), 1, requiredInSeasonTransferFee(state, 'rhf-1'), outlookCounterparty, 'upfront');
    return advanceOutlookCareer(decideInSeasonTransfer(proposed, proposed.recruitment.offers.at(-1)!.id, 'accept'));
  };
  const sold = sell(healthy), soldPrepaid = sell(prepaid);
  let renewed = arrived;
  for (const player of renewed.clubs.find(club => club.id === outlookClub)!.players) if (!contractForSeason(renewed.employment, player.id, 2)) renewed = offerPlayerContract(renewed, player.id, getSeasonWage(player.id), 1);
  const completed = completeOutlookSeason(renewed);
  let settled = completed;
  for (let count = 0; count < 20 && getLiveMarketOffers(settled).length; count += 1) settled = advanceMarket(settled);
  if (getLiveMarketOffers(settled).length) throw new Error('Outlook fixture recruitment did not settle.');
  const nextOpening = rolloverSeason(settled);
  let installmentPaid = nextOpening;
  while (installmentPaid.round < 6) installmentPaid = advanceOutlookCareer(installmentPaid);
  const disabled = createSeason(193, outlookClub, 'off', false, false, false, false);
  return { healthy, fulltime, prepaid, pending, arrived, sold, soldPrepaid, completed, nextOpening, installmentPaid, disabled };
}
