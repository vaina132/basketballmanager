import type { NegotiationDecision, NegotiationTerms } from '../domain/negotiations';
import { getCareerWage, type CareerPlayerContext } from './player-catalog';
import { releaseFeeReason } from './release-clauses';
import { maxContractWage, MIN_CONTRACT_WAGE } from './employment-policy';

const WAGE_STEP = 50_000;
export const NEGOTIATION_TERM_PREMIUMS = [0, 5, 10] as const;
export const RELEASE_CLAUSE_PREMIUM_CAP = 5;

/** Uniform development contract rule, independent of hidden abilities or invented preferences. */
export function requiredNegotiationWage(playerId: string, seasons: number, releaseFee?: number, context: CareerPlayerContext = {}): number {
  if (!Number.isInteger(seasons) || seasons < 1 || seasons > 3) throw new Error('Choose a contract lasting one to three seasons.');
  const base = getCareerWage(context, playerId);
  const clauseReason = releaseFeeReason(releaseFee, context);
  if (clauseReason) throw new Error(clauseReason);
  const premium = releaseFee === undefined ? NEGOTIATION_TERM_PREMIUMS[seasons - 1]! : Math.min(RELEASE_CLAUSE_PREMIUM_CAP, NEGOTIATION_TERM_PREMIUMS[seasons - 1]!);
  return Math.ceil(base * (100 + premium) / (100 * WAGE_STEP)) * WAGE_STEP;
}

export function getNegotiationDemands(playerId: string, releaseFee?: number, context: CareerPlayerContext = {}): { baseWage: number; terms: NegotiationTerms[] } {
  return { baseWage: getCareerWage(context, playerId), terms: [1, 2, 3].map(seasons => ({ seasons, seasonWage: requiredNegotiationWage(playerId, seasons, releaseFee, context), ...(releaseFee === undefined ? {} : { releaseFee }) })) };
}

export function evaluateNegotiation(playerId: string, seasonWage: number, seasons: number, releaseFee?: number, context: CareerPlayerContext = {}): NegotiationDecision {
  const base = getCareerWage(context, playerId), requiredWage = requiredNegotiationWage(playerId, seasons, releaseFee, context);
  if (!Number.isInteger(seasonWage) || seasonWage < MIN_CONTRACT_WAGE || seasonWage > maxContractWage(context) || seasonWage % WAGE_STEP !== 0) throw new Error('Choose a valid annual wage in €500 steps.');
  if (seasonWage >= requiredWage) return { outcome: 'accepted', reason: 'terms-met', requiredWage, counterOffer: null, alternativeOffer: null };
  if (seasonWage * 4 < base * 3) return { outcome: 'rejected', reason: 'far-below-demand', requiredWage, counterOffer: null, alternativeOffer: null };
  let alternativeOffer: NegotiationTerms | null = null;
  for (let shorter = seasons - 1; shorter >= 1; shorter -= 1) if (seasonWage >= requiredNegotiationWage(playerId, shorter, releaseFee, context)) {
    alternativeOffer = { seasonWage, seasons: shorter, ...(releaseFee === undefined ? {} : { releaseFee }) }; break;
  }
  return { outcome: 'countered', reason: seasonWage >= base ? 'term-premium' : 'below-demand', requiredWage, counterOffer: { seasonWage: requiredWage, seasons, ...(releaseFee === undefined ? {} : { releaseFee }) }, alternativeOffer };
}

export function negotiationReasonText(decision: NegotiationDecision): string {
  switch (decision.reason) {
    case 'terms-met': return 'The annual wage meets the player’s requirement for this contract length.';
    case 'term-premium': return 'Fixing the salary for longer requires a higher annual wage; a shorter commitment may fit this offer.';
    case 'below-demand': return 'The offered annual wage is below the player’s requirement for this contract length.';
    case 'far-below-demand': return 'The offer is below 75% of the player’s one-year wage requirement. Submit improved terms to continue.';
  }
}
