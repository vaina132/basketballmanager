import type { ContractOfferOptions } from '../domain/employment';
import type { SeasonState } from '../domain/season';
import type { TransferPaymentPlan } from '../domain/transfer-payments';
import { contractForRound, contractForSeason, effectiveContractsForRound } from './employment-policy';
import type { WorldContext } from '../domain/world';
import { REAL_ECONOMY_RULES, worldEconomy } from './economy';

export const MIN_RELEASE_FEE = 100_000;
export const MAX_RELEASE_FEE = 50_000_000;
export const RELEASE_FEE_STEP = 100_000;
/** The largest release fee: EUR 500,000 in the development economy, EUR 50 million with a researched economy (format 62). */
export const maxReleaseFee = (context?: WorldContext): number => worldEconomy(context) ? REAL_ECONOMY_RULES.limits.maxReleaseFee * 100 : MAX_RELEASE_FEE;

export function releaseFeeReason(fee: number | undefined, context?: WorldContext): string | null {
  const maximum = maxReleaseFee(context);
  return fee === undefined || Number.isSafeInteger(fee) && fee >= MIN_RELEASE_FEE && fee <= maximum && fee % RELEASE_FEE_STEP === 0 ? null : `Choose a release fee from EUR 1,000 to EUR ${(maximum / 100).toLocaleString('en-GB')} in EUR 1,000 steps, or no clause.`;
}

export function offerOptionsReason(state: Pick<SeasonState, 'negotiations'> & WorldContext, options: ContractOfferOptions, paid: boolean): string | null {
  if (options.transferMode !== undefined && options.transferMode !== 'negotiated' && options.transferMode !== 'release-clause' && options.transferMode !== 'loan') return 'Choose a negotiated transfer or explicit release-clause activation.';
  if (!paid && options.transferMode === 'release-clause') return 'Release-clause activation requires a paid club transfer.';
  // Format 78 (`recruitment-2`): a loan is a paid in-season move for the rest of the season.
  if (!paid && options.transferMode === 'loan') return 'A loan needs an agreement with the player\'s club.';
  if (options.transferMode === 'loan' && options.releaseFee !== undefined) return 'A loan carries no release clause.';
  if (options.releaseFee !== undefined && !state.negotiations.enabledSince) return 'Enable contract negotiations before agreeing a release clause.';
  return releaseFeeReason(options.releaseFee, state);
}

export interface ApplicableReleaseClause {
  fee: number | null;
  contractId: string | null;
  sellerClubId: string | null;
  canTrigger: boolean;
  reason: string | null;
}

/** A clause applies only to its active agreement; separately promised future terms are protected. */
export function getApplicableReleaseClause(state: SeasonState, playerId: string): ApplicableReleaseClause {
  const active = contractForRound(state.employment, playerId, state.seasonNumber, state.round);
  const target = state.status === 'complete' ? contractForSeason(state.employment, playerId, state.seasonNumber + 1) : active;
  let reason: string | null = null;
  if (!target || target.releaseFee === undefined) reason = 'This contract has no agreed release clause.';
  else if (releaseFeeReason(target.releaseFee, state)) reason = releaseFeeReason(target.releaseFee, state);
  else if (active?.id !== target.id) reason = 'This release clause starts with the future contract. It cannot be activated before that agreement begins.';
  else {
    const through = Math.max(state.seasonNumber, ...state.employment.contracts.filter(contract => contract.playerId === playerId).map(contract => contract.endsSeason));
    for (let year = state.seasonNumber + 1; year <= through; year += 1) if (effectiveContractsForRound(state.employment, year, 1).some(contract => contract.playerId === playerId && contract.id !== target.id)) {
      reason = 'A separate future agreement protects this player. Negotiate a transfer covering those terms instead of activating this clause.'; break;
    }
  }
  return { fee: target?.releaseFee ?? null, contractId: target?.id ?? null, sellerClubId: target?.clubId ?? null, canTrigger: reason === null, reason };
}

export function releaseClauseTriggerReason(state: SeasonState, playerId: string, fee: number, paymentPlan: TransferPaymentPlan): string | null {
  const clause = getApplicableReleaseClause(state, playerId);
  if (!clause.canTrigger) return clause.reason;
  if (fee !== clause.fee) return 'Activate the release clause at its exact agreed fee.';
  if (paymentPlan !== 'upfront') return 'Release clauses must be paid in full when the transfer completes.';
  return null;
}
