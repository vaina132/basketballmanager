import type { SeasonState } from '../domain/season';
import { awaitsContractReply, getSeasonContractRequests, getSquadRank, raiseContractRequests, replyToContractRequest } from './relationships';
import { commitPlayerOffer } from './employment';
import { quotePlayerContract } from './employment-policy';
import { requiredNegotiationWage } from './negotiations-policy';
import { getInSeasonOffers } from './recruitment-policy';
import { RELATIONSHIP_RULES } from './relationship-rules';

const RULES = RELATIONSHIP_RULES.contractRequests;

/**
 * An AI club answers its player's open request by the same rules as the manager: it renews a player ranked within
 * `ai.renewMaxRank` when an ordinary renewal at his demand fits its budget (opening talks and signing at once), waits
 * while another club's transfer proposal for him is unresolved, and otherwise lets him go by declining.
 */
function answerAsAiClub(state: SeasonState, clubId: string, playerId: string, lastChance: boolean): SeasonState {
  const rank = getSquadRank(state, playerId, clubId);
  if (rank === null || rank > RULES.ai.renewMaxRank) return replyToContractRequest(state, playerId, 'decline', clubId);
  for (const seasons of [...new Set([RULES.ai.renewalSeasons, 1])]) {
    let wage: number;
    try { wage = requiredNegotiationWage(playerId, seasons, undefined, state); } catch { break; } // No wage terms: let him go.
    if (quotePlayerContract(state, playerId, wage, seasons, clubId).canOffer) return commitPlayerOffer(replyToContractRequest(state, playerId, 'talks', clubId), clubId, playerId, wage, seasons);
  }
  const saleOpen = getInSeasonOffers(state, undefined, true).some(offer => offer.playerId === playerId && offer.transfer?.sellerClubId === clubId);
  return saleOpen && !lastChance ? state : replyToContractRequest(state, playerId, 'decline', clubId);
}

/**
 * At each matchday boundary: valued final-year players ask about new contracts, and AI clubs answer theirs. With
 * delegated recruitment the assistant answers the manager's players by the same rules, as it handles renewals.
 */
export function processContractRequests(state: SeasonState): SeasonState {
  if (state.relationships.model !== 'relationships-2' || !state.relationships.enabledSince || state.status !== 'active') return state;
  let next = raiseContractRequests(state);
  // A player sold before an answer is not answered; his request lapses as ignored.
  const open = getSeasonContractRequests(next).filter(request => awaitsContractReply(next, request) && (request.clubId !== next.managedClubId || next.employment.delegated));
  for (const request of open) next = answerAsAiClub(next, request.clubId, request.playerId, next.round >= request.round + RULES.replyRounds - 1);
  return next;
}
