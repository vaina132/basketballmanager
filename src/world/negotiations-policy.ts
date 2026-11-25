import type { NegotiationDecision, NegotiationTerms } from '../domain/negotiations';
import type { SquadRole } from '../domain/relationships';
import { getCareerWage, type CareerPlayerContext } from './player-catalog';
import { releaseFeeReason } from './release-clauses';
import { maxContractWage, MIN_CONTRACT_WAGE } from './employment-policy';
import { roleWage } from './contract-roles';
import { nbaLateFreeAgentMinimum } from './nba-cap-policy';
import { nbaEuropeanDemand } from './nba-moves';
import { cappedNbaDemand } from './nba-free-agency';

const WAGE_STEP = 50_000;
export const NEGOTIATION_TERM_PREMIUMS = [0, 5, 10] as const;
export const RELEASE_CLAUSE_PREMIUM_CAP = 5;

/**
 * The player's one-season demand: his catalog wage, changed by the squad role offered (`relationships-3`; no role in
 * older careers leaves it unchanged).
 */
function roleBase(playerId: string, context: CareerPlayerContext, role: SquadRole | undefined, clubId?: string): number {
  const base = roleWage(getCareerWage(context, playerId), role, context);
  // Format 92: late in the NBA's free agency an unsigned player accepts his minimum salary.
  const late = nbaLateFreeAgentMinimum(context, playerId), demand = late !== null && late < base ? late : base;
  // Format 93: a player paid on the NBA's scale asks a European club a European wage (`nba-moves.ts`).
  const european = nbaEuropeanDemand(context, playerId, clubId, demand);
  // Format 103: never more than the player's maximum NBA contract; less from other clubs in free agency (`nba-free-agency.ts`).
  return cappedNbaDemand(context, clubId, playerId, european ?? demand);
}

/** Uniform development contract rule, independent of hidden abilities or invented preferences. */
export function requiredNegotiationWage(playerId: string, seasons: number, releaseFee?: number, context: CareerPlayerContext = {}, role?: SquadRole, clubId?: string): number {
  if (!Number.isInteger(seasons) || seasons < 1 || seasons > 3) throw new Error('Choose a contract lasting one to three seasons.');
  const base = roleBase(playerId, context, role, clubId);
  const clauseReason = releaseFeeReason(releaseFee, context);
  if (clauseReason) throw new Error(clauseReason);
  const premium = releaseFee === undefined ? NEGOTIATION_TERM_PREMIUMS[seasons - 1]! : Math.min(RELEASE_CLAUSE_PREMIUM_CAP, NEGOTIATION_TERM_PREMIUMS[seasons - 1]!);
  return cappedNbaDemand(context, clubId, playerId, Math.ceil(base * (100 + premium) / (100 * WAGE_STEP)) * WAGE_STEP);
}

export function getNegotiationDemands(playerId: string, releaseFee?: number, context: CareerPlayerContext = {}, role?: SquadRole, clubId?: string): { baseWage: number; terms: NegotiationTerms[] } {
  return { baseWage: roleBase(playerId, context, role, clubId), terms: [1, 2, 3].map(seasons => ({ seasons, seasonWage: requiredNegotiationWage(playerId, seasons, releaseFee, context, role, clubId), ...(releaseFee === undefined ? {} : { releaseFee }) })) };
}

/** `clubId` (format 93): the offering club, whose league can change the demand of a player paid on the NBA's scale. */
export function evaluateNegotiation(playerId: string, seasonWage: number, seasons: number, releaseFee?: number, context: CareerPlayerContext = {}, role?: SquadRole, clubId?: string): NegotiationDecision {
  const base = roleBase(playerId, context, role, clubId), requiredWage = requiredNegotiationWage(playerId, seasons, releaseFee, context, role, clubId);
  if (!Number.isInteger(seasonWage) || seasonWage < MIN_CONTRACT_WAGE || seasonWage > maxContractWage(context) || seasonWage % WAGE_STEP !== 0) throw new Error('Choose a valid annual wage in €500 steps.');
  if (seasonWage >= requiredWage) return { outcome: 'accepted', reason: 'terms-met', requiredWage, counterOffer: null, alternativeOffer: null };
  if (seasonWage * 4 < base * 3) return { outcome: 'rejected', reason: 'far-below-demand', requiredWage, counterOffer: null, alternativeOffer: null };
  let alternativeOffer: NegotiationTerms | null = null;
  for (let shorter = seasons - 1; shorter >= 1; shorter -= 1) if (seasonWage >= requiredNegotiationWage(playerId, shorter, releaseFee, context, role, clubId)) {
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
